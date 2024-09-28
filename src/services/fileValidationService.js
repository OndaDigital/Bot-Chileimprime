import fs from 'fs';
import { promisify } from 'util';
import path from 'path';
import logger from '../utils/logger.js';
import { CustomError } from '../utils/errorHandler.js';
import config from '../config/config.js';
import sharp from 'sharp';
import pdf from 'pdf-parse';
import { fileTypeFromFile } from 'file-type';

const readFile = promisify(fs.readFile);

class FileValidationService {
  constructor() {
    this.supportedFormats = ['jpg', 'jpeg', 'png', 'pdf', 'ai', 'psd', 'cdr'];
  }

  async initialize() {
    logger.info('FileValidationService inicializado');
  }

  async validateFile(filePath, service) {
    try {
      const fileType = await fileTypeFromFile(filePath);
      const fileExtension = path.extname(filePath).toLowerCase().slice(1);
      
      if (!this.supportedFormats.includes(fileExtension)) {
        throw new CustomError('UnsupportedFormatError', `Formato de archivo no soportado: ${fileExtension}`);
      }

      let fileInfo;
      if (['jpg', 'jpeg', 'png'].includes(fileExtension)) {
        fileInfo = await this.validateImage(filePath);
      } else if (fileExtension === 'pdf') {
        fileInfo = await this.validatePDF(filePath);
      } else {
        fileInfo = { format: fileExtension };
      }

      return this.checkFileRequirements(fileInfo, service);
    } catch (error) {
      logger.error(`Error al validar el archivo: ${error.message}`);
      throw new CustomError('FileValidationError', 'Error al validar el archivo', error);
    }
  }

  async validateImage(filePath) {
    const image = sharp(filePath);
    const metadata = await image.metadata();
    
    return {
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      dpi: metadata.density || 72,
      colorSpace: metadata.space
    };
  }

  async validatePDF(filePath) {
    const dataBuffer = await readFile(filePath);
    const data = await pdf(dataBuffer);
    
    const width = data.pages[0].width * (72 / 25.4); // Convertir a mm
    const height = data.pages[0].height * (72 / 25.4); // Convertir a mm
    
    return {
      format: 'pdf',
      width,
      height,
      dpi: 72,
      pages: data.numpages
    };
  }

  checkFileRequirements(fileInfo, service) {
    let isValid = true;
    let reason = '';
    const area = (fileInfo.width / 1000) * (fileInfo.height / 1000); // Convertir a metros cuadrados

    // Verificar formato
    if (service.format && service.format.toLowerCase() !== fileInfo.format.toLowerCase()) {
      isValid = false;
      reason += `El formato del archivo (${fileInfo.format}) no coincide con el requerido (${service.format}). `;
    }

    // Verificar DPI
    let requiredDPI;
    if (area < 2) {
      requiredDPI = 150;
    } else if (area > 20) {
      requiredDPI = 72;
    } else {
      requiredDPI = 120;
    }

    if (fileInfo.dpi < requiredDPI) {
      isValid = false;
      reason += `La resolución del archivo (${fileInfo.dpi} DPI) es menor que la requerida (${requiredDPI} DPI) para un área de ${area.toFixed(2)} m². `;
    }

    // Verificar color space (solo para imágenes)
    if (['jpg', 'jpeg', 'png'].includes(fileInfo.format.toLowerCase())) {
      if (fileInfo.colorSpace !== 'cmyk') {
        reason += 'Advertencia: Las imágenes deben estar en formato CMYK para una mejor calidad de impresión. ';
      }
    }

    // Verificar acabados de impresión (esto requeriría un análisis más profundo del contenido del archivo)
    reason += 'Nota: Asegúrese de que los acabados de impresión (cortes, perforaciones, etc.) estén marcados con líneas punteadas color magenta. ';

    return {
      isValid,
      reason: reason.trim() || 'El archivo cumple con todos los requisitos.',
      fileInfo,
      area
    };
  }
}

export default new FileValidationService();
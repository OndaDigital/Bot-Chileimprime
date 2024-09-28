import fs from 'fs';
import { promisify } from 'util';
import path from 'path';
import logger from '../utils/logger.js';
import { CustomError } from '../utils/errorHandler.js';
import config from '../config/config.js';
import sharp from 'sharp';
import pdf from 'pdf-parse';

const readFile = promisify(fs.readFile);

class FileValidationService {
  constructor() {
    this.supportedFormats = ['jpg', 'jpeg', 'png', 'pdf', 'ai', 'psd', 'cdr'];
  }

  async initialize() {
    // Cualquier inicialización necesaria
    logger.info('FileValidationService inicializado');
  }

  async validateFile(filePath, service) {
    try {
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
      dpi: metadata.density || 72, // Si no se especifica, asumimos 72 DPI
    };
  }

  async validatePDF(filePath) {
    const dataBuffer = await readFile(filePath);
    const data = await pdf(dataBuffer);
    
    // Asumimos que el PDF está en puntos (72 DPI)
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

    // Verificar formato
    if (service.format && service.format.toLowerCase() !== fileInfo.format.toLowerCase()) {
      isValid = false;
      reason += `El formato del archivo (${fileInfo.format}) no coincide con el requerido (${service.format}). `;
    }

    // Verificar DPI
    if (fileInfo.dpi < service.minDPI) {
      isValid = false;
      reason += `La resolución del archivo (${fileInfo.dpi} DPI) es menor que la mínima requerida (${service.minDPI} DPI). `;
    }

    // Verificar tamaño
    if (service.category === 'Telas PVC' || service.category === 'Banderas' || 
        service.category === 'Adhesivos' || service.category === 'Adhesivo Vehicular' || 
        service.category === 'Back Light') {
      const area = (fileInfo.width / 1000) * (fileInfo.height / 1000); // Convertir a metros cuadrados
      if (area < 1) {
        isValid = false;
        reason += `El tamaño del archivo (${area.toFixed(2)} m²) es menor que el mínimo requerido (1 m²). `;
      }
      if (area > 20 && fileInfo.dpi < 72) {
        isValid = false;
        reason += `Para archivos mayores a 20 m², se requiere una resolución mínima de 72 DPI. `;
      }
    }

    // Verificar color (solo para imágenes)
    if (['jpg', 'jpeg', 'png'].includes(fileInfo.format.toLowerCase())) {
      if (fileInfo.space !== 'cmyk') {
        reason += 'Recomendación: Las imágenes deben estar en formato CMYK para una mejor calidad de impresión. ';
      }
    }

    return {
      isValid,
      reason: reason.trim() || 'El archivo cumple con todos los requisitos.',
      fileInfo
    };
  }
}

export default new FileValidationService();
import fs from 'fs';
import { promisify } from 'util';
import path from 'path';
import logger from '../utils/logger.js';
import { CustomError } from '../utils/errorHandler.js';
import sharp from 'sharp';
import fileType from 'file-type';

// Importar createRequire para usar require en ES Modules
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Importar pdf-parse utilizando require
const pdfParse = require('pdf-parse');

const readFile = promisify(fs.readFile);

class FileValidationService {
  constructor() {
    this.supportedFormats = ['jpg', 'jpeg', 'png', 'pdf', 'ai', 'psd', 'cdr'];
  }

  async analyzeFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new CustomError('FileNotFoundError', `El archivo no existe: ${filePath}`);
      }

      const buffer = await readFile(filePath);
      const fileTypeResult = await fileType.fromBuffer(buffer);
      const fileExtension = fileTypeResult ? fileTypeResult.ext : path.extname(filePath).toLowerCase().slice(1);

      if (!this.supportedFormats.includes(fileExtension)) {
        return {
          format: fileExtension,
          supported: false,
          reason: `Formato de archivo no soportado: ${fileExtension}`
        };
      }

      let fileInfo;
      if (['jpg', 'jpeg', 'png'].includes(fileExtension)) {
        fileInfo = await this.analyzeImage(buffer);
      } else if (fileExtension === 'pdf') {
        fileInfo = await this.analyzePDF(buffer);
      } else {
        fileInfo = { format: fileExtension };
      }

      fileInfo.mimeType = fileTypeResult ? fileTypeResult.mime : '';
      fileInfo.supported = true;
      return fileInfo;
    } catch (error) {
      logger.error(`Error al analizar el archivo: ${error.message}`);
      throw new CustomError('FileAnalysisError', 'Error al analizar el archivo', error);
    }
  }

  async analyzeImage(buffer) {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    return {
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      dpi: metadata.density || 72,
      colorSpace: metadata.space
    };
  }

  async analyzePDF(buffer) {
    try {
      const data = await pdfParse(buffer);

      return {
        format: 'pdf',
        pages: data.numpages,
        width: data.metadata?.width || 0,
        height: data.metadata?.height || 0,
        dpi: 72 // Asumimos 72 DPI para PDFs
      };
    } catch (error) {
      logger.error(`Error al analizar PDF: ${error.message}`);
      throw new CustomError('PDFAnalysisError', 'Error al analizar el archivo PDF', error);
    }
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
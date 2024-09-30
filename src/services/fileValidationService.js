import fs from 'fs';
import { promisify } from 'util';
import path from 'path';
import logger from '../utils/logger.js';
import { CustomError } from '../utils/errorHandler.js';
import sharp from 'sharp';
import fileType from 'file-type';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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
}

export default new FileValidationService();
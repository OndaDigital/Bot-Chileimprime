// fileAnalyzer.js - Bot imprenta

import { promises as fs } from 'fs';
import sizeOf from 'image-size';
import { PDFDocument } from 'pdf-lib';
import Logger from './logger.js';

const logger = new Logger();

class FileAnalyzer {
  constructor() {
    this.supportedImageFormats = ['jpg', 'jpeg', 'png', 'gif', 'tiff'];
    this.supportedVectorFormats = ['pdf', 'ai', 'eps', 'svg'];
  }

  async analyzeFile(filePath, requiredWidth, requiredHeight, requiredDPI) {
    try {
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;
      const fileExtension = filePath.split('.').pop().toLowerCase();

      let fileInfo = {
        size: fileSize,
        format: fileExtension,
        width: null,
        height: null,
        dpi: null,
        isVector: this.supportedVectorFormats.includes(fileExtension),
        isCompatible: false,
        errorMessage: null
      };

      if (this.supportedImageFormats.includes(fileExtension)) {
        const dimensions = sizeOf(filePath);
        fileInfo.width = dimensions.width;
        fileInfo.height = dimensions.height;
        fileInfo.dpi = this.estimateDPI(fileInfo.width, fileInfo.height, fileSize);
      } else if (fileExtension === 'pdf') {
        const pdfInfo = await this.analyzePDF(filePath);
        Object.assign(fileInfo, pdfInfo);
      } else if (this.supportedVectorFormats.includes(fileExtension)) {
        fileInfo.dpi = 'N/A (Vector)';
      } else {
        throw new Error('Formato de archivo no soportado');
      }

      fileInfo.isCompatible = this.checkCompatibility(fileInfo, { requiredWidth, requiredHeight, requiredDPI });

      logger.info(`Análisis de archivo completado: ${filePath}`);
      logger.debug(`Resultados: ${JSON.stringify(fileInfo)}`);

      return fileInfo;
    } catch (error) {
      logger.error(`Error al analizar el archivo: ${error.message}`);
      throw error;
    }
  }

  async analyzePDF(filePath) {
    const pdfDoc = await PDFDocument.load(await fs.readFile(filePath));
    const page = pdfDoc.getPages()[0];
    return {
      width: page.getWidth(),
      height: page.getHeight(),
      dpi: 72 // PDF default DPI
    };
  }

  estimateDPI(width, height, fileSize) {
    const pixelCount = width * height;
    const bitsPerPixel = (fileSize * 8) / pixelCount;
    return Math.round(Math.sqrt(bitsPerPixel) * 10);
  }

  checkCompatibility(fileInfo, requirements) {
    if (fileInfo.isVector) {
      return true; // Los archivos vectoriales son siempre compatibles
    }

    const minDPI = requirements.requiredDPI || 150;
    const maxFileSize = 25 * 1024 * 1024; // 25 MB por defecto

    if (fileInfo.size > maxFileSize) {
      fileInfo.errorMessage = `El archivo excede el tamaño máximo permitido de ${maxFileSize / (1024 * 1024)} MB`;
      return false;
    }

    if (fileInfo.dpi < minDPI) {
      fileInfo.errorMessage = `La resolución del archivo (${fileInfo.dpi} DPI) es menor que la mínima requerida (${minDPI} DPI)`;
      return false;
    }

    if (requirements.requiredWidth && requirements.requiredHeight) {
      const aspectRatio = requirements.requiredWidth / requirements.requiredHeight;
      const fileAspectRatio = fileInfo.width / fileInfo.height;

      if (Math.abs(aspectRatio - fileAspectRatio) > 0.01) { // Permitimos una pequeña variación
        fileInfo.errorMessage = `Las proporciones del archivo (${fileAspectRatio.toFixed(2)}) no coinciden con las requeridas (${aspectRatio.toFixed(2)})`;
        return false;
      }

      if (fileInfo.width < requirements.requiredWidth || fileInfo.height < requirements.requiredHeight) {
        fileInfo.errorMessage = `Las dimensiones del archivo (${fileInfo.width}x${fileInfo.height}) son menores que las requeridas (${requirements.requiredWidth}x${requirements.requiredHeight})`;
        return false;
      }
    }

    return true;
  }
}

export default FileAnalyzer;
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

      const fileStats = fs.statSync(filePath);
      const fileSize = this.formatFileSize(fileStats.size);

      const buffer = await readFile(filePath);
      const fileTypeResult = await fileType.fromBuffer(buffer);
      const fileExtension = fileTypeResult ? fileTypeResult.ext : path.extname(filePath).toLowerCase().slice(1);

      if (!this.supportedFormats.includes(fileExtension)) {
        return {
          format: fileExtension,
          supported: false,
          reason: `Formato de archivo no soportado: ${fileExtension}`,
          fileSize: fileSize
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
      fileInfo.fileSize = fileSize;
      return fileInfo;
    } catch (error) {
      logger.error(`Error al analizar el archivo: ${error.message}`);
      throw new CustomError('FileAnalysisError', 'Error al analizar el archivo', error);
    }
  }

  async analyzeImage(buffer) {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    const { physicalWidth, physicalHeight } = this.calculatePhysicalDimensions(metadata.width, metadata.height, metadata.density || 72);
    const area = this.calculateDesignArea(physicalWidth, physicalHeight);

    const colorSpace = metadata.space || 'desconocido';
    const colorSpaceInfo = colorSpace.toLowerCase() !== 'cmyk' 
      ? `${colorSpace} (Se recomienda encarecidamente usar CMYK para evitar diferencias de color entre lo que se ve en el monitor y lo que realmente se imprime)`
      : colorSpace;

    return {
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      dpi: metadata.density || 72,
      colorSpace: colorSpaceInfo,
      physicalWidth,
      physicalHeight,
      area
    };
  }

  async analyzePDF(buffer) {
    try {
      const data = await pdfParse(buffer);
      const width = data.metadata?.width || 0;
      const height = data.metadata?.height || 0;
      const dpi = 72; // Asumimos 72 DPI para PDFs

      const { physicalWidth, physicalHeight } = this.calculatePhysicalDimensions(width, height, dpi);
      const area = this.calculateDesignArea(physicalWidth, physicalHeight);

      return {
        format: 'pdf',
        pages: data.numpages,
        width,
        height,
        dpi,
        physicalWidth,
        physicalHeight,
        area
      };
    } catch (error) {
      logger.error(`Error al analizar PDF: ${error.message}`);
      throw new CustomError('PDFAnalysisError', 'Error al analizar el archivo PDF', error);
    }
  }

  calculatePhysicalDimensions(widthPixels, heightPixels, dpi) {
    const widthInches = widthPixels / dpi;
    const heightInches = heightPixels / dpi;
    const physicalWidth = widthInches * 2.54; // Convertir a centímetros
    const physicalHeight = heightInches * 2.54; // Convertir a centímetros
    return { 
      physicalWidth: Number(physicalWidth.toFixed(2)),
      physicalHeight: Number(physicalHeight.toFixed(2))
    };
  }

  calculateDesignArea(widthCm, heightCm) {
    const areaM2 = (widthCm / 100) * (heightCm / 100);
    return Number(areaM2.toFixed(4));
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

export default new FileValidationService();
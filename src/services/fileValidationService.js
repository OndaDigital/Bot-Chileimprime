// services/fileValidationService.js

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

    logger.info(`Metadatos de la imagen: ${JSON.stringify(metadata)}`);

    const { physicalWidth, physicalHeight } = this.calculatePhysicalDimensions(metadata.width, metadata.height, metadata.density || 72);
    const area = this.calculateDesignArea(physicalWidth, physicalHeight);

    const colorSpace = metadata.space || 'desconocido';
    const colorSpaceInfo = colorSpace.toLowerCase() !== 'cmyk' 
      ? `${colorSpace} (Se recomienda encarecidamente usar CMYK para evitar diferencias de color entre lo que se ve en el monitor y lo que realmente se imprime)`
      : colorSpace;

    logger.info(`Análisis de imagen completado: ${physicalWidth}x${physicalHeight} m, ${area} m², ${colorSpaceInfo}`);

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

      // Asumir dimensiones estándar si no se pueden obtener
      const width = 595; // A4 width in points
      const height = 842; // A4 height in points
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
    logger.info(`Calculando dimensiones físicas: ${widthPixels}x${heightPixels} píxeles, ${dpi} DPI`);
    
    // Convertir píxeles a pulgadas
    const widthInches = widthPixels / dpi;
    const heightInches = heightPixels / dpi;
    
    // Convertir pulgadas a metros (1 pulgada = 0.0254 metros)
    const widthMeters = widthInches * 0.0254;
    const heightMeters = heightInches * 0.0254;
    
    // Redondear a dos decimales
    const physicalWidth = Number(widthMeters.toFixed(2));
    const physicalHeight = Number(heightMeters.toFixed(2));
    
    logger.info(`Dimensiones físicas calculadas: ${physicalWidth}x${physicalHeight} metros`);
    
    return { physicalWidth, physicalHeight };
  }

  calculateDesignArea(widthM, heightM) {
    const areaM2 = widthM * heightM;
    const roundedArea = Number(areaM2.toFixed(2));
    logger.info(`Área calculada: ${roundedArea} m²`);
    return roundedArea;
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

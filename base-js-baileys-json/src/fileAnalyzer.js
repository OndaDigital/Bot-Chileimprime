// fileAnalyzer.js - Bot imprenta

import fs from 'fs/promises';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import Logger from './logger.js';

const logger = new Logger();

class FileAnalyzer {
  async analyzeFile(filePath, productInfo) {
    try {
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;
      const fileExtension = filePath.split('.').pop().toLowerCase();

      if (this.isImage(fileExtension)) {
        return await this.analyzeImage(filePath, fileSize, productInfo);
      } else if (fileExtension === 'pdf') {
        return await this.analyzePDF(filePath, fileSize, productInfo);
      } else {
        return this.analyzeGenericFile(filePath, fileSize, fileExtension);
      }
    } catch (error) {
      logger.error(`Error al analizar el archivo: ${error.message}`);
      throw error;
    }
  }


  isImage(extension) {
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff'];
    return imageExtensions.includes(extension);
  }

  async analyzeImage(filePath, fileSize, productInfo) {
    try {
      const metadata = await sharp(filePath).metadata();
      const dpi = metadata.density || 'No disponible';
      const imageDimensions = { width: metadata.width, height: metadata.height };
      const requiredDPI = this.calculateRequiredDPI(productInfo.medidas);
      
      return {
        tipo: 'Imagen',
        formato: metadata.format,
        ancho: metadata.width,
        alto: metadata.height,
        dpi: dpi,
        tamaño: this.formatFileSize(fileSize),
        esAptaParaImpresion: this.isFileSuitableForPrinting(imageDimensions, dpi, productInfo),
        dpiRequerido: requiredDPI
      };
    } catch (error) {
      logger.error(`Error al analizar la imagen: ${error.message}`);
      throw error;
    }
  }

  async analyzePDF(filePath, fileSize, productInfo) {
    try {
      const pdfBytes = await fs.readFile(filePath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const page = pdfDoc.getPages()[0];
      const { width, height } = page.getSize();
      const pdfDimensions = { width, height };
      const requiredDPI = this.calculateRequiredDPI(productInfo.medidas);

      return {
        tipo: 'PDF',
        ancho: width,
        alto: height,
        tamaño: this.formatFileSize(fileSize),
        esAptaParaImpresion: this.isFileSuitableForPrinting(pdfDimensions, 300, productInfo), // Asumimos 300 DPI para PDFs
        dpiRequerido: requiredDPI
      };
    } catch (error) {
      logger.error(`Error al analizar el PDF: ${error.message}`);
      throw error;
    }
  }

  analyzeGenericFile(filePath, fileSize, fileExtension) {
    return {
      tipo: 'Archivo genérico',
      formato: fileExtension,
      tamaño: this.formatFileSize(fileSize),
      esAptaParaImpresion: false,
      mensaje: 'Este tipo de archivo no es compatible con nuestro sistema de impresión.'
    };
  }

  isFileSuitableForPrinting(fileDimensions, fileDPI, productInfo) {
    const requiredDPI = productInfo.dpi || this.calculateRequiredDPI(productInfo.medidas);
    const minDimension = Math.min(fileDimensions.width, fileDimensions.height);
    const maxDimension = Math.max(fileDimensions.width, fileDimensions.height);
    
    const productMinDimension = Math.min(productInfo.medidas.ancho, productInfo.medidas.alto) * 100; // Convertir a cm
    const productMaxDimension = Math.max(productInfo.medidas.ancho, productInfo.medidas.alto) * 100; // Convertir a cm
    
    const isResolutionSufficient = (minDimension >= productMinDimension * requiredDPI / 2.54) &&
                                   (maxDimension >= productMaxDimension * requiredDPI / 2.54);
    
    return fileDPI >= requiredDPI && isResolutionSufficient;
  }

  calculateRequiredDPI(productDimensions) {
    const maxDimension = Math.max(productDimensions.ancho, productDimensions.alto);
    if (maxDimension <= 1) return 300; // Para productos pequeños (hasta 1m)
    if (maxDimension <= 3) return 150; // Para productos medianos (hasta 3m)
    return Math.max(72, Math.round(300 / maxDimension)); // Para productos grandes, mínimo 72 DPI
  }

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' bytes';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(2) + ' KB';
    else if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + ' MB';
    else return (bytes / 1073741824).toFixed(2) + ' GB';
  }
}

export default FileAnalyzer;
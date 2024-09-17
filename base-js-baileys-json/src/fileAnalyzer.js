// fileAnalyzer.js - Bot imprenta

// fileAnalyzer.js
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import fs from 'fs/promises';
import Logger from './logger.js';

class FileAnalyzer {
  constructor() {
    this.logger = new Logger();
  }

  async analyzeFile(filePath, requiredSpecs) {
    try {
      const fileExtension = filePath.split('.').pop().toLowerCase();
      let analysis;

      if (['jpg', 'jpeg', 'png', 'gif'].includes(fileExtension)) {
        analysis = await this.analyzeImage(filePath);
      } else if (fileExtension === 'pdf') {
        analysis = await this.analyzePDF(filePath);
      } else {
        throw new Error('Formato de archivo no soportado');
      }

      return {
        ...analysis,
        isValid: this.validateAnalysis(analysis, requiredSpecs)
      };
    } catch (error) {
      this.logger.error(`Error al analizar el archivo: ${error.message}`);
      throw error;
    }
  }

  async analyzeImage(filePath) {
    const metadata = await sharp(filePath).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      dpi: metadata.density || 72
    };
  }

  async analyzePDF(filePath) {
    const pdfBytes = await fs.readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const page = pdfDoc.getPages()[0];
    const { width, height } = page.getSize();
    return {
      width: width,
      height: height,
      format: 'pdf',
      dpi: 72 // PDF no tiene DPI intrínseco, asumimos 72 como estándar
    };
  }

  validateAnalysis(analysis, requiredSpecs) {
    return (
      analysis.width >= requiredSpecs.minWidth &&
      analysis.height >= requiredSpecs.minHeight &&
      analysis.dpi >= requiredSpecs.minDPI &&
      requiredSpecs.formatos.includes(analysis.format)
    );
  }
}

export default FileAnalyzer;
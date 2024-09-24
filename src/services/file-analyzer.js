import fs from 'fs/promises';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import fileType from 'file-type';
const { fileTypeFromBuffer } = fileType;
import { logger } from '../utils/logger.js';

class FileAnalyzer {
  async analyzeFile(fileBuffer, fileName) {
    try {
      const fileType = await fileTypeFromBuffer(fileBuffer);
      
      if (!fileType) {
        return "No se pudo determinar el tipo de archivo.";
      }

      switch (fileType.mime) {
        case 'application/pdf':
          return await this.analyzePdf(fileBuffer);
        case 'text/plain':
          return await this.analyzeTextFile(fileBuffer);
        case 'image/jpeg':
        case 'image/png':
          return await this.analyzeImage(fileBuffer, fileType.mime);
        default:
          return `Archivo recibido: ${fileName}. Tipo: ${fileType.mime}. No se puede analizar este tipo de archivo.`;
      }
    } catch (error) {
      logger.error('Error analyzing file', error);
      return "Ocurrió un error al analizar el archivo.";
    }
  }

  async analyzePdf(buffer) {
    try {
      const data = await pdfParse(buffer);
      return `PDF analizado. Número de páginas: ${data.numpages}. Texto extraído: ${data.text.substring(0, 200)}...`;
    } catch (error) {
      logger.error('Error analyzing PDF', error);
      return "Ocurrió un error al analizar el archivo PDF.";
    }
  }

  async analyzeTextFile(buffer) {
    const text = buffer.toString('utf-8');
    return `Archivo de texto analizado. Primeros 200 caracteres: ${text.substring(0, 200)}...`;
  }

  async analyzeImage(buffer, mimeType) {
    return `Imagen ${mimeType} recibida. Tamaño: ${buffer.length} bytes.`;
  }
}

export const fileAnalyzer = new FileAnalyzer();
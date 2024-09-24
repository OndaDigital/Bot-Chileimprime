// commands/analyze-file-command.js

import { fileAnalyzer } from '../services/file-analyzer.js';
import { logger } from '../utils/logger.js';
import { validators } from '../utils/validators.js';
import { ValidationError } from '../utils/error-types.js';

class AnalyzeFileCommand {
  async execute(ctx) {
    try {
      await ctx.reply('Por favor, envía el archivo que deseas analizar.');
      ctx.userContext.setState('UPLOADING_FILE');
      
      // La lógica de análisis del archivo se manejará en el estado UPLOADING_FILE de la FSM
    } catch (error) {
      logger.error('Error initiating file analysis command', error);
      await ctx.reply('Lo siento, ha ocurrido un error al iniciar el análisis del archivo.');
    }
  }

  async handleFileUpload(ctx) {
    if (!ctx.attachment) {
      await ctx.reply('No se ha recibido ningún archivo. Por favor, envía un archivo para analizar.');
      return;
    }

    try {
      validators.validateFile(ctx.attachment, {
        allowedFileTypes: ['application/pdf', 'image/jpeg', 'image/png'],
        maxFileSize: 10 * 1024 * 1024 // 10 MB
      });

      const analysis = await fileAnalyzer.analyzeFile(Buffer.from(ctx.attachment.data, 'base64'), ctx.attachment.filename);
      await ctx.reply(analysis);

      // Volver al menú principal después del análisis
      ctx.userContext.setState('MAIN_MENU');
      await ctx.reply('¿En qué más puedo ayudarte?');
    } catch (error) {
      if (error instanceof ValidationError) {
        await ctx.reply(error.message);
      } else {
        logger.error('Error analyzing file', error);
        await ctx.reply('Lo siento, ha ocurrido un error al analizar el archivo.');
      }
      // Mantener el estado en UPLOADING_FILE para permitir otro intento
    }
  }
}

export const analyzeFileCommand = new AnalyzeFileCommand();
// middleware/message-processor.js
import { openaiService } from '../services/openai-service.js';
import { logger } from '../utils/logger.js';
import { pluginManager } from '../core/plugin-manager.js';

export async function messageProcessor(ctx, { flowDynamic, state }) {
  try {
    // Ejecutar plugins onMessage
    await pluginManager.executePluginMethod('examplePlugin', 'onMessage', ctx);

    if (ctx.message.hasMedia) {
      const media = await ctx.message.downloadMedia();
      if (media.mimetype.startsWith('audio/')) {
        try {
          ctx.transcription = await openaiService.transcribeAudio(Buffer.from(media.data, 'base64'));
          logger.info(`Audio transcribed for user ${ctx.from}`);
        } catch (error) {
          logger.error(`Error transcribing audio for user ${ctx.from}`, error);
        }
      } else {
        ctx.attachment = {
          filename: media.filename,
          data: media.data,
          mimetype: media.mimetype,
        };
      }
    }
  } catch (error) {
    logger.error('Error in message processor', error);
    throw error;
  }
}
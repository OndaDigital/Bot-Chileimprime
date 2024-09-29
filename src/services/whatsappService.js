// services/whatsappService.js

import { createBot, createProvider, createFlow, addKeyword, MemoryDB } from '@builderbot/bot';
import { BaileysProvider } from '@builderbot/provider-baileys';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { CustomError } from '../utils/errorHandler.js';
import fs from 'fs/promises';
import path from 'path';

class WhatsAppService {
  constructor() {
    this.provider = null;
    this.bot = null;
  }

  async initialize(flows) {
    try {
      const adapterDB = new MemoryDB();
      const adapterFlow = createFlow(flows);
      const adapterProvider = createProvider(BaileysProvider, {
        groupsIgnore: true,
      });

      this.provider = adapterProvider;

      const { bot, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
      }, {
        queue: {
          timeout: 60000,
          concurrencyLimit: 100
        }
      });

      this.bot = bot;

      httpServer(config.port);
      logger.info(`Bot iniciado en el puerto ${config.port}`);
    } catch (error) {
      logger.error('Error al inicializar WhatsApp Service:', error);
      throw new CustomError('WhatsAppInitError', 'Error al inicializar el servicio de WhatsApp', error);
    }
  }

  async sendMessage(to, message, options = {}) {
    try {
      await this.bot.sendMessage(to, message, options);
      logger.info(`Mensaje enviado a ${to}`);
    } catch (error) {
      logger.error(`Error al enviar mensaje a ${to}:`, error);
      throw new CustomError('MessageSendError', 'Error al enviar mensaje de WhatsApp', error);
    }
  }

  async saveAudioFile(ctx) {
    try {
      const savedFile = await this.provider.saveFile(ctx);
      if (typeof savedFile === 'string') {
        return savedFile;
      } else if (savedFile && savedFile.path) {
        return savedFile.path;
      } else {
        throw new Error('No se pudo obtener la ruta del archivo de audio');
      }
    } catch (error) {
      logger.error('Error al guardar archivo de audio:', error);
      throw new CustomError('AudioSaveError', 'Error al guardar archivo de audio', error);
    }
  }

  async saveFile(ctx) {
    try {
      if (!this.provider) {
        throw new Error('El proveedor de WhatsApp no está inicializado');
      }
      const savedFile = await this.provider.saveFile(ctx);
      if (typeof savedFile === 'string') {
        return savedFile;
      } else if (savedFile && savedFile.path) {
        return savedFile.path;
      } else {
        throw new Error('No se pudo obtener la ruta del archivo');
      }
    } catch (error) {
      logger.error('Error al guardar archivo:', error);
      throw new CustomError('FileSaveError', 'Error al guardar archivo', error);
    }
  }

  async processVoiceNote(ctx, audioPath) {
    try {
      logger.info(`Procesando nota de voz para usuario ${ctx.from}`);
      const transcription = await openaiService.transcribeAudio(audioPath);
      await fs.unlink(audioPath);
      logger.info(`Nota de voz procesada y archivo eliminado: ${audioPath}`);
      return transcription;
    } catch (error) {
      logger.error(`Error procesando nota de voz: ${error.message}`);
      throw new CustomError('VoiceNoteProcessError', 'Error al procesar nota de voz', error);
    }
  }

  getPromoMessage() {
    return `🤖 *¡Gracias por probar nuestro Bot de Demostración!* 🚀
  
  Desarrollado con ❤️ por *SuperPyme*
  
  🍽️ *Ver Menú y Pedidos:*
  https://docs.google.com/spreadsheets/d/1ZFq1c0IWbR3prkuZdnbJ_Och-GhxI9iMh56yqYlmAjo/edit?usp=sharing
  
  🔒 _Nota: Los números están censurados para proteger la privacidad de nuestros usuarios de prueba._
  
  ✨ *¿Quieres un bot así para tu negocio?* ✨
  
  📱 Whatsapp: *+56 9 7147 1884*
  📧 Escríbenos: *oficina@superpyme.cl*
  🌐 Más información: *superpyme.cl*
  
  🚀 *¡Lleva tu negocio al siguiente nivel con SuperPyme!* 💼
  
  PD: Puedes volver a probar el bot en 10 minutos, si quieres probarlo de inmediato, escribe desde otro número.`;
  }
}

export default new WhatsAppService();
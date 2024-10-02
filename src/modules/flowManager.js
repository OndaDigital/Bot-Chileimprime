import { addKeyword, EVENTS } from '@builderbot/bot';
import logger from '../utils/logger.js';
import userContextManager from './userContext.js';
import orderManager from './orderManager.js';
import openaiService from '../services/openaiService.js';
import whatsappService from '../services/whatsappService.js';
import config from '../config/config.js';
import { CustomError } from '../utils/errorHandler.js';
import inactivityMiddleware from '../core/inactivity-middleware.js';
import blacklistMiddleware from '../core/blacklist-middleware.js';
import MessageQueue from './messageQueue.js';
import fileValidationService from '../services/fileValidationService.js';
import commandProcessor from '../commandProcessor.js';

class FlowManager {
  constructor() {
    this.flows = {
      principalFlow: null,
      confirmedFlow: null,
      restartBotFlow: null,
      documentFlow: null,
      voiceNoteFlow: null,
      catchAllFlow: null,
      idleTimeoutFlow: null,
      promoFlow: null
    };
    this.blacklist = new Map();
    this.idleTimers = new Map();
    this.messageQueue = new MessageQueue({ gapSeconds: config.messageQueueGapSeconds });
    this.cooldowns = new Map();
  }

  async initializeFlows() {
    try {
      // Inicializar los flujos
      this.flows.principalFlow = this.createPrincipalFlow();
      this.flows.confirmedFlow = this.createConfirmedFlow();
      this.flows.restartBotFlow = this.createRestartBotFlow();
      this.flows.documentFlow = this.createDocumentFlow();
      this.flows.voiceNoteFlow = this.createVoiceNoteFlow();
      this.flows.catchAllFlow = this.createCatchAllFlow();
      this.flows.idleTimeoutFlow = this.createIdleTimeoutFlow();
      this.flows.promoFlow = this.createPromoFlow();
      this.flows.mediaFlow = this.createMediaFlow();

      // Agregar middlewares
      Object.values(this.flows).forEach(flow => {
        if (flow && typeof flow.addAction === 'function') {
          flow.addAction(inactivityMiddleware(this));
          flow.addAction(blacklistMiddleware(this));
        } else {
          logger.warn(`Un flujo no tiene el método addAction o es nulo`);
        }
      });

      logger.info('Flujos inicializados correctamente');
      return Object.values(this.flows).filter(flow => flow !== null);
    } catch (error) {
      logger.error(`Error al inicializar flujos: ${error.message}`);
      throw new CustomError('FlowInitializationError', 'Error al inicializar los flujos', error);
    }
  }


  getFlowByName(name) {
    return this.flows[name];
  }

  // Dentro de la clase FlowManager
  createPrincipalFlow() {
    return addKeyword(EVENTS.WELCOME)
      .addAction(async (ctx, { flowDynamic, gotoFlow, endFlow }) => {
        const userId = ctx.from; // Mover la declaración aquí
        const userContext = userContextManager.getUserContext(userId);

        // Verificar si los mensajes iniciales ya fueron enviados
        if (!userContext.initialMessagesSent) {
          // Enviar imagen con la lista de servicios
          await flowDynamic([{ 
            body: `Promo campañas politicas`,
            media: `https://chileimprime.cl/wp-content/uploads/2024/10/Camapanas-politicas-chileimprime-el-m2-mas-economico.jpg` 
          }]);
          logger.info(`Imagen de lista de servicios enviada a ${userId}`);

          // Esperar 5 segundos
          await new Promise(resolve => setTimeout(resolve, 5000));

          // Enviar la lista de servicios en texto utilizando handleListAllServices
          const servicesList = await commandProcessor.handleListAllServices(userId);
          if (servicesList && servicesList.data) {
            await flowDynamic(servicesList.data);
            logger.info(`Lista de servicios en texto enviada a ${userId}`);
          }

          // Esperar 5 segundos
          await new Promise(resolve => setTimeout(resolve, 5000));

          // Actualizar el estado de mensajes iniciales enviados
          userContextManager.updateUserState(userId, { initialMessagesSent: true });
          logger.info(`Estado initialMessagesSent actualizado a true para usuario ${userId}`);
        }

        // Continuar con el manejo normal del mensaje
        this.enqueueMessage(userId, ctx.body, async (accumulatedMessage) => {
          await this.handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, accumulatedMessage);
        });
      });
  }

  createConfirmedFlow() {
    return addKeyword(EVENTS.ACTION)
      .addAction(this.blacklistMiddleware.bind(this))
      .addAction(async (ctx, { flowDynamic, endFlow }) => {
        await flowDynamic("SOLICITUD_HUMANO");
        this.addToBlacklist(ctx.from, config.humanBlacklistDuration);
        logger.info(`Cotización ya confirmada para ${ctx.from}. Redirigiendo a atención humana.`);
        return endFlow("Un representante se pondrá en contacto contigo pronto para finalizar tu cotización. Gracias por tu paciencia.");
      });
  }
  
    createRestartBotFlow() {
      return addKeyword(['bot', 'Bot', 'BOT'])
        .addAction(async (ctx, { flowDynamic, gotoFlow }) => {
          const userId = ctx.from;
          logger.info(`Intento de reinicio de bot por usuario ${userId}`);
          this.resetConversation(userId, true); // Reiniciar initialMessagesSent
          logger.info(`Bot reiniciado para usuario ${userId}`);
          await flowDynamic('*¡Bienvenido de nuevo!* 🎉 El bot ha sido reiniciado. *¿En qué puedo ayudarte hoy?* 😊');
          return gotoFlow(this.flows.principalFlow);
        });
    }
  
    createDocumentFlow() {
      return addKeyword(EVENTS.DOCUMENT)
        .addAction(async (ctx, { flowDynamic, gotoFlow, endFlow }) => {
          try {
            const userId = ctx.from;
            const filePath = await whatsappService.saveFile(ctx);
            const fileInfo = await fileValidationService.analyzeFile(filePath);
            
            await userContextManager.updateCurrentOrder(userId, {
              filePath: filePath,
              fileAnalysis: fileInfo
            });
            
            logger.info(`Archivo analizado para usuario ${userId}: ${JSON.stringify(fileInfo)}`);
            
            // Llamar a handleFileAnalysis de commandProcessor para mostrar los resultados del análisis
            await commandProcessor.handleFileAnalysis(ctx, flowDynamic);
            
          } catch (error) {
            logger.error(`Error al procesar el archivo: ${error.message}`);
            await flowDynamic('Hubo un error al procesar tu archivo. Por favor, intenta enviarlo nuevamente.');
          }
        });
    }

    createMediaFlow() {
      return addKeyword(EVENTS.MEDIA)
        .addAction(async (ctx, { flowDynamic }) => {
          const userId = ctx.from;
          logger.info(`Imagen recibida de ${userId}`);
  
          const messages = [
            '🖼️ *¡Hola!* Hemos recibido tu imagen, pero necesitamos que nos envíes tu diseño como *documento* para preservar la calidad.\n\nLas imágenes enviadas como foto en WhatsApp se comprimen y pierden calidad, lo que afecta el análisis y la impresión.\n\nPor favor, envía el mismo archivo como *documento* en uno de los siguientes formatos de alta calidad: *PDF, AI, PSD* o una imagen en alta resolución.\n\n*Criterios de Validación Resumidos:*\n\n- Resolución mínima: 72 dpi y máxima: 150 dpi.\n- Formato preferente: CMYK para evitar diferencias de color.\n- Tamaño real del diseño acorde al tamaño de impresión.',
            
            '📱 *Cómo enviar un documento en WhatsApp desde Android o iPhone:*\n\n1️⃣ Abre el chat de *Chileimprime*.\n2️⃣ Toca el ícono de *adjuntar* (📎).\n3️⃣ Selecciona *Documento*.\n4️⃣ Busca y selecciona tu archivo de diseño.\n5️⃣ Presiona *Enviar*.',
            
            '✨ *Esperamos tu archivo nuevamente como documento para iniciar el análisis.* ¡Gracias!'
          ];
  
          try {
            for (const message of messages) {
              await flowDynamic(message);
              // Espera de 3 segundos antes de enviar el siguiente mensaje
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
          } catch (error) {
            logger.error(`Error al enviar mensajes secuenciales en mediaFlow para usuario ${userId}: ${error.message}`);
            await flowDynamic('⚠️ *Ha ocurrido un error al enviar las instrucciones. Por favor, intenta nuevamente más tarde.*');
          }
        });
    }
  

    createVoiceNoteFlow() {
      return addKeyword(EVENTS.VOICE_NOTE)
        .addAction(async (ctx, { flowDynamic, state, gotoFlow, endFlow }) => {
          try {
            const audioPath = await whatsappService.saveAudioFile(ctx);
            const transcription = await openaiService.transcribeAudio(audioPath);
            logger.info(`Transcripción del audio: ${transcription}`);
            
            await state.update({ lastTranscription: transcription });
            await flowDynamic(`*📝 Transcripción:*\n${transcription}`);
    
            this.enqueueMessage(ctx.from, transcription, async (accumulatedMessage) => {
              await this.handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, accumulatedMessage);
            });
          } catch (error) {
            logger.error(`Error al procesar la nota de voz: ${error.message}`);
            await flowDynamic('Hubo un error al procesar la nota de voz. Por favor, intenta enviar un mensaje de texto.');
          }
        });
    }
  
  
    createCatchAllFlow() {
      return addKeyword(EVENTS.ACTION)
        .addAction(this.blacklistMiddleware.bind(this))
        .addAction(async (ctx, { gotoFlow }) => {
          if (orderManager.isOrderConfirmed(ctx.from)) {
            return gotoFlow(this.flows.confirmedFlow);
          } else {
            return gotoFlow(this.flows.principalFlow);
          }
        });
    }
  
    createIdleTimeoutFlow() {
      return addKeyword(EVENTS.ACTION)
        .addAction(async (ctx, { endFlow }) => {
          logger.info(`Tiempo de espera agotado para usuario ${ctx.from}`);
          this.resetConversation(ctx.from);
          return endFlow('*😴 Lo siento, el tiempo de espera ha expirado. Tu cotización ha sido cancelada. Si deseas hacer una nueva cotización, por favor envía un mensaje.*');
        });
    }
  
    createPromoFlow() {
      return addKeyword(EVENTS.ACTION)
        .addAction(async (ctx, { flowDynamic, endFlow }) => {
          const promoMessage = whatsappService.getPromoMessage();
          try {
            await flowDynamic(promoMessage);
            logger.info(`Mensaje promocional enviado a ${ctx.from}`);
          } catch (error) {
            logger.error(`Error al enviar mensaje promocional a ${ctx.from}: ${error.message}`);
          }
          return endFlow();
        });
    }
  
    enqueueMessage(userId, message, callback) {
      this.messageQueue.enqueueMessage(userId, message, callback);
    }
  
    async handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, message, instruction = '') {
      const userId = ctx.from;
      logger.info(`Procesando mensaje para usuario ${userId}: ${message}`);
  
      if (this.isBlacklisted(userId)) {
        logger.info(`Usuario ${userId} en lista negra. Mensaje ignorado.`);
        return endFlow();
      }
  
      if (orderManager.isOrderConfirmed(userId)) {
        logger.info(`Cotización ya confirmada para ${userId}. Redirigiendo a atención humana.`);
        return gotoFlow(this.getFlowByName('confirmedFlow'));
      }
  
      this.startIdleTimer(ctx, flowDynamic, gotoFlow);
  
      try {
        const userContext = userContextManager.getUserContext(userId);
        const chatContext = userContextManager.getChatContext(userId);
        
        let aiResponse = await openaiService.getChatCompletion(
          openaiService.getSystemPrompt(userContext.services, userContext.currentOrder, userContext.additionalInfo, chatContext),
          [...chatContext, { role: "user", content: message }],
          instruction
        );
    
        logger.info(`Respuesta inicial de AI para ${userId}: ${aiResponse}`);
    
        // Procesar comandos en la respuesta de la IA
        const commands = this.processAIResponse(aiResponse);
        let currentOrderUpdated = false;
    
        for (const command of commands) {
          const result = await commandProcessor.processCommand(command, userId, ctx, { flowDynamic, gotoFlow, endFlow });
          if (result.currentOrderUpdated) {
            currentOrderUpdated = true;
          }
          if (result.messagesSent) {
            logger.info(`Mensajes enviados por comando ${command.command} para ${userId}`);
          }
          if (result.data) {
            await flowDynamic(result.data);
          }
        }
    
        // Enviar la parte de texto de la respuesta de la IA al usuario
        const filteredResponse = this.filterJsonCommands(aiResponse);
        if (filteredResponse) {
          await flowDynamic(filteredResponse);
        }
    
        userContextManager.updateContext(userId, message, "user");
        userContextManager.updateContext(userId, aiResponse, "assistant");
    
        if (userContextManager.isOrderComplete(userId)) {
          logger.info(`Orden completa para ${userId}. Confirmando pedido.`);
          // Enviar comando de confirmación
          await commandProcessor.processCommand({ command: "CONFIRM_ORDER" }, userId, ctx, { flowDynamic, gotoFlow, endFlow });
          return gotoFlow(this.getFlowByName('confirmedFlow'));
        }
    
      } catch (error) {
        logger.error(`Error al procesar respuesta para usuario ${userId}: ${error.message}`);
        logger.error(`Stack trace: ${error.stack}`);
        await flowDynamic("Lo siento, ha ocurrido un error inesperado. Por favor, intenta nuevamente en unos momentos.");
      }
    }

    isOrderReadyForFileUpload(currentOrder) {
      return currentOrder.service &&
             currentOrder.measures &&
             currentOrder.quantity &&
             currentOrder.finishes &&
             !currentOrder.filePath &&
             !currentOrder.fileAnalysis;
    }

 
  
    processAIResponse(aiResponse) {
      const commandRegex = /{[^}]+}/g;
      const commands = aiResponse.match(commandRegex) || [];
      return commands.map(cmd => {
        try {
          return JSON.parse(cmd);
        } catch (error) {
          logger.error(`Error al parsear comando JSON: ${error.message}`);
          return null;
        }
      }).filter(cmd => cmd !== null);
    }

    filterJsonCommands(aiResponse) {
      // Eliminar todos los comandos JSON de la respuesta
      return aiResponse.replace(/\{.*?\}/g, '').trim();
    }
  
    setIdleTimers(userId, timers) {
      this.idleTimers.set(userId, timers);
    }
  
    addToBlacklist(userId, duration) {
      this.blacklist.set(userId, Date.now() + duration);
      logger.info(`Usuario ${userId} añadido a la lista negra por ${duration/1000} segundos`);
    }
  
    isBlacklisted(userId) {
      if (this.blacklist.has(userId)) {
        const blacklistExpiry = this.blacklist.get(userId);
        if (Date.now() < blacklistExpiry) {
          logger.info(`Usuario ${userId} está en la lista negra. Tiempo restante: ${(blacklistExpiry - Date.now()) / 1000} segundos`);
          return true;
        } else {
          this.blacklist.delete(userId);
          this.resetConversation(userId);
          logger.info(`Usuario ${userId} removido de la lista negra`);
        }
      }
      return false;
    }
  
    resetConversation(userId, resetInitialMessages = false) {
      userContextManager.resetContext(userId, resetInitialMessages);
      orderManager.resetOrderConfirmation(userId);
      this.blacklist.delete(userId);
      this.clearIdleTimer(userId);
      logger.info(`Conversación reiniciada para usuario ${userId}, resetInitialMessages: ${resetInitialMessages}`);
    }
  
    startIdleTimer(ctx, flowDynamic, gotoFlow) {
      this.clearIdleTimer(ctx.from);
      
      const warningTimer = setTimeout(async () => {
        await flowDynamic('*⏰ ¿Sigues ahí? Si necesitas más tiempo, por favor responde cualquier mensaje.*');
      }, config.idleWarningTime);
  
      const timeoutTimer = setTimeout(() => {
        this.resetConversation(ctx.from);
        gotoFlow(this.getFlowByName('idleTimeoutFlow'));
      }, config.idleTimeoutTime);
  
      this.setIdleTimers(ctx.from, { warningTimer, timeoutTimer });
    }
  
    clearIdleTimer(userId) {
      const timers = this.idleTimers.get(userId);
      if (timers) {
        clearTimeout(timers.warningTimer);
        clearTimeout(timers.timeoutTimer);
        this.idleTimers.delete(userId);
      }
    }
  
    blacklistMiddleware(ctx, { endFlow }) {
      if (this.isBlacklisted(ctx.from)) {
        logger.info(`Usuario ${ctx.from} en lista negra. Mensaje ignorado.`);
        return endFlow();
      }
      return false;
    }
  }
  
  export default new FlowManager();
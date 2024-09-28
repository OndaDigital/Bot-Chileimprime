// modules/flowManager.js

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

class FlowManager {
  constructor() {
    this.flows = {
      principalFlow: null,
      confirmedFlow: null,
      restartBotFlow: null,
      voiceNoteFlow: null,
      catchAllFlow: null,
      idleTimeoutFlow: null,
      promoFlow: null
    };
    this.blacklist = new Map();
    this.idleTimers = new Map();
    this.messageQueue = new MessageQueue({ gapSeconds: config.messageQueueGapSeconds });
  }

  async initializeFlows() {
    this.flows.principalFlow = this.createPrincipalFlow();
    this.flows.confirmedFlow = this.createConfirmedFlow();
    this.flows.restartBotFlow = this.createRestartBotFlow();
    this.flows.voiceNoteFlow = this.createVoiceNoteFlow();
    this.flows.catchAllFlow = this.createCatchAllFlow();
    this.flows.idleTimeoutFlow = this.createIdleTimeoutFlow();
    this.flows.promoFlow = this.createPromoFlow();

    // Aplicar middleware a todos los flujos
    Object.values(this.flows).forEach(flow => {
      flow.addAction(inactivityMiddleware(this));
      flow.addAction(blacklistMiddleware(this));
    });

    logger.info('Flujos inicializados correctamente');
    return Object.values(this.flows);
  }

  getFlowByName(name) {
    return this.flows[name];
  }

  modifyPrincipalFlow(newAction) {
    if (this.flows.principalFlow) {
      this.flows.principalFlow.addAction(newAction);
      logger.info('Flujo principal modificado exitosamente');
    } else {
      logger.error('No se pudo encontrar el flujo principal para modificar');
    }
  }

  modifyVoiceNoteFlow(newAction) {
    if (this.flows.voiceNoteFlow) {
      this.flows.voiceNoteFlow.addAction(newAction);
      logger.info('Flujo de notas de voz modificado exitosamente');
    } else {
      logger.error('No se pudo encontrar el flujo de notas de voz para modificar');
    }
  }

  createPrincipalFlow() {
    return addKeyword(EVENTS.WELCOME)
      .addAction(async (ctx, { flowDynamic, gotoFlow, endFlow }) => {
        const userId = ctx.from;
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
        logger.info(`Pedido ya confirmado para ${ctx.from}. Redirigiendo a atención humana.`);
        return endFlow("Un representante humano se pondrá en contacto contigo pronto. Gracias por tu paciencia.");
      });
  }

  createRestartBotFlow() {
    return addKeyword(['bot', 'Bot', 'BOT'])
      .addAction(async (ctx, { flowDynamic, gotoFlow }) => {
        const userId = ctx.from;
        logger.info(`Intento de reinicio de bot por usuario ${userId}`);
        this.resetConversation(userId);
        logger.info(`Bot reiniciado para usuario ${userId}`);
        await flowDynamic('*¡Bienvenido de nuevo!* 🎉 El bot ha sido reiniciado. *¿En qué puedo ayudarte hoy?* 😊');
        return gotoFlow(this.flows.principalFlow);
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
            await this.handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, accumulatedMessage, true);
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
        return endFlow('*😴 Lo siento, el tiempo de espera ha expirado. Tu pedido ha sido cancelado. Si deseas hacer un nuevo pedido, por favor envía un mensaje.*');
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

  async handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, message, isVoiceNote = false) {
    const userId = ctx.from;
    logger.info(`Procesando mensaje para usuario ${userId}. Tipo: ${isVoiceNote ? 'Audio' : 'Texto'}`);

    if (this.isBlacklisted(userId)) {
      logger.info(`Usuario ${userId} en lista negra. Mensaje ignorado.`);
      return endFlow();
    }

    if (orderManager.isOrderConfirmed(userId)) {
      logger.info(`Pedido ya confirmado para ${userId}. Redirigiendo a atención humana.`);
      return gotoFlow(this.getFlowByName('confirmedFlow'));
    }

    this.startIdleTimer(ctx, flowDynamic, gotoFlow);

    try {
      const userContext = userContextManager.getUserContext(userId);
      const aiResponse = await openaiService.getChatCompletion(
        openaiService.getSystemPrompt(userContext.menu, userContext.additionalInfo, userContext.currentOrder),
        userContext.context + (isVoiceNote ? "Transcripción de audio: " : "Usuario: ") + message
      );
      logger.info(`Respuesta AI para ${userId}: ${aiResponse}`);

      userContextManager.updateContext(userId, message, isVoiceNote ? "Transcripción de audio" : "Usuario");
      userContextManager.updateContext(userId, aiResponse, "Vendedor");

      if (aiResponse.includes("CONFIRMAR_PEDIDO")) {
        logger.info(`Iniciando confirmación de pedido para usuario ${userId}`);
        try {
          const { confirmationMessage, orderSummary, endConversation } = await orderManager.finalizeOrder(userId, ctx.pushName, userContext.currentOrder);
          await flowDynamic(orderSummary);
          await flowDynamic(confirmationMessage);
          logger.info(`Pedido confirmado para ${userId}. Finalizando flujo.`);
          
          this.addToBlacklist(userId, config.blacklistDuration);
          this.clearIdleTimer(userId);
          
          setTimeout(() => {
            gotoFlow(this.getFlowByName('promoFlow'));
          }, config.promoMessageDelay);
          
          if (endConversation) {
            return endFlow();
          }
        } catch (error) {
          logger.error(`Error al finalizar el pedido para ${userId}: ${error.message}`);
          await flowDynamic("Lo siento, ha ocurrido un error al procesar tu pedido. Por favor, intenta nuevamente o contacta con nuestro equipo de soporte.");
        }
      } else {
        const { action, order } = await orderManager.updateOrder(userId, aiResponse, userContext.menu, userContext.currentOrder);

        switch (action) {
          case "SOLICITUD_HUMANO":
            this.addToBlacklist(userId, config.humanBlacklistDuration);
            this.resetConversation(userId);
            await flowDynamic("*Entendido* 👍. Un representante humano se pondrá en contacto contigo pronto. *Gracias por tu paciencia.* 🙏");
            logger.info(`Solicitud de humano para ${userId}. Añadido a la lista negra por ${config.humanBlacklistDuration/1000} segundos.`);
            return endFlow();
          case "ADVERTENCIA_MAL_USO_DETECTADO":
            this.addToBlacklist(userId, config.abuseBlacklistDuration);
            this.resetConversation(userId);
            await flowDynamic("*Lo siento* 😔, pero hemos detectado un uso inapropiado del sistema. Tu acceso ha sido *temporalmente suspendido*. Si crees que esto es un error, por favor contacta con nuestro equipo de soporte.");
            logger.info(`Mal uso detectado para ${userId}. Añadido a la lista negra por ${config.abuseBlacklistDuration/1000} segundos.`);
            return endFlow();
          default:
            userContext.currentOrder = order;
            await flowDynamic(aiResponse);
        }
      }
    } catch (error) {
      logger.error(`Error al procesar respuesta para usuario ${userId}: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error inesperado. Por favor, intenta nuevamente en unos momentos.");
    }
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

  resetConversation(userId) {
    userContextManager.resetContext(userId);
    orderManager.resetOrder(userId);
    this.blacklist.delete(userId);
    this.clearIdleTimer(userId);
    logger.info(`Conversación reiniciada para usuario ${userId}`);
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
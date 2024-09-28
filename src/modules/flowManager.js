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
import fileValidationService from '../services/fileValidationService.js';


class FlowManager {
  constructor() {
    this.flows = {
      principalFlow: null,
      confirmedFlow: null,
      restartBotFlow: null,
      fileUploadFlow: null,
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
    this.flows.fileUploadFlow = this.createFileUploadFlow();
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

  createFileUploadFlow() {
    return addKeyword(EVENTS.DOCUMENT)
      .addAction(async (ctx, { flowDynamic, state, gotoFlow, endFlow }) => {
        try {
          const filePath = await whatsappService.saveFile(ctx);
          const validationResult = await fileValidationService.validateFile(filePath);
          
          const userContext = userContextManager.getUserContext(ctx.from);
          await userContext.state.update({ fileValidation: validationResult });
          
          if (validationResult.isValid) {
            await flowDynamic('*Archivo recibido y validado correctamente.* ✅');
          } else {
            await flowDynamic(`*El archivo no cumple con los requisitos:* ❌\n${validationResult.reason}`);
          }

          this.enqueueMessage(ctx.from, "ARCHIVO_RECIBIDO", async (accumulatedMessage) => {
            await this.handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, accumulatedMessage);
          });
        } catch (error) {
          logger.error(`Error al procesar el archivo: ${error.message}`);
          await flowDynamic('Hubo un error al procesar tu archivo. Por favor, intenta enviarlo nuevamente.');
        }
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

  async handleAbuseDetected(ctx, flowDynamic, endFlow) {
    this.addToBlacklist(ctx.from, config.abuseBlacklistDuration);
    this.resetConversation(ctx.from);
    await flowDynamic("*Lo siento* 😔, pero hemos detectado un uso inapropiado del sistema. Tu acceso ha sido *temporalmente suspendido*. Si crees que esto es un error, por favor contacta con nuestro equipo de soporte.");
    logger.info(`Mal uso detectado para ${ctx.from}. Añadido a la lista negra por ${config.abuseBlacklistDuration/1000} segundos.`);
    return endFlow();
  }

  async handleServiceSelection(ctx, flowDynamic, order) {
    await flowDynamic(`Has seleccionado el servicio: *${order.service}*. ¿Qué medidas necesitas para este servicio?`);
  }

  async handleSetMeasures(command, userContext, flowDynamic) {
    if (userContext.currentOrder.category === 'Telas PVC' || 
        userContext.currentOrder.category === 'Banderas' || 
        userContext.currentOrder.category === 'Adhesivos' || 
        userContext.currentOrder.category === 'Adhesivo Vehicular' || 
        userContext.currentOrder.category === 'Back Light') {
      userContextManager.updateCurrentOrder(userContext.userId, {
        measures: { width: command.width, height: command.height }
      });
      await flowDynamic(`Medidas registradas: *${command.width}m de ancho x ${command.height}m de alto*. ¿Cuántas unidades necesitas?`);
    } else {
      await flowDynamic(`Este servicio no requiere medidas personalizadas. ¿Cuántas unidades necesitas?`);
    }
  }

  async handleSetQuantity(command, userContext, flowDynamic) {
    userContextManager.updateCurrentOrder(userContext.userId, {
      quantity: command.quantity
    });
    await flowDynamic(`Cantidad registrada: *${command.quantity} unidades*. ¿Necesitas algún acabado especial?`);
  }

  async handleSetFinishes(command, userContext, flowDynamic) {
    userContextManager.updateCurrentOrder(userContext.userId, {
      finishes: {
        sellado: command.sellado,
        ojetillos: command.ojetillos,
        bolsillo: command.bolsillo
      }
    });
    const finishes = [];
    if (command.sellado) finishes.push("sellado");
    if (command.ojetillos) finishes.push("ojetillos");
    if (command.bolsillo) finishes.push("bolsillo");
    const finishesText = finishes.length > 0 ? finishes.join(", ") : "ninguno";
    await flowDynamic(`Acabados registrados: *${finishesText}*. Por favor, envía tu archivo de diseño.`);
  }

  async handleFileValidation(ctx, flowDynamic, order) {
    if (order.isValid) {
      await flowDynamic("*Archivo validado correctamente.* ✅ Voy a preparar un resumen de tu cotización.");
    } else {
      await flowDynamic(`*El archivo no cumple con los requisitos:* ❌\n${order.reason}\nPor favor, envía un nuevo archivo que cumpla con las especificaciones.`);
    }
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

  async handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, message) {
    const userId = ctx.from;
    logger.info(`Procesando mensaje para usuario ${userId}`);

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
      const aiResponse = await openaiService.getChatCompletion(
        openaiService.getSystemPrompt(userContext.services, userContext.additionalInfo, userContext.currentOrder),
        userContext.context + "Usuario: " + message
      );
      logger.info(`Respuesta AI para ${userId}: ${aiResponse}`);

      userContextManager.updateContext(userId, message, "Usuario");
      userContextManager.updateContext(userId, aiResponse, "Asistente");

      const { action, order } = await this.processAIResponse(aiResponse, userId, userContext);

      switch (action) {
        case "CONFIRMAR_PEDIDO":
          await this.handleOrderConfirmation(ctx, flowDynamic, gotoFlow, endFlow, order);
          break;
        case "SOLICITUD_HUMANO":
          await this.handleHumanRequest(ctx, flowDynamic, endFlow);
          break;
        case "ADVERTENCIA_MAL_USO_DETECTADO":
          await this.handleAbuseDetected(ctx, flowDynamic, endFlow);
          break;
        case "SELECT_SERVICE":
          await this.handleServiceSelection(ctx, flowDynamic, order);
          break;
        case "SET_MEASURES":
          await this.handleSetMeasures(ctx, flowDynamic, order);
          break;
        case "SET_QUANTITY":
          await this.handleSetQuantity(ctx, flowDynamic, order);
          break;
        case "SET_FINISHES":
          await this.handleSetFinishes(ctx, flowDynamic, order);
          break;
        case "VALIDATE_FILE":
          await this.handleFileValidation(ctx, flowDynamic, order);
          break;
        default:
          await flowDynamic(aiResponse);
      }
    } catch (error) {
      logger.error(`Error al procesar respuesta para usuario ${userId}: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error inesperado. Por favor, intenta nuevamente en unos momentos.");
    }
  }

  async handleSelectService(command, userContext, flowDynamic) {
    userContextManager.updateCurrentOrder(userContext.userId, {
      service: command.service,
      category: userContext.services[command.service].category,
      availableWidths: userContext.services[command.service].availableWidths,
      availableFinishes: userContext.services[command.service].availableFinishes
    });

    const serviceCategory = userContext.services[command.service].category;
    if (['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceCategory)) {
      await flowDynamic(`Has seleccionado el servicio: *${command.service}*. Este servicio requiere medidas. Los anchos disponibles son: ${userContext.currentOrder.availableWidths.join(', ')} metros. ¿Qué ancho necesitas?`);
    } else {
      await flowDynamic(`Has seleccionado el servicio: *${command.service}*. Este servicio no requiere medidas personalizadas. ¿Cuántas unidades necesitas?`);
    }
  }

  async handleHumanRequest(ctx, flowDynamic, endFlow) {
    this.addToBlacklist(ctx.from, config.humanBlacklistDuration);
    this.resetConversation(ctx.from);
    await flowDynamic("*Entendido* 👍. Un representante se pondrá en contacto contigo pronto. *Gracias por tu paciencia.* 🙏");
    logger.info(`Solicitud de humano para ${ctx.from}. Añadido a la lista negra por ${config.humanBlacklistDuration/1000} segundos.`);
    return endFlow();
  }



  async handleOrderConfirmation(ctx, flowDynamic, gotoFlow, endFlow, order) {
    try {
      const { confirmationMessage, orderSummary, endConversation } = await orderManager.finalizeOrder(ctx.from, ctx.pushName, order);
      await flowDynamic(orderSummary);
      await flowDynamic(confirmationMessage);
      logger.info(`Cotización confirmada para ${ctx.from}. Finalizando flujo.`);
      
      this.addToBlacklist(ctx.from, config.blacklistDuration);
      this.clearIdleTimer(ctx.from);
      
      setTimeout(() => {
        gotoFlow(this.getFlowByName('promoFlow'));
      }, config.promoMessageDelay);
      
      if (endConversation) {
        return endFlow();
      }
    } catch (error) {
      logger.error(`Error al finalizar la cotización para ${ctx.from}: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error al procesar tu cotización. Por favor, intenta nuevamente o contacta con nuestro equipo de soporte.");
    }
  }

  async processAIResponse(aiResponse, userId, userContext) {
    try {
      const jsonCommandMatch = aiResponse.match(/\{.*\}/s);
      if (jsonCommandMatch) {
        const jsonCommand = JSON.parse(jsonCommandMatch[0]);
        return await orderManager.updateOrder(userId, jsonCommand, userContext.services, userContext.currentOrder);
      }
      return { action: "CONTINUAR", order: userContext.currentOrder };
    } catch (error) {
      logger.error(`Error al procesar la respuesta de AI: ${error.message}`);
      return { action: "CONTINUAR", order: userContext.currentOrder };
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
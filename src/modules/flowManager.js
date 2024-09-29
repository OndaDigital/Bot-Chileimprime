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
      documentFlow: null,
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
    this.flows.documentFlow = this.createDocumentFlow();
    this.flows.catchAllFlow = this.createCatchAllFlow();
    this.flows.idleTimeoutFlow = this.createIdleTimeoutFlow();
    this.flows.promoFlow = this.createPromoFlow();

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

  createPrincipalFlow() {
    return addKeyword(EVENTS.WELCOME)
      .addAction(async (ctx, { flowDynamic, gotoFlow, endFlow }) => {
        const userId = ctx.from;
        this.enqueueMessage(userId, ctx.body, async (accumulatedMessage) => {
          await this.handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, accumulatedMessage);
        });
      });
  }

  createDocumentFlow() {
    return addKeyword(EVENTS.DOCUMENT)
      .addAction(async (ctx, { flowDynamic, gotoFlow, endFlow }) => {
        try {
          const filePath = await whatsappService.saveFile(ctx);
          const userContext = userContextManager.getUserContext(ctx.from);
          const serviceInfo = userContextManager.getServiceInfo(userContext.currentOrder.service);
          
          const validationResult = await fileValidationService.validateFile(filePath, serviceInfo);
          
          await userContextManager.updateCurrentOrder(ctx.from, {
            filePath: filePath,
            fileAnalysis: validationResult
          });
          
          this.enqueueMessage(ctx.from, "", async (accumulatedMessage) => {
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
      const chatContext = userContextManager.getChatContext(userId);
      
      const aiResponse = await openaiService.getChatCompletion(
        openaiService.getSystemPrompt(userContext.services, userContext.currentOrder, userContext.additionalInfo, chatContext),
        [...chatContext, { role: "user", content: message }]
      );
      logger.info(`Respuesta AI para ${userId}: ${aiResponse}`);

      userContextManager.updateContext(userId, message, "user");
      userContextManager.updateContext(userId, aiResponse, "assistant");

      const { action, order } = await this.processAIResponse(aiResponse, userId, userContext);

      switch (action) {
        case "SELECT_CATEGORY":
          await this.handleSelectCategory(ctx, flowDynamic, order);
          break;
        case "SELECT_SERVICE":
          await this.handleSelectService(ctx, flowDynamic, order);
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
        case "CONFIRM_ORDER":
          await this.handleOrderConfirmation(ctx, flowDynamic, gotoFlow, endFlow, order);
          break;
        case "SOLICITUD_HUMANO":
          await this.handleHumanRequest(ctx, flowDynamic, endFlow);
          break;
        case "ADVERTENCIA_MAL_USO_DETECTADO":
          await this.handleAbuseDetected(ctx, flowDynamic, endFlow);
          break;
        default:
          await flowDynamic(aiResponse);
      }
    } catch (error) {
      logger.error(`Error al procesar respuesta para usuario ${userId}: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error inesperado. Por favor, intenta nuevamente en unos momentos.");
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

  async handleSelectService(ctx, flowDynamic, order) {
    if (order.action === "INVALID_SERVICE") {
      if (order.similarServices.length > 0) {
        await flowDynamic(`Lo siento, no pude encontrar el servicio "${order.service}". ¿Quizás te refieres a uno de estos? ${order.similarServices.join(', ')}`);
      } else {
        const categories = Object.keys(userContextManager.getGlobalServices());
        await flowDynamic(`Lo siento, no pude encontrar el servicio "${order.service}". Estas son nuestras categorías disponibles: ${categories.join(', ')}. ¿En cuál estás interesado?`);
      }
      return;
    }

    const serviceInfo = userContextManager.getServiceInfo(order.service);
    await flowDynamic(`Has seleccionado el servicio: *${order.service}* de la categoría *${serviceInfo.category}*.`);

    if (['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceInfo.category)) {
      const availableWidths = serviceInfo.availableWidths.map(w => `${w.material}m`).join(', ');
      await flowDynamic(`Por favor, especifica las medidas que necesitas. Anchos disponibles: ${availableWidths}. El alto debe ser mayor a 1 metro.`);
    } else {
      await flowDynamic(`¿Cuántas unidades necesitas?`);
    }
  }

  async handleSetMeasures(ctx, flowDynamic, order) {
    await flowDynamic(`Medidas registradas: *${order.measures.width}m de ancho x ${order.measures.height}m de alto*. ¿Cuántas unidades necesitas?`);
  }

  async handleSetQuantity(ctx, flowDynamic, order) {
    await flowDynamic(`Cantidad registrada: *${order.quantity} unidades*. ¿Necesitas algún acabado especial?`);
  }

  async handleSetFinishes(ctx, flowDynamic, order) {
    const finishes = [];
    if (order.finishes.sellado) finishes.push("sellado");
    if (order.finishes.ojetillos) finishes.push("ojetillos");
    if (order.finishes.bolsillo) finishes.push("bolsillo");
    const finishesText = finishes.length > 0 ? finishes.join(", ") : "ninguno";
    await flowDynamic(`Acabados registrados: *${finishesText}*. Por favor, envía tu archivo de diseño.`);
  }

  async handleFileValidation(ctx, flowDynamic, order) {
    if (order.fileAnalysis.isValid) {
      await flowDynamic("*Archivo validado correctamente.* ✅ Voy a preparar un resumen de tu cotización.");
    } else {
      await flowDynamic(`*El archivo no cumple con los requisitos:* ❌\n${order.fileAnalysis.reason}\nPor favor, envía un nuevo archivo que cumpla con las especificaciones.`);
    }
  }

  async handleOrderConfirmation(ctx, flowDynamic, gotoFlow, endFlow, order) {
    try {
      const { summary, result } = await orderManager.handleConfirmOrder(ctx.from);
      await flowDynamic(summary);
      await flowDynamic(result.message);
      logger.info(`Cotización confirmada para ${ctx.from}. Finalizando flujo.`);
      
      this.addToBlacklist(ctx.from, config.blacklistDuration);
      this.clearIdleTimer(ctx.from);
      
      setTimeout(() => {
        gotoFlow(this.getFlowByName('promoFlow'));
      }, config.promoMessageDelay);
      
      return endFlow();
    } catch (error) {
      logger.error(`Error al finalizar la cotización para ${ctx.from}: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error al procesar tu cotización. Por favor, intenta nuevamente o contacta con nuestro equipo de soporte.");
    }
  }

  async handleHumanRequest(ctx, flowDynamic, endFlow) {
    this.addToBlacklist(ctx.from, config.humanBlacklistDuration);
    this.resetConversation(ctx.from);
    await flowDynamic("*Entendido* 👍. Un representante se pondrá en contacto contigo pronto. *Gracias por tu paciencia.* 🙏");
    logger.info(`Solicitud de humano para ${ctx.from}. Añadido a la lista negra por ${config.humanBlacklistDuration/1000} segundos.`);
    return endFlow();
  }

  async handleAbuseDetected(ctx, flowDynamic, endFlow) {
    this.addToBlacklist(ctx.from, config.abuseBlacklistDuration);
    this.resetConversation(ctx.from);
    await flowDynamic("*Lo siento* 😔, pero hemos detectado un uso inapropiado del sistema. Tu acceso ha sido *temporalmente suspendido*. Si crees que esto es un error, por favor contacta con nuestro equipo de soporte.");
    logger.info(`Mal uso detectado para ${ctx.from}. Añadido a la lista negra por ${config.abuseBlacklistDuration/1000} segundos.`);
    return endFlow();
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
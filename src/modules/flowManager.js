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
          const fileInfo = await fileValidationService.analyzeFile(filePath);
          
          await userContextManager.updateCurrentOrder(ctx.from, {
            filePath: filePath,
            fileAnalysis: fileInfo
          });
          
          logger.info(`Archivo analizado para usuario ${ctx.from}: ${JSON.stringify(fileInfo)}`);
          
          // Generar respuesta inmediata con el análisis del archivo
          const analysisResponse = this.generateFileAnalysisResponse(fileInfo);
          await flowDynamic(analysisResponse);
          
          // Continuar con el flujo normal de la conversación
          this.enqueueMessage(ctx.from, "", async (accumulatedMessage) => {
            await this.handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, accumulatedMessage);
          });          
        } catch (error) {
          logger.error(`Error al procesar el archivo: ${error.message}`);
          await flowDynamic('Hubo un error al procesar tu archivo. Por favor, intenta enviarlo nuevamente.');
        }
      });
  }

  generateFileAnalysisResponse(fileInfo) {
    let response = "He analizado tu archivo. Aquí están los resultados:\n\n";
    response += `📄 Formato: ${fileInfo.format}\n`;
    response += `📏 Dimensiones: ${fileInfo.width}x${fileInfo.height}\n`;
    response += `🔍 Resolución: ${fileInfo.dpi} DPI\n`;
    if (fileInfo.colorSpace) {
      response += `🎨 Espacio de color: ${fileInfo.colorSpace}\n`;
    }
    response += "\nPor favor, indícame qué servicio de impresión necesitas y te diré si el archivo es compatible.";
    return response;
  }

  generateFileAnalysisAIResponse(fileAnalysis) {
    let response = "Basado en el análisis del archivo que enviaste, puedo proporcionar la siguiente información:\n\n";
    response += `El archivo es de tipo ${fileAnalysis.format} con dimensiones de ${fileAnalysis.width}x${fileAnalysis.height} y una resolución de ${fileAnalysis.dpi} DPI. `;
    
    if (fileAnalysis.colorSpace) {
      response += `El espacio de color es ${fileAnalysis.colorSpace}. `;
    }

    response += "\nPara determinar si este archivo es adecuado para tu proyecto de impresión, necesito saber qué servicio específico estás buscando. ¿Podrías decirme qué tipo de impresión necesitas realizar?";

    return response;
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
      
      // Verificar si hay un análisis de archivo reciente
      const hasRecentFileAnalysis = userContext.currentOrder.fileAnalysis && 
                                    !userContext.currentOrder.fileAnalysisResponded;

      let aiResponse;
      if (hasRecentFileAnalysis) {
        // Generar una respuesta específica para el análisis del archivo
        aiResponse = this.generateFileAnalysisAIResponse(userContext.currentOrder.fileAnalysis);
        userContext.currentOrder.fileAnalysisResponded = true;
      } else {
        // Obtener respuesta normal de OpenAI
        aiResponse = await openaiService.getChatCompletion(
          openaiService.getSystemPrompt(userContext.services, userContext.currentOrder, userContext.additionalInfo, chatContext),
          [...chatContext, { role: "user", content: message }]
        );
      }

      logger.info(`Respuesta AI para ${userId}: ${aiResponse}`);

      userContextManager.updateContext(userId, message, "user");
      userContextManager.updateContext(userId, aiResponse, "assistant");

      const commands = this.processAIResponse(aiResponse, userId, userContext);
      
      for (const { action, order } of commands) {
        switch (action) {
          case "VALIDATE_FILE_FOR_SERVICE":
            await this.handleValidateFileForService(ctx, flowDynamic, order);
            break;
          case "LIST_ALL_SERVICES":
            await this.handleListAllServices(ctx, flowDynamic);
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
            logger.info(`Llamando a handleSetFinishes para usuario ${userId} con orden: ${JSON.stringify(order)}`);
            await this.handleSetFinishes(userId, order.sellado, order.ojetillos, order.bolsillo);
            break;
          case "VALIDATE_FILE":
            await this.handleValidateFile(ctx, flowDynamic, order);
            break;
          case "VALIDATE_FILE_FOR_SERVICE":
              await this.handleValidateFileForService(ctx, flowDynamic, order);
            break;
          case "CONFIRM_ORDER":
            await this.handleConfirmOrder(ctx, flowDynamic, gotoFlow, endFlow, order);
            break;
          case "SERVICE_NOT_FOUND":
            await this.handleServiceNotFound(ctx, flowDynamic, order);
            break;
          case "MISSING_INFO":
            await this.handleMissingInfo(ctx, flowDynamic, order);
            break;
          case "ERROR":
            await this.handleGeneralError(ctx, flowDynamic, order);
            break;
          case "CONTINUAR":
          default:
            // Eliminar los comandos JSON del mensaje antes de mostrarlo al usuario
            const cleanedResponse = aiResponse.replace(/\{.*?\}/g, '').trim();
            await flowDynamic(cleanedResponse);
        }
      }
    } catch (error) {
      logger.error(`Error al procesar respuesta para usuario ${userId}: ${error.message}`);
      logger.error(`Stack trace: ${error.stack}`);
      console.error('Error completo:', error);
      await flowDynamic("Lo siento, ha ocurrido un error inesperado. Por favor, intenta nuevamente en unos momentos.");
    }
  }

  async handleConfirmOrder(ctx, flowDynamic, gotoFlow, endFlow, order) {
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


  async handleValidateFile(ctx, flowDynamic, order) {
    try {
      const result = await orderManager.handleValidateFile(ctx.from, order.fileValidation.isValid, order.fileValidation.reason);
      if (result.order.fileAnalysis.isValid) {
        await flowDynamic("*Archivo validado correctamente.* ✅ Voy a preparar un resumen de tu cotización.");
      } else {
        await flowDynamic(`*El archivo no cumple con los requisitos:* ❌\n${result.order.fileAnalysis.reason}\nPor favor, envía un nuevo archivo que cumpla con las especificaciones.`);
      }
    } catch (error) {
      logger.error(`Error al validar el archivo: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error al validar tu archivo. Por favor, intenta enviarlo nuevamente.");
    }
  }

  processAIResponse(aiResponse, userId, userContext) {
    try {
      const jsonCommands = aiResponse.match(/\{.*?\}/g);
      if (jsonCommands) {
        return jsonCommands.map(jsonCommand => {
          const parsedCommand = JSON.parse(jsonCommand);
          logger.info(`Comando JSON recibido para ${userId}: ${JSON.stringify(parsedCommand)}`);
          return this.processCommand(parsedCommand, userContext);
        }).filter(result => result !== null);
      }
      return [{ action: "CONTINUAR", order: userContext.currentOrder }];
    } catch (error) {
      logger.error(`Error al procesar la respuesta de AI para ${userId}: ${error.message}`);
      return [{ action: "CONTINUAR", order: userContext.currentOrder }];
    }
  }

  processCommand(command, userContext) {
    switch (command.command) {
      case "LIST_ALL_SERVICES":
        return { action: "LIST_ALL_SERVICES", order: userContext.currentOrder };
      case "SELECT_SERVICE":
        return { action: "SELECT_SERVICE", order: { ...userContext.currentOrder, service: command.service } };
      case "SET_MEASURES":
        return { action: "SET_MEASURES", order: { ...userContext.currentOrder, measures: { width: command.width, height: command.height } } };
      case "SET_QUANTITY":
        return { action: "SET_QUANTITY", order: { ...userContext.currentOrder, quantity: command.quantity } };
      case "SET_FINISHES":
        return { action: "SET_FINISHES", order: { ...userContext.currentOrder, finishes: command } };
      case "VALIDATE_FILE":
        return { action: "VALIDATE_FILE", order: { ...userContext.currentOrder, fileValidation: command } };
      case "VALIDATE_FILE_FOR_SERVICE":
        return { action: "VALIDATE_FILE_FOR_SERVICE", order: userContext.currentOrder };
      case "CONFIRM_ORDER":
        return { action: "CONFIRM_ORDER", order: userContext.currentOrder };
      default:
        logger.warn(`Comando desconocido recibido: ${command.command}`);
        return null;
    }
  }

  async handleSelectService(ctx, flowDynamic, order) {
    try {
      const userId = ctx.from;
      const result = await orderManager.handleSelectService(userId, order.service);
      if (result.action === "INVALID_SERVICE") {
        if (result.similarServices.length > 0) {
          await flowDynamic(`Lo siento, no pude encontrar el servicio "${order.service}". ¿Quizás te refieres a uno de estos? ${result.similarServices.join(', ')}`);
        } else {
          const categories = Object.keys(userContextManager.getGlobalServices());
          await flowDynamic(`Lo siento, no pude encontrar el servicio "${order.service}". Estas son nuestras categorías disponibles: ${categories.join(', ')}. ¿En cuál estás interesado?`);
        }
      } else {
        const serviceInfo = result.serviceInfo;
        logger.info(`Servicio seleccionado para usuario ${userId}: ${JSON.stringify(serviceInfo)}`);
        
        userContextManager.updateCurrentOrder(userId, { service: order.service });
        logger.info(`CurrentOrder actualizado para usuario ${userId}: ${JSON.stringify(userContextManager.getCurrentOrder(userId))}`);
        
        await flowDynamic(`Has seleccionado el servicio: *${order.service}* de la categoría *${serviceInfo.category}*.`);
        if (['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceInfo.category)) {
          const availableWidths = serviceInfo.availableWidths.map(w => `${w.material}m`).join(', ');
          await flowDynamic(`Por favor, especifica las medidas que necesitas. Anchos disponibles: ${availableWidths}. El alto debe ser mayor a 1 metro.`);
        } else {
          await flowDynamic(`¿Cuántas unidades necesitas?`);
        }
        
        // Añadir información sobre terminaciones disponibles
        const availableFinishes = [];
        if (serviceInfo.sellado) availableFinishes.push("sellado");
        if (serviceInfo.ojetillos) availableFinishes.push("ojetillos");
        if (serviceInfo.bolsillo) availableFinishes.push("bolsillo");
        
        if (availableFinishes.length > 0) {
          await flowDynamic(`Este servicio tiene las siguientes terminaciones disponibles: ${availableFinishes.join(', ')}. ¿Deseas alguna de estas terminaciones?`);
        } else {
          logger.warn(`No se encontraron terminaciones disponibles para el servicio ${order.service}`);
          await flowDynamic(`Este servicio no tiene terminaciones disponibles.`);
        }
      }
    } catch (error) {
      logger.error(`Error al manejar la selección de servicio: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error al procesar tu selección. Por favor, intenta nuevamente.");
    }
  }

  async handleListAllServices(ctx, flowDynamic) {
    try {
      const allServices = userContextManager.getAllServices();
      let serviceList = "Aquí tienes la lista completa de nuestros servicios:\n\n";
      allServices.forEach(service => {
        serviceList += `- ${service.name} (${service.category})\n`;
      });
      await flowDynamic(serviceList);
    } catch (error) {
      logger.error(`Error al listar todos los servicios: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error al obtener la lista de servicios. Por favor, intenta nuevamente.");
    }
  }

  async handleSetMeasures(ctx, flowDynamic, order) {
    try {
      const result = await orderManager.handleSetMeasures(ctx.from, order.measures.width, order.measures.height);
      await flowDynamic(`Medidas registradas: *${result.order.measures.width}m de ancho x ${result.order.measures.height}m de alto*. ¿Cuántas unidades necesitas?`);
    } catch (error) {
      logger.error(`Error al manejar las medidas: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error al registrar las medidas. Por favor, asegúrate de proporcionar medidas válidas e intenta nuevamente.");
    }
  }

  async handleSetQuantity(ctx, flowDynamic, order) {
    try {
      const result = await orderManager.handleSetQuantity(ctx.from, order.quantity);
      await flowDynamic(`Cantidad registrada: *${result.order.quantity} unidades*. ¿Necesitas algún acabado especial?`);
    } catch (error) {
      logger.error(`Error al manejar la cantidad: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error al registrar la cantidad. Por favor, asegúrate de proporcionar un número válido e intenta nuevamente.");
    }
  }

  async handleSetFinishes(userId, sellado, ojetillos, bolsillo) {
    logger.info(`Manejando configuración de acabados para usuario ${userId}`);
    try {
      const currentOrder = userContextManager.getCurrentOrder(userId);
      logger.info(`Orden actual para usuario ${userId}: ${JSON.stringify(currentOrder)}`);

      if (!currentOrder || !currentOrder.service) {
        throw new CustomError('InvalidOrderError', 'No hay una orden válida o un servicio seleccionado');
      }

      const serviceInfo = userContextManager.getServiceInfo(currentOrder.service);
      logger.info(`Información del servicio para ${currentOrder.service}: ${JSON.stringify(serviceInfo)}`);

      if (!serviceInfo) {
        throw new CustomError('ServiceNotFoundError', `No se encontró información para el servicio: ${currentOrder.service}`);
      }

      const finishes = {
        sellado: sellado && serviceInfo.sellado,
        ojetillos: ojetillos && serviceInfo.ojetillos,
        bolsillo: bolsillo && serviceInfo.bolsillo
      };

      userContextManager.updateCurrentOrder(userId, { finishes: finishes });

      logger.info(`Acabados configurados para usuario ${userId}: ${JSON.stringify(finishes)}`);

      return {
        action: "SET_FINISHES",
        order: userContextManager.getCurrentOrder(userId)
      };
    } catch (error) {
      logger.error(`Error al configurar acabados para usuario ${userId}: ${error.message}`);
      logger.error(`Stack trace: ${error.stack}`);
      if (error instanceof CustomError) {
        throw error;
      }
      throw new CustomError('FinishesSetupError', 'Error al configurar los acabados', error);
    }
  }


  async handleServiceNotFound(ctx, flowDynamic, order) {
    await flowDynamic(`Lo siento, no pude encontrar información sobre el servicio "${order.service}". ¿Podrías verificar el nombre del servicio o elegir uno de nuestra lista de servicios disponibles?`);
    // Aquí podrías añadir lógica para mostrar la lista de servicios disponibles
  }

  async handleMissingInfo(ctx, flowDynamic, order) {
    await flowDynamic(`Parece que falta información importante para completar tu pedido. Específicamente, necesito saber más sobre: ${order.missingField}. ¿Podrías proporcionarme esa información?`);
  }

  async handleGeneralError(ctx, flowDynamic, order) {
    await flowDynamic(`Lo siento, ha ocurrido un error inesperado: ${order.message}. Estamos trabajando para resolverlo. Por favor, intenta nuevamente en unos momentos o contacta a nuestro soporte si el problema persiste.`);
  }

  async handleFileValidation(ctx, flowDynamic, order) {
    if (order.fileAnalysis.isValid) {
      await flowDynamic("*Archivo validado correctamente.* ✅ Voy a preparar un resumen de tu cotización.");
    } else {
      await flowDynamic(`*El archivo no cumple con los requisitos:* ❌\n${order.fileAnalysis.reason}\nPor favor, envía un nuevo archivo que cumpla con las especificaciones.`);
    }
  }

  async handleValidateFileForService(ctx, flowDynamic, order) {
    const userId = ctx.from;
    const currentOrder = userContextManager.getCurrentOrder(userId);
    const serviceInfo = userContextManager.getServiceInfo(currentOrder.service);

    if (!currentOrder.fileAnalysis) {
      await flowDynamic("Lo siento, parece que no hay un archivo para validar. Por favor, envía un archivo primero.");
      return;
    }

    await flowDynamic("Estoy validando el archivo para el servicio seleccionado. Un momento, por favor...");

    try {
      const validationResult = await openaiService.validateFileForService(
        currentOrder.fileAnalysis,
        serviceInfo,
        currentOrder.measures,
        currentOrder
      );

      userContextManager.updateCurrentOrder(userId, {
        fileValidation: validationResult
      });

      if (validationResult.isValid) {
        await flowDynamic("¡Excelente! El archivo que enviaste es válido para el servicio seleccionado. Podemos continuar con tu pedido.");
      } else {
        await flowDynamic(`Lo siento, pero el archivo no cumple con los requisitos para este servicio. Aquí está el análisis:\n\n${validationResult.analysis}\n\nPor favor, ajusta el archivo según estas recomendaciones y vuelve a enviarlo.`);
      }

      // Generar una nueva respuesta de OpenAI para continuar la conversación
      const newResponse = await this.getNewAIResponse(userId);
      await flowDynamic(newResponse);

    } catch (error) {
      logger.error(`Error al validar el archivo para el servicio: ${error.message}`);
      await flowDynamic("Lo siento, hubo un problema al validar el archivo. Por favor, intenta enviar el archivo nuevamente.");
    }
  }

  async getNewAIResponse(userId) {
    const userContext = userContextManager.getUserContext(userId);
    const chatContext = userContextManager.getChatContext(userId);
    
    const aiResponse = await openaiService.getChatCompletion(
      openaiService.getSystemPrompt(userContext.services, userContext.currentOrder, userContext.additionalInfo, chatContext),
      [...chatContext, { role: "assistant", content: "El archivo ha sido validado. ¿Cómo puedo ayudarte a continuar con tu pedido?" }]
    );

    userContextManager.updateContext(userId, aiResponse, "assistant");
    return aiResponse;
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
import logger from './utils/logger.js';
import userContextManager from './modules/userContext.js';
import orderManager from './modules/orderManager.js';
import openaiService from './services/openaiService.js';
import config from './config/config.js';

class CommandProcessor {
  constructor() {}

  async processCommand(command, userId, ctx, { flowDynamic, gotoFlow, endFlow }) {
    try {
      switch (command.command) {
        case "LIST_ALL_SERVICES":
          return this.handleListAllServices(ctx, flowDynamic);
        case "SELECT_SERVICE":
          return this.handleSelectService(ctx, flowDynamic, command.service);
        case "SET_MEASURES":
          return this.handleSetMeasures(ctx, flowDynamic, command.width, command.height);
        case "SET_QUANTITY":
          return this.handleSetQuantity(ctx, flowDynamic, command.quantity);
        case "SET_FINISHES":
          return this.handleSetFinishes(userId, command.sellado, command.ojetillos, command.bolsillo);
        case "VALIDATE_FILE_FOR_SERVICE":
          return this.handleValidateFileForService(ctx, flowDynamic);
        case "CONFIRM_ORDER":
          return this.handleConfirmOrder(ctx, flowDynamic, gotoFlow, endFlow);
        case "SERVICE_NOT_FOUND":
          return this.handleServiceNotFound(ctx, flowDynamic, command.service);
        case "MISSING_INFO":
          return this.handleMissingInfo(ctx, flowDynamic, command.missingField);
        case "ERROR":
          return this.handleGeneralError(ctx, flowDynamic, command.message);
        default:
          logger.warn(`Comando desconocido recibido: ${command.command}`);
          return null;
      }
    } catch (error) {
      logger.error(`Error al procesar comando: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error inesperado. Por favor, intenta nuevamente en unos momentos.");
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

  async handleSelectService(ctx, flowDynamic, serviceName) {
    try {
      const result = await orderManager.handleSelectService(ctx.from, serviceName);
      if (result.action === "INVALID_SERVICE") {
        if (result.similarServices.length > 0) {
          await flowDynamic(`Lo siento, no pude encontrar el servicio "${serviceName}". ¿Quizás te refieres a uno de estos? ${result.similarServices.join(', ')}`);
        } else {
          const categories = Object.keys(userContextManager.getGlobalServices());
          await flowDynamic(`Lo siento, no pude encontrar el servicio "${serviceName}". Estas son nuestras categorías disponibles: ${categories.join(', ')}. ¿En cuál estás interesado?`);
        }
      } else {
        const serviceInfo = result.serviceInfo;
        await flowDynamic(`Has seleccionado el servicio: *${serviceName}* de la categoría *${serviceInfo.category}*.`);
        if (['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceInfo.category)) {
          const availableWidths = serviceInfo.availableWidths.map(w => `${w.material}m`).join(', ');
          await flowDynamic(`Por favor, especifica las medidas que necesitas. Anchos disponibles: ${availableWidths}. El alto debe ser mayor a 1 metro.`);
        } else {
          await flowDynamic(`¿Cuántas unidades necesitas?`);
        }
        
        const availableFinishes = [];
        if (serviceInfo.sellado) availableFinishes.push("sellado");
        if (serviceInfo.ojetillos) availableFinishes.push("ojetillos");
        if (serviceInfo.bolsillo) availableFinishes.push("bolsillo");
        
        if (availableFinishes.length > 0) {
          await flowDynamic(`Este servicio tiene las siguientes terminaciones disponibles: ${availableFinishes.join(', ')}. ¿Deseas alguna de estas terminaciones?`);
        } else {
          await flowDynamic(`Este servicio no tiene terminaciones disponibles.`);
        }
      }
    } catch (error) {
      logger.error(`Error al manejar la selección de servicio: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error al procesar tu selección. Por favor, intenta nuevamente.");
    }
  }

  async handleSetMeasures(ctx, flowDynamic, width, height) {
    try {
      const result = await orderManager.handleSetMeasures(ctx.from, width, height);
      await flowDynamic(`Medidas registradas: *${result.order.measures.width}m de ancho x ${result.order.measures.height}m de alto*. ¿Cuántas unidades necesitas?`);
    } catch (error) {
      logger.error(`Error al manejar las medidas: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error al registrar las medidas. Por favor, asegúrate de proporcionar medidas válidas e intenta nuevamente.");
    }
  }

  async handleSetQuantity(ctx, flowDynamic, quantity) {
    try {
      const result = await orderManager.handleSetQuantity(ctx.from, quantity);
      await flowDynamic(`Cantidad registrada: *${result.order.quantity} unidades*. ¿Necesitas algún acabado especial?`);
    } catch (error) {
      logger.error(`Error al manejar la cantidad: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error al registrar la cantidad. Por favor, asegúrate de proporcionar un número válido e intenta nuevamente.");
    }
  }

  async handleSetFinishes(userId, sellado, ojetillos, bolsillo) {
    try {
      const result = await orderManager.setFinishes(userId, sellado, ojetillos, bolsillo);
      return result;
    } catch (error) {
      logger.error(`Error al configurar acabados para usuario ${userId}: ${error.message}`);
      throw error;
    }
  }

  async handleValidateFile(ctx, flowDynamic, command) {
    try {
      const result = await orderManager.handleValidateFile(ctx.from, command.isValid, command.reason);
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

  async handleValidateFileForService(ctx, flowDynamic) {
    const userId = ctx.from;
    const currentOrder = userContextManager.getCurrentOrder(userId);
    const fileAnalysis = currentOrder.fileAnalysis;

    if (!fileAnalysis) {
      await flowDynamic("Lo siento, parece que no hay un archivo para validar. Por favor, envía un archivo primero.");
      return;
    }

    if (currentOrder.fileAnalysisHandled) {
      logger.info(`Análisis de archivo ya manejado para usuario ${userId}. Ignorando solicitud duplicada.`);
      return;
    }

    let response = "He analizado tu archivo. Aquí están los resultados:\n\n";
    response += `📄 Formato: ${fileAnalysis.format}\n`;
    response += `📏 Dimensiones: ${fileAnalysis.width}x${fileAnalysis.height}\n`;
    response += `🔍 Resolución: ${fileAnalysis.dpi} DPI\n`;
    if (fileAnalysis.colorSpace) {
      response += `🎨 Espacio de color: ${fileAnalysis.colorSpace}\n`;
    }

    if (!currentOrder.service) {
      response += "\nPara determinar si este archivo es adecuado para tu proyecto, necesito saber qué servicio específico estás buscando. ¿Podrías decirme qué tipo de impresión necesitas realizar?";
    } else {
      const serviceInfo = userContextManager.getServiceInfo(currentOrder.service);
      if (!currentOrder.measures && ['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceInfo.category)) {
        response += `\nYa tenemos seleccionado el servicio ${currentOrder.service}. Para validar completamente el archivo, necesito que me proporciones las medidas que necesitas. ¿Podrías indicarme el ancho y alto requeridos?`;
      } else {
        response += "\nCon esta información, puedo determinar si el archivo es adecuado para tu proyecto. ¿Necesitas que revise algo más específico del archivo?";
      }
    }

    await flowDynamic(response);
    userContextManager.updateFileAnalysisResponded(userId, true);
    userContextManager.updateFileAnalysisHandled(userId, true);
    logger.info(`Análisis de archivo manejado y respuesta enviada para usuario ${userId}`);
  }

  async handleConfirmOrder(ctx, flowDynamic, gotoFlow, endFlow) {
    try {
      const { summary, result } = await orderManager.handleConfirmOrder(ctx.from);
      await flowDynamic(summary);
      await flowDynamic(result.message);
      logger.info(`Cotización confirmada para ${ctx.from}. Finalizando flujo.`);
      
      setTimeout(() => {
        gotoFlow('promoFlow');
      }, config.promoMessageDelay);
      
      return endFlow();
    } catch (error) {
      logger.error(`Error al finalizar la cotización para ${ctx.from}: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error al procesar tu cotización. Por favor, intenta nuevamente o contacta con nuestro equipo de soporte.");
    }
  }

  async handleServiceNotFound(ctx, flowDynamic, serviceName) {
    await flowDynamic(`Lo siento, no pude encontrar información sobre el servicio "${serviceName}". ¿Podrías verificar el nombre del servicio o elegir uno de nuestra lista de servicios disponibles?`);
  }

  async handleMissingInfo(ctx, flowDynamic, missingField) {
    await flowDynamic(`Parece que falta información importante para completar tu pedido. Específicamente, necesito saber más sobre: ${missingField}. ¿Podrías proporcionarme esa información?`);
  }

  async handleGeneralError(ctx, flowDynamic, errorMessage) {
    await flowDynamic(`Lo siento, ha ocurrido un error inesperado: ${errorMessage}. Estamos trabajando para resolverlo. Por favor, intenta nuevamente en unos momentos o contacta a nuestro soporte si el problema persiste.`);
  }
}

export default new CommandProcessor();
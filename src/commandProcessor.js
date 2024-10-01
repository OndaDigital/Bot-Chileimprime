import logger from './utils/logger.js';
import userContextManager from './modules/userContext.js';
import orderManager from './modules/orderManager.js';
import openaiService from './services/openaiService.js';
import config from './config/config.js';
import sheetService from './services/sheetService.js'

class CommandProcessor {
  constructor() {}

  async processCommand(command, userId, ctx, { flowDynamic, gotoFlow, endFlow }) {
    try {
      logger.info(`Procesando comando para usuario ${userId}: ${JSON.stringify(command)}`);
      switch (command.command) {
        case "LIST_ALL_SERVICES":
          return this.handleListAllServices(userId);
        case "SELECT_SERVICE":
          return this.handleSelectService(userId, command.service);
        case "SET_MEASURES":
          return this.handleSetMeasures(userId, command.width, command.height);
        case "SET_QUANTITY":
          return this.handleSetQuantity(userId, command.quantity);
        case "SET_FINISHES":
          return this.handleSetFinishes(userId, command.sellado, command.ojetillos, command.bolsillo);
        case "CONFIRM_ORDER":
          return this.handleConfirmOrder(userId, ctx, { flowDynamic, gotoFlow, endFlow });
        case "SERVICE_NOT_FOUND":
          return this.handleServiceNotFound(userId, command.service);
        case "MISSING_INFO":
          return this.handleMissingInfo(userId, command.missingField);
        case "ERROR":
          return this.handleGeneralError(userId, command.message);
        default:
          logger.warn(`Comando desconocido recibido: ${command.command}`);
          return { currentOrderUpdated: false };
      }
    } catch (error) {
      logger.error(`Error al procesar comando: ${error.message}`);
      return { currentOrderUpdated: false, error: error.message };
    }
  }

  async handleSetQuantity(userId, quantity) {
    try {
      const result = await orderManager.handleSetQuantity(userId, quantity);
      logger.info(`Cantidad establecida para usuario ${userId}: ${quantity}`);
      return { currentOrderUpdated: true, ...result };
    } catch (error) {
      logger.error(`Error al configurar cantidad para usuario ${userId}: ${error.message}`);
      return { currentOrderUpdated: false, error: error.message };
    }
  }

  async handleSetFinishes(userId, sellado, ojetillos, bolsillo) {
    try {
      const result = await orderManager.setFinishes(userId, sellado, ojetillos, bolsillo);
      logger.info(`Acabados establecidos para usuario ${userId}: sellado=${sellado}, ojetillos=${ojetillos}, bolsillo=${bolsillo}`);
      return { currentOrderUpdated: true, ...result };
    } catch (error) {
      logger.error(`Error al configurar acabados para usuario ${userId}: ${error.message}`);
      return { currentOrderUpdated: false, error: error.message };
    }
  }

  async handleSetMeasures(userId, width, height) {
    try {
      const result = await orderManager.handleSetMeasures(userId, width, height);
      logger.info(`Medidas establecidas para usuario ${userId}: ${width}x${height}`);
      return { currentOrderUpdated: true, ...result };
    } catch (error) {
      logger.error(`Error al configurar medidas para usuario ${userId}: ${error.message}`);
      return { currentOrderUpdated: false, error: error.message };
    }
  }


  async handleFileAnalysis(ctx, flowDynamic) {
    const userId = ctx.from;
    const currentOrder = userContextManager.getCurrentOrder(userId);
    const fileAnalysis = currentOrder.fileAnalysis;
 
    if (!fileAnalysis) {
      await flowDynamic("Lo siento, parece que no hay un archivo para analizar. Por favor, envía un archivo primero.");
      return;
    }
 
    let response = "He analizado tu archivo. Aquí están los resultados:\n\n";
    response += `📄 Formato: *${fileAnalysis.format}*\n`;
    response += `📏 Dimensiones en píxeles: *${fileAnalysis.width}x${fileAnalysis.height}*\n`;
   
    const widthM = (fileAnalysis.physicalWidth / 100).toFixed(2);
    const heightM = (fileAnalysis.physicalHeight / 100).toFixed(2);
    response += `📐 Dimensiones físicas: *${widthM}x${heightM} m* (${fileAnalysis.physicalWidth.toFixed(2)}x${fileAnalysis.physicalHeight.toFixed(2)} cm)\n`;
   
    response += `📊 Área del diseño: *${fileAnalysis.area} m²*\n`;
    response += `🔍 Resolución: *${fileAnalysis.dpi} DPI*\n`;
   
    if (fileAnalysis.colorSpace) {
      response += `🎨 Espacio de color: *${fileAnalysis.colorSpace}*\n`;
    }
   
    if (fileAnalysis.fileSize) {
      response += `📦 Tamaño del archivo: *${fileAnalysis.fileSize}*\n`;
    }
 
    await flowDynamic(response);
    userContextManager.updateFileAnalysisResponded(userId, true);

    // Generar y enviar el segundo mensaje
    await this.handleFileValidationInstruction(ctx, flowDynamic);
  }

  async handleFileValidationInstruction(ctx, flowDynamic) {
    const userId = ctx.from;
    const currentOrder = userContextManager.getCurrentOrder(userId);

    const instruction = `El usuario acaba de subir un archivo. Verifica el currentOrder y responde según las siguientes condiciones:

    1. Si el currentOrder no contiene un servicio válido, solicita al usuario que seleccione un servicio de impresión.

    2. Si hay un servicio seleccionado, verifica la categoría:
       - Para las categorías Tela PVC, Banderas, Adhesivos, Adhesivo Vehicular y Back Light:
         a) Si no hay medidas seleccionadas, solicita al usuario que proporcione las medidas (ancho y alto).
         b) Si hay medidas seleccionadas, procede a validar el archivo considerando una tolerancia máxima del 70%.

    3. Para las categorías Otros, Imprenta, Péndon Roller, Palomas, Figuras y Extras:
       - Si hay un servicio seleccionado, procede a validar el archivo considerando una tolerancia máxima del 70%.

    4. Si el archivo es válido, informa al usuario y sugiere el siguiente paso en el proceso de cotización.
    5. Si el archivo no es válido, explica detalladamente por qué, considerando la tolerancia del 70%, y sugiere cómo el usuario puede corregirlo.

    Asegúrate de que tu respuesta sea clara, concisa y guíe al usuario sobre cómo proceder.`;

    const aiResponse = await openaiService.getChatCompletion(
      openaiService.getSystemPrompt(sheetService.getServices(), currentOrder, sheetService.getAdditionalInfo(), []),
      [{ role: "system", content: instruction }]
    );

    await flowDynamic(aiResponse);
  }
  

  async handleListAllServices(userId, actions) {
    const services = sheetService.getServices();
    userContextManager.updateCurrentOrder(userId, { availableServices: services });
    const formattedServices = this.formatServiceList(services);
    logger.info(`Lista de servicios preparada para usuario ${userId}`);
    
    return { 
      currentOrderUpdated: true, 
      action: 'SHOW_SERVICES',
      data: formattedServices
    };
  }

  formatServiceList(services) {
    let formattedList = "Aquí tienes la lista completa de servicios disponibles:\n\n";
    
    for (const [category, categoryServices] of Object.entries(services)) {
      formattedList += `*${category}*:\n`;
      categoryServices.forEach(service => {
        formattedList += `- ${service.name}\n`;
      });
      formattedList += "\n";
    }

    formattedList += "Para obtener más información sobre un servicio específico, por favor menciona su nombre.";
    return formattedList;
  }

  async handleSelectService(userId, serviceName) {
    try {
      const result = await orderManager.handleSelectService(userId, serviceName);
      logger.info(`Servicio seleccionado para usuario ${userId}: ${serviceName}`);
      return { currentOrderUpdated: true, ...result };
    } catch (error) {
      logger.error(`Error al seleccionar servicio para usuario ${userId}: ${error.message}`);
      return { currentOrderUpdated: false, error: error.message };
    }
  }


  async handleConfirmOrder(userId, ctx, { flowDynamic, gotoFlow, endFlow }) {
    try {
      const result = await orderManager.handleConfirmOrder(userId);
      if (result.success) {
        logger.info(`Pedido confirmado para usuario ${userId}`);
        return { currentOrderUpdated: true, ...result, nextFlow: 'promoFlow' };
      } else {
        logger.warn(`No se pudo confirmar el pedido para usuario ${userId}: ${result.message}`);
        return { currentOrderUpdated: false, error: result.message };
      }
    } catch (error) {
      logger.error(`Error al confirmar el pedido para ${userId}: ${error.message}`);
      return { currentOrderUpdated: false, error: error.message };
    }
  }

  async handleServiceNotFound(userId, serviceName) {
    userContextManager.updateCurrentOrder(userId, { lastErrorMessage: `Servicio no encontrado: ${serviceName}` });
    logger.warn(`Servicio no encontrado para usuario ${userId}: ${serviceName}`);
    return { currentOrderUpdated: true };
  }

  async handleMissingInfo(userId, missingField) {
    userContextManager.updateCurrentOrder(userId, { lastErrorMessage: `Falta información: ${missingField}` });
    logger.warn(`Información faltante para usuario ${userId}: ${missingField}`);
    return { currentOrderUpdated: true };
  }

  async handleGeneralError(userId, errorMessage) {
    userContextManager.updateCurrentOrder(userId, { lastErrorMessage: errorMessage });
    logger.error(`Error general para usuario ${userId}: ${errorMessage}`);
    return { currentOrderUpdated: true };
  }

  
}

export default new CommandProcessor();
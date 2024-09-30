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
        case "VALIDATE_FILE_FOR_SERVICE":
          return this.handleValidateFileForService(userId);
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
  
    if (!currentOrder.service) {
      response += "\nPor favor, indícame qué servicio de impresión necesitas para poder validar si el archivo es compatible.";
    } else {
      const serviceInfo = userContextManager.getServiceInfo(currentOrder.service);
      if (!currentOrder.measures && ['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceInfo.category)) {
        response += `\nYa has seleccionado el servicio *${currentOrder.service}*. Ahora necesito que me proporciones las medidas (ancho y alto) que necesitas para tu impresión.`;
      } else {
        // Tenemos toda la información, procedemos a validar
        await this.checkAndValidateFile(ctx, flowDynamic);
        return; // Evitamos enviar una respuesta adicional
      }
    }
  
    await flowDynamic(response);
    userContextManager.updateFileAnalysisResponded(userId, true);
  }
  

  async handleListAllServices(userId) {
    const services = sheetService.getServices();
    userContextManager.updateCurrentOrder(userId, { availableServices: services });
    logger.info(`Lista de servicios actualizada para usuario ${userId}`);
    return { currentOrderUpdated: true };
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

  async checkAndValidateFile(ctx, flowDynamic) {
    const userId = ctx.from;
    const currentOrder = userContextManager.getCurrentOrder(userId);
    
    if (currentOrder.fileAnalysis && currentOrder.service) {
      const serviceInfo = userContextManager.getServiceInfo(currentOrder.service);
      if (!['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceInfo.category) || 
          (currentOrder.measures && currentOrder.measures.width && currentOrder.measures.height)) {
        // Tenemos toda la información necesaria, procedemos a validar
        try {
          const validationResult = await openaiService.validateFileForService(
            currentOrder.fileAnalysis,
            serviceInfo,
            currentOrder.measures,
            currentOrder
          );

          let response = `Análisis de compatibilidad para el servicio ${currentOrder.service}:\n\n`;
          response += validationResult.analysis + "\n\n";

          if (validationResult.isValid) {
            response += "✅ El archivo es válido para este servicio y medidas.";
          } else {
            response += `❌ El archivo no cumple con los requisitos: ${validationResult.reason}\n`;
            response += "Por favor, ajusta tu archivo según las recomendaciones y vuelve a enviarlo.";
          }

          await flowDynamic(response);
          userContextManager.updateCurrentOrder(userId, { fileValidation: validationResult });
        } catch (error) {
          logger.error(`Error al validar el archivo para el usuario ${userId}: ${error.message}`);
          await flowDynamic("Lo siento, ha ocurrido un error al validar el archivo. Por favor, intenta nuevamente o contacta con nuestro soporte técnico.");
        }
      }
    }
  }

  async handleValidateFile(ctx, flowDynamic, isValid, reason) {
    const userId = ctx.from;
    try {
      await userContextManager.updateCurrentOrder(userId, {
        fileValidation: { isValid, reason }
      });
      
      if (isValid) {
        await flowDynamic("✅ El archivo es válido para este servicio y medidas.");
      } else {
        await flowDynamic(`❌ El archivo no cumple con los requisitos: ${reason}\nPor favor, ajusta tu archivo según las recomendaciones y vuelve a enviarlo.`);
      }
    } catch (error) {
      logger.error(`Error al manejar la validación del archivo para usuario ${userId}: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error al procesar la validación del archivo. Por favor, intenta nuevamente.");
    }
  }

  async handleValidateFileForService(userId) {
    try {
      const result = await orderManager.handleValidateFile(userId);
      logger.info(`Archivo validado para usuario ${userId}: ${JSON.stringify(result)}`);
      return { currentOrderUpdated: true, ...result };
    } catch (error) {
      logger.error(`Error al validar archivo para usuario ${userId}: ${error.message}`);
      return { currentOrderUpdated: false, error: error.message };
    }
  }

  async validateFileForService(ctx, flowDynamic) {
    const userId = ctx.from;
    const currentOrder = userContextManager.getCurrentOrder(userId);
    const serviceInfo = userContextManager.getServiceInfo(currentOrder.service);

    try {
      const validationResult = await openaiService.validateFileForService(
        currentOrder.fileAnalysis,
        serviceInfo,
        currentOrder.measures,
        currentOrder
      );

      let response = `Análisis de compatibilidad para el servicio ${currentOrder.service}:\n\n`;
      response += validationResult.analysis + "\n\n";

      if (validationResult.isValid) {
        response += "✅ El archivo es válido para este servicio y medidas.";
      } else {
        response += `❌ El archivo no cumple con los requisitos: ${validationResult.reason}\n`;
        response += "Por favor, ajusta tu archivo según las recomendaciones y vuelve a enviarlo.";
      }

      await flowDynamic(response);
      return response;
    } catch (error) {
      logger.error(`Error al validar el archivo para el usuario ${userId}: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error al validar el archivo. Por favor, intenta nuevamente o contacta con nuestro soporte técnico.");
      return "Error en la validación del archivo";
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
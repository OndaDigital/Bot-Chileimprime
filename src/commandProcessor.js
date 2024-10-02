import logger from './utils/logger.js';
import userContextManager from './modules/userContext.js';
import orderManager from './modules/orderManager.js';
import openaiService from './services/openaiService.js';
import config from './config/config.js';
import sheetService from './services/sheetService.js'
import { formatPrice, sendSplitMessages } from './utils/helpers.js';

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
        case "RESULT_ANALYSIS":
            return this.handleAnalysisResult(userId, command.result);
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

  // Nuevo método para manejar RESULT_ANALYSIS
  async handleAnalysisResult(userId, result) {
    try {
      const isValid = result === true || result === "true";
      userContextManager.updateCurrentOrder(userId, { fileValidation: isValid });
      logger.info(`Resultado del análisis actualizado para usuario ${userId}: ${isValid}`);
      return { currentOrderUpdated: true };
    } catch (error) {
      logger.error(`Error al actualizar resultado del análisis para usuario ${userId}: ${error.message}`);
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

    // Verificar que el currentOrder está actualizado
    if (!currentOrder.service || (!currentOrder.measures && currentOrder.requiresMeasures())) {
      // Solicitar la información faltante al usuario
      await flowDynamic("Parece que falta información en tu pedido. Por favor, asegúrate de haber proporcionado el servicio y las medidas necesarias.");
      return;
    }

    // Generar la instrucción para la IA con mayor contexto y flexibilidad
    const instruction = `El usuario acaba de subir un archivo. Ahora eres un experto en impresion de gran formato e ingeniero en color. Verifica el currentOrder y responde según las siguientes condiciones:

1. Analiza el archivo proporcionado considerando una tolerancia del 70% en cuanto a las medidas y el área del diseño comparado con el servicio solicitado.
2. Ten en cuenta que el DPI es importante, pero debe ajustarse según el tamaño del área:
   - Para áreas pequeñas (menos de 2 m²), DPI recomendado: 150 dpi.
   - Para áreas entre 2 m² y 20 m², DPI recomendado: entre 72 dpi y 120 dpi.
   - Para áreas mayores a 20 m², DPI mínimo aceptable: 20 dpi.
3. Considera que en casos especiales, como archivos muy grandes que superan las limitaciones técnicas (ejemplo: archivos mayores a 3GB), es aceptable reducir el DPI para adaptarse.
4. Aplica tu expertise en impresión para evaluar si el archivo es adecuado, incluso si no cumple exactamente con los criterios, pero está dentro de la tolerancia del 70%.
5. Si el archivo es válido o puede ser aceptado con modificaciones menores, indica que es válido.
6. Si el archivo no es válido, proporciona una explicación detallada y consejos específicos para que el cliente pueda corregirlo.

Información para la validación:
- Área del servicio solicitado: ${currentOrder.areaServicio ? currentOrder.areaServicio.toFixed(2) : 'No disponible'} m²
- Área del diseño proporcionado: ${currentOrder.fileAnalysis ? currentOrder.fileAnalysis.area.toFixed(2) : 'No disponible'} m²
- Resolución del diseño: ${currentOrder.fileAnalysis ? currentOrder.fileAnalysis.dpi : 'No disponible'} dpi
- Formato del diseño: ${currentOrder.fileAnalysis ? currentOrder.fileAnalysis.format : 'No disponible'}
- Espacio de color: ${currentOrder.fileAnalysis ? currentOrder.fileAnalysis.colorSpace : 'No disponible'}

Criterios de Validación:
${userContextManager.getFileValidationCriteria()}

IMPORTANTE:
- Al inicio de tu respuesta, incluye un comando JSON indicando el resultado del análisis, en el siguiente formato:
{"command": "RESULT_ANALYSIS", "result": true/false}
- Luego, proporciona la respuesta al usuario siguiendo un formato fijo de 3 secciones, separadas por encabezados "### ":
  1. ### Criterios de Validación Aplicados:
     - Explica brevemente los criterios que aplicaste en este caso específico.
  2. ### Resultado de la Validación:
     - Indica si el archivo es válido o no, y proporciona detalles.
  3. ### Siguiente Paso:
     - Indica al usuario cuál es el siguiente paso en el proceso.

- Asegúrate de que tu respuesta siga este formato exactamente, para que pueda ser dividida en mensajes separados.

Responde al usuario siguiendo estas indicaciones.`;

    // Log para depuración
    logger.info(`Enviando instrucción a la IA para validación de archivo para usuario ${userId}: ${instruction}`);

    const aiResponse = await openaiService.getChatCompletion(
      openaiService.getSystemPrompt(userContextManager.getGlobalServices(), currentOrder, userContextManager.getGlobalAdditionalInfo(), userContextManager.getChatContext(userId)),
      userContextManager.getChatContext(userId).concat({ role: "system", content: instruction })
    );

    // Actualizar el contexto de chat
    userContextManager.updateContext(userId, instruction, "system");
    userContextManager.updateContext(userId, aiResponse, "assistant");

    // Log de la respuesta de la IA
    logger.info(`Respuesta de la IA para validación de archivo para usuario ${userId}: ${aiResponse}`);

    // Procesar comandos en la respuesta de la IA
    const commands = this.processAIResponseCommandProcessor(aiResponse);
    for (const command of commands) {
      await this.processCommand(command, userId, ctx, { flowDynamic });
    }

    // Enviar los mensajes divididos al usuario
    await sendSplitMessages(flowDynamic, aiResponse);
  }

  processAIResponseCommandProcessor(aiResponse) {
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

    const categoryEmojis = {
      'Telas PVC': '🖼️',
      'Banderas': '🚩',
      'Adhesivos': '🏷️',
      'Adhesivo Vehicular': '🚗',
      'Back Light': '💡',
      'Otros': '📦',
      'Imprenta': '🖨️',
      'Péndon Roller': '🎞️',
      'Palomas': '🐦',
      'Figuras': '🔺',
      'Extras': '➕'
    };

    for (const [category, categoryServices] of Object.entries(services)) {
      const emojiIcon = categoryEmojis[category] || '';
      formattedList += `${emojiIcon} *${category}:*\n`;

      categoryServices.forEach(service => {
        const serviceName = service.name;
        const priceFormatted = formatPrice(service.precio);
        const priceBold = `*$${
          priceFormatted
        }*`; // Envuelve el precio con asteriscos para negrita
        formattedList += `- ${serviceName}: ${priceBold}\n`;
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
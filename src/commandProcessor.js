import logger from './utils/logger.js';
import userContextManager from './modules/userContext.js';
import orderManager from './modules/orderManager.js';
import openaiService from './services/openaiService.js';
import config from './config/config.js';
import sheetService from './services/sheetService.js'
import { formatPrice, sendSplitMessages } from './utils/helpers.js';
import { normalizeCommand, findClosestCommand, sanitizeJsonString } from './utils/commandUtils.js';

class CommandProcessor {
  constructor() {}

  async processCommand(command, userId, ctx, { flowDynamic, gotoFlow, endFlow }) {
    try {
      logger.info(`Procesando comando para usuario ${userId}: ${JSON.stringify(command)}`);

      // Normalizar y corregir el comando
      const normalizedCommand = normalizeCommand(command.command);
      const correctedCommand = findClosestCommand(normalizedCommand) || normalizedCommand;
      
      logger.info(`Comando normalizado: ${normalizedCommand}, Comando corregido: ${correctedCommand}`);
      
      if (correctedCommand !== command.command) {
        logger.warn(`Comando corregido de "${command.command}" a "${correctedCommand}"`);
      }

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
 
    logger.info(`Iniciando análisis de archivo para usuario ${userId}`);
    let response = "He analizado tu archivo. Aquí están los resultados:\n\n";
    response += `📄 Formato: *${fileAnalysis.format}*\n`;
    response += `📏 Dimensiones en píxeles: *${fileAnalysis.width}x${fileAnalysis.height}*\n`;
   
    const widthM = fileAnalysis.physicalWidth.toFixed(2);
    const heightM = fileAnalysis.physicalHeight.toFixed(2);
    response += `📐 Dimensiones físicas: *${widthM}x${heightM} m* (${(widthM*100).toFixed(2)}x${(heightM*100).toFixed(2)} cm)\n`;
   
    response += `📊 Área del diseño: *${fileAnalysis.area} m²*\n`;
    response += `🔍 Resolución: *${fileAnalysis.dpi} DPI*\n`;
   
    if (fileAnalysis.colorSpace) {
      response += `🎨 Espacio de color: *${fileAnalysis.colorSpace}*\n`;
    }
   
    if (fileAnalysis.fileSize) {
      response += `📦 Tamaño del archivo: *${fileAnalysis.fileSize}*\n`;
    }
 
    logger.info(`Análisis de archivo completado para usuario ${userId}: ${JSON.stringify(fileAnalysis)}`);
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

    // Información detallada sobre la importancia del DPI según el área y la distancia de visualización
    // Información detallada sobre la importancia del DPI según el área y la distancia de visualización
    const dpiGuidelines = `
    📏 **Resolución (DPI) según el Área y Distancia de Visualización** 📐

    Ten en cuenta lo siguiente sobre la resolución (DPI) en función del área del servicio *${currentOrder.areaServicio} m²* y la distancia de visualización, aplicando a productos específicos de *Chileimprime*:

    - **Áreas pequeñas (menos de 1.0 m²)** 🖼️:
      - Se recomienda una resolución de *150-300 DPI* para obtener alta calidad.
      - Ideal para productos como *Tarjetas de presentación (1000 unidades)*, *Flyers 15×22 cms*, y *Mini Roller de escritorio papel sintético*, los cuales se observan de cerca (distancia menor a *1.5 metros*).

    - **Áreas medianas (1.5 m² a 5 m²)** 📊:
      - La resolución puede oscilar entre *72 y 150 DPI*.
      - Adecuada para *Pendones Roller 90x200 cms*, *Palomas 2 caras 70x120 cms*, y *PVC 11 Oz mt²*, que se visualizan desde distancias intermedias (*1.5 a 3 metros*).

    - **Áreas grandes (5 m² a 10 m²)** 📢:
      - Se recomienda una resolución entre *35 y 72 DPI*.
      - Ideal para *Back Light Banner*, *Tela Mesh* y *PVC Blackout*, que se verán a distancias de *3 a 5 metros*.

    - **Áreas muy grandes (más de 10 m²)** 🏢:
      - Resoluciones bajas, entre *20 y 35 DPI*, son aceptables debido a que estos gráficos se ven desde distancias mayores a *5 metros*.
      - Ejemplos: *Murales publicitarios*, *Back Light Textil*, o *Windows One Vision* que serán observados a grandes distancias.

    ### 📌 Notas Adicionales:
    1. **Distancia de Visualización** 👀: Es un factor crítico para determinar el DPI correcto. A mayor distancia, menor es la necesidad de alta resolución, ya que el ojo humano no distingue los detalles finos.
    2. **Tamaño del Archivo** 💾: Usar resoluciones demasiado altas en áreas grandes como *PVC Alta Definición* para grandes formatos incrementa significativamente el tamaño del archivo y el tiempo de impresión sin una mejora perceptible en la calidad visual.
    3. **Material Específico** 🧱: Productos como *Adhesivo Empavonado*, *Vinilo Adhesivo Reflectante* y *Rotulación para fundido* requieren considerar el material y su capacidad de impresión, por lo que es recomendable mantener el DPI en el rango medio de *72-150 DPI* para garantizar una buena nitidez.

    ✨ **Emojis y Formateo**:
    - Utiliza emojis relevantes para resaltar puntos importantes.
    - Aplica **formateo con asteriscos** usando un asterisco por lado (*texto*) para resaltar palabras clave.
    - Asegúrate de mantener una estructura clara con saltos de línea para facilitar la lectura en WhatsApp.

    Estas guías te ayudarán a optimizar la calidad y la eficiencia en cada proyecto de impresión según el tipo de producto y su aplicación en el mercado chileno.
    `;

    // Generar la instrucción para la IA con mayor contexto y flexibilidad
    const instruction = `🔄 **Nueva Solicitud de Archivo** 📂

    El usuario acaba de subir un archivo. Ahora eres un **experto en impresión de gran formato** e **ingeniero en color**. Verifica el *currentOrder* y responde según las siguientes condiciones:

    1. 📐 **Análisis del Archivo**:
      - Analiza el archivo proporcionado considerando una tolerancia del *70%* en cuanto a las medidas y el área del diseño comparado con el servicio solicitado.
      
    2. 📊 **Directrices de DPI**:
      - Ten en cuenta las siguientes directrices para el DPI:
      <dpiGuidelines>${dpiGuidelines}</dpiGuidelines>
      
    3. 🛠️ **Casos Especiales**:
      - Considera que en casos especiales, como areas muy grandes que superan las limitaciones técnicas, como areas que superen los 5m2, es aceptable reducir la exigencia de DPI hasta 30 o menos para adaptar el diseño a las dimensiones fisicas,
      tu eres el experto que decide el DPI correcto que debe tener el diseño en funcion al las guias de <dpiGuidelines>. Y ten cuidado de que para areas muy grandes de impresion, debes pedir que los archivos tambien tengan alta resolucion,
      verifica la resolucion del archivo enviado por el cliente y en caso de que no cumpla con su area de impresion pero si con los DPI darle los pasos para corregir su archivo.
      
    4. 🧐 **Evaluación de Adecuación**:
      - Aplica tu expertise en impresión para evaluar si el archivo es adecuado, incluso si no cumple exactamente con los criterios, pero está dentro de la tolerancia del *80%*.
      
    5. ✅ **Validación del Archivo**:
      - Si el archivo es válido o puede ser aceptado con modificaciones menores, indica que es válido.
      
    6. ❌ **Invalidez del Archivo**:
      - Si el archivo no es válido, proporciona una explicación detallada y consejos específicos para que el cliente pueda corregirlo.

    📋 **Información para la Validación**:
    - **Servicio seleccionado**: *${currentOrder.service}*
    - **Área del servicio solicitado**: *${currentOrder.areaServicio ? currentOrder.areaServicio.toFixed(2) : 'No disponible'} m²*
    - **Área del diseño proporcionado**: *${currentOrder.fileAnalysis ? currentOrder.fileAnalysis.area.toFixed(2) : 'No disponible'} m²*
    - **Resolución del diseño**: *${currentOrder.fileAnalysis ? currentOrder.fileAnalysis.dpi : 'No disponible'} dpi*
    - **Formato del diseño**: *${currentOrder.fileAnalysis ? currentOrder.fileAnalysis.format : 'No disponible'}*
    - **Espacio de color del diseño**: *${currentOrder.fileAnalysis ? currentOrder.fileAnalysis.colorSpace : 'No disponible'}*

    📑 **Criterios de Validación**:
    ${userContextManager.getFileValidationCriteria()}

    ⚠️ **IMPORTANTE**:
    - Al inicio de tu respuesta, incluye un comando JSON indicando el resultado del análisis, en el siguiente formato:
      {"command": "RESULT_ANALYSIS", "result": true/false}
    - Luego, proporciona la respuesta al usuario siguiendo un formato fijo de 3 secciones, separadas por encabezados "### ":
      1. ### 🔍 Criterios de Validación Aplicados:
        - Explica brevemente los criterios que aplicaste en este caso específico.
      2. ### ✅ Resultado de la Validación:
        - Indica si el archivo es válido o no, y proporciona detalles, sobretodo si el resultado es negativo,
          explica y brinda detalladamente lo que debe hacer el cliente para que su archivo sea valido para su impresion en funcion al area de impresion.
      3. ### 👉 Siguiente Paso:
        - Indica al usuario cuál es el siguiente paso en el proceso.

    - Asegúrate de que tu respuesta siga este formato exactamente, para que pueda ser dividida en mensajes separados.
    - **Incluye emojis y utiliza asteriscos para el formateo** en toda tu respuesta para mejorar la interacción en WhatsApp.

    Responde al usuario siguiendo estas indicaciones.
    `;


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
        const sanitizedCmd = sanitizeJsonString(cmd);
        logger.debug(`Comando sanitizado: ${sanitizedCmd}`);
        const parsedCmd = JSON.parse(sanitizedCmd);
        logger.info(`Comando parseado correctamente: ${JSON.stringify(parsedCmd)}`);
        return parsedCmd;
      } catch (error) {
        logger.error(`Error al parsear comando JSON: ${error.message}`);
        logger.debug(`Comando problemático: ${cmd}`);
        return null;
      }
    }).filter(cmd => cmd !== null);
  }
  

  async handleListAllServices(userId, actions) {
    const services = sheetService.getServices();
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
      logger.info(`Iniciando proceso de confirmación de orden para usuario ${userId}`);
      const currentOrder = userContextManager.getCurrentOrder(userId);
      
      if (!userContextManager.isOrderComplete(userId)) {
        const missingFields = userContextManager.getIncompleteFields(userId);
        const errorMessage = `La orden no está completa. Faltan los siguientes campos: ${missingFields.join(', ')}`;
        logger.warn(errorMessage);
        throw new CustomError('IncompleteOrderError', errorMessage);
      }

      // Añadir información del contexto
      currentOrder.userName = ctx.pushName || 'Cliente';
      currentOrder.userPhone = ctx.from;

      const result = await orderManager.finalizeOrder(userId, currentOrder);
      
      if (result.success) {
        logger.info(`Pedido confirmado para usuario ${userId}. Número de pedido: ${result.orderNumber}`);
        await flowDynamic(`¡Gracias por tu pedido! Tu número de cotización es: ${result.orderNumber}`);
        await flowDynamic(result.message);
        return { currentOrderUpdated: true, nextFlow: 'promoFlow' };
      } else {
        throw new Error("Error al confirmar el pedido");
      }
    } catch (error) {
      logger.error(`Error al confirmar el pedido para usuario ${userId}: ${error.message}`);
      if (error.name === 'IncompleteOrderError') {
        const systemMessage = `Campos faltantes: ${error.message}`;
        userContextManager.updateContext(userId, systemMessage, "system");
        await flowDynamic("Lo siento, pero parece que falta información en tu pedido. Por favor, completa todos los detalles antes de confirmar.");
        return { currentOrderUpdated: false, error: error.message };
      } else {
        await flowDynamic("Lo siento, ha ocurrido un error al procesar tu pedido. Por favor, intenta nuevamente o contacta con nuestro equipo de soporte.");
        return { currentOrderUpdated: false, error: error.message };
      }
    }
  }


  
}

export default new CommandProcessor();
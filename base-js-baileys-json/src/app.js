// app.js - Bot de imprenta

import "dotenv/config";
import { createBot, createProvider, createFlow, addKeyword, EVENTS } from '@builderbot/bot';
import { MemoryDB } from '@builderbot/bot';
import { BaileysProvider } from '@builderbot/provider-baileys';
import GoogleSheetService from './sheetService.js';
import FileAnalyzer from './fileAnalyzer.js';
import OpenAIService from './openaiService.js';
import PrintingCalculator from './printingCalculator.js';
import Logger from './logger.js';
import moment from 'moment-timezone';
import path from 'path';
import fs from 'fs/promises';

const PORT = process.env.PORT ?? 3000;
const sheetService = new GoogleSheetService(process.env.GOOGLE_SHEET_ID);
const openaiService = new OpenAIService(process.env.OPENAI_API_KEY);
const printingCalculator = new PrintingCalculator();
const fileAnalyzer = new FileAnalyzer();
const logger = new Logger();

function createMessageQueue(config) {
  const queue = new Map();
  
  return function enqueueMessage(userId, messageText, callback) {
    logger.info(`Encolando mensaje para usuario ${userId}. Longitud actual de la cola: ${queue.size}`);
    
    if (!queue.has(userId)) {
      queue.set(userId, { messages: [], timer: null });
      logger.info(`Nueva cola creada para usuario ${userId}`);
    }

    const userQueue = queue.get(userId);
    userQueue.messages.push(messageText);

    logger.info(`Mensaje añadido a la cola del usuario ${userId}. Mensajes en cola: ${userQueue.messages.length}`);

    clearTimeout(userQueue.timer);

    userQueue.timer = setTimeout(() => {
      logger.info(`Temporizador expirado para usuario ${userId}. Procesando cola...`);
      const messages = userQueue.messages;
      queue.delete(userId);
      logger.info(`Cola eliminada para usuario ${userId}`);
      if (typeof callback === 'function') {
        try {
          callback(messages.join(" "));
        } catch (error) {
          logger.error(`Error en el callback para usuario ${userId}: ${error.message}`);
        }
      }
    }, config.gapSeconds);
  };
}

const queueConfig = { gapSeconds: 3000 };
const enqueueMessage = createMessageQueue(queueConfig);

const TMP_DIR = path.join(process.cwd(), 'tmp');

try {
  await fs.access(TMP_DIR);
} catch {
  await fs.mkdir(TMP_DIR, { recursive: true });
}

const BLACKLIST_DURATION = 10 * 60 * 1000;
const IDLE_WARNING_TIME = 5 * 60 * 1000;
const IDLE_TIMEOUT_TIME = 10 * 60 * 1000;
const MAX_SERVICES_PER_CONVERSATION = 5;
const MAX_FILE_UPLOAD_ATTEMPTS = 3;  

class PrintingBot {
  constructor() {
    this.userContexts = new Map();
    this.services = {};
    this.blacklist = new Map();
    this.orderConfirmed = new Set();
    this.idleTimers = new Map();
    this.additionalInfo = null;
    this.initialize().catch(error => {
      logger.error(`Error en la inicialización inicial: ${error.message}`);
    });
    this.fileUploadAttempts = new Map();
    this.MAX_FILE_UPLOAD_ATTEMPTS = 3;
  }

  async initialize() {
    try {
      this.services = await sheetService.getServices();
      this.additionalInfo = await sheetService.getAdditionalInfo();
      logger.info("Servicios e información adicional inicializados correctamente");
    } catch (error) {
      logger.error(`Error al inicializar: ${error.message}`);
      this.services = this.services || {};
      this.additionalInfo = this.additionalInfo || {};
    }
  }

  async handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, message) {
    const userId = ctx.from;
    logger.info(`Encolando mensaje para usuario ${userId}`);

    enqueueMessage(userId, message, async (accumulatedMessage) => {

      logger.info(`Procesando mensajes acumulados para usuario ${userId}: ${accumulatedMessage}`);

      if (!this.services || Object.keys(this.services).length === 0 || !this.additionalInfo) {
        logger.info(`Reinicializando servicios e información adicional para usuario ${userId}`);
        await this.initialize();
      }

      if (this.isBlacklisted(userId)) {
        logger.info(`Usuario ${userId} en lista negra. Mensaje ignorado.`);
        return endFlow();
      }

      if (this.isOrderConfirmed(userId)) {
        logger.info(`Pedido ya confirmado para ${userId}. Redirigiendo a atención humana.`);
        return gotoFlow(flowConfirmed);
      }

      this.startIdleTimer(ctx, flowDynamic, gotoFlow);

      try {
        const aiResponse = await this.getAIResponse(userId, accumulatedMessage);
        logger.info(`Respuesta AI para ${userId}: ${aiResponse}`);
        const { action, response } = await this.updateOrder(userId, aiResponse);

        switch (action) {
          case "CONFIRMAR_PEDIDO":
            const { confirmationMessage, orderSummary, endConversation } = await this.finalizeOrder(ctx);
            await flowDynamic(orderSummary);
            await flowDynamic(confirmationMessage);
            logger.info(`Pedido confirmado para ${userId}. Finalizando flujo.`);
            
            this.addToBlacklist(userId, BLACKLIST_DURATION);
            this.clearIdleTimer(userId);
            
            if (endConversation) {
              return endFlow();
            }
            break;
          case "SOLICITUD_HUMANO":
            this.addToBlacklist(userId, BLACKLIST_DURATION);
            this.resetConversation(userId);
            this.clearIdleTimer(userId); // Agregamos esta línea
            await flowDynamic("*Entendido* 👍. Un representante humano se pondrá en contacto contigo pronto. *Gracias por tu paciencia.* 🙏");
            logger.info(`Solicitud de humano para ${userId}. Añadido a la lista negra por ${BLACKLIST_DURATION/1000} segundos.`);
            logger.info(`Temporizador de inactividad detenido para ${userId} debido a solicitud de atención humana.`);
            return endFlow();
          default:
            await flowDynamic(response);
        }
      } catch (error) {
        logger.error(`Error al procesar respuesta para usuario ${userId}: ${error.message}`);
        await flowDynamic("Lo siento, ha ocurrido un error inesperado. Por favor, intenta nuevamente en unos momentos.");
      }
    });
  }

  getUserContext(userId) {
    if (!this.userContexts.has(userId)) {
      this.userContexts.set(userId, {
        context: "",
        currentOrder: { services: [] },
      });
    }
    return this.userContexts.get(userId);
  }

  updateContext(userId, message, role) {
    const userContext = this.getUserContext(userId);
    userContext.context += `${role}: ${message}\n`;
    this.limitContextSize(userId);
    logger.info(`Contexto actualizado para usuario ${userId}. Palabras: ${userContext.context.split(/\s+/).length}`);
  }

  limitContextSize(userId) {
    const userContext = this.getUserContext(userId);
    const words = userContext.context.split(/\s+/);
    if (words.length > 1500) {
      userContext.context = words.slice(-1500).join(" ");
      logger.info(`Contexto limitado a 1500 palabras para usuario ${userId}`);
    }
  }

  getSystemPrompt(userId) {
    const userContext = this.getUserContext(userId);

    return `Eres un empleado amigable y eficiente de una imprenta. Tu objetivo es ayudar a los clientes a cotizar servicios y gestionar pedidos. Sigue estas instrucciones: 

    1. Saluda solo una vez al inicio de la conversación.
    2. Mantén un tono amigable y profesional. Usa emojis ocasionalmente.
    3. Guía al cliente a través del proceso de cotización paso a paso.
    4. Solicita los detalles necesarios según la categoría del producto o servicio.
    5. Verifica la disponibilidad de terminaciones y calcula los precios según las fórmulas dadas.
    6. Resume los detalles del servicio cotizado después de cada interacción.
    7. Permite al cliente cotizar hasta ${MAX_SERVICES_PER_CONVERSATION} servicios por conversación.
    8. Asocia cada servicio con un archivo de diseño provisto por el cliente.
    9. Analiza los archivos para verificar compatibilidad de tamaño, resolución y formato.
    10. Si el archivo no es válido, permite hasta ${MAX_FILE_UPLOAD_ATTEMPTS} intentos para que el cliente suba un nuevo archivo.
    11. Antes de confirmar el pedido, pregunta si el cliente desea agregar alguna observación.
    12. Para confirmar el pedido, usa "CONFIRMAR_PEDIDO" seguido del resumen final.
    13. Usa "SOLICITUD_HUMANO" si el cliente explícitamente pide hablar con un humano.
    14. Nunca te identifiques como un bot o asistente virtual. Actúa como un empleado humano.
    15. Formatea todos tus mensajes para una lectura fácil y agradable.

    Información adicional:
    ${JSON.stringify(this.additionalInfo, null, 2)}

    Servicios disponibles:
    ${JSON.stringify(this.services, null, 2)}
  
    Pedido actual:
    ${JSON.stringify(userContext.currentOrder, null, 2)}
    
    Recuerda: sé eficiente, evita repeticiones innecesarias y siempre busca oportunidades para mejorar la experiencia del cliente.`;
  }

  async getAIResponse(userId, userMessage) {
    try {
      this.updateContext(userId, userMessage, "Usuario");
      const userContext = this.getUserContext(userId);
      const response = await openaiService.getChatCompletion(
        this.getSystemPrompt(userId),
        userContext.context
      );
      logger.info(`Respuesta completa de OpenAI para usuario ${userId}: ${response}`);
      
      if (response && typeof response === 'string') {
        this.updateContext(userId, response, "Asistente");
        return response;
      } else {
        throw new Error(`Respuesta de AI inesperada para usuario ${userId}. Respuesta completa: ${JSON.stringify(response)}`);
      }
    } catch (error) {
      logger.error(`Error al obtener respuesta de AI para usuario ${userId}: ${error.message}`);
      return "Lo siento, estoy teniendo problemas para procesar tu solicitud. ¿Podrías intentarlo de nuevo?";
    }
  }

  async updateOrder(userId, aiResponse) {
    logger.info(`Actualizando pedido para usuario ${userId}. Respuesta AI: ${aiResponse}`);
    try {
      const extractedOrder = await openaiService.extractOrder(this.services, aiResponse);
      logger.info(`Pedido extraído en JSON para usuario ${userId}: ${JSON.stringify(extractedOrder)}`);
  
      const userContext = this.getUserContext(userId);
      if (!userContext.currentOrder) {
        userContext.currentOrder = { services: [] };
      }
  
      if (extractedOrder.items && extractedOrder.items.length > 0) {
        extractedOrder.items.forEach(item => {
          const newService = {
            categoria: item.categoria,
            nombre: item.nombre,
            cantidad: item.cantidad,
            medidas: item.medidas,
            terminaciones: item.terminaciones,
            precio: item.precio,
            dpi: item.dpi, // Agregar DPI del item extraído
            formato: item.formatos.join(', '), // Agregar formatos aceptados del item extraído
            archivo: null,
            archivoValido: false
          };
          userContext.currentOrder.services.push(newService);
        });
  
        if (userContext.currentOrder.services.length > MAX_SERVICES_PER_CONVERSATION) {
          return { action: "LIMITE_SERVICIOS", response: "Has alcanzado el límite de servicios por conversación. Por favor, confirma tu pedido o espera 10 minutos para cotizar servicios adicionales." };
        }
      }
  
      // Actualizar las observaciones del pedido
      userContext.currentOrder.observaciones = extractedOrder.observaciones;
  
      if (aiResponse.includes("CONFIRMAR_PEDIDO")) {
        if (this.allServicesHaveValidFiles(userContext.currentOrder.services)) {
          logger.info(`Pedido confirmado para usuario ${userId}`);
          return { action: "CONFIRMAR_PEDIDO" };
        } else {
          return { action: "ARCHIVOS_FALTANTES", response: "No se puede confirmar el pedido. Algunos servicios no tienen archivos de diseño válidos asociados. Por favor, sube los archivos faltantes." };
        }
      } else if (aiResponse.includes("SOLICITUD_HUMANO")) {
        logger.info(`Solicitud de atención humana detectada para usuario ${userId}`);
        return { action: "SOLICITUD_HUMANO" };
      }
      return { action: "CONTINUAR", response: aiResponse };
    } catch (error) {
      logger.error(`Error al actualizar el pedido para usuario ${userId}: ${error.message}`);
      return { action: "CONTINUAR", response: "Lo siento, ha ocurrido un error al procesar tu pedido. ¿Podrías intentarlo de nuevo?" };
    }
  }

  allServicesHaveValidFiles(services) {
    return services.every(service => service.archivo && service.archivoValido);
  }

  async validateFile(fileUrl, service) {
    try {
      const analysis = await fileAnalyzer.analyzeFile(fileUrl, {
        medidas: service.medidas,
        dpi: service.dpi,
        formato: service.formato || 'PDF, JPG' // Valor por defecto si no está especificado
      });
      logger.info(`Análisis de archivo para servicio ${service.nombre}: ${JSON.stringify(analysis)}`);
      
      return analysis.esAptaParaImpresion;
    } catch (error) {
      logger.error(`Error al validar archivo para servicio ${service.nombre}: ${error.message}`);
      return false;
    }
  }

  resetFileUploadAttempts(userId) {
    this.fileUploadAttempts.set(userId, 0);
  }

  incrementFileUploadAttempts(userId) {
    const attempts = this.fileUploadAttempts.get(userId) || 0;
    this.fileUploadAttempts.set(userId, attempts + 1);
    return attempts + 1;
  }

  getFileUploadAttempts(userId) {
    return this.fileUploadAttempts.get(userId) || 0;
  }


  async finalizeOrder(ctx) {
    const userId = ctx.from;
    const userContext = this.getUserContext(userId);
    logger.info(`Finalizando pedido para usuario ${userId}`);
  
    const calculatedOrder = printingCalculator.calculateOrder(userContext.currentOrder);
    logger.info(`Pedido calculado para usuario ${userId}: ${JSON.stringify(calculatedOrder)}`);
    const formattedOrder = this.formatOrderForSheet(calculatedOrder);
    logger.info(`Pedido formateado para hoja de cálculo, usuario ${userId}: ${JSON.stringify(formattedOrder)}`);

    const finalOrder = {
      fecha: moment().tz('America/Santiago').format('DD-MM-YYYY HH:mm[hrs] - dddd'),
      telefono: userId,
      nombre: ctx.pushName || 'Cliente',
      email: '', // Get email from user if needed
      detalles: formattedOrder.details,
      archivos: formattedOrder.files,
      observaciones: userContext.currentOrder.observaciones || 'Sin observaciones',
      total: formattedOrder.total
    };

    logger.info(`Pedido final para usuario ${userId}: ${JSON.stringify(finalOrder)}`);

    try {
      const result = await sheetService.saveOrder(finalOrder);
      logger.info(`Resultado de guardado para usuario ${userId}: ${JSON.stringify(result)}`);

      if (result.success) {
        this.orderConfirmed.add(userId);
        logger.info(`Pedido finalizado y guardado correctamente para usuario ${userId}`);
        
        const confirmationMessage = "*¡Gracias!* 🎉 Tu pedido ha sido registrado y comenzaremos a procesarlo pronto. Un representante se pondrá en contacto contigo para confirmar los detalles y coordinar el pago. 📞";
        
        return { 
          confirmationMessage, 
          orderSummary: printingCalculator.formatOrderSummary(calculatedOrder),
          endConversation: true
        };
      } else {
        throw new Error("Error al guardar el pedido");
      }
    } catch (error) {
      logger.error(`Error detallado al finalizar el pedido para usuario ${userId}:`, error);
      logger.error(`Stack trace:`, error.stack);
      return { 
        confirmationMessage: "*Lo siento* 😓, ha ocurrido un error al procesar tu pedido. Por favor, intenta nuevamente o contacta con nuestro equipo de soporte.",
        orderSummary: null,
        endConversation: false
      };
    }
  }

  formatOrderForSheet(order) {
    let details = '';
    let files = [];
    let total = 0;
    
    order.services.forEach(service => {
      details += `${service.categoria} - ${service.tipo} - ${service.nombre}\n`;
      details += `Cantidad: ${service.cantidad} - Precio unitario: $${this.formatPrice(service.precioUnitario)}\n`;
      if (service.ancho && service.alto) {
        details += `Medidas: ${service.ancho}x${service.alto} cm\n`;
      }
      const subtotal = service.cantidad * service.precioUnitario;
      details += `Subtotal: $${this.formatPrice(subtotal)}\n\n`;

      files.push(service.archivo);

      total += subtotal;
    });
    
    return {
      details: details.trim(),
      files: files.join(', '),
      total: `$${this.formatPrice(total)}`
    };
  }

  formatPrice(price) {
    return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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

  isOrderConfirmed(userId) {
    return this.orderConfirmed.has(userId);
  }

  resetConversation(userId) {
    this.userContexts.delete(userId);
    this.orderConfirmed.delete(userId);
    this.blacklist.delete(userId);
    this.clearIdleTimer(userId);
    logger.info(`Conversación reiniciada para usuario ${userId}`);
  }

  startIdleTimer(ctx, flowDynamic, gotoFlow) {
    this.clearIdleTimer(ctx.from);
    
    const warningTimer = setTimeout(async () => {
      await flowDynamic('*⏰ ¿Sigues ahí? Si necesitas más tiempo, por favor responde cualquier mensaje.*');
    }, IDLE_WARNING_TIME);

    const timeoutTimer = setTimeout(() => {
      this.resetConversation(ctx.from);
      gotoFlow(idleTimeoutFlow);
    }, IDLE_TIMEOUT_TIME);

    this.idleTimers.set(ctx.from, { warningTimer, timeoutTimer });
  }

  clearIdleTimer(userId) {
    const timers = this.idleTimers.get(userId);
    if (timers) {
      clearTimeout(timers.warningTimer);
      clearTimeout(timers.timeoutTimer);
      this.idleTimers.delete(userId);
    }
  }

}

const printingBot = new PrintingBot();

const blacklistMiddleware = async (ctx, { endFlow, flowName }) => {
  if (printingBot.isBlacklisted(ctx.from) && flowName !== 'flowRestartBot') {
    logger.info(`Usuario ${ctx.from} en lista negra. Mensaje ignorado.`);
    return endFlow();
  }
  return false;
};

const flowPrincipal = addKeyword(EVENTS.WELCOME)
  .addAction(async (ctx, { flowDynamic, gotoFlow, endFlow }) => {
    const userId = ctx.from;

    if (!printingBot.services || Object.keys(printingBot.services).length === 0) {
      await printingBot.initialize();
    }

    await printingBot.handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, ctx.body);
  });

const flowConfirmed = addKeyword(EVENTS.ACTION)
  .addAction(blacklistMiddleware)
  .addAction(async (ctx, { flowDynamic, endFlow }) => {
    await flowDynamic("SOLICITUD_HUMANO");
    printingBot.addToBlacklist(ctx.from, BLACKLIST_DURATION);
    logger.info(`Pedido ya confirmado para ${ctx.from}. Redirigiendo a atención humana.`);
    return endFlow("Un representante humano se pondrá en contacto contigo pronto. Gracias por tu paciencia.");
  });

const flowRestartBot = addKeyword(['bot', 'Bot', 'BOT'])
  .addAction(async (ctx, { flowDynamic, gotoFlow }) => {
    const userId = ctx.from;
    logger.info(`Intento de reinicio de bot por usuario ${userId}`);
    printingBot.resetConversation(userId);
    logger.info(`Bot reiniciado para usuario ${userId}`);
    await flowDynamic('*¡Bienvenido de nuevo!* 🎉 El bot ha sido reiniciado. *¿En qué puedo ayudarte hoy?* 😊');
    return gotoFlow(flowPrincipal);
  });

flowRestartBot.name = 'flowRestartBot';

const flowCatchAll = addKeyword(EVENTS.ACTION)
  .addAction(blacklistMiddleware)
  .addAction(async (ctx, { gotoFlow }) => {
    if (printingBot.isOrderConfirmed(ctx.from)) {
      return gotoFlow(flowConfirmed);
    } else {
      return gotoFlow(flowPrincipal);
    }
  });

const idleTimeoutFlow = addKeyword(EVENTS.ACTION)
  .addAction(async (ctx, { endFlow }) => {
    logger.info(`Tiempo de espera agotado para usuario ${ctx.from}`);
    printingBot.resetConversation(ctx.from);
    printingBot.clearIdleTimer(ctx.from);
    return endFlow('*😴 Lo siento, el tiempo de espera ha expirado. Tu pedido ha sido cancelado. Si deseas hacer un nuevo pedido, por favor envía un mensaje.*');
  });

  const documentFlow = addKeyword(EVENTS.DOCUMENT)
  .addAction(async (ctx, { flowDynamic, provider, gotoFlow }) => {
    logger.info(`Documento recibido de ${ctx.from}`);

    const userId = ctx.from;
    const userContext = printingBot.getUserContext(userId);

    if (!userContext.currentOrder || !userContext.currentOrder.services || userContext.currentOrder.services.length === 0) {
      await flowDynamic("Lo siento, no hay servicios activos para asociar este archivo. Por favor, primero solicita un servicio.");
      return;
    }

    // Encontrar el primer servicio sin archivo válido
    const serviceIndex = userContext.currentOrder.services.findIndex(service => !service.archivoValido);
    if (serviceIndex === -1) {
      await flowDynamic("Todos los servicios ya tienen archivos asociados. Si deseas modificar alguno, por favor especifica cuál.");
      return;
    }

    const currentService = userContext.currentOrder.services[serviceIndex];

    try {
      const localPath = await provider.saveFile(ctx, {path: TMP_DIR});
      logger.info(`Documento guardado en ${localPath}`);

      const fileAnalysis = await fileAnalyzer.analyzeFile(localPath, currentService);
      logger.info(`Análisis de archivo: ${JSON.stringify(fileAnalysis)}`);

      if (fileAnalysis.esAptaParaImpresion) {
        currentService.archivo = localPath;
        currentService.archivoValido = true;
        printingBot.resetFileUploadAttempts(userId);
        logger.info(`Archivo válido asociado al servicio para usuario ${userId}`);
        await flowDynamic(`*¡Archivo recibido y validado!* 👍 Archivo asociado al servicio: ${currentService.nombre}. Continúa con tu pedido o envía "confirmar" para finalizar.`);
      } else {
        const attempts = printingBot.incrementFileUploadAttempts(userId);
        if (attempts >= printingBot.MAX_FILE_UPLOAD_ATTEMPTS) {
          logger.warn(`Usuario ${userId} alcanzó el máximo de intentos de carga de archivo`);
          await flowDynamic("*Lo siento*, has alcanzado el número máximo de intentos para subir un archivo válido. 😓 Por favor, contacta a un representante para asistencia.");
          return gotoFlow(flowConfirmed);
        } else {
          logger.warn(`Archivo inválido para usuario ${userId}. Intento ${attempts}`);
          
          let errorMessage = `*El archivo no cumple con los requisitos necesarios para el servicio ${currentService.nombre}.* 😕\n\n`;
          errorMessage += `Detalles del archivo:\n`;
          errorMessage += `- Tipo: ${fileAnalysis.tipo}\n`;
          errorMessage += `- Formato: ${fileAnalysis.formato}\n`;
          errorMessage += `- Dimensiones: ${fileAnalysis.ancho}x${fileAnalysis.alto} píxeles\n`;
          errorMessage += `- DPI: ${fileAnalysis.dpi}\n`;
          errorMessage += `- Tamaño: ${fileAnalysis.tamaño}\n\n`;
          
          errorMessage += `Para que el archivo sea válido, necesitas:\n`;
          errorMessage += `- DPI mínimo requerido: ${fileAnalysis.dpiRequerido}\n`;
          
          if (fileAnalysis.dpi < fileAnalysis.dpiRequerido) {
            errorMessage += `- Aumentar la resolución (DPI) de tu archivo\n`;
          }
          
          if (!fileAnalysis.esAptaParaImpresion && !fileAnalysis.formato.toUpperCase().includes(currentService.formato.toUpperCase())) {
            errorMessage += `- Usar un formato de archivo válido (${currentService.formato})\n`;
          }
          
          errorMessage += `\nPor favor, ajusta tu archivo según estas recomendaciones y vuelve a intentarlo. Intento ${attempts} de ${printingBot.MAX_FILE_UPLOAD_ATTEMPTS}`;
          
          await flowDynamic(errorMessage);
        }
      }
    } catch (error) {
      logger.error(`Error al procesar documento para usuario ${userId}: ${error.message}`);
      await flowDynamic("*Lo siento*, ocurrió un error al procesar el archivo. 😓 Por favor, intenta nuevamente o contacta a un representante para asistencia.");
    }
  });

const voiceNoteFlow = addKeyword(EVENTS.VOICE_NOTE)
  .addAction(async (ctx, { flowDynamic, provider }) => {
    logger.info(`Nota de voz recibida de ${ctx.from}`);
    await flowDynamic("*Lo siento*, actualmente no puedo procesar notas de voz. 🙊 Por favor, escribe tu mensaje o adjunta una imagen.");
  });
  
const main = async () => {
  const adapterDB = new MemoryDB();
  const adapterFlow = createFlow([
    flowPrincipal,
    flowConfirmed,
    flowRestartBot,
    documentFlow,
    voiceNoteFlow,
    flowCatchAll,
    idleTimeoutFlow,
  ]);
  const adapterProvider = createProvider(BaileysProvider, {
    groupsIgnore: true,
  });

  const { httpServer } = await createBot({
    flow: adapterFlow,
    provider: adapterProvider,
    database: adapterDB,
  }, {
    queue: {
      timeout: 60000,
      concurrencyLimit: 100
    }
  });

  httpServer(PORT);
  logger.info(`Bot iniciado en el puerto ${PORT}`);
};

main().catch(err => logger.error('Error in main:', err));
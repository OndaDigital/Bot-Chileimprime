import "dotenv/config";
import { createBot, createProvider, createFlow, addKeyword, EVENTS } from '@builderbot/bot';
import { JsonFileDB } from '@builderbot/database-json';
import { BaileysProvider } from '@builderbot/provider-baileys';
import SheetService from './sheetService.js';
import OpenAIService from './openaiService.js';
import PrintingCalculator from './printingCalculator.js';
import FileAnalyzer from './fileAnalyzer.js';
import Logger from './logger.js';
import QueueManager from './queueManager.js';
import BlacklistManager from './blacklistManager.js';
import path from 'path';
import fs from 'fs/promises';

const logger = new Logger();
const PORT = process.env.PORT ?? 3000;
const sheetService = new SheetService(process.env.GOOGLE_SHEET_ID);
const openaiService = new OpenAIService(process.env.OPENAI_API_KEY);
const printingCalculator = new PrintingCalculator();
const fileAnalyzer = new FileAnalyzer();
const queueManager = new QueueManager();
const blacklistManager = new BlacklistManager();

const TMP_DIR = path.join(process.cwd(), 'tmp');

try {
  await fs.access(TMP_DIR);
} catch {
  await fs.mkdir(TMP_DIR, { recursive: true });
}

const BLACKLIST_DURATION = 10 * 60 * 1000; // 10 minutos
const HUMAN_BLACKLIST_DURATION = 60 * 60 * 1000; // 1 hora
const ABUSE_BLACKLIST_DURATION = 24 * 60 * 60 * 1000; // 24 horas
const IDLE_WARNING_TIME = 5 * 60 * 1000; // 5 minutos
const IDLE_TIMEOUT_TIME = 10 * 60 * 1000; // 10 minutos
const MAX_SERVICES_PER_CONVERSATION = 5;
const SERVICE_COOLDOWN_TIME = 10 * 60 * 1000; // 10 minutos
const MAX_RETRIES = 3;


class ImprovedPrintingBot {
  constructor() {
    this.userContexts = new Map();
    this.services = {};
    this.additionalInfo = null;
    this.idleTimers = new Map();
    this.initialize().catch(error => {
      logger.error(`Error en la inicialización inicial: ${error.message}`);
    });
  }

  async initialize() {
    try {
      this.services = await sheetService.getServices();
      this.additionalInfo = await sheetService.getAdditionalInfo();
      logger.info("Servicios e información adicional inicializados correctamente");
      logger.debug(`Servicios: ${JSON.stringify(this.services)}`);
      logger.debug(`Info adicional: ${JSON.stringify(this.additionalInfo)}`);
    } catch (error) {
      logger.error(`Error al inicializar: ${error.message}`);
      this.services = {};
      this.additionalInfo = {};
    }
  }

  getUserContext(userId) {
    if (!this.userContexts.has(userId)) {
      this.userContexts.set(userId, {
        context: "",
        currentOrder: { items: [] },
        currentService: null,
        serviceCount: 0,
        lastServiceTime: 0,
        awaitingFile: false
      });
    }
    return this.userContexts.get(userId);
  }

  setCurrentService(userId, serviceName) {
    const userContext = this.getUserContext(userId);
    userContext.currentService = serviceName;
    userContext.awaitingFile = true;
    userContext.fileUploadRetries = 0;  // Reiniciar el contador de intentos
    logger.info(`Servicio actual establecido para ${userId}: ${serviceName}`);
  }

  cancelCurrentService(userId) {
    const userContext = this.getUserContext(userId);
    userContext.currentService = null;
    userContext.awaitingFile = false;
    if (userContext.currentOrder.items.length > 0) {
      userContext.currentOrder.items.pop();
    }
  }

  async handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, message, isVoiceNote = false) {
    const userId = ctx.from;
    logger.info(`Procesando mensaje para usuario ${userId}. Tipo: ${isVoiceNote ? 'Audio' : 'Texto'}`);

    if (blacklistManager.isBlacklisted(userId)) {
      logger.info(`Usuario ${userId} en lista negra. Mensaje ignorado.`);
      return endFlow();
    }

    const userContext = this.getUserContext(userId);
    if (userContext.serviceCount >= MAX_SERVICES_PER_CONVERSATION) {
      logger.info(`Usuario ${userId} ha alcanzado el límite de servicios por conversación.`);
      await flowDynamic("Has alcanzado el límite de servicios por conversación. Por favor, espera 10 minutos antes de solicitar más servicios.");
      return endFlow();
    }

    if (userContext.awaitingFile) {
      await flowDynamic('Parece que aún no has subido un archivo para el servicio actual. Por favor, sube el archivo antes de continuar.');
      return gotoFlow(fileManagementFlow);
    }

    this.startIdleTimer(ctx, flowDynamic, gotoFlow);

    try {
      const aiResponse = await this.getAIResponse(userId, message, isVoiceNote);
      logger.info(`Respuesta AI para ${userId}: ${aiResponse}`);
      const { action, response, order } = await this.updateOrder(userId, aiResponse);

    // Actualizar el servicio actual
    if (order && order.items.length > 0) {
      const currentService = order.items[order.items.length - 1].nombre;
      this.setCurrentService(userId, currentService);
      logger.info(`Servicio actual actualizado para ${userId}: ${currentService}`);
    }

      switch (action) {
        case "CONFIRMAR_PEDIDO":
          if (this.allServicesHaveFiles(userContext)) {
            const { confirmationMessage, orderSummary, promoMessage } = await this.finalizeOrder(ctx);
            await flowDynamic(orderSummary);
            await flowDynamic(confirmationMessage);
            logger.info(`Pedido confirmado para ${userId}. Finalizando flujo.`);
            
            blacklistManager.addToBlacklist(userId, BLACKLIST_DURATION);
            this.clearIdleTimer(userId);
            
            setTimeout(() => {
              gotoFlow(flowPromo);
            }, 15000);
          } else {
            await flowDynamic('Aún hay servicios sin archivos asociados. Por favor, sube los archivos faltantes.');
            return gotoFlow(fileManagementFlow);
          }
          break;
        case "SOLICITUD_HUMANO":
          blacklistManager.addToBlacklist(userId, HUMAN_BLACKLIST_DURATION);
          this.resetConversation(userId);
          this.clearIdleTimer(userId);
          await flowDynamic("*Entendido* 👍. Un representante humano se pondrá en contacto contigo pronto. *Gracias por tu paciencia.* 🙏");
          logger.info(`Solicitud de humano para ${userId}. Añadido a la lista negra por ${HUMAN_BLACKLIST_DURATION/1000} segundos.`);
          return endFlow();
        case "ADVERTENCIA_MAL_USO_DETECTADO":
          blacklistManager.addToBlacklist(userId, ABUSE_BLACKLIST_DURATION);
          this.resetConversation(userId);
          this.clearIdleTimer(userId);
          await flowDynamic("*Lo siento* 😔, pero hemos detectado un uso inapropiado del sistema. Tu acceso ha sido *temporalmente suspendido*. Si crees que esto es un error, por favor contacta con nuestro equipo de soporte.");
          logger.info(`Mal uso detectado para ${userId}. Añadido a la lista negra por ${ABUSE_BLACKLIST_DURATION/1000} segundos.`);
          return endFlow();
        default:
          await flowDynamic(response);
      }
    } catch (error) {
      logger.error(`Error al procesar respuesta para usuario ${userId}: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error inesperado. Por favor, intenta nuevamente en unos momentos.");
    }
  }

  updateContext(userId, message, role) {
    const userContext = this.getUserContext(userId);
    userContext.context += `${role}: ${message}\n`;
    this.limitContextSize(userId);
    logger.debug(`Contexto actualizado para usuario ${userId}. Palabras: ${userContext.context.split(/\s+/).length}`);
  }

  limitContextSize(userId) {
    const userContext = this.getUserContext(userId);
    const words = userContext.context.split(/\s+/);
    if (words.length > 1500) {
      userContext.context = words.slice(-1500).join(" ");
      logger.debug(`Contexto limitado a 1500 palabras para usuario ${userId}`);
    }
  }

  getSystemPrompt(userId) {
    const userContext = this.getUserContext(userId);
    
    return `Eres un empleado amigable y eficiente de una imprenta. Tu objetivo es ayudar a los clientes a hacer pedidos de impresión de manera efectiva. Sigue estas instrucciones:
    
    1. Saluda al cliente y pregunta qué servicio de impresión desea cotizar.
    2. Mantén un tono amigable y profesional. Usa emojis ocasionalmente para dar un tono agradable.
    3. El cliente puede cotizar hasta 5 servicios por conversación. Lleva la cuenta y avisa cuando llegue al límite.
    4. Para productos de Telas PVC, Banderas, Adhesivos, Adhesivo Vehicular o Back Light:
       - Pregunta por ancho, alto y cantidad.
       - Ofrece terminaciones (sellado, ojetillos, bolsillo) si el servicio lo permite.
    5. Para productos de Otros, Imprenta, Pendon Roller, Palomas, Figuras o Extras:
       - Solo pregunta por la cantidad.
       - Verifica si tienen terminaciones disponibles.
    6. Después de cada servicio, pregunta si el cliente desea cotizar algo más o finalizar la cotización.
    7. Solicita el diseño para cada servicio, mencionando el tamaño máximo permitido por WhatsApp (16MB).
    8. No realices cálculos. Solo proporciona la información del servicio y sus opciones.
    9. Si el cliente solicita múltiples servicios, guíalo para cotizar uno por uno.
    10. Usa "CONFIRMAR_PEDIDO" cuando el cliente esté listo para finalizar.
    11. Usa "SOLICITUD_HUMANO" si el cliente pide hablar con un representante.
    12. Si detectas uso inadecuado, usa "ADVERTENCIA_MAL_USO_DETECTADO".
    13. Nunca te identifiques como un bot o IA.
    14. Responde SOLO con la información específica que el cliente solicita.
    15. Si el cliente envía un archivo, informa que será analizado para verificar su compatibilidad.

    Información adicional:
    ${JSON.stringify(this.additionalInfo, null, 2)}

    Servicios disponibles:
    ${JSON.stringify(this.services, null, 2)}
    
    Estado actual del pedido:
    ${JSON.stringify(userContext.currentOrder, null, 2)}`;
  }
  
  async getAIResponse(userId, userMessage, isTranscription = false) {
    try {
      this.updateContext(userId, userMessage, isTranscription ? "Transcripción de audio" : "Usuario");
      const userContext = this.getUserContext(userId);
      const response = await openaiService.getChatCompletion(
        this.getSystemPrompt(userId),
        userContext.context
      );
      
      if (response && typeof response === 'string') {
        this.updateContext(userId, response, "Vendedor");
        return response;
      } else {
        throw new Error(`Respuesta de AI inesperada para usuario ${userId}`);
      }
    } catch (error) {
      logger.error(`Error al obtener respuesta de AI para usuario ${userId}: ${error.message}`);
      return "Lo siento, estoy teniendo problemas para procesar tu solicitud. ¿Podrías intentarlo de nuevo?";
    }
  }

  async updateOrder(userId, aiResponse) {
    logger.info(`Actualizando orden para usuario ${userId}. Respuesta AI: ${aiResponse}`);
    try {
      const extractedOrder = await openaiService.extractOrder(this.services, aiResponse);
      logger.debug(`Orden extraída en JSON para usuario ${userId}: ${JSON.stringify(extractedOrder)}`);

      const userContext = this.getUserContext(userId);
      if (extractedOrder && extractedOrder.items.length > 0) {
        userContext.currentOrder = extractedOrder;
        userContext.serviceCount += extractedOrder.items.length;
        userContext.lastServiceTime = Date.now();
        
        // Actualizar el servicio actual
        const currentService = extractedOrder.items[extractedOrder.items.length - 1].nombre;
        this.setCurrentService(userId, currentService);
        logger.info(`Servicio actual actualizado para ${userId}: ${currentService}`);
      }
      if (aiResponse.includes("CONFIRMAR_PEDIDO")) {
        logger.info(`Pedido confirmado para usuario ${userId}`);
        return { action: "CONFIRMAR_PEDIDO", order: userContext.currentOrder };
      } else if (aiResponse.includes("SOLICITUD_HUMANO")) {
        logger.info(`Solicitud de atención humana detectada para usuario ${userId}`);
        return { action: "SOLICITUD_HUMANO" };
      } else if (aiResponse.includes("ADVERTENCIA_MAL_USO_DETECTADO")) {
        logger.info(`Advertencia de mal uso detectada para usuario ${userId}`);
        return { action: "ADVERTENCIA_MAL_USO_DETECTADO" };
      }
      return { action: "CONTINUAR", response: aiResponse };
    } catch (error) {
      logger.error(`Error al actualizar el pedido para usuario ${userId}: ${error.message}`);
      return { action: "CONTINUAR", response: aiResponse };
    }
  }

  formatOrderForSheet(order) {
    let details = '';
    let total = 0;
    
    order.items.forEach(item => {
      details += `${item.nombre} - Cantidad: ${item.cantidad}\n`;
      if (item.ancho && item.alto) {
        details += `Medidas: ${item.ancho}cm x ${item.alto}cm\n`;
      }
      if (item.terminaciones && item.terminaciones.length > 0) {
        details += `Terminaciones: ${item.terminaciones.join(', ')}\n`;
      }
      details += `Subtotal: $${this.formatPrice(item.subtotal)}\n\n`;
      total += item.subtotal;
    });
    
    return {
      details: details.trim(),
      total: `$${this.formatPrice(total)}`
    };
  }

  formatPrice(price) {
    return price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
  
  getPromoMessage() {
    return `🖨️ *¡Gracias por usar nuestro Bot de Imprenta!* 🚀
  
  Desarrollado con ❤️ por *SuperPyme*
  
  📄 *Ver Servicios y Pedidos:*
  [URL de la hoja de Google Sheets]
  
  🔒 _Nota: Los números están censurados para proteger la privacidad de nuestros usuarios._
  
  ✨ *¿Quieres un bot así para tu negocio?* ✨
  
  📱 Whatsapp: *+56 9 7147 1884*
  📧 Escríbenos: *oficina@superpyme.cl*
  🌐 Más información: *superpyme.cl*
  
  🚀 *¡Lleva tu negocio al siguiente nivel con SuperPyme!* 💼
  
  PD: Puedes volver a probar el bot en 10 minutos, si quieres probarlo de inmediato, escribe desde otro número.`;
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

  resetConversation(userId) {
    this.userContexts.delete(userId);
    this.clearIdleTimer(userId);
    logger.info(`Conversación reiniciada para usuario ${userId}`);
  }

  async processVoiceNote(ctx, provider) {
    try {
      logger.info(`Procesando nota de voz para usuario ${ctx.from}`);
      const audioFileName = `audio_${Date.now()}.oga`;
      const audioPath = path.join(TMP_DIR, audioFileName);
      
      const savedFile = await provider.saveFile(ctx);
      
      if (typeof savedFile === 'string' || (savedFile && savedFile.path)) {
        const sourcePath = typeof savedFile === 'string' ? savedFile : savedFile.path;
        
        await fs.copyFile(sourcePath, audioPath);
        await fs.unlink(sourcePath);
        
        const transcription = await openaiService.transcribeAudio(audioPath);
        await fs.unlink(audioPath);
        logger.info(`Nota de voz procesada y archivo eliminado: ${audioPath}`);
        
        return transcription;
      } else {
        throw new Error('No se pudo obtener la ruta del archivo de audio');
      }
    } catch (error) {
      logger.error(`Error procesando nota de voz: ${error.message}`);
      throw error;
    }
  }

  async analyzeFile(filePath, userInfo) {
    try {
      logger.info(`Analizando archivo: ${filePath}`);
      const currentItem = userInfo.currentOrder.items[userInfo.currentOrder.items.length - 1];
      
      if (!currentItem) {
        throw new Error('No hay un item actual en el pedido');
      }
  
      const serviceInfo = this.services[currentItem.nombre];
      if (!serviceInfo) {
        throw new Error(`No se encontró información del servicio: ${currentItem.nombre}`);
      }
  
      const requiredWidth = currentItem.ancho || serviceInfo.anchoImprimible;
      const requiredHeight = currentItem.alto || serviceInfo.altoImprimible;
      const requiredDPI = serviceInfo.dpi || 300;
  
      const analysisResult = await fileAnalyzer.analyzeFile(filePath, requiredWidth, requiredHeight, requiredDPI);
      
      logger.info(`Resultado del análisis: ${JSON.stringify(analysisResult)}`);
      
      return analysisResult;
    } catch (error) {
      logger.error(`Error analizando archivo: ${error.message}`);
      throw error;
    }
  }

  
  async saveUploadedFile(ctx, provider) {
    try {
      const savedFile = await provider.saveFile(ctx, { path: TMP_DIR });
      logger.info(`Archivo guardado exitosamente: ${savedFile}`);
      return savedFile;
    } catch (error) {
      logger.error(`Error al guardar el archivo: ${error.message}`);
      throw error;
    }
  }
  allServicesHaveFiles(userContext) {
    return userContext.currentOrder.items.every(item => item.fileUploaded);
  }

  async finalizeOrder(ctx) {
    const userContext = this.getUserContext(ctx.from);
    const calculatedOrder = printingCalculator.calculateOrder(userContext.currentOrder, this.services);
    const orderSummary = printingCalculator.formatOrderSummary(calculatedOrder);
    
    const orderForSheet = this.formatOrderForSheet(calculatedOrder);
    const saveResult = await sheetService.saveOrder({
      fecha: new Date().toISOString(),
      telefono: ctx.from,
      nombre: ctx.pushName || 'No disponible',
      correo: 'No disponible', // Puedes agregar lógica para obtener el correo si lo necesitas
      pedido: orderForSheet.details,
      archivos: 'No disponible', // Puedes agregar lógica para manejar los archivos si es necesario
      total: orderForSheet.total,
      estado: 'Pendiente'
    });

    let confirmationMessage = '';
    if (saveResult.success) {
      confirmationMessage = `¡Gracias por tu pedido! Ha sido registrado con el número de orden: ${saveResult.rowIndex}. Nos pondremos en contacto contigo pronto para confirmar los detalles y el pago.`;
    } else {
      confirmationMessage = 'Gracias por tu pedido. Hemos tenido un problema al registrarlo, pero no te preocupes, nos pondremos en contacto contigo pronto para confirmar los detalles.';
    }

    const promoMessage = this.getPromoMessage();

    return { confirmationMessage, orderSummary, promoMessage };
  }
}

const printingBot = new ImprovedPrintingBot();

const flowPrincipal = addKeyword(EVENTS.WELCOME)
  .addAction(async (ctx, { flowDynamic, gotoFlow, endFlow }) => {
    const userId = ctx.from;

    if (Object.keys(printingBot.services).length === 0) {
      await printingBot.initialize();
    }

    const userContext = printingBot.getUserContext(userId);
    if (userContext.awaitingFile) {
      return gotoFlow(fileManagementFlow);
    }

    await printingBot.handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, ctx.body);
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

  const fileManagementFlow = addKeyword(EVENTS.DOCUMENT)
  .addAction(async (ctx, { flowDynamic, gotoFlow, provider, endFlow }) => {
    const userContext = printingBot.getUserContext(ctx.from);
    logger.info(`Estado actual del usuario ${ctx.from}: ${JSON.stringify(userContext)}`);
    
    if (!userContext.currentService) {
      logger.warn(`Usuario ${ctx.from} intentó subir un archivo sin servicio seleccionado.`);
      await flowDynamic('Por favor, selecciona un servicio antes de subir un archivo.');
      return gotoFlow(flowPrincipal);
    }

    logger.info(`Procesando archivo para servicio: ${userContext.currentService}`);
    return handleFileUpload(ctx, { flowDynamic, gotoFlow, provider, endFlow });
  });

  const handleFileUpload = async (ctx, { flowDynamic, gotoFlow, provider }) => {
    const userContext = printingBot.getUserContext(ctx.from);
    let retries = userContext.fileUploadRetries || 0;
  
    try {
      logger.info(`Intentando procesar archivo para usuario ${ctx.from}. Intento ${retries + 1}`);
      const savedFile = await printingBot.saveUploadedFile(ctx, provider);
      
      const userInfo = {
        currentOrder: userContext.currentOrder,
        currentService: userContext.currentService
      };
      
      const fileAnalysisResult = await printingBot.analyzeFile(savedFile, userInfo);
      
      if (fileAnalysisResult.isCompatible) {
        userContext.currentOrder.items[userContext.currentOrder.items.length - 1].fileUploaded = true;
        await flowDynamic('✅ El archivo es compatible y ha sido asociado al servicio actual.');
        userContext.fileUploadRetries = 0;
        return gotoFlow(flowConfirmOrder);
      } else {
        retries++;
        userContext.fileUploadRetries = retries;
        const remainingAttempts = MAX_RETRIES - retries;
        await flowDynamic(`⚠️ El archivo no es compatible: ${fileAnalysisResult.errorMessage}\nTe quedan ${remainingAttempts} ${remainingAttempts === 1 ? 'intento' : 'intentos'}.`);
        return gotoFlow(fileRetryFlow);
      }
    } catch (error) {
      logger.error(`Error al procesar archivo para ${ctx.from}: ${error.message}`);
      retries++;
      userContext.fileUploadRetries = retries;
      const remainingAttempts = MAX_RETRIES - retries;
  
      if (retries >= MAX_RETRIES) {
        await flowDynamic('Se ha alcanzado el número máximo de intentos. Por favor, intenta más tarde o contacta con soporte.');
        return gotoFlow(flowPrincipal);
      }
  
      await flowDynamic(`Hubo un error al procesar tu archivo. Te quedan ${remainingAttempts} ${remainingAttempts === 1 ? 'intento' : 'intentos'}. Por favor, intenta nuevamente.`);
      return gotoFlow(fileRetryFlow);
    }
  }

  const fileRetryFlow = addKeyword(EVENTS.ACTION)
  .addAnswer('¿Qué deseas hacer?')
  .addAnswer(
    ['1. Subir otro archivo', '2. Cancelar este servicio', '3. Finalizar el pedido'],
    { capture: true },
    async (ctx, { flowDynamic, gotoFlow, endFlow }) => {
      const option = ctx.body;
      switch (option) {
        case '1':
          await flowDynamic('Por favor, sube el nuevo archivo.');
          const userContext = printingBot.getUserContext(ctx.from);
          userContext.awaitingFile = true;
          return endFlow();
        case '2':
          printingBot.cancelCurrentService(ctx.from);
          await flowDynamic('Servicio cancelado. ¿Deseas agregar otro servicio?');
          return gotoFlow(flowPrincipal);
        case '3':
          return gotoFlow(flowConfirmOrder);
        default:
          await flowDynamic('Opción no válida. Por favor, elige 1, 2 o 3.');
          return gotoFlow(fileRetryFlow);
      }
    }
  );

const voiceNoteFlow = addKeyword(EVENTS.VOICE_NOTE)
  .addAction(async (ctx, { flowDynamic, gotoFlow, endFlow, provider }) => {
    try {
      const transcription = await printingBot.processVoiceNote(ctx, provider);
      logger.info(`Transcripción del audio: ${transcription}`);
      
      await flowDynamic(`*📝 Transcripción:*\n${transcription}`);

      await printingBot.handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, transcription, true);

    } catch (error) {
      logger.error(`Error al procesar la nota de voz: ${error.message}`);
      await flowDynamic('Hubo un error al procesar la nota de voz. Por favor, intenta enviar un mensaje de texto.');
    }
  });

const idleTimeoutFlow = addKeyword(EVENTS.ACTION)
  .addAction(async (ctx, { endFlow }) => {
    logger.info(`Tiempo de espera agotado para usuario ${ctx.from}`);
    printingBot.resetConversation(ctx.from);
    return endFlow('*😴 Lo siento, el tiempo de espera ha expirado. Tu pedido ha sido cancelado. Si deseas hacer un nuevo pedido, por favor envía un mensaje.*');
  });

const flowPromo = addKeyword(EVENTS.ACTION)
  .addAction(async (ctx, { flowDynamic, endFlow }) => {
    const promoMessage = printingBot.getPromoMessage();
    try {
      await flowDynamic(promoMessage);
      logger.info(`Mensaje promocional enviado a ${ctx.from}`);
    } catch (error) {
      logger.error(`Error al enviar mensaje promocional a ${ctx.from}: ${error.message}`);
    }
    return endFlow();
  });

  const flowConfirmOrder = addKeyword(EVENTS.ACTION)
  .addAction(async (ctx, { flowDynamic, gotoFlow }) => {
    const userContext = printingBot.getUserContext(ctx.from);
    if (!printingBot.allServicesHaveFiles(userContext)) {
      await flowDynamic('Aún hay servicios sin archivos asociados. Por favor, sube los archivos faltantes.');
      return gotoFlow(fileManagementFlow);
    }
    const { confirmationMessage, orderSummary } = await printingBot.finalizeOrder(ctx);
    await flowDynamic(orderSummary);
    await flowDynamic(confirmationMessage);
    return gotoFlow(flowPromo);
  });


const main = async () => {
  try {
    const adapterFlow = createFlow([
      flowPrincipal,
      flowRestartBot,
      voiceNoteFlow,
      fileManagementFlow,
      fileRetryFlow,
      idleTimeoutFlow,
      flowPromo,
      flowConfirmOrder
    ])
    
    const adapterProvider = createProvider(BaileysProvider)
    
    const adapterDB = new JsonFileDB({ filename: 'db.json' })

    const { handleCtx, httpServer } = await createBot({
      flow: adapterFlow,
      provider: adapterProvider,
      database: adapterDB,
    })

    adapterProvider.server.post('/v1/messages', handleCtx(async (bot, req, res) => {
        const { number, message, urlMedia } = req.body
        await bot.sendMessage(number, message, { media: urlMedia ?? null })
        return res.end('sent')
    }))

    adapterProvider.server.post('/v1/blacklist', handleCtx(async (bot, req, res) => {
        const { number, intent } = req.body
        if (intent === 'remove') bot.blacklist.remove(number)
        if (intent === 'add') bot.blacklist.add(number)
        return res.json({ status: 'ok', number, intent })
    }))

    httpServer(+PORT)
    console.log(`Bot iniciado en el puerto ${PORT}`)
  } catch (error) {
    console.error('Error en main:', error)
  }
}

main()
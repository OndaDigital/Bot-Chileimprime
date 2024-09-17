import OpenAIService from './openaiService.js';
import SheetService from './sheetService.js';
import PrintingCalculator from './printingCalculator.js';
import FileAnalyzer from './fileAnalyzer.js';
import Logger from './logger.js';
import path from 'path';
import fs from 'fs/promises';

class PrintingBot {
  constructor() {
    this.openaiService = new OpenAIService(process.env.OPENAI_API_KEY);
    this.sheetService = new SheetService(process.env.GOOGLE_SHEET_ID);
    this.printingCalculator = new PrintingCalculator();
    this.fileAnalyzer = new FileAnalyzer();
    this.logger = new Logger();
    this.userContexts = new Map();
    this.blacklist = new Map();
    this.orderConfirmed = new Set();
    this.idleTimers = new Map();
    this.fileUploadAttempts = new Map();
    this.TMP_DIR = path.join(process.cwd(), 'tmp');
    this.BLACKLIST_DURATION = 10 * 60 * 1000;
    this.IDLE_WARNING_TIME = 5 * 60 * 1000;
    this.IDLE_TIMEOUT_TIME = 10 * 60 * 1000;
    this.MAX_SERVICES_PER_CONVERSATION = 5;
    this.MAX_FILE_UPLOAD_ATTEMPTS = 3;
    this.initialize();
  }

  async initialize() {
    try {
      await fs.access(this.TMP_DIR);
    } catch {
      await fs.mkdir(this.TMP_DIR, { recursive: true });
    }
    this.services = await this.sheetService.getServices();
    this.additionalInfo = await this.sheetService.getAdditionalInfo();
  }

  async handleMessage(ctx, { flowDynamic, gotoFlow, endFlow }) {
    const userId = ctx.from;
    const userContext = this.getUserContext(userId);

    if (this.isBlacklisted(userId)) {
      this.logger.info(`Usuario ${userId} en lista negra. Mensaje ignorado.`);
      return endFlow();
    }

    if (this.isOrderConfirmed(userId)) {
      this.logger.info(`Pedido ya confirmado para ${userId}. Redirigiendo a atención humana.`);
      return gotoFlow('flowConfirmed');
    }

    this.startIdleTimer(ctx, flowDynamic, gotoFlow);

    try {
      const aiResponse = await this.openaiService.getResponse(ctx.body, this.services, userContext);
      const { action, response } = await this.updateOrder(userId, aiResponse);

      switch (action) {
        case "CONFIRMAR_PEDIDO":
          const { confirmationMessage, orderSummary, endConversation } = await this.finalizeOrder(ctx);
          await flowDynamic(orderSummary);
          await flowDynamic(confirmationMessage);
          this.addToBlacklist(userId, this.BLACKLIST_DURATION);
          this.clearIdleTimer(userId);
          if (endConversation) return endFlow();
          break;
        case "SOLICITUD_HUMANO":
          this.addToBlacklist(userId, this.BLACKLIST_DURATION);
          this.resetConversation(userId);
          this.clearIdleTimer(userId);
          await flowDynamic("*Entendido* 👍. Un representante humano se pondrá en contacto contigo pronto. *Gracias por tu paciencia.* 🙏");
          return endFlow();
        default:
          await flowDynamic(response);
      }
    } catch (error) {
      this.logger.error(`Error al procesar respuesta para usuario ${userId}: ${error.message}`);
      await flowDynamic("Lo siento, ha ocurrido un error inesperado. Por favor, intenta nuevamente en unos momentos.");
    }
  }

  async handleDocument(ctx, { flowDynamic, provider }) {
    const userId = ctx.from;
    const userContext = this.getUserContext(userId);

    if (!userContext.currentOrder || !userContext.currentOrder.services || userContext.currentOrder.services.length === 0) {
      await flowDynamic("Lo siento, no hay servicios activos para asociar este archivo. Por favor, primero solicita un servicio.");
      return;
    }

    const serviceIndex = userContext.currentOrder.services.findIndex(service => !service.archivoValido);
    if (serviceIndex === -1) {
      await flowDynamic("Todos los servicios ya tienen archivos asociados. Si deseas modificar alguno, por favor especifica cuál.");
      return;
    }

    const currentService = userContext.currentOrder.services[serviceIndex];

    try {
      const localPath = await provider.saveFile(ctx, {path: this.TMP_DIR});
      const fileAnalysis = await this.fileAnalyzer.analyzeFile(localPath, currentService);

      if (fileAnalysis.esAptaParaImpresion) {
        currentService.archivo = localPath;
        currentService.archivoValido = true;
        this.resetFileUploadAttempts(userId);
        await flowDynamic(`*¡Archivo recibido y validado!* 👍 Archivo asociado al servicio: ${currentService.nombre}. Continúa con tu pedido o envía "confirmar" para finalizar.`);
      } else {
        const attempts = this.incrementFileUploadAttempts(userId);
        if (attempts >= this.MAX_FILE_UPLOAD_ATTEMPTS) {
          await flowDynamic("*Lo siento*, has alcanzado el número máximo de intentos para subir un archivo válido. 😓 Por favor, contacta a un representante para asistencia.");
        } else {
          let errorMessage = `*El archivo no cumple con los requisitos necesarios para el servicio ${currentService.nombre}.* 😕\n\n`;
          errorMessage += `Detalles del archivo:\n${this.formatFileAnalysis(fileAnalysis)}\n`;
          errorMessage += `Por favor, ajusta tu archivo según estas recomendaciones y vuelve a intentarlo. Intento ${attempts} de ${this.MAX_FILE_UPLOAD_ATTEMPTS}`;
          await flowDynamic(errorMessage);
        }
      }
    } catch (error) {
      this.logger.error(`Error al procesar documento para usuario ${userId}: ${error.message}`);
      await flowDynamic("*Lo siento*, ocurrió un error al procesar el archivo. 😓 Por favor, intenta nuevamente o contacta a un representante para asistencia.");
    }
  }

  async handleVoiceNote(ctx, { flowDynamic, provider }) {
    const userId = ctx.from;
    try {
      const localPath = await provider.saveFile(ctx, {path: this.TMP_DIR});
      const transcription = await this.openaiService.transcribeAudio(localPath);
      await flowDynamic(`*Transcripción de tu nota de voz:*\n${transcription}\n\nResponderé a tu mensaje en un momento.`);
      await this.handleMessage({...ctx, body: transcription}, { flowDynamic });
    } catch (error) {
      this.logger.error(`Error al procesar nota de voz para usuario ${userId}: ${error.message}`);
      await flowDynamic("*Lo siento*, ocurrió un error al procesar tu nota de voz. 😓 Por favor, intenta enviar un mensaje de texto.");
    }
  }

  getUserContext(userId) {
    if (!this.userContexts.has(userId)) {
      this.userContexts.set(userId, {
        conversation: [],
        currentOrder: { services: [] },
        currentState: 'inicio',
        lastInteraction: Date.now()
      });
    }
    return this.userContexts.get(userId);
  }

  async updateOrder(userId, aiResponse) {
    const userContext = this.getUserContext(userId);
    const extractedOrder = await this.openaiService.extractOrder(this.services, aiResponse);

    if (extractedOrder.items && extractedOrder.items.length > 0) {
      extractedOrder.items.forEach(item => {
        const newService = {
          categoria: item.categoria,
          nombre: item.nombre,
          cantidad: item.cantidad,
          medidas: item.medidas,
          terminaciones: item.terminaciones,
          precio: item.precio,
          dpi: item.dpi,
          formato: item.formatos.join(', '),
          archivo: null,
          archivoValido: false
        };
        userContext.currentOrder.services.push(newService);
      });

      if (userContext.currentOrder.services.length > this.MAX_SERVICES_PER_CONVERSATION) {
        return { action: "LIMITE_SERVICIOS", response: "Has alcanzado el límite de servicios por conversación. Por favor, confirma tu pedido o espera 10 minutos para cotizar servicios adicionales." };
      }
    }

    userContext.currentOrder.observaciones = extractedOrder.observaciones;

    if (aiResponse.includes("CONFIRMAR_PEDIDO")) {
      if (this.allServicesHaveValidFiles(userContext.currentOrder.services)) {
        return { action: "CONFIRMAR_PEDIDO" };
      } else {
        return { action: "ARCHIVOS_FALTANTES", response: "No se puede confirmar el pedido. Algunos servicios no tienen archivos de diseño válidos asociados. Por favor, sube los archivos faltantes." };
      }
    } else if (aiResponse.includes("SOLICITUD_HUMANO")) {
      return { action: "SOLICITUD_HUMANO" };
    }
    return { action: "CONTINUAR", response: aiResponse };
  }

  async finalizeOrder(ctx) {
    const userId = ctx.from;
    const userContext = this.getUserContext(userId);
    const calculatedOrder = this.printingCalculator.calculateOrder(userContext.currentOrder);
    const formattedOrder = this.formatOrderForSheet(calculatedOrder);

    const finalOrder = {
      fecha: new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' }),
      telefono: userId,
      nombre: ctx.pushName || 'Cliente',
      email: userContext.currentOrder.email || '',
      detalles: formattedOrder.details,
      archivos: formattedOrder.files,
      observaciones: userContext.currentOrder.observaciones || 'Sin observaciones',
      total: formattedOrder.total
    };

    try {
      const result = await this.sheetService.saveOrder(finalOrder);
      if (result.success) {
        this.orderConfirmed.add(userId);
        const confirmationMessage = "*¡Gracias!* 🎉 Tu pedido ha sido registrado y comenzaremos a procesarlo pronto. Un representante se pondrá en contacto contigo para confirmar los detalles y coordinar el pago. 📞";
        return { 
          confirmationMessage, 
          orderSummary: this.printingCalculator.formatOrderSummary(calculatedOrder),
          endConversation: true
        };
      } else {
        throw new Error("Error al guardar el pedido");
      }
    } catch (error) {
      this.logger.error(`Error al finalizar el pedido para usuario ${userId}:`, error);
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
      details += `${service.categoria} - ${service.nombre}\n`;
      details += `Cantidad: ${service.cantidad} - Precio unitario: $${this.formatPrice(service.precioUnitario)}\n`;
      if (service.medidas) {
        details += `Medidas: ${service.medidas.ancho}x${service.medidas.alto} cm\n`;
      }
      if (service.terminaciones && service.terminaciones.length > 0) {
        details += `Terminaciones: ${service.terminaciones.join(', ')}\n`;
      }
      const subtotal = service.cantidad * service.precioUnitario;
      details += `Subtotal: $${this.formatPrice(subtotal)}\n\n`;

      if (service.archivo) {
        files.push(service.archivo);
      }

      total += subtotal;
    });
    
    return {
      details: details.trim(),
      files: files.join(', '),
      total: `$${this.formatPrice(total)}`
    };
  }

  formatPrice(price) {
    return price.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  addToBlacklist(userId, duration) {
    this.blacklist.set(userId, Date.now() + duration);
    this.logger.info(`Usuario ${userId} añadido a la lista negra por ${duration/1000} segundos`);
  }

  isBlacklisted(userId) {
    if (this.blacklist.has(userId)) {
      const blacklistExpiry = this.blacklist.get(userId);
      if (Date.now() < blacklistExpiry) {
        this.logger.info(`Usuario ${userId} está en la lista negra. Tiempo restante: ${(blacklistExpiry - Date.now()) / 1000} segundos`);
        return true;
      } else {
        this.blacklist.delete(userId);
        this.resetConversation(userId);
        this.logger.info(`Usuario ${userId} removido de la lista negra`);
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
    this.logger.info(`Conversación reiniciada para usuario ${userId}`);
  }

  startIdleTimer(ctx, flowDynamic, gotoFlow) {
    this.clearIdleTimer(ctx.from);
    
    const warningTimer = setTimeout(async () => {
      await flowDynamic('*⏰ ¿Sigues ahí? Si necesitas más tiempo, por favor responde cualquier mensaje.*');
    }, this.IDLE_WARNING_TIME);

    const timeoutTimer = setTimeout(() => {
      this.resetConversation(ctx.from);
      gotoFlow('idleTimeoutFlow');
    }, this.IDLE_TIMEOUT_TIME);

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

  resetFileUploadAttempts(userId) {
    this.fileUploadAttempts.set(userId, 0);
  }

  incrementFileUploadAttempts(userId) {
    const attempts = this.fileUploadAttempts.get(userId) || 0;
    this.fileUploadAttempts.set(userId, attempts + 1);
    return attempts + 1;
  }

  allServicesHaveValidFiles(services) {
    return services.every(service => service.archivoValido);
  }

  formatFileAnalysis(fileAnalysis) {
    let analysisText = '';
    analysisText += `- Tipo: ${fileAnalysis.tipo}\n`;
    analysisText += `- Formato: ${fileAnalysis.formato}\n`;
    analysisText += `- Dimensiones: ${fileAnalysis.ancho}x${fileAnalysis.alto} píxeles\n`;
    analysisText += `- DPI: ${fileAnalysis.dpi}\n`;
    analysisText += `- Tamaño: ${fileAnalysis.tamaño}\n`;
    analysisText += `- DPI mínimo requerido: ${fileAnalysis.dpiRequerido}\n`;
    return analysisText;
  }
}

export default PrintingBot;
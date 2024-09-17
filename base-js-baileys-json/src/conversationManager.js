// conversationManager.js - bot de imprenta


// conversationManager.js
import Logger from './logger.js';

class ConversationManager {
  constructor(openaiService, sheetService, fileAnalyzer, printingCalculator) {
    this.openaiService = openaiService;
    this.sheetService = sheetService;
    this.fileAnalyzer = fileAnalyzer;
    this.printingCalculator = printingCalculator;
    this.conversations = new Map();
    this.fileUploadAttempts = new Map();
    this.MAX_FILE_UPLOAD_ATTEMPTS = 3;
    this.IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutos
    this.logger = new Logger();
  }

  async initialize() {
    this.services = await this.sheetService.getServices();
    this.logger.info('Servicios cargados correctamente');
  }

  async handleMessage(ctx) {
    const userId = ctx.from;
    let conversation = this.getConversation(userId);
    conversation.lastActivity = Date.now();

    this.logger.info(`[ConversationManager] Manejando mensaje para usuario ${userId}. Estado actual: ${conversation.state}`);
    this.logger.info(`[ConversationManager] Contexto actual: ${JSON.stringify(conversation.context)}`);
    this.logger.info(`[ConversationManager] Palabras en contexto: ${this.countWordsInContext(conversation.context)}`);

    if (this.isIdle(userId)) {
      this.resetConversation(userId);
      return "La sesión ha expirado debido a inactividad. ¿En qué puedo ayudarte?";
    }

    if (conversation.services.length >= 5 && conversation.state !== 'SUMMARY') {
      conversation.state = 'SUMMARY';
      return "Has alcanzado el límite de 5 servicios por cotización. Procedamos a finalizar.";
    }

    let response;
    switch (conversation.state) {
      case 'INITIAL':
        response = await this.openaiService.handleInitialConversation(conversation.context, ctx.body);
        if (response.includes("{MENU_SOLICITADO}")) {
          response = this.getFullMenu();
        }
        if (response.includes("{LISTO_PARA_SELECCIONAR_SERVICIO}")) {
          conversation.state = 'SERVICE_SELECTION';
          response = "Perfecto, ¿qué servicio te gustaría cotizar?";
        }
        break;
      case 'SERVICE_SELECTION':
        const serviceResponse = await this.openaiService.selectService(this.services, ctx.body);
        if (serviceResponse.includes("{SERVICIO_CONFIRMADO}")) {
          conversation.state = 'MEASUREMENTS_AND_FINISHES';
          conversation.currentService = this.extractServiceFromResponse(serviceResponse);
          response = this.getServiceDetails(conversation.currentService);
        } else {
          response = "Lo siento, no pude identificar el servicio. ¿Podrías ser más específico?";
        }
        break;
      case 'MEASUREMENTS_AND_FINISHES':
        response = await this.openaiService.getMeasurementsAndFinishes(conversation.currentService, ctx.body);
        if (response.includes("{TERMINACIONES_MEDIDAS_SELECCIONADAS}")) {
          conversation.state = 'FILE_UPLOAD';
          conversation.currentService = {
            ...conversation.currentService,
            ...this.extractDetailsFromResponse(response)
          };
          response = "Excelente. Ahora, por favor, sube el archivo de diseño para tu servicio.";
        }
        break;
      case 'FILE_UPLOAD':
        response = "Por favor, sube el archivo de diseño para tu servicio.";
        break;
      case 'SUMMARY':
        if (ctx.body.toLowerCase().includes("nuevo servicio") && conversation.services.length < 5) {
          conversation.state = 'SERVICE_SELECTION';
          response = "Entendido. ¿Qué otro servicio te gustaría cotizar?";
        } else if (ctx.body.toLowerCase().includes("finalizar")) {
          response = await this.finalizeCotization(userId);
        } else {
          response = "¿Deseas cotizar un nuevo servicio o finalizar la cotización?";
        }
        break;
    }

    conversation.context.push({ role: "user", content: ctx.body });
    conversation.context.push({ role: "assistant", content: response });
    this.limitContextSize(conversation);

    this.logger.info(`[ConversationManager] Respuesta generada: ${response}`);
    this.logger.info(`[ConversationManager] Nuevo estado: ${conversation.state}`);
    this.logger.info(`[ConversationManager] Palabras en contexto después de la respuesta: ${this.countWordsInContext(conversation.context)}`);

    return response;
  }

  getServiceDetails(service) {
    return `Has seleccionado: *${service.nombre}*\n\n` +
           `Precio: $${service.precio} por ${service.tipo}\n` +
           `Medidas disponibles: ${service.medidas}\n` +
           `Formato requerido: ${service.formato}\n` +
           `DPI mínimo: ${service.dpi}\n\n` +
           "Por favor, indica las medidas que necesitas (ancho x alto).";
  }

  countWordsInContext(context) {
    return context.reduce((total, message) => total + (message.content ? message.content.split(/\s+/).length : 0), 0);
  }

  async handleFileUpload(userId, filePath) {
    let conversation = this.getConversation(userId);
    let attempts = this.fileUploadAttempts.get(userId) || 0;

    if (attempts >= this.MAX_FILE_UPLOAD_ATTEMPTS) {
      conversation.state = 'SUMMARY';
      return "Has alcanzado el máximo de intentos para subir el archivo. Pasemos a resumir tu cotización.";
    }

    const analysisResult = await this.fileAnalyzer.analyzeFile(filePath, conversation.currentService);
    
    if (analysisResult.isValid) {
      conversation.currentService.filePath = filePath;
      conversation.services.push(conversation.currentService);
      conversation.state = 'SUMMARY';
      const summary = this.generateServiceSummary(conversation.currentService);
      return `Archivo válido y guardado. Resumen de tu cotización:\n${summary}\n¿Deseas finalizar la cotización o cotizar un nuevo servicio?`;
    } else {
      this.fileUploadAttempts.set(userId, attempts + 1);
      return `El archivo no cumple con los requisitos. Por favor, intenta de nuevo. Intento ${attempts + 1} de ${this.MAX_FILE_UPLOAD_ATTEMPTS}.`;
    }
  }

  async finalizeCotization(userId) {
    const conversation = this.getConversation(userId);
    const orderSummary = this.generateFullOrderSummary(conversation);
    await this.sheetService.saveOrder(orderSummary);
    this.resetConversation(userId);
    return `{FINALIZAR_CONVERSACION}\n${orderSummary}\nGracias por tu cotización. Un representante se pondrá en contacto contigo pronto.`;
  }

  getConversation(userId) {
    if (!this.conversations.has(userId)) {
      this.conversations.set(userId, {
        context: [],
        state: 'INITIAL',
        lastActivity: Date.now(),
        services: [],
        currentService: null
      });
    }
    return this.conversations.get(userId);
  }

  resetConversation(userId) {
    this.conversations.delete(userId);
    this.fileUploadAttempts.delete(userId);
    this.logger.info(`Conversación reiniciada para usuario ${userId}`);
  }

  isIdle(userId) {
    const conversation = this.getConversation(userId);
    return Date.now() - conversation.lastActivity > this.IDLE_TIMEOUT;
  }

  limitContextSize(conversation) {
    const maxContextSize = 1500;
    let totalWords = conversation.context.reduce((acc, message) => acc + message.content.split(' ').length, 0);
    while (totalWords > maxContextSize && conversation.context.length > 2) {
      const removed = conversation.context.shift();
      totalWords -= removed.content.split(' ').length;
    }
  }

  getFullMenu() {
    let menuText = "📋 Menú de Servicios:\n\n";
    for (const [category, services] of Object.entries(this.services)) {
      menuText += `*${category}*:\n`;
      services.forEach(service => {
        menuText += `- ${service.nombre}\n`;
      });
      menuText += "\n";
    }
    return menuText;
  }

  extractServiceFromResponse(response) {
    const match = response.match(/{SERVICIO_CONFIRMADO}(.*)/);
    if (match && match[1]) {
      const serviceName = match[1].trim();
      for (const category in this.services) {
        const service = this.services[category].find(s => s.nombre.toLowerCase() === serviceName.toLowerCase());
        if (service) {
          return service;
        }
      }
    }
    throw new Error("No se pudo extraer un servicio válido de la respuesta");
  }

  extractDetailsFromResponse(response) {
    const match = response.match(/{TERMINACIONES_MEDIDAS_SELECCIONADAS}(.*)/);
    if (match && match[1]) {
      try {
        const details = JSON.parse(match[1].trim());
        return {
          medidas: {
            ancho: parseFloat(details.ancho),
            alto: parseFloat(details.alto)
          },
          terminaciones: {
            sellado: details.terminaciones.includes('sellado'),
            ojetillos: details.terminaciones.includes('ojetillos'),
            bolsillo: details.terminaciones.includes('bolsillo')
          }
        };
      } catch (error) {
        this.logger.error("Error al parsear los detalles del servicio:", error);
        throw new Error("No se pudieron extraer los detalles del servicio correctamente");
      }
    }
    throw new Error("No se pudieron extraer los detalles del servicio de la respuesta");
  }

  generateServiceSummary(service) {
    return this.printingCalculator.generateOrderSummary({ servicios: [service] });
  }

  generateFullOrderSummary(conversation) {
    return this.printingCalculator.generateOrderSummary({ servicios: conversation.services });
  }
}

export default ConversationManager;
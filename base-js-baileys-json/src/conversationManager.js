// conversationManager.js - bot de imprenta


import Logger from './logger.js';
import OpenAIService from './openaiService.js';
import PrintingCalculator from './printingCalculator.js';
import FileAnalyzer from './fileAnalyzer.js';

const StateManager = {
  INITIAL: 'INITIAL',
  SERVICE_SELECTION: 'SERVICE_SELECTION',
  MEASUREMENTS_AND_FINISHES: 'MEASUREMENTS_AND_FINISHES',
  FILE_UPLOAD: 'FILE_UPLOAD',
  SUMMARY: 'SUMMARY',
  CONFIRMATION: 'CONFIRMATION'
};

class ConversationManager {
  constructor(openaiService, sheetService, fileAnalyzer, printingCalculator) {
    this.openaiService = openaiService;
    this.sheetService = sheetService;
    this.fileAnalyzer = fileAnalyzer;
    this.printingCalculator = printingCalculator;
    this.conversations = new Map();
    this.logger = new Logger();
    this.MAX_SERVICES = 5;
    this.FILE_UPLOAD_ATTEMPTS = 3;
  }

  async initialize() {
    this.services = await this.sheetService.getServices();
    this.logger.info('Servicios cargados correctamente', { services: this.services });
  }

  getConversation(userId) {
    if (!this.conversations.has(userId)) {
      this.conversations.set(userId, {
        userId,
        state: StateManager.INITIAL,
        context: [],
        currentService: null,
        services: [],
        fileUploadAttempts: 0,
        lastActivity: Date.now()
      });
    }
    return this.conversations.get(userId);
  }

  async handleMessage(ctx) {
    const userId = ctx.from;
    let conversation = this.getConversation(userId);
    conversation.lastActivity = Date.now();

    this.logger.info(`Manejando mensaje para usuario ${userId}`, { state: conversation.state, message: ctx.body });

    const analysis = await this.openaiService.analyzeIntent(ctx.body, conversation.context, this.services, conversation.state);
    this.logger.info(`Análisis de intención`, { userId, analysis });

    let response;
    switch (conversation.state) {
      case StateManager.INITIAL:
        response = await this.handleInitialState(analysis, conversation);
        break;
      case StateManager.SERVICE_SELECTION:
        response = await this.handleServiceSelection(analysis, conversation);
        break;
      case StateManager.MEASUREMENTS_AND_FINISHES:
        response = await this.handleMeasurementsAndFinishes(analysis, conversation);
        break;
      case StateManager.FILE_UPLOAD:
        response = await this.handleFileUploadState(analysis, conversation);
        break;
      case StateManager.SUMMARY:
        response = await this.handleSummary(analysis, conversation);
        break;
      case StateManager.CONFIRMATION:
        response = await this.handleConfirmation(analysis, conversation);
        break;
    }

    this.updateConversationContext(conversation, ctx.body, response);
    this.logger.info(`Respuesta generada`, { userId, response, newState: conversation.state });
    return response;
  }

  async handleInitialState(analysis, conversation) {
    this.logger.info(`Manejando estado inicial`, { userId: conversation.userId, analysis });
    let response = "";

    switch (analysis.intencion) {
      case 'SELECCIONAR_SERVICIO':
        if (analysis.servicioMencionado) {
          const serviceDetails = this.findServiceDetails(analysis.servicioMencionado);
          if (serviceDetails) {
            conversation.state = StateManager.MEASUREMENTS_AND_FINISHES;
            conversation.currentService = { ...serviceDetails, cantidad: 1 };
            response = `Has seleccionado: ${serviceDetails.nombre}. ${this.getServiceDetails(serviceDetails)}`;
          } else {
            response = "No encontré ese servicio específico. ¿Quieres ver nuestro menú completo?";
            conversation.state = StateManager.SERVICE_SELECTION;
          }
        } else {
          response = "Entendido, te mostraré nuestros servicios disponibles. " + this.getFullMenu();
          conversation.state = StateManager.SERVICE_SELECTION;
        }
        break;
      case 'SOLICITAR_INFO':
        response = "Claro, estaré encantado de proporcionarte información sobre nuestros servicios de impresión. " + this.getFullMenu();
        break;
      case 'SOLICITAR_AGENTE':
        response = "Entiendo que deseas hablar con un agente humano. Te conectaré con uno pronto. ¿Hay algo específico en lo que necesites ayuda mientras tanto?";
        break;
      default:
        response = "Bienvenido a nuestra imprenta. ¿En qué puedo ayudarte hoy? Si deseas conocer nuestros servicios, puedo mostrarte el menú.";
    }

    this.logger.info(`Respuesta del estado inicial`, { userId: conversation.userId, response, newState: conversation.state });
    return response;
  }

  async handleServiceSelection(analysis, conversation) {
    this.logger.info(`Manejando selección de servicio`, { userId: conversation.userId, analysis });
    if (analysis.intencion === 'SELECCIONAR_SERVICIO' && analysis.servicioMencionado) {
      const serviceDetails = this.findServiceDetails(analysis.servicioMencionado);
      if (serviceDetails) {
        conversation.state = StateManager.MEASUREMENTS_AND_FINISHES;
        conversation.currentService = { ...serviceDetails, cantidad: 1 };
        const response = `Excelente elección. Has seleccionado: ${serviceDetails.nombre}. ${this.getServiceDetails(serviceDetails)}`;
        this.logger.info(`Servicio seleccionado`, { userId: conversation.userId, service: serviceDetails.nombre });
        return response;
      }
    }
    return "No pude identificar el servicio que deseas. Por favor, elige uno de los siguientes:\n" + this.getFullMenu();
  }

  async handleMeasurementsAndFinishes(analysis, conversation) {
    this.logger.info(`Manejando medidas y terminaciones`, { userId: conversation.userId, analysis });
    const validation = await this.openaiService.validateMeasurementsAndFinishes(conversation.currentService, analysis.message);
    
    if (validation.medidasValidas && validation.terminacionesValidas) {
      conversation.currentService.medidas = validation.medidas;
      conversation.currentService.terminaciones = validation.terminaciones;
      conversation.state = StateManager.FILE_UPLOAD;
      const response = "Perfecto. He registrado las medidas y terminaciones. Ahora, por favor, sube el archivo de diseño para tu servicio.";
      this.logger.info(`Medidas y terminaciones validadas`, { userId: conversation.userId, medidas: validation.medidas, terminaciones: validation.terminaciones });
      return response;
    } else {
      return validation.respuestaSugerida;
    }
  }

  async handleFileUploadState(analysis, conversation) {
    this.logger.info(`Manejando estado de carga de archivo`, { userId: conversation.userId, analysis });
    if (analysis.intencion === 'CONFIRMAR_ARCHIVO') {
      conversation.state = StateManager.SUMMARY;
      return "Entendido. Procederé a analizar el archivo una vez que lo subas. Por favor, envía tu archivo ahora.";
    } else {
      return "Por favor, confirma que estás listo para subir el archivo de diseño o súbelo directamente.";
    }
  }

  async handleFileUpload(userId, filePath) {
    const conversation = this.getConversation(userId);
    this.logger.info(`Iniciando análisis de archivo`, { userId, filePath });

    if (conversation.fileUploadAttempts >= this.FILE_UPLOAD_ATTEMPTS) {
      conversation.state = StateManager.SUMMARY;
      this.logger.warn(`Máximo de intentos de carga de archivo alcanzado`, { userId, attempts: conversation.fileUploadAttempts });
      return "Has alcanzado el máximo de intentos para subir el archivo. Pasaremos a resumir tu cotización sin el archivo.";
    }

    try {
      const analysisResult = await this.fileAnalyzer.analyzeFile(filePath, conversation.currentService);
      this.logger.info(`Resultado del análisis de archivo`, { userId, result: analysisResult });

      if (analysisResult.isValid) {
        conversation.currentService.filePath = filePath;
        conversation.services.push(conversation.currentService);
        conversation.state = StateManager.SUMMARY;
        const summary = this.printingCalculator.generateServiceSummary(conversation.currentService);
        return `Archivo válido y guardado. Resumen de tu cotización:\n${summary}\n¿Deseas finalizar la cotización o cotizar un nuevo servicio?`;
      } else {
        conversation.fileUploadAttempts++;
        this.logger.warn(`Archivo inválido`, { userId, attempts: conversation.fileUploadAttempts, errors: analysisResult.errors });
        return `El archivo no cumple con los requisitos: ${analysisResult.errors.join(", ")}. Por favor, intenta de nuevo. Intento ${conversation.fileUploadAttempts} de ${this.FILE_UPLOAD_ATTEMPTS}.`;
      }
    } catch (error) {
      this.logger.error(`Error al analizar el archivo`, { userId, error: error.message });
      return "Hubo un error al procesar el archivo. Por favor, intenta subirlo nuevamente.";
    }
  }

  async handleSummary(analysis, conversation) {
    this.logger.info(`Manejando resumen`, { userId: conversation.userId, analysis });
    conversation.state = StateManager.CONFIRMATION;
    const summary = this.printingCalculator.generateOrderSummary(conversation);
    return `Resumen de tu cotización:\n${summary}\n\n¿Deseas confirmar esta cotización o agregar otro servicio?`;
  }

  async handleConfirmation(analysis, conversation) {
    this.logger.info(`Manejando confirmación`, { userId: conversation.userId, analysis });
    switch (analysis.intencion) {
      case 'CONFIRMAR_COTIZACION':
        return await this.finalizeCotization(conversation);
      case 'AGREGAR_SERVICIO':
        if (conversation.services.length < this.MAX_SERVICES) {
          conversation.state = StateManager.SERVICE_SELECTION;
          return "Entendido. ¿Qué otro servicio te gustaría cotizar?";
        } else {
          return `Has alcanzado el límite máximo de ${this.MAX_SERVICES} servicios por cotización. ¿Deseas confirmar la cotización actual?`;
        }
      default:
        return "Por favor, indica si deseas confirmar la cotización o agregar otro servicio.";
    }
  }

  async finalizeCotization(conversation) {
    this.logger.info(`Finalizando cotización`, { userId: conversation.userId, services: conversation.services });
    const orderSummary = this.printingCalculator.generateOrderSummary(conversation);
    const result = await this.sheetService.saveOrder(orderSummary);
    if (result.success) {
      this.resetConversation(conversation.userId);
      return `Gracias por tu cotización. Un representante se pondrá en contacto contigo pronto. Aquí tienes un resumen final:\n\n${orderSummary}\n\n{FINALIZAR_CONVERSACION}`;
    } else {
      this.logger.error(`Error al guardar la cotización`, { userId: conversation.userId, error: result.message });
      return "Lo siento, hubo un problema al guardar tu cotización. Por favor, intenta nuevamente o contacta a nuestro equipo de soporte.";
    }
  }

  updateConversationContext(conversation, userMessage, botResponse) {
    conversation.context.push({ role: "user", content: userMessage });
    conversation.context.push({ role: "assistant", content: botResponse });
    this.limitContextSize(conversation);
  }

  limitContextSize(conversation) {
    const maxContextSize = 1500;
    while (this.countWordsInContext(conversation.context) > maxContextSize && conversation.context.length > 2) {
      conversation.context.shift();
    }
  }

  countWordsInContext(context) {
    return context.reduce((total, message) => total + message.content.split(/\s+/).length, 0);
  }

  resetConversation(userId) {
    this.conversations.delete(userId);
    this.logger.info(`Conversación reiniciada`, { userId });
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

  getServiceDetails(service) {
    return `Detalles del servicio:
    - Precio: $${service.precio} por ${service.tipo}
    - Medidas disponibles: ${service.medidas}
    - Formato requerido: ${service.formato}
    - DPI mínimo: ${service.dpi}
    
    Por favor, indica las medidas que necesitas y las terminaciones deseadas (${service.sellado ? 'sellado, ' : ''}${service.ojetillos ? 'ojetillos, ' : ''}${service.bolsillo ? 'bolsillo' : ''}).`;
  }

  findServiceDetails(serviceName) {
    for (const category in this.services) {
      const service = this.services[category].find(s => s.nombre.toLowerCase() === serviceName.toLowerCase());
      if (service) return service;
    }
    return null;
  }
}

export default ConversationManager;
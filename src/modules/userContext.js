import logger from '../utils/logger.js';
import sheetService from '../services/sheetService.js';

class UserContextManager {
  constructor() {
    this.userContexts = new Map();
  }

  // Método existente para obtener el contexto del usuario
  getUserContext(userId) {
    if (!this.userContexts.has(userId)) {
      this.userContexts.set(userId, {
        context: "",
        chatContext: [],
        currentOrder: this.getEmptyOrder(),
        services: sheetService.getServices(),
        additionalInfo: sheetService.getAdditionalInfo(),
        initialMessagesSent: false,
        hasInteracted: false  // Nuevo estado para rastrear cualquier interacción
      });
      logger.info(`Nuevo contexto creado para usuario ${userId}`);
    }
    return this.userContexts.get(userId);
  }

  getEmptyOrder() {
    return {
      service: null,
      category: null,
      type: null,
      measures: null,
      finishes: {
        sellado: false,
        ojetillos: false,
        bolsillo: false
      },
      quantity: null,
      filePath: null,
      fileAnalysis: null,
      fileAnalysisResponded: false,
      fileAnalysisHandled: false,
      fileValidation: null,
      availableWidths: [],
      availableFinishes: [],
      price: 0,
      areaServicio: null,
      correo: null, // Añadido para almacenar el correo electrónico del usuario
      correoConfirmed: false, // Para indicar si el correo ha sido confirmado
      esperandoConfirmacionCorreo: false, // **Añadido**
      messageProcessed: false, // **Añadido si no estaba ya**
    };
  }

  // **Modificación: Actualizar método updateCorreo**
  updateCorreo(userId, correo) {
    const userContext = this.getUserContext(userId);
    userContext.currentOrder.correo = correo;
    userContext.currentOrder.correoConfirmed = true;
    userContext.currentOrder.esperandoConfirmacionCorreo = false; // Reset this flag
    logger.info(`Correo electrónico actualizado y confirmado para usuario ${userId}: ${correo}`);
  }

  setInitialMessagesSent(userId, value) {
    const userContext = this.getUserContext(userId);
    userContext.initialMessagesSent = value;
    userContext.hasInteracted = true;
    logger.info(`Estado de mensajes iniciales y interacción actualizados para usuario ${userId}: ${value}`);
  }

  setHasInteracted(userId, value) {
    const userContext = this.getUserContext(userId);
    userContext.hasInteracted = value;
    logger.info(`Estado de interacción actualizado para usuario ${userId}: ${value}`);
  }

  hasUserInteracted(userId) {
    return this.getUserContext(userId).hasInteracted;
  }

  updateContext(userId, message, role) {
    const userContext = this.getUserContext(userId);
    userContext.context += `${role}: ${message}\n`;
    userContext.chatContext.push({ role, content: message });
    this.limitContextSize(userId);
    logger.info(`Contexto actualizado para usuario ${userId}. Mensajes en contexto: ${userContext.chatContext.length}`);
  }

  limitContextSize(userId) {
    const userContext = this.getUserContext(userId);
    if (userContext.chatContext.length > 30) {
      userContext.chatContext = userContext.chatContext.slice(-10);
    }
    const words = userContext.context.split(/\s+/);
    if (words.length > 1500) {
      userContext.context = words.slice(-1500).join(" ");
    }
    logger.info(`Contexto limitado para usuario ${userId}`);
  }

  setGlobalData(services, additionalInfo) {
    this.services = services;
    this.additionalInfo = additionalInfo;
    logger.info('Datos globales actualizados en UserContextManager');
    logger.info(`Menú global: ${JSON.stringify(this.services)}`);
    logger.info(`Información adicional global: ${JSON.stringify(this.additionalInfo)}`);
  }

  updateCurrentOrder(userId, updates) {
    const userContext = this.getUserContext(userId);
    userContext.currentOrder = { ...userContext.currentOrder, ...updates };
    logger.info(`Orden actualizada para usuario ${userId}: ${JSON.stringify(userContext.currentOrder)}`);
    
    if (updates.service) {
      const serviceInfo = sheetService.getServiceInfo(updates.service);
      if (serviceInfo) {
        userContext.currentOrder.category = serviceInfo.category;
        userContext.currentOrder.type = serviceInfo.type;
        userContext.currentOrder.availableWidths = serviceInfo.availableWidths;
        userContext.currentOrder.availableFinishes = {
          sellado: serviceInfo.sellado,
          ojetillos: serviceInfo.ojetillos,
          bolsillo: serviceInfo.bolsillo
        };
        userContext.currentOrder.fileValidationCriteria = {
          format: serviceInfo.format,
          minDPI: serviceInfo.minDPI,
        };
        logger.info(`Servicio seleccionado para usuario ${userId}: ${JSON.stringify(serviceInfo)}`);
      } else {
        logger.warn(`Servicio no encontrado: ${updates.service}`);
      }
    }

    if (updates.fileAnalysis) {
      userContext.currentOrder.fileAnalysisResponded = false;
    }

    if (updates.fileValidation) {
      userContext.currentOrder.fileValidation = updates.fileValidation;
    }
    
    logger.info(`Orden actualizada para usuario ${userId}: ${JSON.stringify(userContext.currentOrder)}`);
  }

  updateFileAnalysisResponded(userId, value) {
    const userContext = this.getUserContext(userId);
    userContext.currentOrder.fileAnalysisResponded = value;
    logger.info(`FileAnalysisResponded actualizado para usuario ${userId}: ${value}`);
  }

  updateFileAnalysisHandled(userId, value) {
    const userContext = this.getUserContext(userId);
    userContext.currentOrder.fileAnalysisHandled = value;
    logger.info(`FileAnalysisHandled actualizado para usuario ${userId}: ${value}`);
  }

  hasFileAnalysisBeenResponded(userId) {
    const userContext = this.getUserContext(userId);
    return userContext.currentOrder.fileAnalysisResponded;
  }

  hasFileAnalysisBeenHandled(userId) {
    const userContext = this.getUserContext(userId);
    return userContext.currentOrder.fileAnalysisHandled;
  }

  getCurrentOrder(userId) {
    const userContext = this.getUserContext(userId);
    const currentOrder = userContext.currentOrder;
    currentOrder.requiresMeasures = () => this.isServiceRequiringMeasures(currentOrder.category);
    logger.info(`Obteniendo orden actual para usuario ${userId}: ${JSON.stringify(currentOrder)}`);
    return currentOrder;
  }

  resetContext(userId, resetInitialMessages = false) {
    const userContext = this.getUserContext(userId);
    const initialMessagesSent = resetInitialMessages ? false : userContext.initialMessagesSent;
    this.userContexts.set(userId, {
      context: "",
      chatContext: [],
      currentOrder: this.getEmptyOrder(),
      services: sheetService.getServices(),
      additionalInfo: sheetService.getAdditionalInfo(),
      initialMessagesSent: initialMessagesSent,
      hasInteracted: false  // Reiniciar hasInteracted
    });
    logger.info(`Contexto reiniciado para usuario ${userId}, initialMessagesSent preserved: ${!resetInitialMessages}, hasInteracted reset`);
  }

  getGlobalServices() {
    return sheetService.getServices();
  }

  getGlobalAdditionalInfo() {
    return sheetService.getAdditionalInfo();
  }

  getServiceInfo(serviceName) {
    return sheetService.getServiceInfo(serviceName);
  }

  getAllServices() {
    return sheetService.getAllServices();
  }

  findSimilarServices(serviceName) {
    return sheetService.findSimilarServices(serviceName);
  }

  getServicesInCategory(category) {
    return sheetService.getServicesInCategory(category);
  }

  getFileValidationCriteria() {
    return sheetService.getFileValidationCriteria();
  }

  getAvailableFinishes(serviceInfo) {
    const finishes = [];
    if (serviceInfo.sellado) finishes.push("sellado");
    if (serviceInfo.ojetillos) finishes.push("ojetillos");
    if (serviceInfo.bolsillo) finishes.push("bolsillo");
    return finishes;
  }

  // NUEVO: Función para obtener los campos faltantes en la orden actual
  getIncompleteFields(userId) {
    const order = this.getCurrentOrder(userId);
    const missingFields = [];

    // Verificar campos obligatorios
    if (!order.service) missingFields.push('service');
    if (!order.quantity) missingFields.push('quantity');
    if (!order.filePath) missingFields.push('filePath');
    if (!order.fileAnalysis) missingFields.push('fileAnalysis');
    if (!order.fileAnalysisResponded) missingFields.push('fileAnalysisResponded');
    if (!order.fileValidation) missingFields.push('fileValidation');

    // Verificar si el servicio requiere medidas
    if (this.isServiceRequiringMeasures(order.category)) {
      if (!order.measures || !order.measures.width) missingFields.push('width');
      if (!order.measures || !order.measures.height) missingFields.push('height');
      if (!order.areaServicio) missingFields.push('areaServicio');
    }

    logger.info(`Campos faltantes para usuario ${userId}: ${missingFields.join(', ')}`);

    return missingFields;
  }

  // MODIFICADO: isOrderComplete ahora utiliza getIncompleteFields
  isOrderComplete(userId) {
    const missingFields = this.getIncompleteFields(userId);
    return missingFields.length === 0;
  }


    // Método para determinar si el servicio requiere medidas
    isServiceRequiringMeasures(serviceCategory) {
      return ['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceCategory);
    }
  
  
  getChatContext(userId) {
    return this.getUserContext(userId).chatContext;
  }
}

export default new UserContextManager();
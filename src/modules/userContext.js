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
        initialMessagesSent: false // Añadido para rastrear si se enviaron los mensajes iniciales
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
    };
  }

   // Nuevo método para actualizar el estado general del usuario
   updateUserState(userId, updates) {
    const userContext = this.getUserContext(userId);
    Object.assign(userContext, updates);
    logger.info(`Estado del usuario ${userId} actualizado: ${JSON.stringify(updates)}`);
  }

   // Nuevo método para actualizar el contexto del usuario
   updateUserContext(userId, updates) {
    const userContext = this.getUserContext(userId);
    this.userContexts.set(userId, { ...userContext, ...updates });
    logger.info(`Contexto del usuario ${userId} actualizado: ${JSON.stringify(updates)}`);
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
      initialMessagesSent: initialMessagesSent
    });
    logger.info(`Contexto reiniciado para usuario ${userId}, initialMessagesSent preserved: ${!resetInitialMessages}`);
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

  isOrderComplete(userId) {
    const order = this.getCurrentOrder(userId);
    const requiredFields = ['service', 'quantity', 'filePath', 'fileAnalysis'];
    const hasAllRequiredFields = requiredFields.every(field => order[field] !== null);
  
    if (!hasAllRequiredFields) return false;
  
    const serviceInfo = this.getServiceInfo(order.service);
    const needsMeasures = this.isServiceRequiringMeasures(order.category);
  
    if (needsMeasures && (!order.measures || !order.measures.width || !order.measures.height || !order.areaServicio)) {
      return false;
    }
  
    // La validación del archivo ahora es manejada por el sistema de IA
    return true;
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
import logger from '../utils/logger.js';

class UserContextManager {
  constructor() {
    this.userContexts = new Map();
    this.services = null;
    this.additionalInfo = null;
  }

  setGlobalData(services, additionalInfo) {
    this.services = services;
    this.additionalInfo = additionalInfo;
    logger.info('Datos globales actualizados en UserContextManager');
  }

  getUserContext(userId) {
    if (!this.userContexts.has(userId)) {
      this.userContexts.set(userId, {
        context: "",
        chatContext: [],
        currentOrder: this.getEmptyOrder(),
        services: this.services,
        additionalInfo: this.additionalInfo
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
      availableWidths: [],
      availableFinishes: [],
      fileValidationCriteria: {},
      price: 0
    };
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
    if (userContext.chatContext.length > 10) {
      userContext.chatContext = userContext.chatContext.slice(-10);
    }
    const words = userContext.context.split(/\s+/);
    if (words.length > 1500) {
      userContext.context = words.slice(-1500).join(" ");
    }
    logger.info(`Contexto limitado para usuario ${userId}`);
  }

  updateCurrentOrder(userId, updates) {
    const userContext = this.getUserContext(userId);
    userContext.currentOrder = { ...userContext.currentOrder, ...updates };
    
    if (updates.service) {
      const serviceInfo = this.getServiceInfo(updates.service);
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
        logger.info(`Medidas de ancho disponibles para el servicio ${updates.service}: ${JSON.stringify(serviceInfo.availableWidths)}`);
        logger.info(`Terminaciones disponibles para el servicio ${updates.service}: ${JSON.stringify(userContext.currentOrder.availableFinishes)}`);
      } else {
        logger.warn(`Servicio no encontrado: ${updates.service}`);
      }
    }
    
    logger.info(`Orden actualizada para usuario ${userId}: ${JSON.stringify(userContext.currentOrder)}`);
  }
  
  getCurrentOrder(userId) {
    return this.getUserContext(userId).currentOrder;
  }

  getServiceInfo(serviceName) {
    for (const category in this.services) {
      const service = this.services[category].find(s => s.name.toLowerCase() === serviceName.toLowerCase());
      if (service) {
        return service;
      }
    }
    logger.warn(`Servicio no encontrado: ${serviceName}`);
    return null;
  }

  findSimilarServices(serviceName) {
    const allServices = this.getAllServices();
    return allServices
      .filter(service => 
        service.name.toLowerCase().includes(serviceName.toLowerCase()) || 
        serviceName.toLowerCase().includes(service.name.toLowerCase())
      )
      .map(service => ({
        name: service.name,
        category: service.category
      }));
  }

  getServicesInCategory(category) {
    return this.services[category] || [];
  }

  getAllServices() {
    let allServices = [];
    for (const category in this.services) {
      allServices = allServices.concat(this.services[category]);
    }
    return allServices;
  }

  getAvailableFinishes(serviceInfo) {
    const finishes = [];
    if (serviceInfo.sellado) finishes.push("sellado");
    if (serviceInfo.ojetillos) finishes.push("ojetillos");
    if (serviceInfo.bolsillo) finishes.push("bolsillo");
    return finishes;
  }

  resetContext(userId) {
    this.userContexts.delete(userId);
    logger.info(`Contexto reiniciado para usuario ${userId}`);
  }

  getGlobalServices() {
    return this.services;
  }

  getGlobalAdditionalInfo() {
    return this.additionalInfo;
  }

  isOrderComplete(userId) {
    const order = this.getCurrentOrder(userId);
    const requiredFields = ['service', 'quantity', 'filePath', 'fileAnalysis'];
    const hasAllRequiredFields = requiredFields.every(field => order[field] !== null);

    if (!hasAllRequiredFields) return false;

    const serviceInfo = this.getServiceInfo(order.service);
    const needsMeasures = ['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceInfo.category);

    if (needsMeasures && (!order.measures || !order.measures.width || !order.measures.height)) {
      return false;
    }

    return true;
  }

  getChatContext(userId) {
    return this.getUserContext(userId).chatContext;
  }
}

export default new UserContextManager();
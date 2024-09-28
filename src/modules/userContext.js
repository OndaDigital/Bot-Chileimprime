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
        currentOrder: {
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
        },
        services: this.services,
        additionalInfo: this.additionalInfo
      });
      logger.info(`Nuevo contexto creado para usuario ${userId}`);
    }
    return this.userContexts.get(userId);
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
      userContext.currentOrder.category = serviceInfo.category;
      userContext.currentOrder.type = serviceInfo.type;
      userContext.currentOrder.availableWidths = serviceInfo.availableWidths;
      userContext.currentOrder.availableFinishes = this.getAvailableFinishes(serviceInfo);
      userContext.currentOrder.fileValidationCriteria = {
        format: serviceInfo.format,
        minDPI: serviceInfo.minDPI,
      };
    }
    
    logger.info(`Orden actualizada para usuario ${userId}: ${JSON.stringify(userContext.currentOrder)}`);
  }

  getServiceInfo(serviceName) {
    for (const category in this.services) {
      const service = this.services[category].find(s => s.name === serviceName);
      if (service) {
        return service;
      }
    }
    throw new Error(`Servicio no encontrado: ${serviceName}`);
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
    const userContext = this.getUserContext(userId);
    const order = userContext.currentOrder;

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

  calculatePrice(userId) {
    const userContext = this.getUserContext(userId);
    const order = userContext.currentOrder;
    const serviceInfo = this.getServiceInfo(order.service);

    let total = 0;

    if (['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceInfo.category)) {
      const area = order.measures.width * order.measures.height;
      total = area * serviceInfo.precio * order.quantity;

      if (order.finishes.sellado) total += serviceInfo.precioSellado * area;
      if (order.finishes.ojetillos) total += serviceInfo.precioOjetillos * area;
      if (order.finishes.bolsillo) total += serviceInfo.precioBolsillo * area;
    } else {
      total = serviceInfo.precio * order.quantity;

      if (order.finishes.sellado) total += serviceInfo.precioSellado * order.quantity;
      if (order.finishes.ojetillos) total += serviceInfo.precioOjetillos * order.quantity;
      if (order.finishes.bolsillo) total += serviceInfo.precioBolsillo * order.quantity;
    }

    userContext.currentOrder.price = total;
    return total;
  }

  getChatContext(userId) {
    const userContext = this.getUserContext(userId);
    return userContext.chatContext;
  }
}

export default new UserContextManager();
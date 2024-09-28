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
        currentOrder: {
          service: null,
          category: null,
          type: null,
          measures: null,
          finishes: null,
          quantity: null,
          filePath: null,
          fileAnalysis: null,
          availableWidths: [],
          availableFinishes: [],
          fileValidationCriteria: {}
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

  updateCurrentOrder(userId, updates) {
    const userContext = this.getUserContext(userId);
    userContext.currentOrder = { ...userContext.currentOrder, ...updates };
    
    // Actualizar fileValidationCriteria basado en el servicio seleccionado
    if (updates.service) {
      const serviceInfo = this.services[updates.service];
      userContext.currentOrder.fileValidationCriteria = {
        format: serviceInfo.format,
        minDPI: serviceInfo.minDPI,
        // Agregar más criterios según sea necesario
      };
    }
    
    logger.info(`Orden actualizada para usuario ${userId}: ${JSON.stringify(userContext.currentOrder)}`);
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
}

export default new UserContextManager();
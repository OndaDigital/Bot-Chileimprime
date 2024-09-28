// modules/userContext.js

import logger from '../utils/logger.js';

class UserContextManager {
  constructor() {
    this.userContexts = new Map();
    this.globalMenu = null;
    this.globalAdditionalInfo = null;
  }

  setGlobalData(menu, additionalInfo) {
    this.globalMenu = menu;
    this.globalAdditionalInfo = additionalInfo;
    logger.info('Datos globales actualizados en UserContextManager');
    logger.info(`Menú global: ${JSON.stringify(this.globalMenu)}`);
    logger.info(`Información adicional global: ${JSON.stringify(this.globalAdditionalInfo)}`);
  }

  getUserContext(userId) {
    if (!this.userContexts.has(userId)) {
      this.userContexts.set(userId, {
        context: "",
        currentOrder: { items: [] },
        menu: this.globalMenu,
        additionalInfo: this.globalAdditionalInfo
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

  resetContext(userId) {
    this.userContexts.delete(userId);
    logger.info(`Contexto reiniciado para usuario ${userId}`);
  }

  getGlobalMenu() {
    return this.globalMenu;
  }

  getGlobalAdditionalInfo() {
    return this.globalAdditionalInfo;
  }
}

export default new UserContextManager();
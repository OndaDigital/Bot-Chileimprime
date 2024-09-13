//  blacklistManager.js - bot de imprenta

import Logger from './logger.js';

const logger = new Logger();

class BlacklistManager {
  constructor() {
    this.blacklist = new Map();
  }

  addToBlacklist(userId, duration) {
    this.blacklist.set(userId, Date.now() + duration);
    logger.info(`Usuario ${userId} añadido a la lista negra por ${duration/1000} segundos`);
  }

  isBlacklisted(userId) {
    if (this.blacklist.has(userId)) {
      const blacklistExpiry = this.blacklist.get(userId);
      if (Date.now() < blacklistExpiry) {
        logger.info(`Usuario ${userId} está en la lista negra`);
        return true;
      } else {
        this.blacklist.delete(userId);
        logger.info(`Usuario ${userId} removido de la lista negra`);
      }
    }
    return false;
  }

  removeFromBlacklist(userId) {
    this.blacklist.delete(userId);
    logger.info(`Usuario ${userId} removido manualmente de la lista negra`);
  }
}

export default BlacklistManager;
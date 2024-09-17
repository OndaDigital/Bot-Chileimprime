//  blacklistManager.js - bot de imprenta

import Logger from './logger.js';

class BlacklistManager {
  constructor() {
    this.blacklist = new Map();
    this.logger = new Logger();
  }

  addToBlacklist(userId, duration) {
    const expiryTime = Date.now() + duration;
    this.blacklist.set(userId, expiryTime);
    this.logger.info(`Usuario ${userId} añadido a la lista negra hasta ${new Date(expiryTime)}`);
  }

  isBlacklisted(userId) {
    if (this.blacklist.has(userId)) {
      const expiryTime = this.blacklist.get(userId);
      if (Date.now() < expiryTime) {
        this.logger.info(`Usuario ${userId} está en la lista negra`);
        return true;
      } else {
        this.blacklist.delete(userId);
        this.logger.info(`Usuario ${userId} removido de la lista negra`);
      }
    }
    return false;
  }

  removeFromBlacklist(userId) {
    if (this.blacklist.delete(userId)) {
      this.logger.info(`Usuario ${userId} removido manualmente de la lista negra`);
    }
  }

  getBlacklistStatus() {
    return Array.from(this.blacklist, ([userId, expiryTime]) => ({
      userId,
      expiryTime: new Date(expiryTime)
    }));
  }
}

export default BlacklistManager;
import { UserContext } from '../models/user-context.js';
import { logger } from '../utils/logger.js';

class UserSessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionTimeout = 30 * 60 * 1000; // 30 minutos
  }

  getSession(userId) {
    let session = this.sessions.get(userId);
    if (!session) {
      session = new UserContext(userId);
      this.sessions.set(userId, session);
      logger.info(`New session created for user ${userId}`);
    } else {
      session.updateLastInteraction();
    }
    return session;
  }

  updateSession(userId, updates) {
    const session = this.getSession(userId);
    Object.assign(session, updates);
    logger.info(`Session updated for user ${userId}`);
  }

  clearSession(userId) {
    this.sessions.delete(userId);
    logger.info(`Session cleared for user ${userId}`);
  }

  cleanupSessions() {
    const now = Date.now();
    for (const [userId, session] of this.sessions.entries()) {
      if (now - session.lastInteraction > this.sessionTimeout) {
        this.clearSession(userId);
      }
    }
  }

  startCleanupInterval() {
    setInterval(() => this.cleanupSessions(), 5 * 60 * 1000); // Limpiar cada 5 minutos
  }
}

export const userSessionManager = new UserSessionManager();
userSessionManager.startCleanupInterval();
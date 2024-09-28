// modules/messageQueue.js

import logger from '../utils/logger.js';

class MessageQueue {
  constructor(config) {
    this.queue = new Map();
    this.config = config;
  }

  enqueueMessage(userId, messageText, callback) {
    logger.info(`Encolando mensaje para usuario ${userId}. Mensaje: ${messageText}`);
    
    if (!this.queue.has(userId)) {
      this.queue.set(userId, { messages: [], timer: null });
      logger.info(`Nueva cola creada para usuario ${userId}`);
    }

    const userQueue = this.queue.get(userId);
    userQueue.messages.push(messageText);

    logger.info(`Mensaje añadido a la cola del usuario ${userId}. Mensajes en cola: ${userQueue.messages.length}`);

    clearTimeout(userQueue.timer);

    userQueue.timer = setTimeout(() => {
      logger.info(`Temporizador expirado para usuario ${userId}. Procesando cola...`);
      const messages = userQueue.messages;
      this.queue.delete(userId);
      logger.info(`Cola procesada y eliminada para usuario ${userId}. Mensajes procesados: ${messages.length}`);
      if (typeof callback === 'function') {
        try {
          callback(messages.join(" "));
        } catch (error) {
          logger.error(`Error en el callback para usuario ${userId}: ${error.message}`);
        }
      }
    }, this.config.gapSeconds);
  }

  clearQueue(userId) {
    if (this.queue.has(userId)) {
      const userQueue = this.queue.get(userId);
      clearTimeout(userQueue.timer);
      this.queue.delete(userId);
      logger.info(`Cola eliminada para usuario ${userId}`);
    }
  }

  getQueueSize(userId) {
    if (this.queue.has(userId)) {
      return this.queue.get(userId).messages.length;
    }
    return 0;
  }

  isQueueEmpty(userId) {
    return this.getQueueSize(userId) === 0;
  }
}

export default MessageQueue;
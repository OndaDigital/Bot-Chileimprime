// queueManager.js

import Logger from './logger.js';

const logger = new Logger();

class QueueManager {
  constructor(config = { timeout: 3000 }) {
    this.queue = new Map();
    this.config = config;
  }

  enqueue(userId, message, callback) {
    logger.info(`Encolando mensaje para usuario ${userId}`);
    
    if (!this.queue.has(userId)) {
      this.queue.set(userId, { messages: [], timer: null });
    }

    const userQueue = this.queue.get(userId);
    userQueue.messages.push(message);

    clearTimeout(userQueue.timer);

    userQueue.timer = setTimeout(() => {
      logger.info(`Procesando cola para usuario ${userId}`);
      const messages = userQueue.messages;
      this.queue.delete(userId);
      if (typeof callback === 'function') {
        callback(messages.join(" "));
      }
    }, this.config.timeout);
  }
}

export default QueueManager;
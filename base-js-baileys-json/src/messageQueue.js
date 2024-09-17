// messageQueue.js - bot de la imprenta

import Logger from './logger.js';

class MessageQueue {
  constructor() {
    this.queues = new Map();
    this.logger = new Logger();
  }

  enqueue(userId, callback) {
    if (!this.queues.has(userId)) {
      this.queues.set(userId, []);
      this.logger.info(`[MessageQueue] Nueva cola creada para usuario ${userId}`);
    }
    this.queues.get(userId).push(callback);
    this.logger.info(`[MessageQueue] Mensaje encolado para usuario ${userId}. Longitud de la cola: ${this.queues.get(userId).length}`);
    
    this.processQueue(userId);
  }
  
  async processQueue(userId) {
    const queue = this.queues.get(userId);
    if (!queue || queue.length === 0) {
      this.logger.info(`[MessageQueue] Cola vacía para usuario ${userId}`);
      return;
    }
  
    this.logger.info(`[MessageQueue] Procesando cola para usuario ${userId}. Mensajes en cola: ${queue.length}`);
    while (queue.length > 0) {
      const callback = queue.shift();
      try {
        await callback();
        this.logger.info(`[MessageQueue] Mensaje procesado para usuario ${userId}. Mensajes restantes: ${queue.length}`);
      } catch (error) {
        this.logger.error(`[MessageQueue] Error procesando mensaje para usuario ${userId}: ${error.message}`);
      }
    }
    this.logger.info(`[MessageQueue] Procesamiento de cola completado para usuario ${userId}`);
  }

  clearQueue(userId) {
    if (this.queues.has(userId)) {
      this.queues.delete(userId);
      this.logger.info(`Cola limpiada para usuario ${userId}`);
    }
  }

  getQueueStatus() {
    return Array.from(this.queues, ([userId, queue]) => ({
      userId,
      queueLength: queue.length
    }));
  }
}

export default MessageQueue;
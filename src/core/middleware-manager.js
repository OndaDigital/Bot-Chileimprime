import { logger } from '../utils/logger.js';

class MiddlewareManager {
  constructor() {
    this.middlewares = [];
  }

  use(middleware) {
    this.middlewares.push(middleware);
    logger.info(`Middleware registered: ${middleware.name}`);
  }

  async run(ctx, next) {
    let index = 0;
    const runner = async () => {
      if (index < this.middlewares.length) {
        await this.middlewares[index++](ctx, runner);
      } else {
        await next();
      }
    };
    await runner();
  }
}

export const middlewareManager = new MiddlewareManager();
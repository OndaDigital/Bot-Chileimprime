// middleware/logging-middleware.js
import { logger } from '../utils/logger.js';

export async function loggingMiddleware(ctx, next) {
  const startTime = Date.now();
  const initialState = ctx.userContext.getState();

  logger.info(`Processing message for user ${ctx.from}`, {
    initialState,
    message: ctx.body,
  });

  await next();

  const endTime = Date.now();
  const finalState = ctx.userContext.getState();
  
  logger.info(`Finished processing message for user ${ctx.from}`, {
    initialState,
    finalState,
    processingTime: `${endTime - startTime}ms`,
  });
}
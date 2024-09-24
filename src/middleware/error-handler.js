import { logger } from '../utils/logger.js';

export async function errorHandler(ctx, next) {
  try {
    await next();
  } catch (error) {
    logger.error('Error in request pipeline', error);
    await ctx.reply('Lo siento, ha ocurrido un error. Por favor, intenta nuevamente más tarde.');
  }
}
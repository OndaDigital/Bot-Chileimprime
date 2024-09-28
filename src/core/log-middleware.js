import logger from '../utils/logger.js';

const logMiddleware = async (ctx) => {
  const { from, body } = ctx;
  logger.info(`Mensaje recibido de ${from}: ${body}`);
  return false; // Continuar con el flujo normal
};

export default logMiddleware;
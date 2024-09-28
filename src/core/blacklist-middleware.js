// core/blacklist-middleware.js

import logger from '../utils/logger.js';

const blacklistMiddleware = (flowManager) => async (ctx, { endFlow }) => {
  const userId = ctx.from;

  if (flowManager.isBlacklisted(userId)) {
    logger.info(`Usuario ${userId} en lista negra. Mensaje ignorado.`);
    return endFlow();
  }

  return false; // Continuar con el flujo normal
};

export default blacklistMiddleware;
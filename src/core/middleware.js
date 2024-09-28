// core/middleware.js

import logger from '../utils/logger.js';

const createMiddleware = (middlewares) => {
  return async (ctx, { flowDynamic, endFlow }) => {
    for (const middleware of middlewares) {
      try {
        const result = await middleware(ctx, { flowDynamic, endFlow });
        if (result === true) {
          return true; // Middleware ha manejado la solicitud, detener el flujo
        }
      } catch (error) {
        logger.error(`Error en middleware: ${error.message}`);
        await flowDynamic('Lo siento, ha ocurrido un error. Por favor, inténtalo de nuevo más tarde.');
        return endFlow();
      }
    }
    return false; // Continuar con el flujo normal
  };
};

export default createMiddleware;

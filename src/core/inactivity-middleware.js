// core/inactivity-middleware.js

import logger from '../utils/logger.js';
import config from '../config/config.js';

const inactivityMiddleware = (flowManager) => async (ctx, { flowDynamic, gotoFlow }) => {
  const userId = ctx.from;

  // Verificar blacklist
  if (flowManager.isBlacklisted(userId)) {
    logger.info(`Usuario ${userId} en blacklist - omitiendo timers de inactividad`);
    return false;
  }

  flowManager.clearIdleTimer(userId);
  
  // Función auxiliar para verificar blacklist antes de ejecutar una acción
  const executeIfNotBlacklisted = async (action) => {
    if (!flowManager.isBlacklisted(userId)) {
      await action();
    }
  };

  const warningTimer = setTimeout(
    () => executeIfNotBlacklisted(async () => {
      await flowDynamic('*⏰ ¿Sigues ahí? Si necesitas más tiempo, por favor responde cualquier mensaje.*');
    }), 
    config.idleWarningTime
  );

  const timeoutTimer = setTimeout(
    () => executeIfNotBlacklisted(() => {
      flowManager.resetConversation(userId);
      gotoFlow(flowManager.getIdleTimeoutFlow());
    }), 
    config.idleTimeoutTime
  );

  flowManager.setIdleTimers(userId, { warningTimer, timeoutTimer });
  return false;
};

export default inactivityMiddleware;
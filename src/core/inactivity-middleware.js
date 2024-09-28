// core/inactivity-middleware.js

import logger from '../utils/logger.js';
import config from '../config/config.js';

const inactivityMiddleware = (flowManager) => async (ctx, { flowDynamic, gotoFlow }) => {
  const userId = ctx.from;

  flowManager.clearIdleTimer(userId);
  
  const warningTimer = setTimeout(async () => {
    await flowDynamic('*⏰ ¿Sigues ahí? Si necesitas más tiempo, por favor responde cualquier mensaje.*');
  }, config.idleWarningTime);

  const timeoutTimer = setTimeout(() => {
    flowManager.resetConversation(userId);
    gotoFlow(flowManager.getIdleTimeoutFlow());
  }, config.idleTimeoutTime);

  flowManager.setIdleTimers(userId, { warningTimer, timeoutTimer });

  return false; // Continuar con el flujo normal
};

export default inactivityMiddleware;
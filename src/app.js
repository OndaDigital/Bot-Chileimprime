// app.js

import "dotenv/config";
import flowManager from './modules/flowManager.js';
import whatsappService from './services/whatsappService.js';
import sheetService from './services/sheetService.js';
import logger from './utils/logger.js';
import createMiddleware from './core/middleware.js';
import logMiddleware from './core/log-middleware.js';
import userContextManager from './modules/userContext.js';
import config from './config/config.js';
import { errorHandler } from './utils/errorHandler.js';

const middleware = createMiddleware([logMiddleware]);

const initializeServices = async () => {
  let menu = null;
  let additionalInfo = null;

  try {
    await sheetService.initialize();
    menu = await sheetService.getMenu();
    additionalInfo = await sheetService.getAdditionalInfo();
    
    userContextManager.setGlobalData(menu, additionalInfo);

    logger.info("Menú e información adicional inicializados correctamente");
    logger.info(`Menú (truncado): ${JSON.stringify(menu).substring(0, 100)}...`);
    logger.info(`Info adicional (truncada): ${JSON.stringify(additionalInfo).substring(0, 100)}...`);
  } catch (error) {
    logger.error(`Error al inicializar servicios: ${error.message}`);
    logger.warn("Iniciando con funcionalidad reducida");
  }

  return { menu, additionalInfo };
};

const main = async () => {
  try {
    const { menu, additionalInfo } = await initializeServices();

    const flows = await flowManager.initializeFlows();

    // Aplicar middleware a todos los flujos
    flows.forEach(flow => {
      flow.addAction(middleware);
    });

    await whatsappService.initialize(flows);

    logger.info('Bot inicializado correctamente');

    if (menu && additionalInfo) {
      logger.info('Bot iniciado con todas las funcionalidades');
    } else {
      logger.warn('Bot iniciado con funcionalidad reducida. Algunas características pueden no estar disponibles.');
    }

    // Configurar actualización periódica del menú y la información adicional
    setInterval(async () => {
      try {
        await sheetService.reinitialize();
        const updatedMenu = await sheetService.getMenu();
        const updatedAdditionalInfo = await sheetService.getAdditionalInfo();
        userContextManager.setGlobalData(updatedMenu, updatedAdditionalInfo);
        logger.info("Menú e información adicional actualizados correctamente");
      } catch (error) {
        logger.error(`Error al actualizar menú e información adicional: ${error.message}`);
      }
    }, config.menuUpdateInterval);

  } catch (error) {
    logger.error(`Error crítico al inicializar el bot: ${error.message}`);
    process.exit(1);
  }
};

main().catch(err => {
  logger.error('Error fatal en main:', err);
  process.exit(1);
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`);
  // Implementar lógica adicional si es necesario (por ejemplo, reiniciar el bot)
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
  // Implementar lógica adicional si es necesario
});
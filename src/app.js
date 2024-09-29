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
import fileValidationService from './services/fileValidationService.js';

const middleware = createMiddleware([logMiddleware]);

const initializeServices = async () => {
  let services = null;
  let additionalInfo = null;

  try {
    await sheetService.initialize();

    services = await sheetService.getServices();
    additionalInfo = await sheetService.getAdditionalInfo();
    
    if (services && additionalInfo) {
      userContextManager.setGlobalData(services, additionalInfo);
      logger.info("Servicios e información adicional inicializados correctamente");
    } else {
      throw new Error("No se pudieron obtener los servicios o la información adicional");
    }
  } catch (error) {
    logger.error(`Error al inicializar servicios: ${error.message}`);
    logger.warn("Iniciando con funcionalidad reducida");
  }

  return { services, additionalInfo };
};

const main = async () => {
  try {
    const { services, additionalInfo } = await initializeServices();

    const flows = await flowManager.initializeFlows();

    flows.forEach(flow => {
      flow.addAction(middleware);
    });

    await whatsappService.initialize(flows);

    logger.info('Bot inicializado correctamente');

    if (services && additionalInfo) {
      logger.info('Bot iniciado con todas las funcionalidades');
    } else {
      logger.warn('Bot iniciado con funcionalidad reducida. Algunas características pueden no estar disponibles.');
    }

    // Configurar actualización periódica de los servicios y la información adicional
    setInterval(async () => {
      try {
        await sheetService.reinitialize();
        const updatedServices = await sheetService.getServices();
        const updatedAdditionalInfo = await sheetService.getAdditionalInfo();
        if (updatedServices && updatedAdditionalInfo) {
          userContextManager.setGlobalData(updatedServices, updatedAdditionalInfo);
          logger.info("Servicios e información adicional actualizados correctamente");
        } else {
          logger.warn("No se pudieron actualizar los servicios o la información adicional");
        }
      } catch (error) {
        logger.error(`Error al actualizar servicios e información adicional: ${error.message}`);
      }
    }, config.servicesUpdateInterval);

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
import logger from './logger.js';

export class CustomError extends Error {
  constructor(name, message, originalError = null) {
    super(message);
    this.name = name;
    this.originalError = originalError;
  }
}

export const errorHandler = async (error, ctx, { flowDynamic, endFlow }) => {
  logger.error(`Error: ${error.name} - ${error.message}`);
  if (error.originalError) {
    logger.error(`Error original: ${error.originalError.message}`);
    logger.error(`Stack trace: ${error.originalError.stack}`);
  }

  let userMessage = 'Lo siento, ha ocurrido un error inesperado. Por favor, inténtalo de nuevo más tarde.';

  switch (error.name) {
    case 'OpenAIError':
      userMessage = 'Estamos experimentando problemas con nuestro servicio de IA. Por favor, inténtalo de nuevo en unos minutos.';
      break;
    case 'SheetServiceError':
      userMessage = 'Hay un problema temporal con nuestro sistema de pedidos. Por favor, inténtalo de nuevo más tarde.';
      break;
    case 'WhatsAppError':
      userMessage = 'Estamos teniendo dificultades para procesar tu mensaje. Por favor, inténtalo de nuevo.';
      break;
    case 'MiddlewareError':
      userMessage = 'Ha ocurrido un error al procesar tu solicitud. Por favor, inténtalo de nuevo.';
      break;
  }

  await flowDynamic(userMessage);
  return endFlow();
};
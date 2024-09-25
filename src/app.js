// app.js

import { createBot, createProvider, createFlow, addKeyword, MemoryDB, EVENTS } from '@builderbot/bot';
import { BaileysProvider } from '@builderbot/provider-baileys';
import { openaiService } from './services/openai-service.js';
import { sheetsService } from './services/sheets-service.js';
import { conversationManager } from './core/conversation-manager.js';
import { commandHandler } from './core/command-handler.js';
import { userSessionManager } from './core/user-session-manager.js';
import { middlewareManager } from './core/middleware-manager.js';
import { messageProcessor } from './middleware/message-processor.js';
import { errorHandler } from './middleware/error-handler.js';
import { quoteCommand } from './commands/quote-command.js';
import { listServicesCommand } from './commands/list-services-command.js';
import { additionalInfoCommand } from './commands/additional-info-command.js';
import { createOrderCommand } from './commands/create-order-command.js';
import { greetingCommand } from './commands/greeting-command.js';
import { defaultCommand } from './commands/default-command.js';
import { logger } from './utils/logger.js';
import { pluginManager } from './core/plugin-manager.js';
import { examplePlugin } from './plugins/example-plugin.js';
import config from './config/index.js';

const PORT = config.port;

// Registrar plugins
pluginManager.registerPlugin('examplePlugin', examplePlugin);

// Registrar comandos
commandHandler.registerCommand('GREETING', greetingCommand);
commandHandler.registerCommand('QUOTE', quoteCommand);
commandHandler.registerCommand('LIST_SERVICES', listServicesCommand);
commandHandler.registerCommand('ADDITIONAL_INFO', additionalInfoCommand);
commandHandler.registerCommand('CREATE_ORDER', createOrderCommand);
commandHandler.registerDefaultCommand(defaultCommand);


// Configurar middleware
middlewareManager.use(messageProcessor);
middlewareManager.use(errorHandler);

// Configurar estados de conversación
conversationManager.registerState('INITIAL', async (ctx, action, { flowDynamic }) => {
  await flowDynamic('Bienvenido a la imprenta. ¿En qué puedo ayudarte?');
});

conversationManager.registerState('MAIN_MENU', async (ctx, action, { flowDynamic }) => {
  await commandHandler.executeCommand(action, ctx, { flowDynamic });
});

conversationManager.registerState('LISTING_SERVICES', async (ctx, action, { flowDynamic }) => {
  const serviceList = await sheetsService.getFormattedServiceList();
  await flowDynamic(serviceList);
});

conversationManager.registerState('PROVIDING_ADDITIONAL_INFO', async (ctx, action, { flowDynamic }) => {
  const additionalInfo = await sheetsService.getFormattedAdditionalInfo();
  await flowDynamic(additionalInfo);
});

conversationManager.registerState('QUOTING', async (ctx, action, { flowDynamic }) => {
  await flowDynamic('Por favor, proporciona los detalles del servicio que deseas cotizar.');
});

conversationManager.registerState('CREATING_ORDER', async (ctx, action, { flowDynamic }) => {
  await flowDynamic('Vamos a crear tu pedido. Por favor, proporciona los detalles del servicio que deseas ordenar.');
});

// Configurar transiciones
conversationManager.registerTransition('INITIAL', 'MAIN_MENU', () => true);
conversationManager.registerTransition('MAIN_MENU', 'LISTING_SERVICES', (ctx, action) => action === 'LIST_SERVICES');
conversationManager.registerTransition('MAIN_MENU', 'PROVIDING_ADDITIONAL_INFO', (ctx, action) => action === 'ADDITIONAL_INFO');
conversationManager.registerTransition('MAIN_MENU', 'QUOTING', (ctx, action) => action === 'QUOTE');
conversationManager.registerTransition('MAIN_MENU', 'CREATING_ORDER', (ctx, action) => action === 'CREATE_ORDER');



// Configurar flujo principal
const mainFlow = addKeyword([EVENTS.WELCOME, 'hola', 'inicio', 'menu'])
  .addAction(async (ctx, { flowDynamic, gotoFlow }) => {
    const userId = ctx.from;
    ctx.userContext = userSessionManager.getSession(userId);

    try {
      await middlewareManager.run(ctx, { flowDynamic, gotoFlow });
      await conversationManager.handleMessage(ctx, { flowDynamic, gotoFlow });
    } catch (error) {
      logger.error(`Error in main flow for user ${userId}`, error);
      await flowDynamic('Lo siento, ha ocurrido un error inesperado. Por favor, intenta de nuevo más tarde.');
    }
  });

// Inicializar bot
const main = async () => {
  try {
    await openaiService.initialize();
    await sheetsService.initialize();

    const adapterDB = new MemoryDB();
    const adapterFlow = createFlow([mainFlow]);
    const adapterProvider = createProvider(BaileysProvider);

    const { httpServer } = await createBot({
      flow: adapterFlow,
      provider: adapterProvider,
      database: adapterDB,
    });

    if (httpServer) {
      httpServer(PORT);
      logger.info(`HTTP Server is running on port ${PORT}`);
    } else {
      logger.warn('HTTP Server is not available in this BuilderBot version');
    }

    logger.info('Bot initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize bot', error);
    process.exit(1);
  }
};

main().catch(error => {
  logger.error('Unhandled error in main function', error);
  process.exit(1);
});
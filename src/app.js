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
import { analyzeFileCommand } from './commands/analyze-file-command.js';
import { generateBudgetCommand } from './commands/generate-budget-command.js';
import { logger } from './utils/logger.js';
import { pluginManager } from './core/plugin-manager.js';
import { examplePlugin } from './plugins/example-plugin.js';
import config from './config/index.js';

const PORT = process.env.PORT || 3000;

// Registrar plugins
pluginManager.registerPlugin('examplePlugin', examplePlugin);

// Registrar comandos
commandHandler.registerCommand('QUOTE', quoteCommand);
commandHandler.registerCommand('ANALYZE_FILE', analyzeFileCommand);
commandHandler.registerCommand('GENERATE_BUDGET', generateBudgetCommand);

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

conversationManager.registerState('SELECTING_SERVICE', async (ctx, action, { flowDynamic }) => {
  await flowDynamic('Por favor, selecciona un servicio de impresión.');
});

conversationManager.registerState('ENTERING_MEASUREMENTS', async (ctx, action, { flowDynamic }) => {
  await flowDynamic('Por favor, ingresa las medidas del producto.');
});

conversationManager.registerState('SELECTING_FINISHES', async (ctx, action, { flowDynamic }) => {
  await flowDynamic('¿Deseas algún acabado especial?');
});

conversationManager.registerState('UPLOADING_FILE', async (ctx, action, { flowDynamic }) => {
  await flowDynamic('Por favor, sube tu archivo de diseño.');
});

conversationManager.registerState('CONFIRMING_ORDER', async (ctx, action, { flowDynamic }) => {
  await flowDynamic('¿Confirmas tu pedido?');
});

// Configurar transiciones
conversationManager.registerTransition('INITIAL', 'MAIN_MENU', () => true);
conversationManager.registerTransition('MAIN_MENU', 'SELECTING_SERVICE', (ctx, action) => action === 'QUOTE');
conversationManager.registerTransition('MAIN_MENU', 'UPLOADING_FILE', (ctx, action) => action === 'ANALYZE_FILE');
conversationManager.registerTransition('MAIN_MENU', 'CONFIRMING_ORDER', (ctx, action) => action === 'GENERATE_BUDGET');
conversationManager.registerTransition('SELECTING_SERVICE', 'ENTERING_MEASUREMENTS', () => true);
conversationManager.registerTransition('ENTERING_MEASUREMENTS', 'SELECTING_FINISHES', () => true);
conversationManager.registerTransition('SELECTING_FINISHES', 'UPLOADING_FILE', () => true);
conversationManager.registerTransition('UPLOADING_FILE', 'CONFIRMING_ORDER', () => true);
conversationManager.registerTransition('CONFIRMING_ORDER', 'MAIN_MENU', () => true);

// Configurar flujo principal
const mainFlow = addKeyword([EVENTS.WELCOME, 'hola', 'inicio', 'menu'])
  .addAction(async (ctx, { flowDynamic, gotoFlow }) => {
    const userId = ctx.from;
    ctx.userContext = userSessionManager.getSession(userId);

    try {
      await middlewareManager.run(ctx, { flowDynamic, gotoFlow });
      await flowDynamic('¡Bienvenido a la imprenta! ¿En qué puedo ayudarte hoy?');
      await conversationManager.handleMessage(ctx, { flowDynamic, gotoFlow });
    } catch (error) {
      logger.error(`Error in main flow for user ${userId}`, error);
      if (error instanceof ApplicationError) {
        await flowDynamic(error.message);
      } else {
        await flowDynamic('Lo siento, ha ocurrido un error inesperado. Por favor, intenta de nuevo más tarde.');
      }
    }
  });

  // Agregar un comando por defecto
const defaultCommand = {
    execute: async (ctx) => {
      const { flowDynamic } = ctx;
      await flowDynamic('Lo siento, no he entendido tu solicitud. ¿Podrías reformularla o elegir una de las opciones disponibles?');
    }
  };

  commandHandler.registerDefaultCommand(defaultCommand);


// Inicializar bot
const main = async () => {
  try {
    await openaiService.initialize();
    await sheetsService.initialize();

    const adapterDB = new MemoryDB();
    const adapterFlow = createFlow([mainFlow]);
    const adapterProvider = createProvider(BaileysProvider, {
      // Agregar configuración específica de Baileys si es necesario
    });

    const { httpServer } = await createBot({
      flow: adapterFlow,
      provider: adapterProvider,
      database: adapterDB,
    });

    // Iniciar el servidor HTTP
    if (httpServer) {
      httpServer(PORT);
      logger.info(`HTTP Server is running on port ${PORT}`);
    } else {
      logger.warn('HTTP Server is not available in this BuilderBot version');
    }

    logger.info('Bot initialized successfully');
    logger.info('Scan the QR code with your WhatsApp to start the bot');
  } catch (error) {
    logger.error('Failed to initialize bot', error);
    process.exit(1);
  }
};

main().catch(error => {
  logger.error('Unhandled error in main function', error);
  process.exit(1);
});
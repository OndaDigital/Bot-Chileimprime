// app.js - Bot de imprenta

// app.js
import 'dotenv/config';
import { createBot, createProvider, createFlow, addKeyword, EVENTS } from '@builderbot/bot';
import { MemoryDB } from '@builderbot/bot';
import { BaileysProvider } from '@builderbot/provider-baileys';
import OpenAIService from './openaiService.js';
import SheetService from './sheetService.js';
import FileAnalyzer from './fileAnalyzer.js';
import PrintingCalculator from './printingCalculator.js';
import Logger from './logger.js';
import BlacklistManager from './blacklistManager.js';
import MessageQueue from './messageQueue.js';
import ConversationManager from './conversationManager.js';
import path from 'path';
import fs from 'fs/promises';

const PORT = process.env.PORT ?? 3000;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const logger = new Logger();
const sheetService = new SheetService(SHEET_ID);
const openaiService = new OpenAIService(OPENAI_API_KEY);
const fileAnalyzer = new FileAnalyzer();
const printingCalculator = new PrintingCalculator();
const blacklistManager = new BlacklistManager();
const messageQueue = new MessageQueue();
const conversationManager = new ConversationManager(openaiService, sheetService, fileAnalyzer, printingCalculator);

const TMP_DIR = path.join(process.cwd(), 'tmp');

const initializeBot = async () => {
  try {
    await fs.access(TMP_DIR);
  } catch {
    await fs.mkdir(TMP_DIR, { recursive: true });
  }

  await sheetService.initialize();
  await conversationManager.initialize();
  logger.info('Bot inicializado correctamente');
};

const handleMessage = async (ctx, { flowDynamic, gotoFlow, endFlow }) => {
  const userId = ctx.from;
  logger.info(`[App] Mensaje recibido de usuario ${userId}: ${ctx.body}`);

  if (blacklistManager.isBlacklisted(userId)) {
    logger.info(`[App] Usuario ${userId} en lista negra. Finalizando flujo.`);
    return endFlow('Lo siento, tu acceso está temporalmente restringido.');
  }

  try {
    await messageQueue.enqueue(userId, async () => {
      logger.info(`[App] Procesando mensaje para usuario ${userId}`);
      const response = await conversationManager.handleMessage(ctx);
      await flowDynamic(response);
      logger.info(`[App] Respuesta enviada a usuario ${userId}: ${response}`);

      if (response.includes('{FINALIZAR_CONVERSACION}')) {
        logger.info(`[App] Finalizando conversación para usuario ${userId}`);
        blacklistManager.addToBlacklist(userId, 10 * 60 * 1000);
        return endFlow('Gracias por tu cotización. Un representante se pondrá en contacto contigo pronto.');
      }
    });
  } catch (error) {
    logger.error(`[App] Error al procesar mensaje para usuario ${userId}: ${error.message}`);
    await flowDynamic('Lo siento, ha ocurrido un error. Por favor, intenta nuevamente.');
  }
};

const flowPrincipal = addKeyword(EVENTS.WELCOME)
  .addAction(handleMessage);

const flowDocument = addKeyword(EVENTS.DOCUMENT)
  .addAction(async (ctx, { flowDynamic, provider }) => {
    const userId = ctx.from;
    const filePath = await provider.saveFile(ctx, { path: TMP_DIR });
    const response = await conversationManager.handleFileUpload(userId, filePath);
    await flowDynamic(response);
  });

const flowVoiceNote = addKeyword(EVENTS.VOICE_NOTE)
  .addAction(async (ctx, { flowDynamic, provider }) => {
    const userId = ctx.from;
    const audioPath = await provider.saveFile(ctx, { path: TMP_DIR });
    const transcription = await openaiService.transcribeAudio(audioPath);
    await fs.unlink(audioPath);
    const response = await conversationManager.handleMessage({ ...ctx, body: transcription });
    await flowDynamic(response);
  });

const flowRestart = addKeyword(['bot', 'Bot', 'BOT'])
  .addAction(async (ctx, { flowDynamic, gotoFlow }) => {
    const userId = ctx.from;
    conversationManager.resetConversation(userId);
    await flowDynamic('Bot reiniciado. ¿En qué puedo ayudarte?');
    return gotoFlow(flowPrincipal);
  });

  const main = async () => {
    try {
      await initializeBot();
  
      const adapterDB = new MemoryDB();
      const adapterFlow = createFlow([flowPrincipal, flowDocument, flowVoiceNote, flowRestart]);
      const adapterProvider = createProvider(BaileysProvider, { 
        groupsIgnore: true,
      });
  
      const { httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
      });
  
      httpServer(PORT);
      logger.info(`Bot iniciado en el puerto ${PORT}`);
    } catch (error) {
      logger.error('Error in main:', error);
      console.error(error);
    }
  };

main().catch(err => {
  logger.error('Error in main:', err);
  console.error(err);
});
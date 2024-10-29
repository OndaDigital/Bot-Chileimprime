import { addKeyword, EVENTS } from '@builderbot/bot';
import logger from '../utils/logger.js';
import userContextManager from './userContext.js';
import orderManager from './orderManager.js';
import openaiService from '../services/openaiService.js';
import whatsappService from '../services/whatsappService.js';
import config from '../config/config.js';
import { CustomError } from '../utils/errorHandler.js';
import inactivityMiddleware from '../core/inactivity-middleware.js';
import blacklistMiddleware from '../core/blacklist-middleware.js';
import MessageQueue from './messageQueue.js';
import fileValidationService from '../services/fileValidationService.js';
import commandProcessor from '../commandProcessor.js';
import sheetService from '../services/sheetService.js';

class FlowManager {
  constructor() {
    this.flows = {
      principalFlow: null,
      confirmedFlow: null,
      restartBotFlow: null,
      documentFlow: null,
      voiceNoteFlow: null,
      catchAllFlow: null,
      idleTimeoutFlow: null,
      promoFlow: null,
      mediaFlow: null,
      emailConfirmationFlow: null, // Añadido para registrar el nuevo flujo

    };
    this.blacklist = new Map();
    this.idleTimers = new Map();
    this.messageQueue = new MessageQueue({ gapSeconds: config.messageQueueGapSeconds });
    this.cooldowns = new Map();
    this.initialMessagePromises = new Map();
    this.initialMessageLocks = new Map(); // Añade esta línea

  }


  async initializeFlows() {
    try {
      // Inicializar los flujos
      this.flows.principalFlow = this.createPrincipalFlow();
      this.flows.confirmedFlow = this.createConfirmedFlow();
      this.flows.restartBotFlow = this.createRestartBotFlow();
      this.flows.documentFlow = this.createDocumentFlow();
      this.flows.voiceNoteFlow = this.createVoiceNoteFlow();
      this.flows.catchAllFlow = this.createCatchAllFlow();
      this.flows.idleTimeoutFlow = this.createIdleTimeoutFlow();
      this.flows.promoFlow = this.createPromoFlow();
      this.flows.mediaFlow = this.createMediaFlow();
      this.flows.emailConfirmationFlow = this.createEmailConfirmationFlow(); // Inicializar el nuevo flujo


      // Agregar middlewares
      Object.values(this.flows).forEach(flow => {
        if (flow && typeof flow.addAction === 'function') {
          flow.addAction(inactivityMiddleware(this));
          flow.addAction(blacklistMiddleware(this));
        } else {
          logger.warn(`Un flujo no tiene el método addAction o es nulo`);
        }
      });

      logger.info('Flujos inicializados correctamente');
      return Object.values(this.flows).filter(flow => flow !== null);
    } catch (error) {
      logger.error(`Error al inicializar flujos: ${error.message}`);
      throw new CustomError('FlowInitializationError', 'Error al inicializar los flujos', error);
    }
  }


  getFlowByName(name) {
    return this.flows[name];
  }

  // Nuevo método centralizado para manejar mensajes iniciales
  async handleInitialMessagesOnce(userId, flowDynamic) {
    logger.info(`Intentando enviar mensajes iniciales para usuario ${userId}`);
    
    if (this.initialMessageLocks.get(userId)) {
      logger.info(`Usuario ${userId} ya tiene mensajes iniciales en proceso. Ignorando nueva solicitud.`);
      return;
    }

    this.initialMessageLocks.set(userId, true);

    if (!this.initialMessagePromises.has(userId)) {
      this.initialMessagePromises.set(userId, (async () => {
        if (!userContextManager.hasUserInteracted(userId)) {
          logger.info(`Iniciando envío de mensajes iniciales para usuario ${userId}`);

          try {
            // Crear una cola de mensajes
            const messageQueue = [
              { type: 'image', content: 'https://chileimprime.cl/wp-content/uploads/2024/10/Camapanas-politicas-chileimprime-el-m2-mas-economico.jpg' },
              { type: 'services', content: await commandProcessor.handleListAllServices(userId) },
              { type: 'text', content: `
👉 Selecciona uno de los servicios enviados para iniciar tu cotización.

También puedes realizar las siguientes acciones:
- 🔍 Ver el estado de tus pedidos anteriores
- 🕒 Consultar horarios de atención
- 🎉 Conocer nuestras promociones actuales
- 🖨️ Resolver dudas sobre procesos de impresión
- 📄 Consultar especificaciones de archivos o parámetros técnicos
- 🎙️ Analizar archivos en tiempo real para evaluar validez.

Si necesitas contactar a un agente, por favor escribe *agente* o *humano.*

Para reiniciar el bot en cualquier momento, simplemente escribe *bot.*` }
            ];

            // Enviar mensajes de la cola con un intervalo
            for (const message of messageQueue) {
              switch (message.type) {
                case 'image':
                  await flowDynamic([{ body: 'Promo campañas políticas', media: message.content }]);
                  break;
                case 'services':
                  if (message.content && message.content.data) {
                    await flowDynamic(message.content.data);
                  }
                  break;
                case 'text':
                  await flowDynamic(message.content);
                  break;
              }
              await new Promise(resolve => setTimeout(resolve, 3000)); // Espera 3 segundos entre mensajes
            }

            userContextManager.setInitialMessagesSent(userId, true);
            userContextManager.setHasInteracted(userId, true);
            logger.info(`Mensajes iniciales enviados y estado actualizado para usuario ${userId}`);
          } catch (error) {
            logger.error(`Error al enviar mensajes iniciales para usuario ${userId}: ${error.message}`);
          } finally {
            this.initialMessageLocks.delete(userId);
          }
        } else {
          logger.info(`Usuario ${userId} ya ha interactuado, omitiendo mensajes iniciales`);
        }
      })());
    }

    await this.initialMessagePromises.get(userId);
    this.initialMessagePromises.delete(userId);
  }


  // Nuevo flujo para la confirmación del correo electrónico
  createEmailConfirmationFlow() {
    return addKeyword(EVENTS.WELCOME)
      .addAction(async (ctx, { flowDynamic, endFlow, gotoFlow }) => {
        const userId = ctx.from;
        const userContext = userContextManager.getUserContext(userId);

        try {
          // Obtener el correo electrónico asociado al número de teléfono
          const email = await sheetService.getLastEmailByPhoneNumber(userId);

          if (email) {
            // Si se encontró un correo, preguntar al usuario si desea confirmarlo o modificarlo
            await flowDynamic(`👋 Bienvenido de nuevo, antes de continuar necesito que confirmes si tu correo es válido: *${email}*, o si deseas modificarlo.\n\nPor favor, responde con:\n1️⃣ Confirmar y continuar\n2️⃣ Modificar el correo`);
            // Guardar el correo obtenido en el contexto para usarlo después
            userContext.currentOrder.correo = email;
          } else {
            // Si no se encontró un correo, solicitarlo al usuario
            await flowDynamic('👋 Bienvenido, por favor ingresa tu correo electrónico para continuar:');
          }
        } catch (error) {
          logger.error(`Error en createEmailConfirmationFlow para usuario ${userId}: ${error.message}`);
          await flowDynamic('❌ Ha ocurrido un error al procesar tu correo electrónico. Por favor, intenta nuevamente más tarde.');
          return endFlow();
        }
      })
      .addAnswer('', { capture: true }, async (ctx, { flowDynamic, gotoFlow }) => {
        const userId = ctx.from;
        const userContext = userContextManager.getUserContext(userId);
        const answer = ctx.body.trim();

        if (!userContext.currentOrder.correoConfirmed) {
          if (userContext.currentOrder.correo) {
            // Ya tenemos un correo, el usuario está respondiendo 1 o 2
            if (answer === '1' || answer === '1️⃣') {
              // Usuario confirma el correo
              userContext.currentOrder.correoConfirmed = true;
              logger.info(`Usuario ${userId} confirmó su correo electrónico`);
              await flowDynamic('✅ ¡Gracias! Continuaremos con el proceso.');
              return gotoFlow(this.flows.principalFlow);
            } else if (answer === '2' || answer === '2️⃣') {
              // Usuario desea modificar el correo
              userContext.currentOrder.correo = null; // Resetear el correo
              await flowDynamic('Por favor, ingresa tu nuevo correo electrónico:');
            } else {
              // Respuesta no válida
              await flowDynamic('Por favor, selecciona una opción válida (1 o 2).');
            }
          } else {
            // El usuario está ingresando un nuevo correo
            if (this.validateEmail(answer)) {
              userContextManager.updateCorreo(userId, answer);
              userContext.currentOrder.correoConfirmed = true;
              logger.info(`Correo electrónico almacenado para usuario ${userId}: ${answer}`);
              await flowDynamic('✅ ¡Gracias! Continuaremos con el proceso.');
              return gotoFlow(this.flows.principalFlow);
            } else {
              await flowDynamic('❌ El correo electrónico ingresado no es válido. Por favor, intenta nuevamente.');
            }
          }
        }
      });
  }

  // Método para validar el correo electrónico
  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }




  createPrincipalFlow() {
    return addKeyword(EVENTS.WELCOME)
      .addAction(async (ctx, { flowDynamic, gotoFlow }) => {
        const userId = ctx.from;
        const userContext = userContextManager.getUserContext(userId);

        if (this.initialMessageLocks.get(userId)) {
          logger.info(`Ignorando mensaje de usuario ${userId} durante el envío de mensajes iniciales`);
          return;
        }

        if (!userContext.currentOrder.correoConfirmed) {
          // Redirigir al flujo de confirmación de correo
          logger.info(`Redirigiendo a emailConfirmationFlow para usuario ${userId}`);
          return gotoFlow(this.flows.emailConfirmationFlow);
        }

        if (!userContextManager.hasUserInteracted(userId)) {
          // Enviar mensajes iniciales sin procesar la entrada del usuario
          await this.handleInitialMessagesOnce(userId, flowDynamic);
        } else {
          // Procesar la entrada del usuario en interacciones posteriores
          this.enqueueMessage(userId, ctx.body, async (accumulatedMessage) => {
            await this.handleChatbotResponse(ctx, { flowDynamic, gotoFlow }, accumulatedMessage);
          });
        }
      });
  }

  createMediaFlow() {
    return addKeyword(EVENTS.MEDIA)
      .addAction(async (ctx, { flowDynamic }) => {
        const userId = ctx.from;
        logger.info(`Imagen recibida de ${userId}. Enviando instrucciones específicas.`);

        userContextManager.setHasInteracted(userId, true);
  
        const messages = [
          '🖼️ *¡Hola!* Hemos recibido tu imagen, pero necesitamos que nos envíes tu diseño como *documento* para preservar la calidad.\n\nLas imágenes enviadas como foto en WhatsApp se comprimen y pierden calidad, lo que afecta el análisis y la impresión.\n\nPor favor, envía el mismo archivo como *documento* en uno de los siguientes formatos de alta calidad: *PDF, AI, PSD* o una imagen en alta resolución.\n\n*Criterios de Validación Resumidos:*\n\n- Resolución mínima: 72 dpi y máxima: 150 dpi.\n- Formato preferente: CMYK para evitar diferencias de color.\n- Tamaño real del diseño acorde al tamaño de impresión.',
          '📱 *Cómo enviar un documento en WhatsApp desde Android o iPhone:*\n\n1️⃣ Abre el chat de *Chileimprime*.\n2️⃣ Toca el ícono de *adjuntar* (📎).\n3️⃣ Selecciona *Documento*.\n4️⃣ Busca y selecciona tu archivo de diseño.\n5️⃣ Presiona *Enviar*.',
          '✨ *Esperamos tu archivo nuevamente como documento para iniciar el análisis.* ¡Gracias!'
        ];
  
        try {
          for (const message of messages) {
            await flowDynamic(message);
            logger.info(`Mensaje enviado a ${userId}: ${message.substring(0, 50)}...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
          logger.info(`Instrucciones para imagen enviadas exitosamente a ${userId}`);
        } catch (error) {
          logger.error(`Error al enviar mensajes en mediaFlow para usuario ${userId}: ${error.message}`);
          await flowDynamic('⚠️ *Ha ocurrido un error al enviar las instrucciones. Por favor, intenta nuevamente más tarde.*');
        }
      });
  }
  

  createDocumentFlow() {
    return addKeyword(EVENTS.DOCUMENT)
      .addAction(async (ctx, { flowDynamic }) => {
        const userId = ctx.from;
        logger.info(`Documento recibido de ${userId}. Iniciando análisis.`);
        userContextManager.setHasInteracted(userId, true);

        try {
          const filePath = await whatsappService.saveFile(ctx);
          logger.info(`Archivo guardado para usuario ${userId}: ${filePath}`);
  
          const fileInfo = await fileValidationService.analyzeFile(filePath);
          logger.info(`Análisis completado para archivo de usuario ${userId}: ${JSON.stringify(fileInfo)}`);
          
          await userContextManager.updateCurrentOrder(userId, {
            filePath: filePath,
            fileAnalysis: fileInfo
          });
          
          await flowDynamic('📄 Documento recibido. Analizando...');
  
          await commandProcessor.handleFileAnalysis(ctx, flowDynamic);
          
          logger.info(`Análisis de archivo enviado al usuario ${userId}`);
        } catch (error) {
          logger.error(`Error al procesar el documento para usuario ${userId}: ${error.message}`);
          await flowDynamic('❌ Hubo un error al procesar tu archivo. Por favor, intenta enviarlo nuevamente o contacta con soporte si el problema persiste.');
        }
      });
    }

    createConfirmedFlow() {
      return addKeyword(EVENTS.ACTION)
        .addAction(this.blacklistMiddleware.bind(this))
        .addAction(async (ctx, { flowDynamic, endFlow }) => {
          // Modificación: Eliminar envío de "SOLICITUD_HUMANO"
          this.addToBlacklist(ctx.from, config.humanBlacklistDuration);
          logger.info(`Cotización ya confirmada para ${ctx.from}. Redirigiendo a atención humana.`);
          return endFlow("Un representante se pondrá en contacto contigo pronto para finalizar tu cotización. Gracias por tu paciencia.");
        });
    }
    
      createRestartBotFlow() {
        return addKeyword(['bot', 'Bot', 'BOT'])
          .addAction(async (ctx, { flowDynamic, gotoFlow }) => {
            const userId = ctx.from;
            logger.info(`Intento de reinicio de bot por usuario ${userId}`);
            this.resetConversation(userId, true); // Reiniciar initialMessagesSent
            logger.info(`Bot reiniciado para usuario ${userId}`);
            await flowDynamic('*¡Bienvenido de nuevo!* 🎉 El bot ha sido reiniciado. *¿En qué puedo ayudarte hoy?* 😊');
            return gotoFlow(this.flows.principalFlow);
          });
      }

    createVoiceNoteFlow() {
      return addKeyword(EVENTS.VOICE_NOTE)
        .addAction(async (ctx, { flowDynamic, state, gotoFlow, endFlow }) => {
          try {
            const audioPath = await whatsappService.saveAudioFile(ctx);
            const transcription = await openaiService.transcribeAudio(audioPath);
            logger.info(`Transcripción del audio: ${transcription}`);
            
            await state.update({ lastTranscription: transcription });
            await flowDynamic(`*📝 Transcripción:*\n${transcription}`);
    
            this.enqueueMessage(ctx.from, transcription, async (accumulatedMessage) => {
              await this.handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, accumulatedMessage);
            });
          } catch (error) {
            logger.error(`Error al procesar la nota de voz: ${error.message}`);
            await flowDynamic('Hubo un error al procesar la nota de voz. Por favor, intenta enviar un mensaje de texto.');
          }
        });
    }
  
  
    createCatchAllFlow() {
      return addKeyword(EVENTS.ACTION)
        .addAction(this.blacklistMiddleware.bind(this))
        .addAction(async (ctx, { gotoFlow }) => {
          if (orderManager.isOrderConfirmed(ctx.from)) {
            return gotoFlow(this.flows.confirmedFlow);
          } else {
            return gotoFlow(this.flows.principalFlow);
          }
        });
    }
  
    createIdleTimeoutFlow() {
      return addKeyword(EVENTS.ACTION)
        .addAction(async (ctx, { endFlow }) => {
          logger.info(`Tiempo de espera agotado para usuario ${ctx.from}`);
          this.resetConversation(ctx.from);
          return endFlow('*😴 Lo siento, el tiempo de espera ha expirado. Tu cotización ha sido cancelada. Si deseas hacer una nueva cotización, por favor envía un mensaje.*');
        });
    }
  
    createPromoFlow() {
      return addKeyword(EVENTS.ACTION)
        .addAction(async (ctx, { flowDynamic, endFlow }) => {
          const promoMessage = whatsappService.getPromoMessage();
          try {
            await flowDynamic(promoMessage);
            logger.info(`Mensaje promocional enviado a ${ctx.from}`);
          } catch (error) {
            logger.error(`Error al enviar mensaje promocional a ${ctx.from}: ${error.message}`);
          }
          return endFlow();
        });
    }
  
    enqueueMessage(userId, message, callback) {
      this.messageQueue.enqueueMessage(userId, message, callback);
    }
  
    async handleChatbotResponse(ctx, { flowDynamic, gotoFlow, endFlow }, message, instruction = '') {
      const userId = ctx.from;
      logger.info(`Procesando mensaje para usuario ${userId}: ${message}`);
  
      if (this.isBlacklisted(userId)) {
        logger.info(`Usuario ${userId} en lista negra. Mensaje ignorado.`);
        return endFlow();
      }
  
      if (orderManager.isOrderConfirmed(userId)) {
        logger.info(`Cotización ya confirmada para ${userId}. Redirigiendo a atención humana.`);
        return gotoFlow(this.getFlowByName('confirmedFlow'));
      }
  
      this.startIdleTimer(ctx, flowDynamic, gotoFlow);
  
      try {
        const userContext = userContextManager.getUserContext(userId);
        const chatContext = userContextManager.getChatContext(userId);
  
        let aiResponse = await openaiService.getChatCompletion(
          openaiService.getSystemPrompt(userContext.services, userContext.currentOrder, userContext.additionalInfo, chatContext),
          [...chatContext, { role: "user", content: message }],
          instruction
        );
  
        logger.info(`Respuesta inicial de AI para ${userId}: ${aiResponse}`);
  
        // Procesar comandos en la respuesta de la IA
        const commands = this.processAIResponse(aiResponse);
        let currentOrderUpdated = false;
        let missingFields = [];
        let responseHandled = false; // Nueva variable para controlar si la respuesta ya fue manejada
  
        for (const command of commands) {
          // Validar comando antes de procesarlo
          const { validatedCommand, responseSent } = await this.validateCommand(command, userId, aiResponse, message, ctx, flowDynamic);
          if (validatedCommand) {
            if (typeof validatedCommand === 'object') {
              const result = await commandProcessor.processCommand(validatedCommand, userId, ctx, { flowDynamic, gotoFlow, endFlow });
              if (result.currentOrderUpdated) {
                currentOrderUpdated = true;
              }
              if (result.missingFields && result.missingFields.length > 0) {
                missingFields = result.missingFields;
              }
              if (result.messagesSent) {
                logger.info(`Mensajes enviados por comando ${command.command} para ${userId}`);
              }
              if (result.data) {
                await flowDynamic(result.data);
                responseHandled = true;
              }
            }
          }
  
          // Si la respuesta ya fue manejada en validateCommand, establecemos responseHandled en true
          if (responseSent) {
            responseHandled = true;
            break; // Salimos del bucle ya que la respuesta ha sido manejada
          }
        }
  
        // Solo enviar la respuesta original de la IA si no ha sido manejada ya
        if (!responseHandled) {
          const filteredResponse = this.filterJsonCommands(aiResponse);
          if (filteredResponse) {
            await flowDynamic(filteredResponse);
            // Actualizar el contexto con la respuesta enviada
            userContextManager.updateContext(userId, aiResponse, "assistant");
          }
        }
  
        // Actualizar el contexto con el mensaje del usuario
        userContextManager.updateContext(userId, message, "user");
  
        // Manejo de orden completa
        if (userContextManager.isOrderComplete(userId)) {
          logger.info(`Orden completa para ${userId}. Confirmando pedido.`);
          // Enviar comando de confirmación
          await commandProcessor.processCommand({ command: "CONFIRM_ORDER" }, userId, ctx, { flowDynamic, gotoFlow, endFlow });
          return gotoFlow(this.getFlowByName('confirmedFlow'));
        }
  
      } catch (error) {
        logger.error(`Error al procesar respuesta para usuario ${userId}: ${error.message}`);
        logger.error(`Stack trace: ${error.stack}`);
        await flowDynamic("Lo siento, ha ocurrido un error inesperado. Por favor, intenta nuevamente en unos momentos.");
      }
    }


  
    processAIResponse(aiResponse) {
      const commandRegex = /{[^}]+}/g;
      const commands = aiResponse.match(commandRegex) || [];
      return commands.map(cmd => {
        try {
          return JSON.parse(cmd);
        } catch (error) {
          logger.error(`Error al parsear comando JSON: ${error.message}`);
          return null;
        }
      }).filter(cmd => cmd !== null);
    }

    filterJsonCommands(aiResponse) {
      // Eliminar todos los comandos JSON de la respuesta
      return aiResponse.replace(/\{.*?\}/g, '').trim();
    }
  
    setIdleTimers(userId, timers) {
      this.idleTimers.set(userId, timers);
    }
  
    addToBlacklist(userId, duration) {
      this.blacklist.set(userId, Date.now() + duration);
      logger.info(`Usuario ${userId} añadido a la lista negra por ${duration/1000} segundos`);
    }
  
    isBlacklisted(userId) {
      if (this.blacklist.has(userId)) {
        const blacklistExpiry = this.blacklist.get(userId);
        if (Date.now() < blacklistExpiry) {
          logger.info(`Usuario ${userId} está en la lista negra. Tiempo restante: ${(blacklistExpiry - Date.now()) / 1000} segundos`);
          return true;
        } else {
          this.blacklist.delete(userId);
          this.resetConversation(userId);
          logger.info(`Usuario ${userId} removido de la lista negra`);
        }
      }
      return false;
    }
  
    resetConversation(userId, resetInitialMessages = false) {
      userContextManager.resetContext(userId, resetInitialMessages);
      orderManager.resetOrderConfirmation(userId);
      this.blacklist.delete(userId);
      this.clearIdleTimer(userId);
      logger.info(`Conversación reiniciada para usuario ${userId}, resetInitialMessages: ${resetInitialMessages}`);
    }
  
    startIdleTimer(ctx, flowDynamic, gotoFlow) {
      this.clearIdleTimer(ctx.from);
      
      const warningTimer = setTimeout(async () => {
        await flowDynamic('*⏰ ¿Sigues ahí? Si necesitas más tiempo, por favor responde cualquier mensaje.*');
      }, config.idleWarningTime);
  
      const timeoutTimer = setTimeout(() => {
        this.resetConversation(ctx.from);
        gotoFlow(this.getFlowByName('idleTimeoutFlow'));
      }, config.idleTimeoutTime);
  
      this.setIdleTimers(ctx.from, { warningTimer, timeoutTimer });
    }
  
    clearIdleTimer(userId) {
      const timers = this.idleTimers.get(userId);
      if (timers) {
        clearTimeout(timers.warningTimer);
        clearTimeout(timers.timeoutTimer);
        this.idleTimers.delete(userId);
      }
    }
  
    blacklistMiddleware(ctx, { endFlow }) {
      if (this.isBlacklisted(ctx.from)) {
        logger.info(`Usuario ${ctx.from} en lista negra. Mensaje ignorado.`);
        return endFlow();
      }
      return false;
    }

    async validateCommand(command, userId, assistantMessage, userMessage, ctx, flowDynamic) {
      if (command.command === "CONFIRM_ORDER") {
        if (!userContextManager.isOrderComplete(userId)) {
          const missingFields = userContextManager.getIncompleteFields(userId);
          logger.warn(`La orden está incompleta para el usuario ${userId}. Campos faltantes: ${missingFields.join(', ')}. Revaluando comando CONFIRM_ORDER.`);
  
          // Llamar primero a extractDataFromUserMessage
          const extractedCommand = await this.extractDataFromUserMessage(userMessage, userId);
  
          if (extractedCommand) {
            logger.info(`Comando extraído de extractDataFromUserMessage para usuario ${userId}: ${JSON.stringify(extractedCommand)}`);
  
            // Procesar el comando extraído
            await commandProcessor.processCommand(extractedCommand, userId, ctx, { flowDynamic });
  
            // Generar una instrucción para getChatCompletion
            const instruction = `
  El cliente acaba de ${this.getActionDescription(extractedCommand)}.
  
  Continúa la conversación con el cliente para avanzar en la cotización.
  
  Importante:
  - No incluyas ningún comando JSON en tu respuesta.
  - No muestres los comandos al cliente.
  - Responde de manera natural y amable, siguiendo las pautas del SystemPrompt.
  
  Responde al cliente:
            `;
  
            // Obtener el SystemPrompt actualizado
            const userContext = userContextManager.getUserContext(userId);
            const systemPrompt = openaiService.getSystemPrompt(
              userContext.services,
              userContext.currentOrder,
              userContext.additionalInfo,
              userContext.chatContext
            );
  
            // Llamar a getChatCompletion con la instrucción
            const aiResponse = await openaiService.getChatCompletion(
              systemPrompt,
              userContext.chatContext,
              instruction
            );
  
            // Actualizar el contexto
            userContextManager.updateContext(userId, aiResponse, "assistant");
  
            // Enviar la respuesta al cliente
            await flowDynamic(aiResponse);
  
            // Indicar que la respuesta ha sido manejada
            return { validatedCommand: null, responseSent: true };
          } else {
            // Si no se extrae un comando válido, proceder a reevaluateCommand
            const newCommandOrResponse = await this.reevaluateCommand(assistantMessage, userMessage, userId, missingFields);
  
            if (newCommandOrResponse) {
              // Procesar el nuevo comando si existe
              if (newCommandOrResponse.command) {
                logger.info(`Nuevo comando obtenido tras revaluación: ${JSON.stringify(newCommandOrResponse.command)}`);
                await commandProcessor.processCommand(newCommandOrResponse.command, userId, ctx, { flowDynamic });
              }
  
              // Enviar la respuesta al usuario si existe
              if (newCommandOrResponse.response) {
                await flowDynamic(newCommandOrResponse.response);
                userContextManager.updateContext(userId, newCommandOrResponse.response, "assistant");
              }
  
              // Indicar que la respuesta ha sido manejada
              return { validatedCommand: null, responseSent: true };
            } else {
              // Actualizar el contexto del asistente con los campos faltantes
              const systemMessage = `Campos faltantes: La orden no está completa. Faltan los siguientes campos: ${missingFields.join(', ')}`;
              userContextManager.updateContext(userId, systemMessage, "system");
  
              // Informar al usuario
              await flowDynamic("Parece que aún falta información para completar tu pedido. Por favor, proporciónanos los detalles faltantes.");
  
              // Indicar que la respuesta ha sido manejada
              return { validatedCommand: null, responseSent: true };
            }
          }
        }
      }
      return { validatedCommand: command, responseSent: false };
    }  


    // Nueva función para describir la acción basada en el comando
    getActionDescription(command) {
      switch (command.command) {
        case "SELECT_SERVICE":
          return `seleccionado el servicio: ${command.service}`;
        case "SET_MEASURES":
          return `establecido las medidas: ancho ${command.width} m, alto ${command.height} m`;
        case "SET_QUANTITY":
          return `establecido la cantidad: ${command.quantity}`;
        case "SET_FINISHES":
          return `seleccionado las terminaciones: sellado ${command.sellado}, ojetillos ${command.ojetillos}, bolsillo ${command.bolsillo}`;
        default:
          return `realizado una acción`;
      }
    }




    // Nueva función extractDataFromUserMessage
    async extractDataFromUserMessage(userMessage, userId) {
      logger.info(`Intentando extraer comando del mensaje del usuario ${userId}: "${userMessage}"`);
  
      const chatContext = userContextManager.getChatContext(userId);
      const lastMessages = chatContext.slice(-6).map(msg => `${msg.role}: ${msg.content}`).join('\n');
  
      const currentOrder = userContextManager.getCurrentOrder(userId);
  
      const prompt = `
  Eres un asistente experto en impresión y gestión de pedidos. A partir del siguiente mensaje del usuario y el contexto de la conversación, extrae el comando apropiado para procesar su solicitud.
  
  Historial de la conversación:
  ${lastMessages}
  
  Mensaje del usuario:
  "${userMessage}"
  
  Información actual de la orden:
  ${JSON.stringify(currentOrder)}
  
  Lista de servicios disponibles:
  ${JSON.stringify(userContextManager.getAllServices())}
  
  Tu tarea es analizar el mensaje del usuario y, si es posible, extraer el comando adecuado para avanzar en el procesamiento de su pedido. Solo debes devolver un comando JSON válido si estás seguro de que el mensaje del usuario contiene la información necesaria.
  
  Posibles comandos:
  - {"command": "SELECT_SERVICE", "service": "Nombre exacto del servicio"}
  - {"command": "SET_MEASURES", "width": X, "height": Y}
  - {"command": "SET_QUANTITY", "quantity": Z}
  - {"command": "SET_FINISHES", "sellado": true/false, "ojetillos": true/false, "bolsillo": true/false}
  
  Si no es posible extraer un comando válido, no devuelvas nada.
  
  No debes devolver ninguna explicación ni texto adicional. Solo devuelve el comando JSON si es aplicable.
  `;
  
      try {
        const aiResponse = await openaiService.getChatCompletion(prompt, []);
        logger.info(`Respuesta de extractDataFromUserMessage para usuario ${userId}: ${aiResponse}`);
  
        // Intentar parsear la respuesta como JSON
        try {
          const extractedCommand = JSON.parse(aiResponse);
          return extractedCommand;
        } catch (parseError) {
          logger.warn(`No se pudo parsear el comando extraído para usuario ${userId}: ${parseError.message}`);
          return null;
        }
      } catch (error) {
        logger.error(`Error al extraer comando del mensaje del usuario ${userId}: ${error.message}`);
        return null;
      }
    }


  async reevaluateCommand(assistantMessage, userMessage, userId, missingFields) {
    logger.info(`Reevaluando comando para usuario ${userId}`);

    // Obtener el historial reciente de la conversación
    const chatContext = userContextManager.getChatContext(userId);
    const lastMessages = chatContext.slice(-6).map(msg => `${msg.role}: ${msg.content}`).join('\n');

    // Obtener la lista de servicios disponibles
    const services = userContextManager.getGlobalServices();
    const servicesList = Object.values(services).flat().map(service => service.name).join(', ');
    const currentOrder = userContextManager.getCurrentOrder(userId);

    // Modificación del prompt para evitar que el asistente asuma valores por defecto
    const prompt = `
Eres un asistente experto en impresión y gestión de pedidos. Aquí está la última interacción:

${lastMessages}

Basado en esta interacción y el estado actual de la orden:
${JSON.stringify(userContextManager.getCurrentOrder(userId))}

Presta especial atención a los siguientes detalles del currentOrder:
- Servicio actual: ${currentOrder.service || 'No seleccionado'}
- Categoría: ${currentOrder.category || 'No especificada'}
- Tipo: ${currentOrder.type || 'No especificado'}
- Medidas seleccionadas: 
  * Ancho: ${currentOrder.measures?.width || 'No especificado'} metros
  * Alto: ${currentOrder.measures?.height || 'No especificado'} metros
- Terminaciones elegidas: 
  * Sellado: ${currentOrder.finishes?.sellado ? 'Sí' : 'No'}
  * Ojetillos: ${currentOrder.finishes?.ojetillos ? 'Sí' : 'No'}
  * Bolsillo: ${currentOrder.finishes?.bolsillo ? 'Sí' : 'No'}
- Cantidad: ${currentOrder.quantity || 'No especificada'}
- Archivo de diseño: ${currentOrder.filePath ? 'Subido' : 'No subido'}
- Anchos disponibles: ${JSON.stringify(currentOrder.availableWidths)}
- Terminaciones disponibles: ${JSON.stringify(currentOrder.availableFinishes)}
- Área del servicio: ${currentOrder.areaServicio || 'No calculada'} m²

Lista de servicios disponibles: ${servicesList}

Los campos faltantes en la orden son: ${missingFields.join(', ')}

Tu objetivo es ayudar al usuario a completar la información faltante sin asumir ningún valor por defecto. No debes asignar valores a campos faltantes a menos que el usuario los haya proporcionado explícitamente.

Analiza si el comando 'CONFIRM_ORDER' es apropiado. Si la orden está incompleta, determina la mejor respuesta posible al usuario para ayudarlo a proporcionar la información faltante.

Recuerda:
- No asumas servicios o valores que el usuario no haya mencionado explícitamente.
- Si el usuario está confirmando la selección de un servicio, pero no ha proporcionado el nombre del servicio, pídele amablemente que especifique el servicio que desea.
- Proporciona una respuesta clara y amable que guíe al usuario a proporcionar la información faltante.

No debes devolver ningún comando en este caso. Responde al usuario de manera que continúe la conversación y facilite la obtención de la información necesaria.
    `;

    try {
        const aiResponse = await openaiService.getChatCompletion(prompt, []);
        logger.info(`Respuesta de reevaluación del modelo para usuario ${userId}: ${aiResponse}`);

        // Como hemos instruido al asistente a no devolver comandos, procesamos solo la respuesta
        return { command: null, response: aiResponse.trim() };
    } catch (error) {
        logger.error(`Error al reevaluar comando para usuario ${userId}: ${error.message}`);
        return null;
    }
}




  }
  
  export default new FlowManager();
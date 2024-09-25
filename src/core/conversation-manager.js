// core/conversation-manager.js

import { openaiService } from '../services/openai-service.js';
import { sheetsService } from '../services/sheets-service.js';
import { commandHandler } from './command-handler.js';
import { logger } from '../utils/logger.js';

class ConversationManager {
  constructor() {
    this.states = new Map();
    this.transitions = new Map();
  }

  registerState(stateName, handler) {
    this.states.set(stateName, handler);
    logger.info(`State ${stateName} registered`);
  }

  registerTransition(fromState, toState, condition) {
    if (!this.transitions.has(fromState)) {
      this.transitions.set(fromState, new Map());
    }
    this.transitions.get(fromState).set(toState, condition);
    logger.info(`Transition registered: ${fromState} -> ${toState}`);
  }

  async handleMessage(ctx, { flowDynamic, gotoFlow }) {
    const userContext = ctx.userContext;
    const currentState = userContext.getState();

    try {
      userContext.addToHistory('user', ctx.body);

      const intent = await this.determineIntent(ctx.body);
      const action = this.mapIntentToAction(intent);
      
      if (action === 'UNKNOWN') {
        await commandHandler.executeCommand('UNKNOWN', ctx, { flowDynamic, gotoFlow });
        return;
      }

      const nextState = await this.executeStateAndDetermineNext(currentState, ctx, action, { flowDynamic, gotoFlow });

      if (nextState && this.states.has(nextState)) {
        logger.logState(currentState, nextState, { userId: ctx.from, intent, action });
        userContext.setState(nextState);
        await this.executeState(nextState, ctx, action, { flowDynamic, gotoFlow });
      } else {
        await this.handleDefaultResponse(ctx, intent, { flowDynamic });
      }

    } catch (error) {
      logger.logError(`Error handling message for user ${ctx.from}`, error);
      await flowDynamic('Lo siento, ha ocurrido un error. Por favor, intenta de nuevo más tarde.');
      userContext.setState('MAIN_MENU');
    }
  }

  async determineIntent(message) {
    return await openaiService.determineIntent(message);
  }

  mapIntentToAction(intent) {
    const intentActionMap = {
      'saludo': 'GREETING',
      'lista_servicios': 'LIST_SERVICES',
      'informacion_adicional': 'ADDITIONAL_INFO',
      'cotizar': 'QUOTE',
      'realizar_pedido': 'CREATE_ORDER',
      'seleccionar_servicio': 'SELECT_SERVICE',
      'pregunta_general': 'GENERAL_QUESTION',
      'desconocido': 'UNKNOWN'
    };
    return intentActionMap[intent] || 'UNKNOWN';
  }

  async executeStateAndDetermineNext(currentState, ctx, action, { flowDynamic, gotoFlow }) {
    const stateTransitions = this.transitions.get(currentState);
    if (!stateTransitions) {
      throw new Error(`No transitions defined for state: ${currentState}`);
    }

    for (const [nextState, condition] of stateTransitions.entries()) {
      if (await condition(ctx, action)) {
        return nextState;
      }
    }

    return currentState;
  }

  async executeState(state, ctx, action, { flowDynamic, gotoFlow }) {
    const stateHandler = this.states.get(state);
    if (!stateHandler) {
      throw new Error(`No handler found for state: ${state}`);
    }
    await stateHandler(ctx, action, { flowDynamic, gotoFlow });
  }

  async handleDefaultResponse(ctx, intent, { flowDynamic }) {
    const userContext = ctx.userContext;
    const systemPrompt = this.getSystemPrompt(userContext.getState());
    const aiResponse = await openaiService.getChatCompletion(userContext, systemPrompt);
    await flowDynamic(aiResponse);
    userContext.addToHistory('assistant', aiResponse);
  }

  getSystemPrompt(state) {
    const basePrompt = "Eres un asistente virtual para una imprenta. Tu tarea es ayudar a los clientes con sus consultas sobre servicios de impresión.";
    const stateSpecificPrompt = this.getStateSpecificPrompt(state);
    return `${basePrompt} ${stateSpecificPrompt}`;
  }

  getStateSpecificPrompt(state) {
    const prompts = {
      'INITIAL': "Saluda al cliente y pregúntale en qué puedes ayudarle.",
      'MAIN_MENU': "Ayuda al cliente a elegir entre ver la lista de servicios, obtener información adicional, cotizar un servicio o realizar un pedido.",
      'LISTING_SERVICES': "Proporciona la lista de servicios disponibles de manera clara y concisa.",
      'SELECTING_SERVICE': "Ayuda al cliente a seleccionar un servicio específico del menú.",
      'PROVIDING_ADDITIONAL_INFO': "Proporciona información adicional sobre horarios, despacho, métodos de pago, etc.",
      'QUOTING': "Ayuda al cliente a obtener una cotización para un servicio específico.",
      'CREATING_ORDER': "Guía al cliente a través del proceso de creación de un pedido.",
      'GENERAL_QUESTION': "Responde a la pregunta general del cliente de la mejor manera posible.",
    };
    return prompts[state] || "Asiste al cliente con su consulta actual.";
  }
}

export const conversationManager = new ConversationManager();
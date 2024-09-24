// core/conversation-manager.js

import { openaiService } from '../services/openai-service.js';
import { commandHandler } from './command-handler.js';
import { sheetsService } from '../services/sheets-service.js';
import { printingCalculator } from '../services/printing-calculator.js';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/error-types.js';
import { validators } from '../utils/validators.js';

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
    logger.info(`Transition from ${fromState} to ${toState} registered`);
  }

  async handleMessage(ctx, { flowDynamic, gotoFlow }) {
    const userContext = ctx.userContext;
    const currentState = userContext.getState();

    try {
      userContext.addToHistory('user', ctx.body);

      const action = await this.determineAction(ctx);
      const nextState = await this.executeStateAndDetermineNext(currentState, ctx, action, { flowDynamic, gotoFlow });

      if (nextState && this.states.has(nextState)) {
        userContext.setState(nextState);
        await this.executeState(nextState, ctx, action, { flowDynamic, gotoFlow });
      } else {
        throw new Error(`Invalid state transition from ${currentState} with action ${action}`);
      }

      const systemPrompt = this.getSystemPrompt(userContext);
      const aiResponse = await openaiService.getChatCompletion(userContext, systemPrompt);

      const processedResponse = await this.processAIResponse(aiResponse, action, userContext);

      await flowDynamic(processedResponse.message);
      userContext.addToHistory('assistant', processedResponse.message);

      await this.handlePostActions(ctx, action, processedResponse, { flowDynamic, gotoFlow });

    } catch (error) {
      logger.error(`Error handling message for user ${ctx.from}:`, error);
      if (error instanceof ValidationError) {
        await flowDynamic(error.message);
      } else {
        await flowDynamic('Lo siento, ha ocurrido un error. Por favor, intenta de nuevo más tarde.');
      }
    }
  }

  async determineAction(ctx) {
    const userMessage = ctx.body.toLowerCase();
    
    // Intentar determinar la intención usando OpenAI
    try {
      const intent = await openaiService.determineIntent(userMessage);
      switch (intent) {
        case 'cotizar':
          return 'QUOTE';
        case 'analizar_archivo':
          return 'ANALYZE_FILE';
        case 'generar_presupuesto':
          return 'GENERATE_BUDGET';
        default:
          // Si OpenAI no puede determinar la intención, usamos la lógica simple
          if (userMessage.includes('cotizar')) return 'QUOTE';
          if (userMessage.includes('analizar archivo')) return 'ANALYZE_FILE';
          if (userMessage.includes('generar presupuesto')) return 'GENERATE_BUDGET';
          return 'DEFAULT';
      }
    } catch (error) {
      logger.error('Error determining intent with OpenAI', error);
      // En caso de error, volvemos a la lógica simple
      if (userMessage.includes('cotizar')) return 'QUOTE';
      if (userMessage.includes('analizar archivo')) return 'ANALYZE_FILE';
      if (userMessage.includes('generar presupuesto')) return 'GENERATE_BUDGET';
      return 'DEFAULT';
    }
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

    return currentState; // Si no hay transición, permanecemos en el estado actual
  }

  async executeState(state, ctx, action, { flowDynamic, gotoFlow }) {
    const stateHandler = this.states.get(state);
    if (!stateHandler) {
      throw new Error(`No handler found for state: ${state}`);
    }
    await stateHandler(ctx, action, { flowDynamic, gotoFlow });
  }

  getSystemPrompt(userContext) {
    const basePrompt = "Eres un asistente virtual para una imprenta. Tu tarea es ayudar a los clientes a cotizar servicios de impresión.";
    const stateSpecificPrompt = this.getStateSpecificPrompt(userContext.getState());
    return `${basePrompt} ${stateSpecificPrompt}`;
  }

  getStateSpecificPrompt(state) {
    const prompts = {
      'INITIAL': "Saluda al cliente y pregúntale en qué puedes ayudarle.",
      'MAIN_MENU': "Ayuda al cliente a elegir entre cotizar, analizar un archivo o generar un presupuesto.",
      'SELECTING_SERVICE': "Ayuda al cliente a elegir un servicio de impresión. Ofrece opciones basadas en nuestro catálogo.",
      'ENTERING_MEASUREMENTS': "Solicita las medidas específicas para el servicio seleccionado. Asegúrate de que sean válidas.",
      'SELECTING_FINISHES': "Ofrece opciones de acabado como sellado, ojetillos o bolsillo si aplican al servicio seleccionado.",
      'UPLOADING_FILE': "Guía al cliente para que suba su archivo de diseño. Menciona los formatos aceptados y los requisitos de DPI.",
      'CONFIRMING_ORDER': "Presenta un resumen del pedido y pregunta al cliente si desea confirmar o modificar algo.",
    };
    return prompts[state] || "Asiste al cliente con su consulta actual.";
  }

  async processAIResponse(aiResponse, action, userContext) {
    // Implementación para procesar la respuesta de la IA
    return { message: aiResponse };
  }

  async handlePostActions(ctx, action, processedResponse, { flowDynamic, gotoFlow }) {
    // Implementación para manejar acciones posteriores
    logger.info(`Post-action handling for ${action}`);
  }
}

export const conversationManager = new ConversationManager();
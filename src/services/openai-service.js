// services/openai-service.js

import OpenAI from 'openai';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

class OpenAIService {
  constructor() {
    this.client = new OpenAI({ apiKey: config.openai.apiKey });
  }

  async initialize() {
    logger.info('OpenAI service initialized');
  }

  async getChatCompletion(userContext, newMessage) {
    const messages = [
      { role: 'system', content: this.getSystemPrompt() },
      ...userContext.getHistory(),
      { role: 'user', content: newMessage }
    ];

    try {
      const response = await this.client.chat.completions.create({
        model: config.openai.model,
        messages: messages,
        max_tokens: 150
      });

      const aiResponse = response.choices[0].message.content.trim();
      return aiResponse;
    } catch (error) {
      logger.error('Error getting chat completion from OpenAI', error);
      throw error;
    }
  }

  getSystemPrompt() {
    return `Eres un asistente virtual para una imprenta. Tu tarea es ayudar a los clientes a cotizar servicios de impresión, proporcionar información sobre servicios, y asistir en el proceso de pedidos. Sé amable, profesional y directo en tus respuestas.`;
  }

  async determineIntent(message) {
    const prompt = `Determina la intención del usuario basada en el siguiente mensaje. Las posibles intenciones son: saludo, lista_servicios, informacion_adicional, cotizar, realizar_pedido, pregunta_general, o desconocido. Responde solo con la intención, sin explicación adicional.

Mensaje del usuario: "${message}"

Intención:`;

    try {
      const response = await this.client.chat.completions.create({
        model: config.openai.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 10,
        temperature: 0.3,
      });

      const intent = response.choices[0].message.content.trim().toLowerCase();
      return ['saludo', 'lista_servicios', 'informacion_adicional', 'cotizar', 'realizar_pedido', 'pregunta_general', 'desconocido'].includes(intent) ? intent : 'desconocido';
    } catch (error) {
      logger.error('Error determining intent with OpenAI', error);
      return 'desconocido';
    }
  }

  async transcribeAudio(audioBuffer) {
    try {
      const response = await this.client.audio.transcriptions.create({
        file: audioBuffer,
        model: 'whisper-1',
      });
      return response.text;
    } catch (error) {
      logger.error('Error in audio transcription', error);
      throw error;
    }
  }
}

export const openaiService = new OpenAIService();
import OpenAI from 'openai';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

class OpenAIService {
  constructor() {
    this.client = new OpenAI({ apiKey: config.openai.apiKey });
  }

  async initialize() {
    // Aquí puedes agregar cualquier lógica de inicialización necesaria
    logger.info('OpenAI service initialized');
  }

  async getChatCompletion(userContext, newMessage) {
    const messages = [
      { role: 'system', content: this.getSystemPrompt() },
      ...userContext.getHistory(),
      { role: 'user', content: newMessage }
    ];

    const response = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      max_tokens: 150
    });

    const aiResponse = response.choices[0].message.content.trim();
    userContext.addToHistory('assistant', aiResponse);
    return aiResponse;
  }

  getSystemPrompt() {
    // Implementar el prompt del sistema aquí
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

  async determineIntent(message) {
    const prompt = `Determina la intención del usuario basada en el siguiente mensaje. Las posibles intenciones son: cotizar, analizar_archivo, generar_presupuesto, o desconocido. Responde solo con la intención, sin explicación adicional.

Mensaje del usuario: "${message}"

Intención:`;

    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 10,
        temperature: 0.3,
      });

      const intent = response.choices[0].message.content.trim().toLowerCase();
      return ['cotizar', 'analizar_archivo', 'generar_presupuesto'].includes(intent) ? intent : 'desconocido';
    } catch (error) {
      logger.error('Error determining intent with OpenAI', error);
      return 'desconocido';
    }
  }

  
}

export const openaiService = new OpenAIService();
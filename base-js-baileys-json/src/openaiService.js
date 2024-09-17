// openaiService.js - bot de la imprenta

import OpenAI from 'openai';
import Logger from './logger.js';
import fs from 'fs/promises';

class OpenAIService {
  constructor(apiKey) {
    this.openai = new OpenAI({ apiKey });
    this.logger = new Logger();
  }

  async getChatCompletion(messages) {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: messages,
        max_tokens: 2000,
        temperature: 0.7,
      });
      return response.choices[0].message.content.trim();
    } catch (error) {
      this.logger.error("Error al obtener respuesta de OpenAI:", error);
      throw error;
    }
  }

  async handleInitialConversation(context, userMessage) {
    const messages = [
      { role: "system", content: "Eres un asistente de imprenta amigable y eficiente. Tu objetivo es ayudar a los clientes a cotizar servicios de impresión. Debes detectar cuando el cliente pide el menú y responder con {MENU_SOLICITADO}. Si el cliente está listo para seleccionar un servicio, responde con {LISTO_PARA_SELECCIONAR_SERVICIO}. Si el cliente quiere finalizar, responde con {FINALIZAR_CONVERSACION}." },
      ...context,
      { role: "user", content: userMessage }
    ];
    return await this.getChatCompletion(messages);
  }

  async selectService(services, userMessage) {
    const messages = [
      { role: "system", content: "Tu tarea es identificar si el usuario ha seleccionado un servicio válido de la lista proporcionada. Si el usuario selecciona un servicio válido, responde con {SERVICIO_CONFIRMADO} seguido del nombre exacto del servicio. Si no, pide más detalles." },
      { role: "user", content: `Servicios disponibles: ${JSON.stringify(services)}. Mensaje del usuario: ${userMessage}` }
    ];
    
    const response = await this.getChatCompletion(messages);
    
    if (response.includes("{SERVICIO_CONFIRMADO}")) {
      return response;
    } else {
      return "No pude identificar el servicio. ¿Podrías proporcionar más detalles?";
    }
  }

  async getMeasurementsAndFinishes(service, userMessage) {
    const messages = [
      { role: "system", content: `Tu objetivo es analizar si el usuario ha proporcionado medidas válidas para el servicio: ${JSON.stringify(service)}. Las medidas deben estar dentro del rango: ${service.medidas}. Si las medidas son válidas, pregunta por las terminaciones disponibles: ${service.sellado ? 'sellado' : ''} ${service.ojetillos ? 'ojetillos' : ''} ${service.bolsillo ? 'bolsillo' : ''}. Cuando toda la información esté completa, responde con {TERMINACIONES_MEDIDAS_SELECCIONADAS} seguido de un JSON con la información.` },
      { role: "user", content: userMessage }
    ];
    const response = await this.getChatCompletion(messages);
    
    if (response.includes("{TERMINACIONES_MEDIDAS_SELECCIONADAS}")) {
      return response;
    } else {
      return response + "\n\nPor favor, proporciona las medidas o selecciona las terminaciones.";
    }
  }

  async transcribeAudio(audioFilePath) {
    try {
      const audioFile = await fs.readFile(audioFilePath);
      const response = await this.openai.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
      });
      return response.text;
    } catch (error) {
      this.logger.error("Error al transcribir audio:", error);
      throw error;
    }
  }

estimateTokens(messages) {
  // Estimación aproximada, 1 token ≈ 4 caracteres
  return messages.reduce((total, message) => total + message.content.length / 4, 0).toFixed(0);
}

}

export default OpenAIService;
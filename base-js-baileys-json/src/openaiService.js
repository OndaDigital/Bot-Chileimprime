// openaiService.js - Bot imprenta

import OpenAI from "openai";
import Logger from './logger.js';
import fs from 'fs';

const logger = new Logger();
const MAX_AUDIO_SIZE = 2000 * 1024 * 1024; // 25 MB en bytes

class OpenAIService {
  constructor(apiKey) {
    this.openai = new OpenAI({ apiKey });
  }

  async getChatCompletion(systemPrompt, context) {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: context }
        ],
        max_tokens: 2000,
        temperature: 0.7,
      });

      logger.info("Respuesta de OpenAI obtenida correctamente");
      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error("Error al obtener respuesta de OpenAI:", error);
      throw error;
    }
  }

  async extractOrder(services, aiResponse) {
    const systemPrompt = `
      Eres un asistente especializado en extraer información de pedidos de imprenta.
      Tu tarea es extraer los detalles del pedido de la respuesta del asistente.
      Debes proporcionar un resumen del pedido en el siguiente formato JSON:

      {
        "items": [
          {
            "nombre": "Nombre del servicio",
            "cantidad": número,
            "ancho": número (si aplica),
            "alto": número (si aplica),
            "terminaciones": ["sellado", "ojetillos", "bolsillo"] (si aplica)
          }
        ],
        "observaciones": "Observaciones del pedido"
      }

      NO realices ningún cálculo. Solo extrae la información proporcionada por el asistente.
      Si no hay pedido o la información es insuficiente, devuelve un objeto JSON con un array de items vacío.
      NO incluyas ningún texto adicional, solo el JSON.
    `;

    const context = `
      Servicios disponibles:
      ${JSON.stringify(services, null, 2)}

      Respuesta del asistente:
      ${aiResponse}
    `;

    try {
      const response = await this.getChatCompletion(systemPrompt, context);
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(response);
      } catch (parseError) {
        logger.error("Error al analizar la respuesta JSON:", parseError);
        logger.debug("Respuesta recibida:", response);
        parsedResponse = { items: [] };
      }
      return parsedResponse;
    } catch (error) {
      logger.error("Error al extraer el pedido:", error);
      return { items: [] };
    }
  }

  async transcribeAudio(audioFilePath) {
    try {
      const stats = await fs.promises.stat(audioFilePath);
      if (stats.size > MAX_AUDIO_SIZE) {
        throw new Error(`El archivo de audio excede el tamaño máximo permitido de ${MAX_AUDIO_SIZE / (1024 * 1024)} MB`);
      }

      const response = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(audioFilePath),
        model: "whisper-1",
      });
      logger.info(`Audio transcrito exitosamente: ${audioFilePath}`);
      return response.text;
    } catch (error) {
      logger.error(`Error al transcribir audio: ${error.message}`);
      throw error;
    }
  }
}

export default OpenAIService;
// openaiService.js - Bot imprenta

import OpenAI from "openai";
import Logger from './logger.js';
import fs from 'fs';
import { promises as fsPromises } from 'fs';

const logger = new Logger();
const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25 MB en bytes

class OpenAIService {
  constructor(apiKey) {
    this.openai = new OpenAI({ apiKey });
  }

  async getChatCompletion(systemPrompt, context) {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini", // o "gpt-3.5-turbo" si no tienes acceso a GPT-4
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: context }
        ],
        max_tokens: 2000,
        temperature: 0.7,
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error("Error al obtener respuesta de OpenAI:", error);
      throw error;
    }
  }

  async extractOrder(products, aiResponse) {
      const systemPrompt = `
      Eres un asistente especializado en extraer información de pedidos de imprenta.
      Tu tarea es extraer los detalles del pedido de la respuesta del asistente.
      Debes proporcionar un resumen del pedido en el siguiente formato JSON:
    
      {
        "items": [
          {
            "categoria": "Categoría del producto",
            "nombre": "Nombre del producto",
            "cantidad": número,
            "medidas": {
              "ancho": número,
              "alto": número
            },
            "terminaciones": ["sellado", "ojetillos", "bolsillo"],
            "precio": número,
            "dpi": número,
            "formatos": ["PDF", "JPG"]
          }
        ],
        "observaciones": "Observaciones del pedido"
      }
    
      Si no hay un pedido específico o la información es insuficiente, devuelve un objeto JSON con un array de items vacío y una observación explicativa.
      NO incluyas ningún texto adicional, solo el JSON.
    `;
  
    const context = `
      Productos disponibles:
      ${JSON.stringify(products, null, 2)}
  
      Respuesta del asistente:
      ${aiResponse}
    `;
  
    try {
      const response = await this.getChatCompletion(systemPrompt, context);
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(response);
        if (!parsedResponse.items) {
          parsedResponse.items = [];
        }
        if (!parsedResponse.observaciones) {
          parsedResponse.observaciones = "No se proporcionaron observaciones.";
        }
  
        // Verificar y asignar valores por defecto para DPI y formatos si no están presentes
        parsedResponse.items.forEach(item => {
          if (!item.dpi) {
            item.dpi = 72; // Valor por defecto si no se especifica
          }
          if (!item.formatos) {
            item.formatos = ['PDF', 'JPG']; // Formatos por defecto si no se especifican
          }
        });
  
      } catch (parseError) {
        logger.error("Error al analizar la respuesta JSON:", parseError);
        logger.info("Respuesta recibida:", response);
        parsedResponse = { 
          items: [], 
          observaciones: "Error al procesar la respuesta. No se pudo extraer información del pedido."
        };
      }
      return parsedResponse;
    } catch (error) {
      logger.error("Error al extraer el pedido:", error);
      return { 
        items: [], 
        observaciones: "Error al procesar la solicitud de pedido."
      };
    }
  }

  async transcribeAudio(audioFilePath) {
    try {
      const stats = await fsPromises.stat(audioFilePath);
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
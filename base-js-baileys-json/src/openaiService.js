// openaiService.js - bot de la imprenta
// openaiService.js
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
  async analyzeIntent(message, context, services, currentState) {
    const serviceList = Object.values(services).flat().map(s => s.nombre).join(', ');
    const prompt = `
    Eres un asistente de una imprenta. Analiza el siguiente mensaje considerando el estado actual: ${currentState}.
    
    Estados posibles: INITIAL, SERVICE_SELECTION, MEASUREMENTS_AND_FINISHES, FILE_UPLOAD, SUMMARY, CONFIRMATION

    Servicios disponibles: ${serviceList}

    Responde con un JSON:
    {
      "intencion": "SALUDAR" | "SOLICITAR_INFO" | "SELECCIONAR_SERVICIO" | "PROPORCIONAR_MEDIDAS" | "CONFIRMAR_ARCHIVO" | "CONFIRMAR_COTIZACION" | "AGREGAR_SERVICIO" | "SOLICITAR_AGENTE" | "OTRO",
      "servicioMencionado": string | null,
      "medidas": { "ancho": number, "alto": number } | null,
      "terminaciones": string[] | null,
      "respuestaSugerida": string
    }

    Contexto de la conversación:
    ${context.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

    Mensaje del cliente: "${message}"
    `;

    try {
      const response = await this.getChatCompletion([
        { role: "system", content: prompt },
        { role: "user", content: message }
      ]);
      
      const parsedResponse = JSON.parse(response);
      this.logger.info("Análisis de intención completado", { input: message, output: parsedResponse });
      return parsedResponse;
    } catch (error) {
      this.logger.error("Error al analizar la intención:", error);
      return {
        intencion: "OTRO",
        servicioMencionado: null,
        medidas: null,
        terminaciones: null,
        respuestaSugerida: "Lo siento, no pude entender tu mensaje. ¿Podrías reformularlo?"
      };
    }
  }

  async validateMeasurementsAndFinishes(service, message) {
    const prompt = `
    Valida si las medidas y terminaciones proporcionadas son correctas para el servicio: ${JSON.stringify(service)}.
    Medidas válidas: ${service.medidas}
    Terminaciones disponibles: ${service.sellado ? 'sellado,' : ''} ${service.ojetillos ? 'ojetillos,' : ''} ${service.bolsillo ? 'bolsillo' : ''}

    Responde con un JSON:
    {
      "medidasValidas": boolean,
      "terminacionesValidas": boolean,
      "medidas": { "ancho": number, "alto": number } | null,
      "terminaciones": string[] | null,
      "respuestaSugerida": string
    }

    Mensaje del cliente: "${message}"
    `;

    try {
      const response = await this.getChatCompletion([
        { role: "system", content: prompt },
        { role: "user", content: message }
      ]);

      const parsedResponse = JSON.parse(response);
      this.logger.info("Validación de medidas y terminaciones completada", { input: message, output: parsedResponse });
      return parsedResponse;
    } catch (error) {
      this.logger.error("Error al validar medidas y terminaciones:", error);
      return {
        medidasValidas: false,
        terminacionesValidas: false,
        medidas: null,
        terminaciones: null,
        respuestaSugerida: "No pude procesar las medidas y terminaciones. Por favor, proporciónalas en un formato claro, por ejemplo: '100x150 cm, con sellado y ojetillos'."
      };
    }
  }

  async transcribeAudio(audioFilePath) {
    try {
      const audioFile = await fs.readFile(audioFilePath);
      const response = await this.openai.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
      });
      this.logger.info("Transcripción de audio completada", { filePath: audioFilePath });
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
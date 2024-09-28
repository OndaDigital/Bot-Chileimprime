// services/openaiService.js

import OpenAI from "openai";
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { CustomError } from '../utils/errorHandler.js';

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
  }

  async getChatCompletion(systemPrompt, context) {
    try {
      const response = await this.openai.chat.completions.create({
        model: config.languageModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: context }
        ],
        max_tokens: 2000,
        temperature: 0.5,
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error("Error al obtener respuesta de OpenAI:", error);
      throw new CustomError('OpenAIError', 'Error al obtener respuesta de OpenAI', error);
    }
  }

  async extractOrder(menu, aiResponse) {
    const systemPrompt = `
      Eres un asistente especializado en extraer información de pedidos de restaurantes.
      Tu tarea es extraer los detalles del pedido de la respuesta del asistente.
      Debes proporcionar un resumen del pedido en el siguiente formato JSON:

      {
        "items": [
          {
            "categoria": "Categoría del ítem",
            "nombre": "Nombre del ítem",
            "cantidad": número,
            "precio": número
          }
        ],
        "observaciones": "Observaciones del pedido"
      }

      NO realices ningún cálculo. Solo extrae la información proporcionada por el asistente.
      Si no hay pedido o la información es insuficiente, devuelve un objeto JSON con un array de items vacío.
      NO incluyas ningún texto adicional, solo el JSON.
    `;

    const context = `
      Menú del restaurante:
      ${JSON.stringify(menu, null, 2)}

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
        logger.info("Respuesta recibida:", response);
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
      const stats = await fsPromises.stat(audioFilePath);
      if (stats.size > config.maxAudioSize) {
        throw new CustomError('AudioSizeError', `El archivo de audio excede el tamaño máximo permitido de ${config.maxAudioSize / (1024 * 1024)} MB`);
      }

      const response = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(audioFilePath),
        model: "whisper-1",
      });
      logger.info(`Audio transcrito exitosamente: ${audioFilePath}`);
      return response.text;
    } catch (error) {
      if (error instanceof CustomError) {
        throw error;
      }
      logger.error(`Error al transcribir audio: ${error.message}`);
      throw new CustomError('TranscriptionError', 'Error al transcribir el audio', error);
    }
  }

  getSystemPrompt(menu, additionalInfo, currentOrder) {
    return `Eres un empleado amigable y eficiente de "El Comilón", un restaurante de comida rápida. Tu objetivo es ayudar a los clientes a hacer pedidos de manera efectiva y aumentar las ventas. Sigue estas instrucciones:
    
    1. IMPORTANTE: Saluda SOLO UNA VEZ al inicio de la conversación con: "¡Hola, bienvenido al Comilón! 😊 {salto de linea} ¿Qué te gustaría ordenar hoy? {salto de linea} {salto de linea} Si necesitas ver el *menú* o prefieres enviar un *mensaje de voz*, no dudes en hacerlo." No repitas este saludo en futuras interacciones.
    2. Mantén un tono amigable y profesional. Usa emojis ocasionalmente para dar un tono agradable.
    3. Actualiza el pedido con cada interacción del cliente. (NO calcules subtotales ni totales).
    4. IMPORTANTE: Acepta CUALQUIER cantidad de items que el cliente solicite, sin importar cuán grande sea. Si está en el menú, asume que está disponible en la cantidad solicitada.
    5. Haz sugerencias inteligentes SOLO si el cliente no ha especificado una cantidad o producto específico:
       - Si piden un plato principal sin bebida, ofrece una bebida.
       - Si el pedido se acerca a un combo, sugiere el combo si es más conveniente.
       - Sugiere complementos apropiados (ej. papas fritas con una hamburguesa).
    6. Usa este formato para resumir el pedido después de cada cambio (NO calcules subtotales ni totales):
    
    📋 Resumen de tu pedido:
    *[CATEGORÍA EXACTA DEL MENÚ]* - [NOMBRE ESPECÍFICO DEL ITEM]
    Cantidad: CANTIDADx  $PRECIO c/u
    
    7. Sé preciso con los precios, las cantidades, los nombres de los items y las categorías. Verifica siempre contra el menú y usa las categorías exactas del menú en el resumen del pedido.
    8. Si un cliente pide algo que no está en el menú, informa amablemente que no está disponible y ofrece alternativas.
    9. Siempre que el cliente solicite ver el menú o pida recomendaciones sin especificar una categoría, muestra el menú completo.
    10. Antes de confirmar, pregunta SIEMPRE si desean agregar alguna observación al pedido.
    11. Cuando el cliente esté listo para confirmar, usa "CONFIRMAR_PEDIDO" seguido del resumen final sin cálculos.
    11.5 Para confirmar el pedido, utiliza la siguiente secuencia:
      a) Pregunta: "¿Deseas agregar alguna observación final al pedido?"
      b) Si el cliente dice que no quiere una observación o indica de alguna manera que quiere confirmar o finalizar el pedido, usa "CONFIRMAR_PEDIDO" seguido del resumen final.
    12. IMPORTANTE: Solo usa "SOLICITUD_HUMANO" si el cliente explícitamente pide hablar con un humano o un supervisor. No lo uses para respuestas simples como "sí" o "no".
    13. Si detectas uso inadecuado, usa "ADVERTENCIA_MAL_USO_DETECTADO".
    14. IMPORTANTE: Nunca te identifiques como un bot, IA, asistente virtual o similar. Actúa como un empleado humano real de un restaurante de comida rápida.
    15. IMPORTANTE: Nunca uses frases como "Vendedor:", "Asistente:", "Como empleado de El Comilón" o "En El Comilón nosotros...". Habla de forma natural, como si estuvieras en el mostrador del restaurante, sin introducir tus respuestas.
    16. Si el cliente pregunta si eres un bot o IA, evade la pregunta amablemente y redirige la conversación al pedido.
    17. Usa lenguaje coloquial y natural, como lo haría un empleado real de restaurante de comida rápida.
    18. Interpreta respuestas simples como "sí" o "no" en el contexto de la pregunta anterior. Por ejemplo, si preguntaste sobre agregar una observación y el cliente responde "sí", pide que especifique la observación.
    19. Responde SOLO con la información específica que el cliente solicita. No proporciones información adicional a menos que sea directamente relevante o solicitada.
    20. Cuando un cliente mencione "delivery" o "despacho", proporciona SOLO la información sobre comunas con despacho y la dirección de retiro. Por ejemplo: "Realizamos despachos a las siguientes comunas: [lista de comunas]. Si prefieres retirar tu pedido, nuestra dirección es: [dirección de retiro]."
    21. Si el cliente pregunta específicamente por horarios, métodos de pago, promociones o tiempos de preparación, proporciona SOLO esa información.
    22. Si el cliente pregunta por información que no está disponible en los datos proporcionados, ofrece derivarlo a un representante humano.
    23. IMPORTANTE: Formatea TODOS tus mensajes siguiendo estas pautas:
     - Incluye al menos un emoji relevante en cada mensaje para hacerlo más amigable y visual.
     - Usa *negritas* para resaltar información clave como nombres de productos, precios o acciones importantes.
     - Utiliza _cursivas_ para enfatizar detalles secundarios o agregar un toque de estilo.
     - Estructura tus mensajes en párrafos cortos para mejor legibilidad.
     - Asegúrate de que cada mensaje tenga un tono amigable y profesional, manteniendo la conversación fluida.

    IMPORTANTE: Usa ÚNICAMENTE el siguiente menú para responder a las consultas del cliente:
    
    ${JSON.stringify(menu, null, 2)}

    Información adicional (NO la menciones a menos que sea solicitada):
    ${JSON.stringify(additionalInfo, null, 2)}
    
    Estado actual del pedido:
    ${JSON.stringify(currentOrder, null, 2)}
    
    IMPORTANTE: Siempre que pidan el menú, debes presentar ÚNICAMENTE el menú proporcionado arriba, no inventes ni agregues ítems.`;
  }
}

export default new OpenAIService();
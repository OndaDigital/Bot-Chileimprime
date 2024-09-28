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
        max_tokens: config.maxTokens,
        temperature: config.temperature,
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error("Error al obtener respuesta de OpenAI:", error);
      throw new CustomError('OpenAIError', 'Error al obtener respuesta de OpenAI', error);
    }
  }

  async validateFileContent(fileContent, fileType, service) {
    const systemPrompt = `
      Eres un experto en validación de archivos para servicios de impresión.
      Tu tarea es analizar el contenido del archivo y determinar si cumple con los requisitos para el servicio de impresión especificado.
      Debes proporcionar un resultado en el siguiente formato JSON:

      {
        "isValid": booleano,
        "reason": "Explicación detallada de por qué el archivo es válido o no"
      }

      Criterios de validación:
      1. El formato del archivo debe coincidir con el formato requerido por el servicio.
      2. La resolución (DPI) debe ser igual o superior al mínimo requerido por el servicio.
      3. Las dimensiones del archivo deben ser apropiadas para el servicio solicitado.

      Servicio solicitado:
      ${JSON.stringify(service, null, 2)}

      Contenido del archivo (primeros 1000 caracteres):
      ${fileContent.substring(0, 1000)}
    `;

    try {
      const response = await this.getChatCompletion(systemPrompt, "Valida este archivo");
      return JSON.parse(response);
    } catch (error) {
      logger.error("Error al validar el contenido del archivo:", error);
      return { isValid: false, reason: "Error en la validación del archivo" };
    }
  }

  getSystemPrompt(services, currentOrder, additionalInfo) {
    return `Eres un asistente experto en servicios de imprenta llamada Chileimprime. Tu objetivo es guiar al cliente a través del proceso de cotización para un único servicio de impresión. Sigue estas instrucciones detalladas:

    1. Análisis Continuo del Estado del Pedido:
       - Examina constantemente el contenido de currentOrder: ${JSON.stringify(currentOrder)}
       - Elementos posibles en currentOrder: {service, category, type, measures, finishes, quantity, filePath, fileAnalysis}
       - Adapta tu respuesta basándote en la información disponible y lo que falta por completar.

    2. Inicio y Selección de Servicio:
       - Si es el primer mensaje, saluda al cliente y ofrece asistencia.
       - Si no hay un servicio seleccionado, presenta los servicios disponibles y pide al cliente que elija uno.
       - Servicios disponibles:
         ${JSON.stringify(services, null, 2)}
       - Utiliza procesamiento de lenguaje natural para detectar si el cliente menciona un servicio directamente.
       - Cuando el cliente seleccione un servicio válido, responde con el comando JSON:
         {"command": "SELECT_SERVICE", "service": "[Nombre del Servicio]"}

    3. Manejo de Categorías y Tipos de Servicios:
       - Una vez seleccionado el servicio, verifica su categoría y tipo en currentOrder.
       - Para categorías "Telas PVC", "Banderas", "Adhesivos", "Adhesivo Vehicular", "Back Light":
         a) Solicita ancho, alto y cantidad.
         b) Ofrece los anchos disponibles específicos para el servicio (están en currentOrder.availableWidths).
         c) El alto debe ser mayor a 1 metro.
         d) Ofrece terminaciones si están disponibles (revisa currentOrder.availableFinishes).
       - Para categorías "Otros", "Imprenta", "Péndon Roller", "Palomas", "Figuras", "Extras":
         a) Solicita solo la cantidad.
         b) No trabajes con medidas personalizadas.
         c) Ofrece terminaciones si el servicio lo permite (revisa currentOrder.availableFinishes).

    4. Especificación de Medidas y Terminaciones:
       - Si el servicio requiere medidas (categorías: Telas PVC, Banderas, Adhesivos, Adhesivo Vehicular, Back Light):
         a) Presenta al cliente los anchos disponibles específicos para este servicio:
            Anchos disponibles: ${JSON.stringify(currentOrder.availableWidths)}
         b) Guía al cliente para que elija uno de estos anchos válidos.
         c) Pide al cliente que especifique un alto mayor a 1 metro.
         d) Solicita la cantidad deseada.
       - Si el servicio no requiere medidas (categorías: Otros, Imprenta, Péndon Roller, Palomas, Figuras, Extras):
         a) Solicita solo la cantidad deseada.
       - Para todos los servicios, ofrece las terminaciones disponibles según:
         Terminaciones disponibles: ${JSON.stringify(currentOrder.availableFinishes)}
       - Explica claramente qué terminaciones están disponibles y pide al cliente que elija.
       - Cuando el cliente proporcione información válida, responde con los comandos JSON apropiados:
         Para servicios con medidas:
         {"command": "SET_MEASURES", "width": X, "height": Y}
         {"command": "SET_QUANTITY", "quantity": Z}
         {"command": "SET_FINISHES", "sellado": boolean, "ojetillos": boolean, "bolsillo": boolean}
         Para servicios sin medidas:
         {"command": "SET_QUANTITY", "quantity": Z}
         {"command": "SET_FINISHES", "sellado": boolean, "ojetillos": boolean, "bolsillo": boolean}

    5. Subida y Validación de Archivos:
       - Si no hay filePath en currentOrder, pide al cliente que envíe el archivo de diseño.
       - Cuando haya un fileAnalysis en currentOrder, evalúa su validez considerando:
         a) El servicio seleccionado
         b) Las medidas especificadas
         c) El resultado del análisis del archivo (formato, DPI, dimensiones)
       - Criterios de validación:
         ${JSON.stringify(currentOrder.fileValidationCriteria, null, 2)}
       - Explica detalladamente si el archivo es válido o no, y por qué.
       - Si el archivo es válido, responde con el comando JSON:
         {"command": "VALIDATE_FILE", "isValid": true}
       - Si no es válido, proporciona instrucciones claras sobre cómo corregirlo y responde:
         {"command": "VALIDATE_FILE", "isValid": false, "reason": "[Explicación]"}

    6. Resumen y Confirmación:
       - Cuando tengas toda la información necesaria, presenta un resumen detallado del pedido.
       - El resumen debe incluir: servicio, medidas (si aplica), cantidad, terminaciones seleccionadas, y confirmación de archivo válido.
       - Permite al cliente modificar cualquier aspecto antes de la confirmación final.
       - Si el cliente confirma, responde con el comando JSON:
         {"command": "CONFIRM_ORDER"}

    7. Comunicación Clara:
       - Usa un tono amigable pero profesional.
       - Estructura tus respuestas en párrafos cortos para mejor legibilidad.
       - Utiliza emojis ocasionalmente para dar un tono más amigable.

    IMPORTANTE:
    - Utiliza los comandos JSON especificados para comunicar selecciones y validaciones al sistema.
    - Actúa como un experto humano en impresión, no como una IA.
    - Sé preciso con la información técnica, pero mantén un lenguaje accesible.
    - Si el cliente pide algo fuera de lo ofrecido, sugiere alternativas o recomienda contactar al soporte.
    - No calcules precios. El sistema se encargará de esto basándose en la información en currentOrder.
    - Maneja solo un servicio por conversación.
    - Si el cliente intenta cotizar más de un servicio, explica amablemente que por ahora solo puedes manejar un servicio por conversación.

    Información adicional (NO la menciones a menos que sea solicitada):
    ${JSON.stringify(additionalInfo, null, 2)}

    Responde al siguiente mensaje del cliente:`;
  }
}

export default new OpenAIService();
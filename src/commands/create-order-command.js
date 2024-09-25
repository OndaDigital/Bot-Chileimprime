// src/commands/create-order-command.js

import { sheetsService } from '../services/sheets-service.js';
import { logger } from '../utils/logger.js';

class CreateOrderCommand {
  async execute(ctx, { flowDynamic }) {
    try {
      await flowDynamic('Vamos a crear tu pedido. Por favor, proporciona los siguientes detalles:');
      await flowDynamic('1. Nombre del servicio\n2. Cantidad\n3. Medidas (si aplica)\n4. Acabados especiales (si deseas)');
      ctx.userContext.setState('CREATING_ORDER');
    } catch (error) {
      logger.error('Error executing create order command', error);
      await flowDynamic('Lo siento, ha ocurrido un error al iniciar el proceso de pedido.');
    }
  }

  async handleOrderDetails(ctx, { flowDynamic }) {
    // Aquí iría la lógica para procesar los detalles del pedido
    // Este método se llamaría desde el estado CREATING_ORDER en conversation-manager.js
  }
}

export const createOrderCommand = new CreateOrderCommand();
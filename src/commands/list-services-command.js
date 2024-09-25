// src/commands/list-services-command.js

import { sheetsService } from '../services/sheets-service.js';
import { logger } from '../utils/logger.js';

class ListServicesCommand {
  async execute(ctx, { flowDynamic }) {
    try {
      const serviceList = await sheetsService.getFormattedServiceList();
      await flowDynamic(serviceList);
    } catch (error) {
      logger.error('Error executing list services command', error);
      await flowDynamic('Lo siento, ha ocurrido un error al obtener la lista de servicios.');
    }
  }
}

export const listServicesCommand = new ListServicesCommand();
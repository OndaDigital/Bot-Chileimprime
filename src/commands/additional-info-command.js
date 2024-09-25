// src/commands/additional-info-command.js

import { sheetsService } from '../services/sheets-service.js';
import { logger } from '../utils/logger.js';

class AdditionalInfoCommand {
  async execute(ctx, { flowDynamic }) {
    try {
      const additionalInfo = await sheetsService.getFormattedAdditionalInfo();
      await flowDynamic(additionalInfo);
    } catch (error) {
      logger.error('Error executing additional info command', error);
      await flowDynamic('Lo siento, ha ocurrido un error al obtener la información adicional.');
    }
  }
}

export const additionalInfoCommand = new AdditionalInfoCommand();
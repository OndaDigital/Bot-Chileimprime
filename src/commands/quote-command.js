// commands/quote-command.js

import { sheetsService } from '../services/sheets-service.js';
import { logger } from '../utils/logger.js';
import { validators } from '../utils/validators.js';
import { ValidationError } from '../utils/error-types.js';

class QuoteCommand {
  async execute(ctx) {
    try {
      const menu = await sheetsService.getMenu();
      ctx.userContext.setMenu(menu);
      await ctx.reply('Por favor, dime qué tipo de impresión necesitas.');
      ctx.userContext.setState('SELECTING_SERVICE');

      // La lógica siguiente se manejará en los estados correspondientes de la FSM
      // Este comando solo inicia el proceso de cotización

    } catch (error) {
      if (error instanceof ValidationError) {
        await ctx.reply(error.message);
      } else {
        logger.error('Error executing quote command', error);
        await ctx.reply('Lo siento, ha ocurrido un error al procesar tu solicitud.');
      }
    }
  }

  async handleServiceSelection(ctx, service) {
    // Esta lógica se moverá al estado SELECTING_SERVICE de la FSM
    try {
      validators.validateServiceSelection(service, ctx.userContext.getMenu());
      ctx.userContext.getCart().addItem(service);
      ctx.userContext.setState('ENTERING_MEASUREMENTS');
      await ctx.reply(`Has seleccionado ${service.name}. Ahora, por favor, proporciona las medidas.`);
    } catch (error) {
      throw new ValidationError(error.message);
    }
  }

  async handleMeasurements(ctx, measurements) {
    // Esta lógica se moverá al estado ENTERING_MEASUREMENTS de la FSM
    try {
      const service = ctx.userContext.getCart().getLastItem();
      validators.validateMeasurements(measurements, service);
      ctx.userContext.getCart().updateLastItem({ measurements });
      ctx.userContext.setState('SELECTING_FINISHES');
      await ctx.reply('Medidas registradas. ¿Deseas algún acabado especial?');
    } catch (error) {
      throw new ValidationError(error.message);
    }
  }

  async handleFinishes(ctx, finishes) {
    // Esta lógica se moverá al estado SELECTING_FINISHES de la FSM
    try {
      const service = ctx.userContext.getCart().getLastItem();
      validators.validateFinishes(finishes, service);
      ctx.userContext.getCart().updateLastItem({ finishes });
      ctx.userContext.setState('UPLOADING_FILE');
      await ctx.reply('Acabados registrados. Por favor, sube tu archivo de diseño.');
    } catch (error) {
      throw new ValidationError(error.message);
    }
  }
}

export const quoteCommand = new QuoteCommand();
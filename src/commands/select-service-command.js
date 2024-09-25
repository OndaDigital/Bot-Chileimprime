// commands/select-service-command.js

import { sheetsService } from '../services/sheets-service.js';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/error-types.js';

class SelectServiceCommand {
  async execute(ctx, { flowDynamic }) {
    try {
      const userInput = ctx.body.toLowerCase();
      const services = await sheetsService.getServices();
      const selectedService = this.findService(services, userInput);

      if (selectedService) {
        ctx.userContext.setSelectedService(selectedService);
        await flowDynamic(`Has seleccionado ${selectedService.nombre}. El precio base es $${selectedService.precio}. ¿Deseas proceder con la cotización?`);
      } else {
        throw new ValidationError('Servicio no encontrado. Por favor, selecciona un servicio válido del menú.');
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        await flowDynamic(error.message);
      } else {
        logger.error('Error executing select service command:', error);
        await flowDynamic('Lo siento, ha ocurrido un error al seleccionar el servicio. Por favor, intenta nuevamente.');
      }
    }
  }

  findService(services, userInput) {
    for (const category of Object.values(services)) {
      const service = category.find(s => s.nombre.toLowerCase().includes(userInput));
      if (service) return service;
    }
    return null;
  }
}

export const selectServiceCommand = new SelectServiceCommand();
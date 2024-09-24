// commands/generate-budget-command.js

import { openaiService } from '../services/openai-service.js';
import { printingCalculator } from '../services/printing-calculator.js';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/error-types.js';

class GenerateBudgetCommand {
  async execute(ctx) {
    try {
      const cart = ctx.userContext.getCart();
      if (cart.isEmpty()) {
        await ctx.reply('No hay items en el carrito para generar un presupuesto. Por favor, cotiza algunos servicios primero.');
        ctx.userContext.setState('MAIN_MENU');
        return;
      }

      await ctx.reply('Generando presupuesto basado en tu carrito actual...');
      ctx.userContext.setState('CONFIRMING_ORDER');

      const budget = await this.generateBudget(cart);
      await ctx.reply(budget);

      await ctx.reply('¿Deseas confirmar este presupuesto o hacer cambios?');
    } catch (error) {
      logger.error('Error executing generate budget command', error);
      await ctx.reply('Lo siento, ha ocurrido un error al generar el presupuesto.');
      ctx.userContext.setState('MAIN_MENU');
    }
  }

  async generateBudget(cart) {
    try {
      const calculatedOrder = printingCalculator.calculatePrice(cart);
      const formattedBudget = printingCalculator.formatOrderSummary(calculatedOrder);

      const aiPrompt = `Genera un presupuesto detallado basado en la siguiente orden de impresión:\n${formattedBudget}`;
      const aiResponse = await openaiService.getChatCompletion(aiPrompt);

      return `Aquí tienes tu presupuesto detallado:\n\n${aiResponse}`;
    } catch (error) {
      logger.error('Error generating budget', error);
      throw new Error('No se pudo generar el presupuesto');
    }
  }

  async handleConfirmation(ctx, confirmation) {
    if (confirmation.toLowerCase() === 'confirmar') {
      await ctx.reply('¡Gracias por confirmar tu pedido! Nuestro equipo se pondrá en contacto contigo pronto para finalizar los detalles.');
      // Aquí se podría agregar lógica para guardar el pedido en la base de datos o enviar notificaciones
      ctx.userContext.clearCart();
    } else if (confirmation.toLowerCase() === 'cambios') {
      await ctx.reply('Entendido. Volvamos al menú principal para hacer cambios en tu pedido.');
    } else {
      await ctx.reply('No entendí tu respuesta. Por favor, di "confirmar" para aceptar el presupuesto o "cambios" para modificar tu pedido.');
      return; // Mantener el estado actual para esperar una respuesta válida
    }
    
    ctx.userContext.setState('MAIN_MENU');
    await ctx.reply('¿En qué más puedo ayudarte?');
  }
}

export const generateBudgetCommand = new GenerateBudgetCommand();
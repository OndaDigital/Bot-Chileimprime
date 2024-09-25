// commands/default-command.js
import { logger } from '../utils/logger.js';

class DefaultCommand {
  async execute(ctx, { flowDynamic }) {
    logger.info(`Executing default command for user ${ctx.from}`);
    await flowDynamic('Lo siento, no he entendido tu solicitud. ¿Podrías reformularla o elegir una de las opciones disponibles?');
  }
}

export const defaultCommand = new DefaultCommand();
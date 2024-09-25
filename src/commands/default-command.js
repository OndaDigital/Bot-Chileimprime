// commands/default-command.js
import { logger } from '../utils/logger.js';

class DefaultCommand {
  async execute(ctx, { flowDynamic }) {
    const currentState = ctx.userContext.getState();
    logger.info(`Executing default command for user ${ctx.from}`);
    await flowDynamic('Lo siento, no he entendido tu solicitud. ¿Podrías reformularla o elegir una de las opciones disponibles?');
    const nextState = ctx.userContext.getState();
    logger.logState(currentState, nextState, { userId: ctx.from, command: 'default' });
  }
}

export const defaultCommand = new DefaultCommand();
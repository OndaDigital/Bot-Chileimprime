import { logger } from '../utils/logger.js';

class CommandHandler {
  constructor() {
    this.commands = new Map();
    this.subcommands = new Map();
    this.dependencies = new Map();
    this.defaultCommand = null;
  }

  registerDefaultCommand(handler) {
    this.defaultCommand = handler;
    logger.info('Default command registered');
  }

  registerCommand(name, handler, dependencies = []) {
    this.commands.set(name, handler);
    this.dependencies.set(name, dependencies);
    logger.info(`Command ${name} registered`);
  }

  registerSubcommand(commandName, subcommandName, handler) {
    if (!this.subcommands.has(commandName)) {
      this.subcommands.set(commandName, new Map());
    }
    this.subcommands.get(commandName).set(subcommandName, handler);
    logger.info(`Subcommand ${subcommandName} registered for command ${commandName}`);
  }

  async executeCommand(name, ctx, { flowDynamic, gotoFlow }, subcommand = null) {
    const currentState = ctx.userContext.getState();

    try {
      if (this.commands.has(name)) {
        await this.executeDependencies(name, ctx, { flowDynamic, gotoFlow });
        if (subcommand && this.subcommands.has(name) && this.subcommands.get(name).has(subcommand)) {
          await this.subcommands.get(name).get(subcommand).execute(ctx, { flowDynamic, gotoFlow });
        } else {
          await this.commands.get(name).execute(ctx, { flowDynamic, gotoFlow });
        }
      } else if (this.defaultCommand) {
        await this.defaultCommand.execute(ctx, { flowDynamic, gotoFlow });
      } else {
        logger.error(`Command ${name} not found and no default command registered`);
        throw new Error(`Command ${name} not found`);
      }

      const nextState = ctx.userContext.getState();
      if (nextState !== currentState) {
        logger.logState(currentState, nextState, { userId: ctx.from, command: name, subcommand });
      }
    } catch (error) {
      logger.error(`Error executing command ${name}`, error);
      throw error;
    }
  }

  async executeDependencies(commandName, ctx, { flowDynamic, gotoFlow }) {
    const dependencies = this.dependencies.get(commandName) || [];
    for (const dep of dependencies) {
      await this.executeCommand(dep, ctx, { flowDynamic, gotoFlow });
    }
  }

  getRegisteredCommands() {
    return Array.from(this.commands.keys());
  }

  getSubcommands(commandName) {
    return this.subcommands.get(commandName) ? Array.from(this.subcommands.get(commandName).keys()) : [];
  }
}

export const commandHandler = new CommandHandler();
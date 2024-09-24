import { logger } from '../utils/logger.js';

class CommandHandler {
  constructor() {
    this.commands = new Map();
    this.subcommands = new Map();
    this.dependencies = new Map();
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

  async executeCommand(name, ctx, subcommand = null) {
    if (this.commands.has(name)) {
      try {
        await this.executeDependencies(name, ctx);
        if (subcommand && this.subcommands.has(name) && this.subcommands.get(name).has(subcommand)) {
          await this.subcommands.get(name).get(subcommand).execute(ctx);
        } else {
          await this.commands.get(name).execute(ctx);
        }
      } catch (error) {
        logger.error(`Error executing command ${name}`, error);
        throw error;
      }
    } else if (this.defaultCommand) {
      await this.defaultCommand.execute(ctx);
    } else {
      logger.error(`Command ${name} not found and no default command registered`);
      throw new Error(`Command ${name} not found`);
    }
  }

  async executeDependencies(commandName, ctx) {
    const dependencies = this.dependencies.get(commandName) || [];
    for (const dep of dependencies) {
      await this.executeCommand(dep, ctx);
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
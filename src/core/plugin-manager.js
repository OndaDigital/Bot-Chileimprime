import { logger } from '../utils/logger.js';

class PluginManager {
  constructor() {
    this.plugins = new Map();
  }

  registerPlugin(name, plugin) {
    if (this.plugins.has(name)) {
      logger.warn(`Plugin ${name} already registered. Overwriting.`);
    }
    this.plugins.set(name, plugin);
    logger.info(`Plugin ${name} registered successfully.`);
  }

  getPlugin(name) {
    if (!this.plugins.has(name)) {
      logger.error(`Plugin ${name} not found.`);
      return null;
    }
    return this.plugins.get(name);
  }

  async executePluginMethod(pluginName, methodName, ...args) {
    const plugin = this.getPlugin(pluginName);
    if (!plugin) {
      throw new Error(`Plugin ${pluginName} not found.`);
    }
    if (typeof plugin[methodName] !== 'function') {
      throw new Error(`Method ${methodName} not found in plugin ${pluginName}.`);
    }
    try {
      return await plugin[methodName](...args);
    } catch (error) {
      logger.error(`Error executing method ${methodName} of plugin ${pluginName}:`, error);
      throw error;
    }
  }

  getRegisteredPlugins() {
    return Array.from(this.plugins.keys());
  }
}

export const pluginManager = new PluginManager();
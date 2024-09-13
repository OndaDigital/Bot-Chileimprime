// logger.js - Bot imprenta

class Logger {
    constructor() {
      this.logLevels = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3
      };
      this.currentLogLevel = this.logLevels.INFO; // Nivel de log por defecto
    }
  
    setLogLevel(level) {
      if (this.logLevels.hasOwnProperty(level)) {
        this.currentLogLevel = this.logLevels[level];
      } else {
        console.warn(`Nivel de log inválido: ${level}. Usando el nivel por defecto.`);
      }
    }
  
    formatMessage(level, message) {
      const timestamp = new Date().toISOString();
      return `${timestamp} [${level}]: ${message}`;
    }
  
    log(level, message) {
      if (this.logLevels[level] >= this.currentLogLevel) {
        console.log(this.formatMessage(level, message));
      }
    }
  
    debug(message) {
      this.log('DEBUG', message);
    }
  
    info(message) {
      this.log('INFO', message);
    }
  
    warn(message) {
      this.log('WARN', message);
    }
  
    error(message) {
      this.log('ERROR', message);
    }
  
    // Método para registrar objetos complejos
    logObject(level, message, obj) {
      if (this.logLevels[level] >= this.currentLogLevel) {
        console.log(this.formatMessage(level, message));
        console.dir(obj, { depth: null, colors: true });
      }
    }
  }
  
  export default Logger;
// utils/logger.js

import winston from 'winston';
import config from '../config/index.js';
import moment from 'moment-timezone';

// Configurar el formato de fecha para Chile
moment.tz.setDefault("America/Santiago");

const customFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  const formattedDate = moment().format('YYYY-MM-DD HH:mm:ss');
  let msg = `${formattedDate} - ${level.toUpperCase()} - ${message}`;
  
  if (Object.keys(metadata).length > 0 && metadata.service !== 'print-bot') {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  
  return msg;
});

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    customFormat
  ),
  defaultMeta: { service: 'print-bot' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        customFormat
      )
    }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Sobrescribir los métodos de logging para asegurar el formato correcto
['error', 'warn', 'info', 'debug'].forEach((level) => {
  const originalMethod = logger[level];
  logger[level] = function (message, metadata) {
    const formattedDate = moment().format('YYYY-MM-DD HH:mm:ss');
    const formattedMessage = `${formattedDate} - ${level.toUpperCase()} - ${message}`;
    if (metadata) {
      originalMethod.call(this, formattedMessage, metadata);
    } else {
      originalMethod.call(this, formattedMessage);
    }
  };
});

// Método personalizado para logging de errores
logger.logError = (message, error) => {
  const formattedDate = moment().format('YYYY-MM-DD HH:mm:ss');
  logger.error(`${formattedDate} - ERROR - ${message}: ${error.message}`, { 
    stack: error.stack,
    metadata: error
  });
};

// Método personalizado para logging de transiciones de estado
logger.logState = (currentState, nextState, context) => {
  const formattedDate = moment().format('YYYY-MM-DD HH:mm:ss');
  logger.info(`${formattedDate} - INFO - State transition: ${currentState} -> ${nextState}`, context);
};

export { logger };
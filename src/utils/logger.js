import winston from 'winston';
import config from '../config/config.js';
import moment from 'moment-timezone';

const { combine, timestamp, printf } = winston.format;

const myFormat = printf(({ level, message, timestamp }) => {
  const formattedTimestamp = moment(timestamp).tz('America/Santiago').format('DD-MM-YY - HH:mm:ss a');
  return `${formattedTimestamp} : [${level.toUpperCase()}] ${message}`;
});

const logger = winston.createLogger({
  level: config.logLevel || 'info',
  format: combine(
    timestamp(),
    myFormat
  ),
  defaultMeta: { service: 'chatbot-service' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: myFormat,
  }));
}

export default logger;

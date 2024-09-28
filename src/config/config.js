// config/config.js

import dotenv from 'dotenv';
import { CustomError } from '../utils/errorHandler.js';

dotenv.config();

const requiredEnvVars = [
  'PORT',
  'GOOGLE_SHEET_ID',
  'OPENAI_API_KEY',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PRIVATE_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new CustomError('ConfigError', `Missing required environment variable: ${envVar}`);
  }
}

export default {
  port: process.env.PORT,
  googleSheetId: process.env.GOOGLE_SHEET_ID,
  openaiApiKey: process.env.OPENAI_API_KEY,
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  blacklistDuration: parseInt(process.env.BLACKLIST_DURATION) || 10 * 60 * 1000, // 10 minutos por defecto
  humanBlacklistDuration: parseInt(process.env.HUMAN_BLACKLIST_DURATION) || 60 * 60 * 1000, // 1 hora por defecto
  abuseBlacklistDuration: parseInt(process.env.ABUSE_BLACKLIST_DURATION) || 24 * 60 * 60 * 1000, // 24 horas por defecto
  idleWarningTime: parseInt(process.env.IDLE_WARNING_TIME) || 5 * 60 * 1000, // 5 minutos por defecto
  idleTimeoutTime: parseInt(process.env.IDLE_TIMEOUT_TIME) || 10 * 60 * 1000, // 10 minutos por defecto
  maxAudioSize: parseInt(process.env.MAX_AUDIO_SIZE) || 5 * 1024 * 1024, // 5 MB por defecto
  languageModel: process.env.LANGUAGE_MODEL || 'gpt-3.5-turbo',
  timezone: process.env.TIMEZONE || 'America/Santiago',
  menuUpdateInterval: parseInt(process.env.MENU_UPDATE_INTERVAL) || 60 * 60 * 1000, // 1 hora por defecto
  logLevel: process.env.LOG_LEVEL || 'info',
  maxTokens: parseInt(process.env.MAX_TOKENS) || 2000,
  temperature: parseFloat(process.env.TEMPERATURE) || 0.5,
  messageQueueGapSeconds: parseInt(process.env.MESSAGE_QUEUE_GAP_SECONDS) || 3000,
  promoMessageDelay: parseInt(process.env.PROMO_MESSAGE_DELAY) || 15000, // 15 segundos por defecto
};
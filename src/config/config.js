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
  blacklistDuration: parseInt(process.env.BLACKLIST_DURATION) || 10 * 60 * 1000,
  humanBlacklistDuration: parseInt(process.env.HUMAN_BLACKLIST_DURATION) || 60 * 60 * 1000,
  abuseBlacklistDuration: parseInt(process.env.ABUSE_BLACKLIST_DURATION) || 24 * 60 * 60 * 1000,
  idleWarningTime: parseInt(process.env.IDLE_WARNING_TIME) || 5 * 60 * 1000,
  idleTimeoutTime: parseInt(process.env.IDLE_TIMEOUT_TIME) || 10 * 60 * 1000,
  maxAudioSize: parseInt(process.env.MAX_AUDIO_SIZE) || 5 * 1024 * 1024,
  languageModel: process.env.LANGUAGE_MODEL || 'ft:gpt-4o-mini-2024-07-18:personal:modelo-chile-imprime:AEWZI9XK',
  timezone: process.env.TIMEZONE || 'America/Santiago',
  logLevel: process.env.LOG_LEVEL || 'info',
  maxTokens: parseInt(process.env.MAX_TOKENS) || 2000,
  temperature: parseFloat(process.env.TEMPERATURE) || 0.5,
  messageQueueGapSeconds: parseInt(process.env.MESSAGE_QUEUE_GAP_SECONDS) || 3000,
  promoMessageDelay: parseInt(process.env.PROMO_MESSAGE_DELAY) || 15000,
  servicesUpdateInterval: parseInt(process.env.SERVICES_UPDATE_INTERVAL) || 60 * 60 * 1000,
};
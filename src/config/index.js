import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const ENV = process.env.NODE_ENV || 'development';

const createGoogleCredentials = () => ({
  type: "service_account",
  project_id: process.env.GOOGLE_PROJECT_ID,
  private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
});

const config = {
  env: ENV,
  port: process.env.PORT || 3000,
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },
  googleSheets: {
    sheetId: process.env.GOOGLE_SHEET_ID,
    credentials: createGoogleCredentials(),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 30 * 60 * 1000, // 30 minutos por defecto
};

export default config;
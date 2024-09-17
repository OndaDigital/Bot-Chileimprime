// logger.js - Bot imprenta

import moment from 'moment-timezone';
import fs from 'fs/promises';
import path from 'path';

class Logger {
  constructor() {
    moment.tz.setDefault('America/Santiago');
    this.logDir = path.join(process.cwd(), 'logs');
    this.ensureLogDirectory();
  }

  async ensureLogDirectory() {
    try {
      await fs.access(this.logDir);
    } catch {
      await fs.mkdir(this.logDir, { recursive: true });
    }
  }

  async log(level, message) {
    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
    const logEntry = `${timestamp} [${level.toUpperCase()}] ${message}\n`;
    
    console.log(logEntry.trim());

    const logFile = path.join(this.logDir, `${moment().format('YYYY-MM-DD')}.log`);
    try {
      await fs.appendFile(logFile, logEntry);
    } catch (error) {
      console.error(`Error writing to log file: ${error.message}`);
    }
  }

  info(message) {
    this.log('INFO', message);
  }

  error(message) {
    this.log('ERROR', message);
  }

  warn(message) {
    this.log('WARN', message);
  }

  debug(message) {
    if (process.env.DEBUG === 'true') {
      this.log('DEBUG', message);
    }
  }

  async getRecentLogs(lines = 50) {
    const logFile = path.join(this.logDir, `${moment().format('YYYY-MM-DD')}.log`);
    try {
      const data = await fs.readFile(logFile, 'utf8');
      return data.split('\n').slice(-lines).join('\n');
    } catch (error) {
      console.error(`Error reading log file: ${error.message}`);
      return '';
    }
  }
}

export default Logger;
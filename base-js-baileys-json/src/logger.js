// logger.js - Bot imprenta

import moment from 'moment-timezone';

class Logger {
  constructor() {
    moment.tz.setDefault('America/Santiago');
  }

  log(level, message) {
    const timestamp = moment().format('DD-MM-YY - HH:mm:ss a');
    console.log(`${timestamp} : [${level.toUpperCase()}] ${message}`);
  }

  info(message) {
    this.log('INFO', message);
  }

  error(message) {
    this.log('ERROR', message);
  }

  warn(message) {
    this.log('WARNING', message);
  }
}

export default Logger;
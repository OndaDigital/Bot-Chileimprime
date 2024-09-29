import { JWT } from "google-auth-library";
import { GoogleSpreadsheet } from "google-spreadsheet";
import moment from 'moment-timezone';
import 'moment/locale/es.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { CustomError } from '../utils/errorHandler.js';

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 segundo

class GoogleSheetService {
  constructor() {
    this.jwtFromEnv = new JWT({
      email: config.googleServiceAccountEmail,
      key: config.googlePrivateKey,
      scopes: SCOPES,
    });
    this.doc = new GoogleSpreadsheet(config.googleSheetId, this.jwtFromEnv);
    moment.locale('es');
    moment.tz.setDefault(config.timezone);
    this.services = null;
    this.additionalInfo = null;
    this.isInitialized = false;
  }


  async initialize() {
    try {
      await this.doc.loadInfo();
      await this.retryOperation(() => this.loadServicesWithRetry());
      await this.retryOperation(() => this.loadAdditionalInfoWithRetry());
      this.isInitialized = true;
      logger.info("Servicios e información adicional inicializados correctamente");
    } catch (error) {
      logger.error(`Error al inicializar SheetService: ${error.message}`);
      throw new CustomError('SheetServiceInitError', 'Error al inicializar el servicio de Google Sheets', error);
    }
  }

  async retryOperation(operation, maxRetries = MAX_RETRIES) {
    let retries = 0;
    while (retries < maxRetries) {
      try {
        return await operation();
      } catch (error) {
        if (retries === maxRetries - 1) throw error;
        const delay = Math.pow(2, retries) * INITIAL_RETRY_DELAY;
        logger.warn(`Reintento ${retries + 1} en ${delay}ms: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        retries++;
      }
    }
  }

  async loadServicesWithRetry() {
    this.services = await this.getServices();
  }

  async loadAdditionalInfoWithRetry() {
    this.additionalInfo = await this.getAdditionalInfo();
  }

  async getServices() {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[0];
      await sheet.loadCells('A1:Q1000');
  
      const services = {};
      for (let i = 1; i < sheet.rowCount; i++) {
        const id = sheet.getCell(i, 0).value;
        if (!id) break;
  
        const service = this.extractServiceData(sheet, i);
        if (service) {
          if (!services[service.category]) {
            services[service.category] = [];
          }
          services[service.category].push(service);
        }
      }
  
      return services;
    } catch (err) {
      logger.error("Error al obtener los servicios:", err);
      throw new CustomError('ServicesFetchError', 'Error al obtener los servicios desde Google Sheets', err);
    }
  }

  extractServiceData(sheet, row) {
    try {
      const widthsString = sheet.getCell(row, 12).value;
      const availableWidths = widthsString ? this.parseAvailableWidths(widthsString) : [];

      return {
        id: sheet.getCell(row, 0).value,
        category: sheet.getCell(row, 1).value,
        type: sheet.getCell(row, 2).value,
        name: sheet.getCell(row, 3).value,
        sellado: sheet.getCell(row, 4).value === 'Sí',
        ojetillos: sheet.getCell(row, 5).value === 'Sí',
        bolsillo: sheet.getCell(row, 6).value === 'Sí',
        format: sheet.getCell(row, 7).value,
        minDPI: parseInt(sheet.getCell(row, 8).value) || 0,
        stock: parseInt(sheet.getCell(row, 9).value) || 0,
        status: sheet.getCell(row, 10).value,
        precio: parseFloat(sheet.getCell(row, 11).value) || 0,
        availableWidths: availableWidths,
        precioSellado: parseFloat(sheet.getCell(row, 14).value) || 0,
        precioBolsillo: parseFloat(sheet.getCell(row, 15).value) || 0,
        precioOjetillos: parseFloat(sheet.getCell(row, 16).value) || 0
      };
    } catch (error) {
      logger.error(`Error al extraer datos del servicio en la fila ${row}: ${error.message}`);
      return null;
    }
  }


  parseAvailableWidths(widthsString) {
    if (!widthsString || widthsString.toLowerCase().includes('no tiene rollos')) {
      return [];
    }
    
    logger.info(`Procesando medidas: ${widthsString}`);
    
    // Eliminar la línea de encabezado
    const lines = widthsString.split('\n').filter(line => !line.includes('Ancho material'));
    
    return lines.map(line => {
      const [material, imprimible] = line.split('-').map(part => part.trim());
      
      const parseMeasure = (measure) => {
        if (typeof measure !== 'string') {
          logger.warn(`Medida no es un string: ${measure}`);
          return 0;
        }
        return parseFloat(measure.replace('m', '').replace(',', '.')) || 0;
      };
      
      const parsedMaterial = parseMeasure(material);
      const parsedImprimible = parseMeasure(imprimible);
      
      if (parsedMaterial && parsedImprimible) {
        logger.info(`Medida procesada: material ${parsedMaterial}m, imprimible ${parsedImprimible}m`);
        return {
          material: parsedMaterial,
          imprimible: parsedImprimible
        };
      } else {
        logger.warn(`No se pudo procesar la medida: ${line}`);
        return null;
      }
    }).filter(w => w !== null);
  }

  async getAdditionalInfo() {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[2];
      await sheet.loadCells('A1:H11');
  
      const additionalInfo = {
        horarios: {},
        zonasDespacho: [],
        direccionRetiro: '',
        promocionDia: '',
        metodosPago: '',
        tiempoPreparacion: ''
      };
  
      this.extractAdditionalInfo(sheet, additionalInfo);
  
      logger.info("Información adicional cargada completamente");
  
      return additionalInfo;
    } catch (err) {
      logger.error("Error al obtener información adicional:", err);
      throw new CustomError('AdditionalInfoError', 'Error al obtener información adicional desde Google Sheets', err);
    }
  }

  extractAdditionalInfo(sheet, additionalInfo) {
    ['Lunes a viernes', 'Sábados', 'Domingos'].forEach((dia, index) => {
      additionalInfo.horarios[dia] = sheet.getCell(index + 1, 1).value || 'No disponible';
    });
  
    for (let row = 1; row <= 9; row++) {
      const zona = sheet.getCell(row, 2).value;
      if (zona && zona.trim()) additionalInfo.zonasDespacho.push(zona.trim());
    }
  
    additionalInfo.direccionRetiro = sheet.getCell(1, 4).value || 'No disponible';
    additionalInfo.promocionDia = sheet.getCell(1, 5).value || 'No hay promociones actualmente';
    additionalInfo.metodosPago = sheet.getCell(1, 6).value || 'No especificado';
    additionalInfo.tiempoPreparacion = sheet.getCell(1, 7).value || 'No especificado';
  }

  async saveOrder(data) {
    logger.info(`Iniciando guardado de cotización en Google Sheets: ${JSON.stringify(data)}`);
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[1];
      await sheet.loadCells();
  
      const rowData = this.prepareRowData(data);
      const result = await sheet.addRows([rowData]);
  
      return this.processAddRowResult(result, sheet);
    } catch (err) {
      logger.error("Error detallado al guardar la cotización en Google Sheets:", err.message);
      logger.error("Stack trace:", err.stack);
      throw new CustomError('OrderSaveError', `Error al guardar la cotización: ${err.message}`, err);
    }
  }

  prepareRowData(data) {
    const formattedDate = moment().tz(config.timezone).format('DD-MM-YYYY HH:mm[hrs] - dddd');
    const censoredPhone = this.censorPhoneNumber(data.telefono);
    return [
      formattedDate,
      censoredPhone,
      data.nombre,
      data.correo || '',
      data.pedido,
      data.archivos || '',
      data.total,
      "Nueva cotización"
    ];
  }

  processAddRowResult(result, sheet) {
    if (Array.isArray(result) && result.length > 0) {
      const firstRow = result[0];
      const rowIndex = firstRow.rowIndex || firstRow._rowNumber || sheet.rowCount;
      logger.info(`Fila añadida exitosamente. ID de la nueva fila: ${rowIndex}`);
      return { success: true, message: "Cotización guardada exitosamente", rowIndex: rowIndex };
    } else {
      logger.warn("No se pudo obtener información de la fila añadida");
      return { success: true, message: "Cotización guardada exitosamente, pero no se pudo obtener el ID de la fila" };
    }
  }

  censorPhoneNumber(phoneNumber) {
    if (phoneNumber.length <= 5) return phoneNumber;
    const firstTwo = phoneNumber.slice(0, 2);
    const lastThree = phoneNumber.slice(-3);
    const middleLength = phoneNumber.length - 5;
    return `${firstTwo}${'*'.repeat(middleLength)}${lastThree}`;
  }

  async reinitialize() {
    try {
      logger.info("Reinicializando servicios e información adicional");
      await this.retryOperation(() => this.loadServicesWithRetry());
      await this.retryOperation(() => this.loadAdditionalInfoWithRetry());
      logger.info("Servicios e información adicional reinicializados correctamente");
    } catch (error) {
      logger.error(`Error al reinicializar SheetService: ${error.message}`);
      throw new CustomError('SheetServiceReinitError', 'Error al reinicializar el servicio de Google Sheets', error);
    }
  }
}

export default new GoogleSheetService();
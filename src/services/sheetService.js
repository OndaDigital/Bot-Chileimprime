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
      await this.loadServicesWithRetry();
      await this.loadAdditionalInfoWithRetry();
      this.isInitialized = true;
      logger.info("Servicios e información adicional inicializados correctamente");
      logger.info(`Servicios: ${JSON.stringify(this.services)}`);
      logger.info(`Información adicional: ${JSON.stringify(this.additionalInfo)}`);
    } catch (error) {
      logger.error(`Error al inicializar SheetService: ${error.message}`);
      throw new CustomError('SheetServiceInitError', 'Error al inicializar el servicio de Google Sheets', error);
    }
  }

  async loadServicesWithRetry() {
    for (let i = 0; i < config.MAX_RETRIES; i++) {
      try {
        this.services = await this.getServices();
        return;
      } catch (error) {
        logger.error(`Intento ${i + 1} fallido al cargar los servicios: ${error.message}`);
        if (i === config.MAX_RETRIES - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, config.RETRY_DELAY));
      }
    }
  }

  async loadAdditionalInfoWithRetry() {
    for (let i = 0; i < config.MAX_RETRIES; i++) {
      try {
        this.additionalInfo = await this.getAdditionalInfo();
        return;
      } catch (error) {
        logger.error(`Intento ${i + 1} fallido al cargar información adicional: ${error.message}`);
        if (i === config.MAX_RETRIES - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, config.RETRY_DELAY));
      }
    }
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
  
        const category = sheet.getCell(i, 1).value;
        const type = sheet.getCell(i, 2).value;
        const name = sheet.getCell(i, 3).value;
        const sellado = sheet.getCell(i, 4).value === 'Sí';
        const ojetillos = sheet.getCell(i, 5).value === 'Sí';
        const bolsillo = sheet.getCell(i, 6).value === 'Sí';
        const format = sheet.getCell(i, 7).value;
        const minDPI = parseInt(sheet.getCell(i, 8).value);
        const stock = parseInt(sheet.getCell(i, 9).value);
        const status = sheet.getCell(i, 10).value;
        const precio = parseFloat(sheet.getCell(i, 11).value);
        const availableWidths = sheet.getCell(i, 12).value.split(',').map(w => {
          const [material, imprimible] = w.split('-').map(s => s.trim());
          return {
            material: parseFloat(material.replace('m', '')),
            imprimible: parseFloat(imprimible.replace('m', ''))
          };
        });
        const precioSellado = parseFloat(sheet.getCell(i, 14).value) || 0;
        const precioBolsillo = parseFloat(sheet.getCell(i, 15).value) || 0;
        const precioOjetillos = parseFloat(sheet.getCell(i, 16).value) || 0;

        const service = {
          id,
          category,
          type,
          name,
          sellado,
          ojetillos,
          bolsillo,
          format,
          minDPI,
          stock,
          status,
          precio,
          availableWidths,
          precioSellado,
          precioBolsillo,
          precioOjetillos
        };

        if (!services[category]) {
          services[category] = [];
        }
        services[category].push(service);
      }
  
      return services;
    } catch (err) {
      logger.error("Error al obtener los servicios:", err);
      throw new CustomError('ServicesFetchError', 'Error al obtener los servicios desde Google Sheets', err);
    }
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
  
      // Horarios
      ['Lunes a viernes', 'Sábados', 'Domingos'].forEach((dia, index) => {
        const horario = sheet.getCell(index + 1, 1).value;
        additionalInfo.horarios[dia] = horario || 'No disponible';
      });
  
      // Zonas de despacho
      for (let row = 1; row <= 9; row++) {
        const zona = sheet.getCell(row, 2).value;
        if (zona && zona.trim()) additionalInfo.zonasDespacho.push(zona.trim());
      }
  
      // Dirección de retiro
      additionalInfo.direccionRetiro = sheet.getCell(1, 4).value || 'No disponible';
  
      // Promoción del día
      additionalInfo.promocionDia = sheet.getCell(1, 5).value || 'No hay promociones actualmente';
  
      // Métodos de pago
      additionalInfo.metodosPago = sheet.getCell(1, 6).value || 'No especificado';
  
      // Tiempos de preparación
      additionalInfo.tiempoPreparacion = sheet.getCell(1, 7).value || 'No especificado';
  
      logger.info("Información adicional cargada completamente:", JSON.stringify(additionalInfo, null, 2));
  
      return additionalInfo;
    } catch (err) {
      logger.error("Error al obtener información adicional:", err);
      throw new CustomError('AdditionalInfoError', 'Error al obtener información adicional desde Google Sheets', err);
    }
  }

  async saveOrder(data) {
    logger.info(`Iniciando guardado de cotización en Google Sheets: ${JSON.stringify(data)}`);
    try {
      await this.doc.loadInfo();
      logger.info('Información del documento cargada exitosamente');
      
      const sheet = this.doc.sheetsByIndex[1];
      logger.info(`Hoja seleccionada: ${sheet.title}`);
      
      await sheet.loadCells();
      logger.info('Celdas de la hoja cargadas exitosamente');
  
      const formattedDate = moment().tz(config.timezone).format('DD-MM-YYYY HH:mm[hrs] - dddd');
      const censoredPhone = this.censorPhoneNumber(data.telefono);
  
      const rowData = [
        formattedDate,
        censoredPhone,
        data.nombre,
        data.correo || '',
        data.pedido,
        data.archivos || '',
        data.total,
        "Nueva cotización"
      ];
  
      logger.info(`Datos de fila preparados para inserción: ${JSON.stringify(rowData)}`);
  
      const result = await sheet.addRows([rowData]);
      
      logger.info(`Tipo de resultado: ${typeof result}`);
      logger.info(`¿Es un array? ${Array.isArray(result)}`);
      logger.info(`Longitud del resultado: ${result.length}`);
  
      if (Array.isArray(result) && result.length > 0) {
        const firstRow = result[0];
        logger.info(`Tipo de la primera fila: ${typeof firstRow}`);
        
        const safeProperties = {
          rowIndex: firstRow.rowIndex,
          rowNumber: firstRow._rowNumber || firstRow.rowNumber,
        };
        
        logger.info(`Propiedades seguras de la primera fila: ${JSON.stringify(safeProperties)}`);
        
        const rowIndex = safeProperties.rowIndex || safeProperties.rowNumber || sheet.rowCount;
        logger.info(`Fila añadida exitosamente. ID de la nueva fila: ${rowIndex}`);
  
        return { success: true, message: "Cotización guardada exitosamente", rowIndex: rowIndex };
      } else {
        logger.warn("No se pudo obtener información de la fila añadida");
        return { success: true, message: "Cotización guardada exitosamente, pero no se pudo obtener el ID de la fila" };
      }
    } catch (err) {
      logger.error("Error detallado al guardar la cotización en Google Sheets:", err.message);
      logger.error("Stack trace:", err.stack);
      throw new CustomError('OrderSaveError', `Error al guardar la cotización: ${err.message}`, err);
    }
  }

  censorPhoneNumber(phoneNumber) {
    if (phoneNumber.length <= 5) {
      return phoneNumber;
    }
    const firstTwo = phoneNumber.slice(0, 2);
    const lastThree = phoneNumber.slice(-3);
    const middleLength = phoneNumber.length - 5;
    const censoredMiddle = '*'.repeat(middleLength);
    return `${firstTwo}${censoredMiddle}${lastThree}`;
  }

  async reinitialize() {
    try {
      logger.info("Reinicializando servicios e información adicional");
      await this.loadServicesWithRetry();
      await this.loadAdditionalInfoWithRetry();
      logger.info("Servicios e información adicional reinicializados correctamente");
      logger.info(`Servicios actualizados: ${JSON.stringify(this.services)}`);
      logger.info(`Información adicional actualizada: ${JSON.stringify(this.additionalInfo)}`);
    } catch (error) {
      logger.error(`Error al reinicializar SheetService: ${error.message}`);
      throw new CustomError('SheetServiceReinitError', 'Error al reinicializar el servicio de Google Sheets', error);
    }
  }
}

export default new GoogleSheetService();
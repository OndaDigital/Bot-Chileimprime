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
  
      let services = {};
      let currentRow = 1;
  
      while (currentRow < sheet.rowCount) {
        const id = sheet.getCell(currentRow, 0).value;
        if (!id) break;
  
        const service = {
          id: id,
          category: sheet.getCell(currentRow, 1).value,
          type: sheet.getCell(currentRow, 2).value,
          name: sheet.getCell(currentRow, 3).value,
          sellado: sheet.getCell(currentRow, 4).value === 'Sí',
          ojetillos: sheet.getCell(currentRow, 5).value === 'Sí',
          bolsillo: sheet.getCell(currentRow, 6).value === 'Sí',
          format: sheet.getCell(currentRow, 7).value,
          minDPI: parseInt(sheet.getCell(currentRow, 8).value),
          stock: parseInt(sheet.getCell(currentRow, 9).value),
          status: sheet.getCell(currentRow, 10).value,
          precio: parseFloat(sheet.getCell(currentRow, 11).value),
          availableWidths: sheet.getCell(currentRow, 12).value.split(',').map(w => parseFloat(w.trim())),
          precioSellado: parseFloat(sheet.getCell(currentRow, 14).value) || 0,
          precioBolsillo: parseFloat(sheet.getCell(currentRow, 15).value) || 0,
          precioOjetillos: parseFloat(sheet.getCell(currentRow, 16).value) || 0
        };
  
        services[service.name] = service;
        currentRow++;
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
      const sheet = this.doc.sheetsByIndex[1];
      await sheet.loadCells('A1:C100');
  
      const additionalInfo = {
        horarios: {},
        terminaciones: [],
        tiemposEntrega: '',
        politicaArchivos: '',
        informacionContacto: ''
      };
  
      // Horarios
      for (let row = 1; row <= 7; row++) {
        const dia = sheet.getCell(row, 0).value;
        const horario = sheet.getCell(row, 1).value;
        if (dia && horario) {
          additionalInfo.horarios[dia] = horario;
        }
      }
  
      // Terminaciones
      let row = 1;
      while (sheet.getCell(row, 2).value) {
        additionalInfo.terminaciones.push(sheet.getCell(row, 2).value);
        row++;
      }
  
      // Tiempos de entrega
      additionalInfo.tiemposEntrega = sheet.getCell(1, 3).value;
  
      // Política de archivos
      additionalInfo.politicaArchivos = sheet.getCell(1, 4).value;
  
      // Información de contacto
      additionalInfo.informacionContacto = sheet.getCell(1, 5).value;
  
      logger.info("Información adicional cargada completamente:", JSON.stringify(additionalInfo, null, 2));
  
      return additionalInfo;
    } catch (err) {
      logger.error("Error al obtener información adicional:", err);
      throw new CustomError('AdditionalInfoError', 'Error al obtener información adicional desde Google Sheets', err);
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

  async saveOrder(data) {
    logger.info(`Iniciando guardado de cotización en Google Sheets: ${JSON.stringify(data)}`);
    try {
      await this.doc.loadInfo();
      logger.info('Información del documento cargada exitosamente');
      
      const sheet = this.doc.sheetsByIndex[2];
      logger.info(`Hoja seleccionada: ${sheet.title}`);
      
      await sheet.loadCells();
      logger.info('Celdas de la hoja cargadas exitosamente');
  
      const formattedDate = moment().tz(config.timezone).format('DD-MM-YYYY HH:mm[hrs] - dddd');
      const censoredPhone = this.censorPhoneNumber(data.telefono);
  
      const rowData = [
        formattedDate,
        censoredPhone,
        data.nombre,
        data.pedido,
        data.observaciones,
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
        
        // Extraer propiedades seguras individualmente
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
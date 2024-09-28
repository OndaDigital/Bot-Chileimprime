// services/sheetService.js

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

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

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
    this.menu = null;
    this.additionalInfo = null;
    this.isInitialized = false;
  }

  async initialize() {
    try {
      await this.doc.loadInfo();
      await this.loadMenuWithRetry();
      await this.loadAdditionalInfoWithRetry();
      this.isInitialized = true;
      logger.info("Menú e información adicional inicializados correctamente");
      logger.info(`Menú: ${JSON.stringify(this.menu)}`);
      logger.info(`Información adicional: ${JSON.stringify(this.additionalInfo)}`);
    } catch (error) {
      logger.error(`Error al inicializar SheetService: ${error.message}`);
      throw new CustomError('SheetServiceInitError', 'Error al inicializar el servicio de Google Sheets', error);
    }
  }

  async loadMenuWithRetry() {
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        this.menu = await this.getMenu();
        return;
      } catch (error) {
        logger.error(`Intento ${i + 1} fallido al cargar el menú: ${error.message}`);
        if (i === MAX_RETRIES - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }

  async loadAdditionalInfoWithRetry() {
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        this.additionalInfo = await this.getAdditionalInfo();
        return;
      } catch (error) {
        logger.error(`Intento ${i + 1} fallido al cargar información adicional: ${error.message}`);
        if (i === MAX_RETRIES - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }

  async getMenu() {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[0];
      await sheet.loadCells();
  
      let menu = {};
      const startRow = 7;
  
      let categories = [];
      for (let col = 0; col < sheet.columnCount; col++) {
        const cellValue = sheet.getCell(startRow, col).value;
        if (cellValue && typeof cellValue === 'string' && cellValue.trim() !== '') {
          categories.push(cellValue.trim());
        } else {
          break;
        }
      }
  
      categories.forEach((category, index) => {
        let categoryItems = [];
        for (let row = startRow + 1; row < sheet.rowCount; row++) {
          const item = sheet.getCell(row, index).value;
          const price = sheet.getCell(row, index).note;
          if (item) {
            let extractedPrice = price;
            if (!extractedPrice) {
              const priceMatch = item.match(/\$(\d+)/);
              if (priceMatch) {
                extractedPrice = priceMatch[1];
              }
            }
            if (extractedPrice) {
              categoryItems.push({
                nombre: item.replace(/\$\d+/, '').trim(),
                precio: parseInt(extractedPrice)
              });
            }
          } else {
            break;
          }
        }
        menu[category] = categoryItems;
      });
  
      return menu;
    } catch (err) {
      logger.error("Error al obtener el menú:", err);
      throw new CustomError('MenuFetchError', 'Error al obtener el menú desde Google Sheets', err);
    }
  }

  async getAdditionalInfo() {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[2]; // Tercera hoja
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
        logger.info(`Horario cargado para ${dia}: ${additionalInfo.horarios[dia]}`);
      });
  
      // Zonas de despacho
      for (let row = 1; row <= 9; row++) {
        const zona = sheet.getCell(row, 2).value;
        if (zona && zona.trim()) additionalInfo.zonasDespacho.push(zona.trim());
      }
      logger.info(`Zonas de despacho: ${additionalInfo.zonasDespacho.join(', ')}`);
  
      // Dirección de retiro
      additionalInfo.direccionRetiro = sheet.getCell(1, 4).value || 'No disponible';
      logger.info(`Dirección de retiro: ${additionalInfo.direccionRetiro}`);
  
      // Promoción del día
      additionalInfo.promocionDia = sheet.getCell(1, 5).value || 'No hay promociones actualmente';
      logger.info(`Promoción del día: ${additionalInfo.promocionDia}`);
  
      // Métodos de pago
      additionalInfo.metodosPago = sheet.getCell(1, 6).value || 'No especificado';
      logger.info(`Métodos de pago: ${additionalInfo.metodosPago}`);
  
      // Tiempos de preparación
      additionalInfo.tiempoPreparacion = sheet.getCell(1, 7).value || 'No especificado';
      logger.info(`Tiempos de preparación: ${additionalInfo.tiempoPreparacion}`);
  
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
    logger.info(`Iniciando guardado de orden en Google Sheets: ${JSON.stringify(data)}`);
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
        data.pedido,
        data.observaciones,
        data.total,
        "Nuevo pedido"
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
          // Añade aquí otras propiedades que sean seguras de extraer
        };
        
        logger.info(`Propiedades seguras de la primera fila: ${JSON.stringify(safeProperties)}`);
        
        const rowIndex = safeProperties.rowIndex || safeProperties.rowNumber || sheet.rowCount;
        logger.info(`Fila añadida exitosamente. ID de la nueva fila: ${rowIndex}`);
  
        return { success: true, message: "Pedido guardado exitosamente", rowIndex: rowIndex };
      } else {
        logger.warn("No se pudo obtener información de la fila añadida");
        return { success: true, message: "Pedido guardado exitosamente, pero no se pudo obtener el ID de la fila" };
      }
    } catch (err) {
      logger.error("Error detallado al guardar el pedido en Google Sheets:", err.message);
      logger.error("Stack trace:", err.stack);
      throw new CustomError('OrderSaveError', `Error al guardar el pedido: ${err.message}`, err);
    }
  }

  async reinitialize() {
    try {
      logger.info("Reinicializando menú e información adicional");
      await this.loadMenuWithRetry();
      await this.loadAdditionalInfoWithRetry();
      logger.info("Menú e información adicional reinicializados correctamente");
      logger.info(`Menú actualizado: ${JSON.stringify(this.menu)}`);
      logger.info(`Información adicional actualizada: ${JSON.stringify(this.additionalInfo)}`);
    } catch (error) {
      logger.error(`Error al reinicializar SheetService: ${error.message}`);
      throw new CustomError('SheetServiceReinitError', 'Error al reinicializar el servicio de Google Sheets', error);
    }
  }
}

export default new GoogleSheetService();
// services/sheets-service.js

import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import moment from 'moment-timezone';
import 'moment/locale/es.js';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

class SheetsService {
  constructor() {
    this.jwtFromEnv = new JWT({
      email: config.googleSheets.credentials.client_email,
      key: config.googleSheets.credentials.private_key.replace(/\\n/g, "\n"),
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file",
      ],
    });
    this.doc = new GoogleSpreadsheet(config.googleSheets.sheetId, this.jwtFromEnv);
    moment.locale('es');
  }

  async initialize() {
    try {
      await this.doc.loadInfo();
      logger.info('Google Sheets service initialized');
    } catch (error) {
      logger.error('Error initializing Google Sheets', error);
      throw error;
    }
  }

  async getServices() {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[0];
      await sheet.loadCells('A1:Q100');
  
      let services = {};
  
      let currentCategory = null;
      for (let row = 1; row < sheet.rowCount; row++) {
        const id = sheet.getCell(row, 0).value;
        if (!id) break;
        
        const category = sheet.getCell(row, 1).value;
        if (category) currentCategory = category;

        const service = {
          id: id,
          categoria: currentCategory,
          tipo: sheet.getCell(row, 2).value,
          nombre: sheet.getCell(row, 3).value,
          sellado: sheet.getCell(row, 4).value,
          ojetillos: sheet.getCell(row, 5).value,
          bolsillo: sheet.getCell(row, 6).value,
          formato: sheet.getCell(row, 7).value || 'PDF, JPG',
          dpi: 72,
          stock: sheet.getCell(row, 9).value,
          estado: sheet.getCell(row, 10).value,
          precio: sheet.getCell(row, 11).value,
          medidas: sheet.getCell(row, 12).value,
          precioSellado: sheet.getCell(row, 14).value,
          precioBolsillo: sheet.getCell(row, 15).value,
          precioOjetillo: sheet.getCell(row, 16).value
        };

        if (!services[currentCategory]) services[currentCategory] = [];
        services[currentCategory].push(service);
      }
  
      return services;
    } catch (error) {
      logger.error('Error fetching services from Google Sheets', error);
      throw error;
    }
  }

  async getFormattedServiceList() {
    const services = await this.getServices();
    let formattedList = "Lista de servicios disponibles:\n\n";
    
    for (const [category, categoryServices] of Object.entries(services)) {
      formattedList += `*${category}*:\n`;
      categoryServices.forEach(service => {
        formattedList += `- ${service.nombre}: $${service.precio}\n`;
      });
      formattedList += "\n";
    }
    
    return formattedList;
  }

  async saveOrder(order) {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[1];
      
      const formattedDate = moment().tz('America/Santiago').format('DD-MM-YYYY HH:mm[hrs] - dddd');
      const censoredPhone = this.censorPhoneNumber(order.telefono);
  
      const rowData = [
        formattedDate,
        censoredPhone,
        order.nombre,
        order.email,
        order.detalles,
        order.archivos,
        order.observaciones,
        order.total,
        "Nuevo pedido"
      ];
  
      const result = await sheet.addRows([rowData]);
      
      if (result && result.length > 0) {
        const rowIndex = result[0].rowIndex || result[0]._rowNumber || sheet.rowCount;
        logger.info(`Order saved successfully. Row ID: ${rowIndex}`);
        return { success: true, message: "Pedido guardado exitosamente", rowIndex: rowIndex };
      } else {
        logger.warn("Could not get information about the added row");
        return { success: true, message: "Pedido guardado exitosamente, pero no se pudo obtener el ID de la fila" };
      }
    } catch (error) {
      logger.error('Error saving order to Google Sheets', error);
      throw error;
    }
  }

  async getAdditionalInfo() {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[2];
      await sheet.loadCells('A1:G11');
  
      const additionalInfo = {
        horarios: {},
        comunasDespacho: [],
        direccionRetiro: '',
        promocionDia: '',
        metodosPago: '',
        tiempoPreparacion: ''
      };
  
      ['Lunes a viernes', 'Sábados', 'Domingos'].forEach((dia, index) => {
        const horario = sheet.getCell(index + 1, 0).value;
        additionalInfo.horarios[dia] = horario || 'No disponible';
      });
  
      for (let row = 1; row <= 9; row++) {
        const comuna = sheet.getCell(row, 1).value;
        if (comuna && comuna.trim()) additionalInfo.comunasDespacho.push(comuna.trim());
      }
  
      additionalInfo.direccionRetiro = sheet.getCell(1, 3).value || 'No disponible';
      additionalInfo.promocionDia = sheet.getCell(1, 4).value || 'No hay promociones actualmente';
      additionalInfo.metodosPago = sheet.getCell(1, 5).value || 'No especificado';
      additionalInfo.tiempoPreparacion = sheet.getCell(1, 6).value || 'No especificado';
  
      return additionalInfo;
    } catch (error) {
      logger.error('Error fetching additional info from Google Sheets', error);
      throw error;
    }
  }

  async getFormattedAdditionalInfo() {
    const info = await this.getAdditionalInfo();
    let formattedInfo = "Información adicional:\n\n";
    
    formattedInfo += "*Horarios*:\n";
    for (const [dia, horario] of Object.entries(info.horarios)) {
      formattedInfo += `${dia}: ${horario}\n`;
    }
    
    formattedInfo += "\n*Comunas de despacho*:\n";
    formattedInfo += info.comunasDespacho.join(", ") + "\n";
    
    formattedInfo += `\n*Dirección de retiro*: ${info.direccionRetiro}\n`;
    formattedInfo += `*Promoción del día*: ${info.promocionDia}\n`;
    formattedInfo += `*Métodos de pago*: ${info.metodosPago}\n`;
    formattedInfo += `*Tiempo de preparación*: ${info.tiempoPreparacion}\n`;
    
    return formattedInfo;
  }

  censorPhoneNumber(phoneNumber) {
    if (phoneNumber.length <= 5) return phoneNumber;
    return phoneNumber.slice(0, 2) + '*'.repeat(phoneNumber.length - 5) + phoneNumber.slice(-3);
  }
}

export const sheetsService = new SheetsService();
// sheetService.js - Bot imprenta


import { JWT } from "google-auth-library";
import { GoogleSpreadsheet } from "google-spreadsheet";
import moment from 'moment-timezone';
import 'moment/locale/es.js';
import Logger from './logger.js';

const logger = new Logger();

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

class GoogleSheetService {
  constructor(id) {
    if (!id) {
      throw new Error("ID_UNDEFINED");
    }
    this.jwtFromEnv = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: SCOPES,
    });
    this.doc = new GoogleSpreadsheet(id, this.jwtFromEnv);
    moment.locale('es');
  }

  async initialize() {
    await this.doc.loadInfo();
    logger.info('Google Sheet inicializado correctamente');
  }

  async getServices() {
    try {
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
          sellado: sheet.getCell(row, 4).value === 'TRUE',
          ojetillos: sheet.getCell(row, 5).value === 'TRUE',
          bolsillo: sheet.getCell(row, 6).value === 'TRUE',
          formato: sheet.getCell(row, 7).value || 'PDF, JPG',
          dpi: parseInt(sheet.getCell(row, 8).value) || 72,
          stock: parseInt(sheet.getCell(row, 9).value) || 0,
          estado: sheet.getCell(row, 10).value,
          precio: parseFloat(sheet.getCell(row, 11).value) || 0,
          medidas: sheet.getCell(row, 12).value,
          precioSellado: parseFloat(sheet.getCell(row, 14).value) || 0,
          precioBolsillo: parseFloat(sheet.getCell(row, 15).value) || 0,
          precioOjetillo: parseFloat(sheet.getCell(row, 16).value) || 0
        };

        if (!services[currentCategory]) services[currentCategory] = [];
        services[currentCategory].push(service);
      }
  
      return services;
    } catch (err) {
      logger.error("Error al obtener los servicios:", err);
      return undefined;
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
    logger.info(`Iniciando guardado de pedido en Google Sheets: ${JSON.stringify(data)}`);
    try {
      const sheet = this.doc.sheetsByIndex[1];
      await sheet.loadCells();
  
      const formattedDate = moment().tz('America/Santiago').format('DD-MM-YYYY HH:mm[hrs] - dddd');
      const censoredPhone = this.censorPhoneNumber(data.telefono);
  
      const rowData = [
        formattedDate,
        censoredPhone,
        data.nombre,
        data.email,
        data.detalles,
        data.archivos,
        data.observaciones,
        data.total,
        "Nuevo pedido"
      ];
  
      const result = await sheet.addRows([rowData]);
      
      if (result && result.length > 0) {
        const rowIndex = result[0].rowIndex || sheet.rowCount;
        logger.info(`Fila añadida exitosamente. ID de la nueva fila: ${rowIndex}`);
        return { success: true, message: "Pedido guardado exitosamente", rowIndex: rowIndex };
      } else {
        logger.warn("No se pudo obtener información de la fila añadida");
        return { success: true, message: "Pedido guardado exitosamente, pero no se pudo obtener el ID de la fila" };
      }
    } catch (err) {
      logger.error("Error detallado al guardar el pedido en Google Sheets:", err.message);
      logger.error("Stack trace:", err.stack);
      return { success: false, message: `Error al guardar el pedido: ${err.message}` };
    }
  }

  async getAdditionalInfo() {
    try {
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
        additionalInfo.horarios[dia] = sheet.getCell(index + 1, 0).value || 'No disponible';
      });
  
      for (let row = 1; row <= 9; row++) {
        const comuna = sheet.getCell(row, 1).value;
        if (comuna && comuna.trim()) additionalInfo.comunasDespacho.push(comuna.trim());
      }
  
      additionalInfo.direccionRetiro = sheet.getCell(1, 3).value || 'No disponible';
      additionalInfo.promocionDia = sheet.getCell(1, 4).value || 'No hay promociones actualmente';
      additionalInfo.metodosPago = sheet.getCell(1, 5).value || 'No especificado';
      additionalInfo.tiempoPreparacion = sheet.getCell(1, 6).value || 'No especificado';
  
      logger.info("Información adicional cargada completamente:", JSON.stringify(additionalInfo, null, 2));
  
      return additionalInfo;
    } catch (err) {
      logger.error("Error al obtener información adicional:", err);
      return null;
    }
  }
}

export default GoogleSheetService;
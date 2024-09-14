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
          formato: sheet.getCell(row, 7).value,
          dpi: sheet.getCell(row, 8).value,
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
      await this.doc.loadInfo();
      logger.info('Información del documento cargada exitosamente');
      
      const sheet = this.doc.sheetsByIndex[1];
      logger.info(`Hoja seleccionada: ${sheet.title}`);
      
      await sheet.loadCells();
      logger.info('Celdas de la hoja cargadas exitosamente');
  
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
        logger.info(`Horario cargado para ${dia}: ${additionalInfo.horarios[dia]}`);
      });
  
      for (let row = 1; row <= 9; row++) {
        const comuna = sheet.getCell(row, 1).value;
        if (comuna && comuna.trim()) additionalInfo.comunasDespacho.push(comuna.trim());
      }
      logger.info(`Comunas de despacho: ${additionalInfo.comunasDespacho.join(', ')}`);
  
      additionalInfo.direccionRetiro = sheet.getCell(1, 3).value || 'No disponible';
      logger.info(`Dirección de retiro: ${additionalInfo.direccionRetiro}`);
  
      additionalInfo.promocionDia = sheet.getCell(1, 4).value || 'No hay promociones actualmente';
      logger.info(`Promoción del día: ${additionalInfo.promocionDia}`);
  
      additionalInfo.metodosPago = sheet.getCell(1, 5).value || 'No especificado';
      logger.info(`Métodos de pago: ${additionalInfo.metodosPago}`);
  
      additionalInfo.tiempoPreparacion = sheet.getCell(1, 6).value || 'No especificado';
      logger.info(`Tiempos de preparación: ${additionalInfo.tiempoPreparacion}`);
  
      logger.info("Información adicional cargada completamente:", JSON.stringify(additionalInfo, null, 2));
  
      return additionalInfo;
    } catch (err) {
      logger.error("Error al obtener información adicional:", err);
      return null;
    }
  }

}

export default GoogleSheetService;
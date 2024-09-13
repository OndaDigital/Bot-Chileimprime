// sheetService.js - Bot imprenta

import { JWT } from "google-auth-library";
import { GoogleSpreadsheet } from "google-spreadsheet";
import Logger from './logger.js';
import dotenv from 'dotenv';


const logger = new Logger();

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

class SheetService {
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
  }

  async getServices() {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[0]; // Hoja "Control"
      await sheet.loadCells('A2:Q');
  
      let services = {};
      for (let i = 2; sheet.getCell(i, 0).value; i++) {
        const service = {
          id: sheet.getCell(i, 0).value,
          categoria: sheet.getCell(i, 1).value,
          tipo: sheet.getCell(i, 2).value,
          nombre: sheet.getCell(i, 3).value,
          sellado: sheet.getCell(i, 4).value === 'Si',
          ojetillos: sheet.getCell(i, 5).value === 'Si',
          bolsillo: sheet.getCell(i, 6).value === 'Si',
          formato: sheet.getCell(i, 7).value,
          dpi: sheet.getCell(i, 8).value,
          stock: sheet.getCell(i, 9).value,
          estado: sheet.getCell(i, 10).value,
          precio: parseFloat(sheet.getCell(i, 11).value),
          medidas: sheet.getCell(i, 12).value,
          precioSellado: parseFloat(sheet.getCell(i, 14).value) || 0,
          precioBolsillo: parseFloat(sheet.getCell(i, 15).value) || 0,
          precioOjetillo: parseFloat(sheet.getCell(i, 16).value) || 0
        };
        services[service.nombre] = service;
      }
  
      logger.info("Servicios cargados correctamente");
      return services;
    } catch (err) {
      logger.error("Error al obtener los servicios:", err);
      return {};
    }
  }

  async getAdditionalInfo() {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[2]; // Asumiendo que la información adicional está en la tercera hoja
      await sheet.loadCells('A1:H11');
  
      const additionalInfo = {
        horarios: {},
        zonasDespacho: [],
        direccionRetiro: '',
        promocionDia: '',
        metodosPago: '',
        tiempoPreparacion: ''
      };
  
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
  
      logger.info("Información adicional cargada correctamente");
      return additionalInfo;
    } catch (err) {
      logger.error("Error al obtener información adicional:", err);
      return null;
    }
  }

  async saveOrder(data) {
    logger.info(`Iniciando guardado de orden en Google Sheets: ${JSON.stringify(data)}`);
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[1]; // Hoja "Pedidos"
      
      const rowData = [
        data.fecha,
        data.telefono,
        data.nombre,
        data.correo,
        data.pedido,
        data.archivos,
        data.total,
        data.estado
      ];
  
      const result = await sheet.addRow(rowData);
      
      logger.info(`Pedido guardado exitosamente. ID de la nueva fila: ${result._rowNumber}`);
      return { success: true, message: "Pedido guardado exitosamente", rowIndex: result._rowNumber };
    } catch (err) {
      logger.error("Error al guardar el pedido en Google Sheets:", err.message);
      return { success: false, message: `Error al guardar el pedido: ${err.message}` };
    }
  }
}

export default SheetService;
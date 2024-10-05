import { JWT } from "google-auth-library";
import { GoogleSpreadsheet } from "google-spreadsheet";
import moment from 'moment-timezone';
import 'moment/locale/es.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { CustomError } from '../utils/errorHandler.js';

class GoogleSheetService {
  constructor() {
    this.jwtFromEnv = new JWT({
      email: config.googleServiceAccountEmail,
      key: config.googlePrivateKey,
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file",
      ],
    });
    this.doc = new GoogleSpreadsheet(config.googleSheetId, this.jwtFromEnv);
    moment.locale('es');
    moment.tz.setDefault(config.timezone);
    this.services = null;
    this.additionalInfo = null;
    this.isInitialized = false;
    this.lastFetchTime = null;
    this.cacheDuration = 60 * 60 * 1000; // 1 hour
  }

  async initialize() {
    try {
      logger.info("Iniciando inicialización de SheetService");
      await this.doc.loadInfo();
      logger.info("Documento de Google Sheets cargado correctamente");
      
      await this.loadServices();
      logger.info("Servicios cargados correctamente");
      await this.loadAdditionalInfo();
      logger.info("Información adicional cargada correctamente");
      
      this.isInitialized = true;
      this.lastFetchTime = Date.now();
      logger.info("SheetService inicializado completamente");
    } catch (error) {
      logger.error(`Error al inicializar SheetService: ${error.message}`);
      throw new CustomError('SheetServiceInitError', 'Error al inicializar el servicio de Google Sheets', error);
    }
  }

  async loadServices() {
    logger.info("Iniciando carga de servicios");
    this.services = await this.fetchServices();
    logger.info(`Servicios cargados: ${Object.keys(this.services).length} categorías`);
  }

  async loadAdditionalInfo() {
    logger.info("Iniciando carga de información adicional");
    this.additionalInfo = await this.fetchAdditionalInfo();
    logger.info("Información adicional cargada");
  }

  getServices() {
    if (!this.services || this.shouldRefreshCache()) {
      this.loadServices();
    }
    return this.services;
  }

  getAdditionalInfo() {
    if (!this.additionalInfo || this.shouldRefreshCache()) {
      this.loadAdditionalInfo();
    }
    return this.additionalInfo;
  }

  shouldRefreshCache() {
    return !this.lastFetchTime || (Date.now() - this.lastFetchTime > this.cacheDuration);
  }

  getServiceInfo(serviceName) {
    if (!serviceName || typeof serviceName !== 'string') {
      logger.warn(`Nombre de servicio inválido: ${serviceName}`);
      return null;
    }

    const services = this.getServices();
    const lowerServiceName = serviceName.toLowerCase();
    for (const category in services) {
      const service = services[category].find(s => s.name.toLowerCase() === lowerServiceName);
      if (service) {
        return service;
      }
    }
    logger.warn(`Servicio no encontrado: ${serviceName}`);
    return null;
  }

  getAllServices() {
    const services = this.getServices();
    return Object.values(services).flat();
  }

  getServicesInCategory(category) {
    const services = this.getServices();
    return services[category] || [];
  }

  getFileValidationCriteria() {
    const additionalInfo = this.getAdditionalInfo();
    return additionalInfo.criteriosValidacion;
  }

  findSimilarServices(serviceName) {
    const allServices = this.getAllServices();
    return allServices
      .filter(service => 
        service.name.toLowerCase().includes(serviceName.toLowerCase()) || 
        serviceName.toLowerCase().includes(service.name.toLowerCase())
      )
      .map(service => ({
        name: service.name,
        category: service.category
      }));
  }

  async fetchServices() {
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
  
      const sellado = sheet.getCell(row, 4).value.toLowerCase();
      const ojetillos = sheet.getCell(row, 5).value.toLowerCase();
      const bolsillo = sheet.getCell(row, 6).value.toLowerCase();
  
      logger.info(`Valores leídos para el servicio en la fila ${row}:`);
      logger.info(`Sellado: ${sellado}, Ojetillos: ${ojetillos}, Bolsillo: ${bolsillo}`);
  
      const service = {
        id: sheet.getCell(row, 0).value,
        category: sheet.getCell(row, 1).value,
        type: sheet.getCell(row, 2).value,
        name: sheet.getCell(row, 3).value,
        sellado: sellado === 'sí' || sellado === 'si',
        ojetillos: ojetillos === 'sí' || ojetillos === 'si',
        bolsillo: bolsillo === 'sí' || bolsillo === 'si',
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
  
      logger.info(`Servicio extraído: ${JSON.stringify(service)}`);
  
      return service;
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

  async fetchAdditionalInfo() {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[2];
      await sheet.loadCells();
  
      logger.info("Cargando información adicional de la hoja 'Informacion'");
  
      const additionalInfo = {
        horarios: {},
        zonasDespacho: [],
        direccionRetiro: '',
        promocionDia: '',
        metodosPago: '',
        tiempoPreparacion: '',
        criteriosValidacion: '',
        estadoBot: ''
      };
  
      this.extractAdditionalInfo(sheet, additionalInfo);
  
      logger.info("Información adicional cargada completamente");
      logger.debug(`Información adicional: ${JSON.stringify(additionalInfo)}`);
  
      return additionalInfo;
    } catch (err) {
      logger.error("Error al obtener información adicional:", err);
      throw new CustomError('AdditionalInfoError', 'Error al obtener información adicional desde Google Sheets', err);
    }
  }

  extractAdditionalInfo(sheet, additionalInfo) {
    const safeGetCellValue = (row, col) => {
      try {
        const cell = sheet.getCell(row, col);
        return cell.value || '';
      } catch (error) {
        logger.warn(`No se pudo obtener el valor de la celda (${row}, ${col}): ${error.message}`);
        return '';
      }
    };

    ['Lunes a viernes', 'Sábados', 'Domingos'].forEach((dia, index) => {
      additionalInfo.horarios[dia] = `${safeGetCellValue(index + 1, 0)} ${safeGetCellValue(index + 1, 1)}`.trim() || 'No disponible';
    });
  
    for (let row = 1; row <= 9; row++) {
      const zona = safeGetCellValue(row, 2);
      if (zona && zona.trim()) additionalInfo.zonasDespacho.push(zona.trim());
    }
  
    additionalInfo.direccionRetiro = safeGetCellValue(1, 4) || 'No disponible';
    additionalInfo.promocionDia = safeGetCellValue(1, 5) || 'No hay promociones actualmente';
    additionalInfo.metodosPago = safeGetCellValue(1, 6) || 'No especificado';
    additionalInfo.tiempoPreparacion = safeGetCellValue(1, 7) || 'No especificado';
    additionalInfo.criteriosValidacion = safeGetCellValue(1, 8) || 'No especificado';
    additionalInfo.estadoBot = safeGetCellValue(1, 9) || 'No especificado';
  
    logger.info(`Criterios de validación extraídos: ${additionalInfo.criteriosValidacion}`);
    logger.info(`Estado del bot: ${additionalInfo.estadoBot}`);
  }

  async saveOrder(data) {
    logger.info(`Iniciando guardado de cotización en Google Sheets: ${JSON.stringify(data)}`);
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[1]; // Hoja "Pedidos"
      await sheet.loadCells();
  
      const orderNumber = await this.getNextOrderNumber();
      const rowData = this.prepareRowData(data, orderNumber);
      const result = await sheet.addRows([rowData]);
  
      return this.processAddRowResult(result, sheet);
    } catch (err) {
      logger.error("Error detallado al guardar la cotización en Google Sheets:", err.message);
      logger.error("Stack trace:", err.stack);
      throw new CustomError('OrderSaveError', `Error al guardar la cotización: ${err.message}`, err);
    }
  }

  prepareRowData(data, orderNumber) {
    const now = moment().tz(config.timezone);
    const formattedDate = now.format('DD-MM-YYYY HH:mm:ss');
    
    const neto = data.total / 1.19; // Cálculo del neto (sin IVA)
    const iva = data.total - neto; // Cálculo del IVA

    return [
      orderNumber,
      1, // Número de servicios (por ahora siempre 1)
      "Efectivo/transferencia",
      formattedDate,
      formattedDate, // Fecha de modificación (igual a la fecha de ingreso por ahora)
      "Sara - agente virtual",
      data.servicio,
      data.cantidad,
      `${data.measures.width} x ${data.measures.height}`,
      data.area,
      data.precioM2,
      data.precioBase,
      data.terminaciones.join(", ") || "No",
      data.precioTerminaciones, // Columna N: Precio de Terminación/m2
      data.precioTotalTerminaciones, // Columna O: Precio Total con Terminación
      "Boleta",
      neto,
      data.total,
      data.nombre,
      "contacto@chileimprime.cl", // Correo por defecto
      "66.666.666-6", // RUT por defecto
      data.telefono,
      '', '', '', '', '', '', '', '', '', '', '', '', // Columnas vacías
      "Pendiente", // Estado de pago
      "chileimprime.cl", // URL del diseño por defecto
      "Pendiente", // Estado del proyecto
      "sin nota", // Anotaciones
      "COTIZACIÓN" // Extras
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

  async getNextOrderNumber() {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[1]; // Hoja "Pedidos"
      await sheet.loadCells('A:A');
      
      let lastOrderNumber = 0;
      for (let i = sheet.rowCount - 1; i >= 2; i--) {
        const cell = sheet.getCell(i, 0);
        if (cell.value) {
          const match = cell.value.match(/WA-(\d+)/);
          if (match) {
            lastOrderNumber = parseInt(match[1], 10);
            break;
          }
        }
      }
      
      const newOrderNumber = lastOrderNumber + 1;
      return `WA-${newOrderNumber}`;
    } catch (error) {
      logger.error("Error al generar número de pedido:", error);
      throw new CustomError('OrderNumberGenerationError', 'Error al generar número de pedido', error);
    }
  }

  censorPhoneNumber(phoneNumber) {
    if (phoneNumber.length <= 5) return phoneNumber;
    const firstTwo = phoneNumber.slice(0, 2);
    const lastThree = phoneNumber.slice(-3);
    const middleLength = phoneNumber.length - 5;
    return `${firstTwo}${'*'.repeat(middleLength)}${lastThree}`;
  }
}

export default new GoogleSheetService();
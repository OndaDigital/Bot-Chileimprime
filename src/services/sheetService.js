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
      const sheet = this.doc.sheetsByIndex[0]; // La hoja "Control" es la primera hoja
      await sheet.loadCells('A1:Q1000');
  
      // Obtener los precios globales de las terminaciones
      const precioSellado = sheet.getCell(1, 14).value; // Celda O2
      const precioBolsillo = sheet.getCell(1, 15).value; // Celda P2
      const precioOjetillos = sheet.getCell(1, 16).value; // Celda Q2
  
      logger.info(`Precios globales de terminaciones: Sellado: ${precioSellado}, Bolsillo: ${precioBolsillo}, Ojetillos: ${precioOjetillos}`);
  
      const services = {};
      for (let i = 1; i < sheet.rowCount; i++) {
        const id = sheet.getCell(i, 0).value;
        if (!id) break;
  
        const service = this.extractServiceData(sheet, i, { precioSellado, precioBolsillo, precioOjetillos });
        if (service) {
          if (!services[service.category]) {
            services[service.category] = [];
          }
          services[service.category].push(service);
        }
      }
  
      logger.info(`Servicios cargados: ${Object.keys(services).length} categorías`);
      return services;
    } catch (err) {
      logger.error("Error al obtener los servicios:", err);
      logger.error("Stack trace:", err.stack);
      throw new CustomError('ServicesFetchError', 'Error al obtener los servicios desde Google Sheets', err);
    }
  }

  extractServiceData(sheet, row, globalPrices) {
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
        precioSellado: globalPrices.precioSellado,
        precioBolsillo: globalPrices.precioBolsillo,
        precioOjetillos: globalPrices.precioOjetillos
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

      const orderNumber = await this.getNextOrderNumber();
      const rowData = this.prepareRowData(data, orderNumber);
      const newRow = await sheet.addRow(rowData);

      logger.info(`Fila añadida exitosamente. Número de fila: ${newRow.rowNumber}`);

      // Retornar orderNumber para usarlo como identificador único
      return { success: true, message: "Cotización guardada exitosamente", orderNumber: orderNumber };
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

    logger.info(`Preparando datos para guardar en la hoja. Orden número: ${orderNumber}`);

    // Modificación: Usar un objeto con los nombres de los encabezados
    const rowData = {
      'pedido': orderNumber,
      'numero_servicios': 1, // Número de servicios (por ahora siempre 1)
      'medio_de_pago': "Efectivo/transferencia",
      'fecha_de_ingreso': formattedDate,
      'fecha_modificacion': formattedDate,
      'cajero': "Sara - agente virtual",
      'nombre_del_servicio': data.servicio,
      'cant': data.cantidad,
      'medidas': `${data.measures.width} x ${data.measures.height}`,
      'area': data.area,
      'precio_por_m2': data.precioM2,
      'precio_base': data.precioBase,
      'tipo_de_terminacion': data.terminaciones.join(", ") || "No",
      'precio_de_terminacion_m2': data.precioTerminaciones,
      'precio_total_con_terminacion': data.precioTotalTerminaciones,
      'dte': "Boleta",
      'neto_subtotal': neto,
      'total_iva': data.total,
      'nombre': data.nombre,
      'correo': data.correo || 'No proporcionado', // Usar el correo del pedido
      'rut': "66.666.666-6", // RUT por defecto
      'telefono': data.telefono,
      'direccion_completa_envio': '', // Campos vacíos
      'comuna_envio': '',
      'agencia': '',
      'depto_envio': '',
      'region_envio': '',
      'tipo_de_envio': '',
      'rut_de_empresa': '',
      'razon_social': '',
      'comuna_facturacion': '',
      'giro': '',
      'telefono_facturacion': '',
      'region_facturacion': '',
      'estado_de_pago': "Pendiente",
      'url_del_diseno': data.fileUrl || "chileimprime.cl",
      'estado_del_proyecto': "Pendiente",
      'anotaciones': "sin nota",
      'tipo': "COTIZACIÓN"
    };

    logger.info(`Datos preparados para la fila: ${JSON.stringify(rowData)}`);

    return rowData;
  }


  // Modificación en updateOrderWithFileUrl
  async updateOrderWithFileUrl(orderNumber, fileUrl) {
    try {
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[1]; // Hoja "Pedidos"
      const rows = await sheet.getRows();
  
      // Agregar logs para verificar los nombres de las columnas y propiedades
      logger.info(`Nombres de las columnas: ${sheet.headerValues}`);
      logger.info(`Propiedades de la primera fila: ${Object.keys(rows[0])}`);
  
      // Buscar la fila donde 'pedido' coincide con orderNumber utilizando row.get()
      const targetRow = rows.find(row => row.get('pedido') === orderNumber);
  
      if (!targetRow) {
        logger.error(`No se encontró la fila con el número de pedido ${orderNumber}`);
        return;
      }
  
      // Actualizar el campo 'url_del_diseno' con la URL proporcionada utilizando row.set()
      targetRow.set('url_del_diseno', fileUrl);
      await targetRow.save();
  
      logger.info(`Fila con pedido ${orderNumber} actualizada con la URL del archivo en Google Sheets.`);
    } catch (error) {
      logger.error(`Error al actualizar la fila con pedido ${orderNumber} con la URL del archivo: ${error.message}`);
    }
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


  // Reemplazar getEmailByPhoneNumber con searchOrdersByPhone
  async searchOrdersByPhone(phoneNumber) {
    try {
      logger.info(`Buscando pedidos previos para el número ${phoneNumber}`);
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[1]; // Hoja "Pedidos"
      const rows = await sheet.getRows();

      const orders = rows
        .filter(row => row.get('telefono') === phoneNumber)
        .map(row => ({
          correo: row.get('correo'),
          fecha: row.get('fecha_de_ingreso'),
          pedido: row.get('pedido')
        }))
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha)); // Ordenar por fecha descendente

      logger.info(`Se encontraron ${orders.length} pedidos para el número ${phoneNumber}`);
      return orders;
    } catch (error) {
      logger.error(`Error al buscar pedidos por teléfono: ${error.message}`);
      throw new CustomError('OrderSearchError', 'Error al buscar pedidos previos', error);
    }
  }

  async searchOrdersByPhone(phoneNumber) {
    try {
        logger.info(`[SearchOrdersByPhone] Iniciando búsqueda de pedidos para número ${phoneNumber}`);
        await this.doc.loadInfo();
        const sheet = this.doc.sheetsByIndex[1];
        const rows = await sheet.getRows();

        // Crear un array para almacenar todos los pedidos
        const allOrders = [];

        // Procesar las filas y convertir fechas
        rows.forEach(row => {
            if (row.get('telefono') === phoneNumber) {
                const email = row.get('correo');
                const fechaStr = row.get('fecha_de_ingreso');
                
                // Usar moment para parsear la fecha
                const fecha = moment(fechaStr, 'DD-MM-YYYY HH:mm:ss');
                
                if (fecha.isValid()) {
                    allOrders.push({
                        correo: email,
                        fecha: fecha,
                        fechaOriginal: fechaStr,
                        pedido: row.get('pedido')
                    });
                    
                    logger.debug(`[SearchOrdersByPhone] Procesando pedido - Email: ${email}, Fecha: ${fechaStr}`);
                } else {
                    logger.warn(`[SearchOrdersByPhone] Fecha inválida encontrada: ${fechaStr}`);
                }
            }
        });

        // Ordenar por fecha de forma descendente (más reciente primero)
        const sortedOrders = allOrders.sort((a, b) => {
            return b.fecha.valueOf() - a.fecha.valueOf();
        });

        logger.info(`[SearchOrdersByPhone] Encontrados ${sortedOrders.length} pedidos para ${phoneNumber}`);
        
        if (sortedOrders.length > 0) {
            logger.info(`[SearchOrdersByPhone] Correo más reciente: ${sortedOrders[0].correo} (Fecha: ${sortedOrders[0].fechaOriginal})`);
        }

        return sortedOrders;
    } catch (error) {
        logger.error(`[SearchOrdersByPhone] Error al buscar pedidos: ${error.message}`);
        throw new CustomError('OrderSearchError', 'Error al buscar pedidos previos', error);
    }
}

// Nuevo método específico para el historial de pedidos
async searchOrdersHistory(phoneNumber) {
  try {
      logger.info(`[SearchOrdersHistory] Iniciando búsqueda de historial para número ${phoneNumber}`);
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[1];
      const rows = await sheet.getRows();

      const allOrders = [];

      rows.forEach(row => {
          if (row.get('telefono') === phoneNumber) {
              try {
                  const fechaStr = row.get('fecha_de_ingreso');
                  const pedido = row.get('pedido');
                  const servicio = row.get('nombre_del_servicio');
                  const estado = row.get('estado_del_proyecto');
                  let total = row.get('total_iva');

                  // Procesar el total para asegurar que sea un número válido
                  if (total) {
                      if (typeof total === 'string') {
                          // Remover el símbolo de peso y puntos de miles si existen
                          total = total.replace(/[$\.]/g, '').replace(',', '.');
                      }
                      total = parseFloat(total);
                      if (isNaN(total)) {
                          logger.warn(`[SearchOrdersHistory] Total inválido encontrado para pedido ${pedido}: ${row.get('total_iva')}`);
                          total = null;
                      }
                  }
                  
                  const fecha = moment(fechaStr, 'DD-MM-YYYY HH:mm:ss');
                  
                  if (fecha.isValid()) {
                      allOrders.push({
                          pedido,
                          fechaOriginal: fechaStr,
                          servicio,
                          estado,
                          total,
                          fecha: fecha
                      });
                      
                      logger.debug(`[SearchOrdersHistory] Procesando pedido - ID: ${pedido}, Servicio: ${servicio}, Estado: ${estado}, Total: ${total}`);
                  } else {
                      logger.warn(`[SearchOrdersHistory] Fecha inválida encontrada: ${fechaStr}`);
                  }
              } catch (error) {
                  logger.error(`[SearchOrdersHistory] Error procesando fila: ${error.message}`);
                 
              }
          }
      });

      const sortedOrders = allOrders.sort((a, b) => b.fecha.valueOf() - a.fecha.valueOf());
      
      // Limitar a los últimos 10 pedidos
      const lastTenOrders = sortedOrders.slice(0, 10);

      logger.info(`[SearchOrdersHistory] Encontrados ${lastTenOrders.length} pedidos recientes para ${phoneNumber}`);
      
      if (lastTenOrders.length > 0) {
          logger.info(`[SearchOrdersHistory] Pedido más reciente: ${lastTenOrders[0].pedido} (Fecha: ${lastTenOrders[0].fechaOriginal})`);
      }

      return lastTenOrders;
  } catch (error) {
      logger.error(`[SearchOrdersHistory] Error al buscar historial de pedidos: ${error.message}`);
      throw new CustomError('OrderHistoryError', 'Error al buscar historial de pedidos', error);
  }
}


async getLastEmailByPhoneNumber(phoneNumber) {
    try {
        logger.info(`[GetLastEmail] Buscando último correo para número ${phoneNumber}`);
        const orders = await this.searchOrdersByPhone(phoneNumber);
        
        if (orders.length === 0) {
            logger.info(`[GetLastEmail] No se encontraron pedidos para ${phoneNumber}`);
            return null;
        }

        // El primer orden será el más reciente debido al ordenamiento
        const lastOrder = orders[0];
        const email = lastOrder.correo;
        
        logger.info(`[GetLastEmail] Correo más reciente encontrado para ${phoneNumber}: ${email} (Fecha: ${lastOrder.fechaOriginal})`);
        
        // Log de verificación
        if (orders.length > 1) {
            logger.debug(`[GetLastEmail] Verificación - Segundo correo más reciente: ${orders[1].correo} (Fecha: ${orders[1].fechaOriginal})`);
        }

        return email;
    } catch (error) {
        logger.error(`[GetLastEmail] Error al obtener último correo: ${error.message}`);
        throw new CustomError('GetEmailError', 'Error al obtener correo', error);
    }
}



}

export default new GoogleSheetService();
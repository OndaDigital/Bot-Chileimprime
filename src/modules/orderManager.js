import logger from '../utils/logger.js';
import { formatPrice, censorPhoneNumber } from '../utils/helpers.js';
import moment from 'moment-timezone';
import config from '../config/config.js';
import sheetService from '../services/sheetService.js';
import userContextManager from './userContext.js';
import { CustomError } from '../utils/errorHandler.js';
import googleDriveService from '../services/googleDriveService.js';
import emailService from '../services/emailService.js'; // Modificado

class OrderManager {
  constructor() {
    this.orderConfirmed = new Set();
  }

  async handleSelectService(userId, serviceName) {
    logger.info(`Manejando selección de servicio para usuario ${userId}: ${serviceName}`);
    try {
      const serviceInfo = userContextManager.getServiceInfo(serviceName);
      
      if (!serviceInfo) {
        const similarServices = userContextManager.findSimilarServices(serviceName);
        return {
          action: "INVALID_SERVICE",
          similarServices,
          order: userContextManager.getCurrentOrder(userId)
        };
      }

      userContextManager.updateCurrentOrder(userId, { 
        service: serviceName,
        category: serviceInfo.category,
        availableWidths: serviceInfo.availableWidths,
        availableFinishes: userContextManager.getAvailableFinishes(serviceInfo)
      });
      
      return {
        action: "SELECT_SERVICE",
        order: userContextManager.getCurrentOrder(userId),
        serviceInfo: serviceInfo
      };
    } catch (error) {
      logger.error(`Error al seleccionar servicio para usuario ${userId}: ${error.message}`);
      throw new CustomError('ServiceSelectionError', 'Error al seleccionar el servicio', error);
    }
  }

  async handleSetMeasures(userId, width, height) {
    logger.info(`Manejando configuración de medidas para usuario ${userId}: ${width}x${height}`);
    try {
      const currentOrder = userContextManager.getCurrentOrder(userId);
      const serviceInfo = userContextManager.getServiceInfo(currentOrder.service);

      if (!['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceInfo.category)) {
        throw new CustomError('InvalidMeasuresError', 'Este servicio no requiere medidas personalizadas');
      }

      const validWidth = serviceInfo.availableWidths.find(w => w.material === parseFloat(width));
      if (!validWidth) {
        throw new CustomError('InvalidWidthError', 'Ancho no válido para este servicio');
      }

      if (parseFloat(height) < 1) {
        throw new CustomError('InvalidHeightError', 'El alto debe ser mayor o igual a 1 metro');
      }

      const measures = { width: validWidth.material, height: parseFloat(height) };
      const areaServicio = measures.width * measures.height; // Calcular área del servicio
      const { total, area } = this.calculatePrice({ ...currentOrder, measures });

      userContextManager.updateCurrentOrder(userId, { measures, areaServicio, total, area }); // Actualizar areaServicio

      return {
        action: "SET_MEASURES",
        order: userContextManager.getCurrentOrder(userId)
      };
    } catch (error) {
      logger.error(`Error al configurar medidas para usuario ${userId}: ${error.message}`);
      throw new CustomError('MeasuresSetupError', 'Error al configurar las medidas', error);
    }
  }

  async handleSetQuantity(userId, quantity) {
    logger.info(`Manejando configuración de cantidad para usuario ${userId}: ${quantity}`);
    try {
      if (quantity <= 0) {
        throw new CustomError('InvalidQuantityError', 'La cantidad debe ser mayor que cero');
      }

      const currentOrder = userContextManager.getCurrentOrder(userId);
      const serviceInfo = userContextManager.getServiceInfo(currentOrder.service);

      if (!['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceInfo.category)) {
        // Para categorías sin medidas personalizadas, calculamos el precio directamente
        const { total } = this.calculatePrice({ ...currentOrder, quantity });
        userContextManager.updateCurrentOrder(userId, { quantity, total });
      } else {
        userContextManager.updateCurrentOrder(userId, { quantity });
      }

      return {
        action: "SET_QUANTITY",
        order: userContextManager.getCurrentOrder(userId)
      };
    } catch (error) {
      logger.error(`Error al configurar cantidad para usuario ${userId}: ${error.message}`);
      throw new CustomError('QuantitySetupError', 'Error al configurar la cantidad', error);
    }
  }

  async setFinishes(userId, sellado, ojetillos, bolsillo) {
    logger.info(`Manejando configuración de acabados para usuario ${userId}`);
    try {
      const currentOrder = userContextManager.getCurrentOrder(userId);
      const serviceInfo = userContextManager.getServiceInfo(currentOrder.service);

      const finishes = {
        sellado: sellado && serviceInfo.sellado,
        ojetillos: ojetillos && serviceInfo.ojetillos,
        bolsillo: bolsillo && serviceInfo.bolsillo
      };

      userContextManager.updateCurrentOrder(userId, { finishes: finishes});

      return {
        action: "SET_FINISHES",
        order: userContextManager.getCurrentOrder(userId)
      };
    } catch (error) {
      logger.error(`Error al configurar acabados para usuario ${userId}: ${error.message}`);
      throw new CustomError('FinishesSetupError', 'Error al configurar los acabados', error);
    }
  }

  async handleValidateFile(userId, isValid, reason) {
    logger.info(`Manejando validación de archivo para usuario ${userId}`);
    try {
      userContextManager.updateCurrentOrder(userId, {
        fileAnalysis: { isValid, reason }
      });
      
      return {
        action: "VALIDATE_FILE",
        order: userContextManager.getCurrentOrder(userId)
      };
    } catch (error) {
      logger.error(`Error al validar archivo para usuario ${userId}: ${error.message}`);
      throw new CustomError('FileValidationError', 'Error al validar el archivo', error);
    }
  }

  async handleConfirmOrder(userId) {
    logger.info(`Manejando confirmación de pedido para usuario ${userId}`);
    try {
      const currentOrder = userContextManager.getCurrentOrder(userId);
      
      if (!userContextManager.isOrderComplete(userId)) {
        
         // NUEVO: Lanzar excepción con detalles de campos faltantes
         const missingFields = userContextManager.getIncompleteFields(userId);
         const errorMessage = `La orden no está completa. Faltan los siguientes campos: ${missingFields.join(', ')}`;
         logger.warn(errorMessage);
         throw new CustomError('IncompleteOrderError', errorMessage);
      }

      const total = this.calculatePrice(currentOrder);
      userContextManager.updateCurrentOrder(userId, { total: total });

      const orderSummary = this.formatOrderSummary(currentOrder);
      const result = await this.finalizeOrder(userId, currentOrder);

      this.orderConfirmed.add(userId);

      return {
        action: "CONFIRM_ORDER",
        order: currentOrder,
        summary: orderSummary,
        result: result
      };
    } catch (error) {
      logger.error(`Error al confirmar el pedido para usuario ${userId}: ${error.message}`);
      throw new CustomError(error.name || 'OrderConfirmationError', error.message);
    }
  }

  calculatePrice(order) {
    const serviceInfo = userContextManager.getServiceInfo(order.service);
  
    let total = 0;
    let area = 1;
    let precioM2 = serviceInfo.precio;
    let precioTerminaciones = 0;
    let precioTotalTerminaciones = 0;
  
    logger.info(`Calculando precio para orden: ${JSON.stringify(order)}`);
    logger.info(`Información del servicio: ${JSON.stringify(serviceInfo)}`);
  
    if (['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceInfo.category)) {
      area = order.measures.width * order.measures.height;
      total = area * precioM2 * order.quantity;
  
      // Calcula el precio de las terminaciones por m2
      if (order.finishes.sellado) {
        precioTerminaciones += serviceInfo.precioSellado;
      }
      if (order.finishes.ojetillos) {
        precioTerminaciones += serviceInfo.precioOjetillos;
      }
      if (order.finishes.bolsillo) {
        precioTerminaciones += serviceInfo.precioBolsillo;
      }
  
      // Calcula el precio total de las terminaciones
      precioTotalTerminaciones = precioTerminaciones * area * order.quantity;
      total += precioTotalTerminaciones;
  
      logger.info(`Precio de terminaciones por m2: ${precioTerminaciones}`);
      logger.info(`Precio total de terminaciones: ${precioTotalTerminaciones}`);
    } else {
      total = precioM2 * order.quantity;
  
      // Para servicios sin medidas, calculamos las terminaciones por unidad
      if (order.finishes.sellado) {
        precioTerminaciones += serviceInfo.precioSellado;
      }
      if (order.finishes.ojetillos) {
        precioTerminaciones += serviceInfo.precioOjetillos;
      }
      if (order.finishes.bolsillo) {
        precioTerminaciones += serviceInfo.precioBolsillo;
      }
  
      precioTotalTerminaciones = precioTerminaciones * order.quantity;
      total += precioTotalTerminaciones;
  
      logger.info(`Precio de terminaciones por unidad: ${precioTerminaciones}`);
      logger.info(`Precio total de terminaciones: ${precioTotalTerminaciones}`);
    }
  
    const precioBase = area * precioM2 * order.quantity;
  
    logger.info(`Precio base: ${precioBase}`);
    logger.info(`Precio total: ${total}`);
  
    return { 
      total, 
      area, 
      precioM2, 
      precioBase, 
      precioTerminaciones, 
      precioTotalTerminaciones
    };
  }

  formatOrderSummary(order) {
    let summary = "📋 *Resumen de tu cotización:*\n\n";

    summary += `🛍️ *Servicio:* ${order.service}\n`;

    if (order.measures) {
      summary += `📐 *Medidas:* ${order.measures.width}m x ${order.measures.height}m\n`;
      summary += `📏 *Área:* ${order.area} m²\n`;
    }

    summary += `🔢 *Cantidad:* ${order.quantity}\n`;

    if (order.finishes && order.finishes.length > 0) {
      summary += `🎨 *Terminaciones:*\n`;
      order.finishes.forEach(finish => {
        summary += `- ${finish}\n`;
      });
    }

    summary += `💵 *Total:* $${formatPrice(order.total)}\n`;

    return summary;
  }

  async finalizeOrder(userId, order) {
    logger.info(`Finalizando orden para usuario ${userId}`);
    
    const calculatedPrices = this.calculatePrice(order);
    const finalOrder = {
      fecha: moment().tz(config.timezone).format('DD-MM-YYYY HH:mm:ss'),
      telefono: userId,
      nombre: order.userName || 'Cliente',
      servicio: order.service,
      cantidad: order.quantity,
      measures: order.measures,
      area: calculatedPrices.area,
      precioM2: calculatedPrices.precioM2,
      precioBase: calculatedPrices.precioBase,
      terminaciones: Object.entries(order.finishes)
        .filter(([_, value]) => value)
        .map(([key, _]) => key),
      precioTerminaciones: calculatedPrices.precioTerminaciones,
      precioTotalTerminaciones: calculatedPrices.precioTotalTerminaciones,
      total: calculatedPrices.total,
      observaciones: order.observaciones || 'Sin observaciones',
      fileUrl: order.fileUrl,
      correo: order.correo, // Incluir el correo electrónico en el pedido final
    };
  
    logger.info(`Orden final para usuario ${userId}: ${JSON.stringify(finalOrder)}`);
  
    try {
      const result = await sheetService.saveOrder(finalOrder);

      logger.info(`Resultado de guardado para usuario ${userId}: ${JSON.stringify(result)}`);

      if (result.success) {
        this.orderConfirmed.add(userId);
        logger.info(`Cotización finalizada y guardada correctamente para usuario ${userId}`);

        const orderNumber = result.orderNumber;
        
        // Subir archivo y enviar correo electrónico de forma asincrona
        if (order.filePath) {
          this.uploadFileAndSendEmail(order.filePath, userId, orderNumber, finalOrder);
        }

        return {
          success: true,
          message: "Tu cotización ha sido registrada. Un representante se pondrá en contacto contigo pronto para confirmar los detalles y coordinar la entrega de los archivos finales.",
          orderNumber: orderNumber,
        };
      } else {
        throw new Error("Error al guardar la cotización");
      }
    } catch (error) {
      logger.error(`Error detallado al finalizar la cotización para usuario ${userId}:`, error);
      throw new CustomError('OrderFinalizationError', 'Error al finalizar la cotización', error);
    }
  }

  // Nuevo método para manejar la subida del archivo y el envío del correo
  uploadFileAndSendEmail(filePath, userId, orderNumber, finalOrder) {
    // No usamos await aquí para no bloquear
    (async () => {
      try {
        const fileUrl = await this.uploadFileToDrive(filePath, userId, orderNumber);
        finalOrder.fileUrl = fileUrl;
        // Actualizar el pedido en Google Sheets con la URL del archivo
        await sheetService.updateOrderWithFileUrl(orderNumber, fileUrl);
        await emailService.sendEmail(finalOrder, orderNumber);
        logger.info(`Archivo subido y correo enviado para el pedido ${orderNumber}`);
      } catch (error) {
        logger.error(`Error al subir el archivo y enviar el correo para el pedido ${orderNumber}: ${error.message}`);
        // Manejar el error según sea necesario
      }
    })();
  }


  async uploadFileToDrive(filePath, userPhone, orderNumber) {
    try {
      // Formatear la fecha de manera legible
      const dateFormatted = moment().tz(config.timezone).format('DD-MM-YYYY-HH_mm');
      const fileName = `Pedido_${orderNumber}_${userPhone}_${dateFormatted}`;
      const mimeType = 'application/octet-stream'; // Ajustar según el tipo de archivo

      logger.info(`Iniciando subida de archivo para el pedido ${orderNumber}`);

      const fileUrl = await googleDriveService.uploadFile(filePath, fileName, mimeType);

      logger.info(`Archivo subido correctamente. URL: ${fileUrl}`);

      // Actualizar la hoja de cálculo con la URL del archivo
      await sheetService.updateOrderWithFileUrl(orderNumber, fileUrl);

      logger.info(`Hoja de cálculo actualizada con la URL del archivo para el pedido ${orderNumber}`);

      return fileUrl; // Añadido: retornar la URL del archivo
    } catch (error) {
      logger.error(`Error al subir archivo a Google Drive para el pedido ${orderNumber}: ${error.message}`);
      throw error; // Lanzar el error para manejarlo en el llamado
    }
  }




  formatOrderForSheet(order) {
    let details = `Servicio: ${order.service}\n`;
    
    if (order.measures) {
      details += `Medidas: ${order.measures.width}m x ${order.measures.height}m\n`;
    }
    
    details += `Cantidad: ${order.quantity}\n`;
    
    if (order.finishes) {
      details += "Terminaciones:\n";
      if (order.finishes.sellado) details += "- Sellado\n";
      if (order.finishes.ojetillos) details += "- Ojetillos\n";
      if (order.finishes.bolsillo) details += "- Bolsillo\n";
    }
    
    return details.trim();
  }

  isOrderConfirmed(userId) {
    return this.orderConfirmed.has(userId);
  }

  resetOrderConfirmation(userId) {
    this.orderConfirmed.delete(userId);
  }
}

export default new OrderManager();
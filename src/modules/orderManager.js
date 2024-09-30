import logger from '../utils/logger.js';
import { formatPrice, censorPhoneNumber } from '../utils/helpers.js';
import moment from 'moment-timezone';
import config from '../config/config.js';
import sheetService from '../services/sheetService.js';
import userContextManager from './userContext.js';
import { CustomError } from '../utils/errorHandler.js';

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

      if (parseFloat(height) <= 1) {
        throw new CustomError('InvalidHeightError', 'El alto debe ser mayor a 1 metro');
      }

      userContextManager.updateCurrentOrder(userId, {
        measures: { width: validWidth.material, height: parseFloat(height) }
      });

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

      userContextManager.updateCurrentOrder(userId, { quantity: quantity });

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
        throw new CustomError('IncompleteOrderError', 'La orden no está completa');
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
      throw new CustomError('OrderConfirmationError', 'Error al confirmar el pedido', error);
    }
  }

  calculatePrice(order) {
    const serviceInfo = userContextManager.getServiceInfo(order.service);

    let total = 0;

    if (['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceInfo.category)) {
      const area = order.measures.width * order.measures.height;
      total = area * serviceInfo.precio * order.quantity;

      if (order.finishes.sellado) total += serviceInfo.precioSellado * area;
      if (order.finishes.ojetillos) total += serviceInfo.precioOjetillos * area;
      if (order.finishes.bolsillo) total += serviceInfo.precioBolsillo * area;
    } else {
      total = serviceInfo.precio * order.quantity;

      if (order.finishes.sellado) total += serviceInfo.precioSellado * order.quantity;
      if (order.finishes.ojetillos) total += serviceInfo.precioOjetillos * order.quantity;
      if (order.finishes.bolsillo) total += serviceInfo.precioBolsillo * order.quantity;
    }

    return total;
  }

  formatOrderSummary(order) {
    let summary = "📋 Resumen final de tu cotización:\n\n";

    const serviceInfo = userContextManager.getServiceInfo(order.service);
    summary += `*Servicio:* ${order.service} (${serviceInfo.category})\n`;

    if (order.measures) {
      summary += `*Medidas:* ${order.measures.width}m x ${order.measures.height}m\n`;
    }

    summary += `*Cantidad:* ${order.quantity}\n`;

    if (order.finishes) {
      summary += "*Terminaciones:*\n";
      if (order.finishes.sellado) summary += "- Sellado\n";
      if (order.finishes.ojetillos) summary += "- Ojetillos\n";
      if (order.finishes.bolsillo) summary += "- Bolsillo\n";
    }

    summary += `\n💰 *Total:* $${formatPrice(order.total)}\n`;

    return summary;
  }

  async finalizeOrder(userId, order) {
    logger.info(`Finalizando orden para usuario ${userId}`);
    
    const finalOrder = {
      fecha: moment().tz(config.timezone).format('DD-MM-YYYY HH:mm[hrs] - dddd'),
      telefono: userId,
      nombre: order.userName || 'Cliente',
      pedido: this.formatOrderForSheet(order),
      observaciones: order.observaciones || 'Sin observaciones',
      total: `$${formatPrice(order.total)}`
    };
  
    logger.info(`Orden final para usuario ${userId}: ${JSON.stringify(finalOrder)}`);
  
    try {
      const result = await sheetService.saveOrder(finalOrder);
      logger.info(`Resultado de guardado para usuario ${userId}: ${JSON.stringify(result)}`);

      if (result.success) {
        logger.info(`Cotización finalizada y guardada correctamente para usuario ${userId}`);
        return { 
          success: true,
          message: "Tu cotización ha sido registrada. Un representante se pondrá en contacto contigo pronto para confirmar los detalles y coordinar la entrega de los archivos finales.",
          orderNumber: result.rowIndex
        };
      } else {
        throw new Error("Error al guardar la cotización");
      }
    } catch (error) {
      logger.error(`Error detallado al finalizar la cotización para usuario ${userId}:`, error);
      throw new CustomError('OrderFinalizationError', 'Error al finalizar la cotización', error);
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
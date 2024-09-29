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

  async updateOrder(userId, jsonCommand, services, currentOrder) {
    logger.info(`Actualizando orden para usuario ${userId}. Comando: ${JSON.stringify(jsonCommand)}`);
    try {
      switch (jsonCommand.command) {
        case "SELECT_SERVICE":
          return this.handleSelectService(userId, jsonCommand.service);
        case "SET_MEASURES":
          return this.handleSetMeasures(userId, jsonCommand.width, jsonCommand.height);
        case "SET_QUANTITY":
          return this.handleSetQuantity(userId, jsonCommand.quantity);
        case "SET_FINISHES":
          return this.handleSetFinishes(userId, jsonCommand.sellado, jsonCommand.ojetillos, jsonCommand.bolsillo);
        case "VALIDATE_FILE":
          return this.handleValidateFile(userId, jsonCommand.isValid, jsonCommand.reason);
        case "CONFIRM_ORDER":
          return this.handleConfirmOrder(userId);
        default:
          logger.warn(`Comando desconocido recibido: ${jsonCommand.command}`);
          return { action: "CONTINUAR", order: currentOrder };
      }
    } catch (error) {
      logger.error(`Error al actualizar el pedido para usuario ${userId}: ${error.message}`);
      throw new CustomError('OrderUpdateError', 'Error al actualizar el pedido', error);
    }
  }

  handleSelectService(userId, serviceName) {
    const userContext = userContextManager.getUserContext(userId);
    const serviceInfo = userContextManager.getServiceInfo(serviceName);
    
    if (!serviceInfo) {
      const similarServices = userContextManager.findSimilarServices(serviceName);
      return {
        action: "INVALID_SERVICE",
        similarServices,
        order: userContext.currentOrder
      };
    }

    userContextManager.updateCurrentOrder(userId, { 
      service: serviceName,
      category: serviceInfo.category
    });
    
    return {
      action: "SELECT_SERVICE",
      order: userContext.currentOrder,
      serviceInfo: serviceInfo
    };
  }

  handleSetMeasures(userId, width, height) {
    const userContext = userContextManager.getUserContext(userId);
    const serviceInfo = userContextManager.getServiceInfo(userContext.currentOrder.service);

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
      order: userContext.currentOrder
    };
  }

  handleSetQuantity(userId, quantity) {
    if (quantity <= 0) {
      throw new CustomError('InvalidQuantityError', 'La cantidad debe ser mayor que cero');
    }

    userContextManager.updateCurrentOrder(userId, { quantity: quantity });
    const userContext = userContextManager.getUserContext(userId);

    return {
      action: "SET_QUANTITY",
      order: userContext.currentOrder
    };
  }

  handleSetFinishes(userId, sellado, ojetillos, bolsillo) {
    const userContext = userContextManager.getUserContext(userId);
    const serviceInfo = userContextManager.getServiceInfo(userContext.currentOrder.service);

    const finishes = {
      sellado: sellado && serviceInfo.sellado,
      ojetillos: ojetillos && serviceInfo.ojetillos,
      bolsillo: bolsillo && serviceInfo.bolsillo
    };

    userContextManager.updateCurrentOrder(userId, { finishes: finishes });

    return {
      action: "SET_FINISHES",
      order: userContext.currentOrder
    };
  }

  handleValidateFile(userId, isValid, reason) {
    userContextManager.updateCurrentOrder(userId, {
      fileAnalysis: { isValid, reason }
    });
    
    const userContext = userContextManager.getUserContext(userId);

    return {
      action: "VALIDATE_FILE",
      order: userContext.currentOrder
    };
  }

  async handleConfirmOrder(userId) {
    const userContext = userContextManager.getUserContext(userId);
    
    if (!userContextManager.isOrderComplete(userId)) {
      throw new CustomError('IncompleteOrderError', 'La orden no está completa');
    }

    const total = userContextManager.calculatePrice(userId);
    userContextManager.updateCurrentOrder(userId, { total: total });

    try {
      const orderSummary = this.formatOrderSummary(userContext.currentOrder);
      const result = await this.finalizeOrder(userId, userContext.currentOrder);

      this.orderConfirmed.add(userId);

      return {
        action: "CONFIRM_ORDER",
        order: userContext.currentOrder,
        summary: orderSummary,
        result: result
      };
    } catch (error) {
      logger.error(`Error al confirmar el pedido para usuario ${userId}: ${error.message}`);
      throw new CustomError('OrderConfirmationError', 'Error al confirmar el pedido', error);
    }
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

  resetOrder(userId) {
    this.orderConfirmed.delete(userId);
  }
}

export default new OrderManager();
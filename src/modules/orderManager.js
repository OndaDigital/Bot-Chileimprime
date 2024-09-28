import logger from '../utils/logger.js';
import { formatPrice, censorPhoneNumber } from '../utils/helpers.js';
import moment from 'moment-timezone';
import config from '../config/config.js';
import sheetService from '../services/sheetService.js';
import { CustomError } from '../utils/errorHandler.js';

class OrderManager {
  constructor() {
    this.orderConfirmed = new Set();
  }

  calculateOrder(order) {
    let total = 0;
    const calculatedItems = order.items.map(item => {
      let subtotal = 0;
      if (item.width && item.height) {
        const area = item.width * item.height;
        subtotal = area * item.precio * item.quantity;
      } else {
        subtotal = item.precio * item.quantity;
      }
      
      if (item.sellado) subtotal += item.precioSellado * (item.width * item.height);
      if (item.ojetillos) subtotal += item.precioOjetillos * (item.width * item.height);
      if (item.bolsillo) subtotal += item.precioBolsillo * (item.width * item.height);
      
      total += subtotal;
      return { ...item, subtotal };
    });

    return {
      items: calculatedItems,
      total,
      observaciones: order.observaciones
    };
  }

  formatOrderSummary(order) {
    let summary = "📋 Resumen final de tu cotización:\n\n";

    order.items.forEach(item => {
      summary += `*${item.categoria}* - ${item.nombre}\n`;
      if (item.width && item.height) {
        summary += `Medidas: ${item.width}m x ${item.height}m\n`;
      }
      summary += `Cantidad: ${item.quantity}\n`;
      if (item.sellado) summary += "- Con sellado\n";
      if (item.ojetillos) summary += "- Con ojetillos\n";
      if (item.bolsillo) summary += "- Con bolsillo\n";
      summary += `Subtotal: $${formatPrice(item.subtotal)}\n\n`;
    });

    summary += `💰 Total: $${formatPrice(order.total)}\n`;

    if (order.observaciones) {
      summary += `\nObservaciones: ${order.observaciones}\n`;
    }

    return summary;
  }

  async updateOrder(userId, jsonCommand, services, currentOrder) {
    logger.info(`Actualizando orden para usuario ${userId}. Comando: ${JSON.stringify(jsonCommand)}`);
    try {
      switch (jsonCommand.command) {
        case "SELECT_SERVICE":
          currentOrder.service = jsonCommand.service;
          currentOrder.category = services[jsonCommand.service].category;
          currentOrder.availableWidths = services[jsonCommand.service].availableWidths;
          currentOrder.availableFinishes = services[jsonCommand.service].availableFinishes;
          return { action: "SELECT_SERVICE", order: currentOrder };
        case "SET_MEASURES":
          if (!currentOrder.items) currentOrder.items = [];
          currentOrder.items.push({
            categoria: currentOrder.category,
            nombre: currentOrder.service,
            width: jsonCommand.width,
            height: jsonCommand.height,
            precio: services[currentOrder.service].precio
          });
          return { action: "SET_MEASURES", order: currentOrder };
        case "SET_QUANTITY":
          if (currentOrder.items && currentOrder.items.length > 0) {
            currentOrder.items[currentOrder.items.length - 1].quantity = jsonCommand.quantity;
          }
          return { action: "SET_QUANTITY", order: currentOrder };
        case "SET_FINISHES":
          if (currentOrder.items && currentOrder.items.length > 0) {
            const currentItem = currentOrder.items[currentOrder.items.length - 1];
            currentItem.sellado = jsonCommand.sellado;
            currentItem.ojetillos = jsonCommand.ojetillos;
            currentItem.bolsillo = jsonCommand.bolsillo;
            currentItem.precioSellado = services[currentOrder.service].precioSellado;
            currentItem.precioOjetillos = services[currentOrder.service].precioOjetillos;
            currentItem.precioBolsillo = services[currentOrder.service].precioBolsillo;
          }
          return { action: "SET_FINISHES", order: currentOrder };
        case "VALIDATE_FILE":
          currentOrder.fileValidation = {
            isValid: jsonCommand.isValid,
            reason: jsonCommand.reason
          };
          return { action: "VALIDATE_FILE", order: currentOrder };
        case "CONFIRM_ORDER":
          return { action: "CONFIRMAR_PEDIDO", order: currentOrder };
        default:
          logger.warn(`Comando desconocido recibido: ${jsonCommand.command}`);
          return { action: "CONTINUAR", order: currentOrder };
      }
    } catch (error) {
      logger.error(`Error al actualizar el pedido para usuario ${userId}: ${error.message}`);
      throw new CustomError('OrderUpdateError', 'Error al actualizar el pedido', error);
    }
  }

  async finalizeOrder(userId, userName, order) {
    logger.info(`Finalizando orden para usuario ${userId}`);
    
    const calculatedOrder = this.calculateOrder(order);
    logger.info(`Orden calculada para usuario ${userId}: ${JSON.stringify(calculatedOrder)}`);
    const formattedOrder = this.formatOrderForSheet(calculatedOrder);
    logger.info(`Orden formateada para hoja de cálculo, usuario ${userId}: ${JSON.stringify(formattedOrder)}`);
  
    const finalOrder = {
      fecha: moment().tz(config.timezone).format('DD-MM-YYYY HH:mm[hrs] - dddd'),
      telefono: userId,
      nombre: userName || 'Cliente',
      pedido: formattedOrder.details,
      observaciones: order.observaciones || 'Sin observaciones',
      total: formattedOrder.total
    };
  
    logger.info(`Orden final para usuario ${userId}: ${JSON.stringify(finalOrder)}`);
  
    try {
      const result = await sheetService.saveOrder(finalOrder);
      logger.info(`Resultado de guardado para usuario ${userId}: ${JSON.stringify(result)}`);

      if (result.success) {
        this.orderConfirmed.add(userId);
        logger.info(`Cotización finalizada y guardada correctamente para usuario ${userId}`);
        
        return { 
          confirmationMessage: "*¡Gracias!* 🎉 Tu cotización ha sido registrada. Un representante se pondrá en contacto contigo pronto para confirmar los detalles y coordinar la entrega de los archivos finales. 📞",
          orderSummary: this.formatOrderSummary(calculatedOrder),
          endConversation: true
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
    let details = '';
    let total = 0;
    
    order.items.forEach(item => {
      details += `${item.categoria} - ${item.nombre}\n`;
      if (item.width && item.height) {
        details += `Medidas: ${item.width}m x ${item.height}m\n`;
      }
      details += `Cantidad: ${item.quantity}\n`;
      if (item.sellado) details += "- Con sellado\n";
      if (item.ojetillos) details += "- Con ojetillos\n";
      if (item.bolsillo) details += "- Con bolsillo\n";
      details += `Subtotal: $${formatPrice(item.subtotal)}\n\n`;
      total += item.subtotal;
    });
    
    return {
      details: details.trim(),
      total: `$${formatPrice(total)}`
    };
  }

  estimateTotal(order) {
    let total = 0;
    order.items.forEach(item => {
      let itemTotal = item.precio * item.quantity;
      if (item.width && item.height) {
        const area = item.width * item.height;
        itemTotal = area * item.precio * item.quantity;
      }
      if (item.sellado) itemTotal += item.precioSellado * (item.width * item.height);
      if (item.ojetillos) itemTotal += item.precioOjetillos * (item.width * item.height);
      if (item.bolsillo) itemTotal += item.precioBolsillo * (item.width * item.height);
      total += itemTotal;
    });
    return formatPrice(total);
  }

  isOrderConfirmed(userId) {
    return this.orderConfirmed.has(userId);
  }

  resetOrder(userId) {
    this.orderConfirmed.delete(userId);
  }
}

export default new OrderManager();
// modules/orderManager.js

import logger from '../utils/logger.js';
import { formatPrice, censorPhoneNumber } from '../utils/helpers.js';
import moment from 'moment-timezone';
import config from '../config/config.js';
import sheetService from '../services/sheetService.js';
import openaiService from '../services/openaiService.js';
import { CustomError } from '../utils/errorHandler.js';

class OrderManager {
  constructor() {
    this.orderConfirmed = new Set();
  }

  calculateOrder(order) {
    let total = 0;
    const calculatedItems = order.items.map(item => {
      const subtotal = item.cantidad * item.precio;
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
    let summary = "📋 Resumen final de tu pedido:\n\n";

    order.items.forEach(item => {
      summary += `*${item.categoria}* - ${item.nombre}\n`;
      summary += `Cantidad: ${item.cantidad}x  $${formatPrice(item.precio)} c/u\n`;
      summary += `Subtotal: $${formatPrice(item.subtotal)}\n\n`;
    });

    summary += `💰 Total: $${formatPrice(order.total)}\n`;

    if (order.observaciones) {
      summary += `\nObservaciones: ${order.observaciones}\n`;
    }

    return summary;
  }

  async updateOrder(userId, aiResponse, menu, currentOrder) {
    logger.info(`Actualizando orden para usuario ${userId}. Respuesta AI: ${aiResponse}`);
    try {
      const extractedOrder = await openaiService.extractOrder(menu, aiResponse);
      logger.info(`Orden extraída en JSON para usuario ${userId}: ${JSON.stringify(extractedOrder)}`);

      if (extractedOrder && extractedOrder.items.length > 0) {
        currentOrder.items = [...currentOrder.items, ...extractedOrder.items];
        currentOrder.observaciones = extractedOrder.observaciones || currentOrder.observaciones;
        return { action: "ACTUALIZAR", order: currentOrder };
      } else if (aiResponse.includes("SOLICITUD_HUMANO")) {
        return { action: "SOLICITUD_HUMANO" };
      } else if (aiResponse.includes("ADVERTENCIA_MAL_USO_DETECTADO")) {
        return { action: "ADVERTENCIA_MAL_USO_DETECTADO" };
      }
      return { action: "CONTINUAR", order: currentOrder };
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
        logger.info(`Pedido finalizado y guardado correctamente para usuario ${userId}`);
        
        return { 
          confirmationMessage: "*¡Gracias!* 🎉 Tu pedido ha sido registrado y será preparado pronto. Un representante se pondrá en contacto contigo para confirmar los detalles. 📞",
          orderSummary: this.formatOrderSummary(calculatedOrder),
          endConversation: true
        };
      } else {
        throw new Error("Error al guardar el pedido");
      }
    } catch (error) {
      logger.error(`Error detallado al finalizar el pedido para usuario ${userId}:`, error);
      throw new CustomError('OrderFinalizationError', 'Error al finalizar el pedido', error);
    }
  }


  formatOrderForSheet(order) {
    let details = '';
    let total = 0;
    
    order.items.forEach(item => {
      const subtotal = item.cantidad * item.precio;
      details += `${item.categoria} - ${item.cantidad}x ${item.nombre} - $${formatPrice(item.precio)} c/u\n`;
      details += `Subtotal: $${formatPrice(subtotal)}\n`;
      total += subtotal;
    });
    
    return {
      details: details.trim(),
      total: `$${formatPrice(total)}`
    };
  }


  estimateTotal(order) {
    let total = 0;
    order.items.forEach(item => {
      total += item.cantidad * item.precio;
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
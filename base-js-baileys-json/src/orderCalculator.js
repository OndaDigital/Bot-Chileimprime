// orderCalculator.js 


import Logger from './logger.js';

const logger = new Logger();

class OrderCalculator {
  calculateOrder(order, products) {
    try {
      let total = 0;
      const calculatedItems = order.items.map(item => {
        const productInfo = this.findProductInfo(item, products);
        if (!productInfo) {
          throw new Error(`Producto no encontrado: ${item.nombre}`);
        }

        let itemTotal = this.calculateItemTotal(item, productInfo);
        total += itemTotal;

        return {
          ...item,
          precio: productInfo.precio,
          subtotal: itemTotal
        };
      });

      return {
        items: calculatedItems,
        total,
        observaciones: order.observaciones
      };
    } catch (error) {
      logger.error("Error al calcular el pedido:", error);
      throw error;
    }
  }

  findProductInfo(item, products) {
    for (const category in products) {
      const product = products[category].find(p => p.nombre === item.nombre);
      if (product) return product;
    }
    return null;
  }

  calculateItemTotal(item, productInfo) {
    let total = item.cantidad * productInfo.precio;

    if (item.medidas) {
      const area = item.medidas.ancho * item.medidas.alto;
      total *= area;
    }

    if (item.terminaciones) {
      item.terminaciones.forEach(terminacion => {
        switch (terminacion) {
          case 'sellado':
            total += productInfo.precioSellado * item.cantidad;
            break;
          case 'ojetillos':
            total += productInfo.precioOjetillo * item.cantidad;
            break;
          case 'bolsillo':
            total += productInfo.precioBolsillo * item.cantidad;
            break;
        }
      });
    }

    return total;
  }

  formatOrderSummary(order) {
    let summary = "📋 Resumen final de tu pedido:\n\n";

    order.items.forEach(item => {
      summary += `*${item.categoria}* - ${item.nombre}\n`;
      summary += `Cantidad: ${item.cantidad}x\n`;
      if (item.medidas) {
        summary += `Medidas: ${item.medidas.ancho}x${item.medidas.alto}\n`;
      }
      if (item.terminaciones && item.terminaciones.length > 0) {
        summary += `Terminaciones: ${item.terminaciones.join(', ')}\n`;
      }
      summary += `Subtotal: $${this.formatPrice(item.subtotal)}\n\n`;
    });

    summary += `💰 Total: $${this.formatPrice(order.total)}\n`;

    if (order.observaciones) {
      summary += `\nObservaciones: ${order.observaciones}\n`;
    }

    return summary;
  }

  formatPrice(price) {
    return price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
}

export default OrderCalculator;
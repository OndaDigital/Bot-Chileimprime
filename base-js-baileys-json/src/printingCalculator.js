// printingCalculator.js - Bot imprenta
import Logger from './logger.js';

const logger = new Logger();

class PrintingCalculator {
  calculateOrder(order, services) {
    try {
      let total = 0;
      const calculatedItems = order.items.map(item => {
        let subtotal = 0;
        const serviceInfo = services[item.nombre];
        
        if (['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(serviceInfo.categoria)) {
          const area = (item.ancho / 100) * (item.alto / 100); // Convertir a metros cuadrados
          subtotal = area * item.cantidad * serviceInfo.precio;
          
          if (item.terminaciones) {
            if (item.terminaciones.includes('sellado')) subtotal += area * serviceInfo.precioSellado;
            if (item.terminaciones.includes('ojetillos')) subtotal += area * serviceInfo.precioOjetillo;
            if (item.terminaciones.includes('bolsillo')) subtotal += area * serviceInfo.precioBolsillo;
          }
        } else {
          subtotal = item.cantidad * serviceInfo.precio;
          
          if (item.terminaciones) {
            if (item.terminaciones.includes('sellado')) subtotal += serviceInfo.precioSellado * item.cantidad;
            if (item.terminaciones.includes('ojetillos')) subtotal += serviceInfo.precioOjetillo * item.cantidad;
            if (item.terminaciones.includes('bolsillo')) subtotal += serviceInfo.precioBolsillo * item.cantidad;
          }
        }

        total += subtotal;
        return { ...item, subtotal };
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

  formatOrderSummary(order) {
    let summary = "📋 Resumen final de tu pedido:\n\n";

    order.items.forEach(item => {
      summary += `*${item.nombre}*\n`;
      summary += `Cantidad: ${item.cantidad}\n`;
      if (item.ancho && item.alto) {
        summary += `Medidas: ${item.ancho}cm x ${item.alto}cm\n`;
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

export default PrintingCalculator;
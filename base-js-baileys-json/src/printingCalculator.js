// printingCalculator.js - Bot imprenta


import Logger from './logger.js';

const logger = new Logger();

class PrintingCalculator {
  calculateOrder(order) {
    try {
      const calculatedServices = order.services.map(service => {
        let precioUnitario = 0;
        
        if (['Telas PVC', 'Banderas', 'Adhesivos', 'Adhesivo Vehicular', 'Back Light'].includes(service.categoria)) {
          const areaCm2 = service.ancho * service.alto;
          precioUnitario = areaCm2 * service.precioBase;

          if (service.sellado) precioUnitario += service.precioSellado;
          if (service.bolsillo) precioUnitario += service.precioBolsillo;
          if (service.ojetillos) precioUnitario += service.precioOjetillo;
        } else {
          precioUnitario = service.precioBase;
        }

        const subtotal = precioUnitario * service.cantidad;

        return { ...service, precioUnitario, subtotal };
      });

      const total = calculatedServices.reduce((sum, service) => sum + service.subtotal, 0);

      return {
        services: calculatedServices,
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

    order.services.forEach(service => {
      summary += `*${service.categoria} - ${service.tipo} - ${service.nombre}*\n`;
      summary += `Cantidad: ${service.cantidad} - Precio unitario: $${this.formatPrice(service.precioUnitario)}\n`;
      if (service.ancho && service.alto) {
        summary += `Medidas: ${service.ancho}x${service.alto} cm\n`;
      }
      summary += `Subtotal: $${this.formatPrice(service.subtotal)}\n\n`;
    });

    summary += `💰 Total: $${this.formatPrice(order.total)}\n`;

    if (order.observaciones) {
      summary += `\nObservaciones: ${order.observaciones}\n`;
    }

    return summary;
  }

  formatPrice(price) {
    return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
}

export default PrintingCalculator;
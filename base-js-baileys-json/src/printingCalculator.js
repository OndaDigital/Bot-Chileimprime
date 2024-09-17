// printingCalculator.js - Bot imprenta


import Logger from './logger.js';

class PrintingCalculator {
  constructor() {
    this.logger = new Logger();
  }

  calculateOrderTotal(order) {
    let total = 0;
    for (const service of order.servicios) {
      const serviceTotal = this.calculateServiceTotal(service);
      total += serviceTotal;
    }
    return total;
  }

  calculateServiceTotal(service) {
    let total = service.precio * service.cantidad;

    if (service.medidas) {
      const area = (service.medidas.ancho * service.medidas.alto) / 10000; // convertir a m²
      total *= area;
    }

    if (service.terminaciones) {
      if (service.terminaciones.sellado) total += service.precioSellado * service.cantidad;
      if (service.terminaciones.ojetillos) total += service.precioOjetillo * service.cantidad;
      if (service.terminaciones.bolsillo) total += service.precioBolsillo * service.cantidad;
    }

    return total;
  }

  formatCurrency(amount) {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  }

  generateOrderSummary(order) {
    let summary = "Resumen de tu pedido:\n\n";
    for (const service of order.servicios) {
      summary += `${service.nombre} - Cantidad: ${service.cantidad}\n`;
      if (service.medidas) {
        summary += `Medidas: ${service.medidas.ancho}x${service.medidas.alto} cm\n`;
      }
      if (service.terminaciones) {
        const terminaciones = Object.entries(service.terminaciones)
          .filter(([_, value]) => value)
          .map(([key, _]) => key)
          .join(', ');
        if (terminaciones) {
          summary += `Terminaciones: ${terminaciones}\n`;
        }
      }
      const serviceTotal = this.calculateServiceTotal(service);
      summary += `Subtotal: ${this.formatCurrency(serviceTotal)}\n\n`;
    }
    summary += `Total: ${this.formatCurrency(this.calculateOrderTotal(order))}`;
    return summary;
  }
}

export default PrintingCalculator;
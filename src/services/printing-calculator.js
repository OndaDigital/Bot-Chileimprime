import { ValidationError } from '../utils/error-types.js';

class PrintingCalculator {
  calculatePrice(order, serviceDetails) {
    let total = 0;
    for (const item of order.items) {
      const itemDetails = serviceDetails.find(s => s.id === item.id);
      if (!itemDetails) {
        throw new ValidationError(`Servicio no encontrado: ${item.id}`);
      }
      
      const basePrice = this.calculateBasePrice(item, itemDetails);
      const finishingsPrice = this.calculateFinishingsPrice(item, itemDetails);
      const quantity = item.quantity || 1;
      
      total += (basePrice + finishingsPrice) * quantity;
    }
    return total;
  }

  calculateBasePrice(item, itemDetails) {
    if (itemDetails.priceType === 'fixed') {
      return itemDetails.basePrice;
    } else if (itemDetails.priceType === 'perSquareMeter') {
      const area = (item.width * item.height) / 10000; // convert cm² to m²
      return itemDetails.basePrice * area;
    }
    throw new ValidationError(`Tipo de precio no soportado: ${itemDetails.priceType}`);
  }

  calculateFinishingsPrice(item, itemDetails) {
    let finishingsPrice = 0;
    if (item.finishings) {
      for (const [finishing, isSelected] of Object.entries(item.finishings)) {
        if (isSelected && itemDetails.finishings[finishing]) {
          finishingsPrice += itemDetails.finishings[finishing];
        }
      }
    }
    return finishingsPrice;
  }

  formatOrderSummary(order, serviceDetails) {
    let summary = "Resumen del pedido:\n";
    let total = 0;

    for (const item of order.items) {
      const itemDetails = serviceDetails.find(s => s.id === item.id);
      if (!itemDetails) {
        throw new ValidationError(`Servicio no encontrado: ${item.id}`);
      }

      const basePrice = this.calculateBasePrice(item, itemDetails);
      const finishingsPrice = this.calculateFinishingsPrice(item, itemDetails);
      const itemTotal = (basePrice + finishingsPrice) * item.quantity;

      summary += `- ${itemDetails.name}: ${item.quantity} x $${basePrice.toFixed(2)}\n`;
      if (finishingsPrice > 0) {
        summary += `  Acabados: $${finishingsPrice.toFixed(2)}\n`;
      }
      summary += `  Subtotal: $${itemTotal.toFixed(2)}\n\n`;

      total += itemTotal;
    }

    summary += `Total: $${total.toFixed(2)}`;
    return summary;
  }
}

export const printingCalculator = new PrintingCalculator();
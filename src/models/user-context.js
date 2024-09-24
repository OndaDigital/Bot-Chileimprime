import { PrintOrder } from './print-order.js';

class UserContext {
  constructor(userId) {
    this.userId = userId;
    this.state = 'INITIAL';
    this.cart = new PrintOrder(userId);
    this.menu = null;
    this.conversationHistory = [];
    this.lastInteraction = Date.now();
  }

  addToHistory(role, content) {
    this.conversationHistory.push({ role, content });
    this.trimHistory();
    this.updateLastInteraction();
  }

  trimHistory() {
    let totalWords = 0;
    for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
      totalWords += this.conversationHistory[i].content.split(' ').length;
      if (totalWords > 1500) {
        this.conversationHistory = this.conversationHistory.slice(i + 1);
        break;
      }
    }
  }

  getHistory() {
    return this.conversationHistory;
  }

  setState(newState) {
    this.state = newState;
    this.updateLastInteraction();
  }

  getState() {
    return this.state;
  }

  addToCart(item) {
    if (this.cart.items.length >= 5) {
      throw new Error('No se pueden agregar más de 5 servicios al carrito.');
    }
    this.cart.addItem(item);
    this.updateLastInteraction();
  }

  removeFromCart(index) {
    this.cart.removeItem(index);
    this.updateLastInteraction();
  }

  getCart() {
    return this.cart;
  }

  clearCart() {
    this.cart = new PrintOrder(this.userId);
    this.updateLastInteraction();
  }

  setMenu(menu) {
    this.menu = menu;
  }

  getMenu() {
    return this.menu;
  }

  updateLastInteraction() {
    this.lastInteraction = Date.now();
  }

  isSessionExpired(expirationTime) {
    return (Date.now() - this.lastInteraction) > expirationTime;
  }
}

export { UserContext };
class PrintOrder {
    constructor(userId) {
      this.userId = userId;
      this.items = [];
      this.totalPrice = 0;
      this.status = 'PENDING';
    }
  
    addItem(item, quantity, price) {
      this.items.push({ item, quantity, price });
      this.calculateTotal();
    }
  
    removeItem(index) {
      this.items.splice(index, 1);
      this.calculateTotal();
    }
  
    calculateTotal() {
      this.totalPrice = this.items.reduce((total, item) => total + item.quantity * item.price, 0);
    }
  
    setStatus(status) {
      this.status = status;
    }
  
    toJSON() {
      return {
        userId: this.userId,
        items: this.items,
        totalPrice: this.totalPrice,
        status: this.status,
      };
    }
  }
  
  export { PrintOrder };
// utils/helpers.js

export function formatPrice(price) {
  const formattedPrice = price.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return formattedPrice;
}
  
  export function censorPhoneNumber(phoneNumber) {
    if (phoneNumber.length <= 5) {
      return phoneNumber;
    }
    const firstTwo = phoneNumber.slice(0, 2);
    const lastThree = phoneNumber.slice(-3);
    const middleLength = phoneNumber.length - 5;
    const censoredMiddle = '*'.repeat(middleLength);
    return `${firstTwo}${censoredMiddle}${lastThree}`;
  }
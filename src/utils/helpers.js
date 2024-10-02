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


  // Nueva función para enviar mensajes divididos
export async function sendSplitMessages(flowDynamic, aiResponse) {
  // Filtrar el comando JSON inicial
  const filteredResponse = aiResponse.replace(/^\s*\{.*?\}\s*/, '').trim();

  // Dividir la respuesta en secciones basadas en los encabezados "### "
  const sections = filteredResponse.split(/(?=### )/).map(s => s.trim()).filter(s => s);

  for (const section of sections) {
    await flowDynamic(section);
    // Espera de 3 segundos antes de enviar el siguiente mensaje
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
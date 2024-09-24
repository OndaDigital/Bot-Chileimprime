// plugins/example-plugin.js
export const examplePlugin = {
  name: 'ExamplePlugin',
  
  onMessage: async (ctx) => {
    console.log(`Mensaje recibido de ${ctx.from}: ${ctx.body}`);
  },

  onResponse: async (ctx, response) => {
    console.log(`Respuesta a enviar a ${ctx.from}: ${response}`);
  },

  customFunction: async (ctx) => {
    return `Función personalizada ejecutada para ${ctx.from}`;
  }
};
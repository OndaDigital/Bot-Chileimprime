export const greetingCommand = {
    execute: async (ctx, { flowDynamic }) => {
      await flowDynamic('¡Hola! Bienvenido a la imprenta. ¿En qué puedo ayudarte hoy?');
    }
  };
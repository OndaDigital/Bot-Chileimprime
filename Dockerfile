FROM node:20

WORKDIR /app

# Copia package.json y package-lock.json (si existe)
COPY package*.json ./

# Instala las dependencias
RUN npm install

# Copia el resto de los archivos de la aplicación
COPY . .

# Comando para iniciar la aplicación
CMD ["node", "./src/app.js"]

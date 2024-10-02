# Usar una imagen base de Node.js
FROM node:20

# Instalar las dependencias del sistema necesarias
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libvips-dev \
    libvips \
    python3 \
    make \
    g++

# Establecer el directorio de trabajo en el contenedor
WORKDIR /app

# Copiar los archivos de package.json y package-lock.json al contenedor
COPY package*.json ./

# Instalar las dependencias de Node.js
RUN npm install

# Copiar todos los archivos y carpetas del proyecto al contenedor
COPY . .

# Exponer el puerto en el que la aplicación se ejecuta
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["npm", "start"]

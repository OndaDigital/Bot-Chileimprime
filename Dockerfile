FROM node:20

# Instalar dependencias de sistema para módulos como `sharp`
RUN apt-get update && apt-get install -y \
  python3 \
  build-essential \
  libvips-dev

# Establecer el directorio de trabajo en el contenedor
WORKDIR /app

# Copiar los archivos de package.json y package-lock.json al contenedor
COPY package*.json ./

# Instalar las dependencias
RUN npm install

# Copiar todos los archivos y carpetas del proyecto al contenedor
COPY . .

# Exponer el puerto en el que la aplicación se ejecuta
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["npm", "start"]

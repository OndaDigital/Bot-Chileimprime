FROM node:20

# Instalar tzdata para configurar la zona horaria
RUN apt-get update && apt-get install -y tzdata

# Configurar la zona horaria a Santiago de Chile
ENV TZ=America/Santiago

# Variables de entorno para configuración
# Valores posibles: daily, minutes
ENV RESTART_MODE=daily

# Para modo daily: hora del reinicio (0-23)    
ENV RESTART_HOUR=3

# Para modo minutes: intervalo en minutos       
ENV RESTART_MINUTES=5    

WORKDIR /app

# Copia package.json y package-lock.json (si existe)
COPY package*.json ./

# Instala las dependencias
RUN npm install

# Copia el resto de los archivos de la aplicación
COPY . .

# Script mejorado para reinicio configurable
COPY <<EOF /app/start.sh
#!/bin/sh

calculate_daily_restart() {
    current_hour=\$(date +%H | sed 's/^0//')
    current_minute=\$(date +%M | sed 's/^0//')
    
    current_hour=\${current_hour:-0}
    current_minute=\${current_minute:-0}
    
    if [ \$current_hour -lt \$RESTART_HOUR ]; then
        total_minutes=\$(( (\$RESTART_HOUR - \$current_hour) * 60 - \$current_minute ))
    else
        total_minutes=\$(( (\$RESTART_HOUR + 24 - \$current_hour) * 60 - \$current_minute ))
    fi
    
    hours_until=\$(( \$total_minutes / 60 ))
    minutes_until=\$(( \$total_minutes % 60 ))
    seconds_until=\$(( \$total_minutes * 60 ))
    
    current_time=\$(date +"%H:%M")
    next_restart=\$(date -d "+\$total_minutes minutes" +"%H:%M")
    
    echo "⏰ Hora actual: \$current_time"
    echo "🔄 Próximo reinicio: \$next_restart (\$hours_until horas y \$minutes_until minutos)"
    
    return \$seconds_until
}

calculate_minutes_restart() {
    current_minute=\$(date +%M | sed 's/^0//')
    current_minute=\${current_minute:-0}
    
    minutes_until=\$(( \$RESTART_MINUTES - (current_minute % \$RESTART_MINUTES) ))
    
    if [ \$minutes_until -eq \$RESTART_MINUTES ]; then
        minutes_until=\$RESTART_MINUTES
    fi
    
    seconds_until=\$(( minutes_until * 60 ))
    
    # Formatear tiempo actual y próximo reinicio
    current_time=\$(date +"%H:%M")
    next_restart=\$(date -d "+\$minutes_until minutes" +"%H:%M")
    
    echo "⏰ Hora actual: \$current_time"
    echo "🔄 Próximo reinicio: \$next_restart (\$minutes_until minutos)"
    
    return \$seconds_until
}

while true; do
    echo "🤖 Iniciando Bot..."
    echo "⚙️ Modo de reinicio: \$RESTART_MODE"
    
    if [ "\$RESTART_MODE" = "daily" ]; then
        calculate_daily_restart
        seconds_until=\$?
    else
        calculate_minutes_restart
        seconds_until=\$?
    fi
    
    echo "📝 Iniciando proceso por \$seconds_until segundos"
    echo "-------------------------------------------"
    
    timeout \$seconds_until npm start
    
    echo "-------------------------------------------"
    sleep 1
done
EOF

RUN chmod +x /app/start.sh

# Usar el script de inicio
CMD ["/app/start.sh"]
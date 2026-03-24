# Votatoon

App de votaciones en vivo estilo torneo para eventos con dos categorías: **Vestimenta** y **Presentación**.

## Cómo funciona

### Roles

| Rol | Descripción |
|-----|-------------|
| **Votante** | Vota por un concursante en cada enfrentamiento |
| **Concursante** | Participa en una categoría. Puede ver los votos en tiempo real pero NO puede votar en su propia categoría |
| **Presentador** | Controla todo el evento (solo accesible con URL secreta) |

### Flujo del evento

1. Los **concursantes** se registran eligiendo su categoría (Vestimenta o Presentación)
2. Los **votantes** se registran y esperan a que el presentador inicie
3. El **presentador** cierra inscripciones e inicia el torneo
4. Se arma un bracket de eliminación por pares (2 vs 2)
5. El presentador abre la votación para cada enfrentamiento
6. Los votantes eligen a uno de los dos concursantes
7. El presentador cierra la votación → el ganador avanza
8. Se repite hasta que queda un solo ganador por categoría
9. El presentador puede anunciar al ganador y se muestra en todas las pantallas con confetti

### Controles del presentador

- **Cambiar categoría**: Alternar entre Vestimenta y Presentación
- **Cerrar inscripciones**: Bloquea nuevos registros de concursantes
- **Iniciar torneo**: Genera el bracket de eliminación
- **Abrir/Cerrar votación**: Habilita y deshabilita los votos para el enfrentamiento actual
- **Anunciar ganador**: Selecciona un concursante y lo muestra como ganador en todas las pantallas
- **Reiniciar todo**: Borra todo y vuelve al estado inicial

## URLs de acceso

| Quién | URL |
|-------|-----|
| Votantes y concursantes | `http://tu-dominio:3000` |
| Presentador (tú) | `http://tu-dominio:3000/?admin=votatoon2026` |

> **Importante**: Solo con el parámetro `?admin=votatoon2026` aparece la opción de Presentador. Sin esa clave, nadie puede acceder al panel de control.

## Instalación y ejecución

### Opción 1: Node.js directo

```bash
npm install
npm start
```

La app corre en `http://localhost:3000`.

### Opción 2: Docker

```bash
docker build -t votatoon .
docker run -d -p 3000:3000 --name votatoon --restart unless-stopped votatoon
```

### Opción 3: Docker Compose

```bash
docker-compose up -d
```

## Deploy en TrueNAS

### Método 1: Docker Compose (recomendado)

1. Copia la carpeta del proyecto a tu TrueNAS (por ejemplo a `/mnt/pool/apps/votatoon`)
2. Abre la terminal de TrueNAS o conéctate por SSH
3. Navega a la carpeta:
   ```bash
   cd /mnt/pool/apps/votatoon
   ```
4. Levanta el contenedor:
   ```bash
   docker-compose up -d
   ```
5. La app estará en `http://IP-DE-TU-TRUENAS:3000`

### Método 2: Custom App en TrueNAS SCALE

1. Ve a **Apps** → **Discover Apps** → **Custom App**
2. Configura:
   - **Application Name**: `votatoon`
   - **Image Repository**: Primero haz `docker build -t votatoon .` en TrueNAS, o sube la imagen
   - **Container Port**: `3000`
   - **Node Port**: `3000` (o el que quieras)
3. Guarda y despliega

### Configurar subdominio

En tu reverse proxy (nginx, Traefik, etc.) apunta tu subdominio al puerto 3000 de TrueNAS. Ejemplo con nginx:

```nginx
server {
    listen 80;
    server_name votatoon.tudominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

> Los headers `Upgrade` y `Connection` son necesarios para que Socket.IO (WebSockets) funcione correctamente.

## Stack técnico

- **Backend**: Node.js + Express + Socket.IO
- **Frontend**: HTML/CSS/JS vanilla (sin frameworks)
- **Estilo**: Frutiger Aero (glassmorphism, gradientes, Fredoka font)
- **Tiempo real**: Socket.IO (WebSockets)
- **Sin base de datos**: Todo en memoria (ideal para eventos únicos)

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV HOST=0.0.0.0
ENV PORT=3013
EXPOSE 3013
CMD ["node", "server.js"]

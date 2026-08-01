# RAGE ROYALE — image de production
FROM node:22-alpine

WORKDIR /app

# Dépendances (couche cachée tant que package*.json ne change pas)
COPY package*.json ./
RUN npm ci --omit=dev

# Code
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Sonde de santé
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]

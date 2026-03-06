FROM node:20-alpine

WORKDIR /app

# Instalar dependencias (camada cacheada — so muda se package.json mudar)
COPY package.json ./
RUN npm install --production

# CACHEBUST: argumento que invalida o cache das proximas camadas a cada build
# O EasyPanel passa automaticamente --build-arg CACHEBUST=$(date) ou similar
# Se nao passar, use: docker build --build-arg CACHEBUST=$(date +%s) .
ARG CACHEBUST=1
RUN echo "Build: $CACHEBUST"

# Copiar codigo da aplicacao (sempre atualizado apos o CACHEBUST)
COPY server.js ./
COPY public ./public

# Diretorio persistente — montado como volume no EasyPanel
RUN mkdir -p /data/uploads

ENV PORT=3000
ENV DATA_FILE=/data/data.json
ENV UPLOADS_DIR=/data/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]

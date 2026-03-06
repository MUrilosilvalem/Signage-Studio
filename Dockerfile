FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./
COPY public ./public

# Diretório persistente para uploads e data.json
RUN mkdir -p /data/uploads

ENV PORT=3000
ENV DATA_FILE=/data/data.json
ENV UPLOADS_DIR=/data/uploads

EXPOSE 3000

# Healthcheck para o EasyPanel saber que o serviço subiu
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]

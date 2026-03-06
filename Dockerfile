FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /data/uploads

# Permite Node.js usar portas abaixo de 1024 sem root
RUN apk add --no-cache libcap && \
    setcap 'cap_net_bind_service=+ep' $(which node)

ENV DATA_FILE=/data/data.json
ENV UPLOADS_DIR=/data/uploads

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:${PORT:-80}/ || exit 1

CMD ["node", "server.js"]

# Node 24: o código usa `import.meta.filename` e `--env-file-if-exists`.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Cria a pasta public e custom-assets no build (evita erro se a pasta estiver vazia no host)
USER root
RUN mkdir -p public/custom-assets && chown -R node:node /app/public
USER node

# `node` já existe na imagem oficial. Root não precisa rodar um servidor HTTP.
USER node

EXPOSE 3000

# O Caddy na frente já faz o healthcheck do compose; este é para `docker ps`.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]

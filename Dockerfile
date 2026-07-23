# Multi-stage build: menor imagem final, mais rapido de deployar
# ================================================================
# Stage 1: builder — instala TUDO (dev deps) e compila TS -> JS
# ================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Prisma precisa de openssl no Alpine
RUN apk add --no-cache openssl

# Copia manifests primeiro (aproveita cache do Docker se nao mudarem)
COPY package*.json ./
COPY prisma ./prisma

# Instala todas as deps (incluindo dev, precisa do prisma/typescript)
RUN npm ci

# Gera o Prisma Client (precisa antes do build TS)
RUN npx prisma generate

# Copia o resto do codigo e compila
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ================================================================
# Stage 2: runner — imagem final, so o que precisa pra rodar
# ================================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Prisma precisa de openssl em runtime tambem
RUN apk add --no-cache openssl

# Copia apenas manifests e instala SO deps de producao
COPY package*.json ./
RUN npm ci --omit=dev

# Copia artefatos do builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Script de start: roda migrations + sobe o server
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]

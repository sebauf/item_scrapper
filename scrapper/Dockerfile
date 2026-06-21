FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev
RUN npx playwright install --with-deps chromium

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
CMD ["node", "dist/main.js"]

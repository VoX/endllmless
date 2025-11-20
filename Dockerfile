# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json ./
# Copy workspace package files
COPY client/package.json ./client/
COPY server/package.json ./server/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build client
RUN npm run build:client

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Install Caddy
RUN apk add --no-cache caddy

# Setup Server
COPY server/package.json ./server/
WORKDIR /app/server
RUN npm install --omit=dev

COPY server ./

# Setup Client
WORKDIR /app
COPY --from=builder /app/client/dist ./client/dist

# Configs
COPY Caddyfile /etc/caddy/Caddyfile
COPY start.sh ./
RUN chmod +x start.sh

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 80 443

CMD ["./start.sh"]

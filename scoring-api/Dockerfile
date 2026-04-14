# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
COPY prompts/ ./prompts/
RUN npm run build

# Audit for known CVEs — block build on high/critical
RUN npm audit --audit-level=high

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Non-root user for security
RUN addgroup -g 1001 -S lexlens && adduser -S -u 1001 -G lexlens lexlens

# Install production deps only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled output and runtime assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prompts ./prompts

USER lexlens

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]

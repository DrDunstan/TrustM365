# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS production

# Create a non-root user for security
RUN addgroup -S trustm365 && adduser -S trustm365 -G trustm365

WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy backend source
COPY backend/ ./backend/
COPY scripts/ ./scripts/

# Copy built frontend into a location nginx can serve
# (When using docker-compose with nginx, this is handled by a volume mount)
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Copy root package.json for scripts
COPY package.json ./

# Create data directory for SQLite
RUN mkdir -p /data && chown trustm365:trustm365 /data

USER trustm365

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "backend/src/index.js"]

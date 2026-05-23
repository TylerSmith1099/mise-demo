# Mise demo container — single origin: Node/Express backend serves the API and
# the prebuilt React SPA. Build context MUST be the MISE/ directory so both
# backend/ and frontend/dist/ are available.
#
#   docker build -t mise-demo -f Dockerfile .
#
# AU DATA RESIDENCY: deploy this image only to an AWS ap-southeast-2 region (or
# an AU-resident host). Staff/session data must never leave Australia.
FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

# Install backend production dependencies first (cached unless lockfile changes).
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

# Application code: backend source, migrations, scripts, knowledge base.
COPY backend ./backend
# Prebuilt SPA (frontend dist) served same-origin by the backend.
COPY frontend/dist ./frontend/dist

# The entrypoint runs migrations (idempotent), optionally seeds + ingests the
# knowledge base on first boot, then starts the server.
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Most demo platforms inject PORT; the app reads it (defaults to 3000).
EXPOSE 3000

WORKDIR /app/backend
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

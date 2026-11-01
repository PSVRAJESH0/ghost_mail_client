# Production Dockerfile for GhostMail
FROM node:20-alpine AS runner

WORKDIR /app

# Install curl for healthcheck probes
RUN apk add --no-cache curl

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV SMTP_PORT=2525
ENV DATA_FILE=/app/data/store.json

# Copy package descriptors
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy application code
COPY server.js ./
COPY public ./public

# Prepare persistent data directory with permissions for non-root node user
RUN mkdir -p /app/data && chown -R node:node /app

# Switch to non-root user
USER node

# Expose Web (3000) and SMTP (2525) ports
EXPOSE 3000 2525

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/healthz || exit 1

# Start the application
CMD ["node", "server.js"]

# ── Cider Institute AI Knowledge Library ──
# ARM-compatible (Oracle Cloud Always Free)
FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy app code
COPY src/ src/
COPY public/ public/
COPY vault/ vault/

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/ || exit 1

EXPOSE 3002

ENV NODE_ENV=production
ENV PORT=3002

CMD ["node", "src/server.js"]

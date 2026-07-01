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

# Health check (uses built-in Node.js fetch — no wget dependency)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

EXPOSE 3002

ENV NODE_ENV=production
ENV PORT=3002

CMD ["node", "src/server.js"]

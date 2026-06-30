#!/bin/bash
# ── Deploy Cider Institute Knowledge Library to Gael VPS ──
# Usage: ./deploy.sh
# Prerequisites: SSH key at /c/Users/jfpru/Desktop/proyectos/LeonGael/Gael/ssh-key-2026-02-04.key

set -e

SSH_KEY="/c/Users/jfpru/Desktop/proyectos/LeonGael/Gael/ssh-key-2026-02-04.key"
VPS_USER="ubuntu"
VPS_HOST="40.233.31.102"
APP_NAME="cider-knowledge"
APP_PORT="3002"
DOMAIN="cider-demo.leongael.xyz"
APP_DIR="/opt/${APP_NAME}"

echo "🍎 Deploying Cider Institute Knowledge Library..."
echo ""

# 1. Build Docker image locally
echo "📦 Building Docker image..."
docker build -t ${APP_NAME}:latest .

# 2. Save image and copy to VPS
echo "📤 Copying image to VPS..."
docker save ${APP_NAME}:latest | gzip > /tmp/${APP_NAME}.tar.gz
scp -i "${SSH_KEY}" /tmp/${APP_NAME}.tar.gz ${VPS_USER}@${VPS_HOST}:/tmp/
rm /tmp/${APP_NAME}.tar.gz

# 3. Load image on VPS, stop old container, start new one
echo "🚀 Deploying on VPS..."
ssh -i "${SSH_KEY}" ${VPS_USER}@${VPS_HOST} << 'ENDSSH'
set -e

APP_NAME="cider-knowledge"
APP_PORT="3002"
DOMAIN="cider-demo.leongael.xyz"
APP_DIR="/opt/${APP_NAME}"

# Load image
docker load < /tmp/${APP_NAME}.tar.gz
rm /tmp/${APP_NAME}.tar.gz

# Stop old container
docker rm -f ${APP_NAME} 2>/dev/null || true

# Create app directory if needed
mkdir -p ${APP_DIR}

# Start container with Traefik labels
docker run -d \
  --name ${APP_NAME} \
  --restart unless-stopped \
  --network gael_marketing_network \
  -e DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY}" \
  -e OPENAI_API_KEY="${OPENAI_API_KEY}" \
  -e PORT=${APP_PORT} \
  -e NODE_ENV=production \
  -v ${APP_DIR}/vault:/app/vault \
  -l traefik.enable=true \
  -l "traefik.http.routers.${APP_NAME}.rule=Host(\`${DOMAIN}\`)" \
  -l traefik.http.routers.${APP_NAME}.entrypoints=websecure \
  -l traefik.http.routers.${APP_NAME}.tls.certresolver=letsencrypt \
  -l "traefik.http.routers.${APP_NAME}-http.rule=Host(\`${DOMAIN}\`)" \
  -l traefik.http.routers.${APP_NAME}-http.entrypoints=web \
  -l traefik.http.services.${APP_NAME}.loadbalancer.server.port=${APP_PORT} \
  ${APP_NAME}:latest

echo "✅ Container started. Health check:"
sleep 5
docker ps --filter name=${APP_NAME} --format "table {{.Names}}\t{{.Status}}"

ENDSSH

echo ""
echo "✅ Deploy complete!"
echo "   Q&A UI:    https://${DOMAIN}/"
echo "   Wiki:      https://${DOMAIN}/vault/"
echo ""
echo "📋 Next steps:"
echo "   - Copy vault files: scp -r vault/ ${VPS_USER}@${VPS_HOST}:${APP_DIR}/"
echo "   - Test: curl https://${DOMAIN}/api/ask -H 'Content-Type: application/json' -d '{\"question\":\"What pH for fermentation?\"}'"

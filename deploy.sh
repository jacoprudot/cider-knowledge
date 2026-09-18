#!/bin/bash
# ── Deploy Cider Institute Knowledge Library to Gael VPS ──
# Usage: ./deploy.sh
# Prerequisites: SSH key at /c/Users/jfpru/Desktop/proyectos/LeonGael/Gael/ssh-key-2026-02-04.key
#
# Builds the image ON the VPS (ARM-native). Do NOT build locally on Windows —
# that produces an amd64 image which cannot run on the Oracle Cloud ARM host.
#
# Preserves .data (conversations + vault edits) across restarts via bind mount.
# Skips build/restart entirely when the VPS repo is already up to date.

set -e

SSH_KEY="/c/Users/jfpru/Desktop/proyectos/LeonGael/Gael/ssh-key-2026-02-04.key"
VPS_USER="ubuntu"
VPS_HOST="40.233.31.102"

ssh -i "${SSH_KEY}" -o ConnectTimeout=10 ${VPS_USER}@${VPS_HOST} 'bash -s' << 'ENDSSH'
set -e
cd /opt/cider-knowledge

echo "=== 1. git pull ==="
BEFORE=$(git rev-parse HEAD)
git pull origin master
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  echo "No changes on origin — skipping build, container left as-is."
  exit 0
fi

echo "=== 2. docker build (ARM) ==="
docker build -t cider-knowledge:latest .

echo "=== 3. preserve .data from running container ==="
docker cp cider-knowledge:/app/.data /tmp/cider-data-backup 2>/dev/null || true
mkdir -p /opt/cider-knowledge/.data
cp -rn /tmp/cider-data-backup/. /opt/cider-knowledge/.data/ 2>/dev/null || true
rm -rf /tmp/cider-data-backup

echo "=== 4. capture env from old container ==="
get_env() {
  docker inspect cider-knowledge --format '{{range .Config.Env}}{{println .}}{{end}}' | grep "^$1=" | head -1 | cut -d= -f2-
}
DEEPSEEK_API_KEY=$(get_env DEEPSEEK_API_KEY)
ACCESS_CODE=$(get_env ACCESS_CODE)
COOKIE_SECRET=$(get_env COOKIE_SECRET)

echo "=== 5. restart container ==="
docker rm -f cider-knowledge
docker run -d \
  --name cider-knowledge \
  --restart unless-stopped \
  --network gael_marketing_network \
  -e DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
  -e ACCESS_CODE="$ACCESS_CODE" \
  -e COOKIE_SECRET="$COOKIE_SECRET" \
  -e PORT=3002 \
  -e NODE_ENV=production \
  -v /opt/cider-knowledge/vault:/app/vault \
  -v /opt/cider-knowledge/.data:/app/.data \
  -l traefik.enable=true \
  -l 'traefik.http.routers.cider-knowledge.rule=Host(`cider-demo.leongael.xyz`)' \
  -l traefik.http.routers.cider-knowledge.entrypoints=websecure \
  -l traefik.http.routers.cider-knowledge.tls.certresolver=letsencrypt \
  -l 'traefik.http.routers.cider-knowledge-http.rule=Host(`cider-demo.leongael.xyz`)' \
  -l traefik.http.routers.cider-knowledge-http.entrypoints=web \
  -l traefik.http.services.cider-knowledge.loadbalancer.server.port=3002 \
  cider-knowledge:latest

echo "=== 6. health ==="
sleep 6
docker ps --filter name=cider-knowledge --format '{{.Names}} | {{.Status}}'
curl -s http://127.0.0.1:3002/api/health
echo ""
ENDSSH

echo ""
echo "✅ Deploy complete: https://cider-demo.leongael.xyz/"

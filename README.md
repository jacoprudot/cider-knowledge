# Cider Institute AI Knowledge Library

AI-powered Q&A system for cider production education. Members ask questions (text or voice), the system searches Cider Institute course materials and returns cited answers.

**Live:** [cider-demo.leongael.xyz](https://cider-demo.leongael.xyz/)  
**Access code:** `cider2026`

## Architecture

- **LLM:** DeepSeek API (`deepseek-chat`)
- **Server:** Node.js Express (ESM)
- **UI:** Static HTML/CSS/JS (Lato + Oswald, Cider Institute brand)
- **Vault:** Obsidian-compatible markdown, 6 topics, 33 files
- **Voice:** Browser SpeechRecognition + SpeechSynthesis (no API cost)
- **RAG:** Chunked keyword search (4K windows), length-normalized TF scoring, title-weighted ranking
- **Auth:** Shared access code + magic link, HMAC-signed cookies, session isolation

## Quick Start

```bash
npm install
DEEPSEEK_API_KEY=sk-... ACCESS_CODE=cider2026 npm run dev
```

Open http://localhost:3002

## Deploy (Gael VPS)

```bash
ssh ubuntu@40.233.31.102
cd /opt/cider-knowledge && git pull origin master
docker build -t cider-knowledge:latest .
docker rm -f cider-knowledge
docker run -d --name cider-knowledge --restart unless-stopped \
  --network gael_marketing_network \
  -v /opt/cider-knowledge/.data:/app/.data \
  -e DEEPSEEK_API_KEY="sk-..." \
  -e ACCESS_CODE="cider2026" \
  -e NODE_ENV=production \
  -l traefik.enable=true \
  -l "traefik.http.routers.cider-knowledge.rule=Host(\`cider-demo.leongael.xyz\`)" \
  -l traefik.http.routers.cider-knowledge.entrypoints=websecure \
  -l traefik.http.routers.cider-knowledge.tls.certresolver=letsencrypt \
  -l "traefik.http.routers.cider-knowledge-http.rule=Host(\`cider-demo.leongael.xyz\`)" \
  -l traefik.http.routers.cider-knowledge-http.entrypoints=web \
  -l traefik.http.services.cider-knowledge.loadbalancer.server.port=3002 \
  cider-knowledge:latest
```

## Vault Ingest

```bash
pip install pypdf python-docx python-pptx openpyxl openai-whisper
python ingest/run_all.py
```

## Routes

| Route | Description |
|-------|------------|
| `/` | Q&A chat UI |
| `/login` | Login page (access code + magic link) |
| `/vault/` | Knowledge wiki (markdown → HTML) |
| `/vault/graph` | Interactive D3 knowledge graph |
| `/api/ask` | POST — text Q&A (returns answer + sources) |
| `/api/conversations` | GET/POST/DELETE — conversation management |
| `/api/health` | GET — health check |

## Environment Variables

| Var | Required | Default |
|-----|----------|---------|
| `DEEPSEEK_API_KEY` | Yes | — |
| `ACCESS_CODE` | Yes | `cider2026` |
| `COOKIE_SECRET` | Yes | `crypto.randomBytes(32)` |
| `PORT` | No | `3002` |
| `NODE_ENV` | No | `production` |

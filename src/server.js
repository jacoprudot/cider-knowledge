import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { marked } from "marked";
import fs from "fs/promises";
import { createReadStream } from "fs";
import crypto from "crypto";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const app = express();
const PORT = process.env.PORT || 3002;
const ACCESS_CODE = process.env.ACCESS_CODE || "cider2026";

// DeepSeek client (OpenAI-compatible)
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
});

// ── Middleware ──
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Security headers ──
app.use((req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// ── Vault path ──
const VAULT_ROOT = path.join(ROOT, "vault");

// ── Conversation store (disk-persisted, per-user) ──
const conversations = new Map();
const CONVERSATIONS_FILE = path.join(ROOT, ".data", "conversations.json");

// Load conversations from disk on startup
async function loadConversations() {
  try {
    await fs.mkdir(path.join(ROOT, ".data"), { recursive: true });
    const raw = await fs.readFile(CONVERSATIONS_FILE, "utf-8");
    const data = JSON.parse(raw);
    for (const [id, conv] of Object.entries(data)) {
      conversations.set(id, conv);
    }
    console.log(`   Loaded ${conversations.size} conversations`);
  } catch { /* file doesn't exist yet — OK */ }
}

// Persist conversations to disk (debounced — called after mutations)
let saveTimeout;
function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      const data = Object.fromEntries(conversations);
      await fs.writeFile(CONVERSATIONS_FILE, JSON.stringify(data), "utf-8");
    } catch {}
  }, 2000); // debounce 2s
}

function getUserHash(req) {
  // Extract sessionId from cookie for unique user identity
  // Regular token: code.signature.sessionId → sessionId at index 2
  // Magic token: magic.expires.sessionId.signature → sessionId at index 2
  const token = req.cookies?.[COOKIE_NAME] || "";
  const parts = token.split(".");
  let sessionId;
  if (parts[0] === "magic") {
    sessionId = parts[2]; // magic.expires.sessionId.signature
  } else {
    sessionId = parts[2]; // code.signature.sessionId
  }
  return crypto.createHash("sha256").update(sessionId || token || "anonymous").digest("hex").slice(0, 16);
}

function getUserConversations(userHash) {
  const userConvs = [];
  for (const [id, conv] of conversations) {
    if (conv.userId === userHash) {
      userConvs.push({ id: conv.id, title: conv.title, createdAt: conv.createdAt, updatedAt: conv.updatedAt, messageCount: conv.messages.length });
    }
  }
  return userConvs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// ── Auth: shared access code with unique session per user ──
const COOKIE_NAME = "cider_token";
const COOKIE_SECRET = process.env.COOKIE_SECRET || crypto.randomBytes(32).toString("hex");

function signToken(code, sessionId) {
  // Format: code.signature.sessionId
  // sessionId ensures each login gets a unique user identity even with same code
  const hmac = crypto.createHmac("sha256", COOKIE_SECRET);
  hmac.update(`${code}:${sessionId}`);
  return `${code}.${hmac.digest("hex")}.${sessionId}`;
}

function verifyToken(token) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [code, signature, sessionId] = parts;
  if (!code || !signature || !sessionId) return false;
  try {
    const hmac = crypto.createHmac("sha256", COOKIE_SECRET);
    hmac.update(`${code}:${sessionId}`);
    const expected = `${code}.${hmac.digest("hex")}.${sessionId}`;
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

// Magic link: generate a time-limited signed access URL with unique session
function generateMagicLink() {
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  const sessionId = crypto.randomUUID();
  const payload = `magic.${expires}.${sessionId}`;
  const hmac = crypto.createHmac("sha256", COOKIE_SECRET);
  hmac.update(payload);
  return `${payload}.${hmac.digest("hex")}`;
}

function verifyMagicToken(token) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [prefix, expires, sessionId] = parts;
  if (prefix !== "magic") return false;
  if (Date.now() > parseInt(expires)) return false;
  try {
    const payload = `magic.${expires}.${sessionId}`;
    const hmac = crypto.createHmac("sha256", COOKIE_SECRET);
    hmac.update(payload);
    const expected = `${payload}.${hmac.digest("hex")}`;
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

// Auth middleware for protected routes
function requireAuth(req, res, next) {
  // Check cookie first
  const cookieToken = req.cookies?.[COOKIE_NAME];
  if (cookieToken && verifyToken(cookieToken)) {
    return next();
  }

  // Check magic link query parameter
  const magicToken = req.query.token;
  if (magicToken && verifyMagicToken(magicToken)) {
    // Set cookie so future requests don't need the token param
    const maxAge = 7 * 24 * 60 * 60;
    res.cookie(COOKIE_NAME, magicToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: maxAge * 1000,
      path: "/",
    });
    // Strip token from URL for cleanliness
    const url = new URL(req.originalUrl, `http://${req.headers.host}`);
    url.searchParams.delete("token");
    return res.redirect(url.pathname + url.search);
  }

  // Allow API requests to return 401 instead of redirect
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // Redirect to login for page requests
  const returnTo = encodeURIComponent(req.originalUrl);
  return res.redirect(`/login?return=${returnTo}`);
}

// Simple cookie parser (no extra dependency)
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(";").forEach((c) => {
      const [name, ...rest] = c.trim().split("=");
      if (name) req.cookies[name] = rest.join("=");
    });
  }
  next();
});

// ── Public routes (no auth required) ──
app.get("/login", (req, res) => {
  const error = req.query.error === "1" ? "Invalid access code. Please try again." : "";
  const returnTo = req.query.return || "/";
  res.type("html").send(renderLoginPage(error, returnTo));
});

app.post("/api/login", (req, res) => {
  const { code, return: returnTo } = req.body;
  if (code === ACCESS_CODE) {
    const sessionId = crypto.randomUUID();
    const token = signToken(code, sessionId);
    const maxAge = 30 * 24 * 60 * 60; // 30 days
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: maxAge * 1000,
      path: "/",
    });
    return res.json({ ok: true, redirect: returnTo || "/" });
  }
  return res.status(401).json({ ok: false, error: "Invalid access code" });
});

app.get("/api/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.redirect("/login");
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", vaultFiles: wikiIndex.size });
});

// Debug: trace search results
app.get("/api/debug/search", async (req, res) => {
  const q = req.query.q || "ph";
  const results = await searchVault(q);
  res.json(results.map((r) => ({ title: r.title, file: r.file, score: Math.round(r.score * 100) / 100 })));
});

// Generate magic link (requires access code)
app.post("/api/magic", (req, res) => {
  if (req.body.code !== ACCESS_CODE) {
    return res.status(401).json({ error: "Invalid access code" });
  }
  const magicToken = generateMagicLink();
  const host = req.headers.host || "cider-demo.leongael.xyz";
  const protocol = host.includes("localhost") ? "http" : "https";
  const magicUrl = `${protocol}://${host}/?token=${magicToken}`;
  res.json({ url: magicUrl, expires: "7 days" });
});

// ── Static files — serve only assets, NOT index.html ──
app.use(express.static(path.join(ROOT, "public"), { index: false }));

// ── Protected routes ──
app.use(requireAuth);

// ── Conversation API ──
app.get("/api/conversations", (req, res) => {
  const userHash = getUserHash(req);
  res.json(getUserConversations(userHash));
});

app.get("/api/conversations/:id", (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: "Conversation not found" });
  const userHash = getUserHash(req);
  if (conv.userId !== userHash) return res.status(403).json({ error: "Not your conversation" });
  res.json(conv);
});

app.post("/api/conversations", (req, res) => {
  const userHash = getUserHash(req);
  const id = crypto.randomUUID();
  const title = (req.body.title || "New conversation").slice(0, 120);
  const now = new Date().toISOString();
  const conv = { id, userId: userHash, title, messages: [], createdAt: now, updatedAt: now };
  conversations.set(id, conv);
  scheduleSave();
  res.json({ id, title, createdAt: now });
});

app.delete("/api/conversations/:id", (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: "Not found" });
  const userHash = getUserHash(req);
  if (conv.userId !== userHash) return res.status(403).json({ error: "Not your conversation" });
  conversations.delete(req.params.id);
  scheduleSave();
  res.json({ ok: true });
});

// Save message feedback
app.patch("/api/conversations/:convId/messages/:msgIdx/feedback", (req, res) => {
  const conv = conversations.get(req.params.convId);
  if (!conv) return res.status(404).json({ error: "Not found" });
  const userHash = getUserHash(req);
  if (conv.userId !== userHash) return res.status(403).json({ error: "Not your conversation" });
  const idx = parseInt(req.params.msgIdx);
  if (!conv.messages[idx]) return res.status(404).json({ error: "Message not found" });
  conv.messages[idx].feedback = req.body.feedback; // "up", "down", or null
  res.json({ ok: true });
});

// ── System prompt ──
const SYSTEM_PROMPT = `You are a knowledgeable instructor at the Cider Institute of North America — the trusted authority in cidermaking education for over a decade. You help cider and perry producers learn their craft through natural, conversational dialogue. Answer using ONLY the official course materials provided below.

YOUR TONE:
Warm, encouraging, and precise — like a seasoned cidermaker mentoring an apprentice over a cup of coffee. You represent the Cider Institute's intellectual honesty and a decade of credibility.

HOW CONVERSATIONS WORK — READ THIS CAREFULLY:

Cidermaking is both a science and an art. The best answer almost always depends on context. You and the cidermaker are having a conversation to figure out what applies to THEIR specific situation.

**Step 1 — Look at the conversation history. Where are we in this dialogue?**

If your LAST message asked clarifying questions, AND the user's new message appears to answer them (even partially) → Go to Step 3 (give the specific answer). Do NOT ask more questions. They just answered you.

If this is a new topic or the first exchange → Go to Step 2.

**Step 2 — Ask clarifying questions (first turn only)**

When you need context, do this:
1. Warmly acknowledge the question in ONE sentence
2. Ask 2-3 specific questions — numbered, easy to answer
3. End with a natural prompt like "Tell me about your setup and I can give you targeted guidance."

Example of a good first response:
"Great question. pH targets really depend on what you're making and how. A few things would help me give you a useful answer: 1) What style of cider are you going for — dry, sweet, or something specific? 2) Roughly how big is your batch? 3) Are you using cultured yeast or going wild? Tell me about your setup and I can give you much more targeted guidance."

Keep it warm. Never sound like a form or a checklist. This is a conversation between a mentor and an apprentice.

**Step 3 — Give the specific answer (follow-up turns)**

The cidermaker just told you about their situation. Now:
1. Acknowledge what they shared ("A dry cider at 500L with cultured yeast — got it.")
2. Give the specific, practical answer for THEIR situation
3. Cite your sources: "Source: [Document Name], [Section]"
4. If appropriate, add one practical tip or suggest a relevant lab test
5. End with an open door: "Does that help? Or is there another aspect you're wondering about?"

**Step 4 — Straight factual questions**

If the question is purely definitional (e.g., "What is malolactic fermentation?"):
Answer directly. Cite your source. Keep it concise. You can still ask "Would you like me to go deeper on how this applies to your cider?" to keep the conversation going.

GOLDEN RULES:
1. Answer ONLY from the provided documents. Never make up information.
2. Every factual answer MUST cite its source.
3. If the documents don't contain something, say: "I don't have enough in the course materials to answer that confidently." Suggest a module that might cover it.
4. Never loop — if the user gave you context, USE IT. Don't ask again.
5. Be conversational. This is a dialogue, not a Q&A terminal.`;

// ── Vault Search (keyword + title match, chunked for large files) ──
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "can", "shall", "you", "your",
  "we", "they", "them", "their", "its", "it", "this", "that", "these",
  "those", "am", "not", "no", "if", "so", "as", "what", "which", "who",
  "whom", "how", "when", "where", "why", "all", "each", "every", "both",
  "few", "more", "most", "other", "some", "such", "only", "own", "same",
  "than", "too", "very", "just", "about", "also", "into", "over",
]);

const CHUNK_SIZE = 4000;
const CHUNK_OVERLAP = 500;

function filterTerms(query) {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

// Technical cider/perry short terms — never filter these (pH, SO2, TA, SG, etc.)
const TECH_TERMS = new Set(["ph", "so2", "ta", "sg", "mlf", "tv", "va", "co2", "h2s", "o2"]);
// Add tech terms to the stop word removal — but KEEP them
for (const t of TECH_TERMS) STOP_WORDS.delete(t);

async function searchVault(query) {
  const results = [];
  const terms = filterTerms(query);
  if (terms.length === 0) return results;

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith(".md") && entry.name !== "index.md") {
        const content = await fs.readFile(full, "utf-8");
        const title = content.match(/^#\s+(.+)/m)?.[1] || entry.name.replace(".md", "").replace(/-/g, " ");
        const relPath = path.relative(VAULT_ROOT, full).replace(/\\/g, "/");

        // Score: extreme title weight + IDF-like content scoring
        const titleLower = title.toLowerCase();
        const queryLower = query.toLowerCase().trim();
        let titleScore = 0;

        // Massive bonus for key term matches in title (title should dominate search ranking)
        for (const t of terms) {
          if (t.length < 2) continue;
          if (titleLower.includes(t)) {
            titleScore += 200; // +200 per key term in title
          }
        }
        // +500 for exact title match (the holy grail)
        if (titleLower === queryLower) titleScore += 500;
        // +300 if the full query phrase appears in the title
        if (titleLower.includes(queryLower)) titleScore += 300;

        const contentLower = content.toLowerCase();
        const docLen = Math.max(content.length, 1000);
        let contentScore = terms.reduce((s, t) => {
          if (t.length < 2) return s;
          const count = contentLower.split(t).length - 1;
          return s + (count * 1000) / docLen;
        }, 0);
        // +50 if the exact query phrase appears in content
        if (contentLower.includes(queryLower)) contentScore += 50;

        const totalScore = titleScore + contentScore;
        if (totalScore <= 0) return;

        // For large files: chunk and return best chunks
        if (content.length > CHUNK_SIZE + CHUNK_OVERLAP) {
          const chunks = [];
          let pos = 0;
          while (pos < content.length) {
            const chunk = content.slice(pos, pos + CHUNK_SIZE);
            // Score this chunk specifically
            const chunkLower = chunk.toLowerCase();
            const chunkScore = terms.reduce((s, t) => {
              return s + (chunkLower.split(t).length - 1);
            }, 0);
            if (chunkScore > 0) {
              chunks.push({ text: chunk, score: chunkScore });
            }
            pos += CHUNK_SIZE - CHUNK_OVERLAP;
          }
          // Return best chunk per file (avoid flooding results with one doc)
          chunks.sort((a, b) => b.score - a.score);
          const best = chunks[0];
          if (best) {
            results.push({ file: relPath, title, content: best.text, score: best.score + titleScore });
          }
        } else {
          results.push({ file: relPath, title, content: content, score: totalScore });
        }
      }
    }
  }

  await walk(VAULT_ROOT);
  // Deduplicate by file, keep highest-scoring chunks
  results.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    const key = r.file + r.content.slice(0, 50);
    if (!seen.has(key)) { seen.add(key); deduped.push(r); }
  }
  return deduped.slice(0, 6);
}

// ── POST /api/ask ──
app.post("/api/ask", async (req, res) => {
  try {
    const { question, conversationId } = req.body;
    if (!question?.trim()) {
      return res.status(400).json({ error: "question is required" });
    }

    const userHash = getUserHash(req);

    // Get or create conversation
    let conv;
    if (conversationId && conversations.has(conversationId)) {
      conv = conversations.get(conversationId);
    } else {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      conv = { id, userId: userHash, title: question.slice(0, 120), messages: [], createdAt: now, updatedAt: now };
      conversations.set(id, conv);
      scheduleSave();
    }

    // Build conversation context from stored messages
    const recentMessages = conv.messages.slice(-8); // last 8 turns

    // Search vault using question + last 2 messages only (avoid noise from long history)
    const searchContext = recentMessages.slice(-2).map((m) => m.content).join(" ");
    const searchQuery = question + " " + searchContext;
    const pages = await searchVault(searchQuery);
    const vaultContext = pages.map((p) => `### ${p.title} (${p.file})\n${p.content}`).join("\n\n---\n\n");

    // Build LLM messages: system + conversation history + vault + current question
    const llmMessages = [{ role: "system", content: SYSTEM_PROMPT }];

    // Add conversation history
    for (const msg of recentMessages) {
      llmMessages.push({ role: msg.role, content: msg.content });
    }

    // Add current question with vault context
    llmMessages.push({
      role: "user",
      content: `COURSE MATERIALS:\n\n${vaultContext || "No relevant materials found."}\n\n---\n\nQUESTION: ${question}\n\nRemember the conversation flow: if you previously asked clarifying questions, check if I'm answering them now. If your last message asked questions and this message answers them, give me the specific guidance. If this is a new topic, ask clarifying questions if needed.`,
    });

    const completion = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      messages: llmMessages,
      temperature: 0.3,
      max_tokens: 1500,
    });

    const answer = completion.choices[0].message.content;

    // Save messages to conversation
    const now = new Date().toISOString();
    conv.messages.push({ role: "user", content: question, timestamp: now });
    conv.messages.push({ role: "assistant", content: answer, timestamp: now });
    conv.updatedAt = now;
    scheduleSave();
    // Update title from first question if still default
    if (conv.messages.length <= 2) {
      conv.title = question.slice(0, 120);
    }

    res.json({
      conversationId: conv.id,
      answer,
      sources: pages.map((p) => ({ title: p.title, file: p.file })),
    });
  } catch (err) {
    console.error("/api/ask error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/ask-voice ──
app.post("/api/ask-voice", async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript?.trim()) {
      return res.status(400).json({ error: "transcript is required" });
    }

    const pages = await searchVault(transcript);
    const context = pages.map((p) => `### ${p.title} (${p.file})\n${p.content}`).join("\n\n---\n\n");

    const completion = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `COURSE MATERIALS:\n\n${context || "No relevant materials found."}\n\n---\n\nQUESTION: ${transcript}\n\nAnswer as a Cider Institute instructor:` },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    res.json({ answer: completion.choices[0].message.content, sources: pages.map((p) => ({ title: p.title, file: p.file })) });
  } catch (err) {
    console.error("/api/ask-voice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Graph view (must be before /vault/* wildcard) ──
app.get("/vault/graph", (req, res) => {
  res.sendFile(path.join(ROOT, "public", "graph.html"));
});

// ── Public Wiki: /vault/* ──
app.get(["/vault", "/vault/"], (req, res) => {
  res.redirect("/vault/index.md");
});

app.get("/vault/*", async (req, res) => {
  try {
    const relativePath = req.params[0] || "index.md";
    const fullPath = path.join(VAULT_ROOT, relativePath);
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(VAULT_ROOT))) {
      return res.status(403).type("html").send(renderWikiPage("403", "<h1>Forbidden</h1>"));
    }

    let stat;
    try { stat = await fs.stat(resolved); } catch {
      return res.status(404).type("html").send(renderWikiPage("404", "<h1>Page not found</h1><p><a href='/vault/'>Back to wiki</a></p>"));
    }

    if (stat.isDirectory()) {
      const indexPath = path.join(resolved, "index.md");
      try {
        await fs.access(indexPath);
        return res.redirect(`/vault/${relativePath}/index.md`.replace(/\/+/g, "/"));
      } catch {
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        const items = entries
          .filter((e) => e.isDirectory() || (e.isFile() && e.name.endsWith(".md") && e.name !== "index.md"))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((e) => {
            const href = `/vault/${relativePath}${relativePath ? "/" : ""}${e.name}`.replace(/\/+/g, "/");
            const label = e.name.replace(".md", "").replace(/-/g, " ");
            return `<li><a href="${href}">${e.isDirectory() ? "📂" : "📄"} ${label}</a></li>`;
          });
        return res.type("html").send(renderWikiPage(relativePath || "Home", `<h1>${relativePath || "Knowledge Library"}</h1><ul>${items.join("")}</ul>`));
      }
    }

    const md = await fs.readFile(resolved, "utf-8");
    const html = addWikilinks(marked.parse(md));
    res.type("html").send(renderWikiPage(relativePath.replace(".md", ""), html));
  } catch (err) {
    console.error("/vault error:", err);
    res.status(500).type("html").send(renderWikiPage("Error", "<h1>Internal error</h1>"));
  }
});

// ── POST /api/voice/transcribe ──
app.post("/api/voice/transcribe", async (req, res) => {
  try {
    const { audio } = req.body;
    if (!audio) return res.status(400).json({ error: "audio (base64) is required" });

    const audioBuffer = Buffer.from(audio, "base64");
    let transcript = "";
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      await fs.mkdir(path.join(ROOT, ".tmp"), { recursive: true });
      const tmpPath = path.join(ROOT, ".tmp", `recording-${Date.now()}.webm`);
      await fs.writeFile(tmpPath, audioBuffer);

      const whisperRes = await openai.audio.transcriptions.create({
        model: "whisper-1",
        file: createReadStream(tmpPath),
        language: "en",
        response_format: "text",
      });

      transcript = typeof whisperRes === "string" ? whisperRes : whisperRes;
      await fs.unlink(tmpPath).catch(() => {});
    } catch (err) {
      console.error("Whisper error:", err.message);
      return res.status(500).json({ error: "Transcription failed" });
    }

    res.json({ transcript: transcript.trim() });
  } catch (err) {
    console.error("/api/voice/transcribe error:", err);
    res.status(500).json({ error: "Transcription failed" });
  }
});

// ── Serve Q&A UI ──
app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

// ── Login page (access code + magic link, Shamel-inspired) ──
function renderLoginPage(error, returnTo) {
  const errHtml = error ? `<div class="error">${error}</div>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cider Institute — Member Access</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,300;0,400;0,700;1,400&family=Oswald:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
    :root { --charcoal: #1a1a1a; --gold: #C4A35A; --grey: #D4CFC4; --glass-bg: rgba(255,255,255,0.9); }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Lato', sans-serif; font-weight: 400;
      background: linear-gradient(135deg, #f5f0e8 0%, #ede4d3 40%, #e8dfc8 100%);
      color: var(--charcoal); display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
    }
    .login-card {
      background: var(--glass-bg); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255,255,255,0.3); border-radius: 12px;
      padding: 2.5rem; max-width: 420px; width: 90%;
      box-shadow: 0 2px 20px rgba(0,0,0,0.06);
      text-align: center;
    }
    .login-card img { max-width: 200px; height: auto; margin-bottom: 0.75rem; }
    .login-card .subtitle { color: #666; margin-bottom: 2rem; font-size: 0.9rem; line-height: 1.5; }
    .login-card label { display: block; font-size: 0.8rem; margin-bottom: 0.35rem; color: var(--charcoal); text-align: left; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
    .login-card input {
      width: 100%; padding: 0.75rem 0.85rem; font-size: 1rem;
      border: 1px solid var(--grey); border-radius: 6px;
      font-family: 'Lato', sans-serif; outline: none; margin-bottom: 1rem;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .login-card input:focus { border-color: var(--gold); box-shadow: 0 0 0 3px rgba(196,163,90,0.15); }
    .login-card button {
      width: 100%; padding: 0.8rem; font-size: 0.9rem; font-weight: 700;
      background: var(--charcoal); color: #fff; border: none;
      border-radius: 6px; cursor: pointer; font-family: 'Lato', sans-serif;
      text-transform: uppercase; letter-spacing: 0.05em;
      transition: background 0.2s;
    }
    .login-card button:hover { background: #333; }
    .login-card button.secondary {
      background: none; color: var(--charcoal); border: 1px solid var(--grey);
      font-weight: 400; margin-top: 0.75rem; text-transform: none; letter-spacing: 0;
    }
    .login-card button.secondary:hover { border-color: var(--charcoal); background: rgba(0,0,0,0.02); }
    .login-card button:disabled { opacity: 0.5; cursor: not-allowed; }
    .error { color: #8B2E2E; font-size: 0.85rem; margin-bottom: 1rem; }
    .divider { display: flex; align-items: center; margin: 1.25rem 0; color: #aaa; font-size: 0.8rem; }
    .divider::before, .divider::after { content: ""; flex: 1; border-top: 1px solid var(--grey); }
    .divider span { padding: 0 0.75rem; }
    .magic-sent { text-align: center; padding: 1.5rem 0; display: none; }
    .magic-sent.visible { display: block; }
    .magic-sent .check { font-size: 1.5rem; color: var(--gold); margin-bottom: 0.75rem; }
    .magic-sent p { color: #666; font-size: 0.85rem; margin-bottom: 0.5rem; line-height: 1.5; }
    .magic-sent .magic-url {
      background: rgba(0,0,0,0.03); padding: 0.6rem 0.75rem; border-radius: 6px;
      font-family: monospace; font-size: 0.75rem; word-break: break-all;
      color: var(--charcoal); margin: 0.75rem 0; text-align: left;
    }
    .magic-sent .hint { font-size: 0.75rem; color: #aaa; margin-top: 0.5rem; }
    .footer { margin-top: 1.5rem; font-size: 0.75rem; color: #aaa; }
    .footer a { color: #999; }
  </style>
</head>
<body>
  <div class="login-card">
    <img src="/logo.png" alt="Cider Institute of North America">
    <p class="subtitle">Knowledge Library — Member Access</p>

    ${errHtml}

    <form id="codeForm">
      <label for="code">Access code</label>
      <input type="password" name="code" id="code" placeholder="Enter access code" autofocus>
      <button type="submit">Access Knowledge Library</button>
    </form>

    <div class="divider"><span>or</span></div>

    <form id="magicForm">
      <button type="submit" class="secondary">Send magic link →</button>
    </form>

    <div class="magic-sent" id="magicSent">
      <div class="check">✓</div>
      <p style="color: var(--charcoal); font-weight: 600;">Share this link with your team</p>
      <p>One click — no access code needed. Valid for 7 days.</p>
      <div class="magic-url" id="magicUrl"></div>
      <button type="button" class="secondary" onclick="copyMagicUrl()" id="copyBtn">📋 Copy to clipboard</button>
      <p class="hint">You can also bookmark this link for direct access.</p>
    </div>

    <div class="footer">
      <a href="https://www.ciderinstitute.com/">Cider Institute of North America</a>
    </div>
  </div>
  <script>
    document.getElementById("codeForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: document.getElementById("code").value, return: "${returnTo}" }),
      });
      const data = await res.json();
      if (data.ok) window.location.href = data.redirect;
      else window.location.href = "/login?error=1&return=" + encodeURIComponent("${returnTo}");
    });
    document.getElementById("magicForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = document.getElementById("code").value;
      if (!code) { document.getElementById("code").focus(); return; }
      const res = await fetch("/api/magic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code }),
      });
      if (!res.ok) { alert("Incorrect access code"); return; }
      const data = await res.json();
      document.getElementById("magicUrl").textContent = data.url;
      document.getElementById("magicSent").classList.add("visible");
    });
    window.copyMagicUrl = function() {
      const url = document.getElementById("magicUrl").textContent;
      navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById("copyBtn");
        btn.textContent = "✓ Copied!";
        setTimeout(() => { btn.textContent = "📋 Copy to clipboard"; }, 2000);
      });
    };
  </script>
</body>
</html>`;
}

// ── Wiki page renderer ──
function renderWikiPage(currentPath, content) {
  const cleanPath = currentPath.replace(/\\/g, "/");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cider Institute — Knowledge Library</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,300;0,400;0,700;1,400&family=Oswald:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
    :root { --cream: #F8F5F0; --charcoal: #1a1a1a; --gold: #C4A35A; --grey: #D4CFC4; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Lato', sans-serif; font-weight: 400; background: var(--cream); color: var(--charcoal); display: flex; min-height: 100vh; }
    nav {
      width: 280px; background: var(--charcoal); color: #fff; padding: 1.75rem 1.5rem;
      position: sticky; top: 0; height: 100vh; overflow-y: auto; flex-shrink: 0;
    }
    nav img { max-width: 160px; height: auto; margin-bottom: 1.5rem; filter: brightness(10); display: block; }
    nav a { color: #ccc; text-decoration: none; display: block; padding: 0.35rem 0; font-size: 0.85rem; transition: color 0.2s; }
    nav a:hover { color: #fff; }
    nav .nav-section { margin: 1.5rem 0; }
    nav .nav-section strong {
      color: #888; font-size: 0.7rem; text-transform: uppercase;
      letter-spacing: 0.12em; display: block; margin-bottom: 0.5rem;
      font-family: 'Oswald', sans-serif; font-weight: 400;
    }
    .logout-link { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.08); font-size: 0.78rem; }
    main { flex: 1; padding: 2.5rem 3rem; max-width: 850px; }
    main h1 { font-family: 'Oswald', sans-serif; font-weight: 400; font-size: 2rem; margin-bottom: 1.5rem; color: var(--charcoal); }
    main h2 { font-family: 'Oswald', sans-serif; font-weight: 400; font-size: 1.3rem; margin: 2rem 0 0.75rem; border-bottom: 1px solid var(--grey); padding-bottom: 0.35rem; }
    main h3 { font-family: 'Oswald', sans-serif; font-weight: 400; font-size: 1.05rem; margin: 1.5rem 0 0.5rem; }
    main p { line-height: 1.75; margin-bottom: 1rem; font-size: 0.95rem; }
    main ul, main ol { margin: 0.5rem 0 1rem 1.5rem; line-height: 1.75; font-size: 0.95rem; }
    main a { color: #8B2E2E; }
    .wikilink { border-bottom: 1px dashed rgba(139,46,46,0.3); text-decoration: none; }
    .wikilink:hover { border-bottom-color: #8B2E2E; }
    main blockquote {
      border-left: 3px solid var(--gold); padding: 0.5rem 1rem; margin: 1rem 0;
      background: rgba(196,163,90,0.08); font-style: italic; font-size: 0.9rem;
    }
    main table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.9rem; }
    main th { background: var(--charcoal); color: #fff; padding: 0.6rem 0.75rem; text-align: left; font-family: 'Oswald', sans-serif; font-weight: 400; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.8rem; }
    main td { border: 1px solid var(--grey); padding: 0.5rem 0.75rem; }
    main tr:nth-child(even) td { background: rgba(0,0,0,0.015); }
    main code { background: rgba(0,0,0,0.05); padding: 0.15rem 0.35rem; border-radius: 3px; font-size: 0.88em; }
    main pre { background: var(--charcoal); color: #fff; padding: 1.25rem; border-radius: 8px; overflow-x: auto; margin: 1rem 0; }
    main pre code { background: none; padding: 0; color: inherit; }
    .breadcrumb { font-size: 0.8rem; color: #aaa; margin-bottom: 1.5rem; font-family: 'Lato', sans-serif; }
    .breadcrumb a { color: #aaa; text-decoration: none; }
    .breadcrumb a:hover { color: var(--charcoal); }
    @media (max-width: 768px) { body { flex-direction: column; } nav { width: 100%; height: auto; position: static; } main { padding: 1.5rem; } }
  </style>
</head>
<body>
  <nav>
    <img src="/logo.png" alt="Cider Institute">
    <div class="nav-section">
      <strong>Topics</strong>
      <a href="/vault/fermentation/">Fermentation</a>
      <a href="/vault/lab-testing/">Lab Testing</a>
      <a href="/vault/sensory-analysis/">Sensory Analysis</a>
      <a href="/vault/facility-operations/">Facility Operations</a>
      <a href="/vault/perry-production/">Perry Production</a>
      <a href="/vault/aroma-chemistry/">Aroma Chemistry</a>
    </div>
    <a href="/vault/graph" style="margin-top:1.5rem;font-size:0.82rem;">🕸️ Knowledge Graph</a>
    <div class="logout-link">
      <a href="/">← Q&A</a>
      <a href="/api/logout" style="margin-top:0.5rem;">Log out</a>
    </div>
  </nav>
  <main>
    <div class="breadcrumb"><a href="/vault/">Home</a>${cleanPath ? " › " + cleanPath : ""}</div>
    ${content}
  </main>
</body>
</html>`;
}

// ── Wikilink index (built at startup) ──
const wikiIndex = new Map(); // title (lowercase) → { title, file }

async function buildWikiIndex() {
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); }
      else if (entry.name.endsWith(".md") && entry.name !== "index.md") {
        try {
          const content = await fs.readFile(full, "utf-8");
          const title = (content.match(/^#\s+(.+)/m)?.[1] || entry.name.replace(".md", "").replace(/-/g, " ")).trim();
          const relPath = path.relative(VAULT_ROOT, full).replace(/\\/g, "/");
          wikiIndex.set(title.toLowerCase(), { title, file: relPath });
          // Also index significant sub-headings (H2)
          for (const m of content.matchAll(/^##\s+(.+)/gm)) {
            const sub = m[1].trim();
            if (sub.length > 4 && sub.length < 80) {
              const key = sub.toLowerCase();
              if (!wikiIndex.has(key)) wikiIndex.set(key, { title: sub, file: relPath + "#" + sub.toLowerCase().replace(/\s+/g, "-") });
            }
          }
        } catch {}
      }
    }
  }
  await walk(VAULT_ROOT);
  console.log(`   Wiki index: ${wikiIndex.size} titles`);
}

function addWikilinks(html) {
  // Find the longest matching titles in the HTML and wrap them in wikilinks
  const titles = [...wikiIndex.entries()].sort((a, b) => b[0].length - a[0].length); // longest first
  for (const [key, { file }] of titles) {
    const regex = new RegExp(`(${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![^<]*>|[^<>]*<\\/a>)`, "gi");
    html = html.replace(regex, (match) => {
      if (match.length < 4) return match; // skip very short matches
      return `<a href="/vault/${file}" class="wikilink" title="${match}">${match}</a>`;
    });
  }
  return html;
}

// ── Start ──
loadConversations().then(() => buildWikiIndex()).then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🍎 Cider Knowledge server running on :${PORT}`);
    console.log(`   Access code: ${ACCESS_CODE === "cider2026" ? "cider2026 (default — set ACCESS_CODE env var to change)" : "(custom)"}`);
    console.log(`   Q&A UI:     http://localhost:${PORT}/`);
    console.log(`   Wiki:       http://localhost:${PORT}/vault/`);
    console.log(`   Login:      http://localhost:${PORT}/login`);
    console.log(`   Graph:      http://localhost:${PORT}/vault/graph`);
    console.log(`   Vault:      ${VAULT_ROOT}`);
  });
});

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { marked } from "marked";
import fs from "fs/promises";
import { createReadStream } from "fs";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const app = express();
const PORT = process.env.PORT || 3002;

// DeepSeek client (OpenAI-compatible)
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
});

// ── Middleware ──
app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(ROOT, "public")));

// ── Vault path ──
const VAULT_ROOT = path.join(ROOT, "vault");

// ── System prompt ──
const SYSTEM_PROMPT = `You are a knowledgeable instructor at the Cider Institute of North America. You help cider and perry producers learn their craft by answering questions using ONLY the official course materials provided below.

RULES:
1. Answer ONLY from the provided documents. Never make up information.
2. Every answer MUST cite its source: "Source: [Document Name], [Section]"
3. If the documents don't contain the answer, say: "I don't have enough information in the course materials to answer that question confidently." Then suggest which course module might cover it.
4. Your tone is warm, encouraging, and precise — like a seasoned cidermaker mentoring an apprentice.
5. Keep answers concise but thorough. Prefer practical guidance over theory.
6. When relevant, mention lab tests the cidermaker can perform to diagnose their situation.`;

// ── Vault Search (keyword + title match) ──
async function searchVault(query) {
  const results = [];
  const terms = query.toLowerCase().split(/\s+/);

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith(".md") && entry.name !== "index.md") {
        const content = await fs.readFile(full, "utf-8");
        const title = content.match(/^#\s+(.+)/m)?.[1] || entry.name.replace(".md", "");
        const score = terms.reduce((s, t) => {
          const inTitle = title.toLowerCase().includes(t) ? 10 : 0;
          const matches = content.toLowerCase().split(t).length - 1;
          return s + inTitle + matches;
        }, 0);
        if (score > 0) {
          results.push({
            file: path.relative(VAULT_ROOT, full).replace(/\\/g, "/"),
            title,
            content: content.slice(0, 8000),
            score,
          });
        }
      }
    }
  }

  await walk(VAULT_ROOT);
  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ── POST /api/ask ──
app.post("/api/ask", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question?.trim()) {
      return res.status(400).json({ error: "question is required" });
    }

    const pages = await searchVault(question);
    const context = pages
      .map((p) => `### ${p.title} (${p.file})\n${p.content}`)
      .join("\n\n---\n\n");

    const completion = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `COURSE MATERIALS:\n\n${context || "No relevant materials found."}\n\n---\n\nQUESTION: ${question}\n\nAnswer as a Cider Institute instructor:`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    const answer = completion.choices[0].message.content;

    res.json({
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
    const context = pages
      .map((p) => `### ${p.title} (${p.file})\n${p.content}`)
      .join("\n\n---\n\n");

    const completion = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `COURSE MATERIALS:\n\n${context || "No relevant materials found."}\n\n---\n\nQUESTION: ${transcript}\n\nAnswer as a Cider Institute instructor:`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    res.json({
      answer: completion.choices[0].message.content,
      sources: pages.map((p) => ({ title: p.title, file: p.file })),
    });
  } catch (err) {
    console.error("/api/ask-voice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Public Wiki: /vault/* ──
app.get(["/vault", "/vault/"], (req, res) => {
  res.redirect("/vault/index.md");
});

app.get("/vault/*", async (req, res) => {
  try {
    const relativePath = req.params[0] || "index.md";
    const fullPath = path.join(VAULT_ROOT, relativePath);

    // Security: prevent directory traversal
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(VAULT_ROOT))) {
      return res.status(403).type("html").send(renderWikiPage("403", "<h1>Forbidden</h1>"));
    }

    let stat;
    try { stat = await fs.stat(resolved); } catch { return res.status(404).type("html").send(renderWikiPage("404", "<h1>Page not found</h1><p><a href='/vault/'>Back to wiki</a></p>")); }

    // If directory, try index.md
    if (stat.isDirectory()) {
      const indexPath = path.join(resolved, "index.md");
      try {
        await fs.access(indexPath);
        return res.redirect(`/vault/${relativePath}/index.md`.replace(/\/+/g, "/"));
      } catch {
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        const topics = entries
          .filter((e) => e.isDirectory() || (e.isFile() && e.name.endsWith(".md") && e.name !== "index.md"))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((e) => {
            const entryPath = `/vault/${relativePath}${relativePath ? "/" : ""}${e.name}`.replace(/\/+/g, "/");
            const label = e.name.replace(".md", "").replace(/-/g, " ");
            return `<li><a href="${entryPath}">${e.isDirectory() ? "📂" : "📄"} ${label}</a></li>`;
          });
        return res.type("html").send(renderWikiPage(
          relativePath || "Home",
          `<h1>${relativePath || "Knowledge Library"}</h1><ul>${topics.join("")}</ul>`
        ));
      }
    }

    // Render markdown file
    const md = await fs.readFile(resolved, "utf-8");
    const html = marked.parse(md);
    res.type("html").send(renderWikiPage(relativePath.replace(".md", ""), html));
  } catch (err) {
    console.error("/vault error:", err);
    res.status(500).type("html").send(renderWikiPage("Error", "<h1>Internal error</h1>"));
  }
});

function renderWikiPage(currentPath, content) {
  const cleanPath = currentPath.replace(/\\/g, "/");
  const depth = (cleanPath.match(/\//g) || []).length;
  const prefix = depth > 0 ? "../".repeat(depth) : "./";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cider Institute — Knowledge Library</title>
  <style>
    :root {
      --cream: #F5F1E8;
      --charcoal: #2B2B2B;
      --terracotta: #B85C28;
      --grey: #D4CFC4;
      --olive: #7A7E5F;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, 'Times New Roman', serif; background: var(--cream); color: var(--charcoal); display: flex; min-height: 100vh; }
    nav {
      width: 280px; background: var(--charcoal); color: var(--cream); padding: 2rem 1.5rem;
      position: sticky; top: 0; height: 100vh; overflow-y: auto; flex-shrink: 0;
    }
    nav h2 { font-size: 1.1rem; margin-bottom: 1.5rem; color: var(--grey); text-transform: uppercase; letter-spacing: 0.1em; }
    nav a { color: var(--cream); text-decoration: none; display: block; padding: 0.35rem 0; font-size: 0.95rem; }
    nav a:hover { color: var(--terracotta); }
    nav .nav-section { margin-bottom: 1.5rem; }
    nav .nav-section strong { color: var(--grey); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; display: block; margin-bottom: 0.35rem; }
    .back-link { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); font-size: 0.85rem; }
    main { flex: 1; padding: 2.5rem 3rem; max-width: 850px; }
    main h1 { font-size: 2rem; margin-bottom: 1.5rem; color: var(--charcoal); }
    main h2 { font-size: 1.4rem; margin: 2rem 0 0.75rem; border-bottom: 1px solid var(--grey); padding-bottom: 0.25rem; }
    main h3 { font-size: 1.15rem; margin: 1.5rem 0 0.5rem; }
    main p { line-height: 1.7; margin-bottom: 1rem; }
    main ul, main ol { margin: 0.5rem 0 1rem 1.5rem; line-height: 1.7; }
    main a { color: var(--terracotta); }
    main blockquote {
      border-left: 3px solid var(--olive); padding: 0.5rem 1rem; margin: 1rem 0;
      background: rgba(122,126,95,0.08); font-style: italic;
    }
    main table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.95rem; }
    main th { background: var(--charcoal); color: var(--cream); padding: 0.6rem 0.75rem; text-align: left; }
    main td { border: 1px solid var(--grey); padding: 0.5rem 0.75rem; }
    main tr:nth-child(even) td { background: rgba(0,0,0,0.02); }
    main code { background: rgba(0,0,0,0.06); padding: 0.15rem 0.35rem; border-radius: 3px; font-size: 0.9em; font-family: 'Courier New', monospace; }
    main pre { background: var(--charcoal); color: var(--cream); padding: 1.25rem; border-radius: 8px; overflow-x: auto; margin: 1rem 0; }
    main pre code { background: none; padding: 0; color: inherit; }
    .breadcrumb { font-size: 0.85rem; color: #999; margin-bottom: 1.5rem; }
    .breadcrumb a { color: #999; text-decoration: none; }
    .breadcrumb a:hover { color: var(--terracotta); }
    @media (max-width: 768px) {
      body { flex-direction: column; }
      nav { width: 100%; height: auto; position: static; padding: 1.5rem; }
      main { padding: 1.5rem; }
    }
  </style>
</head>
<body>
  <nav>
    <h2>🍎 Cider Institute<br>Knowledge Library</h2>
    <div class="nav-section">
      <strong>Topics</strong>
      <a href="/vault/fermentation/">Fermentation</a>
      <a href="/vault/lab-testing/">Lab Testing</a>
      <a href="/vault/sensory-analysis/">Sensory Analysis</a>
      <a href="/vault/facility-operations/">Facility Operations</a>
      <a href="/vault/perry-production/">Perry Production</a>
      <a href="/vault/aroma-chemistry/">Aroma Chemistry</a>
    </div>
    <div class="back-link">
      <a href="/">← Back to Q&A</a>
    </div>
  </nav>
  <main>
    <div class="breadcrumb"><a href="/vault/">Home</a>${cleanPath ? " › " + cleanPath : ""}</div>
    ${content}
  </main>
</body>
</html>`;
}

// ── POST /api/voice/transcribe ──
app.post("/api/voice/transcribe", async (req, res) => {
  try {
    const { audio, mimeType } = req.body;
    if (!audio) {
      return res.status(400).json({ error: "audio (base64) is required" });
    }

    const audioBuffer = Buffer.from(audio, "base64");

    // Transcribe via OpenAI Whisper
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

// ── Start ──
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🍎 Cider Knowledge server running on :${PORT}`);
  console.log(`   Q&A UI:    http://localhost:${PORT}/`);
  console.log(`   Wiki:      http://localhost:${PORT}/vault/`);
  console.log(`   Vault:     ${VAULT_ROOT}`);
});

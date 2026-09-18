"""
Build graph data for the Obsidian-style graph view.
Generates public/graph-data.json with nodes (vault files) and edges (shared keywords/[[wikilinks]]).
"""
import os, json, re
from pathlib import Path
from collections import defaultdict

VAULT = Path("vault")
PUBLIC = Path("public")
# foundation-textbook must be FIRST — the topic loop breaks at the first match,
# and files like foundation-textbook/fermentation.md would otherwise be
# misclassified as the "fermentation" topic.
TOPICS = ["foundation-textbook", "fermentation", "lab-testing", "sensory-analysis", "facility-operations", "perry-production", "aroma-chemistry"]
TOPIC_COLORS = {
    "foundation-textbook": "#C08B2C",
    "fermentation": "#8B9A6D",
    "lab-testing": "#6B7B4F",
    "sensory-analysis": "#BFA98A",
    "facility-operations": "#C9B896",
    "perry-production": "#4A7072",
    "aroma-chemistry": "#B85C28",
    "other": "#aaa",
}

# Technical vocabulary for TF-IDF-style content keywords. Extracted with a
# corpus document-frequency filter (2..60% of files) so universal words like
# "cider" don't connect everything to everything.
TECH_TERMS = set("""cider perry fermentation ferment fermented yeast mlf malolactic lactic acid acidity
tannin tannins phenolic phenolics apple apples pear pears juice fruit flavor flavours aroma aromas
sulfur dioxide so2 sulfite sulphite maturation mature matured racking racked filtration filter
filtered fining fined clarification clarity carbonation carbonated blending blended packaging
packaged bottling bottled pasteurization pasteurized sterile stability spoilage microbiology
microbial bacteria bacterial laboratory labs analysis testing test sensory quality assurance
control qa inspection sanitation sanitization cleaning hygiene gmp safety hazards haccp
sweet sweetened dry medium sugar sugars brix gravity alcohol abv percent concentration
storage stored storing harvest harvesting orchard orcharding planting trees rootstock
scion propagation pruning cultivar varieties variety vintage pressing milling grinding
pomace pulp must press pressed batch batches tank tanks vessel vessels barrel
barrels cask casks oak wood wooden stainless steel pump pumps transfer transferred
temperature temperatures heat cooling chilled cold warm ambient oxidation oxidized
oxygen aeration headspace ullage sediment lees haze turbidity cloudy bright brilliant
sparkling still co2 carbon dioxide nitrogen argon""".split())

files = {}
file_keywords = {}

for fp in sorted(VAULT.rglob("*.md")):
    if fp.name == "index.md":
        continue
    rel_path = str(fp.relative_to(VAULT)).replace("\\", "/")

    try:
        content = fp.read_text(encoding="utf-8")
    except Exception:
        continue

    title_m = re.search(r"^# (.+)", content, re.M)
    title = title_m.group(1) if title_m else fp.stem.replace("-", " ").title()

    topic = "other"
    for t in TOPICS:
        if t in rel_path:
            topic = t
            break

    # Extract keywords: bold terms + headings + capitalized phrases
    kws = set()
    for m in re.finditer(r"\*\*(.+?)\*\*", content[:4000]):
        kw = m.group(1).lower().strip()
        if 3 < len(kw) < 60:
            kws.add(kw)
    for m in re.finditer(r"^#{1,3}\s+(.+)", content, re.M):
        kw = m.group(1).lower().strip()
        if len(kw) > 2:
            kws.add(kw)

    files[rel_path] = {"title": title, "topic": topic, "keywords": list(kws)[:15]}
    file_keywords[rel_path] = kws

# ── Second pass: technical-term keywords with corpus document-frequency filter ──
# First count in how many files each technical term appears…
term_df = defaultdict(int)
for fpath, _ in files.items():
    # file_keywords may be expanded below; use raw content instead
    content = (VAULT / fpath).read_text(encoding="utf-8").lower()
    content = re.sub(r"[^a-z\s]", " ", content)
    for t in set(TECH_TERMS) & set(content.split()):
        term_df[t] += 1

n_files = len(files)
# Keep terms appearing in 2..~14% of files — rarer terms create meaningful
# edges; common terms (60%) connect everything to everything (hairball).
max_df = max(3, int(n_files * 0.14))

# …then add the rare-ish ones (appearing in 2..60% of files) to each file
for fpath, _ in files.items():
    content = (VAULT / fpath).read_text(encoding="utf-8").lower()
    content = re.sub(r"[^a-z\s]", " ", content)
    words = content.split()
    counter = defaultdict(int)
    for w in words:
        if w in TECH_TERMS and 2 <= term_df.get(w, 0) <= max_df:
            counter[w] += 1
    top = sorted(counter, key=lambda w: -counter[w])[:30]
    file_keywords[fpath] |= set(top)

# Build nodes
nodes = []
for fpath, data in files.items():
    nodes.append({
        "id": fpath,
        "title": data["title"][:60],
        "topic": data["topic"],
        "color": TOPIC_COLORS.get(data["topic"], "#aaa"),
    })

# Build edges: files sharing >=4 keywords (raised from 2 — the technical-term
# pool adds many common words, so a higher bar keeps edges meaningful)
edges = []
seen = set()
file_list = list(files.keys())

for i in range(len(file_list)):
    for j in range(i + 1, len(file_list)):
        f1, f2 = file_list[i], file_list[j]
        overlap = file_keywords[f1] & file_keywords[f2]
        if len(overlap) >= 4:
            ek = tuple(sorted([f1, f2]))
            if ek not in seen:
                seen.add(ek)
                edges.append({
                    "source": f1,
                    "target": f2,
                    "weight": min(len(overlap), 10),
                    "shared": list(overlap)[:5],
                })

graph = {"nodes": nodes, "edges": edges}
PUBLIC.mkdir(exist_ok=True)
Path(PUBLIC / "graph-data.json").write_text(json.dumps(graph), encoding="utf-8")

print(f"Graph: {len(nodes)} nodes, {len(edges)} edges")
for t in TOPICS:
    n = sum(1 for nd in nodes if nd["topic"] == t)
    print(f"  {t}: {n} files")

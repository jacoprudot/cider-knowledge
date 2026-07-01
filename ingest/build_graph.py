"""
Build graph data for the Obsidian-style graph view.
Generates public/graph-data.json with nodes (vault files) and edges (shared keywords/[[wikilinks]]).
"""
import os, json, re
from pathlib import Path
from collections import defaultdict

VAULT = Path("vault")
PUBLIC = Path("public")
TOPICS = ["fermentation", "lab-testing", "sensory-analysis", "facility-operations", "perry-production", "aroma-chemistry"]
TOPIC_COLORS = {
    "fermentation": "#8B9A6D",
    "lab-testing": "#6B7B4F",
    "sensory-analysis": "#BFA98A",
    "facility-operations": "#C9B896",
    "perry-production": "#4A7072",
    "aroma-chemistry": "#B85C28",
    "other": "#aaa",
}

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

# Build nodes
nodes = []
for fpath, data in files.items():
    nodes.append({
        "id": fpath,
        "title": data["title"][:60],
        "topic": data["topic"],
        "color": TOPIC_COLORS.get(data["topic"], "#aaa"),
    })

# Build edges: files sharing 3+ keywords
edges = []
seen = set()
file_list = list(files.keys())

for i in range(len(file_list)):
    for j in range(i + 1, len(file_list)):
        f1, f2 = file_list[i], file_list[j]
        overlap = file_keywords[f1] & file_keywords[f2]
        if len(overlap) >= 2:
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

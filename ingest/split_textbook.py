"""
Split the full Foundation textbook PDF into per-section markdown files.

The PDF has no bookmarks, so we split by book-page ranges derived from the
printed table of contents. Book page N = PDF page index N + 3 (0-based),
i.e. PDF page 10 (1-based) is book page 6.

Output: one .md per logical section in vault/foundation-textbook/, plus an
index.md. Subsection headings from the TOC become ## headings inside files.
"""

import re
import sys
from pathlib import Path

PDF_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:\Users\jfpru\Downloads\FINAL CINA textbook_copyright (1) (1) (1).pdf"
)
VAULT_DIR = Path(__file__).resolve().parent.parent / "vault" / "foundation-textbook"

# ── Section map: (filename, title, book_start, book_end_inclusive, toc_group) ──
SECTIONS = [
    ("history-of-the-cider-industry", "History of the Cider Industry", 6, 8, "A"),
    ("legal-framework", "Cider & Perry Production and Marketing — Legal Framework", 9, 14, "A"),
    ("cider-apples-perry-pears-orcharding", "The Raw Materials — Cider Apples, Perry Pears & Orcharding", 15, 24, "A"),
    ("production-overview", "Cider & Perry Production — An Overview", 25, 29, "B"),
    ("fruit-selection-harvesting-storage", "Fruit Selection, Harvesting & Storage", 30, 32, "C"),
    ("juice-composition", "Juice Composition and the Components of Apple Juice", 33, 33, "C"),
    ("cider-microbiology", "Cider Microbiology", 34, 36, "C"),
    ("microbial-control", "Microbial Control — Building Design, Sanitization & SO₂", 37, 38, "C"),
    ("sulfur-dioxide", "Sulfur Dioxide in Cider Production", 39, 40, "C"),
    ("fermentation", "Fermentation", 41, 46, "C"),
    ("maturation-and-malolactic-fermentation", "Maturation & Malolactic Fermentation", 47, 48, "C"),
    ("perry-production", "Perry Production", 49, 49, "C"),
    ("downstream-processing-overview", "Final Processing & Packaging — Overview & Key Considerations", 50, 50, "D"),
    ("clarity-clarification-filtration", "Cider Clarity, Clarification & Filtration", 51, 53, "D"),
    ("blending-and-carbonation", "Blending & Carbonation", 54, 55, "D"),
    ("final-processing-packaging", "Final Processing & Packaging", 56, 58, "D"),
    ("quality-assurance-control", "Quality Assurance & Control in Cider Production", 59, 60, "E"),
    ("styles-of-cider-and-perry", "Styles of Cider and Perry", 61, 61, "F"),
    ("flavor-of-cider-and-perry", "The Flavor of Cider & Perry", 62, 63, "F"),
    ("sensory-analysis", "Sensory Analysis — Flavor Assessment Techniques", 64, 65, "F"),
    ("faults-in-cider-and-perry", "Faults in Cider & Perry — A Summary", 66, 69, "F"),
    ("responsible-appreciation", "The Responsible Appreciation of Cider and Perry", 70, 71, "F"),
    ("table-of-attributes", "Cider & Perry — Table of Attributes", 72, 77, "F"),
    ("organoleptic-profile-form", "Cider & Perry Organoleptic Profile Form", 78, 78, "F"),
    ("appendix-a-laboratory-techniques", "Appendix A — Key Laboratory Techniques", 79, 81, "App"),
    ("appendix-b-metric-units", "Appendix B — Metric Units and Conversion Chart", 82, 82, "App"),
    ("appendix-c-syllabus", "Appendix C — Foundation Certificate Syllabus", 83, 86, "App"),
]

GROUP_TITLES = {
    "A": "A. Background to Cider & Perry Production",
    "B": "B. Cider & Perry Production — An Overview",
    "C": "C. Making Cider & Perry — Stage One: Fruit Selection to Maturation",
    "D": "D. Making Cider & Perry — Stage Two: Final Processing & Packaging",
    "E": "E. Quality Assurance & Control in Cider Production",
    "F": "F. Cider and Perry — An Appreciation",
    "App": "Appendices",
}

# Subsection headings from the printed TOC — matched as standalone lines and
# promoted to ## headings.
SUB_HEADINGS = {
    "History of the Cider Industry",
    "Apple and Pear Origins",
    "Historical Development of Cider in North America",
    "Cider & Perry Production and Marketing — Legal Framework",
    "Excise and Cider & Perry Definitions & Standards",
    "USA Definitions",
    "Canadian Definitions",
    "Labelling",
    "Food Safety",
    "Legal Obligations in North America",
    "The Raw Materials - Cider Apples, Perry Pears & Orcharding",
    "The Fruit",
    "Cider Apple & Perry Pear Production in Europe",
    "Cider Apple & Perry Pear Production in North America",
    "Cider Apples and Perry Pears",
    "Cider Apple Orcharding",
    "Introduction",
    "Principles of Production",
    "Fruit Selection for Cider & Perry Production — Key Considerations",
    "Harvesting",
    "Fruit Storage",
    "Apple & Pear Juice Concentrate",
    "Juice Composition and the Components of Apple Juice",
    "Cider Microbiology",
    "Fundamentals of Microbiology",
    "Micro-organisms in Cider Production — An Overview",
    "Yeast species",
    "Bacteria",
    "Microbial Control",
    "Building Design",
    "Sanitization",
    "Sulfur Dioxide in Cider Production",
    "History and Background",
    "Use of Sulfur Dioxide",
    "Fermentation",
    "Overview",
    "Preparation of the Juice for Fermentation",
    "Potential Alcohol Production",
    "pH Control",
    "Yeast Selection, Use and Management",
    "Fermentation End & Racking",
    "Maturation",
    "Maturation Management",
    "Malo-Lactic Fermentation",
    "Non-Microbial Changes During Maturation",
    "Perry Production",
    "Overview",
    "Key Considerations",
    "Initial Downstream Processing",
    "Cider Clarity & Clarification",
    "Fining",
    "Centrifugation",
    "Filtration",
    "It's all in the Blending!",
    "The Blending Process",
    "Carbonation",
    "Final Processing & Packaging",
    "Cartridge Filtration",
    "In-Pack Microbiological Stability",
    "Sterile Filtration",
    "Pasteurization",
    "Packaging",
    "What is Quality?",
    "Laboratory Quality Control",
    "Microbiological Analysis",
    "Record Keeping",
    "Quality Assurance (QA)",
    "Styles of Cider and Perry",
    "The Flavor of Cider & Perry",
    "Flavor Assessment Techniques & Practices",
    "What is Sensory Analysis?",
    "Why carry out sensory analysis?",
    "Use of Sensory Analysis in Industry",
    "Implementation of Sensory Analysis",
    "Faults in Cider & Perry — A Summary",
    "The Responsible Appreciation of Cider and Perry",
    "USA — Standard Drinks",
    "Canada — Standard Drinks",
    "Alcohol & the Body",
    "Opportunities: 1. The Heritage of Cider & Perry",
    "Opportunities: 2. Market Place Trends & Adding Value",
    "Opportunities: 3. Cider & Perry with Food",
}

# Running headers repeated at the top of every body page — stripped as furniture.
RUNNING_HEADERS = {
    "Background to Cider & Perry Production",
    "Cider & Perry Production — An Overview",
    "Making Cider & Perry - Stage One: Fruit Selection to Maturation",
    "Making Cider & Perry - Stage Two: Final Processing & Packaging",
    "Quality Assurance & Control in Cider Production",
    "Cider and Perry — An Appreciation",
    "Key Laboratory Techniques",
    "Metric Units and Conversion Chart",
    "The Foundation Certificate in Cider and Perry Production",
    "THE CIDER & PERRY ACADEMY",
    "Cider & Perry Production — A Foundation",
    "Cider & Perry Production",
}

PAGE_OFFSET = 3  # book page N is PDF index N + 3


def clean_line(line: str) -> str:
    """Fix extraction artifacts in a single line."""
    # \x83 is the font's bullet glyph; U+2022 real bullets
    line = line.replace("\x83", "•")
    # Broken digraph ligatures: bare T or Y followed by lowercase word
    line = re.sub(r"\b([TY]) ([a-z]+)\b", r"\1\2", line)
    # Degree sign was extracted as 0/o: 400C → 40°C, 10.0o Brix → 10.0° Brix
    line = re.sub(r"(\d)0C\b", r"\1°C", line)
    line = re.sub(r"(\d\.?\d*)o (Brix|Baume)", r"\1° \2", line)
    line = line.replace("Degrees0", "Degrees°")
    # Normalize whitespace
    line = re.sub(r"[ \t]+", " ", line).strip()
    # Mid-line bullets (table cells like "Sight • Tannins") → dash
    line = re.sub(r"\s+•\s+", " — ", line)
    return line


def is_furniture(line: str) -> bool:
    if not line:
        return True
    if re.fullmatch(r"\d+", line):
        return True
    if line in RUNNING_HEADERS:
        return True
    if line.startswith("© Mitchell F&D Limited"):
        return True
    return False


def extract_pages(reader) -> dict:
    """Extract cleaned, furniture-stripped lines keyed by PDF page index."""
    pages = {}
    for idx in range(len(reader.pages)):
        raw = reader.pages[idx].extract_text() or ""
        lines = [clean_line(l) for l in raw.split("\n")]
        lines = [l for l in lines if not is_furniture(l)]
        pages[idx] = lines
    return pages


def norm_heading(s: str) -> str:
    """Normalize quotes/spacing so TOC headings match extracted lines."""
    return s.replace("’", "'").replace("‘", "'").replace("  ", " ").strip()


def lines_to_markdown(lines: list[str], title: str) -> str:
    """Convert cleaned lines to markdown: headings, bullets, paragraphs."""
    out = []
    para = []
    first_heading_done = False
    title_norm = norm_heading(title).lower()

    def flush():
        if para:
            out.append(" ".join(para))
            para.clear()

    for line in lines:
        if not line:
            flush()
            continue
        # Heading match (TOC subsection or ALL-CAPS section title)
        is_heading = norm_heading(line) in SUB_HEADINGS or re.fullmatch(
            r"[A-F]\. [A-Z0-9 ,&'()—:;-]+", line
        )
        if is_heading:
            flush()
            # Skip the first heading if it just repeats the file title
            if not first_heading_done and norm_heading(line).lower() == title_norm:
                first_heading_done = True
                continue
            first_heading_done = True
            t = line[0] + line[1:].lower() if re.match(r"^[A-F]\. ", line) else line
            out.append(f"\n## {t}\n")
        elif line.startswith("•"):
            flush()
            out.append(f"- {line.lstrip('• ').strip()}")
        else:
            para.append(line)
    flush()
    return "\n\n".join(out)


def main():
    from pypdf import PdfReader

    reader = PdfReader(str(PDF_PATH))
    pages = extract_pages(reader)
    VAULT_DIR.mkdir(parents=True, exist_ok=True)

    files = []
    for slug, title, start, end, group in SECTIONS:
        lines = []
        for book_page in range(start, end + 1):
            lines.extend(pages.get(book_page + PAGE_OFFSET, []))
            lines.append("")  # page boundary = paragraph boundary
        body = lines_to_markdown(lines, title)

        header = f"# {title}\n\n"
        header += (
            f"> Source: Peter Mitchell, *Cider & Perry Production — A Foundation* "
            f"(2nd ed., 2021), Cider Institute of North America. "
            f"{GROUP_TITLES[group]}, pages {start}–{end}.\n\n"
        )
        path = VAULT_DIR / f"{slug}.md"
        path.write_text(header + body + "\n", encoding="utf-8")
        files.append((group, slug, title, start, end))
        print(f"  ✓ {slug}.md  (book p{start}–{end}, {len(body)} chars)")

    # ── index.md ──
    idx = ["# Foundation Textbook — Cider & Perry Production: A Foundation", ""]
    idx.append(
        "> The official textbook for the Foundation Certificate in Cider and Perry "
        "Production, by Peter Mitchell (Second Edition, 2021). Published by the "
        "Cider Institute of North America."
    )
    idx.append("")
    current_group = None
    for group, slug, title, start, end in files:
        if group != current_group:
            idx.append(f"\n## {GROUP_TITLES[group]}\n")
            current_group = group
        idx.append(f"- [{title}](/vault/foundation-textbook/{slug}.md) — pages {start}–{end}")
    idx.append("")
    (VAULT_DIR / "index.md").write_text("\n".join(idx), encoding="utf-8")
    print("  ✓ index.md")

    print(f"\n✅ Done. {len(files)} sections + index in {VAULT_DIR}")


if __name__ == "__main__":
    main()

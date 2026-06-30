#!/usr/bin/env python3
"""
Standalone video transcription script for the Cider Institute Knowledge Library.
Can be run on the VPS or locally. Requires: pip install openai-whisper

Usage:
  python ingest/transcribe_video.py video.mp4 "Video Title" "Source Description" vault/topic/

Output:
  Creates a markdown file in the specified vault directory.
"""

import sys
import time
from pathlib import Path

import whisper


def transcribe(video_path: str, model_size: str = "tiny") -> str:
    """Transcribe a video file using OpenAI Whisper."""
    vpath = Path(video_path)
    if not vpath.exists():
        raise FileNotFoundError(f"Video not found: {video_path}")

    size_mb = vpath.stat().st_size / (1024 * 1024)
    print(f"📹 {vpath.name} ({size_mb:.0f} MB)")

    t0 = time.time()
    print(f"Loading whisper model '{model_size}'...")
    model = whisper.load_model(model_size)
    print(f"   Loaded in {time.time() - t0:.0f}s")

    t0 = time.time()
    print("Transcribing...")
    result = model.transcribe(str(vpath), language="en")
    elapsed = time.time() - t0

    words = len(result["text"].split())
    print(f"   Done in {elapsed:.0f}s — {words} words")

    return result["text"]


def transcript_to_markdown(transcript: str, title: str, source: str) -> str:
    """Convert raw transcript to markdown."""
    md = f"# {title}\n\n"
    md += f"> Source: {source}\n\n"
    md += "## Transcript\n\n"

    # Split into paragraphs at sentence boundaries
    paragraphs = transcript.replace(". ", ".\n\n").split("\n\n")
    for para in paragraphs:
        p = para.strip()
        if p:
            # Ensure it ends with punctuation
            if p[-1] not in ".!?":
                p += "."
            md += p + "  \n"

    return md


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        print("Arguments: <video_path> <title> <source> <output_dir> [model_size]")
        sys.exit(1)

    video_path = sys.argv[1]
    title = sys.argv[2]
    source = sys.argv[3]
    output_dir = Path(sys.argv[4])
    model_size = sys.argv[5] if len(sys.argv) > 5 else "tiny"

    # Transcribe
    transcript = transcribe(video_path, model_size)

    # Convert to markdown
    md = transcript_to_markdown(transcript, title, source)

    # Save
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = title.lower().replace(" ", "-").replace("/", "-")[:80] + ".md"
    output_path = output_dir / filename
    output_path.write_text(md, encoding="utf-8")

    print(f"\n✅ Saved: {output_path}")
    print(f"   {len(transcript.split())} words → {len(md)} chars markdown")


if __name__ == "__main__":
    main()

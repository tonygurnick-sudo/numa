#!/usr/bin/env python3
"""build_styled_doc.py — branded, diacritic-safe DOCX from a JSON spec.

GENERIC HELPER (docx-handling skill). Produces a clean Numa-styled Word doc with
a font that preserves macrons/accents (Calibri — universally available wherever
the user opens the file), purple headings, and image/table helpers. Use it so
te reo Māori and accented names survive ("Te Whetū", not "Te Whetu"), and so you
don't re-hand-roll styling each time.

Usage:
  python3 build_styled_doc.py --spec @/workdir/tmp/doc.json
  python3 build_styled_doc.py --spec '{"title":"Report","out":"/workdir/outputs/r.docx","blocks":[...]}'

Spec blocks:
  {"type":"heading","level":1,"text":"..."}
  {"type":"paragraph","text":"..."}
  {"type":"bullets","items":["a","b"]}
  {"type":"image","path":"/workdir/outputs/chart.png","width_in":6.0,"caption":"..."}
  {"type":"table","headers":["A","B"],"rows":[["1","2"]]}
"""

import argparse
import json
import sys
from pathlib import Path

from docx import Document
from docx.shared import Inches, Pt, RGBColor

PURPLE = RGBColor(0x99, 0x49, 0xAC)
CHARCOAL = RGBColor(0x32, 0x32, 0x32)
BODY_FONT = "Calibri"  # has full Latin Extended-A (macrons) and is everywhere


def _set_base_font(doc):
    style = doc.styles["Normal"]
    style.font.name = BODY_FONT
    style.font.size = Pt(11)
    style.font.color.rgb = CHARCOAL


def _heading(doc, text, level):
    h = doc.add_heading("", level=max(1, min(level, 4)))
    run = h.add_run(text)  # add_run preserves the exact Unicode (no ASCII folding)
    run.font.name = BODY_FONT
    run.font.color.rgb = PURPLE
    run.font.size = Pt({1: 20, 2: 16, 3: 14, 4: 12}.get(level, 14))
    run.font.bold = True
    return h


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--spec", required=True, help="inline JSON or @file")
    args = p.parse_args()

    raw = args.spec
    if raw.startswith("@"):
        raw = Path(raw[1:]).read_text(encoding="utf-8")
    spec = json.loads(raw)
    out = spec.get("out", "/workdir/outputs/document.docx")
    Path(out).parent.mkdir(parents=True, exist_ok=True)

    doc = Document()
    _set_base_font(doc)
    if spec.get("title"):
        _heading(doc, spec["title"], 1)

    for block in spec.get("blocks", []):
        bt = block.get("type")
        if bt == "heading":
            _heading(doc, block.get("text", ""), block.get("level", 2))
        elif bt == "paragraph":
            doc.add_paragraph(block.get("text", ""))
        elif bt == "bullets":
            for item in block.get("items", []):
                doc.add_paragraph(str(item), style="List Bullet")
        elif bt == "image":
            img = block.get("path")
            if img and Path(img).exists():
                doc.add_picture(img, width=Inches(block.get("width_in", 6.0)))
                if block.get("caption"):
                    cap = doc.add_paragraph(block["caption"])
                    cap.runs[0].italic = True
                    cap.runs[0].font.size = Pt(9)
            else:
                doc.add_paragraph(f"[image missing: {img}]")
        elif bt == "table":
            headers = block.get("headers", [])
            rows = block.get("rows", [])
            if headers:
                t = doc.add_table(rows=1, cols=len(headers))
                t.style = "Light Grid Accent 1"
                for i, htext in enumerate(headers):
                    cell = t.rows[0].cells[i]
                    cell.text = str(htext)
                    for r in cell.paragraphs[0].runs:
                        r.font.bold = True
                for row in rows:
                    cells = t.add_row().cells
                    for i, val in enumerate(row[: len(headers)]):
                        cells[i].text = str(val)
        else:
            print(f"WARNING: unknown block type {bt!r}", file=sys.stderr)

    doc.save(out)
    print(f"Wrote document: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

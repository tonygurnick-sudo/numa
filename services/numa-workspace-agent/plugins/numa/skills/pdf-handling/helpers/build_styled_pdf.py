#!/usr/bin/env python3
"""build_styled_pdf.py — branded, Unicode-safe PDF from a JSON spec (WeasyPrint).

GENERIC HELPER (pdf-handling skill). Builds a clean Numa-styled PDF with:
  - DejaVu Sans baked in, so macrons/accents (ā ē ī ō ū) render — no tofu boxes,
    no Latin-1 dropping (the failure mode of bare reportlab/fpdf2).
  - Static image embedding via <img>. Charts MUST be pre-rendered PNGs (use
    make_chart.py) — WeasyPrint does not execute JavaScript, so Chart.js/canvas
    never appears. Reference the PNG via an "image" block.

Usage:
  python3 build_styled_pdf.py --spec @/workdir/tmp/report.json
  python3 build_styled_pdf.py --spec '{"title":"Report","out":"/workdir/outputs/r.pdf","blocks":[...]}'

Spec blocks: heading{level,text} | paragraph{text} | bullets{items} |
             image{path,caption} | table{headers,rows} | highlight{text}
"""

import argparse
import html
import json
import sys
from pathlib import Path

CSS = """
@page { size: A4; margin: 2cm; }
* { font-family: 'DejaVu Sans', 'Calibri', sans-serif; }
body { color: #323232; font-size: 11pt; line-height: 1.5; }
h1 { color: #9949AC; font-size: 22pt; border-bottom: 2px solid #9949AC; padding-bottom: 6px; }
h2 { color: #9949AC; font-size: 16pt; margin-top: 22px; }
h3 { color: #1F1F1F; font-size: 13pt; }
ul { margin: 8px 0 8px 18px; }
li { margin: 4px 0; }
table { width: 100%; border-collapse: collapse; margin: 14px 0; }
th { background: #9949AC; color: #fff; padding: 8px 10px; text-align: left; font-size: 10pt; }
td { padding: 7px 10px; border-bottom: 1px solid #E5E5E5; }
tr:nth-child(even) td { background: #F7F5F1; }
img { max-width: 100%; }
.caption { font-size: 9pt; font-style: italic; color: #323232; margin-top: 2px; }
.highlight { background: #DFBDE7; border-left: 4px solid #9949AC; padding: 10px 14px; margin: 14px 0; }
"""


def _esc(s) -> str:
    return html.escape(str(s))


def _block_html(b) -> str:
    bt = b.get("type")
    if bt == "heading":
        lvl = max(1, min(b.get("level", 2), 3))
        return f"<h{lvl}>{_esc(b.get('text', ''))}</h{lvl}>"
    if bt == "paragraph":
        return f"<p>{_esc(b.get('text', ''))}</p>"
    if bt == "highlight":
        return f"<div class='highlight'>{_esc(b.get('text', ''))}</div>"
    if bt == "bullets":
        items = "".join(f"<li>{_esc(i)}</li>" for i in b.get("items", []))
        return f"<ul>{items}</ul>"
    if bt == "image":
        path = b.get("path", "")
        if path and Path(path).exists():
            cap = (
                f"<div class='caption'>{_esc(b['caption'])}</div>"
                if b.get("caption")
                else ""
            )
            return f"<img src='file://{path}'/>{cap}"
        return f"<p style='color:#EF4444'>[image missing: {_esc(path)}]</p>"
    if bt == "table":
        headers = b.get("headers", [])
        rows = b.get("rows", [])
        head = "".join(f"<th>{_esc(h)}</th>" for h in headers)
        body = "".join(
            "<tr>" + "".join(f"<td>{_esc(c)}</td>" for c in row) + "</tr>"
            for row in rows
        )
        return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"
    print(f"WARNING: unknown block type {bt!r}", file=sys.stderr)
    return ""


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--spec", required=True, help="inline JSON or @file")
    args = p.parse_args()

    raw = args.spec
    if raw.startswith("@"):
        raw = Path(raw[1:]).read_text(encoding="utf-8")
    spec = json.loads(raw)
    out = spec.get("out", "/workdir/outputs/document.pdf")
    Path(out).parent.mkdir(parents=True, exist_ok=True)

    parts = []
    if spec.get("title"):
        parts.append(f"<h1>{_esc(spec['title'])}</h1>")
    for block in spec.get("blocks", []):
        parts.append(_block_html(block))

    doc_html = f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{''.join(parts)}</body></html>"

    from weasyprint import HTML

    HTML(string=doc_html).write_pdf(out)
    print(f"Wrote PDF: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

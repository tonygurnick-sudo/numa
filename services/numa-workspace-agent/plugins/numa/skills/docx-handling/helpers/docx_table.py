#!/usr/bin/env python3
"""docx_table.py — robust, styled DOCX table from headers + rows.

GENERIC HELPER (docx-handling skill). Builds a clean Numa-styled Word table
without hand-rolling python-docx row-fill code. Every row is padded/truncated
to the header count, so a row with too few cells can NEVER silently leave a
column blank — the exact failure that burned ~13 self-debug iterations in a
benchmark (a hand-rolled add-row helper passed 3 of 4 columns). Supports
multi-line cells (newlines become separate lines in the cell), optional column
widths, and a diacritic-safe font so macrons/accents survive ("Te Whetū").

Append a table to a document you're already building with --into (so it works
with in-place edits — don't regenerate the whole doc), or write a fresh
one-table doc with --out.

Why it exists (from benchmark findings):
  - Models hand-roll an add-row helper, pass too few cells for the header
    count, and ship (or slowly self-debug) a table with a blank column. This
    pads short rows and truncates long ones, then tells you it did.
  - Re-deriving table styling each time is slow and inconsistent — this gives
    bold purple headers + a grid style for free.

Usage:
  # Fresh single-table document
  python3 docx_table.py --out /workdir/outputs/risks.docx \
      --headers '["Risk","Likelihood","Impact","Mitigation"]' \
      --rows '[["Data loss","Low","High","Nightly backups + restore drill"],
               ["Vendor lock-in","Med","Med","Abstract the provider API"]]'

  # Append a table (under a heading) to an existing report you're editing
  python3 docx_table.py --into /workdir/outputs/report.docx --heading "Risk register" \
      --headers @/workdir/tmp/headers.json --rows @/workdir/tmp/rows.json

  --headers / --rows accept inline JSON or @/path/to/file.json
  --rows is a JSON array of arrays (one inner array per row). Short rows are
  padded with empty cells, long rows are truncated, and a NOTE is printed for
  each — so a column is never silently dropped.
  --widths is optional JSON: {"Risk":2.0,"Mitigation":2.5} or [2.0,1.0,1.0,2.5] (inches).
"""

import argparse
import json
import sys
from pathlib import Path

from docx import Document
from docx.shared import Inches, Pt, RGBColor

PURPLE = RGBColor(0x99, 0x49, 0xAC)
CHARCOAL = RGBColor(0x32, 0x32, 0x32)
BODY_FONT = "Calibri"  # full Latin Extended-A (macrons) and available everywhere
DEFAULT_STYLE = "Light Grid Accent 1"


def _load_json(raw: str):
    """Inline JSON or @/path/to/file.json — matches the other skill helpers."""
    if raw.startswith("@"):
        raw = Path(raw[1:]).read_text(encoding="utf-8")
    return json.loads(raw)


def _set_cell(cell, value, *, bold=False, color=CHARCOAL):
    """Write a cell, rendering newlines as separate lines and preserving the
    exact Unicode (add_run, never `.text =`, so macrons/accents survive)."""
    lines = str(value).split("\n")
    for i, line in enumerate(lines):
        # Fresh cells have one empty paragraph with no runs — reuse it for line 0.
        para = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
        run = para.add_run(line)
        run.font.name = BODY_FONT
        run.font.color.rgb = color
        run.font.bold = bold


def _normalise_rows(rows, ncols):
    """Pad short rows / truncate long rows to exactly ncols. Returns
    (normalised_rows, n_padded, n_truncated) so the caller can report."""
    out, padded, truncated = [], 0, 0
    for row in rows:
        cells = list(row)
        if len(cells) < ncols:
            padded += 1
            cells = cells + [""] * (ncols - len(cells))
        elif len(cells) > ncols:
            truncated += 1
            cells = cells[:ncols]
        out.append(cells)
    return out, padded, truncated


def build_table(doc, headers, rows, *, widths=None, style=DEFAULT_STYLE):
    """Add a styled table (1 header row + len(rows) body rows) to `doc`.
    Returns (table, n_padded, n_truncated)."""
    ncols = len(headers)
    norm, padded, truncated = _normalise_rows(rows, ncols)

    table = doc.add_table(rows=1, cols=ncols)
    try:
        table.style = style
    except KeyError:
        table.style = "Table Grid"  # always present in the default template

    for i, htext in enumerate(headers):
        _set_cell(table.rows[0].cells[i], htext, bold=True, color=PURPLE)

    for row in norm:
        cells = table.add_row().cells
        for i, val in enumerate(row):
            _set_cell(cells[i], val)

    if widths:
        table.autofit = False
        for i in range(ncols):
            w = None
            if isinstance(widths, dict):
                w = widths.get(headers[i])
            elif isinstance(widths, list) and i < len(widths):
                w = widths[i]
            if w:
                for r in table.rows:
                    r.cells[i].width = Inches(float(w))

    return table, padded, truncated


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--headers", help="inline JSON array or @file")
    p.add_argument("--rows", help="inline JSON array-of-arrays or @file")
    p.add_argument("--out", help="write a fresh one-table .docx here")
    p.add_argument("--into", help="append the table to this existing .docx")
    p.add_argument("--heading", default="", help="optional heading above the table")
    p.add_argument(
        "--widths", default="", help='JSON: {"Col":2.0} or [2.0,1.5] (inches)'
    )
    p.add_argument("--style", default=DEFAULT_STYLE, help="python-docx table style")
    p.add_argument(
        "--selftest", action="store_true", help="run an internal check and exit"
    )
    args = p.parse_args()

    if args.selftest:
        return _selftest()

    if not args.headers or not args.rows:
        print("ERROR: --headers and --rows are required", file=sys.stderr)
        return 2
    if not args.out and not args.into:
        print(
            "ERROR: pass --out (new doc) or --into (append to existing)",
            file=sys.stderr,
        )
        return 2

    headers = _load_json(args.headers)
    rows = _load_json(args.rows)
    widths = _load_json(args.widths) if args.widths else None
    if not isinstance(headers, list) or not headers:
        print("ERROR: --headers must be a non-empty JSON array", file=sys.stderr)
        return 2
    if not isinstance(rows, list):
        print("ERROR: --rows must be a JSON array of arrays", file=sys.stderr)
        return 2

    appending = bool(args.into and Path(args.into).exists())
    path = args.into or args.out
    doc = Document(args.into) if appending else Document()
    Path(path).parent.mkdir(parents=True, exist_ok=True)

    # Base the font on a fresh doc so headings/body match the other helpers.
    if not appending:
        normal = doc.styles["Normal"]
        normal.font.name = BODY_FONT
        normal.font.size = Pt(11)
        normal.font.color.rgb = CHARCOAL

    if args.heading:
        h = doc.add_heading("", level=2)
        run = h.add_run(args.heading)
        run.font.name = BODY_FONT
        run.font.color.rgb = PURPLE
        run.font.bold = True

    _table, padded, truncated = build_table(
        doc, headers, rows, widths=widths, style=args.style
    )
    doc.save(path)

    print(f"Wrote table ({len(rows)} rows x {len(headers)} cols): {path}")
    if padded:
        print(
            f"NOTE: padded {padded} short row(s) to {len(headers)} columns "
            "(missing cells left empty — check the source rows)."
        )
    if truncated:
        print(
            f"NOTE: truncated {truncated} over-long row(s) to {len(headers)} columns."
        )
    return 0


def _selftest() -> int:
    """Build a table from deliberately ragged rows and assert no column is
    silently dropped (the bug class this helper exists to prevent)."""
    import tempfile

    headers = ["Risk", "Likelihood", "Impact", "Mitigation"]
    rows = [
        ["Data loss", "Low", "High", "Nightly backups"],  # full
        ["Vendor lock-in", "Med", "Med"],  # short — must pad, not blank-drop
        ["Scope creep", "High", "High", "Change control", "EXTRA"],  # long — truncate
        ["Multi\nline", "Low", "Low", "Wrap\nacross lines"],  # multi-line cells
    ]
    with tempfile.TemporaryDirectory() as d:
        out = str(Path(d) / "selftest.docx")
        doc = Document()
        _table, padded, truncated = build_table(doc, headers, rows)
        doc.save(out)
        reopened = Document(out)
        t = reopened.tables[0]
        assert len(t.columns) == 4, f"expected 4 cols, got {len(t.columns)}"
        assert len(t.rows) == 1 + len(rows), "row count mismatch"
        # The padded row must still expose 4 cells (3 filled + 1 empty),
        # NOT a structurally missing column.
        padded_row = t.rows[2].cells
        assert len(padded_row) == 4 and padded_row[3].text == "", "pad failed"
        assert padded == 1 and truncated == 1, (padded, truncated)
    print("docx_table selftest: OK (ragged rows padded/truncated, no dropped columns)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

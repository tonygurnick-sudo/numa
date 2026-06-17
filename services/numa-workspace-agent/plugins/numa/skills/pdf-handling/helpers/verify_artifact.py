#!/usr/bin/env python3
"""verify_artifact.py — check that a produced file actually has what you claimed.

GENERIC, OPTIONAL HELPER (lives with pdf-handling; works for PDF / DOCX / PPTX).
Not every deliverable needs verification — but when you've just claimed an
artifact "has the revenue chart" or "uses the navy brand colour" and you can't
natively see it, this confirms it cheaply before you tell the user it's done.

It reports: embedded image count, whether colour is actually used (not just
black/white), and whether expected text/strings are present. Exits non-zero if
any `--expect-*` assertion fails, so you can gate on it.

Usage:
  python3 verify_artifact.py /workdir/outputs/report.pdf \
      --expect-images 1 --expect-text "Quarterly" "ū" --expect-colour

  python3 verify_artifact.py /workdir/outputs/deck.pptx --expect-images 3
"""

import argparse
import subprocess
import sys
import zipfile
from pathlib import Path


def _pdf_stats(path):
    images = colour = None
    text = ""
    try:
        import fitz  # PyMuPDF — richest path

        doc = fitz.open(path)
        images = sum(len(pg.get_images()) for pg in doc)
        text = "".join(pg.get_text() for pg in doc)
        # Colour: any image, or any non-gray drawing fill/stroke.
        colour = images > 0
        for pg in doc:
            for d in pg.get_drawings():
                for key in ("fill", "color"):
                    c = d.get(key)
                    if c and len(set(round(v, 3) for v in c)) > 1:
                        colour = True
        doc.close()
        return images, colour, text
    except ImportError:
        pass
    # Fallback to poppler CLIs (present in the container).
    try:
        out = subprocess.run(
            ["pdfimages", "-list", path], capture_output=True, text=True
        )
        images = max(0, len(out.stdout.strip().splitlines()) - 2)  # minus header rows
    except FileNotFoundError:
        images = None
    try:
        text = subprocess.run(
            ["pdftotext", path, "-"], capture_output=True, text=True
        ).stdout
    except FileNotFoundError:
        text = ""
    return images, (images or 0) > 0 if images is not None else None, text


def _zip_media_count(path, prefix):
    with zipfile.ZipFile(path) as z:
        return sum(
            1
            for n in z.namelist()
            if n.startswith(prefix) and "." in n.rsplit("/", 1)[-1]
        )


def _docx_stats(path):
    images = _zip_media_count(path, "word/media/")
    text = ""
    try:
        import docx

        text = "\n".join(p.text for p in docx.Document(path).paragraphs)
    except ImportError:
        pass
    return images, images > 0, text


def _pptx_stats(path):
    images = _zip_media_count(path, "ppt/media/")
    # Colour: any explicit srgbClr in slide XML.
    colour = False
    text_parts = []
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if n.startswith("ppt/slides/slide") and n.endswith(".xml"):
                xml = z.read(n).decode("utf-8", "ignore")
                if "srgbClr" in xml:
                    colour = True
    try:
        import pptx

        prs = pptx.Presentation(path)
        for slide in prs.slides:
            for shape in slide.shapes:
                if shape.has_text_frame:
                    text_parts.append(shape.text_frame.text)
    except ImportError:
        pass
    return images, colour or images > 0, "\n".join(text_parts)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("path")
    p.add_argument(
        "--expect-images",
        type=int,
        default=None,
        help="fail if fewer than N embedded images",
    )
    p.add_argument(
        "--expect-text",
        nargs="*",
        default=[],
        help="fail if any of these strings is missing",
    )
    p.add_argument(
        "--expect-colour", action="store_true", help="fail if the file uses no colour"
    )
    args = p.parse_args()

    path = Path(args.path)
    if not path.exists():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        return 2

    ext = path.suffix.lower()
    if ext == ".pdf":
        images, colour, text = _pdf_stats(str(path))
    elif ext == ".docx":
        images, colour, text = _docx_stats(str(path))
    elif ext == ".pptx":
        images, colour, text = _pptx_stats(str(path))
    else:
        print(f"ERROR: unsupported type {ext} (pdf/docx/pptx only)", file=sys.stderr)
        return 2

    print(f"File: {path.name}")
    print(f"  embedded images: {images if images is not None else 'unknown'}")
    print(f"  uses colour:     {colour if colour is not None else 'unknown'}")
    print(f"  text length:     {len(text):,} chars")

    failures = []
    if args.expect_images is not None and (images or 0) < args.expect_images:
        failures.append(f"expected >= {args.expect_images} images, found {images}")
    for needle in args.expect_text:
        if needle not in text:
            failures.append(f"missing expected text: {needle!r}")
    if args.expect_colour and not colour:
        failures.append("expected colour, found none")

    if failures:
        print("\nFAILED:")
        for f in failures:
            print(f"  ✗ {f}")
        return 1
    print("\n✓ all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

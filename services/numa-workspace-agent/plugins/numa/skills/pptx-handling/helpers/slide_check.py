#!/usr/bin/env python3
"""slide_check.py — validate a .pptx for off-slide shapes and tiny fonts.

GENERIC HELPER (pptx-handling skill). Opens a deck and reports every shape that
runs off the slide (left/top below the edge, or right/bottom past it) plus any
text below a readable size. Run it after building a deck: it catches the
overflow that makes slides look "compressed / falling off screen" — and it works
in-container, so it catches the problem EVEN WHEN the convert-to-PDF visual QA
can't run. Exit code 1 if any problem is found, so you can gate on it.

What it flags (the exact failures from benchmark testing):
  - a footer / shape placed below the slide bottom edge
  - an embedded dashboard image taller than the slide (not scaled to fit)
  - a table or block that overflows because the slide is over-stuffed
  - sub-12pt text (unreadable), and a non-16:9 canvas

Usage:
  python3 slide_check.py /workdir/outputs/deck.pptx
  python3 slide_check.py /workdir/outputs/deck.pptx --min-font 12 --margin 0.3
"""

import argparse
import sys

from pptx import Presentation

EMU = 914400.0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("path", help="path to the .pptx")
    ap.add_argument(
        "--min-font", type=float, default=12.0, help="flag text smaller than this (pt)"
    )
    ap.add_argument(
        "--margin",
        type=float,
        default=0.0,
        help="required safe margin from each edge (inches)",
    )
    args = ap.parse_args()

    prs = Presentation(args.path)
    SW, SH = prs.slide_width / EMU, prs.slide_height / EMU
    m = args.margin
    problems = 0
    print(f"Slide size: {SW:.2f} x {SH:.2f} in  ({len(prs.slides)} slides)")
    if abs(SW / SH - 16 / 9) > 0.05:
        print(
            f"  NOTE: aspect {SW / SH:.2f} is not 16:9 — set 13.333 x 7.5 in for "
            "modern 16:9 (more vertical room)."
        )

    for si, slide in enumerate(prs.slides, 1):
        for sh in slide.shapes:
            if sh.left is None or sh.top is None:
                continue
            l, t = sh.left / EMU, sh.top / EMU
            w = (sh.width or 0) / EMU
            h = (sh.height or 0) / EMU
            flags = []
            if l < m - 0.02:
                flags.append(f"left {l:.2f} < {m:.2f}")
            if t < m - 0.02:
                flags.append(f"top {t:.2f} < {m:.2f}")
            if l + w > SW - m + 0.02:
                flags.append(
                    f"right {l + w:.2f} > {SW - m:.2f} (off by {l + w - (SW - m):.2f})"
                )
            if t + h > SH - m + 0.02:
                flags.append(
                    f"bottom {t + h:.2f} > {SH - m:.2f} (off by {t + h - (SH - m):.2f})"
                )
            tiny = set()
            if sh.has_text_frame:
                for p in sh.text_frame.paragraphs:
                    sizes = [r.font.size.pt for r in p.runs if r.font.size]
                    if p.font.size:
                        sizes.append(p.font.size.pt)
                    tiny.update(round(s, 1) for s in sizes if s < args.min_font)
            if flags or tiny:
                problems += 1
                label = (
                    sh.text_frame.text[:32].replace("\n", " ")
                    if sh.has_text_frame and sh.text_frame.text.strip()
                    else str(sh.shape_type)
                )
                msg = f"  WARN slide {si} [{sh.name}] {label!r}"
                if flags:
                    msg += "  OFF-SLIDE: " + "; ".join(flags)
                if tiny:
                    msg += f"  TINY-FONT: {sorted(tiny)}pt"
                print(msg)

    if problems:
        print(
            f"\n{problems} issue(s). Fix overflow (scale images to fit, move shapes "
            f"into the safe area, split over-stuffed slides) and bump fonts to "
            f">= {args.min_font:.0f}pt, then re-run."
        )
        return 1
    print("\nOK — every shape is within the slide and no text is below the minimum.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

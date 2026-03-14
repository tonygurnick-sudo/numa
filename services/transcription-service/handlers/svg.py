"""SVG extraction via cairosvg → PNG → vision pipeline."""

import io
import os
import tempfile

import cairosvg


def svg_to_png_bytes(file_path: str) -> bytes:
    """Convert SVG to PNG bytes using cairosvg."""
    with open(file_path, "rb") as f:
        svg_data = f.read()
    return cairosvg.svg2png(bytestring=svg_data, output_width=2048)

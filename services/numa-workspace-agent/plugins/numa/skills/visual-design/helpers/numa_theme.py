#!/usr/bin/env python3
"""numa_theme.py — the Numa brand design tokens, in one place.

GENERIC HELPER (visual-design skill). Single source of truth for Numa's brand
colours, fonts, and spacing, so charts, decks, dashboards, and reports all match
instead of each one re-inventing a palette. Import it from a chart/render
script, or run it to print the tokens.

This is the DEFAULT brand. If the user already has their OWN brand — stated in
chat, saved in memory, or present in a file you're editing — build a brand.json
and pass it to load_palette() / --palette so their colours and fonts win. See
the visual-design skill's "Whose design system?" precedence rules first.

Use from a matplotlib script:
    import sys
    sys.path.insert(0, "/app/plugins/numa/skills/visual-design/helpers")
    import numa_theme
    numa_theme.apply_matplotlib()           # brand fonts, colours, clean axes
    # ...plot using numa_theme.CHART_COLORS...

Override with a user's brand:
    pal = numa_theme.load_palette("/workdir/tmp/brand.json")
    numa_theme.apply_matplotlib(pal)

Run it to see the tokens:
    python3 numa_theme.py                 # human-readable
    python3 numa_theme.py --json          # machine-readable
    python3 numa_theme.py --emit-css      # the :root CSS variables for HTML
    python3 numa_theme.py --palette b.json # preview a user's brand
"""

import argparse
import json
import sys

# ── Numa brand tokens (the default) ─────────────────────────────────────────
COLORS = {
    "primary": "#9949AC",  # Numa purple — headings, CTAs, active states
    "primary_light": "#DFBDE7",  # hover tints, badges, pill highlights
    "primary_dark": "#7D3490",  # purple hover/pressed
    "teal": "#1F4B5E",  # secondary accent, dark sections, banners
    "charcoal": "#1F1F1F",  # dark backgrounds, footers, sidebars
    "charcoal_light": "#323232",  # body text (NOT pure black)
    "warm_bg": "#F7F5F1",  # section/card backgrounds, alternating rows
    "white": "#FFFFFF",
    "black": "#000000",  # h3/h4 headings on light bg, hairline borders
    "success": "#22C55E",
    "error": "#EF4444",
}

# Categorical chart cycle — purple-led, meaning-first (group by category, don't
# rainbow through colours). Reserve success/error green/red for those meanings.
CHART_COLORS = ["#9949AC", "#1F4B5E", "#DFBDE7", "#22C55E", "#323232", "#EF4444"]

FONTS = {
    "display": "Figtree",  # headings — free on Google Fonts
    "body": "Inter",  # body/UI — open substitute for asknuma's Axiforma
    # Server-side artifacts (matplotlib / WeasyPrint PDF / pptx) fall back to an
    # installed font when the brand fonts aren't bundled in the container.
    "server_fallback": "DejaVu Sans",
}

SPACING = {"xs": 4, "sm": 8, "md": 16, "lg": 24, "xl": 40, "2xl": 64, "3xl": 96}
RADII = {"sm": 4, "md": 8, "lg": 16, "pill": 999}
SHADOWS = {
    "sm": "0 1px 4px rgba(0,0,0,0.06)",
    "md": "0 2px 12px rgba(0,0,0,0.08)",
    "lg": "0 8px 32px rgba(0,0,0,0.12)",
}


def load_palette(path):
    """Merge a user's brand.json over the Numa defaults; return {colors,
    chart_colors, fonts}. brand.json may set any subset:

        {"colors": {"primary": "#0A2540", "charcoal_light": "#222"},
         "chart_colors": ["#0A2540", "#00B894", "#F39C12"],
         "fonts": {"display": "Georgia", "body": "Georgia"}}
    """
    with open(path, encoding="utf-8") as f:
        brand = json.load(f)
    colors = {**COLORS, **(brand.get("colors") or {})}
    fonts = {**FONTS, **(brand.get("fonts") or {})}
    chart = brand.get("chart_colors") or CHART_COLORS
    return {"colors": colors, "chart_colors": chart, "fonts": fonts}


def _resolve(palette):
    if palette is None:
        return {"colors": COLORS, "chart_colors": CHART_COLORS, "fonts": FONTS}
    return palette


def apply_matplotlib(palette=None):
    """Style matplotlib globally with the (Numa or brand) tokens: brand font,
    charcoal text, the categorical colour cycle, and clean axes (no top/right
    spines, soft grid). Call once before plotting. Returns the resolved palette."""
    import matplotlib as mpl
    from cycler import cycler

    p = _resolve(palette)
    text = p["colors"].get("charcoal_light", "#323232")
    fam = [
        p["fonts"].get("body"),
        p["fonts"].get("display"),
        p["fonts"].get("server_fallback", "DejaVu Sans"),
        "sans-serif",
    ]
    mpl.rcParams.update(
        {
            "font.family": "sans-serif",
            "font.sans-serif": [f for f in fam if f],
            "text.color": text,
            "axes.labelcolor": text,
            "axes.edgecolor": text,
            "axes.titlecolor": text,
            "xtick.color": text,
            "ytick.color": text,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": True,
            "grid.color": "#E7E5DF",
            "grid.linewidth": 0.6,
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "axes.prop_cycle": cycler(color=p["chart_colors"]),
        }
    )
    return p


def emit_css(palette=None):
    """Return the :root CSS-variables block for HTML artifacts."""
    p = _resolve(palette)
    out = [":root {"]
    for k, v in p["colors"].items():
        out.append(f"  --color-{k.replace('_', '-')}: {v};")
    out.append(f"  --font-display: '{p['fonts'].get('display')}', sans-serif;")
    out.append(f"  --font-body: '{p['fonts'].get('body')}', sans-serif;")
    for k, v in SPACING.items():
        out.append(f"  --space-{k}: {v}px;")
    for k, v in RADII.items():
        out.append(f"  --radius-{k}: {v}px;")
    for k, v in SHADOWS.items():
        out.append(f"  --shadow-{k}: {v};")
    out.append("}")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--json", action="store_true", help="print tokens as JSON")
    ap.add_argument("--emit-css", action="store_true", help="print the :root CSS")
    ap.add_argument("--palette", help="brand.json to merge over the Numa defaults")
    args = ap.parse_args()

    palette = load_palette(args.palette) if args.palette else None
    if args.emit_css:
        print(emit_css(palette))
        return 0
    p = _resolve(palette)
    if args.json:
        print(
            json.dumps(
                {
                    "colors": p["colors"],
                    "chart_colors": p["chart_colors"],
                    "fonts": p["fonts"],
                    "spacing": SPACING,
                    "radii": RADII,
                    "shadows": SHADOWS,
                },
                indent=2,
            )
        )
        return 0
    print("Numa design tokens" + (" (with brand override)" if palette else ""))
    print("\nColours:")
    for k, v in p["colors"].items():
        print(f"  {k:16s} {v}")
    print(f"\nChart cycle: {', '.join(p['chart_colors'])}")
    print(
        f"\nFonts: display={p['fonts'].get('display')}  body={p['fonts'].get('body')}"
        f"  server-fallback={p['fonts'].get('server_fallback')}"
    )
    print(f"\nSpacing (px): {SPACING}")
    print(f"Radii (px):   {RADII}")
    print("\n--emit-css for CSS variables, --json for machine use,")
    print("--palette /path/brand.json to preview a user's brand.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""make_chart.py — generic matplotlib chart → static PNG, with sane defaults.

GENERIC HELPER. This ships with the data-analysis skill and is meant to be a
fast, correct default for charts that must *embed* as real images (decks,
HTML→PDF reports, chat). It is deliberately general — if you need something
bespoke for a particular user/workflow, copy it into /workdir/chat-workflows/
and adapt it there rather than fighting the flags.

Why it exists (from benchmark findings):
  - Decks/PDFs shipped with ZERO embedded charts because models drew "chart
    placeholder" text or relied on Chart.js/canvas (which never executes in
    WeasyPrint). A static PNG always embeds.
  - Multi-magnitude series (counts vs revenue) rendered as invisible flat bars
    because they shared one axis — this auto-splits them onto a second axis.
  - Categories with ~zero value were silently dropped — every label is plotted.

Usage:
  python3 make_chart.py --type bar --out /workdir/outputs/rev.png \
      --title "Revenue by region" --ylabel "NZD" \
      --data '{"labels":["North","South","East","West"],
               "series":{"Revenue":[120000,90000,0,45000]}}'

  # Dual-axis is automatic when two series differ by >20x; or force it:
  python3 make_chart.py --type bar --secondary "Orders" --out /workdir/outputs/c.png \
      --data '{"labels":["Q1","Q2","Q3"],
               "series":{"Revenue":[120000,140000,155000],"Orders":[12,14,15]}}'

  --data accepts inline JSON or @/path/to/spec.json
  --type: bar | grouped_bar | line | hbar | pie
"""

import argparse
import json
import sys

import matplotlib

matplotlib.use("Agg")  # headless — no display in the container
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

# Numa palette (dev-notes/notes/asknuma-design-palette.md) — purple-led, cycled.
NUMA_COLORS = ["#9949AC", "#1F4B5E", "#DFBDE7", "#22C55E", "#323232", "#EF4444"]
TEXT = "#323232"


def _load_data(raw: str) -> dict:
    if raw.startswith("@"):
        with open(raw[1:], encoding="utf-8") as f:
            return json.load(f)
    return json.loads(raw)


def _thousands(x, _pos):
    if abs(x) >= 1000:
        return f"{x:,.0f}"
    return f"{x:g}"


def _style_axes(ax):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(colors=TEXT)
    ax.yaxis.set_major_formatter(FuncFormatter(_thousands))
    for label in ax.get_xticklabels() + ax.get_yticklabels():
        label.set_color(TEXT)


def _auto_secondary(series: dict) -> str | None:
    """If exactly two series differ in magnitude by >20x, return the smaller's
    name so it can go on a secondary axis (else it renders as flat bars)."""
    if len(series) != 2:
        return None
    maxes = {k: max((abs(v) for v in vals), default=0) for k, vals in series.items()}
    lo, hi = sorted(maxes.values())
    if lo > 0 and hi / lo > 20:
        return min(maxes, key=maxes.get)
    return None


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--type", default="bar", choices=["bar", "grouped_bar", "line", "hbar", "pie"]
    )
    p.add_argument("--data", required=True, help="inline JSON or @file")
    p.add_argument("--out", required=True, help="output PNG path")
    p.add_argument("--title", default="")
    p.add_argument("--xlabel", default="")
    p.add_argument("--ylabel", default="")
    p.add_argument("--ylabel2", default="")
    p.add_argument(
        "--secondary", default="", help="series name to plot on a secondary y-axis"
    )
    p.add_argument("--width", type=float, default=9.0)
    p.add_argument("--height", type=float, default=5.0)
    p.add_argument("--dpi", type=int, default=150)
    args = p.parse_args()

    spec = _load_data(args.data)
    labels = spec.get("labels", [])
    fig, ax = plt.subplots(figsize=(args.width, args.height), dpi=args.dpi)

    if args.type == "pie":
        values = spec.get("values") or next(iter(spec.get("series", {}).values()), [])
        ax.pie(
            values,
            labels=labels,
            autopct="%1.1f%%",
            startangle=90,
            colors=NUMA_COLORS,
            textprops={"color": TEXT},
        )
        ax.axis("equal")
    else:
        series = spec.get("series", {})
        if not series:
            print(
                "ERROR: bar/line/grouped_bar/hbar need a 'series' object",
                file=sys.stderr,
            )
            return 2
        secondary = args.secondary or _auto_secondary(series)
        ax2 = ax.twinx() if secondary else None
        x = range(len(labels))
        names = list(series.keys())
        n = len(names)

        for i, name in enumerate(names):
            vals = series[name]
            color = NUMA_COLORS[i % len(NUMA_COLORS)]
            target = ax2 if (secondary and name == secondary) else ax
            if args.type == "line":
                target.plot(x, vals, marker="o", label=name, color=color, linewidth=2)
            elif args.type == "hbar":
                target.barh(list(x), vals, color=color, label=name)
            else:  # bar / grouped_bar
                width = 0.8 / n if (args.type == "grouped_bar" or n > 1) else 0.6
                offset = (i - (n - 1) / 2) * width if n > 1 else 0
                bars = target.bar(
                    [xi + offset for xi in x],
                    vals,
                    width=width,
                    color=color,
                    label=name,
                )
                if n <= 2:  # value labels only when uncluttered
                    target.bar_label(bars, fmt="%g", padding=2, color=TEXT, fontsize=8)

        if args.type == "hbar":
            ax.set_yticks(list(x))
            ax.set_yticklabels(labels)
        else:
            ax.set_xticks(list(x))
            ax.set_xticklabels(
                labels,
                rotation=30 if any(len(str(l)) > 8 for l in labels) else 0,
                ha="right" if any(len(str(l)) > 8 for l in labels) else "center",
            )
        _style_axes(ax)
        if ax2 is not None:
            _style_axes(ax2)
            ax2.spines["top"].set_visible(False)
            if args.ylabel2:
                ax2.set_ylabel(args.ylabel2, color=TEXT)
        # Merge legends from both axes when present.
        handles, lbls = ax.get_legend_handles_labels()
        if ax2 is not None:
            h2, l2 = ax2.get_legend_handles_labels()
            handles += h2
            lbls += l2
        if len(names) > 1 or secondary:
            ax.legend(handles, lbls, frameon=False, labelcolor=TEXT)

    if args.title:
        ax.set_title(args.title, color=TEXT, fontsize=14, fontweight="bold", pad=12)
    if args.xlabel:
        ax.set_xlabel(args.xlabel, color=TEXT)
    if args.ylabel:
        ax.set_ylabel(args.ylabel, color=TEXT)

    fig.tight_layout()
    fig.savefig(args.out, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"Wrote chart: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

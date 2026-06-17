#!/usr/bin/env python3
"""workbook_summary.py — enumerate a workbook BEFORE you analyse it.

GENERIC HELPER (spreadsheet-handling skill). Run this as the mandatory first
step on any spreadsheet you're about to aggregate. It prints every sheet, its
shape, column dtypes, and — critically — the value distribution of every
low-cardinality (status/category) column, so you decide how each value is
treated instead of aggregating blind.

Closes the benchmark failures where models read only the first sheet (built a
reconciliation on half the data) or ignored a `status` column (counted
refunded/cancelled rows as completed and reported a fabricated "undercount").

Usage:
  python3 workbook_summary.py /workdir/uploads/model.xlsx
  python3 workbook_summary.py /workdir/uploads/data.csv --max-unique 25

Output: markdown to stdout. Pipe to a file if you want to keep it.
"""

import argparse
import sys
from pathlib import Path

import pandas as pd


def _summarise_frame(df: pd.DataFrame, max_unique: int) -> list[str]:
    out = [f"- **rows:** {len(df):,}  |  **columns:** {len(df.columns)}", ""]
    out.append("| column | dtype | non-null | distinct |")
    out.append("| --- | --- | --- | --- |")
    for col in df.columns:
        nn = df[col].notna().sum()
        nu = df[col].nunique(dropna=True)
        out.append(f"| `{col}` | {df[col].dtype} | {nn:,} | {nu:,} |")
    out.append("")

    # Value distributions for likely status/category columns (low cardinality).
    cat_cols = [
        c
        for c in df.columns
        if df[c].nunique(dropna=True) <= max_unique
        and (df[c].dtype == object or str(df[c].dtype).startswith(("category", "bool")))
    ]
    # Also include any low-cardinality column whose name hints at status.
    hint = ("status", "state", "type", "category", "stage", "result", "kind", "flag")
    for c in df.columns:
        if (
            c not in cat_cols
            and any(h in str(c).lower() for h in hint)
            and df[c].nunique(dropna=True) <= max_unique
        ):
            cat_cols.append(c)

    if cat_cols:
        out.append("**Value distributions (decide how each value is treated):**")
        out.append("")
        for c in cat_cols:
            counts = df[c].value_counts(dropna=False)
            rendered = ", ".join(f"`{k}`×{v}" for k, v in counts.items())
            out.append(f"- `{c}`: {rendered}")
        out.append("")

    # Flag any signed numeric columns — refunds/credits hide here.
    signed = [c for c in df.select_dtypes("number").columns if (df[c] < 0).any()]
    if signed:
        out.append(
            f"> ⚠️ **Signed numeric columns contain negatives** (refunds/credits/"
            f"reversals — do NOT ABS or drop without confirming meaning): "
            f"{', '.join('`'+str(c)+'`' for c in signed)}"
        )
        out.append("")
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("path", help="path to .xlsx/.xls/.csv/.tsv")
    p.add_argument(
        "--max-unique",
        type=int,
        default=20,
        help="treat columns with <= this many distinct values as categorical",
    )
    args = p.parse_args()

    path = Path(args.path)
    if not path.exists():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        return 2

    lines = [f"# Workbook summary — `{path.name}`", ""]
    ext = path.suffix.lower()
    if ext in (".csv", ".tsv"):
        sep = "\t" if ext == ".tsv" else ","
        df = pd.read_csv(path, sep=sep)
        lines.append("## (single CSV/TSV table)")
        lines += _summarise_frame(df, args.max_unique)
    else:
        xls = pd.ExcelFile(path)
        lines.append(
            f"**{len(xls.sheet_names)} sheet(s):** "
            + ", ".join(f"`{s}`" for s in xls.sheet_names)
        )
        lines.append("")
        lines.append("> Process EVERY in-scope sheet — do not stop at the first one.")
        lines.append("")
        for sheet in xls.sheet_names:
            df = xls.parse(sheet)
            lines.append(f"## Sheet: `{sheet}`")
            lines += _summarise_frame(df, args.max_unique)

    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())

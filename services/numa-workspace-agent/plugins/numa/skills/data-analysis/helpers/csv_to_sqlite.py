#!/usr/bin/env python3
"""csv_to_sqlite.py — convert a big CSV/Excel to an indexed SQLite db + cheat-sheet.

GENERIC HELPER (data-analysis skill). One step: load → SQLite → auto-index the
columns you'll filter/group on → emit a schema & query cheat-sheet alongside the
db. Never hand a user a bare, unindexed `.db` again.

Auto-indexes: any column whose name looks like an id/key/date, plus any
low-cardinality column (a natural GROUP BY / WHERE target).

Usage:
  python3 csv_to_sqlite.py /workdir/uploads/big.csv
  python3 csv_to_sqlite.py /workdir/uploads/big.csv --db /workdir/outputs/data.db --table sales
"""

import argparse
import sqlite3
import sys
from pathlib import Path

import pandas as pd

ID_HINTS = (
    "id",
    "key",
    "code",
    "date",
    "time",
    "_at",
    "customer",
    "category",
    "status",
    "type",
    "region",
    "product",
)


def _read(path: Path) -> pd.DataFrame:
    ext = path.suffix.lower()
    if ext in (".csv", ".tsv"):
        return pd.read_csv(path, sep="\t" if ext == ".tsv" else ",")
    return pd.read_excel(path)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("path")
    p.add_argument(
        "--db", default="", help="output db path (default: /workdir/outputs/<name>.db)"
    )
    p.add_argument("--table", default="data")
    p.add_argument(
        "--max-unique-index",
        type=int,
        default=1000,
        help="index low-cardinality columns with <= this many distinct values",
    )
    args = p.parse_args()

    src = Path(args.path)
    if not src.exists():
        print(f"ERROR: file not found: {src}", file=sys.stderr)
        return 2
    db_path = (
        Path(args.db) if args.db else Path("/workdir/outputs") / (src.stem + ".db")
    )
    db_path.parent.mkdir(parents=True, exist_ok=True)

    df = _read(src)
    conn = sqlite3.connect(db_path)
    df.to_sql(args.table, conn, index=False, if_exists="replace")

    # Decide which columns to index.
    indexed = []
    for col in df.columns:
        name = str(col).lower()
        is_idish = any(h in name for h in ID_HINTS)
        low_card = df[col].nunique(dropna=True) <= args.max_unique_index
        if is_idish or low_card:
            safe = "".join(ch if ch.isalnum() else "_" for ch in str(col))
            conn.execute(
                f'CREATE INDEX IF NOT EXISTS idx_{safe} ON "{args.table}"("{col}")'
            )
            indexed.append(str(col))
    conn.commit()

    # Cheat-sheet.
    md = [
        f"# {db_path.name} — schema & query cheat-sheet",
        "",
        f"**Table `{args.table}`** — {len(df):,} rows, {len(df.columns)} columns.",
        "",
        "| column | dtype | distinct |",
        "| --- | --- | --- |",
    ]
    for col in df.columns:
        md.append(f"| `{col}` | {df[col].dtype} | {df[col].nunique(dropna=True):,} |")
    md += [
        "",
        f"**Indexed:** {', '.join('`'+c+'`' for c in indexed) or '—'}",
        "",
        "## Example queries",
        "```sql",
    ]
    # For the example query, group by a low-cardinality categorical column (not a
    # unique id) and sum a non-id numeric column — a more useful illustration.
    num_cols = [
        c
        for c in df.select_dtypes("number").columns
        if not any(h in str(c).lower() for h in ("id", "key", "code"))
    ]
    cat_for_group = [
        c
        for c in indexed
        if df[c].dtype == object and 1 < df[c].nunique(dropna=True) <= 50
    ]
    grp = (
        cat_for_group[0]
        if cat_for_group
        else (indexed[0] if indexed else df.columns[0])
    )
    if num_cols:
        md.append(
            f'SELECT "{grp}", COUNT(*) AS n, SUM("{num_cols[0]}") AS total\n'
            f'FROM "{args.table}" GROUP BY "{grp}" ORDER BY total DESC LIMIT 20;'
        )
    else:
        md.append(
            f'SELECT "{grp}", COUNT(*) AS n FROM "{args.table}" '
            f'GROUP BY "{grp}" ORDER BY n DESC LIMIT 20;'
        )
    md.append("```")
    schema_path = db_path.with_name(db_path.stem + "-schema.md")
    schema_path.write_text("\n".join(md), encoding="utf-8")
    conn.close()

    print(f"Wrote db: {db_path} ({len(df):,} rows)")
    print(f"Indexed: {', '.join(indexed) or 'none'}")
    print(f"Cheat-sheet: {schema_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

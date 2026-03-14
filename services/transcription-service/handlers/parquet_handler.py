"""Parquet extraction via pyarrow — schema + sample rows."""

import pyarrow.parquet as pq


def extract_parquet(file_path: str) -> list[dict]:
    """Extract schema and sample rows from a Parquet file."""
    table = pq.read_table(file_path)
    schema = table.schema

    lines: list[str] = []
    lines.append("# Parquet File Schema\n")
    for field in schema:
        lines.append(f"- **{field.name}**: {field.type}")

    lines.append(f"\n**Total rows**: {table.num_rows}")
    lines.append(f"**Total columns**: {table.num_columns}\n")

    # Sample first 100 rows
    sample_size = min(100, table.num_rows)
    if sample_size > 0:
        lines.append(f"## Sample Data (first {sample_size} rows)\n")
        sample = table.slice(0, sample_size).to_pandas()
        lines.append(sample.to_markdown(index=False))

    text = "\n".join(lines)
    return [
        {
            "page_number": 1,
            "num_words": len(text.split()),
            "text": text,
        }
    ]

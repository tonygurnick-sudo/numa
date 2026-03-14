"""SQLite extraction — schema (CREATE TABLE) + sample rows per table."""

import sqlite3


def extract_sqlite(file_path: str) -> list[dict]:
    """Extract schema and sample data from a SQLite database."""
    conn = sqlite3.connect(file_path)
    cursor = conn.cursor()

    # Get all table names
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [row[0] for row in cursor.fetchall()]

    pages: list[dict] = []

    for idx, table_name in enumerate(tables):
        lines: list[str] = []
        lines.append(f"# Table: {table_name}\n")

        # Get CREATE TABLE statement
        cursor.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,),
        )
        create_sql = cursor.fetchone()
        if create_sql and create_sql[0]:
            lines.append(f"```sql\n{create_sql[0]}\n```\n")

        # Row count
        cursor.execute(f'SELECT COUNT(*) FROM "{table_name}"')  # noqa: S608
        row_count = cursor.fetchone()[0]
        lines.append(f"**Row count**: {row_count}\n")

        # Sample rows (first 50)
        sample_size = min(50, row_count)
        if sample_size > 0:
            cursor.execute(
                f'SELECT * FROM "{table_name}" LIMIT {sample_size}'
            )  # noqa: S608
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            lines.append(f"## Sample Data (first {sample_size} rows)\n")
            # Markdown table header
            lines.append("| " + " | ".join(col_names) + " |")
            lines.append("| " + " | ".join(["---"] * len(col_names)) + " |")
            for row in rows:
                cells = [str(c)[:100] if c is not None else "" for c in row]
                lines.append("| " + " | ".join(cells) + " |")

        text = "\n".join(lines)
        pages.append(
            {
                "page_number": idx + 1,
                "num_words": len(text.split()),
                "text": text,
            }
        )

    conn.close()
    return pages

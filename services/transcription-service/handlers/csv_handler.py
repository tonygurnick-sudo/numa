"""Native CSV/TSV/JSONL extraction."""

import csv
import io
import json

import structlog

logger = structlog.get_logger(__name__)


def extract_csv(file_path: str, delimiter: str = ",") -> list[dict]:
    """Extract tabular data from a CSV or TSV file."""
    try:
        with open(file_path, "r", errors="replace") as f:
            content = f.read()
    except Exception as e:
        return [
            {"page_number": 1, "num_words": 0, "text": f"(Failed to read CSV: {e})"}
        ]

    try:
        reader = csv.reader(io.StringIO(content), delimiter=delimiter)
        rows = list(reader)
    except Exception as e:
        return [{"page_number": 1, "num_words": len(content.split()), "text": content}]

    if not rows:
        return [{"page_number": 1, "num_words": 0, "text": "(Empty CSV file)"}]

    lines: list[str] = []
    headers = rows[0] if rows else []
    lines.append(f"Columns ({len(headers)}): {', '.join(headers)}")
    lines.append(f"Total rows: {len(rows) - 1}")
    lines.append("")

    # Header + separator
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join("---" for _ in headers) + " |")

    for row in rows[1:]:
        # Pad row to match header count
        padded = row + [""] * (len(headers) - len(row))
        lines.append("| " + " | ".join(padded[: len(headers)]) + " |")

    text = "\n".join(lines)
    return [{"page_number": 1, "num_words": len(text.split()), "text": text}]


def extract_jsonl(file_path: str) -> list[dict]:
    """Extract records from a JSON Lines file."""
    try:
        with open(file_path, "r", errors="replace") as f:
            lines = f.readlines()
    except Exception as e:
        return [
            {"page_number": 1, "num_words": 0, "text": f"(Failed to read JSONL: {e})"}
        ]

    records: list[str] = []
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            records.append(json.dumps(obj, indent=2))
        except json.JSONDecodeError:
            records.append(f"[malformed line {i + 1}]: {line}")

    if not records:
        return [{"page_number": 1, "num_words": 0, "text": "(Empty JSONL file)"}]

    text = f"JSON Lines file ({len(records)} records)\n\n" + "\n\n---\n\n".join(records)
    return [{"page_number": 1, "num_words": len(text.split()), "text": text}]

"""Native Jupyter notebook (.ipynb) extraction."""

import json

import structlog

logger = structlog.get_logger(__name__)


def extract_ipynb(file_path: str) -> list[dict]:
    """Extract all cells from a Jupyter notebook."""
    try:
        with open(file_path, "r", errors="replace") as f:
            nb = json.load(f)
    except Exception as e:
        return [
            {
                "page_number": 1,
                "num_words": 0,
                "text": f"(Failed to parse notebook: {e})",
            }
        ]

    cells = nb.get("cells", [])
    if not cells:
        return [{"page_number": 1, "num_words": 0, "text": "(Empty notebook)"}]

    parts: list[str] = []
    for i, cell in enumerate(cells):
        cell_type = cell.get("cell_type", "unknown")
        source = "".join(cell.get("source", []))

        if cell_type == "markdown":
            parts.append(source)
        elif cell_type == "code":
            parts.append(f"```python\n{source}\n```")
            # Include text outputs
            for output in cell.get("outputs", []):
                if "text" in output:
                    out_text = "".join(output["text"])
                    parts.append(f"Output:\n{out_text}")
                elif "data" in output:
                    for mime, data in output["data"].items():
                        if mime.startswith("text/"):
                            parts.append(f"Output:\n{''.join(data)}")
        elif cell_type == "raw":
            parts.append(source)

    text = "\n\n".join(parts)
    return [{"page_number": 1, "num_words": len(text.split()), "text": text}]

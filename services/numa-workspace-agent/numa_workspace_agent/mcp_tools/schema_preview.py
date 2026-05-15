"""
Compact JSON schema-with-samples preview for large tool results.

When a tool result is too big to inline (deeply nested API payloads,
long arrays of records), the wrapper saves it to disk and hands the
model a path. Without further guidance the model either Reads the file
blind -- crowding context and risking the SDK's 256KB Read cap -- or
guesses a jq path that's wrong on the first try.

`build_schema_preview` walks the value and returns a tiny structural
fingerprint: every key, types, array lengths, example values, with
depth/breadth caps. The model can write a precise jq path against this
without ever loading the full file.

Conventions in the output: keys prefixed with `_` are metadata about
the shape; every other key is a real key from the source data, so the
model can match them up directly with `jq` paths.
"""

from typing import Any

# Caps on the walker. Result files we see in the wild are typically
# homogeneous arrays of records (50 emails, 100 tickets, etc.), so
# first-item sampling captures the shape; the depth/key caps are
# belt-and-braces guards against pathological inputs.
SCHEMA_MAX_DEPTH = 8
SCHEMA_MAX_DICT_KEYS = 50
SCHEMA_STRING_SAMPLE_LEN = 80


def build_schema_preview(value: Any, depth: int = 0) -> Any:
    """Compact schema-with-samples of a JSON value for inline model consumption."""
    if depth >= SCHEMA_MAX_DEPTH:
        return {"_truncated": "max_depth"}

    if value is None:
        return {"_type": "null"}

    if isinstance(value, bool):
        return {"_type": "bool", "_example": value}

    if isinstance(value, (int, float)):
        return {"_type": type(value).__name__, "_example": value}

    if isinstance(value, str):
        if len(value) <= SCHEMA_STRING_SAMPLE_LEN:
            return {"_type": "string", "_example": value}
        return {
            "_type": "string",
            "_length": len(value),
            "_example": value[:SCHEMA_STRING_SAMPLE_LEN] + "…",
        }

    if isinstance(value, list):
        if not value:
            return {"_type": "array", "_length": 0}
        return {
            "_type": "array",
            "_length": len(value),
            "_item": build_schema_preview(value[0], depth + 1),
        }

    if isinstance(value, dict):
        out: dict[str, Any] = {}
        keys = list(value.keys())
        for k in keys[:SCHEMA_MAX_DICT_KEYS]:
            out[str(k)] = build_schema_preview(value[k], depth + 1)
        if len(keys) > SCHEMA_MAX_DICT_KEYS:
            out["_more_keys"] = len(keys) - SCHEMA_MAX_DICT_KEYS
        return out

    return {
        "_type": type(value).__name__,
        "_example": str(value)[:SCHEMA_STRING_SAMPLE_LEN],
    }

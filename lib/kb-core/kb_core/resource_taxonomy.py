"""Shared taxonomy for persona / industry tagging on Knowledge Bases.

TypeScript equivalent: lib/resource-taxonomy.ts + lib/resource-taxonomy.json
Keep these files in sync if values change.
"""

from typing import List, Tuple

PERSONAS: Tuple[str, ...] = ("CEO", "Finance", "HR", "Operations", "Commercial")
INDUSTRIES: Tuple[str, ...] = (
    "Manufacturing",
    "Construction",
    "Engineering",
    "Professional Services",
    "Franchise",
)


def _normalise_against(
    values: object, allowed: Tuple[str, ...]
) -> Tuple[List[str], List[str]]:
    """Trim, dedupe case-insensitively, return canonical case.

    Returns (valid_values, invalid_values). `valid_values` are taxonomy
    members in canonical case; `invalid_values` are trimmed input strings
    that did not match any taxonomy entry.
    """
    if not isinstance(values, list):
        return [], []
    lower_to_canonical = {v.lower(): v for v in allowed}
    seen: set[str] = set()
    valid: List[str] = []
    invalid: List[str] = []
    for v in values:
        if not isinstance(v, str):
            continue
        trimmed = v.strip()
        if not trimmed:
            continue
        canonical = lower_to_canonical.get(trimmed.lower())
        if canonical is None:
            invalid.append(trimmed)
            continue
        if canonical in seen:
            continue
        seen.add(canonical)
        valid.append(canonical)
    return valid, invalid


def normalise_personas(values: object) -> Tuple[List[str], List[str]]:
    return _normalise_against(values, PERSONAS)


def normalise_industries(values: object) -> Tuple[List[str], List[str]]:
    return _normalise_against(values, INDUSTRIES)

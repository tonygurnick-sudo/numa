#!/usr/bin/env python3
"""decode_attachment.py — Gmail/Graph base64 attachment → file, in one step.

GENERIC HELPER (integrations skill). Email attachment actions return the file as
base64 (Gmail uses URL-safe base64; Microsoft Graph uses standard). Decoding it
by hand across several tool calls is error-prone — this does it in one.

Usage:
  # Inline base64 string:
  python3 decode_attachment.py --b64 "JVBERi0xLjQ..." --out /workdir/tmp/report.pdf

  # From the saved action result (auto-finds the base64 field):
  python3 decode_attachment.py --json /workdir/tmp/integrations-results/<id>.json \
      --out /workdir/tmp/report.pdf

  --field overrides the JSON key holding the base64 (default: auto-detect
  'data' / 'attachmentData' / 'contentBytes' / 'body').
"""

import argparse
import base64
import binascii
import json
import sys
from pathlib import Path

_CANDIDATE_FIELDS = ("data", "attachmentData", "contentBytes", "body", "content")


def _decode(b64: str) -> bytes:
    s = b64.strip().replace("\n", "").replace("\r", "")
    # Gmail uses URL-safe alphabet (-, _); standard uses +, /. Try both.
    s = s.replace("-", "+").replace("_", "/")
    s += "=" * (-len(s) % 4)  # restore padding
    return base64.b64decode(s)


def _find_b64(obj, field=None):
    """Recursively locate a base64 string in a parsed JSON result."""
    if field:
        # explicit dotted/plain key
        cur = obj
        for part in field.split("."):
            cur = cur[part] if isinstance(cur, dict) else None
        return cur
    if isinstance(obj, dict):
        for k in _CANDIDATE_FIELDS:
            if k in obj and isinstance(obj[k], str) and len(obj[k]) > 32:
                return obj[k]
        for v in obj.values():
            found = _find_b64(v)
            if found:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = _find_b64(v)
            if found:
                return found
    return None


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--b64", help="inline base64 string")
    src.add_argument(
        "--json", help="path to a JSON action result containing the attachment"
    )
    p.add_argument("--field", help="JSON key holding the base64 (dotted path ok)")
    p.add_argument("--out", required=True, help="output file path")
    args = p.parse_args()

    if args.b64:
        b64 = args.b64
    else:
        data = json.loads(Path(args.json).read_text())
        b64 = _find_b64(data, args.field)
        if not b64:
            print("ERROR: no base64 field found in JSON (try --field)", file=sys.stderr)
            return 2

    try:
        raw = _decode(b64)
    except (binascii.Error, ValueError) as e:
        print(f"ERROR: not valid base64: {e}", file=sys.stderr)
        return 2

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(raw)
    print(f"Wrote {len(raw):,} bytes → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

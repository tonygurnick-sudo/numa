#!/usr/bin/env python3
"""Regenerate ext-api-doc/synergy/02-api-spec-investigation.md from the live
12d Synergy Swagger JSON.

Usage:
    # 1. Fetch the Swagger JSON from the public cloud instance
    curl -sL 'https://synergy.12dsynergycloud.com/api-docs/api/v1' \
        -o playwright-runs/synergy-swagger-verify/swagger.json

    # 2. Run this script
    python3 tools/regen-synergy-spec-doc.py

The output file is the literal ground truth for Synergy endpoints — if
01-llm-api-rules.md ever disagrees, the auto-generated spec wins.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SWAGGER_PATH = REPO_ROOT / "playwright-runs/synergy-swagger-verify/swagger.json"
OUTPUT_PATH = REPO_ROOT / "ext-api-doc/synergy/02-api-spec-investigation.md"

MODELS_TO_SHOW = [
    "PagedResultModel[JobModel]",
    "PagedResultModel[FileModel]",
    "PagedResultModel[FolderModel]",
    "PagedResultModel[ContactModel]",
    "JobModel",
    "FolderModel",
    "FileModel",
    "TaskItemModel",
    "ContactModel",
    "JobItemsModel",
    "FolderItemsModel",
    "EntityID",
    "JobSearchModel",
    "FileSearchModel",
    "ContactSearchModel",
    "TaskSearchModel",
    "AttributeInfo",
]


def render(spec: dict) -> str:
    info = spec.get("info", {})
    host = spec.get("host", "")

    by_tag: dict[str, list[dict]] = defaultdict(list)
    tag_descriptions = {
        t["name"]: t.get("description", "") for t in spec.get("tags", [])
    }

    for path, methods in spec["paths"].items():
        clean_path = path.replace("v{apiVersion}", "v1")
        for method, op in methods.items():
            if method not in ("get", "post", "put", "delete", "patch"):
                continue
            for tag in op.get("tags", ["Uncategorized"]):
                by_tag[tag].append(
                    {
                        "method": method.upper(),
                        "path": clean_path,
                        "summary": op.get("summary", "") or "",
                        "operationId": op.get("operationId", ""),
                    }
                )

    lines: list[str] = []
    write = lines.append

    write("# 12d Synergy API — Verified Endpoint Reference")
    write("")
    write(f"> **Auto-generated from `{host}/api-docs/api/v1`** (Swagger spec, v1).")
    write("> This file is the ground truth. If `01-llm-api-rules.md` disagrees,")
    write(
        "> this file wins. Regenerate with `python3 tools/regen-synergy-spec-doc.py`."
    )
    write("")
    write(f"- **Title:** {info.get('title','')}")
    write(f"- **Version:** {info.get('version','')}")
    write(f"- **Host:** {host}")
    write("- **Base path:** `/api/v1`")
    write(f"- **Total paths:** {len(spec['paths'])}")
    write(f"- **Total operations:** {sum(len(v) for v in by_tag.values())}")
    write("")
    write("---")
    write("")
    write("## Critical Patterns (derived from Swagger)")
    write("")
    write("### Pagination styles")
    write("")
    write(
        "- **Body-paginated (`/search` endpoints):** `{Page, PageSize}` in request body."
    )
    write(
        "  Examples: `POST /api/v1/jobs/search`, `POST /api/v1/files/search`, "
        "`POST /api/v1/Contacts/search`, `POST /api/v1/tasks/search`."
    )
    write(
        "- **Path-paginated (content listings):** `{page}/{page_size}` as path segments, "
        "often with other path params (filter, flags)."
    )
    write(
        "  Examples: `GET /api/v1/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/"
        "{filter}/{show_deleted_files}`."
    )
    write(
        "- **Non-paginated composite (`/items`):** single-shot response returning multiple "
        "collections in one blob."
    )
    write(
        "  Examples: `GET /api/v1/jobs/{id}/items` → `JobItemsModel`; "
        "`GET /api/v1/folders/{id}/items` → `FolderItemsModel`."
    )
    write("")
    write("### ID format")
    write("")
    write(
        'Every ID in a URL path is an `IDString` — format `"N_N"` '
        '(underscore separator, e.g. `"1_1"`).'
    )
    write("Models expose `EntityID` with `{_id, _server_id, _server_guid, IDString}`.")
    write("")
    write("### Version prefix exceptions")
    write("")
    write("All endpoints use `/api/v1/` except:")
    write("- `POST /api/Tasks` — task create/update")
    write("- `GET /health` — health check")
    write("")
    write("### Response shape conventions")
    write("")
    write(
        "- List/search endpoints → `PagedResultModel[T]` with "
        "`{PageNumber, PageSize, TotalPages, TotalRows, Result}`"
    )
    write(
        "- `/items` endpoints → composite model (see `JobItemsModel`, `FolderItemsModel`)"
    )
    write(
        "- Errors → **plain string**, NOT JSON. Swagger documents only 200 responses."
    )
    write("")
    write("---")
    write("")
    write("## Endpoints by Tag")
    write("")

    for tag in sorted(by_tag.keys()):
        endpoints = sorted(by_tag[tag], key=lambda e: (e["path"], e["method"]))
        desc = tag_descriptions.get(tag, "").strip()
        write(f"### {tag} ({len(endpoints)} endpoints)")
        write("")
        if desc:
            write(desc)
            write("")
        write("| Method | Path | Summary |")
        write("| ------ | ---- | ------- |")
        for e in endpoints:
            summary = e["summary"].replace("|", "\\|").replace("\n", " ").strip()
            if not summary:
                summary = e["operationId"]
            write(f"| {e['method']} | `{e['path']}` | {summary[:100]} |")
        write("")

    write("---")
    write("")
    write("## Key Models")
    write("")
    write("The LLM should understand these response shapes before making calls.")
    write("")

    for name in MODELS_TO_SHOW:
        d = spec["definitions"].get(name)
        if not d:
            continue
        write(f"### {name}")
        write("")
        if d.get("description"):
            write(d["description"])
            write("")
        write("| Field | Type | Description |")
        write("| ----- | ---- | ----------- |")
        for pname, pdef in (d.get("properties") or {}).items():
            ptype = pdef.get("type") or ""
            if pdef.get("$ref"):
                ptype = pdef["$ref"].split("/")[-1]
            elif pdef.get("type") == "array":
                items = pdef.get("items", {})
                item_type = items.get("$ref", "").split("/")[-1] or items.get(
                    "type", ""
                )
                ptype = f"array<{item_type}>"
            pdesc = (
                (pdef.get("description") or "")
                .replace("|", "\\|")
                .replace("\n", " ")[:80]
            )
            write(f"| `{pname}` | `{ptype}` | {pdesc} |")
        write("")

    write("---")
    write("")
    write("## Regeneration")
    write("")
    write("```bash")
    write("# 1. Fetch the Swagger JSON")
    write("curl -sL 'https://synergy.12dsynergycloud.com/api-docs/api/v1' \\")
    write("  -o playwright-runs/synergy-swagger-verify/swagger.json")
    write("")
    write("# 2. Re-run the generator")
    write("python3 tools/regen-synergy-spec-doc.py")
    write("```")
    write("")

    return "\n".join(lines) + "\n"


def main() -> int:
    if not SWAGGER_PATH.exists():
        print(
            f"error: swagger JSON not found at {SWAGGER_PATH}. "
            "Fetch it with curl first — see docstring.",
            file=sys.stderr,
        )
        return 1

    with SWAGGER_PATH.open() as f:
        spec = json.load(f)

    OUTPUT_PATH.write_text(render(spec))
    print(f"wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

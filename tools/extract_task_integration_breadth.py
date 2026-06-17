#!/usr/bin/env python3
"""Extract distinct integration counts per task from trace data.

For each task in outputs/all-tasks-dataset.json, scan the conversation's trace
within its [first_message_idx, last_message_idx] user-turn range and count the
DISTINCT Pipedream integration apps invoked by MCP integration tools.

Integration tool detection:
  - mcp__integrations__run_action      -> input.action_key (prefix before '-')
  - mcp__integrations__proxy_request   -> input.integration_slug
                                          (fallback: parse host from upstream_url)
  - mcp__integrations__configure_props -> input.action_key (prefix before '-')

user_idx attribution mirrors scripts/task_segmenter.py:
  - Increment a counter for every `type: user` event whose content has a text
    block that is NOT a tool_result and NOT a skill_inject marker.
  - All assistant tool_use events between user messages belong to the most
    recent user_idx.

Output: dev-notes/tasks/credits-work/outputs/task-integration-breadth.json
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse

CREDITS_DIR = Path("/Users/nathandouglas/arcanum/numa/dev-notes/tasks/credits-work")
CLIENTS_DIR = CREDITS_DIR / "clients"
DATASET = CREDITS_DIR / "outputs" / "all-tasks-dataset.json"
OUTPUT = CREDITS_DIR / "outputs" / "task-integration-breadth.json"

INTEGRATION_TOOL_NAMES = {
    "mcp__integrations__run_action",
    "mcp__integrations__proxy_request",
    "mcp__integrations__configure_props",
}

SKILL_INJECT_MARKER = "Base directory for this skill:"


def is_skill_inject(content) -> bool:
    if not isinstance(content, list):
        return False
    for p in content:
        if isinstance(p, dict) and p.get("type") == "text":
            if (p.get("text") or "").startswith(SKILL_INJECT_MARKER):
                return True
    return False


# Map common upstream hosts to integration slugs when integration_slug is absent.
_HOST_SLUG_RE = [
    (re.compile(r"(?:.*\.)?googleapis\.com"), None),  # handled specially below
    (re.compile(r"(?:.*\.)?slack\.com"), "slack"),
    (re.compile(r"(?:.*\.)?xero\.com"), "xero"),
    (re.compile(r"(?:.*\.)?atlassian\.net"), "jira"),
    (re.compile(r"(?:.*\.)?notion\.com|notion\.so"), "notion"),
    (re.compile(r"(?:.*\.)?hubapi\.com|hubspot\.com"), "hubspot"),
    (re.compile(r"(?:.*\.)?airtable\.com"), "airtable"),
    (re.compile(r"(?:.*\.)?zendesk\.com"), "zendesk"),
    (re.compile(r"(?:.*\.)?freshdesk\.com"), "freshdesk"),
    (re.compile(r"graph\.microsoft\.com"), "microsoft_graph"),
    (re.compile(r"(?:.*\.)?sharepoint\.com"), "sharepoint"),
    (re.compile(r"(?:.*\.)?dropbox(?:api)?\.com"), "dropbox"),
    (re.compile(r"(?:.*\.)?box\.com"), "box"),
    (re.compile(r"(?:.*\.)?monday\.com"), "monday"),
    (re.compile(r"(?:.*\.)?asana\.com"), "asana"),
    (re.compile(r"(?:.*\.)?linear\.app"), "linear"),
    (re.compile(r"(?:.*\.)?clickup\.com"), "clickup"),
    (re.compile(r"(?:.*\.)?intercom\.io"), "intercom"),
    (re.compile(r"(?:.*\.)?mailchimp\.com"), "mailchimp"),
    (re.compile(r"(?:.*\.)?sendgrid\.com"), "sendgrid"),
    (re.compile(r"(?:.*\.)?twilio\.com"), "twilio"),
    (re.compile(r"(?:.*\.)?github\.com|api\.github\.com"), "github"),
    (re.compile(r"(?:.*\.)?gitlab\.com"), "gitlab"),
    (re.compile(r"(?:.*\.)?stripe\.com"), "stripe"),
    (re.compile(r"(?:.*\.)?shopify\.com"), "shopify"),
    (re.compile(r"(?:.*\.)?salesforce\.com|force\.com"), "salesforce"),
    (re.compile(r"(?:.*\.)?netsuite\.com"), "netsuite"),
    (re.compile(r"(?:.*\.)?quickbooks\.com|intuit\.com"), "quickbooks"),
]

# Specific Google subdomain → integration_slug map
_GOOGLE_SUB_MAP = {
    "gmail": "gmail",
    "drive": "google_drive",
    "sheets": "google_sheets",
    "docs": "google_docs",
    "calendar": "google_calendar",
    "youtube": "youtube",
    "people": "google_contacts",
    "analytics": "google_analytics",
    "ads": "google_ads",
}


def host_to_slug(url: str) -> str | None:
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return None
    host = host.lower()
    if not host:
        return None

    # Handle Google APIs (gmail.googleapis.com etc.)
    if host.endswith("googleapis.com") or host == "googleapis.com":
        # gmail.googleapis.com -> gmail
        parts = host.split(".")
        for p in parts:
            if p in _GOOGLE_SUB_MAP:
                return _GOOGLE_SUB_MAP[p]
        # /drive/ in path? Caller doesn't pass path, just URL — try with full URL
        for k, v in _GOOGLE_SUB_MAP.items():
            if f"/{k}/" in url or url.endswith(f"/{k}"):
                return v
        return "google"

    for pattern, slug in _HOST_SLUG_RE:
        if pattern.search(host):
            if slug is None:
                continue
            return slug
    # Last-resort: second-to-last label of host (foo.bar.com -> bar)
    parts = host.split(".")
    if len(parts) >= 2:
        return parts[-2]
    return host or None


def extract_integration_from_tool_use(name: str, inp: dict) -> str | None:
    if not isinstance(inp, dict):
        return None
    if (
        name == "mcp__integrations__run_action"
        or name == "mcp__integrations__configure_props"
    ):
        ak = inp.get("action_key") or ""
        if isinstance(ak, str) and "-" in ak:
            return ak.split("-", 1)[0]
        return None
    if name == "mcp__integrations__proxy_request":
        slug = inp.get("integration_slug")
        if isinstance(slug, str) and slug:
            return slug
        url = inp.get("upstream_url") or inp.get("url") or ""
        if isinstance(url, str) and url:
            return host_to_slug(url)
        return None
    return None


def build_trace_index(
    client: str, surface: str, conv_id: str
) -> dict[int, set[str]] | None:
    """Return {user_idx: {integration_slug, ...}} for one conversation.

    Returns None if the trace file is missing.
    """
    trace_path = CLIENTS_DIR / client / surface / conv_id / "trace.jsonl"
    if not trace_path.exists():
        return None

    per_idx: dict[int, set[str]] = defaultdict(set)
    cur_idx = 0
    try:
        with trace_path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                etype = ev.get("type")
                if etype == "user":
                    msg = ev.get("message") or {}
                    content = msg.get("content") or []
                    if not isinstance(content, list):
                        continue
                    has_text = any(
                        isinstance(p, dict) and p.get("type") == "text" for p in content
                    )
                    has_tool_result = any(
                        isinstance(p, dict) and p.get("type") == "tool_result"
                        for p in content
                    )
                    if (
                        has_text
                        and not has_tool_result
                        and not is_skill_inject(content)
                    ):
                        cur_idx += 1
                elif etype == "assistant":
                    msg = ev.get("message") or {}
                    content = msg.get("content") or []
                    if not isinstance(content, list):
                        continue
                    for p in content:
                        if not isinstance(p, dict):
                            continue
                        if p.get("type") != "tool_use":
                            continue
                        tname = p.get("name")
                        if tname not in INTEGRATION_TOOL_NAMES:
                            continue
                        slug = extract_integration_from_tool_use(
                            tname, p.get("input") or {}
                        )
                        if slug:
                            per_idx[cur_idx].add(slug.lower())
    except Exception:
        # Treat as unreadable
        return None
    return per_idx


def main() -> None:
    print(f"[load] dataset: {DATASET.relative_to(CREDITS_DIR)}")
    with DATASET.open() as f:
        data = json.load(f)
    rows = data["rows"]
    print(f"[load] {len(rows):,} task rows")

    # Group tasks by (client, surface, conv_id) so we only scan each trace once.
    by_conv: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for r in rows:
        by_conv[(r["client"], r["surface"], r["conv_id"])].append(r)
    print(f"[group] {len(by_conv):,} unique (client, surface, conv) keys")

    results: list[dict] = []
    n_missing_trace = 0
    n_with_integrations = 0
    n_distribution = Counter()
    tool_name_seen: set[str] = (
        set()
    )  # populated by build_trace_index implicitly via detection
    distinct_integrations_overall: Counter = Counter()

    n_done = 0
    for key, tasks in by_conv.items():
        client, surface, conv_id = key
        per_idx = build_trace_index(client, surface, conv_id)
        trace_missing = per_idx is None
        if trace_missing:
            n_missing_trace += 1

        for t in tasks:
            first = int(t.get("first_message_idx") or 0)
            last = int(t.get("last_message_idx") or 0)
            integrations: set[str] = set()
            note = None
            if trace_missing:
                note = "trace_missing"
            elif first <= 0 or last < first:
                note = "invalid_range"
            else:
                for idx in range(first, last + 1):
                    s = per_idx.get(idx)
                    if s:
                        integrations.update(s)

            n_int = len(integrations)
            if n_int >= 1:
                n_with_integrations += 1
                for slug in integrations:
                    distinct_integrations_overall[slug] += 1
            bin_key = str(n_int) if n_int < 4 else "4+"
            n_distribution[bin_key] += 1

            entry = {
                "task_id": t["task_id"],
                "n_integrations": n_int,
                "integration_names": sorted(integrations),
            }
            if note:
                entry["note"] = note
            results.append(entry)

        n_done += 1
        if n_done % 500 == 0:
            print(f"  [progress] {n_done}/{len(by_conv)} convs processed")

    # Ordered histogram
    histogram = {k: n_distribution.get(k, 0) for k in ["0", "1", "2", "3", "4+"]}

    payload = {
        "rows": results,
        "summary": {
            "n_tasks": len(results),
            "n_tasks_with_integrations": n_with_integrations,
            "n_distribution": histogram,
            "n_traces_missing": n_missing_trace,
            "integration_tool_names_detected": sorted(INTEGRATION_TOOL_NAMES),
            "top_integration_slugs_by_task_count": distinct_integrations_overall.most_common(
                40
            ),
        },
    }
    print(f"[write] {OUTPUT.relative_to(CREDITS_DIR)} ({len(results):,} rows)")
    with OUTPUT.open("w") as f:
        json.dump(payload, f, indent=2)

    print("\n=== Summary ===")
    print(f"n_tasks: {len(results):,}")
    print(f"n_tasks_with_integrations (>=1): {n_with_integrations:,}")
    print(f"n_traces_missing: {n_missing_trace:,}")
    print(f"Distribution: {histogram}")
    print("Top integrations:")
    for slug, cnt in distinct_integrations_overall.most_common(15):
        print(f"  {cnt:6d}  {slug}")


if __name__ == "__main__":
    main()

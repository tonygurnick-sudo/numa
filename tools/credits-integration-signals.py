#!/usr/bin/env python3
"""
Build per-customer integration signals for the Numa Credits v2 usage-archetype work.

Combines two signals:
  1) PRIMARY: pipedream.by_app_active from raw portal data — apps that at least
     one user has actually connected/authorized (ground truth).
  2) SECONDARY: union of required_integrations across all agents in
     outputs/agents/{client}-agents-v2.json — apps the customer has built
     agents around (intent / aspiration).

The UNION of (1) and (2) is the per-customer "integrations enabled / engaged"
set used for archetype analysis.

Usage:
    python3 tools/credits-integration-signals.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# ----------------------------------------------------------------------------
# Paths
# ----------------------------------------------------------------------------
WORK_DIR = Path("/Users/nathandouglas/arcanum/numa/dev-notes/tasks/credits-work")
RAW_PATH = WORK_DIR / "raw-portal-data/numa-dashboard-raw-2026-05-25.json"
AGENTS_DIR = WORK_DIR / "outputs/agents"

CUSTOMERS: list[str] = [
    "moira-shire-council",
    "uplift-education",
    "av-media",
    "eliotsinclair",
    "momentum",
    "ddconsulting",
    "davidreidhomes",
    "tleaft",
    "thealternativeboard",
    "advanceelectrical",
    "tregaskisbrown",
    "chandler",
    "w-advisory",
    "convergehr",
    "signsgraphics",
    "newfieldroofingnz",
    "capitalfootball",
    "energylightgroup",
    "hangingaround",
    "chriswhelancoaching",
    "flowerdayhomes",
    "morden",
    "roof-logic",
    "theelitenetwork",
    "fridayhomes",
    "pcl",
    "howie",
    "homeofficepainting",
    "apex",
    "vadacom",
    "boroughbuilders",
    "racetech",
    "tabphilly",
    "mexted",
    "rocketscience",
    "kpl",
    "seven-electrical",
    "griffiths-group",
    "momentumiq",
    "atlanticengineering",
    "huddle-advisory",
    "fantailservices",
    "ultra-it",
]


def load_raw() -> dict[str, Any]:
    with RAW_PATH.open() as f:
        return json.load(f)


def pipedream_apps(snapshot: dict[str, Any]) -> tuple[set[str], dict[str, int]]:
    """Return (set of distinct active app_names, per-app user_count)."""
    pd = snapshot.get("pipedream") or {}
    by_app = pd.get("by_app_active") or []
    apps: set[str] = set()
    counts: dict[str, int] = {}
    for entry in by_app:
        name = entry.get("app_name")
        if not name:
            continue
        apps.add(name)
        counts[name] = int(entry.get("user_count", 0))
    return apps, counts


def agent_required_integrations(client: str) -> tuple[set[str], int, int]:
    """
    Return (set of unique required_integrations across all agents,
            num_agents_with_any_integration,
            total_num_agents).
    Returns (set(), 0, -1) if the agents-v2 file is missing.
    """
    path = AGENTS_DIR / f"{client}-agents-v2.json"
    if not path.exists():
        return set(), 0, -1
    with path.open() as f:
        data = json.load(f)
    results = data.get("results") or []
    ints: set[str] = set()
    n_with = 0
    for r in results:
        req = r.get("required_integrations") or []
        if req:
            n_with += 1
            for v in req:
                if not v:
                    continue
                # Normalise: strip, lower-case for de-dup, but keep nice display
                ints.add(str(v).strip().lower())
    return ints, n_with, len(results)


# Map agent-side integration names -> canonical pipedream app slugs so the
# union de-duplicates cleanly. We are deliberately conservative: only collapse
# obvious aliases.
AGENT_TO_PIPEDREAM_ALIAS: dict[str, str] = {
    "google drive": "google_drive",
    "google_docs": "google_docs",
    "google docs": "google_docs",
    "google sheets": "google_sheets",
    "google_sheets": "google_sheets",
    "google calendar": "google_calendar",
    "google_calendar": "google_calendar",
    "google forms": "google_forms",
    "google_forms": "google_forms",
    "gmail": "gmail",
    "slack": "slack",
    "microsoft outlook": "microsoft_outlook",
    "outlook": "microsoft_outlook",
    "microsoft_outlook": "microsoft_outlook",
    "microsoft outlook calendar": "microsoft_outlook_calendar",
    "microsoft_outlook_calendar": "microsoft_outlook_calendar",
    "microsoft teams": "microsoft_teams",
    "ms teams": "microsoft_teams",
    "teams": "microsoft_teams",
    "microsoft_teams": "microsoft_teams",
    "sharepoint": "sharepoint",
    "onedrive": "onedrive",
    "linkedin": "linkedin",
    "freshdesk": "freshdesk",
    "onenote": "onenote",
    "rentman": "rentman",
    "hubspot": "hubspot",
    "salesforce": "salesforce",
    "xero": "xero",
    "quickbooks": "quickbooks",
    "asana": "asana",
    "trello": "trello",
    "monday": "monday",
    "jira": "jira",
    "notion": "notion",
    "zoom": "zoom",
    "calendly": "calendly",
    "intercom": "intercom",
    "zendesk": "zendesk",
}


def normalize_agent_int(name: str) -> str:
    key = name.strip().lower()
    return AGENT_TO_PIPEDREAM_ALIAS.get(key, key.replace(" ", "_"))


def main() -> None:
    raw = load_raw()
    snapshots = raw.get("snapshots", {})

    out: dict[str, dict[str, Any]] = {}
    for client in CUSTOMERS:
        snap = snapshots.get(client)
        notes: list[str] = []

        # --- Signal 1: pipedream actual connections ---
        if snap is None:
            pd_apps: set[str] = set()
            pd_counts: dict[str, int] = {}
            notes.append("missing-from-raw-snapshots")
        else:
            pd_apps, pd_counts = pipedream_apps(snap)

        # --- Signal 2: agent required_integrations ---
        agent_ints_raw, n_agents_with, n_agents = agent_required_integrations(client)
        if n_agents == -1:
            notes.append("agents-v2-file-missing")
            agent_ints_norm: set[str] = set()
        else:
            agent_ints_norm = {normalize_agent_int(x) for x in agent_ints_raw}

        # --- Union ---
        union = sorted(pd_apps | agent_ints_norm)

        # --- Notes: explain delta between intent vs actuals ---
        only_in_agents = sorted(agent_ints_norm - pd_apps)
        only_in_pipedream = sorted(pd_apps - agent_ints_norm)
        if only_in_agents:
            notes.append(
                f"intent-only (in agents, not connected): {','.join(only_in_agents)}"
            )
        if only_in_pipedream:
            # Use compact label
            notes.append(
                f"connected-only (no agent built): {','.join(only_in_pipedream)}"
            )
        if not union:
            notes.append("no-integrations-detected")

        # Sort union by pipedream user_count desc when available, then alpha
        union_sorted = sorted(
            union,
            key=lambda n: (-(pd_counts.get(n, 0)), n),
        )

        out[client] = {
            "n_integrations_enabled": len(union),
            "integration_names": union_sorted,
            "_signals": {
                "pipedream_distinct_active_apps": len(pd_apps),
                "pipedream_apps": sorted(pd_apps),
                "pipedream_active_connections": (
                    (snap or {}).get("pipedream", {}).get("active_connections", 0)
                ),
                "agent_required_integrations_unique": len(agent_ints_norm),
                "agent_required_integrations": sorted(agent_ints_norm),
                "agents_total": n_agents,
                "agents_with_required_integrations": n_agents_with,
            },
            "notes": "; ".join(notes) if notes else "",
        }

    # Print compact JSON for the parent agent
    print(json.dumps(out, indent=2))

    # Also save to disk for reference
    out_path = WORK_DIR / "outputs" / "credits-integration-signals.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        json.dump(out, f, indent=2)


if __name__ == "__main__":
    main()

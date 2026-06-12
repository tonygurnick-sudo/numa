#!/usr/bin/env python3
"""
FEAT-127 — seed persona/industry test data on a dev stack.

Creates a labelled, deterministic test set so the audience filtering (agents
catalogue + chat picker, Ops board switcher, chat KB picker) can be exercised
end-to-end. Every filter rule is covered: untagged (always visible), single
persona, single industry, both, and a non-matching combo.

What it does for `arcanum-demo-tom` (account 905418183804, us-east-1):
  • Agents — creates 7 PUBLIC (workspace) agents, tagged. Public = shared with
    every workspace user incl. you.
  • KBs    — creates 7 SHARED knowledge bases (viewers = ['*']), tagged. Shared
    KBs are the ones the picker audience-filters.
  • Boards — TAGS the 4 existing boards (all accessControl.mode='all', shared).

Deterministic ids → re-running upserts (idempotent). Default is DRY RUN; pass
--apply to write. Pass --clean to delete the created agents/KBs and clear board
tags.

Usage:
  AWS_PROFILE=q-demo python3 tools/seed-feat127-test-data.py            # dry run
  AWS_PROFILE=q-demo python3 tools/seed-feat127-test-data.py --apply    # write
  AWS_PROFILE=q-demo python3 tools/seed-feat127-test-data.py --clean --apply
"""

import argparse
import time

import boto3

REGION = "us-east-1"
TENANT = "arcanum-demo-tom"
USER_SUB = "8458a428-3001-706b-caab-3b76207c65fb"  # tom.wiltshire@arcanum.ai
AGENTS_TABLE = f"numa-{TENANT}-agents"
KB_TABLE = f"numa-{TENANT}-knowledge-bases"
OPS_TABLE = f"{TENANT}-ops"

# (label, personas, industries). Shared across all three resource types so the
# run sheet reads the same everywhere. Designed for a profile of Finance +
# Manufacturing → rows 1,2,4,6 VISIBLE, rows 3,5,7 HIDDEN.
MATRIX = [
    ("Universal (untagged)", [], []),
    ("Finance", ["Finance"], []),
    ("HR", ["HR"], []),
    ("Manufacturing", [], ["Manufacturing"]),
    ("Construction", [], ["Construction"]),
    ("Finance x Manufacturing", ["Finance"], ["Manufacturing"]),
    ("CEO x Franchise", ["CEO"], ["Franchise"]),
]

# The 4 existing boards → one matrix row each (id : matrix index).
BOARD_TAGS = {
    "8d0ba592-dc33-4ca6-987a-eec8dcba32de": 2,  # Customer Support  → HR (hidden)
    "bdc64fde-e1dc-4f24-916a-da838f3e5388": 1,  # Sales Pipeline    → Finance (visible)
    "cdab06c3-f680-4f70-ba8b-69c7c0c5b32b": 3,  # Internal Ops      → Manufacturing (visible)
    "a32308a7-814b-4a22-abd0-928b986acf71": 6,  # Product Engineering → CEO x Franchise (hidden)
}


def agent_item(idx: int, label: str, personas: list, industries: list) -> dict:
    now = int(time.time() * 1000)
    return {
        "tenant_id": TENANT,
        "agent_id": f"agt_feat127_{idx:02d}",
        "visibility": "public",
        "title": f"[F127] {label}",
        "description": f"FEAT-127 test agent — audience: {label}",
        "system_prompt": "You are a FEAT-127 test agent. Be brief.",
        "agent_type": "task",
        "icon": "bi bi-robot",
        "required_integrations": [],
        "reference_files": [],
        "tags": [],
        "personas": personas,
        "industries": industries,
        "tools_config": {
            "autoToolsEnabled": True,
            "createAgentEnabled": False,
            "queryDataSources": True,
            "webSearchEnabled": True,
            "memoriesEnabled": False,
            "numaOpsEnabled": False,
            "enabledConnections": [],
            "allowedKnowledgeBases": None,
        },
        "created_by_user_id": USER_SUB,
        "user_id": USER_SUB,
        "created_by_name": "FEAT-127 Seed",
        "created_at": now,
        "updated_at": now,
        "version": now,
    }


def kb_item(idx: int, label: str, personas: list, industries: list) -> dict:
    kb_id = f"feat127-kb-{idx:02d}"
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return {
        "PK": f"TENANT#{TENANT}",
        "SK": f"KB#{kb_id}",
        "kb_id": kb_id,
        "kb_name": f"[F127] {label}",
        "status": "ACTIVE",
        "is_default": False,
        "created_by": USER_SUB,
        "viewers": {"*"},  # shared with everyone → lands in the picker's "shared" group
        "s3_prefix": f"documents/kb-{kb_id}/",
        "document_count": 0,
        # kb_manager stores tags as string sets when non-empty, else empty list.
        "personas": set(personas) if personas else [],
        "industries": set(industries) if industries else [],
        "created_at": now,
        "updated_at": now,
    }


def fmt(personas: list, industries: list) -> str:
    if not personas and not industries:
        return "(untagged)"
    return f"personas={personas or '[]'} industries={industries or '[]'}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--apply", action="store_true", help="write changes (default: dry run)"
    )
    ap.add_argument(
        "--clean", action="store_true", help="remove seeded data instead of creating it"
    )
    args = ap.parse_args()

    ddb = boto3.resource("dynamodb", region_name=REGION)
    agents, kbs, ops = (
        ddb.Table(AGENTS_TABLE),
        ddb.Table(KB_TABLE),
        ddb.Table(OPS_TABLE),
    )
    mode = "CLEAN" if args.clean else ("APPLY" if args.apply else "DRY RUN")
    print(f"\nFEAT-127 seed — tenant={TENANT}  mode={mode}\n")

    if args.clean:
        for idx in range(1, len(MATRIX) + 1):
            print(f"  delete agent agt_feat127_{idx:02d}")
            if args.apply:
                agents.delete_item(
                    Key={"tenant_id": TENANT, "agent_id": f"agt_feat127_{idx:02d}"}
                )
            print(f"  delete KB feat127-kb-{idx:02d}")
            if args.apply:
                kbs.delete_item(
                    Key={"PK": f"TENANT#{TENANT}", "SK": f"KB#feat127-kb-{idx:02d}"}
                )
        for board_id in BOARD_TAGS:
            print(f"  clear tags on board {board_id}")
            if args.apply:
                ops.update_item(
                    Key={"PK": f"TEAM#{board_id}", "SK": "META"},
                    UpdateExpression="SET personas = :e, industries = :e",
                    ExpressionAttributeValues={":e": []},
                )
        print("\nDone." + ("" if args.apply else "  (dry run — pass --apply)"))
        return

    print(f"AGENTS → {AGENTS_TABLE} (public, shared with all)")
    for i, (label, p, ind) in enumerate(MATRIX, start=1):
        print(f"  • [F127] {label:<24} {fmt(p, ind)}")
        if args.apply:
            agents.put_item(Item=agent_item(i, label, p, ind))

    print(f"\nKBs → {KB_TABLE} (shared, viewers=['*'])")
    for i, (label, p, ind) in enumerate(MATRIX, start=1):
        print(f"  • [F127] {label:<24} {fmt(p, ind)}")
        if args.apply:
            kbs.put_item(Item=kb_item(i, label, p, ind))

    print(f"\nBOARDS → {OPS_TABLE} (tag 4 existing)")
    for board_id, mi in BOARD_TAGS.items():
        label, p, ind = MATRIX[mi]
        print(f"  • {board_id}  → {label:<24} {fmt(p, ind)}")
        if args.apply:
            ops.update_item(
                Key={"PK": f"TEAM#{board_id}", "SK": "META"},
                UpdateExpression="SET personas = :p, industries = :i",
                ExpressionAttributeValues={":p": p, ":i": ind},
            )

    print("\nDone." + ("" if args.apply else "  (dry run — pass --apply to write)"))
    if args.apply:
        print(
            "\nNext: deploy the stack (so the Profile selectors + filtering ship), then set\n"
            "Profile → Persona=Finance, Industry=Manufacturing and check the three surfaces."
        )


if __name__ == "__main__":
    main()

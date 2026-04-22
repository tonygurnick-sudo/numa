#!/usr/bin/env python3
"""
One-time cleanup script for HQ Ops sprint data.

The sprint completion/activation code had a bug where TICKET_INDEX entities
(entityType='TICKET_INDEX') were filtered by entityType='TICKET', causing
zero tickets to be moved/rolled over/archived.

This script fixes the HQ Dev Team data:
1. Archives completed/ended tickets from sprint 2026-7
2. Rolls over incomplete 2026-7 tickets to sprint 2026-8
3. Moves 2026-8 backlog tickets to the board "To Do" stage

Usage:
  AWS_PROFILE=arcanum-prod-numa-demo AWS_REGION=us-east-1 python3 tools/fix-hq-sprint-data.py
"""

import json
from datetime import datetime, timezone

import boto3

TABLE = "hq-ops"
TEAM_ID = "81f2560d-617a-46a4-83dc-7608a6dafc37"
SPRINT_7_ID = "0e6f9457-dea0-465f-a3a5-02f395d0e820"
SPRINT_8_ID = "80e58aa7-cd52-464f-819c-aa28c1a951c0"

# Zone/stage IDs
BACKLOG_ZONE_ID = "5ff58a53-d6b2-4540-a337-c9197bfadecb"
BOARD_ZONE_ID = "26af7aed-ba6b-4c75-afa1-0e800f7fe3f9"
TODO_STAGE_ID = "a5e99e77-3ec1-4c1f-8406-d056d2f395a3"  # "To Do" (queued)

dynamo = boto3.resource("dynamodb")
table = dynamo.Table(TABLE)
ts = datetime.now(timezone.utc).isoformat()


def get_sprint_ticket_ids(sprint_id: str) -> list[str]:
    """Get ticket IDs from the WORKUNIT GSI2 index."""
    resp = table.query(
        IndexName="GSI2",
        KeyConditionExpression="GSI2PK = :pk AND begins_with(GSI2SK, :sk)",
        ExpressionAttributeValues={":pk": f"WORKUNIT#{sprint_id}", ":sk": "TICKET#"},
    )
    return [
        item["ticketId"]
        for item in resp.get("Items", [])
        if item.get("entityType") == "TICKET_INDEX"
    ]


def get_ticket(ticket_id: str) -> dict | None:
    """Get the actual ticket entity."""
    resp = table.get_item(Key={"PK": f"TEAM#{TEAM_ID}", "SK": f"TICKET#{ticket_id}"})
    return resp.get("Item")


def pad_order(order: int) -> str:
    return str(order).zfill(10)


def main():
    print("=" * 60)
    print("HQ Ops Sprint Data Cleanup")
    print("=" * 60)

    # ── Step 1: Process sprint 2026-7 tickets ──────────────────────
    print("\n--- Sprint 2026-7 tickets ---")
    sprint7_ids = get_sprint_ticket_ids(SPRINT_7_ID)
    print(f"Found {len(sprint7_ids)} ticket index items")

    archived_count = 0
    rollover_count = 0
    skipped_count = 0

    for tid in sprint7_ids:
        ticket = get_ticket(tid)
        if not ticket:
            print(f"  SKIP: {tid} - ticket entity not found")
            skipped_count += 1
            continue

        display_id = ticket.get("displayId", "?")
        status = ticket.get("statusType", "?")

        if status in ("completed", "ended"):
            # Archive it
            if ticket.get("archived"):
                print(f"  SKIP: {display_id} ({status}) - already archived")
                skipped_count += 1
                continue
            ticket["archived"] = True
            ticket["updatedAt"] = ts
            table.put_item(Item=ticket)
            print(f"  ARCHIVED: {display_id} ({status})")
            archived_count += 1
        else:
            # Rollover to sprint 2026-8
            ticket["workUnitId"] = SPRINT_8_ID
            ticket["updatedAt"] = ts
            table.put_item(Item=ticket)

            # Update the WORKUNIT index: delete old, create new
            try:
                table.delete_item(
                    Key={
                        "PK": f"TEAM#{TEAM_ID}",
                        "SK": f"TICKET#{tid}#IDX_WORKUNIT",
                    }
                )
            except Exception:
                pass

            table.put_item(
                Item={
                    "PK": f"TEAM#{TEAM_ID}",
                    "SK": f"TICKET#{tid}#IDX_WORKUNIT",
                    "GSI2PK": f"WORKUNIT#{SPRINT_8_ID}",
                    "GSI2SK": f"TICKET#{ts}#{tid}",
                    "entityType": "TICKET_INDEX",
                    "indexType": "IDX_WORKUNIT",
                    "ticketId": tid,
                    "teamId": TEAM_ID,
                    "workUnitId": SPRINT_8_ID,
                }
            )
            print(f"  ROLLOVER: {display_id} ({status}) -> 2026-8")
            rollover_count += 1

    print(
        f"\nSprint 2026-7 summary: {archived_count} archived, {rollover_count} rolled over, {skipped_count} skipped"
    )

    # ── Step 2: Move 2026-8 backlog tickets to board "To Do" ──────
    print("\n--- Sprint 2026-8: move backlog tickets to board ---")
    sprint8_ids = get_sprint_ticket_ids(SPRINT_8_ID)
    print(f"Found {len(sprint8_ids)} ticket index items")

    moved_count = 0

    for tid in sprint8_ids:
        ticket = get_ticket(tid)
        if not ticket:
            print(f"  SKIP: {tid} - ticket entity not found")
            continue

        display_id = ticket.get("displayId", "?")
        zone_id = ticket.get("zoneId", "")
        status = ticket.get("statusType", "?")

        if zone_id != BACKLOG_ZONE_ID:
            print(f"  SKIP: {display_id} ({status}) - already on board")
            continue

        # Move to board zone, "To Do" stage
        order = ticket.get("order", 10000)
        ticket["zoneId"] = BOARD_ZONE_ID
        ticket["stageId"] = TODO_STAGE_ID
        ticket["statusType"] = "queued"
        ticket["startedAt"] = ticket.get("startedAt") or ts
        ticket["GSI1SK"] = f"STAGE#{TODO_STAGE_ID}#ORDER#{pad_order(order)}#{tid}"
        ticket["updatedAt"] = ts
        table.put_item(Item=ticket)
        print(f"  MOVED: {display_id} ({status} -> queued/To Do)")
        moved_count += 1

    print(
        f"\nSprint 2026-8 summary: {moved_count} moved to board, {len(sprint8_ids) - moved_count} already on board"
    )

    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
One-time cleanup: hard delete SAL-137 through SAL-174 and reset the SAL counter to 136.

Ian created these 38 tickets in error while setting up the Sales board. They were soft-deleted
via the API (statusType: "deleted") but still exist in the database. This script removes them
completely and resets the prefix counter so the next ticket created is SAL-137.

Usage (dry run first, then for real):
  AWS_PROFILE=arcanum-prod-numa-demo AWS_REGION=us-east-1 python3 tools/hard-delete-sal-tickets.py
  AWS_PROFILE=arcanum-prod-numa-demo AWS_REGION=us-east-1 python3 tools/hard-delete-sal-tickets.py --apply
"""

import argparse
import sys

import boto3
from boto3.dynamodb.conditions import Key

TABLE = "hq-ops"
TEAM_ID = "0bd17602-34d1-4363-85c6-34fb020a289b"
TICKET_TYPE_ID = "tt-4f81c68a"
PREFIX = "SAL"
FIRST_BAD = 137
LAST_BAD = 174
RESET_TO = 136  # nextSequence after reset — next ticket will be SAL-137


def get_dynamo_table():
    dynamo = boto3.resource("dynamodb", region_name="us-east-1")
    return dynamo.Table(TABLE)


def lookup_ticket_by_display_id(table, display_id: str) -> dict | None:
    """Look up a ticket via GSI3 (TID#{displayId} pattern)."""
    resp = table.query(
        IndexName="GSI3",
        KeyConditionExpression=Key("GSI3PK").eq(f"TID#{display_id}"),
    )
    items = resp.get("Items", [])
    # Filter to ticket entities (not index records)
    tickets = [
        i
        for i in items
        if i.get("entityType") == "TICKET"
        or (
            i.get("PK", "").startswith("TEAM#")
            and i.get("SK", "").startswith("TICKET#")
            and "#IDX" not in i.get("SK", "")
        )
    ]
    return tickets[0] if tickets else None


def query_pk_prefix(table, pk: str, sk_prefix: str) -> list[dict]:
    """Query all items with a given PK and SK prefix."""
    items = []
    kwargs = dict(
        KeyConditionExpression=Key("PK").eq(pk) & Key("SK").begins_with(sk_prefix),
    )
    while True:
        resp = table.query(**kwargs)
        items.extend(resp.get("Items", []))
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek
    return items


def hard_delete_ticket(table, ticket: dict, dry_run: bool) -> int:
    """Delete all DynamoDB items for a ticket. Returns number of items deleted."""
    ticket_id = str(ticket["id"])
    team_pk = f"TEAM#{TEAM_ID}"
    ticket_pk = f"TICKET#{ticket_id}"

    # All items to delete
    to_delete = []

    # 1. Main ticket record
    to_delete.append({"PK": team_pk, "SK": f"TICKET#{ticket_id}"})

    # 2. Index items on the team partition
    for idx in ("IDX_ASSIGNEE", "IDX_CUSTOMER", "IDX_WORKUNIT", "IDX_PROJECT"):
        to_delete.append({"PK": team_pk, "SK": f"TICKET#{ticket_id}#{idx}"})

    # 3. Comments, links, audit entries on the ticket partition
    for sub_prefix in ("COMMENT#", "LINK#", "AUDIT#"):
        sub_items = query_pk_prefix(table, ticket_pk, sub_prefix)
        for item in sub_items:
            to_delete.append({"PK": str(item["PK"]), "SK": str(item["SK"])})

    if dry_run:
        print(
            f"  [DRY RUN] Would delete {len(to_delete)} items for {ticket['displayId']} ({ticket_id})"
        )
        return len(to_delete)

    # Execute deletes
    for key in to_delete:
        try:
            table.delete_item(Key=key)
        except Exception as e:
            # Index items (IDX_*) may not exist — that's fine
            if "IDX_" not in key["SK"]:
                print(f"  WARNING: Failed to delete {key}: {e}", file=sys.stderr)

    return len(to_delete)


def reset_prefix_counter(table, dry_run: bool):
    """Set the SAL nextSequence counter back to RESET_TO."""
    if dry_run:
        print(f"\n[DRY RUN] Would set PREFIX/SAL nextSequence = {RESET_TO}")
        return

    table.update_item(
        Key={"PK": "PREFIX", "SK": PREFIX},
        UpdateExpression="SET nextSequence = :val",
        ExpressionAttributeValues={":val": RESET_TO},
    )
    print(f"\nReset PREFIX/SAL nextSequence -> {RESET_TO}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually perform deletes (default is dry run)",
    )
    args = parser.parse_args()

    dry_run = not args.apply

    print("=" * 60)
    print(f"HQ Ops — Hard Delete SAL-{FIRST_BAD} through SAL-{LAST_BAD}")
    print(f"Mode: {'DRY RUN' if dry_run else '*** APPLYING ***'}")
    print("=" * 60)

    table = get_dynamo_table()

    display_ids = [f"SAL-{str(n).zfill(3)}" for n in range(FIRST_BAD, LAST_BAD + 1)]
    print(
        f"\nProcessing {len(display_ids)} tickets: {display_ids[0]} .. {display_ids[-1]}\n"
    )

    not_found = []
    wrong_team = []
    wrong_status = []
    deleted_count = 0
    total_items = 0

    for display_id in display_ids:
        ticket = lookup_ticket_by_display_id(table, display_id)

        if not ticket:
            print(f"  NOT FOUND: {display_id}")
            not_found.append(display_id)
            continue

        # Safety checks
        if str(ticket.get("teamId", "")) != TEAM_ID:
            print(f"  SKIP (wrong team): {display_id} — teamId={ticket.get('teamId')}")
            wrong_team.append(display_id)
            continue

        if str(ticket.get("statusType", "")) != "deleted":
            print(
                f"  SKIP (not soft-deleted): {display_id} — statusType={ticket.get('statusType')}"
            )
            wrong_status.append(display_id)
            continue

        items_removed = hard_delete_ticket(table, ticket, dry_run)
        total_items += items_removed
        deleted_count += 1
        if not dry_run:
            print(
                f"  DELETED: {display_id} ({ticket['id']}) — {items_removed} items removed"
            )

    print("\n" + "─" * 60)
    print(f"Tickets processed:  {deleted_count}/{len(display_ids)}")
    print(f"Total items:        {total_items}")
    if not_found:
        print(f"Not found ({len(not_found)}): {not_found}")
    if wrong_team:
        print(f"Wrong team ({len(wrong_team)}): {wrong_team}")
    if wrong_status:
        print(f"Wrong status ({len(wrong_status)}): {wrong_status}")

    reset_prefix_counter(table, dry_run)

    print("\n" + "=" * 60)
    print(
        "DONE" if not dry_run else "DRY RUN COMPLETE — re-run with --apply to execute"
    )
    print("=" * 60)


if __name__ == "__main__":
    main()

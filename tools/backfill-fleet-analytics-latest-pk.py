#!/usr/bin/env python3
"""
One-time backfill: stamp `latest_pk = "LATEST"` onto every existing
`SNAPSHOT#latest` row in the `numa-portal-fleet-analytics` table (deployer
account) so they enter the new sparse GSI `latest-snapshots-index`.

Why: the GSI is sparse — it indexes only rows that carry `latest_pk`. New
rollups stamp it (see persist.py), but rows written before the change lack the
attribute and won't appear in the index until rewritten. This backfills them so
the portal's fast Query path returns the full fleet immediately, rather than
waiting for the next nightly rollup.

Safe to run repeatedly — it skips rows that already have `latest_pk` and only
touches `SNAPSHOT#latest` rows (never the dated history).

Usage:
    AWS_PROFILE=arcanum-q-deployer-prod AWS_REGION=us-east-1 \
        python3 tools/backfill-fleet-analytics-latest-pk.py [--dry-run]
"""

from __future__ import annotations

import argparse
import os
import sys

import boto3
from botocore.exceptions import ClientError

TABLE_NAME = "numa-portal-fleet-analytics"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would change without writing.",
    )
    parser.add_argument(
        "--region",
        default=os.environ.get("AWS_REGION", "us-east-1"),
        help="AWS region (default: $AWS_REGION or us-east-1).",
    )
    args = parser.parse_args()

    profile = os.environ.get("AWS_PROFILE", "<default>")
    print(
        f"Profile={profile} region={args.region} table={TABLE_NAME} dry_run={args.dry_run}"
    )

    ddb = boto3.resource("dynamodb", region_name=args.region)
    table = ddb.Table(TABLE_NAME)

    scanned = 0
    latest_rows = 0
    already = 0
    updated = 0
    last_key: dict | None = None

    while True:
        scan_kwargs = {
            "FilterExpression": "sk = :latest",
            "ExpressionAttributeValues": {":latest": "SNAPSHOT#latest"},
            "ProjectionExpression": "clientName, sk, latest_pk",
        }
        if last_key:
            scan_kwargs["ExclusiveStartKey"] = last_key

        resp = table.scan(**scan_kwargs)
        for item in resp.get("Items", []):
            scanned += 1
            latest_rows += 1
            if item.get("latest_pk") == "LATEST":
                already += 1
                continue

            client_name = item["clientName"]
            if args.dry_run:
                print(f"  would stamp: {client_name}")
                updated += 1
                continue

            try:
                table.update_item(
                    Key={"clientName": client_name, "sk": "SNAPSHOT#latest"},
                    UpdateExpression="SET latest_pk = :pk",
                    ExpressionAttributeValues={":pk": "LATEST"},
                    # Belt-and-braces: only touch rows that still exist + lack it.
                    ConditionExpression="attribute_exists(clientName) AND attribute_not_exists(latest_pk)",
                )
                updated += 1
                print(f"  stamped: {client_name}")
            except ClientError as e:
                code = e.response.get("Error", {}).get("Code")
                if code == "ConditionalCheckFailedException":
                    # Raced with a rollup that already stamped it — fine.
                    already += 1
                else:
                    print(f"  ERROR stamping {client_name}: {e}", file=sys.stderr)
                    raise

        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break

    print(
        f"\nDone. latest rows={latest_rows}, "
        f"{'would update' if args.dry_run else 'updated'}={updated}, already_stamped={already}."
    )
    if not args.dry_run and updated:
        print(
            "The GSI populates asynchronously — give DynamoDB a few seconds, then reload the dashboard."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

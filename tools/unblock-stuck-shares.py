#!/usr/bin/env python3
"""Unblock shared-chat shares stuck at chat_status="pending".

Root cause: shared-nova-api's create_share set chat_status="pending" but never
fired the extraction that produces the {s3_key}.json sidecar the read path polls
for. This script does what the (now-fixed) create flow should have done: invokes
the deployed extract-content lambda for each stuck doc, then flips the share to
"ready" exactly as get_share_info would (writes shared/{uuid}/document_text.txt
and sets chat_status="ready" + document_text_key). Docs that extract to empty
text are flipped to "error" (so the client stops polling) rather than left stuck.

Usage:
  AWS_PROFILE=<client-profile> python3 tools/unblock-stuck-shares.py --client hq            # dry run
  AWS_PROFILE=<client-profile> python3 tools/unblock-stuck-shares.py --client hq --apply
Override table/lambda/region if the deployed names differ from the defaults.
"""

import argparse
import json
import sys

import boto3
from botocore.config import Config


def build_clients(region: str):
    session = boto3.Session(region_name=region)
    # Lambda RequestResponse can run up to the function's full timeout (≤900s);
    # raise the socket read timeout above it and disable retries so a slow
    # extraction is never silently re-invoked concurrently.
    lam_cfg = Config(read_timeout=900, connect_timeout=10, retries={"max_attempts": 0})
    return (
        session.client("dynamodb"),
        session.client("s3"),
        session.client("lambda", config=lam_cfg),
        session.client("sts"),
    )


def find_pending(ddb, table: str) -> list[dict]:
    items, kwargs = [], {"TableName": table}
    while True:
        resp = ddb.scan(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return [
        {
            "uuid": it["uuid"]["S"],
            "bucket": it.get("s3_bucket", {}).get("S", ""),
            "key": it.get("s3_key", {}).get("S", ""),
        }
        for it in items
        if it.get("chat_status", {}).get("S") == "pending"
    ]


def extract(lam, s3, lambda_name: str, bucket: str, key: str) -> str:
    """Synchronously invoke the extraction lambda; return joined page text."""
    output_key = f"{key}.json"
    resp = lam.invoke(
        FunctionName=lambda_name,
        InvocationType="RequestResponse",
        Payload=json.dumps(
            {
                "input_bucket": bucket,
                "input_key": key,
                "output_bucket": bucket,
                "output_key": output_key,
                "return_content": False,
            }
        ).encode(),
    )
    body = resp["Payload"].read().decode()
    if resp.get("FunctionError"):
        raise RuntimeError(f"extraction lambda error: {body}")
    obj = s3.get_object(Bucket=bucket, Key=output_key)
    doc = json.loads(obj["Body"].read())
    return "\n".join(p.get("text", "") for p in doc.get("pages", [])) + "\n"


def flip_ready(ddb, s3, table: str, uuid: str, bucket: str, text: str) -> str:
    text_key = f"shared/{uuid}/document_text.txt"
    s3.put_object(
        Bucket=bucket,
        Key=text_key,
        Body=text.encode("utf-8"),
        ContentType="text/plain; charset=utf-8",
    )
    ddb.update_item(
        TableName=table,
        Key={"uuid": {"S": uuid}},
        UpdateExpression="SET chat_status = :cs, document_text_key = :tk",
        ExpressionAttributeValues={":cs": {"S": "ready"}, ":tk": {"S": text_key}},
    )
    return text_key


def flip_error(ddb, table: str, uuid: str, msg: str) -> None:
    ddb.update_item(
        TableName=table,
        Key={"uuid": {"S": uuid}},
        UpdateExpression="SET chat_status = :cs, #s = :st, error_message = :err",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":cs": {"S": "error"},
            ":st": {"S": "error"},
            ":err": {"S": msg},
        },
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", default="hq", help="client name (default: hq)")
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument("--table", help="override (default: numa-{client}-shared)")
    ap.add_argument(
        "--extraction-lambda", help="override (default: {client}_extract-content)"
    )
    ap.add_argument("--apply", action="store_true", help="actually extract + flip")
    args = ap.parse_args()

    table = args.table or f"numa-{args.client}-shared"
    lambda_name = args.extraction_lambda or f"{args.client}_extract-content"
    ddb, s3, lam, sts = build_clients(args.region)

    ident = sts.get_caller_identity()
    print(f"Account {ident['Account']}  region {args.region}")
    print(f"Table {table}  extractor {lambda_name}\n")

    pending = find_pending(ddb, table)
    print(f"Found {len(pending)} pending share(s):")
    for p in pending:
        print(f"  {p['uuid']}  {p['bucket']}/{p['key']}")
    if not args.apply:
        print("\n(dry run — pass --apply to extract and flip)")
        return 0

    print("\nApplying...")
    ok, err, fail = 0, 0, 0
    for p in pending:
        try:
            text = extract(lam, s3, lambda_name, p["bucket"], p["key"])
            if not text.strip():
                flip_error(ddb, table, p["uuid"], "Extraction produced no text")
                print(f"  ⚠ {p['uuid']}  empty extraction -> flipped to error")
                err += 1
                continue
            tk = flip_ready(ddb, s3, table, p["uuid"], p["bucket"], text)
            print(f"  ✓ {p['uuid']}  ready  ({len(text)} chars -> {tk})")
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {p['uuid']}  FAILED: {e}")
            fail += 1
    print(f"\nDone: {ok} ready, {err} error, {fail} failed.")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())

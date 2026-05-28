"""Find and recover AgentCore runtime sessions that are stuck in the 403 state.

Background
----------
We've observed sessions (Eliot Sinclair, Signsgraphics, Chandler) where
`InvokeAgentRuntime` returns `RuntimeClientError: Received error (403) from
runtime`, but `StopRuntimeSession` on the same session_id returns 200 and the
session becomes usable again after a stop.

This script:
  1. Scans a client's workspace-chat-agent-proxy CloudWatch logs over a window
     for "(403) from runtime" errors.
  2. Extracts each distinct conversation_id whose proxy returned 500 in that
     window.
  3. Optionally calls StopRuntimeSession on each one (--apply).
  4. Verifies recovery by invoking the session right after stop.

Dry-run by default — pass --apply to actually call stop.

Usage:
    AWS_PROFILE=<client_profile> python3 recover-403-sessions.py \\
        --client eliotsinclair --hours 6
    AWS_PROFILE=<client_profile> python3 recover-403-sessions.py \\
        --client eliotsinclair --hours 6 --apply
    AWS_PROFILE=<client_profile> python3 recover-403-sessions.py \\
        --client eliotsinclair --session-ids conv-foo,conv-bar --apply
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Iterable

import boto3
from botocore.exceptions import ClientError

REGION_BY_CLIENT = {
    "eliotsinclair": "ap-southeast-2",
    "signsgraphics": "ap-southeast-2",
    "chandler": "ap-southeast-2",
    "hq": "us-east-1",
    # Add more as needed; tool also accepts --region override.
}


def _runtime_arn(client: str, region: str, account: str, runtime_suffix: str) -> str:
    return (
        f"arn:aws:bedrock-agentcore:{region}:{account}:"
        f"runtime/numa_{client.replace('-','_')}_workspace_chat-{runtime_suffix}"
    )


def find_403_conversations(
    *, logs_client, log_group: str, hours: int
) -> tuple[set[str], int]:
    """Return (set of conversation_ids that 500'd, count of 403 events)."""
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - hours * 3600 * 1000

    paginator = logs_client.get_paginator("filter_log_events")
    convs: set[str] = set()
    n_403 = 0

    for page in paginator.paginate(
        logGroupName=log_group,
        startTime=start_ms,
        endTime=end_ms,
        filterPattern='"Internal Server Error"',
    ):
        for ev in page.get("events", []):
            msg = ev.get("message", "")
            for match in re.findall(
                r"/(?:trace|files|runs|invocations)/?([a-f0-9-]+_\d+)?", msg
            ):
                if match:
                    convs.add(match)

    # Count 403 events separately
    for page in paginator.paginate(
        logGroupName=log_group,
        startTime=start_ms,
        endTime=end_ms,
        filterPattern='"(403) from runtime"',
    ):
        n_403 += len(page.get("events", []))

    return convs, n_403


def discover_runtime_arn(*, agentcore_control, name_prefix: str) -> str | None:
    """Find the AgentCore runtime ARN by name prefix (e.g., numa_eliotsinclair_workspace_chat)."""
    paginator = agentcore_control.get_paginator("list_agent_runtimes")
    for page in paginator.paginate():
        for rt in page.get("agentRuntimes", []):
            if rt.get("agentRuntimeName") == name_prefix:
                return rt.get("agentRuntimeArn")
    return None


def stop_and_verify(
    *,
    runtime_client,
    runtime_arn: str,
    session_id: str,
    user_sub: str,
    conversation_id: str,
    apply: bool,
) -> dict:
    """Stop the session and verify it now responds to invoke."""
    result: dict = {"session_id": session_id, "stop": None, "invoke": None}

    if not apply:
        result["stop"] = "skipped (dry-run)"
        result["invoke"] = "skipped (dry-run)"
        return result

    # Step 1: stop
    try:
        resp = (
            runtime_client.meta.client.stop_runtime_session(  # type: ignore[attr-defined]
                agentRuntimeArn=runtime_arn,
                runtimeSessionId=session_id,
            )
            if False
            else None
        )  # placeholder to keep linters quiet; real call below
        # Use the boto client directly:
        agentcore_data = boto3.client(
            "bedrock-agentcore", region_name=runtime_client.meta.region_name
        )
        stop_resp = agentcore_data.stop_runtime_session(
            agentRuntimeArn=runtime_arn,
            runtimeSessionId=session_id,
        )
        result["stop"] = f"OK statusCode={stop_resp.get('statusCode')}"
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ResourceNotFoundException":
            result["stop"] = "ResourceNotFoundException (session already gone — fine)"
        else:
            result["stop"] = f"ERROR {type(e).__name__}: {str(e)[:160]}"
            # Even if stop failed, still try invoke to see real state
    except Exception as e:
        result["stop"] = f"ERROR {type(e).__name__}: {str(e)[:160]}"

    # Step 2: verify with cheap /files
    payload = json.dumps(
        {
            "httpMethod": "POST",
            "httpPath": f"/files/{conversation_id}",
            "headers": {"authorization": "Bearer dummy", "x-user-sub": user_sub},
            "body": {},
        }
    ).encode()

    try:
        invoke_client = boto3.client(
            "bedrock-agentcore", region_name=runtime_client.meta.region_name
        )
        ir = invoke_client.invoke_agent_runtime(
            agentRuntimeArn=runtime_arn,
            runtimeSessionId=session_id,
            payload=payload,
            contentType="application/json",
            accept="application/json",
        )
        body = b"".join(
            c if isinstance(c, bytes) else c.get("payload", b"")
            for c in ir.get("response", [])
        )
        result["invoke"] = f"OK body={body[:120]!r}"
    except Exception as e:
        result["invoke"] = f"FAIL {type(e).__name__}: {str(e)[:200]}"

    return result


def parse_session_pieces(session_id: str) -> tuple[str, str] | None:
    """conv-{user_sub}_{ts} → (user_sub, conversation_id). Returns None on user-fallback."""
    m = re.match(r"^conv-([a-f0-9-]+_\d+)$", session_id)
    if not m:
        return None
    conv = m.group(1)
    # conv = {sub}_{ts} where sub itself is uuid-shaped with dashes
    sub_match = re.match(r"^([a-f0-9-]+)_\d+$", conv)
    if not sub_match:
        return None
    return sub_match.group(1), conv


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", required=True, help="Client name, e.g. eliotsinclair")
    ap.add_argument("--region", help="AWS region (auto from client if known)")
    ap.add_argument(
        "--hours", type=int, default=6, help="Hours back to scan logs (default 6)"
    )
    ap.add_argument(
        "--apply",
        action="store_true",
        help="Actually call StopRuntimeSession (default dry-run)",
    )
    ap.add_argument(
        "--session-ids",
        help="Comma-separated session_ids to stop directly, skipping log scan",
    )
    args = ap.parse_args()

    region = args.region or REGION_BY_CLIENT.get(args.client)
    if not region:
        print(
            f"ERROR: region not known for {args.client}; pass --region", file=sys.stderr
        )
        return 2

    print(
        f"Client: {args.client}    Region: {region}    Hours: {args.hours}    Apply: {args.apply}\n"
    )

    # Resolve runtime ARN
    agentcore_control = boto3.client("bedrock-agentcore-control", region_name=region)
    rt_name = f"numa_{args.client.replace('-', '_')}_workspace_chat"
    runtime_arn = discover_runtime_arn(
        agentcore_control=agentcore_control, name_prefix=rt_name
    )
    if not runtime_arn:
        print(f"ERROR: runtime '{rt_name}' not found in {region}", file=sys.stderr)
        return 3
    print(f"Runtime ARN: {runtime_arn}\n")

    runtime_client = boto3.client("bedrock-agentcore", region_name=region)

    if args.session_ids:
        session_ids = [s.strip() for s in args.session_ids.split(",") if s.strip()]
    else:
        log_group = f"/aws/lambda/{args.client}-workspace-chat-agent-proxy"
        logs_client = boto3.client("logs", region_name=region)
        print(f"Scanning {log_group} for 403s in last {args.hours}h ...")
        convs, n_403 = find_403_conversations(
            logs_client=logs_client, log_group=log_group, hours=args.hours
        )
        print(
            f"  → {n_403} '(403) from runtime' events; {len(convs)} distinct conversation_ids 500'd.\n"
        )
        if not convs:
            print("Nothing to do.")
            return 0
        session_ids = [f"conv-{c}" for c in sorted(convs)]

    print(f"Sessions to process ({len(session_ids)}):")
    for s in session_ids:
        print(f"  {s}")
    print()

    if not args.apply:
        print("DRY-RUN — re-run with --apply to actually call StopRuntimeSession.")
        return 0

    print("=" * 70)
    for sid in session_ids:
        pieces = parse_session_pieces(sid)
        if not pieces:
            print(
                f"SKIP {sid} (cannot parse user_sub/conv_id; fallback `user-*` session not handled)"
            )
            continue
        user_sub, conv_id = pieces
        print(f"\n>>> {sid}")
        r = stop_and_verify(
            runtime_client=runtime_client,
            runtime_arn=runtime_arn,
            session_id=sid,
            user_sub=user_sub,
            conversation_id=conv_id,
            apply=True,
        )
        print(f"    stop:   {r['stop']}")
        print(f"    invoke: {r['invoke']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

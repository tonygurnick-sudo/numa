"""Scan ALL Numa client stacks for AgentCore 403'd sessions and optionally recover.

Reads the client list from numa-client-config in the deployer account, assumes
the ArcanumAIAccess role into each client account in parallel, scans the
workspace-chat-agent-proxy log group for "(403) from runtime" events, and
prints a per-stack summary.

With --apply, calls StopRuntimeSession on each broken session_id and verifies
recovery with a follow-up invoke (cheap /files read).

Run:
    AWS_PROFILE=arcanum-q-deployer-prod python3 scan-403-sessions-all-stacks.py
    AWS_PROFILE=arcanum-q-deployer-prod python3 scan-403-sessions-all-stacks.py --apply
    AWS_PROFILE=arcanum-q-deployer-prod python3 scan-403-sessions-all-stacks.py --hours 24 --workers 16
    AWS_PROFILE=arcanum-q-deployer-prod python3 scan-403-sessions-all-stacks.py --client eliotsinclair --apply
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import re
import sys
import time
from typing import Any

import boto3
from botocore.exceptions import ClientError

DEPLOYER_REGION = "us-east-1"
CONFIG_TABLE = "numa-client-config"
ROLE_NAME = "ArcanumAIAccess"


def list_chat_clients() -> list[dict]:
    """Pull all clients from numa-client-config that have workspace chat enabled
    (default true if attribute missing)."""
    ddb = boto3.client("dynamodb", region_name=DEPLOYER_REGION)
    paginator = ddb.get_paginator("scan")
    out: list[dict] = []
    for page in paginator.paginate(TableName=CONFIG_TABLE):
        for it in page.get("Items", []):
            name = it.get("clientName", {}).get("S")
            cfg = it.get("config", {}).get("M", {})
            wc = cfg.get("numaWorkspaceChat")
            enabled = True if wc is None else wc.get("BOOL", True)
            acct = cfg.get("clientAccountId", {}).get("S")
            region = cfg.get("region", {}).get("S", "us-east-1")
            if name and enabled and acct:
                out.append({"name": name, "account": acct, "region": region})
    return out


def assume_role(
    account_id: str, *, session_name: str = "scan-403-sessions"
) -> boto3.Session:
    sts = boto3.client("sts")
    resp = sts.assume_role(
        RoleArn=f"arn:aws:iam::{account_id}:role/{ROLE_NAME}",
        RoleSessionName=session_name,
    )
    creds = resp["Credentials"]
    return boto3.Session(
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
    )


def scan_client(client: dict, *, hours: int, apply: bool) -> dict:
    name = client["name"]
    account = client["account"]
    region = client["region"]
    log_group = f"/aws/lambda/{name}-workspace-chat-agent-proxy"
    result: dict[str, Any] = {
        "name": name,
        "account": account,
        "region": region,
        "events_403": 0,
        "sessions": [],
        "applied": [],
        "error": None,
    }

    try:
        sess = assume_role(account, session_name=f"scan403-{name[:30]}")
    except Exception as e:
        result["error"] = f"assume-role failed: {type(e).__name__}: {str(e)[:120]}"
        return result

    logs = sess.client("logs", region_name=region)

    end_ms = int(time.time() * 1000)
    start_ms = end_ms - hours * 3600 * 1000

    convs: set[str] = set()
    n_403 = 0

    # Pagination — 403-from-runtime events to count + 500-Internal-Server-Error
    # lines to extract conversation ids from the URL path.
    try:
        for page in logs.get_paginator("filter_log_events").paginate(
            logGroupName=log_group,
            startTime=start_ms,
            endTime=end_ms,
            filterPattern='"(403) from runtime"',
        ):
            n_403 += len(page.get("events", []))
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code == "ResourceNotFoundException":
            result["error"] = "log group missing (no workspace chat deployed?)"
            return result
        result["error"] = f"logs filter failed: {code}"
        return result
    except Exception as e:
        result["error"] = f"logs filter failed: {type(e).__name__}"
        return result

    result["events_403"] = n_403
    if n_403 == 0:
        return result

    # Extract conv ids
    try:
        for page in logs.get_paginator("filter_log_events").paginate(
            logGroupName=log_group,
            startTime=start_ms,
            endTime=end_ms,
            filterPattern='"Internal Server Error"',
        ):
            for ev in page.get("events", []):
                for match in re.findall(
                    r"/(?:trace|files|runs|invocations)/?([a-f0-9-]+_\d+)",
                    ev.get("message", ""),
                ):
                    convs.add(match)
    except Exception:
        pass

    result["sessions"] = sorted(convs)

    if not apply or not convs:
        return result

    # Resolve runtime ARN once
    try:
        ac_control = sess.client("bedrock-agentcore-control", region_name=region)
        rt_name = f"numa_{name.replace('-', '_')}_workspace_chat"
        runtime_arn = None
        for page in ac_control.get_paginator("list_agent_runtimes").paginate():
            for rt in page.get("agentRuntimes", []):
                if rt.get("agentRuntimeName") == rt_name:
                    runtime_arn = rt.get("agentRuntimeArn")
                    break
            if runtime_arn:
                break
        if not runtime_arn:
            result["error"] = f"runtime '{rt_name}' not found"
            return result
    except Exception as e:
        result["error"] = f"runtime lookup failed: {type(e).__name__}"
        return result

    ac_data = sess.client("bedrock-agentcore", region_name=region)
    for conv_id in sorted(convs):
        session_id = f"conv-{conv_id}"
        # user_sub is the first chunk of conv_id (before final `_<ts>`)
        sub_match = re.match(r"^([a-f0-9-]+)_\d+$", conv_id)
        user_sub = sub_match.group(1) if sub_match else "unknown"

        entry: dict[str, Any] = {"session_id": session_id}

        try:
            ac_data.stop_runtime_session(
                agentRuntimeArn=runtime_arn,
                runtimeSessionId=session_id,
            )
            entry["stop"] = "OK"
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            entry["stop"] = (
                code if code == "ResourceNotFoundException" else f"FAIL {code}"
            )
        except Exception as e:
            entry["stop"] = f"FAIL {type(e).__name__}"

        # Verify with a cheap /files call
        payload = json.dumps(
            {
                "httpMethod": "POST",
                "httpPath": f"/files/{conv_id}",
                "headers": {"authorization": "Bearer dummy", "x-user-sub": user_sub},
                "body": {},
            }
        ).encode()
        try:
            r = ac_data.invoke_agent_runtime(
                agentRuntimeArn=runtime_arn,
                runtimeSessionId=session_id,
                payload=payload,
                contentType="application/json",
                accept="application/json",
            )
            # Drain
            for _ in r.get("response", []):
                pass
            entry["invoke_after"] = "OK"
        except Exception as e:
            entry["invoke_after"] = f"FAIL {type(e).__name__}: {str(e)[:120]}"

        result["applied"].append(entry)

    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--hours", type=int, default=12, help="Hours back to scan logs (default 12)"
    )
    ap.add_argument(
        "--workers", type=int, default=10, help="Parallel workers (default 10)"
    )
    ap.add_argument("--client", help="Only scan one client by name")
    ap.add_argument(
        "--apply",
        action="store_true",
        help="Actually call StopRuntimeSession (default dry-run)",
    )
    args = ap.parse_args()

    clients = list_chat_clients()
    if args.client:
        clients = [c for c in clients if c["name"] == args.client]
    if not clients:
        print("No clients matched.", file=sys.stderr)
        return 2
    print(
        f"Scanning {len(clients)} client(s), {args.hours}h back, {args.workers} workers, apply={args.apply}\n"
    )

    results: list[dict] = []
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(scan_client, c, hours=args.hours, apply=args.apply): c
            for c in clients
        }
        for f in cf.as_completed(futures):
            r = f.result()
            results.append(r)
            # Live progress
            done = len(results)
            if r["error"]:
                tag = f"ERROR: {r['error']}"
            elif r["events_403"] == 0:
                tag = "clean"
            else:
                tag = f"{r['events_403']} × 403 events, {len(r['sessions'])} broken sessions"
                if args.apply and r["applied"]:
                    recovered = sum(
                        1 for a in r["applied"] if a["invoke_after"] == "OK"
                    )
                    tag += f" — APPLIED, {recovered}/{len(r['applied'])} verified OK"
            print(f"  [{done:3d}/{len(clients)}] {r['name']:30s}  {tag}")

    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    broken = [r for r in results if r["events_403"] > 0]
    errored = [r for r in results if r["error"]]
    clean = [r for r in results if not r["error"] and r["events_403"] == 0]

    print(f"  Clean stacks:           {len(clean)}")
    print(f"  Stacks with 403s:       {len(broken)}")
    print(f"  Stacks with scan errors:{len(errored)}")
    total_events = sum(r["events_403"] for r in broken)
    total_sessions = sum(len(r["sessions"]) for r in broken)
    print(f"  Total 403 events:       {total_events}")
    print(f"  Total broken sessions:  {total_sessions}")

    if broken:
        print("\nBroken stacks (sorted by event count):")
        for r in sorted(broken, key=lambda x: -x["events_403"]):
            print(
                f"  {r['name']:30s}  {r['events_403']:>5d} × 403 events  {len(r['sessions']):>3d} sessions  ({r['region']})"
            )
            if args.apply and r["applied"]:
                ok = sum(1 for a in r["applied"] if a["invoke_after"] == "OK")
                print(
                    f"      → applied: {ok}/{len(r['applied'])} sessions verified OK after stop"
                )

    if errored:
        print("\nScan errors:")
        for r in errored:
            print(f"  {r['name']:30s}  {r['error']}")

    # Save full JSON for further analysis
    with open("/tmp/403-scan-results.json", "w") as f:
        json.dump(results, f, indent=2, default=str)
    print("\nFull results: /tmp/403-scan-results.json")

    return 0


if __name__ == "__main__":
    sys.exit(main())

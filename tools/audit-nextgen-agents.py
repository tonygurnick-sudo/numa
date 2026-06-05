#!/usr/bin/env python3
"""Audit public (workspace) agents across all nextgen-managed client accounts.

For each active account in the nextgen-management AWS Organization:
  1. Assume OrganizationAccountAccessRole
  2. Find DynamoDB tables matching the public agents convention (`*-agents`,
     excluding user-agents / settings / schedules) across candidate regions
  3. Scan and collect agent title / id / visibility

Output: JSON to /tmp/nextgen_agents_result.json and a console summary.
"""

import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
from botocore.config import Config

PRM = Config(retries={"max_attempts": 4, "mode": "standard"})
ROLE = "OrganizationAccountAccessRole"
REGIONS = ["us-east-1", "ap-southeast-2", "ap-southeast-3"]
# table suffixes to EXCLUDE (we only want the public workspace agents table {client}-agents)
EXCLUDE_SUFFIXES = (
    "-user-agents",
    "-agents-settings",
    "-agent-schedules",
    "-agent-teams",
    "-agent-team-members",
    "-agent-sharing",
    "-agent-user-prefs",
)

base = boto3.Session(profile_name="nextgen-management")
sts = base.client("sts", config=PRM)


def is_public_agents_table(name: str) -> bool:
    if not name.endswith("-agents"):
        return False
    if any(name.endswith(s) for s in EXCLUDE_SUFFIXES):
        return False
    return True


def creds_for(account_id: str):
    r = sts.assume_role(
        RoleArn=f"arn:aws:iam::{account_id}:role/{ROLE}",
        RoleSessionName="agent-audit",
    )["Credentials"]
    return dict(
        aws_access_key_id=r["AccessKeyId"],
        aws_secret_access_key=r["SecretAccessKey"],
        aws_session_token=r["SessionToken"],
    )


def scan_table(ddb, table):
    agents = []
    kwargs = {"TableName": table}
    while True:
        resp = ddb.scan(**kwargs)
        for it in resp.get("Items", []):

            def g(k):
                v = it.get(k)
                if v is None:
                    return None
                return v.get("S") or v.get("N") or v.get("BOOL")

            agents.append(
                {
                    "title": g("title") or g("name") or "(untitled)",
                    "agent_id": g("agent_id") or g("agentId") or g("id"),
                    "visibility": g("visibility"),
                    "created_by": g("created_by")
                    or g("createdBy")
                    or g("user_id")
                    or g("owner"),
                    "tenant_id": g("tenant_id"),
                    "table": table,
                }
            )
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek
    return agents


def process(acct):
    name, aid = acct["Name"], acct["Id"]
    out = {
        "name": name,
        "id": aid,
        "agents": [],
        "tables": [],
        "error": None,
        "region": None,
    }
    # skip the management account itself
    if aid == "282304106064":
        out["error"] = "management-account-skip"
        return out
    try:
        c = creds_for(aid)
    except Exception as e:
        out["error"] = f"assume-role-failed: {type(e).__name__}: {str(e)[:120]}"
        return out
    sess = boto3.Session(**c)
    seen_ids = set()
    for region in REGIONS:
        try:
            ddb = sess.client("dynamodb", region_name=region, config=PRM)
            tables = []
            paginator = ddb.get_paginator("list_tables")
            for page in paginator.paginate():
                tables.extend(page["TableNames"])
        except Exception as e:
            continue
        pub_tables = [t for t in tables if is_public_agents_table(t)]
        if not pub_tables:
            continue
        out["region"] = region
        for t in pub_tables:
            try:
                ags = scan_table(ddb, t)
            except Exception as e:
                out["tables"].append(
                    {"table": t, "region": region, "error": str(e)[:120]}
                )
                continue
            out["tables"].append({"table": t, "region": region, "count": len(ags)})
            for a in ags:
                key = a.get("agent_id") or (a.get("title"), t)
                if key in seen_ids:
                    continue
                seen_ids.add(key)
                out["agents"].append(a)
        # found the deploy region; stop probing further regions
        break
    return out


def main():
    accounts = json.load(open("/tmp/nextgen_accounts.json"))
    results = []
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(process, a): a for a in accounts}
        done = 0
        for f in as_completed(futs):
            res = f.result()
            results.append(res)
            done += 1
            n = len(res["agents"])
            flag = ""
            if res["error"] and res["error"] not in ("management-account-skip",):
                flag = f"  !! {res['error']}"
            print(
                f"[{done:3}/{len(accounts)}] {res['name']:<28} agents={n}{flag}",
                file=sys.stderr,
            )
    results.sort(key=lambda r: (-len(r["agents"]), r["name"]))
    json.dump(results, open("/tmp/nextgen_agents_result.json", "w"), indent=2)
    print("\nWROTE /tmp/nextgen_agents_result.json", file=sys.stderr)


if __name__ == "__main__":
    main()

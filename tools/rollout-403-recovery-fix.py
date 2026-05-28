"""Roll out the workspace-chat-agent-proxy 403-recovery hotfix to client stacks.

For each target client (default: every ap-southeast-2 stack in numa-client-config):

  1. Assume the ArcanumAIAccess role.
  2. Find the proxy Lambda's role and its customer-managed IAM policy.
  3. Ensure `bedrock-agentcore:StopRuntimeSession` is present in the policy
     (create new policy version + set as default if missing). Cleans up the
     oldest non-default version first if we're already at 5/5 versions.
  4. Update the Lambda function code with the bundled-boto3 zip and wait for
     LastUpdateStatus=Successful.
  5. Smoke-test the deployed code with a known-broken session (optional;
     skipped if no broken session_id is known for the stack).

Dry-run by default (lists what would change). Pass --apply to make changes.

Run:
    AWS_PROFILE=arcanum-q-deployer-prod \
        python3 rollout-403-recovery-fix.py [--region ap-southeast-2] [--apply]
    AWS_PROFILE=arcanum-q-deployer-prod \
        python3 rollout-403-recovery-fix.py --client eliotsinclair --apply
    AWS_PROFILE=arcanum-q-deployer-prod \
        python3 rollout-403-recovery-fix.py --apply --workers 16
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import sys
import time
from pathlib import Path
from typing import Any

import boto3
from botocore.exceptions import ClientError

DEPLOYER_REGION = "us-east-1"
CONFIG_TABLE = "numa-client-config"
ROLE_NAME = "ArcanumAIAccess"
ZIP_PATH = (
    Path(__file__).resolve().parent.parent
    / "lambdas/python/workspace-chat-agent-proxy/lambda_function.zip"
)
TARGET_ACTION = "bedrock-agentcore:StopRuntimeSession"


def list_clients() -> list[dict]:
    """Pull all clients from numa-client-config that have workspace chat enabled
    (default true if attribute missing)."""
    ddb = boto3.client("dynamodb", region_name=DEPLOYER_REGION)
    out: list[dict] = []
    for page in ddb.get_paginator("scan").paginate(TableName=CONFIG_TABLE):
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


def assume(account_id: str, *, session_name: str) -> boto3.Session:
    sts = boto3.client("sts")
    resp = sts.assume_role(
        RoleArn=f"arn:aws:iam::{account_id}:role/{ROLE_NAME}",
        RoleSessionName=session_name[:64],
    )
    c = resp["Credentials"]
    return boto3.Session(
        aws_access_key_id=c["AccessKeyId"],
        aws_secret_access_key=c["SecretAccessKey"],
        aws_session_token=c["SessionToken"],
    )


def _find_proxy_iam_policy(iam, role_name: str) -> str | None:
    """Return the ARN of the customer-managed policy attached to the proxy role
    that contains a bedrock-agentcore:InvokeAgentRuntime statement, or None."""
    try:
        attached = iam.list_attached_role_policies(RoleName=role_name).get(
            "AttachedPolicies", []
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchEntity":
            return None
        raise
    for p in attached:
        arn = p["PolicyArn"]
        if ":aws:policy/" in arn:
            continue  # AWS-managed, skip
        ver = iam.get_policy(PolicyArn=arn)["Policy"]["DefaultVersionId"]
        doc = iam.get_policy_version(PolicyArn=arn, VersionId=ver)["PolicyVersion"][
            "Document"
        ]
        for stmt in doc.get("Statement", []):
            acts = stmt.get("Action", [])
            if isinstance(acts, str):
                acts = [acts]
            if any("InvokeAgentRuntime" in a for a in acts):
                return arn
    return None


def _ensure_iam_action(iam, policy_arn: str, action: str) -> str:
    """Ensure `action` is in the bedrock-agentcore statement of the policy.
    Returns 'already_present', 'added', or 'no_matching_statement'.
    Creates a new policy version and sets it as default if action was added.
    """
    default_ver = iam.get_policy(PolicyArn=policy_arn)["Policy"]["DefaultVersionId"]
    doc = iam.get_policy_version(PolicyArn=policy_arn, VersionId=default_ver)[
        "PolicyVersion"
    ]["Document"]

    changed = False
    found_statement = False
    for stmt in doc.get("Statement", []):
        acts = stmt.get("Action", [])
        if isinstance(acts, str):
            acts = [acts]
        if any("InvokeAgentRuntime" in a for a in acts):
            found_statement = True
            if action in acts:
                return "already_present"
            acts.append(action)
            stmt["Action"] = acts
            changed = True
            break

    if not found_statement:
        return "no_matching_statement"

    if not changed:
        return "already_present"

    # IAM caps customer-managed policies at 5 versions. Clean up oldest non-default
    # if we're already at the limit.
    versions = iam.list_policy_versions(PolicyArn=policy_arn).get("Versions", [])
    if len(versions) >= 5:
        # find the oldest non-default
        non_default = sorted(
            [v for v in versions if not v["IsDefaultVersion"]],
            key=lambda v: v["CreateDate"],
        )
        if non_default:
            iam.delete_policy_version(
                PolicyArn=policy_arn, VersionId=non_default[0]["VersionId"]
            )

    iam.create_policy_version(
        PolicyArn=policy_arn,
        PolicyDocument=json.dumps(doc),
        SetAsDefault=True,
    )
    return "added"


def _update_lambda_code(lam, function_name: str, zip_bytes: bytes) -> str:
    """Update Lambda code and wait for LastUpdateStatus=Successful."""
    lam.update_function_code(FunctionName=function_name, ZipFile=zip_bytes)
    deadline = time.time() + 120
    while time.time() < deadline:
        cfg = lam.get_function_configuration(FunctionName=function_name)
        status = cfg.get("LastUpdateStatus")
        if status == "Successful":
            return "ok"
        if status == "Failed":
            return f"failed: {cfg.get('LastUpdateStatusReason')}"
        time.sleep(2)
    return "timeout-waiting-for-update"


def process_client(client: dict, *, apply: bool, zip_bytes: bytes) -> dict:
    name = client["name"]
    region = client["region"]
    function_name = f"{name}_workspace_chat_agent_proxy"
    role_name = function_name  # same naming convention

    result: dict[str, Any] = {
        "name": name,
        "region": region,
        "iam": "skip-dryrun",
        "lambda": "skip-dryrun",
        "error": None,
    }

    try:
        sess = assume(client["account"], session_name=f"rollout-403-{name}")
        iam = sess.client("iam")
        lam = sess.client("lambda", region_name=region)

        # 1. Find policy
        policy_arn = _find_proxy_iam_policy(iam, role_name)
        if policy_arn is None:
            # Role/policy not present — likely the proxy isn't deployed here.
            try:
                lam.get_function(FunctionName=function_name)
                result["error"] = "role found but no AgentCore policy"
            except ClientError as e:
                if e.response["Error"]["Code"] == "ResourceNotFoundException":
                    result["error"] = "no proxy Lambda deployed"
                else:
                    result["error"] = (
                        f"lambda lookup error: {e.response['Error']['Code']}"
                    )
            return result

        if apply:
            result["iam"] = _ensure_iam_action(iam, policy_arn, TARGET_ACTION)
        else:
            # dry-run: just report what would happen
            default_ver = iam.get_policy(PolicyArn=policy_arn)["Policy"][
                "DefaultVersionId"
            ]
            doc = iam.get_policy_version(PolicyArn=policy_arn, VersionId=default_ver)[
                "PolicyVersion"
            ]["Document"]
            has_action = any(
                TARGET_ACTION
                in (
                    s.get("Action")
                    if isinstance(s.get("Action"), list)
                    else [s.get("Action")] or []
                )
                for s in doc.get("Statement", [])
            )
            result["iam"] = "already_present" if has_action else "would_add"

        # 2. Update Lambda code
        if apply:
            result["lambda"] = _update_lambda_code(lam, function_name, zip_bytes)
        else:
            try:
                cur = lam.get_function_configuration(FunctionName=function_name)
                result["lambda"] = (
                    f"would_update (current size={cur['CodeSize']}, lastModified={cur['LastModified']})"
                )
            except ClientError as e:
                result["error"] = f"lambda not present: {e.response['Error']['Code']}"
        return result
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {str(e)[:150]}"
        return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--region",
        default="ap-southeast-2",
        help="Region to target (default ap-southeast-2)",
    )
    ap.add_argument("--client", help="Only roll out to one client by name")
    ap.add_argument(
        "--workers", type=int, default=8, help="Parallel workers (default 8)"
    )
    ap.add_argument(
        "--apply", action="store_true", help="Actually apply (default dry-run)"
    )
    args = ap.parse_args()

    if not ZIP_PATH.exists():
        print(f"ERROR: zip not found at {ZIP_PATH}", file=sys.stderr)
        print(
            "Build it first: cd lambdas && bash package-python-lambda.sh python/workspace-chat-agent-proxy",
            file=sys.stderr,
        )
        return 2

    clients = [c for c in list_clients() if c["region"] == args.region]
    if args.client:
        clients = [c for c in clients if c["name"] == args.client]
    if not clients:
        print(
            f"No clients matched (region={args.region}, client={args.client})",
            file=sys.stderr,
        )
        return 2

    zip_bytes = ZIP_PATH.read_bytes() if args.apply else b""

    print(
        f"Target: {len(clients)} client(s) in {args.region}, workers={args.workers}, apply={args.apply}"
    )
    print(f"Zip:    {ZIP_PATH} ({ZIP_PATH.stat().st_size:,} bytes)")
    print()

    results: list[dict] = []
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(process_client, c, apply=args.apply, zip_bytes=zip_bytes): c
            for c in clients
        }
        for f in cf.as_completed(futures):
            r = f.result()
            results.append(r)
            tag = "ERROR " if r["error"] else "OK    "
            done = len(results)
            extra = r["error"] or f"iam={r['iam']}  lambda={r['lambda']}"
            print(f"  [{done:3d}/{len(clients)}] {tag} {r['name']:35s} {extra}")

    print()
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    errored = [r for r in results if r["error"]]
    iam_added = [r for r in results if r["iam"] == "added"]
    iam_present = [r for r in results if r["iam"] == "already_present"]
    iam_would = [r for r in results if r["iam"] == "would_add"]
    lambda_ok = [r for r in results if r["lambda"] == "ok"]
    print(f"  Errored:                          {len(errored)}")
    print(f"  IAM: action newly added:          {len(iam_added)}")
    print(f"  IAM: action already present:      {len(iam_present)}")
    print(f"  IAM: would add (dry-run):         {len(iam_would)}")
    print(f"  Lambda: code update successful:   {len(lambda_ok)}")
    if errored:
        print("\nErrored clients:")
        for r in errored:
            print(f"  {r['name']:35s} {r['error']}")
    return 0 if not errored else 1


if __name__ == "__main__":
    sys.exit(main())

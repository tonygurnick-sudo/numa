#!/usr/bin/env python3
"""
Nolia production runs report.

Queries DynamoDB for all V2 app runs in nolia-id-gov-moh, then checks S3
for the real status (_result.json) since DynamoDB status is unreliable.

Outputs two TSV files:
  - nolia-assessments.tsv  (evaluation-report / terms-of-reference runs)
  - nolia-rules-gen.tsv    (rules generation runs)

Usage:
  AWS_PROFILE=nolia-moh python3 tools/nolia-runs-report.py
  AWS_PROFILE=nolia-moh python3 tools/nolia-runs-report.py --output-dir /tmp
"""

import argparse
import csv
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REGION = "ap-southeast-3"
TABLE = "nolia-id-gov-moh-v2-app-runs"
BUCKET = "numa-nolia-id-gov-moh-outputs"
NZDT = timezone(timedelta(hours=13))


def aws(*args, timeout=30):
    result = subprocess.run(
        ["aws", *args, "--region", REGION, "--output", "json"],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def utc_to_nz(iso_str):
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.astimezone(NZDT).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return iso_str[:16] if iso_str else ""


def check_s3_result(user_id, run_id):
    """Check S3 for _result.json. Returns (status, cost, duration_min, turns)."""
    s3_key = f"s3://{BUCKET}/v2-apps/nolia/{user_id}/{run_id}/_result.json"
    raw = aws("s3", "cp", s3_key, "-", timeout=15)
    if raw:
        try:
            d = json.loads(raw)
            u = d.get("usage", {})
            return (
                d.get("status", "?").upper(),
                u.get("total_cost_usd", 0),
                u.get("duration_ms", 0) / 60000,
                u.get("num_turns", 0),
            )
        except json.JSONDecodeError:
            pass

    # No _result.json -- check if any files exist at all
    ls_raw = aws(
        "s3", "ls", f"s3://{BUCKET}/v2-apps/nolia/{user_id}/{run_id}/", timeout=15
    )
    if ls_raw and ls_raw.strip():
        return ("STALLED", 0, 0, 0)
    return ("GHOST", 0, 0, 0)


def parse_dynamo_item(item):
    run_id = item.get("runId", {}).get("S", "")
    user_id = item.get("userId", {}).get("S", "")
    user_email = item.get("userEmail", {}).get("S", "")
    db_status = item.get("status", {}).get("S", "")
    created = item.get("createdAt", {}).get("S", "")
    completed = item.get("completedAt", {}).get("S", "")
    agent_type = item.get("agentType", {}).get("S", "")
    name = item.get("name", {}).get("S", "")

    inputs = item.get("inputs", {}).get("M", {})
    options = inputs.get("options", {}).get("M", {})
    metadata = options.get("metadata", {}).get("M", {})
    assess_type = metadata.get("assessment_type", {}).get("S", "")
    lang = metadata.get("output_language", {}).get("S", "")
    kb_cat = metadata.get("kb_category", {}).get("S", "")
    kb_name = metadata.get("kb_name", {}).get("S", "")
    global_kb = metadata.get("global_kb", {}).get("S", "")
    procurement_kb = metadata.get("procurement_kb", {}).get("S", "")
    project_kb = metadata.get("project_kb", {}).get("S", "")
    files = inputs.get("files", {}).get("L", [])
    filename = files[0].get("S", "") if files else ""

    # Cost from DB result (for runs where DB status is correct)
    db_result = item.get("result", {}).get("M", {})
    db_usage = db_result.get("usage", {}).get("M", {})
    db_cost = float(db_usage.get("total_cost_usd", {}).get("N", "0"))
    db_dur = float(db_usage.get("duration_ms", {}).get("N", "0"))
    db_turns = db_usage.get("num_turns", {}).get("N", "")

    is_rules_gen = bool(kb_cat) or "rules" in agent_type

    return {
        "run_id": run_id,
        "user_id": user_id,
        "user_email": user_email,
        "db_status": db_status,
        "created_utc": created,
        "completed_utc": completed,
        "agent_type": agent_type,
        "name": name,
        "assessment_type": assess_type,
        "language": lang,
        "filename": filename,
        "kb_category": kb_cat,
        "kb_name": kb_name,
        "global_kb": global_kb,
        "procurement_kb": procurement_kb,
        "project_kb": project_kb,
        "db_cost": db_cost,
        "db_dur_ms": db_dur,
        "db_turns": db_turns,
        "is_rules_gen": is_rules_gen,
    }


def main():
    parser = argparse.ArgumentParser(description="Nolia production runs report")
    parser.add_argument(
        "--output-dir",
        default="tools/test-reports",
        help="Directory for output files (default: tools/test-reports)",
    )
    args = parser.parse_args()

    if not os.environ.get("AWS_PROFILE"):
        print("ERROR: Set AWS_PROFILE=nolia-moh before running", file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Scan all runs
    print("Scanning DynamoDB...", file=sys.stderr)
    raw = aws("dynamodb", "scan", "--table-name", TABLE)
    if not raw:
        print("ERROR: Failed to scan DynamoDB", file=sys.stderr)
        sys.exit(1)

    data = json.loads(raw)
    items = data.get("Items", [])
    print(f"Found {len(items)} runs", file=sys.stderr)

    runs = [parse_dynamo_item(item) for item in items]
    runs.sort(key=lambda x: x["created_utc"], reverse=True)

    # Check S3 for real status
    for i, run in enumerate(runs):
        label = run["run_id"][:8]
        print(
            f"\r  Checking S3 [{i+1}/{len(runs)}] {label}...", end="", file=sys.stderr
        )

        if run["db_cost"] > 0:
            run["real_status"] = run["db_status"]
            run["cost"] = run["db_cost"]
            run["duration_min"] = run["db_dur_ms"] / 60000
            run["turns"] = run["db_turns"]
        else:
            status, cost, dur_min, turns = check_s3_result(
                run["user_id"], run["run_id"]
            )
            run["real_status"] = status
            run["cost"] = cost
            run["duration_min"] = dur_min
            run["turns"] = str(turns) if turns else ""

        run["db_accurate"] = run["real_status"] == run["db_status"]

    print("", file=sys.stderr)

    # Split into assessments and rules gen
    assessments = [r for r in runs if not r["is_rules_gen"]]
    rules_gen = [r for r in runs if r["is_rules_gen"]]

    # Write assessments
    assess_path = output_dir / "nolia-assessments.tsv"
    assess_fields = [
        "NZ Time",
        "Status",
        "DB Status",
        "DB Accurate",
        "Assessment Type",
        "Language",
        "Document",
        "Cost (USD)",
        "Duration (min)",
        "Turns",
        "User ID",
        "User Email",
        "Global KB",
        "Procurement KB",
        "Project KB",
        "Run ID",
        "Created (UTC)",
    ]
    with open(assess_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=assess_fields, delimiter="\t")
        w.writeheader()
        for r in assessments:
            w.writerow(
                {
                    "NZ Time": utc_to_nz(r["created_utc"]),
                    "Status": r["real_status"],
                    "DB Status": r["db_status"],
                    "DB Accurate": "yes" if r["db_accurate"] else "NO",
                    "Assessment Type": r["assessment_type"],
                    "Language": r["language"],
                    "Document": r["filename"],
                    "Cost (USD)": f"{r['cost']:.2f}" if r["cost"] > 0 else "",
                    "Duration (min)": (
                        f"{r['duration_min']:.1f}" if r["duration_min"] > 0 else ""
                    ),
                    "Turns": r["turns"] if r["turns"] else "",
                    "User ID": r["user_id"],
                    "User Email": r["user_email"],
                    "Global KB": r["global_kb"],
                    "Procurement KB": r["procurement_kb"],
                    "Project KB": r["project_kb"],
                    "Run ID": r["run_id"],
                    "Created (UTC)": r["created_utc"],
                }
            )
    print(f"Wrote {len(assessments)} assessments to {assess_path}", file=sys.stderr)

    # Write rules gen
    rules_path = output_dir / "nolia-rules-gen.tsv"
    rules_fields = [
        "NZ Time",
        "Status",
        "DB Status",
        "DB Accurate",
        "KB Category",
        "KB Name",
        "Cost (USD)",
        "Duration (min)",
        "Turns",
        "User ID",
        "User Email",
        "Run ID",
        "Created (UTC)",
    ]
    with open(rules_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rules_fields, delimiter="\t")
        w.writeheader()
        for r in rules_gen:
            w.writerow(
                {
                    "NZ Time": utc_to_nz(r["created_utc"]),
                    "Status": r["real_status"],
                    "DB Status": r["db_status"],
                    "DB Accurate": "yes" if r["db_accurate"] else "NO",
                    "KB Category": r["kb_category"],
                    "KB Name": r["kb_name"],
                    "Cost (USD)": f"{r['cost']:.2f}" if r["cost"] > 0 else "",
                    "Duration (min)": (
                        f"{r['duration_min']:.1f}" if r["duration_min"] > 0 else ""
                    ),
                    "Turns": r["turns"] if r["turns"] else "",
                    "User ID": r["user_id"],
                    "User Email": r["user_email"],
                    "Run ID": r["run_id"],
                    "Created (UTC)": r["created_utc"],
                }
            )
    print(f"Wrote {len(rules_gen)} rules gen runs to {rules_path}", file=sys.stderr)

    # Print summary
    completed = [r for r in runs if r["real_status"] == "COMPLETED"]
    stalled = [r for r in runs if r["real_status"] == "STALLED"]
    ghosts = [r for r in runs if r["real_status"] == "GHOST"]
    db_wrong = [r for r in runs if not r["db_accurate"]]
    assess_costs = [
        r["cost"] for r in completed if r["cost"] > 10 and not r["is_rules_gen"]
    ]
    rules_costs = [r["cost"] for r in completed if r["cost"] > 0 and r["is_rules_gen"]]
    total_spend = sum(r["cost"] for r in runs if r["cost"] > 0)

    print(f"\n--- Summary ---", file=sys.stderr)
    print(f"Total runs:           {len(runs)}", file=sys.stderr)
    print(f"Completed:            {len(completed)}", file=sys.stderr)
    print(f"Stalled:              {len(stalled)}", file=sys.stderr)
    print(f"Ghost:                {len(ghosts)}", file=sys.stderr)
    print(f"DB status wrong:      {len(db_wrong)} / {len(runs)}", file=sys.stderr)
    if assess_costs:
        print(
            f"Assessment avg cost:  ${sum(assess_costs)/len(assess_costs):.2f} (n={len(assess_costs)})",
            file=sys.stderr,
        )
    if rules_costs:
        print(
            f"Rules gen avg cost:   ${sum(rules_costs)/len(rules_costs):.2f} (n={len(rules_costs)})",
            file=sys.stderr,
        )
    print(f"Total spend:          ${total_spend:.2f}", file=sys.stderr)


if __name__ == "__main__":
    main()

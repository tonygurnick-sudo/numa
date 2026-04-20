#!/usr/bin/env python3
"""
Autonomous Ops Agent Worker

This script bridges Numa Ops and Antigravity (or any Numa Workspace Agent).
It queries the Ops DynamoDB table for a specific ticket, pulls its context,
and generates a strict 5-iteration red-team prompt for the agent to execute.

Usage:
  python autonomous_ops_worker.py --display-id FEAT-123 --client numa-hq
"""

import argparse
import os
import sys
from textwrap import dedent

import boto3


def fetch_ticket_by_display_id(
    client_name: str, display_id: str, profile: str = None
) -> dict:
    table_name = f"{client_name}-ops"

    if profile:
        session = boto3.Session(profile_name=profile)
        dynamodb = session.resource("dynamodb")
    else:
        dynamodb = boto3.resource("dynamodb")

    table = dynamodb.Table(table_name)

    # Query using GSI2 which maps DISPLAYID to Ticket
    try:
        response = table.query(
            IndexName="GSI2",
            KeyConditionExpression="GSI2PK = :pk",
            ExpressionAttributeValues={":pk": f"DISPLAYID#{display_id}"},
        )
    except Exception as e:
        print(f"Error querying DynamoDB: {e}", file=sys.stderr)
        sys.exit(1)

    items = response.get("Items", [])
    if not items:
        print(f"No ticket found with Display ID: {display_id}", file=sys.stderr)
        sys.exit(1)

    # The GSI returns a lightweight version, we then do a GetItem on the main table using the SK.
    # The GSI Item looks like: GSI2PK="DISPLAYID#...", GSI2SK="TICKET#...", teamId=...
    ticket_gsi_item = items[0]

    # We need the TEAM ID and TICKET ID to query the primary index
    # But usually GSI2 projects ALL attributes, let's just return what we have.
    return items[0]


def fetch_next_queued_ticket(client_name: str, profile: str = None) -> dict:
    table_name = f"{client_name}-ops"
    dynamodb = (
        boto3.Session(profile_name=profile).resource("dynamodb")
        if profile
        else boto3.resource("dynamodb")
    )
    table = dynamodb.Table(table_name)

    response = table.scan(
        FilterExpression="entityType = :e AND statusType = :s",
        ExpressionAttributeValues={":e": "TICKET", ":s": "queued"},
    )
    items = response.get("Items", [])
    if not items:
        print(
            "No 'To Do' (queued) tickets currently exist in the backlog!",
            file=sys.stderr,
        )
        sys.exit(1)

    # Sort or just grab the first
    return items[0]


def assign_ticket(
    client_name: str, ticket: dict, assignee_email: str, profile: str = None
):
    table_name = f"{client_name}-ops"
    dynamodb = (
        boto3.Session(profile_name=profile).resource("dynamodb")
        if profile
        else boto3.resource("dynamodb")
    )
    table = dynamodb.Table(table_name)

    table.update_item(
        Key={"PK": ticket["PK"], "SK": ticket["SK"]},
        UpdateExpression="SET assigneeId = :a, assignedTo = :a",
        ExpressionAttributeValues={":a": assignee_email},
    )
    print(
        f"Ticket {ticket.get('displayId')} strictly assigned to {assignee_email} in DynamoDB.",
        file=sys.stderr,
    )


def build_agent_prompt(ticket: dict) -> str:
    title = ticket.get("title", "Unknown Title")
    description = ticket.get("description", "No description provided.")
    display_id = ticket.get("displayId", "UNKNOWN")
    reporter = ticket.get("reporterName", "Unknown")

    prompt = f"""
# ASSIGNED TICKET: {display_id}
**Title:** {title}
**Reporter:** {reporter}

## Description
{description}

---

# INSTRUCTIONS
You are to complete this ticket autonomously. You must strictly follow a 9-iteration Red-Team loop.
Do NOT stop until iteration 9 is complete. Proceed sequentially:

### Iteration 1: The Builder
Read the ticket context, search the codebase, and write the naive implementation. Get it compiling and working.

### Iteration 2: The Critic
Assume the first implementation is sloppy. Scrutinize the code for hardcoded variables, missing i18n strings, bypassing of PRM (Product Registration) boundaries, or poor architecture. Refactor it.

### Iteration 3: The QA Engineer
Actively try to break your own code. Write a quick local test script in `/scratch/` to mock data/endpoints or edge cases. Run your tests, or capture execution output (if UI changes are made, request screenshots or describe exactly how it renders). Save the PROOF OF WORK (e.g. test logs, execution output, or verification summaries) into a file named `mr_proof.md`.

### Iteration 4: The Performance Engineer
Audit the execution overhead. For backend: eliminate N+1 queries, ensure dynamoDB calls are targeted, and avoid unnecessary loops. For frontend: prevent unnecessary re-renders and check bundle sizes. Refactor where necessary.

### Iteration 5: The Security Reviewer
Validate your code diff. Ensure no PII is logged, no path traversal exists, and dangerous endpoints are authenticated.

### Iteration 6: The Accessibility & UX Expert
If you modified the frontend, ensure all new interactive elements have ARIA labels, semantic HTML tags, and check color logic. If backend or infrastructure, ensure graceful error states and readable error messages are bubbled up.

### Iteration 7: The Documentarian
Review the `CLAUDE.md` and any domain-specific documentation or `README.md` files. If your architecture or config changes deviate from existing docs, update the documentation files.

### Iteration 8: The Janitor
Clean up debug prints and ensure standard python/typescript docstrings.
Before creating the MR, you MUST:
1. Verify GitLab Authentication by running `glab auth status`. If this fails, halt and instruct the user to configure `GLAB_TOKEN` or run `glab auth login`.
2. `git fetch origin dev` and `git rebase origin/dev` to ensure your branch is up to date.
3. Run standard Numa linting checks (e.g. `make lint -j` or specific tests for your modified lambdas).
4. Create a detailed `mr_description.md` that summarizes what you built, why you built it, and embeds the proof from `mr_proof.md`.
Once tests and lints pass cleanly, execute `glab mr create --description-file mr_description.md` to open a Merge Request on GitLab against `dev`. Make sure to explicitly assign the GitLab MR to `{reporter}`.

### Iteration 9: The Auditor
Now that the Merge Request exists, immediately retrieve it using `glab mr view`. Read through the code diff and the MR description as if you were a Senior Staff Engineer evaluating a junior's work.
1. Does the code perfectly solve Ticket {display_id}?
2. Are the test outputs logically sound?
3. Is the description overly vague or missing the "why"?
If anything falls short, rewrite the description and update it using `glab mr update`, or push a new commit.
Finally, use the Numa Ops tool to move Ticket {display_id} to "QA" and add a comment linking to your MR.
"""
    return dedent(prompt).strip()


def main():
    parser = argparse.ArgumentParser(
        description="Generate autonomous agent loop for a Numa Ops ticket."
    )
    parser.add_argument(
        "--display-id",
        required=False,
        help="Ticket display ID (e.g. BUG-42). If omitted, use --auto-grab.",
    )
    parser.add_argument(
        "--auto-grab",
        action="store_true",
        help="Automatically grab the next available 'To Do' (queued) ticket.",
    )
    parser.add_argument(
        "--assignee",
        default="f4887418-a0e1-7070-cad6-a8ad89aae942",
        help="Backend User UUID to dynamically assign the grabbed ticket to.",
    )
    parser.add_argument(
        "--client",
        default="nd-labs",
        help="Client name prefix for DynamoDB (default: nd-labs)",
    )
    parser.add_argument(
        "--region", default="us-east-1", help="AWS Region (default: us-east-1)"
    )
    parser.add_argument(
        "--profile",
        default="q-demo",
        help="AWS Profile to use for boto3 authentication",
    )

    args = parser.parse_args()

    if not args.display_id and not args.auto_grab:
        parser.error("You must specify either --display-id or pass --auto-grab.")

    os.environ["AWS_DEFAULT_REGION"] = args.region

    if args.display_id:
        print(
            f"Fetching Ticket {args.display_id} from {args.client}-ops...",
            file=sys.stderr,
        )
        ticket = fetch_ticket_by_display_id(args.client, args.display_id, args.profile)
    else:
        print(
            f"Auto-grabbing next 'To Do' ticket from {args.client}-ops...",
            file=sys.stderr,
        )
        ticket = fetch_next_queued_ticket(args.client, args.profile)

    if args.assignee:
        assign_ticket(args.client, ticket, args.assignee, args.profile)

    prompt = build_agent_prompt(ticket)

    print("\n" + "=" * 80)
    print("READY FOR AGENT (Copy/Paste below or feed into AgentCore runtime)")
    print("=" * 80 + "\n")
    print(prompt)


if __name__ == "__main__":
    main()

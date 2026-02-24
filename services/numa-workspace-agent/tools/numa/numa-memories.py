#!/usr/bin/env python3
"""
Memory Management Tool for Numa Workspace Agent.

This is a thin wrapper that invokes the numa-chat-workspace-tools Lambda.
The Lambda handles all memory operations against the user's profile in DynamoDB.

Subcommands:
    list        List memories (optionally filtered by scope)
    add         Add a new memory
    update      Update an existing memory's content

Usage:
    python3 /workdir/tools/numa/numa-memories.py list
    python3 /workdir/tools/numa/numa-memories.py list --scope general
    python3 /workdir/tools/numa/numa-memories.py add --content "Prefers concise responses"
    python3 /workdir/tools/numa/numa-memories.py add --content "Jira Cloud ID: abc123" --scope "integration:jira"
    python3 /workdir/tools/numa/numa-memories.py update --memory-id mem_abc123 --content "Updated preference"

Examples:
    # List all memories
    python3 /workdir/tools/numa/numa-memories.py list

    # List only general memories
    python3 /workdir/tools/numa/numa-memories.py list --scope general

    # List integration-specific memories
    python3 /workdir/tools/numa/numa-memories.py list --scope "integration:jira"

    # Add a general memory
    python3 /workdir/tools/numa/numa-memories.py add --content "Prefers dark mode"

    # Add an integration-scoped memory
    python3 /workdir/tools/numa/numa-memories.py add \\
        --content "Jira Cloud ID: abc123-def456" \\
        --scope "integration:jira"

    # Add an agent-scoped memory
    python3 /workdir/tools/numa/numa-memories.py add \\
        --content "User wants weekly summaries from this agent" \\
        --scope "agent:agt_abc123"

    # Update a memory's content
    python3 /workdir/tools/numa/numa-memories.py update \\
        --memory-id mem_abc123 \\
        --content "Prefers concise bullet-point responses"
"""

import argparse
import json
import os
import sys

from helpers.credentials import get_local_lambda_client


def get_lambda_client_and_config():
    """Get Lambda client and common configuration from environment."""
    # Check if memories tool is enabled for this conversation
    enabled_tools = os.environ.get("NUMA_ENABLED_TOOLS", "")
    if enabled_tools and "memories_tool" not in enabled_tools:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": "Memory management is not enabled for this conversation. "
                    "Enable 'Update Memory' in chat settings to use this tool.",
                }
            )
        )
        sys.exit(1)

    lambda_name = os.environ.get("WORKSPACE_TOOLS_LAMBDA_NAME")
    if not lambda_name:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": "WORKSPACE_TOOLS_LAMBDA_NAME environment variable not set. "
                    "This tool must be run within the numa-workspace-agent environment.",
                }
            )
        )
        sys.exit(1)

    user_sub = os.environ.get("NUMA_USER_SUB", "")
    if not user_sub:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": "NUMA_USER_SUB environment variable not set. "
                    "User authentication is required for memory operations.",
                }
            )
        )
        sys.exit(1)

    # Parse enabled tools for Lambda-side validation
    enabled_tools_raw = os.environ.get("NUMA_ENABLED_TOOLS", "[]")
    try:
        allowed_tools = json.loads(enabled_tools_raw)
    except (json.JSONDecodeError, TypeError):
        allowed_tools = []

    return {
        "lambda_name": lambda_name,
        "user_sub": user_sub,
        "client": get_local_lambda_client(),
        "allowed_tools": allowed_tools,
    }


def invoke_lambda(config, payload):
    """Invoke Lambda and handle response."""
    try:
        response = config["client"].invoke(
            FunctionName=config["lambda_name"],
            InvocationType="RequestResponse",
            Payload=json.dumps(payload),
        )

        response_payload = json.loads(response["Payload"].read().decode("utf-8"))

        if "FunctionError" in response:
            print(
                json.dumps(
                    {
                        "status": "error",
                        "error": f"Lambda execution error: {response_payload}",
                    }
                )
            )
            sys.exit(1)

        return response_payload

    except Exception as e:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": f"Failed to invoke Lambda: {str(e)}",
                }
            )
        )
        sys.exit(1)


# =============================================================================
# LIST SUBCOMMAND
# =============================================================================


def cmd_list(args):
    """Execute the list subcommand."""
    config = get_lambda_client_and_config()

    params = {}
    if args.scope:
        params["scope"] = args.scope

    payload = {
        "tool": "user_profile_list_memories",
        "user_sub": config["user_sub"],
        "params": params,
        "allowed_tools": config["allowed_tools"],
    }

    response_payload = invoke_lambda(config, payload)
    print(json.dumps(response_payload, indent=2))

    if response_payload.get("status") == "error":
        sys.exit(1)


# =============================================================================
# ADD SUBCOMMAND
# =============================================================================


def cmd_add(args):
    """Execute the add subcommand."""
    config = get_lambda_client_and_config()

    params = {
        "content": args.content,
        "scope": args.scope,
    }

    payload = {
        "tool": "user_profile_add_memory",
        "user_sub": config["user_sub"],
        "params": params,
        "allowed_tools": config["allowed_tools"],
    }

    response_payload = invoke_lambda(config, payload)
    print(json.dumps(response_payload, indent=2))

    if response_payload.get("status") == "error":
        sys.exit(1)


# =============================================================================
# UPDATE SUBCOMMAND
# =============================================================================


def cmd_update(args):
    """Execute the update subcommand."""
    config = get_lambda_client_and_config()

    params = {
        "memory_id": args.memory_id,
        "content": args.content,
    }

    payload = {
        "tool": "user_profile_update_memory",
        "user_sub": config["user_sub"],
        "params": params,
        "allowed_tools": config["allowed_tools"],
    }

    response_payload = invoke_lambda(config, payload)
    print(json.dumps(response_payload, indent=2))

    if response_payload.get("status") == "error":
        sys.exit(1)


# =============================================================================
# MAIN
# =============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Numa Memory Management Tool - List, add, and update user memories",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # -------------------------------------------------------------------------
    # LIST subcommand
    # -------------------------------------------------------------------------
    list_parser = subparsers.add_parser(
        "list",
        help="List memories",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List all memories
  python3 numa-memories.py list

  # List only general memories
  python3 numa-memories.py list --scope general

  # List integration-specific memories
  python3 numa-memories.py list --scope "integration:jira"

  # List agent-specific memories
  python3 numa-memories.py list --scope "agent:agt_abc123"
""",
    )
    list_parser.add_argument(
        "--scope",
        "-s",
        help="Filter by scope (e.g., general, integration:jira, agent:agt_abc123). "
        "Omit to list all memories.",
    )
    list_parser.set_defaults(func=cmd_list)

    # -------------------------------------------------------------------------
    # ADD subcommand
    # -------------------------------------------------------------------------
    add_parser = subparsers.add_parser(
        "add",
        help="Add a new memory",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Add a general memory
  python3 numa-memories.py add --content "Prefers dark mode"

  # Add an integration-scoped memory
  python3 numa-memories.py add \\
      --content "Jira Cloud ID: abc123-def456" \\
      --scope "integration:jira"

  # Add an agent-scoped memory
  python3 numa-memories.py add \\
      --content "User wants weekly summaries" \\
      --scope "agent:agt_abc123"
""",
    )
    add_parser.add_argument(
        "--content",
        "-c",
        required=True,
        help="Memory content (max 300 characters)",
    )
    add_parser.add_argument(
        "--scope",
        "-s",
        default="general",
        help="Memory scope: general (default), integration:{slug}, or agent:{agentId}",
    )
    add_parser.set_defaults(func=cmd_add)

    # -------------------------------------------------------------------------
    # UPDATE subcommand
    # -------------------------------------------------------------------------
    update_parser = subparsers.add_parser(
        "update",
        help="Update an existing memory",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Update a memory's content
  python3 numa-memories.py update \\
      --memory-id mem_abc123 \\
      --content "Prefers concise bullet-point responses"
""",
    )
    update_parser.add_argument(
        "--memory-id",
        "-m",
        required=True,
        help="Memory ID to update (required)",
    )
    update_parser.add_argument(
        "--content",
        "-c",
        required=True,
        help="New memory content (max 300 characters)",
    )
    update_parser.set_defaults(func=cmd_update)

    # -------------------------------------------------------------------------
    # Parse and execute
    # -------------------------------------------------------------------------
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()

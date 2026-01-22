#!/usr/bin/env python3
"""
Agent Management Tool for Numa Workspace Agent.

This is a thin wrapper that invokes the numa-chat-workspace-tools Lambda.
The Lambda handles all agent operations.

Subcommands:
    list        List agents (owned, public, or all)
    get         Get agent details by ID
    create      Create a new agent (with optional file attachments)
    update      Update an existing agent (with optional file attachments)
    duplicate   Duplicate an agent to personal library

Usage:
    python3 /workdir/tools/numa/numa-agents.py list --scope owned
    python3 /workdir/tools/numa/numa-agents.py get --agent-id agt_abc123
    python3 /workdir/tools/numa/numa-agents.py create --title "My Agent" --system-prompt "..."
    python3 /workdir/tools/numa/numa-agents.py update --agent-id agt_abc123 --title "New Title"
    python3 /workdir/tools/numa/numa-agents.py duplicate --agent-id agt_abc123

Examples:
    # List your personal agents and agents you created
    python3 /workdir/tools/numa/numa-agents.py list --scope owned

    # List all public/workspace agents
    python3 /workdir/tools/numa/numa-agents.py list --scope public

    # Get details of a specific agent
    python3 /workdir/tools/numa/numa-agents.py get --agent-id agt_abc123

    # Create a personal agent
    python3 /workdir/tools/numa/numa-agents.py create \\
        --title "Customer Support Agent" \\
        --system-prompt "You are a helpful customer support assistant..."

    # Create a public/workspace agent with file attachments
    python3 /workdir/tools/numa/numa-agents.py create \\
        --title "Onboarding Assistant" \\
        --system-prompt "You help new employees navigate company resources." \\
        --visibility public \\
        --attach-file /workdir/uploads/handbook.pdf \\
        --attach-file /workdir/uploads/policies.docx

    # Update an agent's title
    python3 /workdir/tools/numa/numa-agents.py update \\
        --agent-id agt_abc123 \\
        --title "Updated Agent Name"

    # Update an agent with additional file attachments
    python3 /workdir/tools/numa/numa-agents.py update \\
        --agent-id agt_abc123 \\
        --attach-file /workdir/uploads/new_document.pdf

    # Duplicate a workspace agent to your personal library
    python3 /workdir/tools/numa/numa-agents.py duplicate --agent-id agt_abc123
"""

import argparse
import json
import os
import sys

from botocore.exceptions import ClientError

from helpers.credentials import get_local_lambda_client, get_local_s3_client

# S3 path configuration (must match Lambda's expectations)
S3_PREFIX = "numa-chat/workspace"
WORKSPACE_ROOT = "/workdir"


def _get_relative_path(file_path: str) -> str:
    """Extract relative path from absolute workspace path."""
    if file_path.startswith(WORKSPACE_ROOT + "/"):
        return file_path[len(WORKSPACE_ROOT) + 1 :]
    return file_path


def _get_s3_key_for_file(rel_path: str, user_sub: str, conversation_id: str) -> str:
    """Determine the S3 key for a workspace file."""
    # chat-workflows/ is globally persistent (not scoped to conversation)
    if rel_path.startswith("chat-workflows/"):
        return f"{S3_PREFIX}/{user_sub}/{rel_path}"
    # Everything else is conversation-scoped
    return f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/{rel_path}"


def ensure_file_in_s3(file_path: str, user_sub: str, conversation_id: str) -> None:
    """
    Upload local file to S3 if it doesn't exist there yet.

    This handles files created locally during the same chat session that haven't
    been synced to S3 yet (sync happens after chat completes, but tools need
    files in S3 during the chat).
    """
    # Check if file exists locally
    if not os.path.exists(file_path):
        return  # Nothing to upload, let Lambda handle the error

    outputs_bucket = os.environ.get("OUTPUTS_BUCKET_NAME", "")
    if not outputs_bucket:
        return  # Can't upload without bucket

    # Construct S3 key
    rel_path = _get_relative_path(file_path)
    s3_key = _get_s3_key_for_file(rel_path, user_sub, conversation_id)

    s3_client = get_local_s3_client()

    # Check if already exists in S3
    try:
        s3_client.head_object(Bucket=outputs_bucket, Key=s3_key)
        return  # Already exists
    except ClientError as e:
        if e.response["Error"]["Code"] != "404":
            raise  # Some other error, re-raise

    # Upload local file to S3
    with open(file_path, "rb") as f:
        s3_client.put_object(Bucket=outputs_bucket, Key=s3_key, Body=f.read())


def get_lambda_client_and_config():
    """Get Lambda client and common configuration from environment."""
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

    # Get user_sub for permission verification
    user_sub = os.environ.get("NUMA_USER_SUB", "")
    if not user_sub:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": "NUMA_USER_SUB environment variable not set. "
                    "User authentication is required for agent operations.",
                }
            )
        )
        sys.exit(1)

    # Get conversation_id for file attachment support
    conversation_id = os.environ.get("NUMA_CONVERSATION_ID", "")

    # Get enabled tools from environment (set by workspace agent for security)
    # This enforces that the LLM can only use tools enabled for this conversation
    enabled_tools_json = os.environ.get("NUMA_ENABLED_TOOLS", "[]")
    try:
        enabled_tools = json.loads(enabled_tools_json)
    except json.JSONDecodeError:
        enabled_tools = []

    return {
        "lambda_name": lambda_name,
        "user_sub": user_sub,
        "conversation_id": conversation_id,
        "enabled_tools": enabled_tools,
        "client": get_local_lambda_client(),
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


def check_agent_tools_enabled(config):
    """Check if agent tools are enabled, exit with error if not."""
    if "create_agent_tool" not in config["enabled_tools"]:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": "Agents tools are not enabled. "
                    "Enable 'Agent Creation' in settings.",
                }
            )
        )
        sys.exit(1)


def cmd_list(args):
    """Execute the list subcommand."""
    config = get_lambda_client_and_config()
    check_agent_tools_enabled(config)

    payload = {
        "tool": "list_agents",
        "user_sub": config["user_sub"],
        "allowed_tools": config["enabled_tools"],
        "params": {
            "scope": args.scope,
            "agent_type": args.agent_type,
        },
    }

    response_payload = invoke_lambda(config, payload)
    print(json.dumps(response_payload, indent=2))

    if response_payload.get("status") == "error":
        sys.exit(1)


# =============================================================================
# GET SUBCOMMAND
# =============================================================================


def cmd_get(args):
    """Execute the get subcommand."""
    config = get_lambda_client_and_config()
    check_agent_tools_enabled(config)

    payload = {
        "tool": "get_agent",
        "user_sub": config["user_sub"],
        "allowed_tools": config["enabled_tools"],
        "params": {
            "agent_id": args.agent_id,
        },
    }

    response_payload = invoke_lambda(config, payload)
    print(json.dumps(response_payload, indent=2))

    if response_payload.get("status") == "error":
        sys.exit(1)


# =============================================================================
# CREATE SUBCOMMAND
# =============================================================================


def cmd_create(args):
    """Execute the create subcommand."""
    config = get_lambda_client_and_config()
    check_agent_tools_enabled(config)

    # Build payload with required fields
    params = {
        "title": args.title,
        "systemPrompt": args.system_prompt,
        "visibility": args.visibility,
    }

    # Add optional fields if provided
    if args.description:
        params["description"] = args.description
    if args.agent_type:
        params["agentType"] = args.agent_type
    if args.welcome_message:
        params["userWelcomeMessage"] = args.welcome_message
    if args.time_saved is not None:
        params["estimatedTimeSavedMinutes"] = args.time_saved

    # Parse tools config if provided
    if args.tools_config:
        try:
            params["toolsConfig"] = json.loads(args.tools_config)
        except json.JSONDecodeError:
            print(
                json.dumps(
                    {
                        "status": "error",
                        "error": "Invalid JSON for --tools-config",
                    }
                )
            )
            sys.exit(1)

    # Handle file attachments
    attach_files = args.attach_file or []
    if attach_files:
        conversation_id = config["conversation_id"]
        if not conversation_id:
            print(
                json.dumps(
                    {
                        "status": "error",
                        "error": "NUMA_CONVERSATION_ID environment variable not set. "
                        "Conversation context is required to attach files.",
                    }
                )
            )
            sys.exit(1)

        # Ensure each file exists in S3 before Lambda invocation
        for file_path in attach_files:
            ensure_file_in_s3(file_path, config["user_sub"], conversation_id)

        params["attachFiles"] = attach_files

    payload = {
        "tool": "create_agent",
        "user_sub": config["user_sub"],
        "allowed_tools": config["enabled_tools"],
        "conversation_id": config["conversation_id"],
        "params": params,
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
    check_agent_tools_enabled(config)

    params = {
        "agent_id": args.agent_id,
    }

    # Add optional fields if provided
    if args.title:
        params["title"] = args.title
    if args.system_prompt:
        params["systemPrompt"] = args.system_prompt
    if args.visibility:
        params["visibility"] = args.visibility
    if args.description:
        params["description"] = args.description
    if args.agent_type:
        params["agentType"] = args.agent_type
    if args.welcome_message:
        params["userWelcomeMessage"] = args.welcome_message
    if args.time_saved is not None:
        params["estimatedTimeSavedMinutes"] = args.time_saved

    # Parse tools config if provided
    if args.tools_config:
        try:
            params["toolsConfig"] = json.loads(args.tools_config)
        except json.JSONDecodeError:
            print(
                json.dumps(
                    {
                        "status": "error",
                        "error": "Invalid JSON for --tools-config",
                    }
                )
            )
            sys.exit(1)

    # Handle file attachments
    attach_files = args.attach_file or []
    if attach_files:
        conversation_id = config["conversation_id"]
        if not conversation_id:
            print(
                json.dumps(
                    {
                        "status": "error",
                        "error": "NUMA_CONVERSATION_ID environment variable not set. "
                        "Conversation context is required to attach files.",
                    }
                )
            )
            sys.exit(1)

        # Ensure each file exists in S3 before Lambda invocation
        for file_path in attach_files:
            ensure_file_in_s3(file_path, config["user_sub"], conversation_id)

        params["attachFiles"] = attach_files

    payload = {
        "tool": "update_agent",
        "user_sub": config["user_sub"],
        "allowed_tools": config["enabled_tools"],
        "conversation_id": config["conversation_id"],
        "params": params,
    }

    response_payload = invoke_lambda(config, payload)
    print(json.dumps(response_payload, indent=2))

    if response_payload.get("status") == "error":
        sys.exit(1)


# =============================================================================
# DUPLICATE SUBCOMMAND
# =============================================================================


def cmd_duplicate(args):
    """Execute the duplicate subcommand."""
    config = get_lambda_client_and_config()
    check_agent_tools_enabled(config)

    payload = {
        "tool": "duplicate_agent",
        "user_sub": config["user_sub"],
        "allowed_tools": config["enabled_tools"],
        "params": {
            "agent_id": args.agent_id,
        },
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
        description="Numa Agent Management Tool - Create, list, update, and duplicate agents",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # -------------------------------------------------------------------------
    # LIST subcommand
    # -------------------------------------------------------------------------
    list_parser = subparsers.add_parser(
        "list",
        help="List agents",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List your personal agents and agents you created
  python3 numa-agents.py list --scope owned

  # List all public/workspace agents
  python3 numa-agents.py list --scope public

  # List all agents you can access
  python3 numa-agents.py list --scope all

  # Filter by agent type
  python3 numa-agents.py list --scope owned --agent-type task
""",
    )
    list_parser.add_argument(
        "--scope",
        "-s",
        default="owned",
        choices=["owned", "public", "all"],
        help="Scope: owned (default), public, or all",
    )
    list_parser.add_argument(
        "--agent-type",
        "-t",
        help="Filter by agent type (e.g., task, knowledge)",
    )
    list_parser.set_defaults(func=cmd_list)

    # -------------------------------------------------------------------------
    # GET subcommand
    # -------------------------------------------------------------------------
    get_parser = subparsers.add_parser(
        "get",
        help="Get agent details by ID",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 numa-agents.py get --agent-id agt_abc123
""",
    )
    get_parser.add_argument(
        "--agent-id",
        "-a",
        required=True,
        help="Agent ID to retrieve",
    )
    get_parser.set_defaults(func=cmd_get)

    # -------------------------------------------------------------------------
    # CREATE subcommand
    # -------------------------------------------------------------------------
    create_parser = subparsers.add_parser(
        "create",
        help="Create a new agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Create a personal agent
  python3 numa-agents.py create \\
      --title "Customer Support Agent" \\
      --system-prompt "You are a helpful customer support assistant..."

  # Create a public/workspace agent
  python3 numa-agents.py create \\
      --title "Onboarding Assistant" \\
      --system-prompt "You help new employees navigate company resources." \\
      --visibility public \\
      --description "Helps new hires get started"

  # Create with file attachments
  python3 numa-agents.py create \\
      --title "Policy Expert" \\
      --system-prompt "You help answer questions about company policies." \\
      --attach-file /workdir/uploads/handbook.pdf \\
      --attach-file /workdir/uploads/policies.docx

  # Create with tools configuration
  python3 numa-agents.py create \\
      --title "Research Agent" \\
      --system-prompt "You help with research tasks." \\
      --tools-config '{"webSearchEnabled": true, "queryDataSources": true}'
""",
    )
    create_parser.add_argument(
        "--title",
        "-t",
        required=True,
        help="Agent display name (required)",
    )
    create_parser.add_argument(
        "--system-prompt",
        "-p",
        required=True,
        help="System prompt / core instructions (required)",
    )
    create_parser.add_argument(
        "--visibility",
        "-v",
        default="personal",
        choices=["personal", "public"],
        help="Visibility: personal (default) or public",
    )
    create_parser.add_argument(
        "--description",
        "-d",
        help="One-line description of the agent",
    )
    create_parser.add_argument(
        "--agent-type",
        default="task",
        help="Agent type label (default: task)",
    )
    create_parser.add_argument(
        "--welcome-message",
        "-w",
        help="Welcome message shown when agent starts",
    )
    create_parser.add_argument(
        "--time-saved",
        type=int,
        help="Estimated time saved in minutes",
    )
    create_parser.add_argument(
        "--tools-config",
        help="JSON tools configuration (e.g., '{\"webSearchEnabled\": true}')",
    )
    create_parser.add_argument(
        "--attach-file",
        "-f",
        action="append",
        help="Workspace file to attach (can be specified multiple times, max 5). "
        "Example: --attach-file /workdir/uploads/doc.pdf",
    )
    create_parser.set_defaults(func=cmd_create)

    # -------------------------------------------------------------------------
    # UPDATE subcommand
    # -------------------------------------------------------------------------
    update_parser = subparsers.add_parser(
        "update",
        help="Update an existing agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Update agent title
  python3 numa-agents.py update --agent-id agt_abc123 --title "New Title"

  # Update system prompt
  python3 numa-agents.py update --agent-id agt_abc123 \\
      --system-prompt "Updated instructions..."

  # Change visibility to public
  python3 numa-agents.py update --agent-id agt_abc123 --visibility public

  # Attach additional files to an existing agent
  python3 numa-agents.py update --agent-id agt_abc123 \\
      --attach-file /workdir/uploads/new_document.pdf

  # Update tools configuration
  python3 numa-agents.py update --agent-id agt_abc123 \\
      --tools-config '{"webSearchEnabled": true}'
""",
    )
    update_parser.add_argument(
        "--agent-id",
        "-a",
        required=True,
        help="Agent ID to update (required)",
    )
    update_parser.add_argument(
        "--title",
        "-t",
        help="New agent title",
    )
    update_parser.add_argument(
        "--system-prompt",
        "-p",
        help="New system prompt",
    )
    update_parser.add_argument(
        "--visibility",
        "-v",
        choices=["personal", "public"],
        help="Change visibility",
    )
    update_parser.add_argument(
        "--description",
        "-d",
        help="New description",
    )
    update_parser.add_argument(
        "--agent-type",
        help="New agent type",
    )
    update_parser.add_argument(
        "--welcome-message",
        "-w",
        help="New welcome message",
    )
    update_parser.add_argument(
        "--time-saved",
        type=int,
        help="New estimated time saved in minutes",
    )
    update_parser.add_argument(
        "--tools-config",
        help="JSON tools configuration",
    )
    update_parser.add_argument(
        "--attach-file",
        "-f",
        action="append",
        help="Workspace file to attach (can be specified multiple times, max 5 total). "
        "Note: Attached files are added to existing files. "
        "Example: --attach-file /workdir/uploads/doc.pdf",
    )
    update_parser.set_defaults(func=cmd_update)

    # -------------------------------------------------------------------------
    # DUPLICATE subcommand
    # -------------------------------------------------------------------------
    duplicate_parser = subparsers.add_parser(
        "duplicate",
        help="Duplicate an agent to your personal library",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Duplicate a workspace agent to your personal library
  python3 numa-agents.py duplicate --agent-id agt_abc123

The duplicate is always created as a personal agent with "(Copy)" appended to the title.
""",
    )
    duplicate_parser.add_argument(
        "--agent-id",
        "-a",
        required=True,
        help="Agent ID to duplicate",
    )
    duplicate_parser.set_defaults(func=cmd_duplicate)

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

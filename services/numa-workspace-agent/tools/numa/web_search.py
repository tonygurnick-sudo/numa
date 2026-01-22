#!/usr/bin/env python3
"""
Web Search Tool for Numa Workspace Agent.

This is a thin wrapper that invokes the numa-chat-workspace-tools Lambda.
The Lambda handles the actual web search, scraping, and summarization.

Usage:
    python3 /workdir/tools/numa/web_search.py --query "search query" --user-intent "what user wants" [options]

Parameters:
    --query, -q         Natural language search query (required)
    --user-intent, -u   What the user is trying to accomplish (required)
    --max-results, -m   Maximum number of results (default: 3, max: 10)

Output:
    JSON with summarised_content, references, and results_count

Example:
    python3 /workdir/tools/numa/web_search.py \
        --query "latest AWS Lambda pricing 2025" \
        --user-intent "find current pricing for AWS Lambda"
"""

import argparse
import json
import os
import sys

from helpers.credentials import get_local_lambda_client


def main():
    parser = argparse.ArgumentParser(
        description="Search the web for current information",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Search for current information
  python3 /workdir/tools/numa/web_search.py \\
      --query "AWS Lambda pricing 2025" \\
      --user-intent "find current Lambda pricing"

  # Search with more results
  python3 /workdir/tools/numa/web_search.py \\
      --query "best practices for Python error handling" \\
      --user-intent "learn about exception handling patterns" \\
      --max-results 5
""",
    )
    parser.add_argument(
        "--query",
        "-q",
        required=True,
        help="Natural language search query",
    )
    parser.add_argument(
        "--user-intent",
        "-u",
        required=True,
        help="What the user is trying to accomplish",
    )
    parser.add_argument(
        "--max-results",
        "-m",
        type=int,
        default=3,
        help="Maximum number of results (default: 3, max: 10)",
    )

    args = parser.parse_args()

    # Get Lambda function name from environment
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

    # Clamp max_results to valid range
    max_results = max(1, min(args.max_results, 10))

    # Get enabled tools from environment (set by workspace agent for security)
    # This enforces that the LLM can only use tools enabled for this conversation
    enabled_tools_json = os.environ.get("NUMA_ENABLED_TOOLS", "[]")
    try:
        enabled_tools = json.loads(enabled_tools_json)
    except json.JSONDecodeError:
        enabled_tools = []

    # Build Lambda payload with allowed_tools for security enforcement
    payload = {
        "tool": "web_search",
        "allowed_tools": enabled_tools,  # Lambda validates web_search is in this list
        "params": {
            "query": args.query,
            "user_intent": args.user_intent,
            "max_results": max_results,
        },
    }

    try:
        # Invoke Lambda using local account credentials
        lambda_client = get_local_lambda_client()
        response = lambda_client.invoke(
            FunctionName=lambda_name,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload),
        )

        # Parse response
        response_payload = json.loads(response["Payload"].read().decode("utf-8"))

        # Check for Lambda-level errors
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

        # Output the result
        print(json.dumps(response_payload, indent=2))

        # Exit with error code if the tool returned an error
        if response_payload.get("status") == "error":
            sys.exit(1)

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


if __name__ == "__main__":
    main()

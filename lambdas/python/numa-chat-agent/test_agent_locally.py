"""
Local Agent Testing Utility for numa-chat-agent

This script allows you to test the numa-chat-agent locally without deploying to AWS.
It creates a real agent instance and streams responses from Claude via AWS Bedrock.

Usage:
    poetry run python test_agent_locally.py "What is machine learning?"
    poetry run python test_agent_locally.py "Explain quantum computing" --tools web_search
    poetry run python test_agent_locally.py "Company policy question" --tools query_knowledge_base

Required Environment Variables:
    AWS_PROFILE                - AWS profile to use (default: q-demo)
    AWS_REGION                 - AWS region (default: us-east-1)

Optional Environment Variables:
    MODEL_ID                   - Claude model to use (default: us.anthropic.claude-sonnet-4-20250514-v1:0)
    BEDROCK_KNOWLEDGE_BASE_ID  - For testing knowledge base queries
    Q_APPLICATION_ID           - For testing Q Business queries
    Q_RETRIEVER_ID            - For testing Q Business queries
    PREFERRED_KNOWLEDGE_BASE   - 'q' or 'bedrock' (default: bedrock)

The script automatically mocks unnecessary AWS services (DynamoDB, WebSocket connections)
for local testing purposes.
"""

import argparse
import asyncio
import os
import sys
import warnings

warnings.filterwarnings("ignore", message="Failed to import fsevents")


def setup_environment(profile="q-demo"):
    """Configure environment variables for local testing."""
    # AWS profile configuration
    os.environ["AWS_PROFILE"] = profile

    # Required AWS configuration
    os.environ.setdefault("AWS_REGION", "us-east-1")
    os.environ.setdefault("REGION", "us-east-1")

    # Model configuration
    os.environ.setdefault("MODEL_ID", "us.anthropic.claude-sonnet-4-20250514-v1:0")
    os.environ.setdefault("PREFERRED_KNOWLEDGE_BASE", "bedrock")

    # Mock values for services not needed in local testing
    os.environ.setdefault("CONNECTION_TABLE", "mock-connections-table")

    # Optional: Set these if you want to test knowledge base functionality
    # os.environ.setdefault("BEDROCK_KNOWLEDGE_BASE_ID", "your-kb-id-here")
    # os.environ.setdefault("Q_APPLICATION_ID", "your-q-app-id-here")
    # os.environ.setdefault("Q_RETRIEVER_ID", "your-q-retriever-id-here")


def validate_aws_profile():
    """Check if AWS profile is configured."""
    profile = os.getenv("AWS_PROFILE")

    if not profile:
        print("Error: AWS_PROFILE environment variable not set")
        print("Please set AWS_PROFILE or use the default 'Q-demo' profile")
        return False

    # Check if profile exists by trying to import boto3 and create a session
    try:
        import boto3  # pylint: disable=import-outside-toplevel

        session = boto3.Session(profile_name=profile)
        # Try to get credentials to validate the profile
        credentials = session.get_credentials()
        if credentials is None:
            print(f"Error: AWS profile '{profile}' not found or has no credentials")
            print("Please check your AWS credentials configuration:")
            print("  - ~/.aws/credentials")
            print("  - ~/.aws/config")
            return False
    except Exception as e:
        print(f"Error validating AWS profile '{profile}': {e}")
        return False

    print(f"Using AWS profile: {profile}")
    return True


async def test_agent(
    query: str, enabled_tools: list | None = None, system_prompt: str | None = None
):
    """
    Test the numa-chat-agent with a given query.

    Args:
        query: The input query to send to the agent
        enabled_tools: List of tools to enable (default: no tools)
        system_prompt: Custom system prompt (default: helpful assistant)
    """
    if enabled_tools is None:
        enabled_tools = []

    if system_prompt is None:
        system_prompt = "You are a helpful AI assistant."

    try:
        print("Importing numa-chat-agent components...")
        from numa_chat_agent import (  # pylint: disable=import-outside-toplevel
            create_fresh_agent,
        )

        print("Successfully imported numa-chat-agent")

        print(f"Creating agent with tools: {enabled_tools or 'none'}")
        agent, _ = create_fresh_agent(
            enabled_tools=enabled_tools, system_prompt=system_prompt
        )
        print("Agent created successfully")

        print(f"Sending query: {query}")
        print("Response:")
        print("-" * 60)

        response_parts = []
        async for event in agent.stream_async(query):
            if isinstance(event, dict):
                if event.get("type") == "text" and event.get("text"):
                    text = event["text"]
                    response_parts.append(text)
                    print(text, end="", flush=True)
                elif event.get("complete") or event.get("messageStop"):
                    break

        print("\n" + "-" * 60)
        full_response = "".join(response_parts)
        print(f"Response complete ({len(full_response)} characters)")
        return True

    except ImportError as e:
        print(f"Import error: {e}")
        print("This indicates an issue with dependencies or package installation.")
        return False
    except Exception as e:
        print(f"Agent error: {e}")
        print(f"Error type: {type(e).__name__}")
        return False


def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Test numa-chat-agent locally",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python test_agent_locally.py "What is machine learning?"
  python test_agent_locally.py "Search for recent AI news" --tools web_search
  python test_agent_locally.py "Find company policy" --tools query_knowledge_base
  python test_agent_locally.py "Complex query" --tools web_search query_knowledge_base
  python test_agent_locally.py "Test with different profile" --profile my-profile
        """,
    )

    parser.add_argument("query", help="The query to send to the agent")

    parser.add_argument(
        "--tools",
        nargs="*",
        choices=["web_search", "query_knowledge_base", "data_analysis"],
        default=[],
        help="Tools to enable for the agent (default: none)",
    )

    parser.add_argument("--system-prompt", help="Custom system prompt for the agent")

    parser.add_argument(
        "--profile", default="q-demo", help="AWS profile to use (default: q-demo)"
    )

    return parser.parse_args()


async def main():
    """Main entry point."""
    args = parse_arguments()

    print("numa-chat-agent Local Testing Utility")
    print("=" * 50)

    # Setup environment
    setup_environment(args.profile)

    # Validate AWS profile
    if not validate_aws_profile():
        return False

    # Run the test
    test_success = await test_agent(
        query=args.query, enabled_tools=args.tools, system_prompt=args.system_prompt
    )

    if test_success:
        print("\nTest completed successfully")
    else:
        print("\nTest failed")

    return test_success


if __name__ == "__main__":
    try:
        success = asyncio.run(main())
        if not success:
            sys.exit(1)
    except KeyboardInterrupt:
        print("\nTest interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}")
        sys.exit(1)

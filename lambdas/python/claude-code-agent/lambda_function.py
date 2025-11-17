"""
Claude Code Agent Router

This is the main entry point for the Claude Code Agent Lambda function.
It routes requests to different agent implementations based on the agent_type parameter.

Each agent type has its own directory with:
- main.py: The agent's implementation with a run() function
- prompts.py: Agent-specific prompts
- settings.py: Agent-specific settings and permissions

Available agent types:
- data_analysis: Specialized for data analysis, visualization, and document processing
- default: Basic Claude CLI functionality without specialization

To add a new agent type:
1. Create a new directory with the agent name
2. Implement main.py with a run(event, context) function
3. Add prompts.py and settings.py as needed
4. Add the agent type to the AVAILABLE_AGENTS list below
"""

import importlib
from typing import Any, Dict

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = structlog.get_logger()

# List of available agent types
# Add new agent types here as they are created
AVAILABLE_AGENTS = [
    "data_analysis",
    "default",
]


def handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Main Lambda handler that routes to appropriate agent implementation.

    The agent type is determined by the 'agent_type' parameter in the event.
    If not specified or unknown, defaults to 'default'.

    Args:
        event: Lambda event containing:
            - agent_type: Optional agent type to use (defaults to 'default')
            - All other parameters required by the specific agent
        context: Lambda context

    Returns:
        Response from the selected agent's run() function
    """
    # Get agent type from event, default to 'default' if not specified
    agent_type = event.get("agent_type", "default")

    # Validate agent type
    if agent_type not in AVAILABLE_AGENTS:
        logger.warning(
            f"Unknown agent_type '{agent_type}', falling back to 'default'",
            requested_agent=agent_type,
            available_agents=AVAILABLE_AGENTS,
        )
        agent_type = "default"

    logger.info(f"Routing to agent: {agent_type}")

    # Dynamically import and run the selected agent
    try:
        # Import the agent module
        agent_module = importlib.import_module(f"{agent_type}.main")

        # Call the agent's run function
        return agent_module.run(event, context)

    except ImportError as e:
        logger.error(
            f"Failed to import agent module for '{agent_type}'",
            agent_type=agent_type,
            error=str(e),
        )
        # Fallback to default if import fails
        try:
            logger.info("Attempting fallback to default agent")
            fallback_module = importlib.import_module("default.main")
            return fallback_module.run(event, context)
        except (ImportError, AttributeError) as fallback_error:
            logger.error(
                "Fallback to default also failed",
                error=str(fallback_error),
            )
            # Return an error response
            return {
                "status": "error",
                "result": f"Failed to load agent: {str(e)}",
            }

    except AttributeError as e:
        logger.error(
            f"Agent module '{agent_type}' does not have a run() function",
            agent_type=agent_type,
            error=str(e),
        )
        # Return an error response
        return {
            "status": "error",
            "result": f"Agent '{agent_type}' is not properly implemented (missing run function)",
        }

    except Exception as e:
        logger.error(
            f"Unexpected error running agent '{agent_type}'",
            agent_type=agent_type,
            error=str(e),
        )
        raise  # Re-raise to let Lambda handle the error

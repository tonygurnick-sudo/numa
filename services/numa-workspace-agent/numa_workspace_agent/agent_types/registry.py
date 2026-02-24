"""
Agent type registry.

Simple dict-based registry. Agent types register themselves on import —
each type module calls `register_agent_type()` with its config at module
level, so importing the module is sufficient to make the type available.

The registry provides:
    - `register_agent_type()` — add or overwrite a type config.
    - `get_agent_type_config()` — look up by type_id (falls back to "numa-chat").
    - `list_agent_types()` — enumerate all registered types (for admin/debug UIs).
"""

import structlog

from .base import AgentTypeConfig

logger = structlog.get_logger()

# Internal registry — keyed by type_id
_registry: dict[str, AgentTypeConfig] = {}


def register_agent_type(config: AgentTypeConfig) -> None:
    """Register an agent type configuration.

    If a type with the same ``type_id`` is already registered it will be
    overwritten and a warning logged.  This is intentional — it allows hot
    reloading and test overrides without restarting the process.

    Args:
        config: The agent type configuration to register.
    """
    if config.type_id in _registry:
        logger.warning(
            "Overwriting agent type registration",
            type_id=config.type_id,
        )
    _registry[config.type_id] = config
    logger.info(
        "Agent type registered",
        type_id=config.type_id,
        display_name=config.display_name,
        response_mode=config.response_mode,
    )


def get_agent_type_config(type_id: str) -> AgentTypeConfig:
    """Get an agent type config by ID.

    If the requested ``type_id`` is not found the function falls back to
    the ``"numa-chat"`` default.  If *that* is also missing a ``ValueError``
    is raised — this should only happen if the application failed to import
    the default agent type module during startup.

    Args:
        type_id: The agent type identifier to look up.

    Returns:
        The matching ``AgentTypeConfig``.

    Raises:
        ValueError: If the type is not found and no ``"numa-chat"`` fallback
            is registered.
    """
    config = _registry.get(type_id)
    if config is None:
        logger.warning(
            "Unknown agent type, falling back to numa-chat",
            requested_type=type_id,
            available_types=list(_registry.keys()),
        )
        config = _registry.get("numa-chat")
        if config is None:
            raise ValueError(
                f"Agent type '{type_id}' not found and no 'numa-chat' default registered"
            )
    return config


def list_agent_types() -> list[dict]:
    """List all registered agent types.

    Returns a lightweight summary of every registered type — just enough
    information for admin dashboards, health checks, or auto-discovery UIs.

    Returns:
        A list of dicts, each containing ``type_id``, ``display_name``, and
        ``response_mode``.
    """
    return [
        {
            "type_id": config.type_id,
            "display_name": config.display_name,
            "response_mode": config.response_mode,
        }
        for config in _registry.values()
    ]

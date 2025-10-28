"""
Provider registry for MCP integrations.
"""

from .pipedream import create_provider as create_pipedream_provider

PROVIDERS = {
    "pipedream": create_pipedream_provider,
}


def get_provider(name: str, **kwargs):
    """
    Resolve a provider factory by name.
    """
    factory = PROVIDERS.get(name)
    if not factory:
        return None
    return factory(**kwargs)

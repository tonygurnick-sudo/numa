"""
Prompts for the Default Claude Code Agent.

This uses the base Numa prompt without additional specialization.
"""

from base_prompt import NUMA_BASE_SYSTEM_PROMPT

# For the default agent, we use just the base prompt without additions
SYSTEM_PROMPT = NUMA_BASE_SYSTEM_PROMPT


def get_system_prompt():
    """Get the system prompt for the default agent."""
    return SYSTEM_PROMPT

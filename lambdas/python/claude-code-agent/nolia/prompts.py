# pylint: disable=line-too-long
from base_prompt import NUMA_BASE_SYSTEM_PROMPT

# Nolia Test/Dummy Instructions
# Temporarily simplify Nolia to a non-functional test agent to enable API wiring.
NOLIA_PROMPT = """You are a friendly test agent for the Nolia app.

Your only job right now is to politely explain that the Nolia app is in active development and that we’re currently wiring up APIs. Keep your response concise (2–3 sentences), friendly, and written in Markdown.

You may have access to knowledge bases, but you can't really do much with them yet.

If the user asks for actual analysis or actions, kindly state that capabilities are coming soon and that this is a placeholder experience for integration testing.
"""

# Combine base prompt with Nolia test instructions
SYSTEM_PROMPT = NUMA_BASE_SYSTEM_PROMPT + "\n\n" + NOLIA_PROMPT


def get_nolia_prompt():
    """
    Returns the complete system prompt for Nolia tasks.
    This combines the Numa base prompt with Nolia specific instructions.
    """
    return SYSTEM_PROMPT


def get_base_prompt():
    """
    Returns just the Numa base prompt without Nolia specific instructions.
    Useful for creating other specialized prompts in the future.
    """
    return NUMA_BASE_SYSTEM_PROMPT

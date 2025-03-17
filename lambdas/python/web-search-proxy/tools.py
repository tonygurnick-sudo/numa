"""
Tools for web search functionality

Note: We no longer use Claude's native tool calling functionality.
Instead, we pre-fetch search results and include them directly in the prompt.
This definition is kept for reference.
"""

# Tool definition for reference only - not currently used
WEB_SEARCH_TOOL = [
    {
        "name": "web_search",
        "description": "Search the web for real-time information.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The search query to run"},
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of search results to return (default 5, max 10)",
                },
            },
            "required": ["query"],
        },
    }
]

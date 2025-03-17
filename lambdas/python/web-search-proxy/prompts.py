"""
Prompts for web search processing
"""

# Prompt for Claude to process web search results
SEARCH_RESULTS_PROMPT = """
You are processing web search results from DuckDuckGo for the query: "{query}"

The search returned the following results:
{search_results}

Please analyze these results and provide:
1. A concise summary of the most relevant information found (2-3 sentences)
2. Key facts or data points relevant to the query
3. Any notable conflicting information across sources

Format your response to be clear and easy to read. Include source URLs when referencing specific information.
"""

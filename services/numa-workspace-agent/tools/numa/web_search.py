#!/usr/bin/env python3
"""
Numa Web Search — MCP Tool Reference
======================================

Search the internet for current information via the mcp__numa__numa_tool
MCP tool.  Load the `web-search` skill for guidance on when to use web
search vs knowledge base queries.

Tool name (passed as `name`):  web_search

All examples below are mcp__numa__numa_tool calls.


Parameters
----------

  query        (required)  Natural language search query
  user_intent  (required)  What the user is trying to accomplish
  max_results  (optional)  Number of pages to scrape (default: 3, max: 10)


Examples
--------

  # Find current pricing
  mcp__numa__numa_tool(
    name="web_search",
    description="Finding current AWS Lambda pricing",
    params={
      "query": "AWS Lambda pricing 2025",
      "user_intent": "Find current Lambda pricing information"
    }
  )

  # Research regulations
  mcp__numa__numa_tool(
    name="web_search",
    description="Researching GDPR compliance requirements",
    params={
      "query": "GDPR compliance requirements",
      "user_intent": "Understand data protection obligations"
    }
  )

  # Broader research with more results
  mcp__numa__numa_tool(
    name="web_search",
    description="Researching microservices patterns",
    params={
      "query": "best practices microservices architecture",
      "user_intent": "Research architectural patterns",
      "max_results": 5
    }
  )


Output Format
-------------

JSON response with:
  summarised_content  — AI-synthesized summary of web results
  references          — URLs of sources
  results_count       — Number of pages scraped


When to Use
-----------

- Information may have changed after January 2025
- Looking for current prices, news, or announcements
- External standards or regulations referenced in KB docs
- Topics not covered in the company knowledge base
"""

import sys

print(
    "This file is documentation only. "
    "Use the mcp__numa__numa_tool MCP tool with name='web_search' instead."
)
sys.exit(1)

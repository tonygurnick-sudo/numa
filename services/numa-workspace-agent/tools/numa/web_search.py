#!/usr/bin/env python3
"""
Numa Web Search — MCP Tool Reference
======================================

Search the internet and fetch web pages via the mcp__numa__numa_tool
MCP tool. Supports two operations: search (find URLs) and fetch_url
(get full page content with JS rendering).

Tool name (passed as `name`):  web_search

All examples below are mcp__numa__numa_tool calls.


Operations
----------

1. **search** (default) — Search the web, returns URLs with titles and snippets.
   Use this to find relevant pages before fetching full content.

   Parameters:
     query        (required)  Natural language search query
     max_results  (optional)  Number of results to return (default: 5, max: 10)

2. **fetch_url** — Fetch a specific URL with full JavaScript rendering.
   Returns the page content as markdown. Uses Playwright + Chromium to
   render JS-heavy sites (React, Next.js, SPAs, etc.).

   Parameters:
     operation         (required)  Must be "fetch_url"
     url               (required)  The URL to fetch
     force_playwright  (optional)  Force JS rendering (default: true)


Recommended Workflow
--------------------

1. Use **search** to find relevant URLs with previews
2. Review the snippets to identify the most useful results
3. Use **fetch_url** on the best results to get full page content

This two-step approach is more efficient than fetching every result.


Examples
--------

  # Step 1: Search for URLs with previews
  mcp__numa__numa_tool(
    name="web_search",
    description="Searching for AWS Lambda pricing info",
    params={
      "query": "AWS Lambda pricing 2025",
      "max_results": 5
    }
  )

  # Step 2: Fetch full content from the most relevant result
  mcp__numa__numa_tool(
    name="web_search",
    description="Fetching full content from AWS pricing page",
    params={
      "operation": "fetch_url",
      "url": "https://aws.amazon.com/lambda/pricing/"
    }
  )

  # Broader research
  mcp__numa__numa_tool(
    name="web_search",
    description="Researching microservices patterns",
    params={
      "query": "best practices microservices architecture",
      "max_results": 8
    }
  )


Output Format
-------------

**search operation:**
  results        — List of {url, title, snippet} objects
  query          — Original search query
  results_count  — Number of results returned

**fetch_url operation:**
  url            — The fetched URL
  title          — Page title
  content        — Full page content as markdown
  content_type   — "text/markdown"
  status         — "success" or "error"


When to Use
-----------

- Information may have changed after January 2025
- Looking for current prices, news, or announcements
- External standards or regulations referenced in KB docs
- Topics not covered in the company knowledge base
- Need full page content from JS-rendered sites (use fetch_url)
"""

import sys

print(
    "This file is documentation only. "
    "Use the mcp__numa__numa_tool MCP tool with name='web_search' instead."
)
sys.exit(1)

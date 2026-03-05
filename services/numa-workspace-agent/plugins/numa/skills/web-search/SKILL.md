---
name: web-search
description: Search the internet for current information. Use when needing real-time data, recent news, external references, or information not in the knowledge base.
---

# Web Search Skill

Search the internet for current information not available in the knowledge base.

## Quick Reference

```
mcp__numa__numa_tool(
  name="web_search",
  description="Searching the web for search terms",
  params={"query": "search terms", "user_intent": "what user wants to find"}
)
```

## Parameters

| Parameter     | Required | Default | Description                           |
| ------------- | -------- | ------- | ------------------------------------- |
| `query`       | Yes      | -       | Search query                          |
| `user_intent` | Yes      | -       | What the user is trying to accomplish |
| `max_results` | No       | 3       | Number of pages to scrape (max: 10)   |

## Examples

```
# Find current pricing
mcp__numa__numa_tool(
  name="web_search",
  description="Finding current AWS Lambda pricing",
  params={"query": "AWS Lambda pricing 2025", "user_intent": "Find current Lambda pricing information"}
)

# Research regulations
mcp__numa__numa_tool(
  name="web_search",
  description="Researching GDPR compliance requirements",
  params={"query": "GDPR compliance requirements", "user_intent": "Understand data protection obligations"}
)

# Get more results for broad topics
mcp__numa__numa_tool(
  name="web_search",
  description="Researching microservices architecture patterns",
  params={"query": "best practices microservices architecture", "user_intent": "Research architectural patterns", "max_results": 5}
)
```

## Output

JSON response with:

- `summarised_content` - AI-synthesized summary of web results
- `references` - URLs of sources
- `results_count` - Number of pages scraped

## When to Use

- Information may have changed after January 2025
- Looking for current prices, news, or announcements
- External standards or regulations referenced in KB docs
- Topics not covered in the company knowledge base

---
name: web-search
description: Search the internet and fetch web pages. Use when needing real-time data, recent news, external references, or information not in the user's Numa Files. Supports search (find URLs) and fetch_url (get full page content with JS rendering).
---

# Web Search Skill

Search the internet and fetch web pages for current information not available in the user's Numa Files.

## Operations

### 1. search (default) -- Find URLs with previews

```
mcp__numa__numa_tool(
  name="web_search",
  description="Searching for relevant pages",
  params={"query": "search terms", "max_results": 5}
)
```

| Parameter     | Required | Default | Description                           |
| ------------- | -------- | ------- | ------------------------------------- |
| `query`       | Yes      | -       | Natural language search query         |
| `max_results` | No       | 5       | Number of results to return (max: 10) |

**Returns:** `results` (list of `{url, title, snippet}`), `query`, `results_count`

### 2. fetch_url -- Get full page content as markdown

```
mcp__numa__numa_tool(
  name="web_search",
  description="Fetching full content from page",
  params={"operation": "fetch_url", "url": "https://example.com/page"}
)
```

| Parameter          | Required | Default | Description                       |
| ------------------ | -------- | ------- | --------------------------------- |
| `operation`        | Yes      | -       | Must be `"fetch_url"`             |
| `url`              | Yes      | -       | The URL to fetch                  |
| `force_playwright` | No       | true    | Force JS rendering via Playwright |

**Returns:** `url`, `title`, `content` (full markdown), `content_type`, `status`

**PDFs:** If the URL is a PDF, fetch_url downloads it directly to the workspace and returns a `file_path` instead of `content`. Read the PDF using the `Read` tool on that path.

## Recommended Workflow

1. Use **search** to find relevant URLs with previews
2. Review the snippets to identify the most useful results
3. Use **fetch_url** on the best results to get full page content

This two-step approach is more efficient than fetching every result.

## Examples

```
# Step 1: Search for URLs with previews
mcp__numa__numa_tool(
  name="web_search",
  description="Searching for AWS Lambda pricing info",
  params={"query": "AWS Lambda pricing 2025", "max_results": 5}
)

# Step 2: Fetch full content from the most relevant result
mcp__numa__numa_tool(
  name="web_search",
  description="Fetching full content from AWS pricing page",
  params={"operation": "fetch_url", "url": "https://aws.amazon.com/lambda/pricing/"}
)

# Broader research with more results
mcp__numa__numa_tool(
  name="web_search",
  description="Researching microservices architecture patterns",
  params={"query": "best practices microservices architecture", "max_results": 8}
)
```

## When to Use

- Information may have changed after January 2025
- Looking for current prices, news, or announcements
- External standards or regulations referenced in Numa Files
- Topics not covered in the user's Numa Files folders
- Need full page content from JS-rendered sites (use fetch_url)

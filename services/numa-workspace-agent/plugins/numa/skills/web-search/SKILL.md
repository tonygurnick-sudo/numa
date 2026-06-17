---
name: web-search
description: Search the internet and fetch web pages. Use when needing real-time data, recent news, external references, or information not in the user's Numa Files. Supports search (find URLs) and fetch_url (get full page content with JS rendering).
---

# Web Search Skill

Search the internet and fetch web pages for current information not available in the user's Numa Files.

## Operations

### 1. search (default) -- Find URLs with previews

```bash
numa web search "search terms" --json -m "Searching for relevant pages"
```

| Parameter     | Required | Default | Description                           |
| ------------- | -------- | ------- | ------------------------------------- |
| `query`       | Yes      | -       | Natural language search query         |
| `max_results` | No       | 5       | Number of results to return (max: 10) |

**Returns:** `results` (list of `{url, title, snippet}`), `query`, `results_count`

### 2. fetch -- Get full page content as markdown

```bash
numa web fetch "https://example.com/page" --json -m "Fetching full content from page"
```

| Parameter          | Required | Default | Description                       |
| ------------------ | -------- | ------- | --------------------------------- |
| `url`              | Yes      | -       | The URL to fetch                  |
| `force_playwright` | No       | true    | Force JS rendering via Playwright |

**Returns:** `url`, `title`, `content` (full markdown), `content_type`, `status`

**PDFs:** If the URL is a PDF, fetch downloads it directly to the workspace and returns a `file_path` instead of `content`. Read the PDF using the `Read` tool on that path.

## Recommended Workflow

1. Use **search** to find relevant URLs with previews
2. Review the snippets to identify the most useful results
3. Use **fetch** on the best results to get full page content

This two-step approach is more efficient than fetching every result.

## Reliability & verification

- **A failed or rate-limited search is not "nothing found".** If `search` errors or comes back throttled, retry once; if it still fails, say the search is rate-limited and either fall back to what you already know (flagging it as unverified) or ask the user to retry shortly. Don't silently conclude there are no results.
- **Verify facts against the fetched page, not the snippet.** Search snippets are short and sometimes stale or misleading. Before stating a specific figure, date, or claim, `fetch` the source and confirm it there, then cite the URL you actually read.

## Examples

```bash
# Step 1: Search for URLs with previews
numa web search "AWS Lambda pricing 2025" --json -m "Searching for AWS Lambda pricing info"

# Step 2: Fetch full content from the most relevant result
numa web fetch "https://aws.amazon.com/lambda/pricing/" --json -m "Fetching full content from AWS pricing page"

# Broader research with more results
numa web search "best practices microservices architecture" --json -m "Researching microservices architecture patterns"
```

## When to Use

- Information may have changed after January 2025
- Looking for current prices, news, or announcements
- External standards or regulations referenced in Numa Files
- Topics not covered in the user's Numa Files folders
- Need full page content from JS-rendered sites (use fetch_url)

---
name: web-search
description: Search the internet for current information. Use when needing real-time data, recent news, external references, or information not in the knowledge base.
---

# Web Search Skill

Search the internet for current information not available in the knowledge base.

## Quick Reference

```bash
python3 /workdir/tools/numa/web_search.py \
    --query "search terms" \
    --user-intent "what user wants to find"
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--query, -q` | Yes | - | Search query |
| `--user-intent, -u` | Yes | - | What the user is trying to accomplish |
| `--max-results, -m` | No | 3 | Number of pages to scrape (max: 10) |

## Examples

```bash
# Find current pricing
python3 /workdir/tools/numa/web_search.py \
    --query "AWS Lambda pricing 2025" \
    --user-intent "Find current Lambda pricing information"

# Research regulations
python3 /workdir/tools/numa/web_search.py \
    --query "GDPR compliance requirements" \
    --user-intent "Understand data protection obligations"

# Get more results for broad topics
python3 /workdir/tools/numa/web_search.py \
    --query "best practices microservices architecture" \
    --user-intent "Research architectural patterns" \
    --max-results 5
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

# Web Search Proxy Lambda

This Lambda function provides web search capabilities to the Numa chat interface using googlesearch-python (a keyless library).

## Features

- Performs web searches through googlesearch-python library
- Formats search results for easy consumption by Claude
- Handles error cases gracefully
- Returns structured search results for integration with the chat UI

## Implementation Approach

The web search functionality is implemented as follows:

1. The frontend detects when the search toggle is enabled
2. For each user message, the frontend automatically performs a search using this Lambda
3. Search results are injected directly into the user's message before sending to Claude
4. Claude processes the enhanced message with search results included
5. This approach avoids relying on Claude's tool calling capabilities

## API

### HTTP Request

**GET** `/api/web-search`

Query parameters:
- `query` (required): The search query to perform
- `max_results` (optional, default 5): Number of results to return (max 10)

### Response Format

```json
{
  "query": "the original query",
  "results_count": 5,
  "results": [
    {
      "title": "Search result title",
      "url": "https://example.com/page",
      "snippet": "Preview text of the search result..."
    },
    ...
  ],
  "timestamp": 1647284736
}
```

## Dependencies

- httpx: Modern HTTP client
- structlog: Structured logging
- aws-lambda-powertools: AWS Lambda utilities

## Testing

Run tests with:

```bash
cd tests
pytest
```

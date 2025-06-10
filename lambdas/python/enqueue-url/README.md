# Enqueue URL Lambda

## Overview
This Lambda function adds URLs to the DynamoDB queue for the web crawler workflow. It validates the input URL, sets the crawl depth, and adds it to DynamoDB with a "pending" status.

It handles:
- URL validation
- Crawl depth verification
- Conditional writes to prevent duplicate entries

## Inputs
```json
{
  "url": "https://example.com",
  "title": "Example Website",
  "crawl_depth": 3,
  "creator": "user123"
}
```

- `url` (required): The URL to crawl
- `title` (optional): A friendly title for the URL (defaults to URL)
- `crawl_depth` (optional): How deep to crawl the site (defaults to 1)
- `creator` (required): Identifier for the user creating the request

## Outputs
```json
{
  "url": "https://example.com",
  "title": "Example Website",
  "crawl_depth": 3,
  "creator": "user123",
  "status": "success",
  "message": "URL added to queue"
}
```

## Environment Variables
- `TABLE_NAME`: Name of the DynamoDB table to store URLs

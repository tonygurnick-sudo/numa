# Crawl Page Lambda

## Overview

This Lambda function scrapes content from a URL and processes it for the web crawler workflow. It extracts page content, saves it to S3, and identifies links for recursive crawling.

It handles:

- Web page content extraction (text, title)
- Link discovery for recursive crawling
- Content storage in S3
- Async requests with timeout handling
- Depth tracking for crawl limits

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
- `title` (optional): A title for the URL
- `crawl_depth` (required): Current depth level (decremented for child URLs)
- `creator` (required): Identifier for the user creating the request

## Outputs

```json
{
  "url": "https://example.com",
  "status": "success",
  "s3_key": "web-crawler/user123/https%3A%2F%2Fexample.com",
  "title": "Example Domain",
  "pages_attempted": 1,
  "pages_successful": 1,
  "links_enqueued": 5
}
```

## Environment Variables

- `BUCKET_NAME`: Name of the S3 bucket to store scraped content
- `TABLE_NAME`: Name of the DynamoDB table for enqueueing discovered links

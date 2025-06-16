# Web Crawler Start Lambda

This Lambda function starts the web crawler step function to process URLs from the crawler queue.

## Overview

The Lambda accepts requests from the frontend with seed URLs and crawl settings (max pages, max depth), then starts a Step Function execution to crawl the specified URLs. The Step Function handles the actual crawling logic, processing URLs in a depth-aware manner and storing the crawled content in S3.

## API

### Input

```json
{
    "urls": ["https://example.com"],  // List of seed URLs to crawl
    "maxPages": 100,                  // Optional: Maximum number of pages to crawl (default: 1000)
    "maxDepth": 2                     // Optional: Maximum crawl depth (default: 2)
}
```

### Output

Success:
```json
{
    "success": true,
    "message": "Web crawler started successfully",
    "executionArn": "arn:aws:states:us-east-1:123456789012:execution:web-crawler:execution-id",
    "executionName": "web-crawler-abcd1234"
}
```

Error:
```json
{
    "success": false,
    "error": "Error message",
    "message": "Detailed error message"
}
```

## Environment Variables

- `WEB_CRAWLER_STATE_MACHINE_ARN`: ARN of the web crawler Step Function

## Deployment

The Lambda is deployed as part of the web crawler infrastructure through CDK.

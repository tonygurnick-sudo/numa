# Mark URL Status Lambda

## Overview
This Lambda function updates the status of a URL in DynamoDB after processing. It marks URLs as completed or failed and updates their associated metrics in the database.

It handles:
- Status updates in DynamoDB (completed/failed)
- Metrics tracking (pages attempted, successful, links enqueued)
- Timestamp management for crawl tracking
- Comprehensive error handling

## Inputs
```json
{
  "url": "https://example.com",
  "title": "Example Website",
  "crawl_depth": 3,
  "creator": "user123",
  "status": "success",
  "pages_attempted": 1,
  "pages_successful": 1,
  "links_enqueued": 5,
  "error": {}
}
```

- `url` (required): The URL being processed
- `title` (required): The title of the page
- `creator` (required): Identifier for the user who initiated the crawl
- `status` (required): Status from processing (success/failed)
- `pages_attempted` (optional): Count of pages attempted
- `pages_successful` (optional): Count of pages successfully processed
- `links_enqueued` (optional): Count of links discovered and queued for crawling
- `error` (optional): Error object if processing failed

## Outputs
```json
{
  "status": "success",
  "message": "URL status updated to completed",
  "url": "https://example.com",
  "timestamp": "2023-05-14T12:34:56.789012"
}
```

## Environment Variables
- `TABLE_NAME`: Name of the DynamoDB table to update

# URL Scraper Lambda

This Lambda function scrapes content from provided URLs and uploads them to an S3 bucket for indexing by the knowledge base.

## Features

- Scrapes web page content including title and text
- Handles various URL formats and sanitizes them for S3 keys
- Uploads content to S3 with appropriate metadata
- Returns detailed status for each URL processed
- Includes error handling and retry logic

## Input Format

The Lambda expects an event with the following structure:

```json
{
  "urls": ["https://example.com"],
  "bucket": "your-s3-bucket-name",
  "prefix": "optional/prefix/"
}
```

## Output Format

The Lambda returns a response with the following structure:

```json
{
  "statusCode": 200,
  "body": {
    "status": "completed",
    "results": [
      {
        "url": "https://example.com",
        "status": "success",
        "s3_key": "urls/example.com/20230514123456_abc123_index.html",
        "title": "Example Domain"
      }
    ],
    "timestamp": "2023-05-14T12:34:56.789012"
  }
}
```

## Error Handling

The function will return appropriate HTTP status codes and error messages for different scenarios:

- 400: Invalid request (missing required fields, empty URL list, etc.)
- 200 with error details: Partial success (some URLs failed to process)

## Testing

Run the tests using pytest:

```bash
pytest test_lambda_function.py -v
```

## Deployment

This Lambda is deployed as part of the main infrastructure stack. The infrastructure code will need to be updated to include this new Lambda function and its associated API Gateway endpoint.

## Dependencies

- Python 3.9+
- boto3
- httpx
- beautifulsoup4
- aws-lambda-powertools
- structlog

## Security Considerations

- The Lambda requires S3 write permissions to the specified bucket
- It's recommended to limit the Lambda's execution role to only the necessary permissions
- The function includes basic error handling and logging for security events

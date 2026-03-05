# Infringement Review Lambda

This Lambda function is part of the Infringement Review application, which analyzes parking infringement evidence against local legislation to determine if an infringement should be upheld or cancelled.

## Functionality

The lambda performs the following steps:

1. Processes uploaded evidence files (documents, photos, PDFs)
2. Analyzes evidence against predefined parking legislation
3. Determines if the infringement should be upheld or cancelled
4. Generates a detailed response letter with rationale

## Development

To run tests:

```
cd lambdas/python/infringement-review
poetry install
poetry run pytest
```

## Dependencies

This lambda relies on the following packages:

- bedrock - Handles interactions with Amazon Bedrock for LLM functionality
- helpers - Common utility functions
- s3_helpers - S3 bucket interaction utilities

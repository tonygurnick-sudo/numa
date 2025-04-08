# Document Processing Lambda

## Overview

AWS Lambda function that processes documents using AWS Bedrock Claude 3 to generate summaries and aggregates results into a single JSON file.

## Inputs

```json
{
  "output_bucket": "bucket-name",
  "execution_id": "unique-execution-id"
}
```

## Outputs

```json
{
  "results_location": "document_processing/execution-id/final/result.json",
  "documents_processed": 2,
  "execution_id": "execution-id"
}
```

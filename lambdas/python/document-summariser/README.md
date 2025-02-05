# Document Summarization Lambda

## Overview
AWS Lambda function that uses AWS Bedrock Claude 3 to generate detailed summaries of documents, storing results with unique identifiers in S3.

## Inputs
```json
{
  "content_s3_key": "path/to/extracted/content.txt",
  "document_key": "path/to/original/document.pdf",
  "output_bucket": "bucket-name",
  "execution_id": "unique-execution-id"
}
```

## Outputs
```json
{
  "summary_results": {
    "markdown_summary": "Detailed markdown formatted summary...",
    "metadata": {
      "input_tokens": 968,
      "output_tokens": 699
    }
  },
  "document_key": "example_document.pdf",
  "execution_id": "test123",
  "unique_code": "27b83baa",
  "output_path": "document_processing/test123/summaries/example_document_27b83baa.json"
}
```

Build a deployable zip file with:

```bash
poetry self add poetry-plugin-lambda-build # if the plugin isn't installed already
poetry build-lambda
```

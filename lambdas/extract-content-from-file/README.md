
# AWS Lambda Function: Document Text Extraction

This Lambda function extracts text from various document types stored in an S3 bucket, utilizing AWS Textract for PDF and TIFF documents and Bedrock Vision Model for image files. The function processes the input file and returns the extracted text content.

## Usage with Poetry
Helpful links for poetry with Lambda functions:
- https://pypi.org/project/poetry-plugin-lambda-build/
- https://stackoverflow.com/questions/74292510/how-to-create-a-deployable-python-lamba-zip-using-poetry
- https://aws.plainenglish.io/streamline-lambda-development-with-poetry-25fbc212a846

The lambda zip package configuration is in the toml file. The following plugins are used:
- poetry-plugin-lambda-build

The following command will create the zip package to be used to create the lambda function:
```bash
poetry build-lambda
```

## Overview

The Lambda function supports two main processing modes:

1. **Textract Processing**: Extracts text from PDF and TIFF documents using AWS Textract, providing detailed page-wise content and word count.
2. **Vision Model Processing**: Extracts text and provides detailed descriptions for images (.png, .jpg, .jpeg) using the Bedrock Claude model.

## Supported File Types

- **Text Files**: `.txt`
- **Image Files**: `.png`, `.jpg`, `.jpeg`
- **Document Files**: `.pdf`, `.tiff`

## Input Schema

This schema defines the input structure for the Lambda function.

```json
{
  "type": "object",
  "properties": {
    "bucket": {
      "type": "string",
      "description": "The S3 bucket name where the file is stored."
    },
    "key": {
      "type": "string",
      "description": "The key (file path) in the S3 bucket pointing to the document or image to be processed."
    },
  },
  "required": ["bucket", "key"],
  "additionalProperties": false
}
```

Example input:
```json
{
  "bucket": "my-s3-bucket",
  "key": "documents/my-document.pdf",
}
```

## Output Schema

This schema defines the output structure for the Lambda function.

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "description": "The extracted text content from the document or image."
    },
    "key": {
      "type": "string",
      "description": "The key (file path) in the S3 bucket pointing to the document or image that was processed."
    },
    "bucket": {
      "type": "string",
      "description": "The S3 bucket name where the file was stored."
    }
  },
  "required": ["text", "key", "bucket"],
  "additionalProperties": false
}
```

Example Response

```json
{
  "bucket": "bucket-name",
  "key": "file-key",
  "text": "Extracted text content..."
}
```

## Environment Configuration

Set the following environment variables for AWS client configuration:

- **AWS_BEDROCK_REGION**: Region for Bedrock runtime, e.g., `us-east-1`. Default is `us-east-1`.

## Constants

- **LLM_QUERY**: Specifies the default query for text extraction and visual description of drawings or images in meeting notes.

## Notes

- Ensure S3 bucket permissions allow Lambda access.
- In the future we could customize `LLM_QUERY` for different document content types and have it be configurable.
- Lambda needs appropriate IAM roles for S3, Textract and Bedrock access.

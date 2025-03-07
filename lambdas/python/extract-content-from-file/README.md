# AWS Lambda Function: Document Text Extraction

This Lambda function extracts text from various document types stored in an S3
bucket, utilizing AWS Textract for PDF and TIFF documents and Bedrock Vision
Model for image files.

## Usage with Poetry

Helpful links for poetry with Lambda functions:

- https://pypi.org/project/poetry-plugin-lambda-build/
- https://stackoverflow.com/questions/74292510/how-to-create-a-deployable-python-lamba-zip-using-poetry
- https://aws.plainenglish.io/streamline-lambda-development-with-poetry-25fbc212a846

The lambda zip package configuration is in the pyproject.toml file. The
following plugins are used:

- poetry-plugin-lambda-build

The following command will create the zip package to be used to create the
lambda function:

```bash
poetry build-lambda
```

## Supported File Types

- **Text Files**: `.txt`
- **Image Files**: `.png`, `.jpg`, `.jpeg`
- **Document Files**: `.pdf`, `.tiff`, `.docx`

## Input

```json
{
  "input_bucket": "input-s3-bucket",
  "input_key": "documents/input-document.pdf",
  "output_bucket": "output-s3-bucket", # optional - defaults to input_bucket
  "output_key": "documents/output-document.pdf", # optional - defaults to input_key
  "return_content": true, # optional - defaults to false
}
```

## Output

Extracted text content is written to S3 as a json document with additional
metadata and split into pages. If `return_content` is set to `true` the raw
text content is added to the output.

```json
{
  "input_bucket": "input-s3-bucket", # same as input
  "input_key": "documents/input-document.pdf", # same as input
  "output_bucket": "output-s3-bucket", # same as input
  "output_key": "documents/output-document.pdf", # same as input
  "content": "Extracted text content..."
}
```

## Environment Configuration

- **AWS_BEDROCK_REGION**: Where to run Bedrock, e.g. `us-east-1`. Default is `us-west-2`.

## Notes

- Lambda needs an appropriate IAM role for S3, Textract and Bedrock access.

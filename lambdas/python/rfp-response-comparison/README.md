# RFP Response Comparison Lambda

This AWS Lambda uses AWS Bedrock Claude 3 to compare two RFP response
documents against a provided Comparative Assessment Framework. It generates an
output report in plain text and writes it to S3.

## Inputs

```json
{
  "responses": [{ "s3_key": "path/to/response1.pdf" }, { "s3_key": "path/to/response2.docx" }],
  "framework": [{ "s3_key": "path/to/framework.pdf" }],
  "template": "...template text...",
  "job_id": "unique-job-id",
  "output_path": "rfp-comparison/<job-id>"
}
```

## Outputs

```json
{ "output_key": "rfp-comparison/<job-id>/comparison.txt" }
```

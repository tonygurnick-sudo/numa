
# Lambda Function for Policy Review

## Overview
This AWS Lambda function processes policy documents stored in S3, performs analysis and review using Bedrock Claude 3, and saves the results back to S3.

## Input
```json
{
  "content_s3_key": "policies/input_policy.txt",
  "document_key": "input_policy.txt",
  "output_bucket": "policy-review-results",
  "execution_id": "abc123",
  "policy_context": "Company compliance standards",
  "legislation_content": "Relevant legal references"
}
```
## Output
```json
{
  "output_path": "policy_reviews/abc123/review_input_policy.txt",
  "document_key": "input_policy.txt",
  "execution_id": "abc123",
  "timestamp": "20250205_120000"
}

```
## Build

Build a deployable zip file with:

```bash
poetry self add poetry-plugin-lambda-build # if the plugin isn't installed already
poetry build-lambda
```

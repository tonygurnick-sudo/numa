# Lambda Function for Contract Analysis

## Overview
This AWS Lambda function processes contract documents stored in S3, performs analysis using Bedrock Claude 3, and saves the results back to S3.

## Input
```json
{
  "input_key": "extracted_content/abc123/document.txt",
  "contract_context": "Optional context about the contract"
}
```

## Output
```json
{
  "identified_clauses": "Markdown document with identified clauses",
  "highlighted_explanations": "Contract with explanations of important terms",
  "risk_assessment": "Risk analysis with integrated scoring table",
  "improvement_suggestions": "Suggested improvements to the contract"
}
```

## Build

Build a deployable zip file with:

```bash
poetry self add poetry-plugin-lambda-build # if the plugin isn't installed already
poetry build-lambda
```

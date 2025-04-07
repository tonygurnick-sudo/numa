# Financial Analysis Analysis Lambda

## Overview

This Lambda function uses the Bedrock Claude model to analyze structured data and extracted text from financial documents. This is designed to be integrated within the large Numa Financial Analysis App.

The lambda looks for documents of certain structures within the given S3 bucket and prefix, where the prefix is based on the execution ID of the step function calling this lambda. The lambda then analyzes the documents and returns the results. The results include the financial analysis, a summary of all the documents analyzed, and a csv representation of the structured input data.

## Input Schema

The function expects the following input fields:

- "bucket": The S3 bucket name where the document is stored.
- "prefix": The S3 prefix where the document is stored.

```json
{
  "bucket": "string",
  "prefix": "string"
}
```

### Example Input

```json
{
  "bucket": "my-bucket",
  "prefix": "execution_1234"
}
```

## Output Schema

The function returns a dictionary containing the keys for the financial analysis, documents summary, and csv data.

```json
{
  "financialAnalysisKey": "string",
  "documentsSummaryKey": "string",
  "csvDataKey": "string"
}
```

### Example Output

```json
{
  "financialAnalysisKey": "execution_1234/financial_analysis.md",
  "documentsSummaryKey": "execution_1234/documents_summary.md",
  "csvDataKey": "execution_1234/csv_data.csv"
}
```

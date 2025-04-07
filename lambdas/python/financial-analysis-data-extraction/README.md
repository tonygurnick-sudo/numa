# Financial Analysis Data Extraction Lambda

## Overview

This Lambda function uses the Bedrock Claude model to extract structured data from financial documents. This is designed to be integrated within the large Numa Financial Analysis App.

Note: This function currently supports max pages as indicated in the MAX_PAGES global variable (60 pages as of time of writing). This is due to our lambda timeout limit of 15 minutes. If you need to process more pages, you will need to split the document into smaller chunks and process them separately. ie in the Numa app, upload the document in parts.

One of the outputs is a classification. The current options are:

- interest_rate
- interest_on_loan
- loan_limit
- loan_balance
- location_of_property
- rental_income
- other_rental_income
- total_rental_income
- borrowing costs
- body_corporate_fees
- council_rates
- cleaning
- depreciation
- agent fees
- insurance
- land_tax
- repairs
- capital_works_deduction
- water_rates
- sundry_income_and_expenses
- sundry_postage
- sundry
- sundry_gst_on_fees
- total_rental_expenses
- possible_deduction
- other

These could be updated or made to be inputs to the app in future versions.

## Input Schema

The function expects the following input fields:

- `input_bucket` (str): The S3 bucket where the input document is stored.
- `output_bucket` (str): The S3 bucket where the output document will be stored.
- `input_key` (str): The key of the input document in the input bucket.
- `output_key` (str): The key of the output document in the output bucket.

```json
{
  "input_bucket": "str",
  "output_bucket": "str",
  "input_key": "str",
  "output_key": "str"
}
```

### Example Input

```json
{
    "input_bucket": "my-input-bucket",
    "output_bucket": "my-output-bucket",
    "input_key": "my-input-key.pdf",
    "output_key": "my-output
}
```

## Output Schema

The function creates a list of dictionaries containing the extracted data for each page or document and uploads to s3. The lambda function will return the output key of the uploaded file.

```json
{
  "input_bucket": "str",
  "output_bucket": "str",
  "input_key": "str",
  "output_key": "str"
}
```

### Example Output Uploaded to s3

```json
[
  {
    "name": "Current Balance",
    "value": "-12345.67",
    "description": "The current balance of the investment home loan account.",
    "classification": "loan_balance",
    "page_number": "1"
  },
  {
    "name": "Remaining Term",
    "value": "295",
    "description": "The remaining term of the investment home loan in months.",
    "classification": "other",
    "page_number": "1"
  }
]
```

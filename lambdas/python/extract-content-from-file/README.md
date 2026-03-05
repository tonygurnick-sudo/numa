# AWS Lambda Function: Document Text Extraction

This Lambda function extracts text from various document types stored in an S3
bucket, utilizing AWS Textract for PDF and TIFF documents and Bedrock Vision
Model for image files.

## Usage with Poetry

Helpful links for poetry with Lambda functions:

- https://pypi.org/project/poetry-plugin-lambda-build/
- https://stackoverflow.com/questions/74292510/how-to-create-a-deployable-python-lamba-zip-using-poetry
- https://aws.plainenglish.io/streamline-lambda-development-with-poetry-25fbc212a846

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

## Excel/CSV Notes

The function now also supports CSV and Excel (XLSX) file types.

### CSV Files

- Processed using Python’s built-in csv module.
- Rows are parsed and then formatted as a table-like string (fields are joined with commas, and rows with newlines) before being processed as a single document page.

### Excel Files (XLSX)

- Processed using the pure‑Python library openpyxl, which has no binary dependencies.
- Each sheet in an Excel file is treated as a separate page in the output "document".
- To capture both the underlying formulas and computed values:
  - The workbook is loaded with data_only=False to extract formula strings.
  - The workbook is reloaded with data_only=True to retrieve computed cell values.
  - For cells with formulas, the output includes both the formula and its computed value (e.g., A1: =SUM(B1:B5) (computed: 15)).

Here is an example output:
{
"1": {
"sheet_name": "Sheet1",
"structure": {
"columns": ["A", "B"],
"headers": ["Test Excel File With Formulas", "None"],
"rows_count": 5
},
"rows": [
"A1: Test Excel File With Formulas | B1: None",
"A2: None | B2: None",
"A3: a | B3: 1",
"A4: b | B4: 5",
"A5: c (a+b) | B5: =B3+B4 (computed: 6)"
]
}
}

Future Ideas for Advanced Extraction

- Handle empty cells and missing data more gracefully. At the moment, empty cells are just "A2: None" for example.
- Handling merged cells and more complex formatting.
- Extracting structured data such as headers, data types, and even cell styling.
- A more advanced seperate lambda specifically for Excel files. This could use LLMs or other packages to extract more nuance and complexity from the Excel files.

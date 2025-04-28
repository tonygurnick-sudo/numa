# Council Recourse Consents Lambda

This lambda function analyses council reference documents and a resource consent application to provide a comprehensive assessment of the application's compliance with council requirements.

## Features

- Accepts multiple council reference documents and a single application document
- Extracts content from various document formats using the extract-content-from-file lambda
- Analyzes compliance between the application and council references
- Generates a structured report with compliance assessment, concerns, and recommendations
- Uses AWS Bedrock Claude for document analysis

## Workflow

1. Council reference documents are uploaded via the UI
2. Application document is uploaded via the UI
3. Step function extracts text from all documents using a map state
4. Main lambda analyzes the extracted content using Bedrock Claude
5. Results are returned in markdown format

# Textract PDF Structured Extraction Lambda

## Overview
This Lambda function leverages AWS Textract to extract text from PDF files stored in an S3 bucket. The function supports only PDF files and utilizes asynchronous Textract jobs to detect text within the document. The extracted content is structured by page, with metadata including page number, word count, and total pages.

## How It Works
1. **File Check**: The function verifies if the provided file is in PDF format.
2. **Textract Job**: It starts an asynchronous Textract job to detect text within the PDF.
3. **Text Extraction**: Once the job completes, it retrieves the text and structures it as a series of pages, each with its own text and word count.
4. **Output Structure**: The function outputs the document's metadata, including the number of pages, total word count, and the extracted text by page.

## Input Schema
The function expects the input to include:
- `bucket`: The name of the S3 bucket containing the document.
- `key`: The S3 object key (path) to the document.

```json
{
  "bucket": "string",
  "key": "string"
}
```

### Example Input
```json
{
  "bucket": "example-bucket",
  "key": "documents/sample.pdf"
}
```

## Output Schema

The function returns:
- bucket: The name of the S3 bucket (echoed from input).
- key: The S3 object key (echoed from input).
- content: Contains document metadata and extracted text details:
    - name: The name of the file.
    - num_pages: The total number of pages in the document.
    - total_num_words: The total word count across all pages.
    - text: An array of pages, each represented by:
        - page_number: The page number.
        - num_words: The word count for that page.
        - text: The extracted text from that page.

```json
{
  "bucket": "string",
  "key": "string",
  "content": {
    "name": "string",
    "num_pages": "integer",
    "total_num_words": "integer",
    "text": [
      {
        "page_number": "integer",
        "num_words": "integer",
        "text": "string"
      }
    ]
  }
}
```

### Example Output
```json
{
  "bucket": "example-bucket",
  "key": "documents/sample.pdf",
  "content": {
    "name": "sample.pdf",
    "num_pages": 2,
    "total_num_words": 6,
    "text": [
      {
        "page_number": 1,
        "num_words": 2,
        "text": "Sample text\n"
      },
      {
        "page_number": 2,
        "num_words": 4,
        "text": "Another page text\n"
      }
    ]
  }
}
```

## Error Handling

- Unsupported File Format: If the file is not in PDF format, the function returns an error message with the bucket and key information.
- Textract Job Failure: If the Textract job fails, the function raises an exception.

### Example Error Output
```json
{
  "error": "Unsupported file format for sample.docx",
  "bucket": "example-bucket",
  "key": "documents/sample.docx"
}
```

## Notes

- AWS Textract Permissions: The Lambda function needs permission to interact with AWS Textract and S3.
- Asynchronous Processing: Textract operates asynchronously. Ensure sufficient timeout for this function to allow completion of Textract jobs. This likely means a step function or other orchestration mechanism is needed to handle the asynchronous nature of Textract as it will go over the 30 second API Gateway timeout.

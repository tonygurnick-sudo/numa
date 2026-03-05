# Bedrock Data Extraction Lambda

## Overview

This Lambda function uses the Bedrock Claude model to extract structured data from text-based documents. It can handle both single and multi-page text inputs and supports different configurations for data extraction, making it adaptable for various use cases like personal finance or invoice extraction or insurance data etc. The function is designed to be integrated into a larger Numa app that requires data extraction from unstructured text, of which is currently limited in amazon Q.

Note: This function currently supports max pages as indicated in the MAX_PAGES global variable (30 pages as of time of writing). This is due to our lambda timeout limit of 15 minutes. If you need to process more pages, you will need to split the document into smaller chunks and process them separately.

## How It Works

1. **Configuration Selection**: The function identifies the extraction configuration from the input, including tool selection, prompt, and tool name.
2. **Model Invocation**: Based on the `data_extraction_type`, the function either extracts data from a single document or iteratively processes multiple pages.
3. **Data Extraction**: The selected configuration and prompt are applied to the Bedrock Claude model, which returns structured data for each page or document.
4. **Error Handling**: If an unknown configuration or extraction type is provided, the function raises an error.

## Input Schema

The function expects the following input fields:

- `content`: The document content to be processed. Can be a single text string or a dictionary containing a `text` key with a list of page content.
- `config`: (Optional) The name of the configuration to use for data extraction. Defaults to `"personal_finance"`.
- `data_extraction_type`: (Optional) Specifies the extraction type, either `"full_document"` or `"page_by_page"`. Defaults to `"page_by_page"`.

```json
{
  "content": "string | object",
  "config": "string",
  "data_extraction_type": "string"
}
```

### Example Input

**Single Document Extraction:**

```json
{
  "content": "This is a sample document text for extraction.",
  "config": "personal_finance",
  "data_extraction_type": "full_document"
}
```

**Multiple Document Extraction:**

```json
{
  "content": {
    "text": ["Page 1 content...", "Page 2 content..."]
  },
  "config": "personal_finance",
  "data_extraction_type": "page_by_page"
}
```

## Output Schema

The function returns a list of dictionaries containing the extracted data for each page or document.

```json
[
  {
    "field": "value"
  }
]
```

### Example Output

```json
[
  {
    "field": "Union Fees",
    "amount": "982.93"
  },
  {
    "field": "Rental Income",
    "amount": "23101.09"
  }
]
```

The exact fields in the output depends on the configuration and prompt used for data extraction.

## Notes

- **Token Limit**: The function is limited to an output of 8000 tokens for the model. It is rare to exceed this limit, but if it happens, the function will raise an error. The current input token limit for the default model, claude 3.5 sonnet, is 200k.
- **Configuration Management**: Configurations for different extraction types and prompts are stored separately (e.g., in a `config` file). Ensure that valid configurations are set up for each use case.
- **Model Selection**: The function uses the Bedrock Claude model anthropic.claude-3-5-sonnet-20240620-v1:0 for data extraction. Ensure that the model is available and accessible for the function to use. If a different model is required, update the initialisation of the model accordinly
- **Model Region**: The function uses an environment variable to grab the AWS_BEDROCk_REGION. Ensure that the region is set correctly for the model to be accessed. The default region is `us-east-1`.

# workspace-chat-tools

Lambda function providing tool implementations for the workspace-chat-agent.

## Overview

This Lambda acts as a proxy for privileged operations that the workspace chat agent needs to perform, such as querying knowledge bases, uploading files to KBs, and downloading KB content. The workspace chat agent invokes this Lambda with a tool name and parameters, and the Lambda executes the operation with full AWS permissions.

## Architecture

```
workspace-chat-agent (AgentCore)
    │
    │ Lambda.invoke()
    ▼
workspace-chat-tools Lambda
    │
    ├── query_knowledgebase → Bedrock KB / Q Business search
    ├── add_to_kb → Upload files to KB storage
    ├── retrieve_kb_file → Download/list KB files
    ├── web_search → Brave search API
    ├── extract_content → OCR/vision/transcription
    └── convert_document → Document format conversion
```

## Event Format

```json
{
    "tool": "<tool_name>",
    "params": { ... }
}
```

## Available Tools

### query_knowledgebase

Query the company or user knowledge base with optional summarization.

**Parameters:**

- `query` (str, required): Natural language search query
- `user_intent` (str, required): What the user is trying to accomplish
- `max_results` (int, default=6, max=15): Number of results
- `kb_id` (str, default="company"): KB to query - "company" or user KB UUID
- `summarise_results` (bool, default=true): When true, summarize using Nova Lite
- `all_kbs` (bool, default=false): Query all enabled KBs and synthesize results

**Response:**

- When `summarise_results=true`: Returns `summarised_content`
- When `summarise_results=false`: Returns `raw_content` (list of content pieces)

### add_to_kb

Upload a file from the workspace to a knowledge base.

**Parameters:**

- `source_key` (str, required): S3 key of file to upload (in outputs bucket)
- `kb_id` (str, default="company"): Target KB - "company" or user KB UUID
- `destination_path` (str, optional): Folder path within KB

**Response:**

- `status`: "success" or "error"
- `destination_uri`: S3 URI where file was uploaded

### retrieve_kb_file

Download files from KB storage or list available files.

**Parameters:**

- `s3_uri` (str): S3 URI to download (mutually exclusive with list)
- `list` (bool): List files in KB instead of downloading
- `kb_id` (str, default="company"): KB ID for listing
- `pattern` (str): Filename pattern filter for listing
- `download_folder` (bool): Download entire folder as zip
- `folder_path` (str): Folder path for download_folder mode

**Response (download):**

- `status`: "success" or "error"
- `content_base64`: Base64 encoded file content
- `filename`: Original filename

**Response (list):**

- `status`: "success" or "error"
- `files`: Array of `{key, size, last_modified}`

**Response (download_folder):**

- `status`: "success" or "error"
- `content_base64`: Base64 encoded zip file
- `filename`: Zip filename
- `file_count`: Number of files in zip

### web_search

Search the web using Brave Search API.

**Parameters:**

- `query` (str, required): Search query

### extract_content

Extract content from documents using AI vision/OCR.

**Parameters:**

- `source_key` (str, required): S3 key of file to process
- `extraction_type` (str): Type of extraction

### convert_document

Convert documents between formats.

**Parameters:**

- `source_key` (str, required): S3 key of source file
- `target_format` (str, required): Target format

## Environment Variables

| Variable                    | Description                                              |
| --------------------------- | -------------------------------------------------------- |
| `CLIENT_NAME`               | Client/tenant name for multi-tenant isolation            |
| `AWS_REGION`                | AWS region                                               |
| `PREFERRED_KNOWLEDGE_BASE`  | "q" or "bedrock" (default: bedrock)                      |
| `Q_APPLICATION_ID`          | Q Business application ID                                |
| `Q_RETRIEVER_ID`            | Q Business retriever ID                                  |
| `BEDROCK_KNOWLEDGE_BASE_ID` | Bedrock KB ID                                            |
| `FAST_MODEL_ID`             | Model for summarization (default: amazon.nova-lite-v1:0) |
| `DATA_BUCKET_NAME`          | S3 bucket for KB data                                    |
| `OUTPUTS_BUCKET_NAME`       | S3 bucket for workspace files                            |
| `BRAVE_API_KEY_SECRET_ARN`  | Secret ARN for Brave API key                             |

## Required IAM Permissions

- `bedrock:Retrieve` - Query Bedrock KB
- `bedrock:InvokeModel`, `bedrock:Converse` - Nova Lite summarization
- `qbusiness:SearchRelevantContent` - Query Q Business (if configured)
- `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` - KB file operations

## Development

```bash
# Install dependencies
cd lambdas/python/workspace-chat-tools
poetry install

# Run tests
poetry run pytest

# Package for deployment
cd ../..
bash package-python-lambda.sh lambdas/python/workspace-chat-tools
```

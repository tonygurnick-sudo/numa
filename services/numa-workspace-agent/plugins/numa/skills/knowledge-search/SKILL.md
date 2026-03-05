---
name: knowledge-search
description: Search, retrieve, and upload to company knowledge bases. Use for KB queries, document search, file downloads, or adding documents to knowledge bases.
---

# Knowledge Search Skill

Search, retrieve, and upload to enterprise knowledge bases for documents, policies, and company data.

## Quick Reference

```
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Searching knowledge base",
  params={"operation": "query", "query": "search terms", "user_intent": "what user wants to accomplish"}
)
```

## Operations

All KB operations use `name="knowledge_base"` with an `operation` parameter:

| Operation         | Purpose                               |
| ----------------- | ------------------------------------- |
| `query`           | Search KBs with AI summarization      |
| `upload`          | Add files to a knowledge base         |
| `download`        | Download a file by S3 URI or filename |
| `list`            | List files in a KB                    |
| `download_folder` | Download folder as zip                |

---

## operation: query

Search knowledge bases with optional AI summarization.

### Parameters

| Parameter           | Required | Default   | Description                                       |
| ------------------- | -------- | --------- | ------------------------------------------------- |
| `operation`         | Yes      | -         | `"query"`                                         |
| `query`             | Yes      | -         | Natural language search query                     |
| `user_intent`       | Yes      | -         | What the user is trying to accomplish             |
| `max_results`       | No       | 6         | Max results (max: 15)                             |
| `kb_id`             | No       | "company" | KB ID: "company" or user KB UUID                  |
| `summarise_results` | No       | true      | Summarize results (default)                       |
| `all_kbs`           | No       | false     | Query all enabled KBs and synthesize results      |
| `output_file`       | No       | -         | Write results to file instead of returning inline |

### Examples

```
# Simple KB search
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Searching KB for annual leave policy",
  params={"operation": "query", "query": "annual leave policy", "user_intent": "find how many days of leave employees get"}
)

# Query specific user KB
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Searching project KB for requirements",
  params={"operation": "query", "query": "project requirements", "user_intent": "find project specs", "kb_id": "abc-123-uuid"}
)

# Query all enabled KBs at once
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Searching all KBs for annual leave policy",
  params={"operation": "query", "query": "annual leave policy", "user_intent": "compare policies across departments", "all_kbs": true}
)

# Get raw content for detailed analysis
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Compiling security documentation from KB",
  params={"operation": "query", "query": "all IT security policies", "user_intent": "compile complete security documentation", "summarise_results": false, "max_results": 15, "output_file": "/workdir/outputs/security_policies.json"}
)
```

### Output Format

JSON response with:

- `summarised_content` or `raw_content` - The search results
- `references` - Source documents with S3 URIs
- `provider` - KB provider type (bedrock or q)
- `results_count` - Number of results
- `kbs_queried` - List of KB IDs queried (when using all_kbs)

### When to Use Summarized vs Raw Results

**Use AI Summary (default)** when:

- User wants a quick answer or conceptual understanding
- Explaining policies, procedures, or general information
- First pass to understand what's available in the KB
- User is non-technical or wants digestible information

**Use Raw Results (`summarise_results: false`)** when:

- User needs exact values: specific numbers, limits, thresholds, dates
- Extracting code examples, API parameters, or technical specifications
- User will quote or cite specific passages
- Creating documentation or reports requiring precision
- Troubleshooting with exact error codes or configuration details
- User explicitly asks for "exact", "verbatim", or "word-for-word" information

**Recommended workflow for complex research:**

1. Start with AI summary to understand the landscape
2. Follow up with raw results for implementation details or precision

---

## operation: upload

Add files from the workspace to a knowledge base for future retrieval.

### Parameters

| Parameter   | Required | Default   | Description                                                                                                         |
| ----------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `operation` | Yes      | -         | `"upload"`                                                                                                          |
| `file`      | Yes      | -         | Path to file in workspace                                                                                           |
| `kb_id`     | No       | "company" | Target KB ID                                                                                                        |
| `path`      | No       | root      | Folder prefix within KB (e.g. "reports/2024/"). This is a directory, NOT a filename — omit to upload to the KB root |

### Examples

```
# Upload to company KB (admin only)
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Uploading report to company KB",
  params={"operation": "upload", "file": "/workdir/outputs/report.pdf", "kb_id": "company"}
)

# Upload to user KB with folder path
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Uploading analysis to user KB",
  params={"operation": "upload", "file": "/workdir/outputs/analysis.docx", "kb_id": "abc-123-uuid", "path": "reports/2024/"}
)
```

### Permissions

- **Company KB**: Only admins can upload
- **User KBs**: Only editors/owners can upload

**Size limit**: 4 MB max. Larger files should be uploaded via the Numa web interface.

**Indexing**: Files are indexed within ~30 minutes and become searchable via KB queries.

---

## operation: download

Download files from knowledge base storage.

### Parameters

| Parameter    | Required | Default           | Description                           |
| ------------ | -------- | ----------------- | ------------------------------------- |
| `operation`  | Yes      | -                 | `"download"`                          |
| `file`       | \*       | -                 | Filename to download (use with kb_id) |
| `kb_id`      | No       | "company"         | KB ID when using file                 |
| `uri`        | \*       | -                 | Full S3 URI (alternative to file)     |
| `output_dir` | No       | /workdir/outputs/ | Download location                     |

\*Either `file` or `uri` must be provided.

### Examples

```
# Download by filename (simplest - use when you know the filename)
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Downloading employee handbook from KB",
  params={"operation": "download", "file": "employee-handbook.pdf", "kb_id": "company"}
)

# Download by S3 URI (from KB query result references)
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Downloading policy document from KB",
  params={"operation": "download", "uri": "s3://bucket/documents/company/policy.pdf"}
)

# Download to specific directory
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Downloading report to downloads folder",
  params={"operation": "download", "uri": "s3://bucket/documents/company/report.xlsx", "output_dir": "/workdir/outputs/downloads/"}
)
```

### When to use which mode

**Use `file + kb_id`** when:

- You know the filename (e.g., from system prompt KB listings)
- Downloading files shown in the conversation context
- Simpler and more direct - no need to run list first

**Use `uri`** when:

- Downloading from KB query result references (the `references` array includes S3 URIs)
- You have the full S3 URI from a previous operation

### Working with subfolders

For files in subfolders, include the relative path in `file`:

```
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Downloading Q4 summary from KB",
  params={"operation": "download", "file": "reports/2024/q4-summary.pdf", "kb_id": "company"}
)
```

Use file download when:

- You need to see tables, charts, or formatting
- The KB excerpt doesn't have enough context
- You want to quote specific sections verbatim

---

## operation: list

List files in a knowledge base, optionally filtered by pattern.

### Parameters

| Parameter   | Required | Default   | Description                     |
| ----------- | -------- | --------- | ------------------------------- |
| `operation` | Yes      | -         | `"list"`                        |
| `kb_id`     | No       | "company" | KB ID to list files from        |
| `pattern`   | No       | -         | Filename pattern (e.g., \*.pdf) |

### Examples

```
# List all files in company KB
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Listing files in company KB",
  params={"operation": "list", "kb_id": "company"}
)

# List only PDF files
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Listing PDF files in KB",
  params={"operation": "list", "kb_id": "company", "pattern": "*.pdf"}
)

# List files in a user KB
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Listing files in user KB",
  params={"operation": "list", "kb_id": "abc-123-uuid"}
)
```

---

## operation: download_folder

Download all files in a KB folder as a zip archive.

### Parameters

| Parameter     | Required | Default           | Description            |
| ------------- | -------- | ----------------- | ---------------------- |
| `operation`   | Yes      | -                 | `"download_folder"`    |
| `kb_id`       | No       | "company"         | KB ID to download from |
| `folder_path` | No       | root              | Folder path within KB  |
| `output_dir`  | No       | /workdir/outputs/ | Where to save the zip  |

### Examples

```
# Download entire company KB
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Downloading entire company KB",
  params={"operation": "download_folder", "kb_id": "company"}
)

# Download a specific folder
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Downloading 2024 reports folder from KB",
  params={"operation": "download_folder", "kb_id": "company", "folder_path": "reports/2024/"}
)

# Download from a user KB
mcp__numa__numa_tool(
  name="knowledge_base",
  description="Downloading contracts from user KB",
  params={"operation": "download_folder", "kb_id": "abc-123-uuid", "folder_path": "contracts/"}
)
```

**Limits:**

- Maximum 400 files per download
- Large folders may take time to process

The zip file preserves the folder structure within the KB.

### Working with Downloaded Folders

Downloaded KB folders are saved as **zip files**. For best results:

**1. Keep files zipped** - Don't extract. Web-crawled content has URL-encoded filenames that often exceed filesystem limits (255 chars).

**2. Analyze directly from zip** using Python's `zipfile` module:

```python
import zipfile

# List contents
with zipfile.ZipFile('/workdir/outputs/kb_download.zip', 'r') as z:
    for name in z.namelist():
        print(name)

# Read file content without extracting
with zipfile.ZipFile('/workdir/outputs/kb_download.zip', 'r') as z:
    with z.open('path/to/file.txt') as f:
        content = f.read().decode('utf-8')
```

**3. Write analysis scripts to files** rather than inline bash. Complex Python one-liners may be blocked. Instead:

```python
# Write script
with open('/workdir/outputs/analyze.py', 'w') as f:
    f.write('''
import zipfile
# ... analysis code ...
''')

# Then execute
# python3 /workdir/outputs/analyze.py
```

**4. URL-decode web-crawled filenames** for meaningful analysis:

```python
from urllib.parse import unquote
readable_name = unquote(url_encoded_filename)
```

**Benefits of zip-native analysis:**

- No disk space used for extraction
- No cleanup needed
- Avoids filename length errors
- Memory efficient (one file at a time)
- Works with any KB size up to the 400-file limit

---

## Citing Sources (Required)

**Always cite your sources when using information from knowledge base queries.** This builds trust and allows users to verify or explore the source documents.

Format S3 URIs from the KB query `references` array as clickable references:

```
<kb-source:s3://bucket/documents/company/policy.pdf>
```

This renders as a clickable pill in the chat interface that users can click to open/download the document.

**Example response with sources:**

```
Based on the company policy, employees are entitled to 25 days annual leave.

**Sources:**
- <kb-source:s3://numa-data/documents/company/hr-policies/leave-policy.pdf>
- <kb-source:s3://numa-data/documents/company/hr-policies/employee-handbook.pdf>
```

**Guidelines:**

- Include sources at the end of your response when KB information was used
- Use the S3 URIs from the `references` array in the KB query results
- List the most relevant sources (typically 1-3) rather than every result
- If multiple documents contributed to your answer, cite all relevant ones

---
name: numa-files-search
description: Search, retrieve, upload, download, and delete files in the user's Numa Files folders (Personal, Company Files, and any shared folders the user has access to). Use whenever the user asks about their files, company documents, policies, procedures, or anything stored in Numa.
---

# Numa Files Search Skill

Search, retrieve, and manage files inside the user's **Numa Files** folders. Every user has a seeded **Personal** folder (their private default save location), the workspace-wide **Company Files**, and may have additional private folders they've created or shared folders they have access to. The actual set of folders available to you is in the **Available Numa Files folders** section of your context — work from that list rather than assuming a fixed set.

> "Numa Files" is the user-facing name for the Numa file system. Folders inside it are the unit users select; each folder is searchable. Internally the tool dispatch ID is `numa_files` (preferred) and `knowledge_base` (legacy alias for chat history replay).

## Quick Reference

```
mcp__numa__numa_tool(
  name="numa_files",
  description="Searching files",
  params={"operation": "query", "query": "search terms", "user_intent": "what user wants to accomplish"}
)
```

## Operations

All Numa Files operations use `name="numa_files"` with an `operation` parameter:

| Operation         | Purpose                                        |
| ----------------- | ---------------------------------------------- |
| `query`           | Search files in a folder with AI summarization |
| `upload`          | Add files to a folder                          |
| `download`        | Download a file by S3 URI or filename          |
| `list`            | List files in a folder                         |
| `download_folder` | Download a folder (or sub-path) as zip         |
| `delete`          | Delete files from a folder                     |

---

## operation: query

Search inside the user's Numa Files folders, with optional AI summarization.

### Parameters

| Parameter           | Required | Default   | Description                                                                                                                 |
| ------------------- | -------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `operation`         | Yes      | -         | `"query"`                                                                                                                   |
| `query`             | Yes      | -         | Natural language search query                                                                                               |
| `user_intent`       | Yes      | -         | What the user is trying to accomplish                                                                                       |
| `max_results`       | No       | 6         | Max results (max: 15)                                                                                                       |
| `kb_id`             | No       | "company" | Folder ID: `"company"` (Company Files), a folder UUID, or `"sharepoint"` (workspace's connected SharePoint, when available) |
| `summarise_results` | No       | false     | Set to true to summarize results via Nova Lite. Default returns raw retrieved chunks (higher fidelity for reasoning).       |
| `all_kbs`           | No       | false     | Query all enabled folders and synthesize results                                                                            |
| `output_file`       | No       | -         | Write results to file instead of returning inline                                                                           |

### `kb_id="sharepoint"` — only for select workspaces (do not confuse with the Pipedream SharePoint integration)

**Two completely separate things are both called "SharePoint" in this system. Do not mix them up.**

1. **`kb_id="sharepoint"` (this skill)** — only exists on workspaces where the customer has paid for Amazon Q Business with a SharePoint data source indexed at the **workspace** level. Most workspaces do NOT have this. To check: look for `"sharepoint"` in `__allowed_kbs` for the current conversation. If it's not there, the option is unavailable — passing `kb_id="sharepoint"` will fail with an error. Just don't.

2. **The Pipedream `sharepoint-*` integration actions** (`sharepoint-search-files`, `sharepoint-get-file`, etc., invoked via `mcp__integrations__run_action`) — this is the standard, widely-enabled path. Use it for any SharePoint work on a normal workspace, and for write operations (upload, create, move) on any workspace.

**When `"sharepoint"` IS in `__allowed_kbs`:** prefer `kb_id="sharepoint"` for read / search / "find this content" intents — the query runs with the calling user's own SharePoint ACLs applied automatically (filtered server-side via Q Business identity federation, so the user only sees documents they can already see in SharePoint). Still use the Pipedream `sharepoint-*` actions for writes. For broad "search everything we know" intents, run both `kb_id="company"` and `kb_id="sharepoint"` (or set `all_kbs: true`).

**When `"sharepoint"` is NOT in `__allowed_kbs`:** the workspace does not have Q Business SharePoint provisioned. Use the Pipedream `sharepoint-*` integration actions instead. Never pass `kb_id="sharepoint"` on this kind of workspace.

### Examples

```
# Simple search across the default folder (Company Files)
mcp__numa__numa_tool(
  name="numa_files",
  description="Searching files for annual leave policy",
  params={"operation": "query", "query": "annual leave policy", "user_intent": "find how many days of leave employees get"}
)

# Search a specific folder
mcp__numa__numa_tool(
  name="numa_files",
  description="Searching the project folder for requirements",
  params={"operation": "query", "query": "project requirements", "user_intent": "find project specs", "kb_id": "abc-123-uuid"}
)

# Search the connected SharePoint (ACL-filtered to what the caller can see)
mcp__numa__numa_tool(
  name="numa_files",
  description="Searching SharePoint for the latest pricing deck",
  params={"operation": "query", "query": "Q4 pricing deck", "user_intent": "find the latest SharePoint pricing deck", "kb_id": "sharepoint"}
)

# Search all enabled folders at once (includes SharePoint if enabled)
mcp__numa__numa_tool(
  name="numa_files",
  description="Searching all folders for annual leave policy",
  params={"operation": "query", "query": "annual leave policy", "user_intent": "compare policies across departments", "all_kbs": true}
)

# Get raw content for detailed analysis
mcp__numa__numa_tool(
  name="numa_files",
  description="Compiling security documentation from files",
  params={"operation": "query", "query": "all IT security policies", "user_intent": "compile complete security documentation", "summarise_results": false, "max_results": 15, "output_file": "/workdir/outputs/security_policies.json"}
)
```

### Output Format

JSON response with:

- `summarised_content` or `raw_content` - The search results
- `references` - Source documents with S3 URIs
- `provider` - Search provider type (bedrock or q)
- `results_count` - Number of results
- `kbs_queried` - List of folder IDs queried (when using all_kbs)

### When to Use Summarized vs Raw Results

**Use Raw Results (default)** when:

- User needs exact values: specific numbers, limits, thresholds, dates
- Extracting code examples, API parameters, or technical specifications
- User will quote or cite specific passages
- Creating documentation or reports requiring precision
- Any task where fidelity matters more than digestibility — raw chunks are strictly higher-fidelity input for reasoning

**Use AI Summary (`summarise_results: true`)** when:

- User explicitly asks for a paraphrased digest or "in plain English" summary
- Audience is non-technical and a wall of raw chunks would be unhelpful
- You're confident the question is purely conceptual and exact values aren't needed

Raw results add one Bedrock retrieval; opting into summarisation adds a second Nova Lite pass on top, which has historically caused read-timeout hangs in customer sessions on long results. Default to raw unless you have a clear reason not to.

- Troubleshooting with exact error codes or configuration details
- User explicitly asks for "exact", "verbatim", or "word-for-word" information

**Recommended workflow for complex research:**

1. Start with AI summary to understand the landscape
2. Follow up with raw results for implementation details or precision

---

## operation: upload

Add files from the workspace to a folder for future retrieval.

### Parameters

| Parameter   | Required | Default   | Description                                                                                                                                                                                                                                                                            |
| ----------- | -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operation` | Yes      | -         | `"upload"`                                                                                                                                                                                                                                                                             |
| `file`      | Yes      | -         | Path to file in workspace                                                                                                                                                                                                                                                              |
| `kb_id`     | No       | "company" | Target folder ID                                                                                                                                                                                                                                                                       |
| `path`      | No       | root      | **IMPORTANT: Always include when uploading to a sub-path.** Folder prefix within the target folder (e.g. `"reports/2024/"`). This is a directory path, NOT a filename. Omit only when uploading to the folder root. The parameter name MUST be `path` (not `destination` or `folder`). |

### Examples

```
# Upload to Company Files (admin only)
mcp__numa__numa_tool(
  name="numa_files",
  description="Uploading report to Company Files",
  params={"operation": "upload", "file": "/workdir/outputs/report.pdf", "kb_id": "company"}
)

# Upload to a user folder with sub-path
mcp__numa__numa_tool(
  name="numa_files",
  description="Uploading analysis to user folder",
  params={"operation": "upload", "file": "/workdir/outputs/analysis.docx", "kb_id": "abc-123-uuid", "path": "reports/2024/"}
)
```

### Permissions

- **Company Files**: Only admins can upload
- **User folders**: Only editors/owners can upload

**Indexing**: Files are indexed within ~30 minutes and become searchable via folder queries.

---

## operation: download

Download files from Numa Files storage.

### Parameters

| Parameter    | Required | Default           | Description                           |
| ------------ | -------- | ----------------- | ------------------------------------- |
| `operation`  | Yes      | -                 | `"download"`                          |
| `file`       | \*       | -                 | Filename to download (use with kb_id) |
| `kb_id`      | No       | "company"         | Folder ID when using file             |
| `uri`        | \*       | -                 | Full S3 URI (alternative to file)     |
| `output_dir` | No       | /workdir/outputs/ | Download location                     |

\*Either `file` or `uri` must be provided.

### Examples

```
# Download by filename (simplest - use when you know the filename)
mcp__numa__numa_tool(
  name="numa_files",
  description="Downloading employee handbook from Company Files",
  params={"operation": "download", "file": "employee-handbook.pdf", "kb_id": "company"}
)

# Download by S3 URI (from query result references)
mcp__numa__numa_tool(
  name="numa_files",
  description="Downloading policy document",
  params={"operation": "download", "uri": "s3://bucket/documents/company/policy.pdf"}
)

# Download to specific directory
mcp__numa__numa_tool(
  name="numa_files",
  description="Downloading report to downloads folder",
  params={"operation": "download", "uri": "s3://bucket/documents/company/report.xlsx", "output_dir": "/workdir/outputs/downloads/"}
)
```

### When to use which mode

**Use `file + kb_id`** when:

- You know the filename (e.g., from system prompt folder listings)
- Downloading files shown in the conversation context
- Simpler and more direct - no need to run list first

**Use `uri`** when:

- Downloading from query result references (the `references` array includes S3 URIs)
- You have the full S3 URI from a previous operation

### Working with sub-paths

For files inside sub-paths, include the relative path in `file`:

```
mcp__numa__numa_tool(
  name="numa_files",
  description="Downloading Q4 summary",
  params={"operation": "download", "file": "reports/2024/q4-summary.pdf", "kb_id": "company"}
)
```

Use file download when:

- You need to see tables, charts, or formatting
- The search excerpt doesn't have enough context
- You want to quote specific sections verbatim

---

## operation: list

List files in a folder, optionally filtered by pattern.

### Parameters

| Parameter   | Required | Default   | Description                     |
| ----------- | -------- | --------- | ------------------------------- |
| `operation` | Yes      | -         | `"list"`                        |
| `kb_id`     | No       | "company" | Folder ID to list files from    |
| `pattern`   | No       | -         | Filename pattern (e.g., \*.pdf) |

### Examples

```
# List all files in Company Files
mcp__numa__numa_tool(
  name="numa_files",
  description="Listing files in Company Files",
  params={"operation": "list", "kb_id": "company"}
)

# List only PDF files
mcp__numa__numa_tool(
  name="numa_files",
  description="Listing PDF files in Company Files",
  params={"operation": "list", "kb_id": "company", "pattern": "*.pdf"}
)

# List files in a user folder
mcp__numa__numa_tool(
  name="numa_files",
  description="Listing files in a user folder",
  params={"operation": "list", "kb_id": "abc-123-uuid"}
)
```

---

## operation: download_folder

Download all files in a folder (or a sub-path of one) as a zip archive.

### Parameters

| Parameter     | Required | Default           | Description                |
| ------------- | -------- | ----------------- | -------------------------- |
| `operation`   | Yes      | -                 | `"download_folder"`        |
| `kb_id`       | No       | "company"         | Folder ID to download from |
| `folder_path` | No       | root              | Sub-path within the folder |
| `output_dir`  | No       | /workdir/outputs/ | Where to save the zip      |

### Examples

```
# Download entire Company Files
mcp__numa__numa_tool(
  name="numa_files",
  description="Downloading entire Company Files",
  params={"operation": "download_folder", "kb_id": "company"}
)

# Download a specific sub-path
mcp__numa__numa_tool(
  name="numa_files",
  description="Downloading 2024 reports sub-path",
  params={"operation": "download_folder", "kb_id": "company", "folder_path": "reports/2024/"}
)

# Download a sub-path of a user folder
mcp__numa__numa_tool(
  name="numa_files",
  description="Downloading contracts from user folder",
  params={"operation": "download_folder", "kb_id": "abc-123-uuid", "folder_path": "contracts/"}
)
```

**Limits:**

- Maximum 400 files per download
- Large folders may take time to process

The zip file preserves the folder structure.

### Working with Downloaded Folders

Downloaded folders are saved as **zip files**. For best results:

**1. Keep files zipped** - Don't extract. Web-crawled content has URL-encoded filenames that often exceed filesystem limits (255 chars).

**2. Analyze directly from zip** using Python's `zipfile` module:

```python
import zipfile

# List contents
with zipfile.ZipFile('/workdir/outputs/folder_download.zip', 'r') as z:
    for name in z.namelist():
        print(name)

# Read file content without extracting
with zipfile.ZipFile('/workdir/outputs/folder_download.zip', 'r') as z:
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
- Works with any folder size up to the 400-file limit

---

## operation: delete

Delete files from a folder. Use this to remove outdated, duplicate, or incorrectly placed files.

### Parameters

| Parameter   | Required | Default   | Description                                                                         |
| ----------- | -------- | --------- | ----------------------------------------------------------------------------------- |
| `operation` | Yes      | -         | `"delete"`                                                                          |
| `file`      | Yes      | -         | Relative path within the folder (e.g. `"old-report.pdf"` or `"reports/draft.docx"`) |
| `kb_id`     | No       | "company" | Folder ID                                                                           |

### Examples

```
# Delete file from folder root
mcp__numa__numa_tool(
  name="numa_files",
  description="Deleting outdated report from Company Files",
  params={"operation": "delete", "file": "old-report.pdf", "kb_id": "company"}
)

# Delete file from a sub-path
mcp__numa__numa_tool(
  name="numa_files",
  description="Removing duplicate file from a folder sub-path",
  params={"operation": "delete", "file": "3 - Agency Reports/duplicate.docx", "kb_id": "abc-123-uuid"}
)
```

### Permissions

- **Company Files**: Only admins can delete
- **User folders**: Only editors/owners can delete

### Tips

- Use `list` first to see the exact filenames/paths before deleting
- Deleting a file also removes its metadata sidecar
- The folder index will update within ~30 minutes after deletion

---

## Citing Sources (Required)

**Always cite your sources when using information from a Numa Files search.** This builds trust and lets users verify or open the source documents.

Format S3 URIs from the `references` array as `<kb-source:...>` tags — the chat UI renders these as clickable source pills. (The tag name `kb-source` is a parser format kept for compatibility; users see a styled pill, not the raw tag.)

```
<kb-source:s3://bucket/documents/company/policy.pdf>
```

**Example response with sources:**

```
Based on the company policy, employees are entitled to 25 days annual leave.

**Sources:**
- <kb-source:s3://numa-data/documents/company/hr-policies/leave-policy.pdf>
- <kb-source:s3://numa-data/documents/company/hr-policies/employee-handbook.pdf>
```

**Guidelines:**

- Include sources at the end of your response when Numa Files content was used
- Use the S3 URIs from the `references` array in the query results
- List the most relevant sources (typically 1-3) rather than every result
- If multiple documents contributed to your answer, cite all relevant ones

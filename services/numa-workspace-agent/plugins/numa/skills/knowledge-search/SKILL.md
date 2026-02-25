---
name: knowledge-search
description: Search, retrieve, and upload to company knowledge bases. Use for KB queries, document search, file downloads, or adding documents to knowledge bases.
---

# Knowledge Search Skill

Search, retrieve, and upload to enterprise knowledge bases for documents, policies, and company data.

## Quick Reference

```bash
python3 /workdir/tools/numa/knowledge_base.py query \
    --query "search terms" \
    --user-intent "what user wants to accomplish"
```

## Subcommands

| Subcommand | Purpose |
|------------|---------|
| `query` | Search KBs with AI summarization |
| `upload` | Add files to a knowledge base |
| `download` | Download a file by S3 URI |
| `list` | List files in a KB |
| `download-folder` | Download folder as zip |

---

## Query Subcommand

Search knowledge bases with optional AI summarization.

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--query, -q` | Yes | - | Natural language search query |
| `--user-intent, -u` | Yes | - | What the user is trying to accomplish |
| `--max-results, -m` | No | 6 | Max results (max: 15) |
| `--kb-id, -k` | No | "company" | KB ID: "company" or user KB UUID |
| `--summarise` | No | Yes | Summarize results (default) |
| `--no-summarise` | No | - | Return raw results |
| `--all-kbs` | No | - | Query all enabled KBs and synthesize results |
| `--output-file, -o` | No | - | Write results to file instead of stdout |

### Examples

```bash
# Simple KB search
python3 /workdir/tools/numa/knowledge_base.py query \
    --query "annual leave policy" \
    --user-intent "find how many days of leave employees get"

# Query specific user KB
python3 /workdir/tools/numa/knowledge_base.py query \
    --query "project requirements" \
    --user-intent "find project specs" \
    --kb-id "abc-123-uuid"

# Query all enabled KBs at once
python3 /workdir/tools/numa/knowledge_base.py query \
    --query "annual leave policy" \
    --user-intent "compare policies across departments" \
    --all-kbs

# Get raw content for detailed analysis
python3 /workdir/tools/numa/knowledge_base.py query \
    --query "all IT security policies" \
    --user-intent "compile complete security documentation" \
    --no-summarise \
    --max-results 15 \
    --output-file /workdir/session/security_policies.json
```

### Output Format

JSON response with:
- `summarised_content` or `raw_content` - The search results
- `references` - Source documents with S3 URIs
- `provider` - KB provider type (bedrock or q)
- `results_count` - Number of results
- `kbs_queried` - List of KB IDs queried (when using --all-kbs)

### When to Use Summarized vs Raw Results

**Use AI Summary (default)** when:
- User wants a quick answer or conceptual understanding
- Explaining policies, procedures, or general information
- First pass to understand what's available in the KB
- User is non-technical or wants digestible information

**Use Raw Results (`--no-summarise`)** when:
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

## Upload Subcommand

Add files from the workspace to a knowledge base for future retrieval.

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--file, -f` | Yes | - | Path to file in workspace |
| `--kb-id, -k` | No | "company" | Target KB ID |
| `--path, -p` | No | root | Folder path within KB |

### Examples

```bash
# Upload to company KB (admin only)
python3 /workdir/tools/numa/knowledge_base.py upload \
    --file /workdir/session/report.pdf \
    --kb-id company

# Upload to user KB with folder path
python3 /workdir/tools/numa/knowledge_base.py upload \
    --file /workdir/session/analysis.docx \
    --kb-id "abc-123-uuid" \
    --path "reports/2024/"
```

### Permissions
- **Company KB**: Only admins can upload
- **User KBs**: Only editors/owners can upload

**Size limit**: 4 MB max. Larger files should be uploaded via the Numa web interface.

**Indexing**: Files are indexed within ~30 minutes and become searchable via KB queries.

---

## Download Subcommand

Download files from knowledge base storage.

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--file, -f` | * | - | Filename to download (use with --kb-id) |
| `--kb-id, -k` | No | "company" | KB ID when using --file |
| `--uri, -u` | * | - | Full S3 URI (alternative to --file) |
| `--output-dir, -o` | No | /workdir/session/ | Download location |

*Either `--file` or `--uri` must be provided.

### Examples

```bash
# Download by filename (simplest - use when you know the filename)
python3 /workdir/tools/numa/knowledge_base.py download \
    --file "employee-handbook.pdf" --kb-id company

# Download from user KB by filename
python3 /workdir/tools/numa/knowledge_base.py download \
    --file "project-specs.docx" --kb-id "abc-123-uuid"

# Download by S3 URI (from KB query result references)
python3 /workdir/tools/numa/knowledge_base.py download \
    --uri "s3://bucket/documents/company/policy.pdf"

# Download to specific directory
python3 /workdir/tools/numa/knowledge_base.py download \
    --uri "s3://bucket/documents/company/report.xlsx" \
    --output-dir /workdir/session/downloads/
```

### When to use which mode

**Use `--file + --kb-id`** when:
- You know the filename (e.g., from system prompt KB listings)
- Downloading files shown in the conversation context
- Simpler and more direct - no need to run `list` first

**Use `--uri`** when:
- Downloading from KB query result references (the `references` array includes S3 URIs)
- You have the full S3 URI from a previous operation

### Working with subfolders

For files in subfolders, include the relative path in `--file`:
```bash
python3 /workdir/tools/numa/knowledge_base.py download \
    --file "reports/2024/q4-summary.pdf" --kb-id company
```

Use file download when:
- You need to see tables, charts, or formatting
- The KB excerpt doesn't have enough context
- You want to quote specific sections verbatim

---

## List Subcommand

List files in a knowledge base, optionally filtered by pattern.

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--kb-id, -k` | No | "company" | KB ID to list files from |
| `--pattern, -p` | No | - | Filename pattern (e.g., *.pdf) |

### Examples

```bash
# List all files in company KB
python3 /workdir/tools/numa/knowledge_base.py list --kb-id company

# List only PDF files
python3 /workdir/tools/numa/knowledge_base.py list \
    --kb-id company --pattern "*.pdf"

# List files in a user KB
python3 /workdir/tools/numa/knowledge_base.py list \
    --kb-id "abc-123-uuid"
```

---

## Download-Folder Subcommand

Download all files in a KB folder as a zip archive.

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--kb-id, -k` | No | "company" | KB ID to download from |
| `--folder-path, -f` | No | root | Folder path within KB |
| `--output-dir, -o` | No | /workdir/session/ | Where to save the zip |

### Examples

```bash
# Download entire company KB
python3 /workdir/tools/numa/knowledge_base.py download-folder \
    --kb-id company

# Download a specific folder
python3 /workdir/tools/numa/knowledge_base.py download-folder \
    --kb-id company --folder-path "reports/2024/"

# Download from a user KB
python3 /workdir/tools/numa/knowledge_base.py download-folder \
    --kb-id "abc-123-uuid" --folder-path "contracts/"
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
with zipfile.ZipFile('/workdir/session/kb_download.zip', 'r') as z:
    for name in z.namelist():
        print(name)

# Read file content without extracting
with zipfile.ZipFile('/workdir/session/kb_download.zip', 'r') as z:
    with z.open('path/to/file.txt') as f:
        content = f.read().decode('utf-8')
```

**3. Write analysis scripts to files** rather than inline bash. Complex Python one-liners may be blocked. Instead:

```python
# Write script
with open('/workdir/session/analyze.py', 'w') as f:
    f.write('''
import zipfile
# ... analysis code ...
''')

# Then execute
# python3 /workdir/session/analyze.py
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

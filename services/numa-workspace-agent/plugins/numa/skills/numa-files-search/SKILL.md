---
name: numa-files-search
description: Search, retrieve, upload, download, and delete files in the user's Numa Files folders (Personal, Company Files, and any shared folders the user has access to). Use whenever the user asks about their files, company documents, policies, procedures, or anything stored in Numa.
---

# Numa Files Search Skill

Search, retrieve, and manage files inside the user's **Numa Files** folders. Every user has a seeded **Personal** folder (their private default save location), the workspace-wide **Company Files**, and may have additional private folders they've created or shared folders they have access to. The actual set of folders available to you is in the **Available Numa Files folders** section of your context — work from that list rather than assuming a fixed set.

> "Numa Files" is the user-facing name for the Numa file system. Folders inside it are the unit users select; each folder is searchable.

## Quick Reference

```
Bash("numa files search 'search terms' --json -m 'Searching files'")
```

## Operations

All Numa Files operations use the `numa files` command:

| Operation         | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| `search`          | RAG search across folders (raw matches by default) |
| `upload`          | Add files to a folder                              |
| `download`        | Download a file by `<folder>/<file>`               |
| `list`            | List the folders you have access to                |
| `show`            | List the files inside a folder                     |
| `download-folder` | Download a folder (or sub-path) as zip             |
| `delete`          | Delete files from a folder                         |

---

## numa files search

Search inside the user's Numa Files folders, with optional AI summarization.

### Parameters

| Parameter       | Required | Default | Description                                                                                                                                                                                           |
| --------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`         | Yes      | -       | Natural language search query (positional arg)                                                                                                                                                        |
| `--intent`      | No       | query   | What the user is trying to accomplish. Only used when `--summarise` is set; defaults to the query itself.                                                                                             |
| `--max-results` | No       | 6       | Max results (max: 15)                                                                                                                                                                                 |
| `--folder`      | No       | all     | Narrow to a single folder by name or id: `"company"` (Company Files), a folder UUID, or `"sharepoint"` (workspace's connected SharePoint, when available). Omit to search across all enabled folders. |
| `--all`         | No       | -       | Explicitly search across all enabled folders. This is also the default when `--folder` is omitted; `--all` wins if both are given.                                                                    |
| `--summarise`   | No       | false   | Opt in to LLM-summarise results via Nova Lite. Default returns raw retrieved chunks (higher fidelity for reasoning).                                                                                  |

### `--folder sharepoint` — only for select workspaces (do not confuse with the Pipedream SharePoint integration)

**Two completely separate things are both called "SharePoint" in this system. Do not mix them up.**

1. **`--folder sharepoint` (this skill)** — only exists on workspaces where the customer has paid for Amazon Q Business with a SharePoint data source indexed at the **workspace** level. Most workspaces do NOT have this. To check: look for `"sharepoint"` in `__allowed_kbs` for the current conversation. If it's not there, the option is unavailable — passing `--folder sharepoint` will fail with an error. Just don't.

2. **The Pipedream `sharepoint-*` integration actions** (`sharepoint-search-files`, `sharepoint-get-file`, etc., invoked via `numa integrations pipedream-call`) — this is the standard, widely-enabled path. Use it for any SharePoint work on a normal workspace, and for write operations (upload, create, move) on any workspace.

**When `"sharepoint"` IS in `__allowed_kbs`:** prefer `--folder sharepoint` for read / search / "find this content" intents — the query runs with the calling user's own SharePoint ACLs applied automatically (filtered server-side via Q Business identity federation, so the user only sees documents they can already see in SharePoint). Still use the Pipedream `sharepoint-*` actions for writes. For broad "search everything we know" intents, run both `--folder company` and `--folder sharepoint` (or set `--all`).

**When `"sharepoint"` is NOT in `__allowed_kbs`:** the workspace does not have Q Business SharePoint provisioned. Use the Pipedream `sharepoint-*` integration actions instead. Never pass `--folder sharepoint` on this kind of workspace.

### Examples

```
# Simple search across all enabled folders (the default when --folder is omitted)
Bash("numa files search 'annual leave policy' --json -m 'Searching files for annual leave policy'")

# Search a specific folder (by name or id)
Bash("numa files search 'project requirements' --folder abc-123-uuid --json -m 'Searching the project folder for requirements'")

# Search the connected SharePoint (ACL-filtered to what the caller can see)
Bash("numa files search 'Q4 pricing deck' --folder sharepoint --json -m 'Searching SharePoint for the latest pricing deck'")

# Explicitly search all enabled folders at once (includes SharePoint if enabled)
Bash("numa files search 'annual leave policy' --all --json -m 'Searching all folders for annual leave policy'")

# Opt in to an LLM summary (intent guides the summarisation)
Bash("numa files search 'all IT security policies' --summarise --intent 'compile complete security documentation' --max-results 15 --json -m 'Compiling security documentation from files'")
```

### Output Format

JSON response with:

- `summarised_content` or `raw_content` - The search results
- `references` - Source documents with S3 URIs
- `provider` - Search provider type (bedrock or q)
- `results_count` - Number of results
- `kbs_queried` - List of folder IDs queried (when searching across all folders)

### When to Use Summarized vs Raw Results

**Use Raw Results (default)** when:

- User needs exact values: specific numbers, limits, thresholds, dates
- Extracting code examples, API parameters, or technical specifications
- User will quote or cite specific passages
- Creating documentation or reports requiring precision
- Any task where fidelity matters more than digestibility — raw chunks are strictly higher-fidelity input for reasoning

**Use AI Summary (`--summarise`)** when:

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

## numa files upload

Add files from the workspace to a folder for future retrieval.

### Parameters

| Parameter    | Required | Default  | Description                                                                                                                                                                                                                                                                                           |
| ------------ | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`       | Yes      | -        | Local path to file in workspace (positional arg)                                                                                                                                                                                                                                                      |
| `--to`       | Yes      | -        | Destination folder (name or id). `--folder` is an accepted alias for `--to` — prefer `--to`.                                                                                                                                                                                                          |
| `--path`     | No       | root     | Subfolder prefix within the destination folder, e.g. `"reports/2024/"`. Omit to upload to the folder root. This is a directory path, NOT a filename. **If this file came from a sub-path earlier in the conversation, the updated version must go back to the same sub-path — do not drift to root.** |
| `--filename` | No       | basename | Override the destination filename (defaults to the local file's basename).                                                                                                                                                                                                                            |

### Examples

```
# Upload to Company Files root (admin only) — omit --path for the root
Bash("numa files upload /workdir/outputs/report.pdf --to company -m 'Uploading report to Company Files root'")

# Upload to a user folder with sub-path
Bash("numa files upload /workdir/outputs/analysis.docx --to abc-123-uuid --path 'reports/2024/' -m 'Uploading analysis to user folder'")

# Updating a file you downloaded from a sub-path — preserve the sub-path
# (the file lived at reports/2024/q3.pdf — upload back to "reports/2024/")
Bash("numa files upload /workdir/outputs/q3.pdf --to company --path 'reports/2024/' -m 'Uploading updated q3 report back to reports/2024/'")
```

### Permissions

- **Company Files**: Only admins can upload
- **User folders**: Only editors/owners can upload

**Indexing**: Files are indexed within ~30 minutes and become searchable via folder queries.

---

## numa files download

Download files from Numa Files storage.

### Parameters

| Parameter      | Required | Default      | Description                                                                                                                                                                                               |
| -------------- | -------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folder/file`  | Yes      | -            | Single positional arg combining folder and filename, e.g. `Company/titanic.csv` or `<folder-id>/notes.md`. The folder may be a name or id; include sub-paths inline (e.g. `Company/reports/2024/q4.pdf`). |
| `-o, --output` | No       | ./<filename> | Local file path to write to (a full path, not a directory).                                                                                                                                               |

### Examples

```
# Download by folder/file (use when you know the folder + filename)
Bash("numa files download 'Company/employee-handbook.pdf' -m 'Downloading employee handbook from Company Files'")

# Download from a user folder by id
Bash("numa files download 'abc-123-uuid/policy.pdf' -m 'Downloading policy document'")

# Download to a specific local path
Bash("numa files download 'Company/report.xlsx' -o /workdir/outputs/downloads/report.xlsx -m 'Downloading report to downloads folder'")
```

### Working with sub-paths

For files inside sub-paths, include the relative path after the folder:

```
Bash("numa files download 'Company/reports/2024/q4-summary.pdf' -m 'Downloading Q4 summary'")
```

Use file download when:

- You need to see tables, charts, or formatting
- The search excerpt doesn't have enough context
- You want to quote specific sections verbatim

---

## numa files list

List the **folders** (knowledge bases) you have access to. Takes no folder/pattern flags — it always returns the full list of accessible folders with their names and ids. To see the files _inside_ a folder, use `numa files show <folder>`.

### Examples

```
# List the folders you can access (names + ids)
Bash("numa files list --json -m 'Listing accessible folders'")
```

---

## numa files show

List the **files inside** a folder. Pass the folder name or id as a positional argument.

### Parameters

| Parameter | Required | Default | Description       |
| --------- | -------- | ------- | ----------------- |
| `folder`  | Yes      | -       | Folder name or id |

### Examples

```
# List files in Company Files
Bash("numa files show company --json -m 'Listing files in Company Files'")

# List files in a user folder
Bash("numa files show abc-123-uuid --json -m 'Listing files in a user folder'")
```

> To match files by glob pattern (e.g. `*.pdf`), use `numa files find '<pattern>'` instead.

---

## numa files download-folder

Download all files in a folder (or a sub-path of one) as a zip archive.

### Parameters

| Parameter       | Required | Default        | Description                                         |
| --------------- | -------- | -------------- | --------------------------------------------------- |
| `folder`        | Yes      | -              | Folder name or id to download from (positional arg) |
| `--folder-path` | No       | root           | Sub-path within the folder                          |
| `-o, --output`  | No       | ./<folder>.zip | Local zip path to write to                          |

### Examples

```
# Download entire Company Files
Bash("numa files download-folder company -m 'Downloading entire Company Files'")

# Download a specific sub-path
Bash("numa files download-folder company --folder-path 'reports/2024/' -m 'Downloading 2024 reports sub-path'")

# Download a sub-path of a user folder, to a specific zip path
Bash("numa files download-folder abc-123-uuid --folder-path 'contracts/' -o /workdir/outputs/contracts.zip -m 'Downloading contracts from user folder'")
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

## numa files delete

Delete files from a folder. Use this to remove outdated, duplicate, or incorrectly placed files.

### Parameters

| Parameter     | Required | Default | Description                                                                                                                                                                            |
| ------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folder/file` | Yes      | -       | Single positional arg combining folder and filename, e.g. `Company/old-report.pdf`. The folder may be a name or id; include sub-paths inline (e.g. `abc-123-uuid/reports/draft.docx`). |

### Examples

```
# Delete file from folder root
Bash("numa files delete 'company/old-report.pdf' -m 'Deleting outdated report from Company Files'")

# Delete file from a sub-path
Bash("numa files delete 'abc-123-uuid/3 - Agency Reports/duplicate.docx' -m 'Removing duplicate file from a folder sub-path'")
```

### Permissions

- **Company Files**: Only admins can delete
- **User folders**: Only editors/owners can delete

### Tips

- Use `show <folder>` first to see the exact filenames/paths before deleting
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
- **Cite on EVERY turn that uses KB content — not just summary turns.** The most-skipped case is the headline explanation on the first turn: if your answer draws on a Numa Files document, it gets a `<kb-source:…>` tag, even when you'll summarise again later. No KB-derived claim ships without its source.

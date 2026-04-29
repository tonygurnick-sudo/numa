#!/usr/bin/env python3
"""
Numa Files — MCP Tool Reference
================================

Search, upload, download, list, and delete files inside the user's Numa
Files folders (My Files, Company Files, and any shared folders) via the
mcp__numa__numa_tool MCP tool. Load the `numa-files-search` skill for
detailed guidance on citing sources, raw vs summarized results, and
working with downloaded folders.

Tool name:  numa_files          (preferred)
            knowledge_base      (legacy alias — accepted for chat history replay)

All operations dispatch through a single tool, with the action chosen via
the `operation` parameter. Available operations:

  query             Search files in a folder with optional AI summarization
  upload            Add a file to a folder
  download          Download a file by filename or S3 URI
  list              List the contents of a folder (one level at a time)
  download_folder   Download a folder (or sub-path) as a zip
  delete            Delete a file from a folder

All examples below are mcp__numa__numa_tool calls.


operation: query
----------------

Parameters:
  query              (required)  Natural language search query
  user_intent        (required)  What the user is trying to accomplish
  max_results        (optional)  Max results (default: 6, max: 15)
  kb_id              (optional)  Folder ID: "company" (Company Files, default)
                                 or a folder UUID for a user/shared folder
  summarise_results  (optional)  Summarize results with Nova Lite (default: false).
                                 Default returns raw retrieved chunks so you can
                                 reason over the original content. Opt in only
                                 when you explicitly want a paraphrased summary.
  all_kbs            (optional)  Search all enabled folders (default: false)
  output_file        (optional)  Write results to file instead of returning inline

Return shape:
  Default (summarise_results=false):
    { "raw_content": [chunk, ...], "references": [...], "query": "...", "results_count": N }
  Opt-in (summarise_results=true):
    { "summarised_content": "...", "references": [...], "query": "...", "results_count": N }

Examples:

  # Simple search across the default folder (raw chunks — the default)
  mcp__numa__numa_tool(
    name="numa_files",
    description="Searching files for annual leave policy",
    params={"operation": "query", "query": "annual leave policy", "user_intent": "find leave entitlements"}
  )

  # Search a specific user folder
  mcp__numa__numa_tool(
    name="numa_files",
    description="Searching project folder for requirements",
    params={"operation": "query", "query": "project requirements", "user_intent": "find specs", "kb_id": "abc-123-uuid"}
  )

  # Search across all enabled folders
  mcp__numa__numa_tool(
    name="numa_files",
    description="Searching all folders for compliance info",
    params={"operation": "query", "query": "compliance", "user_intent": "compare policies", "all_kbs": true}
  )

  # Opt into AI summarization when a paraphrased digest is more useful
  # than raw chunks (e.g. surfacing a concept to a non-technical reader)
  mcp__numa__numa_tool(
    name="numa_files",
    description="Summarizing IT security posture",
    params={
      "operation": "query",
      "query": "IT security policies",
      "user_intent": "explain our security posture in plain English",
      "summarise_results": true,
      "max_results": 15
    }
  )


operation: upload
-----------------

Parameters:
  file    (required)  Path to file in workspace
  kb_id   (optional)  Target folder ID (default: "company")
  path    (optional)  Sub-path within the folder

Examples:

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

Permissions:
  Company Files — only admins can upload
  User folders — only editors/owners can upload
Indexing: Files searchable within ~30 minutes.


operation: download
-------------------

Parameters:
  file        (* required)  Filename to download (use with kb_id)
  kb_id       (optional)    Folder ID when using file (default: "company")
  uri         (* required)  Full S3 URI (alternative to file)
  output_dir  (optional)    Download location (default: /workdir/outputs/)

* Either file or uri must be provided.

Examples:

  # Download by filename
  mcp__numa__numa_tool(
    name="numa_files",
    description="Downloading employee handbook",
    params={"operation": "download", "file": "employee-handbook.pdf", "kb_id": "company"}
  )

  # Download by S3 URI (from query result references)
  mcp__numa__numa_tool(
    name="numa_files",
    description="Downloading policy document",
    params={"operation": "download", "uri": "s3://bucket/documents/company/policy.pdf"}
  )

  # Download file from a sub-path
  mcp__numa__numa_tool(
    name="numa_files",
    description="Downloading Q4 summary",
    params={"operation": "download", "file": "reports/2024/q4-summary.pdf", "kb_id": "company"}
  )


operation: list
---------------

Lists the contents of a folder one level at a time — like `ls`. By default
you get the files at the requested level PLUS the names of any immediate
sub-paths, so you can navigate hierarchy without dumping the whole folder.

Parameters:
  kb_id      (optional)  Folder ID to list files from (default: "company")
  folder     (optional)  Sub-path within the folder, e.g. "Releases" or
                         "Releases/v2.1". Path segments are separated by "/".
                         Leading/trailing slashes are stripped. Default: folder root.
                         Also accepted under the names `path` and `folder_path`
                         (synonyms — any of the three works).
  pattern    (optional)  Filename pattern filter (e.g. "*.pdf"). Applied to
                         filenames at the listed level only.
  recursive  (optional)  If true, return a flat list of every file under the
                         requested sub-path (no sub-path names). Default: false.

Return shape (default, recursive=false):
  {
    "kb_id": "...",
    "folder": "Releases",           # empty string when listing root
    "files":   [ {name, key, size, last_modified, s3_uri}, ... ],
    "folders": ["v2.0/", "v2.1/"],  # immediate sub-path names, with trailing slash
    "count": N,
    "recursive": false,
    "pattern": "..."
  }

Return shape (recursive=true):
  Same as above without the `folders` field; `files` contains every object
  under the sub-path at any depth.

Navigation pattern:
  1. List root              -> discover top-level sub-paths
  2. List folder="Releases" -> see files in Releases + any deeper sub-paths
  3. List folder="Releases/v2.1" -> go deeper (folder is a path, not a single segment)
  4. Call download on the file you want.

Examples:

  # Discover what's at the top of Company Files
  mcp__numa__numa_tool(
    name="numa_files",
    description="Listing top-level contents of Company Files",
    params={"operation": "list", "kb_id": "company"}
  )

  # Scope to a sub-path — returns files in Releases + immediate sub-paths
  mcp__numa__numa_tool(
    name="numa_files",
    description="Listing Releases sub-path",
    params={"operation": "list", "kb_id": "company", "folder": "Releases"}
  )

  # Nested: pass the full path to go a level deeper
  mcp__numa__numa_tool(
    name="numa_files",
    description="Listing Releases/v2.1",
    params={"operation": "list", "kb_id": "company", "folder": "Releases/v2.1"}
  )

  # Flat recursive listing with a filename filter (escape hatch for
  # wide searches; prefer scoped navigation when possible)
  mcp__numa__numa_tool(
    name="numa_files",
    description="Finding all xlsx files under Releases",
    params={
      "operation": "list",
      "kb_id": "company",
      "folder": "Releases",
      "recursive": true,
      "pattern": "*.xlsx"
    }
  )


operation: download_folder
--------------------------

Parameters:
  kb_id        (optional)  Folder ID (default: "company")
  folder_path  (optional)  Sub-path within the folder (default: root)
  output_dir   (optional)  Where to save the zip (default: /workdir/outputs/)

Examples:

  # Download entire Company Files
  mcp__numa__numa_tool(
    name="numa_files",
    description="Downloading entire Company Files",
    params={"operation": "download_folder", "kb_id": "company"}
  )

  # Download a specific sub-path
  mcp__numa__numa_tool(
    name="numa_files",
    description="Downloading 2024 reports",
    params={"operation": "download_folder", "kb_id": "company", "folder_path": "reports/2024/"}
  )

Limits: Maximum 400 files per download.
Tip: Analyze zip contents directly with Python's zipfile module
     rather than extracting (avoids long filename issues with
     web-crawled content).


operation: delete
-----------------

Parameters:
  file    (required)  Relative path within the folder
  kb_id   (optional)  Folder ID (default: "company")

Permissions: Company Files require admin; user folders require editor/owner.

Example:

  mcp__numa__numa_tool(
    name="numa_files",
    description="Deleting outdated report",
    params={"operation": "delete", "file": "old-report.pdf", "kb_id": "company"}
  )


Citing Sources
--------------

When using search results, cite sources using:
  <kb-source:s3://bucket/documents/company/policy.pdf>

This renders as a clickable pill in the chat UI. The tag name `kb-source`
is a parser format kept for compatibility — users see a styled pill, not
the raw text.


Security
--------

- Folder ID is validated against NUMA_ALLOWED_KBS (fail-closed)
- Server-side DynamoDB permission check via verify_kb_access()
- User's allowed folders list is passed through from frontend
"""

import sys

print(
    "This file is documentation only. "
    "Use the mcp__numa__numa_tool MCP tool with "
    "name='numa_files' (preferred) or name='knowledge_base' (legacy) "
    "and pick the action via the `operation` parameter."
)
sys.exit(1)

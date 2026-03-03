#!/usr/bin/env python3
"""
Numa Knowledge Base — MCP Tool Reference
==========================================

Query, upload, download, and list files in company knowledge bases via the
mcp__numa__numa_tool MCP tool.  Load the `knowledge-search` skill for
detailed guidance on citing sources, raw vs summarized results, and
working with downloaded folders.

Available tool names (each passed as the `name` parameter):

  query_knowledge_base   Search KBs with AI summarization
  kb_upload              Add files to a knowledge base
  kb_download            Download a file by filename or S3 URI
  kb_list                List files in a KB
  kb_download_folder     Download a folder as zip

All examples below are mcp__numa__numa_tool calls.


query_knowledge_base
--------------------

Parameters:
  query              (required)  Natural language search query
  user_intent        (required)  What the user is trying to accomplish
  max_results        (optional)  Max results (default: 6, max: 15)
  kb_id              (optional)  KB ID: "company" (default) or user KB UUID
  summarise_results  (optional)  Summarize results (default: true)
  all_kbs            (optional)  Query all enabled KBs (default: false)
  output_file        (optional)  Write results to file instead of returning inline

Examples:

  # Simple KB search
  mcp__numa__numa_tool(
    name="query_knowledge_base",
    description="Searching KB for annual leave policy",
    params={"query": "annual leave policy", "user_intent": "find leave entitlements"}
  )

  # Query specific user KB
  mcp__numa__numa_tool(
    name="query_knowledge_base",
    description="Searching project KB for requirements",
    params={"query": "project requirements", "user_intent": "find specs", "kb_id": "abc-123-uuid"}
  )

  # Query all enabled KBs
  mcp__numa__numa_tool(
    name="query_knowledge_base",
    description="Searching all KBs for compliance info",
    params={"query": "compliance", "user_intent": "compare policies", "all_kbs": true}
  )

  # Raw results for precision (no AI summarization)
  mcp__numa__numa_tool(
    name="query_knowledge_base",
    description="Compiling security documentation",
    params={
      "query": "IT security policies",
      "user_intent": "compile complete security documentation",
      "summarise_results": false,
      "max_results": 15,
      "output_file": "/workdir/outputs/security_policies.json"
    }
  )


kb_upload
---------

Parameters:
  file    (required)  Path to file in workspace
  kb_id   (optional)  Target KB ID (default: "company")
  path    (optional)  Folder path within KB

Examples:

  # Upload to company KB (admin only)
  mcp__numa__numa_tool(
    name="kb_upload",
    description="Uploading report to company KB",
    params={"file": "/workdir/outputs/report.pdf", "kb_id": "company"}
  )

  # Upload to user KB with folder path
  mcp__numa__numa_tool(
    name="kb_upload",
    description="Uploading analysis to user KB",
    params={"file": "/workdir/outputs/analysis.docx", "kb_id": "abc-123-uuid", "path": "reports/2024/"}
  )

Permissions:
  Company KB — only admins can upload
  User KBs — only editors/owners can upload
Size limit: 4 MB max. Larger files via web UI.
Indexing: Files searchable within ~30 minutes.


kb_download
-----------

Parameters:
  file        (* required)  Filename to download (use with kb_id)
  kb_id       (optional)    KB ID when using file (default: "company")
  uri         (* required)  Full S3 URI (alternative to file)
  output_dir  (optional)    Download location (default: /workdir/outputs/)

* Either file or uri must be provided.

Examples:

  # Download by filename
  mcp__numa__numa_tool(
    name="kb_download",
    description="Downloading employee handbook",
    params={"file": "employee-handbook.pdf", "kb_id": "company"}
  )

  # Download by S3 URI (from KB query result references)
  mcp__numa__numa_tool(
    name="kb_download",
    description="Downloading policy document",
    params={"uri": "s3://bucket/documents/company/policy.pdf"}
  )

  # Download file from subfolder
  mcp__numa__numa_tool(
    name="kb_download",
    description="Downloading Q4 summary",
    params={"file": "reports/2024/q4-summary.pdf", "kb_id": "company"}
  )


kb_list
-------

Parameters:
  kb_id    (optional)  KB ID to list files from (default: "company")
  pattern  (optional)  Filename pattern filter (e.g. "*.pdf")

Examples:

  # List all files in company KB
  mcp__numa__numa_tool(
    name="kb_list",
    description="Listing files in company KB",
    params={"kb_id": "company"}
  )

  # List only PDFs
  mcp__numa__numa_tool(
    name="kb_list",
    description="Listing PDF files",
    params={"kb_id": "company", "pattern": "*.pdf"}
  )


kb_download_folder
------------------

Parameters:
  kb_id        (optional)  KB ID (default: "company")
  folder_path  (optional)  Folder path within KB (default: root)
  output_dir   (optional)  Where to save the zip (default: /workdir/outputs/)

Examples:

  # Download entire KB
  mcp__numa__numa_tool(
    name="kb_download_folder",
    description="Downloading entire company KB",
    params={"kb_id": "company"}
  )

  # Download specific folder
  mcp__numa__numa_tool(
    name="kb_download_folder",
    description="Downloading 2024 reports",
    params={"kb_id": "company", "folder_path": "reports/2024/"}
  )

Limits: Maximum 400 files per download.
Tip: Analyze zip contents directly with Python's zipfile module
     rather than extracting (avoids long filename issues with
     web-crawled content).


Citing Sources
--------------

When using KB query results, cite sources using:
  <kb-source:s3://bucket/documents/company/policy.pdf>

This renders as a clickable pill in the chat UI.


Security
--------

- KB ID is validated against NUMA_ALLOWED_KBS (fail-closed)
- Server-side DynamoDB permission check via verify_kb_access()
- User's allowed_kbs list is passed through from frontend
"""

import sys

print(
    "This file is documentation only. "
    "Use the mcp__numa__numa_tool MCP tool with "
    "name='query_knowledge_base', 'kb_upload', 'kb_download', "
    "'kb_list', or 'kb_download_folder' instead."
)
sys.exit(1)

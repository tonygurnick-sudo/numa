#!/usr/bin/env python3
"""
Numa Document Conversion — MCP Tool Reference
===============================================

Convert documents between formats via the mcp__numa__numa_tool MCP tool.
Load the `pdf-handling` or `docx-handling` skill for advanced workflows.

Tool name (passed as `name`):  convert_document

All examples below are mcp__numa__numa_tool calls.


Conversion Modes
----------------

  file       Direct DOCX ↔ PDF conversion (LibreOffice). Best quality.
  markdown   Convert markdown/text → PDF or DOCX (Pandoc). Default mode.


Parameters
----------

  file_path  (required)  Path to input file in workspace
  format     (required)  Output format: "pdf" or "docx"
  mode       (optional)  "file" or "markdown" (default: "markdown")
  title      (optional)  Document title (used for filename)


Examples
--------

  # Direct DOCX → PDF conversion (recommended for DOCX files)
  mcp__numa__numa_tool(
    name="convert_document",
    description="Converting DOCX report to PDF",
    params={
      "file_path": "/workdir/uploads/document.docx",
      "format": "pdf",
      "mode": "file"
    }
  )

  # Direct PDF → DOCX conversion
  mcp__numa__numa_tool(
    name="convert_document",
    description="Converting PDF to editable DOCX",
    params={
      "file_path": "/workdir/uploads/document.pdf",
      "format": "docx",
      "mode": "file"
    }
  )

  # Markdown to PDF (default mode)
  mcp__numa__numa_tool(
    name="convert_document",
    description="Converting markdown report to PDF",
    params={
      "file_path": "/workdir/outputs/report.md",
      "format": "pdf"
    }
  )

  # Markdown to DOCX with custom title
  mcp__numa__numa_tool(
    name="convert_document",
    description="Converting report to Word document",
    params={
      "file_path": "/workdir/outputs/report.md",
      "format": "docx",
      "title": "Quarterly Report"
    }
  )


Conversion Quality
------------------

  DOCX → PDF (mode: file)      Excellent — LibreOffice handles this well
  PDF → DOCX (mode: file)      Variable — PDFs are presentation format
  Markdown → PDF/DOCX           Good — works well for formatted markdown


Complex / Scanned PDFs
----------------------

For complex or scanned PDFs, use the two-step approach:

  # Step 1: Extract content using vision AI
  mcp__numa__numa_tool(
    name="extract_content",
    description="Extract content from scanned document",
    params={"file_path": "/workdir/uploads/scanned_document.pdf"}
  )

  # Step 2: Convert extracted markdown to DOCX
  mcp__numa__numa_tool(
    name="convert_document",
    description="Converting extracted text to DOCX",
    params={
      "file_path": "/workdir/outputs/extracted_scanned_document.txt",
      "format": "docx"
    }
  )


Output
------

Converted document is saved to /workdir/outputs/.
Returns JSON with output_path, format, mode, and size.
"""

import sys

print(
    "This file is documentation only. "
    "Use the mcp__numa__numa_tool MCP tool with name='convert_document' instead."
)
sys.exit(1)

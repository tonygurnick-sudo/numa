#!/usr/bin/env python3
"""
Numa Content Extraction — MCP Tool Reference
==============================================

Extract text content from files using advanced OCR and vision AI via the
mcp__numa__numa_tool MCP tool.  Ideal for complex documents that standard
Python libraries can't handle well (scanned PDFs, images, handwritten text).

Tool name (passed as `name`):  extract_content

All examples below are mcp__numa__numa_tool calls.


Supported File Formats
----------------------

Documents (Vision AI):
  .pdf     PDFs (text-based and scanned/image-based)
  .docx    Microsoft Word documents
  .xlsx    Microsoft Excel spreadsheets

Images (OCR/Vision):
  .png     PNG images
  .jpg     JPEG images
  .jpeg    JPEG images

Audio/Video (Transcription):
  .mp3, .mp4, .wav, .flac, .ogg, .amr, .webm, .m4a

Text Files (direct reading):
  .txt, .csv, .json, .xml, .yaml, .yml, .md, .html
  .py, .js, .ts, .css, .scss, .less, .sql
  .sh, .bash, .cfg, .conf, .ini, .log, .tex


Parameters
----------

  file_path  (required)  Path to file in workspace
                         Supports: /workdir/uploads/, /workdir/outputs/,
                                   /workdir/chat-workflows/, or root files


Examples
--------

  # Extract from a scanned PDF
  mcp__numa__numa_tool(
    name="extract_content",
    description="Extracting text from scanned invoice",
    params={"file_path": "/workdir/uploads/scanned_invoice.pdf"}
  )

  # Extract from an image
  mcp__numa__numa_tool(
    name="extract_content",
    description="Extracting text from whiteboard photo",
    params={"file_path": "/workdir/uploads/whiteboard_photo.jpg"}
  )

  # Extract from an Excel spreadsheet
  mcp__numa__numa_tool(
    name="extract_content",
    description="Extracting data from spreadsheet",
    params={"file_path": "/workdir/uploads/financials.xlsx"}
  )

  # Transcribe audio
  mcp__numa__numa_tool(
    name="extract_content",
    description="Transcribing meeting recording",
    params={"file_path": "/workdir/uploads/meeting_recording.mp3"}
  )


Output
------

Extracted content is saved to /workdir/outputs/extracted_{filename}.txt
Returns JSON with output_path, original_file, and text_length.


When to Use
-----------

- Scanned PDFs (image-based, not text-selectable)
- Photos of documents, whiteboards, or handwritten notes
- Complex DOCX/XLSX that Python libraries struggle with
- Audio/video transcription
- Any file where you need high-quality text extraction

For simple text-based PDFs, you may also use PyPDF2 directly via
execute_script — but extract_content handles edge cases better.
"""

import sys

print(
    "This file is documentation only. "
    "Use the mcp__numa__numa_tool MCP tool with name='extract_content' instead."
)
sys.exit(1)

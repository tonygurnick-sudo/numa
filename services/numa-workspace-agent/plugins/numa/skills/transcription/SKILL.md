---
name: transcription
description: Submit files for transcription/content extraction and check job status
---

# Transcription Service

Submit documents, images, audio, and video files for content extraction and transcription. The service processes files asynchronously and returns structured text output.

## Quick Reference

```python
# Submit a file for transcription
result = numa_tool(name="transcription", operation="submit", file_key="documents/report.pdf", file_name="report.pdf")

# Check job status
status = numa_tool(name="transcription", operation="status", job_id="JOB#2026-03-12T10:30:00#abc12345")

# List recent jobs
jobs = numa_tool(name="transcription", operation="list")
```

## Operations

### submit

Submit a file that is already in the user's data bucket for transcription.

| Parameter | Type   | Required | Description                           |
| --------- | ------ | -------- | ------------------------------------- |
| file_key  | string | Yes      | S3 key of the file in the data bucket |
| file_name | string | Yes      | Display name of the file              |

**Returns**: `{ "job_id": "JOB#...", "status": "QUEUED" }`

### status

Check the status of a transcription job.

| Parameter | Type   | Required | Description                     |
| --------- | ------ | -------- | ------------------------------- |
| job_id    | string | Yes      | The job ID returned from submit |

**Returns**: Full job record including status, progress, output key, and any error message.

### list

List the user's recent transcription jobs.

| Parameter | Type   | Required | Description                                                        |
| --------- | ------ | -------- | ------------------------------------------------------------------ |
| status    | string | No       | Filter by status: QUEUED, PROCESSING, COMPLETED, FAILED, CANCELLED |
| limit     | number | No       | Max results (default 20)                                           |

**Returns**: Array of job records.

## Supported Formats

**Documents**: PDF, DOCX, XLSX, PPTX, DOC, XLS, PPT, RTF, ODT, ODS, ODP, PAGES, KEY, NUMBERS
**Text**: TXT, MD, CSV, TSV, JSON, JSONL, XML, YAML, HTML, CSS, JS, TS, PY, SQL, SH, LOG
**Images**: PNG, JPG, JPEG, TIFF, WebP, GIF, BMP, HEIC, HEIF
**Audio/Video**: MP3, MP4, WAV, FLAC, OGG, AMR, WebM, M4A, MOV, AVI, MKV, AAC, WMA
**Special**: EPUB, Parquet, SQLite, ZIP, TAR, SVG, EML, ICS, VCF, MSG, Jupyter notebooks
**Structured**: BibTeX, reStructuredText, AsciiDoc, Org mode, Typst

## Job Statuses

- **QUEUED** — Waiting to be processed
- **PROCESSING** — Currently being extracted/transcribed
- **COMPLETED** — Done, output available
- **FAILED** — Processing failed (check errorMessage)
- **CANCELLED** — Cancelled by user

## When to Use

- User asks to extract text from a document
- User wants to transcribe audio or video
- User needs structured content from spreadsheets, databases, or archives
- User uploads a file and wants its contents analyzed

## Output

Completed jobs produce a JSON document at `transcriptions/{userSub}/{jobId}/output.json` in the data bucket with:

- `name`: Original filename
- `num_pages`: Number of pages/sections extracted
- `total_num_words`: Total word count
- `pages`: Array of `{ page_number, num_words, text }` objects

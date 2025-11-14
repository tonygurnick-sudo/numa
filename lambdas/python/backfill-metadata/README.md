# Backfill Metadata Lambda

## Purpose

This Lambda function backfills `.metadata.json` sidecar files for existing documents in the default company KB.

## Behavior

- Iterates through all files in `documents/company/` prefix in S3
- For each file under `documents/**` without a `.metadata.json` sidecar, creates one with a `metadataAttributes` object compatible with S3 Vectors filterable metadata:
  - `tenant_id`: Client name
  - `kb_id`: Derived from the key prefix (`company` or the value after `kb-`)
  - `uploader_id`: Inferred from the next path segment when available, otherwise `"system"`
  - `uploaded_at`: File's `LastModified` timestamp
  - `backfilled`: `"true"` (flag indicating metadata was backfilled)
- Skips files that already have metadata
- Manually invokable (not triggered automatically)

## Environment Variables

- `BUCKET_NAME`: S3 bucket containing the knowledge base files
- `CLIENT_NAME`: The tenant/client identifier (e.g., "arcanum")

## Returns

- 200: Success with statistics (files_processed, metadata_created, metadata_skipped)
- 500: Error during backfill operation

## Usage

This Lambda should be invoked manually after the initial deployment to backfill metadata for existing files. It can be invoked via:

```bash
aws lambda invoke \
  --function-name numa-{client}-backfill-metadata \
  --payload '{}' \
  response.json
```

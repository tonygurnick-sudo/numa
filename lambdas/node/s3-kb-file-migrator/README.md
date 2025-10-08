# S3 Knowledge Base File Migrator Lambda

Migrates S3 files to `documents/` prefix for compatibility with S3 Vectors Knowledge Bases.

## Purpose

S3 Vectors requires `inclusionPrefixes` to be specified (max 1 prefix), unlike Aurora-backed Knowledge Bases which can index the entire bucket. This Lambda migrates existing files to a unified `documents/` prefix before ingestion.

## What It Does

1. Lists all objects in the specified S3 bucket
2. For each object NOT under `documents/`:
   - Copies to `documents/{original-key}`
   - Optionally deletes original (controlled by `deleteOriginals` parameter)
3. Special handling:
   - **Skips**: Files already under `documents/` (idempotent)
   - **Skips**: `numa-chat/` files (not for KB indexing)
   - **Migrates**: `web-crawler/` → `documents/web-crawler/`
   - **Migrates**: Root-level files → `documents/{filename}`

## Parameters

- `bucketName` (required): Name of the S3 bucket
- `deleteOriginals` (optional, default: false): Whether to delete original files after copying
- `dryRun` (optional, default: false): Preview migration without making changes

## Example Event

```json
{
  "bucketName": "numa-client-name-data",
  "deleteOriginals": false,
  "dryRun": false
}
```

## Build

```bash
yarn install
yarn bundle
```

## Safety

- **Idempotent**: Safe to run multiple times - won't re-copy existing destinations
- **Default behavior**: Keeps originals (set `deleteOriginals: true` to remove)
- **Dry run**: Test with `dryRun: true` before actual migration

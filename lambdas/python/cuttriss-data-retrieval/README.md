# cuttriss-data-retrieval

Downloads files from 12d Synergy (Cuttriss) to S3 using a PAT in AWS Secrets Manager.
Matches the Numa lambda style (Poetry-managed).

## Env Vars (set in IaC)
- `SYNERGY_BASE_URL` e.g. `https://synergy.myserver.com`
- `SYNERGY_PAT_SECRET_NAME` e.g. `synergy/pat`
- `S3_BUCKET` e.g. `numa-<client>-data`
- `S3_PREFIX` defaults to `documents/company/synergy12d-documents/`
- `WITH_REFERENCES` `true|false` (default false)
- `FORCE_OVERWRITE` `true|false` (default false)
- `USE_SYNERGY_PATHS` `true|false` (default true)
- `ENABLE_DELETION` `true|false` (default false) – when enabled the Lambda writes per-folder manifests and removes objects from S3 when Synergy files are deleted, moved, or versioned.
- `PAGE_SIZE` (default 100)
- `HTTP_TIMEOUT_SEC` (default 60), `HTTP_MAX_RETRIES` (default 5), `HTTP_BACKOFF_SEC` (default 0.5)
- `INCLUDE_GLOBS`, `EXCLUDE_GLOBS` (comma-separated patterns)

### Probe mode (default)
- `SYNC_MODE` defaults to `probe`. Set to `legacy` only if you still rely on CSV/job lists.
- `SYNERGY_SERVER_ID` numeric `_server_id` portion for folder IDs (defaults to `1`).
- `PROBE_RANGE_START` / `PROBE_RANGE_END` inclusive numeric folder range to sweep.
- `PROBE_CHUNK_SIZE` number of folder IDs processed per invocation (defaults to `250`).
- `PROBE_STATE_TABLE` optional DynamoDB table name that stores the probe cursor.
- `PROBE_STATE_KEY` row identifier inside the probe table (defaults to `synergy-cuttriss`).
- `PROBE_STATE_PK_ATTR` partition key attribute name inside the probe table (defaults to `stateId`).

When probe mode runs (scheduled CloudWatch event, Step Function, etc.) the Lambda:
1. Reads the `nextStartId` cursor from DynamoDB (or `PROBE_RANGE_START` when unset).
2. Builds a sequential list of folder IDs equal to `PROBE_CHUNK_SIZE`.
3. Calls the Synergy APIs for each folder, downloading/uploading files into `documents/company/synergy12d-documents/`.
4. (Optional) Stores folder manifests + removes stale S3 objects when `ENABLE_DELETION=true`.
5. Persists the next cursor so the following run resumes at the oldest-unseen folder.

You can override any of the range/chunk/cursor/table settings per invocation by passing
`rangeStart`, `rangeEnd`, `chunkSize`, `startId`, `stateTable`, `stateKey`, `statePkAttr`,
and `serverId` fields in the event payload.

### Legacy job list mode
Setting `SYNC_MODE=legacy` (or passing `{"mode":"legacy"}` in the event) keeps the original
job-name/CSV driven behavior. Event fields `jobCsvBucket`, `jobCsvKey`, `jobNames`,
`rootFolderIdStrings`, and `startFolderIdString` continue to work as before.

## Build (local)
```bash
poetry lock
poetry install --no-root
# package to zip for deploy (source-only)
zip -r lambda_function.zip lambda_function.py
# or export pinned requirements if you build layers elsewhere:
poetry export -f requirements.txt -o requirements.txt --without-hashes

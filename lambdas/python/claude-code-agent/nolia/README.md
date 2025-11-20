# Nolia Claude Code Agent

This directory contains the Claude Code–based agent used by the Nolia app. It currently operates in a safe “dummy/test” mode to enable end‑to‑end API wiring without performing real analysis.

## Quick Facts
- Entry point: `main.py` (function `run(event, context)`)
- Prompts: `prompts.py` (currently a test prompt that returns a friendly placeholder message)
- Settings/permissions: `settings.py` (tools and sandbox configuration for Claude CLI)
- Routed by: `lambdas/python/claude-code-agent/lambda_function.py` with `agent_type: "nolia"`

- ## Knowledge Base Files
- Bucket: Outputs bucket provided via env `OUTPUTS_BUCKET_NAME`.
- S3 prefix for KB content: `nolia/knowledge-bases/{kb_name}/`
  - `kb_name` is derived from the user’s selection by lowercasing and replacing spaces with hyphens.
  - Examples: `global` → `s3://$OUTPUTS_BUCKET_NAME/nolia/knowledge-bases/global/`, `procurement-activity` → `s3://$OUTPUTS_BUCKET_NAME/nolia/knowledge-bases/procurement-activity/`
  - Multiple selections are supported; files are downloaded under `./user-inputs/knowledge_base/{kb_name}/` per KB
- Relevant code:
  - Prefix assembly: `lambdas/python/claude-code-agent/nolia/main.py:498`
  - Listing/reading: `lambdas/python/claude-code-agent/nolia/main.py:503,514`

## Event Shape (from Step Function)
The Step Function invokes this Lambda via the generic runner with payload similar to:

```json
{
  "agent_type": "nolia",
  "app_id": "nolia",
  "job_id": "<jobId>",
  "user_id": "<userId>",
  "extracted_content_key": "",               // empty in dummy mode
  "kb_selection": "nolia-kb",               // dropdown selection
  "user_timezone": "UTC",
  "resume_session": true,
  "stream_events": true,
  "use_dynamodb": true
}
```

Notes:
- In dummy mode, `ExtractContent` is skipped and `extracted_content_key` is empty.
- The frontend triggers `HTTP_REQUEST_TASK` at endpoint `nolia/main` (wired by infra).
- The KB dropdown supports selecting one or more options (e.g., `global`, `procurement-activity`).

## Execution Flow (high level)
1. Set up working directories under `/tmp/cc_ws/{job_id}` (see `workspace.py`).
2. If provided, download extracted content and write to `./user-inputs/uploaded-document.txt`.
3. Download KB files from `s3://$OUTPUTS_BUCKET_NAME/nolia/knowledge-bases/{kb_name}/` into `./user-inputs/knowledge_base/`.
4. Ensure Claude CLI settings and (if resuming) restore session.
5. Build system prompt (from `prompts.py`) and run Claude CLI with streaming.
6. Upload outputs and write conversation/manifest/trace artifacts back to S3.

## Outputs and Artifacts
- Base prefix for job artifacts: `nolia/{user_id}/{job_id}/`
- Files written:
  - Results: `nolia/{user_id}/{job_id}/results*.md` (and `outputs/**`)
  - Inline content key used by FE: `nolia/{user_id}/{job_id}/outputs/.assistant.md`
  - Trace: `nolia/{user_id}/{job_id}/trace/trace.jsonl`
  - Manifest: `nolia/{user_id}/{job_id}/meta/manifest.json`
  - Session metadata: `nolia/{user_id}/{job_id}/meta/session.json`

Relevant code: upload/manifest/trace in `main.py` around the `_process_outputs_and_get_result`, `_upload_output_artifacts`, and `_finalize_job_artifacts` helpers.

## Environment Variables (set by infra)
Defined in `infra/constructs/apps/nolia-construct.ts` on the runner function:
- `OUTPUTS_BUCKET_NAME`: target S3 bucket for inputs/outputs
- `APP_ID`: `nolia`
- `HOME`: `/tmp` (for CLI settings)
- `CLAUDE_BIN`: `/tmp/claude` (download location for the CLI)
- `CLAUDE_CLI_S3_KEY`: `artifacts/claude-cli/<version>/claude-x86_64.zip`
- `CLAUDE_CODE_USE_BEDROCK`: `1`
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS`: region‑specific
- `MAX_THINKING_TOKENS`: default `1024` for this runner
- `ANTHROPIC_MODEL` and `ANTHROPIC_SMALL_FAST_MODEL`: region‑specific model IDs
- `DYNAMODB_TABLE`: present when jobs table is enabled (used for event streaming)

The runner also has IAM permissions to read KB paths: `s3://$OUTPUTS_BUCKET_NAME/nolia/knowledge-bases/*` and invoke Bedrock.

## Dummy/Test Mode vs Real Mode
- Dummy/Test mode (current):
  - `prompts.py` instructs the agent to output a brief “in development” message and not to use tools or produce files.
  - The Step Function’s `ExtractContent` is a `Pass` state that sets an empty `extracted.output_key`.
- To restore real processing later:
  1. Revert `prompts.py` to an analysis‑oriented system prompt.
  2. Re‑enable `ExtractContent` in `infra/constructs/apps/nolia-construct.ts` by switching the Pass state back to the original `addLambdaTask` using `props.sharedExtractContentLambdaArn`.

## Useful File References
- Lambda runner router: `lambdas/python/claude-code-agent/lambda_function.py`
- Nolia entry: `lambdas/python/claude-code-agent/nolia/main.py`
- Nolia prompts: `lambdas/python/claude-code-agent/nolia/prompts.py`
- Settings/sandbox: `lambdas/python/claude-code-agent/nolia/settings.py`
- Infra construct (app wiring/Step Function): `infra/constructs/apps/nolia-construct.ts`

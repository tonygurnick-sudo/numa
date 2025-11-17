# Claude Code Agent (Python Lambda)

Generic runner for Claude Code (CLI) to power the Data Analysis app.

- Uses Amazon Bedrock via environment flags (CLAUDE_CODE_USE_BEDROCK=1)
- Writes outputs to `outputs/` and returns the final response inline (no required results.md)
- Hydrates user-uploaded files into `user-inputs/`
- Persists session state, conversation history, and artifacts to S3 for potential future resumption

## Event Payload

Required fields:
- `app_id` (string): app identifier (e.g., `data-analysis`)
- `job_id` (string): unique job identifier
- `user_id` (string): user identifier
- `uploaded_files` (array): list of S3 keys for input files

Optional fields:
- `prompt` (string): custom prompt for the analysis (default: "Perform an initial EDA. Return your response here and reference files with <file:...>.")
- `resume_session` (boolean): enable session continuity (default: `false`, see "Session Continuity" below)
- `include_uploads_in_prompt` (boolean): override whether to preface the user prompt with a list of uploaded files (see below)

## Environment Variables

- `BUCKET` (required): outputs bucket
- `APP_ID` (required): app id prefix (e.g., `data-analysis`)
- `HOME` (default `/tmp`): home dir for Claude session files
- `CLAUDE_BIN` (default `claude`): CLI binary name
- `CLAUDE_CODE_USE_BEDROCK=1`: force Bedrock transport
- `AWS_REGION`: Bedrock region (e.g., `us-east-1`)
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (default 64000): token cap
- `MAX_THINKING_TOKENS` (configured in `settings.py`, currently 10000): extended thinking token budget. When set, all requests use thinking mode.
- `INCLUDE_UPLOADS_IN_PROMPT` (default enabled): when truthy, the agent prompt is prefaced with a list of files found in `./user-inputs/`. Accepts values like `true/false`, `1/0`, `on/off`.

## Prompt Preface: Uploaded Files

To help the agent immediately leverage uploaded inputs, the Lambda can prepend a short summary of files staged under `./user-inputs/` to the user’s prompt.

- Behavior: If enabled and at least one file is present, the prompt sent to the CLI becomes:

  ```
  User uploaded files (available under ./user-inputs/):
  - file-a.csv
  - notes.docx
  ... and N more

  User prompt:
  <original user message>
  ```

- Limits and safeguards:
  - Lists up to 50 files, sorted A→Z; if more, appends "... and N more"
  - Skips hidden files (dotfiles) and directories
  - Truncates very long filenames to 200 characters

- Controls:
  - Env var `INCLUDE_UPLOADS_IN_PROMPT` (default enabled if unset)
  - Per-invocation override `include_uploads_in_prompt` in the event payload

The conversation history written to `history/conversation.json` always records the original user prompt (without the preface) for UI clarity.

## Session Continuity (Future Feature)

The Lambda includes full infrastructure for session resumption but currently operates in one-off mode by default.

**Current Behavior (resume_session=false, default):**
- Every invocation starts a fresh Claude CLI session
- Session artifacts (Claude home archive, session metadata, conversation history, trace files) are **always saved** to S3 to prepare for potential future resumed runs
- Prior outputs are not restored; the agent starts with a clean workspace

**Future Behavior (resume_session=true):**
When enabled, the Lambda will:
1. Restore the Claude session archive (`~/.claude`) from S3
2. Hydrate prior outputs so the agent can reference previous work
3. Load the previous `ccSessionId` and pass `--resume` to the Claude CLI
4. Continue the conversation from the last turn in `history/conversation.json`

**Requirements to Enable:**
- Pass `resume_session: true` in the event payload
- Reuse the same `job_id` across invocations (frontend must track and pass stable job IDs)
- Frontend "Continue this analysis" button or equivalent workflow

**S3 Artifact Structure:**
```
{app_id}/{user_id}/{job_id}/
  outputs/
    (generated files referenced as <file:...>)
  sessions/
    claude-home.tar.gz               # archived Claude session
  meta/
    manifest.json                    # job metadata + ccSessionId
    session.json                     # ccSessionId for --resume
  history/
    conversation.json                # conversation history
  trace/
    trace.jsonl                      # CLI execution trace
```

## Runtime Filesystem & Isolation

Each invocation creates an isolated workspace under `/tmp/cc_ws/<job_id>`:

- `user-inputs/` — hydrated user-uploaded files for this run (read-only from the agent’s perspective)
- `outputs/` — all user-visible artifacts (CSVs, HTML, images, markdown, etc.)
- `tmp/` — scratch and intermediates not shown to the user

Isolation & concurrency:
- Each Lambda invocation gets its own ephemeral `/tmp`. Concurrent users cannot see each other’s files.
- The workspace is recreated on each run to prevent leakage across invocations.
- S3 keys are scoped by `app_id/user_id/job_id`, ensuring cross-user/run isolation.

## Notes

- Pandas is provided via AWS SDK for pandas layer (AWSSDKPandas-Python313)
- Pure-python libs (openpyxl, et-xmlfile) are part of Poetry deps
- The final response is captured from the CLI trace and returned inline; referenced files are uploaded under `outputs/`.

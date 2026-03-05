# Claude Code Agent (Python Lambda)

Multi-agent Claude Code runner supporting specialized agent types for different workflows.

This lambda uses a routing architecture to support multiple agent implementations, each optimized for specific use cases. Agent types are selected via the event payload and provide different capabilities, permissions, and features.

- Uses Amazon Bedrock via environment flags (CLAUDE_CODE_USE_BEDROCK=1)
- Writes outputs to `outputs/` and returns the final response inline (no required results.md)
- Hydrates user-uploaded files into `user-inputs/`
- Supports session state, conversation history, and artifacts persistence (agent-specific)

## Agent Types

The lambda routes to different agent implementations based on the `agent_type` parameter in the event payload. Each agent type has its own system prompts, tool permissions, and feature capabilities.

### Available Agent Types

#### `data_analysis`

Full-featured agent optimized for data analysis, visualization, and document processing.

**Key Features:**

- Enhanced Python package access (pandas, plotly, openpyxl, PyPDF2, python-docx, etc.)
- Session continuity support (resume previous work with `--resume`)
- Conversation history management across turns
- Real-time event streaming for progress updates
- Tool command narration using LLM summarization
- File reference syntax for inline rendering (`<file:...>`, `<folder:...>`)
- Extensive bash command permissions (python, file operations, etc.)
- WebFetch enabled for Arcanum domains

**Best for:** Data exploration, visualization, multi-turn analysis workflows, document processing

**Settings:**

- Permission mode: `acceptEdits`
- Thinking tokens: 10,000
- Tools: Read, Write, Edit, Glob, Grep, TodoWrite, Task, WebFetch, BashOutput, KillShell
- Bash: python, ls, cat, tar, unzip, mkdir, mv, cp, and more

#### `default`

Minimal agent providing basic Claude CLI functionality with restricted permissions.

**Key Features:**

- Single-turn execution (no session continuity)
- Basic file operations (read, write, edit)
- Restricted bash commands (ls, pwd, echo, cat, head, tail, wc, date, whoami, env, which, file)
- No external network access
- Simplified event handling

**Best for:** Simple one-off tasks, testing, or when minimal permissions are desired

**Settings:**

- Permission mode: `allowed_tools`
- Thinking tokens: 80,000
- Tools: Read, Write, Edit, Glob, Grep
- Bash: Very restricted command set
- No WebFetch, no session persistence

### Selecting an Agent Type

Specify the `agent_type` in your event payload:

```json
{
  "agent_type": "data_analysis",
  "app_id": "data-analysis",
  "job_id": "uuid-here",
  "user_id": "user123",
  "prompt": "Analyze this dataset",
  "uploaded_files": ["s3://bucket/key"]
}
```

**Default Behavior:**

- If `agent_type` is omitted, defaults to `default`
- If `agent_type` is invalid/unknown, falls back to `default`
- Fallback includes error logging for debugging

### Feature Comparison

| Feature              | default         | data_analysis               |
| -------------------- | --------------- | --------------------------- |
| Session continuity   | ❌              | ✅                          |
| Conversation history | ❌              | ✅                          |
| Event streaming      | ❌              | ✅                          |
| Python data packages | Limited         | Full (pandas, plotly, etc.) |
| Document parsing     | ❌              | ✅ (PDF, Word, Excel)       |
| Thinking tokens      | 80,000          | 10,000                      |
| Permission mode      | allowed_tools   | acceptEdits                 |
| Bash commands        | Very restricted | Broad (python, file ops)    |
| WebFetch             | ❌              | ✅ (Arcanum domains)        |
| TodoWrite/Task       | ❌              | ✅                          |
| Tool narration       | ❌              | ✅ (LLM-based)              |

## Event Payload

Required fields:

- `app_id` (string): app identifier (e.g., `data-analysis`)
- `job_id` (string): unique job identifier
- `user_id` (string): user identifier
- `uploaded_files` (array): list of S3 keys for input files

Optional fields (all agents):

- `agent_type` (string): agent type to use (`data_analysis` or `default`, default: `default`)
- `prompt` (string): custom prompt for the task
- `include_uploads_in_prompt` (boolean): override whether to preface the user prompt with a list of uploaded files (see below)

Optional fields (data_analysis agent only):

- `resume_session` (boolean): enable session continuity (default: `false`, see "Session Continuity" below)
- `stream_events` (boolean): enable real-time event streaming (default: `true`)
- `use_dynamodb` (boolean): write events to DynamoDB for real-time status (default: `true`)
- `user_timezone` (string): user's timezone for date formatting (default: `UTC`)

## Environment Variables

Shared across all agents:

- `OUTPUTS_BUCKET_NAME` (required): outputs bucket for artifacts
- `HOME` (default `/tmp`): home dir for Claude session files
- `CLAUDE_BIN` (default `claude`): CLI binary name
- `CLAUDE_CODE_USE_BEDROCK=1`: force Bedrock transport
- `AWS_REGION`: Bedrock region (e.g., `us-east-1`)
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (default 64000): token cap

Agent-specific (configured in each agent's `settings.py`):

- `MAX_THINKING_TOKENS`: extended thinking token budget (default: 10,000 for data_analysis, 80,000 for default)
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

## Session Continuity (data_analysis agent only)

The data_analysis agent includes full infrastructure for session resumption. The default agent does not support session continuity.

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

## Creating New Agent Types

To add a new agent type to this lambda:

1. **Create agent directory:** `lambdas/python/claude-code-agent/your_agent_name/`

2. **Add required files:**
   - `__init__.py` — Export the run function from main
   - `main.py` — Implement `run(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]`
   - `prompts.py` — Define `SYSTEM_PROMPT` (can extend `base_prompt.NUMA_BASE_SYSTEM_PROMPT`)
   - `settings.py` — Define `ENV_VARS: dict` and `SETTINGS_JSON: dict`

3. **Register in router:** Add your agent type to `AVAILABLE_AGENTS` list in `lambda_function.py`

4. **Configure infrastructure:** Set `agent_type` in your Step Function task definition (see `infra/constructs/apps/data-analysis-construct.ts` for example)

**Required exports:**

- `main.py` must export `run(event, context)` function
- `settings.py` must export `ENV_VARS` and `SETTINGS_JSON`
- `SETTINGS_JSON` must include: `permissions`, `tools`, `sandbox` configurations

**Shared resources:**

- `base_prompt.py` — `NUMA_BASE_SYSTEM_PROMPT` for consistent base instructions
- `utils/` — Shared utilities (s3_operations, cli_runner, session, trace_parser, appoutput)
- `helpers.py` — Event streaming and DynamoDB helpers

See existing implementations (`default/` and `data_analysis/`) for reference.

## Architecture

```
lambdas/python/claude-code-agent/
├── lambda_function.py          # Router/dispatcher
├── base_prompt.py              # Shared base system prompt
├── helpers.py                  # Shared helpers (event streaming, etc.)
├── default/                    # Default agent type
│   ├── main.py                # Entry point with run(event, context)
│   ├── prompts.py             # System prompt
│   └── settings.py            # ENV_VARS and SETTINGS_JSON
├── data_analysis/              # Data analysis agent type
│   ├── main.py                # Entry point with run(event, context)
│   ├── prompts.py             # System prompt with data analysis extensions
│   ├── settings.py            # ENV_VARS and SETTINGS_JSON
│   ├── conversation.py        # Conversation history management
│   └── workspace.py           # Workspace utilities
└── utils/                      # Shared utilities
    ├── appoutput.py           # Output formatting
    ├── cli_runner.py          # Claude CLI management
    ├── s3_operations.py       # S3 helpers
    ├── session.py             # Session continuity
    └── trace_parser.py        # Trace parsing
```

## Notes

- Pandas is provided via AWS SDK for pandas layer (AWSSDKPandas-Python313)
- Pure-python libs (openpyxl, et-xmlfile, PyPDF2, python-docx, plotly) are part of Poetry deps
- The final response is captured from the CLI trace and returned inline; referenced files are uploaded under `outputs/`
- Agent routing uses dynamic imports: `importlib.import_module(f"{agent_type}.main")`

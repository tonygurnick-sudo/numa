# Pipedream Integrations Architecture

This package hosts the server-side logic that adapts Pipedream MCP integrations for the Numa chat agent.

## Modules

| File | Purpose |
| --- | --- |
| `router.py` | Implements the tools-only Numa router that folds all Pipedream tools for an integration into a single Strands tool, including payload generation, schema validation, execution, auto‑retry, and error normalization. |
| `fallback.py` | Minimal passthrough shim for the legacy “sub-agent” behaviour (each MCP tool exposed directly without intervention). |
| `prompts/` | Prompt snippets assembled at runtime. `base_prompt.md` provides generic guidance; any `*.md` named after an integration augments the base prompt with integration-specific instructions. |
| `config.py` | Static per‑tool routing overrides (force tools‑only or backup sub‑agent without env vars). |

## Key Concepts

### ToolsOnlyIntegrationRouter

`ToolsOnlyIntegrationRouter` orchestrates the end-to-end execution for a Pipedream integration without invoking the full-config meta flow:

- **`build_strands_tool`**: registers one Strands entry point (e.g. `google_calendar_integration`). The agent provides the action name and a natural‑language instruction.
- **`execute`**: entry point for the router’s tool. It:
  1. Builds a combined prompt from `prompts/base_prompt.md` plus any integration‑specific guidance.
  2. Uses `BedrockClaude3Model` to generate a candidate JSON payload that satisfies the action’s static schema.
  3. Validates the payload against the JSON schema (retrying once with feedback if necessary).
  4. Calls the underlying MCP tool directly with the validated payload.
  5. If the tools‑only result contains validation‑style errors, automatically retries once via the sub‑agent (instruction‑only) mode.
  6. If the error is not retryable (auth/identity/quota/network), returns a normalized error payload for the FE.

If an action requires dynamic configuration (`reloadProps`/`remoteOptions`) we fall back to `fallback.py`, which exposes Pipedream’s instruction‑only sub‑agents unchanged. The router decides at runtime: when a call names a tool flagged as dynamic, it forwards the original instruction to the sub‑agent endpoint instead of attempting tools‑only execution.

Header routing: the provider creates two HTTP transports per integration — one with `x-pd-tool-mode: tools-only` (for JSON payload execution) and one without that header (for instruction‑only sub‑agent). The router picks the correct client automatically.

### Automatic Router Selection

At startup we inspect each MCP tool definition to choose the safest execution path:

- Properties marked with `reloadProps: true` or `remoteOptions: true` signal that Pipedream expects meta-tool interaction, so those tools are exposed via the backup sub-agent path.
- Tool-level annotations can also flag dynamic requirements (e.g. `reloadProps` in `annotations`).

Tools without these markers stay on the tools-only router; flagged tools are routed through `fallback.py`. We log both counts per integration to track how often we rely on the backup path.

Additionally, you can force per‑tool routing in code via `config.py` (see “Static overrides”).

### Prompt Management

- **`load_prompt_for_integration`** combines `prompts/base_prompt.md` with an optional integration-specific markdown file (`{integration}.md`).
- At runtime, `_build_user_prompt` embeds the resolved prompt template (base + integration snippet) so the model receives consistent guidance.

## Adding Integration Prompts

1. Create `prompts/<integration>.md` where `<integration>` matches the integration namespace (e.g. `google_calendar.md`).
2. Describe defaults, field preferences, and domain-specific behaviour in plain English. The file content is appended to the base prompt automatically.

Example guidance (see `prompts/google_calendar.md`):
- Encourage the router to honour timezones supplied by Numa.
- Default list endpoints to `maxResults = 30` unless the user explicitly requests a different limit.

## Dynamic Props Primer

Most Pipedream actions have static schemas and work in tools‑only mode. Some actions flag fields with `reloadProps` or `remoteOptions`; these require the instruction‑only sub‑agent path. The router inspects the schema before execution and can route such actions through `fallback.py` when needed. If a dynamic case slips through (e.g., stub schemas that expand after a mode switch), the router auto‑retries once via sub‑agent when the tools‑only response contains validation‑style errors.

### Error Handling and Normalization

- Tools‑only results are inspected for Pipedream observation errors (`os[]` blocks). If an error is detected:
  - Retryable (validation/missing field/time/date issues): one automatic retry via sub‑agent.
  - Non‑retryable (auth 401/403, identity 404/invalid token, quota/429, network): return a normalized error payload to the FE:
    ```json
    {
      "integration": "<integration>",
      "tool": "<tool>",
      "type": "integration-error",
      "error_message": "<first concise message>",
      "error_details": { "name": "Error", "message": "...", "stack": "..." }
    }
    ```
  - Logs:
    - "Detected integration error from tools-only execution" (always when error is seen)
    - "Auto-retrying via sub-agent due to validation/runtime error" (when retrying)
    - "Returning normalised integration error payload" (when not retrying)

### Static Overrides

- File: `config.py`
- Map specific `(integration, tool_name)` pairs to a routing mode:
  - `"backup"`: always use instruction‑only sub‑agent
  - `"numa"`: always use tools‑only JSON
- Default entry forces backup for `("google_calendar", "google_calendar-create-event")` due to dynamic props.

Environment‑based routing overrides have been removed. Any previous `PIPEDREAM_ROUTING_OVERRIDES` usage is deprecated and ignored.

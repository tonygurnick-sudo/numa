---
api_name: 'Dropbox'
api_slug: 'dropbox'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Dropbox — Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Change detection, webhooks/longpoll, the `409` typed-union
> error model, rate limits, and recovery.
>
> The connector is **pull-based and read-only** — it does not register webhooks today. This file
> documents both the change-detection mechanisms available (for future push-driven re-sync) and the
> error handling the connector must already get right. Items needing a live capture are tagged 🔬.

---

## Event-Driven Capabilities

| Mechanism           | Supported by Dropbox | Used by connector | Notes                                           |
| ------------------- | -------------------- | ----------------- | ----------------------------------------------- |
| Webhooks            | Yes                  | No                | App-level URL; HMAC-SHA256 signed; thin payload |
| Long polling        | Yes                  | No                | `list_folder/longpoll` on a cursor              |
| Change feed / delta | Yes                  | Candidate         | Cursor replay via `list_folder/continue`        |
| WebSocket           | No                   | —                 | —                                               |
| Server-Sent Events  | No                   | —                 | —                                               |

**Today's strategy:** poll. Re-index by replaying the saved `list_folder` cursor (see "Delta sync"
in 01b). Webhooks/longpoll would only matter if Numa later wants push-driven KB re-index.

---

## Webhooks (not wired up — reference)

Dropbox webhooks are configured **once in the App Console**, not per-call via the API. [DOCUMENTED]

### Verification handshake

On registration, Dropbox sends a `GET` to your URL with `?challenge=<value>`. You must echo the
value back verbatim (plain text, `Content-Type: text/plain`) to verify ownership. [DOCUMENTED]

### Signature

Every change `POST` carries an `X-Dropbox-Signature` header = **HMAC-SHA256 of the raw request
body, keyed by the app secret**. Recompute and constant-time compare before trusting the body. [DOCUMENTED]

### Payload (thin)

```json
{ "list_folder": { "accounts": ["dbid:AAH4f99T0taNz..."] } }
```

The payload says _which accounts have changes_, **not what changed**. To learn the actual changes,
the app calls `list_folder/continue` with that account's stored cursor. So a webhook is just a
"go poll now" nudge. [DOCUMENTED]

### Reliability

- Respond `200` quickly (within seconds); process async. Slow/failing endpoints get retried and may
  be backed off. [DOCUMENTED]
- Treat delivery as **at-least-once** — build an idempotent receiver and reconcile via the cursor,
  never trust payload contents for the actual change set.

---

## Long Polling (not wired up — reference)

`POST https://notify.dropboxapi.com/2/files/list_folder/longpoll` with
`{ "cursor": "<cursor>", "timeout": 30 }` blocks until there are changes for that cursor (or the
timeout elapses), returning `{ "changes": true, "backoff": <secs?> }`. When `changes:true`, drain
`list_folder/continue`. Note: longpoll uses the **`notify.dropboxapi.com`** host and is
**unauthenticated** (the cursor is the credential). Honor any `backoff` value. [DOCUMENTED]

---

## Polling Fallback (the connector's actual model)

1. Full recursive `list_folder` walk; persist the final `cursor`.
2. On a schedule, replay `list_folder/continue { "cursor": "<saved>" }` to get only changes.
3. Compare each entry's `rev` / `content_hash` to your stored value to decide whether to
   re-download; handle `.tag:"deleted"` as removals.
4. Persist the new `cursor`. Keep intervals conservative to respect rate limits.

Change-detection fields: `server_modified` (authoritative), `rev`, `content_hash`. [DOCUMENTED] 🛠️

---

## Error Handling

### The two-mode status model (read this carefully)

Dropbox is **non-standard**. There are two kinds of failure:

- **Transport/auth failures** use conventional codes: `400` (bad JSON), `401` (bad/expired/
  insufficient-scope token), `429` (rate limited), `5xx` (server).
- **Endpoint-specific application errors** (the path doesn't exist, the file isn't downloadable,
  wrong type) come back as **HTTP `409`** with a **typed tagged-union** body — **not** `404`/`422`.

> **Always branch on the body's `.tag` / `error_summary`, not on the status code alone.** A `409`
> is not a generic conflict here — it carries the specific app error.

### Standard error body (409)

```json
{
  "error_summary": "path/not_found/...",
  "error": {
    ".tag": "path",
    "path": { ".tag": "not_found" }
  }
}
```

| Field           | Type   | Description                                                                 |
| --------------- | ------ | --------------------------------------------------------------------------- |
| `error_summary` | string | Human/string-matchable summary; **prefix-matching is officially supported** |
| `error`         | object | Nested tagged union — walk `.tag` for programmatic handling                 |

> Officially acceptable to do `error_summary.startswith("path/not_found")`. For deeper logic, walk
> `error.tag` → `error.path.tag`. [DOCUMENTED]

### Common 409 error tags (relevant to a read-only file connector)

| `error_summary` prefix    | `error.tag` path              | Meaning                             | Recovery                                           |
| ------------------------- | ----------------------------- | ----------------------------------- | -------------------------------------------------- |
| `path/not_found`          | `path` → `not_found`          | Path/id no longer exists            | Re-list parent (path likely stale via rename/move) |
| `path/not_file`           | `path` → `not_file`           | Tried a file op on a folder         | Use the correct operation                          |
| `path/not_folder`         | `path` → `not_folder`         | Tried a folder op on a file         | Use the correct operation                          |
| `path/restricted_content` | `path` → `restricted_content` | Blocked by policy/DMCA              | Skip the item                                      |
| `unsupported_file`        | `unsupported_file`            | Non-downloadable (Paper/cloud doc)  | Skip, or export via `/2/files/export`              |
| `too_many_requests`       | `too_many_requests`           | Rate limited (also surfaces as 429) | Honor `Retry-After`, back off                      |
| `missing_scope`           | `missing_scope`               | Token lacks the needed scope        | Don't retry — connector is read-only; report       |

### Auth errors (401)

`401` means the access token is invalid, expired, or lacks the scope. The connector **refreshes the
access token** (long-lived refresh token, `grant_type=refresh_token`) and retries the call once.
If it's a `missing_scope`, refresh won't help — the scope was never granted. [DOCUMENTED]

### Recovery Playbook

| HTTP Status | Meaning                        | Retryable? | Recovery Action                                  | Max Retries |
| ----------- | ------------------------------ | ---------- | ------------------------------------------------ | ----------- |
| 200         | Success                        | —          | —                                                | —           |
| 400         | Malformed request / bad JSON   | No         | Fix the request body/params                      | 0           |
| 401         | Invalid/expired token          | Yes        | Refresh access token, retry once                 | 1           |
| 401         | `missing_scope`                | No         | Don't retry — capability not granted (read-only) | 0           |
| 403         | Account/team lacks the feature | No         | Surface; needs account-side action               | 0           |
| 409         | App error (typed union)        | Depends    | Branch on `.tag`; usually not retryable          | 0           |
| 429         | Rate limited                   | Yes        | Honor `Retry-After`, then exponential backoff    | 3+          |
| 5xx         | Server error                   | Yes        | Exponential backoff + jitter                     | 3           |

---

## Rate Limits

| Item                 | Value                                                                                            | Confidence                 |
| -------------------- | ------------------------------------------------------------------------------------------------ | -------------------------- |
| Status code          | `429`                                                                                            | [DOCUMENTED]               |
| Basis                | Dynamic per-app/per-user/namespace; concurrency-aware                                            | [DOCUMENTED]               |
| Published thresholds | **None** — Dropbox does not publish exact numbers                                                | [DOCUMENTED]               |
| `Retry-After` header | Present on `429` (seconds to wait)                                                               | [DOCUMENTED]               |
| 429 body             | `{"error":{".tag":"too_many_requests"},"error_summary":"too_many_requests/...","retry_after":N}` | [DOCUMENTED]/[INFERRED] 🔬 |
| Mostly affects       | Concurrent **writes** (n/a here) — reads are rarely throttled                                    | [DOCUMENTED]               |

**Backoff strategy:**

1. On `429`, honor the **`Retry-After`** header (and/or the body's `retry_after`) first.
2. Otherwise exponential backoff: start ~1–2 s, double each attempt, cap ~60 s, add jitter.
3. **Serialize** bursty workloads (e.g. recursive walks of huge trees) rather than fanning out —
   limits are concurrency-aware. The provider routes all calls through `_make_request_with_retry`,
   which is where `Retry-After` handling belongs. 🛠️

> **🔬 SANDBOX-CONFIRM:** the exact `429` body (`too_many_requests` tag, `retry_after` integer
> placement) and whether `Retry-After` is always present — verify against a live throttle.

---

## Useful response headers

| Header                 | Meaning                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `Retry-After`          | Seconds to wait before retrying (on `429`)                     |
| `X-Dropbox-Request-Id` | Support correlation id — include it in bug reports / log lines |
| `Dropbox-API-Result`   | (download responses) JSON metadata of the downloaded file      |

---

## Idempotency & Consistency

- All connector operations are **reads → naturally idempotent**. No idempotency-key header is
  needed; retries are safe. 🛠️ [INFERRED]
- **Eventual consistency** for search indexing (recent files lag) and for very large recursive
  listings. Don't treat "not in search yet" as "doesn't exist" — fall back to `list_folder`. [DOCUMENTED]

---

## Counter-Exceptions

1. **`409` is the app-error channel, not a conflict** — read the `.tag`; never map it blindly to
   "conflict, retry".
2. **A `200` is always success** — Dropbox does not return `200` with an error union in the body for
   these endpoints; the error union only rides on `409`.
3. **A webhook means "poll now", not "here's the change"** — re-fetch via the cursor; the payload
   only lists changed accounts.
4. **A disabled/failing webhook is silent to the API** — if push re-sync is ever added, re-verify
   webhook health and keep a polling safety net.

---

## Output Formatting Guide

| Data Type      | Format            | Example                                                                                               |
| -------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| File listing   | Markdown table    | name · size · modified (`server_modified`) · type                                                     |
| Single file    | Key-value summary | "Q1 Report.pdf — 471 KB — modified 15 Jan 2026 — PDF"                                                 |
| Search results | Table             | name · path · modified; note total is unknown (no count)                                              |
| Errors         | Clear message     | "Couldn't find '/Reports/old.pdf' — it may have moved or been renamed. Try listing the folder again." |

- Lists: show the first ~20 rows; note that Dropbox provides **no total count** (you only know
  there are more pages via `has_more`).
- For `unsupported_file`/`restricted_content`, tell the user the file can't be downloaded and why,
  rather than failing silently.

---

_Generated from the investigation questionnaire, Phases 7–8, cross-checked against the production
`dropbox_provider.py`._

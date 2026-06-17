---
api_name: Dropbox
api_slug: dropbox
doc: event & error handling (companion to 01-llm-api-rules.md) — change detection, webhooks/longpoll, 409 typed-union model, rate limits, recovery
status: connector is pull-based + read-only — registers no webhooks today. Documents change-detection mechanisms (future push re-sync) and the error handling the connector must already get right.
confidence: facts [DOCUMENTED]; provider-verified 🛠️ / [INFERRED] / 🔬(needs live capture) where noted.
---

# Dropbox — Event & Error Handling

## Event-Driven Capabilities

| Mechanism           | Dropbox supports | Used by connector | Notes                                           |
| ------------------- | ---------------- | ----------------- | ----------------------------------------------- |
| Webhooks            | Yes              | No                | app-level URL; HMAC-SHA256 signed; thin payload |
| Long polling        | Yes              | No                | `list_folder/longpoll` on a cursor              |
| Change feed / delta | Yes              | Candidate         | cursor replay via `list_folder/continue`        |
| WebSocket           | No               | —                 | —                                               |
| Server-Sent Events  | No               | —                 | —                                               |

**Today's strategy: poll.** Re-index by replaying the saved `list_folder` cursor (delta sync, 01b). Webhooks/longpoll matter only if Numa later wants push-driven KB re-index.

## Webhooks (not wired up — reference)

Configured **once in the App Console**, not per-call.

- **Verification handshake:** on registration Dropbox sends `GET ?challenge=<value>`; echo the value back verbatim (plain text, `Content-Type: text/plain`).
- **Signature:** every change `POST` carries `X-Dropbox-Signature` = **HMAC-SHA256 of the raw request body, keyed by the app secret**. Recompute and constant-time compare before trusting the body.
- **Payload (thin):** `{"list_folder":{"accounts":["dbid:AAH4f99T0taNz..."]}}` — says _which accounts changed_, not _what_. To learn changes, call `list_folder/continue` with that account's stored cursor. A webhook is just a "go poll now" nudge.
- **Reliability:** respond `200` quickly (seconds), process async; slow/failing endpoints get retried/backed off. Treat delivery as **at-least-once** — build an idempotent receiver and reconcile via the cursor; never trust payload contents for the actual change set. A disabled/failing webhook is silent to the API — if push re-sync is ever added, re-verify webhook health and keep a polling safety net.

## Long Polling (not wired up — reference)

`POST https://notify.dropboxapi.com/2/files/list_folder/longpoll {"cursor":"<cursor>","timeout":30}` blocks until changes exist for that cursor (or timeout), returning `{"changes":true,"backoff":<secs?>}`. When `changes:true`, drain `list_folder/continue`. Uses the **`notify.dropboxapi.com`** host and is **unauthenticated** (the cursor is the credential). Honor any `backoff`.

## Polling Fallback (the connector's actual model)

1. Full recursive `list_folder` walk; persist the final `cursor`.
2. On a schedule, replay `list_folder/continue {"cursor":"<saved>"}` for only changes.
3. Compare each entry's `rev`/`content_hash` to stored value to decide re-download; handle `.tag:"deleted"` as removals.
4. Persist the new `cursor`. Keep intervals conservative to respect rate limits.
   Change-detection fields: `server_modified` (authoritative), `rev`, `content_hash`. 🛠️

## Error Handling

### Two-mode status model (read carefully)

Dropbox is **non-standard**, two failure kinds:

- **Transport/auth failures** use conventional codes: `400` (bad JSON), `401` (bad/expired/insufficient-scope token), `429` (rate limited), `5xx` (server).
- **Endpoint-specific app errors** (path doesn't exist, file not downloadable, wrong type) come back as **HTTP `409`** with a **typed tagged-union** body — NOT `404`/`422`.

**Always branch on the body's `.tag` / `error_summary`, never on the status code alone.** A `409` is not a generic conflict here — it carries the specific app error. A `200` is always success (Dropbox does not return `200` with an error union for these endpoints).

### 409 error body

`{"error_summary":"path/not_found/...","error":{".tag":"path","path":{".tag":"not_found"}}}`

- `error_summary`: string; **prefix-matching is officially supported** (e.g. `startswith("path/not_found")`).
- `error`: nested tagged union — walk `.tag` → `error.path.tag` for deeper logic.

### Common 409 tags (read-only file connector)

| `error_summary` prefix    | `error.tag` path            | Meaning                             | Recovery                                           |
| ------------------------- | --------------------------- | ----------------------------------- | -------------------------------------------------- |
| `path/not_found`          | `path`→`not_found`          | path/id no longer exists            | re-list parent (path likely stale via rename/move) |
| `path/not_file`           | `path`→`not_file`           | file op on a folder                 | use correct operation                              |
| `path/not_folder`         | `path`→`not_folder`         | folder op on a file                 | use correct operation                              |
| `path/restricted_content` | `path`→`restricted_content` | policy/DMCA block                   | skip the item                                      |
| `unsupported_file`        | `unsupported_file`          | non-downloadable (Paper/cloud doc)  | skip, or export via `/2/files/export`              |
| `too_many_requests`       | `too_many_requests`         | rate limited (also surfaces as 429) | honor `Retry-After`, back off                      |
| `missing_scope`           | `missing_scope`             | token lacks the scope               | don't retry — connector is read-only; report       |

### Recovery Playbook

`401` = access token invalid/expired/insufficient-scope: connector **refreshes the access token** (`grant_type=refresh_token`) and retries once; if `missing_scope`, refresh won't help (scope never granted).
| Status | Meaning | Retryable? | Action | Max retries |
| --- | --- | --- | --- | --- |
| 200 | success | — | — | — |
| 400 | malformed request / bad JSON | No | fix body/params | 0 |
| 401 | invalid/expired token | Yes | refresh access token, retry once | 1 |
| 401 | `missing_scope` | No | don't retry — capability not granted (read-only) | 0 |
| 403 | account/team lacks feature | No | surface; needs account-side action | 0 |
| 409 | app error (typed union) | Depends | branch on `.tag`; usually not retryable | 0 |
| 429 | rate limited | Yes | honor `Retry-After`, then exponential backoff | 3+ |
| 5xx | server error | Yes | exponential backoff + jitter | 3 |

## Rate Limits

| Item                 | Value                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Status code          | `429`                                                                                            |
| Basis                | dynamic per-app/per-user/namespace; concurrency-aware                                            |
| Published thresholds | **None** — Dropbox does not publish exact numbers                                                |
| `Retry-After` header | present on `429` (seconds to wait)                                                               |
| 429 body 🔬          | `{"error":{".tag":"too_many_requests"},"error_summary":"too_many_requests/...","retry_after":N}` |
| Mostly affects       | concurrent **writes** (n/a here) — reads are rarely throttled                                    |

**Backoff:** 1) honor `Retry-After` (and/or body `retry_after`) first. 2) Else exponential backoff: start ~1–2 s, double per attempt, cap ~60 s, add jitter. 3) **Serialize** bursty workloads (recursive walks of huge trees) rather than fanning out — limits are concurrency-aware. Provider routes all calls through `_make_request_with_retry`, where `Retry-After` handling belongs. 🛠️
🔬 SANDBOX-CONFIRM: exact `429` body (`too_many_requests` tag, `retry_after` placement) and whether `Retry-After` is always present — verify against a live throttle.

## Useful Response Headers

| Header                 | Meaning                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `Retry-After`          | seconds to wait before retrying (on `429`)                  |
| `X-Dropbox-Request-Id` | support correlation id — include in bug reports / log lines |
| `Dropbox-API-Result`   | (download responses) JSON metadata of the downloaded file   |

## Idempotency & Consistency

- All connector operations are reads → naturally idempotent. No idempotency-key header; retries are safe. 🛠️ [INFERRED]
- **Eventual consistency** for search indexing (recent files lag) and very large recursive listings. Don't treat "not in search yet" as "doesn't exist" — fall back to `list_folder`.

## Output Formatting Guide

| Data type      | Format            | Example                                                                                               |
| -------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| File listing   | Markdown table    | name · size · modified (`server_modified`) · type                                                     |
| Single file    | key-value summary | "Q1 Report.pdf — 471 KB — modified 15 Jan 2026 — PDF"                                                 |
| Search results | table             | name · path · modified; note total unknown (no count)                                                 |
| Errors         | clear message     | "Couldn't find '/Reports/old.pdf' — it may have moved or been renamed. Try listing the folder again." |

- Lists: show the first ~20 rows; note Dropbox provides **no total count** (you only know there are more pages via `has_more`).
- For `unsupported_file`/`restricted_content`, tell the user the file can't be downloaded and why, rather than failing silently.

---
api_name: 'Wrike'
api_slug: 'wrike'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Wrike -- Event & Error Handling Reference

> Webhooks (Wrike's event mechanism), polling fallback, error format, rate-limit recovery,
> backoff strategy, and output formatting.
> Companion to `01-llm-api-rules.md`. Confidence: DOCUMENTED, not yet live-verified.

---

## Event-Driven Capabilities

| Mechanism              | Supported | Notes                                                         |
| ---------------------- | --------- | ------------------------------------------------------------- |
| Webhooks               | yes (API) | Account / folder / space scoped. HMAC-SHA256 signed payloads. |
| WebSocket              | no        | Not exposed.                                                  |
| Server-Sent Events     | no        |                                                               |
| Long polling           | no        |                                                               |
| Change feeds / streams | partial   | Poll `/tasks?updatedDate={start:…}` as a change feed.         |

---

## Webhooks (Wrike Webhooks API)

> **Numa status:** Wrike supports webhooks, but **Numa does NOT expose a public receiver
> for this connector.** Registering a webhook requires a Numa-hosted HTTPS endpoint that
> completes the `X-Hook-Secret` handshake and verifies the `X-Hook-Signature` HMAC on every
> delivery — none of which exists from chat. **If the user asks for real-time alerts, tell
> them it's polling-only for now.** The section below documents what we'd build if prioritised.

### Setup (for reference — not callable from chat)

- **Registration:** `POST /api/v4/webhooks` (account-wide), `POST /api/v4/folders/{id}/webhooks` (folder-scoped), `POST /api/v4/spaces/{id}/webhooks` (space-scoped).
- **Registration body (form):** `hookUrl=https://…/wrike/webhook&events=[TaskCreated,TaskStatusChanged]&secret=<your-secret>`.
- **URL requirements:** HTTPS. Must complete a verification handshake on registration.
- **Handshake:** on create, Wrike POSTs an `X-Hook-Secret` challenge header to your `hookUrl`; you must echo the SAME `X-Hook-Secret` header back in a 200 to confirm ownership. Reject the handshake if the secret contains JSON characters or exceeds 100 chars (Wrike anti-oracle guidance).

**Webhook object fields:** `id`, `accountId`, `folderId`/`spaceId` (if scoped), `hookUrl`, `status` (`Active`/`Suspended`), `events[]`.

### Event Catalog (representative)

| Event                     | Trigger                        | Key payload fields                                          |
| ------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `TaskCreated`             | New task                       | `taskId`, `eventAuthorId`, `lastUpdatedDate`                |
| `TaskDeleted`             | Task deleted                   | `taskId`                                                    |
| `TaskTitleChanged`        | Title edited                   | `taskId`, `oldValue`, `newValue`                            |
| `TaskImportanceChanged`   | Importance changed             | `taskId`, `oldImportance`, `newImportance`                  |
| `TaskStatusChanged`       | Status / custom-status changed | `taskId`, `oldStatus`, `newStatus`, `old/newCustomStatusId` |
| `TaskDatesChanged`        | Start/due/duration changed     | `taskId`, old/new dates                                     |
| `TaskParentsAdded`        | Added to a folder              | `taskId`, `addedParentId`                                   |
| `TaskParentsRemoved`      | Removed from a folder          | `taskId`, `removedParentId`                                 |
| `TaskResponsiblesAdded`   | Assignee added                 | `taskId`, `addedResponsibleId`                              |
| `TaskResponsiblesRemoved` | Assignee removed               | `taskId`, `removedResponsibleId`                            |
| `CommentAdded`            | Comment posted                 | `taskId`/`folderId`, `commentId`                            |
| `AttachmentAdded`         | File attached                  | `taskId`, `attachmentId`                                    |
| `TimelogChanged`          | Timelog added/edited/deleted   | `taskId`, `timelogId`                                       |

(Project/folder analogues exist for created/deleted/changed.) Exact per-event field names are representative — confirm against a live delivery before relying on a specific `old*`/`new*` field.

### Payload Format (array of events POSTed to your endpoint)

```json
[
  {
    "taskId": "IEAAALZ4KQAAAAAK",
    "webhookId": "IEAAALZ4JEAAAAA",
    "eventAuthorId": "KUAAAAAA",
    "eventType": "TaskStatusChanged",
    "lastUpdatedDate": "2026-05-29T02:00:00Z",
    "oldStatus": "Active",
    "newStatus": "Completed",
    "oldCustomStatusId": "IEAAALZ4JMAAAAA",
    "newCustomStatusId": "IEAAALZ4JNAAAAA"
  }
]
```

The payload carries IDs + the changed fields, NOT the full entity. Fetch the entity via `GET /api/v4/tasks/{id}` if you need full detail.

### Verification / Security

- **Signature header:** `X-Hook-Signature` on every delivered event.
- **Algorithm:** `HMAC-SHA256(key = your secret, value = raw request body)`, hex-encoded — compare against `X-Hook-Signature`. Reject on mismatch.
- **Handshake header:** `X-Hook-Secret` (echo-back on registration).
- **IP allowlist:** not documented. [UNKNOWN]

### Reliability

- **Retry:** Wrike retries failed deliveries; after sustained failures the webhook is auto-**`Suspended`** and must be re-enabled.
- **Dead letter:** none — events drop once suspended.
- **Ordering:** best-effort, not guaranteed.
- **Duplicates:** possible on retry — dedupe on `(eventType, taskId, lastUpdatedDate)`.

---

## WebSocket / SSE

Not applicable — Wrike exposes neither.

---

## Polling Fallback (Numa's current default)

Use when the user asks "what changed?" or you need change detection without webhooks.

### Recommended Approach

```http
GET /api/v4/tasks?updatedDate={"start":"<last_poll_iso>"}&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000
```

- **Change-detection field:** `updatedDate` (always server-set).
- **Interval:** 5–15 minutes for active sync; 30–60 for background. **Never sub-minute** on a busy account (400 req/min budget; each poll page = 1 request).
- For a specific project, scope it: `GET /api/v4/folders/{id}/tasks?updatedDate={…}`.

### Polling Pattern

```
1. last_poll_ts = now()  (ISO 8601 Z)
2. sleep {interval}
3. GET /api/v4/tasks?updatedDate={"start": last_poll_ts}&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000
4. page through nextPageToken (re-send filters each page; stop on missing token OR empty data)
5. for each changed task, fetch detail / act
6. last_poll_ts = now(); goto 2
```

### Efficient Polling Tips

- Keep the detection query lean — don't add `fields`; fetch detail only for tasks that actually changed.
- Batch detail fetches via bulk read: `GET /api/v4/tasks/{id1,id2,…}`.
- Use an open-ended range (`start` only) so you never miss a window edge; dedupe by `id` against what you've already seen.

---

## Error Handling

### Standard Error Response Format

Wrike returns a **flat** error object — there is NO per-field `details` array (unlike Zoho's `{code, details, message, status}`).

```json
{ "error": "invalid_parameter", "errorDescription": "Request parameter name or value is invalid" }
```

**Error fields:**

| Field              | Type   | Always present? | Description                                                         |
| ------------------ | ------ | --------------- | ------------------------------------------------------------------- |
| `error`            | string | yes             | Error code constant (e.g. `invalid_parameter`, `not_authorized`)    |
| `errorDescription` | string | yes             | Human-readable; names the offending parameter for validation errors |

Show the user the `errorDescription` verbatim — for validation failures it tells you exactly which param is wrong.

### Recovery Playbook

| HTTP    | Error code(s)                               | Meaning                            | Retryable? | Recovery action                                                               | Max retries |
| ------- | ------------------------------------------- | ---------------------------------- | ---------- | ----------------------------------------------------------------------------- | ----------- |
| 200     | —                                           | Success                            | —          | —                                                                             |             |
| 400     | `invalid_request`                           | HTTP type invalid / data malformed | No         | Fix request shape (form-encoded? JSON arrays quoted?)                         | 0           |
| 400     | `invalid_parameter`                         | Param name or value invalid        | No         | Fix per `errorDescription` (bad array literal, bad date JSON, bad enum)       | 0           |
| 400     | `parameter_required`                        | Required param missing             | No         | Supply it (`title`, `hours`, `trackedDate`, …)                                | 0           |
| 401     | `not_authorized`                            | Token invalid / expired            | Yes        | Backend refreshes once; if re-raised → user reconnects (rotated token lost)   | 1           |
| 403     | `not_allowed`                               | License/scope/quota blocks action  | No         | A write under `wsReadOnly` → widen scope to `Default,wsReadWrite` + reconnect | 0           |
| 403     | `access_forbidden`                          | Entity not shared with this user   | No         | Check sharing/permissions in Wrike; can't fix from API                        | 0           |
| 404     | `resource_not_found`                        | Entity not found                   | No         | Verify the opaque ID (it's a string!)                                         | 0           |
| 404     | `method_not_found`                          | API method/path doesn't exist      | No         | Verify the path                                                               | 0           |
| 429     | `rate_limit_exceeded` / `too_many_requests` | >400/min (user) or >5000/min (IP)  | Yes        | Honour `Retry-After` if present; else exp. backoff base 2s cap 60s            | 3           |
| 500     | `server_error`                              | Server-side error                  | Yes        | Retry with exponential backoff                                                | 3           |
| 502/503 | (gateway / maintenance)                     | Edge / maintenance                 | Yes        | Retry after `Retry-After`                                                     | 3           |

### Rate Limit Details

| Scope                       | Limit         | Window | Notes                                                          |
| --------------------------- | ------------- | ------ | -------------------------------------------------------------- |
| Per access token / per user | 400 requests  | 1 min  | **Primary limit for an integration.**                          |
| Per IP                      | 5000 requests | 1 min  | Aggregate across users behind one IP.                          |
| DDoS guard                  | dynamic       | —      | May 429 an over-expensive request even under the stated limit. |

- **Rate-limit headers:** none reliably returned — there is NO `X-RateLimit-Remaining` you can pre-emptively read. You learn the limit by getting a 429.
- **`Retry-After`:** sometimes present (seconds). Honour it when present.

**Rate-limit exceeded response:**

```json
{ "error": "rate_limit_exceeded", "errorDescription": "IP or access token exceeded limit: 400 requests per minute" }
```

(HTTP 429; `error` may also be `too_many_requests`.)

**Backoff strategy:**

1. If `Retry-After` is present, honour it.
2. Otherwise exponential backoff: base 2s, double each retry, cap 60s.
3. Add jitter (±50%) to avoid synchronised retry storms.
4. After 3 failed retries, surface to the user.

### Idempotency

- **No idempotency-key header.**
- GET is idempotent; PUT-by-id is idempotent; DELETE-by-id is idempotent (second delete → `resource_not_found` / no-op).
- **POST create is NOT idempotent** — retrying duplicates the task/comment/timelog (no title-uniqueness). For retry-prone create flows, search-by-title (tasks) or check the prior response before re-POSTing.

### Async Operations

- The only async surface is the **Data Export API** (`GET /api/v4/data_export`, `dataExportFull` scope) — kick off, poll the export resource. Out of scope for chat (admin/backup op).
- Core CRUD is fully synchronous.

---

## Counter-Exceptions

Behaviours that differ from standard REST expectations.

1. **API host is per-account, discovered via the token.** A token issued for an EU account sent to `www.wrike.com` fails — the correct host is the token-response `host` (e.g. `app-eu.wrike.com`). The backend handles this; symptom of getting it wrong is `not_authorized` / connectivity errors that look like auth.
2. **Refresh tokens rotate.** Each refresh invalidates the prior refresh token. Standard expectation is a long-lived refresh token — here, persisting the NEW one is mandatory. A connection that 401s persistently right after a refresh means the rotated token was lost → reconnect, don't retry.
3. **Write bodies are form-encoded, responses are JSON.** Composite values are JSON-inside-form-params. Sending a JSON request body to a write endpoint fails.
4. **Flat error shape, no per-field details.** Unlike many APIs, there's no `details[]` array — `errorDescription` is the whole story. Parse it, don't expect structured field errors.
5. **`nextPageToken` can appear on an empty page.** Don't treat token-present as "more data" unconditionally — also check `data` is non-empty and the token changed.
6. **No bulk write, no partial-success codes.** There's no batch endpoint and thus no 207/multi-status. Every write is single-entity, all-or-nothing.
7. **Soft delete only.** DELETE moves entities to the Recycle Bin (restorable in the UI); there's no `?hard=true`.
8. **403 `not_allowed` is the read-only signal.** Under `wsReadOnly`, every write returns `not_allowed` — it's a scope problem, not a body problem.

---

## Output Formatting Guide

How the workspace agent should present Wrike responses to users.

| Data type              | Format                        | Example                                                                                       |
| ---------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| Single task            | Key-value summary             | "**Write the spec** — Active, High importance, due Jun 1, assignee: Jane"                     |
| Task list              | Markdown table                | Columns: `Title`, `Status`, `Importance`, `Due`, `Assignee`, `Project`                        |
| Project                | Status + dates                | "**Q3 Launch** — 🟢 Green, Jun 1 → Aug 31, owner: Jane"                                       |
| Description / comments | Quoted block (plain text)     | Request `?plainText=true`; render as a quote                                                  |
| Dates                  | Human-readable                | "June 1, 2026" / "May 29, 2026 03:00 UTC"                                                     |
| Status                 | Map custom → high-level       | Show the workflow name ("In Review") AND the group ("Active") when relevant                   |
| Assignees              | Resolve IDs → names           | Bulk-read `/contacts/{ids}`; show "Jane Smith (jane@…)" not `KUAAAAAA`                        |
| Permalink              | Link                          | Offer the `permalink` so users can open it in Wrike                                           |
| Errors                 | `errorDescription` + fix hint | "Wrike rejected: _Request parameter name or value is invalid_ — `dates` must be JSON. Retry?" |

**Truncation rules:**

- Lists: show the first ~10; mention `responseSize` total and that more exist if paged.
- Long descriptions/comments: truncate at ~500 chars with "…" and offer to show more.
- Resolve contact IDs to names before displaying — raw opaque IDs are useless to users. Cache the contact lookup within a turn.
- Don't recursively walk subtasks/comments unless asked.

---

_Generated from `00-api-investigation-questionnaire.md` Phases 7 and 8._

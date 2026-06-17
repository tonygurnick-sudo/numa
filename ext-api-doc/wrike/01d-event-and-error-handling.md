---
api_name: Wrike
api_slug: wrike
base_url: https://{host}/api/v4 ({host} from OAuth token response; never hardcode www.wrike.com)
path_version_segment: /api/v4 (real path segment — v4 is path-versioned)
call_surface: HTTP via `numa integrations request` (connector wrike). NOT file-browse, NOT MCP.
companion_of: 01-llm-api-rules.md
doc: events (webhooks — NOT wired into Numa), polling fallback, error model, rate limits, backoff, idempotency, output formatting
confidence: DOCUMENTED (developers.wrike.com), not live-verified
---

# Wrike — Event & Error Handling Reference

## Event-Driven Capabilities

| Mechanism              | Supported                           | Notes                                                |
| ---------------------- | ----------------------------------- | ---------------------------------------------------- |
| Webhooks               | yes (API) — but NOT wired into Numa | account/folder/space scoped; HMAC-SHA256 signed      |
| WebSocket              | no                                  | not exposed                                          |
| Server-Sent Events     | no                                  |                                                      |
| Long polling           | no                                  |                                                      |
| Change feeds / streams | partial                             | poll `/tasks?updatedDate={start:…}` as a change feed |

## Webhooks (Wrike Webhooks API)

**Numa status:** Wrike supports webhooks but **Numa does NOT expose a public receiver for this connector.** Registering requires a Numa-hosted HTTPS endpoint that completes the `X-Hook-Secret` handshake and verifies the `X-Hook-Signature` HMAC on every delivery — none of which exists from chat. **If the user asks for real-time alerts, tell them it's polling-only for now.** Below documents what we'd build if prioritised.

### Setup (reference — not callable from chat)

- Registration: `POST /api/v4/webhooks` (account), `POST /api/v4/folders/{id}/webhooks` (folder), `POST /api/v4/spaces/{id}/webhooks` (space).
- Body (form): `hookUrl=https://…/wrike/webhook&events=[TaskCreated,TaskStatusChanged]&secret=<your-secret>`.
- URL: HTTPS; must complete a verification handshake on registration.
- Handshake: on create Wrike POSTs an `X-Hook-Secret` challenge header to your `hookUrl`; echo the SAME `X-Hook-Secret` back in a 200 to confirm ownership. Reject if the secret contains JSON chars or exceeds 100 chars (Wrike anti-oracle guidance).
- Webhook object fields: `id`, `accountId`, `folderId`/`spaceId` (if scoped), `hookUrl`, `status` (`Active`/`Suspended`), `events[]`.

### Event Catalog (representative)

| Event                     | Trigger                        | Key payload fields                                          |
| ------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `TaskCreated`             | new task                       | `taskId`, `eventAuthorId`, `lastUpdatedDate`                |
| `TaskDeleted`             | task deleted                   | `taskId`                                                    |
| `TaskTitleChanged`        | title edited                   | `taskId`, `oldValue`, `newValue`                            |
| `TaskImportanceChanged`   | importance changed             | `taskId`, `oldImportance`, `newImportance`                  |
| `TaskStatusChanged`       | status / custom-status changed | `taskId`, `oldStatus`, `newStatus`, `old/newCustomStatusId` |
| `TaskDatesChanged`        | start/due/duration changed     | `taskId`, old/new dates                                     |
| `TaskParentsAdded`        | added to a folder              | `taskId`, `addedParentId`                                   |
| `TaskParentsRemoved`      | removed from a folder          | `taskId`, `removedParentId`                                 |
| `TaskResponsiblesAdded`   | assignee added                 | `taskId`, `addedResponsibleId`                              |
| `TaskResponsiblesRemoved` | assignee removed               | `taskId`, `removedResponsibleId`                            |
| `CommentAdded`            | comment posted                 | `taskId`/`folderId`, `commentId`                            |
| `AttachmentAdded`         | file attached                  | `taskId`, `attachmentId`                                    |
| `TimelogChanged`          | timelog added/edited/deleted   | `taskId`, `timelogId`                                       |

Project/folder analogues exist (created/deleted/changed). Per-event field names are representative — confirm against a live delivery before relying on a specific `old*`/`new*` field.

### Payload (array of events POSTed to your endpoint)

`[{"taskId":"IEAAALZ4KQAAAAAK","webhookId":"IEAAALZ4JEAAAAA","eventAuthorId":"KUAAAAAA","eventType":"TaskStatusChanged","lastUpdatedDate":"2026-05-29T02:00:00Z","oldStatus":"Active","newStatus":"Completed","oldCustomStatusId":"IEAAALZ4JMAAAAA","newCustomStatusId":"IEAAALZ4JNAAAAA"}]`
Carries IDs + changed fields, NOT the full entity. Fetch via `GET /api/v4/tasks/{id}` for full detail.

### Verification / Security

- `X-Hook-Signature` on every delivery: `HMAC-SHA256(key=your secret, value=raw request body)`, hex-encoded — compare; reject on mismatch.
- `X-Hook-Secret` echo-back on registration.
- IP allowlist: not documented [UNKNOWN].

### Reliability

- Retry: Wrike retries failed deliveries; sustained failures auto-**Suspend** the webhook (must re-enable).
- Dead letter: none — events drop once suspended.
- Ordering: best-effort, not guaranteed. Duplicates possible on retry — dedupe on `(eventType, taskId, lastUpdatedDate)`.

## Polling Fallback (Numa's current default)

For "what changed?" / change detection without webhooks:

```http
GET /api/v4/tasks?updatedDate={"start":"<last_poll_iso>"}&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000
```

- Change-detection field: `updatedDate` (always server-set).
- Interval: 5–15 min active sync; 30–60 background. **Never sub-minute** on a busy account (400 req/min; each poll page = 1 request).
- Scope to a project when possible: `GET /api/v4/folders/{id}/tasks?updatedDate={…}`.

Pattern:

```
1. last_poll_ts = now() (ISO 8601 Z)
2. sleep {interval}
3. GET /api/v4/tasks?updatedDate={"start":last_poll_ts}&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000
4. page through nextPageToken (re-send filters each page; stop on missing token OR empty data)
5. for each changed task, fetch detail / act
6. last_poll_ts = now(); goto 2
```

Tips: keep the detection query lean (no `fields`; fetch detail only for changed tasks); batch detail fetches via bulk read `GET /api/v4/tasks/{id1,id2,…}`; use an open-ended range (`start` only) so you never miss a window edge; dedupe by `id`.

## Error Handling

Flat error object — NO per-field `details` array (unlike Zoho's `{code,details,message,status}`):
`{"error":"invalid_parameter","errorDescription":"Request parameter name or value is invalid"}`

| Field              | Always present? | Description                                                         |
| ------------------ | --------------- | ------------------------------------------------------------------- |
| `error`            | yes             | code constant (e.g. `invalid_parameter`, `not_authorized`)          |
| `errorDescription` | yes             | human-readable; names the offending parameter for validation errors |

Show `errorDescription` verbatim — for validation failures it names exactly which param is wrong.

### Recovery Playbook

| HTTP    | Error code(s)                               | Meaning                            | Retryable | Recovery                                                                      | Max retries |
| ------- | ------------------------------------------- | ---------------------------------- | --------- | ----------------------------------------------------------------------------- | ----------- |
| 400     | `invalid_request`                           | HTTP type invalid / data malformed | No        | Fix request shape (form-encoded? JSON arrays quoted?)                         | 0           |
| 400     | `invalid_parameter`                         | param name/value invalid           | No        | Fix per `errorDescription` (bad array literal, bad date JSON, bad enum)       | 0           |
| 400     | `parameter_required`                        | required param missing             | No        | Supply it (`title`, `hours`, `trackedDate`, …)                                | 0           |
| 401     | `not_authorized`                            | token invalid/expired              | Yes       | Backend refreshes once; if re-raised → user reconnects (rotated token lost)   | 1           |
| 403     | `not_allowed`                               | license/scope/quota blocks action  | No        | A write under `wsReadOnly` → widen scope to `Default,wsReadWrite` + reconnect | 0           |
| 403     | `access_forbidden`                          | entity not shared with this user   | No        | Check sharing/permissions in Wrike; can't fix from API                        | 0           |
| 404     | `resource_not_found`                        | entity not found                   | No        | Verify the opaque ID (string!)                                                | 0           |
| 404     | `method_not_found`                          | API method/path doesn't exist      | No        | Verify the path                                                               | 0           |
| 429     | `rate_limit_exceeded` / `too_many_requests` | >400/min (user) or >5000/min (IP)  | Yes       | Honour `Retry-After` if present; else exp. backoff base 2s cap 60s            | 3           |
| 500     | `server_error`                              | server-side error                  | Yes       | Retry exp. backoff                                                            | 3           |
| 502/503 | gateway / maintenance                       | edge / maintenance                 | Yes       | Retry after `Retry-After`                                                     | 3           |

### Rate Limits

| Scope                       | Limit    | Window | Notes                                                         |
| --------------------------- | -------- | ------ | ------------------------------------------------------------- |
| Per access token / per user | 400 req  | 1 min  | **primary limit for an integration**                          |
| Per IP                      | 5000 req | 1 min  | aggregate across users behind one IP                          |
| DDoS guard                  | dynamic  | —      | may 429 an over-expensive request even under the stated limit |

- **No reliable rate-limit headers** — NO `X-RateLimit-Remaining` to pre-read. Learn the limit by getting a 429.
- `Retry-After`: sometimes present (seconds). Honour when present.
- 429 response: `{"error":"rate_limit_exceeded","errorDescription":"IP or access token exceeded limit: 400 requests per minute"}` (`error` may also be `too_many_requests`).
- Backoff: honour `Retry-After`; else exponential base 2s, double each retry, cap 60s; add ±50% jitter; after 3 failed retries surface to the user.

### Idempotency

- No idempotency-key header.
- GET / PUT-by-id / DELETE-by-id are idempotent (second delete → `resource_not_found` / no-op).
- **POST create is NOT idempotent** — retrying duplicates the task/comment/timelog (no title-uniqueness). For retry-prone create flows, search-by-title (tasks) or check the prior response before re-POSTing.

### Async Operations

Only async surface is the **Data Export API** (`GET /api/v4/data_export`, `dataExportFull` scope) — kick off, poll the export resource. Out of scope for chat (admin/backup op). Core CRUD is fully synchronous.

## Counter-Exceptions (differ from standard REST)

1. **API host is per-account, discovered via the token.** A token for an EU account sent to `www.wrike.com` fails — the correct host is the token-response `host` (e.g. `app-eu.wrike.com`). The backend handles this; getting it wrong looks like `not_authorized`/connectivity errors that resemble auth.
2. **Refresh tokens rotate.** Each refresh invalidates the prior refresh token; persisting the NEW one is mandatory. A connection that 401s persistently right after a refresh means the rotated token was lost → reconnect, don't retry.
3. **Write bodies form-encoded, responses JSON.** Composite values are JSON-inside-form-params. A JSON request body to a write endpoint fails.
4. **Flat error shape, no per-field details.** No `details[]` array — `errorDescription` is the whole story.
5. **`nextPageToken` can appear on an empty page.** Also check `data` is non-empty and the token changed.
6. **No bulk write, no partial-success codes.** No batch endpoint → no 207/multi-status. Every write is single-entity, all-or-nothing.
7. **Soft delete only.** DELETE → Recycle Bin (restorable in the UI); no `?hard=true`.
8. **403 `not_allowed` is the read-only signal.** Under `wsReadOnly` every write returns `not_allowed` — a scope problem, not a body problem.

## Output Formatting Guide

| Data type              | Format                        | Example                                                                                       |
| ---------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| Single task            | key-value summary             | "**Write the spec** — Active, High importance, due Jun 1, assignee: Jane"                     |
| Task list              | Markdown table                | Columns: `Title`, `Status`, `Importance`, `Due`, `Assignee`, `Project`                        |
| Project                | status + dates                | "**Q3 Launch** — 🟢 Green, Jun 1 → Aug 31, owner: Jane"                                       |
| Description / comments | quoted block (plain text)     | request `?plainText=true`; render as a quote                                                  |
| Dates                  | human-readable                | "June 1, 2026" / "May 29, 2026 03:00 UTC"                                                     |
| Status                 | map custom → high-level       | show the workflow name ("In Review") AND the group ("Active") when relevant                   |
| Assignees              | resolve IDs → names           | bulk-read `/contacts/{ids}`; show "Jane Smith (jane@…)" not `KUAAAAAA`                        |
| Permalink              | link                          | offer the `permalink` so users can open it in Wrike                                           |
| Errors                 | `errorDescription` + fix hint | "Wrike rejected: _Request parameter name or value is invalid_ — `dates` must be JSON. Retry?" |

Truncation: lists — show first ~10, mention `responseSize` total and that more exist if paged. Long descriptions/comments — truncate at ~500 chars with "…" and offer more. Resolve contact IDs to names before displaying (raw opaque IDs are useless to users); cache the lookup within a turn. Don't recursively walk subtasks/comments unless asked.

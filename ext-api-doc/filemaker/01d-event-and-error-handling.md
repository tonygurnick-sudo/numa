---
api_name: 'Claris FileMaker Data API'
api_slug: 'filemaker'
generated_from: '00-api-investigation-questionnaire'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Claris FileMaker Data API — Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Event capabilities (none), polling, the session-token error model,
> the FileMaker error-code playbook, and output formatting.
>
> **The defining error rule:** FileMaker usually returns **HTTP 200** even for logical errors. The real
> status is `messages[0].code` — a _string_ — where `"0"` is success and everything else is a FileMaker
> error code. **Always read `messages`, never trust the HTTP status alone.**

---

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                            |
| ------------------------ | --------- | -------------------------------- |
| Webhooks                 | No        | Not part of the Data API at all. |
| WebSocket                | No        | —                                |
| Server-Sent Events (SSE) | No        | —                                |
| Long polling             | No        | —                                |
| Change feeds / streams   | No        | —                                |

There is **no push mechanism of any kind.** (A FileMaker _solution_ can push outbound via the `Insert from URL`
script step on a trigger, but that is custom solution logic the customer would have to build — it is not an API
feature this connector can rely on.) All change detection is **polling**.

---

## Polling for Changes

### Recommended approach: `_find` on a modification-timestamp field

There is no universal server-wide "modified since" filter and no queryable global change cursor. Polling relies on
the customer's schema having an **auto-enter Modification Timestamp** field on (or accessible from) the layout.
Discover its exact name via `GET .../layouts/{layout}` first.

```http
POST /databases/Inventory/layouts/Products/_find
Authorization: Bearer {token}

{ "query": [ { "Modification Timestamp": ">=05/29/2026 09:00:00" } ],
  "sort":  [ { "fieldName": "Modification Timestamp", "sortOrder": "ascend" } ],
  "limit": "200", "offset": "1", "dateformats": "2" }
```

### Polling loop

```
1. last_poll = "2026-05-29T09:00:00"
2. wait >= 5 minutes
3. POST .../_find  query: { "<ModTimestampField>": ">=<last_poll>" }, paginate via offset/limit
4. process returned records (use recordId/modId to dedupe)
5. last_poll = now()   (UTC; account for clock skew — overlap the window slightly)
6. goto 2
```

### Notes & limits

- `recordId` is stable; `modId` increments per edit but is **not** directly queryable, so it cannot be used as the
  change cursor — use a timestamp field.
- **Deletes are invisible to timestamp polling.** To detect deletions, periodically snapshot the set of `recordId`s
  for a scope and diff against the previous snapshot.
- **Recommended interval:** **≥ 5 minutes.** Each poll consumes a session + a query, there is no rate-limit
  guidance, and throughput is the customer's own hardware — be conservative. For reference data, hourly is plenty.

---

## The Session-Token Error Model (read this first)

| Failure                             | Where it shows                                  | What it means                                                       | Action                                                                                      |
| ----------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Bad credentials at login            | **HTTP 401** on `POST /sessions`                | Wrong `username`/`password`, or `fmrest` privilege not granted      | Surface a clear auth error; the user must fix vault credentials / server-side privilege.    |
| Token expired / invalid             | `messages[].code == "952"` (HTTP often 401/200) | The 15-min idle window lapsed, or the token was invalidated         | **Re-login (`POST /sessions`) and retry the call once.** The proxy does this automatically. |
| Data API disabled / per-license cap | `messages[].code == "953"`                      | Data API turned off in Admin Console, or a license call cap reached | Not retryable by the agent; tell the user to enable/raise it server-side.                   |
| Wrong server/database path          | HTTP 404 / `messages` `802`                     | Bad `server_url`, `database` not hosted, or DB name case wrong      | Verify credentials; database names can be case-sensitive.                                   |
| TLS / certificate failure           | Connection error (no JSON)                      | Self-signed or invalid SSL cert on the FileMaker Server             | The server needs a trusted cert; cannot be worked around client-side.                       |

> **`952` is the one to internalise.** It is normal and expected — tokens expire fast. Re-login and retry once.
> Do not surface `952` to the user as a hard failure on the first occurrence.

---

## Standard Error Format

```json
{ "response": {}, "messages": [{ "code": "102", "message": "Field is missing" }] }
```

| Field                | Type   | Always present? | Description                                                                         |
| -------------------- | ------ | --------------- | ----------------------------------------------------------------------------------- |
| `messages`           | array  | Yes             | One or more `{code, message}` objects. **The source of truth for success/failure.** |
| `messages[].code`    | string | Yes             | FileMaker error code. `"0"` = OK.                                                   |
| `messages[].message` | string | Yes             | Human-readable text.                                                                |
| `response`           | object | Yes             | The payload on success; often `{}` on error.                                        |

There is **no field-by-field validation array** — a validation failure is a single `messages` entry (e.g. `500`,
`504`) and the message does not always name the offending field. This is why discovering required fields / value
lists from layout metadata up front matters.

---

## Recovery Playbook (FileMaker error codes in `messages[].code`)

| Code | Meaning                              | Retryable?         | Recovery                                                                |
| ---- | ------------------------------------ | ------------------ | ----------------------------------------------------------------------- |
| 0    | OK                                   | —                  | Proceed.                                                                |
| 101  | Record is missing                    | No                 | `recordId` wrong or already deleted; re-find.                           |
| 102  | Field is missing                     | No                 | Field not on the layout / misspelled — re-read layout metadata.         |
| 104  | Script is missing                    | No                 | Re-list scripts; check exact name/case.                                 |
| 105  | Layout is missing                    | No                 | Re-list layouts; check exact name/case.                                 |
| 106  | Table is missing                     | No                 | Layout's base table not found; confirm the layout.                      |
| 401  | No records match                     | No (not a failure) | Empty result from a find — report as such.                              |
| 500  | Date/number/validation value invalid | No                 | Fix `fieldData` formatting; set `dateformats:2`, pass ISO dates.        |
| 504  | Unique-value validation failed       | No                 | Duplicate key — find the existing record and edit, or change the value. |
| 802  | Unable to open the file              | No                 | DB not hosted / wrong name / Data API disabled — check connection.      |
| 952  | Invalid Data API token               | **Yes**            | **Re-login and retry once** (proxy handles it).                         |
| 953  | Data API request limit / disabled    | No                 | Feature off or per-license cap; user must fix server-side.              |

**HTTP-level statuses that genuinely occur:** `401` (bad Basic credentials at login), `403`/`404` (wrong
server/database path), `500` (server fault), plus TLS/connection errors for bad certs. There is **no `429`** —
no published rate limit exists.

---

## Retry Logic

```
- 952 (invalid token):     re-login, retry the SAME call ONCE. Then give up if it recurs.
- Connection / TLS error:  retry up to 2x with backoff (server may be restarting); then report.
- HTTP 5xx:                retry up to 2x with exponential backoff (1s, 2s); then report.
- 401 at login:            DO NOT retry — credentials/privilege are wrong.
- 101/102/104/105/500/504: DO NOT retry — fix the request (name, value, or schema understanding).
- 401 from a find:         DO NOT retry — it is an empty result, not an error.
```

No `Retry-After` header is ever sent (no rate limiting). The realistic load failure is **session exhaustion**
(too many concurrent tokens against the server's "Maximum Data API connections" cap) — mitigate by reusing one
token and logging out (`DELETE /sessions/{token}`) when a burst of work finishes, rather than opening many sessions.

---

## Rate Limiting

| Scope               | Limit                                                    | Window | Headers |
| ------------------- | -------------------------------------------------------- | ------ | ------- |
| Global              | None published                                           | —      | None    |
| Concurrent sessions | Configurable server cap ("Maximum Data API connections") | —      | None    |

Self-hosted, so throughput is the customer's hardware. No `429`, no `Retry-After`. Be conservative on polling and
prefer one reused token. There may also be a per-license Data API call cap surfacing as `953`.

---

## Counter-Exceptions

> Behaviors that differ from standard HTTP/REST conventions.

1. **HTTP 200 does not mean success.**
   - Standard: 2xx = success, 4xx/5xx = failure.
   - Actual: most logical errors come back 200 with a non-zero `messages[].code`. Check `messages` first.

2. **A find with no matches reports error `401`.**
   - Standard: 401 = unauthorized.
   - Actual: `messages[].code == "401"` from `_find` = "no records match" — a successful empty result, not auth failure.

3. **`code` is a string, not a number.**
   - Standard: numeric error codes.
   - Actual: `"0"`, `"401"`, `"952"` — compare as strings.

4. **Token expiry (`952`) is routine, not exceptional.**
   - Standard: a session lasts the conversation.
   - Actual: ~15-min sliding idle expiry with no refresh; re-login on `952` is normal flow.

5. **No webhook/event support at all.**
   - Standard: most modern APIs offer webhooks.
   - Actual: polling only, against a tenant-defined modification-timestamp field.

---

## Output Formatting Guide

| Data type        | Format                                             | Example                                                                      |
| ---------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Single record    | Key-value summary using the layout's field names   | "Product Name: Gadget · Stock: 95 · SKU: G-007 (recordId 514)"               |
| Record list      | Markdown table of the most relevant fields + total | Show key columns; note `foundCount`.                                         |
| Counts           | State both                                         | "2 of 500 records match." (`foundCount` / `totalRecordCount`)                |
| Dates            | Human-readable                                     | "29 May 2026, 9:00 AM"                                                       |
| Currency         | Localized                                          | "$4,820.00"                                                                  |
| Container fields | Link / note                                        | Show the streaming URL or note "binary content (download unsupported here)". |
| Errors           | Plain, actionable, include the FM code             | "FileMaker error 504: that SKU already exists. Pick a different SKU."        |

### Truncation rules

- Lists: show the first ~20 records, then note the total (`foundCount`).
- Long text fields: truncate at ~500 characters with "…".
- Always include `recordId` when the user may want to act on a specific record next (edit/delete).

---

## Logging Recommendations

Log at each `connect_request` boundary with a `_name` field for filtering:

```json
{
  "_name": "FILEMAKER_API",
  "method": "POST",
  "path": "/databases/Inventory/layouts/Products/_find",
  "http_status": 200,
  "fm_code": "0",
  "found_count": 2,
  "returned_count": 2,
  "duration_ms": 180,
  "server_url": "myserver.fmi.filemaker-cloud.com",
  "database": "Inventory"
}
```

On error, additionally capture `fm_code`, `fm_message`, and whether a `952` re-login/retry was performed. Never log
credentials or the session token.

---

_Generated from the investigation questionnaire, Phases 7–8. No events (`[DOCUMENTED]`). Error codes are from the
official FileMaker error-code reference (`[DOCUMENTED]`), not live-verified — no reachable per-tenant server._

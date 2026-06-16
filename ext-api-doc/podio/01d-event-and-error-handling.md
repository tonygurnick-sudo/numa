---
api_name: Podio
api_slug: podio
base_url: https://api.podio.com
path_version_segment: none (core API unversioned)
call_surface: HTTP JSON via `connect_request`
rate_limit: 1000/hr general; 250/hr HEAVY (filter/count/search). Exceeded → HTTP 420 (NOT 429) + Retry-After.
confidence: all [DOCUMENTED] (developers.podio.com) unless tagged [INFERRED]. Error-code-per-status partly [INFERRED] from official SDKs (Podio publishes no single HTTP-status page).
companion_of: 01-llm-api-rules.md
scope: hooks + verify handshake, polling fallback, error JSON, 420/rate model, backoff, output formatting
---

# Podio — Event & Error Handling Reference

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                                                     |
| ------------------------ | --------- | --------------------------------------------------------- |
| Webhooks ("Hooks")       | yes       | `/hook/{ref_type}/{ref_id}/` — mandatory verify handshake |
| WebSocket                | no        | Not exposed                                               |
| Server-Sent Events (SSE) | no        |                                                           |
| Long polling             | no        |                                                           |
| Change feeds / streams   | partial   | `/stream/` activity feeds (read, not push)                |

## Webhooks (Hooks API)

**Numa status:** Numa does NOT yet host a verifiable public receiver for the Podio connector, so the agent does NOT register hooks from chat — it's polling-only for now. The section below documents what we'd build if hooks are prioritised (essential reading for anyone wiring the receiver).

### Setup

- Registration: API (`POST /hook/{ref_type}/{ref_id}/`) or the Podio UI.
- `ref_type`/`ref_id`: `app`+`app_id`, `space`+`space_id`, or `app_field`+`field_id` (field-scoped).
- URL: HTTPS endpoint. Podio POSTs notifications as `application/x-www-form-urlencoded`.

Register: `POST /hook/app/500600/` body `{"url":"https://arcanum-demo-tony.numa.arcanum.ai/api/podio/webhook","type":"item.create"}` → `{"hook_id":778899}` — status `inactive` until verified.

### Verification handshake (MANDATORY)

A freshly created hook is `inactive`. Podio immediately POSTs a `type=hook.verify` notification carrying a `code`. Your endpoint must capture it and validate:

```
1. POST /hook/app/500600/                  → {hook_id:778899}, status inactive
2. Podio POSTs to your URL:  type=hook.verify&code=ABC123&hook_id=778899
3. Endpoint captures `code`, then: POST /hook/778899/verify/validate  {"code":"ABC123"}
4. Hook flips to `active`. Events now flow.
```

`POST /hook/{hook_id}/verify/request` re-sends the verify code if you missed it.

### Event Catalog

`type` values delivered to your `url`. Payloads carry **IDs only, not the full record** — re-fetch via `GET /item/{item_id}`.

| Event                     | Trigger                     | Key payload fields                    |
| ------------------------- | --------------------------- | ------------------------------------- |
| `hook.verify`             | Once at creation            | `type`, `code`, `hook_id`             |
| `item.create`             | Item created in scope       | `type`, `item_id`, `item_revision_id` |
| `item.update`             | Item updated                | `type`, `item_id`, `item_revision_id` |
| `item.delete`             | Item deleted                | `type`, `item_id`                     |
| `comment.create`          | Comment added               | `type`, `comment_id`, ref ids         |
| `file.change`             | File attached/changed       | `type`, `file_id`                     |
| `app.update`/`app.delete` | App schema/lifecycle change | `type`, `app_id`                      |
| `space.create` etc.       | Space-level changes         | `type`, `space_id`                    |

### Payload Format

Podio → your endpoint, **form-urlencoded** (not JSON), Content-Type `application/x-www-form-urlencoded`:

```
type=item.create&item_id=12345&item_revision_id=3&hook_id=778899
```

Payload does NOT include record data — fetch `GET /item/{item_id}` for details.

### Verification / Security

- **No signature.** Podio does NOT HMAC-sign webhook payloads. The verify handshake proves _you own the URL_, but inbound events are unsigned.
- **Implication:** anyone who learns the URL could spoof events. Mitigate: (1) an unguessable URL path, (2) re-fetch the referenced item (auth-gated) before acting — never trust the payload's claim alone.
- IP allowlist: not published by Podio; can't be primary verification [INFERRED].

### Reliability

- Retry: Podio retries failed (non-2xx) deliveries; exact schedule undocumented [INFERRED].
- Ordering: best-effort, not guaranteed.
- Duplicates: possible on retry — **dedupe on `item_revision_id`** (and `(item_id, type)`).

### List / delete hooks

`GET /hook/app/500600/` (list hooks on the app); `DELETE /hook/778899` (remove a hook).

## WebSocket / SSE

Not applicable — Podio exposes neither. `/stream/` activity feed is read-only (pull), not a push channel.

## Polling Fallback

Numa's current default for "has X changed?" since hooks aren't wired.

- Endpoint: `POST /item/app/{app_id}/filter` filtered + sorted by `last_edit_on`.
- Change-detection field: `last_edit_on`/`last_event_on` (server-set on every write).

```
POST /item/app/500600/filter
{"filters":{"last_edit_on":{"from":"2026-05-29 09:00:00"}},"sort_by":"last_edit_on","sort_desc":true,"limit":100}
```

Pattern:

```
1. last_poll = now() UTC  (YYYY-MM-DD HH:MM:SS)
2. sleep {interval}
3. POST /item/app/{app_id}/filter  with last_edit_on >= last_poll, limit 100, sort last_edit_on desc
4. process changed items (GET /item/{id} only if full detail needed)
5. last_poll = now(); goto 2
```

- Interval: every **15–30 min**. Filter is HEAVY (250/hr) — do NOT poll aggressively.
- Cost: each poll = 1 heavy-pool call. Polling N apps every 15 min = 4N heavy calls/hr — keep N small or widen the interval.
- Page `limit:100`; use the `last_edit_on` filter so you only pull what changed.

## Error Handling

### Standard Error Response Format

```
{"error":"not_found","error_description":"Item with id 99999 could not be found","error_detail":null,"error_parameters":{},"error_propagate":false,"request":{"url":"https://api.podio.com/item/99999","query_string":"","method":"GET"}}
```

| Field               | Type    | Always present? | Description                                                                                                                              |
| ------------------- | ------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `error`             | string  | yes             | Short machine code: `not_found`, `unauthorized`, `invalid_value`, `forbidden`, `rate_limit`, `server_error`, `invalid_grant`, `conflict` |
| `error_description` | string  | yes             | Human-readable, user-safe — surface verbatim                                                                                             |
| `error_detail`      | any     | sometimes       | Per-error extra context (validation specifics) [INFERRED contents]                                                                       |
| `error_propagate`   | boolean | yes             | UI hint — whether to show to the end user                                                                                                |
| `request`           | object  | yes             | Echoes the failing call (`url`, `method`, `query_string`)                                                                                |

### Validation Error Format (field-level write failure)

```
{"error":"invalid_value","error_description":"The value 'tomorrow' is not a valid date","error_detail":{"field":"due_date","expected":"YYYY-MM-DD HH:MM:SS"},"error_parameters":{},"error_propagate":true,"request":{"url":"https://api.podio.com/item/app/500600/","method":"POST"}}
```

[DOCUMENTED shape from SDKs; `error_detail` contents INFERRED — exact keys may differ.] Note: Podio uses **400 `invalid_value`** for field-level write failures — NOT the standard `422`.

### Recovery Playbook

| HTTP        | `error` (examples)                         | Meaning                           | Retryable? | Recovery action                                                                             | Max retries |
| ----------- | ------------------------------------------ | --------------------------------- | ---------- | ------------------------------------------------------------------------------------------- | ----------- |
| 200/201/204 | —                                          | Success / created / no content    | —          | 204 → treat as success/empty                                                                |             |
| 400         | `invalid_value`, `invalid_grant`           | Bad request / body                | No         | Fix body; re-check field types via `GET /app/{app_id}`                                      | 0           |
| 401         | `unauthorized`, `invalid_token`, `expired` | Token invalid/expired             | Yes        | Refresh token (persist rotated refresh_token), retry once; if refresh also 401 → re-consent | 1           |
| 403         | `forbidden`                                | No permission                     | No         | Check space/app membership                                                                  | 0           |
| 404         | `not_found`                                | Resource missing                  | No         | Verify `item_id`/`app_id`                                                                   | 0           |
| 409         | `conflict`                                 | Conflict                          | Maybe      | Re-read (`GET`) and retry                                                                   | 1           |
| 410         | `gone`                                     | Deleted                           | No         | —                                                                                           | 0           |
| **420**     | `rate_limit`                               | **Rate limited (Podio, NOT 429)** | Yes        | Honour `Retry-After`; widen pages; backoff                                                  | 3           |
| 500         | `server_error`                             | Server error                      | Yes        | Exponential backoff                                                                         | 3           |
| 502/503     | `server_error`                             | Gateway / maintenance             | Yes        | Retry after `Retry-After`                                                                   | 3           |

Always show the user `error_description` verbatim plus a fix hint — don't paraphrase.

### Rate Limit Details

**Per user, per API key**, on a rolling **1-hour** window.
| Scope | Limit | Window | Notes |
| --- | --- | --- | --- |
| General API calls | 1,000 | 1 hr | Default pool |
| "Rate limited" (heavy) ops | 250 | 1 hr | Ops marked "Rate limited" — incl. `/item/app/{id}/filter`, `/count`, search |

Headers on every response: `X-Rate-Limit-Limit` (ceiling for the call just made, e.g. `"1000"`), `X-Rate-Limit-Remaining` (calls left in the current 1-hr window, e.g. `"843"`).

Exceeded → HTTP `420` (Podio-specific, NOT 429), with a `Retry-After` header (seconds):

```
{"error":"rate_limit","error_description":"You have hit the rate limit. Please wait before trying again.","error_detail":null,"request":{"url":"https://api.podio.com/item/app/500600/filter","method":"POST"}}
```

**Backoff:** (1) Honour `Retry-After` first. (2) Else exponential backoff from 2s, doubling each retry, cap 60s. (3) Add jitter (±50%). (4) After 3 failed retries, surface to the user. (5) The heavy pool is only 250/hr — **prevent** 420s: wide pages (`limit:100`), incremental `last_edit_on` filters, `/count` before paging, never poll aggressively.

### Error Code Reference

| Code            | HTTP        | Meaning                             | Common cause                                         | Fix                                                            |
| --------------- | ----------- | ----------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| `unauthorized`  | 401         | Token invalid/expired/wrong scheme  | Used `Bearer` not `OAuth2`; access token past 8h     | Use `OAuth2 {token}`; refresh; persist rotated refresh_token   |
| `invalid_grant` | 400         | Token exchange/refresh failed       | Refresh token expired (28d) or wrong `tokenUrl`      | Re-consent; verify `tokenUrl` = `api.podio.com/oauth/token/v2` |
| `invalid_value` | 400         | Field type/format wrong, bad option | Date with `Z`; ID as string; bad category option id  | Re-check field types/options via `GET /app/{app_id}`           |
| `forbidden`     | 403         | No permission on space/app/item     | User not a member; insufficient rights               | Check membership; gate admin ops                               |
| `not_found`     | 404         | Resource missing                    | Wrong `item_id`/`app_id`; deleted; bad `external_id` | Verify id; refetch                                             |
| `conflict`      | 409         | Conflict                            | Duplicate `external_id`; concurrent write            | Re-read and retry / use external_id lookup                     |
| `rate_limit`    | **420**     | Hourly cap hit (1000 or 250)        | Too many filter/write calls in the window            | Backoff per `Retry-After`; widen pages                         |
| `server_error`  | 500/502/503 | Podio server / maintenance          | Transient                                            | Retry with backoff; check status.podio.com                     |

## Idempotency & Concurrency

- **No idempotency header.** GET / PUT(by item_id) / DELETE are naturally idempotent; POST create is not.
- **Make create idempotent** via a stable `external_id` + `GET /item/app/{app_id}/external_id/{external_id}` lookup-then-create/update (01c Pattern 3). Podio's only dedupe primitive.
- **Optimistic concurrency:** items carry a `revision` integer that increments per write. No ETag enforcement — last-write-wins. Compare `revision` to detect drift before overwriting.
- **Async operations:** none — every Podio call is synchronous request/response. No job/poll pattern.

## Counter-Exceptions (differ from standard HTTP/REST)

1. **Rate-limit status is `420`, not `429`.** Podio returns HTTP 420 with `error:"rate_limit"`. Handle like 429.
2. **Auth header scheme is `OAuth2`, not `Bearer`.** `Authorization: OAuth2 {token}`; `Bearer` → 401 `unauthorized`.
3. **Datetimes are bare UTC, no `Z`/offset.** `YYYY-MM-DD HH:MM:SS`, always UTC; a `Z`/offset → `invalid_value`.
4. **Webhook payloads are unsigned and carry IDs only.** No HMAC (verify handshake proves URL ownership only); form-urlencoded IDs. Re-fetch the auth-gated record before acting.
5. **`number` fields READ back as strings** (`values:[{value:"123.45"}]`). Parse before maths; write back as a real number.
6. **Read `fields` is an array; write `fields` is an object.** Read = `[{field_id,type,values}]`; write = `{external_id: writeValue}`.
7. **No bulk write.** One item per call — loops, paced against the hourly caps.

## Output Formatting Guide (how to present Podio responses)

| Data type         | Format                    | Example                                                                                  |
| ----------------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| Single item       | Key-value summary         | "**Project Alpha** (Leads) — Status: Open, Amount: $50,000 USD, edited 20 May"           |
| Item list         | Markdown table            | Columns: `Title`, `Status`, `Amount`, `Last edited`, `Item ID`                           |
| App schema        | Field list                | "Leads has: Title (text, required), Status (category: Open/Won), Amount (money)"         |
| Long text fields  | Quoted block              | > note content here                                                                      |
| Dates             | Human-readable + UTC note | "May 29, 2026 10:30 (UTC)"                                                               |
| Money             | value + currency          | "$50,000.00 USD" (value reads as a string — parse it)                                    |
| Category          | Option text               | "Open" (resolve from the option object, don't show the raw id)                           |
| App / contact ref | Title / name + id         | "Acme renewal (item 12345)" / "Jane Smith (profile 654321)"                              |
| Errors            | `error_description` + fix | "Podio rejected: _The value 'tomorrow' is not a valid date_. Use `YYYY-MM-DD HH:MM:SS`?" |

**Truncation:** Lists — show first 10 items; note `filtered` total and that more exist (paginate on request). Long fields — truncate at 500 chars with "…" and offer to show more. References — show 1 level deep (don't recursively fetch related items unless asked).

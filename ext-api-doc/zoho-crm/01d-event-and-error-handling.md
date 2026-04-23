---
api_name: 'Zoho CRM'
api_slug: 'zoho-crm'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-04-23'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Zoho CRM -- Event & Error Handling Reference

> Notifications API (Zoho's webhook mechanism), polling fallback, error format,
> credit-based rate-limit recovery, and backoff strategy.

---

## Event-Driven Capabilities

| Mechanism                 | Supported | Notes                                                                          |
| ------------------------- | --------- | ------------------------------------------------------------------------------ |
| Webhooks (Notifications)  | yes       | `/crm/v8/actions/watch`. 24-hour default subscription, renewable up to 1 year. |
| WebSocket                 | no        | Not exposed by Zoho CRM                                                        |
| Server-Sent Events        | no        |                                                                                |
| Long polling              | no        |                                                                                |
| Change feeds / streams    | no        |                                                                                |
| Bulk export notifications | partial   | Optional callback URL on bulk read/write completion                            |

---

## Webhooks (Notifications API)

> **Numa status:** the Zoho CRM connector does NOT yet subscribe to notifications on
> behalf of users. Numa has no public HTTPS receiver wired up for this connector
> yet. If the user asks about real-time alerts, tell them it's polling-only for now.
>
> The section below documents what we'd build if notifications are prioritised.

### Setup

- **Registration method:** API (`POST /crm/v8/actions/watch`) or Zoho UI (Setup → Developer Space → Notifications).
- **URL requirements:** HTTPS required in production. Zoho does not ping the URL on registration.
- **Subscription lifetime:** 24 hours default. Extend up to 1 year by setting `channel_expiry` further in the future. Must be renewed before expiry.

**Register a subscription:**

```http
POST /crm/v8/actions/watch
Authorization: Zoho-oauthtoken {access_token}
Content-Type: application/json

{
  "watch": [
    {
      "channel_id": "1001",
      "events": ["Leads.create", "Leads.edit", "Leads.delete"],
      "channel_expiry": "2027-04-23T10:00:00+10:00",
      "notify_url": "https://arcanum-demo-tony.numa.arcanum.ai/api/zoho-crm/webhook",
      "token": "shared-secret-echoed-back-in-payload-for-verification"
    }
  ]
}
```

### Event Catalog

Event name pattern: `{Module}.{event}`.

| Event Name         | Trigger                                 | Key payload fields             | Notes                                    |
| ------------------ | --------------------------------------- | ------------------------------ | ---------------------------------------- |
| `Leads.create`     | Lead record created                     | `ids[]`, `module`, `operation` |                                          |
| `Leads.edit`       | Lead record updated                     | same + `affected_fields`       | Pre-change snapshot NOT included         |
| `Leads.delete`     | Lead record deleted                     | `ids[]`                        | Soft delete only — hard delete not fired |
| `Leads.convert`    | Lead conversion to Contact/Account/Deal | `ids[]`                        |                                          |
| `Contacts.*`       | Contact create/edit/delete              | as above                       |                                          |
| `Accounts.*`       | Account create/edit/delete              | as above                       |                                          |
| `Deals.*`          | Deal create/edit/delete                 | as above                       |                                          |
| `Tasks.*`          | Task create/edit/delete                 | as above                       |                                          |
| `{CustomModule}.*` | Any custom module                       | as above                       |                                          |

### Payload Format

Delivered to your `notify_url`:

```json
{
  "server_time": 1713849600000,
  "query_params": {},
  "module": "Leads",
  "resource_uri": "https://www.zohoapis.com.au/crm/v8/Leads",
  "ids": ["410405000002264040"],
  "affected_fields": [],
  "operation": "insert",
  "channel_id": "1001",
  "token": "shared-secret-echoed-back-in-payload-for-verification"
}
```

**Headers sent with delivery:**

| Header         | Value                      | Purpose |
| -------------- | -------------------------- | ------- |
| `Content-Type` | `application/json`         |         |
| `User-Agent`   | `Zoho CRM Notification/v8` |         |

The payload itself does **not** include record data — only IDs. Fetch records via `GET /crm/v8/{Module}/{id}` if you need details.

### Verification / Security

- **No signature.** Zoho does NOT HMAC-sign notification payloads.
- **Verification mechanism:** match the `token` field against the shared secret you supplied at registration. **That's the only verification available.**
- **Implication:** anyone who learns your notify_url can spoof events. Keep the token secret and drop requests where the received `token` doesn't match the registered one. Consider further hardening (IP allowlist) at the load balancer.
- **IP allowlist:** not published by Zoho; cannot be used as primary verification.

### Reliability

- **Retry policy:** 5 retries on non-2xx, exponential backoff (~1m, 5m, 30m, 2h, 10h).
- **Dead letter:** none — eventual drop after 5 retries.
- **Event ordering:** best-effort, not guaranteed. Build idempotent handlers keyed on `(module, id, operation, server_time)`.
- **Duplicate delivery:** possible (on retry) — dedupe on your end.

### List and unsubscribe

```http
GET /crm/v8/actions/watch                           # list existing subscriptions
DELETE /crm/v8/actions/watch?channel_ids=1001       # unsubscribe
```

---

## WebSocket / SSE

Not applicable — Zoho CRM does not expose WebSocket or SSE endpoints.

---

## Polling Fallback

Numa's current default. Use when the user asks "has X been updated?" or we need to detect changes without notifications.

### Recommended Approach

- **Best:** COQL on `Modified_Time`:

  ```http
  POST /crm/v8/coql
  { "select_query": "select Id, Modified_Time, Last_Name from Leads where Modified_Time > '2026-04-23T09:00:00+10:00' order by Modified_Time desc limit 200" }
  ```

- **Alternative:** `GET /{Module}?fields=id,Modified_Time&sort_by=Modified_Time&sort_order=desc&per_page=200` then filter client-side.

- **Change detection field:** `Modified_Time` (always server-set).
- **Recommended interval:** 5–15 minutes for active sync; 30–60 minutes for background; **never below 1 minute** (concurrency limits are 5–25 per app per org).
- **Credit budget:** each poll is 1 credit on COQL / 1 on list. Concurrency matters more than credit total.

### Polling Pattern

```
1. Store last_poll_ts = now()
2. Sleep {interval}
3. POST /crm/v8/coql with select Id, Modified_Time ... where Modified_Time > last_poll_ts
4. For each record, fetch full details if needed
5. Update last_poll_ts = now()
6. Goto 2
```

### Efficient Polling Tips

- Use COQL over the list endpoint when filtering — server-side filter saves credits on records you don't care about.
- Keep `fields=id,Modified_Time` lean on the detection query; fetch details only for records that changed.
- Batch detail fetches in one COQL by `Id in ('id1','id2',...)` — saves round-trips.

---

## Error Handling

### Standard Error Response Format

```json
{
  "code": "INVALID_DATA",
  "details": { "api_name": "Email", "expected_data_type": "string" },
  "message": "the given data is not valid",
  "status": "error"
}
```

**Error fields:**

| Field     | Type   | Always present? | Description                                                               |
| --------- | ------ | --------------- | ------------------------------------------------------------------------- |
| `code`    | string | yes             | Zoho error code constant (e.g. `INVALID_DATA`, `DUPLICATE_DATA`)          |
| `message` | string | yes             | Human-readable, user-safe                                                 |
| `status`  | string | yes             | `"error"`                                                                 |
| `details` | object | usually         | Per-code contents; for validation errors carries `api_name` + `json_path` |

### Validation Error Format

```json
{
  "code": "MANDATORY_NOT_FOUND",
  "details": { "api_name": "Last_Name", "json_path": "$.data[0].Last_Name" },
  "message": "required field not found",
  "status": "error"
}
```

For bulk writes, per-record validation errors come back inside the `data[]` array — status code on the outer response is 207 (or sometimes 200), and you must inspect each record's `status`/`code`.

### Recovery Playbook

| HTTP | Error codes                                                                                                          | Meaning                  | Retryable? | Recovery action                                                                      | Max retries |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------- | ------------------------------------------------------------------------------------ | ----------- |
| 200  | —                                                                                                                    | Success                  | —          | —                                                                                    |             |
| 204  | —                                                                                                                    | Empty result             | —          | Treat as zero results                                                                |             |
| 207  | mixed per-record                                                                                                     | Partial success          | per-record | Iterate `data[i]`; retry just the failed records                                     |             |
| 400  | `INVALID_MODULE`, `INVALID_DATA`, `INVALID_QUERY`, `REQUIRED_PARAM_MISSING`, `DUPLICATE_DATA`, `MANDATORY_NOT_FOUND` | Bad request              | No         | Fix per `details`                                                                    | 0           |
| 401  | `INVALID_TOKEN`, `AUTHENTICATION_FAILURE`                                                                            | Unauthorized             | Yes        | Refresh token via `/oauth/v2/token`; if refresh also 401 → re-consent flow           | 1           |
| 403  | `OAUTH_SCOPE_MISMATCH`, `NOT_ALLOWED`, `UNAPPROVED`                                                                  | Forbidden                | No         | Admin adds missing scope; user reconnects. For `NOT_ALLOWED`, check role permissions | 0           |
| 404  | `INVALID_URL_PATTERN`, `RESOURCE_NOT_FOUND`                                                                          | Not found                | No         | Verify module api_name and record id                                                 | 0           |
| 409  | `DUPLICATE_DATA`, `RECORD_LOCKED`                                                                                    | Conflict                 | Maybe      | Switch to `/upsert` with `duplicate_check_fields` OR fetch existing and update       | 1           |
| 413  | `REQUEST_ENTITY_TOO_LARGE`                                                                                           | Body too big             | No         | Split into batches of ≤100 records                                                   | 0           |
| 415  | `INVALID_MIME_TYPE`                                                                                                  | Wrong Content-Type       | No         | Set `Content-Type: application/json`                                                 | 0           |
| 422  | `MANDATORY_NOT_FOUND`, `INVALID_DATA`                                                                                | Validation failed        | No         | Pull `/settings/fields?module=X` and fix fields                                      | 0           |
| 429  | `TOO_MANY_REQUESTS`                                                                                                  | Rate/concurrency limited | Yes        | Honour `Retry-After`; exponential backoff with jitter                                | 3           |
| 500  | `INTERNAL_ERROR`                                                                                                     | Server error             | Yes        | Retry with backoff                                                                   | 3           |
| 502  | `BAD_GATEWAY`                                                                                                        | Gateway error            | Yes        | Retry after 5s                                                                       | 3           |
| 503  | `SERVICE_UNAVAILABLE`                                                                                                | Maintenance              | Yes        | Retry after `Retry-After` header                                                     | 3           |

### Rate Limit Details

**Credit model (24-hour rolling window):**

| Edition               | Base credits | Per user | Max limit |
| --------------------- | ------------ | -------- | --------- |
| Free                  | 5,000        | —        | 5,000     |
| Standard / Starter    | 50,000       | +250     | 100,000   |
| Professional          | 50,000       | +500     | 3,000,000 |
| Enterprise / Zoho One | 50,000       | +1,000   | 5,000,000 |
| Ultimate / CRM Plus   | 50,000       | +2,000   | unlimited |

Most calls = 1 credit. Convert Lead = 5. Merge records = 50. Bulk write initialise = 500.

**Concurrency (simultaneous calls per org per app):**

| Edition               | Concurrent | Heavy-ops sub-pool |
| --------------------- | ---------- | ------------------ |
| Free                  | 5          | 10 shared          |
| Standard / Starter    | 10         | 10 shared          |
| Professional          | 15         | 10 shared          |
| Enterprise / Zoho One | 20         | 10 shared          |
| Ultimate / CRM Plus   | 25         | 10 shared          |

Heavy ops (count against the 10-slot pool): Get Records with `cvid`, Convert Lead, bulk insert/update/upsert >10 records, Send Mail, Search, COQL, Composite APIs.

**Rate-limit headers:**

| Header                    | Meaning                                                           | Example   |
| ------------------------- | ----------------------------------------------------------------- | --------- |
| `X-API-CREDITS-REMAINING` | Remaining credits in 24h window (only appears once >50% consumed) | `"12345"` |

Standard `X-RATELIMIT-*` headers are NOT returned. Concurrency limits don't expose a header — you see 429 when you exceed.

**Rate-limit exceeded response:**

```json
{
  "code": "TOO_MANY_REQUESTS",
  "details": {},
  "message": "too many requests. please try again after some time",
  "status": "error"
}
```

Returns HTTP 429. `Retry-After` header may be present (seconds).

**Backoff strategy:**

1. Check `Retry-After` header first — honour it.
2. Otherwise: exponential backoff starting at 2s, doubling each retry, capped at 60s.
3. Add jitter (±50%) to avoid synchronised retry storms when multiple users hit 429 together.
4. After 3 failed retries, surface to the user.

### Error Code Reference

| Code                     | HTTP    | Meaning                                       | Common cause                                         | Fix                                                      |
| ------------------------ | ------- | --------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| `INVALID_TOKEN`          | 401     | Access token expired or revoked               | Token hit 1h lifetime                                | Refresh; if refresh also fails → re-consent              |
| `OAUTH_SCOPE_MISMATCH`   | 403     | Token lacks required scope                    | Admin didn't include scope at app registration       | Update app scopes; user reconnects                       |
| `INVALID_MODULE`         | 400     | Module api_name wrong or module disabled      | Typo (`leads` vs `Leads`); custom module not enabled | `GET /crm/v8/settings/modules` to verify                 |
| `REQUIRED_PARAM_MISSING` | 400     | `fields` missing on list endpoint             |                                                      | Pass `?fields=a,b,c`                                     |
| `MANDATORY_NOT_FOUND`    | 400/422 | Required field missing on create/update       |                                                      | `GET /crm/v8/settings/fields?module=X`                   |
| `DUPLICATE_DATA`         | 400/409 | Unique-constraint violation                   | Email already on another Lead/Contact                | Use `/upsert` with `duplicate_check_fields`              |
| `INVALID_DATA`           | 400/422 | Field type mismatch, bad format, bad picklist | Date string wrong; picklist case wrong               | Verify field type in `/settings/fields`                  |
| `INVALID_QUERY`          | 400     | Criteria syntax error                         | Unbalanced parens; wrong operator                    | Re-check criteria syntax                                 |
| `NOT_ALLOWED`            | 403     | User's role forbids the operation             | Salesperson trying to delete                         | Admin adjusts role permissions                           |
| `RESOURCE_NOT_FOUND`     | 404     | Record doesn't exist / was deleted            | Stale id; wrong module                               | Refetch; verify id                                       |
| `RECORD_LOCKED`          | 409     | Approval process has locked the record        | Record in approval flow                              | Wait for approval; inspect via UI                        |
| `TOO_MANY_REQUESTS`      | 429     | Credit/concurrency limit                      | Too many concurrent calls                            | Backoff + retry                                          |
| `INTERNAL_ERROR`         | 500     | Zoho server issue                             |                                                      | Retry with backoff; if persistent, check status.zoho.com |
| `SERVICE_UNAVAILABLE`    | 503     | Maintenance window                            |                                                      | Honour Retry-After                                       |

---

## Counter-Exceptions

Behaviours that differ from standard REST expectations.

1. **Partial success returns HTTP 207 OR 200 with per-record errors inside.**
   - Standard behaviour: all-or-nothing 200 / 400.
   - Actual: always iterate `data[i].status` regardless of outer HTTP code.

2. **Empty result returns HTTP 204 with no body, not 200 with `data: []`.**
   - Standard behaviour: empty array in body.
   - Actual: zero content. Treat 204 as zero results, don't try to parse.

3. **`INVALID_TOKEN` can mean wrong region, not expired token.**
   - Standard behaviour: 401 = auth expired.
   - Actual: a token issued at `accounts.zoho.com.au` sent to `www.zohoapis.com` (US host) returns 401 `INVALID_TOKEN`. Check the accounts host and API host match.

4. **Webhook `token` is the only verification.** No HMAC signature.
   - Standard behaviour: most providers sign with HMAC-SHA256.
   - Actual: Zoho echoes a plaintext shared secret. Anyone who learns your URL can spoof. Keep the token high-entropy (≥32 bytes random).

5. **Soft delete is always the default.** No `?hard=true` option.
   - Standard behaviour: DELETE usually means permanent.
   - Actual: records go to Recycle Bin for 60 days. Hard delete requires `DELETE /crm/v8/{Module}/deleted` (empties entire Recycle Bin).

6. **Rate-limit header only appears at >50% credits consumed.**
   - Standard behaviour: always-on counter like `X-RATELIMIT-REMAINING`.
   - Actual: silent until you're over halfway through your 24h budget. Don't rely on headers for pre-emptive throttling — honour `Retry-After` on 429.

---

## Output Formatting Guide

How the workspace agent should present Zoho CRM responses to users.

| Data type        | Format                   | Example                                                                              |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| Single record    | Key-value summary        | "**Jane Smith** at Acme — Lead Status: Contacted, Owner: Sarah (she@…)"              |
| Record list      | Markdown table           | Table with `Name`, `Company`, `Status`, `Owner`, `Modified`                          |
| Long text fields | Quoted block             | > Note content here                                                                  |
| Dates            | Human-readable           | "April 23, 2026 at 10:00 AM (AEST)"                                                  |
| Currency         | Org currency symbol      | "$45,000 AUD" (org-configured currency)                                              |
| Picklists        | Plain text               | "Negotiation/Review"                                                                 |
| User lookups     | Name + email             | "Sarah Owner (sarah@example.com)"                                                    |
| Errors           | Raw `message` + fix hint | "Zoho rejected: _required field not found_ (Last_Name). Retry with a Last_Name set?" |

**Truncation rules:**

- Lists: show first 10 records; mention total (`info.count` plus note about `more_records`).
- Long fields: truncate at 500 chars with "…" and offer to show more.
- Nested lookups: show 1 level deep (don't recursively fetch related lists unless asked).

---

_Generated from `00-api-investigation-questionnaire.md` Phases 7 and 8._

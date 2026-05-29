---
api_name: 'Connecteam (API Key)'
api_slug: 'connecteam-api'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Connecteam (API Key) -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Event-driven capabilities (webhooks, polling), error handling,
> rate limits, and recovery playbooks.
>
> **Shared API:** event/rate-limit/error behaviour is identical to the `connecteam-oauth` connector.
> The **only** auth-specific difference is the **401 recovery path**: there is no token to refresh — a 401
> means the `X-API-KEY` is missing/invalid/revoked, so the fix is to verify the stored key (re-mint in
> Connecteam Settings if needed), **not** retry. (The OAuth connector instead re-mints a 24h bearer token.)

---

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                                                      |
| ------------------------ | --------- | ---------------------------------------------------------- |
| Webhooks                 | Yes       | `POST /settings/v1/webhooks`; 5 feature types [DOCUMENTED] |
| WebSocket                | No        | [INFERRED]                                                 |
| Server-Sent Events (SSE) | No        | [INFERRED]                                                 |
| Long polling             | No        | (auto-assign poll is request-scoped, not an event stream)  |
| Change feeds / streams   | No        | Use `modifiedAt` epoch-second filters to poll [DOCUMENTED] |

---

## Webhooks

### Setup

- **Registration:** API (`POST /settings/v1/webhooks`) and the UI Integration Center. [DOCUMENTED]
- **URL requirement:** HTTPS endpoint. [DOCUMENTED]
- **Subscription shape:** `{ name, url, featureType, eventTypes[], objectId?, secretKey?, isDisabled? }`. [DOCUMENTED]
- **`objectId`:** required for every `featureType` **except `users`**. [DOCUMENTED]

```http
POST /settings/v1/webhooks
Host: api.connecteam.com
X-API-KEY: {api_token}
Content-Type: application/json

{
  "name": "Numa user sync",
  "url": "https://example.com/hooks/connecteam",
  "featureType": "users",
  "eventTypes": ["user_created", "user_updated", "user_archived"],
  "secretKey": "whsec_…"
}
```

**Webhook record response fields:** `id`, `name`, `userId`, `timeCreated`, `url`, `isDisabled`,
`featureType`, `objectId`, `retryLimit` (fixed 3), `eventTypes`. [DOCUMENTED]

### Event Catalog (by featureType)

| featureType       | Events                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `users`           | `user_created`, `user_updated`, `user_deleted`, `user_archived`, `user_promoted` (+ restored/demoted variants) |
| `time_activity`   | `clock_in`, `clock_out`, `admin_add`, `admin_edit`, `admin_approved_add_request`                               |
| `shift_scheduler` | `shift_created`, `shift_updated`, `shift_deleted`, `availability_status_created` (+ deleted)                   |
| `forms`           | `form_submission`, `form_submission_edited`, `manager_field_updated`                                           |
| `tasks`           | `task_published`, `task_completed`                                                                             |

[DOCUMENTED — catalog. The `featureType` value chosen on registration must match the events.]

### Payload Format

**[UNKNOWN]** — the exact webhook JSON body is not documented on the pages reviewed. Per-event payload
schemas live in the per-feature webhook docs (`/docs/*-webhook`) but were not captured. Assume the body
carries at minimum the event name, the affected entity id(s), and a timestamp, but do **not** hard-code
field names without verifying against a live delivery. [UNKNOWN]

### Verification / Security

- A `secretKey` supplied at registration is "for webhook signature verification." The exact signature
  **header name and algorithm are not documented.** [DOCUMENTED — mechanism exists; details UNKNOWN]
- Until the signature scheme is confirmed, treat receivers defensively: cross-reference the payload
  against the API (e.g. GET the referenced user/shift, remembering mixed id types) before acting on it.

### Reliability

- **Retry policy:** fixed `retryLimit` of **3** attempts. [DOCUMENTED]
- **Retry schedule / dead-letter / ordering / dedup guarantees:** [UNKNOWN] — assume duplicates and
  out-of-order delivery are possible.
- **Deduplication strategy:** key on event name + entity id + timestamp.

---

## Polling Fallback

> Use when webhooks aren't configured, or as a backup.

- **Endpoint:** any list endpoint with a `modifiedAt` (epoch-second) filter, e.g.
  `GET /users/v1/users?modifiedAt={epoch_s}&order=desc`. For shifts/time activities, re-query the relevant
  time window. [DOCUMENTED]
- **Change-detection field:** `modifiedAt` (Unix seconds) on users; timestamps on activities/shifts. [DOCUMENTED]
- **Recommended interval:** respect the per-account minute cap (Enterprise 200/min, Expert 100/min,
  SBP 5/min · 100/day — poll sparingly). For Expert+, every 1–5 minutes is fine. [DOCUMENTED]

### Polling Pattern

```
1. last_poll = current epoch seconds
2. wait N minutes (respecting the per-account cap)
3. GET /users/v1/users?modifiedAt={last_poll}&order=desc&limit=200   (paginate via offset)
4. process changed records
5. last_poll = current epoch seconds
6. goto 2
```

### Efficient Polling Tips

- Filter with `modifiedAt` to fetch only changed records. [DOCUMENTED]
- Set `limit` to the endpoint cap (users 500) to minimise calls. [DOCUMENTED]
- Stagger polling across resources — the minute/day budget is **shared across all keys/clients**. [DOCUMENTED]
- Watch `x-ratelimit-minute-remaining` (and `-day-remaining`); pause when either nears zero. [DOCUMENTED]

---

## Error Handling

### Standard Error Response Format

The success envelope is `{ requestId, data, paging? }`. The documented/community-observed error shape uses
a **`detail`** string field. A comprehensive per-status error table is **not published** — the docs defer
to the live API Reference. Confirm 401/403/422 bodies against live calls.

```json
{ "detail": "Too many requests" }
```

| Field     | Type   | Always Present? | Description                                  |
| --------- | ------ | --------------- | -------------------------------------------- |
| detail    | string | likely          | Human-readable error description             |
| requestId | string | maybe           | Correlation id (echo for support) [INFERRED] |

> A `422 Validation Error` is listed on per-endpoint pages; its exact body (single `detail` string vs a
> FastAPI-style `detail[]` array) is **[UNKNOWN]** — discovery needed.

### Recovery Playbook

| HTTP Status | Meaning          | Retryable? | Recovery Action                                                                                                                                           | Max Retries |
| ----------- | ---------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 200         | Success          | —          | —                                                                                                                                                         | —           |
| 400         | Bad request      | No         | Fix request parameters / body per `detail`                                                                                                                | 0           |
| 401         | Unauthorized     | No         | **`X-API-KEY` missing/invalid/revoked.** Verify the stored key; re-mint in Connecteam Settings if needed. No token to refresh — do **not** blindly retry. | 0           |
| 403         | Forbidden        | No         | Plan-gated: account below Expert, or feature not on plan (Forms = Enterprise-only).                                                                       | 0           |
| 404         | Not found        | No         | Verify the id (int vs UUID vs hex string) and the path module/version (V1 vs V2).                                                                         | 0           |
| 422         | Validation error | No         | Inspect `detail` and fix the offending field(s)                                                                                                           | 0           |
| 429         | Rate limited     | Yes        | Back off using `x-ratelimit-minute-reset` (UTC epoch s); **no `Retry-After`**                                                                             | 3           |
| 500/502/503 | Server error     | Yes        | Exponential backoff + jitter                                                                                                                              | 3           |

> **API-key note:** because the key is static and never expires, a 401 is almost always a **bad or revoked
> key**, not an expiry. The fix is human (re-check / re-mint the key), so surface it to the user rather than
> retrying. This is the one place behaviour differs from the OAuth connector (which re-mints a 24h token). [DOCUMENTED]

### Rate Limit Details

Limits are **per account** (shared by ALL keys/clients on that account — this connector + any other
integration), **not per key**. [DOCUMENTED]

| Plan       | Per-minute | Per-day | Notes                        |
| ---------- | ---------- | ------- | ---------------------------- |
| SBP        | 5          | 100     | Throttles almost immediately |
| Expert     | 100        | 10,000  | Minimum tier for API access  |
| Enterprise | 200        | 20,000  | Required for the Forms API   |

**Rate-limit headers** (six, read these to pace requests): [DOCUMENTED]

| Header                         | Meaning                    | Example      |
| ------------------------------ | -------------------------- | ------------ |
| `x-ratelimit-minute-limit`     | Minute quota               | `100`        |
| `x-ratelimit-minute-remaining` | Remaining this minute      | `87`         |
| `x-ratelimit-minute-reset`     | Minute reset (UTC epoch s) | `1745625660` |
| `x-ratelimit-day-limit`        | Daily quota                | `10000`      |
| `x-ratelimit-day-remaining`    | Remaining today            | `9213`       |
| `x-ratelimit-day-reset`        | Daily reset (UTC epoch s)  | `1745712000` |

**429 body:** `{ "detail": "Too many requests" }`. **`Retry-After` header:** **NOT documented** — compute
the wait from `x-ratelimit-minute-reset` instead. [DOCUMENTED]

> **Known quirk:** a community report notes the API sometimes returns **200 OK instead of 429** under
> certain conditions. Treat the `x-ratelimit-*-remaining` headers as the source of truth and throttle
> proactively. [DOCUMENTED — community report, not official]

**Backoff strategy:** exponential backoff starting ~1 s, max ~30 s, with jitter; monitor `x-ratelimit-*`
and pause proactively when `*-minute-remaining` (or `*-day-remaining`) is low. [DOCUMENTED]

---

## Async Operations

- **Shift auto-assign** is the only async pattern: `POST /scheduler/{v1|v2}/schedulers/{sid}/shifts_auto_assign`
  returns a `requestId`; poll `GET …/shifts_auto_assign/{requestId}` until `status` is terminal. [DOCUMENTED]

```json
{ "requestId": "asg_123", "status": "pending" }
```

Poll on a backoff (e.g. start 2 s, cap 15 s) and respect the per-account rate budget.

---

## File Handling

- **Attachments API:** two-step pre-signed flow — `POST /attachments/v1/files/generate_upload_url` → upload
  bytes to the returned URL → `PUT /attachments/v1/files/complete_upload/{fileId}`. Download via
  `POST /attachments/v1/files/download_url`; metadata via `GET /attachments/v1/files/{fileId}`. [DOCUMENTED]
- Also: user payslip upload (`POST /users/v1/users/{userId}/payslips`), shift attachments (read), assets
  metadata. [DOCUMENTED]
- Max file size / allowed types: **[UNKNOWN]**.

---

## Counter-Exceptions

> Behaviours that differ from common REST/auth conventions.

1. **Static, non-expiring credential.** Unlike OAuth, the API key never expires — a 401 means bad/revoked
   key (human fix), not expiry. There is no refresh and no token endpoint for this connector. [DOCUMENTED]
2. **Rate limits are per ACCOUNT, not per key.** Multiple keys/integrations share one minute/day budget. [DOCUMENTED]
3. **No rate-limit `Retry-After`.** Use `x-ratelimit-minute-reset` to time retries. [DOCUMENTED]
4. **API may return 200 instead of 429** when throttled — trust `x-ratelimit-*-remaining`. [DOCUMENTED — community]
5. **No total count in list responses.** "Fewer-than-limit" is the only last-page signal. [DOCUMENTED]
6. **`paging` lives in two places** — top-level (users) vs nested under `data` (jobs/shifts). [DOCUMENTED]
7. **Epoch seconds everywhere** (not ms, not ISO-8601), except time-activity `startDate`/`endDate` which are `YYYY-MM-DD`. [DOCUMENTED]
8. **Mixed id types** — int (users/clocks/schedulers), UUID (jobs), hex string (shifts). Never coerce. [DOCUMENTED]
9. **`/me` is unversioned/unprefixed** — the only such path; use it as the auth smoke test. [DOCUMENTED]

---

## Output Formatting Guide

> How to present Connecteam responses to the user in the workspace agent.

| Data Type       | Format              | Example                                                                       |
| --------------- | ------------------- | ----------------------------------------------------------------------------- |
| Single user     | Key-value summary   | "Omer Vered (owner) — +972 54 888 8888, user@example.com. Status: active"     |
| User list       | Markdown table      | Columns: Name, Type, Phone, Email, Status                                     |
| Time activity   | Human-readable      | "Shift: May 29, 9:00 AM – 5:00 PM (8h) for Omer Vered"                        |
| Timesheet       | Hours summary       | "Pay period: 38.5 regular + 2.0 overtime hours across 5 shifts"               |
| Shift           | Calendar-style      | "May 29, 9:00 AM – 5:00 PM — Auckland scheduler — Omer Vered (published)"     |
| Job             | Title + code        | "Delivery Driver (DD-001)"                                                    |
| Form submission | Status + key fields | "Vehicle check by Omer Vered, May 28 — manager status: approved"              |
| Timestamps      | Human-readable      | "May 29, 2026, 9:00 AM" (convert from epoch seconds; show the tenant's tz)    |
| Errors          | Clear message       | "Connecteam rejected the request: invalid API key — re-check the stored key." |

### Truncation Rules

- Lists: show first ~10 rows; note "showing 10 of N (paginate for more)" since no total is returned.
- Always convert epoch seconds to a human date/time before displaying — never show raw `1716969600`.
- Time activities / shifts: show duration in hours, not raw start/end epochs.
- Custom fields: show only when the user asks for them.
- Show ids as-is (int / UUID / hex) — never reformat or truncate them; they're needed for follow-up calls.

---

_Generated from the investigation questionnaire, Phases 7-8. Event/error behaviour shared with the
`connecteam-oauth` connector; the API-key 401-recovery path (verify key, no refresh) is connector-specific._

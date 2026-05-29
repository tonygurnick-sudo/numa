---
api_name: 'Connecteam API (OAuth)'
api_slug: 'connecteam-oauth'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Connecteam (OAuth) -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Event-driven capabilities (webhooks, polling), error handling,
> rate limits, and recovery playbooks.
>
> **Shared API:** event/error behaviour is identical to the `connecteam-api` (API-key) connector.
> The **only** OAuth-specific difference is the 401 recovery path: a 24-hour access token with **no
> refresh token**, so a 401 means "fetch a fresh token from the token endpoint and retry."

---

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                                                      |
| ------------------------ | --------- | ---------------------------------------------------------- |
| Webhooks                 | Yes       | `POST /settings/v1/webhooks`; 5 feature types [DOCUMENTED] |
| WebSocket                | No        | [INFERRED]                                                 |
| Server-Sent Events (SSE) | No        | [INFERRED]                                                 |
| Long polling             | No        | (auto-assign poll is request-scoped, not an event stream)  |
| Change feeds / streams   | No        | Use `modifiedAt` epoch-second filters to poll [INFERRED]   |

---

## Webhooks

### Setup

- **Registration:** API (`POST /settings/v1/webhooks`) and the UI Integration Center. [DOCUMENTED]
- **URL requirement:** HTTPS endpoint. [DOCUMENTED]
- **Subscription shape:** `{ name, url, feature, events[], secretKey, retryLimit }`. [DOCUMENTED]

```http
POST /settings/v1/webhooks
Host: api.connecteam.com
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "name": "Numa user sync",
  "url": "https://example.com/hooks/connecteam",
  "feature": "users",
  "events": ["user_created", "user_updated", "user_archived"],
  "secretKey": "whsec_…",
  "retryLimit": 3
}
```

### Event Catalog (by feature)

| Feature           | Events                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `users`           | `user_created`, `user_updated`, `user_deleted`, `user_archived`, `user_restored`, `user_promoted`, `user_demoted` |
| `time_activity`   | `clock_in`, `clock_out` (+ admin/approval variants)                                                               |
| `shift_scheduler` | `shift_created`, `shift_updated`, `shift_deleted`, `availability_status_created`, `availability_status_deleted`   |
| `forms`           | `form_submission`, `form_submission_edited`, `manager_field_updated`                                              |
| `tasks`           | `task_published`, `task_completed`                                                                                |

[DOCUMENTED — catalog. The `feature` value chosen on registration must match the events.]

### Payload Format

**[UNKNOWN]** — the exact webhook JSON body is not documented on the pages reviewed. Discovery against a
live delivery is needed. Assume it carries at minimum the event name, the affected entity id(s), and a
timestamp, but do **not** hard-code field names without verifying. [UNKNOWN]

### Verification / Security

- A `secretKey` supplied at registration is "for webhook signature verification." The exact signature
  **header name and algorithm are not documented.** [DOCUMENTED — mechanism exists; details UNKNOWN]
- Until the signature scheme is confirmed, treat receivers defensively: cross-reference the payload
  against the API (e.g. GET the referenced user/shift) before acting on it.

### Reliability

- **Retry policy:** fixed `retryLimit` of 3 attempts. [DOCUMENTED]
- **Ordering / dedup guarantees:** [UNKNOWN] — assume duplicates and out-of-order delivery are possible.
- **Deduplication strategy:** key on event name + entity id + timestamp.

---

## Polling Fallback

> Use when webhooks aren't configured, or as a backup.

- **Endpoint:** any list endpoint with a `modifiedAt` (epoch-second) filter, e.g.
  `GET /users/v1/users?modifiedAt={epoch_s}&order=desc`. [DOCUMENTED]
- **Change-detection field:** `modifiedAt` (Unix seconds). [DOCUMENTED]
- **Recommended interval:** respect the per-account minute cap (Enterprise 200/min, Expert 100/min,
  SBP 5/min). For typical sync, every few minutes. [DOCUMENTED]

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
- Set `limit` to the endpoint cap (users 500, form-subs 100) to minimise calls. [DOCUMENTED]
- Stagger polling across resources — the minute/day budget is **shared across all API clients**. [DOCUMENTED]
- Watch `x-ratelimit-minute-remaining`; pause when it nears zero. [DOCUMENTED]

---

## Error Handling

### Standard Error Response Format

**[INFERRED]** — no global error-schema page was found; per-endpoint pages list `422 Validation Error`,
and the portal uses FastAPI-style validation bodies. Confirm against a live 422.

```json
{
  "requestId": "req_8f3c1a",
  "statusCode": 422,
  "message": "Validation error",
  "detail": [{ "loc": ["body", "users", 0, "phoneNumber"], "msg": "field required", "type": "value_error.missing" }]
}
```

| Field      | Type    | Description                                                        |
| ---------- | ------- | ------------------------------------------------------------------ |
| requestId  | string  | Correlation id (echo for support) [INFERRED]                       |
| statusCode | integer | HTTP status mirrored in the body [INFERRED]                        |
| message    | string  | Human-readable summary [INFERRED]                                  |
| detail[]   | array   | FastAPI-style field errors: `loc` (path), `msg`, `type` [INFERRED] |

### Recovery Playbook

| HTTP Status | Meaning          | Retryable? | Recovery Action                                                                                                                                                                            | Max Retries |
| ----------- | ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 200         | Success          | -          | -                                                                                                                                                                                          | -           |
| 400         | Bad request      | No         | Fix request parameters / body                                                                                                                                                              | 0           |
| 401         | Unauthorized     | Yes        | **Token expired (24h, no refresh).** Re-fetch token from `POST /oauth/v1/token` (client_credentials, HTTP Basic), then retry. `connect_request` does this transparently — just retry once. | 1           |
| 403         | Forbidden        | No         | Missing OAuth scope (scopes are immutable — may need a new app), OR the account is below the Enterprise plan.                                                                              | 0           |
| 404         | Not found        | No         | Verify id / scheduler / formId; **for AU tenants confirm you're hitting `api-au.connecteam.com`**                                                                                          | 0           |
| 422         | Validation error | No         | Inspect `detail[]` and fix the offending field(s)                                                                                                                                          | 0           |
| 429         | Rate limited     | Yes        | Back off using `x-ratelimit-minute-reset` (UTC epoch s); no `Retry-After` header                                                                                                           | 3           |
| 500/502/503 | Server error     | Yes        | Exponential backoff + jitter                                                                                                                                                               | 3           |

> **OAuth note:** Because there is **no refresh token**, never try `grant_type=refresh_token`. On 401,
> the correct action is a fresh `client_credentials` token request, then retry the original call. [DOCUMENTED]

### Rate Limit Details

Limits are **per account** (shared by ALL API clients on that account — this connector + any other
integration), **not per token**. [DOCUMENTED]

| Plan       | Per-minute | Per-day | Notes                        |
| ---------- | ---------- | ------- | ---------------------------- |
| SBP        | 5          | 100     | Throttles almost immediately |
| Expert     | 100        | 10,000  |                              |
| Enterprise | 200        | 20,000  | Required to use the API      |

**Rate-limit headers** (read these to pace requests): [DOCUMENTED]

| Header                         | Meaning                    | Example      |
| ------------------------------ | -------------------------- | ------------ |
| `x-ratelimit-minute-limit`     | Minute quota               | `200`        |
| `x-ratelimit-minute-remaining` | Remaining this minute      | `188`        |
| `x-ratelimit-minute-reset`     | Minute reset (UTC epoch s) | `1716969660` |
| `x-ratelimit-day-limit`        | Daily quota                | `20000`      |
| `x-ratelimit-day-remaining`    | Remaining today            | `19992`      |
| `x-ratelimit-day-reset`        | Daily reset (UTC epoch s)  | `1717027200` |

**429 response body:** shape not published [UNKNOWN]. **`Retry-After` header:** not documented [UNKNOWN];
compute the wait from `x-ratelimit-minute-reset` instead.

**Backoff strategy:** exponential backoff starting ~1 s, max ~30 s, with jitter; monitor `x-ratelimit-*`
and pause proactively when `*-minute-remaining` is low. [DOCUMENTED]

---

## Async Operations

- **Shift auto-assign** is the only async pattern: `POST /scheduler/v1/schedulers/{sid}/shifts/auto-assign`
  returns a `requestId`; poll `GET …/auto-assign/{requestId}` until `status` is terminal. [DOCUMENTED]

```json
{ "requestId": "asg_123", "status": "pending" }
```

Poll on a backoff (e.g. start 2 s, cap 15 s) and respect the per-account rate budget.

---

## File Handling

- **Attachments module** exists with an `attachments.write` scope (in the registry). Upload endpoint paths
  are `[INFERRED]` (`/attachments/v1/...`). [DOCUMENTED — module/scope; INFERRED — paths]
- **Form-submission PDF retrieval** is referenced in the forum but the pattern is undocumented. [INFERRED]

---

## Counter-Exceptions

> Behaviours that differ from common REST/OAuth conventions.

1. **No refresh token.** Unlike most OAuth integrations, Connecteam's documented flow is `client_credentials`
   with a 24h token and no refresh — re-mint on expiry. [DOCUMENTED]
2. **Registry OAuth endpoints disagree with the official docs.** Registry has `app.connecteam.com/oauth/*`
   (redirect-style); official docs say `api.connecteam.com/oauth/v1/token` (client_credentials, HTTP Basic).
   Treat the registry endpoints as unverified until reconciled. [DOCUMENTED]
3. **Rate limits are per ACCOUNT, not per token/key.** Multiple integrations share one budget. [DOCUMENTED]
4. **No rate-limit `Retry-After`.** Use `x-ratelimit-minute-reset` to time retries. [UNKNOWN/DOCUMENTED]
5. **No total count in list responses.** "Fewer-than-limit" is the only last-page signal. [DOCUMENTED]
6. **Epoch seconds everywhere** (not ms, not ISO-8601). [DOCUMENTED]
7. **AU data residency uses a separate host.** `api-au.connecteam.com` for AU tenants. [DOCUMENTED]

---

## Output Formatting Guide

> How to present Connecteam responses to the user in the workspace agent.

| Data Type       | Format              | Example                                                                     |
| --------------- | ------------------- | --------------------------------------------------------------------------- |
| Single user     | Key-value summary   | "Jane Doe (user) — +1 415 555 0101, jane@acme.com. Status: active"          |
| User list       | Markdown table      | Columns: Name, Type, Phone, Email, Status                                   |
| Time activity   | Human-readable      | "Shift: May 29, 9:00 AM – 5:00 PM (8h) for Jane Doe"                        |
| Timesheet       | Hours summary       | "Pay period: 38.5 regular + 2.0 overtime hours across 5 shifts"             |
| Shift           | Calendar-style      | "May 29, 9:00 AM – 5:00 PM — Auckland scheduler — Jane Doe (published)"     |
| Form submission | Status + key fields | "Vehicle check by Jane Doe, May 28 — manager status: approved"              |
| Timestamps      | Human-readable      | "May 29, 2026, 9:00 AM" (convert from epoch seconds; show the tenant's tz)  |
| Errors          | Clear message       | "Couldn't find scheduler #321. Verify the id (AU tenants use api-au host)." |

### Truncation Rules

- Lists: show first ~10 rows; note "showing 10 of N (paginate for more)" since no total is returned.
- Always convert epoch seconds to a human date/time before displaying — never show raw `1716969600`.
- Time activities / shifts: show duration in hours, not raw start/end epochs.
- Custom fields: show only when the user asks for them.

---

_Generated from the investigation questionnaire, Phases 7-8. Event/error behaviour shared with the
`connecteam-api` connector; OAuth 401-recovery and token model are connector-specific._

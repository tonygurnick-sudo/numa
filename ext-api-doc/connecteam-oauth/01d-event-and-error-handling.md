---
api_name: Connecteam API (OAuth)
api_slug: connecteam-oauth
base_url: https://api.connecteam.com
path_version_segment: per-module (/users/v1, …); NO global /v1
timestamps: Unix epoch SECONDS
call_surface: HTTP via `numa integrations request`
confidence: facts [DOCUMENTED] unless tagged [INFERRED]/[UNKNOWN]
shared_api: event/error behaviour identical to connecteam-api (API-key). OAuth-specific difference: 24h token, NO refresh token → 401 = re-fetch a fresh token and retry.
companion_to: 01-llm-api-rules.md
---

# Connecteam (OAuth) — Event & Error Handling Reference

Webhooks, polling, error handling, rate limits, recovery playbooks.

## Event-Driven Capabilities

| Mechanism              | Supported | Notes                                                     |
| ---------------------- | --------- | --------------------------------------------------------- |
| Webhooks               | Yes       | `POST /settings/v1/webhooks`; 5 feature types             |
| WebSocket              | No        | [INFERRED]                                                |
| Server-Sent Events     | No        | [INFERRED]                                                |
| Long polling           | No        | (auto-assign poll is request-scoped, not an event stream) |
| Change feeds / streams | No        | Use `modifiedAt` epoch-second filters to poll [INFERRED]  |

## Webhooks

**Registration:** API (`POST /settings/v1/webhooks`) and the UI Integration Center. URL must be HTTPS. Subscription shape `{name,url,feature,events[],secretKey,retryLimit}`:
`POST /settings/v1/webhooks` body `{"name":"Numa user sync","url":"https://example.com/hooks/connecteam","feature":"users","events":["user_created","user_updated","user_archived"],"secretKey":"whsec_…","retryLimit":3}`

**Event catalog (by feature):** the `feature` value on registration must match the events.
| Feature | Events |
| --- | --- |
| `users` | `user_created`, `user_updated`, `user_deleted`, `user_archived`, `user_restored`, `user_promoted`, `user_demoted` |
| `time_activity` | `clock_in`, `clock_out` (+admin/approval variants) |
| `shift_scheduler` | `shift_created`, `shift_updated`, `shift_deleted`, `availability_status_created`, `availability_status_deleted` |
| `forms` | `form_submission`, `form_submission_edited`, `manager_field_updated` |
| `tasks` | `task_published`, `task_completed` |

**Payload format: [UNKNOWN]** — not documented; discovery against a live delivery needed. Assume it carries at minimum the event name, affected entity id(s), and a timestamp, but do **not** hard-code field names without verifying.

**Verification:** `secretKey` is "for webhook signature verification" — exact header name and algorithm **not documented** [mechanism DOCUMENTED; details UNKNOWN]. Until confirmed, treat receivers defensively: cross-reference the payload against the API (e.g. GET the referenced user/shift) before acting.

**Reliability:** fixed `retryLimit` of 3 attempts. Ordering/dedup guarantees [UNKNOWN] — assume duplicates and out-of-order delivery; dedup on event name + entity id + timestamp.

## Polling Fallback

Use when webhooks aren't configured, or as a backup.

- **Endpoint:** any list endpoint with a `modifiedAt` (epoch-second) filter, e.g. `GET /users/v1/users?modifiedAt={epoch_s}&order=desc`.
- **Change-detection field:** `modifiedAt` (Unix seconds).
- **Interval:** respect the per-account minute cap (Enterprise 200/min, Expert 100/min, SBP 5/min). For typical sync, every few minutes.

**Pattern:**

```
1. last_poll = current epoch seconds
2. wait N minutes (respecting the per-account cap)
3. GET /users/v1/users?modifiedAt={last_poll}&order=desc&limit=200   (paginate via offset)
4. process changed records
5. last_poll = current epoch seconds
6. goto 2
```

**Tips:** filter with `modifiedAt` to fetch only changed records; set `limit` to the endpoint cap (users 500, form-subs 100); stagger polling across resources (minute/day budget is **shared across all API clients**); watch `x-ratelimit-minute-remaining` and pause when it nears zero.

## Error Handling

**Standard error format** [INFERRED — no global error-schema page found; per-endpoint pages list `422 Validation Error`; portal uses FastAPI-style bodies. Confirm against a live 422]:
`{"requestId":"req_8f3c1a","statusCode":422,"message":"Validation error","detail":[{"loc":["body","users",0,"phoneNumber"],"msg":"field required","type":"value_error.missing"}]}`

| Field      | Type    | Description                                                        |
| ---------- | ------- | ------------------------------------------------------------------ |
| requestId  | string  | Correlation id (echo for support) [INFERRED]                       |
| statusCode | integer | HTTP status mirrored in body [INFERRED]                            |
| message    | string  | Human-readable summary [INFERRED]                                  |
| detail[]   | array   | FastAPI-style field errors: `loc` (path), `msg`, `type` [INFERRED] |

**Recovery Playbook:**
| Status | Meaning | Retryable? | Recovery Action | Max Retries |
| --- | --- | --- | --- | --- |
| 200 | Success | — | — | — |
| 400 | Bad request | No | Fix request parameters / body | 0 |
| 401 | Unauthorized | Yes | **Token expired (24h, no refresh).** Re-fetch from `POST /oauth/v1/token` (client_credentials, HTTP Basic), then retry. `connect_request` does this transparently — just retry once. | 1 |
| 403 | Forbidden | No | Missing OAuth scope (immutable — may need a new app), OR account below the Enterprise plan | 0 |
| 404 | Not found | No | Verify id / scheduler / formId; **for AU tenants confirm `api-au.connecteam.com`** | 0 |
| 422 | Validation error | No | Inspect `detail[]` and fix the offending field(s) | 0 |
| 429 | Rate limited | Yes | Back off using `x-ratelimit-minute-reset` (UTC epoch s); no `Retry-After` header | 3 |
| 500/502/503 | Server error | Yes | Exponential backoff + jitter | 3 |

> **OAuth note:** there is **no refresh token** — never try `grant_type=refresh_token`. On 401, do a fresh `client_credentials` token request, then retry.

### Rate Limit Details

Limits are **per account** (shared by ALL API clients on that account — this connector + any other integration), **not per token**.
| Plan | Per-minute | Per-day | Notes |
| --- | --- | --- | --- |
| SBP | 5 | 100 | Throttles almost immediately |
| Expert | 100 | 10,000 | — |
| Enterprise | 200 | 20,000 | Required to use the API |

**Headers** (read to pace requests):
| Header | Meaning | Example |
| --- | --- | --- |
| `x-ratelimit-minute-limit` | Minute quota | `200` |
| `x-ratelimit-minute-remaining` | Remaining this minute | `188` |
| `x-ratelimit-minute-reset` | Minute reset (UTC epoch s) | `1716969660` |
| `x-ratelimit-day-limit` | Daily quota | `20000` |
| `x-ratelimit-day-remaining` | Remaining today | `19992` |
| `x-ratelimit-day-reset` | Daily reset (UTC epoch s) | `1717027200` |

**429 response body:** shape not published [UNKNOWN]. **`Retry-After` header:** not documented [UNKNOWN] — compute the wait from `x-ratelimit-minute-reset`. **Backoff:** exponential starting ~1s, max ~30s, with jitter; pause proactively when `*-minute-remaining` is low.

## Async Operations

**Shift auto-assign** is the only async pattern: `POST /scheduler/v1/schedulers/{sid}/shifts/auto-assign` returns a `requestId`; poll `GET …/auto-assign/{requestId}` until `status` is terminal:
`{"requestId":"asg_123","status":"pending"}`
Poll on backoff (e.g. start 2s, cap 15s); respect the per-account rate budget.

## File Handling

- **Attachments module** exists with an `attachments.write` scope (registry). Upload paths `/attachments/v1/...` [INFERRED — module/scope DOCUMENTED; paths INFERRED].
- **Form-submission PDF retrieval** referenced in the forum but undocumented [INFERRED].

## Counter-Exceptions (differ from common REST/OAuth conventions)

1. **No refresh token.** Documented flow is `client_credentials` with a 24h token — re-mint on expiry.
2. **Registry OAuth endpoints disagree with official docs.** Registry has `app.connecteam.com/oauth/*` (redirect-style); official docs say `api.connecteam.com/oauth/v1/token` (client_credentials, HTTP Basic). Treat registry endpoints as unverified until reconciled.
3. **Rate limits are per ACCOUNT, not per token/key.** Multiple integrations share one budget.
4. **No rate-limit `Retry-After`.** Use `x-ratelimit-minute-reset`.
5. **No total count in list responses.** "Fewer-than-limit" is the only last-page signal.
6. **Epoch seconds everywhere** (not ms, not ISO-8601).
7. **AU data residency uses a separate host** (`api-au.connecteam.com`).

## Output Formatting Guide

How to present Connecteam responses to the user:
| Data Type | Format | Example |
| --- | --- | --- |
| Single user | Key-value summary | "Jane Doe (user) — +1 415 555 0101, jane@acme.com. Status: active" |
| User list | Markdown table | Columns: Name, Type, Phone, Email, Status |
| Time activity | Human-readable | "Shift: May 29, 9:00 AM – 5:00 PM (8h) for Jane Doe" |
| Timesheet | Hours summary | "Pay period: 38.5 regular + 2.0 overtime hours across 5 shifts" |
| Shift | Calendar-style | "May 29, 9:00 AM – 5:00 PM — Auckland scheduler — Jane Doe (published)" |
| Form submission | Status + key fields | "Vehicle check by Jane Doe, May 28 — manager status: approved" |
| Timestamps | Human-readable | "May 29, 2026, 9:00 AM" (convert from epoch seconds; show tenant's tz) |
| Errors | Clear message | "Couldn't find scheduler #321. Verify the id (AU tenants use api-au host)." |

**Truncation rules:** lists show first ~10 rows, note "showing 10 of N (paginate for more)" since no total is returned; always convert epoch seconds to a human date/time (never show raw `1716969600`); time activities/shifts show duration in hours, not raw epochs; custom fields only when asked.

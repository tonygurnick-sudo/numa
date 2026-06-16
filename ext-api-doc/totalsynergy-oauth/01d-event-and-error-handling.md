---
api_name: Total Synergy (OAuth)
api_slug: totalsynergy-oauth
companion_to: 01-llm-api-rules.md
scope: events (none), error handling, the daily rate budget
same_operational_model_as: totalsynergy-api (only credential differs)
---

# Total Synergy (OAuth) — Event & Error Handling Reference

## Events — NONE

| Mechanism              | Supported                  | Confidence |
| ---------------------- | -------------------------- | ---------- |
| Webhooks               | **No** (none in portal/KB) | [INFERRED] |
| WebSocket              | No                         | [INFERRED] |
| Server-Sent Events     | No                         | [INFERRED] |
| Long polling           | No                         | [INFERRED] |
| Change feeds / streams | No                         | [INFERRED] |

No push mechanism exists — don't look for a `webhooks`/`resthooks` resource. Change detection is **polling-only**, and the daily cap makes polling expensive (unlike peers, e.g. Actionstep has RestHooks).

## Polling fallback

- **Endpoint:** page a list resource (`GET Organisation/{Slug}/{Resource}?criteria.pagesize=1000`).
- **Change-detection field:** which field reliably exposes "modified since" is **🔬 NOT DOCUMENTED** — candidates are `modifiedDate`/`updatedDate` or an `*AsInt` timestamp; confirm on a live tenant. Until then, diff against a stored snapshot.
- **Interval — MUST be low frequency.** With 300 calls/day standard, a 5-minute poll = 288 calls/day, nearly exhausting the budget. Realistically poll **once or a few times per day** unless the tenant has the Premium add-on (60k/day) [DOCUMENTED limits / INFERRED strategy].
- **Never poll Transactions on a schedule** — its 50/day cap is far too small.

Pattern:

```
1. store last_snapshot (ids + a change field, if one exists)
2. wait (hours, not minutes — budget-bound)
3. GET Organisation/{Slug}/{Resource}?criteria.pagesize=1000   (page if totalItems > 1000)
4. diff vs last_snapshot → emit changes
5. store new snapshot; goto 2
```

Tips: always use `criteria.pagesize=1000`; prefer targeted `criteria.Id` over a full scan; cache aggressively within a session.

## Error handling

**Error-body format is NOT PUBLISHED** [UNKNOWN] 🔬. All responses are JSON, but code/message/details schema is undocumented. **Do not fabricate it** — surface the raw body + HTTP status, and **detect failure by HTTP status, not by parsing a guessed envelope**. Discover the real shape by triggering errors on a live tenant.

```json
// shape unknown — placeholder ONLY, do not rely on these keys
{ "message": "…", "code": "…" } /* 🔬 actual schema unconfirmed */
```

| Status  | Meaning            | Retryable     | Recovery                                                                         | Max retries |
| ------- | ------------------ | ------------- | -------------------------------------------------------------------------------- | ----------- |
| 200     | OK (JSON body)     | —             | —                                                                                | —           |
| 400     | Bad request        | No            | fix `criteria.*` params or body fields (likely wrong field name)                 | 0           |
| 401     | Unauthorized       | Yes           | check the `access-token` header (not `Authorization`); refresh token, retry once | 1           |
| 404     | Not found          | No            | verify the org `{Slug}` and the resource id                                      | 0           |
| 429 (?) | Rate limit (daily) | No (same day) | STOP — budget resets next day, not in seconds; suggest Premium add-on            | 0           |
| 5xx     | Server error       | Yes           | exponential backoff, sparingly (each retry spends budget)                        | 2–3         |

- **Most common 401:** token sent in `Authorization: Bearer` instead of the `access-token` header, or expired/missing token [DOCUMENTED]. It's a header issue, not a permissions one.
- **429 unconfirmed** — limit may surface as 429 or a bespoke status; `Retry-After` may or may not be sent 🔬. Window is **daily**, so retrying within the same day is futile.

## Rate limits

| Scope                       | Limit  | Window | Confidence   |
| --------------------------- | ------ | ------ | ------------ |
| All API calls (standard)    | 300    | / day  | [DOCUMENTED] |
| Transactions API (standard) | 50     | / day  | [DOCUMENTED] |
| All API calls (Premium)     | 60,000 | / day  | [DOCUMENTED] |
| Transactions API (Premium)  | 20,000 | / day  | [DOCUMENTED] |

- Per organisation; raised via the "Premium API" add-on on the Subscription page [DOCUMENTED].
- Rate-limit headers (`X-RateLimit-*` / `Retry-After`) + exact 429 body: **not documented — do not assume they exist** 🔬.
- Limits are **daily, not per-second** → mitigation is **call frugality + caching**, not tight retry loops. Serialise work; never fan out [INFERRED]. The usual "back off a few seconds and retry" reflex is wrong here.

## Idempotency

- **GET** is naturally idempotent.
- **POST to `…/Transactions` is NOT idempotent** — no documented idempotency key. A retried timesheet/invoice POST risks a **duplicate financial record** AND burns the tight budget. Track created `timesheetId`s client-side; on timeout, re-read before retrying [INFERRED] 🔬.

## Output formatting

| Data type            | Format            | Example                                                                 |
| -------------------- | ----------------- | ----------------------------------------------------------------------- |
| Single project       | key-value summary | "Riverside Bridge Upgrade — Active — client Acme City Council"          |
| Project/contact list | markdown table    | id · name · status (note `totalItems` total)                            |
| Timesheet entries    | table + total     | rows + summed `units`                                                   |
| Currency             | localized         | "$1,500.00"                                                             |
| Errors               | clear message     | "Couldn't reach Total Synergy (HTTP 401). Likely a token/header issue." |

Truncation: show first ~20 rows, note the `totalItems` total — **do not auto-page the rest** (budget). Re-fetch by `criteria.Id` rather than re-scanning. **Always warn the user before any write to `Transactions`** (financial + scarce budget).

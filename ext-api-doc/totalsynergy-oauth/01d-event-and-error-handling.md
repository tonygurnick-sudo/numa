---
api_name: 'Total Synergy (OAuth)'
api_slug: 'totalsynergy-oauth'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Total Synergy (OAuth) — Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Events (none), error handling, and the all-important
> **daily rate budget**.
>
> 📌 **Same operational model as `totalsynergy-api`** — only the credential differs.

---

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                               | Confidence |
| ------------------------ | --------- | ----------------------------------- | ---------- |
| Webhooks                 | **No**    | None found in developer portal / KB | [INFERRED] |
| WebSocket                | No        | —                                   | [INFERRED] |
| Server-Sent Events (SSE) | No        | —                                   | [INFERRED] |
| Long polling             | No        | —                                   | [INFERRED] |
| Change feeds / streams   | No        | —                                   | [INFERRED] |

**There is no push mechanism.** Change detection is **polling-only** — and the daily rate cap makes
polling expensive. This is a key difference from peers (e.g. Actionstep has RestHooks; Total
Synergy has nothing).

---

## Polling Fallback

When you must detect changes:

- **Endpoint:** page a list resource (`GET …/Organisation/{Slug}/{Resource}?criteria.pagesize=1000`).
- **Change-detection field:** which field reliably exposes "modified since" is **🔬 NOT DOCUMENTED** —
  candidates are a `modifiedDate`/`updatedDate` or an `*AsInt` timestamp; confirm on a live tenant.
  Until then, diff against a stored snapshot.
- **Interval — MUST be low frequency.** With **300 calls/day** (standard), a 5-minute poll = 288
  calls/day, which alone nearly exhausts the budget. Realistically poll **once or a few times per
  day** unless the tenant has the Premium API add-on (60k/day). `[DOCUMENTED limits / INFERRED strategy]`

### Polling Pattern

```
1. store last_snapshot (ids + a change field, if one exists)
2. wait (hours, not minutes — budget-bound)
3. GET …/Organisation/{Slug}/{Resource}?criteria.pagesize=1000   (page if totalItems > 1000)
4. diff vs last_snapshot → emit changes
5. store new snapshot; goto 2
```

### Efficient Polling Tips

- **Minimise pages:** always use `criteria.pagesize=1000`.
- **Prefer targeted reads:** if you know an id, `criteria.Id` is far cheaper than a full scan.
- **Cache aggressively** within a session — re-reads spend budget for no new information.
- **Never poll Transactions on a schedule** — its 50/day cap is far too small.

---

## Error Handling

### Standard Error Response Format

> **NOT PUBLISHED.** `[UNKNOWN]` 🔬 All responses are JSON, but the error-body schema
> (code / message / details) is undocumented. **Do not fabricate it.** Surface the raw response
> body and HTTP status to the user, and discover the real shape by triggering errors on a live
> tenant.

```json
// shape unknown — example placeholder ONLY, do not rely on these keys
{ "message": "…", "code": "…" } /* 🔬 actual schema unconfirmed */
```

**Error fields:** unknown — none can be asserted. 🔬

### Recovery Playbook

| HTTP Status | Meaning            | Retryable?        | Recovery Action                                                                       | Max Retries |
| ----------- | ------------------ | ----------------- | ------------------------------------------------------------------------------------- | ----------- |
| 200         | OK (JSON body)     | —                 | —                                                                                     | —           |
| 400         | Bad request        | No                | Fix `criteria.*` params or body fields (likely wrong field name)                      | 0           |
| 401         | Unauthorized       | Yes               | **Check the `access-token` header** (not `Authorization`); refresh token, retry once  | 1           |
| 404         | Not found          | No                | Verify the org `{Slug}` and the resource id                                           | 0           |
| 429 (?)     | Rate limit (daily) | **No (same day)** | Stop calling — the budget resets **next day**, not in seconds; suggest Premium add-on | 0           |
| 5xx         | Server error       | Yes               | Exponential backoff — but **sparingly** (each retry spends budget)                    | 2–3         |

- **Most common 401:** token sent in `Authorization: Bearer` instead of the `access-token` header,
  or expired/missing token. `[DOCUMENTED]`
- **429 status is unconfirmed** — the limit may surface as 429 or a bespoke status; `Retry-After`
  may or may not be sent. 🔬 Because the window is **daily**, retrying within the same day is futile.

### Rate Limit Details

| Scope                       | Limit  | Window | Confidence   |
| --------------------------- | ------ | ------ | ------------ |
| All API calls (standard)    | 300    | / day  | [DOCUMENTED] |
| Transactions API (standard) | 50     | / day  | [DOCUMENTED] |
| All API calls (Premium)     | 60,000 | / day  | [DOCUMENTED] |
| Transactions API (Premium)  | 20,000 | / day  | [DOCUMENTED] |

- Limits are **per organisation**, raised via the Subscription page ("Premium API" add-on). `[DOCUMENTED]`
- **Rate-limit headers / exact 429 body:** not documented. 🔬
- **Backoff strategy:** because the budget is **daily, not per-second**, the practical mitigation is
  **call frugality + caching**, not tight retry loops. Serialise work; never fan out. `[INFERRED]`

**Rate-limit headers:** unknown — do not assume `X-RateLimit-*` / `Retry-After` exist. 🔬

---

## Idempotency

- **GET** is naturally idempotent.
- **POST to `…/Transactions` is NOT idempotent** — no documented idempotency key. A retried
  timesheet/invoice POST risks a **duplicate financial record** _and_ burns the tight Transaction
  budget. **Track created `timesheetId`s client-side; on timeout, re-read before retrying.** `[INFERRED]` 🔬

---

## Counter-Exceptions

1. **No push, no webhooks** — unlike many peers, there is nothing to subscribe to. Don't look for a
   `webhooks`/`resthooks` resource; it doesn't exist. Polling is the only option, and it's budget-bound.
2. **Limits are daily, not per-second** — the usual "back off a few seconds and retry" reflex is
   wrong here. Once the daily cap is hit, you are blocked until the window rolls over.
3. **Auth header is custom** — `access-token`, not `Authorization: Bearer`. A 401 is most often this,
   not a permissions issue.
4. **Error body shape is unknown** — detect failure by **HTTP status**, not by parsing a guessed
   error envelope.

---

## Output Formatting Guide

| Data Type            | Format            | Example                                                                 |
| -------------------- | ----------------- | ----------------------------------------------------------------------- |
| Single project       | Key-value summary | "Riverside Bridge Upgrade — Active — client Acme City Council"          |
| Project/contact list | Markdown table    | id · name · status (note `totalItems` total)                            |
| Timesheet entries    | Table + total     | rows + summed `units`                                                   |
| Currency             | Localized         | "$1,500.00"                                                             |
| Errors               | Clear message     | "Couldn't reach Total Synergy (HTTP 401). Likely a token/header issue." |

### Truncation Rules

- Lists: show first ~20 rows, note the `totalItems` total — **do not auto-page the rest** (budget).
- Re-fetch by `criteria.Id` rather than re-scanning a whole resource.
- **Always warn the user before any write to `Transactions`** (financial + scarce budget).

---

_Generated from the investigation questionnaire, Phases 7–8._

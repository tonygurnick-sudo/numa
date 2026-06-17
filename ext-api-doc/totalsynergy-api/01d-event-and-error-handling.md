---
api_name: Total Synergy (API Key)
api_slug: totalsynergy-api
companion_to: 01-llm-api-rules.md
sibling: totalsynergy-oauth — same operational model (no webhooks, same per-org daily limits, same error model); credential differs (static key → 401 recovery is regenerate, not refresh).
confidence: rate-limit COUNTS are [DOCUMENTED]. The 429 status/headers/Retry-After behaviour and the error-body schema are [UNKNOWN]/[INFERRED] (not published, NO live call made). 🔬 = confirm by triggering real errors on a live tenant. Do NOT fabricate the error body — surface the raw response.
---

# Total Synergy (API Key) — Event & Error Handling Reference

No webhooks (polling only), error handling, the daily rate budget, recovery playbooks.

## Event-driven capabilities

**No push/event mechanism** — no Webhooks, WebSocket, SSE, or change feeds (none found in portal/KB) [INFERRED]. All change detection is **polling-only**.

## Polling fallback

The only way to detect changes. The **daily** rate cap makes polling **low-frequency** (Premium tenants excepted).

- Poll a list endpoint (`GET …/Organisation/{Slug}/{Resource}?criteria.pagesize=1000`) and **diff** against the previous snapshot on a date/modified field.
- **Which field reliably exposes "modified since" is 🔬 DISCOVER** — `createdDate` exists, but a `lastModified`/`modifiedDate` equivalent is unconfirmed. Until confirmed, diff on whatever date field the resource exposes; accept that updates without a timestamp bump are missed.

**Polling budget (the hard constraint):** standard = **300 calls/day total** (50/day Transactions), per organisation.

| Cadence      | Calls/day (1 resource) | Verdict (standard tier)                 |
| ------------ | ---------------------- | --------------------------------------- |
| Every minute | ~1,440                 | ❌ Impossible — 5× over the daily cap   |
| Every 30 min | ~48                    | ⚠️ Eats ~16% of budget for one resource |
| Every hour   | ~24                    | ✅ Sustainable for a few resources      |
| 2–4×/day     | 2–4                    | ✅ Recommended for standard tenants     |

- Multiply by **page count** for large resources (each page is a call).
- Reserve budget for user-initiated reads/writes — don't spend all 300 on polling.
- Premium (60k/day) makes minute-level polling feasible; standard does not.

**Polling pattern:** 1) resolve + cache `{Slug}` once; 2) snapshot the resource (`?criteria.pagesize=1000`), store ids + date fields; 3) wait the interval (hours for standard, not minutes); 4) re-fetch, diff, surface changes; 5) update snapshot; repeat.

## Error handling

**Error-body shape is NOT published** (`[UNKNOWN]` 🔬). All responses are JSON, but the shape (code/message/details) is unknown. **Do NOT fabricate it** — surface the raw response body + HTTP status, and proceed by status code. (Placeholder for illustration only, do NOT assume real: `{ "message": "<server-provided>", ... }` 🔬.)

### Recovery playbook

| Status  | Meaning            | Retryable?    | Recovery                                                                   | Confidence    |
| ------- | ------------------ | ------------- | -------------------------------------------------------------------------- | ------------- |
| 200     | OK (JSON body)     | —             | —                                                                          | [DOCUMENTED]  |
| 400     | Bad request        | No            | Fix params (`criteria.*`) or write-body fields                             | [INFERRED]    |
| 401     | Unauthorized       | No\*          | Static key missing/expired/wrong header — see 401 deep-dive                | [DOCUMENTED]  |
| 404     | Not found          | No            | Verify the org `{Slug}` and the resource id                                | [DOCUMENTED]  |
| 429 (?) | Rate limit (daily) | No (same day) | Stop calling — daily window won't reset until tomorrow; suggest Premium 🔬 | [INFERRED] 🔬 |
| 500     | Internal error     | Yes           | Exponential backoff — **sparingly**, each retry costs budget               | [DOCUMENTED]  |

\*Unlike the OAuth connector, a 401 here is **not** fixable by refreshing — there is no refresh flow. [DOCUMENTED]

### 401 deep-dive (static-key specifics)

A 401 almost always means one of:

1. **Wrong header** — key sent as `Authorization: Bearer` or `X-API-Key` instead of the required **`access-token`**. #1 cause. [DOCUMENTED]
2. **Expired key** — past its **1-year or 3-year** life. [DOCUMENTED]
3. **Revoked key** — the user regenerated the key in their profile, invalidating the old one. [INFERRED] 🔬
4. **Missing key** — the connector didn't inject the credential.

**Recovery:** no programmatic refresh. The user must go to Synergy → Profile settings → ellipsis (⋯) → API Key, generate a **new** key, and re-paste it into Numa. Tell the user this explicitly rather than retrying. [DOCUMENTED]

### 404 notes

- Most 404s mean a **wrong `{Slug}`** or wrong resource id — re-resolve via `…/Organisation/MySlug` and verify the id. [DOCUMENTED]
- A 404 can also mean you hit the **registry `instance_url`** (a `*.totalsynergy.com` subdomain) instead of `api.totalsynergy.com`. Confirm the host. [DOCUMENTED] 🚩

## Rate limits

| Scope                       | Limit  | Window |
| --------------------------- | ------ | ------ |
| All API calls (standard)    | 300    | / day  |
| Transactions API (standard) | 50     | / day  |
| All API calls (Premium)     | 60,000 | / day  |
| Transactions API (Premium)  | 20,000 | / day  |

- **Per organisation, daily window**, set/raised via the Subscription page ("Premium API" add-on). Multiple static keys for the same org **share one budget**. [DOCUMENTED]
- **Headers / exact 429 body not documented** 🔬 — whether the limit surfaces as `429` (vs a bespoke status) and whether `Retry-After` is sent are unconfirmed.
- **Backoff:** because the budget is **daily, not per-second**, mitigation is **call frugality + caching**, NOT tight retry loops. Retrying within the same day after a rate-limit error is **futile** — the window won't reset until next day. [INFERRED]

**Budget management:** track your own per-session call count and warn the user as you approach a meaningful fraction of 300 (or 50 for Transactions). Prefer `criteria.Id` lookups over full scans; use `criteria.pagesize=1000` to minimise pages. Cache resolved data (`{Slug}`, staff/project ids) for the session. For write/polling-heavy use, tell the user the 50/day Transactions / 300/day total caps are the bottleneck and the **Premium API add-on** is the only way past them.

## Idempotency

- **GET** is idempotent — safe to retry (mind the budget).
- **POST to Transactions is NOT idempotent** — no idempotency key. A retried timesheet/invoice POST risks a duplicate AND burns a scarce transaction. Track created `timesheetId`s client-side and verify success before any retry. [INFERRED] 🔬

## File handling

No general file upload/download surface — this is a practice-management **data** API, not a document store. Invoice PDFs / exports, if any, are 🔬 DISCOVER. [INFERRED]

## Counter-exceptions (quick reference)

1. **401 is not refreshable** — recovery is the user regenerating + re-pasting a static key. [DOCUMENTED]
2. **Rate limits are daily, not per-second** — a rate-limit error won't clear by waiting seconds; only the next day's window (or Premium) helps. [INFERRED]
3. **Error body shape is unknown** — don't parse or assume `{code,message,details}`; surface the raw body. [UNKNOWN] 🔬
4. **Per-org budget, not per-key** — adding more static keys does NOT raise the limit. [DOCUMENTED]
5. **No webhooks at all** — polling is the only change-detection mechanism, and it must be sparse on the standard tier. [INFERRED]

## Output formatting (how to present responses)

| Data type | Format                 | Example                                                                                 |
| --------- | ---------------------- | --------------------------------------------------------------------------------------- |
| Project   | Number + name + status | "P-2026-014: Riverside Bridge Upgrade (Active)"                                         |
| Contact   | Name + email           | "Riverside Council — info@riverside.gov"                                                |
| Staff     | Name + email           | "Jordan Lee — jordan@acme-eng.com"                                                      |
| Timesheet | Staff + date + units   | "Jordan Lee: 7.5h on 2026-05-29 — Riverside Bridge Upgrade"                             |
| Invoice   | Id + amount + date     | "INV-77: $1,500.00 — 2026-05-29"                                                        |
| Date      | Human-readable         | "May 29, 2026"                                                                          |
| Errors    | Status + raw message   | "Synergy returned 401 — your API key may be expired; regenerate it in Profile settings" |

- Lists: show the first 10 records, note the total ("Showing 10 of 312 projects").
- **Surface budget cost** for a large scan ("This will use ~4 of your 300 daily API calls — proceed?").
- For writes, **echo the returned `timesheetId`** so the user can confirm and you avoid re-posting.

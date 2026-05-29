---
api_name: 'Total Synergy (API Key)'
api_slug: 'totalsynergy-api'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 7: Real-Time & Events', 'Phase 8: Operational Concerns']
---

# Total Synergy (API Key) — Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Event-driven capabilities (none — polling only), error
> handling, the daily rate budget, and recovery playbooks.
>
> 📌 **Same operational model as `totalsynergy-oauth`** — same (lack of) webhooks, same per-org
> daily rate limits, same error model. The credential differs (static key in the `access-token`
> header), which changes only the **401 recovery** (regenerate the key vs. refresh a token).
>
> ⚠️ **Confidence:** rate-limit **counts** are `[DOCUMENTED]`. The **429 status/headers/`Retry-After`
> behaviour** and the **error-body schema** are `[UNKNOWN]`/`[INFERRED]` — not published, and **no
> live call was made**. Items tagged **🔬** must be confirmed by triggering real errors on a live
> tenant. **Do not fabricate the error body — surface the raw response.**

---

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                   | Confidence |
| ------------------------ | --------- | ----------------------- | ---------- |
| Webhooks                 | No        | None found in portal/KB | [INFERRED] |
| WebSocket                | No        | —                       | [INFERRED] |
| Server-Sent Events (SSE) | No        | —                       | [INFERRED] |
| Change feeds / streams   | No        | —                       | [INFERRED] |

**There is no push/event mechanism.** All change detection is **polling-only**.

---

## Polling Fallback

> The only way to detect changes. The **daily** rate cap makes this **low-frequency** — Premium
> tenants excepted.

### Recommended Approach

```http
GET /api/v2/Organisation/{Slug}/Projects?criteria.pagesize=1000
Host: api.totalsynergy.com
access-token: <apiKey>
```

- Poll a list endpoint and **diff** against the previous snapshot on a date/modified field.
- **Which field reliably exposes "modified since" is 🔬 DISCOVER** — `createdDate` exists, but a
  `lastModified`/`modifiedDate` equivalent is unconfirmed. Until confirmed, diff on whatever date
  field the resource exposes and accept that updates without a timestamp bump will be missed.

### Polling Budget (the hard constraint)

The standard tier allows **300 calls/day total** (50/day for Transactions), counted **per
organisation**. That is the binding limit on polling:

| Cadence      | Calls/day (1 resource) | Verdict (standard tier)                 |
| ------------ | ---------------------- | --------------------------------------- |
| Every minute | ~1,440                 | ❌ Impossible — 5× over the daily cap   |
| Every 30 min | ~48                    | ⚠️ Eats ~16% of budget for one resource |
| Every hour   | ~24                    | ✅ Sustainable for a few resources      |
| 2–4×/day     | 2–4                    | ✅ Recommended for standard tenants     |

- Multiply by **page count** for large resources (each page is a call).
- Reserve budget for user-initiated reads/writes — don't spend all 300 on polling.
- Premium (60k/day) makes minute-level polling feasible; standard does not.

### Polling Pattern

```
1. Resolve and cache {Slug} once (GET …/Organisation/MySlug).
2. Snapshot the resource (GET …/{Resource}?criteria.pagesize=1000), store ids + date fields.
3. Wait the chosen interval (hours for standard tier, not minutes).
4. Re-fetch, diff against the snapshot, surface changes.
5. Update the snapshot. Repeat.
```

---

## Error Handling

### Error Response Format

**Not published.** All responses are JSON, but the error-body shape (code / message / details) is
`[UNKNOWN]`. **Do not fabricate it.** When an error occurs, surface the **raw response body + HTTP
status** to the user and proceed by status code below. 🔬

```
# Error body shape is UNKNOWN — example placeholder only, do NOT assume this is real:
{ "message": "<server-provided>", ... }   // 🔬 confirm by triggering errors on a live tenant
```

### Recovery Playbook

| HTTP Status | Meaning            | Retryable?    | Recovery Action                                                                | Confidence    |
| ----------- | ------------------ | ------------- | ------------------------------------------------------------------------------ | ------------- |
| 200         | OK (JSON body)     | —             | —                                                                              | [DOCUMENTED]  |
| 400         | Bad request        | No            | Fix params (`criteria.*`) or write-body fields                                 | [INFERRED]    |
| 401         | Unauthorized       | No\*          | **Static key missing/expired/wrong header** — see "401 deep-dive" below        | [DOCUMENTED]  |
| 404         | Not found          | No            | Verify the org `{Slug}` and the resource id                                    | [DOCUMENTED]  |
| 429 (?)     | Rate limit (daily) | No (same day) | Stop calling — the daily window won't reset until tomorrow; suggest Premium 🔬 | [INFERRED] 🔬 |
| 500         | Internal error     | Yes           | Retry with exponential backoff — **sparingly**, each retry costs budget        | [DOCUMENTED]  |

\* Unlike the OAuth connector, a 401 here is **not** fixable by refreshing — there is no refresh
flow. `[DOCUMENTED]`

### 401 Deep-Dive (static-key specifics)

A 401 on this connector almost always means one of:

1. **Wrong header** — the key was sent as `Authorization: Bearer` or `X-API-Key` instead of the
   required **`access-token`**. This is the #1 cause. `[DOCUMENTED]`
2. **Expired key** — the static key reached the end of its **1-year or 3-year** life. `[DOCUMENTED]`
3. **Revoked key** — the user regenerated the key in their profile, invalidating the old one.
   `[INFERRED]` 🔬
4. **Missing key** — the connector didn't inject the credential.

**Recovery:** there is **no programmatic refresh**. The user must go to Synergy → Profile settings →
ellipsis (⋯) → API Key, generate a **new** key, and re-paste it into the Numa connector. Tell the
user this explicitly rather than retrying. `[DOCUMENTED]`

### 404 Notes

- Most 404s here mean a **wrong `{Slug}`** or a wrong resource id — re-resolve the slug via
  `…/Organisation/MySlug` and verify the id. `[DOCUMENTED]`
- A 404 can also mean you hit the **registry `instance_url`** (a `*.totalsynergy.com` subdomain)
  instead of `api.totalsynergy.com`. Confirm the host. `[DOCUMENTED]` 🚩

---

## Rate Limit Details

| Scope                       | Limit  | Window | Confidence   |
| --------------------------- | ------ | ------ | ------------ |
| All API calls (standard)    | 300    | / day  | [DOCUMENTED] |
| Transactions API (standard) | 50     | / day  | [DOCUMENTED] |
| All API calls (Premium)     | 60,000 | / day  | [DOCUMENTED] |
| Transactions API (Premium)  | 20,000 | / day  | [DOCUMENTED] |

- Limits are **per organisation**, not per key — set/raised via the Subscription page ("Premium
  API" add-on). Multiple static keys for the same org **share one daily budget**. `[DOCUMENTED]`
- **Rate-limit headers / exact 429 body:** **not documented** 🔬. Whether the limit surfaces as
  `429` (vs. a bespoke status) and whether `Retry-After` is sent are unconfirmed.
- **Backoff strategy:** because the budget is **daily** (not per-second), the practical mitigation
  is **call frugality + caching**, NOT tight retry loops. Retrying within the same day after a
  rate-limit error is **futile** — the window won't reset until the next day. `[INFERRED]`

### Budget-Management Behaviour

- Track your own call count per session and warn the user as you approach a meaningful fraction of
  300 (or 50 for Transactions).
- Prefer `criteria.Id` lookups over full scans; use `criteria.pagesize=1000` to minimise pages.
- Cache resolved data (the org `{Slug}`, staff/project ids) for the session — don't re-fetch.
- For write-heavy or polling-heavy use, tell the user the **50/day Transactions** / **300/day
  total** caps are the bottleneck and that the **Premium API add-on** is the only way past them.

---

## Idempotency

- **GET** is naturally idempotent — safe to retry (mind the budget).
- **POST to Transactions is NOT idempotent** — no idempotency key. A retried timesheet/invoice POST
  risks a **duplicate** record **and** burns a scarce transaction. Track created `timesheetId`s
  client-side and verify success before any retry. `[INFERRED]` 🔬

---

## File Handling

No general file upload/download surface identified — this is a practice-management **data** API, not
a document store. Invoice PDFs / exports, if any, are 🔬 DISCOVER. `[INFERRED]`

---

## Counter-Exceptions

1. **401 is not refreshable.** No token refresh exists — recovery is the user regenerating + re-pasting a static key. `[DOCUMENTED]`
2. **Rate limits are daily, not per-second.** A rate-limit error won't clear by waiting seconds — only the next day's window (or Premium) helps. `[INFERRED]`
3. **Error body shape is unknown.** Don't parse or assume a `{code,message,details}` structure — surface the raw body. `[UNKNOWN]` 🔬
4. **Per-org budget, not per-key.** Adding more static keys does **not** raise the limit. `[DOCUMENTED]`
5. **No webhooks at all.** Polling is the only change-detection mechanism, and it must be sparse on the standard tier. `[INFERRED]`

---

## Output Formatting Guide

> How to present Total Synergy responses to the user in the workspace agent.

### Recommended Display Formats

| Data Type | Format                 | Example                                                                                 |
| --------- | ---------------------- | --------------------------------------------------------------------------------------- |
| Project   | Number + name + status | "P-2026-014: Riverside Bridge Upgrade (Active)"                                         |
| Contact   | Name + email           | "Riverside Council — info@riverside.gov"                                                |
| Staff     | Name + email           | "Jordan Lee — jordan@acme-eng.com"                                                      |
| Timesheet | Staff + date + units   | "Jordan Lee: 7.5h on 2026-05-29 — Riverside Bridge Upgrade"                             |
| Invoice   | Id + amount + date     | "INV-77: $1,500.00 — 2026-05-29"                                                        |
| Date      | Human-readable         | "May 29, 2026"                                                                          |
| Errors    | Status + raw message   | "Synergy returned 401 — your API key may be expired; regenerate it in Profile settings" |

### Truncation & Budget Notes

- Lists: show the first 10 records, note the total ("Showing 10 of 312 projects").
- **Surface budget cost** when a request requires a large scan ("This will use ~4 of your 300 daily
  API calls — proceed?").
- For writes, **echo the returned `timesheetId`** so the user can confirm and so you avoid re-posting.

---

_Generated from the investigation questionnaire, Phases 7–8. Mirrors `totalsynergy-oauth` (same operational model)._

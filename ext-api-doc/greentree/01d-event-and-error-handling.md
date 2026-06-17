---
api_name: MYOB Greentree
api_slug: greentree
doc: events & error handling (change polling, errors, status codes, two-mechanism auth, recovery, output formatting) — companion to 01-llm-api-rules.md (on-demand)
call_surface: HTTP via connectors(name="request", connector="greentree")
auth: dual, both backend-injected — ApiKey header (site serial, account-level) + HTTP Basic (per-user Greentree login). Agent sets neither.
events: NONE — no webhooks/SSE/streaming/long-polling. Change detection = `modifiedSince` polling only.
rate_limit: none documented; customer's single Jade server, bounded worker pool — self-throttle
confidence: docs-derived (MYOB Greentree official docs); NOT live-validated. HTTP status-code behavior through the connector is NOT confirmed. Treat all as [DOCS] unless tagged [UNVERIFIED]; parse error bodies defensively (XML or JSON).
---

# MYOB Greentree — Event & Error Handling

## Event-driven capabilities

| Mechanism              | Supported | Notes                              |
| ---------------------- | --------- | ---------------------------------- |
| Webhooks               | **No**    | Greentree has no webhook subsystem |
| WebSocket              | No        | not available                      |
| Server-Sent Events     | No        | not available                      |
| Long polling           | No        | not available                      |
| Change feeds / streams | No        | use `modifiedSince` polling        |

There is **no push from Greentree**. The only change-detection mechanism is polling with the universal `modifiedSince` modifier. A future Numa Automations trigger source for Greentree would have to be poll-based; nothing is wired today.

## Polling for change (the only option)

Essentially every entity supports `modifiedSince` — "Return a list of {X} modified since a date/time". Standard incremental-sync pattern:

```
connectors(name="request", params={"connector":"greentree","method":"GET","url":"/01/Customer?modifiedSince=2026-06-09T22:00:00&page=1&pageSize=100"})
```

Loop:

```
1. Store high-water mark = max(ModifiedTimeStamp) seen (server-local time, no timezone)
2. Wait interval (5-15 min is plenty for ERP data)
3. GET /{company}/{entity}?modifiedSince={mark}&page=1&pageSize=100
4. Page (increment `page`) until a short/empty page; de-dup by identifier; advance the mark
```

Tips:

- **Overlap the window slightly** and de-dup by identifier — `modifiedSince` boundary handling and same-timestamp saves are unverified, so back the mark off a few minutes and drop duplicates.
- **Timestamps carry no timezone** (`2013-02-28T16:45:00`) — always compare against values the server returned (`ModifiedTimeStamp`), never your local clock.
- **Deletes do not appear in `modifiedSince` polls** — a deleted record simply stops being returned. If delete detection matters, periodically reconcile full identifier lists [UNVERIFIED].
- **The user's permissions filter the poll** — you only see records the authenticated Greentree user can see. A service-account-style user differs from an end user.
- **No total count** — page until a short page; don't assume one request caught everything (100-row cap).
- Poll per entity you care about (`Customer`, `ARInvoice`, `SOSalesOrder`, `StockItem`…); there is no cross-entity "what changed" feed.

**Per-entity timestamp fields:** records carry `ModifiedTimeStamp` (+`ModifiedUser`) and `EntryTimeStamp` (+`EntryUser`). Use `ModifiedTimeStamp` as the high-water mark; `EntryTimeStamp` distinguishes new vs edited.

## Two-mechanism auth (recap + failure handling)

Every request carries TWO credentials, both injected by Numa (mirrors ProWorkflow: an account-level key + a per-user login). The agent sets **neither** and never sees credentials:

1. **`ApiKey` header** — the site's Greentree serial number. Account/site-level, admin-supplied once, same for every user.
2. **HTTP Basic** — the user's Greentree username+password, captured in the chat credential card, stored in the user's vault. The API runs with **that user's Greentree permissions**.

### When auth fails

| Failure source             | Symptom                               | Fix                                                        |
| -------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| User's Greentree login     | bad/expired/revoked username+password | **user reconnects** via the chat credential card           |
| Site `ApiKey` (serial no.) | wrong/disabled/changed serial number  | **admin re-saves** the site ApiKey in integration settings |

Through the connector both surface as a **401** [UNVERIFIED exact code/body]. Because you can't always tell which one failed, **surface both remedies**: "Greentree rejected the credentials — try reconnecting your Greentree login; if that doesn't work, your administrator may need to re-save the site API key (serial number)." Do NOT blind-retry.

> Docs show auth as HTTP Basic (`Authorization: Basic …`) + the `ApiKey` header (or `?ApiKey=` URL param for browsers). **Numa always uses the header form; the agent never adds `?ApiKey=`.**

## Error handling

Greentree returns an HTTP status with a body describing the problem. Through the connector expect JSON; docs samples are XML. Exact error-body shapes through the connector are [UNVERIFIED] — parse defensively.

### Status codes (recovery) [codes UNVERIFIED]

| Status  | Meaning                                         | Retryable? | Recovery                                                                                                                           |
| ------- | ----------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 200     | Success (GET / POST create / update / action)   | —          | POST responses carry the saved record incl. any allocated identifier                                                               |
| 401     | Auth failed — Greentree login OR site ApiKey    | No         | Surface BOTH fixes (user reconnects login, OR admin re-saves the ApiKey). Do NOT retry                                             |
| 404     | Unknown route / entity / identifier             | No         | Check the **company code**, the entity route token (`Customer` not `ARCustomer`), and the **human-key** identifier (not OidString) |
| 4xx     | Validation / business-rule rejection            | No         | Read the body; fix the payload (missing required fields, bad references, unsupported action)                                       |
| timeout | Slow report or large posting outran the request | Cautiously | Reports: raise `timeout=n`; writes: re-read before retrying (may have landed)                                                      |
| 5xx     | Server fault (customer's Greentree service)     | Cautiously | Retry GETs with backoff (max 2-3). NEVER blind-retry writes — re-read first (no idempotency proof)                                 |
| network | Instance unreachable / TLS / DNS                | Cautiously | Customer-hosted: server may be down or not internet-reachable — environment-side                                                   |

### Parsing the error body

1. Check the status code first.
2. Try JSON; fall back to raw body text (docs describe a textual problem description, e.g. "product not found").
3. An HTML body means a wrong content type / a non-API URL was hit — show the status code only [UNVERIFIED].

### 401 vs permission gap

- **401** = the credentials themselves failed (the login OR the ApiKey). Fix: reconnect / re-save (above).
- **A permission gap** (user authenticates fine but lacks rights) likely shows as **filtered/empty results, not a distinct 403** — the API returns what the user is allowed to see. If a user "can't find" data that exists, suspect their Greentree role; tell them to check with their Greentree admin [UNVERIFIED whether a 403 ever surfaces].

## Rate limits

**No documented API rate limit.** But the API is the customer's own single-box web server (default port 9000) fronting their production Jade database, with a bounded worker-thread pool (`MaxWorkerThreads`, default ~5-8; `QueueDepthLimit`). So:

- Don't hammer it. Keep `pageSize` modest, narrow with modifiers, avoid tight polling loops, pause between bulk pages.
- Concurrent requests beyond the worker pool **queue** (and may time out via `QueueDepthLimitTimeout`/`WorkerIdleTimeout`) — serialize bulk work rather than firing many parallel calls.

## Timeouts & long operations

- **Reports** (`action=report`) default to a **60-second** execution timeout; override `timeout=n` (seconds). A slow report can still exceed the connector's own timeout — warn the user; prefer narrow report parameters.
- **`ReadTimeout`** (jadegt.ini, 2019.3+) governs the server waiting for a slow request body; not agent-controllable.
- **`CallDurationLogTrigger`** flags slow calls in the server log (admin diagnostic) — if a customer reports slowness, their admin can enable API tracing (`ApiTracing=1`) temporarily.

## Sessions & keep-alive: N/A

Greentree's API auth is **stateless** — Basic auth + the `ApiKey` header on every request. **No login step, no session token, no cookie, no keep-alive.** No token refresh, no re-auth flow, no session expiry. The only "expiry" is a changed/disabled Greentree password (→ user reconnects) or a changed site serial/ApiKey (→ admin re-saves).

> **State-changing GETs exist** — price calc `?action=sellingPrice` is read-only, but processing-style action GETs elsewhere mutate. Never sweep `action=` URLs speculatively.

## Output formatting guide (presenting Greentree responses)

| Data type      | Format                           | Example                                                                                                                               |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Customer       | Code + Name (+ status)           | "CUST1234 — Acme Trading Ltd (Active)"                                                                                                |
| Supplier       | Code + Name                      | "SUPP01 — Acme Components"                                                                                                            |
| AR invoice     | Reference + customer + net       | "Invoice 100023 — CUST1234 — $1,500.00 (outstanding)"                                                                                 |
| Sales order    | Reference + customer + status    | "Order SO100001 — CUST1234 — Entered"                                                                                                 |
| Purchase order | Reference + supplier + net       | "PO 100000 — SUPP01 — $4,200.00"                                                                                                      |
| Stock item     | Code + Description (+ on-hand)   | "00AOPEN17MONITOR — 17\" Monitor — 193 on hand"                                                                                       |
| GL account     | AccountNo + Description          | "4000 — Sales Revenue"                                                                                                                |
| Job            | Code + Name (+ status)           | "5000 — System for Kangan (Active)"                                                                                                   |
| OidString      | hide by default                  | surface the human key (Code/Reference); keep OidString for follow-up calls                                                            |
| Money          | currency-formatted, 2dp          | "$1,234.56" (check `CurrencyCode`/`CurrencyRate` for FX)                                                                              |
| Dates          | human-readable, no TZ claims     | "30 May 2026" — API timestamps carry no timezone                                                                                      |
| Lists          | markdown table, first 10-15 rows | "Showing 15 (page 1)" — no total count available                                                                                      |
| Errors         | status + body message            | "Greentree rejected the request (404): no customer CUST9999"                                                                          |
| Auth errors    | both remedies                    | "Greentree rejected the credentials — reconnect your Greentree login; if that fails, your admin may need to re-save the site API key" |

### Truncation rules

- Long child collections (LineItems, Attachments, Notes): show the first ~10, note the rest.
- Full records are wide — never dump raw; summarize the fields the user asked about.
- No total count is returned — say "page N" / "first M shown", not "M of T". Offer to fetch the next page (`page+1`) rather than auto-walking everything (100/page).
- Surface human keys (Code/Reference/AccountNo), not `OidString` — but keep the key for follow-up identifier-route calls.

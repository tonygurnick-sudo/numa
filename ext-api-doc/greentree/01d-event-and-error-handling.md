---
api_name: 'MYOB Greentree'
api_slug: 'greentree'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-06-11'
update_source: 'MYOB Greentree official docs (api-overview auth/tracing/timeout sections + per-entity modifiedSince) — NO live testing'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# MYOB Greentree -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Covers change detection (polling), error handling, status
> codes, the two-mechanism auth model, recovery playbooks, and output formatting.

> ⚠️ **Docs-derived — NOT yet live-validated through the Numa connector path.** [DOCS] = MYOB
> Greentree official docs, [UNVERIFIED] = inference. No test instance has been exercised; HTTP
> status-code behavior through the connector is not confirmed.

---

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                                                                  |
| ------------------------ | --------- | ----------------------------------------------------------------------- |
| Webhooks                 | **No**    | Greentree has no webhook subsystem [DOCS — none documented]              |
| WebSocket                | No        | Not available                                                           |
| Server-Sent Events (SSE) | No        | Not available                                                           |
| Long polling             | No        | Not available                                                           |
| Change feeds / streams   | No        | Use `modifiedSince` polling (below)                                     |

> **There is no push from Greentree.** The only change-detection mechanism is polling with the
> universal `modifiedSince` modifier. A future Numa Automations trigger source for Greentree would
> have to be poll-based; nothing is wired today.

---

## Polling for Change (the only option)

Essentially every entity supports a `modifiedSince` query modifier — "Return a list of {X} which
have been modified since a date/time" [DOCS]. This is the standard incremental-sync pattern.

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/Customer?modifiedSince=2026-06-09T22:00:00&page=1&pageSize=100",
  "method": "GET"
})
```

### Pattern

```
1. Store high-water mark = max(ModifiedTimeStamp) seen (server-local time, no timezone)
2. Wait interval (5-15 min is plenty for ERP data)
3. GET /{company}/{entity}?modifiedSince={mark}&page=1&pageSize=100
4. Page (increment `page`) until a short/empty page; de-dup by identifier; advance the mark
```

### Tips

- **Overlap the window slightly** and de-dup by identifier — `modifiedSince` boundary handling and
  same-timestamp saves are unverified, so back the mark off a few minutes and drop duplicates.
- **Timestamps carry no timezone** (`2013-02-28T16:45:00`) — always compare against values the
  server itself returned (`ModifiedTimeStamp`), never your local clock. [DOCS]
- **Deletes do not appear in `modifiedSince` polls** — a deleted record simply stops being
  returned. If delete detection matters, periodically reconcile full identifier lists. [UNVERIFIED]
- **The user's permissions filter the poll** — you only see records the authenticated Greentree
  user can see. A poll for a service-account-style integration user will differ from an end user's.
  [DOCS]
- **No total count** — page until a short page; don't assume one request caught everything (100-row
  cap). [DOCS]
- Poll per entity you care about (`Customer`, `ARInvoice`, `SOSalesOrder`, `StockItem`…); there is
  no cross-entity "what changed" feed.

### Per-entity timestamp fields [DOCS]

Records carry `ModifiedTimeStamp` (+ `ModifiedUser`) and `EntryTimeStamp` (+ `EntryUser`). Use
`ModifiedTimeStamp` as the high-water mark; `EntryTimeStamp` distinguishes new vs edited.

---

## The Two-Mechanism Auth Model (recap + failure handling)

Every request carries TWO credentials, both injected by Numa [DOCS]:

1. **`ApiKey` header** — the site's Greentree serial number. **Account/site-level**, supplied once
   by the admin in the integration settings, the same for every user of that Greentree site.
2. **HTTP Basic auth** — the individual user's Greentree username + password, captured in the chat
   credential card and stored in the user's vault. The API runs with **that user's Greentree
   permissions**.

This is a dual-secret model (mirrors ProWorkflow): an account-level key + a per-user login. The
agent sets **neither** — it never sees credentials.

### When auth fails

A failure can come from **either** mechanism, and the fixes differ:

| Failure source            | Symptom                                  | Fix                                                                   |
| ------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| User's Greentree login    | Bad/expired/revoked username+password    | **User reconnects** via the chat credential card (re-enter login)      |
| Site `ApiKey` (serial no.)| Wrong/disabled/changed serial number     | **Admin re-saves** the site ApiKey in the integration settings         |

Through the connector both surface as a **401** [UNVERIFIED exact code/body]. Because you can't
always tell which one failed, **surface both remedies**: "Greentree rejected the credentials — try
reconnecting your Greentree login; if that doesn't work, your administrator may need to re-save the
site API key (serial number)." Do NOT blind-retry. [DOCS-derived]

> The docs show auth as HTTP Basic (`Authorization: Basic ...`) + the `ApiKey` header (or
> `?ApiKey=` URL param for browsers). **Numa always uses the header form; the agent never adds
> `?ApiKey=` to a URL.** [DOCS]

---

## Error Handling

Greentree returns an HTTP status with a body describing the problem. Through the Numa connector
expect JSON; the docs samples are XML. Exact error-body shapes through the connector are
**[UNVERIFIED]** — parse defensively.

### Status Code Reference [DOCS-derived / UNVERIFIED exact codes]

| HTTP Status | Meaning                                                | Retryable? | Recovery action                                                                                  |
| ----------- | ------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| 200         | Success (GET / POST create / POST update / action)      | --         | POST responses carry the saved record incl. any allocated identifier                              |
| 401         | Auth failed — Greentree login OR site ApiKey            | No         | Surface BOTH fixes: user reconnects their login, OR admin re-saves the site ApiKey. Do NOT retry  |
| 404         | Unknown route / entity / identifier                     | No         | Check the **company code**, the entity route token (e.g. `Customer` not `ARCustomer`), and the **human-key** identifier (not OidString) |
| 4xx         | Validation / business-rule rejection                    | No         | Read the body; fix the payload (missing required fields, bad references, unsupported action)       |
| timeout     | Slow report or large posting outran the request         | Cautiously | For reports raise `timeout=n`; for writes, re-read before retrying (may have landed)               |
| 5xx         | Server fault (the customer's Greentree service)         | Cautiously | Retry GETs with backoff (max 2-3). NEVER blind-retry writes — re-read first (no idempotency proof) |
| (network)   | Instance unreachable / TLS / DNS                        | Cautiously | Customer-hosted: the Greentree server may be down or not internet-reachable — environment-side     |

### Parsing the error body

1. Check the status code first.
2. Try JSON; fall back to raw body text (the docs describe a textual problem description, e.g.
   "product not found"). [DOCS]
3. An HTML body means a wrong content type / a non-API URL was hit — show the status code only.
   [UNVERIFIED]

### 401 — auth failure vs permission gap

- **401** = the credentials themselves failed (the login OR the ApiKey). Fix: reconnect / re-save
  (above). [DOCS-derived]
- **A permission gap** (the user authenticates fine but lacks rights to the data) likely shows up as
  **filtered/empty results**, not a distinct 403 — the API runs with the user's Greentree
  permissions and returns what they're allowed to see. If a user "can't find" data that exists,
  suspect their Greentree role, and tell them to check with their Greentree administrator.
  [DOCS-derived / UNVERIFIED whether a 403 ever surfaces]

---

## Rate Limits

**No documented API rate limit.** [DOCS — none stated] But the API is the customer's own
single-box web server (default port 9000) fronting their production Jade database, with a bounded
worker-thread pool (`MaxWorkerThreads`, default ~5-8; `QueueDepthLimit`) [DOCS]. So:

- Don't hammer it. Keep `pageSize` modest, narrow with modifiers, avoid tight polling loops, and
  pause between bulk pages.
- Concurrent requests beyond the worker pool **queue** (and may time out via `QueueDepthLimitTimeout`
  / `WorkerIdleTimeout`) — serialize bulk work rather than firing many parallel calls. [DOCS]

---

## Timeouts & Long Operations

- **Reports** (`action=report`) default to a **60-second** execution timeout; override with
  `timeout=n` (seconds). A slow report can still exceed the connector's own timeout — warn the user
  and prefer narrow report parameters. [DOCS]
- **`ReadTimeout`** (jadegt.ini, 2019.3+) governs the server waiting for a slow request body; not
  agent-controllable. [DOCS]
- **`CallDurationLogTrigger`** flags slow calls in the server log (admin diagnostic) — if a customer
  reports slowness, their admin can enable API tracing (`ApiTracing=1`) temporarily. [DOCS]

---

## Sessions & Keep-Alive: N/A

Greentree's API auth is **stateless** — Basic auth + the `ApiKey` header on every request. There is
**no login step, no session token, no cookie, no keep-alive** [DOCS]. Therefore:

- No token refresh, no re-auth flow, no session expiry to manage.
- The only "expiry" is a changed/disabled Greentree password (→ user reconnects) or a changed site
  serial/ApiKey (→ admin re-saves). [DOCS-derived]

---

## Counter-Exceptions

> Behaviors that differ from common REST conventions.

1. **No PUT/PATCH — POST is overloaded** for create AND update (and actions). An update is a POST to
   the identifier route. [DOCS]
2. **Some POST-to-identifier calls are actions, not updates** — `ARInvoice` POST-to-identifier
   "executes actions only (no updates)". [DOCS]
3. **State-changing GETs exist** — some entities expose action GETs (e.g. price calc
   `?action=sellingPrice` is read-only, but processing-style GETs elsewhere mutate). Never sweep
   `action=` URLs speculatively. [DOCS]
4. **The company code is in the PATH** — `/01/Customer`, not a header or `?company=`. Most REST APIs
   put tenancy in a header; Greentree puts it in the URL. [DOCS]
5. **The route identifier is a human key, not an internal id** — `/Customer/CUST1234`,
   `/GLAccount/1000`. The internal `OidString` is returned but is not the route key. [DOCS]
6. **No total-count / pagination metadata** — detect the last page by a short page; the 100-record
   cap is a hard ceiling per request. [DOCS]
7. **Two independent auth secrets, two independent fixes** — a 401 might mean the user's login OR
   the admin's ApiKey; you often can't tell which, so surface both. [DOCS-derived]
8. **Results are permission-filtered, not 403'd** — missing data is usually a Greentree-role gap
   that returns filtered results rather than an explicit denial. [DOCS-derived / UNVERIFIED]
9. **Customer-hosted reachability** — the server may simply be unreachable (offline, firewalled,
   not internet-exposed); a transport error is environment-side, not an API error. [DOCS]
10. **No webhooks at all** — unlike many ERPs, there is zero push; polling `modifiedSince` is the
    only change mechanism. [DOCS]

---

## Output Formatting Guide

> How to present Greentree responses to the user in the workspace agent.

| Data type       | Format                              | Example                                                            |
| --------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Customer        | Code + Name (+ status)              | "CUST1234 — Acme Trading Ltd (Active)"                              |
| Supplier        | Code + Name                         | "SUPP01 — Acme Components"                                          |
| AR invoice      | Reference + customer + net          | "Invoice 100023 — CUST1234 — $1,500.00 (outstanding)"              |
| Sales order     | Reference + customer + status       | "Order SO100001 — CUST1234 — Entered"                              |
| Purchase order  | Reference + supplier + net          | "PO 100000 — SUPP01 — $4,200.00"                                   |
| Stock item      | Code + Description (+ on-hand)      | "00AOPEN17MONITOR — 17\" Monitor — 193 on hand"                    |
| GL account      | AccountNo + Description             | "4000 — Sales Revenue"                                             |
| Job             | Code + Name (+ status)              | "5000 — System for Kangan (Active)"                                |
| OidString       | Hide by default                     | Surface the human key (Code/Reference); keep OidString for follow-up calls |
| Money           | Currency-formatted, 2dp             | "$1,234.56" (check `CurrencyCode`/`CurrencyRate` for FX)            |
| Dates           | Human-readable, no TZ claims        | "30 May 2026" — API timestamps carry no timezone                   |
| Lists           | Markdown table, first 10-15 rows    | "Showing 15 (page 1)" — no total count is available                |
| Errors          | Status + body message               | "Greentree rejected the request (404): no customer CUST9999"        |
| Auth errors     | Both remedies                       | "Greentree rejected the credentials — reconnect your Greentree login; if that fails, your admin may need to re-save the site API key" |

### Truncation Rules

- Long child collections (LineItems, Attachments, Notes): show the first ~10, note the rest.
- Full records are wide — never dump them raw; summarize the fields the user asked about.
- No total count is returned, so say "page N" / "first M shown" rather than "M of T". Offer to fetch
  the next page (`page+1`) rather than auto-walking everything (100/page).
- Surface human keys (Code/Reference/AccountNo), not `OidString` — but keep the key for follow-up
  identifier-route calls.

---

_Generated 2026-06-11 from MYOB Greentree's official API documentation (overview auth/tracing/
timeout sections + per-entity `modifiedSince`), Phases 7-8. Not yet validated against a live
instance — verify auth-failure codes, error-body shapes, and polling boundaries before first
customer use._

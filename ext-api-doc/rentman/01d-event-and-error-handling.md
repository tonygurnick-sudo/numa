---
api_name: 'Rentman'
api_slug: 'rentman'
generated_from: 'Live OpenAPI spec (oas.json 1.13.0, fetched 2026-06-10) + support article 360013767839 + FEAT-209'
generated_date: '2026-06-10'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Rentman -- Event & Error Handling Reference

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> All examples use the Numa `connectors` tool form — relative URLs, **no Authorization header**
> (Numa injects the Bearer token). Facts tagged [SPEC] / [DOCS] / [UNVERIFIED].

## Event-Driven Capabilities

| Mechanism           | Platform has it?            | Available to Numa? | Notes                                  |
| ------------------- | --------------------------- | ------------------ | -------------------------------------- |
| Webhooks (outbound) | **Not documented anywhere** | No                 | Neither spec nor support docs mention webhooks [SPEC/DOCS — absence] |
| WebSocket / SSE     | No                          | No                 | Not documented                         |
| Change feeds        | No (but see `updateHash`)   | Poll-equivalent    | Per-item change hash [SPEC]            |
| Polling             | Yes                         | **Yes — the only option** | `modified[gte]` filters + `updateHash` diffing [SPEC] |
| MCP server (beta)   | Yes — `mcp.rentman.net`     | **Not yet in Numa** | Preferred future surface — see below   |

**Bottom line:** "tell me when a project changes" = polling via a Numa scheduled agent. Be explicit
about the latency floor (your polling cadence).

## Polling: The Change-Detection Pattern

Rentman gives you two purpose-built primitives [SPEC]:

1. **`modified` is a real, filterable field** on every resource → server-side delta queries.
2. **`updateHash`** — hash of `id`+`modified`, unique per item per update → cheap change diffing
   without parsing timestamps.

### The delta-poll recipe

```
# Each run: pull everything touched since the last high-water mark
connectors(name="request", params={"connector": "rentman", "method": "GET",
  "url": "/projects?modified[gte]=2026-06-10T06:00:00&sort=+modified&fields=id,name,number,modified,updateHash&limit=500"})

# 1. Compare each row's updateHash to your stored set → changed/new items
# 2. New high-water mark = max(modified) seen     (persist it in the workspace)
# 3. Deletions do NOT appear — detect by full-id sweep when it matters [SPEC — absence]
```

- `sort=+modified` is single-field — safe with paging [SPEC].
- Overlap the window by a minute (`gte` last-mark minus 60s) and dedupe on `updateHash` — clock
  skew and same-second writes are [UNVERIFIED] hazards.
- Sub-entity changes (e.g. a `projectequipment` line) may NOT bump the parent project's
  `modified` [UNVERIFIED] — poll the resource you actually care about.

### Cadence guidance

50,000 req/day [SPEC] is generous: a 5-minute poll over 4 resources ≈ 1,152 req/day. Suggested:

| Need                          | Cadence            |
| ----------------------------- | ------------------ |
| "Roughly daily digest"        | 1×/day scheduled agent |
| "Within the hour"             | 15–60 min          |
| "Near-real-time dashboard"    | 5 min — floor it here; respect 10 req/s bursts [SPEC] |

## Rate Limits

Documented [SPEC]: **50,000 requests/day · 10 requests/second · max 20 concurrent.**

- Numa's connector path is sequential per chat turn — the 10 r/s and 20-concurrent caps matter
  mostly for code-executed loops. Pace bulk loops at ≤5 req/s.
- **Breach behaviour is undocumented** — no 429 appears in the spec's declared responses
  [SPEC — absence]. Treat any 429 (or rate-limit-shaped 4xx/5xx with a limit message) as
  authoritative: back off 2s → 10s → 30s, then halve your pacing for the session.
- The daily quota is per token [UNVERIFIED scope — could be per workspace]. A long export burning
  ~7 req/1500 rows won't dent it; multi-agent fan-out could.

## Error Handling

The spec declares exactly five error statuses, **with no response-body schema** [SPEC]. Read the
status first; quote any body verbatim rather than interpreting it.

| Status | Spec meaning            | Likely causes                                                    | Action |
| ------ | ----------------------- | ---------------------------------------------------------------- | ------ |
| 400    | Bad request             | Bad filter/sort param; expanding a non-link field; sorting a GENERATED field with paging; >5 MB response; malformed body | Fix the request — do NOT retry unchanged. If a big read 400s, cut `limit`/add `fields` |
| 401    | Unauthorized            | Token regenerated (only last token valid [DOCS]), revoked, expired (10-yr [DOCS]); possibly role-denied access [UNVERIFIED] | **Reconnect via the chat credential card.** Do not retry; do not loop |
| 404    | Not found               | Wrong id, wrong path, or data hidden from the token's role [UNVERIFIED] | Verify id via a list query; check the exact path against 01a |
| 500    | "Something went wrong"  | Server-side                                                       | Retry once after 5s. **For writes: verify whether it landed before re-sending** |
| 502    | Bad gateway             | Upstream blip                                                     | Same as 500 |

Not declared but plan for: **429** (rate limit — backoff ladder above) and **403** (if it ever
appears, treat as role-permission denial → the user's Rentman admin must raise the role of the
token-generating user; reconnecting with the same user fixes nothing) [UNVERIFIED].

### 401 — the reconnect flow

The token is a long-lived per-user JWT; **regenerating it in Rentman instantly kills the old one**
[DOCS]. On 401:

1. Stop. Do not retry or vary the request.
2. Tell the user: "Your Rentman connection is no longer valid — the API token was likely
   regenerated or revoked. Reconnect to continue."
3. The chat credential card re-captures the token (Rentman → Configuration → Account →
   Integrations → API → Show token [DOCS]) into the user's vault.
4. Re-run the original request once after reconnection.

Access is role-scoped to the generating user [DOCS] — if reads work but some resource is
empty/404 while the user swears data exists, the role (not the query) is the suspect.

### Timeouts & unknown outcomes on writes

No idempotency keys exist [SPEC — absence]. After a timeout/5xx on POST:

```
1. Wait ~5s
2. Search for the would-be record (e.g. /contacts?email_1=...&sort=-id, or sort=-created on the resource)
3. Found → use it; report it was created despite the error
4. Not found → re-send ONCE; if it fails again, stop and report
```

PUT and DELETE are naturally re-runnable (same end state); POST is the dangerous one.

## Error Triage Decision Tree

```
Request failed
├─ 400 → my request is wrong
│    ├─ used expand on a non-link field?            → drop it (01a lists link fields)
│    ├─ filtered/sorted a GENERATED FIELD?          → move that predicate client-side (01b §filters)
│    ├─ big read (high limit, wide rows)?           → 5 MB cap: add ?fields, halve limit, retry once
│    └─ write body?                                 → diff against the Request schema (01c) + a real sibling record
├─ 401 → token dead                                 → reconnect flow below; NEVER retry-loop
├─ 404 → ─ id wrong?                                → re-resolve via a list query
│        ├─ path wrong?                             → check 01a catalog (no /v4/ prefix, no trailing slash documented)
│        └─ both right?                             → suspect role-scoping [UNVERIFIED] — ask the user to check in the UI
├─ 429 / limit-shaped error → back off 2s→10s→30s   → then halve pacing for the session
└─ 500/502 → ─ read?                                → retry once after 5s
              └─ write?                             → VERIFY FIRST (search for the record), then at most one re-send
```

## Deletion Detection (the gap in delta polling)

`modified[gte]` polling never reports deletions — a deleted record simply stops appearing
[SPEC — absence of any tombstone mechanism]. When deletions matter (e.g. mirroring projects into
another system):

```
1. Periodic full-id sweep:  GET /projects?fields=id&limit=1500  (+ next_page_url drain)
   — ids only ⇒ tiny pages; a 10k-project workspace is ~7 requests
2. Diff against your stored id set → missing ids = deleted (or role-hidden [UNVERIFIED])
3. Run the sweep less often than the delta poll (daily vs every 15 min)
```

Label results honestly: "no longer visible via the API" — you cannot distinguish deletion from a
role/visibility change [UNVERIFIED].

## Worked Example: "Tell me when an invoice gets paid"

`is_paid` is GENERATED → not filterable [SPEC]; poll + client-side diff:

```
# Scheduled agent, every 30 min; state: {invoice_id: updateHash} for open invoices
1. GET /invoices?modified[gte]={mark}&sort=+modified&fields=id,number,modified,updateHash,is_paid,total_paid,outstanding_balance&limit=500
2. For rows whose updateHash changed AND is_paid flipped false→true → notify
3. A payment may bump only the payment record, not the invoice [UNVERIFIED] — ALSO poll:
   GET /payments?modified[gte]={mark}&sort=+modified&fields=id,invoice,amount,moment,modified&limit=500
   and re-read the linked invoice for any new payment
4. Advance {mark}; overlap by 60s; dedupe on updateHash
```

## Worked Example: "Alert on new incoming project requests"

`/projectrequests` is the external-intake resource — new rows are inherently event-shaped [SPEC]:

```
1. GET /projectrequests?created[gte]={mark}&sort=+created&fields=id,name,contact_name,planperiod_start,planperiod_end,price,created&limit=200
2. Anything returned is a new request → summarize (who, when, value) and notify
3. created (not modified) keys this poll — requests are created once, then converted in the UI
```

## Scheduled Sync Recipe (Numa scheduled agent)

```
Trigger:  daily 07:00 (or 15-min for urgent flows)
State:    /workdir high-water marks per resource (modified ISO timestamp + updateHash set)

1. GET /projects?modified[gte]={mark}&sort=+modified&fields=id,name,number,modified,updateHash&limit=500
2. GET /invoices?modified[gte]={mark}&sort=+modified&fields=id,number,modified,updateHash,is_paid,outstanding_balance&limit=500
   (is_paid/outstanding_balance: requestable via fields, NOT filterable — diff client-side [SPEC])
3. GET /projectcrew?modified[gte]={mark}&sort=+modified&fields=id,crewmember,function,planperiod_start,modified,updateHash&limit=500
4. Diff updateHash sets → changed/new; summarize; advance marks only after a successful run
5. Page via next_page_url when itemCount == limit
```

## Connection Health Check

Cheap probe to classify a sick connection before debugging anything else:

```
connectors(name="request", params={"connector": "rentman", "method": "GET",
  "url": "/projects?limit=1&fields=id"})
```

- 200 → token + connectivity fine; the problem is your query (check 01b gotchas)
- 401 → reconnect flow above
- 404 on a known-good path → escalate; likely a path typo (no `/v4/` prefix exists — paths are bare [SPEC])
- repeated 5xx → Rentman-side incident; tell the user to retry later

## The MCP Beta — Preferred Future Surface (NOT available in Numa yet)

Rentman runs a first-party MCP server in beta: **`mcp.rentman.net`** — OAuth 2.1 + PKCE with
dynamic client registration (`/authorize`, `/token`, `/register`; MCP endpoint `/mcp`). The
FEAT-209 customer is in this beta with it enabled.

- Numa's MCP surface today is NetSuite-specific; generic remote-MCP (OAuth 2.1 PKCE) is a separate
  platform spike. **Until that lands, this REST connector is the only Rentman path in Numa.**
- When generic MCP support ships, prefer the MCP surface for tool-shaped operations and keep this
  REST path for bulk reads/drains — re-evaluate then; tool coverage of the beta is [UNVERIFIED].

## Why This Connector Exists (context for the agent)

The Pipedream Rentman actions are **broken** per the FEAT-209 customer — do not suggest the
Pipedream Rentman integration as a fallback; this native connector replaces it. (The same card
requested Current RMS — that is a separate connector, not Rentman.)

## Counter-Exception Handling

1. **A read that worked yesterday 401s today** → token regenerated by someone in the customer's
   Rentman workspace (only the last token is valid [DOCS]) — reconnect, don't debug the query.
2. **A filter param is silently ignored** (full unfiltered list returned) [UNVERIFIED behaviour] →
   misspelled field or GENERATED field; verify the field name against 01a and re-check.
3. **`next_page_url` host differs from api.rentman.net** [UNVERIFIED] → still strip the host and
   send the path+query through the connector; never call foreign hosts directly.
4. **Huge `itemCount` with missing fields** → you forgot `?fields` and the API omitted generated
   fields from a collection response [SPEC] — re-request with explicit `fields`.
5. **The API contradicts this file** → the API wins. Note the discrepancy for the docs.

## Output Formatting Guide

- Lead with `displayname` (it exists on every entity [SPEC]); show `number` for projects/invoices.
- Money fields are plain numbers — currency symbol/locale is workspace config [UNVERIFIED];
  present amounts bare or ask the user for the currency once and reuse it.
- Dates are ISO `date-time` strings; timezone semantics [UNVERIFIED] — display as returned, don't
  silently convert.
- Linked path strings (`"/contacts/12"`) are internal — resolve them (expand or follow-up GET)
  before showing anything to the user.
- Always disclose partial scans: "checked the 300 most recently modified projects" beats a silent
  partial answer.

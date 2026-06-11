---
api_name: 'GoHighLevel'
api_slug: 'gohighlevel'
generated_from: '00-api-investigation (GoHighLevel, 2026-05-04) + official marketplace docs'
generated_date: '2026-06-10'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# GoHighLevel -- Event & Error Handling Reference

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> All examples use the Numa `connectors` tool form — relative URLs, **no Authorization header**
> (Numa injects the Bearer PIT), `Version` header on EVERY call. Facts tagged [DOCS] / [UNVERIFIED].

## Event-Driven Capabilities

| Mechanism           | Platform has it? | Available to Numa (PIT auth)? | Notes                                              |
| ------------------- | ---------------- | ----------------------------- | --------------------------------------------------- |
| Webhooks (outbound) | Yes — 50+ events | **NO**                        | Webhooks require an OAuth **Marketplace app**; PITs get none [DOCS] |
| WebSocket / SSE     | No               | No                            | Not documented                                       |
| Change feeds        | No               | No                            | Not documented                                       |
| Polling             | Yes              | **Yes — the only option**     | Cursor walks + client-side date comparison [UNVERIFIED filters] |
| MCP server          | Yes              | Future surface                | `/mcp/`, PIT auth, request/response only — not events [DOCS] |

**Bottom line for the agent:** if the user asks for "notify me when a lead comes in" or any
real-time behaviour, be explicit — this connector cannot receive GoHighLevel webhooks (PIT
limitation [DOCS]); the floor is polling latency via a Numa scheduled agent.

### Webhooks reference (context only — NOT usable via this connector)

Kept so you can answer questions accurately [DOCS — webhook integration guide]:

- 50+ event types: contact created/updated/deleted + tag changes, opportunity lifecycle, task,
  appointment, invoice lifecycle, product, association, location, user, INSTALL/UNINSTALL.
- Payload pattern: `{"type": "<EventType>", "timestamp": "...", "webhookId": "...", "data": {...}}`.
- Signatures: `X-GHL-Signature` (Ed25519, current) — the legacy `X-WH-Signature` (RSA-SHA256) is
  **deprecated July 1, 2026**.
- Delivery retries: 429 → up to 7 attempts ~10min apart; other non-2xx → exponential backoff for up
  to 3 days; >10k webhooks in 3 days with <90% success → app's webhooks get paused.
- Requires an approved OAuth Marketplace app with webhooks configured in its Advanced Settings —
  out of scope for this connector. If a customer truly needs push, that is a product decision
  (build/operate a marketplace app), not something to attempt from chat.

## Polling: The Only Change-Detection Pattern

No documented server-side `updatedAt >=` filter was found for the core lists [UNVERIFIED — search
endpoints may support date filters; shapes unpinned]. The robust docs-derived recipe:

### The cursor-walk + client-side-date pattern

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/contacts/?locationId={loc}&limit=100", "headers": {"Version": "2021-07-28"}})
```

1. Keep a `last_synced_at` watermark per entity (ISO UTC) in a workspace file.
2. Page the list with `limit=100` + `startAfter`/`startAfterId` cursors from `meta` [DOCS].
3. Compare each record's update timestamp (likely `dateUpdated` — confirm the actual field name on
   the first page [UNVERIFIED]) against the watermark client-side; collect newer records.
4. **Stop early if the list is ordered most-recent-first** — verify the ordering empirically on page 1
   before assuming it [UNVERIFIED — sort order undocumented]; if ordering is unclear, drain all pages.
5. Update the watermark to the max timestamp seen, only after processing succeeds.
6. Dedupe by `id` across runs.

If `/contacts/search` (or `/opportunities/search`, `/conversations/search`) turns out to accept
date filters once validated, switch to those and note it — they are the documented "preferred"
surfaces [DOCS].

### Cadence guidance

Rate limits are numerically unknown [DOCS — searched, not found], so budget by observation, not math:

- **In chat: poll on demand only.** "What's new?" → one walk from the watermark. No timers in chat.
- **Standing syncs belong in Numa scheduled agents** — every 15–60 min per entity is a sane start;
  ~1 request/sec pacing inside a run (community guidance inserts 1000ms between pages [DOCS —
  community practice]).
- The first 429 you see defines the real ceiling — halve your pacing and remember it for the session.

## Rate Limits — Unknown by Design (here)

- No public numeric thresholds exist in official docs or community sources [DOCS — explicitly
  searched and not found]. **Do not quote numbers to the user.**
- 429 is documented as the breach signal [DOCS]. Treat **429 as the only authoritative source** of
  rate-limit truth.
- Check 429 responses for `Retry-After` / `X-RateLimit-*` headers — presence [UNVERIFIED]; honour
  them if they appear, and report their existence (it resolves a known unknown).
- Conservative defaults: sequential calls, ~1/sec, `limit=100` to minimise page count, no
  speculative refreshes.

### Backoff ladder for 429

```
attempt 1: wait 2 seconds
attempt 2: wait 10 seconds
attempt 3: wait 30 seconds
→ then stop, tell the user GoHighLevel is rate-limiting, and halve pacing for the session
```

[UNVERIFIED — recommended strategy; no documented windows to align with]

## Error Response Format — Unknown

The raw error JSON structure is **not documented** and was never observed live [DOCS — flagged as a
top risk]. The SDK wraps errors as `GHLError {message, statusCode, response, request}` [DOCS], which
implies a parseable body, but **do not assume a shape**:

1. Read the **HTTP status code first** — it is the contract.
2. Surface the response body **verbatim** to the user when explaining a failure — don't paraphrase
   away detail, don't invent fields like `error.message`.
3. When you DO see real error bodies, note their shape — first live session resolves this unknown.

## Recovery Playbook

| Status | Meaning                                          | Retryable? | Action                                                                                      |
| ------ | ------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| 400    | Malformed request — bad JSON, **missing `Version` header**, missing `locationId`, bad params | No  | Fix and re-issue; check Version + locationId before anything else [DOCS — both required] |
| 401    | Bad / rotated / revoked PIT                       | No         | User reconnects GoHighLevel via the chat credential card. Token rotation in HighLevel kills the old PIT immediately [DOCS] |
| 403    | **PIT missing a scope** for that endpoint family  | No         | User edits/recreates the Private Integration (HighLevel → Settings → Private Integrations) with the named scope, then reconnects [DOCS]. Name the scope (see 01a mapping) |
| 404    | Wrong id, wrong path, or resource in another location | No     | Verify id, exact documented path, and that the record belongs to THIS location               |
| 422    | Validation failure (field values)                 | No         | Fix values — phone format (E.164), restricted `country` list, enum values; quote the body [DOCS — code documented on contacts] |
| 429    | Rate limited — thresholds unknown                 | Yes        | Backoff ladder above; honour `Retry-After` if present [UNVERIFIED]                           |
| 5xx    | Server error                                      | Once       | Retry once after 5s; for writes, verify first whether it landed (below)                      |

### 401 vs 403 — the two auth-shaped errors, different fixes

- **401 → credential problem.** The PIT is wrong, rotated, or revoked. Fix is **reconnect via the
  chat card**. Re-adding scopes won't help.
- **403 → scope problem.** The PIT is valid but wasn't granted that permission at creation. Fix is
  **in HighLevel** (edit the Private Integration's scopes), then reconnect so Numa stores the new
  token if one was regenerated. Re-entering the same token won't help.
  Never tell the user to "check their token" on a 403 — name the missing scope instead. [DOCS]

### Timeouts and unknown outcomes on writes

A timeout/dropped connection says nothing about whether the write landed. No idempotency keys are
documented [UNVERIFIED]. Before re-sending a POST:

1. **Contacts:** re-run as `POST /contacts/upsert` instead — it's the documented dedupe-safe write [DOCS].
2. **Other entities:** search/list for the would-be record (name, contactId, timestamps) and only
   re-POST if genuinely absent.
3. **PUTs:** safe to repeat with the same body — but re-GET first if time has passed, and remember
   partial-vs-replace semantics are [UNVERIFIED] (01c Pattern 8).
4. **Messages (`/conversations/messages`): never blind-retry** — a duplicate here is a duplicate
   text/email to a real person. Check the conversation's messages first.

## Scheduled Sync Recipe (Numa scheduled agent)

For standing "tell me what changed" requests, move the polling loop into a scheduled agent and
persist state between runs:

```
1. Read watermarks.json from /workdir
   (e.g. {"contacts": "2026-06-09T00:00:00Z", "opportunities": "2026-06-09T00:00:00Z"});
   if absent, initialise to a sensible backstop (e.g. 7 days ago) — NOT epoch zero, or the first
   run becomes a full-book scan against unknown rate limits.
2. For each entity:
   a. Cursor-walk the list (limit=100, startAfter/startAfterId from meta) with the Version header.
   b. Client-side filter on the update-timestamp field identified in the first live session.
   c. Stop early if ordering allows (verified newest-first), else drain pages.
   d. ~1s between requests; abort the run cleanly on a persistent 429.
3. Process/report the changed records.
4. Write new high-water marks back to watermarks.json ONLY after processing succeeds —
   a crashed run then safely re-reads the same window next time (dedupe by id).
```

This is operational guidance, not an API feature — the cursor mechanics are [DOCS]; the
update-timestamp filtering is [UNVERIFIED] until the field name is confirmed live.

## Resolving the Known Unknowns

The investigation left specific gaps that the FIRST real sessions should close. When you encounter
any of these, state the finding explicitly so it can be folded back into these docs:

| Unknown                              | How it resolves itself                                        |
| ------------------------------------ | -------------------------------------------------------------- |
| Error body JSON shape                | First 4xx you receive — quote it                               |
| Rate limit numbers / headers         | First 429 — check for `Retry-After` / `X-RateLimit-*`          |
| `/contacts/search` request shape     | First successful search call (01b Pattern 3 probe order)        |
| Contact update-timestamp field name  | First contact GET (look for `dateUpdated`-like keys)            |
| List sort order                      | First page of each list                                         |
| PUT partial-vs-replace semantics     | First contact update — GET after and compare untouched fields   |
| Single-record envelope per entity    | First GET of each entity type                                   |

## The MCP Server — Future Second Surface

HighLevel runs an official MCP server at `https://services.leadconnectorhq.com/mcp/` — PIT auth
(`Authorization: Bearer pit-...`), HTTP Streamable transport, 36 tools covering contacts,
conversations, opportunities, calendars, payments, blogs, social, email templates; roadmap to 250+
tools [DOCS]. The same PIT the Numa connector stores would work there.

Today, **use this REST connector** — Numa's GoHighLevel integration is the `connectors` request
path. If Numa later wires GHL through `mcp_call`, the MCP tools would replace hand-built REST calls
for the covered operations. Do not attempt to call `/mcp/` through the request operation now
(streaming transport, unvalidated) [UNVERIFIED].

## Connection Health Check

When errors look auth-shaped or the user says "GoHighLevel isn't working", run two cheap probes:

```
# Probe 1 — is the PIT valid at all? (needs View Locations scope)
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/locations/search", "headers": {"Version": "2021-07-28"}})

# Probe 2 — does it have the core CRM scope?
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/contacts/?locationId={loc}&limit=1", "headers": {"Version": "2021-07-28"}})
```

| Outcome                          | Diagnosis                                                                 |
| -------------------------------- | -------------------------------------------------------------------------- |
| Both 200                         | Connection healthy — the original failure is endpoint/scope/payload-specific |
| Probe 1 → 401                    | PIT dead (rotated/revoked) — reconnect via chat card                        |
| Probe 1 → 403                    | PIT lacks even View Locations — integration was created with too few scopes; recreate with the checklist in 01a |
| Probe 1 → 200, Probe 2 → 403     | Valid token, missing contacts scope — add it in Private Integrations        |
| Probe 1 → 200, Probe 2 → 400     | Likely `locationId`/param issue, not auth — re-check the id from Probe 1    |

## Counter-Exception Handling

1. **First suspect on ANY 4xx: the `Version` header.** Numa injects only the Bearer token; a
   missing Version header is this connector's signature failure mode. [DOCS]
2. **403 mid-session on a new endpoint family** = scope gap, not a broken connection. Everything
   that worked keeps working. [DOCS]
3. **401 after earlier success** = the PIT was rotated/revoked in HighLevel between calls. Stop,
   reconnect via the chat card, resume. [DOCS]
4. **Empty page with 200 is not an error** — end of data or no matches. Stop paging.
5. **A 404 on an id the user gave you** may mean it lives in a different location than the PIT's —
   say so rather than declaring the record nonexistent. [UNVERIFIED behaviour, structural inference]
6. **429 with unknown limits:** never promise "we'll be fine after N seconds" — back off, observe,
   and adapt pacing for the rest of the session.
7. **Response shape contradicts these docs:** trust the live response, surface it verbatim, and note
   the discrepancy — these files are docs-derived and expect correction from the first real sessions.
8. **User asks for real-time/webhooks:** explain the PIT limitation [DOCS], offer a Numa scheduled
   agent running the polling recipe as the supported alternative.

## Output Formatting Guide

| Situation       | What to tell the user                                                                  |
| --------------- | --------------------------------------------------------------------------------------- |
| Contact         | "Jane Smith (jane.smith@acme.co.nz, +64 9 555 1234) — tags: vip, newsletter"            |
| Opportunity     | "Acme renewal — Sales pipeline / Proposal stage, open, $12,000" (map stage ids to names via pipelines) |
| List results    | First 10 records + "at least N" phrasing unless you drained all pages                   |
| 403             | "Your GoHighLevel Private Integration is missing the '<scope>' permission. Edit it under Settings → Private Integrations in HighLevel, then reconnect here." |
| 401             | "Your GoHighLevel token is no longer valid (it may have been rotated). Please reconnect via the connection card." |
| 429             | "GoHighLevel is rate-limiting requests (it doesn't publish limits) — I've slowed down and will retry." |
| Unknown errors  | Quote the status code and body verbatim — the error format is undocumented, so the raw text is the most useful thing |
| Real-time asks  | "This connection can't receive GoHighLevel webhooks (they require a marketplace app). I can set up a scheduled check instead." |

---

_Generated 2026-06-10 from the 2026-05-04 docs investigation. Companion to `01-llm-api-rules.md`.
See `01b-query-patterns.md` for cursor pagination and `01c-mutation-patterns.md` for safe write retries._

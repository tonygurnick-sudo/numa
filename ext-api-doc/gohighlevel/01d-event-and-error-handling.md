---
api_name: GoHighLevel
api_slug: gohighlevel
base_url: https://services.leadconnectorhq.com
path_version_segment: none (version is the Version header, never a path)
auth: Bearer PIT (backend-injected); Version header mandatory every call
events: NO webhooks on this connector (PIT auth) — polling only
rate_limit: numeric thresholds UNPUBLISHED — 429 is the only authoritative signal
call_surface: HTTP via `numa integrations request`. NOT a file-store connector.
confidence: docs-derived [DOCS], NOT live-validated. Error body shape UNKNOWN — status code is the contract. Markers [UNVERIFIED] inline.
companions: 01=api-rules, 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns
---

# GoHighLevel — Event & Error Handling

## Event-driven capabilities

| Mechanism           | Platform has it? | Available to Numa (PIT)?  | Notes                                                           |
| ------------------- | ---------------- | ------------------------- | --------------------------------------------------------------- |
| Webhooks (outbound) | Yes — 50+ events | **NO**                    | require an OAuth Marketplace app; PITs get none                 |
| WebSocket / SSE     | No               | No                        | not documented                                                  |
| Change feeds        | No               | No                        | not documented                                                  |
| Polling             | Yes              | **Yes — the only option** | cursor walks + client-side date comparison [UNVERIFIED filters] |
| MCP server          | Yes              | Future surface            | `/mcp/`, PIT auth, request/response only — not events           |

**Bottom line:** for "notify me when a lead comes in" or any real-time ask, be explicit — this connector cannot receive GoHighLevel webhooks (PIT limitation); the floor is polling latency via a Numa scheduled agent.

### Webhooks reference (context only — NOT usable here)

- 50+ event types: contact created/updated/deleted + tag changes, opportunity lifecycle, task, appointment, invoice lifecycle, product, association, location, user, INSTALL/UNINSTALL.
- Payload pattern: `{"type":"<EventType>","timestamp":"...","webhookId":"...","data":{...}}`.
- Signatures: `X-GHL-Signature` (Ed25519, current); legacy `X-WH-Signature` (RSA-SHA256) **deprecated July 1, 2026**.
- Delivery retries: 429 → up to 7 attempts ~10min apart; other non-2xx → exponential backoff up to 3 days; >10k webhooks in 3 days with <90% success → app's webhooks paused.
- Requires an approved OAuth Marketplace app with webhooks in its Advanced Settings — out of scope. Push needs are a product decision (build a marketplace app), not a chat action.

## Polling: the only change-detection pattern

No documented server-side `updatedAt >=` filter for the core lists [UNVERIFIED — search endpoints may support date filters; shapes unpinned].

### Cursor-walk + client-side-date recipe

```
numa integrations request gohighlevel GET "/contacts/?locationId={loc}&limit=100" --headers '{"Version":"2021-07-28"}' -m "poll contacts"
```

1. Keep a `last_synced_at` watermark per entity (ISO UTC) in a workspace file.
2. Page the list with `limit=100` + `startAfter`/`startAfterId` from `meta`.
3. Compare each record's update timestamp (likely `dateUpdated` — confirm the actual field name on page 1 [UNVERIFIED]) against the watermark client-side; collect newer records.
4. Stop early if the list is ordered most-recent-first — verify ordering empirically on page 1 first [UNVERIFIED]; if unclear, drain all pages.
5. Update the watermark to the max timestamp seen, only after processing succeeds.
6. Dedupe by `id` across runs.
   If `/contacts/search` (or `/opportunities/search`, `/conversations/search`) turns out to accept date filters once validated, switch and note it.

### Cadence guidance

Limits unknown — budget by observation, not math:

- **In chat: poll on demand only.** "What's new?" → one walk from the watermark. No timers in chat.
- **Standing syncs belong in Numa scheduled agents** — every 15–60 min per entity is a sane start; ~1 request/sec inside a run (community: 1000ms between pages).
- The first 429 defines the real ceiling — halve pacing and remember it for the session.

## Rate limits — unknown by design

- No public numeric thresholds in official docs or community sources. **Do not quote numbers to the user.**
- 429 is documented as the breach signal — the only authoritative source of rate-limit truth.
- Check 429 responses for `Retry-After` / `X-RateLimit-*` headers — presence [UNVERIFIED]; honour them if they appear and report their existence.
- Conservative defaults: sequential, ~1/sec, `limit=100` to minimise page count, no speculative refreshes.

### Backoff ladder for 429

```
attempt 1: wait 2s
attempt 2: wait 10s
attempt 3: wait 30s
→ then stop, tell the user GoHighLevel is rate-limiting, halve pacing for the session
```

[UNVERIFIED — recommended; no documented windows to align with]

## Error response format — unknown

Raw error JSON structure is undocumented and was never observed live [top risk]. The SDK wraps errors as `GHLError {message, statusCode, response, request}`, implying a parseable body, but do not assume a shape:

1. Read the **HTTP status code first** — it is the contract.
2. Surface the response body **verbatim** — don't paraphrase away detail, don't invent fields like `error.message`.
3. When you DO see real error bodies, note their shape — the first live session resolves this unknown.

## Recovery playbook

| Status | Meaning                                                                      | Retryable? | Action                                                                                                                                             |
| ------ | ---------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | malformed — bad JSON, missing Version header, missing locationId, bad params | No         | fix and re-issue; check Version + locationId first                                                                                                 |
| 401    | bad/rotated/revoked PIT                                                      | No         | user reconnects via the chat credential card. Rotation in HighLevel kills the old PIT immediately                                                  |
| 403    | PIT missing a scope for that endpoint family                                 | No         | user edits/recreates the Private Integration (Settings → Private Integrations) with the named scope, then reconnects. Name the scope (01a mapping) |
| 404    | wrong id/path, or resource in another location                               | No         | verify id, exact documented path, and that the record belongs to THIS location                                                                     |
| 422    | validation (field values)                                                    | No         | fix values — phone E.164, restricted `country` list, enum values; quote the body                                                                   |
| 429    | rate limited — thresholds unknown                                            | Yes        | backoff ladder above; honour `Retry-After` if present [UNVERIFIED]                                                                                 |
| 5xx    | server error                                                                 | Once       | retry once after 5s; for writes, verify first whether it landed (below)                                                                            |

### 401 vs 403 — different fixes

- **401 → credential problem.** PIT wrong/rotated/revoked. Fix is **reconnect via the chat card**. Re-adding scopes won't help.
- **403 → scope problem.** PIT valid but not granted that permission at creation. Fix is **in HighLevel** (edit the Private Integration's scopes), then reconnect so Numa stores any regenerated token. Re-entering the same token won't help. Never tell the user to "check their token" on a 403 — name the missing scope.

### Timeouts / unknown outcomes on writes

A timeout says nothing about whether the write landed. No idempotency keys [UNVERIFIED]. Before re-sending a POST:

1. **Contacts:** re-run as `POST /contacts/upsert` — the documented dedupe-safe write.
2. **Other entities:** search/list for the would-be record (name, contactId, timestamps) and only re-POST if genuinely absent.
3. **PUTs:** safe to repeat with the same body — re-GET first if time has passed, and remember partial-vs-replace semantics [UNVERIFIED] (01c Pattern 8).
4. **Messages (`/conversations/messages`): never blind-retry** — a duplicate is a duplicate text/email to a real person. Check the conversation's messages first.

## Scheduled sync recipe (Numa scheduled agent)

For standing "tell me what changed" requests, move the polling loop into a scheduled agent and persist state:

```
1. Read watermarks.json from /workdir
   (e.g. {"contacts":"2026-06-09T00:00:00Z","opportunities":"2026-06-09T00:00:00Z"});
   if absent, initialise to a sensible backstop (e.g. 7 days ago) — NOT epoch zero, or run 1 is a
   full-book scan against unknown rate limits.
2. For each entity:
   a. Cursor-walk the list (limit=100, startAfter/startAfterId from meta) with the Version header.
   b. Client-side filter on the update-timestamp field identified in the first live session.
   c. Stop early if ordering allows (verified newest-first), else drain pages.
   d. ~1s between requests; abort the run cleanly on a persistent 429.
3. Process/report the changed records.
4. Write new high-water marks back ONLY after processing succeeds — a crashed run safely re-reads the
   same window next time (dedupe by id).
```

Operational guidance, not an API feature — cursor mechanics are documented; update-timestamp filtering is [UNVERIFIED] until the field name is confirmed live.

## Resolving the known unknowns

First real sessions should close these; state the finding explicitly when you hit it.
| Unknown | How it resolves |
| --- | --- |
| Error body JSON shape | first 4xx you receive — quote it |
| Rate limit numbers / headers | first 429 — check for `Retry-After` / `X-RateLimit-*` |
| `/contacts/search` request shape | first successful search call (01b Pattern 3 probe order) |
| Contact update-timestamp field name | first contact GET (look for `dateUpdated`-like keys) |
| List sort order | first page of each list |
| PUT partial-vs-replace semantics | first contact update — GET after and compare untouched fields |
| Single-record envelope per entity | first GET of each entity type |

## The MCP server — future second surface

Official MCP server at `https://services.leadconnectorhq.com/mcp/` — PIT auth (`Authorization: Bearer pit-...`), HTTP Streamable transport, 36 tools (contacts, conversations, opportunities, calendars, payments, blogs, social, email templates); roadmap 250+. The same PIT the Numa connector stores would work there. Today, **use this REST connector**. Do not call `/mcp/` via the request operation now (streaming transport, unvalidated) [UNVERIFIED].

## Connection health check

When errors look auth-shaped or "GoHighLevel isn't working":

```
# Probe 1 — is the PIT valid at all? (needs View Locations scope)
numa integrations request gohighlevel GET /locations/search --headers '{"Version":"2021-07-28"}' -m "health probe"
# Probe 2 — does it have the core CRM scope?
numa integrations request gohighlevel GET "/contacts/?locationId={loc}&limit=1" --headers '{"Version":"2021-07-28"}' -m "scope probe"
```

| Outcome                      | Diagnosis                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| Both 200                     | healthy — the original failure is endpoint/scope/payload-specific                            |
| Probe 1 → 401                | PIT dead (rotated/revoked) — reconnect via chat card                                         |
| Probe 1 → 403                | PIT lacks even View Locations — created with too few scopes; recreate with the 01a checklist |
| Probe 1 → 200, Probe 2 → 403 | valid token, missing contacts scope — add it in Private Integrations                         |
| Probe 1 → 200, Probe 2 → 400 | likely locationId/param issue, not auth — re-check the id from Probe 1                       |

## Counter-exception handling

1. **First suspect on ANY 4xx: the Version header.** A missing Version header is this connector's signature failure mode.
2. **403 mid-session on a new endpoint family** = scope gap, not a broken connection. Everything that worked keeps working.
3. **401 after earlier success** = the PIT was rotated/revoked in HighLevel between calls. Stop, reconnect via the chat card, resume.
4. **Empty page with 200 is not an error** — end of data or no matches. Stop paging.
5. **A 404 on an id the user gave you** may mean it lives in a different location than the PIT's — say so rather than declaring it nonexistent [UNVERIFIED, structural inference].
6. **429 with unknown limits:** never promise "we'll be fine after N seconds" — back off, observe, adapt pacing for the session.
7. **Response shape contradicts these docs:** trust the live response, surface it verbatim, note the discrepancy.
8. **User asks for real-time/webhooks:** explain the PIT limitation, offer a Numa scheduled agent running the polling recipe.

## Output formatting

| Situation      | What to tell the user                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contact        | "Jane Smith (jane.smith@acme.co.nz, +64 9 555 1234) — tags: vip, newsletter"                                                                                 |
| Opportunity    | "Acme renewal — Sales pipeline / Proposal stage, open, $12,000" (map stage ids to names via pipelines)                                                       |
| List results   | first 10 records + "at least N" phrasing unless you drained all pages                                                                                        |
| 403            | "Your GoHighLevel Private Integration is missing the '<scope>' permission. Edit it under Settings → Private Integrations in HighLevel, then reconnect here." |
| 401            | "Your GoHighLevel token is no longer valid (it may have been rotated). Please reconnect via the connection card."                                            |
| 429            | "GoHighLevel is rate-limiting requests (it doesn't publish limits) — I've slowed down and will retry."                                                       |
| Unknown errors | quote the status code and body verbatim — the error format is undocumented, so the raw text is the most useful thing                                         |
| Real-time asks | "This connection can't receive GoHighLevel webhooks (they require a marketplace app). I can set up a scheduled check instead."                               |

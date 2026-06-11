---
api_name: 'GoHighLevel'
api_slug: 'gohighlevel'
version: 'API 2.0 (services.leadconnectorhq.com)'
generated_from: '00-api-investigation (GoHighLevel, 2026-05-04) + official marketplace docs'
generated_date: '2026-06-10'
update_source: 'Docs-only investigation 2026-05-04 — no live API calls made'
line_count_target: '< 300 lines'
---

# GoHighLevel -- Workspace Agent API Rules

> ⚠️ **Docs-derived — NOT yet live-validated through the Numa connector path.**
>
> **This file is loaded into the workspace agent's context when the GoHighLevel integration is active.**
> It must stay under 300 lines. Companion files (01a–01d) contain the detailed reference material.
> Facts are tagged [DOCS] (official docs / SDK README, investigation 2026-05-04) or [UNVERIFIED] (inferred).
> Never claim live-confirmed behaviour — nothing here has been exercised with real credentials.

## Context

- **API:** GoHighLevel (HighLevel) API 2.0 — CRM + marketing platform: contacts, conversations (SMS/email), opportunities/pipelines, calendars, payments, workflows [DOCS]
- **Base URL:** `https://services.leadconnectorhq.com` — configured in Numa; use **relative URLs** like `/contacts/...`. (API 1.0 at `rest.gohighlevel.com` is legacy — never use it.) [DOCS]
- **Auth:** Private Integration Token (PIT, `pit-...`) sent as `Authorization: Bearer` — **injected automatically by Numa. Never set it.**
- **Integration path:** Data Connector — call via the `connectors` MCP tool, `request` operation
- **Rate limits:** numeric thresholds **publicly undocumented** — treat any 429 as authoritative and back off [DOCS — limits searched, not found]
- **Field casing:** camelCase (`firstName`, `locationId`, `startAfterId`) [DOCS]
- **ID format:** opaque strings (e.g. locationId `110411007T`) [DOCS]

## How to Call

```
connectors(name="request", params={
  "connector": "gohighlevel",
  "url": "/contacts/?locationId=ve9EPM428h8vShlRW1KT&limit=100",
  "method": "GET",
  "headers": {"Version": "2021-07-28"}
})
```

Two headers matter on EVERY request:

1. **`Authorization: Bearer pit-...`** — Numa injects this from the user's vault. **NEVER set it yourself; you never see the token.**
2. **`Version`** — Numa auto-injects `Version: 2021-07-28` on every request (admin-configured static header), so plain calls work without it. **Override it per call** via `headers: {"Version": "2023-02-21"}` for endpoint families pinned to a different version (contacts — see below); your per-call header wins.

POST/PUT: pass JSON in `body` (single objects, not arrays). `Content-Type: application/json` [DOCS].

## The `Version` Header

- Required on every API 2.0 call; it selects the response schema [DOCS].
- Documented values: `2023-02-21` (current), `2021-07-28`, `2021-04-15` (legacy, supported) [DOCS].
- **Default to `2021-07-28`** — it is the value shown in the MCP/SDK examples and works across endpoint families [DOCS]. The contacts docs are written against `2023-02-21`; if a contacts response looks wrong under `2021-07-28`, retry with `{"Version": "2023-02-21"}` [UNVERIFIED which differences exist].
- A missing/invalid `Version` is expected to surface as 400/401-class errors [UNVERIFIED — error body unknown]. If an otherwise-correct call fails oddly, check the header first.

## `locationId` — The Tenant Key

GoHighLevel is multi-tenant: **Agency (company) → Locations (sub-accounts)**. A PIT is created inside ONE location and scoped to it [DOCS].

- `locationId` is **required on most list/search endpoints** as a query param (and in many write bodies) [DOCS].
- **Discover it first:** `GET /locations/search` (with the Version header) lists locations visible to the token [DOCS]. Cache the id for the session; ask the user which location if several come back.
- Missing `locationId` → expect a 4xx validation error [UNVERIFIED format].

## Auth Structure

PIT = long-lived token created in HighLevel → **Settings → Private Integrations → Create New Integration**; scopes are selected at creation time [DOCS].

- **403 = the PIT lacks a scope.** Not bad credentials. The user (or their admin) must edit/recreate the Private Integration in HighLevel with the missing scope (e.g. "View Contacts", "Edit Opportunities"), then reconnect. Name the operation so they know which scope to add. Do not retry. [DOCS]
- **401 = bad, rotated, or revoked PIT.** Tokens can be rotated in the same settings screen; the old token dies immediately. The user reconnects GoHighLevel via the chat credential card. Do not retry. [DOCS]
- OAuth2 marketplace apps exist (24h access tokens + refresh) but are NOT this connector's auth path — see 02-api-spec-investigation [DOCS].

## Capabilities

### CAN

1. Read + write contacts: CRUD, upsert, tags, tasks, notes, search [DOCS]
2. Read + update opportunities; read pipelines/stages [DOCS]
3. Read conversations + messages; send a new message (SMS/email) into a thread [DOCS]
4. Read calendars, calendar events, appointment notes [DOCS]
5. Read payments: orders, transactions [DOCS]
6. Read locations (sub-accounts), users, custom fields, forms, surveys, workflows [DOCS]
7. Page any list with `limit` (max 100) + `startAfter`/`startAfterId` cursors [DOCS]

### CANNOT

1. Receive webhooks — webhooks require an OAuth **Marketplace app**; PIT auth gets none. **Polling only.** [DOCS]
2. Exceed 100 records per page (default 20) [DOCS]
3. Call anything the PIT wasn't scoped for at creation (→ 403) [DOCS]
4. Know the numeric rate limits — undocumented; treat 429 as the only signal [DOCS]
5. Use API 1.0 (`rest.gohighlevel.com`) — deprecated legacy surface [DOCS]
6. Confirm exact runtime response shapes — **nothing validated live yet**; trust what the API actually returns over this file

## Critical Gotchas

1. **The `Version` header is auto-injected (`2021-07-28`) by Numa's static-header config.** If a connector was configured before that landed (admin hasn't re-saved the wizard), inject it yourself: `headers: {"Version": "2021-07-28"}`. Adding it explicitly is always safe — per-call headers win. [DOCS]
2. **`locationId` is required on most list endpoints.** Resolve it via `GET /locations/search` before anything else; don't guess. [DOCS]
3. **403 ≠ bad credentials.** It means a missing PIT scope — fix is in HighLevel Settings → Private Integrations, not re-entering the token. [DOCS]
4. **`GET /contacts/` is officially deprecated** in favour of `/contacts/search` — it still works and is the documented cursor-pagination path; prefer it for full listing until search is validated, but expect eventual removal. [DOCS]
5. **Pagination cursors come from `meta`** — pass BOTH `startAfter` (epoch ms) and `startAfterId` from the previous response. Page until no cursor / empty page. [DOCS]
6. **Trailing slash:** documented list paths are `/contacts/`, `/conversations/...` — copy paths exactly as documented; slash-sensitivity is [UNVERIFIED].
7. **Phone numbers should be E.164** (`+15551234567`) on contact writes [UNVERIFIED — community best practice].
8. **Upsert dedupe depends on the location's "Allow Duplicate Contact" setting** — email/phone match priority is configured per location, so upsert may update a different record than you expect. [DOCS]
9. **Error body format is unknown** — read the HTTP status first, surface the body verbatim. [DOCS — flagged needs-testing]
10. **Official MCP server exists** at `https://services.leadconnectorhq.com/mcp/` (PIT auth, 36 tools) — a possible future second surface for Numa via `mcp_call`; today, use this REST connector. [DOCS]

## Default Parameters

| Parameter      | Default                                  | Reason                                  |
| -------------- | ---------------------------------------- | --------------------------------------- |
| `Version`      | `2021-07-28` (header, every call)        | SDK/MCP example value [DOCS]            |
| `locationId`   | from `GET /locations/search`, cached     | Required on most lists [DOCS]           |
| `limit`        | 20 (API default); use 100 for bulk reads | Max 100 [DOCS]                          |
| `startAfter` / `startAfterId` | omit on first page; then from `meta` | Cursor pagination [DOCS]   |
| Pacing         | ≥ 1 call/sec, sequential                 | Limits unknown — be conservative [UNVERIFIED] |

## Working Examples

### Example 1: Resolve the location, then list contacts

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/locations/search", "headers": {"Version": "2021-07-28"}})

connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/contacts/?locationId=ve9EPM428h8vShlRW1KT&limit=100",
  "headers": {"Version": "2021-07-28"}})
```

Response: `{ "contacts": [...], "meta": { ... "startAfter": ..., "startAfterId": ... } }` [DOCS].

### Example 2: Next page (both cursors)

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/contacts/?locationId=ve9EPM428h8vShlRW1KT&limit=100&startAfter=1717977600000&startAfterId=ocQHyuzHvysMo5N5VsXc",
  "headers": {"Version": "2021-07-28"}})
```

### Example 3: Create a contact

```
connectors(name="request", params={"connector": "gohighlevel", "method": "POST",
  "url": "/contacts/", "headers": {"Version": "2021-07-28"},
  "body": {"locationId": "ve9EPM428h8vShlRW1KT", "firstName": "Jane", "lastName": "Smith",
           "email": "jane.smith@acme.co.nz", "phone": "+6495551234"}})
```

Response: `{ "contact": { "id": "...", ... } }` [DOCS — wrapper inferred from SDK]. Capture the `id`.

### Example 4: Pipelines, then update an opportunity

```
connectors(name="request", params={"connector": "gohighlevel", "method": "GET",
  "url": "/opportunities/pipelines?locationId=ve9EPM428h8vShlRW1KT",
  "headers": {"Version": "2021-07-28"}})

connectors(name="request", params={"connector": "gohighlevel", "method": "PUT",
  "url": "/opportunities/{opportunityId}", "headers": {"Version": "2021-07-28"},
  "body": {"pipelineStageId": "...", "status": "won"}})
```

Field names on the PUT body are [UNVERIFIED] — GET the opportunity first and mirror its field names.

## Proxy API Operations (documented core set)

All paths relative to base; **every call needs the `Version` header**. Full catalog in 01a. [DOCS]

| Operation               | Method | Path                              | Notes                                   |
| ----------------------- | ------ | --------------------------------- | --------------------------------------- |
| Search locations        | GET    | /locations/search                 | Do this FIRST — resolves `locationId`   |
| Get location            | GET    | /locations/{locationId}           |                                         |
| List contacts           | GET    | /contacts/?locationId=...         | Deprecated-but-documented; cursor paging |
| Search contacts         | —      | /contacts/search                  | Preferred per docs; request shape [UNVERIFIED] — see 01b |
| Get / update / delete contact | GET/PUT/DELETE | /contacts/{contactId} |                                         |
| Create contact          | POST   | /contacts/                        | `locationId` in body                    |
| Upsert contact          | POST   | /contacts/upsert                  | Dedupe per location settings            |
| Add / remove tags       | POST/DELETE | /contacts/{contactId}/tags   | Body: `{"tags": [...]}` [UNVERIFIED]    |
| Contact tasks           | GET    | /contacts/{contactId}/tasks       |                                         |
| Search opportunities    | GET    | /opportunities/search             | `location_id` param casing [UNVERIFIED] |
| Get / update opportunity| GET/PUT| /opportunities/{id}               |                                         |
| Get pipelines           | GET    | /opportunities/pipelines          | Stage ids for opportunity moves         |
| Search conversations    | GET    | /conversations/search             |                                         |
| Get messages            | GET    | /conversations/{id}/messages      |                                         |
| Send message            | POST   | /conversations/messages           | SMS/Email into a thread — confirm with user first |
| Calendar events         | GET    | /calendars/events                 | Requires userId, groupId, or calendarId |
| Payments                | GET    | /payments/orders/{id}, /payments/transactions | Read-only scopes        |

## Pagination

- **Cursor (keyset):** `limit` (default 20, max 100) + `startAfter` (epoch ms) + `startAfterId` (record id) [DOCS]
- Next-page cursors arrive in `meta.startAfter` / `meta.startAfterId`; **stop when they are absent/null or a page comes back empty** [DOCS; stop condition [UNVERIFIED]]
- No total-count guarantees — phrase results as "at least N" unless you paged to the end

## Error Handling

Error **body format is unknown** ([DOCS — never observed live]) — status code is the contract; quote bodies verbatim.

| Status | Meaning                                | Action                                                              |
| ------ | -------------------------------------- | ------------------------------------------------------------------- |
| 400    | Bad request / validation / missing param | Check `Version` header, `locationId`, body fields; do NOT retry unchanged |
| 401    | Bad/rotated/revoked PIT (or bad Version) [UNVERIFIED split] | Reconnect via chat credential card; do not retry |
| 403    | PIT missing a scope                    | User adds the scope in Settings → Private Integrations; do not retry |
| 404    | Wrong id or path                       | Verify entity id and exact documented path                          |
| 422    | Unprocessable entity (validation)      | Fix field values (e.g. phone format, country values); don't retry unchanged |
| 429    | Rate limited (thresholds unknown)      | Back off 2s → 10s → 30s → stop; reduce pacing for the rest of the session |
| 5xx    | Server error                           | Retry once after 5s; for writes, check first whether it landed      |

## Known Limitations

1. **Nothing live-validated through Numa** — request/response shapes are docs-derived; trust actual responses over this file and note discrepancies
2. **No webhooks on PIT auth** — change detection is polling only (see 01d)
3. **Rate limits and error bodies undocumented** — fly conservatively
4. **`/contacts/search` request shape not pinned down** — the safe documented read path is `GET /contacts/` with cursors
5. **PIT is location-scoped** — agency-wide operations (other locations' data) will 403/404; one connection ≈ one location
6. No OpenAPI spec is publicly fetchable (swagger.json returns empty) [DOCS]

---

_Generated 2026-06-10 from the 2026-05-04 docs investigation. See companion files:_

- _01a-domain-model-reference.md — Entity catalog, hierarchy, fields, scopes_
- _01b-query-patterns.md — locationId discovery, pagination, search patterns_
- _01c-mutation-patterns.md — Create/upsert/update/delete patterns_
- _01d-event-and-error-handling.md — Polling (no webhooks on PIT), 429/error recovery_

---
api_name: GoHighLevel
api_slug: gohighlevel
base_url: https://services.leadconnectorhq.com
url_form: relative path against base_url (e.g. /contacts/); backend expands it
path_version_segment: none (no /v1/ etc.; API version is the Version HEADER, never a path)
legacy_host_never_use: rest.gohighlevel.com (API 1.0, deprecated)
auth: Bearer PIT (pit-...) — injected by backend; agent NEVER sets Authorization
required_header: Version (mandatory every call; BACKEND-INJECTED as 2021-07-28 via static_headers — agent need not set it; override per-call to 2023-02-21 only to pin the newest contacts schema)
field_casing: camelCase
id_format: opaque strings (e.g. locationId 110411007T) — never parse/synthesize
tenant_key: locationId (required on most list/search + many write bodies)
rate_limit: PUBLISHED — burst 100 req/10s + 200,000 req/day, per resource (location/company); 429 on breach with X-RateLimit-* headers. 429 is still the authoritative live signal — honour it over the static numbers. [DOCS marketplace.gohighlevel.com]
call_surface: HTTP via `numa integrations request gohighlevel <METHOD> <URL> [--headers '{"Version":"2023-02-21"}'] [--body '{...}']`. Version is backend-injected; --headers only needed to override it. NOT a file-store connector — does NOT support list-files/search-files/download-file.
confidence: every fact docs-derived from the 2026-05-04 investigation [DOCS], NOT live-validated through Numa; non-default markers [UNVERIFIED]/[INFERRED] inline. Trust real responses over this file; note discrepancies.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# GoHighLevel — API Rules

GoHighLevel (HighLevel) API 2.0 — CRM + marketing: contacts, conversations (SMS/email/call), opportunities/pipelines, calendars, payments, workflows.

## How to call

```
numa integrations request gohighlevel GET "/contacts/?locationId=ve9EPM428h8vShlRW1KT&limit=100" -m "list contacts"
numa integrations request gohighlevel POST /contacts/ --body '{"locationId":"ve9EPM428h8vShlRW1KT","firstName":"Jane","email":"jane@acme.co"}' -m "create contact"
```

- URL = relative path (`/contacts/...`); backend prepends base_url. No version segment — `/v1/...` does NOT exist.
- `Authorization: Bearer pit-...` is backend-injected from the user's vault. NEVER set it; you never see the token.
- `Version` is **backend-injected** as `2021-07-28` (the connector's `static_headers`). You do NOT need to add it. Pass `--headers '{"Version":"2023-02-21"}'` ONLY to override it for a call (per-call value wins).
- POST/PUT body = single JSON object (no arrays). `--body '{...}'` or ad-hoc `--field value` flags (auto-camelized).

## The Version header

- Selects the response schema. Required on every call — but the backend supplies it for you (`2021-07-28` via `static_headers`), so it is never your job to remember it.
- Values: `2023-02-21` (newest), `2021-07-28` (the injected default; works across families), `2021-04-15` (legacy, supported).
- **Default `2021-07-28`** — injected automatically. Contacts has a newer `2023-02-21` schema; if a contacts response looks wrong, override with `--headers '{"Version":"2023-02-21"}'` [UNVERIFIED which response differences exist].
- You will not normally produce a missing-Version 4xx because the backend always sends it. If you ever DO see a Version-shaped 4xx, it means your `--headers` override sent a bad value — drop the override and let the default ride.

## locationId — the tenant key

Multi-tenant: Agency (company) → Locations (sub-accounts). A PIT is created inside ONE location, scoped to it.

- Required on most list/search endpoints (query param) and many write bodies.
- **Resolve first:** `GET /locations/search` lists locations the token sees. Cache for the session; ask the user if several return. Other locations' data → 403/404.
- Missing locationId → 4xx [UNVERIFIED format].

## Auth structure

PIT = long-lived token from HighLevel → Settings → Private Integrations → Create New Integration; scopes chosen at creation.

- **403 = missing scope** (NOT bad credentials). User edits/recreates the Private Integration with the needed scope (e.g. "View Contacts", "Edit Opportunities"), then reconnects. Name the scope. Do not retry.
- **401 = bad/rotated/revoked PIT.** Rotation kills the old token immediately. User reconnects via the chat credential card. Do not retry.
- OAuth2 marketplace apps exist (24h tokens + refresh) but are NOT this connector's path — see 02.

## CAN

1. Contacts: CRUD, upsert, tags, tasks, notes, search.
2. Opportunities: read + update; read pipelines/stages.
3. Conversations + messages: read; send a message (SMS/email) into a thread.
4. Calendars, calendar events, appointment notes (read).
5. Payments: orders, transactions (read).
6. Locations, users, custom fields, forms, surveys, workflows (read).
7. Page any list: `limit` (max 100) + `startAfter`/`startAfterId` cursors.

## CANNOT

1. Receive webhooks — they require an OAuth Marketplace app; PIT gets none. **Polling only.**
2. Exceed 100 records/page (default 20).
3. Call anything the PIT wasn't scoped for (→ 403).
4. Beat the published rate limits — burst 100 req/10s and 200,000/day per location; a 429 is the live ceiling, back off.
5. Use API 1.0 (`rest.gohighlevel.com`).

## Critical gotchas

1. **Version header is required but backend-injected** (`2021-07-28`) — you do not pass it; only override via `--headers` to pin a newer schema (`2023-02-21` for contacts). A Version-shaped 4xx means your override value is wrong.
2. **locationId required on most lists.** Resolve via `GET /locations/search` first; don't guess.
3. **403 ≠ bad credentials** — missing PIT scope. Fix in HighLevel Settings → Private Integrations, not by re-entering the token.
4. **`GET /contacts/` is deprecated** in favour of `/contacts/search` — still works, is the documented cursor-pagination path; prefer for full listing until search shape is validated; expect eventual removal.
5. **Pagination cursors come from `meta`** — pass BOTH `startAfter` (epoch ms) and `startAfterId` from the previous response. Page until no cursor / empty page.
6. **Phone numbers → E.164** (`+15551234567`) on contact writes [UNVERIFIED — community best practice].
7. **Upsert dedupe depends on the location's "Allow Duplicate Contact" setting** — email/phone match priority is per-location, so upsert may update a different record than expected.
8. **Error body format unknown** [needs-testing] — read the HTTP status first, surface the body verbatim.
9. **Official MCP server** at `https://services.leadconnectorhq.com/mcp/` (PIT auth, 36 tools) — possible future second surface; today use this REST connector. Do not call `/mcp/` via `request`.
10. **`country` values are restricted** — see marketplace.gohighlevel.com/docs/other/country.

## Default parameters (override only if the user specifies)

| Param                     | Default                                  | Reason                                                      |
| ------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| Version                   | 2021-07-28 (backend-injected; don't set) | static_headers default; override only to pin a newer schema |
| locationId                | from `GET /locations/search`, cached     | required on most lists                                      |
| limit                     | 20 (API default); use 100 for bulk reads | max 100                                                     |
| startAfter / startAfterId | omit on page 1; then from `meta`         | cursor pagination                                           |
| Pacing                    | sequential, well under 100 req/10s       | published burst limit; a 429 is the live ceiling            |

## Core operations (full catalog in 01a)

| Operation                 | Method         | Path                                          | Notes                                                    |
| ------------------------- | -------------- | --------------------------------------------- | -------------------------------------------------------- |
| Search locations          | GET            | /locations/search                             | FIRST — resolves locationId                              |
| Get location              | GET            | /locations/{locationId}                       |                                                          |
| List contacts             | GET            | /contacts/?locationId=...                     | deprecated-but-documented; cursor paging                 |
| Search contacts           | —              | /contacts/search                              | preferred per docs; request shape [UNVERIFIED] — see 01b |
| Get/update/delete contact | GET/PUT/DELETE | /contacts/{contactId}                         |                                                          |
| Create contact            | POST           | /contacts/                                    | locationId in body                                       |
| Upsert contact            | POST           | /contacts/upsert                              | dedupe per location settings                             |
| Add/remove tags           | POST/DELETE    | /contacts/{contactId}/tags                    | body `{"tags":[...]}` [UNVERIFIED]                       |
| Contact tasks             | GET            | /contacts/{contactId}/tasks                   |                                                          |
| Search opportunities      | GET            | /opportunities/search                         | `location_id` casing [UNVERIFIED]                        |
| Get/update opportunity    | GET/PUT        | /opportunities/{id}                           |                                                          |
| Get pipelines             | GET            | /opportunities/pipelines                      | stage ids for moves                                      |
| Search conversations      | GET            | /conversations/search                         |                                                          |
| Get messages              | GET            | /conversations/{id}/messages                  |                                                          |
| Send message              | POST           | /conversations/messages                       | REAL SMS/email — confirm with user first                 |
| Calendar events           | GET            | /calendars/events                             | requires userId, groupId, OR calendarId                  |
| Payments                  | GET            | /payments/orders/{id}, /payments/transactions | read-only scopes                                         |

## Pagination

Cursor/keyset: `limit` (default 20, max 100) + `startAfter` (epoch ms) + `startAfterId` (record id). Next-page cursors arrive in `meta.startAfter`/`meta.startAfterId`. Stop when cursors absent/null OR a page returns empty. No total-count guarantee — phrase results "at least N" unless paged to the end. Envelope: `{"<collection>":[...],"meta":{...}}` (e.g. `contacts`).

## Errors

Body format unknown — status code is the contract; quote bodies verbatim.
| Status | Meaning | Action |
| --- | --- | --- |
| 400 | bad request / validation / missing param | check Version, locationId, body fields; do NOT retry unchanged |
| 401 | bad/rotated/revoked PIT (or bad Version) [UNVERIFIED split] | reconnect via chat credential card; do not retry |
| 403 | PIT missing a scope | user adds scope in Settings → Private Integrations; do not retry |
| 404 | wrong id or path (or record in another location) | verify entity id + exact documented path |
| 422 | unprocessable (field validation) | fix values (phone E.164, country); don't retry unchanged |
| 429 | rate limited (burst 100/10s or 200k/day) | check `Retry-After`/`X-RateLimit-*`; back off 2s→10s→30s→stop; reduce pacing for the session |
| 5xx | server error | retry once after 5s; for writes, check first whether it landed |

## Examples

(The Version header is backend-injected — none of these set it. Add `--headers '{"Version":"2023-02-21"}'` only to pin the newer contacts schema.)

1. Resolve location, then list contacts:

```
numa integrations request gohighlevel GET /locations/search -m "find location"
numa integrations request gohighlevel GET "/contacts/?locationId=ve9EPM428h8vShlRW1KT&limit=100" -m "list contacts"
```

→ `{"contacts":[...],"meta":{"startAfter":...,"startAfterId":...}}`

2. Next page (BOTH cursors):

```
numa integrations request gohighlevel GET "/contacts/?locationId=ve9EPM428h8vShlRW1KT&limit=100&startAfter=1717977600000&startAfterId=ocQHyuzHvysMo5N5VsXc" -m "next page"
```

3. Create a contact:

```
numa integrations request gohighlevel POST /contacts/ --body '{"locationId":"ve9EPM428h8vShlRW1KT","firstName":"Jane","lastName":"Smith","email":"jane.smith@acme.co.nz","phone":"+6495551234"}' -m "create contact"
```

→ `{"contact":{"id":"...",...}}` [wrapper inferred from SDK]. Capture the `id`.

4. Pipelines, then update an opportunity (mirror field names from a GET first — PUT body names are [UNVERIFIED]):

```
numa integrations request gohighlevel GET "/opportunities/pipelines?locationId=ve9EPM428h8vShlRW1KT" -m "list pipelines"
numa integrations request gohighlevel PUT /opportunities/{opportunityId} --body '{"pipelineStageId":"...","status":"won"}' -m "move deal"
```

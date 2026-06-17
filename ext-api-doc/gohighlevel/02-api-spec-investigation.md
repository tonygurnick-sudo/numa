---
api_name: GoHighLevel API (API 2.0)
api_slug: gohighlevel
base_url: https://services.leadconnectorhq.com
path_version_segment: none — API version is selected by the required Version HEADER (2023-02-21 current; 2021-07-28 / 2021-04-15 supported), NEVER a path segment
legacy_host_never_use: rest.gohighlevel.com (API 1.0, deprecated)
auth: Bearer PIT (pit-...) primary; OAuth 2.0 alternative (not built)
spec_format: none (no public OpenAPI/Swagger; /swagger.json returns empty; interactive docs portal only)
docs_url: https://marketplace.gohighlevel.com/docs/
call_surface: HTTP via `numa integrations request gohighlevel <METHOD> <URL> --headers '{"Version":"..."}'`. NOT a file source — list_files/download_file do not apply.
confidence: docs-derived [DOCS] from the 2026-05-04 investigation; NO authenticated call was made. Error bodies + rate limits UNKNOWN (§Known Unknowns). Verify against a real PIT before first customer use.
---

# GoHighLevel — API Spec & Investigation

Developer reference for the GoHighLevel (HighLevel) REST API — condensed from `00-api-investigation-questionnaire.md` + the official developer portal, OAuth/webhook/MCP guides, and the SDK README (the host blocks headless fetches, so this is docs-derived; see frontmatter `confidence`).

## Overview

HighLevel Inc. — all-in-one CRM + marketing platform (contacts, conversations, pipelines, calendars, payments, workflows, social, funnels, invoices). REST/JSON, single shared SaaS host. 28+ endpoint families. Every call carries `Authorization: Bearer ...` + `Version`; almost every call is scoped by `locationId`. (Auth → §Authentication; headers → §Required headers; pagination, rate limits, webhooks, MCP → their sections.)

**Numa integration model:** Native data connector (`authType: token`, NOT Pipedream). The workspace agent calls `numa integrations request gohighlevel GET "/contacts/search?locationId=...&limit=100" --headers '{"Version":"2021-07-28"}'`. The backend expands the relative URL against `base_url` and injects `Authorization: Bearer <PIT>` from the user's personal vault (`connector-gohighlevel`, field `api_key`). The agent never sees the token but **must add the Version header itself** (a constant, not a secret). See 03.

## Authentication

Bearer token — Private Integration Token (primary) or OAuth 2.0 (alternative).

```
Authorization: Bearer pit-xxxxxxxx-...
Version: 2021-07-28
```

**Private Integration Token (PIT) — the Numa path:**

- Created in HighLevel: Settings → Private Integrations → Create New Integration.
- **Scopes chosen at creation** — human-readable checkboxes ("View Contacts", "Edit Contacts", …); calls outside the granted scopes return **403**.
- Issued **per sub-account (location)**; full access to its scopes within that location.
- `pit-` prefix; **long-lived** — no expiry, no refresh; rotated/revoked manually (→ 401 until re-entered).

**OAuth 2.0 (Authorization Code) — documented alternative, not built:**
| Parameter | Value |
| --- | --- |
| Grant type | authorization_code (+ refresh_token) |
| App registration | marketplace.gohighlevel.com (developer portal) |
| Token URL | `POST https://services.leadconnectorhq.com/oauth/token` |
| Location exchange | `POST /oauth/locationToken` (agency token → location token; needs `Version: 2021-07-28`) |
| Access token life | ~24h (`expires_in: 86399`) |
| Refresh token | 1 year or until used; each use issues a new refresh token; refresh body form-urlencoded |
| Token types | Agency (`userType:"Company"`) vs Location (`userType:"Location"`) |
| Scope lock | marketplace app scopes editable only in **draft** — locked once live |
OAuth is required for webhooks and multi-account marketplace installs — out of scope for the Numa connector v1; revisit only if event-driven triggers are needed.

**Failure semantics:** 401 = invalid/missing token (PIT rotated/revoked/mistyped; possibly also a missing Version header [UNVERIFIED]). 403 = token valid but lacks the scope — fixed in HighLevel's Private Integrations screen, never in Numa.

## Required headers (every request)

| Header          | Value              | Notes                                                                                                                                        |
| --------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Authorization` | `Bearer <token>`   | injected by the Numa backend — agents never set it                                                                                           |
| `Version`       | e.g. `2021-07-28`  | **mandatory every call**; agents set it per request. `2023-02-21` on contacts, `2021-07-28` elsewhere unless an endpoint documents otherwise |
| `Content-Type`  | `application/json` | POST/PUT/PATCH bodies                                                                                                                        |

## Endpoint catalog

No machine-readable spec exists — assembled from the docs nav, the MCP tool list, and the SDK service list. Paths below are exact where cited; the module index is broad-coverage.

### Locations (sub-accounts) — start here

| Method | Path              | Purpose                                       |
| ------ | ----------------- | --------------------------------------------- |
| GET    | /locations/search | discover accessible sub-accounts → locationId |
| GET    | /locations/{id}   | sub-account detail                            |

### Contacts

| Method      | Path                    | Purpose                                  |
| ----------- | ----------------------- | ---------------------------------------- |
| GET         | /contacts/search        | **preferred** list/search (paginated)    |
| GET         | /contacts/ (deprecated) | old list — replaced by /contacts/search  |
| GET         | /contacts/{contactId}   | single contact                           |
| POST        | /contacts/              | create                                   |
| PUT         | /contacts/{contactId}   | update                                   |
| DELETE      | /contacts/{contactId}   | delete — human confirmation in Numa      |
| POST        | /contacts/upsert        | create-or-update (duplicate logic below) |
| GET         | /contacts/{id}/tasks    | contact tasks                            |
| POST/DELETE | /contacts/{id}/tags     | add/remove tags                          |

**Upsert duplicate logic:** depends on the per-location "Allow Duplicate Contact" setting — if email and phone match _different_ existing contacts, the API updates the one matching the first field in the configured priority sequence. `country` takes a fixed value list (/docs/other/country); phones should be E.164 [INFERRED].

### Opportunities & Pipelines

| Method | Path                     | Purpose                     |
| ------ | ------------------------ | --------------------------- |
| GET    | /opportunities/search    | search by criteria          |
| GET    | /opportunities/pipelines | all pipelines (+ stages)    |
| GET    | /opportunities/{id}      | single opportunity          |
| PUT    | /opportunities/{id}      | update (stage/status moves) |

Resolve `pipelineId`/`stageId` to names via /opportunities/pipelines before answering pipeline questions.

### Conversations & Messages

| Method | Path                         | Purpose                                                                   |
| ------ | ---------------------------- | ------------------------------------------------------------------------- |
| GET    | /conversations/search        | search/filter/sort threads                                                |
| GET    | /conversations/{id}/messages | messages in a thread                                                      |
| POST   | /conversations/messages      | **send — real SMS/email.** Human confirmation required; never blind-retry |

### Calendars & Payments

| Method | Path                   | Purpose                                       |
| ------ | ---------------------- | --------------------------------------------- |
| GET    | /calendars/events      | requires `userId`, `groupId`, or `calendarId` |
| GET    | /payments/orders/{id}  | order detail                                  |
| GET    | /payments/transactions | paginated, filterable                         |

### OAuth (alternative path only)

| Method | Path                 | Purpose                       |
| ------ | -------------------- | ----------------------------- |
| POST   | /oauth/token         | issue/refresh OAuth tokens    |
| POST   | /oauth/locationToken | agency token → location token |

### Full module index (28+ families)

Contacts · Conversations · Calendars (events/groups/resources/appointments) · Opportunities/Pipelines · Payments (orders/transactions/integrations/subscriptions) · Locations (+ custom fields/values) · Users · Companies · Workflows (get/trigger) · Forms · Surveys · Funnels · Invoices · Blogs (+ categories/authors) · Social Planner (posts/accounts/statistics) · Emails (templates) · Courses · Snapshots · Campaigns · Media Storage · Objects (custom objects) · Associations · Tags · Notes · Tasks · AI Agent Studio · Voice AI · Phone System · Products · Proposals · SaaS (agency management).
**Deprecated:** `GET /contacts/` (use /contacts/search); the entire API 1.0 platform (rest.gohighlevel.com).

## Data models [field-level schemas need a credentialed pull]

### Hierarchy

```
Company (Agency)
  └── Location (Sub-account)  ← primary API boundary; PIT issued per location
        ├── Contacts ──1:N──> Conversations ──1:N──> Messages
        │       └── Tasks / Notes / Tags
        ├── Opportunities ──N:1──> Pipeline ──1:N──> Stages
        ├── Calendars ──1:N──> Appointments
        ├── Workflows · Forms · Funnels · Invoices · Orders
        ├── Custom Fields / Custom Values
        └── Users
```

### Key entities (decision-relevant fields)

| Entity       | Key fields                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Location     | `id` (the locationId), `companyId`, `name`                                                      |
| Contact      | `id`, `firstName`, `lastName`, `email`, `phone` (E.164), `tags[]`, `customFields`, `locationId` |
| Opportunity  | `id`, `name`, `locationId`, `pipelineId`, `stageId`, `status`, `contactId`                      |
| Pipeline     | `id`, `name`, `locationId`, `stages[]`                                                          |
| Conversation | `id`, `contactId`, `locationId`, `type` (SMS/email/call)                                        |
| Message      | `id`, `conversationId`, `type`, `body`, `direction` (inbound/outbound)                          |
| Calendar     | `id`, `locationId`, `name`                                                                      |
| Appointment  | `id`, `calendarId`, `contactId`, `startTime`, `endTime`                                         |
| Invoice      | `id`, `locationId`, `contactId`, `status`, `total`                                              |
| Order        | `id`, `locationId`, `contactId`, `total`, `status`                                              |
| Workflow     | `id`, `locationId`, `name`, `status`                                                            |
| User         | `id`, `companyId`, `email`, `name`, `role`                                                      |
| Custom Field | `id`, `locationId`, `name`, `fieldKey`, `dataType`                                              |

**Formats:** ISO-8601 datetimes with ms, UTC (`2025-06-25T06:57:06.225Z` in webhook payloads); opaque alphanumeric string ids; epoch-ms pagination cursors. Status enums not enumerated anywhere retrievable [UNKNOWN].

## Pagination

- Cursor/keyset — `startAfter` (epoch ms) + `startAfterId` (record id). Default 20, max 100 (`limit`).
- Total count sometimes present in `meta` [UNVERIFIED].
- Envelope: `{"contacts":[...],"meta":{"startAfter":1718000000000,"startAfterId":"abc123","...":"..."}}` (collection key matches the resource).
- Last page: `meta.startAfter`/`startAfterId` absent or null [INFERRED]; empty collection array is the safe stop [UNVERIFIED].

```
Page 1: GET /contacts/search?locationId=L1&limit=100
Page 2: GET /contacts/search?locationId=L1&limit=100&startAfter={meta.startAfter}&startAfterId={meta.startAfterId}
Page N: cursors absent/null (or empty array) → stop
```

Space page-walks (~1s) — rate-limit budget is unknown.

## Rate limits

| Scope  | Limit         | Notes                                                   |
| ------ | ------------- | ------------------------------------------------------- |
| Global | **[UNKNOWN]** | no numeric thresholds published anywhere; 429 on breach |

- Headers / Retry-After [UNKNOWN] — capture `X-RateLimit-*` on the first credentialed call.
- Strategy: treat 429 as authoritative; back off 1s → 5s → 30s → 2m with jitter; keep bulk walks conservative; never busy-retry.

## Error handling

Standard error format **[UNKNOWN — needs live testing]**. The SDK wraps errors in `GHLError` (`message`, `statusCode`, `response`, `request`), but the raw API error JSON shape appears nowhere in the docs. Parse defensively: status code first, then try JSON, fall back to raw text.
| Status | Meaning | Retryable? | Recovery |
| --- | --- | --- | --- |
| 400 | bad request (documented on contact endpoints) | No | fix the payload |
| 401 | invalid/missing token (PIT rotated/revoked); possibly missing Version [UNVERIFIED] | No | re-enter the PIT via the chat card; check the Version header |
| 403 | missing scope on the PIT/app | No | fix scopes in HighLevel → Settings → Private Integrations |
| 404 | not found | No | verify id/path |
| 422 | validation error (contact endpoints) | No | fix field values |
| 429 | rate limited | Yes | backoff with jitter |
| 5xx | server error | Cautiously | retry once, then surface |
**Idempotency:** no idempotency keys found. GET/PUT-by-id safe to re-send; POST retries risk duplicates — prefer /contacts/upsert; `POST /conversations/messages` re-sends the actual SMS/email — never blind-retry. After a write timeout, query before retrying.

## Webhooks / events

**Supported — but NOT for this connector.** 50+ webhook event types (contact, opportunity, task, appointment, invoice, product, association, location, user, app INSTALL/UNINSTALL), **available only to OAuth marketplace apps** — not to PITs. The Numa connector authenticates with a PIT → **polling only**.
For the record (future OAuth-app path):

- Payload pattern: `{"type":"<EventType>","timestamp":"...","webhookId":"...",...}`.
- Signatures: `X-GHL-Signature` (Ed25519, current — public key in the guide); `X-WH-Signature` (RSA-SHA256) **deprecated July 1, 2026**.
- Retries: 429 → up to 7 attempts at 10 min + jitter; other non-2xx → exponential backoff up to 3 days; circuit breaker pauses webhooks after >10,000 deliveries in 3 days with <90% success.
- App scopes lock once the marketplace app is live (editable in draft only).
  **Polling fallback:** per-module `search` endpoints with cursor walks; date-modified filter availability per endpoint [UNKNOWN — verify live]. Keep cadence conservative.

## MCP server (future second surface)

- URL: `https://services.leadconnectorhq.com/mcp/`. Auth: the same PIT (`Authorization: Bearer pit-...`, + optional `locationId` header or in prompts).
- Transport: HTTP Streamable; **36 tools** at investigation time (contacts, conversations, calendars, opportunities, payments, locations, blogs, social, email templates); roadmap 250+ tools and OAuth.
- Numa angle: could ride `mcp_call` with the credential already stored — richer tool semantics without per-endpoint prompting. Out of scope for v1.

## SDKs & tooling

| SDK                       | Language | Version        | Source                                            |
| ------------------------- | -------- | -------------- | ------------------------------------------------- |
| `@gohighlevel/api-client` | TS/JS    | 3.0.0          | npm; github.com/GoHighLevel/highlevel-api-sdk     |
| `gohighlevel-api-client`  | Python   | 1.0.0b1 (beta) | PyPI; github.com/GoHighLevel/highlevel-api-python |
| PHP SDK                   | PHP      | [UNKNOWN]      | listed in SDK docs nav                            |

TS SDK: full service coverage (30 services), auto token refresh on 401 (OAuth), webhook middleware, `GHLError` class. **Not used by Numa** — raw HTTP via the generic `request` proxy suffices; the SDK source doubles as an endpoint reference. **Postman collection:** not found. **OpenAPI spec:** not available (`/swagger.json` empty).

## Integration path assessment

**Recommended:** Direct API via Numa native data connector (`request` operation), registry `authType: token` — NOT Pipedream, NOT OAuth. Implemented; see 03 for wiring, 04 for lifecycle.
**Justification:** PIT auth is a single user-pasted Bearer token riding the existing token connector backend (`_user_connector_token` → `Authorization: Bearer ...`) with zero new auth code. The admin contributes metadata only. The only API-specific requirement — the mandatory Version header — is a non-secret constant the agent adds per request.
**Connector compatibility:** N/A — not a file source (`list_files`/`download_file` do not apply).
**Rollout checklist (per customer):**

1. HighLevel admin: create a Private Integration for Numa (Settings → Private Integrations) with read scopes for the modules users will query (+ write scopes only if writes are agreed).
2. Numa admin: add GoHighLevel in Integrations (wizard is metadata-only; leave instance URL empty).
3. Each user: paste the PIT into the chat credential card on first use.
4. Verify: `GET /locations/search?limit=1` (with Version) → 200; then probe each needed module to surface missing scopes (403s) early.
5. Burn down §Known Unknowns on the first connected account; update 01-llm-api-rules.md with findings.

## Known unknowns — verify on a credentialed account before customer rollout

1. Rate limit numbers — thresholds, headers, `Retry-After` presence.
2. Error response body shape — 400/401/403/404/422/429 bodies.
3. Missing-Version failure mode — which status/body a missing or invalid Version header produces.
4. Exact response envelopes per module (collection key + `meta` contents, incl. any totals).
5. Per-endpoint filter/sort grammar on the search endpoints (incl. date-modified filters for polling).
6. Complete scopes list (the scopes docs page needs a real browser).
7. Status enums (opportunity status, invoice lifecycle, etc.).
8. Bulk operation limits and partial-failure semantics (contacts bulk tag updates).
9. Media Storage upload format — do not expose until tested.
10. Changelog review (/docs/Changelog) for breaking changes since 2026-05-04.

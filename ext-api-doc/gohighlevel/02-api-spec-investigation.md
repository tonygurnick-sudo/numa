---
api_name: 'GoHighLevel API (API 2.0)'
api_slug: 'gohighlevel'
base_url: 'https://services.leadconnectorhq.com'
version: 'API 2.0 — selected per request via the required Version header (2023-02-21 current; 2021-07-28 / 2021-04-15 supported)'
spec_format: 'none' # no public OpenAPI/Swagger download; interactive docs portal only
spec_url: 'not available (/swagger.json returns empty)'
docs_url: 'https://marketplace.gohighlevel.com/docs/'
date_researched: '2026-05-04'
generated_date: '2026-06-10'
---

# GoHighLevel — API Specification & Investigation

> Developer reference for the GoHighLevel (HighLevel) REST API — the condensed output of
> `00-api-investigation-questionnaire.md`. Compiled from the official developer portal
> (`marketplace.gohighlevel.com/docs/`), the OAuth/webhook/MCP guides, and the official SDK
> README during the API investigation of 2026-05-04.
>
> ⚠️ **NO AUTHENTICATED CALL has been made** — no credentials were available and the API host
> blocks headless fetches. Auth model, endpoints, and pagination are docs-derived ([DOCS]);
> error bodies and rate limits are unknown (§Known Unknowns). Verify against a real Private
> Integration Token before first customer use.
>
> ⚠️ **API 2.0 only.** The legacy API 1.0 at `rest.gohighlevel.com` is deprecated — never build
> on it. Everything below targets `https://services.leadconnectorhq.com`.

---

## Overview

- **Vendor / product:** HighLevel Inc. — all-in-one CRM and marketing platform for marketing
  agencies and SMBs (contacts, conversations, pipelines, calendars, payments, workflows, social,
  funnels, invoices) [DOCS]
- **API style:** REST, JSON [DOCS]
- **Base URL:** `https://services.leadconnectorhq.com` — single shared SaaS host [DOCS]
- **Versioning:** **required `Version` header on every request** — `2023-02-21` (current,
  contacts), `2021-07-28` (OAuth/MCP examples), `2021-04-15` (legacy). The header value
  determines the response shape [DOCS]
- **Auth:** Bearer token — Private Integration Token (`pit-...`) or OAuth 2.0 access token [DOCS]
- **Multi-tenancy:** Company (agency) → Locations (sub-accounts); **`locationId` required on
  most endpoints**; discover via `GET /locations/search` [DOCS]
- **Pagination:** cursor (`startAfter` epoch-ms + `startAfterId`), default 20, max 100 [DOCS]
- **Rate limits:** numeric thresholds **not published** — 429 on breach [UNKNOWN]
- **Spec:** no public OpenAPI/Swagger download (`/swagger.json` empty) [UNKNOWN — tried]
- **Webhooks:** 50+ events, but **OAuth marketplace apps only — NOT available to PITs** → the
  Numa connector is polling-only [DOCS]
- **MCP server:** `https://services.leadconnectorhq.com/mcp/` — official, PIT-authed, 36 tools [DOCS]

**Summary:** A broad CRM/marketing API: 28+ endpoint families covering contacts, conversations
(SMS/email/call), opportunities/pipelines, calendars/appointments, payments, locations, users,
workflows, custom fields, blogs, social planner, and more. Every call carries `Authorization:
Bearer ...` + `Version`; almost every call is scoped by `locationId`.

**Numa integration model:** Native data connector (`authType: token`, NOT Pipedream). The
workspace agent calls
`connectors(name="request", params={connector: "gohighlevel", url: "/contacts/search?locationId=...&limit=100", method: "GET", headers: {"Version": "2021-07-28"}})`.
The backend expands relative URLs against the stored `base_url`
(`https://services.leadconnectorhq.com`) and injects `Authorization: Bearer <PIT>` from the
user's personal vault (`connector-gohighlevel`, field `api_key`). The agent never sees the token
but **must add the `Version` header itself** — it's a constant, not a secret. See
`03-connector-setup.md`.

---

## Authentication

### Method: Bearer token — Private Integration Token (primary) or OAuth 2.0 (alternative)

```
Authorization: Bearer pit-xxxxxxxx-xxxx-...
Version: 2021-07-28
```

**Private Integration Token (PIT) — the Numa path** [DOCS]:

- Created in HighLevel: **Settings → Private Integrations → Create New Integration**
- **Scopes are chosen at creation** — human-readable checkboxes ("View Contacts", "Edit
  Contacts", ...); calls outside the granted scopes return **403**
- Issued **per sub-account (location)**; full access to the configured scopes within it
- Token begins with the **`pit-` prefix**; **long-lived** — no expiry, no refresh; rotated or
  revoked manually in the same settings screen (→ 401 until re-entered)

**OAuth 2.0 (Authorization Code) — documented alternative, not built** [DOCS]:

| Parameter         | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| Grant type        | authorization_code (+ refresh_token)                                  |
| App registration  | `https://marketplace.gohighlevel.com/` (marketplace developer portal) |
| Token URL         | `POST https://services.leadconnectorhq.com/oauth/token`               |
| Location exchange | `POST /oauth/locationToken` (agency token → location token; needs `Version: 2021-07-28`) |
| Access token life | ~24h (`expires_in: 86399`)                                            |
| Refresh token     | 1 year or until used; each use issues a new refresh token; refresh body is form-urlencoded |
| Token types       | Agency (`userType: "Company"`) vs Location (`userType: "Location"`)   |
| Scope lock        | Marketplace app scopes editable only in **draft** status — locked once live |

OAuth is required for webhooks and multi-account marketplace installs — out of scope for the
Numa connector v1; revisit only if event-driven triggers are ever needed.

**Failure semantics:**

| Status | Meaning                                                                            |
| ------ | ----------------------------------------------------------------------------------- |
| 401    | Invalid/missing token — PIT rotated, revoked, or mistyped; possibly also a missing `Version` header [UNVERIFIED] |
| 403    | Token is valid but **lacks the scope** for this endpoint — fixed in HighLevel's Private Integrations screen, never in Numa |

---

## Required Headers (every request)

| Header          | Value                | Notes                                                        |
| --------------- | -------------------- | ------------------------------------------------------------- |
| `Authorization` | `Bearer <token>`     | Injected by the Numa backend — agents never set it            |
| `Version`       | e.g. `2021-07-28`    | **Mandatory on every call**; agents set it per request. Use `2023-02-21` on contacts endpoints, `2021-07-28` elsewhere unless an endpoint documents otherwise [DOCS] |
| `Content-Type`  | `application/json`   | POST/PUT/PATCH bodies                                          |

---

## Endpoint Catalog

> No machine-readable spec exists — this catalog is assembled from the docs nav, the official
> MCP tool list, and the SDK service list [DOCS]. Paths below are exact where cited; the
> module-level index that follows is broad-coverage.

### Locations (sub-accounts) — start here

| Method | Path                 | Purpose                                       |
| ------ | -------------------- | ---------------------------------------------- |
| GET    | `/locations/search`  | Discover accessible sub-accounts → `locationId` |
| GET    | `/locations/{id}`    | Sub-account detail                              |

### Contacts

| Method | Path                      | Purpose                                          |
| ------ | ------------------------- | ------------------------------------------------- |
| GET    | `/contacts/search`        | **Preferred** list/search (paginated)             |
| GET    | `/contacts/` (deprecated) | Old list — replaced by `/contacts/search` [DOCS]  |
| GET    | `/contacts/{contactId}`   | Single contact                                    |
| POST   | `/contacts/`              | Create contact                                    |
| PUT    | `/contacts/{contactId}`   | Update contact                                    |
| DELETE | `/contacts/{contactId}`   | Delete contact — human confirmation in Numa       |
| POST   | `/contacts/upsert`        | Create-or-update (duplicate logic below)          |
| GET    | `/contacts/{id}/tasks`    | Contact tasks                                     |
| POST/DELETE | `/contacts/{id}/tags` | Add/remove tags                                  |

**Upsert duplicate logic** [DOCS]: behaviour depends on the per-location "Allow Duplicate
Contact" setting — if email and phone match *different* existing contacts, the API updates the
one matching the first field in the configured priority sequence. `country` takes a fixed value
list (`/docs/other/country`); phones should be E.164 [INFERRED].

### Opportunities & Pipelines

| Method | Path                        | Purpose                          |
| ------ | --------------------------- | --------------------------------- |
| GET    | `/opportunities/search`     | Search opportunities by criteria  |
| GET    | `/opportunities/pipelines`  | All pipelines (+ stages)          |
| GET    | `/opportunities/{id}`       | Single opportunity                |
| PUT    | `/opportunities/{id}`       | Update (stage/status moves)       |

Resolve `pipelineId`/`stageId` to names via `/opportunities/pipelines` before answering
pipeline questions.

### Conversations & Messages

| Method | Path                              | Purpose                                                |
| ------ | --------------------------------- | ------------------------------------------------------- |
| GET    | `/conversations/search`           | Search/filter/sort conversation threads                 |
| GET    | `/conversations/{id}/messages`    | Messages in a thread                                    |
| POST   | `/conversations/messages`         | **Send a message — real SMS/email.** Human confirmation required in Numa; never blind-retry |

### Calendars & Payments

| Method | Path                          | Purpose                                                  |
| ------ | ----------------------------- | --------------------------------------------------------- |
| GET    | `/calendars/events`           | Calendar events — requires `userId`, `groupId`, or `calendarId` [DOCS] |
| GET    | `/payments/orders/{id}`       | Order detail                                              |
| GET    | `/payments/transactions`      | Paginated, filterable transaction list                    |

### OAuth (alternative path only)

| Method | Path                    | Purpose                                  |
| ------ | ----------------------- | ----------------------------------------- |
| POST   | `/oauth/token`          | Issue/refresh OAuth tokens                |
| POST   | `/oauth/locationToken`  | Exchange agency token for location token  |

### Full module index (28+ families) [DOCS — docs nav + SDK services]

Contacts · Conversations · Calendars (events/groups/resources/appointments) · Opportunities/
Pipelines · Payments (orders/transactions/integrations/subscriptions) · Locations (+ custom
fields/values) · Users · Companies · Workflows (get/trigger) · Forms · Surveys · Funnels ·
Invoices · Blogs (+ categories/authors) · Social Planner (posts/accounts/statistics) · Emails
(templates) · Courses · Snapshots · Campaigns · Media Storage · Objects (custom objects) ·
Associations · Tags · Notes · Tasks · AI Agent Studio · Voice AI · Phone System · Products ·
Proposals · SaaS (agency management)

**Deprecated:** `GET /contacts/` (use `/contacts/search`); the entire API 1.0 platform
(`rest.gohighlevel.com`).

---

## Data Models [DOCS-derived; field-level schemas need a credentialed pull]

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

| Entity       | Key fields                                                                 |
| ------------ | --------------------------------------------------------------------------- |
| Location     | `id` (the `locationId`), `companyId`, `name`                                |
| Contact      | `id`, `firstName`, `lastName`, `email`, `phone` (E.164), `tags[]`, `customFields`, `locationId` |
| Opportunity  | `id`, `name`, `locationId`, `pipelineId`, `stageId`, `status`, `contactId`  |
| Pipeline     | `id`, `name`, `locationId`, `stages[]`                                      |
| Conversation | `id`, `contactId`, `locationId`, `type` (SMS/email/call thread)             |
| Message      | `id`, `conversationId`, `type`, `body`, `direction` (inbound/outbound)      |
| Calendar     | `id`, `locationId`, `name`                                                  |
| Appointment  | `id`, `calendarId`, `contactId`, `startTime`, `endTime`                     |
| Invoice      | `id`, `locationId`, `contactId`, `status`, `total`                          |
| Order        | `id`, `locationId`, `contactId`, `total`, `status`                          |
| Workflow     | `id`, `locationId`, `name`, `status`                                        |
| User         | `id`, `companyId`, `email`, `name`, `role`                                  |
| Custom Field | `id`, `locationId`, `name`, `fieldKey`, `dataType`                          |

**Formats:** ISO-8601 datetimes with ms, UTC (`2025-06-25T06:57:06.225Z` observed in webhook
payloads); opaque alphanumeric string ids; epoch-ms pagination cursors. Status enums not
enumerated anywhere retrievable [UNKNOWN].

---

## Pagination

- **Type:** cursor / keyset — `startAfter` (epoch ms) + `startAfterId` (record id) [DOCS]
- **Default page size:** 20 — **Max:** 100 (`limit`) [DOCS]
- **Total count:** sometimes present in `meta` [UNVERIFIED]

**Response structure:**

```json
{
  "contacts": [ ... ],
  "meta": { "startAfter": 1718000000000, "startAfterId": "abc123", "...": "..." }
}
```

(The collection key matches the resource — `contacts`, `opportunities`, ...)

**Last page detection:** `meta.startAfter`/`meta.startAfterId` absent or null [INFERRED]; an
empty collection array is the safe stop condition [UNVERIFIED].

**Worked example:**

```
Page 1: GET /contacts/search?locationId=L1&limit=100
Page 2: GET /contacts/search?locationId=L1&limit=100&startAfter={meta.startAfter}&startAfterId={meta.startAfterId}
Page N: cursors absent/null (or empty array) → stop
```

Space page-walks (~1s between requests) — the rate-limit budget is unknown.

---

## Rate Limits

| Scope  | Limit         | Window | Notes                                                  |
| ------ | ------------- | ------ | ------------------------------------------------------- |
| Global | **[UNKNOWN]** | —      | No numeric thresholds published anywhere. 429 on breach [DOCS — SDK + webhook retry logic]. |

- **Headers / Retry-After:** [UNKNOWN] — capture `X-RateLimit-*` on the first credentialed call
- **Strategy:** treat 429 as authoritative; back off 1s → 5s → 30s → 2m with jitter; keep bulk
  walks conservative; never busy-retry

---

## Error Handling

**Standard error format: [UNKNOWN — needs live testing].** The official SDK wraps errors in
`GHLError` (`message`, `statusCode`, `response`, `request`) [DOCS — npm README], but the raw API
error JSON shape appears nowhere in the docs. Parse defensively: status code first, then try
JSON, fall back to raw text.

| Status | Meaning                                              | Retryable? | Recovery                                                     |
| ------ | ----------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| 400    | Bad request (documented on contact endpoints)         | No         | Fix the payload                                               |
| 401    | Invalid/missing token (PIT rotated/revoked); possibly missing `Version` [UNVERIFIED] | No | Re-enter the PIT via the chat card; check the `Version` header |
| 403    | **Missing scope on the PIT/app**                      | No         | Fix scopes in HighLevel → Settings → Private Integrations     |
| 404    | Not found                                             | No         | Verify id/path                                                |
| 422    | Validation error (contact endpoints)                  | No         | Fix field values                                              |
| 429    | Rate limited                                          | Yes        | Backoff with jitter                                           |
| 5xx    | Server error                                          | Cautiously | Retry once; then surface                                      |

**Idempotency:** no idempotency keys found. GET/PUT-by-id safe to re-send; **POST retries risk
duplicates** — prefer `/contacts/upsert`; `POST /conversations/messages` re-sends the actual
SMS/email — never blind-retry. After a write timeout, query before retrying.

---

## Webhooks / Events

**Supported — but NOT for this connector.** HighLevel offers 50+ webhook event types (contact,
opportunity, task, appointment, invoice, product, association, location, user, app
INSTALL/UNINSTALL), **available only to OAuth marketplace apps** — not to Private Integration
tokens [DOCS]. The Numa connector authenticates with a PIT → **polling only**.

For the record (future OAuth-app path) [DOCS — webhook guide]:

- Payload pattern: `{ "type": "<EventType>", "timestamp": "...", "webhookId": "...", ... }`
- Signatures: `X-GHL-Signature` (Ed25519, current — public key published in the guide);
  `X-WH-Signature` (RSA-SHA256) is **deprecated July 1, 2026**
- Retries: 429 → up to 7 attempts at 10 min + jitter; other non-2xx → exponential backoff up to
  3 days; circuit breaker pauses webhooks after >10,000 deliveries in 3 days with <90% success
- App scopes lock once the marketplace app is live (editable in draft only)

**Polling fallback:** per-module `search` endpoints with cursor walks; date-modified filter
availability per endpoint [UNKNOWN — verify live]. Keep cadence conservative (unknown budget).

---

## MCP Server (future second surface)

- **URL:** `https://services.leadconnectorhq.com/mcp/` [DOCS]
- **Auth:** the same PIT — `Authorization: Bearer pit-...` (+ optional `locationId` header, or
  supplied in prompts)
- **Transport:** HTTP Streamable; **36 tools** at investigation time (contacts, conversations,
  calendars, opportunities, payments, locations, blogs, social, email templates); roadmap 250+
  tools and OAuth support [DOCS]
- **Numa angle:** could ride `mcp_call` with the credential the user already stored for this
  connector — richer tool semantics without per-endpoint prompting. Out of scope for v1;
  revisit when MCP coverage grows.

---

## SDKs & Tooling

| SDK | Language | Version | Source |
| --- | -------- | ------- | ------ |
| `@gohighlevel/api-client` | TypeScript/JavaScript | 3.0.0 | npm; `github.com/GoHighLevel/highlevel-api-sdk` [DOCS] |
| `gohighlevel-api-client`  | Python | 1.0.0b1 (beta) | PyPI; `github.com/GoHighLevel/highlevel-api-python` [DOCS] |
| PHP SDK | PHP | [UNKNOWN] | Listed in SDK docs nav [DOCS] |

TS SDK features: full service coverage (30 services), auto token refresh on 401 (OAuth),
webhook middleware, `GHLError` class [DOCS]. **Not used by Numa** — raw HTTP via the generic
`request` proxy suffices; the SDK source doubles as an endpoint reference.

**Postman collection:** not found. **OpenAPI spec:** not available (`/swagger.json` empty).

---

## Integration Path Assessment

**Recommended path:** **Direct API via Numa native data connector** (`request` operation),
registry `authType: token` — NOT Pipedream, NOT OAuth. Implemented; see `03-connector-setup.md`
for the real wiring and `04-connection-and-reauth.md` for lifecycle.

**Justification:** PIT auth is a single user-pasted Bearer token riding the existing token
connector backend (`_user_connector_token` → `Authorization: Bearer ...`) with zero new auth
code. The admin contributes metadata only. The only API-specific requirement — the mandatory
`Version` header — is a non-secret constant the agent adds per request.

**Connector compatibility:** N/A — not a file source (`list_files`/`download_file` do not apply).

**Rollout checklist (per customer):**

1. HighLevel admin: create a **Private Integration for Numa** (Settings → Private Integrations)
   with read scopes for the modules users will query (+ write scopes only if writes are agreed)
2. Numa admin: add **GoHighLevel** in Integrations (wizard is metadata-only; leave instance URL empty)
3. Each user: paste the PIT into the chat credential card on first use
4. Verify: `GET /locations/search?limit=1` (with `Version`) → 200; then probe each needed module
   to surface missing scopes (403s) early
5. Burn down §Known Unknowns on the first connected account; update `01-llm-api-rules.md` with findings

---

## Known Unknowns — verify on a credentialed account before customer rollout

1. **Rate limit numbers** — thresholds, headers, `Retry-After` presence
2. **Error response body shape** — 400/401/403/404/422/429 bodies
3. **Missing-`Version` failure mode** — which status/body a missing or invalid `Version` header produces
4. **Exact response envelopes** per module (collection key + `meta` contents, incl. any totals)
5. **Per-endpoint filter/sort grammar** on the search endpoints (incl. date-modified filters for polling)
6. **Complete scopes list** (the scopes docs page needs a real browser)
7. **Status enums** (opportunity status, invoice lifecycle, etc.)
8. **Bulk operation limits** and partial-failure semantics (contacts bulk tag updates)
9. **Media Storage upload format** — do not expose until tested
10. **Changelog review** (`/docs/Changelog`) for breaking changes since 2026-05-04

---

_Researched 2026-05-04 (official developer portal, OAuth/webhook/MCP guides, SDK README);
compiled into this pack 2026-06-10. **No authenticated call was possible — docs-derived only.**
Source: `00-api-investigation-questionnaire.md`._

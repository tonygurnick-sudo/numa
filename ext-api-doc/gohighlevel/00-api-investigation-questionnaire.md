---
api_name: 'GoHighLevel API (API 2.0)'
api_slug: 'gohighlevel'
vendor: 'HighLevel Inc. (branded "HighLevel"; widely known as GoHighLevel / GHL)'
website: 'https://www.gohighlevel.com'
investigation_started: '2026-05-04'
investigator: 'Numa API Investigation Agent (docs investigation 2026-05-04); reformatted into this pack 2026-06-10'
investigation_status: 'blocked' # docs research complete; Phase 2.4 authenticated-call gate NOT passed (no credentials)
documentation_quality: 'good'
api_types: [REST]
overall_confidence: 'medium'
blockers:
  - 'No GoHighLevel credentials were available — every endpoint requires auth, and the docs portal blocks headless fetches, so no live API call has been made'
  - 'Rate limit numbers and raw error body format are not documented publicly — both need a credentialed test'
generated_date: '2026-06-10'
---

# API Investigation Questionnaire: GoHighLevel

> **Source:** A Numa API investigation completed **2026-05-04** against the official HighLevel
> developer portal (`https://marketplace.gohighlevel.com/docs/`), the OAuth/webhook/MCP guides,
> the official npm SDK README (`@gohighlevel/api-client`), and community pagination references.
> Reformatted into the standard pack structure on 2026-06-10 — no new HTTP research was done.
>
> 🔄 **2026-06-24 docs re-verification (supersedes two claims below, [DOCS marketplace.gohighlevel.com]):**
>
> 1. **Rate limits ARE published** — the original investigation marked them `[UNKNOWN]`, but the
>    HighLevel docs state a **burst limit of 100 requests / 10 seconds** and a **daily limit of
>    200,000 requests / day**, each **per resource (Location or Company), per Marketplace app**.
>    Responses carry `X-RateLimit-Max`, `X-RateLimit-Remaining`, `X-RateLimit-Interval-Milliseconds`,
>    `X-RateLimit-Limit-Daily`, `X-RateLimit-Daily-Remaining`. 429 remains the authoritative live
>    signal. Wherever this file says "rate limits unknown/unpublished," read the numbers above.
> 2. **The `Version` header is now backend-injected** — the connector registry carries
>    `staticHeaders: { Version: '2021-07-28' }`, the admin wizard persists it as `static_headers`,
>    and `_connector_static_headers` merges it into every request. Wherever this file says the agent
>    "must set the Version header on every call," that is now wrong: the backend supplies it and the
>    agent only overrides it (`--headers '{"Version":"2023-02-21"}'`) to pin the newest contacts schema.
>    Error-body shape and live auth behaviour remain unverified (still no credentials).
>
> ⚠️ **NO AUTHENTICATED CALL has been made.** The API host blocks headless/scripted GETs,
> `/swagger.json` returned empty, and no credentials were available. Every claim below is
> docs-derived; auth behaviour, error bodies, and rate limits are NOT live-verified.
>
> **Confidence markers (per repo convention for this connector):**
> `[DOCS]` = stated in official HighLevel documentation (tagged `[DOCUMENTED]` in the original
> 2026-05-04 investigation) · `[INFERRED]` = deduced from SDK source, community posts, or
> patterns · `[UNVERIFIED]` = new inference made while compiling this pack · `[UNKNOWN]` =
> looked and could not find.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** `https://marketplace.gohighlevel.com/docs/` — the HighLevel developer portal [DOCS]
- **API reference / endpoint catalog URL:** same portal, per-module pages (e.g. `/docs/ghl/contacts/get-contacts`) [DOCS]
- **Authentication guide URL:** `https://marketplace.gohighlevel.com/docs/Authorization/authorization_doc` (auth types) and `/docs/Authorization/OAuth2.0` (full OAuth flow) [DOCS]
- **Webhook guide URL:** `https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/` [DOCS]
- **MCP server docs URL:** `https://marketplace.gohighlevel.com/docs/other/mcp/` [DOCS]
- **Changelog URL:** `/docs/Changelog` on the same portal — not fetched during the investigation [UNKNOWN — flagged as follow-up]
- **Status page URL:** none found [UNKNOWN]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** **none publicly downloadable** — `/swagger.json` returned empty; the portal uses an interactive UI that may expose a spec to logged-in sessions [UNKNOWN — tried and failed]
- **Postman collection URL:** none found [UNKNOWN]
- **Official SDK repositories:**
  - TypeScript/JavaScript: `@gohighlevel/api-client` (npm, v3.0.0) — `https://github.com/GoHighLevel/highlevel-api-sdk` [DOCS]
  - Python: `gohighlevel-api-client` (PyPI, v1.0.0b1) — `https://github.com/GoHighLevel/highlevel-api-python` [DOCS]
  - PHP: available; version [UNKNOWN] [DOCS — listed in SDK docs nav]
  - API docs repo: `https://github.com/GoHighLevel/highlevel-api-docs` [DOCS]
- **Community sources used:** pagination walkthrough (`medium.com/@tuguidragos` — startAfter/startAfterId mechanics) [INFERRED-grade source, corroborates docs]; third-party integration guide (`isitdev.com`) for E.164/OAuth patterns

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                          |
| ------------------------- | ------ | ------------------------------------------------------------------------------ |
| Authentication            | 5      | PIT + OAuth both documented with token samples and step-by-step flows [DOCS]   |
| Endpoint reference        | 4      | Per-module pages, 28+ endpoint families; no machine-readable spec              |
| Request/response examples | 3      | Endpoint pages carry examples; full response bodies hard to extract headlessly |
| Error documentation       | 2      | Status codes listed per endpoint; raw error JSON shape nowhere [UNKNOWN]       |
| Rate limit documentation  | 1      | **No numeric thresholds published anywhere** — 429 behaviour only [UNKNOWN]    |
| Pagination documentation  | 3      | startAfter/startAfterId cursors documented; corroborated by community guides   |
| Webhook documentation     | 5      | Excellent — 50+ events, payloads, signatures, retries, circuit breaker [DOCS]  |
| SDKs / code examples      | 5      | Official TS + Python SDKs with full service coverage and README [DOCS]         |
| Changelog / versioning    | 3      | Version header documented; changelog page exists but was not fetched           |

**Overall documentation quality:** good (auth/webhooks/SDKs excellent; rate limits and error bodies are the holes)

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation (developer portal) [DOCS]
- [x] Confirmed **no public OpenAPI/Swagger spec** (`/swagger.json` empty) [UNKNOWN — tried]
- [x] Identified authentication method (PIT Bearer token; OAuth 2.0 alternative)
- [ ] Found at least one working **authenticated** example — **NOT done; no credentials** [UNKNOWN]
- [ ] Identified rate limit information — **NOT found anywhere** [UNKNOWN]
- [x] Identified pagination approach (cursor: `startAfter` + `startAfterId`)
- [x] Checked for webhook/event support (yes — but OAuth marketplace apps only)
- [x] Checked for official SDKs (TS, Python, PHP) and the official MCP server

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** GoHighLevel API 2.0 (the product brands itself "HighLevel") [DOCS]
- **Vendor / company:** HighLevel Inc. — all-in-one CRM and marketing platform for marketing agencies and SMBs (contacts, conversations, pipelines, calendars, payments, workflows, social, funnels) [DOCS]
- **Current API version:** API 2.0, selected per-request via the `Version` header (see 2.2); API 1.0 at `rest.gohighlevel.com` is **legacy/deprecated** — do not build on it [DOCS]
- **Base URL(s):**
  - Production: `https://services.leadconnectorhq.com` [DOCS — https://marketplace.gohighlevel.com/docs/]
  - Sandbox / testing: none documented [UNKNOWN]
  - MCP server: `https://services.leadconnectorhq.com/mcp/` [DOCS]
  - White-label variant hosts may exist per agency domain [INFERRED]
- **API type:** REST, JSON [DOCS]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport / format:** HTTPS; JSON; `Content-Type: application/json` on POST/PUT bodies [DOCS]; UTF-8 [UNVERIFIED — standard assumption]
- **URL structure pattern:** [DOCS]

```
https://services.leadconnectorhq.com/{resource}/{action-or-id}
e.g. GET /contacts/{contactId} · GET /opportunities/search · POST /conversations/messages
```

- **Versioning strategy: REQUIRED `Version` request header on every call** — this is the single
  most common cause of failed first calls [DOCS]:

| Header value | Status                                                          |
| ------------ | --------------------------------------------------------------- |
| `2023-02-21` | Current — documented on contacts endpoints [DOCS]               |
| `2021-07-28` | Supported — used in OAuth/locationToken and MCP examples [DOCS] |
| `2021-04-15` | Supported (legacy) [DOCS]                                       |

The `Version` header determines the response shape — different versions may return different
field names/structures [DOCS]. It is a constant, **not a secret**: in Numa the agent sets it
per request (the backend injects only `Authorization`).

- **Required headers (all requests):**

| Header          | Value              | Purpose                                      |
| --------------- | ------------------ | -------------------------------------------- |
| `Authorization` | `Bearer <token>`   | PIT or OAuth access token [DOCS]             |
| `Version`       | e.g. `2021-07-28`  | API version selection — **mandatory** [DOCS] |
| `Content-Type`  | `application/json` | POST/PUT/PATCH bodies [DOCS]                 |

- **CORS policy:** [UNVERIFIED] — irrelevant for Numa (server-side proxy)

### 2.3 Authentication [REQUIRED]

Two distinct methods [DOCS — https://marketplace.gohighlevel.com/docs/Authorization/authorization_doc]:

| Method                              | Use case                                                  | Numa relevance                                                  |
| ----------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| **Private Integration Token (PIT)** | Internal/single sub-account use; no webhooks needed       | **Primary — v1 path**                                           |
| **OAuth 2.0 (Authorization Code)**  | Public marketplace apps, multi-account installs, webhooks | Documented alternative — out of scope for the Numa connector v1 |

**Auth header format (both methods):** `Authorization: Bearer <token>` [DOCS]

#### Private Integration Token (the Numa path)

- Generated in HighLevel: **Settings → Private Integrations → Create New Integration** [DOCS — MCP docs]
- **Scopes are selected at creation time** — the token can only call endpoints its scopes allow; a 403 means a missing scope [DOCS]
- Tied to a specific **sub-account (location)**; full access to the configured scopes within that location [DOCS]
- Token format: begins with the **`pit-` prefix** — observed in the official MCP example `"Authorization": "Bearer pit-12345"` [DOCS]
- **Lifetime: long-lived** — no documented expiry; rotated or revoked manually in the same settings screen [DOCS]
- Rotation/revocation → existing token returns 401 until the user re-enters the new one [INFERRED]

#### OAuth 2.0 (documented alternative — not built)

Flow: Authorization Code Grant [DOCS — /docs/Authorization/OAuth2.0]:

1. Register an app at `https://marketplace.gohighlevel.com/` → `client_id` + `client_secret`
2. User visits the Installation URL → selects a location → redirected to `redirect_uri?code=<auth_code>`
3. Exchange: `POST https://services.leadconnectorhq.com/oauth/token` with
   `{client_id, client_secret, grant_type: "authorization_code", code, user_type, redirect_uri}`

- **Token response fields:** `access_token`, `token_type: "Bearer"`, `expires_in: 86399`, `refresh_token`, `scope`, `refreshTokenId`, `userType`, `companyId`, `locationId` (Location tokens), `userId` [DOCS]
- **Token types:** Agency token (`userType: "Company"`) vs Location token (`userType: "Location"`); an agency token exchanges for a location token via `POST /oauth/locationToken` (with `Version: 2021-07-28`) [DOCS]
- **Expiry/refresh:** access token ~24h (86,399–86,400s); refresh token valid 1 year or until used (each use issues a new refresh token); refresh uses `grant_type: "refresh_token"` with `Content-Type: application/x-www-form-urlencoded` [DOCS]
- **Scope lock:** marketplace app scopes can only be changed while the app is in **draft** status — locked once live [DOCS — webhook guide]
- **Key scopes observed** [DOCS]: `contacts.readonly`/`contacts.write`, `conversations.readonly`/`.write`, `calendars.readonly`/`.write`, `calendars/events.readonly`/`.write`, `opportunities.readonly`/`.write`, `businesses.readonly`/`.write`, `companies.readonly`, `payments/orders.readonly`, `payments/transactions.readonly`, `locations.readonly`, plus social planner / blogs / email template slugs. The complete scopes page was not retrievable headlessly [UNKNOWN — fetch with a real browser]

> PIT scopes use the same permission taxonomy presented as human-readable checkboxes
> ("View Contacts", "Edit Contacts", ...) in the Private Integrations screen [DOCS — MCP docs].

### 2.4 First Successful Call [REQUIRED] — CRITICAL GATE

> ⛔ **GATE NOT PASSED.** No credentials were available and
> `https://services.leadconnectorhq.com/` returns empty bodies to headless/scripted GETs.
> No `[CONFIRMED]` claims exist anywhere in this pack — every endpoint requires auth.

**Endpoint planned for first call (when a PIT is available):**

```http
GET /locations/search?limit=1 HTTP/1.1
Host: services.leadconnectorhq.com
Authorization: Bearer pit-xxxxxxxx
Version: 2021-07-28
Accept: application/json
```

(Locations search needs only the locations scope, returns a small payload, and yields the
`locationId` values every other call needs — the natural connection probe.)

- **Expected status:** 200 with `{ locations: [...] }` [INFERRED]; 401 = bad/rotated token; 403 = PIT lacks the locations scope
- **Gotchas to expect:** omitting the `Version` header fails the request even with a valid token [DOCS]; the error status for a missing `Version` needs live confirmation [UNVERIFIED]

- [ ] **GATE CHECK: First successful authenticated API call completed and documented above** — **NOT DONE; blocked on credentials**

---

## Phase 3: Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

> GoHighLevel is a multi-tenant CRM: **Company (agency) → Locations (sub-accounts) → everything
> else**. `locationId` scopes almost every call. Field lists below are docs/SDK-derived [DOCS]
> unless noted; full schemas need a credentialed pull.

#### Entity: Location (sub-account)

- **Endpoint path:** `/locations/{id}`, `/locations/search` [DOCS — SDK]
- **Description:** The fundamental multi-tenant unit — each agency client is a location. PITs are issued per location.
- **Key fields:** `id` (the `locationId`), `companyId`, `name` [DOCS]

#### Entity: Contact

- **Endpoint path:** `/contacts/` (CRUD), `/contacts/search` (preferred list), `/contacts/upsert` [DOCS]
- **CRUD support:** Create / Read / Update / Delete / Upsert [DOCS]
- **Key fields:** `id`, `firstName`, `lastName`, `email`, `phone` (**E.164 format** [INFERRED — community best practice]), `tags[]`, `customFields`, `locationId` [DOCS]
- **Sub-resources:** tasks (`/contacts/{id}/tasks`), tags (`POST`/`DELETE /contacts/{id}/tags`), notes, followers [DOCS]
- ⚠️ `GET /contacts/` is **deprecated** — use `/contacts/search` [DOCS — /docs/ghl/contacts/get-contacts]

#### Entity: Opportunity (+ Pipeline)

- **Endpoint path:** `/opportunities/search`, `/opportunities/{id}` (GET/PUT), `/opportunities/pipelines` [DOCS — MCP docs]
- **Key fields:** `id`, `name`, `locationId`, `pipelineId`, `stageId`, `status`, `contactId` [DOCS]
- **Pipeline:** `id`, `name`, `locationId`, `stages[]` — container for opportunities [DOCS]

#### Entity: Conversation (+ Message)

- **Endpoint path:** `/conversations/search`, `/conversations/{id}/messages`, `POST /conversations/messages` (send) [DOCS — MCP docs]
- **Description:** SMS/email/call threads per contact. Sending a message dispatches a real SMS/email — treat as a high-consequence write.
- **Key fields:** Conversation `id`, `contactId`, `locationId`, `type`; Message `id`, `conversationId`, `type`, `body`, `direction` (inbound/outbound) [DOCS]

#### Entity: Calendar (+ Appointment)

- **Endpoint path:** `/calendars/events` (events list; requires `userId`, `groupId`, or `calendarId` [DOCS — MCP tool docs]); appointment CRUD under the calendars module [DOCS]
- **Key fields:** Calendar `id`, `locationId`, `name`; Appointment `id`, `calendarId`, `contactId`, `startTime`, `endTime` [DOCS]

#### Other entities (summary) [DOCS]

| Entity              | Key fields                                         | Notes                                             |
| ------------------- | -------------------------------------------------- | ------------------------------------------------- |
| Invoice             | `id`, `locationId`, `contactId`, `status`, `total` | Full lifecycle endpoints                          |
| Order / Transaction | `id`, `locationId`, `contactId`, `total`, `status` | `/payments/orders/{id}`, `/payments/transactions` |
| Workflow            | `id`, `locationId`, `name`, `status`               | Get + trigger                                     |
| User                | `id`, `companyId`, `email`, `name`, `role`         | Agency/location users                             |
| Company             | `id`, `name`                                       | Agency (top level)                                |
| Custom Field        | `id`, `locationId`, `name`, `fieldKey`, `dataType` | Per-location definitions                          |
| Form / Survey       | —                                                  | Read-only submission sources                      |

### 3.2 Entity Relationships [IMPORTANT]

```
Company (Agency)
  └── Location (Sub-account)  ← primary API boundary; PIT issued per location
        ├── Contacts ──1:N──> Conversations ──1:N──> Messages
        │       └──1:N──> Tasks / Notes / Tags
        ├── Opportunities ──N:1──> Pipeline ──1:N──> Stages
        │       └──N:1──> Contact
        ├── Calendars ──1:N──> Appointments (──N:1──> Contact)
        ├── Workflows · Forms · Funnels · Surveys
        ├── Invoices · Orders · Transactions
        ├── Custom Fields / Custom Values
        └── Users
```

### 3.3 State Machines [IMPORTANT]

- **Opportunity status:** moves via `PUT /opportunities/{id}` (`status`, `stageId`); allowed value set not enumerated in retrievable docs [UNKNOWN]
- **Invoice lifecycle:** create → send → payment events exist as webhook events [DOCS], implying draft/sent/paid states; exact enum [UNKNOWN]
- No dedicated lifecycle-action routes were found — state moves via field updates [INFERRED]

### 3.4 Business Rules [IMPORTANT]

- **`locationId` is required on almost every API call** — it scopes all data [DOCS]
- **Upsert duplicate logic:** `POST /contacts/upsert` behaviour depends on the per-location "Allow Duplicate Contact" setting — if both email and phone match _different_ existing contacts, the API updates the one matching the first field in the configured priority sequence [DOCS]
- **`country` field** requires specific accepted values (see `/docs/other/country`) [DOCS]
- **Phone numbers:** normalize to E.164 before sending [INFERRED — community best practice]
- **Scope gating:** every endpoint family maps to a scope chosen at PIT/app creation; calls outside the granted scopes return 403 [DOCS]

### 3.5 Field Format Reference [IMPORTANT]

| Format   | Pattern               | Example                    | Notes                                             |
| -------- | --------------------- | -------------------------- | ------------------------------------------------- |
| DateTime | ISO-8601 with ms, UTC | `2025-06-25T06:57:06.225Z` | Observed in webhook payloads [DOCS]               |
| Cursor   | epoch milliseconds    | `1718000000000`            | `startAfter` pagination cursor [DOCS]             |
| ID       | opaque string         | `ve9EPM428h8vShlRW1KT`     | Alphanumeric record ids [INFERRED — SDK examples] |
| Phone    | E.164                 | `+6421555000`              | [INFERRED]                                        |
| Token    | `pit-` prefix         | `pit-12345...`             | PIT format [DOCS]                                 |
| Enums    | —                     | —                          | Status enums not enumerated [UNKNOWN]             |

---

## Phase 4: Endpoint Catalog

> No public machine-readable spec exists; the catalog below is assembled from the docs nav, the
> MCP tool list, and the official SDK service list [DOCS]. Paths are exact where cited; module
> coverage is broad but per-endpoint parameter detail needs the portal or a live account.

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /contacts/search (preferred contact list/search)

- **Purpose:** search contacts within a location — replaces the deprecated `GET /contacts/` [DOCS]
- **Required:** `Authorization`, `Version` headers; `locationId` query/body param [DOCS]
- **Pagination:** `limit` (default 20, max 100) + `startAfter`/`startAfterId` cursors [DOCS]

```http
GET /contacts/search?locationId={locationId}&limit=100
Authorization: Bearer pit-...
Version: 2023-02-21
```

**Success response shape:** `{ contacts: [...], meta: { startAfter, startAfterId, ... } }` [DOCS — pagination article; wrapper key per collection]

#### Endpoint: POST /contacts/ · PUT /contacts/{id} · DELETE /contacts/{id} · POST /contacts/upsert

- CRUD + upsert on contacts [DOCS]. Upsert depends on the location's duplicate-contact setting (3.4). 400/422 documented on the contact endpoint pages for validation failures [DOCS].

#### Endpoint: GET /opportunities/search + GET /opportunities/pipelines

- Search opportunities by criteria; retrieve all pipelines (needed to translate `pipelineId`/`stageId` into names before answering pipeline questions) [DOCS — MCP docs]

#### Endpoint: GET /conversations/search · GET /conversations/{id}/messages · POST /conversations/messages

- Find threads, read messages, **send a message** (real SMS/email — human confirmation required in Numa) [DOCS — MCP docs]

#### Endpoint: GET /locations/search

- Discover accessible sub-accounts and their `locationId`s — the first call any session should make [DOCS — SDK]

#### Endpoint: GET /calendars/events

- Calendar events — requires `userId`, `groupId`, or `calendarId` [DOCS — MCP tool docs]

#### Endpoint: GET /payments/orders/{id} · GET /payments/transactions

- Order detail; paginated, filterable transaction list [DOCS — MCP docs]. (OAuth-path endpoints `POST /oauth/token` and `POST /oauth/locationToken` are documented in 2.3 — not used by this connector.)

### 4.2 Full Endpoint Index (module level) [IMPORTANT]

28+ endpoint families confirmed from the SDK service list + docs nav [DOCS]:

| Module                                    | Notes                                                       |
| ----------------------------------------- | ----------------------------------------------------------- |
| Contacts                                  | CRUD, upsert, search, tags, tasks, notes, bulk, followers   |
| Conversations                             | Messages (SMS/email/call), send, search                     |
| Calendars                                 | Events, groups, resources, appointments                     |
| Opportunities                             | Pipelines, CRUD, stage transitions                          |
| Payments                                  | Orders, transactions, integrations, subscriptions           |
| Locations                                 | Get, search, create, update, custom fields/values           |
| Users / Companies                         | CRUD / agency level                                         |
| Workflows                                 | Get, trigger                                                |
| Forms / Surveys / Funnels                 | Read                                                        |
| Invoices                                  | CRUD, lifecycle                                             |
| Blogs / Social Planner / Emails           | Blog CRUD; posts, accounts, statistics; email template CRUD |
| Courses / Snapshots / Campaigns           | Read                                                        |
| Media Storage                             | Upload/manage                                               |
| Objects / Associations                    | Custom objects; contact relationships                       |
| AI Agent Studio / Voice AI / Phone System | Agents CRUD, execute                                        |
| Products / Proposals / SaaS               | Read/manage                                                 |

### 4.3 Deprecated endpoints

- `GET /contacts/` — deprecated, replaced by `/contacts/search` [DOCS]
- API 1.0 (`rest.gohighlevel.com`) — legacy platform, deprecated [DOCS]

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                  | Supported?   | Syntax                                                               | Notes                                        |
| --------------------------- | ------------ | -------------------------------------------------------------------- | -------------------------------------------- |
| Scope to a sub-account      | **required** | `locationId={id}`                                                    | On most list endpoints [DOCS]                |
| Per-resource search         | yes          | `/contacts/search`, `/opportunities/search`, `/conversations/search` | Search/filter/sort per module [DOCS]         |
| Filter by field value       | partial      | query params per endpoint                                            | Exact grammar per endpoint [UNKNOWN]         |
| Filter by date range        | partial      | endpoint-specific params                                             | [UNKNOWN — needs portal/live check]          |
| Full-text search            | per-resource | search endpoints above                                               | No global search endpoint found [UNKNOWN]    |
| Sort                        | partial      | conversations search documents sort                                  | Grammar not retrievable headlessly [UNKNOWN] |
| Field selection / aggregate | not found    | —                                                                    | `meta` may include totals [UNVERIFIED]       |

### 5.2 Common Query Patterns [REQUIRED]

```http
# 1 — discover locations (always first; yields locationId)
GET /locations/search?limit=20

# 2 — list/search contacts in a location, max page size
GET /contacts/search?locationId={locationId}&limit=100

# 3 — walk the next contact page (cursors from the previous response meta)
GET /contacts/search?locationId={locationId}&limit=100&startAfter={meta.startAfter}&startAfterId={meta.startAfterId}

# 4 — pipelines, then search opportunities
GET /opportunities/pipelines?locationId={locationId}
GET /opportunities/search?location_id={locationId}&pipeline_id={pipelineId}

# 5 — a contact's conversation history
GET /conversations/search?locationId={locationId}&contactId={contactId}
GET /conversations/{conversationId}/messages
```

(All with `Authorization: Bearer pit-...` + `Version`. Parameter casing varies by module — e.g.
opportunities historically uses `location_id` [INFERRED — SDK]; verify per endpoint.)

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** cursor (keyset) [DOCS]
- **Default page size:** **20** [DOCS — corroborated by the community pagination article]
- **Maximum page size:** **100** via `limit` [DOCS]
- **Total count available:** sometimes present in `meta` [UNVERIFIED]

**Request parameters:**

| Parameter      | Type    | Description                                               |
| -------------- | ------- | --------------------------------------------------------- |
| `limit`        | integer | Records per page; default 20, max 100 [DOCS]              |
| `startAfter`   | numeric | Epoch-ms cursor from previous `meta.startAfter` [DOCS]    |
| `startAfterId` | string  | Record-id cursor from previous `meta.startAfterId` [DOCS] |
| `locationId`   | string  | Required on most list endpoints [DOCS]                    |

**Response structure:** `{ <collection>: [...], meta: { startAfter, startAfterId, ... } }` [DOCS]

**How to detect last page:** `meta.startAfter`/`meta.startAfterId` absent or null [INFERRED]; an
empty collection array is the safe stop condition [UNVERIFIED].

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /contacts/search?locationId=L1&limit=100
        → { contacts: [100], meta: { startAfter: 1718000000000, startAfterId: "abc" } }
Page 2: GET /contacts/search?locationId=L1&limit=100&startAfter=1718000000000&startAfterId=abc
Page N: meta cursors absent/null (or empty array) → stop
```

### 6.3 Bulk Operations [IMPORTANT]

- Contacts module lists **bulk** operations (e.g. bulk tag updates) in the docs nav [DOCS]; batch
  size limits and partial-failure semantics [UNKNOWN]. No generic batch endpoint found [UNKNOWN]

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                      | Supported?                            | Notes                                                                                                             |
| ------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Webhooks                       | **yes — OAuth marketplace apps ONLY** | 50+ event types [DOCS]. **NOT available to Private Integration tokens** — so not available to the Numa connector. |
| WebSocket / SSE / long polling | no                                    | Not documented                                                                                                    |

> ⚠️ **Consequence for Numa:** the connector authenticates with a PIT, so **polling is the only
> event pattern** (7.4). Real-time events would require building and getting approval for an
> OAuth marketplace app — a deliberate future decision, not connector configuration.

### 7.2 Webhooks (documented for the OAuth-app future path) [IMPORTANT]

- **Event categories** [DOCS — webhook guide]: Contact (create/update/delete/tag changes), Opportunity (lifecycle/status), Task, Appointment, Invoice (create → payment lifecycle), Product, Association, Location, User, and app INSTALL/UNINSTALL
- **Payload pattern:** `{ "type": "<EventType>", "timestamp": "...", "webhookId": "...", ...data }` — INSTALL example confirmed with `appId`, `versionId`, `installType`, `locationId`, `companyId`, `userId` [DOCS]
- **Signature verification** [DOCS]: `X-GHL-Signature` (Ed25519, current — public key published in the guide) · `X-WH-Signature` (RSA-SHA256, **deprecated July 1, 2026**). Verify Ed25519 first, fall back to RSA only until the deadline.
- **Retries** [DOCS]: 429 → up to 7 attempts, 10 min + jitter; other non-2xx → exponential backoff + jitter for up to **3 days**; circuit breaker pauses webhooks after >10,000 deliveries in 3 days with <90% success. **Setup:** app Advanced Settings → Webhooks; events/URLs editable anytime, but app **scopes lock once live** [DOCS]

### 7.4 Polling Fallback [IMPORTANT]

- **Endpoints:** the per-module `search` endpoints (contacts/opportunities/conversations), filtered per module
- **Change detection:** date-updated filters where each search endpoint supports them — exact parameter names per module [UNKNOWN — verify live]; otherwise re-walk pages with the cursor
- **Rate-limit implications:** unknown numeric budget (Phase 8) — keep polling conservative and back off on 429

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope  | Limit         | Window | Notes                                                                                                                          |
| ------ | ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Global | **[UNKNOWN]** | —      | No numeric thresholds in any official or community source searched. 429 returned on breach [DOCS — SDK + webhook retry logic]. |

- **Rate limit headers:** [UNKNOWN] — check for `X-RateLimit-*` on the first credentialed call
- **Retry-After:** [UNKNOWN]
- **Backoff strategy:** treat 429 as authoritative — back off 1s → 5s → 30s → 2m with jitter;
  space bulk page-walks (~1s between pages, per community guidance) [INFERRED]

### 8.2 Error Handling [REQUIRED]

**Standard error response format:** **[UNKNOWN — needs live testing.]** The official SDK wraps
errors in a `GHLError` class (`message`, `statusCode`, `response`, `request`) [DOCS — npm README],
but the raw API error JSON structure appears nowhere in the docs. Not inventing it — parse
defensively: status code first, then try JSON, fall back to raw text.

**Status codes observed in docs/SDK** [DOCS]:

| HTTP Status | Meaning                                                                              | Retryable? | Recovery                                                     |
| ----------- | ------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------ |
| 400         | Bad request (documented on contact endpoints)                                        | No         | Fix the payload                                              |
| 401         | Invalid/missing token (PIT rotated/revoked); possibly missing `Version` [UNVERIFIED] | No         | Re-enter the PIT via the chat card                           |
| 403         | **PIT/app lacks the required scope**                                                 | No         | Fix scopes in HighLevel (Private Integrations) — not in Numa |
| 404         | Not found (SDK error example)                                                        | No         | Verify id/path                                               |
| 422         | Unprocessable entity (contact endpoints)                                             | No         | Fix field values                                             |
| 429         | Rate limited                                                                         | Yes        | Backoff per 8.1                                              |
| 5xx         | Server error                                                                         | Cautiously | Retry once with backoff                                      |

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** none found [UNKNOWN]
- GET idempotent; PUT re-sends safe (id-addressed); **POST retries risk duplicates** — prefer
  `POST /contacts/upsert`; message sends (`POST /conversations/messages`) duplicate the outbound
  SMS/email on retry — never blind-retry them. After a write timeout, **query before retrying**

### 8.4 Async Operations / 8.5 File Handling

- **Async:** none documented [UNKNOWN]. **Files:** a Media Storage module exists (upload/manage)
  [DOCS]; request format untested — do not expose through Numa until verified [UNKNOWN]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

**Selected integration path:** **Direct API via the Numa native data connector (`request`
operation)** — registry `authType: token`, NOT Pipedream, NOT OAuth. (Not a file source — CRM
records, not documents; Data Connector (Files)/Hybrid paths don't fit.)

**Justification:** PIT auth is a single user-pasted Bearer token — it maps 1:1 onto the existing
token-connector backend (Synergy/Fergus precedent): the user's vault stores `api_key` (= the
PIT), and the backend injects `Authorization: Bearer pit-...` on every call — zero new auth code.
The admin contributes metadata only. The only GoHighLevel-specific requirement is the mandatory
`Version` header, which is a non-secret constant the **agent** adds per request.

**Numa request flow:**

```
workspace agent → connectors(name="request", params={connector: "gohighlevel",
                    url: "/contacts/search?locationId=...&limit=100", method: "GET",
                    headers: {"Version": "2021-07-28"}})
  → backend resolves base_url https://services.leadconnectorhq.com (connector-config-gohighlevel)
  → injects Authorization: Bearer <user vault: connector-gohighlevel.api_key>
  → forwards; the agent never sees the token
```

### 9.2 Connector Requirements [IMPORTANT]

Not a file connector — `list_files`/`download_file` mapping N/A.

- **Auth type for connector:** `token` — per-user PIT in the personal vault, captured via the inline chat credential card on first use
- **Per-client config:** none — fixed SaaS base URL from the registry; wizard instance URL stays empty
- **Connector category:** CRM — **Caching:** standard project-management preset
- **HighLevel-side prerequisite:** a Private Integration created with the scopes Numa needs (read scopes for queried modules; write scopes only if writes are in scope)

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Answer CRM questions: contacts, opportunities/pipelines, conversations/messages, calendars/appointments, payments (orders/transactions), locations, users, custom fields — with cursor pagination
2. Create/update records on explicit user request: contacts (prefer upsert), opportunities (stage/status moves), notes/tasks/tags
3. Discover the account structure via `/locations/search` and translate pipeline/stage ids to names before answering
4. Connection diagnostics via `GET /locations/search?limit=1`

**CANNOT do (out of scope or dangerous — encode in LLM rules):**

1. Send conversation messages (real SMS/email) without explicit human confirmation
2. Delete contacts or opportunities without explicit human confirmation
3. Set the `Authorization` header itself (backend-injected) — but it MUST set `Version` per request
4. Call legacy API 1.0 (`rest.gohighlevel.com`) or the deprecated `GET /contacts/`
5. Configure webhooks (needs an OAuth marketplace app); bulk page-walks without spacing requests and backing off on 429 (budget unknown)

**Default parameters:**

| Parameter    | Default                                 | Reason                               |
| ------------ | --------------------------------------- | ------------------------------------ |
| `Version`    | `2021-07-28` (`2023-02-21` on contacts) | Documented working versions          |
| `limit`      | 20–100                                  | Default 20; 100 for deliberate walks |
| `locationId` | resolved once per conversation          | Required almost everywhere           |

### 9.4 SDK / MCP Assessment [NICE-TO-HAVE]

| Surface                                                                                       | Quality     | Worth using?                                                                                    | Notes                                  |
| --------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| `@gohighlevel/api-client` (TS, v3.0.0)                                                        | good [DOCS] | No — raw HTTP via the generic `request` proxy suffices                                          | Useful as endpoint reference           |
| `gohighlevel-api-client` (Python, 1.0.0b1)                                                    | beta        | No                                                                                              | Same                                   |
| **Official MCP server** (`/mcp/`, Bearer PIT, HTTP-streamable, 36 tools, roadmap 250+) [DOCS] | promising   | **Future second surface** — could ride Numa's `mcp_call` with the same PIT; out of scope for v1 | Same credential, richer tool semantics |

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed
- [ ] Phase 2 **partially**: auth model fully documented; **authenticated first-call gate NOT passed (no credentials)**
- [x] Phase 3 complete: core entities + hierarchy + business rules (field-level schemas thin)
- [x] Phase 4 complete: critical endpoints with paths; module-level full index (no machine-readable spec)
- [x] Phase 5 partial: search endpoints known; per-endpoint filter grammar [UNKNOWN]
- [x] Phase 6 complete: cursor pagination (default 20 / max 100 / meta cursors) with worked example
- [x] Phase 7 complete: webhooks documented but PIT-excluded → polling only for Numa
- [ ] Phase 8 **partially**: status codes known; **rate limit numbers and error body format [UNKNOWN]**
- [x] Phase 9 complete: integration path selected (Direct API, token connector)

**Overall investigation confidence:** **medium** — auth, pagination, webhooks, and module
coverage are docs-solid, but zero authenticated validation, unknown rate limits, and unknown
error bodies cap it.

**Known gaps that will reduce output quality:**

1. **No authenticated call ever made** — error bodies, rate-limit headers, exact response
   envelopes, and `Version`-header failure mode all need a credentialed test
2. **Rate limit numbers** not published anywhere
3. Per-endpoint filter/sort grammar and field-level schemas not retrievable headlessly
4. Complete scopes list (the scopes page needs a real browser)
5. Changelog not reviewed for recent breaking changes

### 10.2 Generation Prompts [REQUIRED]

Standard pack from this questionnaire (templates in `ext-api-doc/_templates/`):
**01-llm-api-rules** (Phases 2/4/8/9 — MUST open with the not-live-validated banner; mandate the
`Version` header on every call, `locationId` scoping, and human confirmation for message sends
and deletes) · **01a-domain-model-reference** (Phase 3) · **01b-query-patterns** (Phases 5–6:
search endpoints + cursor pagination) · **01c-mutation-patterns** (Phases 3.4 + 4: upsert
semantics, message-send confirmation, no idempotency keys) · **01d-event-and-error-handling**
(Phases 7–8: polling-only, unknown error bodies — defensive parsing) ·
**02-api-spec-investigation** (all phases condensed — companion file) · **03-connector-setup**
(Phase 9 — real registry/wizard/backend wiring) · **04-connection-and-reauth** (Phase 2.3 +
lifecycle: long-lived PIT, rotation/revocation → 401 → chat card, 403 = scope).

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence  | Gaps                                                         |
| ---------------------------- | ------------- | ----------- | ------------------------------------------------------------ |
| 01-llm-api-rules             | yes           | medium      | Error bodies + rate limits unknown                           |
| 01a-domain-model-reference   | yes           | medium      | Field-level schemas thin; enums missing                      |
| 01b-query-patterns           | yes           | medium      | Cursor pagination solid; filter grammar per endpoint unknown |
| 01c-mutation-patterns        | yes           | medium      | Upsert rules documented; validation error shapes unknown     |
| 01d-event-and-error-handling | yes           | medium-high | Webhook exclusion + polling clear; error bodies unknown      |
| 02-api-spec-investigation    | yes           | medium      | Module-level catalog only — no machine-readable spec         |
| 03-connector-setup           | yes           | high        | Standard token connector; wiring is real code                |
| 04-connection-and-reauth     | yes           | high        | PIT lifecycle simple and fully documented                    |

---

_Compiled 2026-06-10 from the Numa API investigation of 2026-05-04 (official HighLevel developer
portal, OAuth/webhook/MCP guides, npm SDK README, community pagination references). **No
authenticated call has been made — re-validate flagged items with a real PIT before first
customer use.**_

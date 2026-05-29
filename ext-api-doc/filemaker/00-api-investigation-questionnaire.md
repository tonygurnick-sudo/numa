---
api_name: 'Claris FileMaker Data API'
api_slug: 'filemaker'
vendor: 'Claris International Inc. (Apple subsidiary)'
website: 'https://www.claris.com/filemaker/'
investigation_started: '2026-05-29'
investigation_updated: '2026-05-29'
investigator: 'Claude Code (automated, docs-only — no live FileMaker Server reachable)'
investigation_status: 'complete'
documentation_quality: 'good'
api_types: ['REST']
overall_confidence: 'medium — official docs are thorough; no live call possible (every install is a private, per-tenant server)'
integration_path: 'Direct API via connect_request (username-password / per-tenant server URL)'
blockers:
  - "No first successful live call — the API runs on the customer's own FileMaker Server / FileMaker Cloud; there is no public sandbox."
  - 'Session-token model (POST sessions per use, ~15-min idle expiry) needs a deliberate strategy in connect_request — see Phase 2.3 / Phase 9.'
  - 'All entities (layouts, fields, scripts) are tenant-defined. There is NO fixed domain model — it must be discovered at runtime via the metadata endpoints.'
---

# API Investigation Questionnaire: Claris FileMaker Data API

> Completed by automated investigation on 2026-05-29.
> Sources: official Claris FileMaker Data API Guide (help.claris.com/en/data-api-guide), archived FM18/19/2023 guides, and community references (DB Services, Soliant, Beezwax, Portage Bay).
> **No live call was made.** The FileMaker Data API is not a hosted SaaS — every customer runs their own FileMaker Server (on-prem) or FileMaker Cloud instance, addressed by their own `server_url`. There is no shared public endpoint or sandbox to test against, so essentially nothing here is `[CONFIRMED]`. Endpoint shapes and the auth flow are `[DOCUMENTED]` from the official guide; anything about a specific customer's data is `[INFERRED]`/`[UNKNOWN]` because the schema is defined per-tenant.
> **Registry cross-check:** connector `id: 'filemaker'`, `authType: 'username-password'`, credential fields `server_url`, `username`, `password`, `database`. This matches the API exactly — login is Basic `user:pass` against a named database on a customer-supplied server. No OAuth block in the registry; correct (the API's enterprise OAuth/Claris-ID flows are not what this connector uses).

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** https://help.claris.com/en/data-api-guide/content/index.html [DOCUMENTED]
- **API reference / endpoint catalog URL:** The guide is task-organised (one page per operation) rather than a single endpoint catalog. Key pages: "Write FileMaker Data API calls", "Log in to a database session", "Get metadata", "Get a range of records", "Perform a find request", "Edit a record", "Run a script", "Upload container data". [DOCUMENTED]
- **Authentication guide URL:** https://help.claris.com/en/data-api-guide/content/log-in-database-session.html [DOCUMENTED]
- **Changelog / release notes URL:** Versioned by FileMaker platform release (FM17 introduced the official Data API; FM18/19/2023/2024 each extend it). Archived guides at `help.claris.com/archive/docs/{17,18,19,fm20}/...`. [DOCUMENTED]
- **Status page URL:** N/A — self-hosted per tenant. There is no Claris-operated status page for a customer's own FileMaker Server. [DOCUMENTED]
- **Per-server live OpenAPI/doc UI:** Each FileMaker Server exposes a live Swagger-style doc at `https://{server}/fmi/data/apidoc/` (e.g. the public-ish demos `fms.mastrapumps.com/fmi/data/apidoc/`). This renders the OpenAPI spec for that exact server version. [DOCUMENTED]

> **Discovery tip:** Because the schema is tenant-specific, the _single most useful_ discovery action against a real connection is `GET /fmi/data/apidoc/` on the customer's server plus the metadata endpoints (Phase 4.1) — they reveal that tenant's databases, layouts, fields, value lists, and scripts.

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** Served live per-server at `https://{server}/fmi/data/apidoc/` (OpenAPI). Not a single canonical hosted spec. [DOCUMENTED]
- **Postman collection URL:** No official Claris Postman collection found. Numerous community collections exist (search "FileMaker Data API Postman"). [INFERRED]
- **Official SDK repositories:**
  - Python: No official Claris SDK. Community: `fmrest` / `python-fmrest` (David Hamann, well maintained) wraps the Data API. [DOCUMENTED]
  - Node.js: No official SDK. Community: `fms-api-client` (Luidog), `fm-data-api-client`. [DOCUMENTED]
  - Other: PHP, .NET community wrappers exist. [INFERRED]
- **Official blog / engineering blog:** Claris Engineering Blog (engineering.claris.com). [DOCUMENTED]
- **Community forums / Stack Overflow tag:** Claris Community (community.claris.com), Stack Overflow tag `filemaker` / `filemaker-data-api`. [DOCUMENTED]

> **Discovery tip:** The community SDKs (`python-fmrest`, `fms-api-client`) are the best reference for the exact request/response envelope, token refresh handling, and container up/download mechanics that the prose docs gloss over.

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                                                                                               |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication            | 4      | Login/logout, Basic→token, header format, and the 15-min idle expiry are all clearly documented.                                                                    |
| Endpoint reference        | 4      | Every operation has its own page with method + path. No single catalog, but the live per-server apidoc fills that gap.                                              |
| Request/response examples | 4      | Good worked examples for login, get-range, find, edit. The `response`/`messages` envelope is consistent.                                                            |
| Error documentation       | 3      | Errors come back in `messages[].code` using FileMaker's numeric error codes; the code list lives in a separate "FileMaker error codes" doc, not the Data API guide. |
| Rate limit documentation  | 1      | None. Self-hosted; throughput depends on the customer's server hardware and the "Max Data API calls" config, not a published rate limit.                            |
| Pagination documentation  | 4      | `_offset`/`_limit` (GET) and `offset`/`limit` (find body) with defaults documented (offset 1, limit 100; portals limit 50).                                         |
| Webhook documentation     | 1      | No webhooks/events in the Data API at all.                                                                                                                          |
| SDKs / code examples      | 3      | No official SDK, but strong community SDKs and many third-party blog walkthroughs.                                                                                  |
| Changelog / versioning    | 3      | Versioned by platform release; `vLatest` vs `v1` (and historically `v2`) is documented but version skew across customer servers is real.                            |

**Overall documentation quality:** good

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Found or confirmed no single canonical OpenAPI spec (it is served live per-server at `/fmi/data/apidoc/`)
- [x] Identified authentication method (Basic → session token)
- [x] Found at least one working example (from docs — not executed live)
- [x] Identified rate limit information (none published; self-hosted)
- [x] Identified pagination approach (`_offset`/`_limit`)
- [x] Checked for webhook/event support (none)
- [x] Checked for official SDKs (none official; community SDKs exist)
- [ ] **First successful LIVE API call — NOT DONE** (no reachable server / sandbox) 🔬

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Claris FileMaker Data API (formerly "FileMaker Data API"; FM16 had a trial "REST API" at `/fmi/rest` that is now deprecated). [DOCUMENTED]
- **Vendor / company:** Claris International Inc. (an Apple company). [DOCUMENTED]
- **Current API version:** Path version segment `vLatest` (recommended) or pinned `v1`. The on-disk version tracks the FileMaker Server release (FM17+ for the official API). [DOCUMENTED]
- **Base URL(s):**
  - Production: `https://{server_url}/fmi/data/vLatest/databases/{database}` — `{server_url}` is the customer's FileMaker Server or FileMaker Cloud host (the registry's `server_url` field, e.g. `https://myserver.fmi.filemaker-cloud.com`). [DOCUMENTED]
  - Sandbox / testing: None operated by Claris. Each customer's own server is the only environment. [DOCUMENTED]
- **API type:** REST (JSON over HTTPS). [DOCUMENTED]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (HTTP/1.1). FileMaker Server requires SSL for the Data API; a valid certificate is expected (self-signed certs cause connection failures unless trusted). [DOCUMENTED]
- **Data format:** JSON. Container fields return/accept binary via separate container endpoints. [DOCUMENTED]
- **Content-Type header(s):** `application/json` for all JSON calls. `multipart/form-data` for the container-upload endpoint. [DOCUMENTED]
- **Character encoding:** UTF-8. [INFERRED]
- **URL structure pattern:**

```
https://{server_url}/fmi/data/vLatest/databases/{database}/layouts/{layout}/records
https://{server_url}/fmi/data/vLatest/databases/{database}/layouts/{layout}/records/{recordId}
https://{server_url}/fmi/data/vLatest/databases/{database}/layouts/{layout}/_find
```

- **Versioning strategy:** URL path segment (`vLatest` | `v1`). Prefer `vLatest`. [DOCUMENTED]
- **CORS policy:** [UNKNOWN] — irrelevant for Numa; all calls are server-side via `connect_request`. FileMaker servers are not designed for browser-direct calls.
- **Field casing:** Field, layout, and script names are **defined by the customer** in FileMaker Pro and used verbatim — they frequently contain spaces and mixed case (e.g. `"First Name"`, `"Work State"`). They must be URL-encoded in paths and used exactly as named in `fieldData`/`query`. [DOCUMENTED]
- **Record IDs:** `recordId` is a server-assigned **internal integer returned as a string** (e.g. `"1"`). It is NOT a user field; it is the Data API's row handle. `modId` is the per-record modification counter used for optimistic locking. [DOCUMENTED]
- **Required headers:**

| Header        | Value                                    | Purpose                                                                      |
| ------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| Authorization | `Basic {base64(user:pass)}` (login only) | Establishes a session; returns a token. [DOCUMENTED]                         |
| Authorization | `Bearer {token}` (all later calls)       | Session token from login; required on every subsequent request. [DOCUMENTED] |
| Content-Type  | `application/json`                       | For all JSON request bodies (login body is `{}`).                            |

### 2.3 Authentication [REQUIRED]

> **This is the defining quirk of FileMaker.** Auth is a two-step, short-lived session token — not a static API key, not OAuth (for this connector).

- **Auth method:** Basic auth on login → short-lived **session Bearer token**. [DOCUMENTED]
- **Auth location:** HTTP `Authorization` header. [DOCUMENTED]
- **Login endpoint:**

```http
POST /fmi/data/vLatest/databases/{database}/sessions HTTP/1.1
Host: {server_url}
Authorization: Basic {base64(username:password)}
Content-Type: application/json

{}
```

- **Login response (HTTP 200):** [DOCUMENTED]

```json
{
  "response": {
    "token": "c4d2e429122e9cdeda19bb23c55cd2a8f282c3cc50c60943a110"
  },
  "messages": [{ "code": "0", "message": "OK" }]
}
```

The token is also echoed in the `X-FM-Data-Access-Token` response header.

- **Subsequent calls:** `Authorization: Bearer {token}` on every request. [DOCUMENTED]
- **Token lifetime:** Valid until logout **or 15 minutes after the last call that used it** (sliding idle timeout — each authenticated call resets the 15-min clock). [DOCUMENTED]
- **Token refresh mechanism:** None. There is no refresh token. When a token expires you simply `POST .../sessions` again with Basic auth to mint a new one. [DOCUMENTED]
- **Logout:** `DELETE /fmi/data/vLatest/databases/{database}/sessions/{token}`. FileMaker Server allows a finite number of concurrent Data API sessions, so proactively logging out (or letting idle expiry reclaim) matters under load. [DOCUMENTED]
- **Scopes / permissions model:** Governed by the FileMaker **account's privilege set** inside the database (`fmrest` extended privilege must be enabled for the account; data-level access is whatever that privilege set grants). No OAuth scopes. [DOCUMENTED]
- **Multi-tenant auth:** Each customer = its own server + database + accounts. The connector's four credential fields (`server_url`, `username`, `password`, `database`) fully parameterise a connection. [DOCUMENTED]
- **Prerequisites on the server side:** (a) Data API enabled in FileMaker Server Admin Console; (b) the database hosted with the `fmrest` extended privilege granted to the account; (c) valid SSL cert. [DOCUMENTED]

**connect_request implication (critical):** Unlike a static-key connector, FileMaker requires a **login round-trip before the real call** and the token expires fast. The connector backend must either log in per request (simple, slightly slower — login + call + optional logout) or cache the token with the 15-min sliding window and re-login on a `952` (invalid token) error. Treat any `952` as "re-authenticate and retry once." [INFERRED — design decision]

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

> **GATE NOT PASSED.** No live FileMaker Server was reachable (the API is self-hosted per customer; no public sandbox exists). The flow below is the documented happy path, not a captured live response.

**Step 1 — log in:**

```http
POST /fmi/data/vLatest/databases/Inventory/sessions HTTP/1.1
Host: myserver.fmi.filemaker-cloud.com
Authorization: Basic YWRtaW46c2VjcmV0
Content-Type: application/json

{}
```

→ `200 OK`, `{"response":{"token":"<token>"},"messages":[{"code":"0","message":"OK"}]}`

**Step 2 — cheapest authenticated probe (validate token + list layouts):**

```http
GET /fmi/data/vLatest/databases/Inventory/layouts HTTP/1.1
Host: myserver.fmi.filemaker-cloud.com
Authorization: Bearer <token>
```

→ `200 OK`, `{"response":{"layouts":[{"name":"Products"},{"name":"Customers"}]},"messages":[{"code":"0","message":"OK"}]}`

- **HTTP status code:** 200 expected. [DOCUMENTED — not live]
- **Time to first successful call:** N/A (not executed). Practically fast once Data API + `fmrest` privilege + SSL are in place; setup time is dominated by server-side enablement.
- **Gotchas encountered during setup:** SSL cert validity, the `fmrest` extended privilege being off by default, and database name being **case-sensitive** on some platforms are the classic setup failures. [DOCUMENTED]

- [ ] **GATE CHECK: First successful API call completed — NOT DONE (no reachable server).** 🔬

---

## Phase 3: Domain Model & Behavior

> **The fundamental truth about FileMaker:** there is **no fixed domain model.** FileMaker is a database _platform_ — the "entities" are whatever **layouts** (table views) the customer's solution defines, exposing whatever **fields** the customer created. The Data API's own first-class entities are structural (Database → Layout → Record → Field/Portal/Container → Script), and the _business_ entities are entirely tenant-specific and must be discovered at runtime. This is the same discovery-first posture as the Podio / Dataverse connectors.

### 3.1 Core Entities [REQUIRED]

#### Entity: Database

- **API resource name / endpoint path:** `/databases` (list names), then everything nests under `/databases/{database}`.
- **Description:** A hosted `.fmp12` solution file. The connector's `database` credential field names exactly one.
- **CRUD support:** Read (list names) only via Data API. Creation/deletion is done in FileMaker Pro / Admin Console, not the API.

#### Entity: Layout

- **API resource name:** `/databases/{database}/layouts` (list), `/databases/{database}/layouts/{layout}` (metadata).
- **Description:** A FileMaker layout = a view onto a table occurrence. **All record I/O is performed _through a layout_, not directly against a table.** A record's available fields, portals, and value lists are exactly those placed on the chosen layout. Choosing the right layout is the key modelling decision for every call.
- **CRUD support:** Read (list + metadata) only via the API.

**Layout-metadata fields (from `GET .../layouts/{layout}`):** `fieldMetaData[]` (each: `name`, `type`, `displayType`, `result`, `global`, `repetitions`, `maxRepeat`, `notEmpty`, `valueList`?), `portalMetaData{}` (per related-set), `valueLists[]`. [DOCUMENTED]

#### Entity: Record

- **API resource name:** `/databases/{database}/layouts/{layout}/records` and `.../records/{recordId}`.
- **Description:** A row in the table backing the layout. Read/written as a flat `fieldData` object plus optional `portalData`.
- **CRUD support:** Create, Read (single + range + find), Update (PATCH), Delete — all supported. [DOCUMENTED]

**Record envelope (in responses):**

| Field        | Type   | Description                                                       | Example                           |
| ------------ | ------ | ----------------------------------------------------------------- | --------------------------------- |
| `recordId`   | string | Server-assigned internal row handle (integer-as-string)           | `"12"`                            |
| `modId`      | string | Modification counter; used for optimistic locking on PATCH/DELETE | `"3"`                             |
| `fieldData`  | object | All layout field values, keyed by exact field name                | `{"First Name":"Joe","Stock":40}` |
| `portalData` | object | Related records, keyed by portal/object name                      | `{"Line Items":[{...}]}`          |

#### Entity: Field (within `fieldData`)

- **Description:** A tenant-defined column. Type is one of FileMaker's field types (text, number, date, time, timestamp, container, calculation, summary). Calculation/summary fields are read-only. Container fields hold binary and are read as URLs / written via the container endpoint.
- **CRUD support:** Writable iff the field is enterable on that layout and not a calc/summary/auto-enter-only field.

#### Entity: Portal (within `portalData`)

- **Description:** A related-record set placed on the layout. Returned under `portalData`, keyed by the portal's object name (or related table-occurrence name). Each portal row carries its own `recordId` and `modId`.
- **CRUD support:** Read with the parent; portal rows can be created/edited via the parent record's PATCH using `<TO::field>` keys and `recordId` for edits.

#### Entity: Script

- **API resource name:** `/databases/{database}/scripts` (list names). Scripts are **invoked**, not CRUD-managed.
- **Description:** A named FileMaker script in the solution. Can be run standalone (`/script/{name}`) or chained onto a record/find call via `script`, `script.prerequest`, `script.presort` (+ matching `.param`).
- **CRUD support:** Execute only.

#### Entity: Session (token)

- **API resource name:** `/databases/{database}/sessions` (POST to create) and `/sessions/{token}` (DELETE to end).
- **Description:** The auth lifecycle object (see Phase 2.3).

> **Discovery tip (mandatory for this connector):** Before any read/write the agent MUST resolve the tenant's structure: `GET .../layouts` → pick a layout → `GET .../layouts/{layout}` for field names/types → only then build `fieldData`/`query`. Field names are free-text and unknowable in advance.

### 3.2 Entity Relationships [IMPORTANT]

```
┌───────────────────┐
│  FileMaker Server │  (= customer's server_url)
│  (self-hosted)    │
└─────────┬─────────┘
          │ 1:N
          ▼
   ┌────────────┐       hosts        ┌────────────┐
   │  Database  │───────────────────>│   Script   │ (execute-only)
   │ (.fmp12)   │                    └────────────┘
   └─────┬──────┘
         │ 1:N (exposes)
         ▼
   ┌────────────┐  view onto a table occurrence
   │  Layout    │
   └─────┬──────┘
         │ 1:N (read/write through)
         ▼
   ┌────────────┐  1:N    ┌──────────────┐
   │  Record    │────────>│ Portal rows  │ (related records)
   │ (recordId, │         └──────────────┘
   │  modId)    │  has-many
   └─────┬──────┘
         │ contains
         ▼
   ┌────────────┐
   │ Field /    │  (text, number, date, container, calc, summary…)
   │ Container  │
   └────────────┘
```

Relationships between _business_ tables (e.g. Customer→Order→LineItem) exist only in the customer's relationship graph and surface to the API as **portals on a layout**. There is no generic "include related entity by ID" — you see related data only if a portal for it is on the layout you query. [DOCUMENTED]

### 3.3 State Machines [IMPORTANT]

The only API-level state machine is the **session/token lifecycle**:

```
[no session] --POST /sessions (Basic)--> [active token]
[active token] --any call--> [active token]  (15-min idle clock RESET on each call)
[active token] --15 min idle--> [expired]    (next call → 952)
[active token] --DELETE /sessions/{token}--> [logged out]
[expired] --POST /sessions (Basic)--> [new active token]
```

| From State   | Action/Trigger           | To State     | Reversible?    | Side Effects                               |
| ------------ | ------------------------ | ------------ | -------------- | ------------------------------------------ |
| no session   | POST /sessions (Basic)   | active token | n/a            | Consumes one of the server's session slots |
| active token | any authenticated call   | active token | n/a            | Resets the 15-min idle timer               |
| active token | 15 min idle              | expired      | yes (re-login) | Token rejected → error `952`               |
| active token | DELETE /sessions/{token} | logged out   | yes (re-login) | Frees the session slot immediately         |

Business-record states (draft/approved/etc.) are entirely tenant-defined in the customer's schema and not visible to the API beyond ordinary field values. [DOCUMENTED]

### 3.4 Business Rules [IMPORTANT]

- **Everything goes through a layout.** You cannot read/write a table directly; you must target a layout that exposes the fields you need. A field absent from the layout is invisible and unwritable via that call. [DOCUMENTED]
- **Field/layout/script names are case- and space-exact**, defined by the customer, and must be URL-encoded in paths. [DOCUMENTED]
- **Field validation is enforced on create/edit.** Required fields, value-list constraints, and unique/validation calcs defined in the schema will reject the write with a FileMaker error code. [DOCUMENTED]
- **Calculation and summary fields are read-only**; sending them in `fieldData` errors. [DOCUMENTED]
- **Optimistic locking via `modId`:** if you send a `modId` on PATCH/DELETE and it doesn't match the current value, the change is rejected (record was modified by someone else). Omit `modId` to force the write. [DOCUMENTED]
- **Dates/times follow the file's settings** unless overridden. Documented examples use `MM/DD/YYYY` or `YYYY/MM/DD`; the request can pass `dateformats` (0=US, 1=file locale, 2=ISO 8601) to control parsing. ISO 8601 is safest. [DOCUMENTED]
- **Session slots are finite** (configurable max on the server). Long-running agents should reuse/refresh one token, not open many. [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

| Format      | Pattern                                  | Example                                     | Notes                                                                 |
| ----------- | ---------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| Date        | `MM/DD/YYYY` or ISO with `dateformats:2` | `01/20/2029` / `2029-01-20`                 | Default follows file; pass `dateformats` to control. ISO recommended. |
| Timestamp   | `MM/DD/YYYY HH:MM:SS` or ISO             | `2029-01-20T13:45:00`                       | Same `dateformats` rule.                                              |
| Time        | `HH:MM:SS`                               | `13:45:00`                                  |                                                                       |
| Number      | JSON number or numeric string            | `40` / `"40"`                               | FileMaker is lenient; strings coerced.                                |
| Currency    | plain number                             | `1234.56`                                   | No symbol; formatting is presentation-layer only.                     |
| recordId    | integer-as-string                        | `"12"`                                      | Server-assigned, NOT a user field.                                    |
| modId       | integer-as-string                        | `"3"`                                       | Optimistic-lock token.                                                |
| Container   | URL (read) / multipart (write)           | `https://{server}/Streaming_SSL/MainDB/...` | Binary served via streaming URL; uploaded via container endpoint.     |
| Enum values | tenant value-lists                       | —                                           | Allowed values come from layout metadata `valueLists`, not the API.   |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

There are **no global enums** — every picklist is a customer-defined **value list** discovered via `GET .../layouts/{layout}` (`valueLists[]`). The only fixed enumerations are API-level controls:

| Context      | Field         | Allowed Values                                             | Notes                                 |
| ------------ | ------------- | ---------------------------------------------------------- | ------------------------------------- |
| Sort         | `sortOrder`   | `ascend`, `descend`                                        | In `_sort` / find `sort`.             |
| Edit request | `dateformats` | `0` (US), `1` (file locale), `2` (ISO)                     | Controls date parsing on create/edit. |
| Field meta   | `result`      | `text`, `number`, `date`, `time`, `timestamp`, `container` | From layout metadata.                 |
| Field meta   | `type`        | `normal`, `calculation`, `summary`                         | calc/summary are read-only.           |

---

## Phase 4: Endpoint Catalog

### 4.1 Critical Endpoints [REQUIRED]

> All paths below are relative to `https://{server_url}/fmi/data/vLatest`. All except login/productInfo/databases require `Authorization: Bearer {token}`.

#### Endpoint: POST /databases/{database}/sessions (Log in)

- **Purpose:** Exchange Basic credentials for a session token.
- **Auth:** Basic (this is how you authenticate).
- **Idempotent:** No (each call mints a new token / consumes a session slot).
- **Request body:** `{}`
- **Success (200):** `{"response":{"token":"<token>"},"messages":[{"code":"0","message":"OK"}]}` [DOCUMENTED]

#### Endpoint: DELETE /databases/{database}/sessions/{token} (Log out)

- **Purpose:** End the session, free the slot.
- **Auth:** the token is in the path (no Bearer header needed for logout).
- **Success (200):** `{"response":{},"messages":[{"code":"0","message":"OK"}]}` [DOCUMENTED]

#### Endpoint: GET /databases/{database}/layouts/{layout}/records (Get a range of records)

- **Purpose:** List records from a layout (no criteria).
- **Auth:** Bearer.
- **Idempotent:** Yes.

**Query parameters:**

| Parameter                              | Type    | Required | Default | Description                                                    |
| -------------------------------------- | ------- | -------- | ------- | -------------------------------------------------------------- |
| `_offset`                              | integer | no       | 1       | 1-based index of first record to return.                       |
| `_limit`                               | integer | no       | 100     | Max records to return.                                         |
| `_sort`                                | JSON    | no       | —       | `[{"fieldName":"Stock","sortOrder":"descend"}]` (URL-encoded). |
| `layout.response`                      | string  | no       | —       | Switch to a different layout for the response shape.           |
| `_offset.{portal}` / `_limit.{portal}` | int     | no       | 1 / 50  | Per-portal pagination.                                         |

**Success (200):** [DOCUMENTED]

```json
{
  "response": {
    "data": [
      {
        "recordId": "1",
        "modId": "0",
        "fieldData": { "Product Name": "Widget", "Stock": 40, "SKU": "W-001" },
        "portalData": {}
      }
    ],
    "dataInfo": {
      "database": "Inventory",
      "layout": "Products",
      "table": "Products",
      "totalRecordCount": 500,
      "foundCount": 500,
      "returnedCount": 1
    }
  },
  "messages": [{ "code": "0", "message": "OK" }]
}
```

#### Endpoint: POST /databases/{database}/layouts/{layout}/\_find (Perform a find request)

- **Purpose:** Query records by criteria. This is the primary read path for filtered data.
- **Auth:** Bearer.
- **Idempotent:** Yes (read-only despite being POST — body carries the query).

**Request body:** [DOCUMENTED]

```json
{
  "query": [{ "Stock": "<40" }, { "Group": "=Surgeon" }, { "Work State": "NY", "omit": "true" }],
  "sort": [{ "fieldName": "Stock", "sortOrder": "descend" }],
  "limit": "10",
  "offset": "1",
  "portal": ["Line Items"],
  "limit.Line Items": "5"
}
```

- Multiple objects in `query[]` are **OR**'d together; multiple fields within one object are **AND**'d. An object with `"omit":"true"` excludes its matches. [DOCUMENTED]
- **Success (200):** same `response.data` + `dataInfo` envelope as get-range. [DOCUMENTED]
- **No records found:** returns `messages:[{"code":"401","message":"No records match the request"}]` (FileMaker error 401, **not** an HTTP 401). [DOCUMENTED]

#### Endpoint: POST /databases/{database}/layouts/{layout}/records (Create a record)

- **Purpose:** Create one record on a layout.
- **Auth:** Bearer. **Idempotent:** No.

**Request body:** [DOCUMENTED]

```json
{
  "fieldData": { "Product Name": "Gadget", "Stock": 100, "SKU": "G-007" },
  "portalData": {}
}
```

**Success (200):** `{"response":{"recordId":"514","modId":"0"},"messages":[{"code":"0","message":"OK"}]}` [DOCUMENTED]

#### Endpoint: PATCH /databases/{database}/layouts/{layout}/records/{recordId} (Edit a record)

- **Purpose:** Update fields on an existing record.
- **Auth:** Bearer. **Idempotent:** Yes per-record (same body → same result), though `modId` increments.

**Request body:** [DOCUMENTED]

```json
{
  "fieldData": { "Stock": 95 },
  "modId": "3"
}
```

**Success (200):** `{"response":{"modId":"4"},"messages":[{"code":"0","message":"OK"}]}` [DOCUMENTED]

#### Endpoint: DELETE /databases/{database}/layouts/{layout}/records/{recordId} (Delete a record)

- **Purpose:** Delete one record. **Auth:** Bearer. **Idempotent:** Yes (deleting an already-gone record errors `101`).
- **Success (200):** `{"response":{},"messages":[{"code":"0","message":"OK"}]}` [DOCUMENTED]

#### Endpoint: GET /databases/{database}/layouts / GET .../layouts/{layout} (Metadata)

- **Purpose:** Discover layout names, then a layout's fields/portals/value-lists. **Foundational for this connector** (Phase 3 discovery). [DOCUMENTED]

#### Endpoint: GET /databases/{database}/scripts + GET .../layouts/{layout}/script/{scriptName} (Scripts)

- **Purpose:** List scripts; run one standalone. Optional query params `script.param`. [DOCUMENTED]

### 4.2 Full Endpoint Index [IMPORTANT]

| Method | Path (under `/fmi/data/vLatest`)                                                          | Purpose                                      | Auth?         | Paginated?                  | Notes                                                               |
| ------ | ----------------------------------------------------------------------------------------- | -------------------------------------------- | ------------- | --------------------------- | ------------------------------------------------------------------- |
| GET    | `/productinfo`                                                                            | Host product/version info                    | No            | No                          | `name, version, buildDate, dateFormat, timeFormat, timeStampFormat` |
| GET    | `/databases`                                                                              | List Data-API-enabled databases              | No\*          | No                          | \*May require Basic; behaviour varies by server config              |
| POST   | `/databases/{db}/sessions`                                                                | Log in → token                               | Basic         | No                          | Body `{}`                                                           |
| DELETE | `/databases/{db}/sessions/{token}`                                                        | Log out                                      | token-in-path | No                          |                                                                     |
| GET    | `/databases/{db}/layouts`                                                                 | List layout names                            | Bearer        | No                          | Discovery                                                           |
| GET    | `/databases/{db}/layouts/{layout}`                                                        | Layout metadata (fields/portals/value lists) | Bearer        | No                          | Discovery                                                           |
| GET    | `/databases/{db}/scripts`                                                                 | List script names                            | Bearer        | No                          |                                                                     |
| GET    | `/databases/{db}/layouts/{layout}/records`                                                | Get range of records                         | Bearer        | Yes (`_offset`/`_limit`)    |                                                                     |
| GET    | `/databases/{db}/layouts/{layout}/records/{recordId}`                                     | Get one record                               | Bearer        | No                          |                                                                     |
| POST   | `/databases/{db}/layouts/{layout}/records`                                                | Create record                                | Bearer        | No                          |                                                                     |
| PATCH  | `/databases/{db}/layouts/{layout}/records/{recordId}`                                     | Edit record                                  | Bearer        | No                          | `modId` for locking                                                 |
| DELETE | `/databases/{db}/layouts/{layout}/records/{recordId}`                                     | Delete record                                | Bearer        | No                          |                                                                     |
| POST   | `/databases/{db}/layouts/{layout}/_find`                                                  | Find (query) records                         | Bearer        | Yes (body `offset`/`limit`) | 401 = no matches                                                    |
| PATCH  | `/databases/{db}/layouts/{layout}/globals`                                                | Set global field values                      | Bearer        | No                          | Per-session globals                                                 |
| GET    | `/databases/{db}/layouts/{layout}/script/{scriptName}`                                    | Run a script (standalone)                    | Bearer        | No                          | `?script.param=`                                                    |
| POST   | `/databases/{db}/layouts/{layout}/records/{recordId}/containers/{fieldName}/{repetition}` | Upload container data                        | Bearer        | No                          | `multipart/form-data`                                               |

### 4.3 Non-REST Endpoints [NICE-TO-HAVE]

None. The Data API is purely REST/JSON. (FileMaker also offers a separate **Admin API** at `/fmi/admin/api/v2` for server administration and an in-app **Execute FileMaker Data API** script step — both out of scope for this connector.)

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported? | Syntax                                                 | Notes                                                                          |
| ------------------------------- | ---------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Filter by field value           | Yes        | `{"Field":"value"}` in `query[]`                       | `=value` for exact whole-word match                                            |
| Filter by date range            | Yes        | `{"Date":"1/1/2025...12/31/2025"}`                     | FileMaker `...` range operator                                                 |
| Full-text search                | Partial    | `{"Field":"word"}`                                     | Word-based "contains" by default; not arbitrary substring                      |
| Sort by field                   | Yes        | `sort:[{"fieldName","sortOrder"}]`                     | Multiple sort keys allowed                                                     |
| Sort direction (asc/desc)       | Yes        | `"ascend"` / `"descend"`                               | Also value-list sort supported                                                 |
| Field selection / sparse fields | No         | —                                                      | You get the whole layout's fields; control via choosing the layout             |
| Include related records         | Yes        | `portal:[...]`                                         | Only portals present on the layout                                             |
| Aggregate / count               | Partial    | `dataInfo.foundCount` / `totalRecordCount`             | No GROUP BY; counts only                                                       |
| Logical operators (AND/OR)      | Yes        | AND = same object; OR = separate objects in `query[]`  |                                                                                |
| Comparison operators            | Yes        | `<`, `>`, `<=` (`≤`), `>=` (`≥`) prefix on value       | e.g. `{"Stock":"<40"}`                                                         |
| Null / empty checks             | Yes        | `{"Field":"=="}` (empty) / `{"Field":"*"}` (non-empty) | FileMaker operators                                                            |
| Regex / pattern matching        | No         | —                                                      | Only FileMaker wildcards: `*` (any), `?` (one char), `#` (digit), `@` (letter) |
| Omit (NOT) matches              | Yes        | `{"Field":"x","omit":"true"}`                          | Excludes matching set                                                          |

### 5.2 Filter Syntax [REQUIRED]

Find criteria are an array of request objects in the `_find` body:

```json
"query": [
  { "Stock": "<40", "Category": "Tools" },     // AND: low stock AND Tools
  { "Category": "Clearance" },                  // OR this whole condition
  { "Status": "Discontinued", "omit": "true" } // ...but OMIT discontinued
]
```

**Operators (placed at the start of the value string):** `=` exact/whole-word, `==` exact-field-content, `<` `>` `≤`(`<=`) `≥`(`>=`) comparison, `...` range (`"1...10"`), wildcards `* ? # @`, `"=="` for empty field, `"*"` for any non-empty. [DOCUMENTED]

### 5.3 Sort Syntax [IMPORTANT]

```
GET  ...?_sort=[{"fieldName":"Product Name","sortOrder":"ascend"}]   (URL-encoded)
POST .../_find body: "sort":[{"fieldName":"Stock","sortOrder":"descend"},{"fieldName":"SKU","sortOrder":"ascend"}]
```

`sortOrder` may also be a value-list name to sort by a custom order. [DOCUMENTED]

### 5.4 Field Selection [NICE-TO-HAVE]

No sparse-fieldset parameter. You always receive every field on the targeted layout. To return fewer fields, **target a leaner layout** (`layout.response`). This is why customers often build dedicated "API layouts". [DOCUMENTED]

### 5.5 Search Capabilities [IMPORTANT]

- **Global search endpoint:** None — search is always per-layout via `_find`.
- **Searchable fields:** Any field present on the layout.
- **Fuzzy matching:** Word-based matching + wildcards; no true fuzzy/Levenshtein. [DOCUMENTED]
- **Minimum query length:** None documented.

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: Low-stock products, newest first, first page**

```http
POST /fmi/data/vLatest/databases/Inventory/layouts/Products/_find
{ "query":[{"Stock":"<40"}], "sort":[{"fieldName":"Modified","sortOrder":"descend"}], "limit":"50", "offset":"1" }
```

**Pattern 2: Exact match on a customer-defined field, excluding a status**

```http
POST .../layouts/Customers/_find
{ "query":[{"Account Manager":"=Jane Smith"},{"Status":"Closed","omit":"true"}], "limit":"100" }
```

**Pattern 3: Date range**

```http
POST .../layouts/Orders/_find
{ "query":[{"Order Date":"01/01/2026...03/31/2026"}], "sort":[{"fieldName":"Order Date","sortOrder":"ascend"}] }
```

**Pattern 4: Browse all (no criteria) with pagination**

```http
GET .../layouts/Products/records?_offset=101&_limit=100&_sort=%5B%7B%22fieldName%22%3A%22SKU%22%2C%22sortOrder%22%3A%22ascend%22%7D%5D
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** Offset-based (1-based). [DOCUMENTED]
- **Default page size:** 100 records (50 for portal rows). [DOCUMENTED]
- **Maximum page size:** Not documented as a hard cap; bounded by server memory / config. Use explicit reasonable `_limit` (e.g. 100–500). [INFERRED]
- **Total count available:** Yes — `response.dataInfo.foundCount` (matching the query) and `totalRecordCount` (whole table). [DOCUMENTED]

**Request parameters:**

| Parameter                              | Type    | Default | Description           |
| -------------------------------------- | ------- | ------- | --------------------- |
| `_offset` (GET) / `offset` (find body) | integer | 1       | 1-based first record. |
| `_limit` (GET) / `limit` (find body)   | integer | 100     | Records per page.     |

**Response structure:** `response.data[]` plus `response.dataInfo.{foundCount,returnedCount,totalRecordCount}`. [DOCUMENTED]

**How to detect last page:** `offset + returnedCount - 1 >= foundCount`, OR `returnedCount < limit`, OR `data` empty. [INFERRED from dataInfo semantics]

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET .../records?_offset=1&_limit=100      → dataInfo.foundCount=240, returnedCount=100
Page 2: GET .../records?_offset=101&_limit=100    → returnedCount=100
Page 3: GET .../records?_offset=201&_limit=100    → returnedCount=40  (40 < 100 → last page)
```

### 6.3 Bulk Operations [IMPORTANT]

| Operation             | Endpoint            | Max Batch      | Notes                                                     |
| --------------------- | ------------------- | -------------- | --------------------------------------------------------- |
| Bulk create           | —                   | 1 record/call  | No batch create endpoint; loop. [DOCUMENTED]              |
| Bulk update           | —                   | 1 record/call  | Loop, or run a server-side script that loops a found set. |
| Bulk delete           | —                   | 1 record/call  | Same; a script is the efficient path.                     |
| Bulk read / batch get | `_find` / get-range | up to `_limit` | Reads are naturally batched via pagination.               |

**Partial failure handling:** Not applicable — each write is a single record. For multi-record mutation prefer a FileMaker **script** that operates on a found set, invoked via the script endpoint (atomic from the API's perspective). [INFERRED]

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

No async export endpoint. Large pulls = paginate `_find`/get-range. For very large sets a server-side script producing a file is the customer's usual workaround. [INFERRED]

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported? | Notes                                  |
| ------------------------ | ---------- | -------------------------------------- |
| Webhooks                 | No         | Not part of the Data API. [DOCUMENTED] |
| WebSocket                | No         |                                        |
| Server-Sent Events (SSE) | No         |                                        |
| Long polling             | No         |                                        |
| Change feeds / streams   | No         |                                        |

### 7.2 Webhooks [IMPORTANT]

Not supported. (FileMaker solutions _can_ push outbound via the `Insert from URL` script step on triggers, but that is custom solution logic, not an API feature this connector can rely on.) [DOCUMENTED]

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended polling endpoint:** `_find` with a criterion on a modification-timestamp field.
- **Change detection field(s):** A customer-defined **modification timestamp** field (FileMaker auto-enter "Modification Timestamp"). There is no universal server-wide "modified since" — it relies on the schema having such a field. `recordId` is stable; `modId` increments per edit but isn't directly queryable. [INFERRED]
- **Recommended interval:** Conservative (e.g. ≥5 min); each poll consumes a session + query and there is no rate-limit guidance, so respect the customer's server load. [INFERRED]

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope               | Limit                          | Window | Notes                                                                               |
| ------------------- | ------------------------------ | ------ | ----------------------------------------------------------------------------------- |
| Global              | None published                 | —      | Self-hosted; throughput = customer hardware.                                        |
| Concurrent sessions | Configurable cap on the server | —      | "Maximum Data API connections" setting; exceeding it fails new logins. [DOCUMENTED] |

- **Rate limit headers:** None. [DOCUMENTED]
- **Retry-After header:** Absent. [DOCUMENTED]
- **Backoff strategy:** No 429s expected. The realistic failure under load is **session exhaustion** (too many concurrent tokens) — mitigate by reusing one token and logging out promptly. [INFERRED]

### 8.2 Error Handling [REQUIRED]

> FileMaker returns **HTTP 200 even for many logical errors** — the real status is in `messages[].code` using FileMaker's numeric error-code list. `code:"0"` = success. Always inspect `messages`, not just the HTTP status. [DOCUMENTED]

**Standard error envelope:**

```json
{
  "response": {},
  "messages": [{ "code": "102", "message": "Field is missing" }]
}
```

**Key FileMaker error codes (from the FileMaker error-codes reference):**

| FM code | Meaning                                       | Retryable?               | Recovery                                                    |
| ------- | --------------------------------------------- | ------------------------ | ----------------------------------------------------------- |
| 0       | OK                                            | —                        | —                                                           |
| 101     | Record is missing                             | No                       | recordId is wrong / already deleted                         |
| 102     | Field is missing                              | No                       | Field not on layout / misspelled — re-check layout metadata |
| 104     | Script is missing                             | No                       | Re-list scripts                                             |
| 105     | Layout is missing                             | No                       | Re-list layouts; check exact name/case                      |
| 106     | Table is missing                              | No                       |                                                             |
| 401     | No records match the request                  | No (not an error per se) | Find returned empty — treat as empty result                 |
| 500     | Date/number/validation value invalid          | No                       | Fix `fieldData` formatting (`dateformats`)                  |
| 504     | Value in field failed unique-value validation | No                       | Duplicate key                                               |
| 802     | Unable to open the file                       | No                       | Database not hosted / wrong name / Data API disabled        |
| 952     | Invalid FileMaker Data API token              | Yes                      | **Re-login (POST /sessions) and retry once**                |
| 953     | Data API request limit / disabled             | No/Maybe                 | Feature off or per-license cap reached                      |

**HTTP-level statuses that DO occur:** `401 Unauthorized` (bad Basic credentials at login), `403`/`404` (wrong server/database path), `500` (server fault), and TLS/connection errors for bad certs. [DOCUMENTED / INFERRED]

**Validation error format:** Same envelope; `messages[].code` in the 5xx FileMaker range (500/504/etc.) with a human message. No field-by-field array. [DOCUMENTED]

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** No dedicated header. [DOCUMENTED]
- **Natural idempotency:** GET yes; PATCH yes (same body → same end state, though `modId` bumps); DELETE yes (second delete → `101`); POST create no (each call adds a row). [INFERRED]
- **Optimistic concurrency:** `modId` on PATCH/DELETE prevents lost updates. [DOCUMENTED]

### 8.5 File Handling [IMPORTANT]

- **Upload endpoint:** `POST .../records/{recordId}/containers/{fieldName}/{repetition}`, `multipart/form-data` with the binary part. [DOCUMENTED]
- **Download:** Container fields return a **streaming URL** (`/Streaming_SSL/...`) in `fieldData`; fetch that URL (token-protected, short-lived) to get the bytes. [DOCUMENTED]
- **connect_request caveat:** `connect_request` is JSON-only, so **container upload (multipart) is out of scope for the v1 chat connector** — flag as a v2/needs-handler item (same posture as Podio attachments). Container _download_ via the streaming URL is feasible if the agent can follow the URL with the token. [INFERRED — design]

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- **Optimistic locking:** `modId` (per-record version). [DOCUMENTED]
- **Consistency:** Strong/immediate (single hosted file; not eventually consistent). [INFERRED]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                         | Fits?   | Notes                                                                                                |
| -------------------------- | --------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| **Data Connector (Files)** | API is primarily a file storage/document system     | No      | FileMaker is a structured database, not a file tree. Container fields exist but are not the product. |
| **Data Connector**         | API has file-like content to browse/search/download | No      | No `list_files`/`download_file` mental model fits records/layouts.                                   |
| **Direct API Only**        | Action/record-oriented API surface                  | **Yes** | Records, finds, scripts — all via authenticated REST.                                                |
| **Hybrid**                 | Browsable content AND actions                       | No      | Container download could be a v2 nicety, but doesn't justify a Files connector.                      |

**Selected integration path:** **Direct API via `connect_request`** (registry `authType: 'username-password'`).

**Justification:** FileMaker exposes tenant-defined structured data (records on layouts, plus scripts) — not a browsable document tree — so it does **not** belong in Files > Remote and needs no `list_files`/`download_file` interface. This mirrors the spec-driven, chat-only `connect_request` pattern used for Podio / Zoho / Actionstep / Connecteam: the workspace agent issues authenticated REST calls through Numa's `connect_request` proxy using credentials from the user's vault, with `01-llm-api-rules.md` as the agent's mental model.

**The one material difference from those connectors** is auth: FileMaker is **not** a static-key or OAuth-bearer flow. The backend must perform a **Basic-auth login** (`POST .../sessions`) to obtain a **short-lived session token (~15-min sliding idle)**, then send `Bearer {token}`, and **re-login on error `952`**. The connector's four credential fields (`server_url`, `username`, `password`, `database`) carry everything needed; the token is ephemeral and managed by the backend, never stored long-term. This token-lifecycle handling is the primary build task and the main risk.

### 9.2 Connector Requirements [IMPORTANT]

Not a Files connector — no `list_files`/`download_file` mapping required. The "connector methods" are effectively the REST operations the agent drives via `connect_request`:

| Capability (agent intent) | API endpoint                                  | Notes                                          |
| ------------------------- | --------------------------------------------- | ---------------------------------------------- |
| Authenticate              | `POST /databases/{db}/sessions` (Basic)       | Backend-managed token; retry on 952            |
| Discover structure        | `GET .../layouts`, `GET .../layouts/{layout}` | **Mandatory first step** before any read/write |
| Read (browse)             | `GET .../layouts/{layout}/records`            | offset/limit                                   |
| Read (query)              | `POST .../layouts/{layout}/_find`             | primary filtered read                          |
| Create                    | `POST .../layouts/{layout}/records`           |                                                |
| Update                    | `PATCH .../records/{recordId}`                | optional `modId`                               |
| Delete                    | `DELETE .../records/{recordId}`               |                                                |
| Run business logic        | `GET .../layouts/{layout}/script/{name}`      | for bulk / complex ops                         |

**Auth type for connector:** username-password → session token (matches registry). **Connector category:** database. **Caching appropriate:** Cache _layout metadata_ per (server, database, layout) for a session (schema is stable); do NOT cache record data. Cache the session token within its 15-min window.

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Discover the tenant's databases/layouts/fields/scripts at runtime (metadata endpoints) — required before anything else.
2. Read and query records (`_find`, get-range) with pagination, sorting, and FileMaker find operators; report counts from `dataInfo`.
3. Create / edit / delete individual records on a chosen layout, respecting `modId` and field validation; run named FileMaker scripts for bulk/complex operations.

**CANNOT do (out of scope or dangerous):**

1. Upload container (binary) data — `connect_request` is JSON-only; multipart is a v2/needs-handler item.
2. Administer the server or change schema (no Admin API access; layouts/fields/scripts are managed in FileMaker Pro).
3. Guess field/layout/script names — must always resolve via metadata first; blind writes risk validation failures and wrong-layout data exposure.

**Default parameters:**

| Parameter               | Default                                                    | Reason                                                   |
| ----------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| API version             | `vLatest`                                                  | Forward-compatible across customer server versions.      |
| `_limit` / find `limit` | 100                                                        | API default; safe page size.                             |
| `dateformats`           | `2` (ISO 8601)                                             | Avoids locale-dependent date parsing bugs.               |
| Token strategy          | login-per-task, cache for 15-min window, re-login on `952` | Balances latency vs session-slot pressure.               |
| `_sort`                 | none unless asked                                          | Avoid surprising ordering; let the layout default apply. |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK               | Language | Quality | Maintained? | Worth Using?   | Notes                                                                                                       |
| ----------------- | -------- | ------- | ----------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| python-fmrest     | Python   | good    | yes         | Reference only | Numa uses raw httpx via `connect_request`; fmrest is a great spec for token handling + container mechanics. |
| fms-api-client    | Node     | good    | community   | Reference only | Best example of token refresh + retry-on-952.                                                               |
| (Claris official) | —        | —       | —           | —              | No official SDK.                                                                                            |

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed
- [ ] **Phase 2 first LIVE call — NOT DONE (no reachable/sandbox server)** 🔬 — auth flow fully documented
- [x] Phase 3 complete: structural entities + discovery-first model documented (business entities are tenant-defined)
- [x] Phase 4 complete: ≥5 critical endpoints with request/response
- [x] Phase 5 complete: find operators, sort, pagination documented
- [x] Phase 6 complete: offset/limit model with worked example
- [x] Phase 7 complete: no events — polling fallback documented
- [x] Phase 8 complete: error envelope (200-with-`messages`), key codes, 952 retry, rate-limit absence
- [x] Phase 9 complete: integration path selected + justified (Direct API via `connect_request`, token lifecycle flagged)

**Overall investigation confidence:** medium — official docs are thorough and the API shape is stable and well understood, but (a) no live call was possible and (b) the business domain is entirely tenant-specific, so per-customer specifics are undiscoverable without a real connection.

**Known gaps that will reduce output quality:**

1. No live response capture — exact `dataInfo` field set, container streaming-URL format, and error bodies are documented but unverified against a running server. 🔬
2. The customer's actual layouts/fields/scripts/value-lists are unknown until runtime discovery — `01a-domain-model-reference.md` must be a _discovery procedure_, not a fixed schema.
3. Exact session-slot limits and any per-license Data API call cap are server-config-dependent and unpublished. 🔬

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate?            | Confidence  | Gaps                                                                                                                      |
| ---------------------------- | ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| 01-llm-api-rules             | Yes                      | medium-high | Stress token lifecycle (Basic→Bearer, 15-min idle, retry-on-952) and "always check `messages[].code`, HTTP 200 ≠ success" |
| 01a-domain-model-reference   | Yes (as discovery guide) | medium      | No fixed schema — must document the layout/field/script discovery procedure                                               |
| 01b-query-patterns           | Yes                      | medium-high | `_find` operators + offset/limit well documented; not live-verified                                                       |
| 01c-mutation-patterns        | Yes                      | medium      | create/edit/delete + `modId` documented; validation errors are schema-specific                                            |
| 01d-event-and-error-handling | Yes                      | medium      | No events; error-code table from FileMaker docs (not live)                                                                |
| 02-api-spec-investigation    | Yes                      | medium      | Endpoint shapes documented; counts/limits server-dependent                                                                |
| 03-connector-setup           | Yes                      | medium-high | username-password + per-tenant `server_url`/`database`; token-lifecycle handling is the key implementation note           |

---

## Appendix: FileMaker-Specific Gotchas (carry into all downstream docs)

1. **HTTP 200 ≠ success.** Always read `messages[0].code`; `"0"` is OK, everything else is a FileMaker error. Find with no matches returns code `401` (not HTTP 401).
2. **Token expires in ~15 min idle, no refresh.** Re-login on `952` and retry once. Log out when done to free session slots.
3. **Everything is layout-scoped.** No direct table access; a field absent from the layout is invisible/unwritable.
4. **Names are tenant-defined, case/space-exact, URL-encode them.** Never guess — discover via metadata endpoints first.
5. **Per-tenant server.** No sandbox, no Claris status page, no published rate limits; throughput = the customer's hardware and session-slot config.
6. **`recordId`/`modId` are API artifacts**, not user fields — `recordId` addresses records, `modId` guards against lost updates.
7. **Container upload is multipart → out of scope for JSON-only `connect_request` (v2).** Container download via streaming URL is feasible.

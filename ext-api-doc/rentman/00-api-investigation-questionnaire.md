---
api_name: 'Rentman API (v4)'
api_slug: 'rentman'
vendor: 'Rentman B.V. — cloud rental management software for AV, event and production companies'
website: 'https://rentman.io'
investigation_started: '2026-06-10'
investigator: 'Numa API Investigation Agent (live spec fetch + support-article research, 2026-06-10)'
investigation_status: 'blocked' # spec research complete; Phase 2.4 authenticated-call gate NOT passed (no credentials)
documentation_quality: 'excellent' # full machine-readable OpenAPI 3.1.1 spec, live-fetched
api_types: [REST]
overall_confidence: 'medium-high'
blockers:
  - 'No Rentman credentials were available — every endpoint requires a Bearer JWT, so no live API call has been made'
  - 'Error response BODY format is not in the spec (only status codes) — needs a credentialed test'
  - 'Behaviour when the generating user''s ROLE denies an endpoint is undocumented (401? 403? empty?) — needs a low-permission token test'
generated_date: '2026-06-10'
---

# API Investigation Questionnaire: Rentman

> **Source:** Live research on **2026-06-10** against the official Rentman API docs
> (`https://api.rentman.net/` — Redoc UI) including a **full download of the machine-readable
> OpenAPI 3.1.1 spec (v1.13.0, 221 paths, 127 schemas)**, plus the Rentman support article
> "The Rentman API" (`support.rentman.io/hc/en-us/articles/360013767839`) and the HQ Ops card
> FEAT-209 (customer request context).
>
> ⚠️ **NO AUTHENTICATED CALL has been made.** No Rentman credentials were available. The spec
> and docs are authoritative for endpoints/shapes, but auth failure modes, error bodies, and
> live envelope behaviour are NOT live-verified.
>
> **Confidence markers (per repo convention for this connector):**
> `[SPEC]` = stated in the live-fetched OpenAPI spec or the api.rentman.net docs page ·
> `[DOCS]` = stated in the Rentman support article · `[INFERRED]` = deduced from patterns ·
> `[UNVERIFIED]` = plausible but unconfirmed · `[UNKNOWN]` = looked and could not find.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** `https://api.rentman.net/` — single-page Redoc reference [SPEC]
- **API reference / endpoint catalog URL:** same page — generated from the OpenAPI spec [SPEC]
- **Authentication guide URL:** covered in the docs-page intro (Authentication section) and the
  support article `https://support.rentman.io/hc/en-us/articles/360013767839-The-Rentman-API` [DOCS]
- **Webhook guide URL:** none — no webhook documentation exists anywhere [UNKNOWN]
- **Changelog URL:** none found; the docs page states "Last deployment is **2026-06-01 16:17**"
  and that only one API version is supported with automatic migration [SPEC]
- **Status page URL:** none found [UNKNOWN]
- **Public roadmap:** `https://rentman.io/public-roadmap` — the documented channel for requesting
  new API data types [SPEC]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** **YES — machine-readable and downloaded.** The Redoc page at
  `https://api.rentman.net/` loads its spec from
  `https://openapi-prod-openapidocumentationbucketprodf3f6f37-23pq5ujpblj3.s3.eu-west-1.amazonaws.com/1.13.0/oas.json`
  (OpenAPI 3.1.1, `info.version: 1.13.0`). Saved locally to `/tmp/rentman_openapi.json` during
  this investigation. ⚠️ The S3 URL is **versioned** — re-extract it from the docs HTML when
  refreshing (`grep -oE 'https://[^"]*oas\.json'`); guessing `/openapi.json` on the API host
  itself returns `403 {"message":"Missing Authentication Token"}` (API Gateway, not a real 403) [SPEC]
- **Postman collection URL:** none found [UNKNOWN]
- **Official SDK repositories:** none — no official SDKs in any language [UNKNOWN — searched]
- **MCP server (beta):** `mcp.rentman.net` — first-party MCP server with OAuth 2.1 + PKCE +
  dynamic client registration (`/authorize`, `/token`, `/register`; MCP endpoint `/mcp`). The
  FEAT-209 customer is in this beta. See Phase 9.4 — this is the customer's actual ask and the
  preferred future surface, blocked on platform-level MCP-auth support in Numa.
- **Community sources used:** none needed — the official spec is complete and machine-readable

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                  |
| ------------------------- | ------ | ----------------------------------------------------------------------- |
| Authentication            | 4      | JWT Bearer model + token generation path documented; role-denial failure mode missing [SPEC][DOCS] |
| Endpoint reference        | 5      | Full OpenAPI spec — 221 paths, every operation with schemas [SPEC]      |
| Request/response examples | 4      | Envelope + expand/pagination examples in docs intro; per-endpoint examples thin |
| Error documentation       | 2      | Status codes enumerated per operation (400/401/404/500/502); **no error body schema anywhere** [UNKNOWN] |
| Rate limit documentation  | 5      | Explicit numbers: 50,000 req/day · 10 req/s · max 20 concurrent [SPEC]  |
| Pagination documentation  | 5      | Cursor (`next_page_url`) + offset modes both documented with examples and caveats [SPEC] |
| Webhook documentation     | —      | No webhooks exist [UNKNOWN]                                             |
| SDKs / code examples      | 1      | No official SDKs; raw HTTP only                                         |
| Changelog / versioning    | 3      | Single rolling version, auto-migration, deployment date shown; no diff history [SPEC] |

**Overall documentation quality:** excellent (machine-readable spec + clear platform conventions;
the only real holes are error bodies and role-denial semantics)

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation (Redoc at `api.rentman.net`) [SPEC]
- [x] **Downloaded the full OpenAPI 3.1.1 spec** (v1.13.0 — 221 paths, 64 resource tags, 127 schemas) [SPEC]
- [x] Identified authentication method (per-user JWT, Bearer) [SPEC][DOCS]
- [ ] Found at least one working **authenticated** example — **NOT done; no credentials** [UNKNOWN]
- [x] Identified rate limit information (50k/day, 10 rps, 20 concurrent) [SPEC]
- [x] Identified pagination approach (cursor `next_page_url` + offset fallback) [SPEC]
- [x] Checked for webhook/event support (none — polling + `updateHash` change detection) [SPEC]
- [x] Checked for official SDKs (none) and MCP (first-party beta at `mcp.rentman.net`)

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Rentman API ("RESTful inspired"; commonly referred to as API v4) [SPEC]
- **Vendor / company:** Rentman B.V. — rental and production management for AV/event companies:
  projects, equipment scheduling and tracking, crew planning, quoting/invoicing, subrentals,
  time registration [SPEC]
- **Current API version:** single rolling version — "We only support one version of the API.
  Integrations are automatically migrated when a new version comes online." Spec `info.version`
  is `1.13.0`; last deployment 2026-06-01 [SPEC]
- **Base URL(s):**
  - Production: `https://api.rentman.net` — single fixed SaaS host, no per-tenant subdomain [SPEC]
  - Sandbox / testing: none documented [UNKNOWN]
  - MCP server (beta): `https://mcp.rentman.net` (separate auth model — Phase 9.4)
- **API type:** REST, JSON [SPEC]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport / format:** HTTPS; JSON request and response bodies [SPEC]
- **URL structure pattern:** flat resource collections + id paths + nested linked collections [SPEC]

```
https://api.rentman.net/{resource}                      e.g. GET /projects
https://api.rentman.net/{resource}/{id}                 e.g. GET /projects/12   (integer ids)
https://api.rentman.net/{resource}/{id}/{linked}        e.g. GET /projects/12/projectequipment
```

- **Required headers (all requests)** [SPEC]:

| Header          | Value                | Purpose                                  |
| --------------- | -------------------- | ----------------------------------------- |
| `Authorization` | `Bearer <JWT>`       | The user's API token                      |
| `Content-Type`  | `application/json`   | Docs say "should always be set" (harmless on GET) |

- **Response envelope (every successful GET/POST/PUT)** [SPEC]:

```json
{
  "data": [ ... ] | { ... },     // array for collections, object for single items
  "itemCount": 10,                // items in THIS response (not the total!)
  "limit": 10,                    // effective limit
  "offset": 0,                    // items skipped
  "next_page_url": "https://api.rentman.net/contacts?cursor=eyJ..." | null
}
```

  `POST`/`PUT` return the created/updated item under `data`; **successful `DELETE` has no
  response body**. `next_page_url` only appears in cursor-paginated collection responses [SPEC].
  ⚠️ `itemCount` counts the returned page, not the total collection — there is **no total count
  field** [SPEC].

- **Versioning strategy:** none per-request — single rolling version, server-side migration [SPEC]
- **CORS policy:** [UNVERIFIED] — irrelevant for Numa (server-side proxy)

### 2.3 Authentication [REQUIRED]

**Method: static per-user JWT, sent as a Bearer token.** [SPEC][DOCS]

```
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOi...
```

- **Generation (exact UI path)** [DOCS]: in the Rentman app —
  **Configuration → Account → Integrations** → (if deactivated, click **Connect** in the
  "API" field) → **Show token**. Regenerate via **Regenerate token** on the same screen.
- **The token is personalized:** "This token is unique for every Rentman user" [SPEC];
  "The access to each call is determined by the **role of the user** who generated the API
  token" [DOCS]. It is generated from the workspace's Configuration screen but is tied to the
  generating user and their permission role — a perfect match for Numa's per-user vault model.
- **Only the last generated token is valid:** "When regenerating a token the previous token
  will not work anymore" [SPEC] — one active token per user; regeneration is the rotation and
  the revocation mechanism.
- **Lifetime:** **10 years** for newly created tokens (previously 5 years — the change applies
  only to new tokens) [DOCS]. Effectively long-lived/static; no refresh mechanism, no scopes.
- **No OAuth on the REST API.** (OAuth 2.1 exists only on the separate MCP beta — Phase 9.4.)
- **Security guidance from Rentman** [DOCS]: treat like a password; never email or screenshot
  it; if a token had to be shared, regenerate afterwards to invalidate the exposed copy.

**Failure semantics:**

| Status | Meaning                                                                              |
| ------ | -------------------------------------------------------------------------------------- |
| 401    | Invalid/regenerated/missing token — the only documented auth failure [SPEC]            |
| 403    | **Not documented anywhere in the spec.** What a role-denied call returns (401? 404? filtered data?) is [UNKNOWN] — test with a low-permission token |

### 2.4 First Successful Call [REQUIRED] — CRITICAL GATE

> ⛔ **GATE NOT PASSED.** No credentials were available. The unauthenticated probe
> `GET https://api.rentman.net/openapi.json` returns API Gateway's
> `403 {"message":"Missing Authentication Token"}` (a routing artifact, not the API's own error
> shape). No `[CONFIRMED]` claims exist in this pack — every endpoint requires auth.

**Endpoint planned for first call (when a token is available):**

```http
GET /projects?limit=1&fields=id,name,number HTTP/1.1
Host: api.rentman.net
Authorization: Bearer <JWT>
Content-Type: application/json
```

(Projects is the cornerstone resource, the call is cheap with `limit=1` + `fields`, and the
response proves auth + envelope + field selection in one shot.)

- **Expected:** 200 with `{ "data": [...], "itemCount": 1, "limit": 1, "offset": 0 }` [SPEC]
- **Gotchas to expect:** none documented for GETs; capture the raw 401 body by also sending one
  bad-token request — the error body shape is the biggest unknown

- [ ] **GATE CHECK: First successful authenticated API call completed and documented above** —
  **NOT DONE; blocked on credentials**

---

## Phase 3: Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

> Rentman models a rental workflow: **Projects** (with mandatory **Subprojects**) consume
> **Equipment** (tracked via **Serial numbers** and **Stock movements**), are staffed by **Crew**
> (via **Project functions**), billed via **Quotes → Contracts → Invoices**, and supplemented by
> **Subrentals** from **Suppliers**. All field lists below are from the OpenAPI spec [SPEC].

#### Entity: Project

- **Endpoint path:** `GET/POST /projects`, `GET /projects/{id}` + ~14 nested linked collections
- **Description:** "Projects are the cornerstone of Rentman. … Projects always include one or
  more subprojects" — even when the UI shows none, one exists [SPEC]
- **Key fields (43 total):** `id`, `name`, `number`, `reference`, `customer` (link → `/contacts/{id}`),
  `cust_contact`, `location`, `account_manager` (link → `/crew/{id}`), `project_type`,
  `usageperiod_start/end`, `planperiod_start/end`, `equipment_period_from/to`, price rollups
  (`project_total_price`, `project_rental_price`, `project_sale_price`, `project_crew_price`, …),
  `estimated_cost`/`planned_cost`/`actual_cost`, `already_invoiced`, `tags`, `custom`
- ⚠️ Most price/period fields are **GENERATED FIELDS** — computed, not sortable/filterable, and
  omitted from collection responses unless requested via `?fields` (see 3.4) [SPEC]
- ⚠️ **No PUT/DELETE on projects** — create + read only via the API (see 4.3)

#### Entity: Subproject

- **Endpoint path:** `GET /subprojects[/{id}]`, `POST /projects/{id}/subprojects` — the
  planning/financial unit inside a project: `status` (link → `/statuses/{id}`), per-cost-group
  discounts, `in_planning`/`in_financial`, the same price rollups, `order` [SPEC]

#### Entity: Equipment

- **Endpoint path:** `GET/POST /equipment`, `GET/PUT /equipment/{id}` + nested: serial numbers,
  accessories, alternatives, set contents, stock movements, suppliers, files, tasks
- **Key fields (57 total):** `id`, `name`, `code`, `folder` (link), `type`, `rental_sales`,
  `price`, `list_price`, `subrental_costs`, `critical_stock_level`, `stock_management`,
  `taxclass`, physical attrs (`weight`, `volume`, `height/width/length`, `power`, `current`),
  webshop fields (`in_shop`, `shop_description_*`), `in_planner`, `in_archive`, `custom` [SPEC]

#### Entity: Contact (+ ContactPerson)

- **Endpoint path:** `GET/POST /contacts`, `GET/PUT/DELETE /contacts/{id}`,
  `GET/POST /contacts/{id}/contactpersons`
- **Key fields (72 total):** `id`, `displayname`, `name`, `firstname`, `surname`, `type`,
  `code`, `accounting_code`, full mailing/visit/invoice address blocks, `country`, geo
  (`latitude`/`longitude`, `distance`, `travel_time`), `custom` [SPEC]
- Contacts double as customers (project `customer` links here) and venues (`location` links)

#### Entity: Crew

- **Endpoint path:** `GET /crew`, `GET /crew/{id}` (read-only) + appointments, availability,
  rates, invitations, tasks, files
- **Key fields (40 total):** `id`, `displayname`, `firstname`, `lastname`, `email`, `phone`,
  `active`, address block, `birthdate`, `driving_license`, `contract`, `default_warehouse`,
  `external` (freelancer flag), `tags`, `custom` [SPEC]

#### Entity: ProjectEquipment (planned equipment)

- **Endpoint path:** `GET /projectequipment`, `/projects/{id}/projectequipment`,
  `/projectequipmentgroup` — **custom linked collections** (read-only; cannot create through
  them — see 3.4). Key fields: `equipment` (link), `quantity`, `unit_price`, `discount`,
  `is_option`, `planperiod_start/end`, `has_missings`, `serial_number_ids` [SPEC]

#### Entity: Invoice / Quote / Contract (financial documents — READ-ONLY)

- **Endpoint paths:** `GET /invoices`, `GET /quotes`, `GET /contracts` (+ `/{id}`,
  `/{id}/invoicelines`, `/{id}/files`) — **no POST/PUT/DELETE on any of them** [SPEC]
- **Invoice key fields** (schema name `FactuurResponse` — Dutch legacy naming): `number`,
  `date`, `customer`, `project`, `price`, `price_invat`, `vat_amount`, `is_paid`,
  `outstanding_balance`, `total_paid`, `date_sent`, `finalized` [SPEC]. **Quote**
  (`QuotationResponse`): `number`, `version`, `customer`, `project`, `date`,
  `expiration_date`, `price` [SPEC]
- Payments ARE writable: `GET/POST /invoices/{id}/payments`, `GET/PUT /payments/{id}` [SPEC]

#### Other entities (summary) [SPEC]

| Entity            | Endpoints                              | Notes                                            |
| ----------------- | -------------------------------------- | ------------------------------------------------- |
| SerialNumber      | `/serialnumbers` (full CRUD)           | `serial`, `equipment` link, `book_value`, `next_inspection`, `qrcodes` |
| Appointment       | `/appointments` (GET/POST/PUT/DELETE)  | `start`, `end`, recurrence fields, `/appointmentcrew` |
| Task / Subtask    | `/tasks` (full CRUD) + per-resource `POST /{res}/{id}/tasks` | `deadline`, `priority`, `status` (link → `/taskstatuses`), assignments |
| TimeRegistration  | `/timeregistration` (GET/POST/PUT/DELETE) | `crewmember`, `start`, `end`, `duration`, `break_duration`, `status` |
| Subrental         | `/subrentals` (read-only + nested)     | `supplier` link, equipment/groups, costs          |
| Supplier          | `/suppliers` (GET/PUT/DELETE)          | Vendor records for subrentals/purchase orders     |
| PurchaseOrder     | `/purchaseorders` (read-only + nested) | Costs, global costs, invoice lines                |
| Repair            | `/repairs` (read-only + tasks/files)   | Equipment repair records                          |
| File              | `/files`, `/{res}/{id}/files` (read-only) | `url` + `proxy_url` (GENERATED) for download; `file_folders` per resource |
| StockLocation / StockMovement / Vehicle | `/stocklocations`, `/stockmovements`, `/vehicles` | Warehouse + logistics  |
| LeaveRequest / LeaveMutation | `/leaverequest`, `/leavemutation` | HR — writable                          |
| Lookup tables     | `/statuses`, `/projecttypes`, `/taskstatuses`, `/leavetypes`, `/ledgercodes`, `/taxclasses`, `/rates`, `/factors`, `/extrainputfields` | Resolve link ids → names |

### 3.2 Entity Relationships [IMPORTANT]

```
Contact (customer/venue) ──┐
                           ├──< Project ──1:N──> Subproject (status → /statuses)
Crew (account_manager) ────┘        │
                                    ├──< ProjectEquipmentGroup ──< ProjectEquipment ──> Equipment
                                    │                                                     ├──< SerialNumber
                                    │                                                     ├──< Accessory / Alternative
                                    │                                                     └──< StockMovement
                                    ├──< ProjectFunctionGroup ──< ProjectFunction ──< ProjectCrew ──> Crew
                                    ├──< Quote · Contract · Invoice ──< InvoiceLine ; Invoice ──< Payment
                                    ├──< Costs · Tasks · Files · Appointments
                                    └──< Subrental ──> Supplier ; PurchaseOrder ──> Supplier
```

**Link mechanics:** reference fields return **path strings** (`"customer": "/contacts/15"`,
`"creator": "/crew/237"`). Use `?expand=` to inline the full object (up to 3 levels,
dot-notation nesting); a null link stays null; expanding a non-link field → 400 [SPEC].

### 3.3 State Machines [IMPORTANT]

- **Subproject status** is a link to the workspace-defined `/statuses` lookup (`id`, `name`) —
  status sets are per-workspace, not a fixed enum. Resolve names via `GET /statuses` [SPEC]
- **Invoice lifecycle** is exposed as flags, not an enum: `finalized`, `date_sent`, `is_paid`,
  `outstanding_balance` — and is read-only via the API anyway [SPEC]
- **Task status** links to the writable `/taskstatuses` lookup [SPEC]
- No lifecycle-action endpoints exist — state moves through field updates where PUT is
  available [SPEC]

### 3.4 Business Rules [IMPORTANT]

- **GENERATED FIELDS** (tagged in field descriptions): computed by the backend, **cannot be
  used for sorting when `limit`/`offset` are set, and cannot be filtered on at all**. Many are
  also **omitted from collection responses unless explicitly requested via `?fields`** (e.g.
  project price rollups) [SPEC]
- **Custom fields** appear under the `custom` key as `custom_<number>`; **not queryable**;
  definitions discoverable via `/extrainputfields` [SPEC]
- **Custom linked collections** (titled "Get *X* custom linked collection", e.g.
  `/projects/{id}/projectequipment`): API-synthesized convenience links — **items can never be
  created through them**, and parent fields may be missing [SPEC]
- **`updateHash`** — every item carries a hash of `id`+`modified`; compare across polls for
  change detection. ⚠️ Documented in the docs-page intro but **not present in the spec's
  response schemas** — confirm its presence in live responses [SPEC/[UNVERIFIED]]
- **Omitted fields in list requests:** some expensive fields are dropped from collection
  responses "to keep requests at a low cost" — request them via `?fields` [SPEC]
- **5 MB response cap:** exceeding it errors — reduce `limit` or trim `?fields` [SPEC]
- **`fields` always includes** `id`, `created`, `modified` regardless of the requested set [SPEC]

### 3.5 Field Format Reference [IMPORTANT]

| Format    | Pattern                              | Example                            | Notes                                  |
| --------- | ------------------------------------ | ----------------------------------- | --------------------------------------- |
| ID        | integer                              | `237`                               | All resources [SPEC]                    |
| Link      | path string                          | `"/contacts/15"`, `"/crew/237"`     | Expandable via `?expand` [SPEC]         |
| DateTime  | string, `format: date-time`, nullable | `"2026-05-01T09:00:00+02:00"` [UNVERIFIED exact zone handling] | `created`/`modified`/period fields [SPEC] |
| Money     | number                               | `1250.5`                            | Currency implied by workspace [SPEC]    |
| Token     | JWT                                  | `eyJ0eXAiOiJKV1Qi...`               | Bearer credential [SPEC]                |
| Custom    | `custom_<n>` under `custom`          | `{"custom": {"custom_3": "..."}}`   | Not queryable [SPEC]                    |
| Enums     | workspace lookups, not fixed enums   | `status: "/statuses/4"`             | Resolve via lookup endpoints [SPEC]     |

---

## Phase 4: Endpoint Catalog

> Assembled from the downloaded OpenAPI spec — **221 paths across 64 resource tags** [SPEC].
> Every operation documents responses `200/400/401/404/500/502`.

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /projects (+ /projects/{id})

- **Purpose:** list/filter projects — the cornerstone resource [SPEC]
- **Pagination:** `limit` (default 300, max 1500) + `next_page_url` cursor [SPEC]

```http
GET /projects?fields=id,name,number,customer,usageperiod_start,usageperiod_end&sort=-usageperiod_start&limit=50
Authorization: Bearer <JWT>
```

**Success shape:** `{ "data": [ProjectResponse...], "itemCount": 50, "limit": 50, "offset": 0, "next_page_url": "..." }` [SPEC]

#### Endpoint: GET /projects/{id}/projectequipment · /projectcrew · /subprojects · /invoices? (via /projects/{id}/contracts, /quotes)

- Project drill-down: planned equipment (custom linked collection — read-only), crew bookings,
  subprojects (financial/planning detail), quotes and contracts [SPEC]

#### Endpoint: GET /equipment (+ /equipment/{id}/serialnumbers, /stockmovements)

- Inventory catalog with stock tracking; `PUT /equipment/{id}` for updates,
  `POST /equipment` to create [SPEC]

#### Endpoint: GET /contacts · POST /contacts · PUT/DELETE /contacts/{id}

- Customer/venue CRM records — full CRUD [SPEC]. DELETE warrants human confirmation in Numa.

#### Endpoint: GET /crew/{id}/appointments · GET /appointments · POST /appointments

- Crew scheduling; appointments writable incl. `PUT/DELETE /appointments/{id}` [SPEC]

#### Endpoint: GET /invoices · GET /invoices/{id}/invoicelines (READ-ONLY)

- Financial reporting: invoice headers + lines; `is_paid`/`outstanding_balance` for AR
  questions; payments writable via `POST /invoices/{id}/payments` [SPEC]

#### Endpoint: GET /timeregistration · POST /timeregistration

- Time tracking records, writable (PUT/DELETE per item too) [SPEC]

### 4.2 Full Endpoint Index (resource level) [IMPORTANT]

All 64 resource families, with write support [SPEC]:

| Resources                       | Write support [SPEC]                                            |
| ------------------------------- | ---------------------------------------------------------------- |
| contacts, contactpersons, serialnumbers, appointments, appointmentcrew, tasks/subtasks/taskassignments/taskstatuses, timeregistration, crewavailability, costs, projectrequests, vehicles | **full CRUD** (creates sometimes via the parent-scoped POST, e.g. `POST /equipment/{id}/serialnumbers`) |
| projects                        | **create only** — `POST /projects`; `/projects/{id}` is GET-only  |
| subprojects                     | create via `POST /projects/{id}/subprojects`; otherwise read      |
| equipment                       | create + update (`POST /equipment`, `PUT /equipment/{id}`) — **no delete** |
| folders                         | create + update                                                   |
| payments                        | create via `POST /invoices/{id}/payments`, update via `PUT /payments/{id}` |
| leaverequest / leavemutation    | create; `PUT` on leaverequest only                                |
| suppliers                       | update/delete only (no create)                                    |
| stockmovements, equipmentsetscontent, accessories, alternatives, projectrequestequipment | create via parent POST; PUT/DELETE on `/{resource}/{id}` |
| crew, invoices, quotes, contracts, invoicelines, purchaseorders (+costs), subrentals (+equipment/groups), repairs, files, file_folders | **read-only** |
| projectequipment / projectcrew / projectvehicles / projectfunctions / projectequipmentgroup | read-only **custom linked collections** |
| Lookups: statuses, projecttypes, leavetypes, ledgercodes, taxclasses, rates, ratefactors, factors, factorgroups, extrainputfields, invitations, crewrates | read-only |

### 4.3 Notable write gaps (encode in LLM rules)

- **Projects: no update, no delete** — `POST /projects` exists, `/projects/{id}` is GET-only [SPEC]
- **Invoices, quotes, contracts, purchase orders, subrentals, repairs, crew, files: read-only** [SPEC]
- **Equipment: no delete** (archive via `in_archive`? — [UNVERIFIED] whether PUT accepts it)
- No deprecated endpoints — single rolling version [SPEC]

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability             | Supported? | Syntax                                       | Notes                                          |
| ---------------------- | ---------- | --------------------------------------------- | ----------------------------------------------- |
| Field selection        | yes        | `?fields=displayname,firstname`               | `id`, `created`, `modified` always included [SPEC] |
| Sort                   | yes        | `?sort=+id,-firstname`                        | Multi-field; ⚠️ only the FIRST field is honored while paginating [SPEC] |
| Filter by field value  | yes        | `?country=gb`                                 | Direct equality on any non-generated field [SPEC] |
| Relational operators   | yes        | `?distance[lte]=300`                          | `lt`, `gt`, `lte`, `gte`, `neq` (neq with multiple values = "not in") [SPEC] |
| Null checks            | yes        | `?folder[isnull]=false`                       | Values: `true/false/1/0` [SPEC]                 |
| Date-range filter      | yes        | `?modified[gte]=2026-06-01T00:00:00`          | Via relational ops on date fields [SPEC; exact datetime literal format UNVERIFIED] |
| Expand linked items    | yes        | `?expand=equipment,equipment.creator`         | ≤3 levels; only `item`/`link` fields; 400 otherwise [SPEC] |
| Full-text search       | no         | —                                             | No search endpoint; filter on specific fields [UNKNOWN] |
| Aggregations / totals  | no         | —                                             | `itemCount` is per-page only [SPEC]             |
| Filter generated/custom fields | no | —                                             | GENERATED and `custom_*` fields not queryable [SPEC] |

### 5.2 Common Query Patterns [REQUIRED]

```http
# 1 — recent projects, newest first, lean payload
GET /projects?fields=id,name,number,customer&sort=-id&limit=50

# 2 — projects for one customer (link filter uses the raw id [UNVERIFIED: id vs path-string literal])
GET /projects?customer=/contacts/15

# 3 — equipment below critical stock that is stock-managed
GET /equipment?stock_management=true&fields=id,name,code,critical_stock_level

# 4 — invoices still unpaid, biggest first
GET /invoices?is_paid=false&sort=-price&fields=id,number,date,price,outstanding_balance,customer

# 5 — what changed since the last poll (updateHash/modified watermark)
GET /projects?modified[gte]=2026-06-09T00:00:00&sort=+modified

# 6 — serial numbers with their equipment inlined
GET /serialnumbers?expand=equipment&limit=100

# 7 — everything on one project
GET /projects/42 · /projects/42/subprojects · /projects/42/projectequipment?expand=equipment
```

(All with `Authorization: Bearer <JWT>`. Verify the link-field filter literal — integer id vs
`/contacts/15` path string — on the first credentialed account [UNVERIFIED].)

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

Two modes [SPEC]:

**Cursor (default, preferred):** follow `next_page_url` until `null`.

| Parameter | Type    | Description                                                       |
| --------- | ------- | ------------------------------------------------------------------ |
| `limit`   | integer | Items per page — **default 300, max 1500**; carried over by the cursor |
| `cursor`  | string  | **Opaque** base64 token — "Do not construct or modify it manually — always use the `next_page_url` as-is" |

- `next_page_url` includes ALL original filter params with the cursor appended [SPEC]
- The `ApiResponse` schema notes `next_page_url` is "only present when using cursor_limit" —
  a naming wrinkle vs the docs' `limit`; confirm which parameter actually triggers it on a live
  call [UNVERIFIED]

**Offset (only when sorting by a non-`id` column):** classic `limit` + `offset`; **no
`next_page_url`** — compute pages yourself; stop when `itemCount < limit` [SPEC].

**Hard caps:** max 1500 items/request; max **5 MB** response (error if exceeded — lower `limit`
or trim `fields`) [SPEC].

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /contacts?limit=100&country=gb
        → { data: [100], itemCount: 100, limit: 100, offset: 0,
            next_page_url: "https://api.rentman.net/contacts?country=gb&cursor=eyJhZnRlciI6..." }
Page 2: GET <next_page_url verbatim>
Page N: next_page_url == null → stop
```

Offset variant (non-id sort): `GET /contacts?limit=100&sort=+firstname&offset=0` → `&offset=100` → …
stop when `itemCount < 100`.

**⚠️ Multi-field sort + pagination is inconsistent:** only the first sort field participates in
pagination — items expected on a page by the second/third sort key can land elsewhere. Use a
single sort field when paginating [SPEC].

### 6.3 Bulk Operations [IMPORTANT]

- None — no batch endpoints, no bulk create/update [SPEC]. Concurrency cap is 20 in-flight
  requests; budget 10 rps (Phase 8.1) for sequential page-walks.

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism  | Supported? | Notes                                       |
| ---------- | ---------- | -------------------------------------------- |
| Webhooks   | **no**     | Nothing in the spec, docs, or support center [UNKNOWN — searched] |
| WebSocket / SSE / long polling | no | Not documented                       |

### 7.4 Polling Fallback [IMPORTANT]

- **Change detection is a designed-in feature:** every item carries `modified` (always returned)
  and `updateHash` (hash of `id`+`modified`) [SPEC]
- **Pattern:** `GET /{resource}?modified[gte]={watermark}&sort=+modified` per polled resource;
  advance the watermark; `updateHash` diffing catches updates when paging overlaps
- **Budget:** generous — 50,000 req/day supports minute-level polling of several resources;
  keep bursts ≤10 rps [SPEC]

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope     | Limit              | Window  | Notes                       |
| --------- | ------------------ | ------- | ---------------------------- |
| Per token | **50,000 requests** | per day | Documented on the docs page [SPEC] |
| Per token | **10 requests**     | per second | [SPEC]                    |
| Concurrency | **20 requests**   | in flight | "A maximum of 20 requests can be sent at once" [SPEC] |

- **Rate limit headers / Retry-After:** [UNKNOWN] — not documented; capture on the first
  credentialed 429 (a 429 status is itself [INFERRED] — the docs state limits but not the
  breach status code)
- **Backoff strategy:** stay under 10 rps by design (~150ms between sequential calls during
  page-walks); on any 429/throttle response back off 1s → 5s → 30s with jitter

### 8.2 Error Handling [REQUIRED]

**Standard error response format: [UNKNOWN — needs live testing.]** The spec declares response
*statuses* only — no error body schema exists anywhere. Parse defensively: status code first,
then try JSON, fall back to raw text. (The unauthenticated `{"message":"Missing Authentication
Token"}` seen on spec probing is **API Gateway's** shape, not necessarily the API's own.)

**Status codes declared on every operation** [SPEC]:

| HTTP Status | Meaning                                  | Retryable? | Recovery                                          |
| ----------- | ----------------------------------------- | ---------- | -------------------------------------------------- |
| 400         | Bad request — invalid filter/expand/body  | No         | Fix the query/payload (e.g. expanding a non-link field) |
| 401         | Unauthorized — token invalid/regenerated  | No         | Re-enter the token via the chat card               |
| 404         | Not found — bad id or path                | No         | Verify id/path                                     |
| 500         | "Something went wrong"                    | Cautiously | Retry once with backoff                            |
| 502         | Bad gateway                               | Cautiously | Retry once with backoff                            |
| 403 / 422 / 429 | **Not declared in the spec**          | —          | Observe live; role-denial semantics [UNKNOWN]      |

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** none [SPEC — searched]
- GET idempotent; PUT re-sends safe (id-addressed); **POST retries risk duplicates** (no upsert
  anywhere) — after a write timeout, **query before retrying** (filter on `name`/`reference` or
  the newest `created`)
- DELETE returns no body; a repeat DELETE presumably 404s [INFERRED]

### 8.4 Async Operations / 8.5 File Handling

- **Async:** none documented [SPEC]
- **Files:** read-only — `FileResponse` exposes `url` and `proxy_url` (both GENERATED fields)
  for download; no upload endpoints exist. Whether `url` is pre-signed/expiring is
  [UNVERIFIED] — treat links as short-lived and fetch promptly

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

**Selected integration path:** **Direct API via the Numa native data connector (`request`
operation)** — registry `authType: token`, NOT Pipedream, NOT OAuth. (Not a file source — rental
operations records; Files Remote does not apply.)

**Justification:** Rentman auth is a single user-pasted long-lived Bearer JWT — it maps 1:1
onto the existing token-connector backend (Synergy/Fergus/GoHighLevel precedent): the user's
vault stores `api_key` (= the JWT), and the backend injects `Authorization: Bearer …` on every
call — zero new auth code. The admin contributes metadata only. No special headers, no
versioning header, fixed SaaS base URL.

**Why not Pipedream:** a Pipedream `rentman` integration already exists in Numa
(`integrationsConfig.ts`), but **its prebuilt actions are broken per FEAT-209** — this native
connector is the deliberate workaround, with the raw REST surface superseding the broken
actions.

**Numa request flow:**

```
workspace agent → connectors(name="request", params={connector: "rentman",
                    url: "/projects?limit=50", method: "GET"})
  → backend resolves base_url https://api.rentman.net (connector-config-rentman)
  → injects Authorization: Bearer <user vault: connector-rentman.api_key>
  → forwards; the agent never sees the token
```

### 9.2 Connector Requirements [IMPORTANT]

Not a file connector — `list_files`/`download_file` mapping N/A.

- **Auth type for connector:** `token` — per-user JWT in the personal vault, captured via the
  inline chat credential card on first use
- **Per-client config:** none — fixed SaaS base URL from the registry; wizard instance URL stays empty
- **Connector category:** Rental Management — **Caching:** `projectManagement` preset (30 min)
- **Rentman-side prerequisite:** each connecting user generates a token in **Configuration →
  Account → Integrations → API**; API access mirrors that user's Rentman role

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Answer rental-ops questions: projects/subprojects (incl. price rollups via `?fields`),
   equipment inventory + serial numbers + stock, crew planning/appointments/availability,
   invoices/quotes/contracts (read), payments, time registration, subrentals, purchase orders,
   tasks — with cursor pagination and `?expand` for link resolution
2. Create/update records where the API allows: contacts (full CRUD), equipment (create/update),
   appointments, tasks, time registration, project costs, payments, serial numbers, project
   requests — on explicit user request
3. Resolve link fields (`/statuses/4`, `/contacts/15`) to names via lookups or `?expand` before
   answering
4. Change polling via `modified[gte]` watermarks + `updateHash`
5. Connection diagnostics via `GET /projects?limit=1&fields=id,name`

**CANNOT do (out of scope or dangerous — encode in LLM rules):**

1. Update or delete **projects** (API is create+read only), or write to invoices/quotes/
   contracts/purchase orders/subrentals/crew (read-only resources)
2. Delete contacts/serial numbers/tasks without explicit human confirmation
3. Set the `Authorization` header itself (backend-injected)
4. Sort or filter on **GENERATED** or `custom_*` fields; multi-field sort while paginating
5. Construct/modify `cursor` values manually — always follow `next_page_url` verbatim
6. Upload files (no endpoint) or register webhooks (none exist)
7. Exceed ~10 rps; request >1500 items or risk the 5 MB cap on wide resources without `?fields`

**Default parameters:**

| Parameter | Default                          | Reason                                       |
| --------- | -------------------------------- | --------------------------------------------- |
| `limit`   | 50–100 for answers; ≤1500 walks  | Default 300 is heavy for chat; 5 MB cap       |
| `fields`  | always set on wide resources     | Contacts=72/Equipment=57 fields; omitted-field + size control |
| `sort`    | single field only when paginating | Multi-sort pagination inconsistency [SPEC]   |

### 9.4 MCP Assessment — the customer's actual ask [IMPORTANT]

**Rentman runs a first-party MCP server (beta) at `mcp.rentman.net`** — OAuth 2.1 with PKCE and
dynamic client registration (`/authorize`, `/token`, `/register`; MCP endpoint `/mcp`). **The
FEAT-209 customer is in this beta with it enabled, and connecting Numa to it is their actual
request.**

| Surface                | Auth                          | Numa support today                       |
| ---------------------- | ----------------------------- | ----------------------------------------- |
| REST API (this pack)   | Static Bearer JWT             | ✅ token connector — ships now            |
| MCP beta               | OAuth 2.1 + PKCE + dyn. reg.  | ❌ Numa's MCP surface is **NetSuite-only**; generic remote-MCP auth is a platform feature to spike separately |

**Decision:** ship the REST token connector now (it covers the data); document the MCP server
as the **preferred future surface** once platform-level MCP auth lands — the `01-llm-api-rules`
file should mention it so agents/admins know the trajectory. Do NOT attempt to wire
`mcp.rentman.net` through the current NetSuite-specific MCP path.

**Same card, separate scope:** FEAT-209 also requests **Current RMS** (`api.current-rms.com`) —
a different rental platform; treat as a **separate connector candidate**, out of scope here.

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified; **machine-readable OpenAPI spec downloaded**
- [ ] Phase 2 **partially**: auth model fully documented; **authenticated first-call gate NOT passed (no credentials)**
- [x] Phase 3 complete: entities, hierarchy, link/expand mechanics, GENERATED-field rules
- [x] Phase 4 complete: full 221-path catalog with write-support matrix from the spec
- [x] Phase 5 complete: fields/sort/filters/relational ops/isnull/expand (link-filter literal format unverified)
- [x] Phase 6 complete: cursor + offset pagination, 300/1500 limits, 5 MB cap, sort caveat
- [x] Phase 7 complete: no webhooks → polling with `modified` watermark + `updateHash`
- [x] Phase 8 **mostly**: rate limits numeric and documented; **error body shape and 403/429 semantics [UNKNOWN]**
- [x] Phase 9 complete: token connector selected; MCP beta documented as the future surface

**Overall investigation confidence:** **medium-high** — endpoint/pagination/query facts are
spec-grade; capped by zero authenticated validation, unknown error bodies, and unknown
role-denial semantics.

**Known gaps that will reduce output quality:**

1. **No authenticated call ever made** — envelope, error bodies, 401 shape, throttle status
   all need a credentialed test
2. **Role-denial failure mode** — what a low-permission token gets (401? 404? filtered?) [UNKNOWN]
3. Link-field **filter literal format** (integer id vs `/contacts/15` path string) [UNVERIFIED]
4. `updateHash` presence in live responses (docs say yes; spec schemas omit it) [UNVERIFIED]
5. File `url`/`proxy_url` expiry semantics [UNVERIFIED]
6. Datetime literal format accepted by relational date filters [UNVERIFIED]

### 10.2 Generation Prompts [REQUIRED]

Standard pack from this questionnaire (templates in `ext-api-doc/_templates/`):
**01-llm-api-rules** (Phases 2/4/8/9 — open with the not-live-validated banner; mandate
`?fields` on wide resources, `next_page_url`-verbatim pagination, single-sort-while-paginating,
no GENERATED/custom filtering, human confirmation for deletes; note projects are create/read
only and financial docs read-only; mention the MCP-beta future surface) ·
**01a-domain-model-reference** (Phase 3) · **01b-query-patterns** (Phases 5–6) ·
**01c-mutation-patterns** (Phases 3.4/4.3/8.3: write matrix, no upsert, query-before-retry) ·
**01d-event-and-error-handling** (Phases 7–8: polling + updateHash, defensive error parsing) ·
**02-api-spec-investigation** (all phases condensed — companion file) · **03-connector-setup**
(Phase 9 — real registry/wizard/backend wiring) · **04-connection-and-reauth** (Phase 2.3 +
lifecycle: 10-year JWT, regenerate-invalidates → 401 → chat card; MCP beta as future surface).

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence  | Gaps                                                    |
| ---------------------------- | ------------- | ----------- | -------------------------------------------------------- |
| 01-llm-api-rules             | yes           | medium-high | Error bodies + role-denial unknown                       |
| 01a-domain-model-reference   | yes           | high        | Spec-grade schemas; workspace lookups vary per tenant    |
| 01b-query-patterns           | yes           | high        | Link-filter literal + date literal format unverified     |
| 01c-mutation-patterns        | yes           | high        | Write matrix is spec-exact; validation error shapes unknown |
| 01d-event-and-error-handling | yes           | medium-high | Polling design solid; error bodies unknown               |
| 02-api-spec-investigation    | yes           | high        | Machine-readable spec backs the whole catalog            |
| 03-connector-setup           | yes           | high        | Standard token connector; wiring is real code            |
| 04-connection-and-reauth     | yes           | high        | JWT lifecycle simple and documented (10-year validity)   |

---

_Compiled 2026-06-10 from live fetches of `https://api.rentman.net/` (OpenAPI 3.1.1 spec
v1.13.0, last deployment 2026-06-01) and the Rentman support article, plus FEAT-209 context.
**No authenticated call has been made — re-validate flagged items with a real token before
first customer use.**_

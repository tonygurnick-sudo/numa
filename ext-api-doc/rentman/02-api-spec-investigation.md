---
api_name: Rentman API (v4)
api_slug: rentman
base_url: https://api.rentman.net
path_version_segment: none — "v4" is a product label only; single rolling version (spec v1.13.0, deployed 2026-06-01), integrations auto-migrated, no version header, no /v4/ in any path
call_surface: HTTP via Numa native data connector — `connectors(name="request", params={connector:"rentman", url:"/projects?limit=50", method:"GET"})`. NOT Pipedream, NOT OAuth, NOT a file source.
auth: static per-user JWT, `Authorization: Bearer` (10yr new / 5yr old; role-scoped; no scopes/OAuth/refresh)
field_casing: snake_case
id_format: integer
linked_fields: path strings ("/contacts/15"); expand to inline (≤3 levels)
rate_limit: 50000/day · 10/s · 20 concurrent (per token)
spec_format: OpenAPI 3.1.1 (machine-readable, live-fetched) — 221 paths, 64 resource tags, 127 schemas
spec_url: linked from https://api.rentman.net/ (versioned S3 URL — re-extract from the docs HTML; /openapi.json on the API host 403s)
docs_url: https://api.rentman.net/
date_researched: 2026-06-10
confidence: spec-derived [SPEC] (OpenAPI 3.1.1 v1.13.0, live-fetched 2026-06-10) unless [DOCS] (support article "The Rentman API") or [UNKNOWN] (needs live testing). NO authenticated call was made — no credentials available. Verify against a real token before first customer use.
---

# Rentman — API Specification & Investigation

Developer reference (condensed from `00-api-investigation-questionnaire.md`). A clean, conventional read-heavy API: 221 paths over 64 resources covering the whole rental workflow. Strong querying (field selection, sort, relational filters, `expand` for link inlining) with sharp documented edges: GENERATED fields (not sortable/filterable, often omitted from lists), read-only financial documents, create-only projects.

## Overview

- **Vendor / product:** Rentman B.V. — rental & production management for AV/event companies: projects, equipment scheduling, crew planning, quoting/invoicing, subrentals, time registration.
- **API style:** "RESTful inspired", JSON. Single fixed SaaS host `https://api.rentman.net`, no per-tenant subdomain.
- **Authorization:** API access mirrors the **Rentman role of the user who generated the token** — no scopes [DOCS].

## Authentication — static per-user JWT, Bearer

```
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOi...
Content-Type: application/json
```

- **Generated in the Rentman app:** **Configuration → Account → Integrations** → (click **Connect** in the "API" field if deactivated) → **Show token** [DOCS].
- **Personalized:** unique per Rentman user; every call authorized by the generating user's role; no API scopes [DOCS].
- **Lifetime: 10 years** (new tokens; older tokens 5 years) [DOCS].
- **Rotation = regeneration:** "the previous token will not work anymore" — one active token per user, instant invalidation [DOCS].
- **No OAuth, no refresh tokens, no expiry handling.**

Failure semantics: **401** = invalid / regenerated / missing token — the only documented auth failure. **403** is **not declared anywhere** — role-denied behaviour is [UNKNOWN] (could surface as 401, 404, or filtered data); test with a low-permission token.

## Response envelope (every request)

```json
{
  "data": [],
  "itemCount": 10,
  "limit": 10,
  "offset": 0,
  "next_page_url": "https://api.rentman.net/contacts?cursor=eyJ..."
}
```

- `data` = array (collection) or object (single item / POST / PUT result).
- `itemCount` = items in THIS response, **NOT a total count** — no total-count field exists anywhere.
- `DELETE` returns **no body**.
- Every item carries `id` (integer), `created`, `modified` (ISO date-time, nullable), and `updateHash` (hash of `id`+`modified`, for change detection; in docs intro but absent from spec schemas — confirm live [UNVERIFIED]).
- **Link fields** return path strings (`"customer":"/contacts/15"`). Inline with `?expand=customer` (comma-separated, dot-nesting ≤3 levels; only link fields are expandable — anything else → 400; null links stay null).

## Endpoint catalog

Spec-exact — 221 paths, 64 resource tags. Every operation declares responses `200/400/401/404/500/502`. Pattern: `GET/POST /{resource}` · `GET[/PUT/DELETE] /{resource}/{id}` · nested `GET[/POST] /{resource}/{id}/{linked}`.

### Core operations (where agents will live)

| Method   | Path                                                                                                                   | Purpose                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| GET/POST | `/projects`                                                                                                            | list/filter · create (**no update/delete**)                  |
| GET      | `/projects/{id}`                                                                                                       | detail (request GENERATED price fields via `?fields`)        |
| GET/POST | `/projects/{id}/subprojects`                                                                                           | planning/financial units (status, discounts, rollups)        |
| GET      | `/projects/{id}/projectequipment`                                                                                      | planned equipment (custom linked collection, read-only)      |
| GET      | `/projects/{id}/projectcrew` · `/projectvehicles` · `/costs` · `/quotes` · `/contracts`                                | project drill-downs                                          |
| GET/POST | `/equipment` · GET/PUT `/equipment/{id}`                                                                               | inventory catalog (57 fields; no delete)                     |
| GET/POST | `/equipment/{id}/serialnumbers`                                                                                        | serials; full CRUD via `/serialnumbers/{id}`                 |
| GET/POST | `/contacts` · GET/PUT/DELETE `/contacts/{id}`                                                                          | customers/venues — full CRUD (72 fields)                     |
| GET      | `/crew` · `/crew/{id}` (+ appointments, availability, rates)                                                           | crew — **read-only**                                         |
| GET/POST | `/appointments` (+ PUT/DELETE on `/{id}`)                                                                              | scheduling — full CRUD                                       |
| GET      | `/invoices` · `/invoices/{id}/invoicelines`                                                                            | financials — **read-only**; `is_paid`, `outstanding_balance` |
| GET/POST | `/invoices/{id}/payments` · GET/PUT `/payments/{id}`                                                                   | payments — writable                                          |
| GET      | `/quotes` · `/contracts` · `/purchaseorders` · `/subrentals` · `/repairs`                                              | **read-only** + nested lines/files/tasks                     |
| GET/POST | `/tasks` (+ subtasks, assignments, statuses — full CRUD)                                                               | work items on any resource                                   |
| GET/POST | `/timeregistration` (+ PUT/DELETE)                                                                                     | time tracking — writable                                     |
| GET      | `/files` · `/{res}/{id}/files`                                                                                         | file metadata + `url`/`proxy_url` download links (read-only) |
| GET      | `/statuses` · `/projecttypes` · `/taskstatuses` · `/leavetypes` · `/ledgercodes` · `/taxclasses` · `/extrainputfields` | workspace lookup tables — resolve link ids to names          |

### Write-support matrix (spec-exact — encode in LLM rules)

| Writable (full or near-full CRUD)                                                                                                                                                                                                                                   | Create/update only                                                                                                             | **Read-only**                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contacts, contactpersons, serialnumbers, appointments, appointmentcrew, tasks, subtasks, taskassignments, taskstatuses, timeregistration, crewavailability, costs, projectrequests, vehicles, stockmovements\*, equipmentsetscontent, accessories\*, alternatives\* | projects (create only!), subprojects (create via parent), equipment (no delete), folders, payments, leaverequest/leavemutation | crew, invoices, quotes, contracts, invoicelines, purchaseorders (+costs), subrentals (+equipment/groups), repairs, files, file_folders, projectequipment/projectcrew/projectvehicles/projectfunctions (custom linked collections), all lookup tables |

\* create via the parent-scoped POST (e.g. `POST /equipment/{id}/accessories`), mutate via `/{resource}/{id}`.

**Custom linked collections** ("Get _X_ custom linked collection") are API-synthesized conveniences — items can **never** be created through them, and parent fields may be missing.

## Data models

### Hierarchy

```
Contact (customer/venue) ──┐
Crew (account manager) ────┴──< Project ──< Subproject (status → /statuses lookup)
                                   ├──< ProjectEquipmentGroup ──< ProjectEquipment ──> Equipment
                                   │                                  Equipment ──< SerialNumber / Accessory / StockMovement
                                   ├──< ProjectFunctionGroup ──< ProjectFunction ──< ProjectCrew ──> Crew
                                   ├──< Quote · Contract · Invoice ──< InvoiceLine ; Invoice ──< Payment
                                   ├──< Costs · Tasks · Files · Appointments
                                   └──< Subrental ──> Supplier ; PurchaseOrder ──> Supplier
```

### Key entities (decision-relevant fields)

| Entity                                                 | Key fields                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project (43f)                                          | `id`, `name`, `number`, `reference`, `customer`→contact, `account_manager`→crew, `project_type`, `usageperiod_start/end`, `planperiod_start/end`, rollups `project_total_price`/`project_rental_price`/… (GENERATED — `?fields` required), `tags`, `custom` |
| Subproject (49f)                                       | `project`→, `status`→/statuses, `order`, `in_planning`, `in_financial`, discounts per cost group, same rollups                                                                                                                                              |
| Equipment (57f)                                        | `name`, `code`, `folder`→, `type`, `rental_sales`, `price`, `list_price`, `critical_stock_level`, `stock_management`, `weight`/`volume`/dims, `in_archive`, `custom`                                                                                        |
| Contact (72f)                                          | `displayname`, `name`, `firstname`/`surname`, `type`, `code`, `accounting_code`, mailing/visit/invoice address blocks, `country`, `latitude`/`longitude`                                                                                                    |
| Crew (40f)                                             | `displayname`, `firstname`/`lastname`, `email`, `phone`, `active`, `external` (freelancer), `default_warehouse`                                                                                                                                             |
| ProjectEquipment (28f)                                 | `equipment`→, `quantity`, `unit_price`, `discount`, `is_option`, `planperiod_*`, `has_missings`, `serial_number_ids`                                                                                                                                        |
| Invoice (40f — schema `FactuurResponse`, Dutch legacy) | `number`, `date`, `customer`→, `project`→, `price`, `price_invat`, `vat_amount`, `is_paid`, `outstanding_balance`, `total_paid`, `date_sent`, `finalized`                                                                                                   |
| Quote (27f — `QuotationResponse`)                      | `number`, `version`, `customer`→, `project`→, `date`, `expiration_date`, `price`, `price_invat`                                                                                                                                                             |
| SerialNumber (24f)                                     | `equipment`→, `serial`, `purchasedate`, `book_value`, `next_inspection`, `qrcodes`, `active`                                                                                                                                                                |
| Appointment (20f)                                      | `name`, `start`, `end`, `location`, recurrence fields, `/appointmentcrew` join                                                                                                                                                                              |
| Task (34f)                                             | `name`, `deadline`, `priority`, `status`→/taskstatuses, `item`+`itemtype` (polymorphic anchor), `completed_at`                                                                                                                                              |
| TimeRegistration (20f)                                 | `crewmember`→, `start`, `end`, `duration`, `break_duration`, `status`                                                                                                                                                                                       |
| File (31f)                                             | `readable_name`, `size`, `extension`, `url`, `proxy_url` (GENERATED download links), `item`+`itemtype`                                                                                                                                                      |

**Formats:** integer ids; nullable ISO `date-time` for `created`/`modified`/periods; link fields as path strings; money as plain numbers (workspace currency); custom fields as `custom_<n>` under `custom` (not queryable); statuses are **per-workspace lookup tables**, not fixed enums — resolve via `/statuses` & co.

**GENERATED FIELDS** (tagged in descriptions): backend-computed — **not sortable when `limit`/`offset` are set, never filterable, and often omitted from collection responses unless requested via `?fields`**.

## Querying

| Capability       | Syntax                                | Notes                                                          |
| ---------------- | ------------------------------------- | -------------------------------------------------------------- |
| Field selection  | `?fields=displayname,firstname`       | `id`/`created`/`modified` always included                      |
| Sort             | `?sort=+id,-firstname`                | ⚠️ only the FIRST field is honored while paginating            |
| Equality filter  | `?country=gb`                         | any non-generated, non-custom field                            |
| Relational ops   | `?distance[lte]=300`                  | `lt`, `gt`, `lte`, `gte`, `neq` (multi-value `neq` = "not in") |
| Null check       | `?folder[isnull]=false`               | `true/false/1/0`                                               |
| Expand links     | `?expand=equipment,equipment.creator` | ≤3 levels deep; non-link field → 400                           |
| Full-text search | —                                     | not supported; filter on concrete fields [UNKNOWN]             |

```http
GET /projects?fields=id,name,number,customer&sort=-id&limit=50
GET /equipment?stock_management=true&fields=id,name,code,critical_stock_level
GET /invoices?is_paid=false&sort=-price&fields=id,number,date,price,outstanding_balance,customer
GET /projects?modified[gte]=2026-06-09T00:00:00&sort=+modified          # change polling
GET /serialnumbers?expand=equipment&limit=100
```

Link-field filter literal (integer id vs `/contacts/15` path string) is [UNVERIFIED] — test both forms on the first credentialed account.

## Pagination

**Cursor (default — preferred):** follow `next_page_url` verbatim until `null`.

- `limit` — **default 300, max 1500**; carried over by the cursor.
- `cursor` — **opaque** base64 token; "Do not construct or modify it manually".
- `next_page_url` preserves all original filter params.

```
Page 1: GET /contacts?limit=100&country=gb
        → { data:[100], itemCount:100, next_page_url:".../contacts?country=gb&cursor=eyJ..." }
Page 2: GET <next_page_url verbatim>
Page N: next_page_url == null → stop
```

**Offset (only for non-`id` sorts):** `?limit=100&sort=+firstname&offset=0` → `&offset=100` → …; no `next_page_url` — stop when `itemCount < limit`.

**Hard caps:** 1500 items/request; **5 MB response** (error if exceeded — lower `limit` or trim `?fields`). **Multi-field sort + pagination is inconsistent** (only the first sort field participates) — use one sort field when paging.

## Rate limits

| Scope       | Limit               | Window     |
| ----------- | ------------------- | ---------- |
| Per token   | **50,000 requests** | per day    |
| Per token   | **10 requests**     | per second |
| Concurrency | **20 requests**     | in flight  |

- Breach status / headers / Retry-After: [UNKNOWN] — not documented; capture live.
- Strategy: design under budget (~150 ms between sequential page-walk calls); on a throttle response back off 1s → 5s → 30s with jitter; never busy-retry.

## Error handling

**Error body format: [UNKNOWN — needs live testing].** Spec declares only status codes — no error schema. Parse defensively: status first, then try JSON, fall back to raw text. (The `{"message":"Missing Authentication Token"}` seen probing `/openapi.json` unauthenticated is **API Gateway's** error, not necessarily the API's own shape.)

| Status      | Declared? | Meaning                                       | Retryable? | Recovery                                        |
| ----------- | --------- | --------------------------------------------- | ---------- | ----------------------------------------------- |
| 400         | yes       | bad request — invalid filter/expand/body      | No         | fix the query (e.g. expanding a non-link field) |
| 401         | yes       | token invalid / regenerated / missing         | No         | re-enter the token via the chat card            |
| 404         | yes       | not found — bad id or path                    | No         | verify id/path                                  |
| 500         | yes       | "Something went wrong"                        | cautiously | retry once with backoff                         |
| 502         | yes       | bad gateway                                   | cautiously | retry once with backoff                         |
| 403/422/429 | **no**    | role denial / validation / throttle semantics | —          | observe live [UNKNOWN]                          |

**Idempotency:** no idempotency keys, no upsert. GET/PUT-by-id safe to re-send; **POST retries risk duplicates** — after a write timeout, query (filter on `name`/`reference`/newest `created`) before retrying. DELETE returns no body.

## Events & polling

**No webhooks, no streaming** — nothing in spec or support center [UNKNOWN — searched]. **Polling is designed-in:** `modified` always returned, relational date filters exist, every item carries `updateHash` for cheap change detection:

```
GET /{resource}?modified[gte]={watermark}&sort=+modified&fields=id,modified,...
→ advance watermark; diff updateHash where pages overlap
```

The 50k/day budget supports minute-level polling of several resources; keep bursts ≤10 rps.

## MCP server (beta — the FEAT-209 customer's actual ask)

- **URL:** `https://mcp.rentman.net` — MCP endpoint `/mcp`.
- **Auth:** **OAuth 2.1 + PKCE with dynamic client registration** (`/authorize`, `/token`, `/register`) — a completely different model from the REST API's static JWT.
- **Status:** beta; the FEAT-209 customer has it enabled and asked for it by name.
- **Numa angle:** Numa's MCP surface today is **NetSuite-only** — generic remote-MCP auth (OAuth 2.1 PKCE + dynamic registration) is a platform feature to spike separately. Ship the REST token connector now; treat the MCP server as the preferred future surface once platform support lands. Don't route `mcp.rentman.net` through the NetSuite-specific path.
- **Same FEAT-209 card:** also requests **Current RMS** (`api.current-rms.com`) — a separate rental platform and separate connector candidate; out of scope for this pack.

## SDKs & tooling

- **Official SDKs: none** (any language). Raw HTTP via the Numa `request` proxy is the path.
- **Postman collection:** none found.
- **OpenAPI spec: yes** — the differentiator. Regenerate reference material by re-extracting the versioned `oas.json` URL from the docs HTML (`/tmp/rentman_openapi.json` holds the 2026-06-10 snapshot, v1.13.0).
- **Pipedream:** a `rentman` Pipedream app exists, wired in Numa's integrations config, but **its actions are broken (FEAT-209)** — superseded by this native connector.

## Integration path assessment

**Recommended path:** Direct API via Numa native data connector (`request` operation), registry `authType: token` — NOT Pipedream, NOT OAuth. Implemented; see `03-connector-setup.md` for wiring and `04-connection-and-reauth.md` for lifecycle.

**Justification:** auth is a single user-pasted long-lived Bearer JWT riding the existing token-connector backend (`_user_connector_token` → `Authorization: Bearer …`) with zero new auth code; no extra headers, no versioning, fixed SaaS base URL. Per-user tokens mirror Rentman roles, matching Numa's per-user vault model exactly.

**Connector compatibility:** N/A — not a file source (`list_files`/`download_file` don't apply; Rentman file _metadata_ and download URLs are reachable via `/files`).

**Rollout checklist (per customer):**

1. Numa admin: add **Rentman** in Integrations (wizard is metadata-only; leave instance URL empty).
2. Each user: generate a token in Rentman (Configuration → Account → Integrations → API → Show token) and paste it into the chat credential card on first use.
3. Verify: `GET /projects?limit=1&fields=id,name` → 200; also capture one bad-token 401 body.
4. Probe role coverage: invoices, crew, equipment — confirm what the user's role exposes.
5. Burn down §Known Unknowns on the first connected account; update `01-llm-api-rules.md`.

## Known unknowns — verify on a credentialed account before customer rollout

1. **Error response body shape** — 400/401/404/500 bodies (and whether 422/429 exist).
2. **Role-denial failure mode** — low-permission token: 401, 404, or silently filtered data?
3. **Throttle behaviour** — status code, headers, `Retry-After` at >10 rps / >50k/day.
4. **Link-field filter literal** — integer id vs `/contacts/15` path string.
5. **`updateHash` presence** in live responses (docs say yes; spec schemas omit it).
6. **Datetime literal format** accepted by `modified[gte]` (zone handling).
7. **File `url`/`proxy_url` expiry** semantics.
8. **`next_page_url` trigger** — docs say `limit`, the `ApiResponse` schema says `cursor_limit`; confirm which parameter engages cursor mode.

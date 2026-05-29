---
api_name: 'HireHop'
api_slug: 'hirehop'
vendor: 'HireHop Ltd (UK)'
website: 'https://www.hirehop.com'
investigation_started: '2026-05-29'
investigator: 'Claude Code (automated) — documentation + web research only (no live credentials)'
investigation_status: 'in-progress'
documentation_quality: 'adequate'
api_types: ['REST']
overall_confidence: 'medium — documented, not live-tested'
blockers:
  - 'No live token available; first successful call gate (Phase 2.4) NOT satisfied.'
  - 'Job status integer values are not enumerated in public docs — must be discovered against a live instance.'
  - 'job_data / job_refresh response excludes line items; supplying-list structure inferred from barcode-add response.'
---

# API Investigation Questionnaire: HireHop

> Completed by automated investigation on 2026-05-29 from official HireHop documentation and web research.
> **No live API testing was performed** — there were no credentials available. Every answer is tagged
> `[DOCUMENTED]` (stated in vendor docs), `[INFERRED]` (deduced from examples/ecosystem), or `[UNKNOWN]`.
> Nothing is marked `[CONFIRMED]` because no live call was made.
>
> Sources:
>
> - HireHop API Documentation — https://www.hirehop.com/api_documentation/ (also mirrored on co.za/co.uk/.net) [DOCUMENTED]
> - HireHop REST API Getting Started Guide — https://www.hirehop.com/blog/hirehop-rest-api-getting-started-guide/ [DOCUMENTED]
> - HireHop Help → API category — https://www.hirehop.co.za/blog/category/help/api/ [DOCUMENTED]
> - HireHop Webhooks — https://www.hirehop.com/blog/webhooks/ (and co.uk mirror) [DOCUMENTED]
> - HireHop Custom Fields – API — https://www.hirehop.co.uk/blog/custom-fields-hirehop-api/ [DOCUMENTED]
> - Demo document template — https://myhirehop.com/docs/job_info.html [DOCUMENTED]
>
> **Connector registry config (source of truth):** `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
> id `hirehop`, `authType: 'api-key'`, credential fields `api_token` (password) + `base_url` (url, placeholder `https://myhirehop.com`). No OAuth block. Category "Equipment & Rental". [DOCUMENTED — registry]

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** https://www.hirehop.com/api_documentation/ [DOCUMENTED]
  - Note: `www.hirehop.com` returns HTTP 403 to automated fetchers. The same docs are reachable on the regional mirrors `https://www.hirehop.co.za/api_documentation/` and `https://www.hirehop.co.uk/api_documentation/`. [DOCUMENTED]
- **API reference / endpoint catalog URL:** Same page — an HTML reference listing `/php_functions/*.php` and `/api/*.php` endpoints with parameters. Not an OpenAPI/Swagger UI. [DOCUMENTED]
- **Authentication guide URL:** https://www.hirehop.com/blog/hirehop-rest-api-getting-started-guide/ [DOCUMENTED]
- **Changelog / release notes URL:** https://www.hirehop.com/updates/ and https://www.hirehop.com/announcement/ (product announcements, not API-specific changelog) [DOCUMENTED]
- **Status page URL:** None found [UNKNOWN]

> **Discovery note:** HireHop is a PHP/AJAX app. The "API" is a curated, stable subset of the same `php_functions/*.php` endpoints the web UI calls. The getting-started guide explicitly suggests inspecting the browser network console to discover additional undocumented calls — but those are not contractually stable.

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** None — no machine-readable spec exists. [DOCUMENTED]
- **Postman collection URL:** None found [UNKNOWN]
- **Official SDK repositories:**
  - Python: None [DOCUMENTED]
  - Node.js: None [DOCUMENTED]
  - Other: Official **HireHop Webshop** WordPress plugin (PHP) — https://en-gb.wordpress.org/plugins/hirehop-webshop/ — uses the same API and is a useful reference for real request/response shapes [DOCUMENTED]
- **Official blog / engineering blog:** https://www.hirehop.com/blog/ [DOCUMENTED]
- **Community forums / Stack Overflow tag:** None of note [UNKNOWN]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                                  |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Authentication            | 4      | Token model, generation, passing methods, and invalidation rules clearly documented [DOCUMENTED]       |
| Endpoint reference        | 3      | Many endpoints listed with params, but it is a flat HTML page — no consistent request/response schemas |
| Request/response examples | 2      | A few worked examples (job_refresh, job_save, webhook payload); most endpoints lack full response JSON |
| Error documentation       | 2      | Error 327 / 429 (rate limit) documented; general error envelope only partially shown                   |
| Rate limit documentation  | 5      | Explicit: 60/min and 3/sec, with `X-Request-Count` / `X-RateLimit-Available` headers and 429 + err 327 |
| Pagination documentation  | 2      | `page` + `rows` params mentioned, limits vary per endpoint, not consistently documented                |
| Webhook documentation     | 4      | Dedicated page: setup, payload shape, `export_key` security check, event-name pattern, fire-and-forget |
| SDKs / code examples      | 2      | No SDKs; PHP snippets only; WordPress plugin is the de-facto reference                                 |
| Changelog / versioning    | 3      | API is versioned (`version=` param, current 1.3, backward compatible) but no per-release API changelog |

**Overall documentation quality:** adequate

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Confirmed no OpenAPI/Swagger spec
- [x] Identified authentication method (token, multiple passing locations)
- [x] Found at least one documented example (job_refresh, job_save, webhook payload)
- [x] Identified rate limit information (60/min, 3/sec)
- [x] Identified pagination approach (`page` + `rows`)
- [x] Checked for webhook/event support (supported, documented)
- [x] Checked for official SDKs (none)
- [ ] **Live API call — NOT done (no credentials). Phase 2.4 gate UNMET.**

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** HireHop REST API [DOCUMENTED]
- **Vendor / company:** HireHop Ltd — equipment / event rental management software (UK) [DOCUMENTED]
- **Current API version:** 1.3 — backward compatible; older versions can be requested with `version=1.2` (etc.) as a parameter [DOCUMENTED]
- **Base URL(s):**
  - Production: **per-tenant `base_url`** supplied as a credential field. HireHop runs the same app simultaneously on three interchangeable hosts:
    - `https://myhirehop.com` (registry placeholder default) [DOCUMENTED]
    - `https://hirehop.net` [DOCUMENTED]
    - `https://myhirehop.co.uk` [DOCUMENTED]
  - Some customers use a vanity/custom domain that proxies to the same backend — hence `base_url` is a credential, not a hard-coded constant. [INFERRED]
  - Sandbox / testing: No dedicated sandbox; a demo doc template exists at `myhirehop.com/docs/job_info.html`. [DOCUMENTED]
- **API type:** REST-ish over HTTP — JSON responses, but endpoints are PHP scripts (`*.php`), not RESTful resource paths. [DOCUMENTED]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (HTTP/1.1) [DOCUMENTED]
- **Data format:** JSON responses. Requests accept **either** a JSON body **or** URL-encoded form data **or** query-string params — HireHop auto-detects which was used. [DOCUMENTED]
- **Content-Type header(s):** `application/json` for JSON bodies, `application/x-www-form-urlencoded` for AJAX-style posts. Both accepted. [DOCUMENTED]
- **Character encoding:** UTF-8 [INFERRED]
- **URL structure pattern:** `{base_url}/php_functions/{action}.php` (most endpoints) and `{base_url}/api/{action}.php` (a smaller curated REST surface). A few live under `/frames/`. [DOCUMENTED]

```
Examples:
GET  {base_url}/api/job_data.php?job=52&token={url_encoded_token}
POST {base_url}/php_functions/job_save.php
POST {base_url}/frames/status_save.php
```

- **Versioning strategy:** Optional `version` request parameter (defaults to latest, currently 1.3; backward compatible). No version in the path. [DOCUMENTED]
- **CORS policy:** Not documented. The vendor explicitly states the token must only be used **server-side** and never exposed in browser JS — implying browser-origin use is not intended. [DOCUMENTED]
- **Field casing:** **Mixed and asymmetric** — response fields are largely UPPER_SNAKE_CASE (`JOB_NAME`, `OUT_DATE`, `DEPOT_ID`, `CUSTOM_FIELDS`); request parameters are largely lower_snake_case (`name`, `out`, `start`, `job_name`, `client_id`). Do NOT assume request field names equal response field names. [DOCUMENTED]
- **ID format:** Integer (job number `ID`, depot `ID`, client/company `CLIENT_ID`, user IDs). [DOCUMENTED]
- **Required headers (all requests):** None strictly required if the token is supplied as a query/body param. Optionally `X-TOKEN` may carry the token instead. [DOCUMENTED]

| Header       | Value              | Purpose                                               |
| ------------ | ------------------ | ----------------------------------------------------- |
| X-TOKEN      | `{token}`          | Optional alternative to passing `token` as param/body |
| Content-Type | `application/json` | When sending a JSON request body (POST endpoints)     |

### 2.3 Authentication [REQUIRED]

- **Auth method:** Static per-user **API token** (long-lived bearer-style secret). NOT OAuth. Matches registry `authType: 'api-key'`. [DOCUMENTED — registry + vendor]
- **Auth location:** Flexible — any one of:
  1. Query parameter `?token={url_encoded_token}` (must be URL-encoded) [DOCUMENTED]
  2. POST form parameter `token` [DOCUMENTED]
  3. JSON body field `"token"` [DOCUMENTED]
  4. HTTP header `X-TOKEN: {token}` [DOCUMENTED]
- **Auth header format (if using header):**

```
X-TOKEN: dqwejk5GVT65909bHHBN7922pq5hxjm=-7hmn
```

**For API Key / token auth:**

- **How to obtain:** Admin mode → Settings → **Users** tab → select (or create) a user → **Menu** → **API Token**. A token is unique per user. [DOCUMENTED]
- **Key format / pattern:** Opaque base64-ish string containing `=`, `+`, `-` characters (e.g. `dqwejk5GVT65909bHHBN7922pq5hxjm=-7hmn`). **Must be URL-encoded** when placed in a query string. [DOCUMENTED]
- **Token lifetime:** "Never expires" — BUT invalidated immediately if the owning user logs in again, or changes their email/password. [DOCUMENTED]
  - **Strong vendor recommendation:** create a dedicated "API" user that never logs in interactively, so the token stays stable. Numa onboarding should advise customers to do this. [DOCUMENTED]
- **Permissions model:** The token inherits the owning user's HireHop permissions/role. Scope the API user's role to what the integration needs. [DOCUMENTED]
- **Rate limits per token:** 60 requests / minute and 3 requests / second, per user (see Phase 8.1). [DOCUMENTED]
- **Key rotation procedure:** Regenerate the token from the same Users → API Token menu (and/or change the API user's password to force-invalidate a leaked token). [DOCUMENTED]
- **Tenancy:** The token + `base_url` together identify the customer's HireHop account. There is no separate account/company ID parameter — the token resolves the company server-side. [INFERRED]

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

> **GATE NOT SATISFIED.** No live credentials were available during this investigation. The request/response below is the _documented_ shape, NOT a verified live capture. It must be validated against a real instance before generating downstream mutation docs.

**Documented first call (read a job):**

```http
GET /api/job_data.php?job=1&token={url_encoded_token} HTTP/1.1
Host: myhirehop.com
```

**Documented response shape (job metadata — line items NOT included here):** [DOCUMENTED, structure; values illustrative]

```json
{
  "ID": 1,
  "JOB_NAME": "Summer Festival Main Stage",
  "COMPANY": "Acme Events Ltd",
  "NAME": "Jane Smith",
  "OUT_DATE": "2026-06-10 08:00",
  "JOB_DATE": "2026-06-11 00:00",
  "JOB_END": "2026-06-14 00:00",
  "RETURN_DATE": "2026-06-15 17:00",
  "STATUS": 2,
  "DEPOT": "Main Depot",
  "DEPOT_ID": 1,
  "COLOUR": "#3399ff",
  "LOCKED": 0,
  "CURRENCY": { "CODE": "GBP", "SYMBOL": "£", "DECIMALS": 2 },
  "DEFAULT_DISCOUNT": 0,
  "USE_SALES_TAX": 0,
  "CUSTOM_FIELDS": {},
  "STANDARD_TAX_RATES": []
}
```

- **HTTP status code (expected):** 200 [INFERRED]
- **Response headers of note (expected):** `X-Request-Count`, `X-RateLimit-Available` [DOCUMENTED]
- **Time to first successful call:** Immediate once an API token is generated. [INFERRED]
- **Gotchas:** (1) Token MUST be URL-encoded in the query string or auth fails. (2) `www.hirehop.com` 403s automated clients — the customer's `base_url` (myhirehop.com / .net / .co.uk / vanity) is what must be used. [DOCUMENTED]

- [ ] **GATE CHECK: First successful API call — NOT completed (no credentials). Must be done before mutation docs are generated.**

---

## Phase 3: Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

#### Entity: Job

- **API resource / endpoints:** `GET /api/job_data.php`, `GET /php_functions/job_refresh.php`, `POST /api/save_job.php`, `POST /php_functions/job_save.php`, `POST /frames/status_save.php`, `POST /php_functions/job_duplicate.php`, `GET /php_functions/job_margins.php`, `GET /php_functions/jobs_totals.php`
- **Description:** The central entity — a rental/hire booking for a customer covering a date range, a depot, a status, financials, and a supplying list of items. "Quotation / booking / job" are all the same record at different statuses. [DOCUMENTED]
- **CRUD support:** Create, Read, Update (all via `job_save` — omit/`0` the `job` param to create, pass an ID to edit), Duplicate, Status-change. No documented hard delete (delete is a status, see state machine). [DOCUMENTED]

**Fields (response — UPPER_SNAKE_CASE):**

| Field            | Type    | Required? | Writable?           | Description                                 | Example Value        |
| ---------------- | ------- | --------- | ------------------- | ------------------------------------------- | -------------------- |
| ID               | integer | yes       | no                  | Job number                                  | `52`                 |
| JOB_NAME         | string  | no        | yes (job_name)      | Internal job/booking name                   | `"Main Stage"`       |
| COMPANY          | string  | no        | yes (company)       | Customer company name                       | `"Acme Events Ltd"`  |
| NAME             | string  | yes       | yes (name)          | Customer contact name                       | `"Jane Smith"`       |
| CLIENT_ID        | integer | no        | yes (client_id)     | Address-book company/client reference       | `1023`               |
| OUT_DATE         | string  | yes       | yes (out)           | Reservation/out datetime `YYYY-MM-DD hh:mm` | `"2026-06-10 08:00"` |
| JOB_DATE         | string  | yes       | yes (start)         | Charging start datetime                     | `"2026-06-11 00:00"` |
| JOB_END          | string  | no        | yes (end)           | Charging end datetime                       | `"2026-06-14 00:00"` |
| RETURN_DATE      | string  | no        | yes (to)            | Return datetime                             | `"2026-06-15 17:00"` |
| STATUS           | number  | yes       | via status_save     | Job status (numeric — see 3.6)              | `2`                  |
| DEPOT_ID         | integer | no        | yes (depot)         | Owning depot                                | `1`                  |
| DEPOT            | string  | no        | no                  | Depot display name                          | `"Main Depot"`       |
| COLOUR           | string  | no        | no                  | Status colour (hex)                         | `"#3399ff"`          |
| LOCKED           | integer | no        | no                  | 1 = locked, 0 = editable                    | `0`                  |
| CURRENCY         | object  | yes       | no                  | `{CODE, SYMBOL, DECIMALS}`                  | `{"CODE":"GBP",...}` |
| DEFAULT_DISCOUNT | number  | no        | yes (default_disc)  | Default line discount %                     | `0`                  |
| USE_SALES_TAX    | integer | no        | no                  | Sales-tax vs VAT mode flag                  | `0`                  |
| CUSTOM_FIELDS    | object  | no        | yes (custom_fields) | Tenant-defined custom fields                | `{"po":"PO-9981"}`   |

**Job create — documented required request params:** `name` (customer name), `out` (reservation datetime), `start` (charging start datetime). [DOCUMENTED]
**Job edit:** pass `job={id}`; only the fields you include are changed (partial update semantics). [DOCUMENTED]

**Items on create/edit:** the `items` request parameter is an object map of `{ "<prefix><productId>": <qty> }` where prefix `a`=sales, `b`=hire, `c`=labour. e.g. `{"b123":4, "a12":3.5, "c34":2.2}`. [DOCUMENTED]

> **IMPORTANT:** `job_data` / `job_refresh` return job _metadata only_ — the supplying list (line items) is NOT in that response. The item/supply structure is documented separately (e.g. via the barcode-add response). Reading a job's full line items likely requires a separate call (`archive_insert` / supplying-list endpoints) — **discovery needed against a live instance.** [INFERRED]

**Relationships:**

| Related Entity  | Relationship | How Expressed                              | Notes                                |
| --------------- | ------------ | ------------------------------------------ | ------------------------------------ |
| Client/Company  | many-to-one  | `CLIENT_ID` ref into address book          | [DOCUMENTED]                         |
| Depot           | many-to-one  | `DEPOT_ID`                                 | [DOCUMENTED]                         |
| LineItem/Supply | one-to-many  | `items` map (write); supplying-list (read) | Read path needs discovery [INFERRED] |
| Invoice/Billing | one-to-many  | Jobs convert to invoices on dispatch       | [DOCUMENTED]                         |
| User (manager)  | many-to-one  | `user`, `user2` manager IDs                | [DOCUMENTED]                         |
| Project         | many-to-one  | `proj` project ID                          | [DOCUMENTED]                         |

#### Entity: LineItem / Supply (job supplying list)

- **API resource / endpoints:** written via `job_save.php` `items` map; barcode add via `POST /php_functions/items_barcode_save.php`; price multiplier `GET /php_functions/items_get_multiplier.php`. Reading the full list: **discovery needed**. [DOCUMENTED / INFERRED]
- **Description:** A row on a job's supplying list — equipment (hire), sales goods, labour, headings, custom lines, or calculated lines. Supports nesting (parent/child via nested-set `LFT`/`RGT`). [DOCUMENTED]
- **CRUD support:** Create/Update via job save & barcode add. [DOCUMENTED]

**Fields (response):**

| Field          | Type    | Description                                                            | Example        |
| -------------- | ------- | ---------------------------------------------------------------------- | -------------- |
| ID             | integer | Line item ID                                                           | `9001`         |
| kind           | integer | 0=heading,1=sales,2=hire,3=custom,4=labour,5=inline,6=calculated       | `2`            |
| title          | string  | Item title                                                             | `"LED Par 64"` |
| qty            | number  | Quantity                                                               | `4`            |
| UNIT_PRICE     | number  | Per-unit price (base currency)                                         | `15.00`        |
| PRICE          | number  | Line price                                                             | `180.00`       |
| PRICE_TYPE     | integer | 0=one-off,1=hourly,2=daily,3=weekly,4=monthly,5=every day,6=every week | `3`            |
| VAT_RATE       | number  | Tax rate %                                                             | `20`           |
| DURATION       | number  | Charge duration                                                        | `3`            |
| OUTGOING_DATE  | string  | Out date `YYYY-MM-DD`                                                  | `"2026-06-10"` |
| RETURNING_DATE | string  | Return date                                                            | `"2026-06-15"` |
| avail          | number  | Available quantity                                                     | `12`           |
| remainder      | number  | Shortfall/remaining                                                    | `0`            |
| VIRTUAL        | integer | 1 or 2 = virtual/package item                                          | `0`            |
| parent         | integer | Parent line ID (nesting)                                               | `null`         |
| LFT / RGT      | integer | Nested-set tree bounds                                                 | `1` / `2`      |

#### Entity: Client / Contact (address book)

- **API resource / endpoints:** `list_contacts.php` (list, paginated), `save_contact.php` (create/edit), `contact_prices_save.php` (per-client price overrides). [DOCUMENTED — names confirmed in docs; exact params partly inferred]
- **Description:** Address-book companies/people that hire equipment. Referenced from jobs via `CLIENT_ID`. Supports custom fields. [DOCUMENTED]
- **CRUD support:** Create, Read (list), Update. Delete not documented. [DOCUMENTED / INFERRED]

**Fields:** `ID`, `COMPANY` (name), contact details, `CUSTOM_FIELDS`. Full field list is **not fully documented** — discovery needed. [INFERRED]

#### Entity: Invoice / Billing

- **API resource / endpoints:** Not given a clean documented CRUD surface. Jobs that are dispatched **automatically become invoices**; invoice status changes fire the `invoice.status.updated` webhook. [DOCUMENTED]
- **Description:** Financial document derived from a job. Billing data also surfaced via `job_margins.php` (costings/profit) and `jobs_totals.php` (totals across up to 50 jobs). [DOCUMENTED]
- **CRUD support:** Read (totals/margins). Direct invoice CRUD endpoints not documented — **discovery needed.** [INFERRED]

#### Entity: Depot

- **API resource / endpoints:** `GET /php_functions/get_depots.php` (no params). [DOCUMENTED]
- **Description:** Physical/virtual stock location. Jobs and stock belong to a depot.
- **CRUD support:** Read. [DOCUMENTED]
- **Fields:** `ID` (int), `DEPOT` (name), `VIRTUAL` (bool). [DOCUMENTED]

#### Entity: Category

- **API resource / endpoints:** `categories_list.php` (list), `categories_save.php` (create/edit), `categories_move.php`, `categories_delete.php` (empty only). [DOCUMENTED]
- **Description:** Product/stock catalogue tree. [DOCUMENTED]
- **CRUD support:** Create, Read, Update, Delete (empty only), Move. [DOCUMENTED]

#### Entity: Stock / Availability (Product)

- **API resource / endpoints:** `picklist_get_availability.php`, `availability_list.php`, `availability_get_available.php` (daily availability, POST), `availability_jobs_list.php` (jobs using a product within a year), `items_available.php` (deprecated), `items_barcode_save.php`, `sales_list.php`. [DOCUMENTED]
- **Description:** Rental/sales products and their day-by-day availability. Barcode lookup returns hire/sales item details. [DOCUMENTED]
- **CRUD support:** Read / availability query (mostly). [DOCUMENTED]

#### Entity: Attachment (files)

- **API resource / endpoints:** `attach_list.php` (list), `attach_files_upload.php` (upload), `attach_delete.php` (delete). [DOCUMENTED]
- **Description:** Files attached to a job (documents, photos, signed contracts). [DOCUMENTED]
- **CRUD support:** Create (upload), Read (list), Delete. [DOCUMENTED]

#### Entity: User

- **API resource / endpoints:** `GET /php_functions/get_user_info.php` (current user / token owner). [DOCUMENTED]
- **Description:** HireHop staff users. The token owner. [DOCUMENTED]
- **CRUD support:** Read (current user). [DOCUMENTED]

#### Entity: Custom Fields (global definitions)

- **API resource / endpoints:** `custom_fields_global_load.php` (load), `custom_fields_global_save.php` (save). [DOCUMENTED]
- **Description:** Tenant-defined custom field schema applied to jobs/clients/items; values stored as JSON objects on each record's `CUSTOM_FIELDS`. [DOCUMENTED]
- **CRUD support:** Read, Update (global definitions). [DOCUMENTED]

### 3.2 Entity Relationships [IMPORTANT]

```
┌──────────┐   N:1   ┌──────────┐   1:N   ┌─────────────┐
│  Client  │<────────│   Job    │────────>│ LineItem    │
│ (address │         │ (booking)│         │ (supplying  │
│   book)  │         └──────────┘         │   list)     │
└──────────┘              │               └─────────────┘
      │                   │ N:1                  │ N:1
      │ 1:N               ▼                      ▼
┌──────────┐         ┌──────────┐         ┌─────────────┐
│ Contact  │         │  Depot   │         │  Product /  │
│  prices  │         └──────────┘         │  Stock      │
└──────────┘              ▲               └─────────────┘
                          │ N:1                  │ N:1
   ┌──────────┐           │               ┌─────────────┐
   │  Invoice │<──(job dispatched)──┐      │  Category   │
   │ /Billing │                     │      └─────────────┘
   └──────────┘                  ┌──────────┐
                                 │   User   │ (manager / token owner)
   ┌────────────┐               └──────────┘
   │ Attachment │──N:1──> Job
   └────────────┘
```

### 3.3 State Machines [IMPORTANT]

#### State Machine: Job status

```
[Enquiry/Quote] --confirm--> [Booked/Provisional] --prep--> [Prepped]
        │                          │                              │
        │                          │                       --dispatch--> [Dispatched/Booked Out]
        │                          │                                            │
        └--lose/cancel--> [Cancelled/Dead]                              --return--> [Returned]
                                                                                     │
                                                                            --invoice--> [Invoiced/Completed]
```

> Job status is set via `POST /frames/status_save.php` with `job` + `status` (a **numeric** value). The web UI workflow is: customer signs → status auto-moves to **Booked**; prep scan complete → **Prepped**; dispatched bookings auto-convert to **Invoices**. [DOCUMENTED]

| From State    | Action/Trigger           | To State       | Reversible?  | Side Effects                              |
| ------------- | ------------------------ | -------------- | ------------ | ----------------------------------------- |
| Enquiry/Quote | customer signs / confirm | Booked         | Yes (manual) | status_save; fires `job.status.*` webhook |
| Booked        | prep scan complete       | Prepped        | Yes (manual) | status_save                               |
| Prepped       | dispatch                 | Dispatched     | Maybe        | May auto-create an invoice                |
| Dispatched    | check-in / return scan   | Returned       | No           | status_save                               |
| Any           | cancel                   | Cancelled/Dead | Maybe        | status_save                               |

#### State Machine: Invoice

```
[Draft/Unpaid] --send--> [Sent] --pay--> [Paid]   (each transition fires invoice.status.updated)
```

| From State | Action | To State | Side Effects                     |
| ---------- | ------ | -------- | -------------------------------- |
| Draft      | send   | Sent     | `invoice.status.updated` webhook |
| Sent       | pay    | Paid     | `invoice.status.updated` webhook |

### 3.4 Business Rules [IMPORTANT]

**Ordering / dependency rules:**

- Creating a non-trivial job needs at minimum `name`, `out`, `start`. [DOCUMENTED]
- `items` reference existing products by ID with a type prefix (`a`/`b`/`c`); the product must exist. [DOCUMENTED]
- Categories must be empty before they can be deleted (`categories_delete.php`). [DOCUMENTED]

**Field-level rules:**

- Token in a query string **must be URL-encoded**. [DOCUMENTED]
- Dates/times are always `YYYY-MM-DD hh:mm:ss` (ISO-8601-style, space separator). [DOCUMENTED]
- Currency values are always sent/received in the **base currency**; conversion to job/invoice currency is applied for display only. [DOCUMENTED]

**Cascading effects:**

- Dispatching a booking can auto-generate an invoice. [DOCUMENTED]
- Status changes fire webhooks unless suppressed with `no_webhook` on `status_save`. [DOCUMENTED]

**Locking:**

- `LOCKED = 1` on a job indicates it cannot be edited (e.g. invoiced/closed). Respect this before attempting writes. [DOCUMENTED]

**Computed / read-only fields:**

- Job/line totals, margins (`job_margins.php`), and `jobs_totals.php` aggregates are computed server-side. [DOCUMENTED]
- `COLOUR` is derived from status. [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

| Format      | Pattern               | Example               | Notes                                                       |
| ----------- | --------------------- | --------------------- | ----------------------------------------------------------- |
| DateTime    | `YYYY-MM-DD hh:mm:ss` | `2026-06-10 08:00:00` | Space separator, not `T`. Some fields shown as `hh:mm` only |
| Date        | `YYYY-MM-DD`          | `2026-06-10`          | Line item out/return dates                                  |
| Currency    | number (base ccy)     | `180.00`              | Always base currency; display conversion applied elsewhere  |
| ID format   | integer               | `52`                  | Jobs, depots, clients, users                                |
| Token       | opaque string         | `dqwejk5...=-7hmn`    | Contains `=`/`+`/`-`; URL-encode in query strings           |
| Boolean-ish | integer 0/1           | `1`                   | `LOCKED`, `USE_SALES_TAX`, `VIRTUAL`                        |
| Colour      | hex                   | `#3399ff`             | Job status colour                                           |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Entity   | Field       | Allowed Values                                                                                                                | Confidence                       | Notes                                                                                                                             |
| -------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| LineItem | kind        | 0=heading, 1=sales, 2=hire, 3=custom, 4=labour, 5=inline, 6=calculated                                                        | [DOCUMENTED]                     |                                                                                                                                   |
| LineItem | PRICE_TYPE  | 0=one-off, 1=hourly, 2=daily, 3=weekly, 4=monthly, 5=every day, 6=every week                                                  | [DOCUMENTED]                     |                                                                                                                                   |
| Job item | prefix      | `a`=sales, `b`=hire, `c`=labour (used in the `items` write map)                                                               | [DOCUMENTED]                     |                                                                                                                                   |
| Job      | STATUS      | numeric. Commonly: 0=Enquiry/Draft, 1=Provisional, 2=Booked, 3=Prepped, 5=Dispatched/Booked Out, 7=Returned, 8=Cancelled/Dead | **[INFERRED — NEEDS DISCOVERY]** | Exact integer→label map is **not** in public docs. Do not treat as fact; verify on a live instance via `status_save` / job reads. |
| Job      | price_group | 0, 1, 2                                                                                                                       | [DOCUMENTED]                     | Pricing tier selector on save                                                                                                     |

---

## Phase 4: Endpoint Catalog

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /api/job_data.php (alias: GET /php_functions/job_refresh.php)

- **Purpose:** Retrieve a job's metadata by ID. [DOCUMENTED]
- **Auth required:** yes
- **Idempotent:** yes

**Query parameters:**

| Parameter | Type    | Required | Description                      |
| --------- | ------- | -------- | -------------------------------- |
| job       | integer | yes      | Job number                       |
| token     | string  | yes\*    | URL-encoded token (or X-TOKEN)   |
| version   | string  | no       | API version (default latest 1.3) |

**Example request:**

```http
GET /api/job_data.php?job=52&token=dqwejk5...%3D-7hmn HTTP/1.1
Host: myhirehop.com
```

**Success response (200):** see Phase 2.4 documented shape (job metadata; no line items). [DOCUMENTED]

#### Endpoint: POST /php_functions/job_save.php (alias: POST /api/save_job.php)

- **Purpose:** Create (omit `job` or set `job=0`) or edit (`job={id}`) a job and optionally its items in one call. [DOCUMENTED]
- **Auth required:** yes
- **Idempotent:** no (create); edit is effectively idempotent if the same body is re-sent

**Request body (create):** [DOCUMENTED params; illustrative values]

```json
{
  "job": 0,
  "name": "Jane Smith",
  "company": "Acme Events Ltd",
  "out": "2026-06-10 08:00",
  "start": "2026-06-11 00:00",
  "end": "2026-06-14 00:00",
  "to": "2026-06-15 17:00",
  "job_name": "Summer Festival Main Stage",
  "depot": 1,
  "client_id": 1023,
  "items": { "b123": 4, "a12": 3.5, "c34": 2.2 },
  "token": "dqwejk5GVT65909bHHBN7922pq5hxjm=-7hmn"
}
```

**Request body (edit name only):**

```json
{ "job": 52, "name": "New Name", "token": "dqwejk5...=-7hmn" }
```

**Required (create):** `name`, `out`, `start`. **To edit:** `job={id}` + the fields to change. [DOCUMENTED]

#### Endpoint: POST /frames/status_save.php

- **Purpose:** Change a job's status. [DOCUMENTED]
- **Auth required:** yes
- **Idempotent:** yes (setting the same status again is a no-op)

**Parameters:**

| Parameter  | Type    | Required | Description                                          |
| ---------- | ------- | -------- | ---------------------------------------------------- |
| job        | integer | yes      | Job number                                           |
| status     | number  | yes      | New numeric status (see 3.6 — values need discovery) |
| no_webhook | integer | no       | Non-zero suppresses the status-change webhook        |
| token      | string  | yes\*    | Token                                                |

**Success response:** `{ "status": <new>, "colour": "#rrggbb" }` (or `error`). [DOCUMENTED]

#### Endpoint: GET /php_functions/get_depots.php

- **Purpose:** List all depots (no params). [DOCUMENTED]

**Response:**

```json
[
  { "ID": 1, "DEPOT": "Main Depot", "VIRTUAL": false },
  { "ID": 2, "DEPOT": "London Hub", "VIRTUAL": false }
]
```

#### Endpoint: POST /php_functions/availability_get_available.php

- **Purpose:** Get day-by-day availability for products over a date range — core for "is X available between dates?" questions. [DOCUMENTED]
- **Auth required:** yes
- **Idempotent:** yes
- **Note:** Exact request/response schema not fully documented — **discovery needed.** [INFERRED]

### 4.2 Full Endpoint Index [IMPORTANT]

> All paths are relative to the tenant `base_url`. Methods/purposes per the API docs page. None live-verified.

| Method | Path                                          | Purpose                                   | Auth | Paginated | Confidence   |
| ------ | --------------------------------------------- | ----------------------------------------- | ---- | --------- | ------------ |
| GET    | /api/job_data.php                             | Get job data by ID                        | Yes  | No        | [DOCUMENTED] |
| GET    | /php_functions/job_refresh.php                | Get job data (UI alias)                   | Yes  | No        | [DOCUMENTED] |
| POST   | /api/save_job.php                             | Save job + items in one call              | Yes  | No        | [DOCUMENTED] |
| POST   | /php_functions/job_save.php                   | Create/edit job                           | Yes  | No        | [DOCUMENTED] |
| POST   | /frames/status_save.php                       | Change job status                         | Yes  | No        | [DOCUMENTED] |
| POST   | /php_functions/job_duplicate.php              | Duplicate a job                           | Yes  | No        | [DOCUMENTED] |
| GET    | /php_functions/job_margins.php                | Job costings / profit                     | Yes  | No        | [DOCUMENTED] |
| GET    | /php_functions/jobs_totals.php                | Totals for up to 50 jobs                  | Yes  | No\*      | [DOCUMENTED] |
| POST   | /php_functions/archive_insert.php             | Save supplying list to archive            | Yes  | No        | [DOCUMENTED] |
| GET    | /php_functions/items_available.php            | Item availability (deprecated)            | Yes  | No        | [DOCUMENTED] |
| POST   | /php_functions/items_barcode_save.php         | Add item to job by barcode                | Yes  | No        | [DOCUMENTED] |
| GET    | /php_functions/items_get_multiplier.php       | Price multiplier for an item              | Yes  | No        | [DOCUMENTED] |
| GET    | /php_functions/picklist_get_availability.php  | Product availability for picklist         | Yes  | No        | [DOCUMENTED] |
| GET    | /php_functions/availability_list.php          | Products for availability list            | Yes  | Maybe     | [DOCUMENTED] |
| POST   | /php_functions/availability_get_available.php | Daily product availability                | Yes  | No        | [DOCUMENTED] |
| GET    | /php_functions/availability_jobs_list.php     | Jobs using a rental product within a year | Yes  | Maybe     | [DOCUMENTED] |
| GET    | /php_functions/sales_list.php                 | Jobs using a labour/rental product        | Yes  | Maybe     | [DOCUMENTED] |
| GET    | /php_functions/list_contacts.php              | List address-book contacts/clients        | Yes  | Yes       | [DOCUMENTED] |
| POST   | /php_functions/save_contact.php               | Create/edit a contact/client              | Yes  | No        | [INFERRED]   |
| POST   | /php_functions/contact_prices_save.php        | Save per-client price overrides           | Yes  | No        | [DOCUMENTED] |
| GET    | /php_functions/categories_list.php            | List categories                           | Yes  | No        | [DOCUMENTED] |
| POST   | /php_functions/categories_save.php            | Create/edit category                      | Yes  | No        | [DOCUMENTED] |
| POST   | /php_functions/categories_move.php            | Move categories                           | Yes  | No        | [DOCUMENTED] |
| POST   | /php_functions/categories_delete.php          | Delete empty categories                   | Yes  | No        | [DOCUMENTED] |
| GET    | /php_functions/get_depots.php                 | List depots                               | Yes  | No        | [DOCUMENTED] |
| GET    | /php_functions/get_user_info.php              | Current user (token owner) info           | Yes  | No        | [DOCUMENTED] |
| GET    | /php_functions/attach_list.php                | List job attachments                      | Yes  | Maybe     | [DOCUMENTED] |
| POST   | /php_functions/attach_files_upload.php        | Upload attachment                         | Yes  | No        | [DOCUMENTED] |
| POST   | /php_functions/attach_delete.php              | Delete attachment                         | Yes  | No        | [DOCUMENTED] |
| GET    | /php_functions/custom_fields_global_load.php  | Load global custom field defs             | Yes  | No        | [DOCUMENTED] |
| POST   | /php_functions/custom_fields_global_save.php  | Save global custom field defs             | Yes  | No        | [DOCUMENTED] |
| POST   | /api/sql_execute.php                          | Run raw SELECT (deprecated, dangerous)    | Yes  | No        | [DOCUMENTED] |

> **Avoid `/api/sql_execute.php`** for the connector — it is deprecated and exposes raw SQL; out of scope for a safe agent tool. [DOCUMENTED]

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                 | Supported?       | Syntax                                | Notes                                                               |
| -------------------------- | ---------------- | ------------------------------------- | ------------------------------------------------------------------- |
| Filter by field value      | Partial          | endpoint-specific params              | No uniform `?filter[x]=` syntax; each `.php` defines its own params |
| Filter by date range       | Yes (some)       | date params on availability endpoints | e.g. availability over a date range [DOCUMENTED]                    |
| Full-text search           | Partial          | `list_contacts.php` search param      | Search exists on contacts; not uniform [INFERRED]                   |
| Sort by field              | Partial          | endpoint-specific                     | Not consistently documented [INFERRED]                              |
| Field selection            | No               | -                                     | Not supported [INFERRED]                                            |
| Include related records    | No               | -                                     | Jobs don't embed line items; separate calls needed [DOCUMENTED]     |
| Aggregate / count          | Yes (some)       | `jobs_totals.php`, `job_margins.php`  | Computed totals/margins [DOCUMENTED]                                |
| Logical operators (AND/OR) | No               | -                                     | Implicit AND of params at best [INFERRED]                           |
| Comparison operators       | No               | -                                     | Only explicit date-range params [INFERRED]                          |
| Raw SQL                    | Yes (deprecated) | `/api/sql_execute.php`                | **Do not use** — deprecated, unsafe [DOCUMENTED]                    |

### 5.2 Filter Syntax [REQUIRED]

There is **no uniform filter grammar**. Each PHP endpoint defines its own named parameters. The general access pattern is:

```
{base_url}/php_functions/{action}.php?{param}={value}&{param2}={value2}&token={url_encoded_token}
```

### 5.3 Sort Syntax [IMPORTANT]

Sort is endpoint-specific (e.g. list endpoints accept `page` + `rows`; sort columns where supported are documented per endpoint). Not uniformly documented. [INFERRED]

### 5.5 Search Capabilities [IMPORTANT]

- **Global search endpoint:** None [DOCUMENTED]
- **Per-resource search:** `list_contacts.php` accepts filter/search params; product availability endpoints accept product identifiers/barcodes. [DOCUMENTED / INFERRED]
- **Fuzzy matching:** Not documented [UNKNOWN]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: Get a job's details**

```http
GET /api/job_data.php?job=52&token={enc}
```

**Pattern 2: List depots (then map DEPOT_ID → name)**

```http
GET /php_functions/get_depots.php?token={enc}
```

**Pattern 3: Check product availability over a date range**

```http
POST /php_functions/availability_get_available.php
{ "product": 123, "start": "2026-06-10 08:00", "end": "2026-06-15 17:00", "token": "{enc}" }
```

**Pattern 4: Find jobs that used a rental product this year**

```http
GET /php_functions/availability_jobs_list.php?product=123&token={enc}
```

**Pattern 5: Totals across multiple jobs**

```http
GET /php_functions/jobs_totals.php?jobs=51,52,53&token={enc}
```

> Exact param names for Patterns 3-5 are **inferred** and must be confirmed against the live docs/instance. [INFERRED]

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** page-number — `page` + `rows` parameters on list endpoints. [DOCUMENTED]
- **Default page size:** Varies per endpoint; not uniformly documented. [DOCUMENTED]
- **Maximum page size:** Varies per endpoint (e.g. `jobs_totals.php` caps at 50 jobs). [DOCUMENTED]
- **Total count available:** Not consistently documented — likely a `rows`/total field in list responses; needs discovery. [INFERRED]

**Request parameters:**

| Parameter | Type    | Description                          |
| --------- | ------- | ------------------------------------ |
| page      | integer | 1-based page number                  |
| rows      | integer | Page size (endpoint-specific limits) |

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /php_functions/list_contacts.php?page=1&rows=50&token={enc}
Page 2: GET /php_functions/list_contacts.php?page=2&rows=50&token={enc}
Last:   returned rows < requested rows  (exact "last page" signal needs discovery)
```

### 6.3 Bulk Operations [IMPORTANT]

| Operation             | Endpoint                        | Notes                                                          |
| --------------------- | ------------------------------- | -------------------------------------------------------------- |
| Bulk read (totals)    | `jobs_totals.php`               | Up to 50 jobs at once [DOCUMENTED]                             |
| Save job + many items | `job_save.php` / `save_job.php` | Single call writes a job and its full `items` map [DOCUMENTED] |

No general bulk create/update/delete across arbitrary records is documented. [INFERRED]

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

No dedicated async export API. Document generation (PDF) exists in the product but is not a documented JSON export endpoint. [INFERRED]

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported? | Notes                                                    |
| ------------------------ | ---------- | -------------------------------------------------------- |
| Webhooks                 | **Yes**    | First-class, configured in company settings [DOCUMENTED] |
| WebSocket                | No         | [INFERRED]                                               |
| Server-Sent Events (SSE) | No         | [INFERRED]                                               |
| Long polling             | No         | [INFERRED]                                               |
| Change feeds / streams   | No         | [INFERRED]                                               |

### 7.2 Webhooks [IMPORTANT]

**Setup:**

- **Registration method:** UI — Settings → **Company settings** tab → **Webhooks** button → **New** → enter target URL and tick the events to subscribe to. [DOCUMENTED]
- **Registration endpoint:** UI only (no documented API to manage webhook subscriptions). [DOCUMENTED]
- **Webhook URL requirements:** A reachable HTTP(S) endpoint. HireHop **does not wait for a response and does not report HTTP errors** from the target — fire-and-forget. [DOCUMENTED]

**Event Catalog:**

| Event Name (pattern)          | Trigger                      | Confidence                           |
| ----------------------------- | ---------------------------- | ------------------------------------ |
| `invoice.status.updated`      | Invoice status changes       | [DOCUMENTED]                         |
| `job.status.*` (e.g. updated) | Job status changes           | [INFERRED]                           |
| (other entity.action.event)   | Per the checkboxes in the UI | [INFERRED — full list not published] |

> The docs show the **payload shape** and one concrete event (`invoice.status.updated`) but do **not** publish the full event list. Enumerate it from the Webhooks settings UI on a live instance. [DOCUMENTED / discovery needed]

**Payload format:** [DOCUMENTED]

```json
{
  "time": "2022-03-29 07:50:42",
  "user_id": 1,
  "user_name": "John Smith",
  "user_email": "john@email.com",
  "company_id": 1,
  "export_key": "22u43mrjwe7u",
  "event": "invoice.status.updated",
  "data": {},
  "changes": {
    "FIELD_NAME": { "from": "old", "to": "new" }
  }
}
```

**Verification / security:**

- **Shared-secret check:** `export_key` in the payload equals the **export key** in company settings. Verify it to authenticate the sender. [DOCUMENTED]
- **Signature header:** None — there is no HMAC signature; the only check is the body `export_key`. [DOCUMENTED]
- **IP allowlist:** Not documented. [UNKNOWN]

**Reliability:**

- **Retry policy:** None — HireHop neither waits for nor retries on failure (fire-and-forget). Missed events must be reconciled by polling. [DOCUMENTED]
- **Ordering / duplicates:** Not guaranteed / not documented. [UNKNOWN]

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended polling:** Re-read jobs / availability on demand. There is no documented "modified since" filter, so polling is coarse. [INFERRED]
- **Recommended interval:** No tighter than the rate limit allows — stay within 60/min and 3/sec. [DOCUMENTED]
- **Change detection field(s):** None standard documented; status changes are best caught via webhooks. [INFERRED]

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope    | Limit       | Window   | Notes                       |
| -------- | ----------- | -------- | --------------------------- |
| Per user | 60 requests | 1 minute | Per token/user [DOCUMENTED] |
| Per user | 3 requests  | 1 second | Burst cap [DOCUMENTED]      |

- **Rate limit headers:** [DOCUMENTED]

| Header                | Meaning                         |
| --------------------- | ------------------------------- |
| X-Request-Count       | Requests made in current window |
| X-RateLimit-Available | Requests remaining              |

- **Rate limit exceeded response:** HTTP **429** with HireHop error **327** ("Security warning, too many transactions"). [DOCUMENTED]
- **Backoff strategy:** Throttle to ≤3/sec and ≤60/min; on 429 back off and retry after the window. [DOCUMENTED]

### 8.2 Error Handling [REQUIRED]

**Error envelope:** Errors are commonly returned as a JSON object carrying an `error` field (numeric HireHop error code and/or message). The HTTP status is not always non-2xx for application errors — **inspect the body's `error` field**, not just the HTTP code. [DOCUMENTED / INFERRED]

```json
{ "error": 327, "message": "Security warning, too many transactions" }
```

**Error codes reference:**

| HTTP Status | HireHop code | Meaning                         | Retryable? | Recovery                                                    |
| ----------- | ------------ | ------------------------------- | ---------- | ----------------------------------------------------------- |
| 200         | `error` set  | Application-level error in body | Depends    | Read `error`/`message`; fix request                         |
| 401/403     | —            | Invalid/expired token           | No         | Token invalidated (user re-login or pw change) → regenerate |
| 429         | 327          | Rate limit exceeded             | Yes        | Back off, respect 60/min + 3/sec                            |
| 404         | —            | Wrong host/path                 | No         | Use the tenant `base_url`; not `www.hirehop.com`            |
| 5xx         | —            | Server error                    | Yes        | Retry with backoff                                          |

> **Note:** The complete HireHop numeric error code table is not published; 327 (rate limit) is the only widely documented one. Treat unknown `error` values as non-retryable and surface the message. [DOCUMENTED / INFERRED]

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** No. [INFERRED]
- **Naturally idempotent:** GET reads (job_data, get_depots) yes; `job_save` with a fixed `job` id is effectively idempotent; `status_save` is idempotent (sets to a target value). Creating a job (`job=0`) is NOT idempotent — re-posting creates duplicates. [INFERRED]

### 8.5 File Handling [IMPORTANT]

- **Upload endpoint:** `POST /php_functions/attach_files_upload.php` (file upload, likely multipart). [DOCUMENTED]
- **List:** `attach_list.php`; **Delete:** `attach_delete.php`. [DOCUMENTED]
- **Method / limits:** Multipart upload assumed; size/type limits not documented. [INFERRED]

> NOTE: These attachments are job-scoped documents, NOT a general file-browsing surface. They do not make HireHop a "file storage" connector (see Phase 9).

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                 | Fits?        | Notes                                                                |
| -------------------------- | ------------------------------------------- | ------------ | -------------------------------------------------------------------- |
| **Data Connector**         | API has browsable file-like content         | No           | Not a document/file system; structured rental records                |
| **Data Connector (Files)** | API is primarily file storage               | No           | Attachments are job-scoped only, not a browsable drive               |
| **Direct API Only**        | Action-oriented; read+write structured data | **Best fit** | Jobs, items, availability, clients, status, billing via direct calls |
| **Hybrid**                 | Browsable content AND actions               | No           | No genuine file-browse surface                                       |

**Selected integration path:** **Direct API via `connect_request`** — an API-key connector. Matches the registry entry (`authType: 'api-key'`, NOT a file-browser like Drive/OneDrive/Dropbox).

**Justification:** HireHop exposes structured, action-oriented rental operations (read/create/edit jobs, change status, check availability, list depots/clients, read margins/totals). There is no browsable file/document tree, so the Data Connector (Files) path does not apply. The workspace agent should call HireHop directly through the connector's `connect_request` mechanism, injecting the stored `api_token` and using the per-tenant `base_url`. The two credential fields (`api_token`, `base_url`) are exactly what the runtime needs to build each request: `{base_url}{path}` with the token in `X-TOKEN` (preferred — avoids URL-encoding pitfalls and keeps the secret out of query logs).

### 9.2 Connector Requirements [IMPORTANT]

Not a Files connector — the standard `list_files`/`download_file` interface does not apply. Instead the connector is a thin authenticated HTTP passthrough:

| Concern         | HireHop specifics                                                                 |
| --------------- | --------------------------------------------------------------------------------- |
| Base URL        | From credential `base_url` (e.g. `https://myhirehop.com`); append endpoint paths  |
| Auth injection  | Add token — prefer header `X-TOKEN: {api_token}`; fallback `?token={url_encoded}` |
| Read endpoints  | `job_data.php`, `get_depots.php`, `list_contacts.php`, availability/jobs lists    |
| Write endpoints | `job_save.php`, `status_save.php`, `save_contact.php`, `attach_files_upload.php`  |
| Rate limiting   | Enforce ≤3/sec, ≤60/min; respect 429/err 327                                      |

**Auth type for connector:** API Key (token) — confirmed in registry.
**Connector category:** Equipment & Rental (registry) — functionally project/operations management.
**Caching appropriate:** Yes for slow-changing reference data (depots, categories, custom-field defs) — short TTL (e.g. 5 min). Do NOT cache availability (time-sensitive) or financial totals.

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Read a job's details by ID (`job_data.php`) and its costings/totals (`job_margins.php`, `jobs_totals.php`). [DOCUMENTED]
2. Create and edit jobs/bookings including their supplying-list items (`job_save.php` with the `items` map). [DOCUMENTED]
3. Change a job's status (`status_save.php`) — quote → booked → prepped → dispatched → returned. [DOCUMENTED]
4. Check equipment availability over date ranges and find jobs using a product (`availability_*`). [DOCUMENTED]
5. List depots, categories, and contacts/clients; create/edit clients and per-client prices. [DOCUMENTED]
6. Manage job attachments (list/upload/delete). [DOCUMENTED]
7. Read global custom-field definitions and set custom-field values on jobs. [DOCUMENTED]

**CANNOT do (out of scope or dangerous):**

1. Run raw SQL via `/api/sql_execute.php` — deprecated and unsafe; never expose to the agent. [DOCUMENTED]
2. Manage webhook subscriptions via API — UI only. [DOCUMENTED]
3. Rely on exact job-status integers — the numeric→label map is unverified; status writes must be confirmed against the tenant first. [INFERRED]
4. Hard-delete jobs — no documented delete; cancellation is a status. [INFERRED]
5. Edit `LOCKED` jobs — respect the lock flag and refuse writes. [DOCUMENTED]

**Default parameters:**

| Parameter | Default            | Reason                                                         |
| --------- | ------------------ | -------------------------------------------------------------- |
| token via | `X-TOKEN` header   | Keeps the secret out of URLs/logs; avoids URL-encoding bugs    |
| version   | omit (latest, 1.3) | Backward compatible; only pin if a tenant needs an older shape |
| rows      | 50                 | Reasonable page size within rate budget                        |
| throttle  | ≤3/sec, ≤60/min    | Hard API limits (err 327 / 429)                                |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK             | Language | Quality | Maintained? | Worth Using?   | Notes                                                |
| --------------- | -------- | ------- | ----------- | -------------- | ---------------------------------------------------- |
| (none official) | —        | —       | —           | No             | No official SDK                                      |
| HireHop Webshop | PHP      | Good    | Yes         | Reference only | Official WordPress plugin — best real-world examples |

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified, quality assessed (adequate)
- [~] Phase 2 complete: auth fully documented; **first live call NOT made (gate unmet)**
- [x] Phase 3 complete: core entities + fields documented; status enum + read-path for line items need discovery
- [x] Phase 4 complete: 30+ endpoints catalogued (documented, not live-verified); 5 critical ones with examples
- [x] Phase 5 complete: query/filter model documented (per-endpoint, no uniform grammar)
- [x] Phase 6 complete: page/rows pagination documented
- [x] Phase 7 complete: webhooks documented (payload + export_key); full event list needs discovery
- [x] Phase 8 complete: rate limits + 429/327 documented; full error code table not published
- [x] Phase 9 complete: integration path selected (Direct API via connect_request, api-key)

**Overall investigation confidence:** medium — well documented, but NOT live-tested. Treat all request/response bodies as documented shapes pending live verification.

**Known gaps that will reduce output quality:**

1. **No live call** — Phase 2.4 gate unmet; mutation request/response bodies are documented, not verified.
2. **Job status integer values** are not published — `status_save` writes and status filtering need discovery on a real tenant.
3. **Reading a job's full line items** — `job_data` excludes them; the read path (supplying-list endpoint) is inferred, not confirmed.
4. **Full webhook event list** and **complete error code table** are not published.
5. **Per-endpoint pagination/sort/total-count details** are inconsistently documented.

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence  | Gaps                                                                         |
| ---------------------------- | ------------- | ----------- | ---------------------------------------------------------------------------- |
| 01-llm-api-rules             | Yes           | Medium      | Auth + rate limits solid; mark mutation shapes as unverified                 |
| 01a-domain-model-reference   | Yes           | Medium      | Status enum + line-item read path need discovery                             |
| 01b-query-patterns           | Partial       | Low-Med     | No uniform filter grammar; per-endpoint params partly inferred               |
| 01c-mutation-patterns        | Partial       | Low-Med     | job_save/status_save documented; needs live validation of fields             |
| 01d-event-and-error-handling | Yes           | Medium      | Webhook payload + export_key + 429/327 solid; full event/error lists missing |
| 02-api-spec-investigation    | Yes           | Medium      | Endpoints documented, not live-verified                                      |
| 03-connector-setup           | Yes           | Medium-High | Auth model (api-key + base_url) matches registry exactly                     |

---

## Appendix: HireHop-specific notes for the connector author

1. **Two credential fields are both required at request time.** Build every call as `{base_url}{path}` and inject the token. Prefer the `X-TOKEN` header so the secret never lands in a query string or access log; only fall back to `?token=` (URL-encoded) if a specific endpoint misbehaves with the header.
2. **`www.hirehop.com` is the marketing site and 403s API clients.** The real API hosts are `myhirehop.com`, `hirehop.net`, `myhirehop.co.uk`, or the tenant's vanity domain — exactly why `base_url` is a credential.
3. **Token stability:** advise the customer to generate the token under a dedicated, non-interactive "API" user. Any interactive login (or email/password change) by that user silently invalidates the token → 401/403.
4. **Currency is always base currency** in/out — don't apply the job/invoice currency yourself; HireHop handles display conversion.
5. **Datetimes are `YYYY-MM-DD hh:mm:ss`** with a space, not a `T`.
6. **Check `LOCKED` before writing** and never expose `/api/sql_execute.php` to the agent.
7. **Status writes are risky without the verified integer map** — first discovery task on any live tenant is to enumerate the job status IDs.

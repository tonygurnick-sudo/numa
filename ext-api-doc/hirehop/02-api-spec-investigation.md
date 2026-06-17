---
api_name: HireHop
api_slug: hirehop
doc: api-spec-investigation (developer reference)
base_url: per-tenant credential (e.g. https://myhirehop.com | https://hirehop.net | https://myhirehop.co.uk | vanity domain). NEVER www.hirehop.com (marketing site, 403s API clients)
path_construction: '{base_url}{path}' — path includes the .php script. Prefixes /php_functions/ (most), /api/ (small curated set), /frames/ (a few)
path_version_segment: none — "1.3" is a request-param label only (`version=1.2` for older shapes); no version in the path
auth: API key (static per-user token), header X-TOKEN preferred. NOT OAuth. token+base_url = identity (no account/company id param)
field_casing: ASYMMETRIC — responses UPPER_SNAKE_CASE, request params lower_snake_case (request name ≠ response name)
id_format: integer everywhere
rate_limit: 60/60s AND 3/s per token → 429 + {"error":327}
spec_format: none (no OpenAPI/Swagger; flat HTML reference)
docs_url: https://www.hirehop.com/api_documentation/ (www host 403s fetchers; mirrors https://www.hirehop.co.za/api_documentation/ and https://www.hirehop.co.uk/api_documentation/)
getting_started: https://www.hirehop.com/blog/hirehop-rest-api-getting-started-guide/
call_surface: HTTP via `numa integrations request`. NOT a Files connector (no browsable tree; attachments job-scoped only)
confidence: MEDIUM — documented from HireHop official docs + web research 2026-05-29, NOT live-tested. Every fact [DOCUMENTED] unless tagged [INFERRED]/[UNKNOWN]. Nothing [CONFIRMED] (no live call)
---

# HireHop — API Specification & Investigation

Condensed developer reference. Verify request/response bodies field-for-field on first real call.

## Overview

- **Vendor:** HireHop Ltd — equipment / event rental management software (UK).
- **API version:** 1.3 — backward compatible; older shapes via a `version` request param (e.g. `version=1.2`). No version in the path.
- **Base URL:** per-tenant `base_url` credential. HireHop runs the same app on three interchangeable hosts (or a vanity domain proxying to the same backend): `https://myhirehop.com` (registry placeholder default), `https://hirehop.net`, `https://myhirehop.co.uk`. **NEVER `https://www.hirehop.com`** — marketing site, returns 403 to API clients. This is why `base_url` is a credential, not a constant.
- **Sandbox:** none. A demo document template exists at `myhirehop.com/docs/job_info.html`.
- **API type:** REST-ish over HTTPS. JSON responses, but endpoints are PHP scripts (`*.php`), not RESTful resource paths. The "API" is a curated, stable subset of the same `php_functions/*.php` endpoints the web UI calls.
- **Data format:** JSON responses. Requests accept **either** a JSON body, URL-encoded form data, **or** query-string params — HireHop auto-detects.
- **Field casing:** ASYMMETRIC — responses mostly UPPER_SNAKE_CASE (`JOB_NAME`, `OUT_DATE`, `DEPOT_ID`, `CUSTOM_FIELDS`); request params lower_snake_case (`name`, `out`, `start`, `job_name`, `client_id`). **Request field name ≠ response field name.**
- **ID format:** integer everywhere (job `ID`, `DEPOT_ID`, `CLIENT_ID`, user IDs, line-item `ID`).
- **URL structure:** `{base_url}/php_functions/{action}.php` (most), `{base_url}/api/{action}.php` (smaller curated surface), a few under `{base_url}/frames/`.
- **OpenAPI/Postman/status page:** none — flat HTML reference only [UNKNOWN for status page].
- **Contact:** HireHop support via hirehop.com — self-service (token generated in-app), no partner registration.

**Summary:** read/create/edit jobs (a "job" = quotation = booking, same record at different statuses), manage a job's supplying list of items, change job status, check equipment availability over date ranges, list depots and address-book clients, read costings/margins/billing totals. **No browsable file/document tree** — attachments are job-scoped only — so this is a Direct-API connector, not a Files connector.

## Authentication

**Method: API key (static per-user token).** Long-lived, opaque, bearer-style. NOT OAuth. Registry `authType: 'api-key'`. The token resolves the customer's HireHop company server-side → **no account/company ID param**; the pair `api_token`+`base_url` is the entire identity.

**Header (preferred):** `X-TOKEN: dqwejk5GVT65909bHHBN7922pq5hxjm=-7hmn` + `Content-Type: application/json` (only when sending a JSON body).
Token may be supplied any one of: (1) header `X-TOKEN`, (2) query `?token={URL-ENCODED}` (MUST URL-encode — token contains `=`,`+`,`-`), (3) POST form field `token`, (4) JSON body field `"token"`. Prefer the header (keeps secret out of URLs/logs, avoids encoding pitfalls).

| Property           | Value                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| How to obtain      | Admin mode → Settings → **Users** tab → select/create a user → **Menu** → **API Token**                                        |
| Token format       | Opaque base64-ish string containing `=`,`+`,`-` (e.g. `dqwejk5GVT65909bHHBN7922pq5hxjm=-7hmn`)                                 |
| Lifetime           | "Never expires" by time — BUT silently invalidated the moment the owning user logs in interactively, or changes email/password |
| Scopes/permissions | Inherits the owning user's HireHop role/permissions                                                                            |
| Rotation           | Regenerate from the same Users → API Token menu (or change the API user's password to force-invalidate a leaked token)         |

**Stability:** create a dedicated, non-interactive "API" user (never logs in via the web UI) so the token isn't silently invalidated. No OAuth flow, no refresh token, no PKCE. See `04-connection-and-reauth.md`.

## Response & Error Conventions

- **Success:** plain JSON object or array (no uniform `{result,data}` envelope). Single-resource reads return an object (`job_data.php`); list reads return an array (`get_depots.php`).
- **Application errors:** JSON object carrying an `error` field (numeric HireHop code) — HTTP status is NOT always non-2xx. **Inspect the body's `error` field, not just the HTTP status.** `{"error":327}`. Messages live in client-side lang files (e.g. `en-US.js`); the body carries the code. Known: **3**="Missing parameters"; **327**=rate limit / "Security warning, too many transactions". Full table unpublished — treat unknown codes as non-retryable and surface them [INFERRED].

## Endpoint Catalog

All paths relative to tenant `base_url`. None live-verified — all [DOCUMENTED] from the HTML docs unless noted.

### Jobs (the central entity)

| Method | Path                               | Purpose                             | Paginated | Idempotent  |
| ------ | ---------------------------------- | ----------------------------------- | --------- | ----------- |
| GET    | `/api/job_data.php`                | Get a job's metadata by ID          | No        | Yes         |
| GET    | `/php_functions/job_refresh.php`   | Get job metadata (UI alias)         | No        | Yes         |
| POST   | `/api/save_job.php`                | Create/edit job + items in one call | No        | No (create) |
| POST   | `/php_functions/job_save.php`      | Create/edit job (UI alias)          | No        | No (create) |
| POST   | `/frames/status_save.php`          | Change a job's status               | No        | Yes         |
| POST   | `/php_functions/job_duplicate.php` | Duplicate a job (param is `id`)     | No        | No          |
| GET    | `/php_functions/job_margins.php`   | Job costings / profit               | No        | Yes         |
| GET    | `/php_functions/jobs_totals.php`   | Aggregate totals for ≤50 jobs       | No        | Yes         |

Create vs edit: same save endpoint handles both. Omit `job` or set `job=0` to create; pass `job={id}` to edit. Edits are **partial** — only the params you send are changed.

### Line Items / Supplying List

| Method | Path                                      | Purpose                                   | Notes                                 |
| ------ | ----------------------------------------- | ----------------------------------------- | ------------------------------------- |
| POST   | `/php_functions/job_save.php`             | Write items via the `items` map (on save) | `items`=`{"<prefix><productId>":qty}` |
| POST   | `/php_functions/items_barcode_save.php`   | Add an item to a job by barcode           |                                       |
| GET    | `/php_functions/items_get_multiplier.php` | Price multiplier for an item              |                                       |
| POST   | `/php_functions/archive_insert.php`       | Save supplying list to archive            |                                       |

**Reading a job's full line-item list is a known gap.** `job_data.php`/`job_refresh.php` return job **metadata only** — the supplying list is NOT in that response. The full-item read path is not cleanly documented and must be discovered against a live instance [INFERRED].

### Availability & Stock

| Method | Path                                            | Purpose                                      | Confidence                               |
| ------ | ----------------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| POST   | `/php_functions/availability_get_available.php` | Day-by-day product availability over a range | exact request/response schema [INFERRED] |
| GET    | `/php_functions/availability_list.php`          | Products for an availability list            |                                          |
| GET    | `/php_functions/picklist_get_availability.php`  | Product availability for a job's picklist    |                                          |
| GET    | `/php_functions/availability_jobs_list.php`     | Jobs using a rental product within a year    |                                          |
| GET    | `/php_functions/sales_list.php`                 | Jobs using a labour/rental product           |                                          |
| GET    | `/php_functions/items_available.php`            | Item availability (**deprecated**)           |                                          |

### Clients / Contacts (address book)

| Method | Path                                     | Purpose                            | Paginated |
| ------ | ---------------------------------------- | ---------------------------------- | --------- |
| GET    | `/php_functions/get_contacts.php`        | List address-book contacts/clients | Yes       |
| POST   | `/php_functions/contact_save.php`        | Create/edit a contact/client       | No        |
| POST   | `/php_functions/contact_prices_save.php` | Save per-client price overrides    | No        |

Endpoint-name correction: the live endpoints are `get_contacts.php` (read) / `contact_save.php` (write). Earlier draft material referenced `list_contacts.php`/`save_contact.php` — wrong names (see 01 gotcha #8).

### Reference Data (depots, categories, custom fields, user)

| Method | Path                                           | Purpose                              |
| ------ | ---------------------------------------------- | ------------------------------------ |
| GET    | `/php_functions/get_depots.php`                | List depots (no params)              |
| GET    | `/php_functions/get_user_info.php`             | Current user (token owner) info      |
| GET    | `/php_functions/categories_list.php`           | List catalogue categories            |
| POST   | `/php_functions/categories_save.php`           | Create/edit a category               |
| POST   | `/php_functions/categories_move.php`           | Move categories                      |
| POST   | `/php_functions/categories_delete.php`         | Delete **empty** categories          |
| GET    | `/php_functions/custom_fields_global_load.php` | Load global custom-field definitions |
| POST   | `/php_functions/custom_fields_global_save.php` | Save global custom-field definitions |

### Attachments (job-scoped files)

| Method | Path                                     | Purpose                                  |
| ------ | ---------------------------------------- | ---------------------------------------- |
| GET    | `/php_functions/attach_list.php`         | List job attachments                     |
| POST   | `/php_functions/attach_files_upload.php` | Upload attachment (multipart) [INFERRED] |
| POST   | `/php_functions/attach_delete.php`       | Delete attachment                        |

### Do NOT Use

| Method | Path                   | Why                                                                         |
| ------ | ---------------------- | --------------------------------------------------------------------------- |
| POST   | `/api/sql_execute.php` | Runs raw SQL `SELECT`. Deprecated and dangerous — never expose to the agent |

## Data Models

Full entity reference in `01a-domain-model-reference.md`. Responses UPPER_SNAKE_CASE; writable request param (lower_snake_case) shown where it differs.

### Job

| Field              | Type    | Required | Writable (request param) | Description                         | Example                 |
| ------------------ | ------- | -------- | ------------------------ | ----------------------------------- | ----------------------- |
| `ID`               | integer | yes      | no                       | Job number                          | `52`                    |
| `JOB_NAME`         | string  | no       | yes (`job_name`)         | Internal job/booking name           | `"Main Stage"`          |
| `COMPANY`          | string  | no       | yes (`company`)          | Customer company name               | `"Acme Events Ltd"`     |
| `NAME`             | string  | yes      | yes (`name`)             | Customer contact name               | `"Jane Smith"`          |
| `CLIENT_ID`        | integer | no       | yes (`client_id`)        | Address-book client ref             | `1023`                  |
| `OUT_DATE`         | string  | yes      | yes (`out`)              | Reservation/out datetime            | `"2026-06-10 08:00:00"` |
| `JOB_DATE`         | string  | yes      | yes (`start`)            | Charging start datetime             | `"2026-06-11 00:00:00"` |
| `JOB_END`          | string  | no       | yes (`end`)              | Charging end datetime               | `"2026-06-14 00:00:00"` |
| `RETURN_DATE`      | string  | no       | yes (`to`)               | Return datetime                     | `"2026-06-15 17:00:00"` |
| `STATUS`           | number  | yes      | via `status_save.php`    | Job status (numeric — see enums)    | `2`                     |
| `DEPOT_ID`         | integer | no       | yes (`depot`)            | Owning depot                        | `1`                     |
| `DEPOT`            | string  | no       | no                       | Depot display name                  | `"Main Depot"`          |
| `COLOUR`           | string  | no       | no                       | Status colour (hex, derived)        | `"#3399ff"`             |
| `LOCKED`           | integer | no       | no                       | 1=locked (not editable), 0=editable | `0`                     |
| `CURRENCY`         | object  | yes      | no                       | `{CODE,SYMBOL,DECIMALS}`            | `{"CODE":"GBP",...}`    |
| `DEFAULT_DISCOUNT` | number  | no       | yes (`default_disc`)     | Default line discount %             | `0`                     |
| `USE_SALES_TAX`    | integer | no       | no                       | Sales-tax vs VAT mode flag          | `0`                     |
| `CUSTOM_FIELDS`    | object  | no       | yes (`custom_fields`)    | Tenant-defined custom fields (JSON) | `{"po":"PO-9981"}`      |

Create — required request params: `name`, `out`, `start`. Edit: `job={id}` + only the fields to change (partial update).

### Line Item / Supply

| Field            | Type    | Description                                                            | Example        |
| ---------------- | ------- | ---------------------------------------------------------------------- | -------------- |
| `ID`             | integer | Line item ID                                                           | `9001`         |
| `kind`           | integer | 0=heading,1=sales,2=hire,3=custom,4=labour,5=inline,6=calculated       | `2`            |
| `title`          | string  | Item title                                                             | `"LED Par 64"` |
| `qty`            | number  | Quantity                                                               | `4`            |
| `UNIT_PRICE`     | number  | Per-unit price (base ccy)                                              | `15.00`        |
| `PRICE`          | number  | Line price                                                             | `180.00`       |
| `PRICE_TYPE`     | integer | 0=one-off,1=hourly,2=daily,3=weekly,4=monthly,5=every day,6=every week | `3`            |
| `VAT_RATE`       | number  | Tax rate %                                                             | `20`           |
| `OUTGOING_DATE`  | string  | Out date `YYYY-MM-DD`                                                  | `"2026-06-10"` |
| `RETURNING_DATE` | string  | Return date `YYYY-MM-DD`                                               | `"2026-06-15"` |
| `parent`         | integer | Parent line ID (nesting)                                               | `null`         |
| `LFT`/`RGT`      | integer | Nested-set tree bounds                                                 | `1`/`2`        |

Write map (on job save): `items` request param = `{"<prefix><productId>":<qty>}` where `a`=sales, `b`=hire, `c`=labour — e.g. `{"b123":4,"a12":3.5,"c34":2.2}`. Referenced products must already exist.

### Depot

`ID` (integer), `DEPOT` (name string), `VIRTUAL` (boolean).

**Relationships:** Job N:1 Client (`CLIENT_ID`), Job N:1 Depot (`DEPOT_ID`), Job 1:N LineItem (`items` write / supplying-list read), Job 1:N Attachment, Job → Invoice (dispatched job auto-converts), Job N:1 User (manager). See `01a`.

## Pagination

Page-number: `page` (1-based) + `rows` (page size) on list endpoints. Default size varies per endpoint. Max varies (`jobs_totals.php` caps at 50 jobs). Total-count field likely exists but not consistently documented — needs discovery [INFERRED].

| Parameter | Type    | Default           | Description                          |
| --------- | ------- | ----------------- | ------------------------------------ |
| `page`    | integer | 1                 | 1-based page number                  |
| `rows`    | integer | endpoint-specific | Page size (endpoint-specific limits) |

Example: `GET /php_functions/get_contacts.php?page=1&rows=50` then `?page=2&rows=50`. Last page: returned rows < requested `rows` (no explicit "total" field) [INFERRED].

## Rate Limits

60 requests / 60 s AND 3 requests / 1 s, both per token/user. Headers: `X-Request-Count` (requests in the current 60 s window); `X-RateLimit-Available` (**Unix timestamp** of when the next request is allowed — NOT a remaining count). Exceeded → HTTP **429** + HireHop error **327** ("Security warning, too many transactions"). Strategy: proactively throttle to ≤3/s and ≤60/min; on 429 back off and retry after the window (`X-RateLimit-Available` timestamp).

## Error Handling

Numeric `error` code in the body, authoritative even on a 2xx — always inspect `error`. `{"error":327}`.

| Status  | HireHop code | Meaning                         | Retryable | Recovery                                                       |
| ------- | ------------ | ------------------------------- | --------- | -------------------------------------------------------------- |
| 200     | `error` set  | Application-level error in body | Depends   | Read `error` (3=missing params); fix request                   |
| 401/403 | —            | Invalid/expired token           | No        | Token invalidated (user re-login or pw change) → regenerate    |
| 404     | —            | Wrong host/path                 | No        | Use tenant `base_url`, not `www.hirehop.com`; check the path   |
| 429     | 327          | Rate limit exceeded             | Yes       | Back off; respect 60/min + 3/s; honour `X-RateLimit-Available` |
| 5xx     | —            | Server error                    | Yes       | Exponential backoff (max ~3)                                   |

Full numeric table unpublished; only `3` (missing params) and `327` (rate limit) widely documented. Treat unknown `error` values as non-retryable and surface them [INFERRED]. See `01d` for the full reference.

## Webhooks / Events

First-class but **setup is UI-only** — Settings → Company Settings → Webhooks → New → enter URL + tick events. No API to manage subscriptions.

| Event                    | Trigger                | Confidence                                 |
| ------------------------ | ---------------------- | ------------------------------------------ |
| `invoice.status.updated` | Invoice status changes | [DOCUMENTED]                               |
| `job.status.*`           | Job status changes     | [INFERRED — full event list not published] |

Payload: `{"time":"2022-03-29 07:50:42","user_id":1,"user_name":"John Smith","user_email":"john@email.com","company_id":1,"export_key":"22u43mrjwe7u","event":"invoice.status.updated","data":{},"changes":{"FIELD_NAME":{"from":"old","to":"new"}}}`.
Verification: body `export_key` must equal the export key in the customer's company settings — **no HMAC signature**, the `export_key` is the only authenticity check. Reliability: fire-and-forget — does NOT wait for a response, report HTTP errors from the target, or retry. Reconcile missed events by polling (no "modified-since" filter — coarse). See `01d`.

## Known Limitations

1. **Not live-tested** — every body is a documented shape; validate on first real call [INFERRED].
2. **Job status integers not published** — discover the numeric→label map per tenant before trusting status writes [INFERRED — NEEDS DISCOVERY].
3. **`job_data`/`job_refresh` exclude line items** — metadata only; supplying-list read path unverified [INFERRED].
4. **No uniform filter/sort grammar** — each `.php` endpoint defines its own named params; no `?filter[x]=`, no field selection; jobs don't embed line items (separate calls) [INFERRED].
5. **Webhook subscriptions UI-only**, delivery fire-and-forget with no retry.
6. **Full webhook event list and full error-code table not published.**
7. **No async export API** — PDF document generation exists in the product but is not a documented JSON export endpoint [INFERRED].
8. **No official SDK** (Python or Node).
9. **`/api/sql_execute.php` (raw SQL) deprecated and unsafe** — never expose to the agent.

## SDKs & Tooling

No official Python/Node SDK. The **HireHop Webshop** WordPress plugin (PHP, https://en-gb.wordpress.org/plugins/hirehop-webshop/) is the de-facto reference — best real-world request/response examples (reference only). Postman collection: not available [UNKNOWN]. OpenAPI spec: none.

## Integration Path Assessment

**Recommended: Direct API via `connect_request`** (API-key connector). HireHop exposes structured, action-oriented rental operations (read/create/edit jobs, change status, check availability, list depots/clients, read margins/totals). There is **no browsable file/document tree** (attachments are job-scoped only), so the Data Connector (Files) path does NOT apply. Matches registry `authType: 'api-key'` — not a file-browser like Drive/OneDrive/Dropbox. The workspace agent calls HireHop directly via the connector's `connect_request`, which injects the stored `api_token` and uses the per-tenant `base_url` to build each request as `{base_url}{path}`.

Files-interface compatibility (for completeness; not applicable): `list_files`/`download_file`/`search_files`/`get_file_metadata` — all None (not a file system; attachments are job-scoped, not a browsable drive).

Source: official HireHop docs (co.za/co.uk mirrors), getting-started guide, webhooks & custom-fields blog posts, HireHop Webshop WordPress plugin, and `00-api-investigation-questionnaire.md`. NOT live-tested.

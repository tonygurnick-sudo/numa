---
api_name: 'HireHop'
api_slug: 'hirehop'
base_url: 'per-tenant credential — e.g. https://myhirehop.com'
version: '1.3'
spec_format: 'none' # no OpenAPI/Swagger — flat HTML reference page
spec_url: 'Not available (HTML reference only)'
docs_url: 'https://www.hirehop.com/api_documentation/'
date_researched: '2026-05-29'
date_live_tested: 'NEVER — no instance, no API token, no public sandbox'
---

# HireHop -- API Specification & Investigation

> Clean developer reference for the HireHop REST API. This document is the condensed
> output of the investigation questionnaire -- everything a developer needs to integrate
> with this API, in one place.
>
> ⚠️ **CONFIDENCE: MEDIUM. Documented, NOT live-tested.** No API token was available during
> investigation. Every endpoint, parameter, and response body below is the **documented** shape
> drawn from HireHop's official docs and web research — verify field-for-field on first real call.
> Confidence tags: `[DOCUMENTED]` (in vendor docs), `[INFERRED]` (deduced), `[UNKNOWN]`.
> Nothing is `[CONFIRMED]` — no live call was made (questionnaire Phase 2.4 gate is unmet).

---

## Overview

- **Vendor:** HireHop Ltd — equipment / event rental management software (UK) [DOCUMENTED]
- **API version:** 1.3 — backward compatible; older shapes selectable via a `version` request param (e.g. `version=1.2`). No version in the path. [DOCUMENTED]
- **Base URL:** **per-tenant `base_url` credential.** HireHop runs the same app on three interchangeable hosts; a customer's account is reachable on any of them (or a vanity domain that proxies to the same backend): [DOCUMENTED]
  - `https://myhirehop.com` (registry placeholder default)
  - `https://hirehop.net`
  - `https://myhirehop.co.uk`
  - **NEVER `https://www.hirehop.com`** — that is the marketing site and returns HTTP 403 to API clients. This is exactly why `base_url` is a credential, not a hard-coded constant. [DOCUMENTED]
- **Sandbox URL:** No dedicated sandbox. A demo document template exists at `myhirehop.com/docs/job_info.html`. [DOCUMENTED]
- **API type:** REST-ish over HTTPS. JSON responses, but endpoints are PHP scripts (`*.php`), not RESTful resource paths. The "API" is a curated, stable subset of the same `php_functions/*.php` endpoints the web UI calls. [DOCUMENTED]
- **Data format:** JSON responses. Requests accept **either** a JSON body, URL-encoded form data, **or** query-string params — HireHop auto-detects which was used. [DOCUMENTED]
- **Field casing:** **Asymmetric.** Response fields are mostly UPPER_SNAKE_CASE (`JOB_NAME`, `OUT_DATE`, `DEPOT_ID`, `CUSTOM_FIELDS`); request params are lower_snake_case (`name`, `out`, `start`, `job_name`, `client_id`). **Request field name ≠ response field name.** [DOCUMENTED]
- **ID format:** Integer everywhere (job `ID`, `DEPOT_ID`, `CLIENT_ID`, user IDs, line-item `ID`). [DOCUMENTED]
- **URL structure:** `{base_url}/php_functions/{action}.php` (most endpoints), `{base_url}/api/{action}.php` (smaller curated REST surface), a few under `{base_url}/frames/`. [DOCUMENTED]
- **Documentation:** [https://www.hirehop.com/api_documentation/](https://www.hirehop.com/api_documentation/) — note `www.hirehop.com` 403s automated fetchers; the identical docs are reachable on the regional mirrors `https://www.hirehop.co.za/api_documentation/` and `https://www.hirehop.co.uk/api_documentation/`. [DOCUMENTED]
- **API reference:** Same page — a flat HTML reference listing `/php_functions/*.php` and `/api/*.php` endpoints with parameters. Not an OpenAPI/Swagger UI. [DOCUMENTED]
- **OpenAPI spec:** None — no machine-readable spec exists. [DOCUMENTED]
- **Status page:** None found. [UNKNOWN]
- **Getting-started guide:** [https://www.hirehop.com/blog/hirehop-rest-api-getting-started-guide/](https://www.hirehop.com/blog/hirehop-rest-api-getting-started-guide/) [DOCUMENTED]
- **Contact:** HireHop support via [hirehop.com](https://www.hirehop.com/) — the API is self-service (token generated in-app), no partner registration required.

**Summary:** HireHop is equipment / event rental management software. The API exposes structured,
action-oriented rental operations: read/create/edit jobs (a "job" = quotation = booking, all the same
record at different statuses), manage a job's supplying list of items, change job status, check equipment
availability over date ranges, list depots and address-book clients, and read costings/margins/billing
totals. There is **no browsable file/document tree** — attachments are job-scoped only — so this is a
Direct-API connector, not a Files connector.

---

## Authentication

### Method: API Key (static per-user token)

Long-lived, opaque, bearer-style secret. **Not OAuth.** Matches the registry entry
`authType: 'api-key'`. The token resolves the customer's HireHop company server-side, so there is
**no account/company ID parameter** — the credential pair (`api_token` + `base_url`) is the entire identity. [DOCUMENTED]

**Header format (preferred):**

```
X-TOKEN: dqwejk5GVT65909bHHBN7922pq5hxjm=-7hmn
Content-Type: application/json          ← only when sending a JSON body
```

The token may be supplied **any one** of four ways. **Prefer the `X-TOKEN` header** — it keeps the
secret out of URLs/access logs and avoids URL-encoding pitfalls: [DOCUMENTED]

1. HTTP header `X-TOKEN: {token}`
2. Query parameter `?token={URL-ENCODED token}` — **must** be URL-encoded (the token contains `=`, `+`, `-`)
3. POST form field `token`
4. JSON body field `"token"`

**For API Key / token auth:**

| Property           | Value                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| How to obtain      | Admin mode → Settings → **Users** tab → select/create a user → **Menu** → **API Token** [DOCUMENTED]                                              |
| Token format       | Opaque base64-ish string containing `=`, `+`, `-` (e.g. `dqwejk5GVT65909bHHBN7922pq5hxjm=-7hmn`)                                                  |
| Token lifetime     | "Never expires" by time — BUT silently invalidated the moment the owning user logs in interactively, or changes their email/password [DOCUMENTED] |
| Scopes/permissions | Inherits the owning user's HireHop role/permissions. Scope the API user's role to what's needed. [DOCUMENTED]                                     |
| Rotation           | Regenerate from the same Users → API Token menu (or change the API user's password to force-invalidate a leaked token). [DOCUMENTED]              |

> **Stability recommendation:** create a dedicated, non-interactive "API" user (one that never logs in
> through the web UI) so the token never gets silently invalidated by a login or password change. Numa
> onboarding should advise customers to do this. [DOCUMENTED]

There is no OAuth flow, no refresh token, and no PKCE — this is a single static secret. See
`04-connection-and-reauth.md` for the full credential-generation and rotation walkthrough.

---

## Response & Error Conventions

- **Success:** plain JSON object or array (no uniform `{result, data}` envelope). Single-resource reads
  return an object (`job_data.php`); list reads return an array (`get_depots.php`). [DOCUMENTED]
- **Application errors:** returned as a JSON object carrying an `error` field (a numeric HireHop error
  code) — and the HTTP status is **not always non-2xx** for application-level errors. **Inspect the body's
  `error` field, not just the HTTP status.** [DOCUMENTED / INFERRED]

```json
{ "error": 327 }
```

Error _messages_ live in HireHop's client-side language files (e.g. `en-US.js`); the body carries the
code. Known codes: **3** = "Missing parameters"; **327** = rate limit / "Security warning, too many
transactions". The full numeric code table is **not published** — treat unknown codes as non-retryable
and surface the code. [DOCUMENTED / INFERRED]

---

## Endpoint Catalog

> All paths are relative to the tenant `base_url`. Methods/purposes per the HTML API-docs page.
> **None are live-verified.** Mark all as `[DOCUMENTED]` from the docs unless noted otherwise.

### Jobs (the central entity)

| Method | Path                               | Purpose                             | Auth | Paginated | Idempotent  |
| ------ | ---------------------------------- | ----------------------------------- | ---- | --------- | ----------- |
| GET    | `/api/job_data.php`                | Get a job's metadata by ID          | Yes  | No        | Yes         |
| GET    | `/php_functions/job_refresh.php`   | Get job metadata (UI alias)         | Yes  | No        | Yes         |
| POST   | `/api/save_job.php`                | Create/edit job + items in one call | Yes  | No        | No (create) |
| POST   | `/php_functions/job_save.php`      | Create/edit job (UI alias)          | Yes  | No        | No (create) |
| POST   | `/frames/status_save.php`          | Change a job's status               | Yes  | No        | Yes         |
| POST   | `/php_functions/job_duplicate.php` | Duplicate a job (param is `id`)     | Yes  | No        | No          |
| GET    | `/php_functions/job_margins.php`   | Job costings / profit               | Yes  | No        | Yes         |
| GET    | `/php_functions/jobs_totals.php`   | Aggregate totals for ≤50 jobs       | Yes  | No\*      | Yes         |

> **Create vs edit:** the same save endpoint handles both. Omit `job` or set `job=0` to create; pass
> `job={id}` to edit. Edits are **partial** — only the params you send are changed. [DOCUMENTED]

### Line Items / Supplying List

| Method | Path                                      | Purpose                                   | Auth | Notes                                      |
| ------ | ----------------------------------------- | ----------------------------------------- | ---- | ------------------------------------------ |
| POST   | `/php_functions/job_save.php`             | Write items via the `items` map (on save) | Yes  | `items` = `{ "<prefix><productId>": qty }` |
| POST   | `/php_functions/items_barcode_save.php`   | Add an item to a job by barcode           | Yes  |                                            |
| GET    | `/php_functions/items_get_multiplier.php` | Price multiplier for an item              | Yes  |                                            |
| POST   | `/php_functions/archive_insert.php`       | Save supplying list to archive            | Yes  | [DOCUMENTED]                               |

> **Reading a job's full line-item list is a known gap.** `job_data.php` / `job_refresh.php` return job
> **metadata only** — the supplying list (line items) is NOT in that response. The read path for the full
> item list is **not cleanly documented** and must be discovered against a live instance. [DOCUMENTED / INFERRED]

### Availability & Stock

| Method | Path                                            | Purpose                                      | Auth | Confidence                                             |
| ------ | ----------------------------------------------- | -------------------------------------------- | ---- | ------------------------------------------------------ |
| POST   | `/php_functions/availability_get_available.php` | Day-by-day product availability over a range | Yes  | [DOCUMENTED]; exact request/response schema [INFERRED] |
| GET    | `/php_functions/availability_list.php`          | Products for an availability list            | Yes  | [DOCUMENTED]                                           |
| GET    | `/php_functions/picklist_get_availability.php`  | Product availability for a job's picklist    | Yes  | [DOCUMENTED]                                           |
| GET    | `/php_functions/availability_jobs_list.php`     | Jobs using a rental product within a year    | Yes  | [DOCUMENTED]                                           |
| GET    | `/php_functions/sales_list.php`                 | Jobs using a labour/rental product           | Yes  | [DOCUMENTED]                                           |
| GET    | `/php_functions/items_available.php`            | Item availability (**deprecated**)           | Yes  | [DOCUMENTED]                                           |

### Clients / Contacts (address book)

| Method | Path                                     | Purpose                            | Auth | Paginated | Confidence   |
| ------ | ---------------------------------------- | ---------------------------------- | ---- | --------- | ------------ |
| GET    | `/php_functions/get_contacts.php`        | List address-book contacts/clients | Yes  | Yes       | [DOCUMENTED] |
| POST   | `/php_functions/contact_save.php`        | Create/edit a contact/client       | Yes  | No        | [DOCUMENTED] |
| POST   | `/php_functions/contact_prices_save.php` | Save per-client price overrides    | Yes  | No        | [DOCUMENTED] |

> **Endpoint-name correction:** the live endpoints are `get_contacts.php` (read) and `contact_save.php`
> (write). Earlier draft material referenced `list_contacts.php` / `save_contact.php` — those are the
> wrong names. Use `get_contacts.php` / `contact_save.php`. [DOCUMENTED — see 01-llm-api-rules.md gotcha #8]

### Reference Data (depots, categories, custom fields, user)

| Method | Path                                           | Purpose                              | Auth | Confidence   |
| ------ | ---------------------------------------------- | ------------------------------------ | ---- | ------------ |
| GET    | `/php_functions/get_depots.php`                | List depots (no params)              | Yes  | [DOCUMENTED] |
| GET    | `/php_functions/get_user_info.php`             | Current user (token owner) info      | Yes  | [DOCUMENTED] |
| GET    | `/php_functions/categories_list.php`           | List catalogue categories            | Yes  | [DOCUMENTED] |
| POST   | `/php_functions/categories_save.php`           | Create/edit a category               | Yes  | [DOCUMENTED] |
| POST   | `/php_functions/categories_move.php`           | Move categories                      | Yes  | [DOCUMENTED] |
| POST   | `/php_functions/categories_delete.php`         | Delete **empty** categories          | Yes  | [DOCUMENTED] |
| GET    | `/php_functions/custom_fields_global_load.php` | Load global custom-field definitions | Yes  | [DOCUMENTED] |
| POST   | `/php_functions/custom_fields_global_save.php` | Save global custom-field definitions | Yes  | [DOCUMENTED] |

### Attachments (job-scoped files)

| Method | Path                                     | Purpose                       | Auth | Confidence                          |
| ------ | ---------------------------------------- | ----------------------------- | ---- | ----------------------------------- |
| GET    | `/php_functions/attach_list.php`         | List job attachments          | Yes  | [DOCUMENTED]                        |
| POST   | `/php_functions/attach_files_upload.php` | Upload attachment (multipart) | Yes  | [DOCUMENTED] / multipart [INFERRED] |
| POST   | `/php_functions/attach_delete.php`       | Delete attachment             | Yes  | [DOCUMENTED]                        |

### Do NOT Use

| Method | Path                   | Why                                                                                           |
| ------ | ---------------------- | --------------------------------------------------------------------------------------------- |
| POST   | `/api/sql_execute.php` | Runs raw SQL `SELECT`. **Deprecated and dangerous** — never expose to the agent. [DOCUMENTED] |

---

## Data Models

> Full entity reference is in `01a-domain-model-reference.md`. Response fields are UPPER_SNAKE_CASE;
> the writable request param name (lower_snake_case) is shown in the "Writable" column where it differs.

### Job

| Field              | Type    | Required | Writable (request param) | Description                                 | Example                 |
| ------------------ | ------- | -------- | ------------------------ | ------------------------------------------- | ----------------------- |
| `ID`               | integer | yes      | no                       | Job number                                  | `52`                    |
| `JOB_NAME`         | string  | no       | yes (`job_name`)         | Internal job/booking name                   | `"Main Stage"`          |
| `COMPANY`          | string  | no       | yes (`company`)          | Customer company name                       | `"Acme Events Ltd"`     |
| `NAME`             | string  | yes      | yes (`name`)             | Customer contact name                       | `"Jane Smith"`          |
| `CLIENT_ID`        | integer | no       | yes (`client_id`)        | Address-book client reference               | `1023`                  |
| `OUT_DATE`         | string  | yes      | yes (`out`)              | Reservation/out datetime                    | `"2026-06-10 08:00:00"` |
| `JOB_DATE`         | string  | yes      | yes (`start`)            | Charging start datetime                     | `"2026-06-11 00:00:00"` |
| `JOB_END`          | string  | no       | yes (`end`)              | Charging end datetime                       | `"2026-06-14 00:00:00"` |
| `RETURN_DATE`      | string  | no       | yes (`to`)               | Return datetime                             | `"2026-06-15 17:00:00"` |
| `STATUS`           | number  | yes      | via `status_save.php`    | Job status (numeric — see enums below)      | `2`                     |
| `DEPOT_ID`         | integer | no       | yes (`depot`)            | Owning depot                                | `1`                     |
| `DEPOT`            | string  | no       | no                       | Depot display name                          | `"Main Depot"`          |
| `COLOUR`           | string  | no       | no                       | Status colour (hex, derived from status)    | `"#3399ff"`             |
| `LOCKED`           | integer | no       | no                       | `1` = locked (not editable), `0` = editable | `0`                     |
| `CURRENCY`         | object  | yes      | no                       | `{CODE, SYMBOL, DECIMALS}`                  | `{"CODE":"GBP",...}`    |
| `DEFAULT_DISCOUNT` | number  | no       | yes (`default_disc`)     | Default line discount %                     | `0`                     |
| `USE_SALES_TAX`    | integer | no       | no                       | Sales-tax vs VAT mode flag                  | `0`                     |
| `CUSTOM_FIELDS`    | object  | no       | yes (`custom_fields`)    | Tenant-defined custom fields (JSON object)  | `{"po":"PO-9981"}`      |

**Create — required request params:** `name`, `out`, `start`. **Edit:** `job={id}` + only the fields to
change (partial update). [DOCUMENTED]

### Line Item / Supply

| Field            | Type    | Description                                                                                | Example        |
| ---------------- | ------- | ------------------------------------------------------------------------------------------ | -------------- |
| `ID`             | integer | Line item ID                                                                               | `9001`         |
| `kind`           | integer | `0`=heading, `1`=sales, `2`=hire, `3`=custom, `4`=labour, `5`=inline, `6`=calculated       | `2`            |
| `title`          | string  | Item title                                                                                 | `"LED Par 64"` |
| `qty`            | number  | Quantity                                                                                   | `4`            |
| `UNIT_PRICE`     | number  | Per-unit price (base currency)                                                             | `15.00`        |
| `PRICE`          | number  | Line price                                                                                 | `180.00`       |
| `PRICE_TYPE`     | integer | `0`=one-off, `1`=hourly, `2`=daily, `3`=weekly, `4`=monthly, `5`=every day, `6`=every week | `3`            |
| `VAT_RATE`       | number  | Tax rate %                                                                                 | `20`           |
| `OUTGOING_DATE`  | string  | Out date `YYYY-MM-DD`                                                                      | `"2026-06-10"` |
| `RETURNING_DATE` | string  | Return date `YYYY-MM-DD`                                                                   | `"2026-06-15"` |
| `parent`         | integer | Parent line ID (nesting)                                                                   | `null`         |
| `LFT` / `RGT`    | integer | Nested-set tree bounds                                                                     | `1` / `2`      |

**Write map (on job save):** the `items` request param is `{ "<prefix><productId>": <qty> }` where
prefix `a`=sales, `b`=hire, `c`=labour — e.g. `{"b123":4, "a12":3.5, "c34":2.2}`. Referenced products
must already exist. [DOCUMENTED]

### Depot

`ID` (integer), `DEPOT` (name string), `VIRTUAL` (boolean). [DOCUMENTED]

**Relationships:** `Job` N:1 `Client` (`CLIENT_ID`), `Job` N:1 `Depot` (`DEPOT_ID`), `Job` 1:N `LineItem`
(`items` write map / supplying-list read), `Job` 1:N `Attachment`, `Job` → `Invoice` (a dispatched job
auto-converts to an invoice), `Job` N:1 `User` (manager). See `01a-domain-model-reference.md`.

---

## Pagination

- **Type:** page-number — `page` (1-based) + `rows` (page size) on list endpoints. [DOCUMENTED]
- **Default page size:** varies per endpoint; not uniformly documented. [DOCUMENTED]
- **Max page size:** varies per endpoint (e.g. `jobs_totals.php` caps at 50 jobs). [DOCUMENTED]
- **Total count:** not consistently documented — likely a total/`rows` field in list responses; needs discovery. [INFERRED]

**Parameters:**

| Parameter | Type    | Default           | Description                          |
| --------- | ------- | ----------------- | ------------------------------------ |
| `page`    | integer | 1                 | 1-based page number                  |
| `rows`    | integer | endpoint-specific | Page size (endpoint-specific limits) |

**Worked example:**

```http
GET /php_functions/get_contacts.php?page=1&rows=50 HTTP/1.1
Host: myhirehop.com
X-TOKEN: dqwejk5...=-7hmn
```

```http
GET /php_functions/get_contacts.php?page=2&rows=50 HTTP/1.1
Host: myhirehop.com
X-TOKEN: dqwejk5...=-7hmn
```

**Last-page detection:** returned rows < requested `rows`. An explicit "total" field is not consistently
documented — needs discovery. [INFERRED]

---

## Rate Limits

| Scope    | Limit       | Window   |
| -------- | ----------- | -------- |
| Per user | 60 requests | 1 minute |
| Per user | 3 requests  | 1 second |

Both limits apply per token/user. [DOCUMENTED]

**Headers:**

| Header                  | Meaning                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `X-Request-Count`       | Requests made in the current 60-second window                                               |
| `X-RateLimit-Available` | **Unix timestamp** of when the next request is allowed — NOT a remaining count [DOCUMENTED] |

**When exceeded:** HTTP **429** with HireHop error **327** ("Security warning, too many transactions"). [DOCUMENTED]

**Recommended strategy:** proactively throttle to ≤3/sec and ≤60/min. On 429, back off and retry after
the window (`X-RateLimit-Available` timestamp). Watch out — `X-RateLimit-Available` is a timestamp, not a
remaining-request count.

---

## Error Handling

**Standard error format** — a JSON object with a numeric `error` code. The body code is authoritative even
when the HTTP status is otherwise 2xx — always inspect `error`. [DOCUMENTED]

```json
{ "error": 327 }
```

**Status codes:**

| Status  | HireHop code | Meaning                         | Retryable | Recovery                                                         |
| ------- | ------------ | ------------------------------- | --------- | ---------------------------------------------------------------- |
| 200     | `error` set  | Application-level error in body | Depends   | Read `error` (3 = missing params); fix the request               |
| 401/403 | —            | Invalid/expired token           | No        | Token invalidated (user re-login or pw change) → regenerate      |
| 404     | —            | Wrong host/path                 | No        | Use the tenant `base_url`, not `www.hirehop.com`; check the path |
| 429     | 327          | Rate limit exceeded             | Yes       | Back off; respect 60/min + 3/sec; honour `X-RateLimit-Available` |
| 5xx     | —            | Server error                    | Yes       | Retry with exponential backoff (max ~3)                          |

> The complete HireHop numeric error-code table is not published; only `3` (missing params) and `327`
> (rate limit) are widely documented. Treat unknown `error` values as non-retryable and surface the code. [DOCUMENTED / INFERRED]

See `01d-event-and-error-handling.md` for the full error/recovery reference.

---

## Webhooks / Events

**Supported** (first-class), but **setup is UI-only** — Settings → **Company Settings** tab → **Webhooks**
button → **New** → enter target URL and tick the events to subscribe to. There is **no API to manage
webhook subscriptions.** [DOCUMENTED]

| Event                    | Trigger                | Confidence                                    |
| ------------------------ | ---------------------- | --------------------------------------------- |
| `invoice.status.updated` | Invoice status changes | [DOCUMENTED]                                  |
| `job.status.*`           | Job status changes     | [INFERRED — full event list is not published] |

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
  "changes": { "FIELD_NAME": { "from": "old", "to": "new" } }
}
```

**Verification:** verify the body `export_key` equals the export key in the customer's company settings.
**There is no HMAC signature** — the `export_key` is the only authenticity check. [DOCUMENTED]

**Reliability:** fire-and-forget — HireHop does NOT wait for a response, does NOT report HTTP errors from
the target, and does NOT retry. Reconcile missed events by polling (re-read on demand; there is no
"modified-since" filter, so polling is coarse). [DOCUMENTED]

---

## Known Limitations

1. **Not live-tested** — every request/response body is a documented shape, not a verified capture. Validate on first real call. [INFERRED]
2. **Job status integer values are not published** — the numeric→label map for `STATUS` / `status_save.php` must be discovered per tenant before status writes can be trusted. [INFERRED — NEEDS DISCOVERY]
3. **`job_data` / `job_refresh` exclude line items** — they return metadata only; the supplying-list read path is unverified. [DOCUMENTED / INFERRED]
4. **No uniform filter/sort grammar** — each `.php` endpoint defines its own named params; there is no `?filter[x]=` syntax, no field selection, and jobs do not embed line items (separate calls needed). [DOCUMENTED / INFERRED]
5. **Webhook subscriptions are UI-only**, and webhook delivery is fire-and-forget with no retry. [DOCUMENTED]
6. **Full webhook event list and full error-code table are not published.** [DOCUMENTED]
7. **No async export API.** PDF document generation exists in the product but is not a documented JSON export endpoint. [INFERRED]
8. **No official SDK** — Python or Node. [DOCUMENTED]
9. **`/api/sql_execute.php` (raw SQL) is deprecated and unsafe** — must never be exposed to the agent. [DOCUMENTED]

---

## SDKs & Tooling

| SDK             | Language | Repository                                           | Quality          | Notes                                                                                 |
| --------------- | -------- | ---------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| (none official) | —        | —                                                    | —                | No official Python/Node SDK                                                           |
| HireHop Webshop | PHP      | https://en-gb.wordpress.org/plugins/hirehop-webshop/ | Good (reference) | Official WordPress plugin — best real-world request/response examples; reference only |

**Postman collection:** Not available. [UNKNOWN]
**OpenAPI spec:** Not available — flat HTML reference only. [DOCUMENTED]

---

## Integration Path Assessment

**Recommended path:** **Direct API via `connect_request`** (API-key connector).

**Justification:** HireHop exposes structured, action-oriented rental operations — read/create/edit jobs,
change status, check availability, list depots/clients, read margins/totals. There is **no browsable
file/document tree** (attachments are job-scoped only), so the Data Connector (Files) path does not apply.
This matches the registry entry exactly: `authType: 'api-key'`, NOT a file-browser like
Drive/OneDrive/Dropbox. The workspace agent calls HireHop directly through the connector's
`connect_request` mechanism, which injects the stored `api_token` and uses the per-tenant `base_url` to
build each request as `{base_url}{path}`.

**Connector compatibility (Files interface — for completeness; not applicable here):**

| Connector Method  | API Endpoint | Feasibility                                              |
| ----------------- | ------------ | -------------------------------------------------------- |
| list_files        | —            | None — not a file system; structured rental records      |
| download_file     | —            | None — attachments are job-scoped, not a browsable drive |
| search_files      | —            | None                                                     |
| get_file_metadata | —            | None                                                     |

---

_Researched on 2026-05-29. **NOT live-tested.**_
_Source: official HireHop docs (co.za/co.uk mirrors), getting-started guide, webhooks & custom-fields blog posts, HireHop Webshop WordPress plugin, and the investigation questionnaire (`00-api-investigation-questionnaire.md`)._

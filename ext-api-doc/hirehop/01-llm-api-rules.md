---
api_name: HireHop
api_slug: hirehop
base_url: per-tenant credential (e.g. https://myhirehop.com | https://hirehop.net | https://myhirehop.co.uk | vanity domain). NEVER www.hirehop.com (marketing site, 403s API clients)
path_construction: '{base_url}{path}' — path includes the .php script, e.g. {base_url}/api/job_data.php
path_prefixes: /php_functions/{action}.php (most), /api/{action}.php (small curated set), /frames/{action}.php (a few)
path_version_segment: none — "v1.3" is a request param label only, never a path segment. /v1/... → 404
version_param: optional `version=1.2` request param for older response shapes; omit for latest (1.3)
auth: API key (static per-user token). Prefer header `X-TOKEN: {token}`. NOT OAuth. No account/company id param — token+base_url = identity
field_casing: ASYMMETRIC — response fields UPPER_SNAKE_CASE (JOB_NAME, OUT_DATE, DEPOT_ID); request params lower_snake_case (name, out, start, job_name). Request name ≠ response name
id_format: integer (job ID, DEPOT_ID, CLIENT_ID, user, line-item ID)
rate_limit: 60 req/60s AND 3 req/s per user/token. Exceed → HTTP 429 + body {"error":327}
call_surface: HTTP via `numa integrations request`. NOT a file-store; no list-files/download-file. Attachments are job-scoped only (not a browsable drive)
confidence: MEDIUM — documented from HireHop official docs (co.za/co.uk mirrors) 2026-05-29, NOT live-tested. Every fact is [DOCUMENTED] unless tagged [INFERRED]/[UNKNOWN]. Verify request/response bodies field-for-field on first real call
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# HireHop — API Rules

Equipment / event rental management. Endpoints are PHP scripts (`*.php`), not REST resource paths. Methods: GET (reads), POST (writes). No PUT/PATCH/DELETE verbs.

## Paths (read first)

- Build every call as `{base_url}{path}` where path includes the `.php` script. e.g. `{base_url}/api/job_data.php?job=52`.
- NO version path segment. "v1.3" is a label; older shapes via the optional `version=1.2` request param. `/v1/...` → 404.
- Use the tenant `base_url`, NEVER `www.hirehop.com` (marketing host, 403s API clients).

## Auth

Static per-user token. Prefer header `X-TOKEN: {token}` (keeps secret out of URLs/logs, avoids URL-encoding bugs). Add `Content-Type: application/json` only when sending a JSON body.
Fallbacks (any one): query `?token={URL-ENCODED}` (token contains `=`,`+`,`-` → MUST URL-encode), POST form field `token`, JSON body field `"token"`.
Token never expires by time BUT is silently invalidated when the owning user logs in interactively or changes email/password → next call 401/403. Advise the customer to dedicate a non-interactive "API" user. Token inherits that user's permissions.

## CAN

Read job metadata (`job_data.php`/`job_refresh.php`) and costings/totals (`job_margins.php`, `jobs_totals.php`). Create/edit jobs + supplying-list items in one call (`save_job.php`/`job_save.php`, `items` map). Change status (`status_save.php`), duplicate (`job_duplicate.php`). Check availability over date ranges (`availability_get_available.php`, `availability_list.php`, `picklist_get_availability.php`). List depots (`get_depots.php`), categories, contacts/clients (`get_contacts.php`); create/edit contacts (`contact_save.php`). Job attachments: list/upload/delete (`attach_*`). Read global custom-field defs (`custom_fields_global_load.php`); set per-job custom values via `custom_fields` on save. Read token owner (`get_user_info.php`).

## CANNOT

Run raw SQL (`/api/sql_execute.php` — deprecated/unsafe; NEVER use). Manage webhook subscriptions via API (UI-only). Hard-delete a job (cancellation is a status) [INFERRED]. Edit a `LOCKED` job (refuse the write). Read a job's full line-item list from `job_data` (metadata only — separate read path; unverified) [INFERRED]. Trust exact status integers (numeric→label map unpublished; discover per tenant) [INFERRED].

## Gotchas

1. Use the tenant `base_url`, never `www.hirehop.com` (403s API clients).
2. URL-encode the token if placed in a query string (`=`,`+`,`-`). Prefer `X-TOKEN` to avoid this.
3. Inspect the body `error` field, NOT just HTTP status — application errors return `{"error":<code>}` and may arrive on an otherwise-2xx response.
4. Save is PARTIAL-update: `save_job.php`/`job_save.php` change ONLY the params you send (sending only `custom_fields` updates only those). Create a job with `job=0` or omit `job`.
5. Datetimes are `YYYY-MM-DD hh:mm:ss` with a SPACE, not `T`. System dates UTC; user-entered dates in the depot's timezone.
6. Currency is always base currency in/out — do NOT convert; HireHop applies display conversion itself.
7. `X-RateLimit-Available` is a Unix timestamp (when the next request is allowed), NOT a remaining count. `X-Request-Count` = requests in the last 60 s.
8. Contacts endpoints are `get_contacts.php` (read) / `contact_save.php` (write) — NOT `list_contacts`/`save_contact`.
9. `items` write map keys are `<prefix><productId>`: `a`=sales, `b`=hire, `c`=labour; value = quantity. e.g. `{"b123":4,"a12":3.5,"c34":2.2}`. Referenced products must exist.
10. Param name for the job ID differs per endpoint: `job` (job_data, status_save, save_job), `job_id` (job_margins), `id` (job_duplicate), `jobs` (jobs_totals). Array-param encoding (e.g. `jobs[]=`) unverified [INFERRED].
11. Create is NOT idempotent: `job=0` always inserts; re-POSTing makes a duplicate. Store the returned `ID`.

## Defaults (override only if the user specifies)

token via `X-TOKEN` header · `version` omit (latest 1.3) · `rows=50` · throttle ≤3/s and ≤60/min.

## Operations

All paths relative to tenant `base_url`. See 01b/01c for full params.

| Operation               | Method | Path                                          | Key params / notes                                            |
| ----------------------- | ------ | --------------------------------------------- | ------------------------------------------------------------- |
| Get job                 | GET    | /api/job_data.php                             | `job`; metadata only, NO line items                           |
| Get job (UI alias)      | GET    | /php_functions/job_refresh.php                | `job`; same as job_data                                       |
| Create/edit job         | POST   | /api/save_job.php                             | `job`(0=new), `name`, `out`, `start`, `items`; partial update |
| Create/edit job (alias) | POST   | /php_functions/job_save.php                   | UI alias of save_job; no `items` support                      |
| Change status           | POST   | /frames/status_save.php                       | `job`, `status`(numeric), `no_webhook`                        |
| Duplicate job           | POST   | /php_functions/job_duplicate.php              | `id`(not `job`), `notes`, `tasks`, `supplying`, `update`      |
| Job margins             | GET    | /php_functions/job_margins.php                | `job_id` OR `project_id`; costings/profit                     |
| Jobs totals             | GET    | /php_functions/jobs_totals.php                | `jobs` (array of IDs, ≤50); aggregate totals                  |
| Availability (range)    | POST   | /php_functions/availability_get_available.php | `depot`, `rows`(product IDs), `local`, `tz`                   |
| Availability list       | GET    | /php_functions/availability_list.php          | `head`, `cats`, `date`, `date_range`, `depots`                |
| Picklist availability   | GET    | /php_functions/picklist_get_availability.php  | `job`, `rows`, `local`, `tz`                                  |
| List contacts           | GET    | /php_functions/get_contacts.php               | `page`, `rows`, search params; paginated                      |
| Create/edit contact     | POST   | /php_functions/contact_save.php               | contact fields, `custom_fields`                               |
| List depots             | GET    | /php_functions/get_depots.php                 | none; returns `ID`, `DEPOT`                                   |
| Current user            | GET    | /php_functions/get_user_info.php              | none; token owner                                             |
| List categories         | GET    | /php_functions/categories_list.php            | —                                                             |
| List attachments        | GET    | /php_functions/attach_list.php                | `job`                                                         |
| Upload attachment       | POST   | /php_functions/attach_files_upload.php        | `job`, file (multipart)                                       |
| Custom field defs       | GET    | /php_functions/custom_fields_global_load.php  | global definitions                                            |

**Do NOT use:** `POST /api/sql_execute.php` (deprecated, raw SQL, unsafe).

## Pagination

Page-number: `page` (1-based) + `rows` (page size, endpoint-specific limits; `jobs_totals.php` caps at 50 jobs). No uniform default size. Last page = returned rows < requested `rows` (no explicit total/has-more field documented) [INFERRED]. e.g. `?page=1&rows=50` then `&page=2&rows=50`.

## Errors

Body carries a numeric `error` CODE, not a message (messages live in HireHop lang files e.g. `en-US.js`). Inspect `error` even on 2xx. Shape: `{"error":327}`.
Known codes: **3** = "Missing parameters"; **327** = "Security warning, too many transactions" (rate limit). Full table unpublished — treat unknown codes as non-retryable and surface them.
Recovery: 200-with-`error` read code (3=missing params) fix request · 401/403 token invalidated (user re-login or pw change) → regenerate · 404 wrong host/path → use tenant `base_url` not `www.hirehop.com` · 429/327 back off, honor `X-RateLimit-Available` (Unix ts), respect 60/min+3/s (≤3 retries) · 5xx exponential backoff (≤3).

## Examples

Token shown in header form (preferred). Values illustrative; structure documented.

1. Read a job's metadata — `GET /api/job_data.php?job=52` (X-TOKEN header)
   → `{"ID":52,"JOB_NAME":"Summer Festival Main Stage","COMPANY":"Acme Events Ltd","NAME":"Jane Smith","OUT_DATE":"2026-06-10 08:00:00","JOB_DATE":"2026-06-11 00:00:00","JOB_END":"2026-06-14 00:00:00","RETURN_DATE":"2026-06-15 17:00:00","STATUS":2,"DEPOT":"Main Depot","DEPOT_ID":1,"LOCKED":0,"CURRENCY":{"CODE":"GBP","SYMBOL":"£","DECIMALS":2},"CUSTOM_FIELDS":{"po":"PO-9981"}}`
   Line items are NOT in this response — metadata only.

2. Create a job with items — `POST /api/save_job.php` (X-TOKEN, Content-Type: application/json)
   `{"job":0,"name":"Jane Smith","company":"Acme Events Ltd","out":"2026-06-10 08:00:00","start":"2026-06-11 00:00:00","end":"2026-06-14 00:00:00","to":"2026-06-15 17:00:00","job_name":"Summer Festival Main Stage","depot":1,"client_id":1023,"items":{"b123":4,"a12":3.5,"c34":2.2}}`
   → `{"ID":53}`. Required to create: `name`, `out`, `start`. Re-POSTing creates a duplicate (not idempotent).

3. Change job status — `POST /frames/status_save.php`
   `{"job":52,"status":2,"no_webhook":0}`
   → `{"status":2,"colour":"#3399ff"}`. `status` is numeric — the integer→label map is unverified; discover per tenant first.

4. List depots (then map `DEPOT_ID`→name) — `GET /php_functions/get_depots.php`
   → `[{"ID":1,"DEPOT":"Main Depot"},{"ID":2,"DEPOT":"London Hub"}]`

## Webhooks (read-only awareness)

First-class but setup is UI-only (Settings → Company Settings → Webhooks → New → URL + tick events). NO API to manage subscriptions. Known event `invoice.status.updated`; `job.status.*` [INFERRED]; full list unpublished. Payload: `{time,user_id,user_name,user_email,company_id,export_key,event,data,changes}` where `changes.{FIELD}.{from,to}`. Security: verify body `export_key` equals the tenant's export key (NO HMAC). Fire-and-forget: no retry, no delivery confirmation → reconcile by polling (no "modified-since" filter). See 01d.

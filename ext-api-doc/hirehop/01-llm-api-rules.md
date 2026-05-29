---
api_name: 'HireHop'
api_slug: 'hirehop'
version: '1.3'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
update_source: 'official HireHop docs (co.za/co.uk mirrors) + web research — NOT live-tested'
line_count_target: '< 300 lines'
---

# HireHop -- Workspace Agent API Rules

> **This file is loaded into the workspace agent's context when the HireHop integration is active.**
> It must stay under 300 lines. Be precise, not verbose.
> Companion files (01a-01d) contain the detailed reference material.
>
> **Confidence: MEDIUM. Documented, NOT live-tested.** No live token was available during investigation.
> Request/response bodies are the _documented_ shapes — verify field-for-field on first real use.
> Confidence tags: `[DOCUMENTED]` (in vendor docs), `[INFERRED]`, `[UNKNOWN]`. Nothing is `[CONFIRMED]`.

## Context

- **API:** HireHop REST API v1.3 (equipment / event rental management) [DOCUMENTED]
- **Base URL:** **per-tenant `base_url` credential** — `https://myhirehop.com` (default placeholder), `https://hirehop.net`, `https://myhirehop.co.uk`, or a tenant vanity domain. **NEVER `www.hirehop.com`** (marketing site, 403s API clients). [DOCUMENTED]
- **Auth:** API-key connector — static per-user token (credential `api_token`). NOT OAuth. [DOCUMENTED — registry + vendor]
- **Integration path:** Direct API via `connect_request` (action-oriented; no browsable file tree). [DOCUMENTED]
- **Rate limits:** 60 requests / 60 s AND 3 requests / s per user. Exceed → HTTP 429 + error 327. [DOCUMENTED]
- **Field casing:** **Asymmetric.** Responses are mostly UPPER_SNAKE_CASE (`JOB_NAME`, `OUT_DATE`, `DEPOT_ID`); request params are lower_snake_case (`name`, `out`, `start`, `job_name`). Request name ≠ response name. [DOCUMENTED]
- **ID format:** Integer (`job`, `DEPOT_ID`, `CLIENT_ID`, user IDs). [DOCUMENTED]

## Auth Structure

API-key (token) auth. The token resolves the tenant company server-side — there is **no account/company ID param**. The credential `base_url` + `api_token` together identify the customer.

The token may be supplied **any one** of four ways. **Prefer the `X-TOKEN` header** (keeps the secret out of URLs/access logs and avoids URL-encoding bugs):

```
X-TOKEN: dqwejk5GVT65909bHHBN7922pq5hxjm=-7hmn
Content-Type: application/json          # only when sending a JSON body
```

Fallbacks: query `?token={URL-ENCODED}`, POST form field `token`, or JSON body field `"token"`.

**Token lifecycle:**

- Never expires by time, BUT is **silently invalidated** the moment the owning user logs in interactively or changes their email/password → next call 401/403. [DOCUMENTED]
- **Advise the customer to dedicate a non-interactive "API" user** so the token stays stable. Rotate by regenerating from Settings → Users → (user) → Menu → API Token. [DOCUMENTED]
- The token inherits the owning user's HireHop permissions. [DOCUMENTED]

## Capabilities

### CAN

1. Read a job's metadata by ID (`job_data.php`) and its costings/totals (`job_margins.php`, `jobs_totals.php`). [DOCUMENTED]
2. Create and edit jobs/bookings incl. supplying-list items in one call (`save_job.php` / `job_save.php` with the `items` map). [DOCUMENTED]
3. Change a job's status (`status_save.php`) and duplicate a job (`job_duplicate.php`). [DOCUMENTED]
4. Check equipment availability over date ranges (`availability_get_available.php`, `availability_list.php`, `picklist_get_availability.php`). [DOCUMENTED]
5. List depots (`get_depots.php`), categories, contacts/clients (`get_contacts.php`); create/edit contacts (`contact_save.php`). [DOCUMENTED]
6. Manage job attachments — list/upload/delete (`attach_*`). [DOCUMENTED]
7. Read global custom-field defs (`custom_fields_global_load.php`) and set per-job custom values via `custom_fields` on save. [DOCUMENTED]
8. Read the token owner / current user (`get_user_info.php`). [DOCUMENTED]

### CANNOT

1. Run raw SQL (`/api/sql_execute.php`) — deprecated and unsafe; never expose to the agent. [DOCUMENTED]
2. Manage webhook subscriptions via API — webhook setup is UI-only. [DOCUMENTED]
3. Rely on exact job-status integers — the numeric→label map is **not published**; discover per tenant before status writes. [INFERRED]
4. Hard-delete a job — no documented delete; cancellation is a status. [INFERRED]
5. Edit a `LOCKED` job — respect the lock flag and refuse the write. [DOCUMENTED]
6. Read a job's full line-item list from `job_data` — that response is **metadata only**; line items need a separate call (read path needs discovery). [DOCUMENTED / INFERRED]

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Use the tenant `base_url`, never `www.hirehop.com`.** The marketing host 403s API clients. Build every call as `{base_url}{path}`. [DOCUMENTED]
2. **URL-encode the token if you put it in a query string** (it contains `=`, `+`, `-`). The vendor explicitly requires encoding for GET/non-JSON-POST. Prefer the `X-TOKEN` header to sidestep this entirely. [DOCUMENTED]
3. **Inspect the body's `error` field, not just the HTTP status.** Application errors return `{"error": <code>}` and may arrive with an otherwise-2xx status. [DOCUMENTED]
4. **Partial-update semantics on save:** `job_save.php`/`save_job.php` only change the params you send. Sending only `custom_fields` updates _only_ the custom fields; everything else stays. To create a job, set `job=0` or omit it. [DOCUMENTED]
5. **Datetimes are `YYYY-MM-DD hh:mm:ss` with a SPACE, not a `T`.** System dates are UTC; user-entered dates are in the depot's timezone. [DOCUMENTED]
6. **Currency is always base currency** in and out — do not convert; HireHop applies job/invoice display conversion itself. [DOCUMENTED]
7. **`X-RateLimit-Available` is a Unix timestamp** (when the next request is allowed), NOT a remaining-count. `X-Request-Count` is the count in the last 60 s. [DOCUMENTED]
8. **Contacts endpoints are `get_contacts.php` (read) / `contact_save.php` (write)** — not `list_contacts`/`save_contact`. [DOCUMENTED]
9. **`items` write map keys are `<prefix><productId>`**: `a`=sales, `b`=hire, `c`=labour, value = quantity. e.g. `{"b123":4,"a12":3.5,"c34":2.2}`. Referenced products must exist. [DOCUMENTED]

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter | Default           | Reason                                                         |
| --------- | ----------------- | -------------------------------------------------------------- |
| token via | `X-TOKEN` header  | Keeps secret out of URLs/logs; avoids URL-encoding bugs        |
| version   | omit (latest 1.3) | Backward compatible; only pin if a tenant needs an older shape |
| rows      | 50                | Reasonable page size within the rate budget                    |
| throttle  | ≤3/s, ≤60/min     | Hard API limits (err 327 / HTTP 429)                           |

## Working Examples

> Values illustrative; structure documented. Token shown in header form (preferred).

### Example 1: Read a job's metadata

```http
GET /api/job_data.php?job=52 HTTP/1.1
Host: myhirehop.com
X-TOKEN: dqwejk5GVT65909bHHBN7922pq5hxjm=-7hmn
```

```json
{
  "ID": 52,
  "JOB_NAME": "Summer Festival Main Stage",
  "COMPANY": "Acme Events Ltd",
  "NAME": "Jane Smith",
  "OUT_DATE": "2026-06-10 08:00:00",
  "JOB_DATE": "2026-06-11 00:00:00",
  "JOB_END": "2026-06-14 00:00:00",
  "RETURN_DATE": "2026-06-15 17:00:00",
  "STATUS": 2,
  "DEPOT": "Main Depot",
  "DEPOT_ID": 1,
  "LOCKED": 0,
  "CURRENCY": { "CODE": "GBP", "SYMBOL": "£", "DECIMALS": 2 },
  "CUSTOM_FIELDS": { "po": "PO-9981" }
}
```

_Line items are NOT in this response — metadata only._

### Example 2: Create a job with items

```http
POST /api/save_job.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: dqwejk5...=-7hmn
Content-Type: application/json

{
  "job": 0,
  "name": "Jane Smith",
  "company": "Acme Events Ltd",
  "out": "2026-06-10 08:00:00",
  "start": "2026-06-11 00:00:00",
  "end": "2026-06-14 00:00:00",
  "to": "2026-06-15 17:00:00",
  "job_name": "Summer Festival Main Stage",
  "depot": 1,
  "client_id": 1023,
  "items": { "b123": 4, "a12": 3.5, "c34": 2.2 }
}
```

```json
{ "ID": 53 }
```

_Required to create: `name`, `out`, `start`. Re-POSTing creates a duplicate (not idempotent)._

### Example 3: Change job status

```http
POST /frames/status_save.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: dqwejk5...=-7hmn
Content-Type: application/json

{ "job": 52, "status": 2, "no_webhook": 0 }
```

```json
{ "status": 2, "colour": "#3399ff" }
```

_`status` is numeric — the integer→label map is unverified; discover per tenant first._

### Example 4: List depots (then map DEPOT_ID → name)

```http
GET /php_functions/get_depots.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: dqwejk5...=-7hmn
```

```json
[
  { "ID": 1, "DEPOT": "Main Depot" },
  { "ID": 2, "DEPOT": "London Hub" }
]
```

## Proxy API Operations

> Quick reference. All paths relative to the tenant `base_url`. See 01b/01c for full params.

| Operation             | Method | Path                                          | Key Parameters                                 | Notes                         |
| --------------------- | ------ | --------------------------------------------- | ---------------------------------------------- | ----------------------------- |
| Get job               | GET    | /api/job_data.php                             | `job`                                          | Metadata only; no line items  |
| Get job (UI alias)    | GET    | /php_functions/job_refresh.php                | `job`                                          | Same as job_data              |
| Create/edit job       | POST   | /api/save_job.php                             | `job`(0=new), `name`, `out`, `start`, `items`  | Partial update; see 01c       |
| Create/edit job       | POST   | /php_functions/job_save.php                   | (same as save_job, no `items`)                 | UI alias of save_job          |
| Change status         | POST   | /frames/status_save.php                       | `job`, `status`, `no_webhook`                  | Numeric status                |
| Duplicate job         | POST   | /php_functions/job_duplicate.php              | `id`, `notes`, `tasks`, `supplying`, `update`  | Note param is `id`, not `job` |
| Job margins           | GET    | /php_functions/job_margins.php                | `job_id` OR `project_id`                       | Costings / profit             |
| Jobs totals           | GET    | /php_functions/jobs_totals.php                | `jobs` (array of IDs, ≤50)                     | Aggregate totals              |
| Availability (range)  | POST   | /php_functions/availability_get_available.php | `depot`, `rows`, `local`, `tz`                 | Daily availability            |
| Availability list     | GET    | /php_functions/availability_list.php          | `head`, `cats`, `date`, `date_range`, `depots` | Products list                 |
| Picklist availability | GET    | /php_functions/picklist_get_availability.php  | `job`, `rows`, `local`, `tz`                   |                               |
| List contacts         | GET    | /php_functions/get_contacts.php               | `page`, `rows`, search params                  | Paginated                     |
| Create/edit contact   | POST   | /php_functions/contact_save.php               | contact fields, `custom_fields`                |                               |
| List depots           | GET    | /php_functions/get_depots.php                 | (none)                                         | Returns `ID`, `DEPOT`         |
| Current user          | GET    | /php_functions/get_user_info.php              | (none)                                         | Token owner                   |
| List categories       | GET    | /php_functions/categories_list.php            |                                                |                               |
| List attachments      | GET    | /php_functions/attach_list.php                | `job`                                          |                               |
| Upload attachment     | POST   | /php_functions/attach_files_upload.php        | `job`, file (multipart)                        |                               |
| Custom field defs     | GET    | /php_functions/custom_fields_global_load.php  |                                                | Global definitions            |

**Do NOT use:** `POST /api/sql_execute.php` (deprecated, raw SQL, unsafe). [DOCUMENTED]

## Pagination

- **Type:** page-number — `page` (1-based) + `rows` (page size). [DOCUMENTED]
- **Default page size:** varies per endpoint; not uniformly documented.
- **Max page size:** varies per endpoint (e.g. `jobs_totals.php` caps at 50 jobs; list `rows` ~20–500). [DOCUMENTED]
- **How to paginate:**

```http
GET /php_functions/get_contacts.php?page=1&rows=50
GET /php_functions/get_contacts.php?page=2&rows=50
```

- **Last-page detection:** returned rows < requested `rows`. An explicit total field is not consistently documented — needs discovery. [INFERRED]

## Webhooks / Events

**Supported** (first-class), but **setup is UI-only** — Settings → Company Settings → Webhooks → New → enter URL + tick events. No API to manage subscriptions. [DOCUMENTED]

| Event                    | Trigger                | Key Payload Fields                                                  |
| ------------------------ | ---------------------- | ------------------------------------------------------------------- |
| `invoice.status.updated` | Invoice status changes | `event`, `data`, `changes.{FIELD}.{from,to}`                        |
| `job.status.*`           | Job status changes     | (event names per UI checkboxes; full list not published) [INFERRED] |

**Payload:** `{ time, user_id, user_name, user_email, company_id, export_key, event, data, changes }`.
**Security:** verify the body `export_key` equals the export key in company settings. **No HMAC signature.** [DOCUMENTED]
**Reliability:** fire-and-forget — HireHop does NOT wait for a response, report HTTP errors, or retry. Reconcile missed events by polling (re-read on demand; no "modified-since" filter). [DOCUMENTED]

## Error Handling

**Standard error format** — a JSON object with a numeric (or text) `error` code. Error _messages_ live in HireHop language files (e.g. `en-US.js`); the body carries the code. Inspect `error` even on 2xx. [DOCUMENTED]

```json
{ "error": 327 }
```

Known codes: **3** = "Missing parameters"; **327** = rate limit / "Security warning, too many transactions". The full numeric table is not published — treat unknown codes as non-retryable and surface the code/message. [DOCUMENTED / INFERRED]

**Recovery by status:**

| Status  | Meaning               | Action                                                                  |
| ------- | --------------------- | ----------------------------------------------------------------------- |
| 200     | `error` set in body   | Read `error` code (3=missing params); fix request                       |
| 401/403 | Invalid/expired token | Token invalidated (user re-login or pw change) → regenerate             |
| 404     | Wrong host/path       | Use tenant `base_url`, not `www.hirehop.com`; check the path            |
| 429     | Rate limited (327)    | Back off; respect 60/min + 3/s; honor `X-RateLimit-Available` (Unix ts) |
| 5xx     | Server error          | Retry with exponential backoff (max 3)                                  |

## Known Limitations

1. Not live-tested — request/response bodies are documented shapes; verify on first real call. [INFERRED]
2. Job status integer values are not published — `status_save` writes need per-tenant discovery. [INFERRED]
3. `job_data`/`job_refresh` exclude line items; the supplying-list read path is unverified. [DOCUMENTED / INFERRED]
4. No uniform filter/sort grammar — each `.php` endpoint defines its own params. [DOCUMENTED]
5. Webhook subscriptions are UI-only; no fire-and-forget retry. [DOCUMENTED]
6. Full webhook event list and full error-code table are not published. [DOCUMENTED]
7. No official SDK. The HireHop Webshop WordPress plugin (PHP) is the de-facto reference. [DOCUMENTED]

---

_Generated from the investigation questionnaire (2026-05-29) + official HireHop docs. NOT live-tested._
_See companion files for detailed reference:_

- _01a-domain-model-reference.md — Entity catalog, relationships, state machines_
- _01b-query-patterns.md — Filtering, search, pagination examples_
- _01c-mutation-patterns.md — Create, update, status transitions_
- _01d-event-and-error-handling.md — Webhooks, polling, error recovery_

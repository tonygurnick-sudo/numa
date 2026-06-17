---
api_name: HireHop
api_slug: hirehop
doc: domain-model-reference (companion to 01-llm-api-rules.md — on-demand)
call_surface: HTTP via `numa integrations request`; path = {base_url}{path} incl. .php script
field_casing: responses UPPER_SNAKE_CASE; write params lower_snake_case (listed separately because they differ)
confidence: MEDIUM — documented, NOT live-tested. Every fact [DOCUMENTED] unless tagged [INFERRED]/[UNKNOWN]
---

# HireHop — Domain Model Reference

Full entity catalog, relationships, state machines, business rules.

## Entity Catalog

### Job (booking / quotation)

**Paths:** read `/api/job_data.php`, `/php_functions/job_refresh.php`; write `/api/save_job.php`, `/php_functions/job_save.php`; status `/frames/status_save.php`; duplicate `/php_functions/job_duplicate.php`.
Central entity — a rental booking for a customer over a date range, at a depot, with status, financials, and a supplying list of items. "Quotation / booking / job" = same record at different statuses.
**CRUD:** Create (`job=0`/omit), Read (metadata only), Update (partial), Duplicate, Status-change. No hard delete (cancellation is a status).

**Response fields (UPPER_SNAKE_CASE):**

| Field            | Type    | Writable (write param) | Description                                   | Example                 |
| ---------------- | ------- | ---------------------- | --------------------------------------------- | ----------------------- |
| ID               | integer | no                     | Job number                                    | `52`                    |
| JOB_NAME         | string  | yes (`job_name`)       | Internal job/booking name                     | `"Main Stage"`          |
| COMPANY          | string  | yes (`company`)        | Customer company name                         | `"Acme Events Ltd"`     |
| NAME             | string  | yes (`name`)           | Customer contact name (**req. on create**)    | `"Jane Smith"`          |
| CLIENT_ID        | integer | yes (`client_id`)      | Address-book company/client ref               | `1023`                  |
| OUT_DATE         | string  | yes (`out`)            | Reservation/out datetime (**req. on create**) | `"2026-06-10 08:00:00"` |
| JOB_DATE         | string  | yes (`start`)          | Charging start datetime (**req. on create**)  | `"2026-06-11 00:00:00"` |
| JOB_END          | string  | yes (`end`)            | Charging end datetime                         | `"2026-06-14 00:00:00"` |
| RETURN_DATE      | string  | yes (`to`)             | Return datetime                               | `"2026-06-15 17:00:00"` |
| STATUS           | number  | via `status_save`      | Job status (numeric — see Enums)              | `2`                     |
| DEPOT_ID         | integer | yes (`depot`)          | Owning depot                                  | `1`                     |
| DEPOT            | string  | no                     | Depot display name                            | `"Main Depot"`          |
| COLOUR           | string  | no                     | Status colour (hex, derived from status)      | `"#3399ff"`             |
| LOCKED           | integer | no                     | 1=locked (refuse writes), 0=editable          | `0`                     |
| CURRENCY         | object  | no                     | `{CODE,SYMBOL,DECIMALS}`                      | `{"CODE":"GBP",...}`    |
| DEFAULT_DISCOUNT | number  | yes (`default_disc`)   | Default line discount %                       | `0`                     |
| USE_SALES_TAX    | integer | no                     | Sales-tax vs VAT mode flag                    | `0`                     |
| CUSTOM_FIELDS    | object  | yes (`custom_fields`)  | Tenant-defined custom fields (JSON)           | `{"po":"PO-9981"}`      |

**Write-only params** (no response mirror): `address`, `telephone`, `email`, `mobile`, `type`, `details`, `client_ref`, `duration_days`, `duration_hrs`, `duration_locked`, `venue`, `venue_address`, `venue_id`, `venue_telephone`, `deliver` (0=return,1=collect,2=courier,3=other), `collect` (0=customer,1=deliver,2=courier,3=other), `duration_scheme`, `price_group` (0=A,1=B,2=C), `no_vat`, `calc_late_fees`, `allow_early_returns`, `proj` (project ID), `user`/`user2` (manager IDs), `custom_index`, `int` (internal hire 0/1), `do_priority`.

`job_data`/`job_refresh` return **metadata only** — supplying list (line items) NOT included. Full-item read path unverified — discovery needed [INFERRED].

**Relationships:** Client/Contact N:1 (`CLIENT_ID`) · Depot N:1 (`DEPOT_ID`) · LineItem/Supply 1:N (`items` map write; supplying-list read path needs discovery [INFERRED]) · Invoice 1:N (jobs auto-convert on dispatch) · User/manager N:1 (`user`,`user2`) · Project N:1 (`proj`) · Attachment 1:N (`attach_list.php?job={id}`).

### LineItem / Supply (job supplying list)

**Paths:** written via `save_job.php` `items` map; barcode add `/php_functions/items_barcode_save.php`; multiplier `/php_functions/items_get_multiplier.php`. Full-list read needs discovery [INFERRED].
A row on a job's supplying list — equipment (hire), sales goods, labour, headings, custom/inline/calculated. Nesting via nested-set `LFT`/`RGT`.
**Write map (`items`):** key=`<prefix><productId>`, value=quantity. Prefixes `a`=sales, `b`=hire, `c`=labour. e.g. `{"b123":4,"a12":3.5,"c34":2.2}`.

| Field          | Type    | Description                                                            | Example        |
| -------------- | ------- | ---------------------------------------------------------------------- | -------------- |
| ID             | integer | Line item ID                                                           | `9001`         |
| kind           | integer | 0=heading,1=sales,2=hire,3=custom,4=labour,5=inline,6=calculated       | `2`            |
| title          | string  | Item title                                                             | `"LED Par 64"` |
| qty            | number  | Quantity                                                               | `4`            |
| UNIT_PRICE     | number  | Per-unit price (base ccy)                                              | `15.00`        |
| PRICE          | number  | Line price                                                             | `180.00`       |
| PRICE_TYPE     | integer | 0=one-off,1=hourly,2=daily,3=weekly,4=monthly,5=every day,6=every week | `3`            |
| VAT_RATE       | number  | Tax rate %                                                             | `20`           |
| DURATION       | number  | Charge duration                                                        | `3`            |
| OUTGOING_DATE  | string  | Out date `YYYY-MM-DD`                                                  | `"2026-06-10"` |
| RETURNING_DATE | string  | Return date                                                            | `"2026-06-15"` |
| avail          | number  | Available quantity                                                     | `12`           |
| remainder      | number  | Shortfall / remaining                                                  | `0`            |
| VIRTUAL        | integer | 1 or 2 = virtual/package item                                          | `0`            |
| parent         | integer | Parent line ID (nesting)                                               | `null`         |
| LFT / RGT      | integer | Nested-set tree bounds                                                 | `1`/`2`        |

### Client / Contact (address book)

**Paths:** list `/php_functions/get_contacts.php` (paginated); create/edit `/php_functions/contact_save.php`; per-client price overrides `/php_functions/contact_prices_save.php`. NOT `list_contacts.php`/`save_contact.php`.
Address-book companies/people that hire equipment; referenced from jobs via `CLIENT_ID`. Supports `custom_fields`.
**CRUD:** Create, Read (list), Update. Delete not documented [INFERRED].

| Field         | Type    | Description            | Example             |
| ------------- | ------- | ---------------------- | ------------------- |
| ID            | integer | Contact/company ID     | `1023`              |
| COMPANY       | string  | Company / contact name | `"Acme Events Ltd"` |
| CUSTOM_FIELDS | object  | Tenant-defined fields  | `{}`                |

Full field list not fully documented — discovery needed (address, telephone, email expected) [INFERRED].

### Invoice / Billing

No clean documented CRUD surface. Dispatched jobs **auto-become invoices**; invoice status changes fire `invoice.status.updated` webhook. Billing surfaces via `job_margins.php` (costings/profit) and `jobs_totals.php` (totals, ≤50 jobs). **CRUD:** Read (totals/margins) only; direct invoice CRUD not documented [INFERRED].

### Depot

**Path:** `/php_functions/get_depots.php` (no params). Physical/virtual stock location; jobs and stock belong to a depot. **CRUD:** Read.
Fields: `ID` (integer), `DEPOT` (name string), `VIRTUAL` (boolean).

### Category

**Paths:** `categories_list.php` (list), `categories_save.php` (create/edit), `categories_move.php`, `categories_delete.php` (empty only). Product/stock catalogue tree. **CRUD:** Create, Read, Update, Delete (empty only), Move — a category must be empty before deletion.

### Stock / Availability (Product)

**Paths:** `availability_get_available.php` (POST; `depot`,`rows`,`local`,`tz`), `availability_list.php` (`head`,`cats`,`date`,`date_range`,`depots`), `picklist_get_availability.php` (`job`,`rows`,`local`,`tz`), `availability_jobs_list.php` (jobs using a product within a year), `sales_list.php`, `items_barcode_save.php`, `items_available.php` (deprecated). Rental/sales products + day-by-day availability; barcode lookup returns hire/sales item details. **CRUD:** Read / availability query.

### Attachment (job files)

**Paths:** `attach_list.php` (list, `job`), `attach_files_upload.php` (upload, multipart), `attach_delete.php` (delete). Files on a job (documents, photos, signed contracts). Job-scoped only — NOT a browsable drive. **CRUD:** Create (upload), Read (list), Delete.

### User

**Path:** `/php_functions/get_user_info.php` (current user / token owner). HireHop staff users; response includes permissions, currency, locale, grid settings. The token resolves to one user. **CRUD:** Read (current user).

### Custom Fields (global definitions)

**Paths:** `custom_fields_global_load.php` (load), `custom_fields_global_save.php` (save). Tenant-defined schema applied mainly to Jobs and Projects. Values stored as JSON on each record's `CUSTOM_FIELDS` (each value carries value/type/format). Surfaced in documents via underscore merge fields (`_job:_field_name`). **CRUD:** Read, Update.

## Entity Relationship Diagram

```
Client/Contact (address book) ──N:1── Job (booking) ──1:N── LineItem (supplying list)
        │1:N                              │N:1                       │N:1
   Contact prices                      Depot                  Product/Stock ──N:1── Category
                                          ▲
   Invoice/Billing ◄─(dispatch)──── Job  │N:1── User (manager / token owner)
   Attachment ──N:1──► Job
```

## State Machines

### Job status

```
[Enquiry/Quote] --confirm--> [Booked/Provisional] --prep--> [Prepped] --dispatch--> [Dispatched/Booked Out] --return--> [Returned] --invoice--> [Invoiced/Completed]
        └--lose/cancel--> [Cancelled/Dead]
```

Set via `POST /frames/status_save.php` (`job` + numeric `status`). UI flow: customer signs → Booked; prep scan complete → Prepped; dispatched bookings auto-convert to Invoices.

| From          | Action               | To             | Reversible?  | Side effects                              |
| ------------- | -------------------- | -------------- | ------------ | ----------------------------------------- |
| Enquiry/Quote | confirm              | Booked         | Yes (manual) | status_save; fires `job.status.*` webhook |
| Booked        | prep scan complete   | Prepped        | Yes (manual) | status_save                               |
| Prepped       | dispatch             | Dispatched     | Maybe        | May auto-create an invoice                |
| Dispatched    | check-in/return scan | Returned       | No           | status_save                               |
| Any           | cancel               | Cancelled/Dead | Maybe        | status_save                               |

**Per-state capabilities:**

| State         | Update?             | Delete?     | Actions                 | Notes                                |
| ------------- | ------------------- | ----------- | ----------------------- | ------------------------------------ |
| Enquiry/Quote | Yes                 | No (cancel) | edit, add items, status | Most editable                        |
| Booked        | Yes (if not LOCKED) | No          | status, edit items      |                                      |
| Dispatched    | Limited             | No          | return                  | May be LOCKED                        |
| Invoiced      | No                  | No          | (none — financial)      | Typically `LOCKED=1` — refuse writes |

The integer→label map is NOT published. First discovery task on any tenant: read jobs at known statuses and/or enumerate via the UI. Do not treat the inferred numbers in Enums as fact [INFERRED].

### Invoice

```
[Draft/Unpaid] --send--> [Sent] --pay--> [Paid]   (each fires invoice.status.updated)
```

## Business Rules

- Creating a job needs at minimum `name`, `out`, `start`.
- `items` reference existing products by ID + type prefix (`a`/`b`/`c`); the product must exist.
- A category must be empty before deletion.
- Token in a query string MUST be URL-encoded (`=`,`+`,`-`).
- Datetimes `YYYY-MM-DD hh:mm:ss` (space). System dates UTC; user dates in depot timezone.
- Currency always base currency in/out; conversion is display-only.
- Dispatching a booking can auto-generate an invoice.
- Status changes fire webhooks unless suppressed with `no_webhook` on `status_save`.
- `LOCKED=1` → job not editable (e.g. invoiced/closed); check before any write and refuse if locked.
- Server-computed/read-only: job/line totals, `job_margins.php` margins, `jobs_totals.php` aggregates, `COLOUR` (derived from status).

## Field Format Reference

| Format      | Pattern               | Example               | Notes                                                     |
| ----------- | --------------------- | --------------------- | --------------------------------------------------------- |
| DateTime    | `YYYY-MM-DD hh:mm:ss` | `2026-06-10 08:00:00` | Space, not `T`. System=UTC, user=depot tz                 |
| Date        | `YYYY-MM-DD`          | `2026-06-10`          | Line item out/return dates                                |
| Currency    | number (base ccy)     | `180.00`              | Always base currency; display conversion elsewhere        |
| ID          | integer               | `52`                  | Jobs, depots, clients, users                              |
| Token       | opaque string         | `dqwejk5...=-7hmn`    | Contains `=`/`+`/`-`; URL-encode in query strings         |
| Boolean-ish | integer 0/1           | `1`                   | `LOCKED`, `USE_SALES_TAX`, `VIRTUAL`, `int`, `no_webhook` |
| Colour      | hex                   | `#3399ff`             | Job status colour                                         |

## Enum Value Reference

| Entity   | Field       | Allowed values                                                                                         | Notes                                                                                                            |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| LineItem | kind        | 0=heading,1=sales,2=hire,3=custom,4=labour,5=inline,6=calculated                                       |                                                                                                                  |
| LineItem | PRICE_TYPE  | 0=one-off,1=hourly,2=daily,3=weekly,4=monthly,5=every day,6=every week                                 |                                                                                                                  |
| Job item | prefix      | `a`=sales,`b`=hire,`c`=labour (in `items` write map)                                                   |                                                                                                                  |
| Job      | price_group | 0=A,1=B,2=C                                                                                            | Pricing tier selector on save                                                                                    |
| Job      | deliver     | 0=return,1=collect,2=courier,3=other                                                                   | Delivery method on save                                                                                          |
| Job      | collect     | 0=customer,1=deliver,2=courier,3=other                                                                 | Collection method on save                                                                                        |
| Job      | STATUS      | numeric; commonly 0=Enquiry/Draft,1=Provisional,2=Booked,3=Prepped,5=Dispatched,7=Returned,8=Cancelled | **[INFERRED — NEEDS DISCOVERY]** integer→label map NOT in public docs; verify per tenant before any status write |

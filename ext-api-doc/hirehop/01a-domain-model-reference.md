---
api_name: 'HireHop'
api_slug: 'hirehop'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# HireHop -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Full entity catalog, relationships, state machines,
> and business rules the workspace agent references when working with HireHop data.
>
> **Confidence: MEDIUM — documented, NOT live-tested.** Tags: `[DOCUMENTED]` (vendor docs),
> `[INFERRED]`, `[UNKNOWN]`. Response field names are UPPER_SNAKE_CASE; write params are
> lower_snake_case — they are deliberately listed separately below because they differ.

---

## Entity Catalog

### Job (booking / quotation)

**Resource path:** `/api/job_data.php`, `/php_functions/job_refresh.php` (read); `/api/save_job.php`, `/php_functions/job_save.php` (write); `/frames/status_save.php` (status); `/php_functions/job_duplicate.php`
**Description:** The central entity — a rental/hire booking for a customer over a date range, at a depot, with a status, financials, and a supplying list of items. "Quotation / booking / job" are the same record at different statuses. [DOCUMENTED]
**CRUD:** Create (`job=0`/omit), Read (metadata only), Update (partial), Duplicate, Status-change. No hard delete (cancellation is a status). [DOCUMENTED]

**Response fields (UPPER_SNAKE_CASE):**

| Field            | Type    | Writable (write param) | Description                                    | Example                 |
| ---------------- | ------- | ---------------------- | ---------------------------------------------- | ----------------------- |
| ID               | integer | no                     | Job number                                     | `52`                    |
| JOB_NAME         | string  | yes (`job_name`)       | Internal job/booking name                      | `"Main Stage"`          |
| COMPANY          | string  | yes (`company`)        | Customer company name                          | `"Acme Events Ltd"`     |
| NAME             | string  | yes (`name`)           | Customer contact name (**required on create**) | `"Jane Smith"`          |
| CLIENT_ID        | integer | yes (`client_id`)      | Address-book company/client reference          | `1023`                  |
| OUT_DATE         | string  | yes (`out`)            | Reservation/out datetime (**req. on create**)  | `"2026-06-10 08:00:00"` |
| JOB_DATE         | string  | yes (`start`)          | Charging start datetime (**req. on create**)   | `"2026-06-11 00:00:00"` |
| JOB_END          | string  | yes (`end`)            | Charging end datetime                          | `"2026-06-14 00:00:00"` |
| RETURN_DATE      | string  | yes (`to`)             | Return datetime                                | `"2026-06-15 17:00:00"` |
| STATUS           | number  | via `status_save`      | Job status (numeric — see Enum ref)            | `2`                     |
| DEPOT_ID         | integer | yes (`depot`)          | Owning depot                                   | `1`                     |
| DEPOT            | string  | no                     | Depot display name                             | `"Main Depot"`          |
| COLOUR           | string  | no                     | Status colour (hex, derived from status)       | `"#3399ff"`             |
| LOCKED           | integer | no                     | 1 = locked (refuse writes), 0 = editable       | `0`                     |
| CURRENCY         | object  | no                     | `{CODE, SYMBOL, DECIMALS}`                     | `{"CODE":"GBP",...}`    |
| DEFAULT_DISCOUNT | number  | yes (`default_disc`)   | Default line discount %                        | `0`                     |
| USE_SALES_TAX    | integer | no                     | Sales-tax vs VAT mode flag                     | `0`                     |
| CUSTOM_FIELDS    | object  | yes (`custom_fields`)  | Tenant-defined custom fields (JSON)            | `{"po":"PO-9981"}`      |

**Additional write-only params** (no direct response mirror; from docs): `address`, `telephone`, `email`, `mobile`, `type`, `details`, `client_ref`, `duration_days`, `duration_hrs`, `duration_locked`, `venue`, `venue_address`, `venue_id`, `venue_telephone`, `deliver` (0=return,1=collect,2=courier,3=other), `collect` (0=customer,1=deliver,2=courier,3=other), `duration_scheme`, `price_group` (0=A,1=B,2=C), `no_vat`, `calc_late_fees`, `allow_early_returns`, `proj` (project ID), `user`, `user2` (manager IDs), `custom_index`, `int` (internal hire 0/1), `do_priority`. [DOCUMENTED]

**IMPORTANT:** `job_data`/`job_refresh` return **metadata only** — the supplying list (line items) is NOT included. Reading full line items needs a separate call; the read path is unverified — **discovery needed.** [DOCUMENTED / INFERRED]

**Relationships:**

| Related Entity  | Type | Expression                                 | Notes                                |
| --------------- | ---- | ------------------------------------------ | ------------------------------------ |
| Client/Contact  | N:1  | `CLIENT_ID` ref into address book          | [DOCUMENTED]                         |
| Depot           | N:1  | `DEPOT_ID`                                 | [DOCUMENTED]                         |
| LineItem/Supply | 1:N  | `items` map (write); supplying list (read) | Read path needs discovery [INFERRED] |
| Invoice/Billing | 1:N  | Jobs convert to invoices on dispatch       | [DOCUMENTED]                         |
| User (manager)  | N:1  | `user`, `user2`                            | [DOCUMENTED]                         |
| Project         | N:1  | `proj`                                     | [DOCUMENTED]                         |
| Attachment      | 1:N  | `attach_list.php?job={id}`                 | [DOCUMENTED]                         |

---

### LineItem / Supply (job supplying list)

**Resource path:** written via `save_job.php` `items` map; barcode add via `/php_functions/items_barcode_save.php`; multiplier via `/php_functions/items_get_multiplier.php`. **Reading the full list needs discovery.** [DOCUMENTED / INFERRED]
**Description:** A row on a job's supplying list — equipment (hire), sales goods, labour, headings, custom/inline/calculated lines. Supports nesting via nested-set `LFT`/`RGT`. [DOCUMENTED]
**CRUD:** Create/Update via job save & barcode add. [DOCUMENTED]

**Write map (`items`):** key = `<prefix><productId>`, value = quantity. Prefixes: `a`=sales, `b`=hire, `c`=labour. e.g. `{"b123":4,"a12":3.5,"c34":2.2}`. [DOCUMENTED]

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
| remainder      | number  | Shortfall / remaining                                                  | `0`            |
| VIRTUAL        | integer | 1 or 2 = virtual/package item                                          | `0`            |
| parent         | integer | Parent line ID (nesting)                                               | `null`         |
| LFT / RGT      | integer | Nested-set tree bounds                                                 | `1` / `2`      |

---

### Client / Contact (address book)

**Resource path:** `/php_functions/get_contacts.php` (list, paginated); `/php_functions/contact_save.php` (create/edit); `/php_functions/contact_prices_save.php` (per-client price overrides).
**NOTE:** Vendor docs use `get_contacts.php` / `contact_save.php` — NOT `list_contacts.php` / `save_contact.php`. [DOCUMENTED]
**Description:** Address-book companies/people that hire equipment. Referenced from jobs via `CLIENT_ID`. Supports `custom_fields`. [DOCUMENTED]
**CRUD:** Create, Read (list), Update. Delete not documented. [DOCUMENTED / INFERRED]

| Field         | Type    | Description            | Example             |
| ------------- | ------- | ---------------------- | ------------------- |
| ID            | integer | Contact/company ID     | `1023`              |
| COMPANY       | string  | Company / contact name | `"Acme Events Ltd"` |
| CUSTOM_FIELDS | object  | Tenant-defined fields  | `{}`                |

Full field list is **not fully documented** — discovery needed (address, telephone, email, etc. expected). [INFERRED]

---

### Invoice / Billing

**Resource path:** No clean documented CRUD surface. Jobs that are dispatched **auto-become invoices**; invoice status changes fire the `invoice.status.updated` webhook. Billing data surfaces via `job_margins.php` (costings/profit) and `jobs_totals.php` (totals, ≤50 jobs). [DOCUMENTED]
**CRUD:** Read (totals/margins) only. Direct invoice CRUD endpoints not documented — **discovery needed.** [INFERRED]

---

### Depot

**Resource path:** `/php_functions/get_depots.php` (no params). [DOCUMENTED]
**Description:** Physical/virtual stock location. Jobs and stock belong to a depot.
**CRUD:** Read.

| Field   | Type    | Description    | Example        |
| ------- | ------- | -------------- | -------------- |
| ID      | integer | Depot ID       | `1`            |
| DEPOT   | string  | Depot name     | `"Main Depot"` |
| VIRTUAL | boolean | Virtual depot? | `false`        |

---

### Category

**Resource path:** `categories_list.php` (list), `categories_save.php` (create/edit), `categories_move.php`, `categories_delete.php` (empty only). [DOCUMENTED]
**Description:** Product/stock catalogue tree.
**CRUD:** Create, Read, Update, Delete (empty only), Move. A category must be empty before deletion. [DOCUMENTED]

---

### Stock / Availability (Product)

**Resource path:** `availability_get_available.php` (POST; `depot`, `rows`, `local`, `tz`), `availability_list.php` (`head`, `cats`, `date`, `date_range`, `depots`), `picklist_get_availability.php` (`job`, `rows`, `local`, `tz`), `availability_jobs_list.php` (jobs using a product within a year), `sales_list.php`, `items_barcode_save.php`, `items_available.php` (deprecated). [DOCUMENTED]
**Description:** Rental/sales products and their day-by-day availability. Barcode lookup returns hire/sales item details.
**CRUD:** Read / availability query. [DOCUMENTED]

---

### Attachment (job files)

**Resource path:** `attach_list.php` (list, `job`), `attach_files_upload.php` (upload, multipart), `attach_delete.php` (delete). [DOCUMENTED]
**Description:** Files attached to a job (documents, photos, signed contracts). Job-scoped only — NOT a browsable drive. [DOCUMENTED]
**CRUD:** Create (upload), Read (list), Delete.

---

### User

**Resource path:** `/php_functions/get_user_info.php` (current user / token owner). [DOCUMENTED]
**Description:** HireHop staff users. Response includes permissions, currency, locale, grid settings. The token resolves to one user.
**CRUD:** Read (current user).

---

### Custom Fields (global definitions)

**Resource path:** `custom_fields_global_load.php` (load), `custom_fields_global_save.php` (save). [DOCUMENTED]
**Description:** Tenant-defined custom-field schema applied mainly to Jobs and Projects. Values stored as JSON objects on each record's `CUSTOM_FIELDS` (each value carries value/type/format). Surfaced in documents via underscore merge fields (`_job:_field_name`). [DOCUMENTED]
**CRUD:** Read, Update (global definitions).

---

## Entity Relationship Diagram

```
┌──────────┐   N:1   ┌──────────┐   1:N   ┌─────────────┐
│ Client / │<────────│   Job    │────────>│ LineItem    │
│ Contact  │         │(booking) │         │ (supplying  │
│ (address │         └──────────┘         │   list)     │
│  book)   │              │               └─────────────┘
└──────────┘              │ N:1                  │ N:1
      │                   ▼                      ▼
      │ 1:N         ┌──────────┐           ┌─────────────┐
┌──────────┐        │  Depot   │           │  Product /  │
│ Contact  │        └──────────┘           │  Stock      │
│  prices  │              ▲                └─────────────┘
└──────────┘              │ N:1                  │ N:1
                          │               ┌─────────────┐
   ┌──────────┐           │               │  Category   │
   │ Invoice  │<─(dispatch)─┐             └─────────────┘
   │ /Billing │             │
   └──────────┘        ┌──────────┐
                       │   User   │ (manager / token owner)
   ┌────────────┐      └──────────┘
   │ Attachment │──N:1──> Job
   └────────────┘
```

---

## State Machines

### Job status

```
[Enquiry/Quote] --confirm--> [Booked/Provisional] --prep--> [Prepped]
        │                          │                              │
        │                          │                    --dispatch--> [Dispatched/Booked Out]
        │                          │                                       │
        └--lose/cancel--> [Cancelled/Dead]                       --return--> [Returned]
                                                                              │
                                                                  --invoice--> [Invoiced/Completed]
```

> Status is set via `POST /frames/status_save.php` with `job` + numeric `status`. UI workflow: customer signs → Booked; prep scan complete → Prepped; dispatched bookings auto-convert to Invoices. [DOCUMENTED]

**Transitions:**

| From          | Action / Trigger         | To             | Reversible?  | Side Effects                              |
| ------------- | ------------------------ | -------------- | ------------ | ----------------------------------------- |
| Enquiry/Quote | customer signs / confirm | Booked         | Yes (manual) | status_save; fires `job.status.*` webhook |
| Booked        | prep scan complete       | Prepped        | Yes (manual) | status_save                               |
| Prepped       | dispatch                 | Dispatched     | Maybe        | May auto-create an invoice                |
| Dispatched    | check-in / return scan   | Returned       | No           | status_save                               |
| Any           | cancel                   | Cancelled/Dead | Maybe        | status_save                               |

**Per-State Capabilities:**

| State         | Can Update?         | Can Delete? | Available Actions       | Notes                                |
| ------------- | ------------------- | ----------- | ----------------------- | ------------------------------------ |
| Enquiry/Quote | Yes                 | No (cancel) | edit, add items, status | Most editable state                  |
| Booked        | Yes (if not LOCKED) | No          | status, edit items      |                                      |
| Dispatched    | Limited             | No          | return                  | May be LOCKED                        |
| Invoiced      | No                  | No          | (none — financial)      | Typically `LOCKED=1` — refuse writes |

> **The integer→label map is NOT published.** First discovery task on any tenant: read several jobs at known statuses and/or enumerate via the UI. Do not treat the inferred numbers below as fact. [INFERRED]

### Invoice

```
[Draft/Unpaid] --send--> [Sent] --pay--> [Paid]   (each fires invoice.status.updated)
```

---

## Business Rules

### Ordering / Dependency Rules

- Creating a job needs at minimum `name`, `out`, `start`. [DOCUMENTED]
- `items` reference existing products by ID + type prefix (`a`/`b`/`c`); the product must exist. [DOCUMENTED]
- A category must be empty before it can be deleted. [DOCUMENTED]

### Field-Level Rules

- Token in a query string **must be URL-encoded** (MIME/RFC2046 transports). [DOCUMENTED]
- Datetimes are `YYYY-MM-DD hh:mm:ss` (space separator). System dates UTC; user dates in depot timezone. [DOCUMENTED]
- Currency values are always base currency in/out; conversion is display-only. [DOCUMENTED]

### Cascading Effects

- Dispatching a booking can auto-generate an invoice. [DOCUMENTED]
- Status changes fire webhooks unless suppressed with `no_webhook` on `status_save`. [DOCUMENTED]

### Locking

- `LOCKED = 1` means the job cannot be edited (e.g. invoiced/closed). Check before any write and refuse if locked. [DOCUMENTED]

### Computed / Read-Only Fields

- Job/line totals, `job_margins.php` margins, `jobs_totals.php` aggregates are server-computed. [DOCUMENTED]
- `COLOUR` is derived from status. [DOCUMENTED]

---

## Field Format Reference

| Format      | Pattern               | Example               | Notes                                                      |
| ----------- | --------------------- | --------------------- | ---------------------------------------------------------- |
| DateTime    | `YYYY-MM-DD hh:mm:ss` | `2026-06-10 08:00:00` | Space separator, not `T`. System=UTC, user=depot tz        |
| Date        | `YYYY-MM-DD`          | `2026-06-10`          | Line item out/return dates                                 |
| Currency    | number (base ccy)     | `180.00`              | Always base currency; display conversion applied elsewhere |
| ID          | integer               | `52`                  | Jobs, depots, clients, users                               |
| Token       | opaque string         | `dqwejk5...=-7hmn`    | Contains `=`/`+`/`-`; URL-encode in query strings          |
| Boolean-ish | integer 0/1           | `1`                   | `LOCKED`, `USE_SALES_TAX`, `VIRTUAL`, `int`, `no_webhook`  |
| Colour      | hex                   | `#3399ff`             | Job status colour                                          |

---

## Enum Value Reference

| Entity   | Field       | Allowed Values                                                                                                | Confidence                       | Notes                                                                                     |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| LineItem | kind        | 0=heading, 1=sales, 2=hire, 3=custom, 4=labour, 5=inline, 6=calculated                                        | [DOCUMENTED]                     |                                                                                           |
| LineItem | PRICE_TYPE  | 0=one-off, 1=hourly, 2=daily, 3=weekly, 4=monthly, 5=every day, 6=every week                                  | [DOCUMENTED]                     |                                                                                           |
| Job item | prefix      | `a`=sales, `b`=hire, `c`=labour (in the `items` write map)                                                    | [DOCUMENTED]                     |                                                                                           |
| Job      | price_group | 0=A, 1=B, 2=C                                                                                                 | [DOCUMENTED]                     | Pricing tier selector on save                                                             |
| Job      | deliver     | 0=return, 1=collect, 2=courier, 3=other                                                                       | [DOCUMENTED]                     | Delivery method on save                                                                   |
| Job      | collect     | 0=customer, 1=deliver, 2=courier, 3=other                                                                     | [DOCUMENTED]                     | Collection method on save                                                                 |
| Job      | STATUS      | numeric. Commonly: 0=Enquiry/Draft, 1=Provisional, 2=Booked, 3=Prepped, 5=Dispatched, 7=Returned, 8=Cancelled | **[INFERRED — NEEDS DISCOVERY]** | Exact integer→label map is NOT in public docs. Verify per tenant before any status write. |

---

_Generated from the investigation questionnaire (Phase 3) + official HireHop docs. NOT live-tested._

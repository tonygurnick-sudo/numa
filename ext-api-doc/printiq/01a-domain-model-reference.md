---
api_name: PrintIQ
api_slug: printiq
companion_to: 01-llm-api-rules.md
content: entity catalog, relationships, state machines, business rules
confidence: LOW. Entity EXISTENCE (Quote, Order/Job, Product, Customer, Price) is [DOCUMENTED]. Every field name, type, resource path, enum value, and relationship is [INFERRED] from the print-MIS domain UNLESS tagged [DOCUMENTED]. No live schema captured — discover real field names from the IQConnect doc pack / a live response before relying on them.
---

# PrintIQ — Domain Model Reference

## Entity Catalog

### Quote

Path `[INFERRED]`: `/api/Quote`, `/api/Quote/{quoteNo}`; price via `GetPrice`. A priced estimate for a print job; accepting/converting it creates an order/job (one-way). CRUD: Create (build cart → save), Read, price (`GetPrice`), Update (before conversion). [DOCUMENTED: quotes + GetPrice exist]
Real key could be `quoteNo` vs `QuoteReference` vs `id` — discover it.

| Field        | Type   | Req | Writable | Description                       | Example                  |
| ------------ | ------ | --- | -------- | --------------------------------- | ------------------------ |
| quoteNo      | string | yes | no       | Human-readable quote number       | `"Q-100234"`             |
| quoteGuid    | string | yes | no       | System unique id                  | `"a1b2c3d4-..."`         |
| customerCode | string | yes | yes      | Owning customer reference         | `"CUST001"`              |
| status       | string | yes | no       | Quote lifecycle state             | `"Draft"`                |
| lines        | array  | yes | yes      | Line items (product + spec + qty) | `[{...}]`                |
| total        | number | yes | no       | Computed price total              | `1250.00`                |
| currency     | string | yes | no       | From instance settings            | `"NZD"`                  |
| createdDate  | string | yes | no       | ISO 8601 timestamp                | `"2026-05-29T10:00:00Z"` |

Relationships: Customer N:1 (`customerCode` on quote) · Product N:M (each line references a product + spec; `GetPrice` prices a product) · Order/Job 1:N (accepting converts it, one-way).

### Order / Job

Path `[INFERRED]`: `/api/Order`, `/api/Job`, `/api/Job/{jobNo}`. A confirmed order becomes one or more production **jobs** on printIQ's Production Board (barcoded job bags, scheduling, production methods). Punch-Out delivers an order + artwork straight to the board. CRUD: Create (from accepted quote / punch-out), Read, status updates. [DOCUMENTED at domain level]
"Order" vs "Job": a job is the production unit; an order may contain several jobs. Whether the API exposes them as one resource or two is `[UNKNOWN]`.

| Field        | Type   | Req | Writable | Description                    | Example           |
| ------------ | ------ | --- | -------- | ------------------------------ | ----------------- |
| jobNo        | string | yes | no       | Production job number          | `"J-100234"`      |
| orderNo      | string | yes | no       | Order number                   | `"O-55012"`       |
| quoteNo      | string | no  | no       | Source quote (if from a quote) | `"Q-100234"`      |
| customerCode | string | yes | no       | Owning customer                | `"CUST001"`       |
| status       | string | yes | no       | Production/shipping state      | `"In Production"` |
| dueDate      | string | yes | no       | Promised due date              | `"2026-06-04"`    |
| shippedDate  | string | no  | no       | When shipped (nullable)        | `null`            |
| lines        | array  | yes | no       | Job line items                 | `[{...}]`         |
| artworkRefs  | array  | no  | no       | Attached artwork references    | `[]`              |

Relationships: Quote N:1 (`quoteNo` source) · Customer N:1 (`customerCode`) · Artwork 1:N (`artworkRefs` / job bag — travels with the order).

### Product

Path `[INFERRED]`: `/api/Product`, `/api/Product/{code}`. A configurable print product definition — the thing you price; drives `GetPrice`. printIQ also has **Inventory Items** (stocked products): the Infigo integration distinguishes a "static PDF product sync" webhook from an "Inventory Items product sync" webhook, confirming both types. CRUD: Read (catalog/sync); create/update likely admin-side, not API. [DOCUMENTED: both product types exist]

| Field       | Type    | Req | Writable | Description                           | Example                  |
| ----------- | ------- | --- | -------- | ------------------------------------- | ------------------------ |
| productCode | string  | yes | no       | Product code (used by GetPrice)       | `"BC-350GSM"`            |
| name        | string  | yes | no       | Display name                          | `"Business Card 350gsm"` |
| productType | string  | yes | no       | Configurable vs inventory item        | `"Configurable"`         |
| options     | array   | no  | no       | Selectable spec options (finish, etc) | `[{...}]`                |
| active      | boolean | yes | no       | Whether sellable                      | `true`                   |

### Customer

Path `[INFERRED]`: `/api/Customer`, `/api/Customer/{code}`. The account quotes/orders are placed against. printIQ syncs customer + pipeline updates to CRMs (HubSpot, Zoho, Salesforce). CRUD: Create, Read, Update. [DOCUMENTED: customer + CRM sync exist]

| Field         | Type   | Req | Writable | Description                  | Example            |
| ------------- | ------ | --- | -------- | ---------------------------- | ------------------ |
| customerCode  | string | yes | no       | Unique customer reference    | `"CUST001"`        |
| name          | string | yes | yes      | Customer/company name        | `"Acme Signs Ltd"` |
| accountStatus | string | yes | no       | Account state                | `"Active"`         |
| priceList     | string | no  | yes      | Pricing tier / price list    | `"Trade"`          |
| contacts      | array  | no  | yes      | Contact people               | `[{...}]`          |
| addresses     | array  | no  | yes      | Billing / delivery addresses | `[{...}]`          |

### Price (GetPrice result)

Path `[INFERRED]`: `POST .../GetPrice` (e.g. `/api/Quote/GetPrice` or `/api/GetPrice`). Real-time pricing for a product + spec + quantity — the single most-cited IQConnect endpoint (Infigo "requests pricing solely from printIQ via the GetPrice API"). Pricing lives in printIQ, fetched on demand. CRUD: Read/compute only (POST a spec, get a price). [DOCUMENTED: GetPrice is the pricing source of truth]

| Field        | Type   | Req | Writable | Description                    | Example   |
| ------------ | ------ | --- | -------- | ------------------------------ | --------- |
| price        | number | yes | no       | Computed price                 | `250.00`  |
| currency     | string | yes | no       | From instance settings         | `"NZD"`   |
| leadTimeDays | number | no  | no       | Estimated production lead time | `3`       |
| breakdown    | array  | no  | no       | Per-component cost breakdown   | `[{...}]` |

## ERD (INFERRED domain model, NOT an API schema)

```
Customer ──1:N──> Quote ──convert(one-way)──> Order ──1:N──> Job (Production Board)
                    │ references                                 │
                    ▼                                             ▼
                 Product (GetPrice prices a Product+spec+qty)   Artwork / Job Bag
```

## State Machine (Quote → Order → Job; all INFERRED, real enums UNKNOWN)

```
[Quote: Draft] ──GetPrice──> [Quoted] ──accept/convert──> [Order]
                                                            └─(production)─> [Job: Pending] → [In Production] → [Shipped] → [Completed]
```

| From          | Action           | To            | Reversible? | Side effects                                    |
| ------------- | ---------------- | ------------- | ----------- | ----------------------------------------------- |
| Quote Draft   | GetPrice         | Quoted        | Yes         | Price computed; no commitment                   |
| Quoted        | Accept/convert   | Order/Job     | **No**      | Job created on Production Board                 |
| Pending       | Start production | In Production | No          | Job scheduled / job bag printed                 |
| In Production | Ship             | Shipped       | No          | "Shipped status" webhook fires (if provisioned) |
| Shipped       | Complete         | Completed     | No          | Job closed                                      |

Per-state capabilities (INFERRED): Quote Draft → update yes, delete unknown, actions GetPrice/edit lines (editable before acceptance) · Quoted → update limited, delete unknown, action accept/convert (one-way) · In Production / Shipped → no update, no delete, view status only (owned by production workflow).

## Business Rules

- Pricing is authoritative in printIQ — call `GetPrice`, never compute client-side. [DOCUMENTED]
- A valid product code + its required option/spec selections is needed to get a price. [INFERRED]
- A quote (or punch-out order) must exist before an order/job; orders derive from accepted quotes / punch-out. [INFERRED]
- Orders flow to the Production Board with artwork attached. [DOCUMENTED]
- `customerCode` / `quoteNo` / `jobNo` presumed unique references per instance. [INFERRED]
- Accepting/converting a quote creates an order/job (one-way). [INFERRED]
- Computed/read-only: Quote `total` (from lines + GetPrice), `createdDate`/timestamps (server-set), production status fields (owned by the workflow, not API-writable). [INFERRED]
- Field-level validation, max lengths, required-field lists, uniqueness constraints, deletion/cascade semantics: all `[UNKNOWN]` — discover from the doc pack. Do NOT assume cascading deletes exist.

## Field Formats

| Format        | Pattern  | Example                  | Notes                                                    |
| ------------- | -------- | ------------------------ | -------------------------------------------------------- |
| Date/DateTime | ISO 8601 | `2026-05-29T10:00:00Z`   | [INFERRED]                                               |
| Currency      | number   | `1250.00`                | Currency from instance settings (NZD/AUD/etc) [INFERRED] |
| ID/reference  | string   | `"Q-100234"` and/or GUID | Likely a human ref + GUID pair [INFERRED]                |
| Enum values   | string   | —                        | Status enums `[UNKNOWN]`                                 |

## Enums (`[UNKNOWN]` — no public values; anticipated, do NOT rely on exact strings)

| Entity    | Field       | Allowed values (INFERRED — UNVERIFIED)                          | Notes                |
| --------- | ----------- | --------------------------------------------------------------- | -------------------- |
| Quote     | status      | `Draft`, `Quoted`, `Accepted`, `Cancelled`                      | strings unverified   |
| Order/Job | status      | `Pending`, `In Production`, `Shipped`, `Completed`, `Cancelled` | strings unverified   |
| Product   | productType | `Configurable`, `Inventory Item`                                | two types DOCUMENTED |

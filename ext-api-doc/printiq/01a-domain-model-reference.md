---
api_name: 'PrintIQ'
api_slug: 'printiq'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
update_source: 'web research only — NO live API access; partner-gated docs'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# PrintIQ -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Entity catalog, relationships, state machines, and
> business rules the workspace agent references when working with PrintIQ data.
>
> ⚠️ **CONFIDENCE: LOW.** Entity _existence_ (Quote, Order/Job, Product, Customer, Price) is
> `[DOCUMENTED]` from printIQ product/marketing material. **Every field name, type, resource path,
> enum value, and relationship below is `[INFERRED]` from the print-MIS domain unless explicitly
> marked otherwise.** No schema was captured from a live call. Replace these with real field names
> from the IQConnect doc pack / a live response before relying on them.

---

## Entity Catalog

### Quote

**Resource path:** `[INFERRED]` `/api/Quote`, `/api/Quote/{quoteNo}`; pricing via `GetPrice`
**Description:** A priced estimate for a print job. printIQ's core strength is automated estimating —
`GetPrice` returns real-time pricing for a product + specification + quantity. A quote can later be
accepted and converted into an order/job. [DOCUMENTED: quotes + GetPrice exist]
**CRUD:** Create (build cart → save quote), Read, price (`GetPrice`), Update (before conversion) [INFERRED]

| Field        | Type   | Required | Writable | Description                             | Example                  |
| ------------ | ------ | -------- | -------- | --------------------------------------- | ------------------------ |
| quoteNo      | string | yes      | no       | Human-readable quote number             | `"Q-100234"`             |
| quoteGuid    | string | yes      | no       | System unique id                        | `"a1b2c3d4-..."`         |
| customerCode | string | yes      | yes      | Owning customer reference               | `"CUST001"`              |
| status       | string | yes      | no       | Quote lifecycle state                   | `"Draft"`                |
| lines        | array  | yes      | yes      | Quote line items (product + spec + qty) | `[{...}]`                |
| total        | number | yes      | no       | Computed price total                    | `1250.00`                |
| currency     | string | yes      | no       | From instance settings                  | `"NZD"`                  |
| createdDate  | string | yes      | no       | ISO 8601 timestamp                      | `"2026-05-29T10:00:00Z"` |

> **All fields `[INFERRED]`.** The real key could be `quoteNo` vs `QuoteReference` vs `id` — discover it.

**Relationships:**

| Related Entity | Type | Expression (INFERRED)                      | Notes                       |
| -------------- | ---- | ------------------------------------------ | --------------------------- |
| Customer       | N:1  | `customerCode` on quote                    | Quote belongs to a customer |
| Product        | N:M  | each line references a product + spec      | `GetPrice` prices a product |
| Order/Job      | 1:N  | accepting a quote converts it to order/job | Convert is one-way          |

---

### Order / Job

**Resource path:** `[INFERRED]` `/api/Order`, `/api/Job`, `/api/Job/{jobNo}`
**Description:** A confirmed order that becomes one or more production **jobs** tracked on printIQ's
Production Board (barcoded job bags, scheduling, production methods). Punch-Out delivers an order with
artwork straight to the Production Board. [DOCUMENTED at domain level]
**CRUD:** Create (from accepted quote / punch-out), Read, status updates (production lifecycle) [INFERRED]

| Field        | Type   | Required | Writable | Description                    | Example           |
| ------------ | ------ | -------- | -------- | ------------------------------ | ----------------- |
| jobNo        | string | yes      | no       | Production job number          | `"J-100234"`      |
| orderNo      | string | yes      | no       | Order number                   | `"O-55012"`       |
| quoteNo      | string | no       | no       | Source quote (if from a quote) | `"Q-100234"`      |
| customerCode | string | yes      | no       | Owning customer                | `"CUST001"`       |
| status       | string | yes      | no       | Production/shipping state      | `"In Production"` |
| dueDate      | string | yes      | no       | Promised due date              | `"2026-06-04"`    |
| shippedDate  | string | no       | no       | When shipped (nullable)        | `null`            |
| lines        | array  | yes      | no       | Job line items                 | `[{...}]`         |
| artworkRefs  | array  | no       | no       | Attached artwork references    | `[]`              |

> "Order" vs "Job" terminology: in printIQ a job is the production unit; an order may contain several
> jobs. Whether the API exposes them as one resource or two is `[UNKNOWN]` — discover.

**Relationships:**

| Related Entity | Type | Expression (INFERRED)    | Notes                          |
| -------------- | ---- | ------------------------ | ------------------------------ |
| Quote          | N:1  | `quoteNo` (source quote) | Created from an accepted quote |
| Customer       | N:1  | `customerCode`           |                                |
| Artwork        | 1:N  | `artworkRefs` / job bag  | Artwork travels with the order |

---

### Product

**Resource path:** `[INFERRED]` `/api/Product`, `/api/Product/{code}`
**Description:** A configurable print product definition — the thing you get a price for. Drives
`GetPrice`. printIQ also has **Inventory Items** (stocked products): the Infigo integration
distinguishes a "static PDF product sync" webhook from an "Inventory Items product sync" webhook,
confirming both product types exist. [DOCUMENTED: both product types exist]
**CRUD:** Read (catalog/sync); create/update is likely admin-side, not API. [INFERRED]

| Field       | Type    | Required | Writable | Description                           | Example                  |
| ----------- | ------- | -------- | -------- | ------------------------------------- | ------------------------ |
| productCode | string  | yes      | no       | Product code (used by GetPrice)       | `"BC-350GSM"`            |
| name        | string  | yes      | no       | Display name                          | `"Business Card 350gsm"` |
| productType | string  | yes      | no       | e.g. configurable vs inventory item   | `"Configurable"`         |
| options     | array   | no       | no       | Selectable spec options (finish, etc) | `[{...}]`                |
| active      | boolean | yes      | no       | Whether sellable                      | `true`                   |

---

### Customer

**Resource path:** `[INFERRED]` `/api/Customer`, `/api/Customer/{code}`
**Description:** A customer/account that quotes and orders are placed against. printIQ syncs
customer + pipeline updates to CRMs (HubSpot, Zoho, Salesforce). [DOCUMENTED: customer + CRM sync exist]
**CRUD:** Create, Read, Update [INFERRED]

| Field         | Type   | Required | Writable | Description                  | Example            |
| ------------- | ------ | -------- | -------- | ---------------------------- | ------------------ |
| customerCode  | string | yes      | no       | Unique customer reference    | `"CUST001"`        |
| name          | string | yes      | yes      | Customer/company name        | `"Acme Signs Ltd"` |
| accountStatus | string | yes      | no       | Account state                | `"Active"`         |
| priceList     | string | no       | yes      | Pricing tier / price list    | `"Trade"`          |
| contacts      | array  | no       | yes      | Contact people               | `[{...}]`          |
| addresses     | array  | no       | yes      | Billing / delivery addresses | `[{...}]`          |

---

### Price (GetPrice result)

**Resource path:** `[INFERRED]` `POST .../GetPrice` (e.g. `/api/Quote/GetPrice` or `/api/GetPrice`)
**Description:** Real-time pricing for a product + specification + quantity. This is the single
most-cited IQConnect endpoint — Infigo "requests pricing solely from printIQ via the GetPrice API."
The integration philosophy is that **pricing lives in printIQ** and is fetched on demand.
[DOCUMENTED: GetPrice exists and is the pricing source of truth]
**CRUD:** Read/compute only (POST a spec, get a price) [INFERRED]

| Field        | Type   | Required | Writable | Description                    | Example   |
| ------------ | ------ | -------- | -------- | ------------------------------ | --------- |
| price        | number | yes      | no       | Computed price                 | `250.00`  |
| currency     | string | yes      | no       | From instance settings         | `"NZD"`   |
| leadTimeDays | number | no       | no       | Estimated production lead time | `3`       |
| breakdown    | array  | no       | no       | Per-component cost breakdown   | `[{...}]` |

---

## Entity Relationship Diagram

```
[INFERRED domain model — NOT captured from an API schema]

┌──────────┐   1:N   ┌──────────┐   convert   ┌──────────┐   1:N   ┌──────────┐
│ Customer │────────>│  Quote   │────────────>│  Order   │────────>│   Job    │
└──────────┘         └──────────┘  (one-way)  └──────────┘         └──────────┘
                          │ references                                   │
                          ▼                                              ▼ (Production Board)
                     ┌──────────────┐                            ┌──────────────┐
                     │   Product    │  (GetPrice prices a        │  Artwork /   │
                     │ / Inventory  │   Product + spec + qty)    │  Job Bag     │
                     └──────────────┘                            └──────────────┘
```

---

## State Machines

### Quote → Order → Job Lifecycle (INFERRED)

```
[Quote: Draft] ──GetPrice──> [Quoted] ──accept/convert──> [Order]
                                                             │
                                                       (production)
                                                             ▼
       [Job: Pending] ──> [In Production] ──> [Shipped] ──> [Completed]
```

> All states and transitions are `[INFERRED]` from the print-MIS domain. Real enum values are `[UNKNOWN]`.

**Transitions:**

| From          | Action / Trigger | To            | Reversible? | Side Effects                                    |
| ------------- | ---------------- | ------------- | ----------- | ----------------------------------------------- |
| Quote Draft   | GetPrice         | Quoted        | Yes         | Price computed; no commitment                   |
| Quoted        | Accept / convert | Order / Job   | **No**      | Job created on the Production Board             |
| Pending       | Start production | In Production | No          | Job scheduled / job bag printed                 |
| In Production | Ship             | Shipped       | No          | "Shipped status" webhook fires (if provisioned) |
| Shipped       | Complete         | Completed     | No          | Job closed                                      |

**Per-State Capabilities (INFERRED):**

| State         | Can Update? | Can Delete? | Available Actions    | Notes                        |
| ------------- | ----------- | ----------- | -------------------- | ---------------------------- |
| Quote Draft   | Yes         | Unknown     | GetPrice, edit lines | Editable before acceptance   |
| Quoted        | Limited     | Unknown     | accept / convert     | Convert is one-way           |
| In Production | No          | No          | view status          | Owned by production workflow |
| Shipped       | No          | No          | view status          |                              |

---

## Business Rules

### Ordering / Dependency Rules

- **Pricing is authoritative in printIQ** — call `GetPrice`; never compute prices client-side. [DOCUMENTED]
- A valid **product code + its required option/spec selections** is needed to get a price. [INFERRED]
- A quote (or punch-out order) must exist before an order/job is created — orders derive from accepted quotes / punch-out. [INFERRED]
- **Orders flow to the Production Board with artwork attached.** [DOCUMENTED]

### Field-Level Rules

- Field-level validation, max lengths, and required-field lists are `[UNKNOWN]` without the doc pack.
- `customerCode` / `quoteNo` / `jobNo` are assumed to be unique references within the instance. [INFERRED]

### Cascading Effects

- Accepting/converting a quote creates an order/job (one-way). [INFERRED]
- Deletion semantics are `[UNKNOWN]` — do not assume cascading deletes exist.

### Uniqueness Constraints

- `[UNKNOWN]` — discover from the doc pack. Reference codes are presumed unique per instance. [INFERRED]

### Computed / Read-Only Fields

- Quote `total` is computed from line items + GetPrice. [INFERRED]
- `createdDate` / timestamps are server-set. [INFERRED]
- Production status fields are owned by the production workflow, not directly writable via API. [INFERRED]

---

## Field Format Reference

| Format          | Pattern  | Example                  | Notes                                                    |
| --------------- | -------- | ------------------------ | -------------------------------------------------------- |
| Date / DateTime | ISO 8601 | `2026-05-29T10:00:00Z`   | [INFERRED]                                               |
| Currency        | number   | `1250.00`                | Currency from instance settings (NZD/AUD/etc) [INFERRED] |
| ID / reference  | string   | `"Q-100234"` and/or GUID | Likely a human ref + GUID pair [INFERRED]                |
| Enum values     | string   | —                        | Status enums `[UNKNOWN]`                                 |

---

## Enum Value Reference

`[UNKNOWN]` — no enum values are public. Discover all status/type enums from live responses. Anticipated
(INFERRED, do NOT rely on the exact strings):

| Entity    | Field       | Allowed Values (INFERRED — UNVERIFIED)                          | Notes                |
| --------- | ----------- | --------------------------------------------------------------- | -------------------- |
| Quote     | status      | `Draft`, `Quoted`, `Accepted`, `Cancelled`                      | Strings unverified   |
| Order/Job | status      | `Pending`, `In Production`, `Shipped`, `Completed`, `Cancelled` | Strings unverified   |
| Product   | productType | `Configurable`, `Inventory Item`                                | Two types DOCUMENTED |

---

_Generated from the investigation questionnaire, Phase 3 (web research only; no live call). All field/enum/path detail is inferred — discover real values before relying on them._

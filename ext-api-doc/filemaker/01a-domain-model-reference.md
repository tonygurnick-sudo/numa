---
api_name: 'Claris FileMaker Data API'
api_slug: 'filemaker'
generated_from: '00-api-investigation-questionnaire'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# Claris FileMaker Data API — Domain Model Reference

> Companion to `01-llm-api-rules.md`. The structural entities (Database → Layout → Record →
> Field/Portal/Container → Script → Session) and their relationships, state machines, and
> business rules.
>
> **The single most important fact about FileMaker: there is no fixed business domain model.**
> FileMaker is a database _platform_. The "entities" you care about (Customer, Order, Invoice…)
> are whatever **layouts** the customer's solution defines, exposing whatever **fields** they
> created. The API's own first-class entities are _structural_; the business entities are
> _tenant-defined_ and **must be discovered at runtime**. This is the same discovery-first
> posture as Podio / Dataverse — never assume a schema, never hard-code a field name.

---

## The Runtime Discovery Procedure (do this first, every time)

Because the schema is unknown until you look, every task starts with discovery:

```
1. GET /databases/{db}/layouts            → list layout names. Pick the layout that exposes
                                             the data you need (often a dedicated "API_*" layout).
2. GET /databases/{db}/layouts/{layout}   → fieldMetaData (names, types, read-only flags),
                                             portalMetaData (related sets), valueLists (picklists).
3. (optional) GET /databases/{db}/scripts → script names, for bulk / business-logic operations.
4. Only now build your query / fieldData using the EXACT names you just discovered.
```

Cache layout metadata per `(server, database, layout)` for the session — the schema is stable.
Never cache record data.

---

## Entity Catalog (structural — these ARE fixed)

### Database

**Resource path:** `/databases` (list names), then everything nests under `/databases/{database}`.
**Description:** A hosted `.fmp12` solution file. The connector's `database` credential names exactly one.
**CRUD:** Read (list names) only. Files are created/deleted in FileMaker Pro / Admin Console, not via the API.

### Layout

**Resource path:** `/databases/{database}/layouts` (list) · `/databases/{database}/layouts/{layout}` (metadata).
**Description:** A FileMaker layout is a view onto a table occurrence. **All record I/O is performed _through a
layout_, never directly against a table.** A record's available fields, portals and value lists are exactly
those placed on the chosen layout. Choosing the right layout is the key modelling decision for every call.
**CRUD:** Read (list + metadata) only via the API.

`GET .../layouts/{layout}` returns:

| Field            | Type   | Description                                                                                  |
| ---------------- | ------ | -------------------------------------------------------------------------------------------- |
| `fieldMetaData`  | array  | One object per field on the layout (see below).                                              |
| `portalMetaData` | object | Keyed by portal/object name; each value is an array of that portal's field metadata.         |
| `valueLists`     | array  | Each: `name`, `type` (`customList` / `field` / `byField`), `values:[{value, displayValue}]`. |

**`fieldMetaData[]` object:**

| Field                       | Type    | Description                                                                            | Example          |
| --------------------------- | ------- | -------------------------------------------------------------------------------------- | ---------------- |
| `name`                      | string  | Exact field name (case/space-sensitive)                                                | `"Product Name"` |
| `type`                      | string  | `normal` \| `calculation` \| `summary`                                                 | `"normal"`       |
| `result`                    | string  | Data result type: `text` \| `number` \| `date` \| `time` \| `timestamp` \| `container` | `"number"`       |
| `displayType`               | string  | UI control (e.g. `editText`, `popupList`, `checkBox`)                                  | `"editText"`     |
| `global`                    | boolean | True if this is a global field                                                         | `false`          |
| `repetitions` / `maxRepeat` | int     | Repeating-field counts                                                                 | `1`              |
| `notEmpty`                  | boolean | Required (validation)                                                                  | `true`           |
| `valueList`                 | string  | Name of an attached value list, if any                                                 | `"Categories"`   |

> **Rule:** `type` of `calculation` or `summary` ⇒ the field is **read-only**. Sending it in `fieldData` errors.

### Record

**Resource path:** `/databases/{database}/layouts/{layout}/records` and `.../records/{recordId}`.
**Description:** A row in the table backing the layout. Read/written as a flat `fieldData` object plus optional `portalData`.
**CRUD:** Create, Read (single + range + find), Update (PATCH), Delete — all supported.

**Record envelope (in responses):**

| Field        | Type   | Writable         | Description                                                                    | Example                 |
| ------------ | ------ | ---------------- | ------------------------------------------------------------------------------ | ----------------------- |
| `recordId`   | string | no               | Server-assigned internal row handle (integer-as-string). **NOT a user field.** | `"514"`                 |
| `modId`      | string | no               | Modification counter; optimistic-lock token on PATCH/DELETE.                   | `"1"`                   |
| `fieldData`  | object | yes (per field)  | Layout field values, keyed by exact field name.                                | `{"Stock": 40}`         |
| `portalData` | object | yes (via parent) | Related-record sets, keyed by portal/object name.                              | `{"Line Items": [...]}` |

**Relationships:**

| Related entity    | Type | Expression          | Notes                                                        |
| ----------------- | ---- | ------------------- | ------------------------------------------------------------ |
| Layout            | N:1  | path scope          | A record is always addressed _through_ a layout.             |
| Portal rows       | 1:N  | nested `portalData` | Related records, only if a portal for them is on the layout. |
| Field / Container | 1:N  | nested `fieldData`  | Columns the layout exposes.                                  |

### Field / Container (within `fieldData`)

**Description:** A tenant-defined column. FileMaker field types: text, number, date, time, timestamp, container,
calculation, summary. Calculation/summary are read-only. **Container** fields hold binary: on read they return a
short-lived **streaming URL** (`https://{server}/Streaming_SSL/...`); on write they require the multipart
container endpoint (out of scope for JSON-only `connect_request`).
**CRUD:** Writable iff the field is enterable on that layout and is not a calc/summary/auto-enter-only field.

### Portal (within `portalData`)

**Description:** A related-record set placed on the layout, returned under `portalData` keyed by the portal's
object name (or related table-occurrence name). Each portal row carries its own `recordId` and `modId`.
**CRUD:** Read with the parent. Portal rows are created/edited via the parent record's PATCH using
`"TableOccurrence::field"` keys (and the row's `recordId` for edits). See `01c`.

### Script

**Resource path:** `/databases/{database}/scripts` (list names) · `.../layouts/{layout}/script/{name}` (run).
**Description:** A named FileMaker script in the solution. **Invoked, not CRUD-managed.** Run standalone, or chain
onto a record/find call via `script`, `script.prerequest`, `script.presort` (each with a matching `.param`).
Scripts are the efficient path for bulk / multi-record / complex business operations.
**CRUD:** Execute only.

### Session (token)

**Resource path:** `/databases/{database}/sessions` (POST to create) · `/sessions/{token}` (DELETE to end).
**Description:** The auth lifecycle object. See state machine below and `01-llm-api-rules.md` § Auth.

---

## Entity Relationship Diagram

```
┌────────────────────┐
│  FileMaker Server  │  (= customer's server_url; self-hosted, per-tenant)
└─────────┬──────────┘
          │ 1:N
          ▼
   ┌────────────┐        hosts         ┌────────────┐
   │  Database  │─────────────────────>│   Script   │ (execute-only)
   │ (.fmp12)   │                      └────────────┘
   └─────┬──────┘
         │ 1:N (exposes)
         ▼
   ┌────────────┐  view onto a table occurrence
   │  Layout    │
   └─────┬──────┘
         │ 1:N (read/write THROUGH the layout)
         ▼
   ┌────────────┐  1:N    ┌──────────────┐
   │  Record    │────────>│ Portal rows  │ (related records; own recordId/modId)
   │ recordId,  │         └──────────────┘
   │ modId      │
   └─────┬──────┘
         │ contains
         ▼
   ┌──────────────────┐
   │ Field / Container │  (text, number, date, time, timestamp, container, calc, summary)
   └──────────────────┘
```

Relationships between _business_ tables (Customer → Order → LineItem) live only in the customer's
relationship graph and surface to the API as **portals on a layout**. There is no generic "include
related entity by ID" — you see related data only if a portal for it is on the layout you query.

---

## State Machines

### Session / Token Lifecycle (the only API-level state machine)

```
[no session] ──POST /sessions (Basic)──> [active token]
[active token] ──any authenticated call──> [active token]   (15-min idle clock RESET each call)
[active token] ──15 min idle──> [expired]                   (next call → error 952)
[active token] ──DELETE /sessions/{token}──> [logged out]
[expired] ──POST /sessions (Basic)──> [new active token]
```

| From         | Action / Trigger         | To           | Reversible?    | Side Effects                                |
| ------------ | ------------------------ | ------------ | -------------- | ------------------------------------------- |
| no session   | POST /sessions (Basic)   | active token | n/a            | Consumes one of the server's session slots. |
| active token | any authenticated call   | active token | n/a            | Resets the 15-min idle timer.               |
| active token | 15 min idle              | expired      | yes (re-login) | Token rejected → error `952`.               |
| active token | DELETE /sessions/{token} | logged out   | yes (re-login) | Frees the session slot immediately.         |

### Record "lifecycle"

There is **no built-in record state machine.** Business statuses (draft/approved/closed…) are ordinary
tenant-defined field values — they live in `fieldData` and you transition them with a normal PATCH. The only
record-level concurrency control is `modId` optimistic locking (see Business Rules).

---

## Business Rules

### Ordering / Dependency Rules

- **Discover before you touch data.** Resolve layout → field names via metadata before any read/write.
- **Everything is layout-scoped.** Pick a layout that exposes the fields you need; a field absent from the
  layout is invisible and unwritable through that call.
- **Bulk = script.** There are no batch endpoints. For multi-record work, prefer a server-side FileMaker
  script invoked via the script endpoint (atomic from the API's perspective) over looping single-record calls.

### Field-Level Rules

- **Names are case- and space-exact**, tenant-defined, URL-encoded in paths, used verbatim in JSON.
- **Calculation and summary fields are read-only** — never send them in `fieldData`.
- **Validation is enforced on write** — required (`notEmpty`), value-list, unique, and calc validations defined
  in the schema reject the write with a FileMaker error code (e.g. `504` for a duplicate unique value).
- **Dates/times follow the file's settings** unless you pass `dateformats` (`0`=US, `1`=file locale, `2`=ISO 8601).
  Prefer `dateformats:2` and ISO strings.

### Concurrency / Optimistic Locking

- Send the record's current `modId` on PATCH/DELETE. If it no longer matches, the change is rejected (the record
  was modified by someone else). Omit `modId` to force the write (last-write-wins).

### Computed / Read-Only Fields

- `recordId` — server-assigned row handle, set on create, never changes.
- `modId` — increments on every successful edit of the record.
- Calculation / summary fields — recomputed by FileMaker; never directly writable.

---

## Field Format Reference

| Format               | Pattern                                   | Example                                     | Notes                                                                     |
| -------------------- | ----------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| Date                 | `MM/DD/YYYY`, or ISO with `dateformats:2` | `01/20/2029` / `2029-01-20`                 | Default follows the file; pass `dateformats` to control. ISO recommended. |
| DateTime (timestamp) | `MM/DD/YYYY HH:MM:SS`, or ISO             | `2029-01-20T13:45:00`                       | Same `dateformats` rule.                                                  |
| Time                 | `HH:MM:SS`                                | `13:45:00`                                  |                                                                           |
| Number               | JSON number or numeric string             | `40` / `"40"`                               | FileMaker is lenient; strings are coerced.                                |
| Currency             | plain number                              | `1234.56`                                   | No symbol; currency formatting is presentation-only.                      |
| `recordId`           | integer-as-string                         | `"514"`                                     | Server-assigned, NOT a user field.                                        |
| `modId`              | integer-as-string                         | `"1"`                                       | Optimistic-lock token.                                                    |
| Container            | URL (read) / multipart (write)            | `https://{server}/Streaming_SSL/MainDB/...` | Binary via streaming URL; upload out of scope.                            |
| Enum values          | tenant value-lists                        | —                                           | Allowed values come from `valueLists` in layout metadata, not the API.    |

---

## Enum Value Reference

There are **no global enums.** Every picklist is a customer-defined **value list**, discovered via
`GET .../layouts/{layout}` → `valueLists[]`. The only fixed enumerations are API-level controls:

| Context        | Field         | Allowed Values                                             | Notes                                  |
| -------------- | ------------- | ---------------------------------------------------------- | -------------------------------------- |
| Sort           | `sortOrder`   | `ascend`, `descend`, or a value-list name                  | In `_sort` / find `sort`.              |
| Create/Edit    | `dateformats` | `0` (US), `1` (file locale), `2` (ISO 8601)                | Controls date parsing on write.        |
| Field metadata | `result`      | `text`, `number`, `date`, `time`, `timestamp`, `container` | From layout metadata.                  |
| Field metadata | `type`        | `normal`, `calculation`, `summary`                         | `calculation`/`summary` are read-only. |

---

_Generated from the investigation questionnaire, Phase 3. Confidence: medium — endpoint shapes and metadata
structure are `[DOCUMENTED]`; the customer's specific layouts/fields/scripts/value-lists are `[UNKNOWN]` until
runtime discovery._

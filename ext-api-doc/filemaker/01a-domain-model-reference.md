---
api_name: Claris FileMaker Data API
api_slug: filemaker
base_url: https://{server_url}/fmi/data/vLatest/databases/{database}
path_version_segment: vLatest (real path segment, in the URL — not a label)
companion_to: 01-llm-api-rules.md
scope: structural entities (Database→Layout→Record→Field/Portal/Container→Script→Session) + runtime discovery procedure
confidence: endpoint shapes + metadata structure [DOCUMENTED]; customer layouts/fields/scripts/value-lists [UNKNOWN] until runtime discovery
---

# Claris FileMaker Data API — Domain Model Reference

**There is no fixed business domain model.** FileMaker is a database _platform_. The entities you care about (Customer, Order, Invoice…) are whatever **layouts** the customer defined, exposing whatever **fields** they created. The API's first-class entities are _structural_; business entities are _tenant-defined_ and **must be discovered at runtime**. Same discovery-first posture as Podio/Dataverse — never assume a schema, never hard-code a field name.

## Runtime Discovery Procedure (do this first, every time)

```
1. GET /layouts            → layout names. Pick the one exposing the data you need (often a dedicated "API_*" layout).
2. GET /layouts/{layout}   → fieldMetaData (names, types, read-only flags), portalMetaData (related sets), valueLists (picklists).
3. (optional) GET /scripts → script names, for bulk/business-logic ops.
4. Build query/fieldData using the EXACT names you just discovered.
```

Cache layout metadata per `(server, database, layout)` for the session (schema is stable). Never cache record data.

## Entity Catalog (structural — these ARE fixed)

### Database

Path: `/databases` (list names), then everything nests under `/databases/{database}`. A hosted `.fmp12` solution file; the `database` credential names exactly one. **CRUD:** Read (list names) only — files are created/deleted in FileMaker Pro / Admin Console, not the API.

### Layout

Path: `/layouts` (list) · `/layouts/{layout}` (metadata). A view onto a table occurrence. **All record I/O goes through a layout, never directly against a table.** A record's available fields/portals/value-lists are exactly those placed on the chosen layout — picking the right layout is the key modelling decision for every call. **CRUD:** Read only via API.

`GET /layouts/{layout}` returns:
| Field | Type | Description |
| --- | --- | --- |
| `fieldMetaData` | array | one object per field on the layout (below) |
| `portalMetaData` | object | keyed by portal/object name; each value = array of that portal's field metadata |
| `valueLists` | array | each: `name`, `type` (`customList`/`field`/`byField`), `values:[{value,displayValue}]` |

**`fieldMetaData[]` object:**
| Field | Type | Description | Example |
| --- | --- | --- | --- |
| `name` | string | exact field name (case/space-sensitive) | `"Product Name"` |
| `type` | string | `normal`\|`calculation`\|`summary` | `"normal"` |
| `result` | string | `text`\|`number`\|`date`\|`time`\|`timestamp`\|`container` | `"number"` |
| `displayType` | string | UI control (`editText`,`popupList`,`checkBox`) | `"editText"` |
| `global` | boolean | true if a global field | `false` |
| `repetitions`/`maxRepeat` | int | repeating-field counts | `1` |
| `notEmpty` | boolean | required (validation) | `true` |
| `valueList` | string | name of attached value list, if any | `"Categories"` |

> `type` `calculation` or `summary` ⇒ field is **read-only**; sending it in `fieldData` errors.

### Record

Path: `/layouts/{layout}/records` and `.../records/{recordId}`. A row in the table backing the layout; read/written as a flat `fieldData` object + optional `portalData`. **CRUD:** Create, Read (single+range+find), Update (PATCH), Delete — all supported.

**Record envelope (in responses):**
| Field | Type | Writable | Description | Example |
| --- | --- | --- | --- | --- |
| `recordId` | string | no | server-assigned internal row handle (integer-as-string). **NOT a user field.** | `"514"` |
| `modId` | string | no | modification counter; optimistic-lock token on PATCH/DELETE | `"1"` |
| `fieldData` | object | yes (per field) | layout field values, keyed by exact field name | `{"Stock":40}` |
| `portalData` | object | yes (via parent) | related-record sets, keyed by portal/object name | `{"Line Items":[...]}` |

**Relationships:** Layout N:1 (record addressed _through_ a layout). Portal rows 1:N (nested `portalData`; related records, only if a portal for them is on the layout). Field/Container 1:N (nested `fieldData`; columns the layout exposes).

### Field / Container (within `fieldData`)

A tenant-defined column. Types: text, number, date, time, timestamp, container, calculation, summary. Calc/summary read-only. **Container** holds binary: on read returns a short-lived **streaming URL** (`https://{server}/Streaming_SSL/...`); on write requires the multipart container endpoint (out of scope for JSON-only `connect_request`). **CRUD:** writable iff enterable on that layout and not calc/summary/auto-enter-only.

### Portal (within `portalData`)

A related-record set on the layout, returned under `portalData` keyed by the portal's object name (or related table-occurrence name); each row carries its own `recordId`/`modId`. **CRUD:** read with the parent; rows created/edited via the parent record's PATCH using `"TableOccurrence::field"` keys (+ the row's `recordId` for edits). See `01c`.

### Script

Path: `/scripts` (list names) · `/layouts/{layout}/script/{name}` (run). A named FileMaker script. **Invoked, not CRUD-managed.** Run standalone, or chain onto a record/find call via `script`, `script.prerequest`, `script.presort` (each with a matching `.param`). The efficient path for bulk/multi-record/complex business ops. **CRUD:** Execute only.

### Session (token)

Path: `/sessions` (POST to create) · `/sessions/{token}` (DELETE to end). The auth lifecycle object — see state machine below and `01` § Auth.

## Entity Relationship Diagram

```
FileMaker Server (= customer's server_url; self-hosted, per-tenant)
  └─1:N─ Database (.fmp12) ──hosts──> Script (execute-only)
            └─1:N (exposes)─ Layout (view onto a table occurrence)
                  └─1:N (read/write THROUGH the layout)─ Record (recordId, modId)
                        ├─1:N─ Portal rows (related records; own recordId/modId)
                        └─contains─ Field/Container (text,number,date,time,timestamp,container,calc,summary)
```

Business-table relationships (Customer→Order→LineItem) live only in the customer's relationship graph and surface to the API as **portals on a layout**. There is no generic "include related entity by ID" — you see related data only via a portal on the layout you query.

## State Machines

### Session / Token Lifecycle (the only API-level state machine)

```
[no session]   ──POST /sessions (Basic)──>      [active token]   (consumes a session slot)
[active token] ──any authenticated call──>      [active token]   (15-min idle clock RESET each call)
[active token] ──15 min idle──>                 [expired]        (next call → error 952)
[active token] ──DELETE /sessions/{token}──>    [logged out]     (frees the slot immediately)
[expired]      ──POST /sessions (Basic)──>      [new active token]
```

Expired/logged-out → reversible by re-login.

### Record "lifecycle"

No built-in record state machine. Business statuses (draft/approved/closed…) are ordinary tenant-defined field values — they live in `fieldData`; transition them with a normal PATCH. The only record-level concurrency control is `modId` optimistic locking.

## Business Rules

- **Discover before you touch data.** Resolve layout → field names via metadata before any read/write.
- **Everything is layout-scoped.** A field absent from the targeted layout is invisible + unwritable through that call.
- **Bulk = script.** No batch endpoints; prefer a server-side script (atomic from the API's view) over looping single-record calls.
- **Names are case/space-exact**, tenant-defined, URL-encoded in paths, verbatim in JSON.
- **Calc/summary fields are read-only** — never in `fieldData`.
- **Validation enforced on write** — required (`notEmpty`), value-list, unique, calc validations reject with a FileMaker error code (e.g. `504` for a duplicate unique value).
- **Dates/times** follow the file's settings unless you pass `dateformats` (`0`=US, `1`=file locale, `2`=ISO 8601). Prefer `dateformats:2` + ISO strings.
- **Optimistic locking:** send the record's current `modId` on PATCH/DELETE; if it no longer matches, the change is rejected (modified by someone else). Omit `modId` to force (last-write-wins).
- **Computed/read-only:** `recordId` (set on create, never changes), `modId` (increments on every successful edit), calc/summary fields (recomputed by FileMaker, never directly writable).

## Field Format Reference

| Format               | Pattern                                   | Example                                     | Notes                                                            |
| -------------------- | ----------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| Date                 | `MM/DD/YYYY`, or ISO with `dateformats:2` | `01/20/2029` / `2029-01-20`                 | default follows file; ISO recommended                            |
| DateTime (timestamp) | `MM/DD/YYYY HH:MM:SS`, or ISO             | `2029-01-20T13:45:00`                       | same `dateformats` rule                                          |
| Time                 | `HH:MM:SS`                                | `13:45:00`                                  |                                                                  |
| Number               | JSON number or numeric string             | `40` / `"40"`                               | FileMaker coerces strings                                        |
| Currency             | plain number                              | `1234.56`                                   | no symbol; formatting is presentation-only                       |
| `recordId`           | integer-as-string                         | `"514"`                                     | server-assigned, NOT a user field                                |
| `modId`              | integer-as-string                         | `"1"`                                       | optimistic-lock token                                            |
| Container            | URL (read) / multipart (write)            | `https://{server}/Streaming_SSL/MainDB/...` | binary via streaming URL; upload out of scope                    |
| Enum values          | tenant value-lists                        | —                                           | allowed values from `valueLists` in layout metadata, not the API |

## Enum Value Reference

**No global enums.** Every picklist is a customer-defined **value list** from `GET /layouts/{layout}` → `valueLists[]`. The only fixed enumerations are API-level controls:
| Context | Field | Allowed Values | Notes |
| --- | --- | --- | --- |
| Sort | `sortOrder` | `ascend`, `descend`, or a value-list name | in `_sort` / find `sort` |
| Create/Edit | `dateformats` | `0` (US), `1` (file locale), `2` (ISO 8601) | controls date parsing on write |
| Field metadata | `result` | `text`,`number`,`date`,`time`,`timestamp`,`container` | from layout metadata |
| Field metadata | `type` | `normal`,`calculation`,`summary` | `calculation`/`summary` are read-only |

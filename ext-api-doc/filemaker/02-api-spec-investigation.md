---
api_name: 'Claris FileMaker Data API'
api_slug: 'filemaker'
base_url: 'https://{server_url}/fmi/data/vLatest/databases/{database}'
version: 'vLatest (FM17+; per-server release-pinned)'
spec_format: 'none (no single canonical spec — served live per-server at /fmi/data/apidoc/)'
spec_url: 'https://{server_url}/fmi/data/apidoc/ (OpenAPI, per-server)'
docs_url: 'https://help.claris.com/en/data-api-guide/content/index.html'
date_researched: '2026-05-29'
---

# Claris FileMaker Data API — API Specification & Investigation

> Clean developer reference for the Claris FileMaker Data API. This is the condensed
> output of the investigation questionnaire (`00-api-investigation-questionnaire.md`) —
> everything a developer needs to integrate with this API, in one place.
>
> **No live call was made during research.** Every FileMaker install is a private,
> per-tenant server (FileMaker Server on-prem or FileMaker Cloud); there is no shared
> public endpoint or sandbox. Endpoint shapes and the auth flow are `[DOCUMENTED]` from
> the official Claris Data API Guide and independently re-verified against
> help.claris.com on 2026-05-29. The customer's actual layouts, fields, scripts and value
> lists are `[UNKNOWN]` until discovered at runtime — there is **no fixed domain model**.

---

## Overview

- **Vendor:** Claris International Inc. (an Apple company)
- **API version:** Path segment `vLatest` (recommended) or pinned `v1`. The on-disk version tracks the FileMaker Server release (FM17 introduced the official Data API; FM18/19/2023/2024 extend it).
- **Base URL:** `https://{server_url}/fmi/data/vLatest/databases/{database}`
  - `{server_url}` = the customer's FileMaker Server / FileMaker Cloud host (the connector's `server_url` credential, e.g. `https://myserver.fmi.filemaker-cloud.com`)
  - `{database}` = the hosted `.fmp12` solution name (the connector's `database` credential, e.g. `Inventory`)
- **Sandbox URL:** None operated by Claris. Each customer's own server is the only environment.
- **API type:** REST (JSON over HTTPS, HTTP/1.1). SSL/TLS required.
- **Data format:** JSON. Container (binary) fields use separate streaming-URL download / multipart upload.
- **Documentation:** [help.claris.com/en/data-api-guide](https://help.claris.com/en/data-api-guide/content/index.html)
- **API reference:** Task-organised guide (one page per operation), plus a **live per-server OpenAPI UI** at `https://{server_url}/fmi/data/apidoc/`.
- **OpenAPI spec:** Not a single hosted spec — served live per-server at `/fmi/data/apidoc/`, pinned to that server's version.
- **Status page:** N/A — self-hosted per tenant; there is no Claris-operated status page for a customer's own server.

**Summary:** The FileMaker Data API is a REST/JSON interface to a customer's FileMaker
solution (a hosted `.fmp12` database). It exposes records, finds, layout/script metadata
and script execution — all scoped through **layouts** (table views), not raw tables. It is
the data-access surface for FileMaker Pro solutions; used to read/write business records,
run server-side scripts, and discover a solution's structure programmatically.

> **The one fact that frames everything else:** FileMaker is a database _platform_, so the
> "entities" are whatever the customer's solution defines. There is no shipped object model.
> Discover the tenant's structure (layouts → fields → value lists → scripts) at runtime
> before reading or writing. Never guess a field/layout/script name.

---

## Authentication

### Method: Basic login → short-lived session Bearer token

This is the defining quirk of FileMaker. Auth is a **two-step, short-lived session token** —
not a static API key, and **not OAuth** for this connector. (FileMaker Cloud also supports a
Claris-ID `FMID` token flow, but the Numa connector uses the on-prem/standard Basic→token
flow against the four credential fields.)

**Step 1 — log in (Basic credentials → token):**

```http
POST /fmi/data/vLatest/databases/{database}/sessions HTTP/1.1
Host: {server_url}
Authorization: Basic {base64(username:password)}
Content-Type: application/json

{}
```

Response (HTTP 200) — token is in the body **and** echoed in the `X-FM-Data-Access-Token` header:

```json
{
  "response": { "token": "c4d2e429122e9cdeda19bb23c55cd2a8f282c3cc50c60943a110" },
  "messages": [{ "code": "0", "message": "OK" }]
}
```

**Step 2 — every subsequent call uses the token as a Bearer:**

```
Authorization: Bearer c4d2e429122e9cdeda19bb23c55cd2a8f282c3cc50c60943a110
```

**Header format:**

```
# Login (once):
Authorization: Basic {base64(username:password)}
Content-Type: application/json

# All later calls:
Authorization: Bearer {session-token}
Content-Type: application/json     ← request bodies only
```

**Token lifecycle (critical):**

| Property          | Value                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Token type        | Opaque session token (not a JWT)                                                                      |
| Lifetime          | Valid until logout **or 15 minutes after the last call that used it** — sliding idle timeout          |
| Idle reset        | Each authenticated call resets the 15-min clock (the `validateSession` probe does **not** extend it)  |
| Refresh mechanism | **None.** No refresh token. When it expires, log in again (`POST .../sessions`)                       |
| Expiry signal     | Next call after expiry returns FileMaker error code `952` (invalid token) in `messages[].code`        |
| Recovery          | On `952`: re-login and retry the call **once**                                                        |
| Logout            | `DELETE /fmi/data/vLatest/databases/{database}/sessions/{token}` — frees a server session slot        |
| Scarce resource   | Concurrent Data API session slots (configurable cap on the server); reuse one token, log out promptly |

**Permissions model:** Governed by the FileMaker **account's privilege set** inside the
database. The account must have the `fmrest` extended privilege enabled, and data access is
whatever that privilege set grants. There are no OAuth scopes.

**Server-side prerequisites:** (a) Data API enabled in the FileMaker Server Admin Console;
(b) the database hosted with the `fmrest` extended privilege granted to the account;
(c) a valid SSL certificate (self-signed certs fail unless trusted). [DOCUMENTED]

> **CORS note:** The Data API does **not** support CORS or the `OPTIONS` method. This is
> irrelevant for Numa — every call is server-side via `connect_request`, never browser-direct.

---

## Endpoint Catalog

> All paths below are relative to `https://{server_url}/fmi/data/vLatest`. All except
> login / `productinfo` / `databases` require `Authorization: Bearer {token}`.

### Sessions (auth lifecycle)

| Method | Path                               | Purpose        | Auth          | Paginated | Idempotent |
| ------ | ---------------------------------- | -------------- | ------------- | --------- | ---------- |
| POST   | `/databases/{db}/sessions`         | Log in → token | Basic         | No        | No         |
| DELETE | `/databases/{db}/sessions/{token}` | Log out        | token-in-path | No        | Yes        |

### Metadata / discovery (foundational — run first)

| Method | Path                               | Purpose                                      | Auth   | Paginated | Idempotent |
| ------ | ---------------------------------- | -------------------------------------------- | ------ | --------- | ---------- |
| GET    | `/productinfo`                     | Host product/version info                    | No     | No        | Yes        |
| GET    | `/databases`                       | List Data-API-enabled databases              | No\*   | No        | Yes        |
| GET    | `/databases/{db}/layouts`          | List layout names                            | Bearer | No        | Yes        |
| GET    | `/databases/{db}/layouts/{layout}` | Layout metadata (fields/portals/value lists) | Bearer | No        | Yes        |
| GET    | `/databases/{db}/scripts`          | List script names                            | Bearer | No        | Yes        |

\* `GET /databases` may require Basic credentials depending on server config.

### Records (the read/write surface — all scoped through a layout)

| Method | Path                                                  | Purpose              | Auth   | Paginated                   | Idempotent       |
| ------ | ----------------------------------------------------- | -------------------- | ------ | --------------------------- | ---------------- |
| GET    | `/databases/{db}/layouts/{layout}/records`            | Get range of records | Bearer | Yes (`_offset`/`_limit`)    | Yes              |
| GET    | `/databases/{db}/layouts/{layout}/records/{recordId}` | Get one record       | Bearer | No                          | Yes              |
| POST   | `/databases/{db}/layouts/{layout}/_find`              | Find (query) records | Bearer | Yes (body `offset`/`limit`) | Yes              |
| POST   | `/databases/{db}/layouts/{layout}/records`            | Create record        | Bearer | No                          | No               |
| PATCH  | `/databases/{db}/layouts/{layout}/records/{recordId}` | Edit record          | Bearer | No                          | Yes (per record) |
| DELETE | `/databases/{db}/layouts/{layout}/records/{recordId}` | Delete record        | Bearer | No                          | Yes              |

### Scripts, globals, containers

| Method | Path                                                                                      | Purpose                 | Auth   | Notes                                                                    |
| ------ | ----------------------------------------------------------------------------------------- | ----------------------- | ------ | ------------------------------------------------------------------------ |
| GET    | `/databases/{db}/layouts/{layout}/script/{scriptName}`                                    | Run a script standalone | Bearer | `?script.param=`                                                         |
| PATCH  | `/databases/{db}/layouts/{layout}/globals`                                                | Set global field values | Bearer | Per-session globals                                                      |
| POST   | `/databases/{db}/layouts/{layout}/records/{recordId}/containers/{fieldName}/{repetition}` | Upload container data   | Bearer | `multipart/form-data` — **out of scope for JSON-only `connect_request`** |

> A script can also be **chained** onto a record/find call via the body keys `script`,
> `script.prerequest`, `script.presort` (+ matching `.param`) — useful for running business
> logic as part of a read/write.

### Full Endpoint Index

| #   | Method | Path                                                                                      | Purpose                   | Notes                                                               |
| --- | ------ | ----------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| 1   | GET    | `/productinfo`                                                                            | Host product/version info | `name, version, buildDate, dateFormat, timeFormat, timeStampFormat` |
| 2   | GET    | `/databases`                                                                              | List enabled databases    | May require Basic                                                   |
| 3   | POST   | `/databases/{db}/sessions`                                                                | Log in → token            | Body `{}`                                                           |
| 4   | DELETE | `/databases/{db}/sessions/{token}`                                                        | Log out                   | token-in-path                                                       |
| 5   | GET    | `/databases/{db}/layouts`                                                                 | List layout names         | Discovery                                                           |
| 6   | GET    | `/databases/{db}/layouts/{layout}`                                                        | Layout metadata           | Discovery                                                           |
| 7   | GET    | `/databases/{db}/scripts`                                                                 | List script names         | Execute-only                                                        |
| 8   | GET    | `/databases/{db}/layouts/{layout}/records`                                                | Get range of records      | `_offset`/`_limit`/`_sort`                                          |
| 9   | GET    | `/databases/{db}/layouts/{layout}/records/{recordId}`                                     | Get one record            |                                                                     |
| 10  | POST   | `/databases/{db}/layouts/{layout}/records`                                                | Create record             | Returns new `recordId`                                              |
| 11  | PATCH  | `/databases/{db}/layouts/{layout}/records/{recordId}`                                     | Edit record               | `modId` optimistic lock                                             |
| 12  | DELETE | `/databases/{db}/layouts/{layout}/records/{recordId}`                                     | Delete record             | Second delete → `101`                                               |
| 13  | POST   | `/databases/{db}/layouts/{layout}/_find`                                                  | Find (query) records      | `401` = no matches                                                  |
| 14  | PATCH  | `/databases/{db}/layouts/{layout}/globals`                                                | Set global field values   | Per-session globals                                                 |
| 15  | GET    | `/databases/{db}/layouts/{layout}/script/{scriptName}`                                    | Run a script (standalone) | `?script.param=`                                                    |
| 16  | POST   | `/databases/{db}/layouts/{layout}/records/{recordId}/containers/{fieldName}/{repetition}` | Upload container          | multipart                                                           |

---

## Data Models

> **There is no fixed business object model.** FileMaker's _first-class_ entities are
> structural (Database → Layout → Record → Field/Portal/Container → Script → Session). The
> _business_ entities (Customer, Order, Invoice, …) are whatever layouts/fields the customer
> built and must be discovered at runtime via the metadata endpoints. The models below are
> the structural envelope you always receive; field names inside `fieldData` are tenant-defined.

### Record envelope (returned by get-range, get-one, `_find`)

| Field        | Type   | Required | Writable | Description                                                                                      |
| ------------ | ------ | -------- | -------- | ------------------------------------------------------------------------------------------------ |
| `recordId`   | string | —        | no       | Server-assigned internal row handle (integer-as-string, e.g. `"12"`). **Not a user field.**      |
| `modId`      | string | —        | no       | Modification counter; used for optimistic locking on PATCH/DELETE                                |
| `fieldData`  | object | —        | yes\*    | All layout field values, keyed by exact (tenant-defined) field name                              |
| `portalData` | object | —        | yes\*    | Related-record sets, keyed by portal/object name; each portal row has its own `recordId`/`modId` |

\* Writable iff the field is enterable on that layout and not a calculation/summary/auto-enter-only field.

### `dataInfo` (returned alongside `data` on reads)

| Field              | Type    | Description                             |
| ------------------ | ------- | --------------------------------------- |
| `database`         | string  | Database name                           |
| `layout`           | string  | Layout queried                          |
| `table`            | string  | Underlying table occurrence             |
| `totalRecordCount` | integer | Total records in the whole table        |
| `foundCount`       | integer | Records matching this query / found set |
| `returnedCount`    | integer | Records on this page                    |

### Layout metadata (`GET .../layouts/{layout}`)

| Field            | Type   | Description                                                                                                                                                                                            |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fieldMetaData`  | array  | Per field: `name`, `type` (`normal`/`calculation`/`summary`), `result` (`text`/`number`/`date`/`time`/`timestamp`/`container`), `global`, `repetitions`, `maxRepeat`, `notEmpty`, optional `valueList` |
| `portalMetaData` | object | Per-portal field metadata (same shape, keyed by portal name)                                                                                                                                           |
| `valueLists`     | array  | Per value list: `name`, `type`, `values[]` (`value` / `displayValue`)                                                                                                                                  |

> `type: "calculation"` and `type: "summary"` fields are **read-only** — never send them in
> `fieldData`. Picklist options come from `valueLists`, not a global enum.

**Relationships:** Business-table relationships (e.g. Customer→Order→LineItem) live in the
customer's relationship graph and surface to the API **only as portals on a layout**. There
is no generic "include related entity by ID"; you see related data only if a portal for it
is on the layout you query.

### Field format reference

| Format    | Pattern                                  | Example                              | Notes                                                                     |
| --------- | ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| Date      | `MM/DD/YYYY` or ISO with `dateformats:2` | `01/20/2029` / `2029-01-20`          | Default follows the file; pass `dateformats` to control. ISO recommended. |
| Timestamp | `MM/DD/YYYY HH:MM:SS` or ISO             | `2029-01-20T13:45:00`                | Same `dateformats` rule.                                                  |
| Time      | `HH:MM:SS`                               | `13:45:00`                           |                                                                           |
| Number    | JSON number or numeric string            | `40` / `"40"`                        | FileMaker coerces strings.                                                |
| Container | URL (read) / multipart (write)           | `https://{server}/Streaming_SSL/...` | Binary served via short-lived streaming URL.                              |
| recordId  | integer-as-string                        | `"12"`                               | Server-assigned, not a user field.                                        |
| modId     | integer-as-string                        | `"3"`                                | Optimistic-lock token.                                                    |

### Worked request/response examples

**Get a range of records:**

```http
GET /databases/Inventory/layouts/Products/records?_offset=1&_limit=2
Authorization: Bearer {token}
```

```json
{
  "response": {
    "data": [
      {
        "recordId": "1",
        "modId": "0",
        "fieldData": { "Product Name": "Widget", "Stock": 40, "SKU": "W-001" },
        "portalData": {}
      },
      {
        "recordId": "2",
        "modId": "3",
        "fieldData": { "Product Name": "Gadget", "Stock": 7, "SKU": "G-007" },
        "portalData": {}
      }
    ],
    "dataInfo": {
      "database": "Inventory",
      "layout": "Products",
      "table": "Products",
      "totalRecordCount": 500,
      "foundCount": 500,
      "returnedCount": 2
    }
  },
  "messages": [{ "code": "0", "message": "OK" }]
}
```

**Create a record** → returns the new `recordId`:

```http
POST /databases/Inventory/layouts/Products/records
Authorization: Bearer {token}
Content-Type: application/json

{ "fieldData": { "Product Name": "Gizmo", "Stock": 100, "SKU": "GZ-1" } }
```

```json
{ "response": { "recordId": "514", "modId": "0" }, "messages": [{ "code": "0", "message": "OK" }] }
```

**Edit a record** with optimistic locking → bumps `modId`:

```http
PATCH /databases/Inventory/layouts/Products/records/514
Authorization: Bearer {token}
Content-Type: application/json

{ "fieldData": { "Stock": 95 }, "modId": "0" }
```

```json
{ "response": { "modId": "1" }, "messages": [{ "code": "0", "message": "OK" }] }
```

---

## Pagination

- **Type:** Offset-based, **1-based**.
- **Default page size:** 100 records (50 for portal rows).
- **Max page size:** No documented hard cap; bounded by server memory / config. Keep `_limit` reasonable (100–500). [INFERRED]
- **Total count:** Available via `response.dataInfo.foundCount` (matching the query) and `totalRecordCount` (whole table).

**Parameters:**

| Parameter                              | Type    | Default | Description                                                           |
| -------------------------------------- | ------- | ------- | --------------------------------------------------------------------- |
| `_offset` (GET) / `offset` (find body) | integer | 1       | 1-based index of the first record to return                           |
| `_limit` (GET) / `limit` (find body)   | integer | 100     | Maximum records to return                                             |
| `_sort` (GET) / `sort` (find body)     | JSON    | —       | `[{"fieldName":"Stock","sortOrder":"descend"}]` (URL-encoded for GET) |
| `_offset.{portal}` / `_limit.{portal}` | integer | 1 / 50  | Per-portal pagination                                                 |

**Response structure:**

```json
{
  "response": {
    "data": [
      /* ...records... */
    ],
    "dataInfo": {
      "foundCount": 240,
      "returnedCount": 100,
      "totalRecordCount": 240,
      "database": "Inventory",
      "layout": "Products",
      "table": "Products"
    }
  },
  "messages": [{ "code": "0", "message": "OK" }]
}
```

**Last page detection:** `offset + returnedCount - 1 >= foundCount`, OR `returnedCount < limit`, OR `data` empty.

**Worked example:**

```
Page 1: GET .../records?_offset=1&_limit=100    → foundCount=240, returnedCount=100
Page 2: GET .../records?_offset=101&_limit=100  → returnedCount=100
Page 3: GET .../records?_offset=201&_limit=100  → returnedCount=40  (40 < 100 → last page)
```

> For `_find`, put `offset` / `limit` / `sort` (no leading underscore) in the JSON body.

---

## Query & Filter Capabilities

Find criteria are an array of request objects in the `_find` body. **Multiple objects in
`query[]` are OR'd; multiple fields within one object are AND'd.** An object with
`"omit":"true"` excludes its matches.

```json
{
  "query": [
    { "Stock": "<40", "Category": "Tools" }, // AND: low stock AND Tools
    { "Category": "Clearance" }, // OR this whole condition
    { "Status": "Discontinued", "omit": "true" } // ...but OMIT discontinued
  ],
  "sort": [{ "fieldName": "Stock", "sortOrder": "descend" }],
  "limit": "10",
  "offset": "1",
  "portal": ["Line Items"],
  "limit.Line Items": "5"
}
```

**Operators (placed at the start of the value string):**

| Capability         | Syntax                                               | Notes                                 |
| ------------------ | ---------------------------------------------------- | ------------------------------------- |
| Exact / whole-word | `"=value"`                                           | `==value` for exact field content     |
| Comparison         | `"<40"`, `">10"`, `"<=5"`, `">=5"`                   | Prefix the value                      |
| Range              | `"1...10"` / `"01/01/2026...03/31/2026"`             | FileMaker `...` range operator        |
| Wildcards          | `*` (any), `?` (one char), `#` (digit), `@` (letter) | No regex                              |
| Empty / non-empty  | `"=="` (empty) / `"*"` (any non-empty)               |                                       |
| Omit (NOT)         | `{ "Field": "x", "omit": "true" }`                   | Excludes the matching set             |
| Sort direction     | `"ascend"` / `"descend"`                             | Or a value-list name for custom order |

| Capability                      | Supported? | Notes                                                                                 |
| ------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| Filter by field value           | Yes        | `{"Field":"value"}`                                                                   |
| Filter by date range            | Yes        | `...` range operator                                                                  |
| Full-text search                | Partial    | Word-based "contains"; not arbitrary substring                                        |
| Sort (multi-key, asc/desc)      | Yes        | `sort:[{fieldName, sortOrder}]`                                                       |
| Field selection / sparse fields | No         | You always get every field on the layout — target a leaner layout (`layout.response`) |
| Include related records         | Yes        | `portal:[...]` — only portals present on the layout                                   |
| Aggregate / count               | Partial    | `dataInfo.foundCount` / `totalRecordCount`; no GROUP BY                               |
| Logical AND / OR                | Yes        | AND = same object; OR = separate objects                                              |
| Regex / pattern                 | No         | FileMaker wildcards only                                                              |

**No global search endpoint** — search is always per-layout via `_find`. To return fewer
fields, point at a leaner layout (customers often build dedicated "API layouts").

---

## Rate Limits

| Scope               | Limit                          | Window |
| ------------------- | ------------------------------ | ------ |
| Global              | None published                 | —      |
| Concurrent sessions | Configurable cap on the server | —      |

**Headers:** None (no `X-RateLimit-*`, no `Retry-After`).

**When exceeded:** There is **no `429`**. The realistic load failure is **session
exhaustion** — exceeding the server's "Maximum Data API connections" setting fails new
logins. A per-license Data API call cap can surface as error `953`.

**Recommended strategy:** Self-hosted, so throughput = the customer's hardware. Reuse one
token within its 15-min window, log out promptly to free a session slot, and keep polling
intervals conservative (≥5 min). No backoff is needed for rate limits because none are
enforced; do back off on `5xx`/connection errors.

---

## Error Handling

> **HTTP 200 ≠ success.** FileMaker returns HTTP 200 for many _logical_ errors — the real
> status is in `messages[0].code`, a **string** FileMaker error code. `"0"` = OK; anything
> else is an error. Always inspect `messages`, never trust the HTTP status alone.

**Standard error format:**

```json
{ "response": {}, "messages": [{ "code": "102", "message": "Field is missing" }] }
```

**Key FileMaker error codes (`messages[].code`):**

| Code | Meaning                              | Retryable?         | Recovery                                                    |
| ---- | ------------------------------------ | ------------------ | ----------------------------------------------------------- |
| 0    | OK                                   | —                  | —                                                           |
| 101  | Record is missing                    | No                 | `recordId` wrong / already deleted                          |
| 102  | Field is missing                     | No                 | Field not on layout / misspelled — re-check layout metadata |
| 104  | Script is missing                    | No                 | Re-list scripts                                             |
| 105  | Layout is missing                    | No                 | Re-list layouts; check exact name/case                      |
| 106  | Table is missing                     | No                 |                                                             |
| 401  | No records match the request         | No (not a failure) | Find returned empty — treat as empty result set             |
| 500  | Date/number/validation value invalid | No                 | Fix `fieldData` formatting; set `dateformats:2`             |
| 504  | Unique-value validation failed       | No                 | Duplicate key                                               |
| 802  | Unable to open the file              | No                 | DB not hosted / wrong name / Data API disabled              |
| 952  | Invalid FileMaker Data API token     | **Yes**            | **Re-login (POST /sessions) and retry once**                |
| 953  | Data API request limit / disabled    | No / Maybe         | Feature off or per-license cap reached                      |

**HTTP-level statuses that DO occur:**

| Status | Meaning                        | Retryable | Recovery                                                                     |
| ------ | ------------------------------ | --------- | ---------------------------------------------------------------------------- |
| 401    | Bad Basic credentials at login | No        | Fix username/password (this is a true HTTP 401, distinct from FM code `401`) |
| 403    | Forbidden / wrong path         | No        | Check server URL / database path / privileges                                |
| 404    | Wrong server or database path  | No        | Verify `server_url` + `database`                                             |
| 5xx    | Server fault                   | Yes       | Retry with backoff                                                           |
| —      | TLS/connection error           | Maybe     | Bad / self-signed cert, or server unreachable                                |

> **Two different "401"s.** A true HTTP `401` means bad Basic credentials at login.
> FileMaker error `code: "401"` in `messages` means _"no records matched a find"_ — an empty
> result, not an auth failure. Do not conflate them.

---

## Webhooks / Events

No webhook, WebSocket, SSE, or change-feed support of any kind — the Data API has none.

Use **polling** via `_find` against a customer-defined **modification-timestamp** field
(FileMaker's auto-enter "Modification Timestamp"). There is no universal server-wide
"modified since" — it relies on the schema having such a field. `recordId` is stable;
`modId` increments per edit but is not directly queryable. Recommended interval: **≥5 min**
(each poll consumes a session + query; be gentle since there is no rate-limit guidance).

---

## Known Limitations

1. **Per-tenant, no sandbox.** No Claris status page, no public test endpoint, no published rate limits — throughput = the customer's hardware and session-slot config.
2. **No fixed domain model.** Business entities are whatever layouts/fields the customer defined — discover them at runtime via the metadata endpoints.
3. **Everything is layout-scoped.** No direct table access; a field absent from the layout you target is invisible and unwritable through that call.
4. **Tenant-defined, case/space-exact names.** Layout/field/script names are authored by the customer, are case- and space-sensitive (`"First Name"`, `"Work State"`), and must be URL-encoded in paths. Never guess.
5. **Short-lived token, no refresh.** ~15-min sliding idle expiry; re-login on `952`. Finite session slots — reuse one token and log out promptly.
6. **No bulk write endpoints.** Create/edit/delete are one record per call; for bulk, run a server-side FileMaker **script** over a found set.
7. **Container upload is multipart** → out of scope for JSON-only `connect_request` (v2/needs-handler). Container _download_ via the streaming URL is feasible.
8. **HTTP 200 ≠ success.** Always read `messages[0].code`.

---

## SDKs & Tooling

| SDK                | Language | Repository                           | Quality | Notes                                                               |
| ------------------ | -------- | ------------------------------------ | ------- | ------------------------------------------------------------------- |
| (Claris official)  | —        | —                                    | —       | No official SDK                                                     |
| python-fmrest      | Python   | github.com/davidhamann/python-fmrest | good    | Reference for token handling + container mechanics; well maintained |
| fms-api-client     | Node     | github.com/Luidog/fms-api-client     | good    | Best example of token refresh + retry-on-`952`                      |
| fm-data-api-client | Node     | community                            | fair    | Lighter wrapper                                                     |

**Postman collection:** No official Claris collection; many community collections exist (search "FileMaker Data API Postman").
**OpenAPI spec:** Served live per-server at `https://{server_url}/fmi/data/apidoc/` (no single canonical hosted spec).

> Numa uses raw HTTP via `connect_request`; the community SDKs are reference-only but are the
> best source for the exact token-refresh / retry-on-`952` and container up/download
> mechanics that the prose docs gloss over.

---

## Integration Path Assessment

**Recommended path:** **Direct API via `connect_request`** (registry `authType: 'username-password'`).

**Justification:** FileMaker exposes tenant-defined **structured data** (records on layouts,
plus scripts) — not a browsable document tree — so it does **not** belong in Files > Remote
and needs no `list_files`/`download_file` interface. This mirrors the spec-driven, chat-only
`connect_request` pattern used for Podio / Zoho / Actionstep / Connecteam: the workspace
agent issues authenticated REST calls through Numa's `connect_request` proxy using the
vaulted credentials, with `01-llm-api-rules.md` (+ companions) as the agent's mental model.

**The one material difference** from those connectors is auth: FileMaker is **not** a
static-key or OAuth-bearer flow. The backend must perform a **Basic-auth login**
(`POST .../sessions`) to obtain a **short-lived session token (~15-min sliding idle)**, send
`Bearer {token}`, and **re-login on error `952`**. The four credential fields (`server_url`,
`username`, `password`, `database`) carry everything needed; the token is ephemeral and
backend-managed, never stored long-term. This token-lifecycle handling is the primary build
task and the main risk.

**Connector compatibility (Files-connector methods do NOT apply):**

| Connector Method  | API Endpoint              | Feasibility                                              |
| ----------------- | ------------------------- | -------------------------------------------------------- |
| list_files        | —                         | none — not a file tree                                   |
| download_file     | (container streaming URL) | partial — only for container fields; out of scope for v1 |
| search_files      | —                         | none — use `_find` on records instead                    |
| get_file_metadata | —                         | none                                                     |

**Agent capability surface (what the agent actually drives via `connect_request`):**

| Capability (agent intent) | API endpoint                                                     | Notes                                 |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| Authenticate              | `POST /databases/{db}/sessions` (Basic)                          | Backend-managed token; retry on `952` |
| Discover structure        | `GET .../layouts`, `GET .../layouts/{layout}`, `GET .../scripts` | **Mandatory first step**              |
| Read (browse)             | `GET .../layouts/{layout}/records`                               | `_offset`/`_limit`                    |
| Read (query)              | `POST .../layouts/{layout}/_find`                                | primary filtered read; `401` = empty  |
| Create / Update / Delete  | `POST` / `PATCH` / `DELETE .../records[/{recordId}]`             | `modId` optimistic lock               |
| Run business logic        | `GET .../layouts/{layout}/script/{name}`                         | for bulk / complex ops                |

---

_Researched on 2026-05-29. Sources: official Claris FileMaker Data API Guide
(help.claris.com/en/data-api-guide), re-verified against help.claris.com on 2026-05-29;
Claris support article "Working around FileMaker Data API authorization timeouts" (15-min
idle expiry); community SDKs python-fmrest / fms-api-client. No live call possible — every
install is a private, per-tenant server. See `00-api-investigation-questionnaire.md` for the
full investigation and confidence markings._

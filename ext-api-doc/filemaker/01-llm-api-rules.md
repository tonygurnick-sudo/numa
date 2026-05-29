# Claris FileMaker Data API — Workspace Agent API Rules

> Loaded into the workspace agent when the **Claris FileMaker** connector is active. Companion files (01a–01d) hold the deep reference.
>
> **No live call was ever made against this API during research** — every FileMaker install is a private, per-tenant server. Endpoint shapes and the auth flow are `[DOCUMENTED]` from the official Claris Data API Guide; the customer's actual layouts, fields, scripts and value lists are `[UNKNOWN]` until you discover them at runtime. **Discover before you act. Never guess a field or layout name.**

---

## Context

- **API:** Claris FileMaker Data API (REST/JSON over HTTPS). Version segment `vLatest`.
- **Base URL:** `https://{server_url}/fmi/data/vLatest/databases/{database}`
  - `{server_url}` and `{database}` come from the connector credentials (per tenant).
- **Auth:** Basic-login → short-lived **session Bearer token** (~15 min sliding idle, no refresh).
- **Integration path:** Direct API via `connect_request` (registry `authType: username-password`).
- **Rate limits:** None published. Self-hosted; throughput = the customer's hardware. The real
  scarce resource is **concurrent Data API sessions** (a configurable cap on the server).

You issue every call through Numa's `connect_request` proxy using the four vaulted
credentials (`server_url`, `username`, `password`, `database`). The proxy performs the
Basic login, caches the token, sends `Bearer {token}`, and re-logs-in on error `952`.
You do not handle the raw token yourself — but you DO need to understand it (below).

## Auth Structure

Two-step session auth. **Not** a static key, **not** OAuth.

```
# Step 1 — log in (Basic). Body is literally {}.
POST /fmi/data/vLatest/databases/{database}/sessions
Authorization: Basic base64(username:password)
Content-Type: application/json

{}
# → 200 {"response":{"token":"<token>"},"messages":[{"code":"0","message":"OK"}]}
# token is also echoed in the X-FM-Data-Access-Token response header.

# Step 2 — every later call.
Authorization: Bearer <token>
```

**Token lifecycle:**

- Valid until logout **or 15 minutes after the last call that used it** (sliding idle reset on every call).
- **No refresh token.** When it expires you simply log in again (`POST .../sessions`).
- Error `952` (invalid token) → re-login and **retry the call once**. Log out (`DELETE .../sessions/{token}`)
  when finished with a burst of work to free a session slot.

## Capabilities

### CAN

1. **Discover structure at runtime** — `GET .../layouts`, `GET .../layouts/{layout}` (fields, portals,
   value lists), `GET .../scripts`. This is the mandatory first step before any read or write.
2. **Read & query records** — `GET .../records` (browse) and `POST .../_find` (filtered) with FileMaker
   find operators, sort, offset/limit pagination, and per-portal pagination. Report counts from `dataInfo`.
3. **Create / edit / delete single records** on a chosen layout (respecting `modId` optimistic locking and
   field validation), set per-session global fields, and **run named FileMaker scripts** for bulk / complex work.

### CANNOT

1. **Upload container (binary) data** — that endpoint is `multipart/form-data`; `connect_request` is JSON-only.
   (Container _download_ via the streaming URL is possible if you follow the URL.) Flag as out of scope.
2. **Administer the server or change schema** — no Admin API here. Layouts, fields, scripts and value lists
   are authored in FileMaker Pro, never via this API.
3. **Read or write a table directly** — everything is scoped to a **layout**. A field not on the layout you
   target is invisible and unwritable through that call.

## Critical Gotchas

> These cause the most failures. Internalise them.

1. **HTTP 200 ≠ success.** FileMaker returns 200 for many logical errors. The real status is
   `messages[0].code` — `"0"` is OK, anything else is a FileMaker error code (a _string_, e.g. `"102"`).
   Always inspect `messages`, never trust the HTTP status alone.
2. **A find with no matches is error `401`** in `messages[].code` — **not** an HTTP 401, and **not** a failure.
   Treat it as "empty result set".
3. **Names are tenant-defined and exact.** Layout, field and script names are authored by the customer,
   are case- and space-sensitive (`"First Name"`, `"Work State"`), and must be **URL-encoded** in paths and
   used verbatim in `fieldData`/`query`. Never invent one — discover it via metadata first.
4. **Everything goes through a layout.** Choose a layout that exposes the fields you need. `recordId` and
   `modId` are API artifacts (the row handle and a version counter), **not** user fields.
5. **Calculation and summary fields are read-only.** Sending one in `fieldData` errors. Required-field and
   value-list validation is enforced on every create/edit and rejects with a FileMaker error code.

## Default Parameters

| Parameter               | Default                                                 | Reason                                                         |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| API version             | `vLatest`                                               | Forward-compatible across customer server versions.            |
| `_limit` / find `limit` | `100`                                                   | API default; safe page size.                                   |
| `dateformats`           | `2` (ISO 8601)                                          | Avoids locale-dependent date-parsing bugs.                     |
| `_sort`                 | none unless asked                                       | Let the layout's default order apply; don't surprise the user. |
| Token strategy          | login → cache for the 15-min window → re-login on `952` | Latency vs. session-slot pressure (proxy handles it).          |

## Working Examples

> Paths are relative to `https://{server_url}/fmi/data/vLatest`. All except login require `Bearer`.

### Example 1: Discover layouts, then a layout's fields

```http
GET /databases/Inventory/layouts
Authorization: Bearer {token}
```

```json
{
  "response": { "layouts": [{ "name": "Products" }, { "name": "Customers" }, { "name": "Orders" }] },
  "messages": [{ "code": "0", "message": "OK" }]
}
```

```http
GET /databases/Inventory/layouts/Products
Authorization: Bearer {token}
```

```json
{
  "response": {
    "fieldMetaData": [
      { "name": "Product Name", "type": "normal", "result": "text", "global": false, "notEmpty": true, "maxRepeat": 1 },
      { "name": "Stock", "type": "normal", "result": "number", "global": false, "notEmpty": false, "maxRepeat": 1 },
      { "name": "Margin", "type": "calculation", "result": "number", "global": false, "maxRepeat": 1 }
    ],
    "portalMetaData": {},
    "valueLists": [
      {
        "name": "Categories",
        "type": "customList",
        "values": [
          { "value": "Tools", "displayValue": "Tools" },
          { "value": "Clearance", "displayValue": "Clearance" }
        ]
      }
    ]
  },
  "messages": [{ "code": "0", "message": "OK" }]
}
```

`Margin` is `type:"calculation"` → read-only, never send it in `fieldData`.

### Example 2: Find low-stock products, newest first (filtered read)

```http
POST /databases/Inventory/layouts/Products/_find
Authorization: Bearer {token}
Content-Type: application/json

{ "query": [ { "Stock": "<40" } ],
  "sort": [ { "fieldName": "Modified", "sortOrder": "descend" } ],
  "limit": "50", "offset": "1" }
```

```json
{
  "response": {
    "data": [
      {
        "recordId": "7",
        "modId": "1",
        "fieldData": { "Product Name": "Baguette", "Stock": 34, "SKU": "FB3" },
        "portalData": {}
      }
    ],
    "dataInfo": {
      "database": "Inventory",
      "layout": "Products",
      "table": "Products",
      "totalRecordCount": 500,
      "foundCount": 2,
      "returnedCount": 1
    }
  },
  "messages": [{ "code": "0", "message": "OK" }]
}
```

`foundCount` = records matching the query; `totalRecordCount` = whole table; `returnedCount` = this page.

### Example 3: Create a record

```http
POST /databases/Inventory/layouts/Products/records
Authorization: Bearer {token}
Content-Type: application/json

{ "fieldData": { "Product Name": "Gadget", "Stock": 100, "SKU": "G-007" } }
```

```json
{ "response": { "recordId": "514", "modId": "0" }, "messages": [{ "code": "0", "message": "OK" }] }
```

### Example 4: Edit a record with optimistic locking

```http
PATCH /databases/Inventory/layouts/Products/records/514
Authorization: Bearer {token}
Content-Type: application/json

{ "fieldData": { "Stock": 95 }, "modId": "0" }
```

```json
{ "response": { "modId": "1" }, "messages": [{ "code": "0", "message": "OK" }] }
```

If the supplied `modId` no longer matches, the edit is rejected (someone else changed the record). Omit `modId` to force the write.

### Example 5: Find with no matches (NOT an error)

```http
POST /databases/Inventory/layouts/Products/_find
Authorization: Bearer {token}

{ "query": [ { "SKU": "==DOES-NOT-EXIST" } ] }
```

```json
{ "response": {}, "messages": [{ "code": "401", "message": "No records match the request" }] }
```

Code `401` here = empty result. Report "no matching records", do not treat as a failure.

## Proxy API Operations

| Operation       | Method | Path (under `/databases/{db}`)          | Key Parameters                          | Notes                                        |
| --------------- | ------ | --------------------------------------- | --------------------------------------- | -------------------------------------------- |
| Log in          | POST   | `/sessions`                             | Basic header, body `{}`                 | Returns `response.token`. Proxy-managed.     |
| Log out         | DELETE | `/sessions/{token}`                     | token in path                           | Frees a session slot.                        |
| List layouts    | GET    | `/layouts`                              | —                                       | **Discovery.**                               |
| Layout metadata | GET    | `/layouts/{layout}`                     | —                                       | Fields, portals, value lists. **Discovery.** |
| List scripts    | GET    | `/scripts`                              | —                                       | Script names; execute-only.                  |
| Browse records  | GET    | `/layouts/{layout}/records`             | `_offset`, `_limit`, `_sort`            | Paginated.                                   |
| Get one record  | GET    | `/layouts/{layout}/records/{recordId}`  | —                                       |                                              |
| Find records    | POST   | `/layouts/{layout}/_find`               | body `query`, `sort`, `limit`, `offset` | Primary filtered read. `401`=empty.          |
| Create record   | POST   | `/layouts/{layout}/records`             | body `fieldData`, `portalData`          | Returns new `recordId`.                      |
| Edit record     | PATCH  | `/layouts/{layout}/records/{recordId}`  | body `fieldData`, optional `modId`      | Optimistic lock via `modId`.                 |
| Delete record   | DELETE | `/layouts/{layout}/records/{recordId}`  | —                                       | Second delete → `101`.                       |
| Set globals     | PATCH  | `/layouts/{layout}/globals`             | body `globalFields`                     | Per-session global field values.             |
| Run script      | GET    | `/layouts/{layout}/script/{scriptName}` | `?script.param=`                        | For bulk/complex ops.                        |

## Pagination

- **Type:** Offset-based, **1-based**.
- **Default page size:** 100 records (50 for portal rows).
- **Max page size:** No documented hard cap; bounded by server memory. Keep `_limit` reasonable (100–500).
- **How to paginate:**

```http
GET /databases/Inventory/layouts/Products/records?_offset=101&_limit=100
Authorization: Bearer {token}
```

For `_find`, put `offset` and `limit` (no underscore) in the JSON body.

- **Last-page detection:** `offset + returnedCount - 1 >= foundCount`, OR `returnedCount < limit`, OR `data` empty.
  Get `foundCount` / `totalRecordCount` from `response.dataInfo`.

## Webhooks / Events

No webhook, WebSocket, SSE, or change-feed support of any kind — the Data API has none.
Use **polling** via `_find` against a customer-defined **modification-timestamp** field
(FileMaker auto-enter "Modification Timestamp"). There is no universal server-wide "modified since".
Recommended interval: **≥ 5 minutes** (each poll consumes a session + query; no rate-limit guidance, so be gentle).

## Error Handling

**Standard error format** (HTTP is usually 200 — read `messages`):

```json
{ "response": {}, "messages": [{ "code": "102", "message": "Field is missing" }] }
```

**Recovery by FileMaker error code (`messages[].code`, a string):**

| Code | Meaning                              | Retryable?         | Action                                                           |
| ---- | ------------------------------------ | ------------------ | ---------------------------------------------------------------- |
| 0    | OK                                   | —                  | —                                                                |
| 101  | Record is missing                    | No                 | `recordId` wrong / already deleted.                              |
| 102  | Field is missing                     | No                 | Field not on the layout / misspelled — re-check layout metadata. |
| 104  | Script is missing                    | No                 | Re-list scripts.                                                 |
| 105  | Layout is missing                    | No                 | Re-list layouts; check exact name/case.                          |
| 401  | No records match                     | No (not a failure) | Find returned empty — report as empty result.                    |
| 500  | Date/number/validation value invalid | No                 | Fix `fieldData` formatting; set `dateformats:2`.                 |
| 504  | Unique-value validation failed       | No                 | Duplicate key.                                                   |
| 802  | Unable to open the file              | No                 | DB not hosted / wrong name / Data API disabled.                  |
| 952  | Invalid Data API token               | **Yes**            | **Re-login and retry once** (proxy handles this).                |
| 953  | Data API request limit / disabled    | No                 | Feature off or per-license cap reached.                          |

**HTTP-level statuses that DO occur:** `401 Unauthorized` (bad Basic credentials at login),
`403`/`404` (wrong server/database path), `500` (server fault), TLS errors (bad/self-signed cert).
There is **no `429`** — there is no published rate limit; the realistic load failure is session exhaustion.

## Known Limitations

1. **Per-tenant, no sandbox.** No Claris status page, no public test endpoint, no published rate limits.
2. **No fixed domain model.** Business entities are whatever layouts/fields the customer defined — discover them.
3. **Container upload is out of scope** (multipart vs. JSON-only `connect_request`); download via streaming URL only.
4. **No bulk write endpoints** — create/edit/delete are one record per call; use a server-side script for bulk.
5. **Finite session slots.** Reuse one token; log out promptly. No refresh token — re-login on `952`.

---

_See companion files for detail:_

- _01a-domain-model-reference.md — structural entities + the runtime discovery procedure_
- _01b-query-patterns.md — find operators, sort, pagination, worked reads_
- _01c-mutation-patterns.md — create / edit / delete, `modId`, scripts, globals_
- _01d-event-and-error-handling.md — no events, polling, full error playbook_

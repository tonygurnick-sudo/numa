---
api_name: Claris FileMaker Data API
api_slug: filemaker
base_url: https://{server_url}/fmi/data/vLatest/databases/{database}
path_version_segment: vLatest (REAL path segment, NOT a label — it is literally in the URL: /fmi/data/vLatest/...)
path_construction: {server_url} + /fmi/data/vLatest/databases/{database} + {relative path below}. {server_url} and {database} come from connector credentials.
auth: Basic login → short-lived session Bearer token (~15 min sliding idle, NO refresh). NOT static key, NOT OAuth.
field_casing: tenant-defined exact (case + space sensitive); URL-encode in paths, verbatim in JSON
id_format: recordId / modId = integer-as-string ("514"); server-assigned, NOT user fields
rate_limit: none published; scarce resource = concurrent Data API session slots (server cap). No 429, no Retry-After.
call_surface: HTTP via connect_request proxy (registry authType=username-password). Proxy does Basic login, caches token, sends Bearer, re-logs-in on error 952. NOT a Files connector — no list-files/download-file/MCP.
confidence: every fact is [DOCUMENTED] from the official Claris Data API Guide (re-verified 2026-05-29); NO live call ever made (every FileMaker install is private/per-tenant). Customer layouts/fields/scripts/value-lists are [UNKNOWN] until runtime — discover, never guess.
companions: 01a=domain-model+discovery, 01b=query/find, 01c=mutation/scripts, 01d=events+errors
---

# Claris FileMaker Data API — API Rules

## Paths (read first)

- Real base: `https://{server_url}/fmi/data/vLatest/databases/{database}`. `{server_url}` + `{database}` from credentials.
- `vLatest` is a **REAL path segment** — it is literally in the URL. NOT a label. NOT optional. Do not drop it.
- Relative paths below are under `/databases/{database}` (e.g. `/layouts`, `/layouts/{layout}/records`).
- Layout/field/script names: case + space sensitive, **URL-encode in paths** (`Work State` → `Work%20State`), verbatim in JSON. Never invent one — discover first.

## Call surface

HTTP via `connect_request` proxy (registry `authType: username-password`). The proxy does Basic login, caches the token, sends `Bearer {token}`, re-logs-in on `952`. NOT a Files connector (no list-files/download-file). NOT MCP. You never handle the raw token, but must understand it (below).

## Auth (two-step session; NOT static key, NOT OAuth)

```
# Step 1 — login (Basic). Body is literally {}.
POST /databases/{database}/sessions
Authorization: Basic base64(username:password)
Content-Type: application/json
{}
# → 200 {"response":{"token":"<token>"},"messages":[{"code":"0","message":"OK"}]}  (token also in X-FM-Data-Access-Token header)

# Step 2 — every later call:
Authorization: Bearer <token>
```

Token: opaque, valid until logout **or 15 min after the last call** (sliding idle reset each call). **No refresh token** — re-login on expiry. Error `952` (invalid token) → re-login + **retry the call once** (proxy handles this). Log out (`DELETE /sessions/{token}`) after a burst to free a session slot.

## CAN

1. **Discover at runtime (mandatory first step):** `GET /layouts`, `GET /layouts/{layout}` (fields, portals, value lists), `GET /scripts`.
2. **Read/query:** `GET /layouts/{layout}/records` (browse) + `POST /layouts/{layout}/_find` (filtered) with find operators, sort, offset/limit + per-portal pagination. Counts in `dataInfo`.
3. **Write single records:** create/edit/delete on a layout (respect `modId` optimistic lock + validation), set per-session global fields, **run named scripts** for bulk/complex work.

## CANNOT

- **Upload container (binary) data** — endpoint is `multipart/form-data`; `connect_request` is JSON-only → out of scope. (Container _download_ via streaming URL is possible if you follow the URL.)
- **Administer server / change schema** — no Admin API. Layouts/fields/scripts/value-lists are authored in FileMaker Pro only.
- **Touch a table directly** — everything is layout-scoped. A field not on the targeted layout is invisible + unwritable through that call.
- **Bulk write** — create/edit/delete are one record per call; use a server-side script for bulk.

## Critical Gotchas

1. **HTTP 200 ≠ success.** Real status is `messages[0].code` (a STRING): `"0"`=OK, anything else = a FileMaker error code (`"102"`). Always read `messages`, never trust HTTP status alone.
2. **A find with no matches = code `401`** in `messages[].code` — NOT an HTTP 401, NOT a failure. Treat as empty result.
3. **Names are tenant-defined + exact** (case/space-sensitive: `"First Name"`, `"Work State"`), URL-encoded in paths, verbatim in `fieldData`/`query`. Discover via metadata; never guess.
4. **Everything goes through a layout.** Pick one that exposes the fields you need. `recordId`+`modId` are API artifacts (row handle + version counter), NOT user fields.
5. **Calculation/summary fields are read-only** — sending one in `fieldData` errors. Required (`notEmpty`) + value-list validation enforced on every create/edit.

## Defaults (override only if the user specifies)

| Param                   | Default                                         | Reason                                    |
| ----------------------- | ----------------------------------------------- | ----------------------------------------- |
| API version             | `vLatest`                                       | forward-compatible across server versions |
| `_limit` / find `limit` | `100`                                           | API default; safe page size               |
| `dateformats`           | `2` (ISO 8601)                                  | avoids locale date-parsing bugs           |
| `_sort`                 | none                                            | let layout default order apply            |
| Token                   | login → cache 15-min window → re-login on `952` | proxy handles it                          |

## Operations (paths under `/databases/{db}`)

| Operation       | Method | Path                                    | Key params / notes                                                       |
| --------------- | ------ | --------------------------------------- | ------------------------------------------------------------------------ |
| Log in          | POST   | `/sessions`                             | Basic header, body `{}`; returns `response.token`. Proxy-managed.        |
| Log out         | DELETE | `/sessions/{token}`                     | frees a session slot                                                     |
| List layouts    | GET    | `/layouts`                              | **Discovery**                                                            |
| Layout metadata | GET    | `/layouts/{layout}`                     | fields, portals, value lists. **Discovery**                              |
| List scripts    | GET    | `/scripts`                              | script names; execute-only                                               |
| Browse records  | GET    | `/layouts/{layout}/records`             | `_offset`, `_limit`, `_sort` (paginated)                                 |
| Get one record  | GET    | `/layouts/{layout}/records/{recordId}`  | —                                                                        |
| Find records    | POST   | `/layouts/{layout}/_find`               | body `query`,`sort`,`limit`,`offset`. Primary filtered read; `401`=empty |
| Create record   | POST   | `/layouts/{layout}/records`             | body `fieldData`,`portalData`; returns new `recordId`                    |
| Edit record     | PATCH  | `/layouts/{layout}/records/{recordId}`  | body `fieldData`, optional `modId` (optimistic lock)                     |
| Delete record   | DELETE | `/layouts/{layout}/records/{recordId}`  | second delete → `101`                                                    |
| Set globals     | PATCH  | `/layouts/{layout}/globals`             | body `globalFields` (per-session)                                        |
| Run script      | GET    | `/layouts/{layout}/script/{scriptName}` | `?script.param=`; for bulk/complex ops                                   |

## Pagination

Offset-based, **1-based** (first record = offset `1`). Default page 100 (50 for portal rows). No hard cap; keep `_limit` 100–500. GET: `_offset`/`_limit`/`_sort`. `_find`: `offset`/`limit`/`sort` in body (no underscore). Counts from `response.dataInfo`: `foundCount` (matched query), `totalRecordCount` (whole table), `returnedCount` (this page). Last page when `offset + returnedCount - 1 >= foundCount`, OR `returnedCount < limit`, OR `data` empty.

## Webhooks / Events

NONE — no webhook/WebSocket/SSE/change-feed. Poll via `_find` against a customer-defined modification-timestamp field (discover its exact name first). No server-wide "modified since". Interval ≥ **5 min** (each poll = a session + query; no rate-limit guidance).

## Errors

Format (HTTP usually 200 — read `messages`): `{"response":{},"messages":[{"code":"102","message":"Field is missing"}]}`. `code` is a STRING.

| Code | Meaning                              | Retry?             | Action                                                    |
| ---- | ------------------------------------ | ------------------ | --------------------------------------------------------- |
| 0    | OK                                   | —                  | —                                                         |
| 101  | Record is missing                    | No                 | `recordId` wrong/already deleted                          |
| 102  | Field is missing                     | No                 | field not on layout/misspelled — re-check layout metadata |
| 104  | Script is missing                    | No                 | re-list scripts                                           |
| 105  | Layout is missing                    | No                 | re-list layouts; check exact name/case                    |
| 401  | No records match                     | No (not a failure) | find returned empty — report as empty result              |
| 500  | Date/number/validation value invalid | No                 | fix `fieldData` formatting; set `dateformats:2`           |
| 504  | Unique-value validation failed       | No                 | duplicate key                                             |
| 802  | Unable to open the file              | No                 | DB not hosted / wrong name / Data API disabled            |
| 952  | Invalid Data API token               | **Yes**            | **re-login + retry once** (proxy handles)                 |
| 953  | Data API request limit / disabled    | No                 | feature off or per-license cap                            |

HTTP-level statuses that DO occur: `401` (bad Basic credentials at LOGIN — distinct from FM code `401`), `403`/`404` (wrong server/database path), `500` (server fault), TLS errors (bad/self-signed cert). **No `429`** — no published rate limit; realistic load failure is session exhaustion.

## Examples

> Paths relative to `https://{server_url}/fmi/data/vLatest`. All except login require `Bearer`. `Margin` below is `type:"calculation"` → read-only, never in `fieldData`.

1. Discover layouts, then a layout's fields:
   `GET /databases/Inventory/layouts` → `{"response":{"layouts":[{"name":"Products"},{"name":"Customers"},{"name":"Orders"}]},"messages":[{"code":"0","message":"OK"}]}`
   `GET /databases/Inventory/layouts/Products` → `{"response":{"fieldMetaData":[{"name":"Product Name","type":"normal","result":"text","global":false,"notEmpty":true,"maxRepeat":1},{"name":"Stock","type":"normal","result":"number","global":false,"notEmpty":false,"maxRepeat":1},{"name":"Margin","type":"calculation","result":"number","global":false,"maxRepeat":1}],"portalMetaData":{},"valueLists":[{"name":"Categories","type":"customList","values":[{"value":"Tools","displayValue":"Tools"},{"value":"Clearance","displayValue":"Clearance"}]}]},"messages":[{"code":"0","message":"OK"}]}`

2. Find low-stock products, newest first (filtered read):
   `POST /databases/Inventory/layouts/Products/_find`
   `{"query":[{"Stock":"<40"}],"sort":[{"fieldName":"Modified","sortOrder":"descend"}],"limit":"50","offset":"1"}`
   → `{"response":{"data":[{"recordId":"7","modId":"1","fieldData":{"Product Name":"Baguette","Stock":34,"SKU":"FB3"},"portalData":{}}],"dataInfo":{"database":"Inventory","layout":"Products","table":"Products","totalRecordCount":500,"foundCount":2,"returnedCount":1}},"messages":[{"code":"0","message":"OK"}]}`

3. Create a record:
   `POST /databases/Inventory/layouts/Products/records` `{"fieldData":{"Product Name":"Gadget","Stock":100,"SKU":"G-007"}}`
   → `{"response":{"recordId":"514","modId":"0"},"messages":[{"code":"0","message":"OK"}]}`

4. Edit with optimistic locking:
   `PATCH /databases/Inventory/layouts/Products/records/514` `{"fieldData":{"Stock":95},"modId":"0"}`
   → `{"response":{"modId":"1"},"messages":[{"code":"0","message":"OK"}]}`
   If supplied `modId` no longer matches, the edit is rejected (concurrent change). Omit `modId` to force the write.

5. Find with no matches (NOT an error):
   `POST /databases/Inventory/layouts/Products/_find` `{"query":[{"SKU":"==DOES-NOT-EXIST"}]}`
   → `{"response":{},"messages":[{"code":"401","message":"No records match the request"}]}`
   Code `401` here = empty result. Report "no matching records"; do not treat as a failure.

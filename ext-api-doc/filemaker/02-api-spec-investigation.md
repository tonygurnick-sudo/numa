---
api_name: Claris FileMaker Data API
api_slug: filemaker
base_url: https://{server_url}/fmi/data/vLatest/databases/{database}
path_version_segment: vLatest — REAL path segment, in the URL (/fmi/data/vLatest/...). NOT a label. v1 also pins; vLatest recommended. The on-disk version tracks the FileMaker Server release (FM17 introduced the Data API; FM18/19/2023/2024 extend it).
auth: Basic login → short-lived session Bearer token (~15 min sliding idle, NO refresh). NOT static key, NOT OAuth.
call_surface: HTTP via connect_request proxy (registry authType=username-password). NOT a Files connector, NOT MCP.
spec_format: none (no single canonical spec — served live per-server at /fmi/data/apidoc/, version-pinned)
spec_url: https://{server_url}/fmi/data/apidoc/ (OpenAPI UI, per-server)
docs_url: https://help.claris.com/en/data-api-guide/content/index.html
date_researched: 2026-05-29
confidence: endpoint shapes + auth flow [DOCUMENTED] from the official Claris Data API Guide, re-verified against help.claris.com 2026-05-29; NO live call (every install is private/per-tenant). Customer layouts/fields/scripts/value-lists [UNKNOWN] until runtime. Tagged [INFERRED] inline where not documented.
---

# Claris FileMaker Data API — API Specification & Investigation

Clean developer reference. Everything needed to integrate, in one place.

## Overview

- **Vendor:** Claris International Inc. (an Apple company).
- **Base URL:** `https://{server_url}/fmi/data/vLatest/databases/{database}` — `{server_url}` = the customer's FileMaker Server / FileMaker Cloud host (`server_url` credential, e.g. `https://myserver.fmi.filemaker-cloud.com`); `{database}` = the hosted `.fmp12` solution name (`database` credential, e.g. `Inventory`).
- **API type:** REST (JSON over HTTPS, HTTP/1.1). SSL/TLS required. Container (binary) fields use a separate streaming-URL download / multipart upload.
- **Sandbox:** None operated by Claris — each customer's own server is the only environment. No Claris-operated status page for a customer's server.
- **Docs:** [help.claris.com/en/data-api-guide](https://help.claris.com/en/data-api-guide/content/index.html). API reference = task-organised guide (one page per operation) + a **live per-server OpenAPI UI** at `https://{server_url}/fmi/data/apidoc/` (renders the spec for that exact server version; no single canonical hosted spec).

**Summary:** A REST/JSON interface to a customer's hosted `.fmp12` FileMaker solution. Exposes records, finds, layout/script metadata, and script execution — all scoped through **layouts** (table views), not raw tables. Used to read/write business records, run server-side scripts, and discover a solution's structure programmatically.

**The one fact that frames everything:** FileMaker is a database _platform_, so the "entities" are whatever the customer's solution defines. There is no shipped object model. Discover the tenant's structure (layouts → fields → value lists → scripts) at runtime before reading or writing. Never guess a field/layout/script name.

## Authentication — Basic login → short-lived session Bearer token

The defining quirk. A **two-step, short-lived session token** — NOT a static API key, NOT OAuth for this connector. (FileMaker Cloud also supports a Claris-ID `FMID` token flow, but the Numa connector uses the on-prem/standard Basic→token flow against the four credential fields.)

**Step 1 — log in (Basic credentials → token):**

```http
POST /fmi/data/vLatest/databases/{database}/sessions HTTP/1.1
Host: {server_url}
Authorization: Basic {base64(username:password)}
Content-Type: application/json
{}
```

Response (HTTP 200) — token in the body **and** echoed in the `X-FM-Data-Access-Token` header:
`{"response":{"token":"c4d2e429122e9cdeda19bb23c55cd2a8f282c3cc50c60943a110"},"messages":[{"code":"0","message":"OK"}]}`

**Step 2 — every subsequent call uses the token as a Bearer:** `Authorization: Bearer {token}`. `Content-Type: application/json` on request bodies only.

**Token lifecycle (critical):**
| Property | Value |
| --- | --- |
| Token type | opaque session token (not a JWT) |
| Lifetime | valid until logout **or 15 minutes after the last call that used it** — sliding idle timeout |
| Idle reset | each authenticated call resets the 15-min clock (the `validateSession` probe does **not** extend it) |
| Refresh | **None.** No refresh token. On expiry, log in again (`POST /sessions`) |
| Expiry signal | next call after expiry returns FileMaker error code `952` (invalid token) in `messages[].code` |
| Recovery | on `952`: re-login and retry the call **once** |
| Logout | `DELETE /fmi/data/vLatest/databases/{database}/sessions/{token}` — frees a server session slot |
| Scarce resource | concurrent Data API session slots (configurable server cap); reuse one token, log out promptly |

**Permissions:** Governed by the FileMaker **account's privilege set** inside the database. The account must have the `fmrest` extended privilege enabled; data access is whatever that privilege set grants. No OAuth scopes. **Server-side prerequisites:** (a) Data API enabled in the FileMaker Server Admin Console; (b) the database hosted with `fmrest` granted to the account; (c) a valid SSL certificate (self-signed certs fail unless trusted).

> **CORS note:** the Data API does NOT support CORS or `OPTIONS`. Irrelevant for Numa — every call is server-side via `connect_request`, never browser-direct.

## Endpoint Catalog

All paths relative to `https://{server_url}/fmi/data/vLatest`. All except login / `productinfo` / `databases` require `Authorization: Bearer {token}`.

| #   | Method | Path                                                                                      | Purpose                                      | Auth          | Paginated                        | Idempotent       | Notes                                                                    |
| --- | ------ | ----------------------------------------------------------------------------------------- | -------------------------------------------- | ------------- | -------------------------------- | ---------------- | ------------------------------------------------------------------------ |
| 1   | GET    | `/productinfo`                                                                            | host product/version info                    | No            | No                               | Yes              | `name,version,buildDate,dateFormat,timeFormat,timeStampFormat`           |
| 2   | GET    | `/databases`                                                                              | list Data-API-enabled databases              | No\*          | No                               | Yes              | \*may require Basic                                                      |
| 3   | POST   | `/databases/{db}/sessions`                                                                | log in → token                               | Basic         | No                               | No               | body `{}`; returns `response.token`                                      |
| 4   | DELETE | `/databases/{db}/sessions/{token}`                                                        | log out                                      | token-in-path | No                               | Yes              | frees a session slot                                                     |
| 5   | GET    | `/databases/{db}/layouts`                                                                 | list layout names                            | Bearer        | No                               | Yes              | discovery                                                                |
| 6   | GET    | `/databases/{db}/layouts/{layout}`                                                        | layout metadata (fields/portals/value lists) | Bearer        | No                               | Yes              | discovery                                                                |
| 7   | GET    | `/databases/{db}/scripts`                                                                 | list script names                            | Bearer        | No                               | Yes              | execute-only                                                             |
| 8   | GET    | `/databases/{db}/layouts/{layout}/records`                                                | get range of records                         | Bearer        | Yes (`_offset`/`_limit`/`_sort`) | Yes              |                                                                          |
| 9   | GET    | `/databases/{db}/layouts/{layout}/records/{recordId}`                                     | get one record                               | Bearer        | No                               | Yes              |                                                                          |
| 10  | POST   | `/databases/{db}/layouts/{layout}/records`                                                | create record                                | Bearer        | No                               | No               | returns new `recordId`                                                   |
| 11  | PATCH  | `/databases/{db}/layouts/{layout}/records/{recordId}`                                     | edit record                                  | Bearer        | No                               | Yes (per record) | `modId` optimistic lock                                                  |
| 12  | DELETE | `/databases/{db}/layouts/{layout}/records/{recordId}`                                     | delete record                                | Bearer        | No                               | Yes              | second delete → `101`                                                    |
| 13  | POST   | `/databases/{db}/layouts/{layout}/_find`                                                  | find (query) records                         | Bearer        | Yes (body `offset`/`limit`)      | Yes              | `401` = no matches                                                       |
| 14  | PATCH  | `/databases/{db}/layouts/{layout}/globals`                                                | set global field values                      | Bearer        | No                               | Yes              | per-session globals                                                      |
| 15  | GET    | `/databases/{db}/layouts/{layout}/script/{scriptName}`                                    | run a script (standalone)                    | Bearer        | No                               | —                | `?script.param=`                                                         |
| 16  | POST   | `/databases/{db}/layouts/{layout}/records/{recordId}/containers/{fieldName}/{repetition}` | upload container data                        | Bearer        | No                               | No               | `multipart/form-data` — **out of scope for JSON-only `connect_request`** |

> A script can also be **chained** onto a record/find call via the body keys `script`, `script.prerequest`, `script.presort` (+ matching `.param`) — useful for running business logic as part of a read/write.

## Data Models

**No fixed business object model.** FileMaker's _first-class_ entities are structural (Database → Layout → Record → Field/Portal/Container → Script → Session). Business entities (Customer, Order, Invoice…) are whatever layouts/fields the customer built — discover at runtime via metadata. The models below are the structural envelope you always receive; field names inside `fieldData` are tenant-defined.

**Record envelope (from get-range, get-one, `_find`):**
| Field | Type | Writable | Description |
| --- | --- | --- | --- |
| `recordId` | string | no | server-assigned internal row handle (integer-as-string, e.g. `"12"`). **NOT a user field.** |
| `modId` | string | no | modification counter; optimistic locking on PATCH/DELETE |
| `fieldData` | object | yes\* | all layout field values, keyed by exact (tenant-defined) field name |
| `portalData` | object | yes\* | related-record sets, keyed by portal/object name; each row has its own `recordId`/`modId` |

\* writable iff the field is enterable on that layout and not calc/summary/auto-enter-only.

**`dataInfo` (returned alongside `data` on reads):** `database`, `layout`, `table` (underlying table occurrence), `totalRecordCount` (whole table), `foundCount` (matching this query / found set), `returnedCount` (this page).

**Layout metadata (`GET /layouts/{layout}`):** `fieldMetaData` array — per field: `name`, `type` (`normal`/`calculation`/`summary`), `result` (`text`/`number`/`date`/`time`/`timestamp`/`container`), `global`, `repetitions`, `maxRepeat`, `notEmpty`, optional `valueList`. `portalMetaData` object — per-portal field metadata (same shape, keyed by portal name). `valueLists` array — per list: `name`, `type`, `values[]` (`value`/`displayValue`).

> `type: "calculation"`/`"summary"` fields are **read-only** — never in `fieldData`. Picklist options come from `valueLists`, not a global enum.

**Relationships:** Business-table relationships (Customer→Order→LineItem) live in the customer's relationship graph and surface to the API **only as portals on a layout**. No generic "include related entity by ID" — you see related data only via a portal on the layout you query.

**Field format reference:** Date `MM/DD/YYYY` or ISO with `dateformats:2` (`01/20/2029`/`2029-01-20`; default follows file, ISO recommended). Timestamp `MM/DD/YYYY HH:MM:SS` or ISO (`2029-01-20T13:45:00`). Time `HH:MM:SS`. Number = JSON number or numeric string (`40`/`"40"`; coerced). Container = URL (read) / multipart (write), `https://{server}/Streaming_SSL/...`. `recordId`/`modId` = integer-as-string, server-assigned, not user fields.

**Worked examples:**
Get a range: `GET /databases/Inventory/layouts/Products/records?_offset=1&_limit=2` → `{"response":{"data":[{"recordId":"1","modId":"0","fieldData":{"Product Name":"Widget","Stock":40,"SKU":"W-001"},"portalData":{}},{"recordId":"2","modId":"3","fieldData":{"Product Name":"Gadget","Stock":7,"SKU":"G-007"},"portalData":{}}],"dataInfo":{"database":"Inventory","layout":"Products","table":"Products","totalRecordCount":500,"foundCount":500,"returnedCount":2}},"messages":[{"code":"0","message":"OK"}]}`
Create → returns new `recordId`: `POST /databases/Inventory/layouts/Products/records` `{"fieldData":{"Product Name":"Gizmo","Stock":100,"SKU":"GZ-1"}}` → `{"response":{"recordId":"514","modId":"0"},"messages":[{"code":"0","message":"OK"}]}`
Edit with optimistic lock → bumps `modId`: `PATCH /databases/Inventory/layouts/Products/records/514` `{"fieldData":{"Stock":95},"modId":"0"}` → `{"response":{"modId":"1"},"messages":[{"code":"0","message":"OK"}]}`

## Pagination

Offset-based, **1-based**. Default page 100 (50 for portal rows). No documented hard cap; bounded by server memory/config — keep `_limit` 100–500 [INFERRED]. Total count via `response.dataInfo.foundCount` (query match) + `totalRecordCount` (whole table).

| Parameter                              | Type    | Default | Description                                                           |
| -------------------------------------- | ------- | ------- | --------------------------------------------------------------------- |
| `_offset` (GET) / `offset` (find body) | integer | 1       | 1-based index of the first record                                     |
| `_limit` (GET) / `limit` (find body)   | integer | 100     | max records to return                                                 |
| `_sort` (GET) / `sort` (find body)     | JSON    | —       | `[{"fieldName":"Stock","sortOrder":"descend"}]` (URL-encoded for GET) |
| `_offset.{portal}` / `_limit.{portal}` | integer | 1 / 50  | per-portal pagination                                                 |

**Last page:** `offset + returnedCount - 1 >= foundCount`, OR `returnedCount < limit`, OR `data` empty.
**Worked:** Page 1 `?_offset=1&_limit=100` → foundCount=240, returnedCount=100 · Page 2 `?_offset=101&_limit=100` → 100 · Page 3 `?_offset=201&_limit=100` → 40 (40<100 → last). For `_find`, put `offset`/`limit`/`sort` (no leading underscore) in the JSON body.

## Query & Filter Capabilities

Find criteria = an array of request objects in the `_find` body. **Multiple objects in `query[]` are OR'd; multiple fields within one object are AND'd.** An object with `"omit":"true"` excludes its matches.
`{"query":[{"Stock":"<40","Category":"Tools"},{"Category":"Clearance"},{"Status":"Discontinued","omit":"true"}],"sort":[{"fieldName":"Stock","sortOrder":"descend"}],"limit":"10","offset":"1","portal":["Line Items"],"limit.Line Items":"5"}`

**Operators (at the start of the value string):** exact/whole-word `"=value"` (`"==value"` for exact field content) · comparison `"<40"`,`">10"`,`"<=5"`,`">=5"` · range `"1...10"` / `"01/01/2026...03/31/2026"` · wildcards `*` (any), `?` (one char), `#` (digit), `@` (letter) — no regex · empty/non-empty `"=="` / `"*"` · omit `{"Field":"x","omit":"true"}` · sort direction `"ascend"`/`"descend"` (or a value-list name for custom order).

**Supported?** Filter by field value Yes · date range Yes (`...`) · full-text Partial (word-based "contains", not arbitrary substring) · multi-key sort Yes · field selection/sparse fields **No** (always get every field on the layout — target a leaner layout, or `layout.response`) · include related records Yes (`portal:[...]`, only portals on the layout) · aggregate/count Partial (`dataInfo.foundCount`/`totalRecordCount`, no GROUP BY) · logical AND/OR Yes · regex/pattern **No** (FileMaker wildcards only). **No global search endpoint** — search is always per-layout via `_find`.

## Rate Limits

| Scope               | Limit                          | Window |
| ------------------- | ------------------------------ | ------ |
| Global              | None published                 | —      |
| Concurrent sessions | Configurable cap on the server | —      |

**Headers:** none (no `X-RateLimit-*`, no `Retry-After`). **When exceeded:** there is **no `429`** — the realistic load failure is **session exhaustion** (exceeding the server's "Maximum Data API connections" fails new logins). A per-license Data API call cap can surface as error `953`. **Strategy:** self-hosted, so throughput = the customer's hardware; reuse one token within its 15-min window, log out promptly, keep polling intervals ≥5 min. No backoff needed for rate limits (none enforced); do back off on `5xx`/connection errors.

## Error Handling

**HTTP 200 ≠ success.** FileMaker returns HTTP 200 for many _logical_ errors — the real status is `messages[0].code`, a STRING. `"0"` = OK; anything else is an error. Format: `{"response":{},"messages":[{"code":"102","message":"Field is missing"}]}`.

**Key FileMaker error codes (`messages[].code`):**
| Code | Meaning | Retryable? | Recovery |
| --- | --- | --- | --- |
| 0 | OK | — | — |
| 101 | Record is missing | No | `recordId` wrong / already deleted |
| 102 | Field is missing | No | field not on layout / misspelled — re-check layout metadata |
| 104 | Script is missing | No | re-list scripts |
| 105 | Layout is missing | No | re-list layouts; check exact name/case |
| 106 | Table is missing | No | — |
| 401 | No records match the request | No (not a failure) | find returned empty — treat as empty result set |
| 500 | Date/number/validation value invalid | No | fix `fieldData` formatting; set `dateformats:2` |
| 504 | Unique-value validation failed | No | duplicate key |
| 802 | Unable to open the file | No | DB not hosted / wrong name / Data API disabled |
| 952 | Invalid FileMaker Data API token | **Yes** | **re-login (POST /sessions) and retry once** |
| 953 | Data API request limit / disabled | No / Maybe | feature off or per-license cap reached |

**HTTP-level statuses that DO occur:** `401` (bad Basic credentials at login — a true HTTP 401, distinct from FM code `401`; fix username/password), `403` (forbidden/wrong path — check server URL/database path/privileges), `404` (wrong server or database path — verify `server_url` + `database`), `5xx` (server fault — retry with backoff), TLS/connection errors (bad/self-signed cert, or server unreachable).

> **Two different "401"s.** True HTTP `401` = bad Basic credentials at login. FileMaker `code: "401"` in `messages` = "no records matched a find" — an empty result, not auth failure. Do not conflate.

## Webhooks / Events

NONE — no webhook/WebSocket/SSE/change-feed. Poll via `_find` against a customer-defined **modification-timestamp** field (FileMaker's auto-enter "Modification Timestamp"). No universal server-wide "modified since" — relies on the schema having such a field. `recordId` is stable; `modId` increments per edit but is not directly queryable. Interval ≥ **5 min** (each poll = a session + query; no rate-limit guidance).

## Known Limitations

1. **Per-tenant, no sandbox.** No status page, no public test endpoint, no published rate limits — throughput = the customer's hardware + session-slot config.
2. **No fixed domain model.** Business entities are whatever layouts/fields the customer defined — discover them at runtime via metadata.
3. **Everything is layout-scoped.** No direct table access; a field absent from the targeted layout is invisible + unwritable through that call.
4. **Tenant-defined, case/space-exact names** (`"First Name"`, `"Work State"`), URL-encoded in paths. Never guess.
5. **Short-lived token, no refresh** (~15-min sliding idle; re-login on `952`). Finite session slots — reuse one token, log out promptly.
6. **No bulk write endpoints.** Create/edit/delete are one record per call; for bulk, run a server-side script over a found set.
7. **Container upload is multipart** → out of scope for JSON-only `connect_request` (v2/needs-handler). Container _download_ via the streaming URL is feasible.
8. **HTTP 200 ≠ success.** Always read `messages[0].code`.

## SDKs & Tooling

| SDK                | Language | Repository                           | Quality | Notes                                                               |
| ------------------ | -------- | ------------------------------------ | ------- | ------------------------------------------------------------------- |
| (Claris official)  | —        | —                                    | —       | no official SDK                                                     |
| python-fmrest      | Python   | github.com/davidhamann/python-fmrest | good    | reference for token handling + container mechanics; well maintained |
| fms-api-client     | Node     | github.com/Luidog/fms-api-client     | good    | best example of token refresh + retry-on-`952`                      |
| fm-data-api-client | Node     | community                            | fair    | lighter wrapper                                                     |

**Postman:** no official Claris collection; many community ones (search "FileMaker Data API Postman"). **OpenAPI:** served live per-server at `https://{server_url}/fmi/data/apidoc/`.

> Numa uses raw HTTP via `connect_request`; the community SDKs are reference-only but the best source for the exact token-refresh / retry-on-`952` and container up/download mechanics the prose docs gloss over.

## Integration Path Assessment

**Recommended:** **Direct API via `connect_request`** (registry `authType: 'username-password'`). FileMaker exposes tenant-defined **structured data** (records on layouts, plus scripts) — not a browsable document tree — so it does NOT belong in Files > Remote and needs no `list_files`/`download_file`. Same spec-driven, chat-only `connect_request` pattern as Podio / Zoho / Actionstep / Connecteam.

**The one material difference:** auth is NOT static-key or OAuth-bearer. The backend must perform a **Basic-auth login** (`POST /sessions`) to obtain a **short-lived session token (~15-min sliding idle)**, send `Bearer {token}`, and **re-login on error `952`**. The four credentials (`server_url`, `username`, `password`, `database`) carry everything; the token is ephemeral + backend-managed, never stored long-term. This token-lifecycle handling is the primary build task and the main risk.

**Files-connector methods do NOT apply:** `list_files` none (not a file tree) · `download_file` partial (only container fields; out of scope for v1) · `search_files` none (use `_find` on records) · `get_file_metadata` none.

**Agent capability surface (driven via `connect_request`):** Authenticate `POST /sessions` (Basic; backend-managed token, retry on `952`) · Discover structure `GET /layouts`, `GET /layouts/{layout}`, `GET /scripts` (**mandatory first step**) · Read browse `GET /layouts/{layout}/records` (`_offset`/`_limit`) · Read query `POST /layouts/{layout}/_find` (primary filtered read; `401`=empty) · Create/Update/Delete `POST`/`PATCH`/`DELETE .../records[/{recordId}]` (`modId` optimistic lock) · Run business logic `GET /layouts/{layout}/script/{name}` (bulk/complex ops).

_Sources: official Claris FileMaker Data API Guide (help.claris.com/en/data-api-guide), re-verified 2026-05-29; Claris support article "Working around FileMaker Data API authorization timeouts" (15-min idle expiry); community SDKs python-fmrest / fms-api-client. No live call possible — every install is private/per-tenant. See `00-api-investigation-questionnaire.md` for the full investigation + confidence markings._

---
api_name: QuickBooks Online Accounting API
api_slug: quickbooks
vendor: Intuit Inc.
base_url: https://quickbooks.api.intuit.com
base_url_sandbox: https://sandbox-quickbooks.api.intuit.com
path_template: /v3/company/{realmId}/{resource}[/{id}]
path_version_segment: /v3/ (REAL path segment — always present, not a label)
realm_in_path: yes — {realmId} (company id) is templated into EVERY path; relay-stored, from OAuth callback
auth: OAuth2 Bearer (relay injects Authorization header); scope com.intuit.quickbooks.accounting only
call_surface: HTTP via `numa integrations request` (connect_request/relay) — NOT a Files connector (no list-files/download-file/search-files), NOT MCP
field_casing: PascalCase (entities + fields); resource in path is case-insensitive
id_format: numeric string per realm ("58"); realmId = long numeric string
minorversion: pin 75 (min; 1-74 deprecated Aug 2025)
rate_limit: 500/min/realm; 10 concurrent/realm; batch 120/min/realm; reports ~200/min. No reliable X-RateLimit-*/Retry-After — detect via 429
confidence: all facts [DOCUMENTED] from Intuit docs+SDKs unless tagged [INFERRED]; NO live calls — verify edge-case wrappers against sandbox
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# QuickBooks Online — API Rules

## Call mechanics (read first)

- Surface: HTTP via `numa integrations request` (`connector="quickbooks"`). The relay attaches `Authorization: Bearer {token}` and forwards to the base URL. You build method + path + body + `Accept`/`Content-Type`. NOT a Files connector; NOT MCP.
- Path = `/v3/company/{realmId}/{resource}[/{id}]`. `/v3/` is a REAL path segment (always present). `{realmId}` is the company id (relay-stored from the OAuth callback `?...&realmId=...`) — templated into EVERY path. Full URL form equivalent: `https://quickbooks.api.intuit.com/v3/company/{realmId}/invoice/130`.
- `minorversion` is an additive QUERY param (`?minorversion=75`), not a path segment. One auth = one realm; multiple companies = multiple connections.

## Auth

- `Authorization: Bearer {access_token}` (relay-injected) · `Accept: application/json` (ALWAYS — omit → silent XML) · `Content-Type: application/json` (writes; query body uses `application/text`).
- Access token 1h. Refresh token ~100d and ROTATES (new one ~every 24h + on every exchange; old dies). Relay persists the rotated token or next refresh → `invalid_grant`. See 04.

## CAN

Read/filter any entity via SQL-like `query` (`SELECT … FROM Invoice WHERE …`) + read one by id (`GET /{entity}/{id}`). Create + update (full + **sparse**) Invoice, Customer, Item, Bill, Vendor, Account; record customer Payments + apply to invoices; vendor-side via `/billpayment`. List unpaid/overdue invoices+bills; `/reports` (P&L, A/R aging); `/companyinfo`, `/preferences`. Incremental sync via `/cdc` or `WHERE MetaData.LastUpdatedTime > '…'`. Download invoice PDF. `/batch` (≤30 ops). `/upload` Attachable (multipart).

## CANNOT

Query dialect: no JOIN, no OR, no parentheses/nesting — AND-only + `LIKE`. No PUT (create AND update both = POST `/{entity}`). No runtime webhook subscribe (portal-configured). No inline Customer/Item creation inside an Invoice (referenced entities must pre-exist). No Payments-scope features (`com.intuit.quickbooks.payment` not granted). No hard delete of name-list entities (Customer/Vendor/Item/Account) — deactivate via `Active:false`.

## Critical Gotchas

1. **Sparse-or-wipe.** A plain POST update CLEARS every omitted field. Patch a subset → send `"sparse":true` + `Id` + current `SyncToken`. (01c)
2. **`SyncToken` = optimistic lock.** Every update needs the CURRENT `SyncToken` (fresh GET). Stale → error **5010 "Stale Object Error"** (HTTP 400). GET-then-update, always.
3. **Relationships are `*Ref` objects**, never nested entities: `{"value":"<Id>"}`. Resolve `CustomerRef`/`ItemRef`/`IncomeAccountRef` by querying for the id BEFORE writing.
4. **Validation = HTTP 400, not 422.** Distinguish by `Fault.type` + `code`: `6240`=duplicate name, `2010`=missing field, `610`=ref not found, `5010`=stale, `4001`=parse error, `3200`=token, `003001`=throttle.
5. **Pin `minorversion=75`.** Never "latest" in prod — field behaviour shifts.
6. **`Accept: application/json`** or you may silently get XML.
7. **Empty query result = `"QueryResponse":{}`** — entity array key ABSENT, `totalCount` may be missing. Check the key exists; never index blindly.
8. **`companyinfo` resource id IS the realmId** (`GET /companyinfo/{realmId}`), not `"1"`.

## Defaults (override only if user specifies)

`minorversion=75` · `MAXRESULTS=100` (cap 1000; raise only for bulk) · `Accept=application/json` · production base (sandbox only in dev).

## Operations

All paths relative to `…/v3/company/{realmId}/`. `{entity}` ∈ `invoice|customer|item|bill|vendor|account|payment|billpayment`.

| Operation       | Method | Path                              | Notes                                                    |
| --------------- | ------ | --------------------------------- | -------------------------------------------------------- |
| Query / list    | GET    | /query?query=SELECT…              | URL-encoded SELECT; AND-only; primary read path          |
| Read one        | GET    | /{entity}/{id}                    | e.g. /invoice/130                                        |
| Create          | POST   | /{entity}                         | body, no `Id`; `?requestid={uuid}` to dedupe             |
| Update (full)   | POST   | /{entity}                         | body w/ `Id`+`SyncToken`; omitted fields CLEARED         |
| Update (sparse) | POST   | /{entity}                         | `sparse:true`+`Id`+`SyncToken`; only sent fields change  |
| Delete txn      | POST   | /{entity}?operation=delete        | `{Id,SyncToken}`; txn entities only; HITL-gate           |
| Void invoice    | POST   | /invoice?operation=void           | `{Id,SyncToken}`; lines kept, total→0; HITL-gate         |
| Invoice PDF     | GET    | /invoice/{id}/pdf                 | `Accept: application/pdf`; binary                        |
| Send invoice    | POST   | /invoice/{id}/send?sendTo={email} | sets `EmailStatus`                                       |
| Batch           | POST   | /batch                            | `BatchItemRequest[]` ≤30; partial success; 120/min/realm |
| CDC             | GET    | /cdc?entities=…&changedSince={ts} | ISO8601; full objects, many entities                     |
| Company info    | GET    | /companyinfo/{realmId}            | smoke test                                               |
| Preferences     | GET    | /preferences                      | multicurrency etc.                                       |
| Reports         | GET    | /reports/{reportName}             | lower limit ~200/min                                     |
| Upload          | POST   | /upload                           | Attachable, multipart/form-data                          |

## Pagination

Offset, expressed INSIDE the SELECT via `STARTPOSITION` (1-based) + `MAXRESULTS` (default 100, max 1000). No cursors.
`SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1 MAXRESULTS 1000`, then `STARTPOSITION 1001 …`. Always include a stable `ORDER BY Id` (deterministic offsets). Last page when returned array length < `MAXRESULTS` (or array key absent).

## Webhooks / Events

Webhooks exist but configured PER-APP in the Intuit portal, not at runtime; they carry only `{name,id,operation,lastUpdated}` — never the full entity (query by id on receipt). Verify via `intuit-signature` header (HMAC-SHA256 of raw body, app verifier token key). **Prefer CDC polling** (full objects, one call, runtime-controllable):
`GET /cdc?entities=Invoice,Customer,Bill,Payment,Item&changedSince=2026-05-28T00:00:00-07:00` — interval a few min, within 500/min. See 01d.

## Errors — `Fault` envelope

`{"Fault":{"Error":[{"Message":"Stale Object Error","Detail":"…","code":"5010","element":"SyncToken"}],"type":"ValidationFault"},"time":"…"}`
`Fault.type` ∈ `ValidationFault | AuthenticationFault | AuthorizationFault | SystemFault`. Parse `code`, not just status (validation is 400, not 422).
Recovery: 400 → read `code`, fix payload/query (no retry) · 400+5010 → GET fresh `SyncToken`, retry once · 400+6240 → unique name · 401 → relay refreshes, retry once · 403 → scope/realm, re-consent (no retry) · 404 → verify id in realm · 429 → backoff+jitter, cap parallelism 10 · 5xx → exponential backoff.

## Examples (JSON minified — parse identically)

1. **List unpaid invoices, newest first:**
   `GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice WHERE Balance > '0' ORDER BY TxnDate DESC MAXRESULTS 100&minorversion=75` (Accept: application/json)
   → `{"QueryResponse":{"startPosition":1,"maxResults":100,"totalCount":2,"Invoice":[{"Id":"130","SyncToken":"0","CustomerRef":{"value":"58","name":"Amy's Bird Sanctuary"},"TotalAmt":150.00,"Balance":150.00,"TxnDate":"2026-05-20","DueDate":"2026-06-19"}]},"time":"2026-05-29T10:00:00.123-07:00"}`

2. **Create invoice** (`POST /v3/company/{realmId}/invoice?minorversion=75`):
   `{"CustomerRef":{"value":"58"},"Line":[{"Amount":150.00,"DetailType":"SalesItemLineDetail","Description":"Consulting - 3 hours","SalesItemLineDetail":{"ItemRef":{"value":"1","name":"Consulting Services"},"Qty":3,"UnitPrice":50.00}}],"DueDate":"2026-06-28"}`
   → `{"Invoice":{"Id":"131","SyncToken":"0","DocNumber":"1071","TotalAmt":150.00,"Balance":150.00},"time":"…"}`

3. **Sparse update customer email** (`POST /v3/company/{realmId}/customer?minorversion=75`):
   `{"sparse":true,"Id":"58","SyncToken":"1","PrimaryEmailAddr":{"Address":"newemail@birds.com"}}`
   → full updated `Customer` with incremented `SyncToken`. Omit `"sparse":true` and every unspecified field is wiped.

4. **Record payment applied to invoice** (`POST /v3/company/{realmId}/payment?minorversion=75`):
   `{"CustomerRef":{"value":"58"},"TotalAmt":150.00,"Line":[{"Amount":150.00,"LinkedTxn":[{"TxnId":"131","TxnType":"Invoice"}]}]}`
   → linked invoice `Balance` drops to 0. Linked invoices must belong to the same `CustomerRef`.

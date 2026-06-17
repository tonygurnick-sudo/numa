---
api_name: QuickBooks Online Accounting API
api_slug: quickbooks
vendor: Intuit Inc.
base_url: https://quickbooks.api.intuit.com
base_url_sandbox: https://sandbox-quickbooks.api.intuit.com
path_template: /v3/company/{realmId}/{resource}[/{id}]?minorversion={n}
path_version_segment: /v3/ (REAL path segment, always present); minorversion is an additive QUERY param, not a path segment
protocol: HTTPS REST; JSON default / XML legacy / PDF via Accept
auth: OAuth2 authorization_code Bearer (the ONLY method — no API keys/basic); scope com.intuit.quickbooks.accounting
spec_format: none (no official OpenAPI; Postman collection is closest machine-readable artefact)
docs_url: https://developer.intuit.com/app/developer/qbo/docs/api/accounting
status_page: https://status.developer.intuit.com/
date_researched: 2026-05-29
confidence: everything [DOCUMENTED] against Intuit official ref + official/community SDKs unless tagged [INFERRED]/[UNKNOWN]. NO [CONFIRMED] live/sandbox call made — exact response wrappers, empty-result shapes, a few field nuances unverified. Verify against a sandbox company before trusting edge fields. Research trail: 00-api-investigation-questionnaire.md.
---

# API Spec Investigation — QuickBooks Online (Accounting API v3)

QBO's Accounting API exposes a small-business accounting ledger (invoices, customers, items, bills, payments, accounts) over REST + a SQL-like query language. Used by accounting integrations and now Numa's workspace agent to read+mutate a company's books. Analogous to MYOB/Xero.

**The `{realmId}` path segment is per-company** — NOT a fixed base URL. Captured during the OAuth callback (`?...&realmId=…`), persisted per authorised company, templated into every request path. One authorisation = one company. (QBO analogue of MYOB `businessId` / Xero tenant id.)

## Identity

| Property       | Value                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Version        | v3 (path-versioned) + additive `minorversion` query param                                              |
| Response       | JSON (default) / XML (legacy) / PDF (with `Accept`)                                                    |
| Base (prod)    | `https://quickbooks.api.intuit.com/v3/company/{realmId}/`                                              |
| Base (sandbox) | `https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}/`                                      |
| API reference  | https://developer.intuit.com/app/developer/qbo/docs/api/accounting                                     |
| OpenAPI        | None published; Postman: https://developer.intuit.com/app/developer/qbo/docs/develop/tutorials/postman |

## Authentication

OAuth 2.0 Authorization Code grant — the ONLY supported method (no API keys, no basic auth).

| Step           | Method | URL                                                                 |
| -------------- | ------ | ------------------------------------------------------------------- |
| Authorize      | GET    | `https://appcenter.intuit.com/connect/oauth2`                       |
| Token exchange | POST   | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`         |
| Token refresh  | POST   | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`         |
| Revocation     | POST   | `https://developer.api.intuit.com/v2/oauth2/tokens/revoke`          |
| Discovery doc  | GET    | `https://developer.api.intuit.com/.well-known/openid_configuration` |

Authorize + Token URLs match the connector registry entry (`oauth.authUrl`/`oauth.tokenUrl`) exactly — see 03.

**Authorize URL params:** `client_id` (app's Client ID) · `redirect_uri` (registered, byte-for-byte) · `response_type=code` · `scope=com.intuit.quickbooks.accounting` · `state` (CSRF, Numa always sends).

**Token response:** `access_token` (Bearer; 1h, `expires_in=3600`) · `refresh_token` (**rotates ~every 24h + on each exchange — store each time**) · `token_type=bearer` · `x_refresh_token_expires_in` (~100 days = `8640000`).

**Post-OAuth redirect:** `{redirect_uri}?code=AB11…&state={csrf}&realmId=4620816365212402417`. `code`=exchange for tokens; `state`=verify matches sent; `realmId`=**QBO company id, primary id for every API call path — persist it**. No "list companies" call; each auth scoped to exactly one realm; multiple companies = OAuth once per company.

**Token lifetimes:** access 1h; refresh ~100 days. **Rotation: yes** — new `refresh_token` ~every 24h + on every exchange, old one invalidated; persist or next refresh fails `invalid_grant`. PKCE: not required (confidential client uses `client_secret`; PKCE supported). Re-consent: when refresh token expires (~100d unused) or user revokes.
[DOCUMENTED] oauth-2.0 guide + help.developer.intuit.com/s/article/Validity-of-Refresh-Token

**Scopes:** `com.intuit.quickbooks.accounting` = full read/write to all Accounting entities — **required, the registry's sole scope**. NOT granted: `com.intuit.quickbooks.payment` (Payments API), `openid`/`profile`/`email` (OIDC identity, not needed).

## Required Headers

| Header          | Value                   | Required                                         |
| --------------- | ----------------------- | ------------------------------------------------ |
| `Authorization` | `Bearer {access_token}` | Always (relay-injected)                          |
| `Accept`        | `application/json`      | Always — **omit → API may silently return XML**  |
| `Content-Type`  | `application/json`      | POST writes (query body uses `application/text`) |
| `Content-Type`  | `multipart/form-data`   | Attachable file uploads (`/upload`)              |

The Numa relay attaches `Authorization` automatically; the agent builds path + body + `Accept`/`Content-Type`. See 01.

## URL Structure & Versioning

```
https://quickbooks.api.intuit.com/v3/company/{realmId}/{resource}[/{id}]?minorversion={n}
https://quickbooks.api.intuit.com/v3/company/{realmId}/query?query={SQL}&minorversion={n}
```

- Path `/v3/` is a fixed REAL segment; behaviour layered via the additive `minorversion` QUERY param.
- **Pin `minorversion`.** Minor versions 1–74 deprecated Aug 2025; **75 is the current minimum**. Never "latest" in prod — field behaviour shifts between versions. Ref: developer.intuit.com/app/developer/qbo/docs/develop/explore-the-quickbooks-online-api/minor-versions

## Endpoint Catalog

All paths relative to `…/v3/company/{realmId}/`. `{entity}` ∈ `invoice|customer|item|bill|payment|…` (case-insensitive in the path; PascalCase in the query language + JSON bodies).

| #   | Method | Path                                | Purpose / Notes                                                                                                                                        |
| --- | ------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | GET    | `/query?query=SELECT…`              | Read/list/filter any entity; STARTPOSITION/MAXRESULTS paginated; AND-only dialect                                                                      |
| 2   | GET    | `/{entity}/{id}`                    | Read one (e.g. `/invoice/130`) → `{"<Entity>":{…},"time":"…"}`                                                                                         |
| 3   | POST   | `/{entity}`                         | **Create OR update** (no PUT). No `Id`=create (use `requestid` to dedupe); `Id`+`SyncToken`=update; add `"sparse":true` to update only supplied fields |
| 4   | POST   | `/{entity}?operation=delete`        | Delete a transaction (txn entities only)                                                                                                               |
| 5   | POST   | `/invoice?operation=void`           | Void invoice; total→0, lines retained                                                                                                                  |
| 6   | GET    | `/invoice/{id}/pdf`                 | Download PDF; `Accept: application/pdf` (binary)                                                                                                       |
| 7   | POST   | `/invoice/{id}/send?sendTo={email}` | Email invoice; sets `EmailStatus`                                                                                                                      |
| 8   | POST   | `/batch`                            | ≤30 mixed ops; 120/min/realm; partial success                                                                                                          |
| 9   | GET    | `/cdc?entities=…&changedSince={ts}` | Change Data Capture; full objects for many entities since a timestamp                                                                                  |
| 10  | GET    | `/companyinfo/{realmId}`            | Company metadata; smoke test — id IS the realmId                                                                                                       |
| 11  | GET    | `/preferences`                      | Company preferences (multicurrency, etc.)                                                                                                              |
| 12  | POST   | `/upload`                           | `Attachable` multipart upload                                                                                                                          |
| 13  | GET    | `/reports/{reportName}`             | Run a report (P&L, A/R aging); lower limit ~200/min                                                                                                    |

**No PUT.** Create and update both go through `POST /{entity}`.

## Data Models

Every entity shares the `Id` + `SyncToken` + `MetaData` envelope. Relationships are `*Ref` objects (`{"value":"<Id>","name":"<opt>"}`), never nested child entities. `Id`/`SyncToken` are strings in JSON. Full field tables in 01a — key fields below.

**Customer** (`/customer`): `Id`(sys), `SyncToken`(update), `DisplayName`(cond, unique per realm), `GivenName`/`FamilyName`, `CompanyName`, `PrimaryEmailAddr`={"Address":…}, `PrimaryPhone`={"FreeFormNumber":…}, `BillAddr`, `Balance`(computed), `Active`(false=deactivated; no hard delete).

**Item** (`/item`): `Id`(sys), `SyncToken`, `Name`(unique per realm), `Type`(`Inventory|Service|NonInventory|Group|Category|Bundle`), `UnitPrice`, `IncomeAccountRef`(req Service/Inventory), `ExpenseAccountRef`/`AssetAccountRef`(req Inventory), `QtyOnHand`(Inventory, with `TrackQtyOnHand:true`+`InvStartDate`), `Active`.

**Invoice** (`/invoice`): `Id`(sys), `SyncToken`, `CustomerRef`(req), `Line`(req; `SalesItemLineDetail` etc.), `DocNumber`, `TxnDate`/`DueDate`(`YYYY-MM-DD`), `TotalAmt`(computed), `Balance`(computed, 0 once paid), `EmailStatus`(`NotSet|NeedToSend|EmailSent`), `LinkedTxn`(sys). No explicit paid/unpaid enum — derive from `Balance` vs `TotalAmt`; `EmailStatus` is separate.

**Bill** (`/bill`): `Id`(sys), `SyncToken`, `VendorRef`(req), `Line`(req; `AccountBasedExpenseLineDetail`/`ItemBasedExpenseLineDetail`), `TxnDate`/`DueDate`, `TotalAmt`/`Balance`(computed).

**Payment** (`/payment`): customer payment received vs invoices (A/R). Vendor-side payment of a Bill = separate `/billpayment`. `Id`(sys), `SyncToken`, `CustomerRef`(req), `TotalAmt`(req), `Line`(apply via `LinkedTxn`,`TxnType=Invoice`), `DepositToAccountRef`, `TxnDate`, `UnappliedAmt`(sys).

**Relationships:** `Customer ←CustomerRef← Invoice ←LinkedTxn← Payment`; `Vendor ←VendorRef← Bill`; `Item` referenced by `Invoice.Line[].ItemRef`/`Bill.Line[].ItemRef`; `Item.IncomeAccountRef`/`ExpenseAccountRef`/`AssetAccountRef` → `Account`. Referenced entities (Customer/Vendor/Item/Account) must exist BEFORE referencing — no inline creation. A `Payment` links only to `Invoice`s of the same `CustomerRef`.

**Field formats:** dates `YYYY-MM-DD`; datetimes `YYYY-MM-DDThh:mm:ss±hh:mm`; currency = plain decimal (no symbol); ids = numeric strings; `realmId` = long numeric string in the URL path.

## Query & Filter (SQL-like dialect)

`query` takes a URL-encoded `SELECT`. NOT SQL — Intuit's restricted dialect.
`GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice WHERE Balance > '0' ORDER BY TxnDate DESC STARTPOSITION 1 MAXRESULTS 100`

| Capability              | Supported?   | Syntax / Note                                               |
| ----------------------- | ------------ | ----------------------------------------------------------- |
| Filter by field         | Yes          | `WHERE DisplayName = 'Amy'`                                 |
| Date range              | Yes          | `WHERE TxnDate >= '2026-01-01' AND TxnDate <= '2026-05-31'` |
| Comparison              | Yes          | `=`,`<`,`>`,`<=`,`>=`,`IN`,`LIKE`                           |
| Text match              | Partial      | `LIKE 'Amy%'` / `LIKE '%pump%'` — no true full-text         |
| Sort                    | Yes          | `ORDER BY TxnDate [DESC]`                                   |
| Field selection         | Yes          | `SELECT Id, DocNumber FROM Invoice` or `SELECT *`           |
| Count                   | Yes          | `SELECT COUNT(*) FROM Invoice` → `totalCount`               |
| Logical                 | **AND only** | **No `OR`**                                                 |
| Parentheses/nesting     | **No**       |                                                             |
| JOINs / include related | **No**       | resolve `*Ref` ids with follow-up queries                   |
| Null checks             | Limited      | not generally supported — [INFERRED, verify in sandbox]     |

Common patterns:

```sql
SELECT * FROM Invoice WHERE Balance > '0' ORDER BY TxnDate DESC MAXRESULTS 100        -- unpaid, newest first
SELECT * FROM Customer WHERE DisplayName LIKE 'Amy%'                                  -- find customer by name
SELECT * FROM Bill WHERE VendorRef = '56' AND DueDate <= '2026-05-31' AND Balance > '0'  -- bills due this month for a vendor
SELECT * FROM Customer WHERE MetaData.LastUpdatedTime > '2026-05-28T00:00:00-07:00'   -- incremental sync
```

Full query reference: 01b.

## Pagination

Offset, expressed INSIDE the SELECT via `STARTPOSITION` (1-based) + `MAXRESULTS`. Default page 100, max 1000. No cursors. Total via `SELECT COUNT(*)`; list responses echo `startPosition`/`maxResults`.
List shape: `{"QueryResponse":{"startPosition":1,"maxResults":100,"totalCount":2,"Invoice":[…up to 100…]},"time":"2026-05-29T10:00:00.000-07:00"}`

```
Page 1: SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1    MAXRESULTS 1000
Page 2: SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1001 MAXRESULTS 1000
Last:   returned array length < 1000 → stop
```

Last-page detection: array has fewer rows than `MAXRESULTS` (or is absent). Always include a stable `ORDER BY Id`. **Empty-result gotcha:** zero rows → `"QueryResponse":{}`, entity array key ABSENT, `totalCount` may be omitted — handle the missing-key case. [INFERRED on exact empty shape]

## Rate Limits

| Scope                  | Limit        | Window | Notes                        |
| ---------------------- | ------------ | ------ | ---------------------------- |
| Per company (realmId)  | 500          | /min   | primary throttle             |
| Concurrent / realm     | 10 in flight | —      | 11th concurrent → throttled  |
| Batch endpoint / realm | 120          | /min   | raised from 40 on 2025-10-31 |
| Reports / heavy        | ~200         | /min   | lower than the global 500    |

NO reliable `X-RateLimit-*` headers, generally no `Retry-After` — detect via 429. `intuit_tid` present on every response; quote in support tickets. 429 body: `{"Fault":{"Error":[{"Message":"ThrottleExceeded","Detail":"You have exceeded the number of allowed requests.","code":"003001"}],"type":"ValidationFault"},"time":"…"}`. Strategy: exponential backoff WITH jitter; cap parallelism at 10. [Source: Intuit help KB + 2026 guides Coefficient/Satva/Truto; header behaviour INFERRED]

## Error Handling

Fault envelope: `{"Fault":{"Error":[{"Message":"Stale Object Error","Detail":"Stale Object Error : You and someone else were working on this at the same time...","code":"5010","element":"SyncToken"}],"type":"ValidationFault"},"time":"…"}`. `Fault.type` ∈ `ValidationFault | AuthenticationFault | AuthorizationFault | SystemFault`. **Most validation failures return HTTP 400, not 422** — distinguish by `Fault.type` + `code`, not status alone.

| HTTP | Code      | Retryable     | Recovery                                     |
| ---- | --------- | ------------- | -------------------------------------------- |
| 400  | 4000/4001 | No            | fix the SELECT syntax / JSON                 |
| 400  | 2010      | No            | add the missing field                        |
| 400  | 6240      | No            | use a unique `DisplayName`/`Name`            |
| 400  | 5010      | After refetch | GET latest, retry with fresh `SyncToken`     |
| 400  | 610       | No            | verify the id exists in this realm           |
| 401  | 3200      | Yes           | refresh token, retry once                    |
| 403  | —         | No            | re-consent with correct scope; check realmId |
| 429  | 003001    | Yes           | backoff + jitter; cap parallelism at 10      |
| 5xx  | —         | Yes           | retry with backoff; check status page        |

Full Fault catalogue: 01d.

## Webhooks / Events

**Supported — configured per-app in the Intuit portal, not at runtime via API.** Registration: portal sets notification endpoint URL + entities/operations; HTTPS only, respond 200 quickly. Payload: only `{name,id,operation,lastUpdated}` per change — NEVER the full entity (query by id on receipt). Verification: `intuit-signature` header — HMAC-SHA256 of raw body using app verifier token; compare base64. Retry: Intuit retries failed deliveries w/ backoff; events batched/coalesced; duplicate delivery possible → handlers idempotent; ordering not guaranteed.

CDC (polling, preferred for the agent): `GET /v3/company/{realmId}/cdc?entities=Invoice,Customer,Bill,Payment,Item&changedSince=2026-05-28T00:00:00-07:00`. Full objects for everything changed since the timestamp in one call (cheaper than per-entity polling). `changedSince` reaches ~30 days back. Change-detection fields: `MetaData.LastUpdatedTime`, `SyncToken`. Detail: 01d.

## Idempotency, Async & Files

- **Idempotency:** GET idempotent; POST-create is not — use `requestid` query param to dedupe retried writes (`POST /invoice?requestid=abc123`). POST-update with `Id`+`SyncToken` is effectively idempotent via the lock. No header form of the key.
- **Async:** none — all writes (and `/batch`, ≤30 items) are synchronous.
- **Files:** `POST /upload` (multipart) attaches files via the `Attachable` entity; `GET /invoice/{id}/pdf` (with `Accept: application/pdf`) downloads a PDF; Attachable downloads via a `TempDownloadUri`.
- **Concurrency:** optimistic locking via `SyncToken` (increments per update; stale → error 5010). GET-then-update, always.

## Known Limitations

1. Query dialect restricted: AND-only, no `OR`/`JOIN`/parentheses; text only `LIKE '%…%'`. For OR, run multiple queries or use CDC.
2. No PUT — create and update both = `POST /{entity}`. A plain update CLEARS every omitted field; send `"sparse":true` for a partial update.
3. `Retry-After`/`X-RateLimit-*` not reliably returned — implement client-side backoff.
4. No `[CONFIRMED]` live responses — field names/wrappers verified against docs+SDKs only. Verify exact wrappers + empty-result shapes against a sandbox before trusting edge fields.

## SDKs & Tooling

Numa drives QBO through the relay (`connect_request` / `connectors(name="request",…)`), so NO SDK is embedded — SDKs are reference material for exact field names only.

| SDK                | Language | Repository                           | Quality | Notes                           |
| ------------------ | -------- | ------------------------------------ | ------- | ------------------------------- |
| oauth-jsclient     | Node.js  | github.com/intuit/oauth-jsclient     | Good    | Official — OAuth/token only     |
| oauth-pythonclient | Python   | github.com/intuit/oauth-pythonclient | Good    | Official — OAuth/token only     |
| python-quickbooks  | Python   | github.com/ej2/python-quickbooks     | Good    | Community — confirm field names |
| node-quickbooks    | Node.js  | (community)                          | Fair    | Reference for entity shapes     |
| .NET / PHP / Java  | various  | Intuit official                      | Good    | Reference for CRUD semantics    |

Postman: developer.intuit.com/app/developer/qbo/docs/develop/tutorials/postman. OpenAPI: none (Postman is the closest machine-readable artefact).

## Integration Path Assessment

**Recommended: Direct API via `connect_request` (Direct API Only).** QBO exposes transactional + name-list accounting entities through a SQL-like query endpoint plus REST CRUD — no browsable file tree for Files Remote (mirrors MYOB/Xero). The agent issues `connect_request`-style calls through the Numa relay, which injects the stored OAuth bearer token and forwards to `https://quickbooks.api.intuit.com/v3/company/{realmId}/…`. **NOT a Data Connector (Files).**

| Connector Method     | API Endpoint                                        | Feasibility |
| -------------------- | --------------------------------------------------- | ----------- |
| list_files           | n/a                                                 | none        |
| download_file        | `/invoice/{id}/pdf` (incidental)                    | partial     |
| search_files         | n/a                                                 | none        |
| get_file_metadata    | n/a                                                 | none        |
| request (direct API) | `/query`, `/{entity}`, `/batch`, `/cdc`, `/reports` | good        |

## Unknowns Requiring Live Testing

| Unknown                                 | Impact            | How to Verify                                                |
| --------------------------------------- | ----------------- | ------------------------------------------------------------ |
| Exact response wrappers / field names   | Field mapping     | `GET /companyinfo/{realmId}`, `GET /invoice/{id}` in sandbox |
| Empty-result shape (`QueryResponse:{}`) | Read parsing      | run a zero-match query in sandbox                            |
| Current `minorversion` to pin           | Field stability   | confirm latest stable minor version at build time            |
| `Retry-After`/`X-RateLimit-*` presence  | Backoff strategy  | trigger a 429 in sandbox; inspect headers                    |
| Null-check support in query dialect     | Query correctness | test `WHERE Field = NULL`-style filters in sandbox           |

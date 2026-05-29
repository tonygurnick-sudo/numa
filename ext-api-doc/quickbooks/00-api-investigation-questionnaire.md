---
api_name: 'QuickBooks Online Accounting API'
api_slug: 'quickbooks'
vendor: 'Intuit Inc.'
website: 'https://developer.intuit.com/app/developer/qbo/docs/api/accounting'
investigation_started: '2026-05-29'
investigator: 'Claude Code'
investigation_status: 'in-progress' # not-started | in-progress | blocked | complete
documentation_quality: 'excellent' # excellent | good | adequate | poor | nonexistent
api_types: [REST] # REST | GraphQL | SOAP | gRPC | WebSocket | SSE
overall_confidence: 'medium' # high | medium | low
blockers: []
---

# API Investigation Questionnaire: QuickBooks Online Accounting API v3

> Drives the entire integration package for the `quickbooks` connector (authType `oauth2`).
> Connector registry entry: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id: 'quickbooks'`).
>
> **Confidence markers:** `[CONFIRMED]` (live call — none here, no sandbox auth), `[DOCUMENTED]` (official Intuit docs), `[INFERRED]` (SDK/3rd-party/behavioural), `[UNKNOWN]`.
>
> **Honesty note:** QuickBooks is a well-documented, mature API. Almost everything below is `[DOCUMENTED]`. No claim is marked `[CONFIRMED]` because no authenticated live call was made during this investigation. A few specific field-level details and exact response wrappers are `[INFERRED]` and flagged for sandbox verification.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account — [DOCUMENTED]
- **API reference / endpoint catalog URL:** https://developer.intuit.com/app/developer/qbo/docs/api/accounting (left-nav lists every entity) — [DOCUMENTED]
- **Authentication guide URL:** https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0 — [DOCUMENTED]
- **Changelog / release notes URL:** https://developer.intuit.com/app/developer/qbo/docs/develop/explore-the-quickbooks-online-api/minor-versions (additive minor-version system) — [DOCUMENTED]
- **Status page URL:** https://status.developer.intuit.com/ — [DOCUMENTED]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** No official public OpenAPI spec published by Intuit. Postman collection is the closest machine-readable artefact. — [INFERRED]
- **Postman collection URL:** https://developer.intuit.com/app/developer/qbo/docs/develop/tutorials/postman (official Intuit Postman workspace) — [DOCUMENTED]
- **Official SDK repositories:**
  - Python: https://github.com/intuit/oauth-pythonclient (OAuth) + community `python-quickbooks` (https://github.com/ej2/python-quickbooks) — [DOCUMENTED]
  - Node.js: https://github.com/intuit/oauth-jsclient (official OAuth client); `node-quickbooks` community — [DOCUMENTED]
  - Other: official .NET (`IppDotNetSdkForQuickBooksApiV3`), PHP (`QuickBooks-V3-PHP-SDK`), Java, Ruby (`quickbooks-ruby`) — [DOCUMENTED]
- **Official blog / engineering blog:** https://blogs.intuit.com/ ; developer help: https://help.developer.intuit.com/ — [DOCUMENTED]
- **Community forums / Stack Overflow tag:** Intuit Developer community (https://help.developer.intuit.com/s/), SO tag `quickbooks-online` — [DOCUMENTED]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                  |
| ------------------------- | ------ | -------------------------------------------------------------------------------------- |
| Authentication            | 5      | Full OAuth 2.0 guide, playground, token-rotation FAQ                                   |
| Endpoint reference        | 5      | Per-entity reference pages with full field tables and CRUD operations                  |
| Request/response examples | 5      | Every entity page shows full JSON request + response samples                           |
| Error documentation       | 4      | Fault/Error envelope documented; full error-code catalogue spread across help articles |
| Rate limit documentation  | 4      | Documented (500/min/realm, 10 concurrent, batch 40→120/min); some details in help KB   |
| Pagination documentation  | 5      | `STARTPOSITION` / `MAXRESULTS` documented in the query-operations page                 |
| Webhook documentation     | 5      | Dedicated webhooks + CDC pages with HMAC verification                                  |
| SDKs / code examples      | 5      | Official SDKs in 6+ languages, OAuth playground                                        |
| Changelog / versioning    | 5      | Minor-version page lists every additive change                                         |

**Overall documentation quality:** excellent

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Found or confirmed no OpenAPI/Swagger spec (no official OpenAPI; Postman collection exists)
- [x] Identified authentication method (OAuth 2.0 authorization_code)
- [x] Found at least one working example (docs + apideck real response wrapper)
- [x] Identified rate limit information (500/min/realm; 10 concurrent; batch throttle)
- [x] Identified pagination approach (`STARTPOSITION`/`MAXRESULTS` in query)
- [x] Checked for webhook/event support (webhooks + CDC both supported)
- [x] Checked for official SDKs (multiple official SDKs)

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** QuickBooks Online Accounting API (v3) — [DOCUMENTED]
- **Vendor / company:** Intuit Inc. — [DOCUMENTED]
- **Current API version:** v3 (path-versioned). Behavioural changes layered via additive `minorversion` query param — current minor version is in the 70s range (e.g. `minorversion=75`). — [DOCUMENTED]
- **Base URL(s):**
  - Production: `https://quickbooks.api.intuit.com/v3/company/{realmId}/` — [DOCUMENTED]
  - Sandbox / testing: `https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}/` — [DOCUMENTED]
- **API type:** REST (JSON; XML also supported but JSON is the default and what Numa will use) — [DOCUMENTED]

> **Connector note:** The registry entry has **no static base/instance URL field** — the base URL is host-fixed but the **`{realmId}`** path segment is per-company and is returned during the OAuth callback (see 2.3). The connector must capture and persist `realmId` per authorised company, then template it into every request path. This is the QuickBooks analogue of MYOB's `businessId` / Xero's tenant id.

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTP/1.1 (HTTP/2 negotiable at the edge) — [INFERRED]
- **Data format:** JSON (default); XML supported — [DOCUMENTED]
- **Content-Type header(s):** `application/json` for read/write; `application/text` for the SQL-like query body; `multipart/form-data` for Attachable uploads — [DOCUMENTED]
- **Character encoding:** UTF-8 — [INFERRED]
- **URL structure pattern:**

```
https://quickbooks.api.intuit.com/v3/company/{realmId}/{resource}[/{id}]?minorversion={n}
https://quickbooks.api.intuit.com/v3/company/{realmId}/query?query={SQL}&minorversion={n}
```

- **Versioning strategy:** URL path (`/v3/`) + additive `minorversion` query parameter — [DOCUMENTED]
- **CORS policy:** Not designed for browser-direct calls — calls go through Numa's `connect_request` relay (server-side), so CORS is not a factor. — [INFERRED]
- **Required headers (all requests):**

| Header                                 | Value              | Purpose                                            |
| -------------------------------------- | ------------------ | -------------------------------------------------- |
| `Authorization: Bearer {access_token}` | OAuth 2.0 bearer   | Auth (1-hour access token)                         |
| `Accept: application/json`             | `application/json` | Request JSON responses (else XML may be returned)  |
| `Content-Type: application/json`       | `application/json` | For POST writes (use `application/text` for query) |

[DOCUMENTED] — https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0

### 2.3 Authentication [REQUIRED]

- **Auth method:** OAuth 2.0 (Authorization Code grant) — **the only** supported method; no API keys, no basic auth. — [DOCUMENTED]
- **Auth location:** Header — `Authorization: Bearer {token}` — [DOCUMENTED]
- **Auth header format:** `Authorization: Bearer {access_token}` — [DOCUMENTED]

**For OAuth 2.0:**

- **Grant type(s) supported:** `authorization_code`, `refresh_token` — [DOCUMENTED]
- **Authorization URL:** `https://appcenter.intuit.com/connect/oauth2` — **matches registry `oauth.authUrl`** — [DOCUMENTED]
- **Token URL:** `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` — **matches registry `oauth.tokenUrl`** — [DOCUMENTED]
- **Revocation URL:** `https://developer.api.intuit.com/v2/oauth2/tokens/revoke` — [DOCUMENTED]
- **Discovery document:** `https://developer.api.intuit.com/.well-known/openid_configuration` (production) — [DOCUMENTED]
- **Required scopes:**

| Scope                                            | Purpose                                                    | Required?                                   |
| ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------- |
| `com.intuit.quickbooks.accounting`               | Full read/write to the Accounting API (all entities below) | **YES** — this is the registry's sole scope |
| `com.intuit.quickbooks.payment`                  | QuickBooks Payments API (charges, tokens)                  | No — out of scope for this connector        |
| `openid`, `profile`, `email`, `phone`, `address` | OpenID Connect identity claims                             | No — not needed for accounting data access  |

Registry `oauth.scopes` = `com.intuit.quickbooks.accounting` — **CONFIRMED MATCH** with the required scope. — [DOCUMENTED]

- **Token lifetime:** Access token **1 hour (3600 s)**. Refresh token **valid ~100 days**, and **rotates** — a new refresh token is returned roughly every 24 hours and on token exchange; when a new one is issued the previous one is invalidated. — [DOCUMENTED]
- **Refresh token behavior:** Manual — caller must POST `grant_type=refresh_token` to the token URL and **persist the new `refresh_token` from every response** (rotation). Failing to store the rotated token causes `invalid_grant` on the next refresh. — [DOCUMENTED]
- **PKCE required?** No (server-side confidential client uses `client_secret`; PKCE supported but not required) — [DOCUMENTED]
- **State parameter required?** Strongly recommended (CSRF protection); not strictly enforced but Numa's OAuth layer sends it. — [DOCUMENTED]
- **Redirect URI restrictions:** HTTPS required (except `localhost` for dev). Must exactly match a redirect URI registered in the Intuit app's Keys & credentials. — [DOCUMENTED]

**OAuth callback — realmId capture (critical):**

After consent, Intuit redirects to the registered redirect URI with **both** an authorization `code` **and** a `realmId` query parameter:

```
{redirect_uri}?code=AB11...&state={csrf}&realmId=4620816365212402417
```

The `realmId` identifies the QuickBooks company and **must be persisted** alongside the tokens — it is not part of the token response and there is no API call to "list companies" for a token (each authorisation is scoped to exactly one realm). To connect multiple companies, run the OAuth flow once per company. — [DOCUMENTED]

### 2.4 First Successful Call [REQUIRED] — CRITICAL GATE

> **GATE NOT PASSED LIVE.** No authenticated call was made (no sandbox credentials available in this environment). The example below is the **documented** canonical first call. It must be executed against a sandbox before downstream docs are treated as `[CONFIRMED]`.

**Endpoint used for first call (recommended smoke test):**

```http
GET /v3/company/{realmId}/companyinfo/{realmId}?minorversion=75 HTTP/1.1
Host: sandbox-quickbooks.api.intuit.com
Authorization: Bearer {access_token}
Accept: application/json
```

**Expected response (documented shape):**

```json
{
  "CompanyInfo": {
    "CompanyName": "Sandbox Company_US_1",
    "LegalName": "Sandbox Company_US_1",
    "Country": "US",
    "Id": "1",
    "SyncToken": "4",
    "MetaData": {
      "CreateTime": "2024-01-10T09:30:00-08:00",
      "LastUpdatedTime": "2024-08-12T11:17:56-07:00"
    }
  },
  "time": "2026-05-29T11:17:56.425-07:00"
}
```

- **HTTP status code:** 200 (expected) — [DOCUMENTED]
- **Response headers of note:** `intuit_tid` (transaction id — always quote in support tickets) — [DOCUMENTED]
- **Time to first successful call:** N/A (not executed)
- **Gotchas encountered during setup:** (a) forgetting `Accept: application/json` yields XML; (b) using the wrong realm/host (sandbox vs prod) yields 401/403; (c) `companyinfo` requires the `realmId` as the resource id, not "1". — [DOCUMENTED]/[INFERRED]

- [ ] **GATE CHECK: First successful API call completed and documented above** — NOT DONE (no live credentials). Treat all response field names as `[DOCUMENTED]`/`[INFERRED]`, not `[CONFIRMED]`.

---

## Phase 3: Domain Model & Behavior

> Focus on the entities named in the brief: **Invoice, Customer, Item, Bill, Payment**. Each is a first-class QBO transaction/name-list entity with full CRUD via REST + read via the SQL-like query. All entities share the `Id` + `SyncToken` + `MetaData` envelope and use `*Ref` objects (`{"value": "<Id>", "name": "<optional>"}`) to express relationships.

### 3.1 Core Entities [REQUIRED]

#### Entity: Customer

- **API resource name / endpoint path:** `/customer` (singular) — [DOCUMENTED]
- **Description:** A name-list entity representing someone you invoice. — [DOCUMENTED]
- **CRUD support:** Create / Read / **Update (full + sparse)** / no hard Delete — Customers are deactivated via `Active: false` sparse update, not deleted. — [DOCUMENTED]

**Fields (selected):**

| Field                    | Type    | Required?   | Writable? | Description                                  | Example Value            |
| ------------------------ | ------- | ----------- | --------- | -------------------------------------------- | ------------------------ |
| `Id`                     | string  | system      | no        | Entity id (per realm)                        | `"58"`                   |
| `SyncToken`              | string  | for update  | no        | Optimistic-lock version (increments)         | `"0"`                    |
| `DisplayName`            | string  | conditional | yes       | Unique display name (one of name fields req) | `"Amy's Bird Sanctuary"` |
| `GivenName`/`FamilyName` | string  | no          | yes       | Person name parts                            | `"Amy"` / `"Lauterbach"` |
| `CompanyName`            | string  | no          | yes       | Business name                                | `"Amy's Bird Sanctuary"` |
| `PrimaryEmailAddr`       | object  | no          | yes       | `{ "Address": "amy@birds.com" }`             |                          |
| `PrimaryPhone`           | object  | no          | yes       | `{ "FreeFormNumber": "(650) 555-1234" }`     |                          |
| `BillAddr`               | object  | no          | yes       | Address sub-object                           |                          |
| `Balance`                | decimal | system      | no        | Open balance (computed)                      | `239.00`                 |
| `Active`                 | boolean | no          | yes       | Active flag (false = deactivated)            | `true`                   |

[DOCUMENTED] — https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer

#### Entity: Item

- **API resource name / endpoint path:** `/item` — [DOCUMENTED]
- **Description:** A product/service line that appears on invoices/bills. `Type` ∈ `Inventory | Service | NonInventory | Group | Category | Bundle`. — [DOCUMENTED]
- **CRUD support:** Create / Read / Update (full + sparse); deactivate via `Active: false` (no hard delete). — [DOCUMENTED]

**Fields (selected):**

| Field               | Type    | Required?   | Writable?   | Description                                 | Example Value    |
| ------------------- | ------- | ----------- | ----------- | ------------------------------------------- | ---------------- |
| `Id`                | string  | system      | no          | Item id                                     | `"19"`           |
| `SyncToken`         | string  | for update  | no          | Lock version                                | `"2"`            |
| `Name`              | string  | yes         | yes         | Unique item name                            | `"Pump"`         |
| `Type`              | enum    | yes         | yes(create) | Item type                                   | `"Inventory"`    |
| `UnitPrice`         | decimal | no          | yes         | Sales price                                 | `12.75`          |
| `IncomeAccountRef`  | Ref     | conditional | yes         | Required for Service/Inventory              | `{"value":"79"}` |
| `ExpenseAccountRef` | Ref     | conditional | yes         | Required for Inventory                      | `{"value":"80"}` |
| `AssetAccountRef`   | Ref     | conditional | yes         | Required for Inventory                      | `{"value":"81"}` |
| `QtyOnHand`         | decimal | conditional | yes(create) | Inventory only; with `TrackQtyOnHand: true` | `10`             |
| `Active`            | boolean | no          | yes         | Active flag                                 | `true`           |

[DOCUMENTED] — https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/item

#### Entity: Invoice

- **API resource name / endpoint path:** `/invoice` — [DOCUMENTED]
- **Description:** A sales transaction (A/R). Must reference a `CustomerRef` and one or more `Line` items. — [DOCUMENTED]
- **CRUD support:** Create / Read / Update (full + sparse) / **Delete** (transactions can be deleted via `?operation=delete`) / send-PDF, get-PDF, void. — [DOCUMENTED]

**Fields (selected):**

| Field         | Type    | Required?  | Writable? | Description                             | Example Value       |
| ------------- | ------- | ---------- | --------- | --------------------------------------- | ------------------- | ---------- | -------------- |
| `Id`          | string  | system     | no        | Invoice id                              | `"130"`             |
| `SyncToken`   | string  | for update | no        | Lock version                            | `"0"`               |
| `CustomerRef` | Ref     | yes        | yes       | The customer being billed               | `{"value":"58"}`    |
| `Line`        | array   | yes        | yes       | Line items (`SalesItemLineDetail` etc.) | see request example |
| `DocNumber`   | string  | no         | yes       | Invoice number                          | `"1070"`            |
| `TxnDate`     | date    | no         | yes       | Transaction date                        | `"2026-05-29"`      |
| `DueDate`     | date    | no         | yes       | Payment due date                        | `"2026-06-28"`      |
| `TotalAmt`    | decimal | system     | no        | Computed total                          | `150.00`            |
| `Balance`     | decimal | system     | no        | Outstanding balance (0 once paid)       | `0`                 |
| `EmailStatus` | enum    | no         | yes       | `NotSet                                 | NeedToSend          | EmailSent` | `"NeedToSend"` |
| `LinkedTxn`   | array   | system     | no        | Links to Payments/CreditMemos applied   |                     |

[DOCUMENTED] — https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice

#### Entity: Bill

- **API resource name / endpoint path:** `/bill` — [DOCUMENTED]
- **Description:** A purchase transaction (A/P) owed to a vendor. References `VendorRef` and one or more `Line` items (`AccountBasedExpenseLineDetail` or `ItemBasedExpenseLineDetail`). — [DOCUMENTED]
- **CRUD support:** Create / Read / Update (full + sparse) / Delete (`?operation=delete`). — [DOCUMENTED]

**Fields (selected):**

| Field       | Type    | Required?  | Writable? | Description         | Example Value    |
| ----------- | ------- | ---------- | --------- | ------------------- | ---------------- |
| `Id`        | string  | system     | no        | Bill id             | `"890"`          |
| `SyncToken` | string  | for update | no        | Lock version        | `"0"`            |
| `VendorRef` | Ref     | yes        | yes       | The vendor owed     | `{"value":"56"}` |
| `Line`      | array   | yes        | yes       | Expense/item lines  | see example      |
| `TxnDate`   | date    | no         | yes       | Bill date           | `"2026-05-29"`   |
| `DueDate`   | date    | no         | yes       | Due date            | `"2026-06-28"`   |
| `TotalAmt`  | decimal | system     | no        | Computed total      | `200.00`         |
| `Balance`   | decimal | system     | no        | Outstanding balance | `200.00`         |

[DOCUMENTED] — https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/bill

#### Entity: Payment

- **API resource name / endpoint path:** `/payment` — [DOCUMENTED]
- **Description:** A customer payment received against one or more invoices (A/R). Links to invoices via `Line[].LinkedTxn`. (Vendor-side payment of a Bill is a separate `/billpayment` entity.) — [DOCUMENTED]
- **CRUD support:** Create / Read / Update (full + sparse) / Delete (`?operation=delete`) / void. — [DOCUMENTED]

**Fields (selected):**

| Field                 | Type    | Required?  | Writable? | Description                                         | Example Value    |
| --------------------- | ------- | ---------- | --------- | --------------------------------------------------- | ---------------- |
| `Id`                  | string  | system     | no        | Payment id                                          | `"123"`          |
| `SyncToken`           | string  | for update | no        | Lock version                                        | `"0"`            |
| `CustomerRef`         | Ref     | yes        | yes       | Customer who paid                                   | `{"value":"58"}` |
| `TotalAmt`            | decimal | yes        | yes       | Payment amount                                      | `150.00`         |
| `Line`                | array   | no         | yes       | Apply to invoices via `LinkedTxn` (TxnType=Invoice) | see example      |
| `DepositToAccountRef` | Ref     | no         | yes       | Account funds deposited to                          | `{"value":"35"}` |
| `TxnDate`             | date    | no         | yes       | Payment date                                        | `"2026-05-29"`   |
| `UnappliedAmt`        | decimal | system     | no        | Amount not yet applied to an invoice                | `0`              |

[DOCUMENTED] — https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/payment

### 3.2 Entity Relationships [IMPORTANT]

```
┌──────────┐    invoiced to     ┌──────────┐    pays via       ┌───────────┐
│ Customer │<───CustomerRef─────│ Invoice  │<──LinkedTxn───────│  Payment  │
└──────────┘                    └──────────┘                   └───────────┘
     ▲                                │                              │
     │ (name list)                    │ Line[].ItemRef               │ DepositToAccountRef
     │                                ▼                              ▼
┌──────────┐                    ┌──────────┐                   ┌───────────┐
│  Vendor  │<──VendorRef────────│   Bill   │   Line[].ItemRef ─│   Item    │
└──────────┘                    └──────────┘──────────────────>└───────────┘
                                                                     │
                                                          IncomeAccountRef / ExpenseAccountRef
                                                                     ▼
                                                               ┌───────────┐
                                                               │  Account  │ (chart of accounts)
                                                               └───────────┘
```

- Relationships are expressed by **`*Ref` objects** (`{"value": "<Id>"}`), never by nesting full child objects. — [DOCUMENTED]
- A `Payment` applies to one or more `Invoice`s through `Line[].LinkedTxn` entries with `TxnType: "Invoice"`. — [DOCUMENTED]

### 3.3 State Machines [IMPORTANT]

#### State Machine: Invoice (paid status, derived from Balance)

```
[draft/open: Balance == TotalAmt] --record Payment--> [partially paid: 0 < Balance < TotalAmt]
                                                            |
                                   --record full Payment--> [paid: Balance == 0]
[any] --void--> [voided: TotalAmt == 0, lines preserved]
[any] --delete (?operation=delete)--> [removed]
```

| From State | Action/Trigger        | To State       | Reversible?          | Side Effects                                   |
| ---------- | --------------------- | -------------- | -------------------- | ---------------------------------------------- |
| open       | create Payment + link | partially/paid | yes (delete Payment) | Invoice `Balance` decreases; `LinkedTxn` added |
| open/paid  | void                  | voided         | no (delete only)     | `TotalAmt`→0, lines retained, status Voided    |
| any        | delete                | removed        | no                   | Record gone; SyncToken history lost            |

> **Note:** QBO does **not** expose a single explicit "status" enum on Invoice for paid/unpaid — paid-state is **derived from `Balance` vs `TotalAmt`**. `EmailStatus` is a separate enum (`NotSet|NeedToSend|EmailSent`). — [DOCUMENTED]/[INFERRED]

### 3.4 Business Rules [IMPORTANT]

**Ordering / dependency rules:**

- Must create the referenced `Customer`, `Vendor`, `Item`, and `Account` **before** referencing them in an Invoice/Bill/Payment. You cannot create a Customer or Item inline inside an Invoice payload. — [DOCUMENTED]
- A `Payment` can only link to existing `Invoice` ids belonging to the same `CustomerRef`. — [DOCUMENTED]

**Field-level rules:**

- `Customer.DisplayName` must be unique per realm — duplicate yields error **6240 (Duplicate Name Exists Error)**. — [DOCUMENTED]
- `Item.Name` must be unique per realm. — [DOCUMENTED]
- Inventory `Item` requires `IncomeAccountRef`, `ExpenseAccountRef`, `AssetAccountRef`, `TrackQtyOnHand: true`, and an `InvStartDate`. — [DOCUMENTED]
- Currency on a transaction must match the customer/company currency configuration (multicurrency must be enabled to set `CurrencyRef`). — [DOCUMENTED]

**Cascading effects:**

- Deleting/voiding an Invoice that has a linked Payment is blocked or unlinks depending on operation — handle the dependency explicitly. — [INFERRED]

**Uniqueness constraints:**

- `DisplayName` (Customer), `Name` (Item, Account) unique within the realm. — [DOCUMENTED]

**Computed / read-only fields:**

- `Balance`, `TotalAmt`, `UnappliedAmt`, `MetaData.*`, `Id`, `SyncToken` are server-computed/managed — never send as writable intent (sending them on create is ignored). — [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

| Format      | Pattern                           | Example                     | Notes                                             |
| ----------- | --------------------------------- | --------------------------- | ------------------------------------------------- |
| Date        | `YYYY-MM-DD`                      | `2026-05-29`                | ISO 8601 date for `TxnDate`, `DueDate`            |
| DateTime    | `YYYY-MM-DDThh:mm:ss±hh:mm`       | `2024-08-12T11:17:56-07:00` | `MetaData.LastUpdatedTime`, CDC/query filters     |
| Currency    | decimal number (no symbol)        | `150.00`                    | `CurrencyRef` separate; amounts are plain numbers |
| Phone       | free-form string                  | `(650) 555-1234`            | `{ "FreeFormNumber": "..." }`                     |
| ID format   | numeric string (per realm)        | `"58"`                      | Always a string in JSON; unique within a realm    |
| realmId     | long numeric string               | `4620816365212402417`       | Company id; in the URL path, from OAuth callback  |
| Ref         | `{"value":"<id>","name":"<opt>"}` | `{"value":"58"}`            | Foreign-key reference object                      |
| Enum values | string                            | `EmailSent`                 | See 3.6                                           |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Entity  | Field               | Allowed Values                                                                                                                   | Default  | Notes                     |
| ------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------- |
| Invoice | `EmailStatus`       | `NotSet`, `NeedToSend`, `EmailSent`                                                                                              | `NotSet` | [DOCUMENTED]              |
| Item    | `Type`              | `Inventory`, `Service`, `NonInventory`, `Group`, `Category`, `Bundle`                                                            | —        | Some require account refs |
| Line    | `DetailType`        | `SalesItemLineDetail`, `AccountBasedExpenseLineDetail`, `ItemBasedExpenseLineDetail`, `SubTotalLineDetail`, `DiscountLineDetail` | —        | Drives line shape         |
| Payment | LinkedTxn `TxnType` | `Invoice`, `CreditMemo`, `Deposit`                                                                                               | —        | Apply payment to txns     |

---

## Phase 4: Endpoint Catalog

> **Connector pattern (mirrors how Numa drives non-file APIs):** QuickBooks is a **Direct API via `connect_request`** integration. The workspace agent does not call Intuit directly — it issues `connect_request` calls through the Numa relay/proxy, which attaches the stored OAuth bearer token and forwards to `https://quickbooks.api.intuit.com/v3/company/{realmId}/...`. All endpoints below are addressed relative to that base.

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /v3/company/{realmId}/query

- **Purpose:** Read entities using the SQL-like query language — the primary read path for list/filter. — [DOCUMENTED]
- **Authentication required:** yes
- **Rate limit:** Counts against the 500/min/realm limit; "resource-intensive" reports can be lower (200/min). — [DOCUMENTED]
- **Idempotent:** yes (GET)

**Query parameters:**

| Parameter      | Type   | Required | Default       | Description                              |
| -------------- | ------ | -------- | ------------- | ---------------------------------------- |
| `query`        | string | yes      | —             | URL-encoded SELECT statement             |
| `minorversion` | int    | no       | latest pinned | Selects additive minor-version behaviour |

**Request:**

```http
GET /v3/company/4620816365212402417/query?query=SELECT%20*%20FROM%20Invoice%20WHERE%20Balance%20%3E%20%270%27%20ORDER%20BY%20TxnDate%20DESC%20STARTPOSITION%201%20MAXRESULTS%20100&minorversion=75
Host: quickbooks.api.intuit.com
Authorization: Bearer {access_token}
Accept: application/json
```

**Success response (200):**

```json
{
  "QueryResponse": {
    "startPosition": 1,
    "maxResults": 100,
    "totalCount": 2,
    "Invoice": [
      {
        "Id": "130",
        "SyncToken": "0",
        "CustomerRef": { "value": "58", "name": "Amy's Bird Sanctuary" },
        "TotalAmt": 150.0,
        "Balance": 150.0,
        "TxnDate": "2026-05-20",
        "DueDate": "2026-06-19",
        "MetaData": { "CreateTime": "2026-05-20T09:00:00-07:00", "LastUpdatedTime": "2026-05-20T09:00:00-07:00" }
      }
    ]
  },
  "time": "2026-05-29T10:00:00.123-07:00"
}
```

> **Empty result gotcha:** when zero rows match, `QueryResponse` is an **empty object `{}`** (the entity array key is absent), and `totalCount` may be omitted. Callers must handle the missing-key case. — [DOCUMENTED]/[INFERRED]

**Error responses:**

| Status | Error Code | Meaning                       | Recovery              |
| ------ | ---------- | ----------------------------- | --------------------- |
| 400    | 4000/4001  | Malformed query / parse error | Fix the SELECT syntax |
| 401    | 3200       | Token expired/invalid         | Refresh token, retry  |
| 429    | —          | Throttled                     | Backoff + retry       |

#### Endpoint: POST /v3/company/{realmId}/invoice (create OR update)

- **Purpose:** Create a new invoice (no `Id`) or update an existing one (with `Id` + `SyncToken`). QBO uses **POST for both** — there is no PUT. — [DOCUMENTED]
- **Authentication required:** yes
- **Idempotent:** No for create. Use the **`RequestId` query param** for idempotency on writes. — [DOCUMENTED]

**Query parameters:**

| Parameter      | Type   | Required | Description                                                        |
| -------------- | ------ | -------- | ------------------------------------------------------------------ |
| `operation`    | string | no       | `delete` (delete txn) / `void` (void txn). Omit for create/update. |
| `include`      | string | no       | `include=invoiceLink` etc. to add extra response data              |
| `minorversion` | int    | no       | Minor version                                                      |
| `requestid`    | string | no       | Idempotency key — dedupes retried writes                           |

**Request body (create):**

```json
{
  "CustomerRef": { "value": "58" },
  "Line": [
    {
      "Amount": 150.0,
      "DetailType": "SalesItemLineDetail",
      "Description": "Strategy consulting - 3 hours",
      "SalesItemLineDetail": {
        "ItemRef": { "value": "1", "name": "Consulting Services" },
        "Qty": 3,
        "UnitPrice": 50.0
      }
    }
  ],
  "DueDate": "2026-06-28"
}
```

**Success response (200):**

```json
{
  "Invoice": {
    "Id": "131",
    "SyncToken": "0",
    "DocNumber": "1071",
    "CustomerRef": { "value": "58", "name": "Amy's Bird Sanctuary" },
    "TotalAmt": 150.0,
    "Balance": 150.0,
    "DueDate": "2026-06-28",
    "Line": [
      {
        "Id": "1",
        "Amount": 150.0,
        "DetailType": "SalesItemLineDetail",
        "SalesItemLineDetail": {
          "ItemRef": { "value": "1", "name": "Consulting Services" },
          "Qty": 3,
          "UnitPrice": 50.0
        }
      }
    ],
    "MetaData": { "CreateTime": "2026-05-29T10:05:00-07:00", "LastUpdatedTime": "2026-05-29T10:05:00-07:00" }
  },
  "time": "2026-05-29T10:05:00.987-07:00"
}
```

#### Endpoint: POST /v3/company/{realmId}/customer (sparse update)

**Request body (sparse update — change only the email + active flag):**

```json
{
  "sparse": true,
  "Id": "58",
  "SyncToken": "1",
  "PrimaryEmailAddr": { "Address": "newemail@birds.com" }
}
```

- `sparse: true` updates only the supplied fields; all other fields preserved. Without it, omitted fields are **cleared**. — [DOCUMENTED]
- `SyncToken` must be the current value — stale token → **error 5010 (stale object / SyncToken mismatch)**. — [DOCUMENTED]

#### Endpoint: GET /v3/company/{realmId}/{entity}/{id}

- **Purpose:** Read a single entity by id (e.g. `GET /invoice/130`). Returns `{ "<Entity>": {...}, "time": "..." }`. — [DOCUMENTED]
- **Idempotent:** yes

#### Endpoint: POST /v3/company/{realmId}/batch

- **Purpose:** Bundle up to **30 operations** (mixed create/update/delete/query) in one call. — [DOCUMENTED]
- **Rate limit:** Batch endpoint throttled at **120 requests/min/realm** (as of 2025-10-31; previously 40/min). — [DOCUMENTED]
- **Partial success:** Yes — each `BatchItemResponse` carries its own result or `Fault`. — [DOCUMENTED]

### 4.2 Full Endpoint Index [IMPORTANT]

| Method | Path                                               | Purpose                              | Auth? | Pagination?              | Notes                                  |
| ------ | -------------------------------------------------- | ------------------------------------ | ----- | ------------------------ | -------------------------------------- |
| GET    | `/query?query=SELECT...`                           | Read/list/filter any entity          | yes   | STARTPOSITION/MAXRESULTS | Primary read path                      |
| GET    | `/{entity}/{id}`                                   | Read one by id                       | yes   | n/a                      | e.g. `/invoice/130`                    |
| POST   | `/{entity}`                                        | Create or full/sparse update         | yes   | n/a                      | POST used for both; `?operation=`      |
| POST   | `/{entity}?operation=delete`                       | Delete a transaction                 | yes   | n/a                      | Txn entities only                      |
| POST   | `/invoice?operation=void`                          | Void an invoice                      | yes   | n/a                      | Lines retained, total→0                |
| GET    | `/invoice/{id}/pdf`                                | Download invoice PDF                 | yes   | n/a                      | `Accept: application/pdf`              |
| POST   | `/invoice/{id}/send?sendTo={email}`                | Email the invoice                    | yes   | n/a                      | Sets `EmailStatus`                     |
| POST   | `/batch`                                           | Up to 30 ops; partial success        | yes   | n/a                      | 120/min/realm                          |
| GET    | `/cdc?entities=Invoice,Customer&changedSince={ts}` | Change Data Capture                  | yes   | n/a                      | Bulk poll of changes since a timestamp |
| GET    | `/companyinfo/{realmId}`                           | Company metadata / smoke test        | yes   | n/a                      | Good first call                        |
| GET    | `/preferences`                                     | Company preferences (multicurrency…) | yes   | n/a                      | Read-only-ish                          |
| POST   | `/upload`                                          | Upload Attachable (multipart)        | yes   | n/a                      | File attachments                       |
| GET    | `/reports/{reportName}`                            | Run a report (P&L, A/R aging, etc.)  | yes   | n/a                      | Lower rate limit                       |

### 4.3 Non-REST Endpoints [NICE-TO-HAVE]

Not applicable — REST only. The "query" endpoint uses an Intuit SQL-like dialect (not GraphQL).

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported? | Syntax                                       | Notes                              |
| ------------------------------- | ---------- | -------------------------------------------- | ---------------------------------- |
| Filter by field value           | Yes        | `WHERE DisplayName = 'Amy'`                  | [DOCUMENTED]                       |
| Filter by date range            | Yes        | `WHERE TxnDate >= '2026-01-01'`              | [DOCUMENTED]                       |
| Full-text search                | Partial    | `WHERE Name LIKE '%pump%'`                   | `LIKE` with `%`; no true FTS       |
| Sort by field                   | Yes        | `ORDER BY TxnDate`                           | [DOCUMENTED]                       |
| Sort direction (asc/desc)       | Yes        | `ORDER BY TxnDate DESC`                      | [DOCUMENTED]                       |
| Field selection / sparse fields | Yes        | `SELECT Id, DocNumber FROM Invoice`          | Or `SELECT *`                      |
| Include related records         | No (query) | use `?include=` on reads / follow `*Ref` ids | No JOINs in the query language     |
| Aggregate / count               | Yes        | `SELECT COUNT(*) FROM Invoice`               | Returns `totalCount`               |
| Logical operators (AND/OR)      | AND only   | `WHERE A = 'x' AND B = 'y'`                  | **No OR** in the QBO query dialect |
| Comparison operators            | Yes        | `=`, `<`, `>`, `<=`, `>=`, `IN`, `LIKE`      | [DOCUMENTED]                       |
| Null checks                     | Limited    | not generally supported                      | [INFERRED — verify in sandbox]     |
| Regex / pattern matching        | No         | only `LIKE` with `%`                         | [DOCUMENTED]                       |

### 5.2 Filter Syntax [REQUIRED]

**General pattern** (SQL-like, URL-encoded into the `query` param):

```
GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice WHERE Balance > '0' ORDER BY TxnDate DESC STARTPOSITION 1 MAXRESULTS 100
```

**Operator syntax:**

```
WHERE TxnDate >= '2026-01-01' AND TxnDate <= '2026-05-31'
WHERE CustomerRef = '58'
WHERE DocNumber IN ('1070','1071')
WHERE DisplayName LIKE 'Amy%'
```

**Combining filters:**

- Multiple filters: **AND only** (the dialect does not support `OR`). For OR-style queries, run multiple queries or use CDC. — [DOCUMENTED]
- Nesting / parentheses: not supported. — [DOCUMENTED]

### 5.3 Sort Syntax [IMPORTANT]

```
ORDER BY TxnDate            (ascending)
ORDER BY TxnDate DESC       (descending)
ORDER BY MetaData.LastUpdatedTime DESC
```

### 5.4 Field Selection [NICE-TO-HAVE]

```
SELECT Id, DocNumber, TotalAmt, Balance FROM Invoice
```

### 5.5 Search Capabilities [IMPORTANT]

- **Global search endpoint:** none — query is per-entity (`FROM Invoice`, `FROM Customer`, …). — [DOCUMENTED]
- **Per-resource search:** via `WHERE ... LIKE '%term%'`. — [DOCUMENTED]
- **Searchable fields:** most scalar fields; not all are filterable (each entity page lists "Filterable: true/false"). — [DOCUMENTED]
- **Fuzzy matching:** none (only `LIKE`). — [DOCUMENTED]
- **Minimum query length:** n/a.

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: Unpaid invoices (open A/R), newest first**

```http
GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice WHERE Balance > '0' ORDER BY TxnDate DESC MAXRESULTS 100
```

**Pattern 2: Find a customer by name**

```http
GET /v3/company/{realmId}/query?query=SELECT * FROM Customer WHERE DisplayName LIKE 'Amy%'
```

**Pattern 3: Bills due this month for a vendor**

```http
GET /v3/company/{realmId}/query?query=SELECT * FROM Bill WHERE VendorRef = '56' AND DueDate <= '2026-05-31' AND Balance > '0'
```

**Pattern 4: Recently modified records (incremental sync)**

```http
GET /v3/company/{realmId}/query?query=SELECT * FROM Customer WHERE MetaData.LastUpdatedTime > '2026-05-28T00:00:00-07:00'
```

**Pattern 5: Count invoices**

```http
GET /v3/company/{realmId}/query?query=SELECT COUNT(*) FROM Invoice
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** offset-style via `STARTPOSITION` + `MAXRESULTS` clauses inside the SELECT (1-based offset). — [DOCUMENTED]
- **Default page size:** 100 records when `MAXRESULTS` omitted. — [DOCUMENTED]
- **Maximum page size:** 1000 (`MAXRESULTS 1000`). — [DOCUMENTED]
- **Total count available:** Yes — `SELECT COUNT(*)` returns `totalCount`; list responses also echo `startPosition`/`maxResults`. — [DOCUMENTED]

**Request parameters (in the SELECT, not URL query):**

| Parameter       | Type | Default | Description                 |
| --------------- | ---- | ------- | --------------------------- |
| `STARTPOSITION` | int  | 1       | 1-based offset of first row |
| `MAXRESULTS`    | int  | 100     | Page size (max 1000)        |

**Response structure:**

```json
{
  "QueryResponse": {
    "startPosition": 1,
    "maxResults": 100,
    "Invoice": [
      /* up to 100 */
    ]
  },
  "time": "2026-05-29T10:00:00.000-07:00"
}
```

**How to detect last page:** the returned entity array has **fewer rows than `MAXRESULTS`** (or is absent). There is no `next` cursor. — [DOCUMENTED]/[INFERRED]

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: query=SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1   MAXRESULTS 1000
Page 2: query=SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1001 MAXRESULTS 1000
Page 3: query=SELECT * FROM Invoice ORDER BY Id STARTPOSITION 2001 MAXRESULTS 1000
Last:   returned array length < 1000  -> stop
```

> Always include a stable `ORDER BY` (e.g. `Id`) so offsets are deterministic across pages.

### 6.3 Bulk Operations [IMPORTANT]

| Operation             | Endpoint | Max Batch Size | Notes                                 |
| --------------------- | -------- | -------------- | ------------------------------------- |
| Bulk create           | `/batch` | 30 ops/request | Mixed ops allowed; partial success    |
| Bulk update           | `/batch` | 30 ops/request | Each item carries its own `SyncToken` |
| Bulk delete           | `/batch` | 30 ops/request | `operation: "delete"` per item        |
| Bulk read / batch get | `/batch` | 30 ops/request | Each item can be a Query or a Get     |

**Bulk request format:**

```json
{
  "BatchItemRequest": [
    {
      "bId": "1",
      "operation": "create",
      "Invoice": {
        "CustomerRef": { "value": "58" },
        "Line": [
          /* ... */
        ]
      }
    },
    { "bId": "2", "Query": "SELECT * FROM Customer WHERE Active = true MAXRESULTS 50" }
  ]
}
```

**Partial failure handling:**

- Yes — partial success supported. Each `BatchItemResponse` has either the entity or a `Fault`; iterate and reconcile by `bId`. — [DOCUMENTED]

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

- **Export endpoint:** none dedicated. For bulk extraction use paged queries + CDC for deltas. Reports endpoint (`/reports/...`) returns aggregated data, not row dumps. — [DOCUMENTED]
- **Async export:** No. — [DOCUMENTED]

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported? | Notes                                                                     |
| ------------------------ | ---------- | ------------------------------------------------------------------------- |
| Webhooks                 | **Yes**    | Per-app config in Intuit portal; HMAC-SHA256 signed                       |
| WebSocket                | No         | —                                                                         |
| Server-Sent Events (SSE) | No         | —                                                                         |
| Long polling             | No         | —                                                                         |
| Change feeds / streams   | **Yes**    | Change Data Capture (`/cdc`) — bulk poll of changed entities since a time |

### 7.2 Webhooks [IMPORTANT]

**Setup:**

- **Registration method:** Intuit Developer portal (per app) — set the notification endpoint URL and pick entities/operations. Not a runtime API. — [DOCUMENTED]
- **Webhook URL requirements:** HTTPS only; must respond 200 quickly. — [DOCUMENTED]

**Event Catalog (operations: Create / Update / Delete / Merge / Void per entity):**

| Entity (subset)                                                                                                     | Triggers                     | Payload Summary                           |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------- |
| `Customer`, `Vendor`, `Item`, `Account`                                                                             | Create, Update, (Merge)      | id + operation + realmId (no full object) |
| `Invoice`, `Bill`, `Payment`, `BillPayment`, `Estimate`, `CreditMemo`                                               | Create, Update, Delete, Void | id + operation + realmId                  |
| `JournalEntry`, `Purchase`, `PurchaseOrder`, `SalesReceipt`, `RefundReceipt`, `Deposit`, `Transfer`, `TimeActivity` | Create, Update, Delete       | id + operation + realmId                  |

**Payload format (notification only — fetch the entity afterwards):**

```json
{
  "eventNotifications": [
    {
      "realmId": "4620816365212402417",
      "dataChangeEvent": {
        "entities": [
          { "name": "Invoice", "id": "130", "operation": "Update", "lastUpdated": "2026-05-29T10:05:00-07:00" }
        ]
      }
    }
  ]
}
```

> Webhooks carry **only the id + operation**, never the full entity — on receipt, query the entity by id to get current state. — [DOCUMENTED]

**Verification / security:**

- **Signature header:** `intuit-signature` — [DOCUMENTED]
- **Signature algorithm:** HMAC-SHA256 of the **raw request body** using the app's **verifier token** (from the portal) as the key; compare to the base64 value in `intuit-signature`. — [DOCUMENTED]
- **IP allowlist available:** Not the primary mechanism — rely on HMAC verification. — [INFERRED]

**Reliability:**

- **Retry policy:** Intuit retries failed deliveries with backoff; events may be batched/coalesced. — [DOCUMENTED]
- **Event ordering guarantee:** Not guaranteed — treat events as "something changed, go fetch". — [INFERRED]
- **Duplicate delivery possible:** Yes — handlers must be idempotent. — [INFERRED]

### 7.3 WebSocket / SSE [NICE-TO-HAVE]

Not applicable.

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended polling endpoint:** `/cdc?entities=Invoice,Customer,Bill,Payment,Item&changedSince={ISO8601}` — returns **full objects** for everything changed since the timestamp (one call, multiple entity types). — [DOCUMENTED]
- **Alternative:** per-entity `WHERE MetaData.LastUpdatedTime > '{ts}'` queries. — [DOCUMENTED]
- **Recommended polling interval:** CDC supports `changedSince` up to ~30 days back; poll on a cadence that fits the 500/min budget (e.g. every few minutes). — [DOCUMENTED]/[INFERRED]
- **Change detection field(s):** `MetaData.LastUpdatedTime`, `SyncToken`. — [DOCUMENTED]
- **Rate limit implications:** CDC is one call for many entities — far cheaper than per-entity polling. — [INFERRED]

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope                       | Limit                    | Window     | Notes                                        |
| --------------------------- | ------------------------ | ---------- | -------------------------------------------- |
| Per company (realmId)       | 500 requests             | per minute | Primary throttle                             |
| Concurrent requests / realm | 10 in flight             | —          | 11th concurrent → throttled                  |
| Batch endpoint / realm      | 120 requests             | per minute | Raised from 40 on 2025-10-31                 |
| Reports / heavy endpoints   | ~200 requests            | per minute | Lower than the global 500                    |
| Per app (across realms)     | Higher app-level ceiling | per minute | Effective limit is usually the per-realm one |

[DOCUMENTED] — Intuit help KB + 2026 third-party guides (Coefficient, Satva, Truto).

- **Rate limit headers:** Intuit does **not** reliably return `X-RateLimit-*` headers; detect via the 429 response. `intuit_tid` is present for tracing. — [INFERRED]
- **Rate limit exceeded response (429):**

```json
{
  "Fault": {
    "Error": [
      { "Message": "ThrottleExceeded", "Detail": "You have exceeded the number of allowed requests.", "code": "003001" }
    ],
    "type": "ValidationFault"
  },
  "time": "2026-05-29T10:00:00.000-07:00"
}
```

- **Retry-After header:** Generally **absent** — implement client-side backoff. — [INFERRED]
- **Backoff strategy:** Exponential backoff **with jitter**; respect the 10-concurrent ceiling (cap parallelism). — [DOCUMENTED]/[INFERRED]

### 8.2 Error Handling [REQUIRED]

**Standard error response format (Fault envelope):**

```json
{
  "Fault": {
    "Error": [
      {
        "Message": "Stale Object Error",
        "Detail": "Stale Object Error : You and someone else were working on this at the same time...",
        "code": "5010",
        "element": "SyncToken"
      }
    ],
    "type": "ValidationFault"
  },
  "time": "2026-05-29T10:00:00.000-07:00"
}
```

[DOCUMENTED] — The `Fault` envelope with an `Error[]` array (each having `Message`, `Detail`, `code`, optional `element`) and a `type` is the universal QBO error shape. `Fault.type` ∈ `ValidationFault | AuthenticationFault | AuthorizationFault | SystemFault`.

**Error codes reference (selected, commonly hit):**

| HTTP Status | Error Code | Meaning                                 | Retryable?   | Recovery Action                          |
| ----------- | ---------- | --------------------------------------- | ------------ | ---------------------------------------- |
| 400         | 4000/4001  | Invalid query / parse error             | No           | Fix SELECT syntax                        |
| 400         | 2010       | Required param/field missing            | No           | Add the missing field                    |
| 400         | 6240       | Duplicate Name Exists                   | No           | Use a unique `DisplayName`/`Name`        |
| 400         | 5010       | Stale Object (SyncToken mismatch)       | No (refetch) | GET latest, retry with fresh `SyncToken` |
| 400         | 610        | Object Not Found                        | No           | Verify the id exists in this realm       |
| 401         | 3200       | Token expired / invalid `Authorization` | Yes          | Refresh access token, retry              |
| 403         | —          | AuthorizationFault / insufficient scope | No           | Re-consent with correct scope            |
| 429         | 003001     | ThrottleExceeded                        | Yes          | Backoff + retry                          |
| 500/503     | —          | SystemFault / service issue             | Yes          | Retry with backoff; check status page    |

> **Gotcha:** Many **validation** failures return **HTTP 400** (not 422). Distinguish by `Fault.type` + `code`, not by status alone. — [DOCUMENTED]

**Validation error format:** same `Fault.Error[]` shape, with `element` naming the offending field (e.g. `"element": "SyncToken"`). — [DOCUMENTED]

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** Yes — the **`requestid`** query parameter on write endpoints dedupes retried POSTs (e.g. `POST /invoice?requestid=abc123`). — [DOCUMENTED]
- **Idempotency key header:** No header form — it's a query param.
- **Idempotency key lifetime:** Short window (documented as best-effort for retry dedup); treat as transient. — [INFERRED]
- **Which methods are naturally idempotent:**
  - GET: yes
  - POST (create): no — use `requestid`
  - POST (update with `Id`+`SyncToken`): effectively idempotent given the SyncToken lock

### 8.4 Async Operations [IMPORTANT]

- No async/long-running job pattern for CRUD — all writes are synchronous. `/batch` is synchronous (up to 30 items). — [DOCUMENTED]

### 8.5 File Handling [IMPORTANT]

- **Upload endpoint:** `POST /v3/company/{realmId}/upload` (multipart) to attach files via the `Attachable` entity. — [DOCUMENTED]
- **Upload method:** `multipart/form-data` (file part + JSON metadata part). — [DOCUMENTED]
- **Download:** `GET /invoice/{id}/pdf` (and similar) returns binary PDF with `Accept: application/pdf`. Attachable downloads via a `TempDownloadUri`. — [DOCUMENTED]

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- **Optimistic locking:** `SyncToken` per entity — increments on each update; stale token → error 5010. Always GET-then-update. — [DOCUMENTED]
- **Conflict resolution:** Refetch latest, reapply change, retry. — [DOCUMENTED]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                         | Fits?   | Notes                                                   |
| -------------------------- | --------------------------------------------------- | ------- | ------------------------------------------------------- |
| **Data Connector**         | API has file-like content to browse/search/download | No      | QBO is an accounting data API, not a file browser       |
| **Data Connector (Files)** | API is primarily a file storage/document system     | No      | Only incidental PDF/Attachable; not a file system       |
| **Direct API Only**        | API is action-oriented (no browsable content)       | **Yes** | CRUD over accounting entities via SQL-like query + REST |
| **Hybrid**                 | Both browsable content AND actions                  | No      | —                                                       |

**Selected integration path:** **Direct API via `connect_request`** (Direct API Only).

**Justification:** QuickBooks Online exposes transactional/name-list accounting entities (Invoice, Customer, Item, Bill, Payment) through a SQL-like query endpoint plus REST CRUD — there is no browsable file tree to surface in Files Remote. This mirrors the other accounting connectors in this repo (MYOB, Xero): the workspace agent issues `connect_request` calls through the Numa relay/proxy, which injects the stored OAuth bearer token and forwards to `https://quickbooks.api.intuit.com/v3/company/{realmId}/...`. The connector is **not** a Data Connector (Files). — [DOCUMENTED]/[INFERRED]

### 9.2 Connector Requirements [IMPORTANT]

Not a Data Connector (Files) — the standard `list_files`/`download_file` interface does not apply. The connector exposes accounting operations through `connect_request`, not the file connector interface.

**Auth type for connector:** OAuth 2.0 (registry `authType: 'oauth2'`) — **CONFIRMED MATCH** with registry.
**Connector category:** Accounting (registry `category: 'Accounting'`) — **CONFIRMED MATCH**.
**Caching appropriate:** Light/no caching for transactional reads (financial data must be fresh). Static-ish lists (Item, Account, TaxCode, Customer) could be short-TTL cached. — [INFERRED]
**Caching policy:** If added, short TTL (minutes) for name-lists; never cache balances/transaction reads. — [INFERRED]

> **Realm handling requirement:** The connector/relay must persist the `realmId` captured from the OAuth callback per authorised company and template it into every request path. Multiple companies = multiple authorisations (one realm each). This is the single biggest connector-specific implementation detail.

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Look up customers, vendors, items and read their details (SQL-like query + get-by-id).
2. List/filter invoices and bills (e.g. unpaid, overdue, by customer, by date range) and report A/R / A/P status.
3. Create and (sparse-)update invoices, customers, items, bills; record customer payments against invoices.
4. Pull company info, preferences, and run summary reports (P&L, A/R aging) via `/reports`.
5. Incremental sync via CDC / `LastUpdatedTime` for "what changed recently".

**CANNOT do (out of scope or dangerous):**

1. Hard-delete or void transactions without explicit human confirmation (destructive, affects the books) — gate behind HITL.
2. Bulk financial mutations beyond a small, reviewed batch (rate limits + audit risk).
3. Anything requiring the Payments scope (`com.intuit.quickbooks.payment`) — not granted by this connector's scope.

**Default parameters:**

| Parameter      | Default                 | Reason                                                  |
| -------------- | ----------------------- | ------------------------------------------------------- |
| `minorversion` | latest stable (e.g. 75) | Pin to a known minor version for stable field behaviour |
| `MAXRESULTS`   | 100 (cap 1000)          | Sensible page size; raise to 1000 only for bulk reads   |
| environment    | production base         | Use sandbox base only in dev/testing                    |
| `Accept`       | `application/json`      | Avoid accidental XML responses                          |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK                      | Language | Quality | Maintained?    | Worth Using?                | Notes                                        |
| ------------------------ | -------- | ------- | -------------- | --------------------------- | -------------------------------------------- |
| `intuit-oauth` (JS)      | Node.js  | Good    | Yes (official) | For OAuth/token only        | Numa handles OAuth centrally; reference only |
| `intuitoauth` / pyclient | Python   | Good    | Yes (official) | OAuth only                  | —                                            |
| `python-quickbooks`      | Python   | Good    | Community      | Reference for entity shapes | Useful to confirm field names                |
| `node-quickbooks`        | Node.js  | OK      | Community      | Reference                   | —                                            |
| .NET / PHP / Java SDKs   | various  | Good    | Yes (official) | Reference                   | Confirm CRUD semantics                       |

Numa drives QBO through `connect_request` + the relay, so no SDK is embedded — SDKs are reference material for exact field names. — [INFERRED]

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed (excellent)
- [~] Phase 2 complete: auth fully documented; **first live call NOT executed** (no sandbox creds) — GATE not passed live
- [x] Phase 3 complete: core entities (Customer, Item, Invoice, Bill, Payment) with fields + relationships
- [x] Phase 4 complete: 5+ critical endpoints with request/response (query, create/update, sparse update, get-by-id, batch)
- [x] Phase 5 complete: query/filter patterns documented (SQL-like, AND-only, LIKE)
- [x] Phase 6 complete: pagination model + worked example (STARTPOSITION/MAXRESULTS)
- [x] Phase 7 complete: webhooks + CDC documented
- [x] Phase 8 complete: rate limits + Fault error envelope documented
- [x] Phase 9 complete: integration path selected (Direct API via connect_request)

**Overall investigation confidence:** **medium** — documentation is excellent and comprehensive, but **no authenticated live call was made**, so exact response wrappers, empty-result shapes, and a few field-level nuances are `[DOCUMENTED]`/`[INFERRED]` rather than `[CONFIRMED]`.

**Known gaps that will reduce output quality:**

1. No live `[CONFIRMED]` response bodies — field names/wrappers verified against docs/SDKs only; verify against sandbox before treating as ground truth.
2. Exact current `minorversion` to pin and which fields it gates — confirm the latest stable minor version at build time.
3. Rate-limit header behaviour (presence of `Retry-After`/`X-RateLimit-*`) and exact throttle reset semantics — not authoritatively documented; verify empirically.

### 10.2 Generation Prompts [REQUIRED]

Standard set (01-llm-api-rules, 01a-domain-model, 01b-query-patterns, 01c-mutation-patterns, 01d-event-and-error-handling, 02-api-spec-investigation). **03-connector-setup** applies in the OAuth/Direct-API sense (auth + entity mapping), not the Files connector interface.

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence  | Gaps                                                   |
| ---------------------------- | ------------- | ----------- | ------------------------------------------------------ |
| 01-llm-api-rules             | Yes           | High        | Auth + endpoints well documented                       |
| 01a-domain-model-reference   | Yes           | Medium-High | Field names from docs/SDK, not live calls              |
| 01b-query-patterns           | Yes           | High        | Query dialect well documented (AND-only, LIKE caveats) |
| 01c-mutation-patterns        | Yes           | Medium-High | Sparse update + SyncToken solid; verify edge fields    |
| 01d-event-and-error-handling | Yes           | High        | Fault envelope + webhooks/CDC documented               |
| 02-api-spec-investigation    | Yes           | Medium-High | Comprehensive; pending live confirmation               |
| 03-connector-setup           | Yes           | High        | OAuth + realmId capture clear                          |

---

## Source Catalogue

| URL                                                                                                          | Quality            | Used For                                  |
| ------------------------------------------------------------------------------------------------------------ | ------------------ | ----------------------------------------- |
| https://developer.intuit.com/app/developer/qbo/docs/api/accounting                                           | Official           | Entity reference, endpoints, fields       |
| https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0       | Official           | OAuth flow, realmId, scopes               |
| https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/faq             | Official           | Token lifetimes, refresh rotation         |
| https://developer.intuit.com/app/developer/qbo/docs/develop/explore-the-quickbooks-online-api/minor-versions | Official           | minorversion strategy                     |
| https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks                                         | Official           | Webhooks, HMAC, event catalogue           |
| https://help.developer.intuit.com/s/article/Validity-of-Refresh-Token                                        | Official (help)    | Refresh token 100-day + rotation          |
| https://help.developer.intuit.com/s/article/Handling-OAuth-token-expiration                                  | Official (help)    | Token expiry handling                     |
| https://www.apideck.com/blog/exploring-the-quickbooks-online-accounting-api                                  | Third-party        | Response wrapper example, write semantics |
| https://coefficient.io/quickbooks-api/quickbooks-api-rate-limits                                             | Third-party (2026) | Rate limits (500/min, 10 concurrent)      |
| https://satvasolutions.com/blog/quickbooks-online-api-guide                                                  | Third-party (2026) | Limits, endpoints, batch throttle change  |
| https://truto.one/blog/how-to-integrate-with-the-quickbooks-online-api-2026-guide                            | Third-party (2026) | Integration patterns, pagination          |
| https://github.com/ej2/python-quickbooks                                                                     | Community SDK      | Entity field-name confirmation            |

**Not found / not done:**

- No official public OpenAPI/Swagger spec (Postman collection is the closest machine-readable artefact).
- No `[CONFIRMED]` live call — no authenticated sandbox credentials in this environment.
- Exact presence of `Retry-After` / `X-RateLimit-*` headers not authoritatively documented.

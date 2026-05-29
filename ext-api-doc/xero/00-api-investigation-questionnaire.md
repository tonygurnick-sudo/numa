---
api_name: 'Xero Accounting API'
api_slug: 'xero'
vendor: 'Xero Limited'
website: 'https://developer.xero.com/documentation/api/accounting/overview'
investigation_started: '2026-05-29'
investigator: 'Claude Code'
investigation_status: 'complete' # not-started | in-progress | blocked | complete
documentation_quality: 'excellent' # excellent | good | adequate | poor | nonexistent
api_types: [REST] # REST | GraphQL | SOAP | gRPC | WebSocket | SSE
overall_confidence: 'high' # high | medium | low
blockers:
  [
    'No live OAuth token captured — all request/response examples are from official docs and the Xero OpenAPI spec, not a verified live call (GATE in Phase 2.4 is documented-only, not CONFIRMED).',
  ]
---

# API Investigation Questionnaire: Xero Accounting API

> Connector slug: **`xero`** · authType **`oauth2`** · category **Accounting** (per `connectorRegistry.ts`).
> Integration path (decided in Phase 9): **Direct API via `connect_request`** — Xero is an action/data API, not a file browser.
>
> **Confidence markers used below:**
>
> - `[CONFIRMED]` — Verified against a live API call (almost never — no token was available for this investigation)
> - `[DOCUMENTED]` — Stated in official Xero developer docs or the official Xero OpenAPI spec
> - `[INFERRED]` — Deduced from SDKs, examples, behaviour, or the registry config
> - `[UNKNOWN]` — Could not determine; discovery noted

---

## Phase 1: Information Sources

> **Why:** Establishes the research foundation.

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** https://developer.xero.com/documentation/api/accounting/overview — [DOCUMENTED]
- **API reference / endpoint catalog URL:** https://developer.xero.com/documentation/api/accounting/ (per-resource pages: Invoices, Contacts, Accounts, Payments, BankTransactions) — [DOCUMENTED]
- **Authentication guide URL:** https://developer.xero.com/documentation/guides/oauth2/overview/ and https://developer.xero.com/documentation/guides/oauth2/auth-flow/ — [DOCUMENTED]
- **Requests & responses / headers / pagination:** https://developer.xero.com/documentation/api/accounting/requests-and-responses — [DOCUMENTED]
- **Response codes:** https://developer.xero.com/documentation/api/accounting/responsecodes — [DOCUMENTED]
- **Rate limits:** https://developer.xero.com/documentation/guides/oauth2/limits/ — [DOCUMENTED]
- **Tenants / connections:** https://developer.xero.com/documentation/guides/oauth2/tenants — [DOCUMENTED]
- **Webhooks:** https://developer.xero.com/documentation/guides/webhooks/overview/ — [DOCUMENTED]
- **Changelog / release notes:** https://developer.xero.com/documentation/changelog/ — [DOCUMENTED]
- **Status page:** https://status.xero.com/ — [DOCUMENTED]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** https://github.com/XeroAPI/Xero-OpenAPI — `xero_accounting.yaml` (Accounting), `xero-webhooks.yaml` (Webhooks). This is **public, official, and machine-readable** — a major quality advantage over MYOB (whose spec was 401-gated). — [DOCUMENTED]
- **Postman collection:** Public Xero workspace at https://www.postman.com/xeroapi/workspace/xeroapi — [DOCUMENTED]
- **Official SDK repositories:**
  - Python: https://github.com/XeroAPI/xero-python (generated from the OpenAPI spec) — [DOCUMENTED]
  - Node.js: https://github.com/XeroAPI/xero-node — [DOCUMENTED]
  - Other: PHP (`xero-php-oauth2`), Ruby (`xero-ruby`), .NET, Java — all under https://github.com/XeroAPI — [DOCUMENTED]
- **Official blog:** https://devblog.xero.com/ — [DOCUMENTED]
- **Community forum:** https://central.xero.com/s/ (Developer) and the developer community archive — [DOCUMENTED]

> **Note:** Unlike MYOB AccountRight (incomplete community SDKs, auth-gated swagger), Xero publishes a **complete, version-tagged OpenAPI 3.0 spec on GitHub**. Treat `xero_accounting.yaml` as ground truth for field names and enums.

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                          |
| ------------------------- | ------ | ------------------------------------------------------------------------------ |
| Authentication            | 5      | Full OAuth2 auth-code flow guide, token-types guide, tenants/connections guide |
| Endpoint reference        | 5      | Per-resource pages + public OpenAPI spec                                       |
| Request/response examples | 4      | JSON and XML examples per resource; some examples are XML-first (legacy)       |
| Error documentation       | 5      | Dedicated response-codes page with `ValidationErrors` shape                    |
| Rate limit documentation  | 5      | Dedicated limits page; exact headers + 429 + Retry-After documented            |
| Pagination documentation  | 4      | `page` param + `Pagination` object documented; per-resource paging caveats     |
| Webhook documentation     | 5      | Dedicated webhooks guide + OpenAPI webhooks spec + signature validation        |
| SDKs / code examples      | 5      | First-party SDKs in 6 languages, all generated from the spec                   |
| Changelog / versioning    | 5      | Public changelog; spec is semver-tagged (e.g. v12.x)                           |

**Overall documentation quality:** **excellent** — one of the best-documented accounting APIs. [DOCUMENTED]

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Found OpenAPI/Swagger spec (public on GitHub — `XeroAPI/Xero-OpenAPI`)
- [x] Identified authentication method (OAuth 2.0 auth-code + PKCE optional, `offline_access` for refresh)
- [x] Found at least one working example (documented request/response pairs; no live token call made)
- [x] Identified rate limit information (60/min/tenant, 5000/day/tenant, 5 concurrent, 10000/min app-wide)
- [x] Identified pagination approach (`page` query param, 100/page, `Pagination` object)
- [x] Checked for webhook/event support (YES — Invoice/Contact create+update events, HMAC-signed)
- [x] Checked for official SDKs (Python, Node, PHP, Ruby, .NET, Java — all first-party)

---

## Phase 2: API Fundamentals

> **Why:** Auth + first call are the non-negotiable basics.

### 2.1 API Identity [REQUIRED]

- **API name:** Xero Accounting API — [DOCUMENTED]
- **Vendor / company:** Xero Limited — [DOCUMENTED]
- **Current API version:** Path version `2.0` (`api.xro/2.0`); OpenAPI spec semver ~v12.x — [DOCUMENTED]
- **Base URL(s):**
  - Production (Accounting): `https://api.xero.com/api.xro/2.0` — [DOCUMENTED]
  - Connections (tenant discovery): `https://api.xero.com/connections` — [DOCUMENTED]
  - Identity / token: `https://identity.xero.com/connect/token` — [DOCUMENTED, matches registry `tokenUrl`]
  - Sandbox / testing: **No separate sandbox host.** Xero provides a **Demo Company** per organisation (toggle in the Xero UI) that resets ~28 days; you call the same production base URL against the Demo Company's tenant id. — [DOCUMENTED]
- **API type:** REST (JSON; legacy XML also supported but JSON is the default and recommended) — [DOCUMENTED]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (HTTP/1.1) — [DOCUMENTED]
- **Data format:** JSON (default). XML available on most endpoints for legacy reasons. — [DOCUMENTED]
- **Content-Type header(s):** `application/json` for request bodies — [DOCUMENTED]
- **Character encoding:** UTF-8 — [INFERRED, standard]
- **URL structure pattern:**

```
https://api.xero.com/api.xro/2.0/{Resource}            (list / create)
https://api.xero.com/api.xro/2.0/{Resource}/{ID}       (get one / update / delete)
Example: https://api.xero.com/api.xro/2.0/Invoices/297c2dc5-cc47-4afd-8ec8-74990b8761e9
```

> Resource names are **PascalCase and plural** (`Invoices`, `Contacts`, `Accounts`, `Payments`, `BankTransactions`). — [DOCUMENTED]

- **Versioning strategy:** URL path (`api.xro/2.0`). New behaviour is shipped behind the same path version; the OpenAPI spec carries the semver. — [DOCUMENTED]
- **CORS policy:** Not designed for direct browser calls; Numa calls it server-side via the `connect_request` proxy, so CORS is N/A. — [INFERRED]
- **Required headers (all requests):**

| Header           | Value                   | Purpose                                                                                                                                         | Confidence   |
| ---------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `Authorization`  | `Bearer {access_token}` | OAuth2 bearer token                                                                                                                             | [DOCUMENTED] |
| `Xero-tenant-id` | `{tenantId GUID}`       | **REQUIRED** — identifies which connected Xero org the call targets. A token can be connected to many orgs; without this header the call fails. | [DOCUMENTED] |
| `Accept`         | `application/json`      | Return JSON (default is XML on some endpoints, so always send this)                                                                             | [DOCUMENTED] |
| `Content-Type`   | `application/json`      | For POST/PUT bodies                                                                                                                             | [DOCUMENTED] |

> **Gotcha (the headline one for Xero):** `Xero-tenant-id` is mandatory on **every** data call. It is NOT discoverable from the access token alone — you must first call `GET https://api.xero.com/connections` to enumerate tenant ids. This is the single most important difference from a "normal" OAuth API and mirrors MYOB's `businessId` two-step, but Xero uses a header rather than a path segment. — [DOCUMENTED]

### 2.3 Authentication [REQUIRED]

> **This is the single most important section.**

- **Auth method:** OAuth 2.0 — [DOCUMENTED]
- **Auth location:** `Authorization: Bearer {token}` header — [DOCUMENTED]
- **Auth header format:**

```
Authorization: Bearer eyJ...   (JWT access token)
```

**For OAuth 2.0:**

- **Grant type(s) supported:** `authorization_code` (+ optional PKCE), `refresh_token`, `client_credentials` (M2M, custom-connections only) — [DOCUMENTED]
- **Authorization URL:** `https://login.xero.com/identity/connect/authorize` — [DOCUMENTED, matches registry `authUrl`]
- **Token URL:** `https://identity.xero.com/connect/token` — [DOCUMENTED, matches registry `tokenUrl`]
- **Revocation URL:** `https://identity.xero.com/connect/revocation` — [DOCUMENTED]
- **Required scopes (registry config + their purpose):**

| Scope                          | Purpose                                                                 | Required?                         | Confidence   |
| ------------------------------ | ----------------------------------------------------------------------- | --------------------------------- | ------------ |
| `openid`                       | OpenID Connect — identifies the user                                    | Yes (in registry)                 | [DOCUMENTED] |
| `profile`                      | User name/profile claims                                                | In registry                       | [DOCUMENTED] |
| `email`                        | User email claim                                                        | In registry                       | [DOCUMENTED] |
| `accounting.transactions.read` | **Read** Invoices, Bills, BankTransactions, CreditNotes, Payments, etc. | Yes — core read scope in registry | [DOCUMENTED] |
| `accounting.contacts.read`     | **Read** Contacts and Contact Groups                                    | Yes — in registry                 | [DOCUMENTED] |
| `offline_access`               | Returns a **refresh token** (required for long-lived/background sync)   | Yes — in registry                 | [DOCUMENTED] |

> **Scopes NOT in the registry but available (note for future expansion):** `accounting.transactions` (read+write), `accounting.contacts` (read+write), `accounting.settings` / `accounting.settings.read` (Accounts/chart-of-accounts, tax rates, org), `accounting.reports.read`, `accounting.attachments(.read)`, `accounting.journals.read`, `paymentservices`, `bankfeeds`. — [DOCUMENTED]
>
> **⚠ Registry coverage gap — IMPORTANT:** The current registry scopes are **read-only and missing `accounting.settings.read`**. Consequences for the connector as configured today:
>
> 1. **Accounts / Chart of Accounts (`GET /Accounts`) require `accounting.settings.read`** — with the current scope set, `/Accounts`, `/TaxRates`, and `/Organisation` calls will **403**. If the connector needs to read accounts (it is listed as in-scope in the task brief), add `accounting.settings.read` to the registry scopes.
> 2. The scopes are read-only (`*.read`), so **no create/update** (POST/PUT) of invoices/contacts is possible. That is the right default for a safe read-mostly connector, but it must be a conscious decision.
>
> [DOCUMENTED] — verified against https://developer.xero.com/documentation/guides/oauth2/scopes/

- **Granular-scopes migration (timing note):** Xero is rolling out a **new granular scope model**; apps created **on/after 2 March 2026** must use the new granular scopes from day one, and connections created from 29 April 2026 use granular scopes. The classic scopes above remain valid for existing apps. When registering a _new_ Xero app for a client, confirm whether granular scopes are mandated and adjust the registry `scopes` string accordingly. — [DOCUMENTED]
- **Token lifetime:** Access token **30 minutes**. — [DOCUMENTED]
- **Refresh token behavior:** **Rotating, one-time-use.** Each refresh returns a NEW `refresh_token` and invalidates the old one. The refresh token expires after **60 days of inactivity**. There is a ~30-minute grace window where the previous refresh token can be retried if the response was lost. **You must persist the new refresh token after every refresh** or you get `invalid_grant`. — [DOCUMENTED]
- **PKCE required?** Optional for web apps (recommended); required for the mobile/desktop PKCE flow. — [DOCUMENTED]
- **State parameter required?** Strongly recommended (CSRF). — [DOCUMENTED]
- **Redirect URI restrictions:** Must exactly match a URI registered in the Xero app (`developer.xero.com → My Apps`). HTTPS required (except `http://localhost` for dev). — [DOCUMENTED, matches registry `oauthSetupSteps`]

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

> ⚠ **Honesty note:** No live OAuth token was available during this investigation. The request/response below is the **documented** first-call sequence, not a [CONFIRMED] live capture. The gate is satisfied at the **[DOCUMENTED]** level only.

**Step 1 — discover the tenant id (mandatory before any data call):**

```http
GET /connections HTTP/1.1
Host: api.xero.com
Authorization: Bearer {access_token}
Accept: application/json
```

**Response (documented shape):**

```json
[
  {
    "id": "e1eede29-f875-4a5d-8470-17f6a29a88b1",
    "tenantId": "70784a63-d24b-46a9-a4db-0b70a274b056",
    "tenantType": "ORGANISATION",
    "tenantName": "Demo Company (NZ)",
    "createdDateUtc": "2024-07-01T18:07:09.6121490",
    "updatedDateUtc": "2024-07-01T18:07:09.6121490"
  }
]
```

**Step 2 — first data call (e.g. organisation sanity check):**

```http
GET /api.xro/2.0/Organisation HTTP/1.1
Host: api.xero.com
Authorization: Bearer {access_token}
Xero-tenant-id: 70784a63-d24b-46a9-a4db-0b70a274b056
Accept: application/json
```

**Response (documented shape, abbreviated):**

```json
{
  "Id": "a1b2c3d4-...",
  "Status": "OK",
  "ProviderName": "Numa",
  "DateTimeUTC": "/Date(1717272000000)/",
  "Organisations": [
    {
      "OrganisationID": "70784a63-d24b-46a9-a4db-0b70a274b056",
      "Name": "Demo Company (NZ)",
      "BaseCurrency": "NZD",
      "CountryCode": "NZ",
      "OrganisationType": "COMPANY"
    }
  ]
}
```

- **HTTP status code:** 200 (documented)
- **Response headers of note:** `X-MinLimit-Remaining`, `X-DayLimit-Remaining`, `X-AppMinLimit-Remaining`, `Xero-Correlation-Id`
- **Time to first successful call:** N/A (no live call)
- **Gotchas encountered during setup (documented):**
  1. Forgetting `Xero-tenant-id` → 401/403.
  2. Forgetting `Accept: application/json` → some endpoints return XML.
  3. `Organisation`/`Accounts` need `accounting.settings.read` — not in the current registry scopes (see 2.3 warning).
  4. Dates serialize as Microsoft JSON `/Date(epoch_ms+tz)/` on legacy endpoints; the `*UTC` variants (e.g. `UpdatedDateUTC`) are ISO-ish. Parse defensively.

- [x] **GATE CHECK: First call sequence documented** (at [DOCUMENTED] confidence — not live-verified)

---

## Phase 3: Domain Model & Behavior

> **Why:** This is what makes the LLM prompt useful vs. generic. Field names and enums below are from the official `xero_accounting.yaml` OpenAPI spec.

### 3.1 Core Entities [REQUIRED]

#### Entity: Invoice

- **API resource name / endpoint path:** `/Invoices`, `/Invoices/{InvoiceID}` — [DOCUMENTED]
- **Description:** Sales invoices (`ACCREC`, money owed to the org) and bills (`ACCPAY`, money the org owes). The single most important Xero entity.
- **CRUD support:** Read (Create/Update available only with the write scope `accounting.transactions`, which is **not** in the current registry config). Invoices cannot be hard-deleted via API — they are VOIDED or DELETED via status change. — [DOCUMENTED]

**Fields (key subset):**

| Field                                         | Type     | Required?   | Writable?   | Description                                                          | Example Value         |
| --------------------------------------------- | -------- | ----------- | ----------- | -------------------------------------------------------------------- | --------------------- |
| `InvoiceID`                                   | GUID     | system      | no          | Unique id                                                            | `297c2dc5-...`        |
| `Type`                                        | enum     | yes (write) | on create   | `ACCREC` / `ACCPAY`                                                  | `ACCREC`              |
| `InvoiceNumber`                               | string   | no          | yes         | Human number                                                         | `INV-0042`            |
| `Reference`                                   | string   | no          | yes         | ACCREC reference                                                     | `PO-123`              |
| `Contact`                                     | object   | yes (write) | yes         | `{ "ContactID": "..." }` or `{ "Name": "..." }`                      | —                     |
| `Date`                                        | date     | no          | yes         | Invoice date                                                         | `2024-06-01`          |
| `DueDate`                                     | date     | no          | yes         | Due date                                                             | `2024-06-30`          |
| `LineItems`                                   | array    | yes (write) | yes         | Line items (Description, Quantity, UnitAmount, AccountCode, TaxType) | —                     |
| `LineAmountTypes`                             | enum     | no          | yes         | `Exclusive` / `Inclusive` / `NoTax`                                  | `Exclusive`           |
| `Status`                                      | enum     | no          | via actions | see state machine                                                    | `AUTHORISED`          |
| `SubTotal` / `TaxTotal` / `Total`             | decimal  | computed    | no          | Totals                                                               | `100.00`              |
| `AmountDue` / `AmountPaid` / `AmountCredited` | decimal  | computed    | no          | Payment tracking                                                     | `0.00`                |
| `CurrencyCode`                                | string   | no          | yes         | ISO currency                                                         | `NZD`                 |
| `UpdatedDateUTC`                              | datetime | system      | no          | Last-modified — key for incremental sync                             | `2024-06-02T10:00:00` |
| `HasAttachments`                              | bool     | system      | no          | Attachment flag                                                      | `true`                |

**Relationships:**

| Related Entity | Relationship Type      | How Expressed              | Notes                 |
| -------------- | ---------------------- | -------------------------- | --------------------- |
| Contact        | many-to-one            | nested `Contact.ContactID` | The customer/supplier |
| Payment        | one-to-many            | nested `Payments[]`        | Applied payments      |
| CreditNote     | one-to-many            | nested `CreditNotes[]`     | Allocated credits     |
| Account        | many-to-one (per line) | `LineItems[].AccountCode`  | GL coding             |

#### Entity: Contact

- **API resource name / endpoint path:** `/Contacts`, `/Contacts/{ContactID}` — [DOCUMENTED]
- **Description:** Customers, suppliers, and other parties. A contact can be both a customer and supplier.
- **CRUD support:** Read with `accounting.contacts.read` (registry has this); write needs `accounting.contacts`. — [DOCUMENTED]

**Fields (key subset):**

| Field                       | Type     | Required?   | Writable? | Description                           | Example Value  |
| --------------------------- | -------- | ----------- | --------- | ------------------------------------- | -------------- |
| `ContactID`                 | GUID     | system      | no        | Unique id                             | `bd2270c3-...` |
| `Name`                      | string   | yes (write) | yes       | Display name (unique per org)         | `ABC Ltd`      |
| `ContactNumber`             | string   | no          | yes       | External ref                          | `C-001`        |
| `FirstName` / `LastName`    | string   | no          | yes       | Primary person                        | `Jane` / `Doe` |
| `EmailAddress`              | string   | no          | yes       | Primary email                         | `jane@abc.com` |
| `ContactStatus`             | enum     | no          | yes       | `ACTIVE` / `ARCHIVED` / `GDPRREQUEST` | `ACTIVE`       |
| `Addresses` / `Phones`      | array    | no          | yes       | Address & phone collections           | —              |
| `IsCustomer` / `IsSupplier` | bool     | system      | no        | Derived flags                         | `true`         |
| `UpdatedDateUTC`            | datetime | system      | no        | Last-modified                         | —              |

#### Entity: Account (Chart of Accounts)

- **API resource name / endpoint path:** `/Accounts`, `/Accounts/{AccountID}` — [DOCUMENTED]
- **Description:** General-ledger accounts (the chart of accounts).
- **⚠ Scope:** Requires `accounting.settings.read` — **NOT in the current registry scope list**. Will 403 as configured. — [DOCUMENTED]

**Fields (key subset):**

| Field               | Type   | Writable?       | Description                                                                                      | Example   |
| ------------------- | ------ | --------------- | ------------------------------------------------------------------------------------------------ | --------- |
| `AccountID`         | GUID   | no              | Unique id                                                                                        | —         |
| `Code`              | string | yes             | Account code (used by line items)                                                                | `200`     |
| `Name`              | string | yes             | Account name                                                                                     | `Sales`   |
| `Type`              | enum   | yes             | e.g. `BANK`, `REVENUE`, `EXPENSE`, `CURRENT`, `FIXED`, `EQUITY`, `LIABILITY` (full enum in spec) | `REVENUE` |
| `Status`            | enum   | yes             | `ACTIVE` / `ARCHIVED`                                                                            | `ACTIVE`  |
| `TaxType`           | string | yes             | Default tax code                                                                                 | `OUTPUT2` |
| `BankAccountNumber` | string | yes (BANK only) | Bank number                                                                                      | —         |

#### Entity: Payment

- **API resource name / endpoint path:** `/Payments`, `/Payments/{PaymentID}` — [DOCUMENTED]
- **Description:** Payments applied against invoices, bills, credit notes, or prepayments/overpayments.
- **CRUD support:** Read with `accounting.transactions.read`. Payments are not edited — they are created or **deleted/reversed** (status `DELETED`). — [DOCUMENTED]

**Fields (key subset):**

| Field         | Type    | Writable? | Description                                                                 | Example         |
| ------------- | ------- | --------- | --------------------------------------------------------------------------- | --------------- |
| `PaymentID`   | GUID    | no        | Unique id                                                                   | —               |
| `Date`        | date    | yes       | Payment date                                                                | `2024-06-05`    |
| `Amount`      | decimal | yes       | Payment amount                                                              | `50.00`         |
| `Reference`   | string  | yes       | Reference                                                                   | `Cheque 123`    |
| `Invoice`     | object  | yes       | `{ "InvoiceID": "..." }` the doc paid                                       | —               |
| `Account`     | object  | yes       | Bank/clearing account                                                       | —               |
| `PaymentType` | enum    | no        | e.g. `ACCRECPAYMENT`, `ACCPAYPAYMENT`, `ARCREDITPAYMENT`, `APCREDITPAYMENT` | `ACCRECPAYMENT` |
| `Status`      | enum    | no        | `AUTHORISED` / `DELETED`                                                    | `AUTHORISED`    |

#### Entity: BankTransaction

- **API resource name / endpoint path:** `/BankTransactions`, `/BankTransactions/{BankTransactionID}` — [DOCUMENTED]
- **Description:** Spend-money / receive-money transactions against bank accounts (distinct from Payments and from imported bank statement lines).
- **CRUD support:** Read with `accounting.transactions.read`. — [DOCUMENTED]

**Fields (key subset):**

| Field                                      | Type     | Writable? | Description                                                                                              | Example      |
| ------------------------------------------ | -------- | --------- | -------------------------------------------------------------------------------------------------------- | ------------ |
| `BankTransactionID`                        | GUID     | no        | Unique id                                                                                                | —            |
| `Type`                                     | enum     | yes       | `RECEIVE`, `SPEND`, `RECEIVE-OVERPAYMENT`, `RECEIVE-PREPAYMENT`, `SPEND-OVERPAYMENT`, `SPEND-PREPAYMENT` | `SPEND`      |
| `Status`                                   | enum     | no        | `AUTHORISED`, `DELETED` (also `DRAFT` on some flows)                                                     | `AUTHORISED` |
| `Contact`                                  | object   | yes       | Counterparty                                                                                             | —            |
| `BankAccount`                              | object   | yes       | `{ "AccountID": "..." }` (must be a BANK account)                                                        | —            |
| `LineItems`                                | array    | yes       | Lines                                                                                                    | —            |
| `IsReconciled`                             | bool     | no        | Reconciliation flag                                                                                      | `false`      |
| `Date` / `Total` / `SubTotal` / `TaxTotal` | —        | —         | Standard amounts                                                                                         | —            |
| `UpdatedDateUTC`                           | datetime | no        | Last-modified                                                                                            | —            |

### 3.2 Entity Relationships [IMPORTANT]

```
                ┌──────────────┐
                │  Connection  │  (GET /connections → tenantId)
                └──────┬───────┘
                       │ scopes one tenant (Xero-tenant-id header)
                       ▼
                ┌──────────────┐
                │ Organisation │
                └──────┬───────┘
        ┌──────────────┼───────────────┬───────────────┐
        ▼              ▼                ▼               ▼
  ┌──────────┐   ┌──────────┐    ┌──────────┐    ┌──────────────┐
  │ Contact  │   │ Account  │    │ Invoice  │    │BankTransaction│
  └────┬─────┘   └────┬─────┘    └────┬─────┘    └──────┬────────┘
       │  1:N         │ N:1 (per       │ 1:N            │ N:1
       │ invoices     │  line item)    ▼                ▼
       └─────────────►│           ┌──────────┐     (BankAccount = Account, Type=BANK)
                      └──────────►│ Payment  │
                                  └──────────┘
```

[DOCUMENTED — derived from spec field references]

### 3.3 State Machines [IMPORTANT]

#### State Machine: Invoice

```
[DRAFT] --approve--> [SUBMITTED] --approve--> [AUTHORISED] --(payment applied)--> [PAID]
   │                                              │
   └──void/delete──> [DELETED]                    └──void──> [VOIDED]
```

| From State      | Action/Trigger                     | To State   | Reversible?           | Side Effects                                                    |
| --------------- | ---------------------------------- | ---------- | --------------------- | --------------------------------------------------------------- |
| DRAFT           | submit for approval                | SUBMITTED  | yes                   | none                                                            |
| SUBMITTED       | approve                            | AUTHORISED | no                    | becomes a real receivable/payable; affects ledger               |
| AUTHORISED      | apply payment(s) until AmountDue=0 | PAID       | via deleting payments | reduces AmountDue                                               |
| DRAFT/SUBMITTED | delete                             | DELETED    | no                    | removed from lists                                              |
| AUTHORISED      | void                               | VOIDED     | no                    | reverses ledger impact; cannot void if payments/credits applied |

**Per-state capabilities:**

| State            | Can Update? | Can Delete?    | Available Actions           | Notes                                   |
| ---------------- | ----------- | -------------- | --------------------------- | --------------------------------------- |
| DRAFT            | yes         | yes (→DELETED) | edit, submit, authorise     | fully mutable                           |
| SUBMITTED        | yes         | yes (→DELETED) | edit, approve               |                                         |
| AUTHORISED       | limited     | no (void only) | apply payment, void, attach | line items largely locked               |
| PAID             | no          | no             | view                        | remove payments to revert to AUTHORISED |
| VOIDED / DELETED | no          | no             | view                        | terminal                                |

[DOCUMENTED] https://developer.xero.com/documentation/best-practices/user-experience/invoice-status/

### 3.4 Business Rules [IMPORTANT]

- **Tenant scoping (the big one):** Every data call is scoped to exactly one tenant via `Xero-tenant-id`. A single OAuth token can be connected to many orgs; you must loop tenants explicitly. — [DOCUMENTED]
- **Ordering / dependency rules:** Invoice line items reference an existing `AccountCode` (chart of accounts) and `TaxType`. Payments reference an existing `InvoiceID` + a bank `Account`. — [DOCUMENTED]
- **Field-level rules:** `Contact.Name` must be unique within an org. Invoice `Total = SubTotal + TaxTotal` and is computed server-side from line items. — [DOCUMENTED]
- **Cascading effects:** Voiding an invoice reverses its ledger impact; cannot void if payments/credit notes are applied (remove them first). — [DOCUMENTED]
- **Computed / read-only fields:** `SubTotal`, `TaxTotal`, `Total`, `AmountDue`, `AmountPaid`, `AmountCredited`, `UpdatedDateUTC` are server-computed. — [DOCUMENTED]
- **Idempotency:** Xero supports an `Idempotency-Key` request header on create (POST/PUT) endpoints to safely retry. — [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

| Format                      | Pattern                     | Example                                | Notes                                                    |
| --------------------------- | --------------------------- | -------------------------------------- | -------------------------------------------------------- |
| Date                        | `YYYY-MM-DD`                | `2024-06-01`                           | Accepted in JSON request bodies                          |
| DateTime (response, legacy) | `/Date(epoch_ms+tzoffset)/` | `/Date(1717272000000+0000)/`           | Microsoft JSON format on some fields — parse defensively |
| DateTime (`*UTC` fields)    | ISO-like                    | `2024-06-02T10:00:00`                  | `UpdatedDateUTC` etc. — prefer these for sync            |
| Currency / decimal          | plain decimal               | `100.00`                               | No thousands separators                                  |
| ID format                   | GUID v4                     | `297c2dc5-cc47-4afd-8ec8-74990b8761e9` | All `*ID` fields                                         |
| Enum values                 | UPPERCASE                   | `AUTHORISED`, `ACCREC`                 | Status/Type enums are uppercase                          |
| LineAmountTypes             | PascalCase                  | `Exclusive`                            | Exception — not uppercase                                |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Entity          | Field           | Allowed Values                                                                                                                                                                                                     | Default      | Confidence   |
| --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------ |
| Invoice         | Type            | `ACCPAY`, `ACCREC`                                                                                                                                                                                                 | —            | [DOCUMENTED] |
| Invoice         | Status          | `DRAFT`, `SUBMITTED`, `DELETED`, `AUTHORISED`, `PAID`, `VOIDED`                                                                                                                                                    | `DRAFT`      | [DOCUMENTED] |
| Invoice         | LineAmountTypes | `Exclusive`, `Inclusive`, `NoTax`                                                                                                                                                                                  | `Exclusive`  | [DOCUMENTED] |
| Contact         | ContactStatus   | `ACTIVE`, `ARCHIVED`, `GDPRREQUEST`                                                                                                                                                                                | `ACTIVE`     | [DOCUMENTED] |
| Account         | Status          | `ACTIVE`, `ARCHIVED`, `DELETED`                                                                                                                                                                                    | `ACTIVE`     | [DOCUMENTED] |
| Account         | Type            | `BANK`, `CURRENT`, `CURRLIAB`, `DEPRECIATN`, `DIRECTCOSTS`, `EQUITY`, `EXPENSE`, `FIXED`, `INVENTORY`, `LIABILITY`, `NONCURRENT`, `OTHERINCOME`, `OVERHEADS`, `PREPAYMENT`, `REVENUE`, `SALES`, `TERMLIAB`, `PAYG` | —            | [DOCUMENTED] |
| Payment         | Status          | `AUTHORISED`, `DELETED`                                                                                                                                                                                            | `AUTHORISED` | [DOCUMENTED] |
| BankTransaction | Type            | `RECEIVE`, `SPEND`, `RECEIVE-OVERPAYMENT`, `RECEIVE-PREPAYMENT`, `SPEND-OVERPAYMENT`, `SPEND-PREPAYMENT`                                                                                                           | —            | [DOCUMENTED] |
| BankTransaction | Status          | `AUTHORISED`, `DELETED` (`DRAFT` in some flows)                                                                                                                                                                    | —            | [DOCUMENTED] |

---

## Phase 4: Endpoint Catalog

> **Why:** Core of the API spec doc and the LLM examples.

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /connections

- **Purpose:** Enumerate the tenant ids the access token can access (must run before any data call).
- **Auth required:** yes — **no `Xero-tenant-id` header here** (it's how you _get_ the tenant ids).
- **Host:** `https://api.xero.com` (NOT under `api.xro/2.0`)
- **Idempotent:** yes

**Success response (200):**

```json
[
  {
    "id": "e1eede29-f875-4a5d-8470-17f6a29a88b1",
    "tenantId": "70784a63-d24b-46a9-a4db-0b70a274b056",
    "tenantType": "ORGANISATION",
    "tenantName": "Demo Company (NZ)",
    "createdDateUtc": "2024-07-01T18:07:09.6121490",
    "updatedDateUtc": "2024-07-01T18:07:09.6121490"
  }
]
```

[DOCUMENTED] https://developer.xero.com/documentation/guides/oauth2/tenants

#### Endpoint: GET /api.xro/2.0/Invoices

- **Purpose:** List invoices (filterable, sortable, paged).
- **Auth required:** yes (`accounting.transactions.read` + `Xero-tenant-id`)
- **Rate limit:** global (see Phase 8)
- **Idempotent:** yes

**Query parameters:**

| Parameter        | Type   | Required | Default | Description                                                                |
| ---------------- | ------ | -------- | ------- | -------------------------------------------------------------------------- |
| `where`          | string | no       | —       | Filter expression, e.g. `Status=="AUTHORISED"`                             |
| `order`          | string | no       | —       | Sort, e.g. `Date DESC`                                                     |
| `page`           | int    | no       | 1       | Page number; **returns 100 per page** when `page` is supplied              |
| `pageSize`       | int    | no       | 100     | Override page size (1–1000 on supported resources)                         |
| `Statuses`       | string | no       | —       | Comma-separated status filter, e.g. `AUTHORISED,PAID`                      |
| `IDs`            | string | no       | —       | Comma-separated InvoiceID list                                             |
| `InvoiceNumbers` | string | no       | —       | Comma-separated invoice numbers                                            |
| `ContactIDs`     | string | no       | —       | Filter by contact                                                          |
| `createdByMyApp` | bool   | no       | false   | Only invoices your app created                                             |
| `summaryOnly`    | bool   | no       | false   | Lightweight fast response (omits line items) — recommended for large lists |
| `searchTerm`     | string | no       | —       | Free-text search (newer param)                                             |

**Also via header:** `If-Modified-Since: {RFC1123 datetime}` returns only records modified at/after that timestamp.

**Success response (200, abbreviated):**

```json
{
  "Id": "a1b2c3d4-...",
  "Status": "OK",
  "ProviderName": "Numa",
  "DateTimeUTC": "/Date(1717272000000)/",
  "Invoices": [
    {
      "InvoiceID": "297c2dc5-cc47-4afd-8ec8-74990b8761e9",
      "Type": "ACCREC",
      "InvoiceNumber": "INV-0042",
      "Contact": { "ContactID": "bd2270c3-...", "Name": "ABC Ltd" },
      "Date": "/Date(1717200000000+0000)/",
      "DueDate": "/Date(1719792000000+0000)/",
      "Status": "AUTHORISED",
      "LineAmountTypes": "Exclusive",
      "SubTotal": 100.0,
      "TotalTax": 15.0,
      "Total": 115.0,
      "AmountDue": 115.0,
      "AmountPaid": 0.0,
      "CurrencyCode": "NZD",
      "UpdatedDateUTC": "/Date(1717272000000+0000)/"
    }
  ]
}
```

> When `page` is supplied, the envelope also includes a `Pagination` object (see Phase 6).

**Error responses:**

| Status | Error Code          | Meaning                                           | Recovery                   |
| ------ | ------------------- | ------------------------------------------------- | -------------------------- |
| 400    | ValidationException | Bad `where`/`order` syntax                        | fix query                  |
| 401    | —                   | Expired/invalid token OR missing `Xero-tenant-id` | refresh token / add header |
| 403    | —                   | Token lacks scope for this resource               | add scope, re-consent      |
| 429    | —                   | Rate limit exceeded                               | honour `Retry-After`       |

[DOCUMENTED] https://developer.xero.com/documentation/api/accounting/invoices

#### Endpoint: GET /api.xro/2.0/Invoices/{InvoiceID}

- **Purpose:** Fetch one invoice with full line items + payments.
- **Auth required:** yes. **Idempotent:** yes.
- **Path params:** `InvoiceID` (GUID) — also accepts `InvoiceNumber`.

[DOCUMENTED]

#### Endpoint: GET /api.xro/2.0/Contacts

- **Purpose:** List contacts. **Auth:** `accounting.contacts.read` + tenant header.
- **Query params:** `where`, `order`, `page`, `pageSize`, `IDs`, `includeArchived`, `summaryOnly`, `searchTerm`.

```json
{
  "Status": "OK",
  "Contacts": [
    {
      "ContactID": "bd2270c3-...",
      "Name": "ABC Ltd",
      "EmailAddress": "ap@abc.com",
      "ContactStatus": "ACTIVE",
      "IsCustomer": true,
      "IsSupplier": false,
      "UpdatedDateUTC": "/Date(1717272000000+0000)/"
    }
  ]
}
```

[DOCUMENTED] https://developer.xero.com/documentation/api/accounting/contacts

#### Endpoint: GET /api.xro/2.0/Accounts

- **Purpose:** Chart of accounts. **Auth:** `accounting.settings.read` (**⚠ missing from registry scopes**) + tenant header.
- **Note:** `/Accounts` is **not paged** (returns the full chart) — no `page` param.

[DOCUMENTED] https://developer.xero.com/documentation/api/accounting/accounts

#### Endpoint: GET /api.xro/2.0/Payments

- **Purpose:** List payments. **Auth:** `accounting.transactions.read` + tenant header. Supports `where`, `order`, `page`.

[DOCUMENTED] https://developer.xero.com/documentation/api/accounting/payments

#### Endpoint: GET /api.xro/2.0/BankTransactions

- **Purpose:** List spend/receive money txns. **Auth:** `accounting.transactions.read` + tenant header. Supports `where`, `order`, `page`, `If-Modified-Since`.

[DOCUMENTED] https://developer.xero.com/documentation/api/accounting/banktransactions

### 4.2 Full Endpoint Index [IMPORTANT]

| Method       | Path                               | Purpose                                                    | Auth Scope                       | Pagination?          | Notes                                 |
| ------------ | ---------------------------------- | ---------------------------------------------------------- | -------------------------------- | -------------------- | ------------------------------------- |
| GET          | `/connections`                     | List tenants                                               | any token                        | no                   | host `api.xero.com`, no tenant header |
| GET          | `/api.xro/2.0/Organisation`        | Org details                                                | `accounting.settings.read`       | no                   | ⚠ scope not in registry               |
| GET/POST/PUT | `/api.xro/2.0/Invoices`            | Invoices/bills                                             | `accounting.transactions(.read)` | yes (`page`, 100/pg) | write needs non-read scope            |
| GET          | `/api.xro/2.0/Invoices/{id}`       | One invoice                                                | `accounting.transactions.read`   | no                   | by GUID or number                     |
| POST         | `/api.xro/2.0/Invoices/{id}/Email` | Email invoice                                              | `accounting.transactions`        | no                   | write scope                           |
| GET          | `/api.xro/2.0/Invoices/{id}/pdf`   | Invoice PDF                                                | `accounting.transactions.read`   | no                   | `Accept: application/pdf`             |
| GET/POST/PUT | `/api.xro/2.0/Contacts`            | Contacts                                                   | `accounting.contacts(.read)`     | yes                  | registry has read                     |
| GET          | `/api.xro/2.0/ContactGroups`       | Contact groups                                             | `accounting.contacts.read`       | no                   |                                       |
| GET/POST/PUT | `/api.xro/2.0/Accounts`            | Chart of accounts                                          | `accounting.settings(.read)`     | no                   | ⚠ scope not in registry               |
| GET/POST     | `/api.xro/2.0/Payments`            | Payments                                                   | `accounting.transactions(.read)` | yes                  | delete via status                     |
| GET/POST/PUT | `/api.xro/2.0/BankTransactions`    | Spend/receive money                                        | `accounting.transactions(.read)` | yes                  |                                       |
| GET          | `/api.xro/2.0/BankTransfers`       | Transfers between banks                                    | `accounting.transactions.read`   | yes                  |                                       |
| GET/POST/PUT | `/api.xro/2.0/CreditNotes`         | Credit notes                                               | `accounting.transactions(.read)` | yes                  |                                       |
| GET          | `/api.xro/2.0/Items`               | Inventory items                                            | `accounting.settings.read`       | no                   | ⚠ scope not in registry               |
| GET          | `/api.xro/2.0/TaxRates`            | Tax rates                                                  | `accounting.settings.read`       | no                   | ⚠ scope not in registry               |
| GET          | `/api.xro/2.0/Reports/{report}`    | Reports (P&L, BalanceSheet, AgedReceivables, TrialBalance) | `accounting.reports.read`        | no                   | ⚠ scope not in registry               |
| GET          | `/api.xro/2.0/Journals`            | GL journals (cursor via `offset`)                          | `accounting.journals.read`       | special (offset)     | ⚠ scope not in registry               |

### 4.3 Non-REST Endpoints [NICE-TO-HAVE]

N/A — Xero Accounting API is pure REST/JSON. (Webhooks are covered in Phase 7.)

---

## Phase 5: Query & Filter Capabilities

> **Why:** Users will ask "show me all invoices where X".

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported?    | Syntax                                                        | Notes                                         |
| ------------------------------- | ------------- | ------------------------------------------------------------- | --------------------------------------------- | ------ | --- |
| Filter by field value           | yes           | `where=Status=="AUTHORISED"`                                  | `==` is the optimised operator                |
| Filter by date range            | yes           | `where=Date>=DateTime(2024,01,01)&&Date<DateTime(2024,12,31)` | `DateTime(y,m,d)` literal                     |
| Full-text search                | partial       | `searchTerm=...` (Invoices/Contacts)                          | newer param; also `Name.Contains("...")`      |
| Sort by field                   | yes           | `order=Date DESC`                                             |                                               |
| Sort direction                  | yes           | `ASC` / `DESC`                                                | default ASC                                   |
| Field selection / sparse fields | partial       | `summaryOnly=true`                                            | omits line items; not arbitrary field picking |
| Include related records         | yes (default) | full objects returned                                         | use `summaryOnly` to reduce                   |
| Aggregate / count               | no            | —                                                             | use Reports endpoints instead                 |
| Logical operators (AND/OR)      | yes           | `&&` (AND), `                                                 |                                               | ` (OR) |     |
| Comparison operators            | yes           | `==`, `!=`, `>`, `>=`, `<`, `<=`                              | non-`==` operators are slower on big orgs     |
| Null checks                     | yes           | `Field==null`                                                 |                                               |
| Regex / pattern matching        | partial       | `.Contains()`, `.StartsWith()`, `.EndsWith()`                 | string methods, not full regex                |

### 5.2 Filter Syntax [REQUIRED]

**General pattern (the `where` parameter, URL-encoded):**

```
GET /api.xro/2.0/Invoices?where=Status=="AUTHORISED"
GET /api.xro/2.0/Invoices?where=Type=="ACCREC"&&AmountDue>0
GET /api.xro/2.0/Contacts?where=Name.Contains("Smith")
GET /api.xro/2.0/Contacts?where=ContactID==guid("bd2270c3-...")
```

**Operator syntax:**

```
Equality (optimised):   where=Status=="AUTHORISED"
Date range:             where=Date>=DateTime(2024,01,01)&&Date<DateTime(2024,07,01)
GUID match:             where=Contact.ContactID==guid("....")
String contains:        where=Name.Contains("Ltd")
Boolean:                where=IsCustomer==true
```

**Combining filters:**

- Multiple filters: `&&` (AND), `||` (OR), parentheses for grouping.
- **Performance:** Xero strongly recommends sticking to `==` equality and a small number of "optimised fields" per resource. `.Contains()`, `>`, `<` and nested-field filters are unoptimised and can time out on large orgs — prefer `If-Modified-Since` + `page` for bulk pulls. — [DOCUMENTED]

### 5.3 Sort Syntax [IMPORTANT]

```
order=Date              (ascending)
order=Date DESC         (descending)
order=UpdatedDateUTC DESC
```

[DOCUMENTED]

### 5.4 Field Selection [NICE-TO-HAVE]

No arbitrary field projection. Use `summaryOnly=true` (Invoices, Contacts, etc.) for a fast, lightweight response that omits line items / heavy sub-objects. — [DOCUMENTED]

### 5.5 Search Capabilities [IMPORTANT]

- **Global search endpoint:** none.
- **Per-resource search:** `searchTerm` query param on Invoices and Contacts; plus `where=...Contains()`.
- **Searchable fields:** name/number/reference (resource-dependent).
- **Fuzzy matching:** no — substring via `.Contains()`.
- **Minimum query length:** not documented. — [UNKNOWN]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: All authorised (unpaid+paid) sales invoices, newest first**

```http
GET /api.xro/2.0/Invoices?where=Type=="ACCREC"&&Status=="AUTHORISED"&order=Date DESC&page=1
Xero-tenant-id: {tenantId}
```

**Pattern 2: Everything changed since last sync (incremental)**

```http
GET /api.xro/2.0/Invoices?page=1
Xero-tenant-id: {tenantId}
If-Modified-Since: Mon, 27 May 2026 00:00:00 GMT
```

**Pattern 3: Outstanding receivables (money owed to the org)**

```http
GET /api.xro/2.0/Invoices?where=Type=="ACCREC"&&AmountDue>0&summaryOnly=true&page=1
```

**Pattern 4: Find a contact by name**

```http
GET /api.xro/2.0/Contacts?where=Name.Contains("Acme")
```

**Pattern 5: Payments in a date range**

```http
GET /api.xro/2.0/Payments?where=Date>=DateTime(2024,06,01)&&Date<DateTime(2024,07,01)&order=Date DESC&page=1
```

---

## Phase 6: Pagination & Bulk Operations

> **Why:** Get pagination wrong and you miss data.

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** **page-number** (1-based) on most list endpoints. Journals use an `offset` cursor; `/Accounts`, `/TaxRates`, `/Items`, `/Organisation` are **not paged**. — [DOCUMENTED]
- **Default page size:** 100 records per page when `page` is supplied. — [DOCUMENTED]
- **Maximum page size:** `pageSize` up to **1000** on resources that support it (Invoices, Contacts, BankTransactions, etc.). — [DOCUMENTED]
- **Total count available:** yes — when `page` is supplied the response includes a `Pagination` object with `itemCount` and `pageCount`. — [DOCUMENTED]

**Request parameters:**

| Parameter  | Type | Default | Description                                                                    |
| ---------- | ---- | ------- | ------------------------------------------------------------------------------ |
| `page`     | int  | 1       | 1-based page number; enables paging + caps at 100/page unless `pageSize` given |
| `pageSize` | int  | 100     | Records per page (max 1000 on supported resources)                             |

**Response structure (when `page` supplied):**

```json
{
  "Status": "OK",
  "Invoices": [
    /* up to 100 (or pageSize) items */
  ],
  "Pagination": {
    "page": 1,
    "pageSize": 100,
    "pageCount": 5,
    "itemCount": 437
  }
}
```

**How to detect last page:**

```
Stop when page >= Pagination.pageCount
(equivalently: stop when the returned array length < pageSize, or is empty)
```

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /api.xro/2.0/Invoices?page=1          → Pagination.pageCount = 5
Page 2: GET /api.xro/2.0/Invoices?page=2
Page 3: GET /api.xro/2.0/Invoices?page=3
...
Page 5: GET /api.xro/2.0/Invoices?page=5          → last (page == pageCount)
```

Combine with `If-Modified-Since` for incremental sync: set the header once, then walk `page=1..pageCount`. — [DOCUMENTED]

### 6.3 Bulk Operations [IMPORTANT]

| Operation             | Endpoint                                   | Max Batch Size                                | Notes                                                                         |
| --------------------- | ------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------- |
| Bulk create           | POST `/Invoices` (etc.) with array         | ~60 items / 6MB body (documented soft limits) | Send `{ "Invoices": [ ... ] }` array — requires write scope (not in registry) |
| Bulk update           | POST `/Invoices` with `InvoiceID` per item | as above                                      | upsert by id                                                                  |
| Bulk delete           | n/a                                        | —                                             | delete is via status change (VOIDED/DELETED)                                  |
| Bulk read / batch get | GET `?IDs=guid1,guid2,...`                 | comma-separated list                          | efficient multi-fetch                                                         |

**Partial failure handling:** When `SummarizeErrors=false` is passed, Xero returns per-item results with a `ValidationErrors` array on the items that failed and `StatusAttributeString` per element — partial success is supported. With the default (`SummarizeErrors=true`) the whole batch is rejected on the first error. — [DOCUMENTED]

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

- **Export endpoint:** No dedicated bulk-export. For large historical pulls use the **Journals** endpoint (offset cursor, GL-level) or paged list endpoints + `If-Modified-Since`. — [DOCUMENTED]
- **Async export:** no.

---

## Phase 7: Real-Time & Event-Driven

> **Why:** Webhooks avoid polling. Xero **does** support webhooks (a notable advantage over MYOB, which has none).

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported? | Notes                                                                |
| ------------------------ | ---------- | -------------------------------------------------------------------- |
| Webhooks                 | **yes**    | Invoice + Contact create/update events; HMAC-signed                  |
| WebSocket                | no         | —                                                                    |
| Server-Sent Events (SSE) | no         | —                                                                    |
| Long polling             | no         | —                                                                    |
| Change feeds / streams   | partial    | `If-Modified-Since` + `UpdatedDateUTC` polling; Journals offset feed |

### 7.2 Webhooks [IMPORTANT]

**Setup:**

- **Registration method:** Xero developer portal UI (per app) — set delivery URL + get a webhook signing key. — [DOCUMENTED]
- **Webhook URL requirements:** HTTPS, publicly reachable, must respond within **5 seconds** with `200`. — [DOCUMENTED]
- **Activation:** "Intent to Receive" handshake — Xero posts a payload; you must validate the signature and respond `200` for a valid signature, `401` for invalid. Wrong response blocks activation. — [DOCUMENTED]

**Event Catalog:**

| Event Name           | Trigger         | Payload Summary                                      |
| -------------------- | --------------- | ---------------------------------------------------- |
| `Invoice` / `CREATE` | Invoice created | `resourceId` (InvoiceID), `tenantId`, `eventDateUtc` |
| `Invoice` / `UPDATE` | Invoice updated | as above                                             |
| `Contact` / `CREATE` | Contact created | `resourceId` (ContactID), `tenantId`                 |
| `Contact` / `UPDATE` | Contact updated | as above                                             |

> Webhooks currently cover **Contacts and Invoices only**. Other entities require polling. — [DOCUMENTED]

**Payload format:**

```json
{
  "events": [
    {
      "resourceUrl": "https://api.xero.com/api.xro/2.0/Invoices/297c2dc5-...",
      "resourceId": "297c2dc5-cc47-4afd-8ec8-74990b8761e9",
      "tenantId": "70784a63-d24b-46a9-a4db-0b70a274b056",
      "tenantType": "ORGANISATION",
      "eventCategory": "INVOICE",
      "eventType": "UPDATE",
      "eventDateUtc": "2026-05-29T03:14:00.000"
    }
  ],
  "firstEventSequence": 1,
  "lastEventSequence": 1,
  "entropy": "..."
}
```

> **Payloads are ID-only** — they tell you _what_ changed, not the new data. You must call the API (`resourceUrl`) with the right `Xero-tenant-id` to fetch the record. — [DOCUMENTED]

**Verification / security:**

- **Signature header:** `x-xero-signature` — [DOCUMENTED]
- **Signature algorithm:** HMAC-SHA256 over the **raw request body** using the webhook signing key, base64-encoded, compared to the header. — [DOCUMENTED]
- **Verification process:** Compute HMAC of the unparsed body; constant-time compare. Must use the raw body — JSON re-serialisation breaks it. — [DOCUMENTED]
- **IP allowlist:** Not the primary mechanism; rely on signature validation. — [INFERRED]

**Reliability:**

- **Retry policy:** Xero retries failed deliveries (non-200 or timeout) with backoff over up to ~24h, then disables the webhook. — [DOCUMENTED]
- **Event ordering:** `firstEventSequence`/`lastEventSequence` provided; ordering not strictly guaranteed across retries.
- **Duplicate delivery possible:** yes — design idempotent handlers. — [DOCUMENTED]

### 7.3 WebSocket / SSE [NICE-TO-HAVE]

N/A.

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended polling endpoint:** the relevant list endpoint (Invoices, Contacts, BankTransactions, Payments).
- **Recommended polling interval:** respect 60/min/tenant — for sync, a few-minutes cadence with `If-Modified-Since` is comfortable.
- **"Modified since" filter:** `If-Modified-Since: {RFC1123}` header (preferred) OR `where=UpdatedDateUTC>=DateTime(...)`. — [DOCUMENTED]
- **Change detection field(s):** `UpdatedDateUTC` on all major entities. — [DOCUMENTED]
- **Rate limit implications:** With 60/min/tenant, full incremental syncs of paged resources are fine; spread tenants out to stay under the 10,000/min app-wide ceiling. — [DOCUMENTED]

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope               | Limit        | Window      | Notes                          |
| ------------------- | ------------ | ----------- | ------------------------------ |
| Per tenant (minute) | 60 calls     | rolling 60s | per connected org              |
| Per tenant (day)    | 5,000 calls  | 24h         | per connected org              |
| Concurrent          | 5 in-flight  | —           | per tenant                     |
| App-wide (minute)   | 10,000 calls | rolling 60s | across all tenants for the app |

[DOCUMENTED] https://developer.xero.com/documentation/guides/oauth2/limits/

- **Rate limit headers (on every response):**

| Header                    | Meaning                           | Example Value                   |
| ------------------------- | --------------------------------- | ------------------------------- |
| `X-MinLimit-Remaining`    | calls left this minute (tenant)   | `58`                            |
| `X-DayLimit-Remaining`    | calls left today (tenant)         | `4990`                          |
| `X-AppMinLimit-Remaining` | calls left this minute (app-wide) | `9985`                          |
| `Retry-After`             | seconds to wait (on 429 only)     | `1`                             |
| `X-Rate-Limit-Problem`    | which limit was hit (on 429)      | `minute` / `day` / `concurrent` |
| `Xero-Correlation-Id`     | trace id for support tickets      | `8be4...`                       |

- **Rate limit exceeded response:** HTTP **429 Too Many Requests** with a `Retry-After` header.

```json
{
  "Type": null,
  "Title": "Rate limit exceeded",
  "Status": 429,
  "Detail": "The API rate limit for your application/organisation has been reached. The minute limit is 60. Please try again in 1 seconds."
}
```

- **Retry-After header:** present on 429 — honour it exactly. — [DOCUMENTED]
- **Backoff strategy:** Read `Retry-After`, sleep that many seconds, retry. For 5xx use exponential backoff with jitter. Track `X-MinLimit-Remaining` to throttle proactively. — [DOCUMENTED]

### 8.2 Error Handling [REQUIRED]

**Standard validation error format:**

```json
{
  "ErrorNumber": 10,
  "Type": "ValidationException",
  "Message": "A validation exception occurred",
  "Elements": [
    {
      "InvoiceID": "00000000-0000-0000-0000-000000000000",
      "ValidationErrors": [{ "Message": "Invoice not of valid status for modification" }]
    }
  ]
}
```

**Error codes reference:**

| HTTP Status | Meaning                                                                   | Retryable?          | Recovery Action                                              |
| ----------- | ------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------ |
| 400         | Bad request / malformed `where`/`order`                                   | No                  | Fix query syntax                                             |
| 401         | Unauthorized — expired/invalid token, or missing/invalid `Xero-tenant-id` | Yes (after refresh) | Refresh token; verify tenant header                          |
| 403         | Forbidden — token lacks the required scope                                | No                  | Add scope + re-consent (e.g. add `accounting.settings.read`) |
| 404         | Resource/record not found                                                 | No                  | Verify id + tenant                                           |
| 405         | Method not allowed                                                        | No                  | Wrong verb for resource                                      |
| 412         | Precondition failed                                                       | No                  | Check headers                                                |
| 429         | Rate limit exceeded                                                       | Yes                 | Honour `Retry-After`                                         |
| 500         | Internal server error                                                     | Yes                 | Backoff + retry; quote `Xero-Correlation-Id`                 |
| 503         | Service unavailable / throttling                                          | Yes                 | Backoff + retry                                              |

[DOCUMENTED] https://developer.xero.com/documentation/api/accounting/responsecodes

**Validation error format:** The `Elements[].ValidationErrors[]` array carries field/business-rule messages per item (see above). For batch posts with `SummarizeErrors=false`, failed elements carry their own `ValidationErrors`. — [DOCUMENTED]

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** yes — `Idempotency-Key` request header on create endpoints (POST/PUT). — [DOCUMENTED]
- **Idempotency key header:** `Idempotency-Key: {your-unique-key}`
- **Idempotency key lifetime:** ~24h (documented window). — [DOCUMENTED]
- **Naturally idempotent methods:**
  - GET: yes
  - PUT: yes (Xero PUT creates; use with care)
  - DELETE: n/a (deletes are status changes)
  - POST: no unless `Idempotency-Key` used (Xero POST = create or update)
  - PATCH: limited (some resources, e.g. PATCH Contacts to archive)

> **Quirk:** In Xero, **PUT = create new** and **POST = create or update** (POST upserts by id). This is the opposite of most REST APIs and a common source of accidental duplicates. — [DOCUMENTED]

### 8.4 Async Operations [IMPORTANT]

Not applicable to the Accounting API — all calls are synchronous. (The separate Bulk/Files APIs are out of scope for this connector.) — [DOCUMENTED]

### 8.5 File Handling [IMPORTANT]

- **Attachments:** Invoices/Contacts/etc. support attachments via `GET/POST /{Resource}/{id}/Attachments` and `/{id}/Attachments/{filename}` (requires `accounting.attachments(.read)` scope — not in registry). — [DOCUMENTED]
- **Upload method:** binary body with `Content-Type` of the file; max **25MB** per attachment, ~10 attachments per object. — [DOCUMENTED]
- **Invoice PDF:** `GET /Invoices/{id}/pdf` with `Accept: application/pdf`. — [DOCUMENTED]

> Attachments are out of scope for the read-only connector as currently scoped, but available if needed.

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- **Optimistic locking:** none exposed (no ETag/RowVersion like MYOB). Last-write-wins on POST upsert. — [INFERRED]
- **Eventual consistency:** A record may not appear in a filtered list immediately after creation; `UpdatedDateUTC` ordering is reliable. — [INFERRED]

---

## Phase 9: Platform Integration Assessment

> **Why:** Determines the Numa integration path.

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                         | Fits?   | Notes                                                  |
| -------------------------- | --------------------------------------------------- | ------- | ------------------------------------------------------ |
| **Data Connector**         | API has file-like content to browse/search/download | No      | Xero exposes accounting records, not browsable files   |
| **Data Connector (Files)** | API is primarily a file/document store              | No      | Not a file system                                      |
| **Direct API Only**        | API is action/data-oriented (no browsable content)  | **Yes** | Records-and-queries API; perfect for `connect_request` |
| **Hybrid**                 | Both browsable content AND actions                  | No      | —                                                      |

**Selected integration path:** **Direct API via `connect_request`.**

**Justification:** Xero is a structured accounting **records and actions** API (invoices, contacts, accounts, payments, bank transactions), not a file/document browser. It matches the same path as MYOB AccountRight, simPRO, Jobber, etc. in this codebase. The workspace agent makes authenticated calls through the connector's `connect_request` proxy (OAuth2 token + `Xero-tenant-id` header injected per call). It is **not** a `Data Connector (Files)` integration — there is no `list_files`/`download_file` surface to map. The registry already declares `authType: 'oauth2'` with the correct `authUrl`/`tokenUrl`, confirming the Direct-API/OAuth2 shape.

> **Connector-config callouts (must be addressed before build):**
>
> 1. **`Xero-tenant-id` two-step.** Unlike most Direct-API connectors, the very first call after auth must be `GET https://api.xero.com/connections` to obtain `tenantId`, which is then sent as a header on every subsequent call. The connector layer (or the agent prompt) must handle this explicitly — there is no implicit "current tenant". Multi-org users will have multiple tenant ids; decide whether to pin one or let the agent choose.
> 2. **Scope gap.** Registry scopes are read-only and **lack `accounting.settings.read`** → `/Accounts`, `/Items`, `/TaxRates`, `/Organisation` will 403. Add `accounting.settings.read` if accounts/chart-of-accounts reads are in scope (the task brief lists "accounts"). Add `accounting.reports.read` for reports.
> 3. **Token rotation.** Refresh tokens are one-time-use and rotate on every refresh — the secret-storage layer must persist the new refresh token each time or background sync breaks with `invalid_grant`.

### 9.2 Connector Requirements [IMPORTANT]

Not a Data Connector (Files) integration — the `list_files`/`download_file` table does not apply. For reference, the read surface maps as:

| Capability          | API Endpoint                        | Notes                              |
| ------------------- | ----------------------------------- | ---------------------------------- |
| List tenants        | `GET /connections`                  | Mandatory bootstrap step           |
| List invoices/bills | `GET /api.xro/2.0/Invoices`         | paged, filterable                  |
| Get one invoice     | `GET /api.xro/2.0/Invoices/{id}`    | full detail incl. payments         |
| List contacts       | `GET /api.xro/2.0/Contacts`         | paged                              |
| List payments       | `GET /api.xro/2.0/Payments`         | paged                              |
| List bank txns      | `GET /api.xro/2.0/BankTransactions` | paged                              |
| List accounts       | `GET /api.xro/2.0/Accounts`         | ⚠ needs `accounting.settings.read` |

**Auth type for connector:** OAuth 2.0 (matches registry).
**Connector category:** Accounting (matches registry `category: 'Accounting'`).
**Caching appropriate:** Light caching of the chart of accounts / tenant list (low churn). Do NOT cache invoices/payments (transactional). — [INFERRED]

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope — read-only with current registry scopes):**

1. Discover connected orgs (`GET /connections`) and operate per-tenant.
2. List & filter invoices/bills (by status, type, date range, contact, amount due) and fetch full invoice detail incl. payments.
3. List & search contacts (customers/suppliers), list payments and bank transactions; answer questions like "who owes us money", "recent bills from supplier X", "payments in June".

**CANNOT do (out of scope or blocked by current config):**

1. **Create/modify** invoices, contacts, payments — registry scopes are read-only (`*.read`); writes need `accounting.transactions` / `accounting.contacts`.
2. **Read chart of accounts / tax rates / org / reports** — blocked by missing `accounting.settings.read` / `accounting.reports.read` until scopes are added.
3. **Void/delete** financial records, manage attachments, or send invoice emails — destructive/side-effecting and out of scope for a read connector.

**Default parameters:**

| Parameter     | Default               | Reason                                          |
| ------------- | --------------------- | ----------------------------------------------- |
| `Accept`      | `application/json`    | Avoid XML responses                             |
| `page`        | `1`                   | Always page; walk to `pageCount`                |
| `pageSize`    | `100`                 | Xero default; raise only for bulk sync          |
| `summaryOnly` | `true` for list views | Faster, lighter; fetch detail by id when needed |
| `order`       | `UpdatedDateUTC DESC` | Most-recent-first; good for incremental         |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK            | Language | Quality                    | Maintained? | Worth Using?                                                                                 | Notes                                   |
| -------------- | -------- | -------------------------- | ----------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| `xero-python`  | Python   | High (generated from spec) | Yes         | Maybe — Numa's `connect_request` proxy makes raw HTTP simpler; SDK useful for type reference | https://github.com/XeroAPI/xero-python  |
| `xero-node`    | Node.js  | High                       | Yes         | Reference only                                                                               | https://github.com/XeroAPI/xero-node    |
| `Xero-OpenAPI` | spec     | Authoritative              | Yes         | **Yes — use as field/enum ground truth**                                                     | https://github.com/XeroAPI/Xero-OpenAPI |

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed (excellent; public OpenAPI spec)
- [x] Phase 2 complete: auth documented; first-call sequence documented (⚠ [DOCUMENTED], not live-[CONFIRMED])
- [x] Phase 3 complete: 5 core entities (Invoice, Contact, Account, Payment, BankTransaction) with fields + enums from the spec
- [x] Phase 4 complete: 7 critical endpoints + full index
- [x] Phase 5 complete: `where`/`order`/`searchTerm` syntax + 5 query patterns
- [x] Phase 6 complete: page-number pagination + `Pagination` object + worked example
- [x] Phase 7 complete: webhooks (Invoice/Contact, HMAC) + polling fallback
- [x] Phase 8 complete: rate limits w/ exact headers + error format + idempotency
- [x] Phase 9 complete: integration path = Direct API via `connect_request`

**Overall investigation confidence:** **high** — Xero is exceptionally well-documented with a public OpenAPI spec; nearly everything is [DOCUMENTED]. The only genuine gaps are live-verification items.

**Known gaps that will reduce output quality:**

1. **No live [CONFIRMED] call** — all request/response examples are documented, not captured from a real token. Field names/enums are spec-sourced (high confidence) but exact response envelopes (Microsoft `/Date()/` vs ISO per field) should be confirmed against the Demo Company once a client is connected.
2. **Registry scope gap** — `accounting.settings.read` is absent, so Accounts/Items/TaxRates/Org reads will 403 as configured. This is a config decision, not a doc gap, but it bounds what the connector can do today.
3. **Granular-scopes migration timing** — for a _newly registered_ Xero app (on/after 2 Mar 2026) the exact granular scope strings must be confirmed against the live consent screen.

### 10.2 Generation Prompts [REQUIRED]

**Output Set 1: LLM Knowledge Pack**

1. **01-llm-api-rules.md** — Source: Phase 2 (auth + the `Xero-tenant-id` two-step), Phase 4 (endpoints), Phase 8 (errors/rate limits/headers), Phase 9 (capabilities). Constraint: < 300 lines. Lead with the tenant-id rule and the read-only scope reality.
2. **01a-domain-model-reference.md** — Source: Phase 3 (Invoice/Contact/Account/Payment/BankTransaction fields, enums, invoice state machine, business rules).
3. **01b-query-patterns.md** — Source: Phase 5 (`where`/`order`/`searchTerm`) + Phase 6 (page pagination, `If-Modified-Since`).
4. **01c-mutation-patterns.md** — Source: Phase 3 (rules) + Phase 4 (write endpoints). **Note:** writes are out-of-scope with current registry scopes — generate as "future / requires write scope", flag PUT=create / POST=upsert quirk + `Idempotency-Key`.
5. **01d-event-and-error-handling.md** — Source: Phase 7 (webhooks, HMAC `x-xero-signature`, ID-only payloads) + Phase 8 (429/Retry-After, validation errors).

**Output Set 2: Developer Reference**

6. **02-api-spec-investigation.md** — Source: all phases, condensed.

**Output Set 3: Build Instructions**

7. **03-connector-setup.md** — Source: Phase 9 + Phase 2. **Only if** Data-Connector path were chosen — here the path is Direct API, so this becomes a `connect_request` wiring note rather than a Files-connector setup. Must call out: (a) `/connections` bootstrap, (b) scope gap fix, (c) refresh-token rotation persistence.

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate?            | Confidence | Gaps                                                 |
| ---------------------------- | ------------------------ | ---------- | ---------------------------------------------------- |
| 01-llm-api-rules             | Yes                      | High       | Live response envelope not captured                  |
| 01a-domain-model-reference   | Yes                      | High       | Field set from spec; live-confirm `/Date()/` formats |
| 01b-query-patterns           | Yes                      | High       | `where` performance edges per resource               |
| 01c-mutation-patterns        | Yes (future)             | Medium     | Write scopes not enabled in registry                 |
| 01d-event-and-error-handling | Yes                      | High       | Webhook retry schedule specifics                     |
| 02-api-spec-investigation    | Yes                      | High       | —                                                    |
| 03-connector-setup           | Yes (Direct-API variant) | High       | Scope-gap + token-rotation must be resolved at build |

---

## Appendix: Source Catalogue

| URL                                                                            | Quality                  | Used For                                         |
| ------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------ |
| https://developer.xero.com/documentation/api/accounting/overview               | ⭐⭐⭐⭐ Official        | Overview, base URL                               |
| https://developer.xero.com/documentation/api/accounting/requests-and-responses | ⭐⭐⭐⭐ Official        | Headers, `If-Modified-Since`, pagination         |
| https://developer.xero.com/documentation/api/accounting/responsecodes          | ⭐⭐⭐⭐ Official        | Error codes, `ValidationErrors` shape            |
| https://developer.xero.com/documentation/guides/oauth2/overview/               | ⭐⭐⭐⭐ Official        | OAuth2 flow                                      |
| https://developer.xero.com/documentation/guides/oauth2/auth-flow/              | ⭐⭐⭐⭐ Official        | Auth-code flow, token endpoints                  |
| https://developer.xero.com/documentation/guides/oauth2/scopes/                 | ⭐⭐⭐⭐ Official        | Scopes (+ granular migration)                    |
| https://developer.xero.com/documentation/guides/oauth2/tenants                 | ⭐⭐⭐⭐ Official        | `/connections`, `Xero-tenant-id`                 |
| https://developer.xero.com/documentation/guides/oauth2/token-types             | ⭐⭐⭐⭐ Official        | Token lifetimes, refresh rotation                |
| https://developer.xero.com/documentation/guides/oauth2/limits/                 | ⭐⭐⭐⭐ Official        | Rate limits + headers                            |
| https://developer.xero.com/documentation/guides/webhooks/overview/             | ⭐⭐⭐⭐ Official        | Webhooks, HMAC signature                         |
| https://developer.xero.com/documentation/api/accounting/invoices               | ⭐⭐⭐⭐ Official        | Invoice fields, params, statuses                 |
| https://developer.xero.com/documentation/api/accounting/contacts               | ⭐⭐⭐⭐ Official        | Contact fields, ContactStatus                    |
| https://developer.xero.com/documentation/api/accounting/accounts               | ⭐⭐⭐⭐ Official        | Account fields, Type/Status enums                |
| https://developer.xero.com/documentation/api/accounting/payments               | ⭐⭐⭐⭐ Official        | Payment fields, PaymentType                      |
| https://developer.xero.com/documentation/api/accounting/banktransactions       | ⭐⭐⭐⭐ Official        | BankTransaction Type/Status                      |
| https://github.com/XeroAPI/Xero-OpenAPI (`xero_accounting.yaml`)               | ⭐⭐⭐⭐⭐ Official spec | **Ground truth** for fields + enums              |
| https://github.com/XeroAPI/Xero-OpenAPI (`xero-webhooks.yaml`)                 | ⭐⭐⭐⭐⭐ Official spec | Webhook payload schema                           |
| https://github.com/XeroAPI/xero-python / xero-node                             | ⭐⭐⭐⭐ Official SDK    | Type reference                                   |
| `connectorRegistry.ts` (`id: 'xero'`)                                          | ⭐⭐⭐⭐⭐ Repo source   | authType, authUrl, tokenUrl, scopes, setup steps |

**Not live-verified (no token available):**

- Exact response envelopes (`/Date()/` vs ISO per field) — confirm against Demo Company.
- Behaviour of the missing `accounting.settings.read` scope (expected 403 on `/Accounts`).
- Exact granular-scope strings for apps registered on/after 2 Mar 2026.

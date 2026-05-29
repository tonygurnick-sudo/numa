# API Investigation Questionnaire — MYOB AccountRight (MYOB Business API)

**Date:** 2026-05-19
**API:** MYOB AccountRight / MYOB Business API (v2)
**Status:** Phase 5 complete — awaiting human review

> **Reading order:** start with `01-llm-api-rules.md` (cheat sheet) and dip into this file for citations and depth.

---

## Phase 1 — API Identity & Context

| Question                 | Answer                                                                                            | Confidence                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Official API name        | MYOB Business API (formerly AccountRight Live API)                                                | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/getting-started/    |
| Vendor                   | MYOB Technology Pty Ltd                                                                           | [DOCUMENTED] https://developer.myob.com                                                        |
| Current stable version   | v2                                                                                                | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/v2/                              |
| API style                | REST, JSON                                                                                        | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/    |
| Base URL (cloud)         | `https://api.myob.com/accountright/{businessId}/`                                                 | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719                      |
| Base URL (local desktop) | `http://localhost:8080/accountright/` or `http://{ip}:8080/accountright/`                         | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/getting-started/    |
| Developer portal         | https://developer.myob.com                                                                        | [DOCUMENTED]                                                                                   |
| API support centre       | https://apisupport.myob.com/hc/en-us                                                              | [DOCUMENTED]                                                                                   |
| Postman collection       | https://www.postman.com/myob-accountright                                                         | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/accountright-postman-collection/ |
| OpenAPI / Swagger spec   | `GET https://api.myob.com/accountright/swagger.json` — returns **401** (exists but requires auth) | [CONFIRMED — 401 received]                                                                     |
| MCP server               | CData MYOB AccountRight MCP Server (read-only via JDBC)                                           | [DOCUMENTED] https://github.com/CDataSoftware/myob-accountright-mcp-server-by-cdata            |
| Status page              | https://status.myob.com/                                                                          | [DOCUMENTED] https://ocerra.freshdesk.com/support/solutions/articles/60000713463               |

### Products sharing this API

- **MYOB AccountRight** (UIAccessFlags = 3)
- **MYOB Essentials (new)** (UIAccessFlags = 2)
- **MYOB Business** (current branding for new customers — replaces AccountRight and Essentials)
- Legacy AccountRight Classic (v19 and earlier) — read-only from Feb 2026 onwards

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/v2/

---

## Phase 2 — Authentication

| Question                    | Answer                                                                                                                                           | Confidence                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Auth type                   | OAuth 2.0 Authorization Code flow                                                                                                                | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719                   |
| Authorization URL           | `https://secure.myob.com/oauth2/account/authorize`                                                                                               | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719                   |
| Token endpoint              | `POST https://secure.myob.com/oauth2/v1/authorize`                                                                                               | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719                   |
| Token exchange body         | `client_id`, `client_secret`, `code`, `redirect_uri`, `grant_type=authorization_code` (form-encoded)                                             | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719                   |
| Token refresh body          | `client_id`, `client_secret`, `refresh_token`, `grant_type=refresh_token` (form-encoded)                                                         | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719                   |
| Token response fields       | `access_token`, `refresh_token`, `scope`, `expires_in`                                                                                           | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719                   |
| Access token lifetime       | [UNKNOWN — needs testing; typical OAuth is ~20 min or 1 hr]                                                                                      | [UNKNOWN]                                                                                   |
| Refresh token lifetime      | [UNKNOWN — needs testing]                                                                                                                        | [UNKNOWN]                                                                                   |
| `prompt=consent` required   | YES — required in auth URL to return `businessId` and to allow re-auth for multiple files                                                        | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719                   |
| Company file identification | `businessId` GUID extracted from redirect URI after auth. Previously from `GET /accountright/` — deprecated for keys created after 12 March 2025 | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719                   |
| Admin requirement           | OAuth authorisation requires an **Administrator** user of the company file                                                                       | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719                   |
| App registration            | Via my.myob.com.au Developer tab — provides `client_id` (API key) and `client_secret`                                                            | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/getting-started/ |
| Multi-company file          | Supported — run OAuth flow once per file with `prompt=consent`. Store each `businessId` separately                                               | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719                   |
| Company file token (legacy) | `x-myobapi-cftoken` header with base64 encoded `username:password` for local/desktop files                                                       | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/v2/                           |

### Authorization URL format (Post-March 2025)

```
GET https://secure.myob.com/oauth2/account/authorize
  ?client_id=YOUR_CLIENT_ID
  &redirect_uri=https://yourapp.com/redirect
  &response_type=code
  &scope=sme-company-file sme-customer sme-invoice
  &prompt=consent
```

### Redirect URI response parameters

```
https://yourapp.com/redirect?
  code=...&scope=...&state=...
  &businessId=5d4b1ce0-bb9f-4f4c-9578-2b168b7295db
  &businessName=My+Company+File
```

---

## Phase 3 — Required Headers

| Header                                   | Purpose                                                     | Required?       | Confidence                                                        |
| ---------------------------------------- | ----------------------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `Authorization: Bearer {access_token}`   | OAuth bearer token                                          | YES             | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/v2/ |
| `x-myobapi-key: {api_key}`               | Your registered API key (client_id)                         | YES             | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/v2/ |
| `x-myobapi-version: v2`                  | API version                                                 | YES             | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/v2/ |
| `x-myobapi-cftoken: {base64(user:pass)}` | Company file credentials — for local files or legacy access | For local files | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/v2/ |
| `Content-Type: application/json`         | For POST/PUT requests                                       | For writes      | [INFERRED from API style]                                         |
| `Accept: application/pdf`                | To retrieve invoice/sales PDF                               | Optional        | [DOCUMENTED] https://github.com/uptick/pymyob                     |

### Example header block

```
Authorization: Bearer {ACCESS_TOKEN}
x-myobapi-key: {API_KEY}
x-myobapi-version: v2
Content-Type: application/json
```

---

## Phase 4 — Scopes

All 13 granular OAuth scopes listed below. Multiple scopes space-separated in auth URL.

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/scopes/

| Scope                   | Access Area                                              |
| ----------------------- | -------------------------------------------------------- |
| `sme-general-ledger`    | Chart of accounts, journal transactions, tax codes       |
| `sme-sales`             | Invoices, customer payments, credit notes, orders        |
| `sme-timebilling`       | Time billing activities                                  |
| `sme-inventory`         | Inventory items, item pricing                            |
| `sme-contacts-customer` | Customer contacts                                        |
| `sme-contacts-supplier` | Supplier contacts                                        |
| `sme-contacts-personal` | Personal contacts                                        |
| `sme-contacts-employee` | Employee contacts                                        |
| `sme-banking`           | Bank accounts, spend/receive/transfer money transactions |
| `sme-purchases`         | Bills, supplier payments, debit notes                    |
| `sme-payroll`           | Payroll, timesheets, employees                           |
| `sme-company-settings`  | Company file settings and preferences                    |
| `sme-company-file`      | Company file access (required as base scope)             |

**Note:** The legacy `CompanyFile` scope is deprecated for API keys created after 12 March 2025. Use granular `sme-*` scopes.

[DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719

---

## Phase 5 — Endpoint Catalogue

Base path pattern: `https://api.myob.com/accountright/{businessId}/{ResourcePath}`

> **Corrected 2026-05-19 — IMPORTANT.** A prior version of this section was rebuilt from the **pymyob** community SDK and dropped many real endpoints (Professional/TimeBilling/Miscellaneous invoice variants, BankAccount, Personal contact, full Payroll & TimeBilling surfaces, several GL/Inventory services). pymyob is incomplete. The list below is rebuilt from the **official MYOB .NET SDK** [`myob-oss/AccountRight_Live_API_.Net_SDK`](https://github.com/myob-oss/AccountRight_Live_API_.Net_SDK) — specifically the service classes under `MYOB.API.SDK/SDK/Services/Version2/` (verified 2026-05-19 via `gh api`). `CRUD` = GET-list, GET-by-uid, POST, PUT-by-uid, DELETE-by-uid.

### Contacts (scope `sme-contacts-*`)

| Endpoint                                        | Methods  | Description                     |
| ----------------------------------------------- | -------- | ------------------------------- |
| `/Contact/`                                     | GET      | List of contact-type sub-paths  |
| `/Contact/Customer/`                            | CRUD     | Customer contacts               |
| `/Contact/Supplier/`                            | CRUD     | Supplier contacts               |
| `/Contact/Employee/`                            | CRUD     | Employee cards                  |
| `/Contact/Personal/`                            | CRUD     | Personal contacts               |
| `/Contact/Employee/{uid}/PaymentDetails/`       | GET, PUT | Employee payment details        |
| `/Contact/Employee/{uid}/PaymentSummaryReport/` | GET      | Employee payment summary report |
| `/Contact/Employee/{uid}/PayrollDetails/`       | GET, PUT | Employee payroll details        |
| `/Contact/Employee/{uid}/StandardPay/`          | GET, PUT | Employee standard pay           |

[VERIFIED — official .NET SDK `Services/Version2/Contact/`]

### Sales (scope `sme-sales`)

| Endpoint                                           | Methods                         | Description                             |
| -------------------------------------------------- | ------------------------------- | --------------------------------------- |
| `/Sale/Invoice/`                                   | GET                             | List invoice types                      |
| `/Sale/Invoice/Item/`                              | CRUD                            | Item invoices                           |
| `/Sale/Invoice/Service/`                           | CRUD                            | Service invoices                        |
| `/Sale/Invoice/Professional/`                      | CRUD                            | Professional invoices                   |
| `/Sale/Invoice/TimeBilling/`                       | CRUD                            | Time-billing invoices                   |
| `/Sale/Invoice/Miscellaneous/`                     | CRUD                            | Miscellaneous invoices                  |
| `/Sale/Invoice/{uid}/pdf`                          | GET (`Accept: application/pdf`) | Invoice as PDF                          |
| `/Sale/Invoice/{uid}/email`                        | POST                            | Email invoice (online cloud files only) |
| `/Sale/Order/`                                     | GET                             | List order types                        |
| `/Sale/Order/Item/`                                | CRUD                            | Item orders                             |
| `/Sale/Order/Service/`                             | CRUD                            | Service orders                          |
| `/Sale/Order/Professional/`                        | CRUD                            | Professional orders                     |
| `/Sale/Order/TimeBilling/`                         | CRUD                            | Time-billing orders                     |
| `/Sale/Order/Miscellaneous/`                       | CRUD                            | Miscellaneous orders                    |
| `/Sale/Quote/`                                     | GET                             | List quote types                        |
| `/Sale/Quote/Item/`                                | CRUD                            | Item quotes                             |
| `/Sale/Quote/Service/`                             | CRUD                            | Service quotes                          |
| `/Sale/Quote/Professional/`                        | CRUD                            | Professional quotes                     |
| `/Sale/Quote/TimeBilling/`                         | CRUD                            | Time-billing quotes                     |
| `/Sale/Quote/Miscellaneous/`                       | CRUD                            | Miscellaneous quotes                    |
| `/Sale/CustomerPayment/`                           | GET-list, GET, POST, DELETE     | Customer payments                       |
| `/Sale/CustomerPaymentRecordWithDiscountsAndFees/` | POST                            | Customer payment + discount/fee calc    |
| `/Sale/CreditRefund/`                              | GET-list, GET, POST, DELETE     | Credit refunds                          |
| `/Sale/CreditSettlement/`                          | GET-list, GET, POST, DELETE     | Credit settlements                      |
| `/Sale/CalculateDiscountsFees/`                    | POST                            | Server-side discount + fee calculation  |

[VERIFIED — official .NET SDK `Services/Version2/Sale/` lists `ItemInvoice`, `ServiceInvoice`, `ProfessionalInvoice`, `TimeBillingInvoice`, `MiscellaneousInvoice`, equivalents for Order and Quote, plus `CalculateDiscountsFees`, `CustomerPaymentRecordWithDiscountsAndFees`, `SaleEmail`, `PdfInvoiceServiceBase`]

### Purchases (scope `sme-purchases`)

| Endpoint                                               | Methods                     | Description                          |
| ------------------------------------------------------ | --------------------------- | ------------------------------------ |
| `/Purchase/Bill/`                                      | GET                         | List bill types                      |
| `/Purchase/Bill/Item/`                                 | CRUD                        | Item bills                           |
| `/Purchase/Bill/Service/`                              | CRUD                        | Service bills                        |
| `/Purchase/Bill/Professional/`                         | CRUD                        | Professional bills                   |
| `/Purchase/Bill/Miscellaneous/`                        | CRUD                        | Miscellaneous bills                  |
| `/Purchase/Order/`                                     | GET                         | List PO types                        |
| `/Purchase/Order/Item/`                                | CRUD                        | Item purchase orders                 |
| `/Purchase/Order/Service/`                             | CRUD                        | Service purchase orders              |
| `/Purchase/Order/Professional/`                        | CRUD                        | Professional purchase orders         |
| `/Purchase/Order/Miscellaneous/`                       | CRUD                        | Miscellaneous purchase orders        |
| `/Purchase/SupplierPayment/`                           | CRUD                        | Supplier payments                    |
| `/Purchase/SupplierPaymentRecordWithDiscountsAndFees/` | POST                        | Supplier payment + discount/fee calc |
| `/Purchase/DebitRefund/`                               | GET-list, GET, POST, DELETE | Debit refunds                        |
| `/Purchase/DebitSettlement/`                           | GET-list, GET, POST, DELETE | Debit settlements                    |
| `/Purchase/CalculateDiscounts/`                        | POST                        | Server-side discount calculation     |

[VERIFIED — official .NET SDK `Services/Version2/Purchase/` lists `ItemBill`, `ServiceBill`, `ProfessionalBill`, `MiscellaneousBill`, equivalents for PurchaseOrder, plus `CalculateDiscounts`, `SupplierPaymentRecordWithDiscountsAndFees`]

### General Ledger (scope `sme-general-ledger`)

| Endpoint                                 | Methods       | Description                       |
| ---------------------------------------- | ------------- | --------------------------------- |
| `/GeneralLedger/Account/`                | CRUD          | Chart of accounts                 |
| `/GeneralLedger/AccountBudget/`          | CRUD          | Account budgets                   |
| `/GeneralLedger/AccountRegister/`        | GET-list      | Account register                  |
| `/GeneralLedger/AccountingProperties/`   | GET-list      | Accounting properties             |
| `/GeneralLedger/TaxCode/`                | CRUD          | Tax codes                         |
| `/GeneralLedger/Category/`               | CRUD          | Cost-centre tracking categories   |
| `/GeneralLedger/CategoryRegister/`       | GET-list      | Category register                 |
| `/GeneralLedger/Currency/`               | CRUD          | Currencies (multi-currency files) |
| `/GeneralLedger/Job/`                    | CRUD          | Jobs                              |
| `/GeneralLedger/JobBudget/`              | CRUD          | Job budgets                       |
| `/GeneralLedger/JobRegister/`            | GET-list      | Job register                      |
| `/GeneralLedger/LinkedAccount/`          | CRUD          | Linked accounts                   |
| `/GeneralLedger/GeneralJournal/`         | CRUD          | General journals                  |
| `/GeneralLedger/JournalTransaction/`     | GET-list, GET | Read-only transaction journals    |
| `/GeneralLedger/ProfitLossDistribution/` | CRUD          | Profit/loss distribution          |

[VERIFIED — official .NET SDK `Services/Version2/GeneralLedger/`]

### Banking (scope `sme-banking`)

| Endpoint                     | Methods  | Description                 |
| ---------------------------- | -------- | --------------------------- |
| `/Banking/`                  | GET      | List banking types          |
| `/Banking/BankAccount/`      | CRUD     | Bank accounts               |
| `/Banking/SpendMoneyTxn/`    | CRUD     | Spend-money transactions    |
| `/Banking/ReceiveMoneyTxn/`  | CRUD     | Receive-money transactions  |
| `/Banking/TransferMoneyTxn/` | CRUD     | Transfer-money transactions |
| `/Banking/Statement/`        | GET-list | Bank statements             |

[VERIFIED — official .NET SDK `Services/Version2/Banking/`]

### Inventory (scope `sme-inventory`)

| Endpoint                          | Methods            | Description                          |
| --------------------------------- | ------------------ | ------------------------------------ |
| `/Inventory/Item/`                | CRUD               | Inventory items                      |
| `/Inventory/InventoryAdjustment/` | CRUD               | Inventory adjustments                |
| `/Inventory/InventoryBuild/`      | CRUD               | Inventory builds (assembly)          |
| `/Inventory/ItemPriceMatrix/`     | GET-list, GET, PUT | Item pricing matrix (no POST/DELETE) |
| `/Inventory/PriceLevelDetail/`    | GET-list           | Price level details                  |

[VERIFIED — official .NET SDK `Services/Version2/Inventory/`]

### TimeBilling (scope `sme-timebilling`)

| Endpoint                     | Methods | Description                      |
| ---------------------------- | ------- | -------------------------------- |
| `/TimeBilling/Activity/`     | CRUD    | Activities (billable item types) |
| `/TimeBilling/ActivitySlip/` | CRUD    | Activity slips (time entries)    |

[VERIFIED — official .NET SDK `Services/Version2/TimeBilling/`]

### Payroll (scope `sme-payroll`)

| Endpoint                             | Methods | Description                               |
| ------------------------------------ | ------- | ----------------------------------------- |
| `/Payroll/Timesheet/`                | CRUD    | Employee timesheets                       |
| `/Payroll/EmploymentClassification/` | CRUD    | Employment classifications                |
| `/Payroll/SuperannuationFund/`       | CRUD    | Superannuation funds                      |
| `/Payroll/PaymentSummaryETP/`        | CRUD    | Employment Termination Payment summaries  |
| `/Payroll/PaymentSummaryETPAmended/` | CRUD    | Amended ETP summaries                     |
| `/Payroll/PaymentSummaryINB/`        | CRUD    | Individual Non-Business payment summaries |
| `/Payroll/PaymentSummaryINBAmended/` | CRUD    | Amended INB summaries                     |
| `/Payroll/PaymentSummaryLH/`         | CRUD    | Labour Hire payment summaries             |
| `/Payroll/PaymentSummaryLHAmended/`  | CRUD    | Amended LH summaries                      |

[VERIFIED — official .NET SDK `Services/Version2/Payroll/` lists `TimesheetService`, `PayrollEmploymentClassificationService`, `PayrollSuperannuationFundService`, and 6 `EmployeePaymentSummary*` services. Exact URL paths inferred from service class names; confirm against sandbox or Postman.]

### Company

| Endpoint                | Methods  | Description                                                            |
| ----------------------- | -------- | ---------------------------------------------------------------------- |
| `/Company/Preferences/` | GET-list | Company data-file preferences                                          |
| `/CompanyFile`          | GET      | Company file details                                                   |
| `/DataScopes`           | GET      | Lists enabled scopes and endpoints (no specific scope required)        |
| `/CurrentUser`          | GET      | Currently authenticated user (Post-March 2025 deprecated for new keys) |

[VERIFIED — `/CompanyFile`, `/DataScopes` from Post-March 2025 article; `/Company/Preferences/` from .NET SDK]

**Note:** Full endpoint list with example payloads available in the official Postman collection at https://www.postman.com/myob-accountright. SDK service classes confirmed: pymyob (community, incomplete) and the official `myob-oss/AccountRight_Live_API_.Net_SDK` (comprehensive — use this as ground truth).

---

## Phase 6 — Request / Response Formats

### GET list response shape (generic)

```json
{
  "Count": 50,
  "PageSize": 400,
  "NextPageLink": "https://api.myob.com/accountright/{businessId}/Contact/Customer?$top=400&$skip=400",
  "Items": [ ... ]
}
```

Response: [NEEDS TESTING — no authorised example available; shape inferred from pagination docs]

### POST/PUT request (generic)

- Body: JSON with entity fields
- Returns: HTTP 201 (created) or 200 (updated) + the created/updated entity

Response: [NEEDS TESTING — no authorised example available]

### Error response shape (documented)

```json
{
  "Name": "Required",
  "Message": "[Field] is required",
  "AdditionalDetails": "[Path]",
  "ErrorCode": 100,
  "Severity": "Error"
}
```

Or for access errors:

```json
{
  "Message": "You are not authorised to access this resource",
  "ErrorCode": "AccessDenied"
}
```

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/

### RowVersion (PUT requirement)

PUT requests require the current `RowVersion` value from the entity. The RowVersion is returned on GET. Supplying a stale RowVersion returns:

```json
{
  "Name": "IncorrectRowVersionSupplied",
  "Message": "An Update operation requires the latest RowVersion for each of the existing entities being modified",
  "ErrorCode": 111,
  "Severity": "Error"
}
```

HTTP status: **409 Conflict** (per official error reference)

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/

---

## Phase 7 — Pagination

| Property                    | Value                                                                                            | Confidence                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Default page size           | 400 records                                                                                      | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/ |
| Max page size               | 1000 records (via `$top=1000`)                                                                   | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/ |
| Pagination mechanism        | `$top` + `$skip` OData params; response includes `NextPageLink`                                  | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/ |
| OData version               | v2 (with v3 support for advanced operators like `any`/`all`)                                     | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/ |
| Supported OData params      | `$top`, `$skip`, `$orderby`, `$filter`                                                           | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/ |
| `$filter` operators         | `eq`, `gt`, `ge`, `le`, `and`, `or`, `any`, `all`, `substringof()`, `startswith()`, `endswith()` | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/ |
| DateTime filter format      | `datetime'YYYY-MM-DD'` e.g. `LastModified ge datetime'2024-01-01'`                               | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/ |
| Best practice               | `$skip` should be a multiple of `$top`                                                           | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/ |
| Field name case sensitivity | Field names in OData filters are **case-sensitive**                                              | [DOCUMENTED] https://www.apideck.com/blog/how-to-integrate-with-the-myob-api                |

### Example pagination calls

```
# Page 1 of 1000
GET /Contact/Customer?$top=1000

# Page 2 of 1000
GET /Contact/Customer?$top=1000&$skip=1000

# Filter by last modified since date
GET /Sale/Invoice/Item?$filter=LastModified ge datetime'2024-06-01'

# Get recently paid invoices
GET /Sale/Invoice/Item?$filter=Status eq 'Closed' and LastModified ge datetime'2024-06-01'
```

---

## Phase 8 — Rate Limits

| Property               | Value                                                                                                              | Confidence                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Per-second limit       | 8 requests/second                                                                                                  | [DOCUMENTED] https://www.apideck.com/blog/how-to-integrate-with-the-myob-api               |
| Daily limit            | 1,000,000 requests/day per API key                                                                                 | [DOCUMENTED] https://www.apideck.com/blog/how-to-integrate-with-the-myob-api               |
| Rate limit HTTP status | **403 Forbidden** (NOT 429 — this is a common gotcha)                                                              | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/ |
| Rate limit error name  | `RateLimitError` — "API key has exceeded the per-second rate limit" or "API key has exceeded the daily rate limit" | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/ |
| Request timeout        | 29–30 seconds; returns 504 Gateway Timeout                                                                         | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/sections/360000104856                    |
| Recommended retry      | Exponential backoff when 403 rate limit received                                                                   | [INFERRED — standard practice]                                                             |
| Busy periods           | MYOB servers often slow/timeout around 20th–end of month (end-of-month processing)                                 | [DOCUMENTED] https://ocerra.freshdesk.com/support/solutions/articles/60000713463           |

---

## Phase 9 — Webhooks & Events

| Property            | Value                                                                    | Confidence                                                                                          |
| ------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Webhooks supported? | **NO** — MYOB does not support webhooks                                  | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/6258012443791-Does-MYOB-support-webhooks |
| Alternative         | Polling with `$filter=LastModified ge datetime'...'`                     | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/6258012443791-Does-MYOB-support-webhooks |
| Change detection    | Use `LastModified` field available on most entities for incremental sync | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/6258012443791-Does-MYOB-support-webhooks |
| Status page         | https://status.myob.com/ for real-time service status                    | [DOCUMENTED]                                                                                        |

---

## Phase 10 — SDKs & Community Resources

| Resource            | URL                                                                                        | Language  | Confidence                                                                |
| ------------------- | ------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------- |
| Official .NET SDK   | https://github.com/myob-oss/AccountRight_Live_API_.Net_SDK                                 | C# / .NET | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/arlive-sdk/ |
| NuGet package       | `MYOB.AccountRight.API.SDK` v2025.5.658                                                    | C#        | [DOCUMENTED] https://www.nuget.org/packages/MYOB.AccountRight.API.SDK     |
| Python SDK (pymyob) | https://github.com/uptick/pymyob / PyPI `pymyob` v1.4.0 (Nov 2024)                         | Python    | [DOCUMENTED] https://pypi.org/project/pymyob/                             |
| Node.js wrapper     | https://github.com/aidancasey/myob-accountright-api                                        | Node.js   | [DOCUMENTED]                                                              |
| Ruby wrapper        | https://github.com/davidlumley/myob-api                                                    | Ruby      | [DOCUMENTED]                                                              |
| Postman collection  | https://www.postman.com/myob-accountright                                                  | -         | [DOCUMENTED]                                                              |
| CData MCP Server    | https://github.com/CDataSoftware/myob-accountright-mcp-server-by-cdata                     | Read-only | [DOCUMENTED]                                                              |
| Community forums    | https://community.myob.com/t5/AccountRight-API-questions-and/bd-p/AccountRightAPIquestions | -         | [DOCUMENTED]                                                              |
| n8n community node  | `n8n-nodes-myob` (sales orders only)                                                       | n8n       | [DOCUMENTED]                                                              |

---

## Phase 11 — Gotchas & Known Issues (Ordered by Frequency)

1. **Rate limit returns 403, not 429** — Most developers expect 429. MYOB returns 403 for both auth errors AND rate limits. Check the error `Name` field to distinguish.
   [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/

2. **504 Gateway Timeout (30s)** — Very common. MYOB's servers get heavily loaded around month-end (20th–end of month). Large data fetches time out. Use pagination and OData filters to reduce response times.
   [DOCUMENTED] https://apisupport.myob.com/hc/en-us/sections/360000104856 + https://ocerra.freshdesk.com/support/solutions/articles/60000713463

3. **RowVersion required for PUT** — Every PUT must include the current `RowVersion` from the entity. Fetch the entity first, then PUT with the returned RowVersion. Stale RowVersion = `409 IncorrectRowVersionSupplied`.
   [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/

4. **March 2025 auth changes** — `GET /accountright/` no longer returns company file list for new API keys. Must use `prompt=consent` and extract `businessId` from redirect URI.
   [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719

5. **OData field names are case-sensitive** — `number` vs `Number`, `isActive` vs `IsActive`. Wrong case silently returns all records or errors.
   [DOCUMENTED] https://www.apideck.com/blog/how-to-integrate-with-the-myob-api

6. **Only Admin users can authorise OAuth** — Non-admin users get an Access Denied error during OAuth. This must be communicated to end users.
   [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719

7. **Transactions cannot be deleted (must be reversed)** — If the company file preference `TransactionsCannotBeChangedMustBeReversed = true` is set, DELETE returns error 25003. You must create a reversal transaction instead.
   [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/

8. **Line items require pre-existing references** — Invoice lines must reference existing Item UIDs, TaxCode UIDs, and Account UIDs. You cannot create items inline in an invoice payload. Fetch the chart of accounts, tax codes, and items first.
   [DOCUMENTED] https://www.apideck.com/blog/how-to-integrate-with-the-myob-api

9. **Company file version compatibility** — If the company file software version is too old, endpoints may return 404. Customer must update their MYOB software.
   [DOCUMENTED] https://apisupport.myob.com/hc/en-us/sections/360000104856

10. **No webhooks — polling required** — No real-time event support. Use `LastModified` filter for incremental sync. Polling frequency must respect the 8 req/s rate limit.
    [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/6258012443791

11. **Foreign Currency Quotes not supported** — The API does not support foreign currency quotes.
    [DOCUMENTED] https://apisupport.myob.com/hc/en-us/sections/360000104856

12. **Date/time stamps may differ between request and response** — MYOB may adjust date/time values. Do not assume response timestamps match exactly what was sent.
    [DOCUMENTED] https://apisupport.myob.com/hc/en-us/sections/360000104856

---

## Phase 12 — Business Domain Model

### Key Entities

| Entity              | Description                                                                                                                            | Scope Required          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Company File        | The MYOB data file (database). Identified by `businessId` (GUID).                                                                      | `sme-company-file`      |
| Customer            | A contact who buys from you. Has `UID`, `DisplayID`, `CompanyName`, `Addresses[]`, `EmailAddress`, `IsActive`.                         | `sme-contacts-customer` |
| Supplier            | A contact who sells to you. Similar structure to Customer.                                                                             | `sme-contacts-supplier` |
| Employee            | An employee contact with payroll details.                                                                                              | `sme-contacts-employee` |
| Invoice (Item)      | A sales invoice with line items referencing inventory items. Has `Number`, `Date`, `Status`, `Customer.UID`, `Lines[]`, `TotalAmount`. | `sme-sales`             |
| Invoice (Service)   | A sales invoice with service line items (account-based, no inventory).                                                                 | `sme-sales`             |
| Bill (Item)         | A purchase bill with item lines.                                                                                                       | `sme-purchases`         |
| Account             | A ledger account. Has `Number`, `Name`, `Type` (Asset/Liability/etc.), `DisplayID`.                                                    | `sme-general-ledger`    |
| TaxCode             | A tax code (GST, FRE, etc.) with `Rate`, `UID`, `Code`.                                                                                | `sme-general-ledger`    |
| Inventory Item      | A product/service item for sale. Has `Number`, `Name`, `SellingPrice`, `BuyingPrice`.                                                  | `sme-inventory`         |
| Journal Transaction | A general ledger journal entry.                                                                                                        | `sme-general-ledger`    |
| Customer Payment    | Records payment received from customer against invoices.                                                                               | `sme-sales`             |
| Supplier Payment    | Records payment made to supplier against bills.                                                                                        | `sme-purchases`         |

### Invoice Status Values (Item Invoice)

- `Open` — unpaid
- `Closed` — fully paid
- `CreditNote` — credit note created

[INFERRED from webhook article example: https://apisupport.myob.com/hc/en-us/articles/6258012443791]

### UIAccessFlags (company file type identifier)

- `0` = Local AccountRight
- `2` = Essentials (new)
- `3` = AccountRight / AccountRight Browser

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/getting-started/

---

## Phase 13 — Testing / Sandbox

| Property              | Value                                                                                              | Confidence                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Sandbox environment   | MYOB provides a **Shared Sandbox** company file to approved developers. No self-service demo data. | [DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles related                          |
| Sandbox invitation    | Developer receives invitation to sandbox company file after registration approval                  | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/getting-started/ |
| Self-provisioned test | Can use a trial MYOB Business account with manually created test data                              | [DOCUMENTED] https://www.apideck.com/blog/how-to-integrate-with-the-myob-api                |
| Local testing         | Install AccountRight desktop locally — accessible at localhost:8080                                | [DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/getting-started/ |

---

## Phase 14 — Live Test Results

| Endpoint Tested                                  | Method | Result                                                | Status      |
| ------------------------------------------------ | ------ | ----------------------------------------------------- | ----------- |
| `https://api.myob.com/accountright/swagger.json` | GET    | **401 Unauthorized** — endpoint exists, requires auth | [CONFIRMED] |

All other endpoints require OAuth authentication — no public unauthenticated endpoints found.

---

## Phase 15 — Integration Readiness Checklist

| Item                                       | Status                                                         |
| ------------------------------------------ | -------------------------------------------------------------- |
| Auth flow fully documented                 | ✅ Yes (post-March 2025 guide available)                       |
| Base URL known                             | ✅ Yes                                                         |
| Required headers documented                | ✅ Yes                                                         |
| At least 10 endpoints documented           | ✅ Yes (inferred from error docs + SDK)                        |
| Error format documented with real examples | ✅ Yes (from official error messages page)                     |
| Rate limits known                          | ✅ Yes (8/s, 1M/day, returns 403)                              |
| Pagination mechanism known                 | ✅ Yes (OData $top/$skip, NextPageLink)                        |
| Webhook support assessed                   | ✅ None — polling strategy documented                          |
| SDK available                              | ✅ .NET (official), Python (pymyob), Ruby, Node.js             |
| Sandbox available                          | ⚠️ Requires registration approval                              |
| Swagger spec retrieved                     | ❌ Requires auth (401)                                         |
| Response body examples confirmed           | ⚠️ Partial — structure inferred, not confirmed from live calls |

---

## Phase 16 — Confidence Report

| Confidence Level | Count | Notes                                                     |
| ---------------- | ----- | --------------------------------------------------------- |
| [CONFIRMED]      | 1     | Swagger.json endpoint returns 401                         |
| [DOCUMENTED]     | 42+   | From official MYOB developer docs and support centre      |
| [INFERRED]       | 15+   | From SDK source, error messages doc, community posts      |
| [UNKNOWN]        | 4     | Access/refresh token lifetimes; full response body shapes |

---

## Phase 17 — Top Risks & What to Verify

1. **Token lifetime unknown** — The access_token and refresh_token expiry times are not documented publicly. Needs testing or a support ticket to confirm. Risk: tokens expire unexpectedly mid-session.

2. **Full response body shapes unconfirmed** — Response body structures (especially for individual entities like Invoice, Customer) inferred from SDK and docs but not confirmed from live authenticated calls. Recommend fetching from sandbox before building against specific field names.

3. **RowVersion generation** — How to correctly generate or handle RowVersion for PUTs is partially documented. There is a community article on this but the exact algorithm needs verification.

4. **Rate limit behaviour at 8 req/s** — How strictly this is enforced, whether burst is allowed, and whether the counter resets each second needs testing.

5. **March 2025 `businessId` extraction edge cases** — For customers with multiple company files, the flow requires careful state management. Edge cases (user cancels, selects wrong file) need testing.

---

## Phase 18 — Next Steps

1. **Register for API access** at https://apisupport.myob.com/hc/en-us/requests/new?ticket_form_id=6175906535311
2. **Register an app** at https://my.myob.com.au to get `client_id` and `client_secret`
3. **Request sandbox access** — ask MYOB to invite you to the shared sandbox company file
4. **Test the OAuth flow** with `prompt=consent` and confirm `businessId` is returned in redirect URI
5. **Test token lifetimes** — confirm access_token and refresh_token expiry in seconds
6. **Fetch 2–3 GET endpoints** (Customer, Account, TaxCode) to confirm response body field names
7. **Test a simple POST** (create a Customer contact) to confirm request/response format
8. **Test RowVersion behaviour** — fetch an entity, update it, verify RowVersion handling
9. **Test rate limiting** — confirm 403 + `RateLimitError` is returned at 8+ req/s

---

## Source Catalogue

| URL                                                                            | Quality                | Used For                               |
| ------------------------------------------------------------------------------ | ---------------------- | -------------------------------------- |
| https://developer.myob.com/api/myob-business-api/api-overview/getting-started/ | ⭐⭐⭐ Official        | Overview, base URL, registration       |
| https://apisupport.myob.com/hc/en-us/articles/13065472856719                   | ⭐⭐⭐⭐ Official      | Auth flow (post-March 2025)            |
| https://developer.myob.com/api/myob-business-api/api-overview/error-messages/  | ⭐⭐⭐⭐ Official      | Error codes, entity names              |
| https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/ | ⭐⭐⭐⭐ Official      | Pagination, OData                      |
| https://developer.myob.com/api/myob-business-api/api-overview/scopes/          | ⭐⭐⭐⭐ Official      | OAuth scopes                           |
| https://developer.myob.com/api/myob-business-api/v2/                           | ⭐⭐⭐ Official        | Headers, version                       |
| https://apisupport.myob.com/hc/en-us/articles/6258012443791                    | ⭐⭐⭐ Official        | Webhooks                               |
| https://apisupport.myob.com/hc/en-us/sections/360000104856                     | ⭐⭐⭐ Official        | Tips, tricks, common errors            |
| https://github.com/uptick/pymyob                                               | ⭐⭐⭐⭐ Community SDK | Endpoint patterns, Python usage        |
| https://www.apideck.com/blog/how-to-integrate-with-the-myob-api                | ⭐⭐⭐ Third-party     | Rate limits, entity structure, gotchas |
| https://ocerra.freshdesk.com/support/solutions/articles/60000713463            | ⭐⭐⭐ Third-party     | Real-world timeout gotchas             |
| https://www.nuget.org/packages/MYOB.AccountRight.API.SDK                       | ⭐⭐ Official NuGet    | SDK existence                          |
| https://github.com/CDataSoftware/myob-accountright-mcp-server-by-cdata         | ⭐⭐ Third-party       | MCP server                             |

**Not found:**

- No public OpenAPI/Swagger spec (returns 401)
- No official rate limit documentation page (only confirmed via third-party apideck)
- No official sandbox guide page found (support article referenced but not fetched)
- No official token expiry documentation found

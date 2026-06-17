---
doc: api-spec-investigation (consolidated reference) — MYOB AccountRight (MYOB Business API v2)
api: MYOB Business API · version v2 (version is HEADER x-myobapi-version, NOT a path segment) · HTTPS REST · JSON default / PDF via Accept header
base_url_cloud: https://api.myob.com/accountright/{businessId}/
base_url_local: http://localhost:8080/accountright/{businessId}/
confidence: [CONFIRMED] / [DOCUMENTED] / [INFERRED] / [UNKNOWN] inline; endpoint methods verified against official MYOB .NET SDK 2026-05-19
links: dev-portal=https://developer.myob.com · support=https://apisupport.myob.com/hc/en-us · status=https://status.myob.com/ · postman=https://www.postman.com/myob-accountright · openapi=/swagger.json (requires auth → 401) [CONFIRMED 401 received]
---

# API Spec Investigation — MYOB AccountRight

## Authentication

**Type:** OAuth 2.0 Authorization Code (post-March 2025 flow).
| Step | Method | URL |
| --- | --- | --- |
| Authorize | GET | `https://secure.myob.com/oauth2/account/authorize` |
| Token exchange | POST | `https://secure.myob.com/oauth2/v1/authorize` |
| Token refresh | POST | `https://secure.myob.com/oauth2/v1/authorize` |

**Authorize URL params:** `client_id`=API key · `redirect_uri`=registered URI (exact match) · `response_type=code` · `scope`=space-separated `sme-*` · `prompt=consent` (**REQUIRED** — without it `businessId` is not returned).

**Token request (POST body, form-encoded):**

- `authorization_code`: `client_id`, `client_secret`, `code`, `redirect_uri`, `grant_type=authorization_code`
- `refresh_token`: `client_id`, `client_secret`, `refresh_token`, `grant_type=refresh_token`

**Token response fields:** `access_token` (bearer) · `refresh_token` (**rotates every refresh — store each time**) · `scope` (granted) · `expires_in` (seconds).

**Post-OAuth redirect params:** `code` (auth code) · `businessId` (company file GUID — **primary identifier for all API calls**) · `businessName` (display name).

**Breaking changes (March 2025):** `GET /accountright/` no longer lists company files for new API keys · `CompanyFile` scope deprecated → use `sme-*` · `CurrentUser` deprecated for new keys · `businessId` must come from redirect URI. [DOCUMENTED https://apisupport.myob.com/hc/en-us/articles/13065472856719]

## Required Headers

| Header              | Value                       | Required          |
| ------------------- | --------------------------- | ----------------- |
| `Authorization`     | `Bearer {access_token}`     | always            |
| `x-myobapi-key`     | API key (client_id)         | always            |
| `x-myobapi-version` | `v2`                        | always            |
| `Content-Type`      | `application/json`          | POST/PUT          |
| `x-myobapi-cftoken` | `base64(username:password)` | local files only  |
| `Accept`            | `application/pdf`           | PDF download only |

[DOCUMENTED https://developer.myob.com/api/myob-business-api/v2/]

## OAuth Scopes

`sme-company-file` (base, always) · `sme-general-ledger` (accounts, tax codes, journals) · `sme-sales` (invoices, customer payments, orders, quotes) · `sme-purchases` (bills, supplier payments, purchase orders) · `sme-contacts-customer` · `sme-contacts-supplier` · `sme-contacts-employee` · `sme-contacts-personal` · `sme-banking` · `sme-inventory` · `sme-payroll` (payroll, timesheets) · `sme-timebilling` · `sme-company-settings`. [DOCUMENTED https://developer.myob.com/api/myob-business-api/api-overview/scopes/]

## Rate Limits

| Limit      | Value                         | Error                |
| ---------- | ----------------------------- | -------------------- |
| Per-second | 8 req/s                       | 403 `RateLimitError` |
| Daily      | 1,000,000 req/day per API key | 403 `RateLimitError` |
| Timeout    | 30s                           | 504 `GatewayTimeout` |

> ⚠️ Rate limit errors return **403, NOT 429.** [DOCUMENTED apideck + errors]

## Pagination

OData v2 (v3 ops `any`/`all` supported). Default page size 400, max 1000 (`$top=1000`). Params `$top`/`$skip`/`$orderby`/`$filter`. Next-page indicator `NextPageLink` in response. Best practice: `$skip` = multiple of `$top`. [DOCUMENTED retrieving-data]

## Confirmed Endpoints

All paths relative to `https://api.myob.com/accountright/{businessId}/`. Methods verified against official MYOB .NET SDK ([`myob-oss/AccountRight_Live_API_.Net_SDK`](https://github.com/myob-oss/AccountRight_Live_API_.Net_SDK), service classes under `MYOB.API.SDK/SDK/Services/Version2/`, verified 2026-05-19). `CRUD` = GET-list + GET-by-uid + POST + PUT + DELETE.

> **Corrected 2026-05-19:** prior catalogue was built from the incomplete community **pymyob** SDK (dropped many real endpoints); this version uses the official .NET SDK as authoritative source.

### Contacts (`sme-contacts-*`)

| Path                                                                                      | Methods                  |
| ----------------------------------------------------------------------------------------- | ------------------------ |
| `/Contact/`                                                                               | GET (list contact types) |
| `/Contact/Customer/` · `/Contact/Supplier/` · `/Contact/Employee/` · `/Contact/Personal/` | CRUD                     |
| `/Contact/Employee/{uid}/PaymentDetails/`                                                 | GET, PUT                 |
| `/Contact/Employee/{uid}/PaymentSummaryReport/`                                           | GET                      |
| `/Contact/Employee/{uid}/PayrollDetails/`                                                 | GET, PUT                 |
| `/Contact/Employee/{uid}/StandardPay/`                                                    | GET, PUT                 |

### Sales (`sme-sales`)

| Path                                                                                         | Methods                         |
| -------------------------------------------------------------------------------------------- | ------------------------------- |
| `/Sale/Invoice/`                                                                             | GET (list invoice types)        |
| `/Sale/Invoice/Item/` · `/Service/` · `/Professional/` · `/TimeBilling/` · `/Miscellaneous/` | CRUD                            |
| `/Sale/Invoice/{uid}/pdf`                                                                    | GET (`Accept: application/pdf`) |
| `/Sale/Invoice/{uid}/email`                                                                  | POST — online cloud files only  |
| `/Sale/Order/`                                                                               | GET (list order types)          |
| `/Sale/Order/Item/` · `/Service/` · `/Professional/` · `/TimeBilling/` · `/Miscellaneous/`   | CRUD                            |
| `/Sale/Quote/`                                                                               | GET (list quote types)          |
| `/Sale/Quote/Item/` · `/Service/` · `/Professional/` · `/TimeBilling/` · `/Miscellaneous/`   | CRUD                            |
| `/Sale/CustomerPayment/`                                                                     | GET-list, GET, POST, DELETE     |
| `/Sale/CustomerPaymentRecordWithDiscountsAndFees/`                                           | POST                            |
| `/Sale/CreditRefund/` · `/Sale/CreditSettlement/`                                            | GET-list, GET, POST, DELETE     |
| `/Sale/CalculateDiscountsFees/`                                                              | POST                            |

### Purchases (`sme-purchases`)

| Path                                                                         | Methods                     |
| ---------------------------------------------------------------------------- | --------------------------- |
| `/Purchase/Bill/`                                                            | GET (list bill types)       |
| `/Purchase/Bill/Item/` · `/Service/` · `/Professional/` · `/Miscellaneous/`  | CRUD                        |
| `/Purchase/Order/`                                                           | GET (list order types)      |
| `/Purchase/Order/Item/` · `/Service/` · `/Professional/` · `/Miscellaneous/` | CRUD                        |
| `/Purchase/SupplierPayment/`                                                 | CRUD                        |
| `/Purchase/SupplierPaymentRecordWithDiscountsAndFees/`                       | POST                        |
| `/Purchase/DebitRefund/` · `/Purchase/DebitSettlement/`                      | GET-list, GET, POST, DELETE |
| `/Purchase/CalculateDiscounts/`                                              | POST                        |

### General Ledger (`sme-general-ledger`)

| Path                                                                                                                                                                                      | Methods                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `/GeneralLedger/Account/` · `/AccountBudget/` · `/TaxCode/` · `/Category/` · `/Currency/` · `/Job/` · `/JobBudget/` · `/LinkedAccount/` · `/GeneralJournal/` · `/ProfitLossDistribution/` | CRUD                      |
| `/GeneralLedger/AccountRegister/` · `/AccountingProperties/` · `/CategoryRegister/` · `/JobRegister/`                                                                                     | GET-list                  |
| `/GeneralLedger/JournalTransaction/`                                                                                                                                                      | GET-list, GET (read-only) |

### Inventory (`sme-inventory`)

| Path                                                              | Methods            |
| ----------------------------------------------------------------- | ------------------ |
| `/Inventory/Item/` · `/InventoryAdjustment/` · `/InventoryBuild/` | CRUD               |
| `/Inventory/ItemPriceMatrix/`                                     | GET-list, GET, PUT |
| `/Inventory/PriceLevelDetail/`                                    | GET-list           |

### Banking (`sme-banking`)

| Path                                                                                     | Methods                  |
| ---------------------------------------------------------------------------------------- | ------------------------ |
| `/Banking/`                                                                              | GET (list banking types) |
| `/Banking/BankAccount/` · `/SpendMoneyTxn/` · `/ReceiveMoneyTxn/` · `/TransferMoneyTxn/` | CRUD                     |
| `/Banking/Statement/`                                                                    | GET-list                 |

### TimeBilling (`sme-timebilling`)

| Path                                        | Methods |
| ------------------------------------------- | ------- |
| `/TimeBilling/Activity/` · `/ActivitySlip/` | CRUD    |

### Payroll (`sme-payroll`)

| Path                                                                                                                                                                                                                                             | Methods |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `/Payroll/Timesheet/` · `/EmploymentClassification/` · `/SuperannuationFund/` · `/PaymentSummaryETP/` · `/PaymentSummaryETPAmended/` · `/PaymentSummaryINB/` · `/PaymentSummaryINBAmended/` · `/PaymentSummaryLH/` · `/PaymentSummaryLHAmended/` | CRUD    |

> Payroll paths inferred from .NET SDK service class names (`TimesheetService.cs`, `PayrollEmploymentClassificationService.cs`, `PayrollSuperannuationFundService.cs`, six `EmployeePaymentSummary*` services). Confirm exact paths against sandbox or Postman collection before integrating.

### Company (`sme-company-file` / `sme-company-settings`)

| Path                    | Methods  | Notes                                                                  |
| ----------------------- | -------- | ---------------------------------------------------------------------- |
| `/Company/Preferences/` | GET-list | company data-file preferences                                          |
| `/CompanyFile`          | GET      | company file details                                                   |
| `/CurrentUser`          | GET      | authenticated user (deprecated for API keys created after 12 Mar 2025) |
| `/DataScopes`           | GET      | lists enabled scopes + endpoints; no scope required                    |

[UNKNOWN — endpoints not in verified sources]

## Error Reference

| HTTP | Name                                  | Code  | Cause                        |
| ---- | ------------------------------------- | ----- | ---------------------------- |
| 403  | `RateLimitError`                      | null  | rate limit (8/s or 1M/day)   |
| 403  | `DeveloperInactive`                   | null  | API key missing/inactive     |
| 403  | `AccessDenied`                        | -     | no permission to resource    |
| 400  | `Required`                            | 100   | required field missing       |
| 400  | `NotFound`                            | 150   | referenced UID doesn't exist |
| 400  | `SerializationError`                  | 50    | wrong field type             |
| 409  | `IncorrectRowVersionSupplied`         | 111   | stale RowVersion on PUT      |
| 400  | `TransactionsCannotBeDeleted`         | 25003 | must reverse, not delete     |
| 400  | `DatePriorToBeginningOfFinancialYear` | 25008 | date before FY start         |
| 504  | `GatewayTimeout`                      | null  | request timed out (>30s)     |

[DOCUMENTED errors] · full catalogue in `01d`.

## SDK Reference

| SDK                        | Language | Maintainer              | Link                                                       |
| -------------------------- | -------- | ----------------------- | ---------------------------------------------------------- |
| AccountRight Live .NET SDK | C#/.NET  | MYOB (official)         | https://github.com/myob-oss/AccountRight_Live_API_.Net_SDK |
| pymyob                     | Python   | uptick (community)      | https://github.com/uptick/pymyob                           |
| myob-api                   | Ruby     | davidlumley (community) | https://github.com/davidlumley/myob-api                    |
| myob-accountright-api      | Node.js  | aidancasey (community)  | https://github.com/aidancasey/myob-accountright-api        |

## Unknowns Requiring Live Testing

| Unknown                     | Impact             | Verify by                                                    |
| --------------------------- | ------------------ | ------------------------------------------------------------ |
| Access token lifetime       | refresh timing     | `expires_in` in token response                               |
| Refresh token lifetime      | session management | sandbox — wait + attempt refresh                             |
| Entity response field names | field mapping      | `GET /Contact/Customer`, `GET /Sale/Invoice/Item` in sandbox |
| GUID filter syntax in OData | query correctness  | test `$filter=Customer/UID eq guid'...'` vs `eq '...'`       |
| RowVersion format           | PUT payload        | `GET /Contact/Customer/{uid}` — inspect `RowVersion`         |

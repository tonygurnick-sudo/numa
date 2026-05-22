# API Spec Investigation — MYOB AccountRight (MYOB Business API v2)

> Clean consolidated API reference. All confirmed endpoints, auth, pagination, rate limits, and fields.
> Confidence markers used throughout: [CONFIRMED], [DOCUMENTED], [INFERRED], [UNKNOWN]

---

## API Identity

| Property           | Value                                                   | Confidence                 |
| ------------------ | ------------------------------------------------------- | -------------------------- |
| API Name           | MYOB Business API                                       | [DOCUMENTED]               |
| Version            | v2                                                      | [DOCUMENTED]               |
| Protocol           | HTTPS REST                                              | [DOCUMENTED]               |
| Response Format    | JSON (default) / PDF (with Accept header)               | [DOCUMENTED]               |
| Base URL (cloud)   | `https://api.myob.com/accountright/{businessId}/`       | [DOCUMENTED]               |
| Base URL (local)   | `http://localhost:8080/accountright/{businessId}/`      | [DOCUMENTED]               |
| Developer Portal   | https://developer.myob.com                              | [DOCUMENTED]               |
| API Support        | https://apisupport.myob.com/hc/en-us                    | [DOCUMENTED]               |
| Status Page        | https://status.myob.com/                                | [DOCUMENTED]               |
| OpenAPI Spec       | Exists at `/swagger.json` — requires auth (returns 401) | [CONFIRMED — 401 received] |
| Postman Collection | https://www.postman.com/myob-accountright               | [DOCUMENTED]               |

---

## Authentication

**Type:** OAuth 2.0 Authorization Code (Post-March 2025 flow)

### Endpoints

| Step           | Method | URL                                                |
| -------------- | ------ | -------------------------------------------------- |
| Authorize      | GET    | `https://secure.myob.com/oauth2/account/authorize` |
| Token Exchange | POST   | `https://secure.myob.com/oauth2/v1/authorize`      |
| Token Refresh  | POST   | `https://secure.myob.com/oauth2/v1/authorize`      |

### Authorization URL Required Parameters

| Parameter       | Value                                                                 |
| --------------- | --------------------------------------------------------------------- |
| `client_id`     | Your API key                                                          |
| `redirect_uri`  | Your registered redirect URI (must match exactly)                     |
| `response_type` | `code`                                                                |
| `scope`         | Space-separated list of `sme-*` scopes                                |
| `prompt`        | **`consent`** (REQUIRED — without this, `businessId` is not returned) |

### Token Request (POST body — form-encoded)

| Grant Type           | Parameters                                                                            |
| -------------------- | ------------------------------------------------------------------------------------- |
| `authorization_code` | `client_id`, `client_secret`, `code`, `redirect_uri`, `grant_type=authorization_code` |
| `refresh_token`      | `client_id`, `client_secret`, `refresh_token`, `grant_type=refresh_token`             |

### Token Response Fields

| Field           | Type    | Notes                                                   |
| --------------- | ------- | ------------------------------------------------------- |
| `access_token`  | string  | Bearer token for API calls                              |
| `refresh_token` | string  | **Rotates on every refresh — must be stored each time** |
| `scope`         | string  | Granted scopes                                          |
| `expires_in`    | integer | Seconds until access_token expires                      |

[DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719

### Post-OAuth Redirect Parameters

| Parameter      | Description                                                  |
| -------------- | ------------------------------------------------------------ |
| `code`         | Authorization code                                           |
| `businessId`   | Company file GUID — **primary identifier for all API calls** |
| `businessName` | Company file display name                                    |

### Breaking Changes (March 2025)

- `GET /accountright/` no longer lists company files for new API keys
- Old `CompanyFile` scope deprecated — use `sme-*` scopes
- `CurrentUser` endpoint deprecated for new keys
- `businessId` must come from redirect URI (not the list endpoint)

[DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719

---

## Required Headers

| Header              | Value                       | Required          |
| ------------------- | --------------------------- | ----------------- |
| `Authorization`     | `Bearer {access_token}`     | Always            |
| `x-myobapi-key`     | Your API key (client_id)    | Always            |
| `x-myobapi-version` | `v2`                        | Always            |
| `Content-Type`      | `application/json`          | POST/PUT          |
| `x-myobapi-cftoken` | `base64(username:password)` | Local files only  |
| `Accept`            | `application/pdf`           | PDF download only |

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/v2/

---

## OAuth Scopes

| Scope                   | Access Area                                 |
| ----------------------- | ------------------------------------------- |
| `sme-company-file`      | Company file access (base scope)            |
| `sme-general-ledger`    | Accounts, tax codes, journal entries        |
| `sme-sales`             | Invoices, customer payments, orders, quotes |
| `sme-purchases`         | Bills, supplier payments, purchase orders   |
| `sme-contacts-customer` | Customer contacts                           |
| `sme-contacts-supplier` | Supplier contacts                           |
| `sme-contacts-employee` | Employee contacts                           |
| `sme-contacts-personal` | Personal contacts                           |
| `sme-banking`           | Banking transactions                        |
| `sme-inventory`         | Inventory items                             |
| `sme-payroll`           | Payroll, timesheets                         |
| `sme-timebilling`       | Time billing activities                     |
| `sme-company-settings`  | Company file settings                       |

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/scopes/

---

## Rate Limits

| Limit      | Value                              | Error                  |
| ---------- | ---------------------------------- | ---------------------- |
| Per-second | 8 requests/second                  | 403 + `RateLimitError` |
| Daily      | 1,000,000 requests/day per API key | 403 + `RateLimitError` |
| Timeout    | 30 seconds                         | 504 + `GatewayTimeout` |

> ⚠️ Rate limit errors return **403**, NOT 429.

[DOCUMENTED] https://www.apideck.com/blog/how-to-integrate-with-the-myob-api
[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/

---

## Pagination

| Property            | Value                                            |
| ------------------- | ------------------------------------------------ |
| Protocol            | OData v2 (v3 operators supported — `any`, `all`) |
| Default page size   | 400                                              |
| Maximum page size   | 1000 (via `$top=1000`)                           |
| Parameters          | `$top`, `$skip`, `$orderby`, `$filter`           |
| Next page indicator | `NextPageLink` field in response                 |
| Best practice       | `$skip` = multiple of `$top`                     |

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/

---

## Confirmed Endpoints

All paths relative to `https://api.myob.com/accountright/{businessId}/`. Methods verified against the **official MYOB .NET SDK** [`myob-oss/AccountRight_Live_API_.Net_SDK`](https://github.com/myob-oss/AccountRight_Live_API_.Net_SDK) — service classes under `MYOB.API.SDK/SDK/Services/Version2/` (verified 2026-05-19). `CRUD` = GET-list + GET-by-uid + POST + PUT + DELETE.

> **Corrected 2026-05-19:** prior version of this catalogue was built from the **pymyob** community SDK, which is incomplete. It dropped many real endpoints. This version uses the official .NET SDK as the authoritative source.

### Contacts (`sme-contacts-*`)

| Path                                            | Methods                  |
| ----------------------------------------------- | ------------------------ |
| `/Contact/`                                     | GET (list contact types) |
| `/Contact/Customer/`                            | CRUD                     |
| `/Contact/Supplier/`                            | CRUD                     |
| `/Contact/Employee/`                            | CRUD                     |
| `/Contact/Personal/`                            | CRUD                     |
| `/Contact/Employee/{uid}/PaymentDetails/`       | GET, PUT                 |
| `/Contact/Employee/{uid}/PaymentSummaryReport/` | GET                      |
| `/Contact/Employee/{uid}/PayrollDetails/`       | GET, PUT                 |
| `/Contact/Employee/{uid}/StandardPay/`          | GET, PUT                 |

### Sales (`sme-sales`)

| Path                                               | Methods                         |
| -------------------------------------------------- | ------------------------------- |
| `/Sale/Invoice/`                                   | GET (list invoice types)        |
| `/Sale/Invoice/Item/`                              | CRUD                            |
| `/Sale/Invoice/Service/`                           | CRUD                            |
| `/Sale/Invoice/Professional/`                      | CRUD                            |
| `/Sale/Invoice/TimeBilling/`                       | CRUD                            |
| `/Sale/Invoice/Miscellaneous/`                     | CRUD                            |
| `/Sale/Invoice/{uid}/pdf`                          | GET (`Accept: application/pdf`) |
| `/Sale/Invoice/{uid}/email`                        | POST — online cloud files only  |
| `/Sale/Order/`                                     | GET (list order types)          |
| `/Sale/Order/Item/`                                | CRUD                            |
| `/Sale/Order/Service/`                             | CRUD                            |
| `/Sale/Order/Professional/`                        | CRUD                            |
| `/Sale/Order/TimeBilling/`                         | CRUD                            |
| `/Sale/Order/Miscellaneous/`                       | CRUD                            |
| `/Sale/Quote/`                                     | GET (list quote types)          |
| `/Sale/Quote/Item/`                                | CRUD                            |
| `/Sale/Quote/Service/`                             | CRUD                            |
| `/Sale/Quote/Professional/`                        | CRUD                            |
| `/Sale/Quote/TimeBilling/`                         | CRUD                            |
| `/Sale/Quote/Miscellaneous/`                       | CRUD                            |
| `/Sale/CustomerPayment/`                           | GET-list, GET, POST, DELETE     |
| `/Sale/CustomerPaymentRecordWithDiscountsAndFees/` | POST                            |
| `/Sale/CreditRefund/`                              | GET-list, GET, POST, DELETE     |
| `/Sale/CreditSettlement/`                          | GET-list, GET, POST, DELETE     |
| `/Sale/CalculateDiscountsFees/`                    | POST                            |

### Purchases (`sme-purchases`)

| Path                                                   | Methods                     |
| ------------------------------------------------------ | --------------------------- |
| `/Purchase/Bill/`                                      | GET (list bill types)       |
| `/Purchase/Bill/Item/`                                 | CRUD                        |
| `/Purchase/Bill/Service/`                              | CRUD                        |
| `/Purchase/Bill/Professional/`                         | CRUD                        |
| `/Purchase/Bill/Miscellaneous/`                        | CRUD                        |
| `/Purchase/Order/`                                     | GET (list order types)      |
| `/Purchase/Order/Item/`                                | CRUD                        |
| `/Purchase/Order/Service/`                             | CRUD                        |
| `/Purchase/Order/Professional/`                        | CRUD                        |
| `/Purchase/Order/Miscellaneous/`                       | CRUD                        |
| `/Purchase/SupplierPayment/`                           | CRUD                        |
| `/Purchase/SupplierPaymentRecordWithDiscountsAndFees/` | POST                        |
| `/Purchase/DebitRefund/`                               | GET-list, GET, POST, DELETE |
| `/Purchase/DebitSettlement/`                           | GET-list, GET, POST, DELETE |
| `/Purchase/CalculateDiscounts/`                        | POST                        |

### General Ledger (`sme-general-ledger`)

| Path                                     | Methods                   |
| ---------------------------------------- | ------------------------- |
| `/GeneralLedger/Account/`                | CRUD                      |
| `/GeneralLedger/AccountBudget/`          | CRUD                      |
| `/GeneralLedger/AccountRegister/`        | GET-list                  |
| `/GeneralLedger/AccountingProperties/`   | GET-list                  |
| `/GeneralLedger/TaxCode/`                | CRUD                      |
| `/GeneralLedger/Category/`               | CRUD                      |
| `/GeneralLedger/CategoryRegister/`       | GET-list                  |
| `/GeneralLedger/Currency/`               | CRUD                      |
| `/GeneralLedger/Job/`                    | CRUD                      |
| `/GeneralLedger/JobBudget/`              | CRUD                      |
| `/GeneralLedger/JobRegister/`            | GET-list                  |
| `/GeneralLedger/LinkedAccount/`          | CRUD                      |
| `/GeneralLedger/GeneralJournal/`         | CRUD                      |
| `/GeneralLedger/JournalTransaction/`     | GET-list, GET (read-only) |
| `/GeneralLedger/ProfitLossDistribution/` | CRUD                      |

### Inventory (`sme-inventory`)

| Path                              | Methods            |
| --------------------------------- | ------------------ |
| `/Inventory/Item/`                | CRUD               |
| `/Inventory/InventoryAdjustment/` | CRUD               |
| `/Inventory/InventoryBuild/`      | CRUD               |
| `/Inventory/ItemPriceMatrix/`     | GET-list, GET, PUT |
| `/Inventory/PriceLevelDetail/`    | GET-list           |

### Banking (`sme-banking`)

| Path                         | Methods                  |
| ---------------------------- | ------------------------ |
| `/Banking/`                  | GET (list banking types) |
| `/Banking/BankAccount/`      | CRUD                     |
| `/Banking/SpendMoneyTxn/`    | CRUD                     |
| `/Banking/ReceiveMoneyTxn/`  | CRUD                     |
| `/Banking/TransferMoneyTxn/` | CRUD                     |
| `/Banking/Statement/`        | GET-list                 |

### TimeBilling (`sme-timebilling`)

| Path                         | Methods |
| ---------------------------- | ------- |
| `/TimeBilling/Activity/`     | CRUD    |
| `/TimeBilling/ActivitySlip/` | CRUD    |

### Payroll (`sme-payroll`)

| Path                                 | Methods |
| ------------------------------------ | ------- |
| `/Payroll/Timesheet/`                | CRUD    |
| `/Payroll/EmploymentClassification/` | CRUD    |
| `/Payroll/SuperannuationFund/`       | CRUD    |
| `/Payroll/PaymentSummaryETP/`        | CRUD    |
| `/Payroll/PaymentSummaryETPAmended/` | CRUD    |
| `/Payroll/PaymentSummaryINB/`        | CRUD    |
| `/Payroll/PaymentSummaryINBAmended/` | CRUD    |
| `/Payroll/PaymentSummaryLH/`         | CRUD    |
| `/Payroll/PaymentSummaryLHAmended/`  | CRUD    |

> URL paths inferred from the .NET SDK service class names (`TimesheetService.cs`, `PayrollEmploymentClassificationService.cs`, `PayrollSuperannuationFundService.cs`, six `EmployeePaymentSummary*` services). Confirm exact paths against sandbox or the Postman collection before integrating.

### Company (`sme-company-file` / `sme-company-settings`)

| Path                    | Methods  | Notes                                                                    |
| ----------------------- | -------- | ------------------------------------------------------------------------ |
| `/Company/Preferences/` | GET-list | Company data-file preferences                                            |
| `/CompanyFile`          | GET      | Company file details                                                     |
| `/CurrentUser`          | GET      | Authenticated user (deprecated for API keys created after 12 March 2025) |
| `/DataScopes`           | GET      | Lists enabled scopes + endpoints; no scope required                      |

[UNKNOWN — endpoints not in verified sources]

---

## Error Reference

| HTTP Status | Error Name                            | Code  | Cause                               |
| ----------- | ------------------------------------- | ----- | ----------------------------------- |
| 403         | `RateLimitError`                      | null  | Rate limit exceeded (8/s or 1M/day) |
| 403         | `DeveloperInactive`                   | null  | API key missing or inactive         |
| 403         | `AccessDenied`                        | -     | No permission to resource           |
| 400         | `Required`                            | 100   | Required field missing              |
| 400         | `NotFound`                            | 150   | Referenced UID doesn't exist        |
| 400         | `SerializationError`                  | 50    | Wrong field type                    |
| 409         | `IncorrectRowVersionSupplied`         | 111   | Stale RowVersion on PUT             |
| 400         | `TransactionsCannotBeDeleted`         | 25003 | Must reverse, not delete            |
| 400         | `DatePriorToBeginningOfFinancialYear` | 25008 | Date before FY start                |
| 504         | `GatewayTimeout`                      | null  | Request timed out (>30s)            |

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/

---

## SDK Reference

| SDK                        | Language  | Maintainer              | Link                                                       |
| -------------------------- | --------- | ----------------------- | ---------------------------------------------------------- |
| AccountRight Live .NET SDK | C# / .NET | MYOB (official)         | https://github.com/myob-oss/AccountRight_Live_API_.Net_SDK |
| pymyob                     | Python    | uptick (community)      | https://github.com/uptick/pymyob                           |
| myob-api                   | Ruby      | davidlumley (community) | https://github.com/davidlumley/myob-api                    |
| myob-accountright-api      | Node.js   | aidancasey (community)  | https://github.com/aidancasey/myob-accountright-api        |

---

## Unknowns Requiring Live Testing

| Unknown                          | Impact                    | How to Verify                                                    |
| -------------------------------- | ------------------------- | ---------------------------------------------------------------- |
| Access token lifetime            | Token refresh timing      | Check `expires_in` field in token response                       |
| Refresh token lifetime           | Session management        | Test with sandbox — wait and attempt refresh                     |
| Entity response body field names | Integration field mapping | `GET /Contact/Customer`, `GET /Sale/Invoice/Item` in sandbox     |
| GUID filter syntax in OData      | Query correctness         | Test `$filter=Customer/UID eq guid'...'` vs `eq '...'`           |
| RowVersion format                | PUT payload               | `GET /Contact/Customer/{uid}` — inspect `RowVersion` field value |

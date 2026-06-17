---
doc: event-and-error-handling — MYOB AccountRight (MYOB Business API v2)
webhooks: NOT SUPPORTED — poll only [DOCUMENTED https://apisupport.myob.com/hc/en-us/articles/6258012443791-Does-MYOB-support-webhooks]
critical: rate limits return HTTP 403 (NOT 429) — always inspect response body `Name` field to distinguish rate-limit from auth errors
confidence: [DOCUMENTED] from MYOB docs unless noted
ref: errors=https://developer.myob.com/api/myob-business-api/api-overview/error-messages/ · rules-section=https://apisupport.myob.com/hc/en-us/sections/360000104856
---

# Event & Error Handling — MYOB AccountRight

## 1. Webhooks

NOT SUPPORTED — no webhooks, push notifications, or event subscriptions. Polling is the only change-detection mechanism.

## 2. Polling Strategy (webhook substitute)

Use the `LastModified` OData filter (MYOB's recommended approach). Store `last_sync_time`; on each poll:

```
GET /{endpoint}?$filter=LastModified ge datetime'{last_sync_time}'&$orderby=LastModified asc&$top=1000
# after processing, set last_sync_time = LastModified of last record returned
```

**Poll endpoints by event:**
| Event to detect | Poll endpoint |
| --- | --- |
| new/updated invoices | `/Sale/Invoice/Item`, `/Sale/Invoice/Service` |
| paid invoices | `/Sale/Invoice/Item?$filter=Status eq 'Closed' and LastModified ge datetime'...'` |
| new customer payments | `/Sale/CustomerPayment?$filter=LastModified ge datetime'...'` |
| new/updated customers | `/Contact/Customer?$filter=LastModified ge datetime'...'` |
| new/updated suppliers | `/Contact/Supplier?$filter=LastModified ge datetime'...'` |
| new bills | `/Purchase/Bill/Item?$filter=LastModified ge datetime'...'` |
| new transactions | `/Banking/SpendMoneyTxn?$filter=LastModified ge datetime'...'` |

**Frequency:** max once/min per endpoint (stay under 8 req/s); low-activity files 5–15 min suffices. Avoid end-of-month (~20th–5th of following month). Check https://status.myob.com/ before assuming gaps are missing records.

> ⚠️ Known issue: `LastModified` may not always update when expected — MYOB support acknowledges cases where it doesn't update on certain entity changes. [DOCUMENTED rules-section]

## 3. Error Response Shapes

**Standard:** `{"Name":"Required","Message":"Customer is required","AdditionalDetails":"Customer","ErrorCode":100,"Severity":"Error"}`
**Access/auth:** `{"Message":"You are not authorised to access this resource","ErrorCode":"AccessDenied"}`
**Rate limit:** `{"Name":"RateLimitError","Message":"API key has exceeded the per-second rate limit","AdditionalDetails":"Header: x-myobapi-key","ErrorCode":null,"Severity":"Error","LearnMore":"[Documentation URI]"}`
**Gateway timeout:** `{"Name":"GatewayTimeout","Message":"Connection to the API has timed out","ErrorCode":null,"Severity":"Error","LearnMore":"[Documentation URI]"}`
[DOCUMENTED errors]

## 4. HTTP Status Reference

| Status | Meaning                                       | Action                                                                                                                             |
| ------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 200    | success (GET/PUT/DELETE)                      | process response                                                                                                                   |
| 201    | created (POST)                                | extract UID from response                                                                                                          |
| 400    | bad request — validation                      | check body `Name`+`Message`; fix payload                                                                                           |
| 401    | unauthorised                                  | re-authenticate; access token may be expired                                                                                       |
| 403    | forbidden — rate limit OR auth                | **check `Name`:** `RateLimitError`→backoff+retry; `DeveloperInactive`→check API key; `AccessDenied`→check company file permissions |
| 404    | not found                                     | check UID                                                                                                                          |
| 409    | conflict `IncorrectRowVersionSupplied` on PUT | re-fetch entity for current `RowVersion`, retry PUT                                                                                |
| 500    | internal server error                         | retry with backoff; log                                                                                                            |
| 504    | gateway timeout (~30s)                        | retry with backoff                                                                                                                 |

> ⚠️ Rate limits return **403, not 429** — always inspect body `Name` to distinguish auth from rate-limit.

## 5. Error Catalogue

### Common

| Name                                  | Code  | HTTP | Cause                                    | Resolution                               |
| ------------------------------------- | ----- | ---- | ---------------------------------------- | ---------------------------------------- |
| `RateLimitError`                      | null  | 403  | per-second (8/s) or daily (1M) exceeded  | exponential backoff, respect 8 req/s     |
| `DeveloperInactive`                   | null  | 403  | API key missing/inactive                 | check `x-myobapi-key` header             |
| `AccessDenied`                        | -     | 403  | user lacks company file permission       | check `x-myobapi-cftoken` or OAuth scope |
| `Required`                            | 100   | 400  | required field missing                   | add field                                |
| `NotFound`                            | 150   | 400  | referenced UID doesn't exist             | verify UID via GET before POST/PUT       |
| `SerializationError`                  | 50    | 400  | wrong field type (e.g. "abc" for GUID)   | check field types vs schema              |
| `IncorrectRowVersionSupplied`         | 111   | 409  | stale RowVersion on PUT                  | re-fetch latest RowVersion               |
| `TransactionsCannotBeDeleted`         | 25003 | 400  | company "must reverse" setting           | create reversal transaction              |
| `DatePriorToBeginningOfFinancialYear` | 25008 | 400  | date before FY start                     | use date in current FY                   |
| `GatewayTimeout`                      | null  | 504  | MYOB server timed out                    | retry, exponential backoff               |
| `FreightHasNotBeenSet`                | -     | 400  | freight amount without TaxCode           | add `FreightTaxCode` to invoice          |
| `AccountHeaderNotAllowed`             | -     | 400  | header account in transaction            | use detail-type account                  |
| `ConsolidatedTaxCode`                 | -     | 400  | consolidated tax code on a line          | use non-consolidated tax code            |
| `AsOfDateBeforeConversionPeriod`      | -     | 400  | date before company file conversion date | use date after conversion period         |
| `DateInLockPeriod`                    | -     | 400  | transaction in locked accounting period  | use date outside the locked period       |

### Domain-specific (verified)

| Name                         | Code  | Area             | Cause                                                      |
| ---------------------------- | ----- | ---------------- | ---------------------------------------------------------- |
| `InvoicePaid`                | 10001 | Sale/Invoice     | rejected because invoice has payments applied              |
| `OrderConvertedToInvoice`    | 37001 | Sale/Order       | order already converted — can't mutate as order            |
| `LayoutTypeMismatch`         | 37004 | Sale/Invoice     | wrong layout type for the operation                        |
| `Duplicate`                  | 200   | Purchase/Bill    | duplicate bill number                                      |
| `CreditLimitExceeded`        | 25005 | Purchase/Bill    | supplier credit limit exceeded                             |
| `IncorrectAccountType`       | 25006 | Purchase/Bill    | account type wrong for line (header where detail required) |
| `ItemLinkedToSales`          | 9002  | Inventory/Item   | can't modify/delete — linked to sale records               |
| `ItemWithInventory`          | 9005  | Inventory/Item   | can't delete while it holds inventory                      |
| `TransferBetweenSameAccount` | 29000 | Banking/Transfer | `From` and `To` accounts identical                         |
| `DepositToAccountMismatch`   | 26000 | Banking/Receive  | deposit-to account mismatch on receive-money               |

[DOCUMENTED errors + rules-section]

## 6. Retry Logic

```
function callWithRetry(request, maxRetries=3):
    for attempt in 1..maxRetries:
        response = makeRequest(request)
        if response.status in (200, 201): return response
        elif response.status == 403:
            error = parseJSON(response.body)
            if error.Name == "RateLimitError": wait(2^attempt s); continue   # backoff + retry
            else: raise AuthError(error.Message)                             # do NOT retry
        elif response.status == 504: wait(5*attempt s); continue              # server timeout
        elif response.status == 409:                                         # IncorrectRowVersionSupplied
            entity = GET(request.url); request.body.RowVersion = entity.RowVersion; continue
        elif response.status == 400: raise ValidationError(response.body)     # do NOT retry, fix payload
        elif response.status == 401: refreshAccessToken(); continue           # retry once
        else: raise ApiError(response)
    raise MaxRetriesExceeded()
```

## 7. Output Formatting

**Dates:** API returns `"2024-06-15T00:00:00"`; display in locale (`15/06/2024` AU/NZ); filter with `datetime'2024-06-15'`.

> ⚠️ Date/time values may differ between request and response — MYOB may normalise timestamps. Do NOT assert exact datetime equality. [DOCUMENTED rules-section]

**Currency:** decimals to 2 dp; no symbol in API; currency code per company file settings; multi-currency if enabled (ISO 4217).
**GUIDs:** UUID v4; pass as plain string `"5d4b1ce0-bb9f-4f4c-9578-2b168b7295db"`; in `$filter` may need `guid'...'` (confirm against sandbox).
**RowVersion:** string returned on every entity GET; pass back verbatim on PUT (do not modify); changes on every successful PUT.

## 8. When NOT to retry

| Scenario                                  | Reason                                                           |
| ----------------------------------------- | ---------------------------------------------------------------- |
| 400 `Required`/`NotFound`                 | data error — fix payload                                         |
| 403 `DeveloperInactive`                   | config issue — check API key                                     |
| 403 `AccessDenied`                        | permission issue — check OAuth scopes + company file permissions |
| 400 `DatePriorToBeginningOfFinancialYear` | business rule — fix the date                                     |

**A 403 is NOT a rate limit when `Name != "RateLimitError"`** → auth/permission error, retrying won't help. Check: `x-myobapi-key` correct? Bearer token valid/not expired? OAuth scope covers the endpoint? User an Administrator?

**"Company file version not supported":** some customers run outdated AccountRight desktop → endpoints return 404. Fix = customer updates MYOB software; cannot be resolved programmatically. [DOCUMENTED rules-section]

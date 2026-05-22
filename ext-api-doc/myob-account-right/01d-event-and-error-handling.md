# Event & Error Handling — MYOB AccountRight (MYOB Business API v2)

---

## 1. Webhooks / Push Notifications

**Status: NOT SUPPORTED.**

MYOB does not provide webhooks, push notifications, or event subscriptions of any kind.

[DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/6258012443791-Does-MYOB-support-webhooks

**Polling is the only option for change detection.**

---

## 2. Polling Strategy (Webhook Substitute)

Use the `LastModified` OData filter on any endpoint that supports it. This is the recommended MYOB approach.

### Incremental sync pattern

```
# Store last_sync_time in your system. On each poll:

GET /{endpoint}?$filter=LastModified ge datetime'{last_sync_time}'
  &$orderby=LastModified asc
  &$top=1000

# After processing, update last_sync_time = LastModified of last record returned
```

### Recommended polling endpoints for common use cases

| Event you want to detect | Poll endpoint                                                                     |
| ------------------------ | --------------------------------------------------------------------------------- |
| New/updated invoices     | `/Sale/Invoice/Item`, `/Sale/Invoice/Service`                                     |
| Paid invoices            | `/Sale/Invoice/Item?$filter=Status eq 'Closed' and LastModified ge datetime'...'` |
| New customer payments    | `/Sale/CustomerPayment?$filter=LastModified ge datetime'...'`                     |
| New/updated customers    | `/Contact/Customer?$filter=LastModified ge datetime'...'`                         |
| New/updated suppliers    | `/Contact/Supplier?$filter=LastModified ge datetime'...'`                         |
| New bills                | `/Purchase/Bill/Item?$filter=LastModified ge datetime'...'`                       |
| New transactions         | `/Banking/SpendMoneyTxn?$filter=LastModified ge datetime'...'`                    |

### Polling frequency guidelines

- Maximum: once per minute per endpoint (to stay within 8 req/s limit)
- For low-activity files: once every 5–15 minutes is sufficient
- Avoid polling during known busy periods (end of month: ~20th–5th of following month)
- Check https://status.myob.com/ before assuming data gaps are missing records

> ⚠️ **Known issue:** The `LastModified` field may not always update when expected. MYOB support documentation acknowledges cases where `LastModified` does not update on certain entity changes.
> [DOCUMENTED] https://apisupport.myob.com/hc/en-us/sections/360000104856

---

## 3. Error Response Format

All API errors return a JSON body. The shape varies slightly by error type.

### Standard error shape

```json
{
  "Name": "Required",
  "Message": "Customer is required",
  "AdditionalDetails": "Customer",
  "ErrorCode": 100,
  "Severity": "Error"
}
```

### Access/auth error shape

```json
{
  "Message": "You are not authorised to access this resource",
  "ErrorCode": "AccessDenied"
}
```

### Rate limit error shape

```json
{
  "Name": "RateLimitError",
  "Message": "API key has exceeded the per-second rate limit",
  "AdditionalDetails": "Header: x-myobapi-key",
  "ErrorCode": null,
  "Severity": "Error",
  "LearnMore": "[Documentation URI]"
}
```

### Gateway timeout shape

```json
{
  "Name": "GatewayTimeout",
  "Message": "Connection to the API has timed out",
  "ErrorCode": null,
  "Severity": "Error",
  "LearnMore": "[Documentation URI]"
}
```

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/

---

## 4. HTTP Status Code Reference

| Status | Meaning                                         | Action                                                                                                                                                       |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 200    | Success (GET/PUT/DELETE)                        | Process response                                                                                                                                             |
| 201    | Created (POST)                                  | Entity created — extract UID from response                                                                                                                   |
| 400    | Bad Request — validation error                  | Check error body `Name` + `Message`. Fix payload.                                                                                                            |
| 401    | Unauthorised                                    | Re-authenticate. Access token may be expired.                                                                                                                |
| 403    | Forbidden — could be rate limit OR auth issue   | **Check `Name` field.** If `RateLimitError` → backoff and retry. If `DeveloperInactive` → check API key. If `AccessDenied` → check company file permissions. |
| 404    | Not Found                                       | Entity doesn't exist. Check UID.                                                                                                                             |
| 409    | Conflict — `IncorrectRowVersionSupplied` on PUT | Re-fetch entity to get current `RowVersion`, then retry PUT.                                                                                                 |
| 500    | Internal Server Error                           | Retry with backoff. Log error.                                                                                                                               |
| 504    | Gateway Timeout                                 | MYOB server timed out (~30s). Retry with backoff.                                                                                                            |

> ⚠️ **Critical gotcha:** Rate limits return **403**, not 429. Always inspect the response body's `Name` field to distinguish between auth errors and rate limit errors.

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/

---

## 5. Error Catalogue (Common Errors)

| Error Name                            | Code  | HTTP | Cause                                         | Resolution                                     |
| ------------------------------------- | ----- | ---- | --------------------------------------------- | ---------------------------------------------- |
| `RateLimitError`                      | null  | 403  | Per-second (8/s) or daily (1M) limit exceeded | Exponential backoff, respect 8 req/s           |
| `DeveloperInactive`                   | null  | 403  | API key missing or inactive                   | Check `x-myobapi-key` header                   |
| `AccessDenied`                        | -     | 403  | User lacks company file permission            | Check `x-myobapi-cftoken` or OAuth token scope |
| `Required`                            | 100   | 400  | Required field missing                        | Add missing field to payload                   |
| `NotFound`                            | 150   | 400  | Referenced UID does not exist                 | Verify UID via GET before POST/PUT             |
| `SerializationError`                  | 50    | 400  | Wrong field type (e.g. "abc" for a GUID)      | Check field types against schema               |
| `IncorrectRowVersionSupplied`         | 111   | 409  | Stale RowVersion on PUT                       | Re-fetch entity to get latest RowVersion       |
| `TransactionsCannotBeDeleted`         | 25003 | 400  | Company has "must reverse" setting            | Create a reversal transaction instead          |
| `DatePriorToBeginningOfFinancialYear` | 25008 | 400  | Date before financial year start              | Use date within current financial year         |
| `GatewayTimeout`                      | null  | 504  | MYOB server timed out                         | Retry with exponential backoff                 |
| `FreightHasNotBeenSet`                | -     | 400  | Freight amount without TaxCode                | Add `FreightTaxCode` to invoice                |
| `AccountHeaderNotAllowed`             | -     | 400  | Using a header account in transaction         | Use a detail-type account                      |
| `ConsolidatedTaxCode`                 | -     | 400  | Consolidated tax code used on a line          | Use non-consolidated tax code                  |
| `AsOfDateBeforeConversionPeriod`      | -     | 400  | Date before company file conversion date      | Use a date after conversion period             |
| `DateInLockPeriod`                    | -     | 400  | Transaction in a locked accounting period     | Use a date outside the locked period           |

### Domain-specific errors (selected, verified)

| Error Name                   | Code  | Area             | Cause                                                                    |
| ---------------------------- | ----- | ---------------- | ------------------------------------------------------------------------ |
| `InvoicePaid`                | 10001 | Sale/Invoice     | Operation rejected because invoice has payments applied                  |
| `OrderConvertedToInvoice`    | 37001 | Sale/Order       | Order already converted — can no longer mutate as order                  |
| `LayoutTypeMismatch`         | 37004 | Sale/Invoice     | Wrong layout type for the operation                                      |
| `Duplicate`                  | 200   | Purchase/Bill    | Duplicate bill number                                                    |
| `CreditLimitExceeded`        | 25005 | Purchase/Bill    | Supplier credit limit exceeded                                           |
| `IncorrectAccountType`       | 25006 | Purchase/Bill    | Account type wrong for the line (e.g. header used where detail required) |
| `ItemLinkedToSales`          | 9002  | Inventory/Item   | Item cannot be modified/deleted because it's linked to sale records      |
| `ItemWithInventory`          | 9005  | Inventory/Item   | Item cannot be deleted while it still holds inventory                    |
| `TransferBetweenSameAccount` | 29000 | Banking/Transfer | `From` and `To` accounts are identical                                   |
| `DepositToAccountMismatch`   | 26000 | Banking/Receive  | Deposit-to account mismatch on receive-money                             |

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/
https://apisupport.myob.com/hc/en-us/sections/360000104856

---

## 6. Retry Logic

### Recommended retry strategy

```
function callWithRetry(request, maxRetries=3):
    for attempt in 1..maxRetries:
        response = makeRequest(request)

        if response.status == 200 or 201:
            return response

        elif response.status == 403:
            error = parseJSON(response.body)
            if error.Name == "RateLimitError":
                # Back off and retry
                wait(2^attempt seconds)
                continue
            else:
                # Auth error — do not retry
                raise AuthError(error.Message)

        elif response.status == 504:
            # Server timeout — retry with longer delay
            wait(5 * attempt seconds)
            continue

        elif response.status == 409:
            # IncorrectRowVersionSupplied — re-fetch and retry
            entity = GET(request.url)
            request.body.RowVersion = entity.RowVersion
            continue

        elif response.status == 400:
            # Validation error — do not retry, fix payload
            raise ValidationError(response.body)

        elif response.status == 401:
            # Token expired — refresh token and retry once
            refreshAccessToken()
            continue

        else:
            raise ApiError(response)

    raise MaxRetriesExceeded()
```

---

## 7. Output Formatting

### Dates

- API returns dates as: `"2024-06-15T00:00:00"`
- When displaying: format to locale (e.g. `15/06/2024` for AU/NZ)
- When filtering: use `datetime'2024-06-15'` (OData format)

> ⚠️ **Known issue:** Date/time values may differ between what you send in a request and what MYOB returns in the response. MYOB may normalise timestamps. Do not assert exact datetime equality.
> [DOCUMENTED] https://apisupport.myob.com/hc/en-us/sections/360000104856

### Currency

- All monetary values are decimals to 2 decimal places
- No currency symbol in API — currency code depends on company file settings
- Multi-currency supported if enabled in company file (ISO 4217 codes)

### GUIDs

- All entity UIDs are UUID v4 format
- Always pass as plain string: `"5d4b1ce0-bb9f-4f4c-9578-2b168b7295db"`
- In OData `$filter`, may need `guid'...'` syntax (confirm against sandbox)

### RowVersion

- String value returned on every entity GET
- Must be passed back verbatim on PUT — do not modify
- Changes on every successful PUT

---

## 8. Counter-Exceptions

### When NOT to retry

| Scenario                                  | Reason                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| 400 `Required` or `NotFound`              | Data error — retrying won't help. Fix the payload.                                       |
| 403 `DeveloperInactive`                   | Configuration issue — retrying won't help. Check API key.                                |
| 403 `AccessDenied`                        | Permission issue — retrying won't help. Check OAuth scopes and company file permissions. |
| 400 `DatePriorToBeginningOfFinancialYear` | Business rule violation — retrying won't help. Fix the date.                             |

### When a 403 is NOT a rate limit

If `Name != "RateLimitError"`, the 403 is an auth/permission error. Retrying will not help. Check:

- Is the `x-myobapi-key` header correct?
- Is the Bearer token valid and not expired?
- Does the OAuth scope include the endpoint you're accessing?
- Is the company file user an Administrator?

### Handling the "company file version not supported" error

Some customers run outdated versions of AccountRight desktop. Endpoints may return 404. The fix is for the customer to update their MYOB software — this cannot be resolved programmatically.
[DOCUMENTED] https://apisupport.myob.com/hc/en-us/sections/360000104856

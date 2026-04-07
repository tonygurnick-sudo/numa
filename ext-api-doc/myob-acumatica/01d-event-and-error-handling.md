# MYOB Acumatica -- Event & Error Handling

> **API Version:** 24.200.001
> Companion to `01-llm-api-rules.md`.

---

## Event-Driven Capabilities

| Mechanism                     | Supported | Notes                                                   |
| ----------------------------- | --------- | ------------------------------------------------------- |
| Webhooks (Push Notifications) | Yes       | UI-only configuration, not API-managed                  |
| WebSocket                     | No        | --                                                      |
| Server-Sent Events (SSE)      | No        | --                                                      |
| Long polling                  | No        | Use standard polling with `LastModifiedDateTime` filter |
| Change feeds / streams        | No        | --                                                      |

---

## Webhooks (Push Notifications)

### Setup: UI-Only

**[DOCUMENTED]** -- MYOB Acumatica webhooks are configured exclusively through the Push Notifications screen in the Acumatica UI. There is no API to create, modify, or delete webhook subscriptions.

**Setup path:**

1. Create a Generic Inquiry (GI) or use a built-in definition that captures the data/events you want
2. Navigate to Push Notifications screen in Acumatica
3. Configure: source definition, destination URL, event triggers
4. Test the notification

Source: https://www.acumatica.com/media/2020/07/2020-Virtual-DevCon-Push-Notifications-Webhooks-Final.pdf

### What Can Trigger Notifications

- Any entity insert, update, or delete captured by a GI or built-in definition
- State transitions (status field changes)
- Custom business events via GI formulas

### Webhook Payload Format

**[DOCUMENTED]** -- Push Notification payload structure from Acumatica DevCon 2020 presentation:

```json
{
  "Query": "SourceDefinitionName",
  "CompanyId": "CompanyLoginName",
  "Id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "TimeStamp": 637407844167787833,
  "Inserted": [
    {
      "CustomerID": "ACME01",
      "CustomerName": "Acme Corporation",
      "Status": "Active"
    }
  ],
  "Deleted": [],
  "AdditionalInfo": {}
}
```

For updates (shows old and new values):

```json
{
  "Query": "CustomerChanges",
  "CompanyId": "MyCompany",
  "Id": "d4e5f6a7-b8c9-0123-4567-890abcdef123",
  "TimeStamp": 637407844167800000,
  "Inserted": [
    {
      "CustomerID": "ACME01",
      "CustomerName": "Acme Corp (Updated)",
      "Status": "Active"
    }
  ],
  "Deleted": [
    {
      "CustomerID": "ACME01",
      "CustomerName": "Acme Corporation",
      "Status": "Active"
    }
  ],
  "AdditionalInfo": {}
}
```

**Key payload fields:**

- `Query` -- Name of the source definition (GI name or built-in class name)
- `CompanyId` -- Login company name
- `Id` -- Transaction identifier (UUID, generated at DB level). Use for deduplication.
- `TimeStamp` -- Monotonically increasing DB timestamp value (not ISO 8601)
- `Inserted[]` -- New/updated rows with current values. Flat fields (no `{"value": ...}` wrappers)
- `Deleted[]` -- Old values before change (populated on Update and Delete)
- `AdditionalInfo` -- Optional metadata object

**Key differences from entity API responses:**

- No `{"value": ...}` wrappers -- flat field values
- `Deleted` array shows old values; comparing with `Inserted` shows what changed
- Field names match GI column aliases, which may differ from entity field names
- No system `id` (GUID) for the record unless explicitly included in the GI definition
- Delivery: at-least-once (use `Id` field for deduplication)

Source: https://www.acumatica.com/media/2019/05/Push-Notifications.pdf

### Delivery Guarantees

| Feature                   | Support                                     |
| ------------------------- | ------------------------------------------- |
| Retry on failure          | Yes (configurable retry count with backoff) |
| Delivery guarantee        | At-least-once                               |
| Dead letter queue         | No                                          |
| Delivery confirmation API | No                                          |
| Webhook signature/HMAC    | No                                          |
| Order guarantee           | No (best effort)                            |
| Deduplication             | Use `Id` field in payload                   |

### Implications for Numa Integration

Since webhooks cannot be managed via API, Numa cannot automatically set up event subscriptions. Options:

1. **Polling pattern** (recommended) -- periodic GET requests with `LastModifiedDateTime` filter
2. **Customer-configured webhooks** -- customer sets up Push Notifications to call a Numa endpoint
3. **Generic Inquiry polling** -- use GIs with date filters to detect recent changes

---

## Polling Patterns

Since programmatic webhook setup is not available, polling is the primary approach for detecting changes.

### Pattern 1: LastModifiedDateTime Polling

**[DOCUMENTED]** -- Most entities have a `LastModifiedDateTime` field. Use it to fetch only records changed since your last check.

```http
GET /entity/Default/24.200.001/Customer
    ?$top=100
    &$filter=LastModifiedDateTime gt datetimeoffset'2026-03-30T10:00:00Z'
    &$orderby=LastModifiedDateTime asc
Authorization: Bearer {token}
```

**Implementation:**

```python
last_poll = "2026-03-30T10:00:00Z"

response = GET(f"/entity/Default/24.200.001/Customer"
               f"?$top=100"
               f"&$filter=LastModifiedDateTime gt datetimeoffset'{last_poll}'"
               f"&$orderby=LastModifiedDateTime asc")

records = response.json()

if records:
    for record in records:
        process_change(record)
    # Update last_poll to the most recent record's timestamp
    last_poll = records[-1]["LastModifiedDateTime"]["value"]
```

**Polling interval recommendation:** 5-15 minutes for most use cases. More frequent risks hitting concurrency limits.

### Pattern 2: Status-Based Polling

For tracking state transitions (e.g., new invoices that need processing):

```http
GET /entity/Default/24.200.001/SalesInvoice
    ?$top=50
    &$filter=Status eq 'Open' and Date ge datetimeoffset'2026-03-30T00:00:00Z'
    &$orderby=Date desc
Authorization: Bearer {token}
```

---

## Error Response Format

### Standard Error

**[DOCUMENTED]** -- JSON error body with `PX.Data` exception types.

```json
{
  "message": "An error has occurred.",
  "exceptionMessage": "Error: 'CustomerClass' cannot be empty.",
  "exceptionType": "PX.Data.PXException",
  "stackTrace": "..."
}
```

Source: Acumatica community forums and Integration Development Guide

### Nested Exception (with inner error)

```json
{
  "message": "An error has occurred.",
  "exceptionMessage": "Error: 'CustomerClass' cannot be empty.",
  "exceptionType": "PX.Data.PXException",
  "innerException": {
    "message": "Value cannot be null.",
    "exceptionType": "System.ArgumentNullException"
  }
}
```

### Multi-Field Validation Error

**[DOCUMENTED]** -- Uses `PX.Data.PXOuterException` to wrap multiple field errors:

```json
{
  "message": "An error has occurred.",
  "exceptionMessage": "Inserting 'Customer' record raised at least one error. Please review the errors.",
  "exceptionType": "PX.Data.PXOuterException",
  "innerException": {
    "message": "'Customer Class' cannot be empty.\r\n'Currency' cannot be empty.",
    "exceptionType": "PX.Data.PXException"
  }
}
```

**Error response fields:**

| Field            | Type   | Always Present | Description                                             |
| ---------------- | ------ | -------------- | ------------------------------------------------------- |
| message          | string | Yes            | Generic error message                                   |
| exceptionMessage | string | Yes            | Specific error details (most useful for debugging)      |
| exceptionType    | string | Yes            | .NET exception class name (e.g., `PX.Data.PXException`) |
| stackTrace       | string | No             | Server stack trace (may be omitted in production)       |
| innerException   | object | No             | Nested exception with same structure                    |

---

## HTTP Status Code Reference

| Code | Meaning                                                | Retryable | Recovery Action                                    |
| ---- | ------------------------------------------------------ | --------- | -------------------------------------------------- |
| 200  | Success (entity returned)                              | --        | Process response                                   |
| 202  | Accepted (long-running action)                         | --        | Poll Location header URL                           |
| 204  | Success (no content -- actions, deletes, file uploads) | --        | Operation succeeded                                |
| 400  | Bad request / validation error                         | No        | Check `exceptionMessage` for field-level details   |
| 401  | Unauthorized                                           | Yes       | Refresh token, retry once                          |
| 403  | Forbidden                                              | No        | No API license OR insufficient user permissions    |
| 404  | Not found                                              | No        | Wrong entity name, invalid GUID, or record deleted |
| 409  | Conflict                                               | Yes       | Optimistic concurrency -- re-GET, merge, retry     |
| 422  | Business rule violation                                | No        | State violation, credit hold, closed period        |
| 429  | Too many concurrent requests                           | Yes       | Wait 2-5s, retry with exponential backoff          |
| 500  | Internal server error                                  | Yes       | Retry once with backoff                            |

---

## Counter-Exception Reference

These are the most common business-logic errors encountered in practice.

### 1. CustomerClass Cannot Be Empty

```
exceptionMessage: "Error: 'CustomerClass' cannot be empty."
```

**Fix:** Include `"CustomerClass": {"value": "DEFAULT"}` on Customer creation.

### 2. Document Is Already Released

```
exceptionMessage: "Document is already released and cannot be modified."
```

**Fix:** Void the document and create a new one. Released documents are immutable.

### 3. Inventory Quantity Insufficient

```
exceptionMessage: "Inventory quantity of item 'WIDGET01' is insufficient for allocation in warehouse 'MAIN'."
```

**Fix:** Reduce order quantity, allocate from different warehouse, or allow backorder.

### 4. Document Has Applications

```
exceptionMessage: "The document cannot be deleted because it has applications."
```

**Fix:** Reverse payment applications first, then delete (or void instead).

### 5. Currency Rate Not Found

```
exceptionMessage: "Currency rate from 'NZD' to 'USD' for date '03/30/2026' is not found."
```

**Fix:** Set up exchange rates in Currency Management before creating the transaction.

### 6. Tax Zone Is Required

```
exceptionMessage: "Tax zone is required for Customer 'ACME01'."
```

**Fix:** Assign a TaxZone to the Customer entity or specify it on the transaction.

### 7. Numbering Sequence Exhausted

```
exceptionMessage: "Numbering sequence 'SALESORD' has reached maximum number and cannot generate a new ID."
```

**Fix:** Admin must extend the numbering sequence range in Acumatica.

### 8. Record Changed By Another Process

```
exceptionMessage: "Another process has updated the 'SOOrder' record. Your changes will be lost."
```

**Fix:** Re-GET the entity, merge your changes with the latest version, retry PUT.

Source: https://asiablog.acumatica.com/index.php/2018/03/another-process-has-added-updated-deleted/

### 9. Access Rights Violation

```
exceptionMessage: "You are not authorized to perform this action."
```

**Fix:** Check user role configuration in Acumatica.

### 10. API License Not Valid

```
exceptionMessage: "The API license is not valid or has expired."
```

**HTTP Code:** 403. **Fix:** Customer must purchase/renew the API License add-on.

### 11. Credit Hold

```
exceptionMessage: "The document cannot be processed because Customer 'ACME01' is on credit hold."
```

**Fix:** Increase credit limit, apply payments to reduce balance, or release hold manually.

### 12. Period Is Closed

```
exceptionMessage: "The financial period '01-2026' is closed. Transactions cannot be posted to this period."
```

**Fix:** Use a date within an open financial period, or have admin reopen the period.

---

## Error Recovery Playbook

### Strategy 1: Retry with Backoff (429, 500)

```python
import time

def api_call_with_retry(method, url, body=None, max_retries=3):
    for attempt in range(max_retries):
        response = request(method, url, json=body)

        if response.status_code == 429:
            # No documented Retry-After header from Acumatica
            wait = min(2 ** (attempt + 1), 30)  # 2s, 4s, 8s...
            time.sleep(wait)
            continue

        if response.status_code == 500 and attempt < max_retries - 1:
            time.sleep(2 ** attempt)
            continue

        return response

    raise Exception(f"API call failed after {max_retries} retries")
```

### Strategy 2: Token Refresh (401)

```python
def api_call_with_auth(method, url, body=None):
    response = request(method, url, json=body, headers=auth_header())

    if response.status_code == 401:
        refresh_access_token()
        response = request(method, url, json=body, headers=auth_header())

    return response
```

### Strategy 3: Concurrency Conflict Resolution (409 / timestamp error)

```python
def update_with_conflict_resolution(entity_name, entity_id, changes, max_retries=3):
    for attempt in range(max_retries):
        current = GET(f"/entity/Default/24.200.001/{entity_name}/{entity_id}")
        merged = {**changes, "id": entity_id}
        response = PUT(f"/entity/Default/24.200.001/{entity_name}", json=merged)

        if response.status_code in (409, 500):
            error = response.json()
            if "another process" in error.get("exceptionMessage", "").lower():
                continue  # retry with latest version
        return response

    raise Exception("Concurrency conflict could not be resolved")
```

### Strategy 4: Validation Error Parsing

```python
def parse_error(response):
    body = response.json()
    message = body.get("exceptionMessage", body.get("message", "Unknown error"))
    error_type = body.get("exceptionType", "Unknown")

    inner = body.get("innerException", {})
    if inner:
        message = inner.get("message", message)

    return {
        "message": message,
        "type": error_type,
        "status": response.status_code,
        "retryable": response.status_code in (429, 500, 409),
        "auth_error": response.status_code == 401,
        "license_error": response.status_code == 403
    }
```

---

## Rate Limit Management

### Concurrency-Based Throttling

**[DOCUMENTED]** -- MYOB Acumatica uses concurrent request limits, not requests-per-second.

| License  | Max Concurrent | Queue Depth | Queue Timeout | Beyond Queue |
| -------- | -------------- | ----------- | ------------- | ------------ |
| L-series | 6              | 20          | 60 seconds    | 429          |

- No documented rate limit headers (`X-RateLimit-*`, `Retry-After`)
- Rate limiting is per-instance, shared across all API consumers

Source: Acumatica Licensing Guide and https://community.acumatica.com/develop-integrations-with-web-services-apis-289/concurrent-api-requests-23035

### Best Practices

1. **Serialize dependent operations** -- Don't fire 6 PUTs simultaneously when they depend on each other
2. **Use `$select` to reduce response size** -- Faster responses free up concurrency slots sooner
3. **Limit parallel requests to 3-4** -- Leave headroom for other integrations and UI users
4. **Avoid polling too frequently** -- 5-15 minute intervals prevent hitting limits
5. **Monitor for 429 errors** -- If you start seeing them, reduce concurrency

---

## Output Formatting Guide

### Recommended Display Formats for Workspace Agent

| Data Type     | Format            | Example                                                       |
| ------------- | ----------------- | ------------------------------------------------------------- |
| Single record | Key-value summary | "Name: Acme Corp, Status: Active, Balance: $12,500.00"        |
| Record list   | Markdown table    | Table with key columns                                        |
| Dates         | Human-readable    | "March 30, 2026"                                              |
| Currency      | With symbol       | "$1,234.56" or "NZD 1,234.56"                                 |
| Errors        | Clear message     | "Could not create customer: 'CustomerClass' cannot be empty." |

### Truncation Rules

- Lists: Show first 10-20 records, note if more exist
- Long fields: Truncate at 200 characters with "..."
- Nested records: Show 2 levels deep maximum

---

_Generated from the investigation questionnaire, Phases 7-8._

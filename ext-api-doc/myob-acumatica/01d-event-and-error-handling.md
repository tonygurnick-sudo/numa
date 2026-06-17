---
doc: event-and-error-handling
api_version: 24.200.001
companion_of: 01-llm-api-rules.md
webhooks: Push Notifications, UI-configured ONLY (no API management) → use polling
confidence: [DOCUMENTED] unless tagged
---

# MYOB Acumatica — Event & Error Handling

## Event-driven capabilities

| Mechanism                     | Supported | Notes                                            |
| ----------------------------- | --------- | ------------------------------------------------ |
| Webhooks (Push Notifications) | Yes       | UI-only config, NOT API-managed                  |
| WebSocket                     | No        | —                                                |
| Server-Sent Events            | No        | —                                                |
| Long polling                  | No        | use standard polling with `LastModifiedDateTime` |
| Change feeds / streams        | No        | —                                                |

## Webhooks (Push Notifications)

Configured exclusively via the **Push Notifications** screen in the Acumatica UI. No API to create/modify/delete subscriptions. Setup: (1) create/choose a GI or built-in definition capturing the data/events; (2) Push Notifications screen; (3) configure source definition, destination URL, event triggers; (4) test.
Source: acumatica.com/media/2020/07/2020-Virtual-DevCon-Push-Notifications-Webhooks-Final.pdf
Triggers: any entity insert/update/delete captured by a GI or built-in definition; state transitions (status changes); custom business events via GI formulas.

### Payload format

Insert: `{"Query":"SourceDefinitionName","CompanyId":"CompanyLoginName","Id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","TimeStamp":637407844167787833,"Inserted":[{"CustomerID":"ACME01","CustomerName":"Acme Corporation","Status":"Active"}],"Deleted":[],"AdditionalInfo":{}}`
Update (Deleted = old values, Inserted = new values): `{"Query":"CustomerChanges","CompanyId":"MyCompany","Id":"d4e5f6a7-b8c9-0123-4567-890abcdef123","TimeStamp":637407844167800000,"Inserted":[{"CustomerID":"ACME01","CustomerName":"Acme Corp (Updated)","Status":"Active"}],"Deleted":[{"CustomerID":"ACME01","CustomerName":"Acme Corporation","Status":"Active"}],"AdditionalInfo":{}}`
Source: acumatica.com/media/2019/05/Push-Notifications.pdf

Payload fields: `Query` = source-definition name (GI/built-in class); `CompanyId` = login company name; `Id` = transaction UUID (DB-level) — use for deduplication; `TimeStamp` = monotonic DB value (NOT ISO 8601); `Inserted[]` = new/current values; `Deleted[]` = old values (populated on Update + Delete); `AdditionalInfo` = optional metadata.
Differs from entity API responses: NO `{"value":...}` wrappers (flat fields); field names match GI column aliases (may differ from entity field names); no system `id` GUID unless the GI includes it; delivery is at-least-once (dedupe on `Id`).

Delivery guarantees: retry on failure Yes (configurable count + backoff); guarantee at-least-once; dead-letter queue No; delivery-confirmation API No; signature/HMAC No; order guarantee No (best effort); dedup via payload `Id`.

### Numa implication

Numa cannot programmatically set up subscriptions. Options: (1) **polling** (recommended) — periodic GET with `LastModifiedDateTime` filter; (2) customer-configured Push Notifications → Numa endpoint; (3) GI polling with date filters.

## Polling patterns

Pattern 1 — `LastModifiedDateTime` (most entities have it):
`GET /entity/Default/24.200.001/Customer?$top=100&$filter=LastModifiedDateTime gt datetimeoffset'2026-03-30T10:00:00Z'&$orderby=LastModifiedDateTime asc`
Loop: after processing, set `last_poll = records[-1]["LastModifiedDateTime"]["value"]`. Interval 5–15 min (more frequent risks concurrency limits).
Pattern 2 — status-based (e.g. new invoices to process):
`GET /entity/Default/24.200.001/SalesInvoice?$top=50&$filter=Status eq 'Open' and Date ge datetimeoffset'2026-03-30T00:00:00Z'&$orderby=Date desc`

## Error response format

Standard (`PX.Data` exception types): `{"message":"An error has occurred.","exceptionMessage":"Error: 'CustomerClass' cannot be empty.","exceptionType":"PX.Data.PXException","stackTrace":"..."}`
Nested: adds `"innerException":{"message":"Value cannot be null.","exceptionType":"System.ArgumentNullException"}`
Multi-field (wraps several field errors in `PX.Data.PXOuterException`): `{"message":"An error has occurred.","exceptionMessage":"Inserting 'Customer' record raised at least one error. Please review the errors.","exceptionType":"PX.Data.PXOuterException","innerException":{"message":"'Customer Class' cannot be empty.\r\n'Currency' cannot be empty.","exceptionType":"PX.Data.PXException"}}`

Fields: `message` (always; generic) · `exceptionMessage` (always; specific detail — most useful) · `exceptionType` (always; .NET class) · `stackTrace` (optional; omitted in prod) · `innerException` (optional; same structure).

## HTTP status codes

| Code | Meaning                                              | Retryable | Recovery                                                         |
| ---- | ---------------------------------------------------- | --------- | ---------------------------------------------------------------- |
| 200  | Success (entity returned)                            | —         | process response                                                 |
| 202  | Accepted (long-running action)                       | —         | poll `Location` header URL                                       |
| 204  | Success, no content (actions, deletes, file uploads) | —         | succeeded                                                        |
| 400  | Bad request / validation                             | No        | check `exceptionMessage` for field detail                        |
| 401  | Unauthorized                                         | Yes       | refresh token, retry once                                        |
| 403  | Forbidden                                            | No        | NO API license OR insufficient permissions (do NOT refresh-loop) |
| 404  | Not found                                            | No        | wrong entity name, invalid GUID, or deleted record               |
| 409  | Conflict                                             | Yes       | optimistic concurrency — re-GET, merge, retry                    |
| 422  | Business-rule violation                              | No        | state violation, credit hold, closed period                      |
| 429  | Too many concurrent requests                         | Yes       | wait 2–5s, exponential backoff                                   |
| 500  | Internal server error                                | Yes       | retry once with backoff                                          |

## Counter-exceptions (verbatim `exceptionMessage` — match on these)

1. `"Error: 'CustomerClass' cannot be empty."` → include `"CustomerClass":{"value":"DEFAULT"}` on Customer create.
2. `"Document is already released and cannot be modified."` → released docs immutable; void + recreate.
3. `"Inventory quantity of item 'WIDGET01' is insufficient for allocation in warehouse 'MAIN'."` → reduce qty, use another warehouse, or allow backorder.
4. `"The document cannot be deleted because it has applications."` → reverse payment applications first, then delete (or void).
5. `"Currency rate from 'NZD' to 'USD' for date '03/30/2026' is not found."` → set up exchange rates in Currency Management first.
6. `"Tax zone is required for Customer 'ACME01'."` → assign a TaxZone to the Customer or specify on the transaction.
7. `"Numbering sequence 'SALESORD' has reached maximum number and cannot generate a new ID."` → admin extends the numbering sequence range.
8. `"Another process has updated the 'SOOrder' record. Your changes will be lost."` → re-GET, merge, retry PUT (409 concurrency).
9. `"You are not authorized to perform this action."` → check user role config.
10. `"The API license is not valid or has expired."` → HTTP 403; customer must purchase/renew the API License add-on.
11. `"The document cannot be processed because Customer 'ACME01' is on credit hold."` → increase credit limit, apply payments, or release hold (422).
12. `"The financial period '01-2026' is closed. Transactions cannot be posted to this period."` → use a date in an open period, or admin reopens it.
    Source (8): asiablog.acumatica.com/index.php/2018/03/another-process-has-added-updated-deleted/

## Error recovery playbook

Retry with backoff (429, 500): on 429 wait `min(2**(attempt+1), 30)`s (2,4,8…; no documented Retry-After) and continue; on 500 (if attempt < max) wait `2**attempt`s and continue; else return. Max 3 retries.
Token refresh (401): on 401 call `refresh_access_token()` then re-issue the request once.
Concurrency conflict (409 / timestamp error): for each attempt re-GET the entity, merge changes with `id`, PUT; if 409/500 with `"another process"` in `exceptionMessage` → retry with latest version; max 3.
Validation parsing: read `exceptionMessage` (fallback `message`); if `innerException` present, prefer `innerException.message`; flag `retryable = status in {429,500,409}`, `auth_error = status==401`, `license_error = status==403`.

## Rate-limit management

Concurrency-based throttling (NOT requests/sec):
| License | Max concurrent | Queue depth | Queue timeout | Beyond queue |
| --- | --- | --- | --- | --- |
| L-series | 6 | 20 | 60s | 429 |
No documented rate-limit headers (`X-RateLimit-*`, `Retry-After`). Per-instance, shared across all consumers.
Source: Acumatica Licensing Guide; community.acumatica.com/develop-integrations-with-web-services-apis-289/concurrent-api-requests-23035
Best practices: serialize dependent ops (don't fire 6 dependent PUTs at once); use `$select` to shrink responses (frees slots sooner); cap parallelism at 3–4; poll at 5–15 min; on repeated 429 reduce concurrency.

## Output formatting (workspace agent display)

| Data          | Format                       | Example                                                       |
| ------------- | ---------------------------- | ------------------------------------------------------------- |
| Single record | key-value summary            | "Name: Acme Corp, Status: Active, Balance: $12,500.00"        |
| Record list   | Markdown table (key columns) | —                                                             |
| Dates         | human-readable               | "March 30, 2026"                                              |
| Currency      | with symbol                  | "$1,234.56" or "NZD 1,234.56"                                 |
| Errors        | clear message                | "Could not create customer: 'CustomerClass' cannot be empty." |

Truncation: lists → first 10–20 records, note if more; long fields → 200 chars + "..."; nested records → max 2 levels deep.

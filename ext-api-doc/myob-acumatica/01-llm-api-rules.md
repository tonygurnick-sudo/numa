# MYOB Acumatica -- Workspace Agent API Rules

> **This file is loaded into the workspace agent's context when the MYOB Acumatica integration is active.**
> It must stay under 300 lines. Be precise, not verbose.
> Companion files (01a-01d) contain the detailed reference material.

## Context

- **API:** MYOB Acumatica Contract-Based REST API v24.200.001
- **Base URL:** `https://{instance}.myobadvanced.com/entity/Default/24.200.001/{Entity}`
- **Auth:** OAuth 2.0 per-instance, Bearer token
- **Integration path:** Data Connector (OAuth2) + Direct API
- **Rate limits:** 6 concurrent requests per instance (L-series) [DOCUMENTED]; queue depth/timeout values commonly cited as 20/60s but only sourced from a single community-forum post [INFERRED]

## Auth Structure

OAuth 2.0 Authorization Code flow. Per-instance endpoints (no central gateway).

```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Token lifecycle:**

- Access token: ~1 hour (instance-configurable), returned as `expires_in` in seconds
- Refresh token: 30 days default (configurable from 2023 R2). Rotates on each use.

**`client_id` format (critical):** The `client_id` includes a `@CompanyId` suffix, e.g. `{GUID}@Company`. Without the suffix the OAuth server cannot resolve the tenant and the token request fails. [VERIFIED 2026-05-19]

## Capabilities

### CAN

1. CRUD on 200+ business entities (Customer, Vendor, SalesOrder, SalesInvoice, Bill, PurchaseOrder, StockItem, Lead, Opportunity, Project, Employee, JournalTransaction)
2. Query with OData filters, sort, pagination, field selection, and related entity expansion
3. Execute business actions (release invoices, confirm orders, convert leads)
4. Attach/download files on entities
5. Access Generic Inquiries for custom reporting data

### CANNOT

1. Create/modify/delete webhook subscriptions via API (UI-only Push Notifications)
2. Perform bulk/batch operations in a single request (no $batch)
3. Edit released financial documents (must void and recreate)
4. Get a total record count from list queries

## Critical Rules (Violations = Broken Requests)

1. **Every field is wrapped in `{"value": "..."}`**
   - CORRECT: `{"CustomerName": {"value": "Acme"}}`
   - WRONG: `{"CustomerName": "Acme"}`
   - Nested objects follow same pattern: `{"MainContact": {"Email": {"value": "a@b.com"}}}`

2. **PUT = create AND update (upsert)**
   - PUT without `id` / without matching key fields = create new record
   - PUT with `id` or matching key fields = update existing record
   - There is NO POST for creation. There is NO PATCH.

3. **Filters use bare field names + single quotes**
   - CORRECT: `$filter=Status eq 'Active'`
   - WRONG: `$filter=Status.value eq 'Active'`
   - WRONG: `$filter=Status eq "Active"`

4. **Always specify `$top` on list queries**
   - Without `$top`, the API returns ALL records (can be thousands)
   - Recommended: `$top=100` for listing, `$top=200` max per page

5. **Totals and balances are computed (read-only)**
   - `OrderTotal`, `Amount`, `Balance`, `LineTotal` are calculated from line items
   - Sending these fields in PUT is ignored or causes errors

6. **Released documents are immutable**
   - Cannot edit a released SalesInvoice, Bill, or JournalTransaction
   - Must void the document and create a new one

7. **Line item updates replace the entire array**
   - When updating an entity's `Details`, send ALL line items
   - Existing lines: include their `id` to preserve them
   - New lines: omit `id`
   - Any existing line NOT in the array is deleted

8. **Actions may return 202 or 204 -- both are success**
   - 204 No Content = action completed immediately
   - 202 Accepted = long-running operation. Poll the `Location` header URL.

## HTTP Methods

| Method | Purpose                | Example                                                                          |
| ------ | ---------------------- | -------------------------------------------------------------------------------- |
| GET    | List/read              | `GET /entity/Default/24.200.001/Customer?$top=20`                                |
| PUT    | Create or update       | `PUT /entity/Default/24.200.001/Customer`                                        |
| DELETE | Delete by GUID or keys | `DELETE /entity/Default/24.200.001/Customer/{guid}`                              |
| POST   | Execute action         | `POST /entity/Default/24.200.001/SalesInvoice/{guid}/action/ReleaseSalesInvoice` |
| PUT    | Attach file            | `PUT /entity/Default/24.200.001/SalesOrder/SO/000042/files/{filename}`           |

## OData Query Parameters

| Parameter  | Example                           | Notes                              |
| ---------- | --------------------------------- | ---------------------------------- |
| `$top`     | `$top=100`                        | Always include. Max practical: 200 |
| `$skip`    | `$skip=100`                       | For pagination                     |
| `$filter`  | `$filter=Status eq 'Active'`      | Bare field names, single quotes    |
| `$select`  | `$select=CustomerID,CustomerName` | Reduces payload                    |
| `$orderby` | `$orderby=CustomerName asc`       | asc/desc                           |
| `$expand`  | `$expand=Details`                 | Include line items / sub-entities  |

## Working Examples

### Example 1: List active customers

```http
GET /entity/Default/24.200.001/Customer?$top=20&$filter=Status eq 'Active'&$select=CustomerID,CustomerName,Status,Balance&$orderby=CustomerName asc
Authorization: Bearer {token}
```

### Example 2: Create a customer

```http
PUT /entity/Default/24.200.001/Customer
Authorization: Bearer {token}
Content-Type: application/json

{
    "CustomerID": {"value": "ACME01"},
    "CustomerName": {"value": "Acme Corporation"},
    "CustomerClass": {"value": "DEFAULT"},
    "Status": {"value": "Active"},
    "MainContact": {
        "Email": {"value": "billing@acme.com"}
    }
}
```

### Example 3: Create a sales order with line items

```http
PUT /entity/Default/24.200.001/SalesOrder
Authorization: Bearer {token}
Content-Type: application/json

{
    "OrderType": {"value": "SO"},
    "CustomerID": {"value": "ACME01"},
    "Description": {"value": "Q1 2026 Order"},
    "Details": [
        {
            "InventoryID": {"value": "WIDGET01"},
            "Quantity": {"value": 10},
            "UnitPrice": {"value": 25.00}
        }
    ]
}
```

### Example 4: Release an invoice (action)

```http
POST /entity/Default/24.200.001/SalesInvoice/{guid}/action/ReleaseSalesInvoice
Authorization: Bearer {token}
Content-Type: application/json

{"entity": {"id": "{guid}"}}
```

Response: `204 No Content` (immediate success) or `202 Accepted` (poll Location header).

### Example 5: Paginated listing with filter

```http
GET /entity/Default/24.200.001/StockItem?$top=100&$skip=0&$filter=ItemStatus eq 'Active'&$orderby=InventoryID asc
Authorization: Bearer {token}
```

Stop when `results.length < 100`.

## Proxy Table (Numa Workspace Agent)

| User Intent        | Method | Endpoint                                        | Key Parameters                                        |
| ------------------ | ------ | ----------------------------------------------- | ----------------------------------------------------- |
| List customers     | GET    | `/Customer`                                     | `$top`, `$filter`, `$select`                          |
| Get customer       | GET    | `/Customer/{id}`                                | --                                                    |
| Create customer    | PUT    | `/Customer`                                     | Body (no `id`)                                        |
| Update customer    | PUT    | `/Customer`                                     | Body (with `id`)                                      |
| Delete customer    | DELETE | `/Customer/{id}`                                | --                                                    |
| List sales orders  | GET    | `/SalesOrder`                                   | `$top`, `$filter`, `$expand=Details`                  |
| Create sales order | PUT    | `/SalesOrder`                                   | Body with `Details[]`                                 |
| Release invoice    | POST   | `/SalesInvoice/{id}/action/ReleaseSalesInvoice` | Action body                                           |
| List stock items   | GET    | `/StockItem`                                    | `$top`, `$filter`                                     |
| Create bill        | PUT    | `/Bill`                                         | Body with `Details[]`                                 |
| List vendors       | GET    | `/Vendor`                                       | `$top`, `$filter`                                     |
| Attach file        | PUT    | `/{Entity}/{keys}/files/{filename}`             | Binary body, `Content-Type: application/octet-stream` |

All endpoint paths are relative to `/entity/Default/24.200.001`.

## Pagination

- **Type:** Offset-based ($top + $skip)
- **Default page size:** None (returns ALL if $top omitted)
- **Recommended page size:** 100
- **How to paginate:** `$top=100&$skip=0`, then `$skip=100`, etc.
- **Last page detection:** `results.length < $top`
- **Total count:** Not available. No @odata.count in contract-based API.
- **Always include `$orderby`** when paginating for deterministic order.

## Webhooks / Events

No API-managed webhooks. Push Notifications are UI-configured only.
Use polling with `LastModifiedDateTime` filter for change detection:

```
$filter=LastModifiedDateTime gt datetimeoffset'2026-03-30T10:00:00Z'
```

Recommended interval: 5-15 minutes.

## Error Handling

**Standard error format:**

```json
{
  "message": "An error has occurred.",
  "exceptionMessage": "Error: 'CustomerClass' cannot be empty.",
  "exceptionType": "PX.Data.PXException"
}
```

**Recovery by status:**

| Status | Meaning          | Action                                      |
| ------ | ---------------- | ------------------------------------------- |
| 400    | Validation error | Check `exceptionMessage` for field details  |
| 401    | Unauthorized     | Refresh token and retry                     |
| 403    | Forbidden        | No API license or insufficient permissions  |
| 404    | Not found        | Verify entity name and record ID            |
| 409    | Conflict         | Re-GET record, merge changes, retry PUT     |
| 422    | Business rule    | State violation, credit hold, closed period |
| 429    | Rate limit       | Wait 2-5s, retry with exponential backoff   |
| 500    | Server error     | Retry once with backoff                     |

## Do NOT

- Use POST to create records (use PUT)
- Use PATCH to update records (use PUT)
- Send `{"CustomerName": "Acme"}` without the value wrapper
- Send `$filter=Status.value eq 'Active'` (use bare `Status`)
- Use double quotes in filters (use single quotes)
- Omit `$top` on list requests
- Send partial line item arrays on update (send ALL lines)
- Try to edit released documents (void and recreate)
- Assume actions always return 204 (may return 202 for long-running)
- Forget the API License requirement (403 without it)

---

_Companion files for detailed reference:_

- _01a-domain-model-reference.md -- Entity catalog, relationships, state machines_
- _01b-query-patterns.md -- Filtering, search, pagination examples_
- _01c-mutation-patterns.md -- Create, update, delete patterns_
- _01d-event-and-error-handling.md -- Events, webhooks, error recovery_

# MYOB Acumatica -- API Specification & Investigation

> **API Version:** 24.200.001 | **Base URL:** `https://{instance}.myobadvanced.com`
> **Researched:** 2026-03-30

---

## Overview

- **Vendor:** MYOB (Acumatica-based ERP, ANZ market)
- **API version:** 24.200.001 (2024 R2)
- **Base URL:** `https://{instance}.myobadvanced.com/entity/Default/24.200.001/{Entity}`
- **API type:** Contract-Based REST API with OData query syntax
- **Data format:** JSON
- **Documentation:** https://enterprise-support.myob.com/acudev/api-documentation
- **Help docs:** https://help.acumatica.com (upstream Acumatica)
- **OpenAPI spec:** Per-instance at `/entity/Default/24.200.001/swagger.json?company={CompanyName}` (requires auth)
- **C# SDK:** https://github.com/Acumatica/AcumaticaRESTAPIClientForCSharp

**Summary:** MYOB Acumatica is a cloud ERP system exposing 200+ business entities via a contract-based REST API. Used by mid-market businesses in Australia and New Zealand for financials, sales, purchasing, inventory, CRM, and project management.

---

## Authentication

### Method: OAuth 2.0 Authorization Code

**[DOCUMENTED]** -- Per-instance OAuth. Each Acumatica instance has its own identity server.

| Parameter              | Value                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| Grant type             | authorization_code (+ refresh_token)                             |
| Authorization URL      | `https://{instance}.myobadvanced.com/identity/connect/authorize` |
| Token URL              | `https://{instance}.myobadvanced.com/identity/connect/token`     |
| OIDC Discovery         | `https://{instance}.myobadvanced.com/identity/`                  |
| Access token lifetime  | ~3600 seconds (instance-configurable)                            |
| Refresh token lifetime | 30 days (configurable from 2023 R2 via SM303010)                 |
| Refresh behavior       | Rotate on use (old token invalidated)                            |
| PKCE required          | No (recommended but not enforced)                                |

**Required scopes:**

| Scope            | Purpose                                 | Required |
| ---------------- | --------------------------------------- | -------- |
| `api`            | Access to REST API endpoints            | Yes      |
| `offline_access` | Receive refresh token with access token | Yes      |

**Header format:**

```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Token exchange:**

> ⚠️ `client_id` must include the `@CompanyId` suffix, e.g. `392B04F6-6CA4-43FA-48D9-45A6E6DF5579@Company`. Without it the OAuth server cannot resolve the tenant. [VERIFIED 2026-05-19 — `fast-programmer/myob_acumatica` README + Keboola helper]

```http
POST https://{instance}.myobadvanced.com/identity/connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={authorization_code}
&redirect_uri={redirect_uri}
&client_id={GUID}@{CompanyId}
&client_secret={client_secret}
```

**Token response:**

```json
{
  "access_token": "eyJ0eXAiOiJKV1Qi...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "abc123def456..."
}
```

**Token refresh:**

```http
POST https://{instance}.myobadvanced.com/identity/connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token={refresh_token}
&client_id={GUID}@{CompanyId}
&client_secret={client_secret}
```

Sources:

- https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=ff780860-09c2-46c9-bdd7-c6c3b1fc442c
- https://satvasolutions.com/blog/oauth-2-0-authentication-in-myob-acumatica
- https://help.acumatica.com/Help?ScreenId=ShowWiki&pageid=a8f71c44-9f5c-4af8-9d47-bc815c8a58e7

---

## Endpoint Catalog

### Entity API -- `/entity/Default/24.200.001/`

| Method | Path                                       | Purpose                                          | Returns                        |
| ------ | ------------------------------------------ | ------------------------------------------------ | ------------------------------ |
| GET    | `/{Entity}`                                | List records (with OData query params)           | JSON array of entities         |
| GET    | `/{Entity}/{id}`                           | Get by GUID                                      | Single entity object           |
| GET    | `/{Entity}/{key1}/{key2}`                  | Get by business key values                       | Single entity object           |
| PUT    | `/{Entity}`                                | Create (no key match) or update (key match/`id`) | Created/updated entity         |
| DELETE | `/{Entity}/{id}`                           | Delete by GUID                                   | 204 No Content                 |
| DELETE | `/{Entity}/{key1}/{key2}`                  | Delete by key values                             | 204 No Content                 |
| POST   | `/{Entity}/{id}/action/{ActionName}`       | Execute business action                          | 202 Accepted or 204 No Content |
| PUT    | `/{Entity}/{key1}/{key2}/files/{filename}` | Attach file (binary body)                        | 204 No Content                 |
| GET    | `/{Entity}/{key1}/{key2}/files/{filename}` | Download file                                    | Binary data                    |

### Generic Inquiry (OData)

| Method | Path                             | Purpose               | Returns                    |
| ------ | -------------------------------- | --------------------- | -------------------------- |
| GET    | `/odata/{Company}/{GI_ScreenID}` | Query generic inquiry | JSON array of flat objects |

### OAuth API -- `/identity/connect/`

| Method | Path         | Purpose                       | Returns            |
| ------ | ------------ | ----------------------------- | ------------------ |
| GET    | `/authorize` | Authorization code request    | Redirect with code |
| POST   | `/token`     | Exchange code / refresh token | Token response     |

---

## Entity Endpoints -- Detailed Reference

### Customer

**List:**

```http
GET /entity/Default/24.200.001/Customer?$top=50&$filter=Status eq 'Active'&$select=CustomerID,CustomerName,Status,Balance,MainContact&$orderby=CustomerName asc
Authorization: Bearer {token}
```

**Response:**

```json
[
  {
    "id": "f7a8b9c0-d1e2-3456-7890-abcdef123456",
    "rowNumber": 1,
    "note": null,
    "CustomerID": { "value": "ACME01" },
    "CustomerName": { "value": "Acme Corporation" },
    "Status": { "value": "Active" },
    "Balance": { "value": 12500.0 },
    "MainContact": {
      "id": "11223344-5566-7788-99aa-bbccddeeff00",
      "rowNumber": 1,
      "Email": { "value": "billing@acme.com" },
      "Phone1": { "value": "+64 9 555 0100" }
    }
  }
]
```

**Create:**

```http
PUT /entity/Default/24.200.001/Customer
Content-Type: application/json
Authorization: Bearer {token}

{
    "CustomerID": {"value": "NEWCUST01"},
    "CustomerName": {"value": "New Customer Ltd"},
    "CustomerClass": {"value": "DEFAULT"},
    "Status": {"value": "Active"}
}
```

Response: `200 OK` with full entity including generated `id`.

**Update:**

```http
PUT /entity/Default/24.200.001/Customer
Content-Type: application/json
Authorization: Bearer {token}

{
    "id": "f7a8b9c0-d1e2-3456-7890-abcdef123456",
    "CustomerName": {"value": "Acme Corp (New Name)"}
}
```

**Delete:**

```http
DELETE /entity/Default/24.200.001/Customer/f7a8b9c0-d1e2-3456-7890-abcdef123456
Authorization: Bearer {token}
```

Response: `204 No Content`

---

### SalesOrder

**List with line items:**

```http
GET /entity/Default/24.200.001/SalesOrder?$top=20&$filter=Status eq 'Open' and CustomerID eq 'ACME01'&$expand=Details&$orderby=Date desc
Authorization: Bearer {token}
```

**Response:**

```json
[
  {
    "id": "e5f6a7b8-...",
    "rowNumber": 1,
    "note": null,
    "OrderType": { "value": "SO" },
    "OrderNbr": { "value": "000042" },
    "CustomerID": { "value": "ACME01" },
    "Date": { "value": "2026-03-28T00:00:00+00:00" },
    "Status": { "value": "Open" },
    "OrderTotal": { "value": 500.0 },
    "Details": [
      {
        "id": "line-1-guid",
        "rowNumber": 1,
        "InventoryID": { "value": "WIDGET01" },
        "Quantity": { "value": 10.0 },
        "UnitPrice": { "value": 25.0 },
        "Amount": { "value": 250.0 }
      }
    ]
  }
]
```

**Create:**

```http
PUT /entity/Default/24.200.001/SalesOrder
Content-Type: application/json
Authorization: Bearer {token}

{
    "OrderType": {"value": "SO"},
    "CustomerID": {"value": "ACME01"},
    "Description": {"value": "New order"},
    "Details": [
        {
            "InventoryID": {"value": "WIDGET01"},
            "Quantity": {"value": 10},
            "UnitPrice": {"value": 25.00}
        }
    ]
}
```

**Confirm (action):**

```http
POST /entity/Default/24.200.001/SalesOrder/{guid}/action/ConfirmSalesOrder
Content-Type: application/json
Authorization: Bearer {token}

{"entity": {"id": "{guid}"}}
```

Response: `204 No Content` or `202 Accepted` (poll Location header).

---

### SalesInvoice

**List:**

```http
GET /entity/Default/24.200.001/SalesInvoice?$top=50&$filter=Status eq 'Open'&$select=ReferenceNbr,Type,CustomerID,Date,DueDate,Amount,Balance,Status&$orderby=Date desc
Authorization: Bearer {token}
```

**Response:**

```json
[
  {
    "id": "inv-guid-1",
    "rowNumber": 1,
    "note": null,
    "Type": { "value": "INV" },
    "ReferenceNbr": { "value": "AR007890" },
    "CustomerID": { "value": "ACME01" },
    "Date": { "value": "2026-03-15T00:00:00+00:00" },
    "DueDate": { "value": "2026-04-14T00:00:00+00:00" },
    "Status": { "value": "Open" },
    "Amount": { "value": 1250.0 },
    "Balance": { "value": 1250.0 }
  }
]
```

**Release (action):**

```http
POST /entity/Default/24.200.001/SalesInvoice/{guid}/action/ReleaseSalesInvoice
Content-Type: application/json
Authorization: Bearer {token}

{"entity": {"id": "{guid}"}}
```

---

### Bill

**List:**

```http
GET /entity/Default/24.200.001/Bill?$top=50&$filter=Status eq 'Open' and VendorID eq 'SUPPLY01'&$select=ReferenceNbr,Type,VendorID,Date,DueDate,Amount,Balance,Status&$orderby=DueDate asc
Authorization: Bearer {token}
```

**Create:**

```http
PUT /entity/Default/24.200.001/Bill
Content-Type: application/json
Authorization: Bearer {token}

{
    "Type": {"value": "BL"},
    "VendorID": {"value": "SUPPLY01"},
    "VendorRef": {"value": "VENDOR-INV-123"},
    "Description": {"value": "Office supplies"},
    "Details": [
        {
            "InventoryID": {"value": "PAPER"},
            "Quantity": {"value": 100},
            "UnitPrice": {"value": 5.00}
        }
    ]
}
```

---

### StockItem

**List:**

```http
GET /entity/Default/24.200.001/StockItem?$top=100&$filter=ItemStatus eq 'Active'&$select=InventoryID,Description,DefaultPrice,CurrentStockQty,ItemStatus&$orderby=InventoryID asc
Authorization: Bearer {token}
```

**Response:**

```json
[
  {
    "id": "item-guid-1",
    "rowNumber": 1,
    "note": null,
    "InventoryID": { "value": "WIDGET01" },
    "Description": { "value": "Standard Widget" },
    "DefaultPrice": { "value": 25.0 },
    "CurrentStockQty": { "value": 1250.0 },
    "ItemStatus": { "value": "Active" }
  }
]
```

---

### JournalTransaction

**Create balanced journal entry:**

```http
PUT /entity/Default/24.200.001/JournalTransaction
Content-Type: application/json
Authorization: Bearer {token}

{
    "Module": {"value": "GL"},
    "TransactionDate": {"value": "2026-03-30"},
    "Description": {"value": "Adjusting entry"},
    "Details": [
        {
            "AccountID": {"value": "52000"},
            "DebitAmount": {"value": 1000.00},
            "CreditAmount": {"value": 0},
            "Description": {"value": "Debit - expense"}
        },
        {
            "AccountID": {"value": "21000"},
            "DebitAmount": {"value": 0},
            "CreditAmount": {"value": 1000.00},
            "Description": {"value": "Credit - liability"}
        }
    ]
}
```

---

### Lead / Opportunity

**Create lead:**

```http
PUT /entity/Default/24.200.001/Lead
Content-Type: application/json
Authorization: Bearer {token}

{
    "FirstName": {"value": "John"},
    "LastName": {"value": "Doe"},
    "CompanyName": {"value": "Potential Client Inc"},
    "Email": {"value": "john@potentialclient.com"},
    "Source": {"value": "Referral"}
}
```

**Convert lead to opportunity:**

```http
POST /entity/Default/24.200.001/Lead/{guid}/action/ConvertLeadToOpportunity
Content-Type: application/json
Authorization: Bearer {token}

{"entity": {"id": "{guid}"}}
```

---

## File Attachment Endpoints

**Attach file:**

```http
PUT /entity/Default/24.200.001/SalesOrder/SO/000042/files/quote.pdf
Content-Type: application/octet-stream
Authorization: Bearer {token}

{binary file data}
```

Response: `204 No Content`

**Download file:**

```http
GET /entity/Default/24.200.001/SalesOrder/SO/000042/files/quote.pdf
Authorization: Bearer {token}
```

**List files:**

```http
GET /entity/Default/24.200.001/SalesOrder/SO/000042?$expand=files
Authorization: Bearer {token}
```

---

## Pagination

- **Type:** Offset-based ($top + $skip)
- **Default page size:** None (returns ALL if $top omitted)
- **Max page size:** No enforced limit, practical max ~500
- **Total count:** Not available in contract-based API

**Parameters:**

| Parameter | Type    | Default | Description           |
| --------- | ------- | ------- | --------------------- |
| $top      | integer | none    | Max records to return |
| $skip     | integer | 0       | Records to skip       |

**Last page detection:** `results.length < $top`

---

## Rate Limits

| Scope                   | Limit        | Window             |
| ----------------------- | ------------ | ------------------ |
| Per-instance concurrent | 6 (L-series) | Concurrent         |
| Request queue           | 20           | Queue timeout: 60s |

**When exceeded:** HTTP 429. No documented `Retry-After` header.

**Recommended strategy:** Limit parallel requests to 3-4, exponential backoff on 429.

---

## Error Handling

**Standard error format:**

```json
{
  "message": "An error has occurred.",
  "exceptionMessage": "Error: 'CustomerClass' cannot be empty.",
  "exceptionType": "PX.Data.PXException"
}
```

**Status codes:**

| Status | Meaning          | Retryable | Recovery                         |
| ------ | ---------------- | --------- | -------------------------------- |
| 400    | Validation error | No        | Fix request per exceptionMessage |
| 401    | Unauthorized     | Yes       | Refresh token                    |
| 403    | Forbidden        | No        | Check API license / permissions  |
| 404    | Not found        | No        | Verify entity name and ID        |
| 409    | Conflict         | Yes       | Re-GET, merge, retry             |
| 422    | Business rule    | No        | Check state / constraints        |
| 429    | Rate limited     | Yes       | Backoff + retry                  |
| 500    | Server error     | Yes       | Retry once                       |

---

## Webhooks / Events

**Push Notifications** -- UI-configured only (not API-managed).

**Payload fields:** `Query`, `CompanyId`, `Id`, `TimeStamp`, `Inserted[]`, `Deleted[]`, `AdditionalInfo`

**Delivery:** At-least-once. Use `Id` for deduplication.

**No API webhook management.** Use polling with `LastModifiedDateTime` filter for automated change detection.

---

## Known Limitations

1. No batch/bulk endpoint -- individual PUT calls only
2. No total record count in list responses
3. Webhooks (Push Notifications) are UI-only -- no API management
4. Swagger spec requires authenticated instance access (cannot be downloaded publicly)
5. Released financial documents are immutable (must void and recreate)
6. Line item arrays are fully replaced on update (no partial array updates)
7. API License add-on required (separate purchase from MYOB)
8. No `Retry-After` header documented for 429 responses

---

## SDKs & Tooling

| SDK                     | Language | Repository                                                   | Quality | Notes                              |
| ----------------------- | -------- | ------------------------------------------------------------ | ------- | ---------------------------------- |
| Acumatica.RESTClient    | C#       | https://github.com/Acumatica/AcumaticaRESTAPIClientForCSharp | Good    | Official, NuGet packages           |
| Acumatica Java REST API | Java     | https://github.com/Acumatica/Java-based-REST-API             | Fair    | Community contributed              |
| EndpointModelGenerator  | C#       | Same repo as RESTClient                                      | Good    | Generates models from swagger.json |

**Postman collection:** Not publicly available
**OpenAPI spec:** Per-instance at `/entity/Default/{version}/swagger.json?company={Company}`

---

## Integration Path Assessment

**Recommended path:** Data Connector (OAuth2) + Direct API (Hybrid)

**Justification:** Acumatica exposes browsable entity data (customers, orders, invoices) suitable for a data connector, plus action-oriented capabilities (release, confirm, convert) that benefit from direct API access via workspace agent.

**Connector compatibility:**

| Connector Method  | API Endpoint                            | Feasibility                    |
| ----------------- | --------------------------------------- | ------------------------------ |
| list_files        | `GET /{Entity}?$top=...`                | Good -- maps to entity listing |
| download_file     | `GET /{Entity}/{keys}/files/{filename}` | Good -- binary download        |
| search_files      | `GET /{Entity}?$filter=contains(...)`   | Good -- OData filter           |
| get_file_metadata | `GET /{Entity}/{id}`                    | Good -- single record GET      |

---

_Researched on 2026-03-30. Sources: Official Acumatica help docs, MYOB Enterprise Support, Integration Development Guide PDFs, Acumatica community forums, GitHub SDK, DevCon presentations._

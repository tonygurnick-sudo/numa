# MYOB Acumatica API -- Full Investigation

> **Status:** Research complete
> **API Version:** 24.200.001 (Contract-Based REST API)
> **Last verified:** 2026-03-30
> **Sources:** Official Acumatica help docs, MYOB Enterprise Support portal, Acumatica Integration Development Guide (2020 R2 PDF), Acumatica community forums, Concentrus guide, Satva Solutions OAuth guide, Acumatica DevCon Push Notifications presentation (2020), Acumatica C# REST API Client (GitHub)

---

## Phase 1: Information Sources

### 1.1 Primary Documentation

- **Official MYOB Acumatica developer portal:** https://enterprise-support.myob.com/acudev/
- **API documentation hub:** https://enterprise-support.myob.com/acudev/api-documentation
- **Contract-based REST API overview:** https://enterprise-support.myob.com/adv/contract-based-rest-api
- **Upstream Acumatica help (all versions):** https://help.acumatica.com
- **Contract-based REST API main concepts:** https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=735fad82-9cf3-4a2c-8538-1c8344aba844
- **Integration Development Guide PDF (2020 R2):** https://www.acumatica.com/media/2020/09/AcumaticaERP_IntegrationDevelopmentGuide.pdf
- **Integration Development Guide PDF (2019 R2):** https://www.acumatica.com/media/2020/02/AcumaticaERP_IntegrationDevelopmentGuide.pdf

### 1.2 Supplementary Sources

- **OpenAPI/Swagger spec:** Per-instance at `https://{instance}/entity/Default/24.200.001/swagger.json?company={CompanyName}` (requires authenticated session)
- **C# REST API Client SDK (GitHub):** https://github.com/Acumatica/AcumaticaRESTAPIClientForCSharp
- **NuGet packages:** `Acumatica.RESTClient`, `Acumatica.Default_24.200.001`
- **Concentrus API guide:** https://concentrus.com/acumatica-rest-api-documentation/
- **Satva Solutions OAuth guide:** https://satvasolutions.com/blog/oauth-2-0-authentication-in-myob-acumatica
- **LeverageCloudTech API overview:** https://www.leveragecloudtech.com.au/api/
- **Acumatica Community Forums:** https://community.acumatica.com/develop-integrations-with-web-services-apis-289
- **Push Notifications DevCon Presentation:** https://www.acumatica.com/media/2020/07/2020-Virtual-DevCon-Push-Notifications-Webhooks-Final.pdf
- **Acumatica Developer Blog (Asia):** https://asiablog.acumatica.com
- **OpenUni training courses:** I310 Data Retrieval, I320/I330 Data Manipulation (PDFs)

### 1.3 Documentation Quality Assessment

| Area                      | Rating | Notes                                                                      |
| ------------------------- | ------ | -------------------------------------------------------------------------- |
| Authentication            | 4/5    | Well documented. OAuth flows clear in help docs and Satva guide.           |
| Endpoint reference        | 3/5    | Help docs cover patterns but no complete catalog. Swagger is per-instance. |
| Request/response examples | 4/5    | Integration Development Guide has worked examples. Community has many.     |
| Error documentation       | 3/5    | Exception types documented, but no formal error code catalog.              |
| Rate limit documentation  | 2/5    | Concurrency limit mentioned in licensing guide. No header docs.            |
| Pagination documentation  | 3/5    | $top/$skip documented. No total count confirmed absent in community.       |
| Webhook documentation     | 3/5    | DevCon presentation is detailed. Help docs exist but sparse.               |
| SDKs / code examples      | 4/5    | C# SDK on GitHub. NuGet packages. Java SDK exists.                         |
| Changelog / versioning    | 3/5    | Version embedded in URL. Release notes available per version.              |

**Overall documentation quality:** Good -- well-structured help docs and integration guide PDFs, supplemented by a strong community forum. Per-instance swagger spec is a significant asset. Weakest area is rate limiting specifics.

### 1.4 Discovery Status

- [x] Found official API documentation (MYOB Enterprise Support + upstream Acumatica help)
- [x] Confirmed swagger spec is per-instance (requires auth to download)
- [x] Identified authentication method (OAuth 2.0 Authorization Code)
- [x] Found multiple working examples (Integration Guide, community, Concentrus)
- [x] Identified rate limit information (concurrency-based, L-series = 6)
- [x] Identified pagination approach ($top + $skip, no total count)
- [x] Checked webhook support (Push Notifications, UI-only setup)
- [x] Checked for official SDKs (C# on GitHub/NuGet, Java on GitHub)

---

## Phase 2: Authentication & Authorization

### Q1: What authentication method does the API use?

**[DOCUMENTED]** -- OAuth 2.0 Authorization Code flow, per official Acumatica help and MYOB Enterprise Support.

- Authorization endpoint: `https://{instance}.myobadvanced.com/identity/connect/authorize`
- Token endpoint: `https://{instance}.myobadvanced.com/identity/connect/token`
- OpenID Connect discovery: `https://{instance}.myobadvanced.com/identity/` (if client supports OIDC Discovery)
- Scopes: `api offline_access`
- Token type: Bearer
- All endpoints are per-instance (no central MYOB gateway for Acumatica)

Source: https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=ff780860-09c2-46c9-bdd7-c6c3b1fc442c and https://satvasolutions.com/blog/oauth-2-0-authentication-in-myob-acumatica

### Q2: How are API credentials obtained?

**[DOCUMENTED]** -- Registered as a Connected Application within each Acumatica instance.

1. Navigate to Connected Applications screen (SM303010) in the Acumatica instance
2. Create new application with flow type "Authorization Code"
3. Provide redirect URI
4. Receive `client_id` and `client_secret`
5. Must also have an Acumatica API License (separate purchase) -- without it, all API calls return 403

> **⚠️ `client_id` format gotcha (verified 2026-05-19):** The `client_id` issued by MYOB Acumatica is **not** a bare GUID — it includes a `@CompanyId` suffix, e.g. `392B04F6-6CA4-43FA-48D9-45A6E6DF5579@Company`. Without the suffix the OAuth server cannot resolve which tenant the credential belongs to and the token request fails. Confirmed by: `fast-programmer/myob_acumatica` Ruby gem README (`MYOB_ACUMATICA_CLIENT_ID=xxxxxxxx-...-xxxxxxxxxxxx@Company`) and Keboola's `keboola/component-acumatica/scripts/oauth_helper.sh` line 15 (`Enter Client ID (e.g., 392B...@Company)`).

Source: https://help.acumatica.com/Help?ScreenId=ShowWiki&pageid=a8f71c44-9f5c-4af8-9d47-bc815c8a58e7

### Q3: Are there different permission levels?

**[DOCUMENTED]** -- API calls inherit the permissions of the authenticated Acumatica user.

- Row-level security based on business account restrictions
- Entity-level visibility based on role configuration
- Screen-level access maps to API endpoint availability
- No separate API-specific permission model beyond user roles

### Q4: Does authentication differ between environments?

**[DOCUMENTED]** -- Each Acumatica instance is fully self-contained.

- Each instance has its own OAuth registration, token endpoints, and user database
- No shared identity provider across instances
- Sandbox instances have same auth flow with different base URL

### Q5: What is the token lifecycle?

**[DOCUMENTED]** -- Configurable per instance. Defaults:

| Token              | Default Lifetime      | Notes                                                                |
| ------------------ | --------------------- | -------------------------------------------------------------------- |
| Access token       | 3600 seconds (1 hour) | Returned as `expires_in` in token response                           |
| Refresh token      | 30 days absolute      | Configurable from 2023 R2 via SM303010 (Absolute, Infinite, Sliding) |
| Authorization code | ~60 seconds           | Single-use                                                           |

- Refresh tokens rotate on each use (old token invalidated)
- If refresh token expires, user must re-authorize
- Pre-2023 R2 versions had fixed 30-day absolute refresh token lifetime with no configuration
- Token endpoint returns standard OAuth fields: `access_token`, `token_type`, `expires_in`, `refresh_token`

Source: https://community.acumatica.com/develop-integrations-with-web-services-apis-289/is-there-an-access-token-lifetime-in-versions-2023-r1-and-older-20342 and https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=92bf610c-f18c-446c-8e62-5fb928ef2def

---

## Phase 3: Base URL & Versioning

### Q6: What is the base URL structure?

**[DOCUMENTED]** -- `https://{instance}.myobadvanced.com/entity/Default/{version}/{EntityName}`

- `{instance}` = customer's Acumatica instance subdomain/hostname
- `Default` = the default endpoint name (custom endpoints can be created via Web Service Endpoints screen)
- `{version}` = API contract version, e.g., `24.200.001`
- `{EntityName}` = PascalCase entity name, e.g., `Customer`, `SalesOrder`

Source: https://enterprise-support.myob.com/adv/contract-based-rest-api

### Q7: How is versioning handled?

**[DOCUMENTED]** -- Version is embedded in the URL path.

- Format: `{major}.{minor}.{patch}` (e.g., `24.200.001` = 2024 R2)
- Multiple versions can coexist on the same instance
- Breaking changes only between major versions
- Custom endpoints can expose different field sets at the same version
- Swagger spec available per endpoint version: `/entity/Default/24.200.001/swagger.json?company={Company}`

### Q8: Are there environment-specific URLs?

**[DOCUMENTED]** -- Each environment is a separate instance with a distinct URL.

- Production: `https://company.myobadvanced.com/...`
- Sandbox: `https://company-sandbox.myobadvanced.com/...` (or cloned instance)
- Instance URL is the complete differentiator

---

## Phase 4: Rate Limiting & Quotas

### Q9: What are the rate limits?

Concurrency-based, not requests-per-second.

| Limit                   | Value                 | Confidence                                                               | Notes                                     |
| ----------------------- | --------------------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| Concurrent API requests | 6                     | [DOCUMENTED — community forum + license tier docs]                       | L-series license default                  |
| Request queue depth     | 20                    | [INFERRED — single community-forum post; not in official Acumatica docs] | Requests beyond 6 queue                   |
| Queue timeout           | 60 seconds            | [INFERRED — same single community post]                                  | Queued requests waiting >60s are declined |
| Beyond queue            | 429 Too Many Requests | [DOCUMENTED]                                                             | Must retry                                |
| Request timeout         | 600 seconds           | [DOCUMENTED]                                                             | Long-running operations                   |

- Rate limiting is per-instance, shared across all API consumers and integrations
- No per-user or per-application throttling
- S-series licenses have lower concurrency (exact number not publicly documented)
- License Monitoring Console (SM604000) shows current API usage

Source: https://community.acumatica.com/develop-integrations-with-web-services-apis-289/concurrent-api-requests-23035 and Acumatica Licensing Guide

### Q10: Are there payload or record limits?

**[DOCUMENTED]**:

- Default without `$top`: returns ALL records (dangerous for large datasets)
- Recommended: Always use `$top` (practical max: 200-500 per page)
- `$skip` for pagination offset
- File attachment limit: depends on instance configuration (typically 50MB)
- No documented request body size limit for entity operations

### Q11: How are rate limit errors communicated?

**[INFERRED]** -- HTTP 429 when concurrency + queue are exhausted.

- No documented Acumatica-specific rate limit headers (`X-RateLimit-*`, `Retry-After`)
- The Acumatica documentation does not specify whether a `Retry-After` header is returned with 429 responses
- Best practice: implement exponential backoff with 2-5 second initial delay

### Q12: Is there a usage dashboard?

**[DOCUMENTED]** -- License Monitoring Console (SM604000) shows API user sessions. No real-time request rate dashboard.

---

## Phase 5: Core Entities & Data Model

### Q13: What are the primary entities?

**[DOCUMENTED]** -- The Default endpoint (24.200.001) exposes 200+ entities. Key business entities:

| Entity             | Category   | Key Operations                          |
| ------------------ | ---------- | --------------------------------------- |
| Customer           | Financials | CRUD, search, credit hold, statements   |
| Vendor             | Financials | CRUD, search, 1099 settings             |
| SalesOrder         | Sales      | CRUD, actions (confirm, ship, complete) |
| SalesInvoice       | Sales      | CRUD, release, email, print             |
| Bill               | Purchasing | CRUD, release, pay                      |
| PurchaseOrder      | Purchasing | CRUD, approve, receive, complete        |
| StockItem          | Inventory  | CRUD, availability, warehouse details   |
| JournalTransaction | Financials | CRUD, release, reverse                  |
| Lead               | CRM        | CRUD, convert to opportunity            |
| Opportunity        | CRM        | CRUD, convert to sales order            |
| Project            | Projects   | CRUD, activate, complete, billing       |
| Employee           | HR         | CRUD, department, position              |

### Q14: How are entities related?

**[DOCUMENTED]** -- Key relationships:

- Customer 1:N SalesOrder 1:N SalesInvoice
- Vendor 1:N Bill, Vendor 1:N PurchaseOrder
- Lead 1:1 Opportunity (via conversion action)
- Opportunity 1:1 SalesOrder (via conversion action)
- StockItem M:N SalesOrder (via Details lines)
- StockItem M:N PurchaseOrder (via Details lines)
- Employee N:1 Department
- Project 1:N ProjectTask
- Customer/Vendor referenced by business key fields (e.g., `CustomerID`)

### Q15: What are the field naming conventions?

**[DOCUMENTED]** -- PascalCase for all fields. Every field wrapped in a value object.

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "rowNumber": 1,
  "note": null,
  "CustomerID": { "value": "ACME01" },
  "CustomerName": { "value": "Acme Corporation" },
  "Status": { "value": "Active" },
  "MainContact": {
    "id": "...",
    "rowNumber": 1,
    "Email": { "value": "contact@acme.com" },
    "Phone1": { "value": "+64 9 555 0100" }
  }
}
```

- System fields at root: `id` (GUID), `rowNumber` (integer), `note` (string or null)
- Business fields wrapped in `{"value": ...}`
- Nested objects for sub-entities (e.g., `MainContact`, `BillingAddress`)
- Detail arrays for line items (e.g., `Details[]`)
- Custom fields use a `custom` wrapper: `"custom": {"DataViewName": {"UsrFieldName": {"type": "String", "value": "..."}}}`

Source: https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=7b104d41-3457-42f8-8010-165d9d931d3f (Representation of a Record in JSON Format)

### Q16: How are IDs structured?

**[DOCUMENTED]**:

- Internal ID: GUID (UUID format), e.g., `"id": "ca4b97c9-7b86-ed11-8688-020017045e71"`
- Business key: Human-readable, e.g., `CustomerID: {"value": "ACME01"}`
- Both can be used for lookups (single record GET)
- GUIDs are system-assigned and immutable
- Business keys may be auto-numbered (via numbering sequences)

---

## Phase 6: CRUD Operations

### Q17: How are records created?

**[DOCUMENTED]** -- PUT (not POST) to the entity endpoint creates a new record when no key match is found.

```http
PUT /entity/Default/24.200.001/Customer
Content-Type: application/json
Authorization: Bearer {token}

{
    "CustomerID": {"value": "ACME01"},
    "CustomerName": {"value": "Acme Corporation"},
    "CustomerClass": {"value": "DEFAULT"},
    "Status": {"value": "Active"}
}
```

Response: 200 OK with the full created entity (including system-generated `id`, `rowNumber`, `note`).

Source: https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=9d966d50-a0a1-4456-a9ff-1cc2159d48d4 (Creation of a Record)

### Q18: How are records read?

**[DOCUMENTED]** -- GET with OData query parameters.

```http
GET /entity/Default/24.200.001/Customer?$top=20&$filter=Status eq 'Active'&$select=CustomerID,CustomerName,Status
Authorization: Bearer {token}
```

Single record by GUID:

```http
GET /entity/Default/24.200.001/Customer/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

Single record by business key:

```http
GET /entity/Default/24.200.001/Customer/ACME01
```

### Q19: How are records updated?

**[DOCUMENTED]** -- PUT with `id` field or key field values updates the existing record.

```http
PUT /entity/Default/24.200.001/Customer
Content-Type: application/json
Authorization: Bearer {token}

{
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "CustomerName": {"value": "Acme Corp (Updated)"}
}
```

- Only changed fields need to be sent (plus `id` or key fields to identify the record)
- **Exception:** Line item arrays (e.g., `Details` on SalesOrder) are replaced entirely -- you must send ALL lines

Source: https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=af48c02a-afbc-4fdb-b1e5-635ac7ebbaf1 (Update of a Record)

### Q20: How are records deleted?

**[DOCUMENTED]** -- DELETE by GUID or by key values in the URL path.

By GUID:

```http
DELETE /entity/Default/24.200.001/Customer/a1b2c3d4-e5f6-7890-abcd-ef1234567890
Authorization: Bearer {token}
```

By key values (separated by `/` in URL path):

```http
DELETE /entity/Default/24.200.001/SalesOrder/SO/000123
Authorization: Bearer {token}
```

Response: 204 No Content on success. Records with dependent children return 400/500 with explanatory error.

Source: https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=d806636f-3cb8-4fd6-bc1e-fef9cdf9683d (Removal of a Record)

### Q21: Is there bulk/batch support?

**[DOCUMENTED]** -- No native batch endpoint.

- No `$batch` OData support
- For bulk creates/updates: loop individual PUT calls
- Respect the 6 concurrent request limit (recommend 3-4 parallel max)
- Some actions support batch processing (e.g., releasing multiple invoices)

---

## Phase 7: Querying & Filtering

### Q22: What query syntax is supported?

**[DOCUMENTED]** -- OData query parameters on entity endpoints.

| Parameter  | Example                   | Purpose                               |
| ---------- | ------------------------- | ------------------------------------- |
| `$filter`  | `Status eq 'Active'`      | Filter records                        |
| `$select`  | `CustomerID,CustomerName` | Choose fields                         |
| `$top`     | `100`                     | Limit records                         |
| `$skip`    | `100`                     | Pagination offset                     |
| `$orderby` | `CustomerName asc`        | Sort results                          |
| `$expand`  | `Details`                 | Include related entities/detail lines |
| `$custom`  | Custom parameters         | Retrieve custom/UDF fields            |

### Q23: What filter operators are available?

**[DOCUMENTED]** -- Standard OData operators.

| Operator               | Example                                     |
| ---------------------- | ------------------------------------------- |
| `eq`                   | `Status eq 'Active'`                        |
| `ne`                   | `Status ne 'Closed'`                        |
| `gt`, `ge`, `lt`, `le` | `OrderTotal gt 1000`                        |
| `and`, `or`, `not`     | `Status eq 'Active' and Type eq 'Customer'` |
| `contains`             | `contains(CustomerName, 'Acme')`            |
| `startswith`           | `startswith(CustomerID, 'AC')`              |
| `endswith`             | `endswith(Email, '.com')`                   |
| `substringof`          | `substringof('corp', CustomerName)`         |

**Critical:** Filters use bare field names, not `FieldName.value`. String values use single quotes.

Source: Acumatica community forums and Integration Development Guide

### Q24: How does pagination work?

**[DOCUMENTED]** -- `$top` + `$skip` pattern. No total count available in contract-based REST API responses.

- No `@odata.count`, no `@odata.nextLink`, no continuation token
- Infer last page: `results.length < $top`
- Default with no `$top`: returns ALL records
- Recommended page size: 100-200

Source: https://community.acumatica.com/develop-integrations-with-web-services-apis-289/http-rest-api-and-total-count-inclusion-in-response-27874

---

## Phase 8: State Management & Business Logic

### Q26: What state machines exist?

**[DOCUMENTED]** -- Key state machines (see 01a-domain-model-reference.md for full detail):

- SalesInvoice / Bill: Balanced -> Open -> Released -> Closed -> Voided
- SalesOrder: Open -> BackOrder -> Shipping -> Completed / Cancelled
- PurchaseOrder: Open -> PendingApproval -> Approved -> Completed
- Lead: New -> Open -> Converted / Disqualified
- Opportunity: New -> Open -> Won / Lost

### Q27: How are state transitions triggered?

**[DOCUMENTED]** -- Via action endpoints using POST.

```http
POST /entity/Default/24.200.001/SalesInvoice/{id}/action/ReleaseSalesInvoice
Content-Type: application/json
Authorization: Bearer {token}

{
    "entity": {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    }
}
```

**Action response pattern:**

- **204 No Content** -- Action completed immediately (success)
- **202 Accepted** -- Long-running operation initiated. Response includes `Location` header with a URL to poll for status. Poll that URL with GET: 202 = still processing, 204 = completed.

Source: https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=91bf9106-062a-47a8-be1f-b48517a54324 (Execution of an Action)

---

## Phase 9: Webhooks & Events

### Q29: Does the API support webhooks?

**[DOCUMENTED]** -- UI-only configuration via Push Notifications screen.

- Webhooks are configured through the Acumatica UI (Push Notifications screen), not via API
- Based on Generic Inquiries (GI) or built-in definitions
- Push Notification monitors a data source for changes and sends HTTP POST
- Cannot create, modify, or delete webhook subscriptions via API

Source: https://www.acumatica.com/media/2020/07/2020-Virtual-DevCon-Push-Notifications-Webhooks-Final.pdf

### Q31: What is the webhook payload format?

**[DOCUMENTED]** -- Push Notification payload structure:

```json
{
  "Query": "SourceDefinitionName",
  "CompanyId": "CompanyLoginName",
  "Id": "transaction-uuid-here",
  "TimeStamp": 637407844167787833,
  "Inserted": [{ "FieldName": "value", "AnotherField": "value" }],
  "Deleted": [{ "FieldName": "old_value", "AnotherField": "old_value" }],
  "AdditionalInfo": {}
}
```

- `Query` = name of the source definition (GI name or built-in class name)
- `CompanyId` = login company name
- `Id` = transaction identifier (UUID, generated at DB level) -- can be used for deduplication
- `TimeStamp` = monotonically increasing DB timestamp value
- `Inserted[]` = new/updated rows (flat field values, no `{"value": ...}` wrappers)
- `Deleted[]` = old values (populated on Update and Delete)
- `AdditionalInfo` = optional metadata
- Delivery: at-least-once (use `Id` for deduplication)

Source: Acumatica DevCon 2020 Push Notifications presentation and https://www.acumatica.com/media/2019/05/Push-Notifications.pdf

### Q32: Is there retry/delivery guarantee for webhooks?

**[DOCUMENTED]** -- Limited:

- Retries: configurable retry count with exponential backoff
- Delivery guarantee: at-least-once
- No dead letter queue
- No delivery confirmation API
- No webhook signature/HMAC for verification
- Failures logged in Acumatica System Monitor

---

## Phase 10: Error Handling & Files

### Q33: What is the error response format?

**[DOCUMENTED]** -- JSON error body with exception details.

```json
{
  "message": "An error has occurred.",
  "exceptionMessage": "Error: 'CustomerClass' cannot be empty.",
  "exceptionType": "PX.Data.PXException",
  "stackTrace": "..."
}
```

Multi-field validation errors use `PX.Data.PXOuterException` with `innerException`:

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

| HTTP Code | Meaning                                                   |
| --------- | --------------------------------------------------------- |
| 400       | Bad request / validation error                            |
| 401       | Invalid or expired token                                  |
| 403       | No API license or insufficient permissions                |
| 404       | Entity/record not found                                   |
| 409       | Concurrent modification conflict (optimistic concurrency) |
| 422       | Business rule violation                                   |
| 429       | Too many concurrent requests                              |
| 500       | Internal server error                                     |

Source: Acumatica community forums and Integration Development Guide

### Q35: How are concurrent modification conflicts handled?

**[DOCUMENTED]** -- Optimistic concurrency via DB-level timestamp (TStamp column).

- Each record has a `TStamp` field (PXDBTimestamp attribute in DAC)
- On PUT, Acumatica validates that the TStamp has not changed since the record was read
- If another process modified the record, returns error: "Another process has updated the '{EntityName}' record. Your changes will be lost."
- Resolution: re-GET the record, merge changes, retry PUT

Source: https://asiablog.acumatica.com/index.php/2018/03/another-process-has-added-updated-deleted/

### Q36: How are files attached to records?

**[DOCUMENTED]** -- PUT binary data to the files sub-resource.

```http
PUT /entity/Default/24.200.001/SalesOrder/SO/000042/files/invoice-scan.pdf
Content-Type: application/octet-stream
Authorization: Bearer {token}

{binary file data}
```

- Keys in URL path separated by `/` (e.g., `SO/000042` for OrderType=SO, OrderNbr=000042)
- Response: 204 No Content on success
- Retrieve: `GET /entity/Default/24.200.001/SalesOrder/SO/000042/files/invoice-scan.pdf`
- List files: use `$expand=files` on entity GET
- Since System Contract 4 (Default 20.200.001+), can attach files to detail items

Source: https://asiablog.acumatica.com/index.php/2018/01/attach-files-with-rest-api/

### Q37: Are there Generic Inquiry endpoints?

**[DOCUMENTED]** -- Two access methods:

**Method 1: Contract-based endpoint (extended)**

- Extend the Web Service Endpoint to include GI definitions
- Access via the entity API path
- Use `$expand=Result` and PUT with `{}` body to retrieve data

**Method 2: OData feed**

- Direct OData access: `https://{instance}/odata/{CompanyName}/{GI_ScreenID}`
- OData v3 (with limitations)
- Returns flat tabular data
- Supports `$filter`, `$top`, `$skip`, `$orderby`
- Read-only

Source: https://www.acumatica.com/blog/contract-based-apis-in-generic-inquiries/

---

## Confidence Summary

| Category         | Documented | Inferred | Unknown |
| ---------------- | ---------- | -------- | ------- |
| Authentication   | 5          | 0        | 0       |
| URL & Versioning | 3          | 0        | 0       |
| Rate Limiting    | 3          | 1        | 0       |
| Data Model       | 4          | 0        | 0       |
| CRUD             | 5          | 0        | 0       |
| Querying         | 4          | 0        | 0       |
| State Management | 3          | 0        | 0       |
| Webhooks         | 4          | 0        | 0       |
| Errors           | 3          | 0        | 0       |
| Files & Special  | 3          | 0        | 0       |
| **Total**        | **37**     | **1**    | **0**   |

The single [INFERRED] item is the 429 response format -- Acumatica documentation confirms 429 is returned when concurrency is exceeded but does not specify whether `Retry-After` headers are included.

---

## Integration Path for Numa

**Recommended:** Data Connector (OAuth2) + Direct API calls from workspace agent.

- **Auth type:** OAuth 2.0 Authorization Code (per-instance)
- **Per-instance URLs:** Connector must store instance URL per company connection
- **Key challenge:** Per-instance OAuth registration requires admin access to each Acumatica instance
- **API License requirement:** Customer must have purchased the Acumatica API License add-on
- **Swagger spec:** Available per-instance for dynamic discovery of available entities and fields

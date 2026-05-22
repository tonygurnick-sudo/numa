---
api_name: 'NetSuite AI Connector Service (MCP)'
api_slug: 'netsuite'
vendor: 'Oracle NetSuite'
website: 'https://www.netsuite.com'
investigation_started: '2026-03-30'
investigator: 'Claude Code + AEW customer live tools/list response'
investigation_status: 'complete'
documentation_quality: 'good'
api_types: ['MCP (JSON-RPC 2.0)', 'REST']
overall_confidence: 'high'
blockers: []
---

# API Investigation Questionnaire: NetSuite AI Connector Service (MCP)

> Investigation completed using a combination of:
>
> - [CONFIRMED] live tools/list response from AEW (Account ID: 5721181)
> - [DOCUMENTED] Oracle official documentation
> - [INFERRED] community guides and observed behavior

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0714082142.html [DOCUMENTED]
- **API reference / endpoint catalog URL:** https://system.netsuite.com/help/helpcenter/en_US/APIs/REST_API_Browser/record/v1/2024.1/index.html [DOCUMENTED]
- **Authentication guide URL:** https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157771733782.html [DOCUMENTED]
- **Changelog / release notes URL:** https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1539886829.html [DOCUMENTED]
- **Status page URL:** https://status.netsuite.com [DOCUMENTED]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** Not available. NetSuite uses a proprietary REST API Browser. [CONFIRMED]
- **Postman collection URL:** Community guides exist but no official Postman collection [INFERRED]
- **Official SDK repositories:**
  - Python: None for MCP endpoint
  - Node.js: None for MCP endpoint
  - SuiteScript (server-side): Built-in to NetSuite platform
- **Official blog:** https://blogs.oracle.com/developers/ [DOCUMENTED]
- **Community forums:** https://community.oracle.com/netsuite [DOCUMENTED]
- **FAQ:** https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_4160616848.html [DOCUMENTED]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                   |
| ------------------------- | ------ | --------------------------------------------------------------------------------------- |
| Authentication            | 4      | Good OAuth 2.0 PKCE docs, but MCP-specific auth details scattered across multiple pages |
| Endpoint reference        | 3      | MCP tools described in SuiteApp docs; REST API browser is separate and comprehensive    |
| Request/response examples | 2      | MCP tool input schemas confirmed; response formats not documented in detail             |
| Error documentation       | 4      | REST error format well-documented with `o:errorDetails` structure                       |
| Rate limit documentation  | 3      | Concurrency governance documented; MCP-specific limits unclear                          |
| Pagination documentation  | 3      | SuiteQL REST pagination well-documented; MCP pagination via tool params                 |
| Webhook documentation     | 2      | No native webhooks; requires SuiteScript custom development                             |
| SDKs / code examples      | 2      | No SDK for MCP; SuiteScript SDK is NetSuite-internal only                               |
| Changelog / versioning    | 4      | Regular release notes per quarter                                                       |

**Overall documentation quality:** good

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Found or confirmed no OpenAPI/Swagger spec (uses proprietary REST API Browser)
- [x] Identified authentication method (OAuth 2.0 Authorization Code with PKCE)
- [x] Found at least one working example (tools/list response from AEW account)
- [x] Identified rate limit information (concurrency governance model)
- [x] Identified pagination approach (SuiteQL: offset/limit; MCP tools: range_start/range_end)
- [x] Checked for webhook/event support (no native webhooks; requires SuiteScript)
- [x] Checked for official SDKs (none for MCP; SuiteScript is platform-internal)

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** NetSuite AI Connector Service (MCP Standard Tools) [CONFIRMED]
- **Vendor / company:** Oracle NetSuite [CONFIRMED]
- **Current API version:** MCP Protocol version 2025-06-18 [DOCUMENTED]
- **Base URL(s):**
  - MCP Standard Tools: `https://{accountid}.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools` [CONFIRMED]
  - MCP All Tools: `https://{accountid}.suitetalk.api.netsuite.com/services/mcp/v1/all` [DOCUMENTED]
  - SuiteQL REST: `https://{accountid}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql` [DOCUMENTED]
  - Record REST: `https://{accountid}.suitetalk.api.netsuite.com/services/rest/record/v1/{recordType}` [DOCUMENTED]
  - Sandbox: Same pattern with sandbox account ID [DOCUMENTED]
- **API type:** MCP (JSON-RPC 2.0) over HTTP POST [CONFIRMED]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (HTTP/1.1 and HTTP/2 supported) [DOCUMENTED]
- **Data format:** JSON [CONFIRMED]
- **Content-Type header(s):** `application/json` [CONFIRMED]
- **Character encoding:** UTF-8 [DOCUMENTED]
- **URL structure pattern:** `https://{accountid}.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/{applicationid}` [CONFIRMED]

- **Versioning strategy:** MCP protocol version in server capabilities; REST version in URL path [DOCUMENTED]
- **CORS policy:** Not applicable (server-to-server) [INFERRED]
- **Required headers (all requests):**

| Header          | Value                   | Purpose                                |
| --------------- | ----------------------- | -------------------------------------- |
| `Authorization` | `Bearer {access_token}` | OAuth 2.0 JWT access token [CONFIRMED] |
| `Content-Type`  | `application/json`      | Request body format [CONFIRMED]        |

### 2.3 Authentication [REQUIRED]

- **Auth method:** OAuth 2.0 Authorization Code with PKCE (public client) [CONFIRMED]
- **Auth location:** Header [CONFIRMED]
- **Auth header format:** `Authorization: Bearer {jwt_access_token}` [CONFIRMED]

**OAuth 2.0 details:**

- **Grant type(s) supported:** `authorization_code` (with PKCE) and `refresh_token` [DOCUMENTED]
- **Authorization URL:** `https://{accountid}.app.netsuite.com/app/login/oauth2/authorize.nl` [DOCUMENTED — corrected 2026-05-19; the prior `suitetalk.api.netsuite.com/.../authorize` value was wrong]
- **Authorization URL fallback (account ID unknown):** `https://system.netsuite.com/app/login/oauth2/authorize.nl` [DOCUMENTED]
- **Token URL:** `https://{accountid}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token` [DOCUMENTED]
- **Revocation URL:** Unknown [UNKNOWN]
- **Supported scopes:** `restlets`, `rest_webservices`, `suite_analytics`, `mcp` — space-separated. The `mcp` scope is **exclusive** (cannot be combined with the others). [DOCUMENTED]

| Scope              | Purpose                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `rest_webservices` | SuiteTalk REST (Record API + SuiteQL)                                                        |
| `restlets`         | Custom SuiteScript RESTlet endpoints                                                         |
| `suite_analytics`  | SuiteAnalytics Connect / BI                                                                  |
| `mcp`              | NetSuite AI Connector Service (MCP). Exclusive; requires PKCE even for confidential clients. |

- **Access token lifetime:** 3600 seconds (1 hour). Format: JWT RS256. [DOCUMENTED]
- **Refresh token lifetime:**
  - **Confidential clients:** 7 days, reusable until expiry [DOCUMENTED]
  - **Public clients:** 2 days default, configurable 1 hour – 720 hours via integration record. **One-time use — rotates on every refresh.** [DOCUMENTED]
- **PKCE required?** Yes for public clients; required for the `mcp` scope on confidential clients too. [DOCUMENTED]
- **PKCE method:** `S256` only — `plain` unsupported since 2020.2. [DOCUMENTED]
- **`code_verifier` constraints:** 43–128 chars, `[A-Za-z0-9-._~]`. [DOCUMENTED]
- **State parameter:** Required. Must be **22–1024 characters**, printable ASCII, unique per flow. [DOCUMENTED] (NetSuite-specific tighter constraint than the spec.)
- **Redirect URI restrictions:** Must match integration record exactly. [DOCUMENTED]

**Critical setup requirements (MCP scope specifically):**

1. Integration record must have "NetSuite AI Connector Service" scope enabled [DOCUMENTED]
2. Public Client is recommended for MCP, but confidential clients also work — PKCE is required either way. [DOCUMENTED — corrects prior "must use public client" claim, which is only universally true if you specifically want PKCE without storing a secret]
3. Administrator role does NOT work for MCP — must create a custom role [DOCUMENTED]
4. Custom role requires: MCP Server Connection + OAuth 2.0 Access Tokens permissions [DOCUMENTED]
5. Features required: OAuth 2.0, Server SuiteScript, REST Web Services [DOCUMENTED]

For non-MCP scopes (`rest_webservices`, `restlets`), the Administrator role works fine, and confidential clients are common.

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

**Endpoint used for first call:** tools/list via MCP JSON-RPC [CONFIRMED]

```http
POST /services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools HTTP/1.1
Host: 5721181.suitetalk.api.netsuite.com
Authorization: Bearer {jwt_token}
Content-Type: application/json

{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
```

**Response received:** 11 tools returned (6352 bytes compressed). Full tool list documented in Phase 4. [CONFIRMED]

- **HTTP status code:** 200 [CONFIRMED]
- **Time to first successful call:** Initial setup hit 400 error with wrong scope (`restlets rest_webservices`); resolved when correct `mcp` scope used [CONFIRMED]
- **Gotchas encountered during setup:**
  1. Scope must be `mcp` (and `mcp` is exclusive — cannot be combined with `restlets`/`rest_webservices`) [CONFIRMED]
  2. The test integration used a public client (no client secret) [CONFIRMED]. Confidential clients also work for `mcp` per Oracle docs, provided PKCE is supplied. [DOCUMENTED]
  3. Administrator role cannot be used for MCP; need custom role with `MCP Server Connection` [DOCUMENTED]

- [x] **GATE CHECK: First successful API call completed and documented above**

---

## Phase 3: Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

> NetSuite MCP exposes a GENERIC record API. Rather than entity-specific endpoints, it provides tools that operate on ANY NetSuite record type. The key entity is `recordType` -- a string parameter that selects which kind of record to operate on.

#### Entity: Generic Record (via ns_createRecord / ns_updateRecord / ns_getRecord)

- **API resource name:** Any valid NetSuite record type string [CONFIRMED]
- **Description:** Generic CRUD on any NetSuite record type. Must call ns_getRecordTypeMetadata first to discover fields and types. [CONFIRMED]
- **CRUD support:** Create (ns_createRecord) / Read (ns_getRecord) / Update (ns_updateRecord) / Delete (not available via MCP tools) [CONFIRMED]

**Common record types accessible via generic API:** [DOCUMENTED]

| Record Type String     | Description                    | Category    |
| ---------------------- | ------------------------------ | ----------- |
| `customer`             | Customer/company records       | Entity      |
| `vendor`               | Vendor/supplier records        | Entity      |
| `employee`             | Employee records               | Entity      |
| `contact`              | Contact records                | Entity      |
| `salesorder`           | Sales order transactions       | Transaction |
| `invoice`              | Invoice transactions           | Transaction |
| `purchaseorder`        | Purchase order transactions    | Transaction |
| `vendorbill`           | Vendor bill (AP) transactions  | Transaction |
| `journalentry`         | General ledger journal entries | Transaction |
| `inventoryitem`        | Inventory/stock items          | Item        |
| `noninventoryitem`     | Non-inventory items            | Item        |
| `serviceitem`          | Service items                  | Item        |
| `itemfulfillment`      | Item fulfillment records       | Transaction |
| `itemreceipt`          | Item receipt records           | Transaction |
| `creditmemo`           | Credit memo transactions       | Transaction |
| `payment`              | Customer payment records       | Transaction |
| `vendorpayment`        | Vendor payment records         | Transaction |
| `estimate`             | Quotes/estimates               | Transaction |
| `opportunity`          | Sales opportunities            | CRM         |
| `case` / `supportcase` | Support cases                  | CRM         |
| `customrecord_{id}`    | Custom record types            | Custom      |

**Fields:** Dynamic per record type. Discovered via `ns_getRecordTypeMetadata`. [CONFIRMED]

**Relationships:** Expressed as ID references within records (e.g., `salesorder.entity` references a `customer` ID). [INFERRED]

#### Entity: Report

- **API resource name:** Reports accessed via ns_listAllReports / ns_runReport [CONFIRMED]
- **Description:** Financial and operational reports with date filtering and subsidiary support [CONFIRMED]
- **CRUD support:** Read only [CONFIRMED]

**Fields (from ns_listAllReports response):** [CONFIRMED]

| Field                    | Type    | Description                       |
| ------------------------ | ------- | --------------------------------- |
| `name`                   | string  | Report name                       |
| `id`                     | number  | Report ID                         |
| `as_of_date_format`      | string  | Date format used                  |
| `has_subsidiary_filter`  | boolean | Whether subsidiary filter applies |
| `periods_allowed`        | string  | Allowed date periods              |
| `supports_consolidation` | boolean | Consolidation support             |

#### Entity: Saved Search

- **API resource name:** Saved searches via ns_listSavedSearches / ns_runSavedSearch [CONFIRMED]
- **Description:** Pre-built search queries that can be listed and executed [CONFIRMED]
- **CRUD support:** Read only (list and execute) [CONFIRMED]

#### Entity: SuiteQL Table/View

- **API resource name:** SuiteQL metadata and queries via ns_getSuiteQLMetadata / ns_runCustomSuiteQL [CONFIRMED]
- **Description:** Direct SQL-like query access to NetSuite's Oracle-dialect database [CONFIRMED]
- **CRUD support:** Read only [CONFIRMED]

### 3.2 Entity Relationships [IMPORTANT]

```
┌──────────────┐     via entity ID     ┌──────────────┐
│   Customer   │<─────────────────────│  Sales Order  │
└──────────────┘                       └──────────────┘
                                             │
                                             │ line items
                                             ▼
                                       ┌──────────────┐
                                       │  Inventory   │
                                       │    Item      │
                                       └──────────────┘
┌──────────────┐     via entity ID     ┌──────────────┐
│    Vendor    │<─────────────────────│Purchase Order │
└──────────────┘                       └──────────────┘
                                             │
                                             │ fulfillment
                                             ▼
                                       ┌──────────────┐
                                       │ Item Receipt │
                                       └──────────────┘
┌──────────────┐     via entity ID     ┌──────────────┐
│   Customer   │<─────────────────────│   Invoice    │
└──────────────┘                       └──────────────┘
                                             │
                                             │ payment
                                             ▼
                                       ┌──────────────┐
                                       │   Payment    │
                                       └──────────────┘
```

[INFERRED] -- Standard ERP relationships; exact field names discovered via ns_getRecordTypeMetadata.

### 3.3 State Machines [IMPORTANT]

#### State Machine: Sales Order [DOCUMENTED]

```
[Pending Fulfillment] ──fulfill──> [Pending Billing] ──invoice──> [Billed] ──close──> [Closed]
                                                                        \
                                                                         ──cancel──> [Cancelled]
```

#### State Machine: Invoice [DOCUMENTED]

```
[Open] ──payment──> [Paid In Full]
   \
    ──void──> [Voided]
```

#### State Machine: Purchase Order [DOCUMENTED]

```
[Pending Supervisor Approval] ──approve──> [Pending Receipt] ──receive──> [Partially Received / Fully Received] ──bill──> [Fully Billed] ──close──> [Closed]
```

### 3.4 Business Rules [IMPORTANT]

**Ordering / dependency rules:**

- Must call `ns_getRecordTypeMetadata` before `ns_createRecord` or `ns_updateRecord` [CONFIRMED]
- Must call `ns_listAllReports` before `ns_runReport` to get valid report IDs [CONFIRMED]
- If report `has_subsidiary_filter`, must call `ns_getSubsidiaries` before `ns_runReport` [CONFIRMED]
- `ns_createRecord` data must be stringified JSON (not raw JSON object) [CONFIRMED]

**Field-level rules:**

- Record field types and requirements are dynamic per record type [CONFIRMED]
- SuiteQL uses Oracle-dialect SQL -- no CTEs, no `LIMIT`, uses `ROWNUM` [CONFIRMED]
- SuiteQL `IN` clause limited to 1000 items [CONFIRMED]
- SuiteQL date format: `TO_DATE('2024-01-01', 'YYYY-MM-DD')` [CONFIRMED]

**Computed / read-only fields:**

- Transaction totals computed from line items [DOCUMENTED]
- System fields (datecreated, lastmodified) are read-only [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

| Format    | Pattern                    | Example                    | Notes                                                             |
| --------- | -------------------------- | -------------------------- | ----------------------------------------------------------------- |
| Date      | `YYYY-MM-DD`               | `2026-03-30`               | ISO 8601 for MCP tools; `TO_DATE()` in SuiteQL [CONFIRMED]        |
| DateTime  | `YYYY-MM-DDTHH:mm:ss.sssZ` | `2026-03-30T14:30:00.000Z` | ISO 8601 [INFERRED]                                               |
| Currency  | Numeric                    | `1234.56`                  | No currency symbol; currency determined by record [INFERRED]      |
| ID format | Integer string             | `"12345"`                  | Internal IDs are integers as strings [DOCUMENTED]                 |
| Boolean   | `T` / `F`                  | `T`                        | NetSuite uses T/F strings, not true/false in SuiteQL [DOCUMENTED] |

---

## Phase 4: Endpoint Catalog

### 4.1 Critical Endpoints [REQUIRED] -- MCP Tools (CONFIRMED from live response)

> These are not REST endpoints in the traditional sense. They are MCP tools invoked via JSON-RPC 2.0 POST to the MCP endpoint. Each tool call is:
>
> ```json
> {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "tool_name", "arguments": {...}}}
> ```

#### Tool 1: ns_getRecordTypeMetadata [CONFIRMED]

- **Purpose:** Get metadata for record types including fields and types. Gateway tool -- call before create/update.
- **Annotations:** readOnly=true, idempotent=true

**Input:**

| Parameter    | Type   | Required | Description                                            |
| ------------ | ------ | -------- | ------------------------------------------------------ |
| `recordType` | string | No       | Omit for all types; provide for specific type metadata |

**Response:** [UNKNOWN] -- Schema of fields, types, nullability. Not documented in detail.

#### Tool 2: ns_createRecord [CONFIRMED]

- **Purpose:** Create a new record. MUST call ns_getRecordTypeMetadata first.
- **Annotations:** readOnly=false, destructive=true, idempotent=false

**Input:**

| Parameter    | Type   | Required | Description                      |
| ------------ | ------ | -------- | -------------------------------- |
| `recordType` | string | Yes      | e.g., `customer`, `salesorder`   |
| `data`       | string | Yes      | Stringified JSON of field values |

#### Tool 3: ns_updateRecord [CONFIRMED]

- **Purpose:** Update an existing record. MUST call ns_getRecordTypeMetadata first.
- **Annotations:** readOnly=false, destructive=true, idempotent=false

**Input:**

| Parameter    | Type   | Required | Description                          |
| ------------ | ------ | -------- | ------------------------------------ |
| `recordType` | string | Yes      | e.g., `customer`, `salesorder`       |
| `recordId`   | string | Yes      | Internal ID of the record            |
| `data`       | string | Yes      | Stringified JSON of fields to update |

#### Tool 4: ns_getRecord [CONFIRMED]

- **Purpose:** Retrieve a single record by type and ID.
- **Annotations:** readOnly=true, idempotent=true

**Input:**

| Parameter    | Type   | Required | Description                          |
| ------------ | ------ | -------- | ------------------------------------ |
| `recordType` | string | Yes      | e.g., `customer`, `invoice`          |
| `recordId`   | string | Yes      | Internal ID                          |
| `fields`     | string | No       | Comma-separated field list to return |

#### Tool 5: ns_listAllReports [CONFIRMED]

- **Purpose:** List all available reports with metadata. Must call BEFORE ns_runReport.
- **Annotations:** readOnly=true, idempotent=true

**Input:** None.

**Response includes:** name, id, as_of_date_format, has_subsidiary_filter, periods_allowed, supports_consolidation [CONFIRMED]

#### Tool 6: ns_runReport [CONFIRMED]

- **Purpose:** Run a report. MUST call ns_listAllReports first.
- **Annotations:** readOnly=true, idempotent=true

**Input:**

| Parameter      | Type   | Required    | Description                              |
| -------------- | ------ | ----------- | ---------------------------------------- |
| `reportId`     | number | Yes         | From ns_listAllReports                   |
| `dateTo`       | string | Yes         | ISO 8601 `YYYY-MM-DD`                    |
| `dateFrom`     | string | Conditional | Required for some report types           |
| `subsidiaryId` | number | Conditional | Required if report has_subsidiary_filter |

**Complex workflow:** listAllReports -> check has_subsidiary_filter -> getSubsidiaries if needed -> runReport [CONFIRMED]

#### Tool 7: ns_getSubsidiaries [CONFIRMED]

- **Purpose:** Get subsidiaries for report filtering.
- **Annotations:** readOnly=true, idempotent=true

**Input:** None.

**Response:** Array of {id, name}. Consolidated subsidiaries have negative IDs. [CONFIRMED]

#### Tool 8: ns_listSavedSearches [CONFIRMED]

- **Purpose:** List all saved searches, optionally filtered by name.
- **Annotations:** readOnly=true, idempotent=true

**Input:**

| Parameter | Type   | Required | Description             |
| --------- | ------ | -------- | ----------------------- |
| `query`   | string | No       | Filter searches by name |

#### Tool 9: ns_runSavedSearch [CONFIRMED]

- **Purpose:** Run a saved search with optional pagination.
- **Annotations:** readOnly=true, idempotent=true

**Input:**

| Parameter     | Type   | Required    | Description                          |
| ------------- | ------ | ----------- | ------------------------------------ |
| `searchId`    | string | Yes         | Saved search internal ID             |
| `type`        | string | Conditional | Required for standalone search types |
| `range_start` | number | No          | Pagination start index               |
| `range_end`   | number | No          | Pagination end index                 |

#### Tool 10: ns_runCustomSuiteQL [CONFIRMED]

- **Purpose:** Run custom SuiteQL (Oracle-dialect SQL) queries.
- **Annotations:** readOnly=true, idempotent=true

**Input:**

| Parameter     | Type   | Required | Description                                               |
| ------------- | ------ | -------- | --------------------------------------------------------- |
| `sqlQuery`    | string | Yes      | SuiteQL query string                                      |
| `description` | string | Yes      | Human-readable description of what the query does         |
| `pageSize`    | number | No       | Rows per page (max 5000 per call, hard cap 100,000 total) |

#### Tool 11: ns_getSuiteQLMetadata [CONFIRMED]

- **Purpose:** Get SuiteQL table/field metadata.
- **Annotations:** readOnly=true, idempotent=true

**Input:**

| Parameter    | Type   | Required | Description                                     |
| ------------ | ------ | -------- | ----------------------------------------------- |
| `recordType` | string | No       | Omit for all tables; provide for specific table |

**Response:** JSON Schema with field types, titles, nullability, joinability (`x-n:joinable`, `x-n:recordType`). [CONFIRMED]

### 4.2 Full Endpoint Index [IMPORTANT]

| #   | Tool Name                  | Purpose                      | Read/Write | Requires Prerequisite                   |
| --- | -------------------------- | ---------------------------- | ---------- | --------------------------------------- |
| 1   | `ns_getRecordTypeMetadata` | Record type field discovery  | Read       | No                                      |
| 2   | `ns_createRecord`          | Create any record            | Write      | ns_getRecordTypeMetadata                |
| 3   | `ns_updateRecord`          | Update any record            | Write      | ns_getRecordTypeMetadata                |
| 4   | `ns_getRecord`             | Get a record by ID           | Read       | No                                      |
| 5   | `ns_listAllReports`        | List available reports       | Read       | No                                      |
| 6   | `ns_runReport`             | Execute a report             | Read       | ns_listAllReports (+ns_getSubsidiaries) |
| 7   | `ns_getSubsidiaries`       | List subsidiaries            | Read       | No                                      |
| 8   | `ns_listSavedSearches`     | List saved searches          | Read       | No                                      |
| 9   | `ns_runSavedSearch`        | Execute a saved search       | Read       | ns_listSavedSearches (to find ID)       |
| 10  | `ns_runCustomSuiteQL`      | Run SQL-like queries         | Read       | ns_getSuiteQLMetadata (recommended)     |
| 11  | `ns_getSuiteQLMetadata`    | SuiteQL table/field metadata | Read       | No                                      |

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                          | Supported? | Syntax                                                     | Notes        |
| ----------------------------------- | ---------- | ---------------------------------------------------------- | ------------ |
| Filter by field value               | Yes        | SuiteQL `WHERE field = 'value'`                            | [CONFIRMED]  |
| Filter by date range                | Yes        | SuiteQL `WHERE date BETWEEN TO_DATE(...) AND TO_DATE(...)` | [CONFIRMED]  |
| Full-text search                    | Partial    | Saved searches with `query` param; SuiteQL `LIKE`          | [CONFIRMED]  |
| Sort by field                       | Yes        | SuiteQL `ORDER BY field`                                   | [CONFIRMED]  |
| Sort direction (asc/desc)           | Yes        | SuiteQL `ORDER BY field ASC/DESC`                          | [CONFIRMED]  |
| Field selection                     | Yes        | ns_getRecord `fields` param; SuiteQL `SELECT`              | [CONFIRMED]  |
| Include related records             | Yes        | SuiteQL `JOIN`                                             | [CONFIRMED]  |
| Aggregate / count                   | Yes        | SuiteQL `COUNT(*)`, `SUM()`, `AVG()`, `GROUP BY`           | [CONFIRMED]  |
| Logical operators (AND/OR)          | Yes        | SuiteQL `WHERE x AND y OR z`                               | [CONFIRMED]  |
| Comparison operators (gt, lt, etc.) | Yes        | SuiteQL `>`, `<`, `>=`, `<=`, `!=`                         | [CONFIRMED]  |
| Null checks                         | Yes        | SuiteQL `IS NULL`, `IS NOT NULL`, `NVL()`                  | [CONFIRMED]  |
| Regex / pattern matching            | Partial    | SuiteQL `LIKE` with `%` and `_` wildcards                  | [DOCUMENTED] |

### 5.2 Filter Syntax [REQUIRED]

**SuiteQL (primary query mechanism via ns_runCustomSuiteQL):**

```sql
SELECT id, companyname, email
FROM customer
WHERE companyname LIKE '%Acme%'
AND datecreated >= TO_DATE('2025-01-01', 'YYYY-MM-DD')
ORDER BY companyname ASC
```

**Saved searches (via ns_runSavedSearch):**
Filter is built into the saved search definition. Runtime filtering is limited to the `query` parameter on ns_listSavedSearches. [CONFIRMED]

### 5.3 Sort Syntax [IMPORTANT]

```sql
-- SuiteQL sorting
SELECT id, companyname FROM customer ORDER BY companyname ASC
SELECT id, trandate, total FROM transaction ORDER BY trandate DESC, total DESC
```

[CONFIRMED] -- Standard SQL ORDER BY.

### 5.4 Field Selection [NICE-TO-HAVE]

```
-- Via ns_getRecord tool
fields parameter: "companyname,email,phone" (comma-separated) [CONFIRMED]

-- Via SuiteQL
SELECT companyname, email, phone FROM customer [CONFIRMED]
```

### 5.5 Search Capabilities [IMPORTANT]

- **Global search endpoint:** ns_listSavedSearches with `query` parameter [CONFIRMED]
- **Per-resource search:** SuiteQL with `WHERE ... LIKE '%term%'` [CONFIRMED]
- **Saved search execution:** ns_runSavedSearch with pagination via range_start/range_end [CONFIRMED]
- **Fuzzy matching:** Not natively supported; use `LIKE` with wildcards [INFERRED]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: List customers by name**

```json
{
  "name": "ns_runCustomSuiteQL",
  "arguments": {
    "sqlQuery": "SELECT id, companyname, email, phone FROM customer WHERE companyname LIKE '%Acme%' ORDER BY companyname",
    "description": "Find customers with Acme in their name"
  }
}
```

**Pattern 2: Recent sales orders**

```json
{
  "name": "ns_runCustomSuiteQL",
  "arguments": {
    "sqlQuery": "SELECT id, tranid, entity, trandate, total, status FROM transaction WHERE type = 'SalesOrd' AND trandate >= TO_DATE('2026-01-01', 'YYYY-MM-DD') ORDER BY trandate DESC",
    "description": "List sales orders from 2026"
  }
}
```

**Pattern 3: Open invoices with balances**

```json
{
  "name": "ns_runCustomSuiteQL",
  "arguments": {
    "sqlQuery": "SELECT t.id, t.tranid, c.companyname, t.trandate, t.total, t.amountremaining FROM transaction t JOIN customer c ON t.entity = c.id WHERE t.type = 'CustInvc' AND t.amountremaining > 0 ORDER BY t.amountremaining DESC",
    "description": "List open invoices with remaining balances"
  }
}
```

**Pattern 4: Inventory item lookup**

```json
{
  "name": "ns_runCustomSuiteQL",
  "arguments": {
    "sqlQuery": "SELECT id, itemid, displayname, quantityavailable, baseprice FROM item WHERE itemtype = 'InvtPart' AND quantityavailable > 0 ORDER BY itemid",
    "description": "List in-stock inventory items"
  }
}
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

**MCP tool pagination (ns_runSavedSearch):** [CONFIRMED]

- **Type:** Range-based (range_start / range_end)
- **Default page size:** Not specified in tool schema
- **Maximum results:** Depends on saved search configuration

**MCP tool pagination (ns_runCustomSuiteQL):** [CONFIRMED]

- **Type:** Page-based via `pageSize` parameter
- **Default page size:** Unknown [UNKNOWN]
- **Maximum per call:** 5,000 rows [CONFIRMED]
- **Hard cap total:** 100,000 rows [CONFIRMED]

**SuiteQL REST (direct, not MCP):** [DOCUMENTED]

- **Type:** Offset/limit
- **Parameters:** `?limit=N&offset=N`
- **Response includes:** `count`, `offset`, `totalResults`, `hasMore`, `items`, `links`

### 6.2 Pagination Worked Example [REQUIRED]

**Saved search pagination:**

```
Call 1: ns_runSavedSearch(searchId="123", range_start=0, range_end=99)
Call 2: ns_runSavedSearch(searchId="123", range_start=100, range_end=199)
Call 3: ns_runSavedSearch(searchId="123", range_start=200, range_end=299)
Stop when fewer results returned than requested range.
```

**SuiteQL pagination via ROWNUM:**

```sql
-- Page 1: rows 1-100
SELECT * FROM (SELECT id, companyname, ROWNUM rn FROM customer WHERE ROWNUM <= 100) WHERE rn > 0

-- Page 2: rows 101-200
SELECT * FROM (SELECT id, companyname, ROWNUM rn FROM customer WHERE ROWNUM <= 200) WHERE rn > 100
```

[CONFIRMED] -- SuiteQL uses ROWNUM, not LIMIT/OFFSET.

### 6.3 Bulk Operations [IMPORTANT]

| Operation   | Available via MCP? | Notes                                                             |
| ----------- | ------------------ | ----------------------------------------------------------------- |
| Bulk create | No                 | Must create records one at a time via ns_createRecord [CONFIRMED] |
| Bulk update | No                 | Must update records one at a time via ns_updateRecord [CONFIRMED] |
| Bulk delete | No                 | Delete not available via MCP tools [CONFIRMED]                    |
| Bulk read   | Partial            | SuiteQL can return up to 5,000 rows per call [CONFIRMED]          |

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported?  | Notes                                                       |
| ------------------------ | ----------- | ----------------------------------------------------------- |
| Webhooks                 | No (native) | Requires custom SuiteScript User Event Scripts [DOCUMENTED] |
| WebSocket                | No          | Not supported [DOCUMENTED]                                  |
| Server-Sent Events (SSE) | No          | Not supported [DOCUMENTED]                                  |
| Long polling             | No          | Not a built-in feature [DOCUMENTED]                         |
| Change feeds / streams   | No          | Not supported [DOCUMENTED]                                  |

### 7.2 Webhooks [IMPORTANT]

NetSuite has NO native webhook system. Real-time event notifications require custom SuiteScript development:

1. **User Event Scripts:** Trigger on record create/edit/delete (beforeSubmit, afterSubmit) [DOCUMENTED]
2. **Workflow Action Scripts:** Trigger within NetSuite Workflows, more flexible than User Event Scripts [DOCUMENTED]
3. **Scheduled Scripts / Map-Reduce Jobs:** For batch processing and retry logic [DOCUMENTED]

This is out of scope for the MCP integration. The MCP tools are query/command-oriented, not event-driven.

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended polling endpoint:** ns_runCustomSuiteQL with date filter [INFERRED]
- **Recommended query:** `SELECT id, lastmodifieddate FROM {recordType} WHERE lastmodifieddate > TO_DATE('...', 'YYYY-MM-DD HH24:MI:SS')`
- **Recommended polling interval:** 60 seconds minimum (respect concurrency limits) [INFERRED]
- **Change detection field(s):** `lastmodifieddate`, `datecreated` [DOCUMENTED]
- **Rate limit implications:** Each poll consumes a concurrency slot [DOCUMENTED]

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope               | Limit                 | Window              | Notes                                                         |
| ------------------- | --------------------- | ------------------- | ------------------------------------------------------------- |
| Account concurrency | 15 (default)          | Concurrent          | Shared across ALL integrations (REST, SOAP, MCP) [DOCUMENTED] |
| Tier 2              | 25                    | Concurrent          | +10 per SuiteCloud Plus license [DOCUMENTED]                  |
| Tier 3              | 35                    | Concurrent          | [DOCUMENTED]                                                  |
| Tier 4              | 45                    | Concurrent          | [DOCUMENTED]                                                  |
| Tier 5              | 55                    | Concurrent          | [DOCUMENTED]                                                  |
| Frequency           | Unknown exact numbers | 60s and 24h windows | Per-integration limits configurable [DOCUMENTED]              |
| SuiteQL result cap  | 100,000 rows          | Per query           | Hard limit [CONFIRMED]                                        |
| SuiteQL per-call    | 5,000 rows            | Per call            | Via MCP tool [CONFIRMED]                                      |
| Record REST         | 1,000 records         | Per list request    | Standard REST limit [DOCUMENTED]                              |

- **Rate limit exceeded response:** HTTP 429 with `o:errorCode: "CONCURRENCY_LIMIT_EXCEEDED"` [DOCUMENTED]
- **Retry-After header:** Not documented for NetSuite [UNKNOWN]
- **Backoff strategy:** Exponential backoff starting at 1s (1s, 2s, 4s, 8s) [INFERRED]

### 8.2 Error Handling [REQUIRED]

**Standard error response format (REST):** [DOCUMENTED]

```json
{
  "type": "https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html",
  "title": "Bad Request",
  "status": 400,
  "o:errorDetails": [
    {
      "detail": "Error while accessing resource: Invalid field value.",
      "o:errorCode": "INVALID_CONTENT",
      "o:errorPath": "item.items[0].item"
    }
  ]
}
```

**Error codes reference:**

| HTTP Status | Error Code                 | Meaning                      | Retryable? | Recovery Action        |
| ----------- | -------------------------- | ---------------------------- | ---------- | ---------------------- |
| 400         | INVALID_CONTENT            | Bad field value              | No         | Fix per o:errorPath    |
| 400         | INVALID_REQUEST            | Malformed request            | No         | Fix request syntax     |
| 401         | INVALID_LOGIN              | Auth failed / token expired  | Yes        | Refresh OAuth token    |
| 403         | Forbidden                  | Insufficient permissions     | No         | Check role permissions |
| 404         | NONEXISTENT_ID             | Record not found             | No         | Verify record ID       |
| 429         | CONCURRENCY_LIMIT_EXCEEDED | Too many concurrent requests | Yes        | Exponential backoff    |
| 429         | USER_ERROR                 | Rate/frequency limit         | Yes        | Backoff + retry        |
| 500         | UNEXPECTED_ERROR           | Server error                 | Yes        | Retry with backoff     |

**MCP-specific error format:** [UNKNOWN] -- MCP errors likely wrapped in JSON-RPC error response format.

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** No [INFERRED]
- **Which methods are naturally idempotent:**
  - ns_getRecord: Yes [CONFIRMED]
  - ns_getRecordTypeMetadata: Yes [CONFIRMED]
  - ns_listAllReports: Yes [CONFIRMED]
  - ns_runReport: Yes [CONFIRMED]
  - ns_getSuiteQLMetadata: Yes [CONFIRMED]
  - ns_runCustomSuiteQL: Yes [CONFIRMED]
  - ns_listSavedSearches: Yes [CONFIRMED]
  - ns_runSavedSearch: Yes [CONFIRMED]
  - ns_getSubsidiaries: Yes [CONFIRMED]
  - ns_createRecord: No (creates duplicate) [CONFIRMED]
  - ns_updateRecord: No (per MCP annotation, but functionally idempotent if same data sent) [CONFIRMED]

### 8.5 File Handling [IMPORTANT]

No file upload/download tools in the MCP Standard Tools SuiteApp. File handling requires the REST API directly:

- **Upload:** PUT to `/services/rest/record/v1/{recordType}/{id}/files/{filename}` [DOCUMENTED]
- **Download:** GET from file cabinet endpoints [DOCUMENTED]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                            | Fits?   | Notes                                                             |
| -------------------------- | -------------------------------------- | ------- | ----------------------------------------------------------------- |
| **Data Connector**         | API has browsable structured content   | Partial | Has records, but access is via generic MCP tools not file-like    |
| **Data Connector (Files)** | File storage/document system           | No      | MCP tools do not expose file cabinet                              |
| **Direct API Only**        | Action-oriented (no browsable content) | No      | Has significant read capabilities                                 |
| **Hybrid**                 | Both browsable content AND actions     | **Yes** | Read via SuiteQL/saved searches + write via create/update records |

**Selected integration path:** Data Connector (OAuth2) -- per-account URLs, custom MCP protocol

**Justification:** NetSuite MCP is primarily accessed via a custom MCP endpoint that requires per-account OAuth 2.0 with PKCE. The integration path is "Data Connector" because:

1. OAuth 2.0 auth flow needs the standard connector token management
2. Per-account URLs (account ID in hostname) require connector configuration
3. The MCP tools provide both query (SuiteQL, saved searches, reports) and mutation (create/update records) capabilities
4. No file browsing -- this is structured data access, not file storage

### 9.2 Connector Requirements [IMPORTANT]

| Connector Method     | MCP Tool Mapping                  | Notes                                  |
| -------------------- | --------------------------------- | -------------------------------------- |
| N/A (not file-based) | ns_runCustomSuiteQL               | Primary query tool for structured data |
| N/A                  | ns_getRecord                      | Single record retrieval                |
| N/A                  | ns_createRecord / ns_updateRecord | Record mutations                       |
| N/A                  | ns_runSavedSearch                 | Pre-built query execution              |
| N/A                  | ns_runReport                      | Financial reporting                    |

**Auth type for connector:** OAuth 2.0 Authorization Code with PKCE (public client) [CONFIRMED]
**Connector category:** erp [CONFIRMED]
**Caching appropriate:** Yes for metadata calls (ns_getRecordTypeMetadata, ns_getSuiteQLMetadata) [INFERRED]
**Caching policy:** Cache metadata for 1 hour; do not cache query results [INFERRED]

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Query any record type via SuiteQL (customers, orders, invoices, items, etc.)
2. Retrieve individual records by ID with field selection
3. Create new records (customers, sales orders, invoices, etc.)
4. Update existing records
5. Run financial reports with date ranges and subsidiary filters
6. Execute saved searches with pagination
7. Discover record types and field metadata
8. Discover SuiteQL table schemas for ad-hoc queries

**CANNOT do (out of scope or dangerous):**

1. Delete records (no delete tool in MCP Standard Tools)
2. Upload or download files (no file tools in MCP Standard Tools)
3. Manage user accounts or roles
4. Modify SuiteScript customizations
5. Access NetSuite admin functions
6. Execute bulk operations (must process records individually)
7. Set up webhooks or event subscriptions
8. Access audit trails directly

**Default parameters:**

| Parameter          | Default         | Reason                                         |
| ------------------ | --------------- | ---------------------------------------------- |
| SuiteQL pageSize   | 100             | Balance between data retrieval and performance |
| Saved search range | 0-99 (100 rows) | Reasonable first page for user review          |
| Report dateTo      | Current date    | Most common use case                           |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK         | Language | Quality | Maintained? | Worth Using? | Notes                                                    |
| ----------- | -------- | ------- | ----------- | ------------ | -------------------------------------------------------- |
| None        | --       | --      | --          | No           | No official SDK for MCP endpoint. Use raw HTTP.          |
| SuiteScript | JS       | Good    | Yes         | N/A          | Platform-internal only, not usable from external clients |

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed
- [x] Phase 2 complete: auth working, first call documented (tools/list from AEW)
- [x] Phase 3 complete: core entities documented (generic record model + SuiteQL)
- [x] Phase 4 complete: all 11 MCP tools documented with input schemas
- [x] Phase 5 complete: SuiteQL query and filter patterns documented
- [x] Phase 6 complete: pagination models documented (range-based + ROWNUM)
- [x] Phase 7 complete: event-driven capabilities assessed (none native)
- [x] Phase 8 complete: rate limits (concurrency governance) and error format documented
- [x] Phase 9 complete: integration path selected (Data Connector OAuth2)

**Overall investigation confidence:** high

**Known gaps that will reduce output quality:**

1. MCP tool response body formats are not documented -- input schemas are [CONFIRMED] but outputs are [UNKNOWN]
2. Exact frequency rate limits (per-minute, per-24h) are not publicly documented with specific numbers
3. MCP-specific error format (as opposed to REST error format) is [UNKNOWN]

### 10.2 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps                                                                                  |
| ---------------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------- |
| 01-llm-api-rules             | Yes           | High       | Response body formats unknown                                                         |
| 01a-domain-model-reference   | Yes           | High       | Field details are dynamic per record type                                             |
| 01b-query-patterns           | Yes           | High       | SuiteQL well-documented                                                               |
| 01c-mutation-patterns        | Yes           | Medium     | Create/update data format is stringified JSON; exact field names per record type vary |
| 01d-event-and-error-handling | Yes           | Medium     | No native events; REST error format documented, MCP error format unknown              |
| 02-api-spec-investigation    | Yes           | High       | Comprehensive tool catalog available                                                  |
| 03-connector-setup           | Yes           | Medium     | Custom connector pattern (not standard file-based)                                    |

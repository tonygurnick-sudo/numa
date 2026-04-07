---
api_name: 'NetSuite AI Connector Service (MCP)'
api_slug: 'netsuite'
base_url: 'https://{accountid}.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools'
version: 'MCP Protocol 2025-06-18'
spec_format: 'none'
spec_url: ''
docs_url: 'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0714082142.html'
date_researched: '2026-03-30'
---

# NetSuite AI Connector Service (MCP) -- API Specification & Investigation

> Clean developer reference for the NetSuite MCP integration. This document condenses
> the investigation questionnaire into everything a developer needs to integrate.

---

## Overview

- **Vendor:** Oracle NetSuite
- **API version:** MCP Protocol 2025-06-18
- **Base URL:** `https://{accountid}.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools`
- **Alt URL (all tools):** `https://{accountid}.suitetalk.api.netsuite.com/services/mcp/v1/all`
- **API type:** MCP (JSON-RPC 2.0 over HTTP POST)
- **Data format:** JSON
- **Documentation:** [Oracle NetSuite AI Connector Service](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0714082142.html)
- **FAQ:** [AI Connector Service FAQ](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_4160616848.html)
- **REST API Browser:** [Record API Reference](https://system.netsuite.com/help/helpcenter/en_US/APIs/REST_API_Browser/record/v1/2024.1/index.html)
- **Status page:** [status.netsuite.com](https://status.netsuite.com)
- **OpenAPI spec:** Not available

**Summary:** NetSuite's AI Connector Service exposes ERP data (customers, orders, invoices, items, GL, etc.) via the Model Context Protocol (MCP). It provides 11 standard tools for CRUD operations on any record type, SuiteQL queries, saved searches, and financial reports. Each NetSuite account has its own endpoint URL with the account ID in the hostname.

---

## Authentication

### Method: OAuth 2.0 Authorization Code with PKCE (Public Client)

NetSuite MCP uses per-account OAuth 2.0. There is no central authorization server. Each customer's NetSuite account has its own OAuth endpoints.

**Header format:**

```
Authorization: Bearer {jwt_access_token}
```

**OAuth 2.0 Configuration:**

| Parameter         | Value                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| Grant type        | Authorization Code with PKCE                                                            |
| Authorization URL | `https://{accountid}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/authorize` |
| Token URL         | `https://{accountid}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`     |
| Revocation URL    | Unknown                                                                                 |
| Token lifetime    | ~3600 seconds                                                                           |
| Token format      | JWT (RS256)                                                                             |
| Refresh mechanism | Standard OAuth 2.0 refresh token flow                                                   |
| PKCE required     | Yes                                                                                     |
| Client type       | Public (no client secret)                                                               |

**Required scopes:**

| Scope | Purpose                         | Required? |
| ----- | ------------------------------- | --------- |
| `mcp` | MCP AI Connector Service access | Yes       |

**Prerequisites (customer must complete):**

1. Enable OAuth 2.0, Server SuiteScript, and REST Web Services features
2. Create a custom role with "MCP Server Connection" and "OAuth 2.0 Access Tokens" permissions
3. Create an Integration Record with "NetSuite AI Connector Service" scope enabled and "Public Client" checked
4. **The Administrator role does NOT work** -- must use a custom role
5. Configure redirect URI in the integration record

---

## MCP Protocol Details

### JSON-RPC 2.0 Invocation

All MCP tool calls are HTTP POST requests to the MCP endpoint:

```http
POST /services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools HTTP/1.1
Host: {accountid}.suitetalk.api.netsuite.com
Authorization: Bearer {token}
Content-Type: application/json

{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "tool_name", "arguments": {...}}}
```

### Discovery

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
```

Returns all 11 available tools with input schemas and annotations.

---

## Tool Catalog (11 Tools) [CONFIRMED]

### Metadata & Discovery Tools

| #   | Tool                       | Purpose                     | Input                   | Prerequisite |
| --- | -------------------------- | --------------------------- | ----------------------- | ------------ |
| 1   | `ns_getRecordTypeMetadata` | Record type field schemas   | `recordType` (optional) | None         |
| 2   | `ns_getSuiteQLMetadata`    | SuiteQL table/field schemas | `recordType` (optional) | None         |

### Record CRUD Tools

| #   | Tool              | Purpose             | Input                                                                | Prerequisite             |
| --- | ----------------- | ------------------- | -------------------------------------------------------------------- | ------------------------ |
| 3   | `ns_getRecord`    | Get a single record | `recordType` (req), `recordId` (req), `fields` (opt)                 | None                     |
| 4   | `ns_createRecord` | Create a record     | `recordType` (req), `data` (req, stringified JSON)                   | ns_getRecordTypeMetadata |
| 5   | `ns_updateRecord` | Update a record     | `recordType` (req), `recordId` (req), `data` (req, stringified JSON) | ns_getRecordTypeMetadata |

### Query Tools

| #   | Tool                   | Purpose              | Input                                                                          | Prerequisite |
| --- | ---------------------- | -------------------- | ------------------------------------------------------------------------------ | ------------ |
| 6   | `ns_runCustomSuiteQL`  | Execute SQL queries  | `sqlQuery` (req), `description` (req), `pageSize` (opt)                        | None         |
| 7   | `ns_listSavedSearches` | List saved searches  | `query` (opt)                                                                  | None         |
| 8   | `ns_runSavedSearch`    | Execute saved search | `searchId` (req), `type` (conditional), `range_start` (opt), `range_end` (opt) | None         |

### Report Tools

| #   | Tool                 | Purpose                | Input                                                                                    | Prerequisite      |
| --- | -------------------- | ---------------------- | ---------------------------------------------------------------------------------------- | ----------------- |
| 9   | `ns_listAllReports`  | List available reports | (none)                                                                                   | None              |
| 10  | `ns_runReport`       | Execute a report       | `reportId` (req), `dateTo` (req), `dateFrom` (conditional), `subsidiaryId` (conditional) | ns_listAllReports |
| 11  | `ns_getSubsidiaries` | List subsidiaries      | (none)                                                                                   | None              |

### Tool Annotations [CONFIRMED]

All tools have the following annotations:

- Read-only tools: `readOnly=true, idempotent=true`
- Write tools (create/update): `readOnly=false, destructive=true, idempotent=false`
- **Note:** All tools report `destructiveHint: true` regardless -- this is a NetSuite default, not meaningful.

---

## Data Models

### Common Record Types

| Record Type     | SuiteQL Table                   | Category    | Key Fields                                            |
| --------------- | ------------------------------- | ----------- | ----------------------------------------------------- |
| `customer`      | `customer`                      | Entity      | id, companyname, email, phone, balance, subsidiary    |
| `vendor`        | `vendor`                        | Entity      | id, companyname, email, phone, balance, subsidiary    |
| `employee`      | `employee`                      | Entity      | id, firstname, lastname, email, department            |
| `contact`       | `contact`                       | Entity      | id, firstname, lastname, email, company               |
| `salesorder`    | `transaction` (type='SalesOrd') | Transaction | id, tranid, entity, trandate, total, status           |
| `invoice`       | `transaction` (type='CustInvc') | Transaction | id, tranid, entity, trandate, total, amountremaining  |
| `purchaseorder` | `transaction` (type='PurchOrd') | Transaction | id, tranid, entity, trandate, total                   |
| `vendorbill`    | `transaction` (type='VendBill') | Transaction | id, tranid, entity, trandate, total                   |
| `inventoryitem` | `item` (itemtype='InvtPart')    | Item        | id, itemid, displayname, baseprice, quantityavailable |
| `serviceitem`   | `item` (itemtype='Service')     | Item        | id, itemid, displayname, baseprice                    |
| `journalentry`  | `transaction` (type='Journal')  | Transaction | id, tranid, trandate, memo                            |

### Key Relationships

- `transaction.entity` -> `customer.id` or `vendor.id`
- `transactionline.transaction` -> `transaction.id`
- `transactionline.item` -> `item.id`
- `contact.company` -> `customer.id` or `vendor.id`
- `*.subsidiary` -> `subsidiary.id`

### SuiteQL Transaction Type Codes

| Code       | Record Type      |
| ---------- | ---------------- |
| `SalesOrd` | Sales Order      |
| `CustInvc` | Invoice          |
| `PurchOrd` | Purchase Order   |
| `VendBill` | Vendor Bill      |
| `CustPymt` | Customer Payment |
| `VendPymt` | Vendor Payment   |
| `Journal`  | Journal Entry    |
| `ItemShip` | Item Fulfillment |
| `ItemRcpt` | Item Receipt     |
| `Estimate` | Quote/Estimate   |
| `CustCred` | Credit Memo      |
| `CashSale` | Cash Sale        |

---

## Pagination

### SuiteQL (via ns_runCustomSuiteQL)

- **Type:** ROWNUM-based (Oracle dialect) + `pageSize` parameter
- **Default page size:** Unknown
- **Max per call:** 5,000 rows
- **Hard cap total:** 100,000 rows
- **Row limiting:** Use `ROWNUM` (not LIMIT/OFFSET)

**ROWNUM pagination pattern:**

```sql
-- Page 1 (rows 1-100)
SELECT * FROM (SELECT id, companyname, ROWNUM rn FROM customer WHERE ROWNUM <= 100) WHERE rn > 0

-- Page 2 (rows 101-200)
SELECT * FROM (SELECT id, companyname, ROWNUM rn FROM customer WHERE ROWNUM <= 200) WHERE rn > 100
```

### Saved Searches (via ns_runSavedSearch)

- **Type:** Range-based (range_start / range_end)
- **Detection:** Fewer results returned than requested range = last page

```json
{"searchId": "123", "range_start": 0, "range_end": 99}   // Page 1
{"searchId": "123", "range_start": 100, "range_end": 199} // Page 2
```

### SuiteQL REST (direct, not via MCP)

- **Endpoint:** `POST /services/rest/query/v1/suiteql?limit=N&offset=N`
- **Response:** `{ "count": N, "offset": N, "totalResults": N, "hasMore": bool, "items": [...] }`
- **Requires header:** `Prefer: transient`

---

## Rate Limits

| Scope                         | Limit        | Window       |
| ----------------------------- | ------------ | ------------ |
| Account concurrency (default) | 15           | Simultaneous |
| Per SuiteCloud Plus license   | +10          | Additional   |
| Max (Tier 5)                  | 55           | Simultaneous |
| SuiteQL per call              | 5,000 rows   | Per request  |
| SuiteQL total                 | 100,000 rows | Per query    |

**When exceeded:** 429 status with `CONCURRENCY_LIMIT_EXCEEDED` error code.

**Recommended strategy:** Exponential backoff starting at 1 second, doubling to max 30 seconds, with random jitter.

**Note:** No `Retry-After` header is returned. No standard rate limit headers are provided.

---

## Error Handling

**Standard error format:**

```json
{
  "type": "https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html",
  "title": "Bad Request",
  "status": 400,
  "o:errorDetails": [{ "detail": "description", "o:errorCode": "CODE", "o:errorPath": "field.path" }]
}
```

**Status codes:**

| Status | Meaning                  | Retryable | Recovery                       |
| ------ | ------------------------ | --------- | ------------------------------ |
| 400    | Bad request / validation | No        | Fix per o:errorPath            |
| 401    | Token expired / invalid  | Yes       | Refresh OAuth token            |
| 403    | Insufficient permissions | No        | Check role (NOT Administrator) |
| 404    | Record not found         | No        | Verify type and ID             |
| 429    | Concurrency limit        | Yes       | Exponential backoff            |
| 500    | Server error             | Yes       | Retry with backoff             |

---

## Webhooks / Events

No native webhook support. NetSuite requires custom SuiteScript development for event-driven behavior.

**Polling alternative:** Use `ns_runCustomSuiteQL` with `WHERE lastmodifieddate >= TO_DATE(...)` to detect changes.

---

## Known Limitations

1. **No delete tool** in MCP Standard Tools -- cannot delete records via MCP
2. **No file upload/download** -- file cabinet not exposed via MCP tools
3. **No bulk operations** -- must process records individually
4. **No native webhooks/events** -- requires custom SuiteScript
5. **SuiteQL Oracle dialect only** -- no CTEs, no LIMIT/OFFSET, max 1000 items in IN clause
6. **Per-account URLs** -- every customer has a different hostname based on account ID
7. **Administrator role incompatible** -- must use a custom role for MCP access
8. **All tools report destructiveHint: true** -- misleading annotation, ignore for read-only tools
9. **Response body formats undocumented** -- tool input schemas are confirmed, outputs are not formally documented
10. **Concurrency shared** -- MCP tools share the same concurrency pool with all other API integrations

---

## SDKs & Tooling

| SDK         | Language   | Repository           | Quality | Notes                            |
| ----------- | ---------- | -------------------- | ------- | -------------------------------- |
| None        | --         | --                   | --      | No official SDK for MCP endpoint |
| SuiteScript | JavaScript | Built-in to NetSuite | Good    | Platform-internal only           |

**Postman collection:** Community guides available; no official collection
**OpenAPI spec:** Not available

---

## Integration Path Assessment

**Recommended path:** Data Connector (OAuth2) -- per-account URLs with custom MCP protocol

**Justification:** NetSuite MCP requires per-account OAuth 2.0 PKCE authentication with account-specific hostnames. The connector must:

1. Store the account ID for URL construction
2. Manage OAuth 2.0 tokens (JWT access tokens, refresh tokens)
3. Make JSON-RPC 2.0 calls to the MCP endpoint
4. Handle the unique "stringified JSON" data parameter format

**This is NOT a standard file-based connector.** It is a structured data connector that uses MCP tools for CRUD operations and SQL-like queries against the NetSuite ERP.

---

_Researched on 2026-03-30. Source: Investigation questionnaire, Oracle documentation, live tools/list response from AEW (Account ID: 5721181)._

---
api_name: NetSuite AI Connector Service (MCP)
api_slug: netsuite
doc: developer spec / investigation reference (on-demand)
base_url: https://{accountid}.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools
alt_base_url: https://{accountid}.suitetalk.api.netsuite.com/services/mcp/v1/all (all tools)
path_version_segment: literal `/v1/` IS in the path (real segment). `version` below = MCP protocol revision, NOT a path component.
mcp_protocol_version: 2025-06-18
api_type: MCP (JSON-RPC 2.0 over HTTP POST); data format JSON
auth: OAuth 2.0 Authorization Code + PKCE, per-account
spec_format: none (no OpenAPI)
docs_url: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0714082142.html
date_researched: 2026-03-30 (live tools/list from account 5721181)
confidence: [CONFIRMED] unless tagged [UNKNOWN]
---

# NetSuite AI Connector Service (MCP) — Dev Spec

Condensed developer reference for the NetSuite MCP integration.

## Overview

- Vendor: Oracle NetSuite. MCP protocol 2025-06-18. Per-account: every endpoint has the account ID in the hostname; no global endpoint.
- Base URL: `https://{accountid}.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools` (alt all-tools: `…/services/mcp/v1/all`).
- 11 standard tools: CRUD on any record type, SuiteQL, saved searches, financial reports.
- Docs: [AI Connector Service](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0714082142.html) · [FAQ](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_4160616848.html) · [REST API Browser](https://system.netsuite.com/help/helpcenter/en_US/APIs/REST_API_Browser/record/v1/2024.1/index.html) · [status.netsuite.com](https://status.netsuite.com). No OpenAPI spec.

## Authentication — OAuth 2.0 Authorization Code + PKCE (public client)

Per-account; no central authorization server. Header: `Authorization: Bearer {jwt_access_token}`. Full setup in 03-connector-setup.md and 04-connection-and-reauth.md.
| Parameter | Value |
| --- | --- |
| Grant types | `authorization_code` (PKCE) + `refresh_token` |
| Authorize URL | `https://{accountid}.app.netsuite.com/app/login/oauth2/authorize.nl` |
| Authorize fallback (unknown account) | `https://system.netsuite.com/app/login/oauth2/authorize.nl` |
| Token URL | `https://{accountid}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token` |
| Access token | JWT (RS256), 3600s (1 hr) |
| Refresh token (confidential) | 7 days, reusable until expiry |
| Refresh token (public) | 2 days default, configurable 1–720 hrs; **rotates every refresh (one-time use)** |
| PKCE method | `S256` only (`plain` removed in 2020.2) |
| `code_verifier` | 43–128 chars, `[A-Za-z0-9-._~]` |
| `state` | 22–1024 chars, printable ASCII, unique per flow |
| Client types | Public (PKCE, no secret) or confidential (client_secret); PKCE required for both when scope is `mcp` |

**Scopes (one per integration record):** `rest_webservices`=SuiteTalk REST (Record + SuiteQL) · `restlets`=RESTlet endpoints · `suite_analytics`=SuiteAnalytics Connect · `mcp`=AI Connector Service (**EXCLUSIVE — cannot combine with the others**).

**Customer prerequisites:** (1) enable OAuth 2.0, REST Web Services, Server SuiteScript; (2) create Integration Record with the desired scope + Authorization Code Grant checked, mark Public Client if no secret; (3) for MCP only, create a custom role (Administrator does NOT work) with `MCP Server Connection` + `OAuth 2.0 Access Tokens`; (4) configure redirect URI matching the authorize URL byte-for-byte.

## MCP protocol

All tool calls are HTTP POST to the endpoint:

```http
POST /services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools HTTP/1.1
Host: {accountid}.suitetalk.api.netsuite.com
Authorization: Bearer {token}
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"tool_name","arguments":{...}}}
```

Discovery: `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}` → all 11 tools with input schemas + annotations.

## Tool catalog (11)

| #   | Tool                       | Purpose                     | Input                                                               | Prerequisite             |
| --- | -------------------------- | --------------------------- | ------------------------------------------------------------------- | ------------------------ |
| 1   | `ns_getRecordTypeMetadata` | Record-type field schemas   | `recordType` (opt)                                                  | None                     |
| 2   | `ns_getSuiteQLMetadata`    | SuiteQL table/field schemas | `recordType` (opt)                                                  | None                     |
| 3   | `ns_getRecord`             | Get one record              | `recordType` req, `recordId` req, `fields` opt                      | None                     |
| 4   | `ns_createRecord`          | Create                      | `recordType` req, `data` req (stringified JSON)                     | ns_getRecordTypeMetadata |
| 5   | `ns_updateRecord`          | Update                      | `recordType` req, `recordId` req, `data` req (stringified JSON)     | ns_getRecordTypeMetadata |
| 6   | `ns_runCustomSuiteQL`      | Execute SQL                 | `sqlQuery` req, `description` req, `pageSize` opt                   | None                     |
| 7   | `ns_listSavedSearches`     | List saved searches         | `query` opt                                                         | None                     |
| 8   | `ns_runSavedSearch`        | Run saved search            | `searchId` req, `type` conditional, `range_start`/`range_end` opt   | None                     |
| 9   | `ns_listAllReports`        | List reports                | (none)                                                              | None                     |
| 10  | `ns_runReport`             | Run report                  | `reportId` req, `dateTo` req, `dateFrom`/`subsidiaryId` conditional | ns_listAllReports        |
| 11  | `ns_getSubsidiaries`       | List subsidiaries           | (none)                                                              | None                     |

**Annotations [CONFIRMED]:** read-only tools `readOnly=true, idempotent=true`; write tools `readOnly=false, destructive=true, idempotent=false`. All tools report `destructiveHint: true` regardless — NetSuite default, not meaningful.

## Data models — common record types

| Record type     | SuiteQL table                   | Category    | Key fields                                            |
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

**Relationships:** `transaction.entity`→`customer.id`/`vendor.id` · `transactionline.transaction`→`transaction.id` · `transactionline.item`→`item.id` · `contact.company`→`customer.id`/`vendor.id` · `*.subsidiary`→`subsidiary.id`.
**Transaction `type` codes:** `SalesOrd` `CustInvc` `PurchOrd` `VendBill` `CustPymt` `VendPymt` `Journal` `ItemShip` `ItemRcpt` `Estimate` `CustCred` `CashSale`.

## Pagination

- **SuiteQL (`ns_runCustomSuiteQL`):** ROWNUM-based (Oracle) + `pageSize` param. Default page size unknown; 5,000 rows/call; 100,000 total/query. Use `ROWNUM` (not LIMIT/OFFSET). Page 1: `SELECT * FROM (SELECT id, companyname, ROWNUM rn FROM customer WHERE ROWNUM <= 100) WHERE rn > 0`; page 2: `… WHERE ROWNUM <= 200) WHERE rn > 100`.
- **Saved searches (`ns_runSavedSearch`):** range-based; last page when fewer results than range. `{"searchId":"123","range_start":0,"range_end":99}` then `100/199`.
- **SuiteQL REST (direct, not MCP):** `POST /services/rest/query/v1/suiteql?limit=N&offset=N` with `Prefer: transient` → `{"count":N,"offset":N,"totalResults":N,"hasMore":bool,"items":[…]}`.

## Rate limits

| Scope                         | Limit        | Window       |
| ----------------------------- | ------------ | ------------ |
| Account concurrency (default) | 15           | Simultaneous |
| Per SuiteCloud Plus license   | +10          | Additional   |
| Max (Tier 5)                  | 55           | Simultaneous |
| SuiteQL per call              | 5,000 rows   | Per request  |
| SuiteQL total                 | 100,000 rows | Per query    |

Exceeded → 429 `CONCURRENCY_LIMIT_EXCEEDED`. No `Retry-After` / standard rate-limit headers. Exponential backoff from 1s, doubling to 30s max, with jitter.

## Error handling

`{"type":"https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html","title":"Bad Request","status":400,"o:errorDetails":[{"detail":"description","o:errorCode":"CODE","o:errorPath":"field.path"}]}`
| Status | Meaning | Retryable | Recovery |
| --- | --- | --- | --- |
| 400 | Bad request / validation | No | Fix per `o:errorPath` |
| 401 | Token expired/invalid | Yes | Refresh OAuth token |
| 403 | Insufficient permissions | No | Check role (NOT Administrator) |
| 404 | Record not found | No | Verify type + id |
| 429 | Concurrency limit | Yes | Exponential backoff |
| 500 | Server error | Yes | Retry with backoff |
(Full code reference: 01d-event-and-error-handling.md.)

## Webhooks / events

No native webhook support; requires custom SuiteScript. Polling alternative: `ns_runCustomSuiteQL` with `WHERE lastmodifieddate >= TO_DATE(...)`.

## Limitations & tooling

- No delete tool · no file upload/download (file cabinet not exposed) · no bulk ops (one record at a time) · no native webhooks/events · SuiteQL Oracle-dialect only (no CTEs, no LIMIT/OFFSET, `IN` max 1000) · per-account hostnames · Administrator role incompatible (custom role required) · all tools report misleading `destructiveHint: true` · response body formats undocumented [UNKNOWN] (input schemas confirmed) · concurrency pool shared with all integrations.
- **SDKs:** no official SDK for the MCP endpoint. SuiteScript (JavaScript) is platform-internal only. No official Postman collection / OpenAPI spec.

## Integration path

Data Connector (OAuth2) — per-account URLs with custom MCP protocol. The connector must: store the account ID for URL construction; manage OAuth 2.0 tokens (JWT access + refresh); make JSON-RPC 2.0 calls; handle the stringified-JSON `data` param. **NOT a file-based connector** — a structured data connector using MCP tools for CRUD + SQL-like queries against NetSuite ERP.

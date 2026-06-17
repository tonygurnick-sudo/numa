---
api_name: NetSuite AI Connector Service (MCP)
api_slug: netsuite
call_surface: MCP — invoke via `mcp_call` (JSON-RPC 2.0 tools). NOT `numa integrations request`. For the REST/SuiteQL surface see 01-llm-api-rest-rules.md.
mcp_endpoint: https://{accountid}.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools
base_url_is_per_account: yes — {accountid} is in the hostname; no global endpoint
path_version_segment: literal `/v1/` IS in the MCP path (real segment, not a label)
auth: OAuth 2.0 Authorization Code + PKCE (public client, scope=mcp). Bearer {jwt}, RS256, ~3600s.
content_type: application/json
tools: 11 standard tools from `com.netsuite.mcpstandardtools` SuiteApp
field_casing: lowercase (NetSuite field ids, e.g. companyname, lastmodifieddate)
id_format: integer internal id; passed as STRING in MCP tool params
rate_limit: concurrency-based (default 15 simultaneous, shared with all integrations); no Retry-After header
mcp_vs_rest: mcp scope is EXCLUSIVE on an integration record — cannot combine with rest_webservices/restlets/suite_analytics. REST call returning `INVALID_LOGIN_ATTEMPT — Insufficient scope` ⇒ record is mcp-scoped, use mcp_call.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors, 02=dev-spec, 03=connector-setup, 04=reauth
---

# NetSuite MCP — API Rules

## Surface (read first)

- Call via `mcp_call` only (JSON-RPC 2.0). This connector does NOT use `numa integrations request` — that hits REST, a separate scope. If a REST attempt returns `Insufficient scope`, the record is mcp-scoped → use `mcp_call`.
- Endpoint: `https://{accountid}.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools`. `{accountid}` is literal in the hostname; `/v1/` is a REAL path segment.
- Generic record API: no entity-specific tools. `recordType` string parameter selects the entity.

## Critical rules (violations = broken requests)

1. **Call `ns_getRecordTypeMetadata` BEFORE `ns_createRecord`/`ns_updateRecord`** — you need field names/types; skipping → malformed payloads.
2. **`data` param for create/update = STRINGIFIED JSON, not a raw object.** OK: `"data": "{\"companyname\": \"Acme\"}"`. WRONG: `"data": {"companyname":"Acme"}`.
3. **Call `ns_listAllReports` BEFORE `ns_runReport`** — need the report `id` and `has_subsidiary_filter`. If `has_subsidiary_filter` is true, call `ns_getSubsidiaries` first.
4. **`ns_runCustomSuiteQL` requires BOTH `sqlQuery` AND `description`** (mandatory brief English description).
5. **SuiteQL is Oracle-dialect SQL, NOT standard SQL:**
   - Concat `||` (not `+`/`CONCAT`). Dates `TO_DATE('2024-01-01','YYYY-MM-DD')`. Null `NVL(field,default)` (not ISNULL/IFNULL). Substring `SUBSTR(str,pos,len)` (not SUBSTRING). Row limit `ROWNUM` (not LIMIT/OFFSET/TOP).
   - NO CTEs (`WITH … AS`), NO recursive queries. `IN` clause max 1000 items. Booleans `'T'`/`'F'` (not true/false). Strings use single quotes; double quotes = identifiers.
6. **SuiteQL result caps:** 5,000 rows per MCP call; 100,000 rows total per query. Always include a `ROWNUM` limit to avoid timeouts.
7. **No delete tool** in MCP Standard Tools — cannot delete via MCP. Tell the user; suggest `isinactive='T'` (soft-delete) or status void for transactions.
8. **All 11 tools report `destructiveHint: true`** — NetSuite default, meaningless. Only `ns_createRecord`/`ns_updateRecord` modify data.
9. **Administrator role does NOT work for MCP** — requires a custom role with `MCP Server Connection` + `OAuth 2.0 Access Tokens`.

## Tools (11)

| Tool                       | Purpose                                                                              | R/W | Prerequisite                      |
| -------------------------- | ------------------------------------------------------------------------------------ | --- | --------------------------------- |
| `ns_getRecordTypeMetadata` | Discover record fields/types (`recordType` opt)                                      | R   | None                              |
| `ns_getSuiteQLMetadata`    | Discover SuiteQL table schemas/join paths (`recordType` opt)                         | R   | None                              |
| `ns_getRecord`             | Get one record (`recordType`,`recordId` req; `fields` opt)                           | R   | None                              |
| `ns_createRecord`          | Create (`recordType` req; `data` req stringified)                                    | W   | ns_getRecordTypeMetadata          |
| `ns_updateRecord`          | Update by id (`recordType`,`recordId` req; `data` req stringified)                   | W   | ns_getRecordTypeMetadata          |
| `ns_runCustomSuiteQL`      | Ad-hoc SQL (`sqlQuery`,`description` req; `pageSize` opt)                            | R   | ns_getSuiteQLMetadata recommended |
| `ns_listSavedSearches`     | List saved searches (`query` opt)                                                    | R   | None                              |
| `ns_runSavedSearch`        | Run saved search (`searchId` req; `type` conditional; `range_start`/`range_end` opt) | R   | None                              |
| `ns_listAllReports`        | List reports                                                                         | R   | None                              |
| `ns_runReport`             | Run report (`reportId`,`dateTo` req; `dateFrom`/`subsidiaryId` conditional)          | R   | ns_listAllReports                 |
| `ns_getSubsidiaries`       | List subsidiaries (consolidated = negative id)                                       | R   | None                              |

## Common SuiteQL tables

| Table             | Description                                       | Common fields                                      |
| ----------------- | ------------------------------------------------- | -------------------------------------------------- |
| `customer`        | Customers                                         | id, companyname, email, phone, balance, subsidiary |
| `vendor`          | Vendors/suppliers                                 | id, companyname, email, phone                      |
| `employee`        | Employees                                         | id, firstname, lastname, email                     |
| `transaction`     | All transaction types (unified; filter by `type`) | id, type, tranid, entity, trandate, total, status  |
| `transactionline` | Transaction line items                            | id, transaction, item, quantity, rate, amount      |
| `item`            | All item types                                    | id, itemid, displayname, itemtype, baseprice       |
| `contact`         | Contacts                                          | id, firstname, lastname, email, company            |
| `account`         | Chart of accounts                                 | id, acctnumber, acctname, accttype                 |

**Transaction `type` codes:** `SalesOrd` `CustInvc` `PurchOrd` `VendBill` `CustPymt` `VendPymt` `Journal` `ItemShip` `ItemRcpt` `Estimate` `CustCred` `RtnAuth` `CashSale`.

## Pagination

- **SuiteQL** — use `ROWNUM` (no LIMIT/OFFSET). ROWNUM is applied BEFORE ORDER BY, so to page sorted results nest the sorted query first.
  - Rows 101–200: `SELECT * FROM (SELECT id, companyname, ROWNUM rn FROM customer WHERE ROWNUM <= 200) WHERE rn > 100`
- **Saved searches** — `range_start`/`range_end`; last page when fewer results than range size:
  - `{"name":"ns_runSavedSearch","arguments":{"searchId":"123","range_start":0,"range_end":99}}`

## Errors

REST-style envelope wraps tool errors: `{"status":400,"o:errorDetails":[{"detail":"…","o:errorCode":"INVALID_CONTENT","o:errorPath":"item.items[0].item"}]}`. Branch on `o:errorCode`:
| Status | Code | Meaning | Action |
| --- | --- | --- | --- |
| 400 | INVALID_CONTENT | Bad field value | Read `o:errorPath`, fix field |
| 400 | INVALID_REQUEST | Malformed request | Fix syntax (check stringified JSON) |
| 401 | INVALID_LOGIN | Token expired | Refresh OAuth token, retry |
| 403 | (none) | Insufficient permissions | Check role (Administrator does NOT work) |
| 404 | NONEXISTENT_ID | Record not found | Verify recordType + internal id |
| 429 | CONCURRENCY_LIMIT_EXCEEDED | Too many concurrent | Exponential backoff 1s,2s,4s,… (no Retry-After) |
| 500 | UNEXPECTED_ERROR | Server error | Retry with backoff |

## Examples

1. **Query customers by name (SuiteQL):**
   `{"name":"ns_runCustomSuiteQL","arguments":{"sqlQuery":"SELECT id, companyname, email, phone FROM customer WHERE companyname LIKE '%Electrical%' ORDER BY companyname","description":"Find customers with Electrical in their name"}}`

2. **Get one record:**
   `{"name":"ns_getRecord","arguments":{"recordType":"customer","recordId":"12345","fields":"companyname,email,phone,balance"}}`

3. **Create a customer (call ns_getRecordTypeMetadata first):**
   `{"name":"ns_createRecord","arguments":{"recordType":"customer","data":"{\"companyname\": \"New Customer Ltd\", \"email\": \"contact@newcustomer.com\", \"subsidiary\": \"1\"}"}}`

4. **Open invoices with balances (SuiteQL join):**
   `{"name":"ns_runCustomSuiteQL","arguments":{"sqlQuery":"SELECT t.id, t.tranid, c.companyname, t.trandate, t.foreigntotal, t.amountremaining FROM transaction t JOIN customer c ON t.entity = c.id WHERE t.type = 'CustInvc' AND t.amountremaining > 0 ORDER BY t.amountremaining DESC","description":"Open invoices with outstanding balances joined to customer names","pageSize":100}}`

5. **Run a financial report:**
   `{"name":"ns_listAllReports","arguments":{}}` → then `{"name":"ns_runReport","arguments":{"reportId":42,"dateTo":"2026-03-31","dateFrom":"2026-01-01"}}`

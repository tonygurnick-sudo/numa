# NetSuite MCP -- Workspace Agent API Rules

> **Purpose:** Concise rules for any LLM calling NetSuite via the MCP AI Connector Service.
> **Protocol:** MCP (JSON-RPC 2.0) | **Auth:** OAuth 2.0 PKCE per-account
> **Tools:** 11 standard tools from `com.netsuite.mcpstandardtools` SuiteApp

---

## Connection

| Setting      | Value                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| MCP Endpoint | `https://{accountid}.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools` |
| Auth         | OAuth 2.0 Authorization Code + PKCE (public client, scope: `mcp`)                                       |
| Token type   | JWT (RS256), ~3600s lifetime                                                                            |
| Protocol     | JSON-RPC 2.0 via HTTP POST                                                                              |
| Content-Type | `application/json`                                                                                      |

---

## Critical Rules (Violations = Broken Requests)

1. **Always call ns_getRecordTypeMetadata BEFORE ns_createRecord or ns_updateRecord**
   - You need the field names and types for the target record type
   - Skipping this will produce malformed data payloads

2. **The `data` parameter for create/update must be STRINGIFIED JSON, not a raw object**
   - CORRECT: `"data": "{\"companyname\": \"Acme Corp\", \"email\": \"info@acme.com\"}"`
   - WRONG: `"data": {"companyname": "Acme Corp"}` (raw object)

3. **Always call ns_listAllReports BEFORE ns_runReport**
   - You need the report `id` and must check `has_subsidiary_filter`
   - If `has_subsidiary_filter` is true, also call ns_getSubsidiaries first

4. **SuiteQL is Oracle-dialect SQL, NOT standard SQL**
   - Use `||` for string concatenation (not `+` or `CONCAT`)
   - Use `TO_DATE('2024-01-01', 'YYYY-MM-DD')` for dates (not date literals)
   - Use `NVL(field, default)` not `ISNULL` or `IFNULL`
   - Use `SUBSTR(str, pos, len)` not `SUBSTRING`
   - Use `ROWNUM` for limiting rows (not `LIMIT`, `OFFSET`, or `TOP`)
   - NO CTEs (`WITH ... AS`), NO recursive queries
   - `IN` clause max: 1000 items
   - Booleans: `'T'` / `'F'` (not `true` / `false`)

5. **SuiteQL result caps**
   - 5,000 rows per MCP call
   - 100,000 rows total per query
   - Always include reasonable `ROWNUM` limits to avoid timeouts

6. **No delete tool exists in MCP Standard Tools**
   - You cannot delete records via MCP
   - Inform the user if they ask for record deletion

7. **ns_runCustomSuiteQL requires BOTH `sqlQuery` AND `description`**
   - The `description` parameter is mandatory -- provide a brief English description of what the query does

8. **All 11 tools report `destructiveHint: true` in annotations -- ignore this for read-only tools**
   - This is a NetSuite default, not a meaningful signal
   - Only ns_createRecord and ns_updateRecord actually modify data

---

## Available MCP Tools (11 total)

| Tool                       | Purpose                                | Read/Write | Prerequisite                             |
| -------------------------- | -------------------------------------- | ---------- | ---------------------------------------- |
| `ns_getRecordTypeMetadata` | Discover record fields and types       | Read       | None                                     |
| `ns_createRecord`          | Create a record                        | Write      | ns_getRecordTypeMetadata                 |
| `ns_updateRecord`          | Update a record by ID                  | Write      | ns_getRecordTypeMetadata                 |
| `ns_getRecord`             | Get a single record                    | Read       | None                                     |
| `ns_listAllReports`        | List available reports                 | Read       | None                                     |
| `ns_runReport`             | Run a report                           | Read       | ns_listAllReports                        |
| `ns_getSubsidiaries`       | List subsidiaries for report filtering | Read       | None                                     |
| `ns_listSavedSearches`     | List saved searches                    | Read       | None                                     |
| `ns_runSavedSearch`        | Run a saved search                     | Read       | None                                     |
| `ns_runCustomSuiteQL`      | Execute ad-hoc SQL queries             | Read       | None (ns_getSuiteQLMetadata recommended) |
| `ns_getSuiteQLMetadata`    | Discover SuiteQL table schemas         | Read       | None                                     |

---

## Working Examples

### Example 1: Query customers by name (SuiteQL)

```json
{
  "name": "ns_runCustomSuiteQL",
  "arguments": {
    "sqlQuery": "SELECT id, companyname, email, phone FROM customer WHERE companyname LIKE '%Electrical%' ORDER BY companyname",
    "description": "Find customers with Electrical in their name"
  }
}
```

### Example 2: Get a specific record

```json
{
  "name": "ns_getRecord",
  "arguments": {
    "recordType": "customer",
    "recordId": "12345",
    "fields": "companyname,email,phone,balance"
  }
}
```

### Example 3: Create a customer (must call ns_getRecordTypeMetadata first)

```json
{
  "name": "ns_createRecord",
  "arguments": {
    "recordType": "customer",
    "data": "{\"companyname\": \"New Customer Ltd\", \"email\": \"contact@newcustomer.com\", \"subsidiary\": \"1\"}"
  }
}
```

### Example 4: Open invoices with balances (SuiteQL join)

```json
{
  "name": "ns_runCustomSuiteQL",
  "arguments": {
    "sqlQuery": "SELECT t.id, t.tranid, c.companyname, t.trandate, t.foreigntotal, t.amountremaining FROM transaction t JOIN customer c ON t.entity = c.id WHERE t.type = 'CustInvc' AND t.amountremaining > 0 ORDER BY t.amountremaining DESC",
    "description": "List all open invoices with outstanding balances, joined with customer names",
    "pageSize": 100
  }
}
```

### Example 5: Run a financial report

```json
// Step 1: List reports
{"name": "ns_listAllReports", "arguments": {}}

// Step 2: Check if subsidiary filter needed, then run
{"name": "ns_runReport", "arguments": {
  "reportId": 42,
  "dateTo": "2026-03-31",
  "dateFrom": "2026-01-01"
}}
```

---

## Common SuiteQL Record Types

| SuiteQL Table | Description             | Common Fields                                     |
| ------------- | ----------------------- | ------------------------------------------------- |
| `customer`    | Customer records        | id, companyname, email, phone, balance            |
| `vendor`      | Vendor/supplier records | id, companyname, email, phone                     |
| `employee`    | Employee records        | id, firstname, lastname, email                    |
| `transaction` | All transaction types   | id, type, tranid, entity, trandate, total, status |
| `item`        | All item types          | id, itemid, displayname, itemtype, baseprice      |
| `contact`     | Contact records         | id, firstname, lastname, email, company           |
| `account`     | Chart of accounts       | id, acctnumber, acctname, accttype                |

**Transaction type codes for SuiteQL WHERE clauses:**
`SalesOrd`, `CustInvc`, `PurchOrd`, `VendBill`, `CustPymt`, `VendPymt`, `Journal`, `ItemShip`, `ItemRcpt`, `Estimate`, `CustCred`

---

## Pagination

**SuiteQL:** Use `ROWNUM` -- not `LIMIT/OFFSET`:

```sql
SELECT * FROM (SELECT id, companyname, ROWNUM rn FROM customer WHERE ROWNUM <= 200) WHERE rn > 100
```

**Saved searches:** Use `range_start` / `range_end` parameters:

```json
{ "name": "ns_runSavedSearch", "arguments": { "searchId": "123", "range_start": 0, "range_end": 99 } }
```

---

## Error Handling

**REST error format:**

```json
{
  "status": 400,
  "o:errorDetails": [{ "detail": "Error description", "o:errorCode": "INVALID_CONTENT" }]
}
```

| Status | Code                       | Meaning                      | Action                                        |
| ------ | -------------------------- | ---------------------------- | --------------------------------------------- |
| 400    | INVALID_CONTENT            | Bad field value              | Check o:errorPath, fix field                  |
| 400    | INVALID_REQUEST            | Malformed request            | Fix syntax                                    |
| 401    | INVALID_LOGIN              | Token expired                | Refresh OAuth token                           |
| 403    | --                         | Insufficient permissions     | Check role (Administrator role does NOT work) |
| 404    | NONEXISTENT_ID             | Record not found             | Verify record ID                              |
| 429    | CONCURRENCY_LIMIT_EXCEEDED | Too many concurrent requests | Exponential backoff (1s, 2s, 4s...)           |
| 500    | UNEXPECTED_ERROR           | Server error                 | Retry with backoff                            |

---

## Do NOT

- Skip calling ns_getRecordTypeMetadata before create/update operations
- Pass raw JSON objects as the `data` parameter (must be stringified)
- Use `LIMIT`, `OFFSET`, `TOP`, `WITH`, `CTE`, or `ISNULL` in SuiteQL
- Use double-quoted strings in SuiteQL (use single quotes)
- Assume the Administrator role works (it does not for MCP)
- Attempt to delete records (no delete tool in MCP Standard Tools)
- Exceed 5,000 rows per SuiteQL call or 100,000 total
- Forget the `description` parameter in ns_runCustomSuiteQL
- Run ns_runReport without first calling ns_listAllReports
- Put more than 1000 items in a SuiteQL `IN (...)` clause

---

_See companion files for detailed reference:_

- _01a-domain-model-reference.md -- Entity catalog, record types, relationships_
- _01b-query-patterns.md -- SuiteQL syntax, saved searches, report workflows_
- _01c-mutation-patterns.md -- Create, update patterns with validation rules_
- _01d-event-and-error-handling.md -- Error recovery, rate limits, polling_

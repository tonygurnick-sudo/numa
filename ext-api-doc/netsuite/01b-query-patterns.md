---
api_name: NetSuite AI Connector Service (MCP)
api_slug: netsuite
doc: on-demand query-patterns reference (companion to 01-llm-api-rules.md)
call_surface: MCP via mcp_call
primary_query_tool: ns_runCustomSuiteQL (Oracle-dialect SQL)
fallback: ns_runSavedSearch (pre-built UI searches); ns_runReport (financial/operational reports)
confidence: every capability below is confirmed unless tagged [UNKNOWN]
---

# NetSuite MCP — Query Patterns Reference

All read operations: SuiteQL, saved searches, reports, metadata discovery, pagination. Companion to `01-llm-api-rules.md`.

## Query capabilities

| Capability            | Supported | Tool / syntax                                         | Notes                   |
| --------------------- | --------- | ----------------------------------------------------- | ----------------------- |
| Filter by field value | Yes       | SuiteQL `WHERE field = 'value'`                       |                         |
| Filter by date range  | Yes       | `WHERE date BETWEEN TO_DATE(...) AND TO_DATE(...)`    | Oracle                  |
| Full-text search      | Partial   | SuiteQL `LIKE '%term%'`; saved-search `query` param   | No true full-text index |
| Sort                  | Yes       | `ORDER BY field ASC/DESC`                             |                         |
| Field selection       | Yes       | SuiteQL `SELECT col1,col2`; `ns_getRecord` `fields`   |                         |
| Related records       | Yes       | SuiteQL `JOIN`                                        |                         |
| Aggregation/count     | Yes       | `COUNT(*)`,`SUM()`,`AVG()`,`MAX()`,`MIN()`,`GROUP BY` |                         |
| Logical AND/OR        | Yes       | `WHERE x AND y OR z`                                  | Standard precedence     |
| Comparison            | Yes       | `=` `!=` `>` `<` `>=` `<=`                            |                         |
| Null checks           | Yes       | `IS NULL`,`IS NOT NULL`,`NVL(field,default)`          | Oracle NVL, not ISNULL  |
| Subqueries            | Yes       | `WHERE id IN (SELECT …)`, `EXISTS (SELECT …)`         |                         |
| Set operations        | Yes       | `UNION`, `UNION ALL`                                  |                         |

## Tool selection

| Need                     | Tool                                                 | Why                             |
| ------------------------ | ---------------------------------------------------- | ------------------------------- |
| Ad-hoc query             | `ns_runCustomSuiteQL`                                | Full SQL: JOINs, aggregation    |
| Single record by id      | `ns_getRecord`                                       | Fastest; no SQL overhead        |
| Pre-built business query | `ns_runSavedSearch`                                  | NetSuite-maintained definitions |
| Financial report         | `ns_runReport`                                       | Purpose-built                   |
| Discover fields/tables   | `ns_getRecordTypeMetadata` / `ns_getSuiteQLMetadata` | Schema discovery                |

## SuiteQL Oracle-dialect rules

Concat `||` (not `+`/`CONCAT` — `||` is more reliable and chains: `firstname || ' ' || lastname`). Null `NVL(field,default)`. Substring `SUBSTR(str,pos,len)`. Date `TO_DATE('2026-01-01','YYYY-MM-DD')`. Row limit `ROWNUM` (not LIMIT/OFFSET/TOP). No CTEs, no recursive queries. `IN` max 1000. Booleans `'T'`/`'F'`. Strings = single quotes; double quotes = identifiers/aliases. Both SQL-92 and Oracle JOIN syntax work but **not mixed in one query** — prefer Oracle (ANSI risks performance issues). `WHERE field = NULL` returns no rows — use `IS NULL`.

## Pattern 1 — basic SuiteQL

`{"name":"ns_runCustomSuiteQL","arguments":{"sqlQuery":"SELECT columns FROM table WHERE conditions ORDER BY column","description":"What this query does"}}`

## Pattern 2 — JOINs

Implicit (Oracle, preferred):

```sql
SELECT t.tranid, t.trandate, c.companyname, t.total FROM transaction t, customer c
WHERE t.entity = c.id AND t.type = 'CustInvc' AND t.trandate >= TO_DATE('2026-01-01','YYYY-MM-DD') ORDER BY t.trandate DESC
```

Explicit (ANSI): `… FROM transaction t INNER JOIN customer c ON t.entity = c.id WHERE …`.
Line detail: `SELECT t.tranid, tl.item, i.itemid, tl.quantity, tl.rate, tl.amount FROM transaction t, transactionline tl, item i WHERE t.id = tl.transaction AND tl.item = i.id AND t.type = 'SalesOrd' AND t.id = 12345 ORDER BY tl.linesequencenumber`.

## Pattern 3 — single record by id

`{"name":"ns_getRecord","arguments":{"recordType":"customer","recordId":"12345","fields":"companyname,email,phone,balance"}}`. Omit `fields` to return all fields.

## Pattern 4 — saved search

1. Find: `{"name":"ns_listSavedSearches","arguments":{"query":"open invoices"}}`
2. Run: `{"name":"ns_runSavedSearch","arguments":{"searchId":"456","range_start":0,"range_end":99}}`

## Pattern 5 — financial reports (multi-step; never skip step 1)

1. `{"name":"ns_listAllReports","arguments":{}}`
2. From the response read `has_subsidiary_filter` (if true → step 2b), `as_of_date_format` (required date params), `periods_allowed` (valid ranges).
   2b. `{"name":"ns_getSubsidiaries","arguments":{}}` (consolidated subsidiaries have negative ids).
3. `{"name":"ns_runReport","arguments":{"reportId":42,"dateTo":"2026-03-31","dateFrom":"2026-01-01","subsidiaryId":1}}`

## Pattern 6 — date range

```sql
SELECT id, tranid, trandate, total FROM transaction
WHERE trandate BETWEEN TO_DATE('2026-01-01','YYYY-MM-DD') AND TO_DATE('2026-03-31','YYYY-MM-DD') AND type = 'CustInvc' ORDER BY trandate DESC
```

Modified since: `SELECT id, companyname, lastmodifieddate FROM customer WHERE lastmodifieddate >= TO_DATE('2026-03-01','YYYY-MM-DD') ORDER BY lastmodifieddate DESC`.

## Pattern 7 — aggregation

```sql
SELECT c.companyname, COUNT(*) AS order_count, SUM(t.total) AS total_sales FROM transaction t, customer c
WHERE t.entity = c.id AND t.type = 'SalesOrd' AND t.trandate >= TO_DATE('2026-01-01','YYYY-MM-DD')
GROUP BY c.companyname HAVING SUM(t.total) > 1000 ORDER BY total_sales DESC
```

## Pattern 8 — schema discovery

- Record types: `{"name":"ns_getRecordTypeMetadata","arguments":{}}`
- Fields for a type: `{"name":"ns_getRecordTypeMetadata","arguments":{"recordType":"salesorder"}}`
- SuiteQL tables + join paths: `{"name":"ns_getSuiteQLMetadata","arguments":{"recordType":"transaction"}}` → JSON Schema with `x-n:joinable` / `x-n:recordType` annotations showing joinable fields.

## Pagination

**SuiteQL via ROWNUM** (no LIMIT/OFFSET). ROWNUM evaluates BEFORE ORDER BY, so to page sorted results nest the sorted query first.

- Page 1 (1–100): `SELECT * FROM (SELECT id, companyname, email, ROWNUM rn FROM customer WHERE ROWNUM <= 100) WHERE rn > 0`
- Page 2 (101–200): `SELECT * FROM (SELECT id, companyname, email, ROWNUM rn FROM customer WHERE ROWNUM <= 200) WHERE rn > 100`
- Sorted: `SELECT * FROM (SELECT sorted.*, ROWNUM rn FROM (SELECT id, companyname, email FROM customer ORDER BY companyname ASC) sorted WHERE ROWNUM <= 200) WHERE rn > 100`
- Limits: 5,000 rows/call, 100,000 total/query. Larger → SuiteAnalytics Connect.

**Saved search via range_start/range_end:** `{"searchId":"123","range_start":0,"range_end":99}` then `100/199`, `200/299`… Stop when fewer results than range size.

**SuiteQL via `pageSize` param:** `ns_runCustomSuiteQL` also accepts `pageSize`. `{"sqlQuery":"SELECT id, companyname FROM customer ORDER BY companyname","description":"List all customers","pageSize":100}`. Pagination response shape [UNKNOWN] — may return page tokens or offset info.

## Worked examples

1. **Top customers by outstanding balance** — implicit join, aggregates open invoices, `amountremaining > 0` filters to unpaid:
   `{"name":"ns_runCustomSuiteQL","arguments":{"sqlQuery":"SELECT c.id, c.companyname, c.email, SUM(t.amountremaining) AS outstanding FROM transaction t, customer c WHERE t.entity = c.id AND t.type = 'CustInvc' AND t.amountremaining > 0 GROUP BY c.id, c.companyname, c.email ORDER BY outstanding DESC","description":"Top customers by outstanding invoice balance","pageSize":10}}`

2. **Sales order line items with product detail** — join transactionline→item, filter by parent txn:
   `{"name":"ns_runCustomSuiteQL","arguments":{"sqlQuery":"SELECT tl.linesequencenumber, i.itemid, i.displayname, tl.quantity, tl.rate, tl.amount FROM transactionline tl, item i WHERE tl.item = i.id AND tl.transaction = 12345 ORDER BY tl.linesequencenumber","description":"Line items for sales order 12345 with product details"}}`

3. **Monthly revenue** — `TO_CHAR` for date formatting, group by year-month, invoices only:
   `{"name":"ns_runCustomSuiteQL","arguments":{"sqlQuery":"SELECT TO_CHAR(t.trandate,'YYYY-MM') AS month, COUNT(*) AS invoice_count, SUM(t.total) AS revenue FROM transaction t WHERE t.type = 'CustInvc' AND t.trandate >= TO_DATE('2026-01-01','YYYY-MM-DD') AND t.trandate <= TO_DATE('2026-12-31','YYYY-MM-DD') GROUP BY TO_CHAR(t.trandate,'YYYY-MM') ORDER BY month","description":"Monthly revenue summary for 2026"}}`

4. **Inventory below reorder point** — boolean `'F'`, `InvtPart` item type, `quantityavailable` computed:
   `{"name":"ns_runCustomSuiteQL","arguments":{"sqlQuery":"SELECT id, itemid, displayname, quantityavailable, quantityonorder FROM item WHERE itemtype = 'InvtPart' AND quantityavailable < 10 AND isinactive = 'F' ORDER BY quantityavailable ASC","description":"Inventory items with less than 10 units available"}}`

## Gotchas

1. **Transaction table is unified** — all types in one `transaction` table; always filter by `type`.
2. **Saved-search `type` param** — some standalone saved searches need a `type` in `ns_runSavedSearch`; if the search was created against a specific record type the type may already be embedded, else provide it.
3. **Report workflow is multi-step** — never `ns_runReport` without `ns_listAllReports` first (id, subsidiary-filter flag, and date format come from the list response).

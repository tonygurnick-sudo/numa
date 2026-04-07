---
api_name: 'NetSuite AI Connector Service (MCP)'
api_slug: 'netsuite'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-03-30'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# NetSuite MCP -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Contains all read operation patterns including
> SuiteQL queries, saved searches, reports, metadata discovery, and pagination.
>
> **Primary query tool:** `ns_runCustomSuiteQL` -- Oracle-dialect SQL against NetSuite data.
> **Fallback/pre-built:** `ns_runSavedSearch` -- Execute saved searches created in NetSuite UI.
> **Analytics:** `ns_runReport` -- Run financial/operational reports.

---

## Query Capabilities Summary

| Capability                 | Supported | Tool / Syntax                                                      | Notes                   |
| -------------------------- | --------- | ------------------------------------------------------------------ | ----------------------- |
| Filter by field value      | Yes       | SuiteQL `WHERE field = 'value'`                                    | [CONFIRMED]             |
| Filter by date range       | Yes       | SuiteQL `WHERE date BETWEEN TO_DATE(...) AND TO_DATE(...)`         | Oracle syntax           |
| Full-text search           | Partial   | SuiteQL `LIKE '%term%'`; saved search `query` param                | No true full-text index |
| Sort by field              | Yes       | SuiteQL `ORDER BY field ASC/DESC`                                  |                         |
| Sort direction             | Yes       | `ASC` / `DESC`                                                     |                         |
| Field selection            | Yes       | SuiteQL `SELECT col1, col2`; ns_getRecord `fields` param           |                         |
| Include related records    | Yes       | SuiteQL `JOIN`                                                     |                         |
| Aggregation / count        | Yes       | SuiteQL `COUNT(*)`, `SUM()`, `AVG()`, `MAX()`, `MIN()`, `GROUP BY` |                         |
| Logical operators (AND/OR) | Yes       | SuiteQL `WHERE x AND y OR z`                                       | Standard SQL precedence |
| Comparison operators       | Yes       | `=`, `!=`, `>`, `<`, `>=`, `<=`                                    |                         |
| Null checks                | Yes       | `IS NULL`, `IS NOT NULL`, `NVL(field, default)`                    | Oracle NVL, not ISNULL  |
| Subqueries                 | Yes       | `WHERE id IN (SELECT ...)`, `EXISTS (SELECT ...)`                  |                         |
| Set operations             | Yes       | `UNION`, `UNION ALL`                                               |                         |

---

## Query Tool Selection Guide

| Need                     | Best Tool                                             | Why                                         |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------- |
| Ad-hoc data query        | `ns_runCustomSuiteQL`                                 | Full SQL flexibility, JOINs, aggregation    |
| Single record by ID      | `ns_getRecord`                                        | Fastest; avoids SQL overhead                |
| Pre-built business query | `ns_runSavedSearch`                                   | Uses NetSuite-maintained search definitions |
| Financial report         | `ns_runReport`                                        | Purpose-built for financial reporting       |
| Discover fields/tables   | `ns_getRecordTypeMetadata` or `ns_getSuiteQLMetadata` | Schema discovery                            |

---

## Pattern 1: SuiteQL Basic Query

> The primary query mechanism. Oracle-dialect SQL.

**Syntax:**

```json
{
  "name": "ns_runCustomSuiteQL",
  "arguments": {
    "sqlQuery": "SELECT columns FROM table WHERE conditions ORDER BY column",
    "description": "Human-readable description of what this query does"
  }
}
```

**SuiteQL Oracle-dialect rules:**

- String concatenation: `||` (not `+` or `CONCAT`)
- Null handling: `NVL(field, default)` (not `ISNULL`, not `IFNULL`)
- Substring: `SUBSTR(str, pos, len)` (not `SUBSTRING`)
- Date conversion: `TO_DATE('2026-01-01', 'YYYY-MM-DD')`
- Row limiting: `ROWNUM` (not `LIMIT`, `OFFSET`, or `TOP`)
- No CTEs (`WITH ... AS`)
- No recursive queries
- `IN` clause: max 1000 items
- Booleans: `'T'` / `'F'` (not `true` / `false`)
- Both SQL-92 and Oracle JOIN syntax supported (but not mixed in same query)
- **Prefer Oracle syntax** -- ANSI SQL-92 risks performance issues

---

## Pattern 2: SuiteQL with JOINs

> Retrieve data across related tables.

**Implicit join (Oracle syntax -- preferred):**

```sql
SELECT t.tranid, t.trandate, c.companyname, t.total
FROM transaction t, customer c
WHERE t.entity = c.id
AND t.type = 'CustInvc'
AND t.trandate >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
ORDER BY t.trandate DESC
```

**Explicit join (ANSI syntax):**

```sql
SELECT t.tranid, t.trandate, c.companyname, t.total
FROM transaction t
INNER JOIN customer c ON t.entity = c.id
WHERE t.type = 'CustInvc'
AND t.trandate >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
ORDER BY t.trandate DESC
```

**Transaction line detail join:**

```sql
SELECT t.tranid, tl.item, i.itemid, tl.quantity, tl.rate, tl.amount
FROM transaction t, transactionline tl, item i
WHERE t.id = tl.transaction
AND tl.item = i.id
AND t.type = 'SalesOrd'
AND t.id = 12345
ORDER BY tl.linesequencenumber
```

---

## Pattern 3: Get Single Record by ID

> Use ns_getRecord for direct record retrieval (faster than SuiteQL for single records).

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

**Without field selection (returns all fields):**

```json
{
  "name": "ns_getRecord",
  "arguments": {
    "recordType": "salesorder",
    "recordId": "67890"
  }
}
```

---

## Pattern 4: Saved Search Execution

> Run pre-built searches defined in the NetSuite UI.

**Step 1: Find the saved search:**

```json
{
  "name": "ns_listSavedSearches",
  "arguments": {
    "query": "open invoices"
  }
}
```

**Step 2: Run the saved search:**

```json
{
  "name": "ns_runSavedSearch",
  "arguments": {
    "searchId": "456",
    "range_start": 0,
    "range_end": 99
  }
}
```

---

## Pattern 5: Financial Reports

> Multi-step workflow: list reports -> check subsidiary filter -> run report.

**Step 1: List available reports:**

```json
{ "name": "ns_listAllReports", "arguments": {} }
```

**Step 2: Check report metadata** (from Step 1 response):

- `has_subsidiary_filter` -- if true, must call ns_getSubsidiaries
- `as_of_date_format` -- determines required date parameters
- `periods_allowed` -- determines valid date ranges

**Step 2b (conditional): Get subsidiaries:**

```json
{ "name": "ns_getSubsidiaries", "arguments": {} }
```

Note: Consolidated subsidiaries have negative IDs.

**Step 3: Run the report:**

```json
{
  "name": "ns_runReport",
  "arguments": {
    "reportId": 42,
    "dateTo": "2026-03-31",
    "dateFrom": "2026-01-01",
    "subsidiaryId": 1
  }
}
```

---

## Pattern 6: Date Range Queries

```sql
-- Transactions in a date range
SELECT id, tranid, trandate, total
FROM transaction
WHERE trandate BETWEEN TO_DATE('2026-01-01', 'YYYY-MM-DD') AND TO_DATE('2026-03-31', 'YYYY-MM-DD')
AND type = 'CustInvc'
ORDER BY trandate DESC

-- Records modified since a timestamp
SELECT id, companyname, lastmodifieddate
FROM customer
WHERE lastmodifieddate >= TO_DATE('2026-03-01', 'YYYY-MM-DD')
ORDER BY lastmodifieddate DESC
```

---

## Pattern 7: Aggregation and Grouping

```sql
-- Total sales by customer
SELECT c.companyname, COUNT(*) AS order_count, SUM(t.total) AS total_sales
FROM transaction t, customer c
WHERE t.entity = c.id
AND t.type = 'SalesOrd'
AND t.trandate >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
GROUP BY c.companyname
HAVING SUM(t.total) > 1000
ORDER BY total_sales DESC

-- Invoice aging summary
SELECT
  NVL(c.companyname, 'Unknown') AS customer,
  COUNT(*) AS invoice_count,
  SUM(t.amountremaining) AS total_outstanding
FROM transaction t, customer c
WHERE t.entity = c.id
AND t.type = 'CustInvc'
AND t.amountremaining > 0
GROUP BY c.companyname
ORDER BY total_outstanding DESC
```

---

## Pattern 8: Schema Discovery

**Discover record types:**

```json
{ "name": "ns_getRecordTypeMetadata", "arguments": {} }
```

**Discover fields for a specific record type:**

```json
{
  "name": "ns_getRecordTypeMetadata",
  "arguments": {
    "recordType": "salesorder"
  }
}
```

**Discover SuiteQL tables and join paths:**

```json
{
  "name": "ns_getSuiteQLMetadata",
  "arguments": {
    "recordType": "transaction"
  }
}
```

Response includes JSON Schema with `x-n:joinable` and `x-n:recordType` annotations showing which fields can be joined.

---

## Pagination Handling

### SuiteQL Pagination (via ROWNUM)

SuiteQL uses Oracle's `ROWNUM` for pagination. There is no `LIMIT` or `OFFSET`.

**Page 1 (rows 1-100):**

```sql
SELECT * FROM (
  SELECT id, companyname, email, ROWNUM rn
  FROM customer
  WHERE ROWNUM <= 100
)
WHERE rn > 0
```

**Page 2 (rows 101-200):**

```sql
SELECT * FROM (
  SELECT id, companyname, email, ROWNUM rn
  FROM customer
  WHERE ROWNUM <= 200
)
WHERE rn > 100
```

**With sorting (wrap the sorted query):**

```sql
SELECT * FROM (
  SELECT sorted.*, ROWNUM rn FROM (
    SELECT id, companyname, email
    FROM customer
    ORDER BY companyname ASC
  ) sorted
  WHERE ROWNUM <= 200
)
WHERE rn > 100
```

**Limits:**

- Max 5,000 rows per MCP tool call
- Max 100,000 rows total per query
- For larger datasets, use SuiteAnalytics Connect

### Saved Search Pagination (range_start / range_end)

```json
// Page 1
{"name": "ns_runSavedSearch", "arguments": {"searchId": "123", "range_start": 0, "range_end": 99}}

// Page 2
{"name": "ns_runSavedSearch", "arguments": {"searchId": "123", "range_start": 100, "range_end": 199}}

// Page 3
{"name": "ns_runSavedSearch", "arguments": {"searchId": "123", "range_start": 200, "range_end": 299}}

// Stop when fewer results returned than range size
```

### SuiteQL Pagination (via pageSize parameter)

The `ns_runCustomSuiteQL` tool also has a `pageSize` parameter:

```json
{
  "name": "ns_runCustomSuiteQL",
  "arguments": {
    "sqlQuery": "SELECT id, companyname FROM customer ORDER BY companyname",
    "description": "List all customers paginated",
    "pageSize": 100
  }
}
```

Response format for pagination: [UNKNOWN] -- the tool may return page tokens or offset info.

---

## Worked Examples

### Example 1: Top 10 Customers by Outstanding Balance

> Identify customers with the highest unpaid invoices.

```json
{
  "name": "ns_runCustomSuiteQL",
  "arguments": {
    "sqlQuery": "SELECT c.id, c.companyname, c.email, SUM(t.amountremaining) AS outstanding FROM transaction t, customer c WHERE t.entity = c.id AND t.type = 'CustInvc' AND t.amountremaining > 0 GROUP BY c.id, c.companyname, c.email ORDER BY outstanding DESC",
    "description": "Top customers by outstanding invoice balance",
    "pageSize": 10
  }
}
```

**Key points:**

- Uses implicit Oracle join syntax
- Aggregates across all open invoices per customer
- `amountremaining > 0` filters to unpaid invoices only

---

### Example 2: Sales Order Line Items with Product Details

> Get line-level detail for a specific sales order.

```json
{
  "name": "ns_runCustomSuiteQL",
  "arguments": {
    "sqlQuery": "SELECT tl.linesequencenumber, i.itemid, i.displayname, tl.quantity, tl.rate, tl.amount FROM transactionline tl, item i WHERE tl.item = i.id AND tl.transaction = 12345 ORDER BY tl.linesequencenumber",
    "description": "Line items for sales order ID 12345 with product details"
  }
}
```

**Key points:**

- Joins transactionline to item for product info
- Filter by parent transaction ID
- Ordered by line sequence

---

### Example 3: Monthly Revenue Summary

> Aggregate revenue by month for the current year.

```json
{
  "name": "ns_runCustomSuiteQL",
  "arguments": {
    "sqlQuery": "SELECT TO_CHAR(t.trandate, 'YYYY-MM') AS month, COUNT(*) AS invoice_count, SUM(t.total) AS revenue FROM transaction t WHERE t.type = 'CustInvc' AND t.trandate >= TO_DATE('2026-01-01', 'YYYY-MM-DD') AND t.trandate <= TO_DATE('2026-12-31', 'YYYY-MM-DD') GROUP BY TO_CHAR(t.trandate, 'YYYY-MM') ORDER BY month",
    "description": "Monthly revenue summary for 2026"
  }
}
```

**Key points:**

- Uses `TO_CHAR` for date formatting (Oracle function)
- Groups by year-month string
- Filters to invoices only for revenue calculation

---

### Example 4: Inventory Below Reorder Point

> Find items that need restocking.

```json
{
  "name": "ns_runCustomSuiteQL",
  "arguments": {
    "sqlQuery": "SELECT id, itemid, displayname, quantityavailable, quantityonorder FROM item WHERE itemtype = 'InvtPart' AND quantityavailable < 10 AND isinactive = 'F' ORDER BY quantityavailable ASC",
    "description": "Inventory items with less than 10 units available"
  }
}
```

**Key points:**

- Boolean filter uses `'F'` not `false`
- `InvtPart` is the item type code for inventory items
- `quantityavailable` is a computed field

---

## Gotchas & Counter-Exceptions

1. **ROWNUM filtering is evaluated BEFORE ORDER BY:** To paginate sorted results, you must nest the sorted query inside a subquery, then apply ROWNUM to the outer query. See the "With sorting" pagination example above.

2. **Transaction table is unified:** All transaction types (sales orders, invoices, POs, bills, payments, journals) are in the single `transaction` table. Always filter by `type` column to get the records you want.

3. **SuiteQL uses single quotes for strings:** Double quotes are for identifiers (column aliases). `WHERE name = 'Acme'` is correct; `WHERE name = "Acme"` will fail or be interpreted as a column reference.

4. **`CONCAT` vs `||`:** While some SuiteQL documentation shows `CONCAT()`, the Oracle-standard `||` operator is more reliable and supports multi-value concatenation: `firstname || ' ' || lastname`.

5. **Saved search `type` parameter:** Some standalone saved searches require a `type` parameter in `ns_runSavedSearch`. If the search was created against a specific record type, the type may already be embedded. If not, you must provide it.

6. **Report workflow is multi-step:** Never call `ns_runReport` without first calling `ns_listAllReports`. The report ID, subsidiary filter requirement, and date format come from the list response.

7. **SuiteQL null returns:** Oracle SQL returns no rows for `WHERE field = NULL`. Always use `IS NULL` or `IS NOT NULL`, not `= NULL`.

---

_Generated from the investigation questionnaire, Phases 5-6._

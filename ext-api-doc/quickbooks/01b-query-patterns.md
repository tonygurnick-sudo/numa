# Query Patterns — QuickBooks Online Accounting API (v3)

> Natural language → API read operation mappings.
> Reads go through the SQL-like `query` endpoint or `GET /{entity}/{id}`.
> All paths relative to `…/v3/company/{realmId}/`. Pin `minorversion=75`.
> Response field names `[DOCUMENTED]` from Intuit docs/SDK; verify exact wrappers against sandbox.

---

## The query endpoint

QBO reads use a **single SQL-like dialect** against one entity at a time, passed in the `query` query-string parameter (URL-encoded):

```
GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice WHERE Balance > '0' ORDER BY TxnDate DESC STARTPOSITION 1 MAXRESULTS 100&minorversion=75
Accept: application/json
```

- This is **not** SQL and **not** GraphQL — it is Intuit's restricted dialect.
- `FROM` takes exactly one entity (`Invoice`, `Customer`, `Item`, `Bill`, `Payment`, `Vendor`, `Account`, …). **No JOINs.**
- String literals are single-quoted, including numeric ids and `Balance`/amount comparisons: `WHERE CustomerRef = '58'`, `WHERE Balance > '0'`.
- Field names are **case-sensitive** and PascalCase: `TxnDate`, `DocNumber`, `DisplayName`, `MetaData.LastUpdatedTime`.

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries

---

## Filter syntax reference

| Capability             | Supported? | Syntax                                   | Notes                             |
| ---------------------- | ---------- | ---------------------------------------- | --------------------------------- |
| Equality               | Yes        | `WHERE DisplayName = 'Amy'`              |                                   |
| Comparison             | Yes        | `>`, `<`, `>=`, `<=` (quote the literal) | `WHERE TxnDate >= '2026-01-01'`   |
| IN list                | Yes        | `WHERE DocNumber IN ('1070','1071')`     |                                   |
| LIKE (prefix/contains) | Yes        | `WHERE DisplayName LIKE 'Amy%'`          | `%` wildcard; no true full-text   |
| Logical AND            | Yes        | `WHERE A = 'x' AND B = 'y'`              | **AND only**                      |
| Logical OR             | **No**     | —                                        | Run multiple queries instead      |
| Parentheses / nesting  | **No**     | —                                        |                                   |
| ORDER BY               | Yes        | `ORDER BY TxnDate DESC`                  | asc default                       |
| Field selection        | Yes        | `SELECT Id, DocNumber FROM Invoice`      | or `SELECT *`                     |
| COUNT                  | Yes        | `SELECT COUNT(*) FROM Invoice`           | returns `totalCount`, no rows     |
| Pagination             | Yes        | `STARTPOSITION n MAXRESULTS m`           | inside the SELECT, not URL params |
| NULL checks            | Limited    | not generally supported                  | [INFERRED — verify in sandbox]    |
| Regex                  | **No**     | only `LIKE` with `%`                     |                                   |

> ⚠️ **AND-only.** There is no `OR`. To express OR, issue separate queries and merge client-side, or use CDC for "everything that changed".

[DOCUMENTED]

---

## Pagination

Offset-based, expressed **inside the SELECT** (not as URL query params):

```
# Page 1
SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1    MAXRESULTS 1000

# Page 2
SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1001 MAXRESULTS 1000

# Page 3
SELECT * FROM Invoice ORDER BY Id STARTPOSITION 2001 MAXRESULTS 1000

# Last page: returned array length < 1000  →  stop
```

- Default `MAXRESULTS` = 100; max = 1000.
- **No cursor.** Detect the last page by a short array (fewer rows than `MAXRESULTS`) or an absent entity key.
- **Always include a stable `ORDER BY Id`** so offsets are deterministic across pages (rows can shift otherwise).
- `STARTPOSITION` is **1-based**.

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries

---

## Response shape (list)

```json
{
  "QueryResponse": {
    "startPosition": 1,
    "maxResults": 100,
    "totalCount": 2,
    "Invoice": [ { "...entity..." }, { "...entity..." } ]
  },
  "time": "2026-05-29T10:00:00.123-07:00"
}
```

> ⚠️ **Empty result = `"QueryResponse": {}`** — the entity array key (`Invoice`) is **absent**, and `totalCount` may be omitted. Never assume the array exists; check for the key first. For `COUNT(*)`, only `totalCount` is returned (no rows).
> [DOCUMENTED]/[INFERRED]

---

## Query Pattern Library

### Customers / Vendors

**"Find a customer by name"**

```
SELECT * FROM Customer WHERE DisplayName LIKE 'Amy%'
```

**"Get all active customers"**

```
SELECT * FROM Customer WHERE Active = true ORDER BY DisplayName MAXRESULTS 1000
```

**"Customers with an outstanding balance"**

```
SELECT * FROM Customer WHERE Balance > '0' ORDER BY Balance DESC
```

**"Get one customer by id"**

```
GET /v3/company/{realmId}/customer/58
```

**"Find a vendor by name"**

```
SELECT * FROM Vendor WHERE DisplayName LIKE '%Supplies%'
```

---

### Invoices (A/R)

**"Unpaid / open invoices, newest first"**

```
SELECT * FROM Invoice WHERE Balance > '0' ORDER BY TxnDate DESC MAXRESULTS 100
```

**"Invoices for a specific customer"**

```
SELECT * FROM Invoice WHERE CustomerRef = '58' ORDER BY TxnDate DESC
```

**"Overdue invoices (due before today, still owing)"**

```
SELECT * FROM Invoice WHERE DueDate < '2026-05-29' AND Balance > '0' ORDER BY DueDate ASC
```

**"Invoices in a date range"**

```
SELECT * FROM Invoice WHERE TxnDate >= '2026-01-01' AND TxnDate <= '2026-03-31' ORDER BY TxnDate ASC
```

**"Find an invoice by number"**

```
SELECT * FROM Invoice WHERE DocNumber = '1071'
```

**"Most recent 10 invoices"**

```
SELECT * FROM Invoice ORDER BY MetaData.CreateTime DESC MAXRESULTS 10
```

**"One invoice by id"**

```
GET /v3/company/{realmId}/invoice/130
```

**"Invoice as PDF"**

```
GET /v3/company/{realmId}/invoice/130/pdf
Accept: application/pdf
```

---

### Bills (A/P)

**"Open bills"**

```
SELECT * FROM Bill WHERE Balance > '0' ORDER BY DueDate ASC MAXRESULTS 1000
```

**"Bills due this month for a vendor"**

```
SELECT * FROM Bill WHERE VendorRef = '56' AND DueDate <= '2026-05-31' AND Balance > '0'
```

**"Bills in a date range"**

```
SELECT * FROM Bill WHERE TxnDate >= '2026-04-01' AND TxnDate <= '2026-06-30' ORDER BY TxnDate ASC
```

---

### Payments

**"Payments received from a customer"**

```
SELECT * FROM Payment WHERE CustomerRef = '58' ORDER BY TxnDate DESC
```

**"Recent payments"**

```
SELECT * FROM Payment WHERE TxnDate >= '2026-05-01' ORDER BY TxnDate DESC MAXRESULTS 100
```

---

### Items / Accounts

**"All active items"**

```
SELECT * FROM Item WHERE Active = true ORDER BY Name MAXRESULTS 1000
```

**"Find an item by name"**

```
SELECT * FROM Item WHERE Name LIKE '%pump%'
```

**"Income accounts (to wire up an item or invoice line)"**

```
SELECT * FROM Account WHERE AccountType = 'Income' ORDER BY Name
```

**"Find the A/R or bank account"**

```
SELECT * FROM Account WHERE AccountType = 'Bank'
```

---

### Counting & summaries

**"How many invoices?"**

```
SELECT COUNT(*) FROM Invoice
```

Response: `{ "QueryResponse": { "totalCount": 412 }, "time": "..." }` — no rows.

**"How many open bills?"**

```
SELECT COUNT(*) FROM Bill WHERE Balance > '0'
```

---

## Incremental sync (what changed)

Two ways. Prefer **CDC** for multi-entity polling (one call), or per-entity `LastUpdatedTime` for a single stream.

**Per-entity, by last-modified:**

```
SELECT * FROM Customer WHERE MetaData.LastUpdatedTime > '2026-05-28T00:00:00-07:00' ORDER BY MetaData.LastUpdatedTime ASC
```

Save the `LastUpdatedTime` of the last row as your next cursor.

**Change Data Capture (many entities, full objects, one call):**

```
GET /v3/company/{realmId}/cdc?entities=Invoice,Customer,Bill,Payment,Item&changedSince=2026-05-28T00:00:00-07:00
```

CDC returns full objects (not just ids) for everything changed since the timestamp, far cheaper than per-entity polling. `changedSince` reaches up to ~30 days back. See `01d`.

---

## Worked Examples (end-to-end)

### Example 1: Full invoice export (paged)

```
SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1    MAXRESULTS 1000   # page 1
SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1001 MAXRESULTS 1000   # page 2
# ...repeat until returned array length < 1000
```

### Example 2: Gather everything needed to create an invoice

```
# 1. Resolve the customer id
SELECT Id, DisplayName FROM Customer WHERE DisplayName LIKE 'Amy%'

# 2. Resolve the item id (+ its income account is already wired on the item)
SELECT Id, Name, UnitPrice FROM Item WHERE Name = 'Consulting Services'

# 3. (optional) Resolve a specific income account if overriding
SELECT Id, Name FROM Account WHERE AccountType = 'Income'

# 4. POST the invoice with the gathered ids — see 01c
```

### Example 3: Find unpaid invoices for one customer (to apply a payment)

```
SELECT Id, DocNumber, Balance, SyncToken FROM Invoice WHERE CustomerRef = '58' AND Balance > '0' ORDER BY TxnDate ASC
```

Then build a `/payment` with a `LinkedTxn` per invoice id — see `01c`.

### Example 4: A/R aging snapshot via report

```
GET /v3/company/{realmId}/reports/AgedReceivables?minorversion=75
```

Reports return aggregated columns/rows, not entity arrays, and carry a **lower rate limit (~200/min)** — don't poll them aggressively.

---

## Quick reference — quoting & casing rules

- Quote **all** literals, including ids and amounts: `WHERE CustomerRef = '58'`, `WHERE Balance > '0'`.
- Booleans are **unquoted**: `WHERE Active = true`.
- Dates/datetimes are quoted: `WHERE TxnDate >= '2026-01-01'`, `WHERE MetaData.LastUpdatedTime > '2026-05-28T00:00:00-07:00'`.
- Field names are case-sensitive PascalCase. Wrong case can silently return wrong/empty results.
- `LIKE` uses `%`; there is no `_` single-char wildcard guarantee — treat `%` as the only reliable wildcard.

[DOCUMENTED]/[INFERRED]

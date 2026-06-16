---
doc: query-patterns
api: QuickBooks Online Accounting API v3
scope: NL → read operation mappings. Reads go through SQL-like `query` endpoint or `GET /{entity}/{id}`.
paths: relative to …/v3/company/{realmId}/ ; pin minorversion=75 ; Accept: application/json
confidence: field names [DOCUMENTED] from Intuit docs/SDK; verify wrappers against sandbox. [INFERRED] tagged inline.
---

# Query Patterns — QuickBooks Online (v3)

## The query endpoint

QBO reads use ONE SQL-like dialect against ONE entity at a time, passed URL-encoded in the `query` param:

```
GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice WHERE Balance > '0' ORDER BY TxnDate DESC STARTPOSITION 1 MAXRESULTS 100&minorversion=75
```

- NOT real SQL, NOT GraphQL — Intuit's restricted dialect.
- `FROM` takes exactly one entity (`Invoice`,`Customer`,`Item`,`Bill`,`Payment`,`Vendor`,`Account`,…). No JOINs.
- Quote ALL literals incl. numeric ids + amounts: `WHERE CustomerRef = '58'`, `WHERE Balance > '0'`. Booleans UNQUOTED: `WHERE Active = true`. Dates/datetimes quoted: `WHERE TxnDate >= '2026-01-01'`.
- Field names are **case-sensitive PascalCase** (`TxnDate`,`DocNumber`,`DisplayName`,`MetaData.LastUpdatedTime`). Wrong case can silently return wrong/empty results.
- `LIKE` uses `%` (no reliable `_` single-char wildcard).

## Filter syntax

| Capability          | Supported? | Syntax                               | Notes                           |
| ------------------- | ---------- | ------------------------------------ | ------------------------------- |
| Equality            | Yes        | `WHERE DisplayName = 'Amy'`          |                                 |
| Comparison          | Yes        | `>`,`<`,`>=`,`<=` (quote literal)    | `WHERE TxnDate >= '2026-01-01'` |
| IN list             | Yes        | `WHERE DocNumber IN ('1070','1071')` |                                 |
| LIKE                | Yes        | `WHERE DisplayName LIKE 'Amy%'`      | `%` wildcard; no true full-text |
| Logical AND         | Yes        | `WHERE A = 'x' AND B = 'y'`          | **AND only**                    |
| Logical OR          | **No**     | —                                    | run multiple queries instead    |
| Parentheses/nesting | **No**     | —                                    |                                 |
| ORDER BY            | Yes        | `ORDER BY TxnDate DESC`              | asc default                     |
| Field selection     | Yes        | `SELECT Id, DocNumber FROM Invoice`  | or `SELECT *`                   |
| COUNT               | Yes        | `SELECT COUNT(*) FROM Invoice`       | returns `totalCount`, no rows   |
| Pagination          | Yes        | `STARTPOSITION n MAXRESULTS m`       | inside SELECT, not URL params   |
| NULL checks         | Limited    | not generally supported              | [INFERRED — verify in sandbox]  |
| Regex               | **No**     | only `LIKE` with `%`                 |                                 |

To express OR: issue separate queries + merge client-side, or use CDC for "everything that changed".

## Pagination

Offset-based, expressed INSIDE the SELECT (not URL params). Default `MAXRESULTS`=100, max=1000. `STARTPOSITION` is **1-based**. No cursor — detect last page by short array (rows < `MAXRESULTS`) or absent entity key. Always include a stable `ORDER BY Id` so offsets are deterministic across pages.

```
SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1    MAXRESULTS 1000   # page 1
SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1001 MAXRESULTS 1000   # page 2
SELECT * FROM Invoice ORDER BY Id STARTPOSITION 2001 MAXRESULTS 1000   # page 3 …until rows < 1000
```

## List response shape

`{"QueryResponse":{"startPosition":1,"maxResults":100,"totalCount":2,"Invoice":[{…},{…}]},"time":"2026-05-29T10:00:00.123-07:00"}`

**Empty result = `"QueryResponse":{}`** — entity array key (`Invoice`) ABSENT, `totalCount` may be omitted. Check for the key first; never assume the array exists. `COUNT(*)` returns only `totalCount` (no rows). [INFERRED on exact empty shape]

## Query Pattern Library

**Customers / Vendors**

```
SELECT * FROM Customer WHERE DisplayName LIKE 'Amy%'                                  # find by name
SELECT * FROM Customer WHERE Active = true ORDER BY DisplayName MAXRESULTS 1000       # all active
SELECT * FROM Customer WHERE Balance > '0' ORDER BY Balance DESC                      # outstanding balance
GET /v3/company/{realmId}/customer/58                                                 # one by id
SELECT * FROM Vendor WHERE DisplayName LIKE '%Supplies%'                              # find vendor
```

**Invoices (A/R)**

```
SELECT * FROM Invoice WHERE Balance > '0' ORDER BY TxnDate DESC MAXRESULTS 100        # unpaid/open, newest first
SELECT * FROM Invoice WHERE CustomerRef = '58' ORDER BY TxnDate DESC                  # for a customer
SELECT * FROM Invoice WHERE DueDate < '2026-05-29' AND Balance > '0' ORDER BY DueDate ASC   # overdue
SELECT * FROM Invoice WHERE TxnDate >= '2026-01-01' AND TxnDate <= '2026-03-31' ORDER BY TxnDate ASC  # date range
SELECT * FROM Invoice WHERE DocNumber = '1071'                                        # by number
SELECT * FROM Invoice ORDER BY MetaData.CreateTime DESC MAXRESULTS 10                 # most recent 10
GET /v3/company/{realmId}/invoice/130                                                 # one by id
GET /v3/company/{realmId}/invoice/130/pdf  (Accept: application/pdf)                  # as PDF
```

**Bills (A/P)**

```
SELECT * FROM Bill WHERE Balance > '0' ORDER BY DueDate ASC MAXRESULTS 1000           # open bills
SELECT * FROM Bill WHERE VendorRef = '56' AND DueDate <= '2026-05-31' AND Balance > '0'   # due this month for vendor
SELECT * FROM Bill WHERE TxnDate >= '2026-04-01' AND TxnDate <= '2026-06-30' ORDER BY TxnDate ASC  # date range
```

**Payments**

```
SELECT * FROM Payment WHERE CustomerRef = '58' ORDER BY TxnDate DESC                  # received from customer
SELECT * FROM Payment WHERE TxnDate >= '2026-05-01' ORDER BY TxnDate DESC MAXRESULTS 100  # recent
```

**Items / Accounts**

```
SELECT * FROM Item WHERE Active = true ORDER BY Name MAXRESULTS 1000                  # all active items
SELECT * FROM Item WHERE Name LIKE '%pump%'                                           # find item by name
SELECT * FROM Account WHERE AccountType = 'Income' ORDER BY Name                      # income accounts (wire up item/line)
SELECT * FROM Account WHERE AccountType = 'Bank'                                      # A/R or bank account
```

**Counting**

```
SELECT COUNT(*) FROM Invoice                       # → {"QueryResponse":{"totalCount":412},"time":"…"} (no rows)
SELECT COUNT(*) FROM Bill WHERE Balance > '0'      # open bill count
```

## Incremental sync (what changed)

Prefer **CDC** for multi-entity polling (one call), or per-entity `LastUpdatedTime` for a single stream.

```
# per-entity, by last-modified (save last row's LastUpdatedTime as next cursor):
SELECT * FROM Customer WHERE MetaData.LastUpdatedTime > '2026-05-28T00:00:00-07:00' ORDER BY MetaData.LastUpdatedTime ASC
# CDC — full objects, many entities, one call; changedSince reaches ~30d back (see 01d):
GET /v3/company/{realmId}/cdc?entities=Invoice,Customer,Bill,Payment,Item&changedSince=2026-05-28T00:00:00-07:00
```

## Worked Examples

**1. Full invoice export (paged):** `SELECT * FROM Invoice ORDER BY Id STARTPOSITION 1 MAXRESULTS 1000` → bump `STARTPOSITION` by 1000 each page → stop when rows < 1000.

**2. Gather ids to create an invoice (see 01c):**

```
SELECT Id, DisplayName FROM Customer WHERE DisplayName LIKE 'Amy%'          # 1. resolve customer id
SELECT Id, Name, UnitPrice FROM Item WHERE Name = 'Consulting Services'     # 2. resolve item id (its income account is wired on the item)
SELECT Id, Name FROM Account WHERE AccountType = 'Income'                   # 3. (optional) income account if overriding
# 4. POST the invoice — see 01c
```

**3. Find unpaid invoices for one customer (to apply a payment — see 01c):**
`SELECT Id, DocNumber, Balance, SyncToken FROM Invoice WHERE CustomerRef = '58' AND Balance > '0' ORDER BY TxnDate ASC` → build `/payment` with a `LinkedTxn` per invoice id.

**4. A/R aging via report:** `GET /v3/company/{realmId}/reports/AgedReceivables?minorversion=75`. Reports return aggregated columns/rows (not entity arrays) and carry a LOWER rate limit (~200/min) — don't poll aggressively.

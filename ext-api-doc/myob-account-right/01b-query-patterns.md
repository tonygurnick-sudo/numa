---
doc: query-patterns (NL → read operation) — MYOB AccountRight (MYOB Business API v2)
query_protocol: OData v2 ($top/$skip/$orderby/$filter); v3 ops any/all supported. All params are URL query-string values.
field_casing: case-sensitive PascalCase (LastModified not lastModified, IsActive not isactive)
confidence: paths [DOCUMENTED] from official docs/SDK; response field names [INFERRED] where not live-confirmed
ref: https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/
---

# Query Patterns — MYOB AccountRight

## Filter Syntax

| Param      | Purpose                             | Example                       |
| ---------- | ----------------------------------- | ----------------------------- |
| `$top`     | max records (default 400, max 1000) | `?$top=1000`                  |
| `$skip`    | skip first N                        | `?$skip=1000`                 |
| `$orderby` | sort                                | `?$orderby=LastModified desc` |
| `$filter`  | filter expression                   | `?$filter=IsActive eq true`   |

**Operators:** `eq` (equals: `Status eq 'Open'`) · `gt` (`TotalAmount gt 1000`) · `ge` (`LastModified ge datetime'2024-01-01'`) · `lt` (`Date lt datetime'2024-12-31'`) · `le` · `and` (`Status eq 'Open' and IsActive eq true`) · `or` (`Type eq 'Customer' or Type eq 'Supplier'`) · `substringof(val,field)` contains (`substringof('Acme', CompanyName)`) · `startswith(field,val)` · `endswith(field,val)` · `any(x: x/field eq val)` array contains (`Addresses/any(x: x/Email eq 'a@b.com')`).

## Pagination

```
GET /{resource}?$top=1000                        # page 1
GET /{resource}?$top=1000&$skip=1000             # page 2
GET /{resource}?$top=1000&$skip={(N-1)*1000}     # page N
```

Response has `NextPageLink` — follow it. Null/absent → last page. Best practice: `$skip` = multiple of `$top`.

## Query Library

### Contacts

```
GET /Contact/Customer?$filter=IsActive eq true&$top=1000                                              # all active customers
GET /Contact/Customer?$filter=substringof('Acme Corp', CompanyName)                                   # by company name
GET /Contact/Customer?$filter=Addresses/any(x: x/Email eq 'tony@example.com')                         # by email
GET /Contact/Customer?$filter=LastModified ge datetime'2024-06-01'&$orderby=LastModified desc&$top=1000  # modified since (incremental)
GET /Contact/Customer/{uid}                                                                           # by UID
GET /Contact/Supplier?$filter=IsActive eq true&$top=1000                                              # all active suppliers
```

### Sales / Invoices

```
GET /Sale/Invoice/Item?$filter=Status eq 'Open'&$top=1000                                             # all open
GET /Sale/Invoice/Item?$filter=Status eq 'Closed'&$orderby=Date desc&$top=1000                        # all paid (closed)
GET /Sale/Invoice/Item?$filter=Customer/UID eq guid'{customer_uid}'&$top=1000                         # for a customer
GET /Sale/Invoice/Item?$filter=LastModified ge datetime'2024-06-01'&$orderby=LastModified desc&$top=1000  # modified since
GET /Sale/Invoice/Item?$filter=Date ge datetime'2024-01-01' and Date le datetime'2024-03-31'&$orderby=Date asc&$top=1000  # date range
GET /Sale/Invoice/Item?$filter=TotalAmount gt 5000&$orderby=TotalAmount desc                          # over a value
GET /Sale/Invoice/Item?$orderby=Date desc&$top=10                                                     # most recent 10
GET /Sale/Invoice/Item/{uid}                                                                          # single by UID
GET /Sale/Invoice/Item/{uid}    # + header Accept: application/pdf                                     # download as PDF
GET /Sale/Invoice/Service?$top=1000&$orderby=Date desc                                                # all service invoices
```

> GUID filter syntax may need `guid'...'` wrapper [INFERRED from OData conventions; confirm against sandbox].

### Purchases / Bills

```
GET /Purchase/Bill/Item?$filter=Status eq 'Open'&$top=1000                                            # all open bills
GET /Purchase/Bill/Item?$filter=Supplier/UID eq guid'{supplier_uid}'&$top=1000                        # for a supplier
GET /Purchase/Bill/Item?$filter=LastModified ge datetime'2024-06-01'&$top=1000                        # modified since
```

### General Ledger

```
GET /GeneralLedger/Account?$orderby=Number asc&$top=1000                                              # all accounts
GET /GeneralLedger/Account?$filter=Type eq 'Income'&$orderby=Number asc                               # income only
GET /GeneralLedger/Account?$filter=DisplayID gt '4-0000'&$orderby=Name                                # DisplayID > 4-0000
GET /GeneralLedger/TaxCode                                                                            # all tax codes
GET /GeneralLedger/JournalTransaction?$filter=DateOccurred ge datetime'2024-04-01' and DateOccurred le datetime'2024-06-30'&$top=1000  # journals in range
```

### Inventory

```
GET /Inventory/Item?$filter=IsActive eq true&$top=1000                                                # all active items
GET /Inventory/Item?$filter=substringof('Widget', Name)                                               # by name
```

### Banking

```
GET /Banking/SpendMoneyTxn?$filter=LastModified ge datetime'2024-06-01'&$top=1000                     # spend money since date
GET /Banking/ReceiveMoneyTxn?$top=1000&$orderby=Date desc                                             # receive money
```

### Company / Scopes

```
GET /CompanyFile      # company file info
GET /DataScopes       # all enabled SME scopes + endpoints; no scope required [DOCUMENTED https://apisupport.myob.com/hc/en-us/articles/13065472856719]
```

## Worked Examples (end-to-end)

**1. Full customer list for sync** — page until `NextPageLink` is null:

```
GET /Contact/Customer?$top=1000&$orderby=LastModified asc
GET /Contact/Customer?$top=1000&$skip=1000&$orderby=LastModified asc
```

**2. Incremental invoice sync** — save last record's `LastModified` as next cursor:

```
GET /Sale/Invoice/Item?$filter=LastModified ge datetime'2024-06-01'&$orderby=LastModified asc&$top=1000
```

**3. Fetch all data to create an invoice** (then POST, see 01c):

```
GET /Contact/Customer?$filter=substringof('Acme', CompanyName)    # customer UID
GET /Inventory/Item?$filter=substringof('Widget A', Name)         # item UID
GET /GeneralLedger/TaxCode                                        # tax code UID
GET /GeneralLedger/Account?$filter=Type eq 'Income'               # income account UID
```

**4. Unpaid invoices for a customer:**

```
GET /Sale/Invoice/Item?$filter=Customer/UID eq guid'{customer_uid}' and Status eq 'Open'&$orderby=Date asc&$top=1000
```

**5. Recent payments received:**

```
GET /Sale/CustomerPayment?$filter=LastModified ge datetime'2024-06-01'&$orderby=Date desc&$top=1000
```

## Response Structure (generic list) [NEEDS TESTING — inferred from pagination docs]

```json
{"Count":42,"PageSize":1000,"NextPageLink":"https://api.myob.com/accountright/{businessId}/Contact/Customer?$top=1000&$skip=1000","Items":[{"...entity..."},{"...entity..."}]}
```

`NextPageLink` null/absent → last page.

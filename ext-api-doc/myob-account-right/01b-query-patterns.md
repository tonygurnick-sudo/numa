# Query Patterns — MYOB AccountRight (MYOB Business API v2)

> Natural language → API read operation mappings.
> All endpoint paths confirmed from official documentation or SDK source.
> Response body field names marked [INFERRED] where not confirmed from live calls.

---

## Filter Syntax Reference

The API uses **OData v2** query parameters with v3 support for advanced operators (`any`/`all`). All parameters are URL query string values.

| Parameter  | Purpose                                       | Example                       |
| ---------- | --------------------------------------------- | ----------------------------- |
| `$top`     | Max records to return (default 400, max 1000) | `?$top=1000`                  |
| `$skip`    | Skip first N records                          | `?$skip=1000`                 |
| `$orderby` | Sort results                                  | `?$orderby=LastModified desc` |
| `$filter`  | Filter expression                             | `?$filter=IsActive eq true`   |

### Filter operators

| Operator                  | Meaning               | Example                                    |
| ------------------------- | --------------------- | ------------------------------------------ |
| `eq`                      | Equals                | `Status eq 'Open'`                         |
| `gt`                      | Greater than          | `TotalAmount gt 1000`                      |
| `ge`                      | Greater than or equal | `LastModified ge datetime'2024-01-01'`     |
| `lt`                      | Less than             | `Date lt datetime'2024-12-31'`             |
| `le`                      | Less than or equal    | `Date le datetime'2024-12-31'`             |
| `and`                     | Logical AND           | `Status eq 'Open' and IsActive eq true`    |
| `or`                      | Logical OR            | `Type eq 'Customer' or Type eq 'Supplier'` |
| `substringof(val, field)` | Contains              | `substringof('Acme', CompanyName)`         |
| `startswith(field, val)`  | Starts with           | `startswith(CompanyName, 'Acme')`          |
| `endswith(field, val)`    | Ends with             | `endswith(CompanyName, 'Ltd')`             |
| `any(x: x/field eq val)`  | Array contains        | `Addresses/any(x: x/Email eq 'a@b.com')`   |

> ⚠️ **Field names are case-sensitive.** Use `LastModified` not `lastModified`, `IsActive` not `isactive`.

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/

---

## Pagination Pattern

```
# Page 1
GET /{resource}?$top=1000

# Page 2
GET /{resource}?$top=1000&$skip=1000

# Page N
GET /{resource}?$top=1000&$skip={(N-1)*1000}
```

Response includes `NextPageLink` — follow it to get the next page. When `NextPageLink` is absent or null, you've reached the last page.

**Best practice:** `$skip` should always be a multiple of `$top`.

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/retrieving-data/

---

## Query Pattern Library

### Contacts

**"Get all active customers"**

```
GET /Contact/Customer?$filter=IsActive eq true&$top=1000
```

**"Find customer by company name"**

```
GET /Contact/Customer?$filter=substringof('Acme Corp', CompanyName)
```

**"Find customer by email address"**

```
GET /Contact/Customer?$filter=Addresses/any(x: x/Email eq 'tony@example.com')
```

**"Get customers modified since date (incremental sync)"**

```
GET /Contact/Customer?$filter=LastModified ge datetime'2024-06-01'&$orderby=LastModified desc&$top=1000
```

**"Get a specific customer by UID"**

```
GET /Contact/Customer/{uid}
```

**"Get all active suppliers"**

```
GET /Contact/Supplier?$filter=IsActive eq true&$top=1000
```

---

### Sales / Invoices

**"Get all open invoices"**

```
GET /Sale/Invoice/Item?$filter=Status eq 'Open'&$top=1000
```

**"Get all paid (closed) invoices"**

```
GET /Sale/Invoice/Item?$filter=Status eq 'Closed'&$orderby=Date desc&$top=1000
```

**"Get invoices for a specific customer"**

```
GET /Sale/Invoice/Item?$filter=Customer/UID eq guid'{customer_uid}'&$top=1000
```

> Note: GUID filter syntax may require `guid'...'` wrapper — [INFERRED from OData conventions; confirm against sandbox]

**"Get invoices modified since a date"**

```
GET /Sale/Invoice/Item?$filter=LastModified ge datetime'2024-06-01'&$orderby=LastModified desc&$top=1000
```

**"Get invoices in a date range"**

```
GET /Sale/Invoice/Item?$filter=Date ge datetime'2024-01-01' and Date le datetime'2024-03-31'&$orderby=Date asc&$top=1000
```

**"Get invoices over a certain value"**

```
GET /Sale/Invoice/Item?$filter=TotalAmount gt 5000&$orderby=TotalAmount desc
```

**"Get the most recent 10 invoices"**

```
GET /Sale/Invoice/Item?$orderby=Date desc&$top=10
```

**"Get a single invoice by UID"**

```
GET /Sale/Invoice/Item/{uid}
```

**"Download invoice as PDF"**

```
GET /Sale/Invoice/Item/{uid}
Accept: application/pdf
```

**"Get all service invoices"**

```
GET /Sale/Invoice/Service?$top=1000&$orderby=Date desc
```

---

### Purchases / Bills

**"Get all open bills"**

```
GET /Purchase/Bill/Item?$filter=Status eq 'Open'&$top=1000
```

**"Get bills for a specific supplier"**

```
GET /Purchase/Bill/Item?$filter=Supplier/UID eq guid'{supplier_uid}'&$top=1000
```

**"Get bills modified since a date"**

```
GET /Purchase/Bill/Item?$filter=LastModified ge datetime'2024-06-01'&$top=1000
```

---

### General Ledger

**"Get all accounts"**

```
GET /GeneralLedger/Account?$orderby=Number asc&$top=1000
```

**"Get income accounts only"**

```
GET /GeneralLedger/Account?$filter=Type eq 'Income'&$orderby=Number asc
```

**"Get accounts with display ID greater than 4-0000"**

```
GET /GeneralLedger/Account?$filter=DisplayID gt '4-0000'&$orderby=Name
```

**"Get all tax codes"**

```
GET /GeneralLedger/TaxCode
```

**"Get journal transactions for a date range"**

```
GET /GeneralLedger/JournalTransaction?$filter=DateOccurred ge datetime'2024-04-01' and DateOccurred le datetime'2024-06-30'&$top=1000
```

---

### Inventory

**"Get all active inventory items"**

```
GET /Inventory/Item?$filter=IsActive eq true&$top=1000
```

**"Find inventory item by name"**

```
GET /Inventory/Item?$filter=substringof('Widget', Name)
```

---

### Banking

**"Get spend money transactions since date"**

```
GET /Banking/SpendMoneyTxn?$filter=LastModified ge datetime'2024-06-01'&$top=1000
```

**"Get receive money transactions"**

```
GET /Banking/ReceiveMoneyTxn?$top=1000&$orderby=Date desc
```

---

### Company / Scopes

**"Get company file information"**

```
GET /CompanyFile
```

**"List all available API scopes and endpoints"**

```
GET /DataScopes
```

> This endpoint requires no specific scope. Returns all SME scopes and their endpoints.

[DOCUMENTED] https://apisupport.myob.com/hc/en-us/articles/13065472856719

---

## Worked Examples (End-to-End)

### Example 1: Full customer list for sync

```
# Step 1: Get first page
GET /Contact/Customer?$top=1000&$orderby=LastModified asc
# Check response for NextPageLink

# Step 2: Follow NextPageLink or manually page
GET /Contact/Customer?$top=1000&$skip=1000&$orderby=LastModified asc

# Repeat until NextPageLink is null
```

### Example 2: Incremental invoice sync

```
# Assume last sync was 2024-06-01T10:00:00

GET /Sale/Invoice/Item
  ?$filter=LastModified ge datetime'2024-06-01'
  &$orderby=LastModified asc
  &$top=1000

# Save the LastModified of the last record as the next sync cursor
```

### Example 3: Fetch all data needed to create an invoice

```
# Step 1: Get customer UID
GET /Contact/Customer?$filter=substringof('Acme', CompanyName)

# Step 2: Get inventory item UID
GET /Inventory/Item?$filter=substringof('Widget A', Name)

# Step 3: Get tax code UID
GET /GeneralLedger/TaxCode

# Step 4: Get income account UID
GET /GeneralLedger/Account?$filter=Type eq 'Income'

# Step 5: Create invoice using the UIDs gathered above (see mutation patterns)
```

### Example 4: Find unpaid invoices for a customer

```
GET /Sale/Invoice/Item
  ?$filter=Customer/UID eq guid'{customer_uid}' and Status eq 'Open'
  &$orderby=Date asc
  &$top=1000
```

### Example 5: Get recent payments received

```
GET /Sale/CustomerPayment
  ?$filter=LastModified ge datetime'2024-06-01'
  &$orderby=Date desc
  &$top=1000
```

---

## Response Structure (Generic List)

```json
{
  "Count": 42,
  "PageSize": 1000,
  "NextPageLink": "https://api.myob.com/accountright/{businessId}/Contact/Customer?$top=1000&$skip=1000",
  "Items": [
    { ... entity ... },
    { ... entity ... }
  ]
}
```

Response shape: [NEEDS TESTING — structure inferred from pagination docs]

When `NextPageLink` is `null` or absent, you have reached the last page.

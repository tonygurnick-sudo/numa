# Mutation Patterns — MYOB AccountRight (MYOB Business API v2)

> Natural language → API write operation mappings.
> All endpoint paths confirmed from official docs or SDK source.
> Request body field names marked [INFERRED] where not confirmed from live calls.
> DO NOT use these as drop-in payloads without testing against sandbox first.

---

## General Mutation Rules

1. **POST** — Create a new entity. Returns 201 Created + created entity (or URI).
2. **PUT** — Update an existing entity. **Always include the current `RowVersion`**. Returns 200 OK.
3. **DELETE** — Delete an entity. Some entities cannot be deleted (see Dangerous Operations).
4. **Content-Type** must be `application/json` for all POST/PUT requests.
5. All object references use `{ "UID": "{guid}" }` format.
6. All dates use ISO format: `"2024-06-15T00:00:00"`.

---

## Create Patterns

### Create a Customer

```
POST /Contact/Customer
Content-Type: application/json

{
  "CompanyName": "Acme Corp Ltd",
  "FirstName": "Tony",
  "LastName": "Smith",
  "IsActive": true,
  "Addresses": [
    {
      "Location": 1,
      "Email": "tony@acmecorp.com",
      "Phone1": "09 123 4567",
      "Street": "123 Main St",
      "City": "Auckland",
      "State": "AUK",
      "PostCode": "1010",
      "Country": "New Zealand"
    }
  ]
}
```

[INFERRED from pymyob SDK + apideck guide]

---

### Create a Supplier

```
POST /Contact/Supplier
Content-Type: application/json

{
  "CompanyName": "Parts & Co",
  "IsActive": true,
  "ABN": "12 345 678 901",
  "Addresses": [
    {
      "Location": 1,
      "Email": "orders@partsco.com",
      "Phone1": "02 9876 5432",
      "Street": "456 Supply Road",
      "City": "Sydney",
      "State": "NSW",
      "PostCode": "2000",
      "Country": "Australia"
    }
  ]
}
```

[INFERRED]

---

### Update a Customer (PUT — requires RowVersion)

```
# Step 1: Fetch the customer to get current RowVersion
GET /Contact/Customer/{uid}

# Step 2: PUT with updated fields + RowVersion from Step 1
PUT /Contact/Customer/{uid}
Content-Type: application/json

{
  "UID": "{uid}",
  "CompanyName": "Acme Corp Ltd (Updated)",
  "IsActive": true,
  "RowVersion": "{rowversion_from_step1}",
  "Addresses": [ ... ]
}
```

> ⚠️ If `RowVersion` is stale, you get a `409 IncorrectRowVersionSupplied` error.

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/

---

### Create an Item Invoice

**Prerequisites — fetch these UIDs first:**

- Customer UID: `GET /Contact/Customer?$filter=substringof('Acme', CompanyName)`
- Item UID: `GET /Inventory/Item`
- TaxCode UID: `GET /GeneralLedger/TaxCode`
- Income Account UID: `GET /GeneralLedger/Account?$filter=Type eq 'Income'`

```
POST /Sale/Invoice/Item
Content-Type: application/json

{
  "Date": "2024-06-15T00:00:00",
  "Customer": { "UID": "{customer_uid}" },
  "Number": "INV-0001",
  "Lines": [
    {
      "LineType": "Transaction",
      "Item": { "UID": "{item_uid}" },
      "Description": "Widget A - 10 units",
      "ShipQuantity": 10,
      "UnitPrice": 99.99,
      "DiscountPercent": 0,
      "TaxCode": { "UID": "{taxcode_uid}" },
      "Account": { "UID": "{income_account_uid}" }
    }
  ],
  "Comment": "Thank you for your business"
}
```

[INFERRED from apideck guide + pymyob SDK]

---

### Create a Service Invoice

```
POST /Sale/Invoice/Service
Content-Type: application/json

{
  "Date": "2024-06-15T00:00:00",
  "Customer": { "UID": "{customer_uid}" },
  "Number": "INV-SVC-0001",
  "Lines": [
    {
      "LineType": "Transaction",
      "Account": { "UID": "{income_account_uid}" },
      "Description": "Consulting services - June 2024",
      "Amount": 500.00,
      "TaxCode": { "UID": "{gst_taxcode_uid}" }
    }
  ]
}
```

[INFERRED]

---

### Update an Invoice (PUT)

```
# Step 1: GET the invoice to retrieve RowVersion
GET /Sale/Invoice/Item/{uid}

# Step 2: PUT with full payload + current RowVersion
PUT /Sale/Invoice/Item/{uid}
Content-Type: application/json

{
  "UID": "{uid}",
  "Date": "2024-06-15T00:00:00",
  "Customer": { "UID": "{customer_uid}" },
  "Lines": [ ... ],
  "RowVersion": "{rowversion}"
}
```

[DOCUMENTED from RowVersion rules]

---

### Record a Customer Payment

```
POST /Sale/CustomerPayment
Content-Type: application/json

{
  "Customer": { "UID": "{customer_uid}" },
  "ReceiveFrom": { "UID": "{bank_account_uid}" },
  "Date": "2024-06-20T00:00:00",
  "Amount": 1099.89,
  "Invoices": [
    {
      "UID": "{invoice_uid}",
      "AmountApplied": 1099.89
    }
  ],
  "Memo": "Payment received - INV-0001"
}
```

[INFERRED from pymyob SDK]

---

### Create an Item Bill (Purchase)

```
POST /Purchase/Bill/Item
Content-Type: application/json

{
  "Supplier": { "UID": "{supplier_uid}" },
  "Date": "2024-06-10T00:00:00",
  "Number": "BILL-0001",
  "Lines": [
    {
      "LineType": "Transaction",
      "Item": { "UID": "{item_uid}" },
      "BillQuantity": 5,
      "UnitCost": 45.00,
      "TaxCode": { "UID": "{gst_taxcode_uid}" },
      "Account": { "UID": "{expense_account_uid}" }
    }
  ]
}
```

[INFERRED]

---

### Record a Supplier Payment

```
POST /Purchase/SupplierPayment
Content-Type: application/json

{
  "Supplier": { "UID": "{supplier_uid}" },
  "PayFrom": { "UID": "{bank_account_uid}" },
  "Date": "2024-06-25T00:00:00",
  "Amount": 225.00,
  "Bills": [
    {
      "UID": "{bill_uid}",
      "AmountApplied": 225.00
    }
  ]
}
```

[INFERRED]

---

### Create a Spend Money Transaction

```
POST /Banking/SpendMoneyTxn
Content-Type: application/json

{
  "Account": { "UID": "{bank_account_uid}" },
  "Date": "2024-06-15T00:00:00",
  "Amount": 150.00,
  "Lines": [
    {
      "Account": { "UID": "{expense_account_uid}" },
      "Amount": 150.00,
      "TaxCode": { "UID": "{gst_taxcode_uid}" },
      "Memo": "Office supplies"
    }
  ],
  "Memo": "Office supplies purchase"
}
```

[INFERRED]

---

### Create a General Journal Entry

```
POST /GeneralLedger/GeneralJournal
Content-Type: application/json

{
  "DateOccurred": "2024-06-30T00:00:00",
  "Memo": "Month-end accrual",
  "Lines": [
    {
      "Account": { "UID": "{debit_account_uid}" },
      "IsCredit": false,
      "Amount": 1000.00,
      "TaxCode": { "UID": "{nt_taxcode_uid}" }
    },
    {
      "Account": { "UID": "{credit_account_uid}" },
      "IsCredit": true,
      "Amount": 1000.00,
      "TaxCode": { "UID": "{nt_taxcode_uid}" }
    }
  ]
}
```

[INFERRED]

---

### Email an Invoice

```
POST /Sale/Invoice/Item/{uid}/email
Content-Type: application/json

{
  "To": "customer@example.com",
  "Subject": "Invoice INV-0001",
  "Message": "Please find attached your invoice."
}
```

> ⚠️ Only works for **online (cloud-hosted)** company files. Local desktop files will return an error.

[DOCUMENTED] https://www.apideck.com/blog/how-to-integrate-with-the-myob-api
Body field names: [INFERRED — confirm against sandbox before use]

---

### Delete an Entity

```
DELETE /Contact/Customer/{uid}
DELETE /Sale/Invoice/Item/{uid}
DELETE /Purchase/Bill/Item/{uid}
```

Returns 200 OK on success. Returns 400 with `TransactionsCannotBeDeleted` error if the company file setting prohibits deletion.

---

## State Transitions

### Mark invoice as paid (Close it)

Invoices are closed **automatically** when a `CustomerPayment` is posted that fully covers the invoice amount. You do not PUT a status field directly.

### Reverse a transaction (when deletion is not permitted)

When `TransactionsCannotBeChangedMustBeReversed = true` on the company file:

1. Do NOT attempt DELETE — returns error 25003
2. Create a new reversing transaction with negative amounts and the same date (or current date)

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/

---

## Dangerous Operations

| Operation                         | Risk                                                         | Mitigation                                                  |
| --------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| `DELETE /Sale/Invoice/Item/{uid}` | Permanent deletion if company permits it. Irreversible.      | Check company file setting first. Prefer reversals.         |
| `PUT` with wrong RowVersion       | Returns 409 — no data loss, but you must re-fetch RowVersion | Always GET before PUT                                       |
| POST with duplicate `Number`      | May create duplicate entities or return validation error     | Check if entity already exists with GET before POST         |
| `DELETE /Contact/Customer/{uid}`  | Removes contact. May fail if contact has open transactions.  | Set `IsActive = false` (soft-delete) instead of hard DELETE |

---

## Common POST/PUT Error Scenarios

| Error                                              | Cause                                        | Fix                                               |
| -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| `Required` (code 100)                              | Missing required field                       | Add missing field to payload                      |
| `NotFound` (code 150)                              | Referenced UID doesn't exist                 | Verify UID via GET before submitting              |
| `SerializationError` (code 50)                     | Wrong type (e.g. string instead of boolean)  | Check field types                                 |
| `IncorrectRowVersionSupplied` (code 111, HTTP 409) | Stale RowVersion on PUT                      | Re-fetch entity and retry                         |
| `TransactionsCannotBeDeleted` (code 25003)         | Company file setting prevents deletion       | Create reversal instead                           |
| `DatePriorToBeginningOfFinancialYear` (code 25008) | Date before financial year start             | Use a date within the current financial year      |
| `FreightHasNotBeenSet`                             | Freight amount set without TaxCode           | Add `FreightTaxCode: { "UID": "..." }` to invoice |
| `AccountHeaderNotAllowed`                          | Using a header-type account in a transaction | Use a detail-type account                         |
| `ConsolidatedTaxCodesNotAllowed`                   | Consolidated tax code used on line           | Use a non-consolidated tax code                   |

[DOCUMENTED] https://developer.myob.com/api/myob-business-api/api-overview/error-messages/
https://apisupport.myob.com/hc/en-us/sections/360000104856

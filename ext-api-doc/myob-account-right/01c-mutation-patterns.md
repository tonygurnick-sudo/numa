---
doc: mutation-patterns (NL → write operation) — MYOB AccountRight (MYOB Business API v2)
confidence: paths [DOCUMENTED] from official docs/SDK; request field names [INFERRED] where not live-confirmed — do NOT use as drop-in payloads without sandbox testing
ref: errors=https://developer.myob.com/api/myob-business-api/api-overview/error-messages/ · rules-section=https://apisupport.myob.com/hc/en-us/sections/360000104856 · apideck=https://www.apideck.com/blog/how-to-integrate-with-the-myob-api
---

# Mutation Patterns — MYOB AccountRight

## General Rules

- **POST** = create → 201 + created entity (or URI). **PUT** = update → 200; **always include current `RowVersion`**. **DELETE** = delete (some entities cannot — see Dangerous Operations).
- `Content-Type: application/json` on all POST/PUT.
- All object references use `{ "UID": "{guid}" }`. All dates ISO: `"2024-06-15T00:00:00"`.

## Create Customer — `POST /Contact/Customer`

```json
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

## Create Supplier — `POST /Contact/Supplier`

```json
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

## Update Customer — `PUT /Contact/Customer/{uid}` (requires RowVersion)

Step 1: `GET /Contact/Customer/{uid}` to get current `RowVersion`. Step 2:

```json
{
  "UID": "{uid}",
  "CompanyName": "Acme Corp Ltd (Updated)",
  "IsActive": true,
  "RowVersion": "{rowversion_from_step1}",
  "Addresses": []
}
```

Stale `RowVersion` → `409 IncorrectRowVersionSupplied` [DOCUMENTED errors].

## Create Item Invoice — `POST /Sale/Invoice/Item`

Prereq UIDs (fetch first): Customer `GET /Contact/Customer?$filter=substringof('Acme', CompanyName)`; Item `GET /Inventory/Item`; TaxCode `GET /GeneralLedger/TaxCode`; Income Account `GET /GeneralLedger/Account?$filter=Type eq 'Income'`.

```json
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

## Create Service Invoice — `POST /Sale/Invoice/Service`

```json
{
  "Date": "2024-06-15T00:00:00",
  "Customer": { "UID": "{customer_uid}" },
  "Number": "INV-SVC-0001",
  "Lines": [
    {
      "LineType": "Transaction",
      "Account": { "UID": "{income_account_uid}" },
      "Description": "Consulting services - June 2024",
      "Amount": 500.0,
      "TaxCode": { "UID": "{gst_taxcode_uid}" }
    }
  ]
}
```

## Update Invoice — `PUT /Sale/Invoice/Item/{uid}`

Step 1: `GET /Sale/Invoice/Item/{uid}` for `RowVersion`. Step 2 (full payload + current RowVersion):

```json
{
  "UID": "{uid}",
  "Date": "2024-06-15T00:00:00",
  "Customer": { "UID": "{customer_uid}" },
  "Lines": [],
  "RowVersion": "{rowversion}"
}
```

## Record Customer Payment — `POST /Sale/CustomerPayment`

```json
{
  "Customer": { "UID": "{customer_uid}" },
  "ReceiveFrom": { "UID": "{bank_account_uid}" },
  "Date": "2024-06-20T00:00:00",
  "Amount": 1099.89,
  "Invoices": [{ "UID": "{invoice_uid}", "AmountApplied": 1099.89 }],
  "Memo": "Payment received - INV-0001"
}
```

## Create Item Bill — `POST /Purchase/Bill/Item`

```json
{
  "Supplier": { "UID": "{supplier_uid}" },
  "Date": "2024-06-10T00:00:00",
  "Number": "BILL-0001",
  "Lines": [
    {
      "LineType": "Transaction",
      "Item": { "UID": "{item_uid}" },
      "BillQuantity": 5,
      "UnitCost": 45.0,
      "TaxCode": { "UID": "{gst_taxcode_uid}" },
      "Account": { "UID": "{expense_account_uid}" }
    }
  ]
}
```

## Record Supplier Payment — `POST /Purchase/SupplierPayment`

```json
{
  "Supplier": { "UID": "{supplier_uid}" },
  "PayFrom": { "UID": "{bank_account_uid}" },
  "Date": "2024-06-25T00:00:00",
  "Amount": 225.0,
  "Bills": [{ "UID": "{bill_uid}", "AmountApplied": 225.0 }]
}
```

## Create Spend Money — `POST /Banking/SpendMoneyTxn`

```json
{
  "Account": { "UID": "{bank_account_uid}" },
  "Date": "2024-06-15T00:00:00",
  "Amount": 150.0,
  "Lines": [
    {
      "Account": { "UID": "{expense_account_uid}" },
      "Amount": 150.0,
      "TaxCode": { "UID": "{gst_taxcode_uid}" },
      "Memo": "Office supplies"
    }
  ],
  "Memo": "Office supplies purchase"
}
```

## Create General Journal — `POST /GeneralLedger/GeneralJournal`

```json
{
  "DateOccurred": "2024-06-30T00:00:00",
  "Memo": "Month-end accrual",
  "Lines": [
    {
      "Account": { "UID": "{debit_account_uid}" },
      "IsCredit": false,
      "Amount": 1000.0,
      "TaxCode": { "UID": "{nt_taxcode_uid}" }
    },
    {
      "Account": { "UID": "{credit_account_uid}" },
      "IsCredit": true,
      "Amount": 1000.0,
      "TaxCode": { "UID": "{nt_taxcode_uid}" }
    }
  ]
}
```

## Email an Invoice — `POST /Sale/Invoice/Item/{uid}/email`

```json
{ "To": "customer@example.com", "Subject": "Invoice INV-0001", "Message": "Please find attached your invoice." }
```

Only works for **online (cloud-hosted)** company files; local desktop files error. [DOCUMENTED apideck] Body field names [INFERRED — confirm against sandbox].

## Delete an Entity

```
DELETE /Contact/Customer/{uid}    DELETE /Sale/Invoice/Item/{uid}    DELETE /Purchase/Bill/Item/{uid}
```

200 OK on success. 400 `TransactionsCannotBeDeleted` if company file setting prohibits deletion.

## State Transitions

- **Mark invoice paid (Close):** automatic when a `CustomerPayment` fully covering the amount is posted. Do NOT PUT a status field.
- **Reverse a transaction** (when `TransactionsCannotBeChangedMustBeReversed=true`): do NOT DELETE (error 25003) — POST a new reversing transaction with negative amounts, same date (or current date). [DOCUMENTED errors]

## Dangerous Operations

| Operation                         | Risk                                           | Mitigation                                    |
| --------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| `DELETE /Sale/Invoice/Item/{uid}` | permanent, irreversible if company permits     | check company setting first; prefer reversals |
| `PUT` with wrong RowVersion       | 409 (no data loss) but must re-fetch           | always GET before PUT                         |
| POST with duplicate `Number`      | duplicate entity or validation error           | GET to check existence before POST            |
| `DELETE /Contact/Customer/{uid}`  | removes contact; may fail if open transactions | set `IsActive=false` (soft-delete) instead    |

## Common POST/PUT Errors

| Error (code)                                  | Cause                                | Fix                                |
| --------------------------------------------- | ------------------------------------ | ---------------------------------- |
| `Required` (100)                              | missing required field               | add field                          |
| `NotFound` (150)                              | referenced UID doesn't exist         | verify UID via GET                 |
| `SerializationError` (50)                     | wrong type (string for boolean etc.) | check field types                  |
| `IncorrectRowVersionSupplied` (111, HTTP 409) | stale RowVersion on PUT              | re-fetch + retry                   |
| `TransactionsCannotBeDeleted` (25003)         | company "must reverse" setting       | create reversal                    |
| `DatePriorToBeginningOfFinancialYear` (25008) | date before FY start                 | use date in current FY             |
| `FreightHasNotBeenSet`                        | freight amount without TaxCode       | add `FreightTaxCode:{"UID":"..."}` |
| `AccountHeaderNotAllowed`                     | header-type account in a transaction | use a detail-type account          |
| `ConsolidatedTaxCodesNotAllowed`              | consolidated tax code on a line      | use a non-consolidated tax code    |

[DOCUMENTED errors + rules-section]

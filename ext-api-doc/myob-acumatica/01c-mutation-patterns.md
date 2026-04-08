# MYOB Acumatica -- Mutation Patterns

> **API Version:** 24.200.001 | **Mutation method:** PUT (upsert)
> Companion to `01-llm-api-rules.md`.

---

## Write Capabilities Summary

| Operation          | Supported | Method | Notes                                              |
| ------------------ | --------- | ------ | -------------------------------------------------- |
| Create             | Yes       | PUT    | No `id` or key match = create                      |
| Update (partial)   | Yes       | PUT    | Include `id` + changed fields only (except arrays) |
| Delete             | Yes       | DELETE | By GUID or by key values in URL path               |
| Bulk create/update | No        | --     | Loop individual PUT calls                          |
| State transitions  | Yes       | POST   | Action sub-resource endpoint                       |
| File upload        | Yes       | PUT    | Binary body to files sub-resource                  |

Source: https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=9d966d50-a0a1-4456-a9ff-1cc2159d48d4

---

## The PUT Upsert Model

**[DOCUMENTED]** -- MYOB Acumatica uses PUT for both creation and updates. There is no POST for entity creation and no PATCH for partial updates.

| Operation | Method | `id` field | Body                                                |
| --------- | ------ | ---------- | --------------------------------------------------- |
| Create    | PUT    | Omit       | Full entity (required fields + optional)            |
| Update    | PUT    | Include    | Changed fields + `id` (except line items: send ALL) |
| Delete    | DELETE | In URL     | --                                                  |
| Action    | POST   | In URL     | Action-specific body                                |

---

## Creating Records

### Simple Entity (Customer)

```http
PUT /entity/Default/24.200.001/Customer
Content-Type: application/json
Authorization: Bearer {token}

{
    "CustomerID": {"value": "ACME01"},
    "CustomerName": {"value": "Acme Corporation"},
    "CustomerClass": {"value": "DEFAULT"},
    "Status": {"value": "Active"},
    "MainContact": {
        "Email": {"value": "billing@acme.com"},
        "Phone1": {"value": "+64 9 555 0100"}
    },
    "BillingAddress": {
        "AddressLine1": {"value": "123 Main Street"},
        "City": {"value": "Auckland"},
        "State": {"value": "AUK"},
        "PostalCode": {"value": "1010"},
        "Country": {"value": "NZ"}
    }
}
```

**Response:** `200 OK` with the complete entity including system-generated `id`, `rowNumber`, `note`.

### Entity with Line Items (SalesOrder)

```http
PUT /entity/Default/24.200.001/SalesOrder
Content-Type: application/json
Authorization: Bearer {token}

{
    "OrderType": {"value": "SO"},
    "CustomerID": {"value": "ACME01"},
    "Date": {"value": "2026-03-30"},
    "Description": {"value": "March order"},
    "Details": [
        {
            "InventoryID": {"value": "WIDGET01"},
            "Quantity": {"value": 10},
            "UnitPrice": {"value": 25.00},
            "WarehouseID": {"value": "MAIN"}
        },
        {
            "InventoryID": {"value": "GADGET02"},
            "Quantity": {"value": 5},
            "UnitPrice": {"value": 50.00}
        }
    ]
}
```

### Auto-Numbered Entities

If the instance has auto-numbering configured, omit the business key:

```http
PUT /entity/Default/24.200.001/SalesOrder
{
    "OrderType": {"value": "SO"},
    "CustomerID": {"value": "ACME01"},
    "Details": [...]
}
```

The system assigns `OrderNbr` automatically and returns it in the response.

---

## Updating Records

### Simple Field Update

Include `id` and only the fields to change:

```http
PUT /entity/Default/24.200.001/Customer
Content-Type: application/json
Authorization: Bearer {token}

{
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "CustomerName": {"value": "Acme Corp (Updated)"},
    "MainContact": {
        "Phone1": {"value": "+64 9 555 0200"}
    }
}
```

### Alternative: Update by Key Fields

**[DOCUMENTED]** -- Instead of `id`, you can specify key field values or use `$filter` to identify the record:

```http
PUT /entity/Default/24.200.001/Customer?$filter=CustomerID eq 'ACME01'
Content-Type: application/json
Authorization: Bearer {token}

{
    "CustomerName": {"value": "Acme Corp (Updated)"}
}
```

Source: https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=af48c02a-afbc-4fdb-b1e5-635ac7ebbaf1

### Line Item Updates (CRITICAL: Full Array Replacement)

When updating an entity with line items (`Details`), you **must send ALL lines**. The submitted array completely replaces the existing lines.

**Scenario:** SalesOrder has 2 lines. You want to add a 3rd line and update the quantity on line 1.

**Step 1:** GET the current order with `$expand=Details` to get line `id` values.

**Step 2:** PUT with all 3 lines:

```http
PUT /entity/Default/24.200.001/SalesOrder
Content-Type: application/json
Authorization: Bearer {token}

{
    "id": "order-guid-here",
    "Details": [
        {
            "id": "existing-line-1-guid",
            "InventoryID": {"value": "WIDGET01"},
            "Quantity": {"value": 20},
            "UnitPrice": {"value": 25.00}
        },
        {
            "id": "existing-line-2-guid",
            "InventoryID": {"value": "GADGET02"},
            "Quantity": {"value": 5},
            "UnitPrice": {"value": 50.00}
        },
        {
            "InventoryID": {"value": "NEWITEM03"},
            "Quantity": {"value": 3},
            "UnitPrice": {"value": 75.00}
        }
    ]
}
```

**Rules:**

- Existing lines: include their `id` to preserve them
- New lines: omit `id` -- system assigns one
- Any existing line NOT in the array is **deleted**
- To remove a line: omit it from the array

---

## Deleting Records

**[DOCUMENTED]** -- DELETE by GUID or by key values in the URL path.

### By GUID

```http
DELETE /entity/Default/24.200.001/Customer/a1b2c3d4-e5f6-7890-abcd-ef1234567890
Authorization: Bearer {token}
```

### By Key Values (in URL path)

```http
DELETE /entity/Default/24.200.001/SalesOrder/SO/000123
Authorization: Bearer {token}
```

Key values are separated by `/` in the URL path (e.g., OrderType `SO` and OrderNbr `000123`).

**Response:** `204 No Content`

**Constraints:**

- Cannot delete records with dependent children (e.g., Customer with open orders)
- Cannot delete released financial documents (must void first)
- Returns 400/500 with explanatory `exceptionMessage` if blocked

Source: https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=d806636f-3cb8-4fd6-bc1e-fef9cdf9683d

---

## State Transitions (Actions)

**[DOCUMENTED]** -- Actions trigger business logic and state changes. They use POST to an action sub-resource.

### General Pattern

```http
POST /entity/Default/24.200.001/{Entity}/{guid}/action/{ActionName}
Content-Type: application/json
Authorization: Bearer {token}

{
    "entity": {
        "id": "{guid}"
    }
}
```

### Action Response Pattern

**[DOCUMENTED]** -- Actions return one of two success statuses:

- **204 No Content** -- Action completed immediately. No response body.
- **202 Accepted** -- Long-running operation initiated. Response includes a `Location` header with a URL to poll for status.

To poll a long-running action:

1. GET the URL from the `Location` header
2. **202** response = still processing, continue polling
3. **204** response = completed successfully

Source: https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=91bf9106-062a-47a8-be1f-b48517a54324

### Actions with Parameters

Some actions accept parameters:

```http
POST /entity/Default/24.200.001/SalesOrder/{guid}/action/CreateShipment
Content-Type: application/json
Authorization: Bearer {token}

{
    "entity": {"id": "{guid}"},
    "parameters": {
        "WarehouseID": {"value": "MAIN"}
    }
}
```

### Key Actions Reference

| Entity             | Action                          | Purpose                               |
| ------------------ | ------------------------------- | ------------------------------------- |
| SalesInvoice       | ReleaseSalesInvoice             | Release invoice (makes immutable)     |
| SalesInvoice       | EmailSalesInvoice               | Email invoice to customer             |
| SalesOrder         | ConfirmSalesOrder               | Confirm order for processing          |
| SalesOrder         | CreateShipment                  | Create shipment (params: WarehouseID) |
| Bill               | ReleaseBill                     | Release bill (makes immutable)        |
| PurchaseOrder      | ApprovePurchaseOrder            | Approve purchase order                |
| JournalTransaction | ReleaseJournalTransaction       | Post journal entry                    |
| JournalTransaction | ReverseJournalTransaction       | Create reversal entry                 |
| Lead               | ConvertLeadToOpportunity        | Convert lead to opportunity           |
| Opportunity        | CreateSalesOrderFromOpportunity | Create SO from won opportunity        |
| Project            | ActivateProject                 | Activate a planned project            |

---

## File Attachments

### Attach a File to an Entity

**[DOCUMENTED]** -- PUT binary data to the files sub-resource.

```http
PUT /entity/Default/24.200.001/SalesOrder/SO/000042/files/invoice-scan.pdf
Content-Type: application/octet-stream
Authorization: Bearer {token}

{binary PDF data}
```

- Keys in URL path separated by `/` (e.g., `SO/000042` for OrderType=SO, OrderNbr=000042)
- Response: `204 No Content`
- Since System Contract 4 (Default 20.200.001+), can attach files to detail items

Source: https://asiablog.acumatica.com/index.php/2018/01/attach-files-with-rest-api/

### Download a File

```http
GET /entity/Default/24.200.001/SalesOrder/SO/000042/files/invoice-scan.pdf
Authorization: Bearer {token}
```

Response: binary file data with appropriate Content-Type.

### List Files on an Entity

Include `$expand=files` in the entity GET:

```http
GET /entity/Default/24.200.001/SalesOrder/SO/000042?$expand=files
Authorization: Bearer {token}
```

---

## Dangerous Operations -- Safety Checklist

### Releasing Financial Documents

**Risk:** Irreversible. Released documents become read-only.

Before releasing:

- [ ] Verify all line items are correct
- [ ] Verify customer/vendor is correct
- [ ] Verify dates and financial period are correct
- [ ] Verify tax calculation is expected

If wrong after release: void the document and create a new one.

### Deleting Records

**Risk:** Permanent. No trash/recycle bin.

Before deleting:

- [ ] Verify no dependent records exist
- [ ] Confirm the correct record ID
- [ ] Consider deactivating (Status = Inactive) instead of deleting

### Updating Line Items

**Risk:** Omitting a line deletes it.

Before updating line items:

- [ ] GET the current entity with `$expand=Details`
- [ ] Include ALL existing line `id` values in the update
- [ ] Verify the new `Details` array is complete

### Journal Entries

**Risk:** Affects financial statements directly.

Before releasing journal entries:

- [ ] Verify debits equal credits
- [ ] Verify correct financial period
- [ ] Verify correct GL accounts

---

## Concurrency Handling

**[DOCUMENTED]** -- MYOB Acumatica uses optimistic concurrency via a DB-level timestamp (TStamp/PXDBTimestamp).

1. **On GET:** Entity includes an implicit row timestamp in the DB
2. **On PUT:** Acumatica validates that the TStamp has not changed since the record was read
3. **If changed:** Returns error "Another process has updated the '{EntityName}' record. Your changes will be lost."
4. **Resolution:** Re-GET the entity, merge changes, retry PUT

Source: https://asiablog.acumatica.com/index.php/2018/03/another-process-has-added-updated-deleted/

---

## Common Mutation Mistakes

| Mistake                                           | Result                       | Fix                                 |
| ------------------------------------------------- | ---------------------------- | ----------------------------------- |
| Using POST to create                              | 405 Method Not Allowed       | Use PUT                             |
| Using PATCH to update                             | 405 Method Not Allowed       | Use PUT                             |
| Omitting `{"value": ...}` wrapper                 | 400 Bad Request              | Wrap all field values               |
| Sending computed fields (OrderTotal)              | Ignored or error             | Omit computed fields                |
| Partial line item array on update                 | Lines silently deleted       | Send ALL lines                      |
| Editing released document                         | 400/422                      | Void and recreate                   |
| Omitting required fields on create                | 400 with field name in error | Check entity required fields        |
| Forgetting `$expand=Details` on GET before update | Missing line IDs             | Always expand before updating lines |
| Treating action 202 as failure                    | Missed long-running result   | Poll Location header URL            |

---

_Generated from the investigation questionnaire, Phases 3-4._

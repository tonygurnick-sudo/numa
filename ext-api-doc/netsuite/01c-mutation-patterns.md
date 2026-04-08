---
api_name: 'NetSuite AI Connector Service (MCP)'
api_slug: 'netsuite'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-03-30'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# NetSuite MCP -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Contains all write operation patterns including
> record creation, updates, and the mandatory metadata-first workflow.
>
> **Only two write tools exist:** `ns_createRecord` and `ns_updateRecord`.
> **No delete tool** is available in the MCP Standard Tools SuiteApp.
> Both tools operate on ANY NetSuite record type via the `recordType` parameter.

---

## Write Capabilities Summary

| Operation         | Supported | Tool            | Notes                                            |
| ----------------- | --------- | --------------- | ------------------------------------------------ |
| Create            | Yes       | ns_createRecord | Any record type; `data` is stringified JSON      |
| Update            | Yes       | ns_updateRecord | Any record type; partial update by record ID     |
| Delete            | **No**    | --              | Not available in MCP Standard Tools [CONFIRMED]  |
| Bulk create       | No        | --              | Must create one record at a time                 |
| Bulk update       | No        | --              | Must update one record at a time                 |
| State transitions | Indirect  | ns_updateRecord | Change status field if the transition is allowed |

---

## Mandatory Pre-Flight: Metadata Discovery

**CRITICAL:** Before any create or update, you MUST call `ns_getRecordTypeMetadata` to discover the target record type's field names, types, and requirements.

```json
{
  "name": "ns_getRecordTypeMetadata",
  "arguments": {
    "recordType": "customer"
  }
}
```

This returns a schema describing:

- Available fields and their data types
- Required vs optional fields
- Field value constraints
- Sublist/line item structures (for transactions)

**Skipping this step will result in malformed data payloads and creation failures.**

---

## Pattern 1: Create a Record

```json
{
  "name": "ns_createRecord",
  "arguments": {
    "recordType": "customer",
    "data": "{\"companyname\": \"New Customer Ltd\", \"email\": \"info@newcustomer.com\", \"subsidiary\": \"1\"}"
  }
}
```

**Critical rules:**

- `data` must be a **stringified JSON string**, not a raw JSON object
- `recordType` must be a valid NetSuite record type identifier
- Required fields vary by record type -- always check metadata first
- The response format is [UNKNOWN] but expected to include the new record's internal ID

**Common required fields by record type:**

| Record Type     | Typical Required Fields            | Notes                                         |
| --------------- | ---------------------------------- | --------------------------------------------- |
| `customer`      | companyname, subsidiary (OneWorld) | subsidiary required only in OneWorld accounts |
| `vendor`        | companyname, subsidiary (OneWorld) |                                               |
| `salesorder`    | entity (customer ID), subsidiary   | Line items in sublist                         |
| `invoice`       | entity (customer ID), subsidiary   | Line items in sublist                         |
| `purchaseorder` | entity (vendor ID), subsidiary     | Line items in sublist                         |
| `vendorbill`    | entity (vendor ID), subsidiary     | Line items in sublist                         |
| `inventoryitem` | itemid, subsidiary                 |                                               |
| `journalentry`  | subsidiary                         | Debit/credit lines in sublist                 |
| `contact`       | firstname or lastname              |                                               |
| `employee`      | firstname, lastname                |                                               |

---

## Pattern 2: Update a Record

```json
{
  "name": "ns_updateRecord",
  "arguments": {
    "recordType": "customer",
    "recordId": "12345",
    "data": "{\"email\": \"newemail@example.com\", \"phone\": \"+64 21 999 8888\"}"
  }
}
```

**Behavior:**

- Only fields included in `data` are updated; omitted fields remain unchanged
- `recordId` must be the internal ID of the existing record
- `data` must be stringified JSON (same as create)
- Computed/read-only fields (balance, total, etc.) are ignored if sent

---

## Pattern 3: Create a Transaction with Line Items

Transactions (sales orders, invoices, POs, bills) typically require line items. The exact structure depends on the record type's metadata, but the general pattern is:

**Step 1: Discover the schema**

```json
{
  "name": "ns_getRecordTypeMetadata",
  "arguments": {
    "recordType": "salesorder"
  }
}
```

**Step 2: Create with line items**

```json
{
  "name": "ns_createRecord",
  "arguments": {
    "recordType": "salesorder",
    "data": "{\"entity\": \"12345\", \"subsidiary\": \"1\", \"memo\": \"Q1 2026 Order\", \"item\": {\"items\": [{\"item\": \"100\", \"quantity\": 10, \"rate\": 25.00}, {\"item\": \"200\", \"quantity\": 5, \"rate\": 50.00}]}}"
  }
}
```

**Key points:**

- Line items are typically in a sublist object (e.g., `item.items[]` for sales orders)
- The exact sublist field name comes from metadata
- Each line references an item by internal ID
- `rate` is the unit price; `amount` is typically computed

---

## Pattern 4: Update a Transaction

```json
{
  "name": "ns_updateRecord",
  "arguments": {
    "recordType": "salesorder",
    "recordId": "67890",
    "data": "{\"memo\": \"Updated memo\", \"duedate\": \"2026-06-30\"}"
  }
}
```

**Updating line items on transactions:**
Line item update behavior is [UNKNOWN] for MCP specifically. In the REST API:

- Sending a sublist replaces all existing lines
- Omitting lines from the update array deletes them
- Include existing line IDs to preserve them

**Recommendation:** When updating transaction lines, first call `ns_getRecord` to get current lines, then include all lines (modified and unmodified) in the update payload.

---

## Pattern 5: Create a Contact for a Customer

```json
{
  "name": "ns_createRecord",
  "arguments": {
    "recordType": "contact",
    "data": "{\"firstname\": \"Jane\", \"lastname\": \"Smith\", \"email\": \"jane@acme.com\", \"company\": \"12345\", \"title\": \"CFO\"}"
  }
}
```

**Key points:**

- `company` field links the contact to a customer/vendor by internal ID
- Either `firstname` or `lastname` typically required

---

## Field Validation Rules

> Rules the API enforces on write operations. These are general patterns; exact rules
> vary by record type and are discovered via ns_getRecordTypeMetadata.

| Context                | Field            | Rule                                        | Error if Violated                |
| ---------------------- | ---------------- | ------------------------------------------- | -------------------------------- |
| All records (OneWorld) | subsidiary       | Required                                    | Missing mandatory field          |
| Customer/Vendor        | companyname      | Required, non-empty                         | Missing mandatory field          |
| Transaction            | entity           | Required, must be valid customer/vendor ID  | INVALID_CONTENT                  |
| Transaction lines      | item             | Required, must be valid item ID             | INVALID_CONTENT with o:errorPath |
| Transaction lines      | quantity         | Required, must be > 0                       | Validation error                 |
| Invoice                | trandate         | Must be in an open accounting period        | Period is closed                 |
| Journal entry          | Debits/credits   | Must balance (total debits = total credits) | Out of balance error             |
| All records            | Read-only fields | Cannot be set via create/update             | Ignored or error                 |

**Data type rules:**

- Integer reference fields (subsidiary, entity, item): Pass as string representations of internal IDs
- Currency fields: Pass as numbers (e.g., `25.00`)
- Date fields: Pass as ISO 8601 strings (`"2026-03-30"`)
- Boolean fields: Behavior varies by context; check metadata

---

## Server-Side Defaults

> Fields the server populates automatically on create/update.

| Entity      | Field             | Default Value                      | When Applied   |
| ----------- | ----------------- | ---------------------------------- | -------------- |
| All         | id                | Auto-generated internal ID         | Create         |
| All         | datecreated       | Current timestamp                  | Create         |
| All         | lastmodifieddate  | Current timestamp                  | Create, update |
| Transaction | tranid            | Auto-generated (SO-1234, INV-5678) | Create         |
| Transaction | total             | Computed from line items           | Create, update |
| Transaction | amountremaining   | total - payments applied           | Ongoing        |
| Customer    | balance           | Sum of open transactions           | Ongoing        |
| Item        | quantityavailable | Computed from inventory            | Ongoing        |

---

## Worked Examples

### Example 1: Create a New Customer

> Create a customer record with basic information.

**Step 1: Get metadata**

```json
{ "name": "ns_getRecordTypeMetadata", "arguments": { "recordType": "customer" } }
```

**Step 2: Create the customer**

```json
{
  "name": "ns_createRecord",
  "arguments": {
    "recordType": "customer",
    "data": "{\"companyname\": \"Advance Electrical NZ\", \"email\": \"accounts@advanceelectrical.co.nz\", \"phone\": \"+64 9 555 1234\", \"subsidiary\": \"1\", \"terms\": \"2\"}"
  }
}
```

**Notes:**

- `subsidiary` is "1" (the primary subsidiary, required for OneWorld accounts)
- `terms` references a payment terms record by internal ID
- The server will auto-generate the customer's internal ID and set datecreated

---

### Example 2: Create a Purchase Order

> Create a PO for a vendor with line items.

**Step 1: Get metadata**

```json
{ "name": "ns_getRecordTypeMetadata", "arguments": { "recordType": "purchaseorder" } }
```

**Step 2: Create the PO**

```json
{
  "name": "ns_createRecord",
  "arguments": {
    "recordType": "purchaseorder",
    "data": "{\"entity\": \"500\", \"subsidiary\": \"1\", \"memo\": \"Restock order - March 2026\", \"item\": {\"items\": [{\"item\": \"150\", \"quantity\": 100, \"rate\": 12.50}, {\"item\": \"160\", \"quantity\": 50, \"rate\": 8.75}]}}"
  }
}
```

**Notes:**

- `entity` is the vendor internal ID
- Line items include item ID, quantity, and unit rate
- The server computes totals from line items

---

### Example 3: Update an Invoice Memo and Due Date

> Modify fields on an existing invoice.

```json
{
  "name": "ns_updateRecord",
  "arguments": {
    "recordType": "invoice",
    "recordId": "98765",
    "data": "{\"memo\": \"Updated: Extended payment terms per customer request\", \"duedate\": \"2026-05-15\"}"
  }
}
```

**Notes:**

- Only the specified fields are updated
- Cannot update computed fields like `total` or `amountremaining`
- Cannot update a voided or fully paid invoice's financial fields

---

## Gotchas & Counter-Exceptions

1. **Stringified JSON is mandatory:** The `data` parameter MUST be a JSON string (escaped), not a raw object. This is the most common error when calling ns_createRecord or ns_updateRecord. Double-check that your JSON is properly escaped.

2. **No delete capability:** The MCP Standard Tools do not include a delete tool. If a user asks to delete a record, explain this limitation. Suggest alternatives:
   - Set `isinactive` to `'T'` to deactivate (soft-delete)
   - For transactions, voiding may be possible via status update

3. **Sublist field names vary by record type:** Sales orders use `item.items[]` for line items, but journal entries use `line.items[]` for debit/credit lines. Always check metadata.

4. **Transaction line replacement on update:** When updating sublists, including a partial list may delete omitted lines. Always retrieve the current record first if you need to preserve existing lines.

5. **Accounting period restrictions:** Creating or modifying transactions in a closed accounting period will fail. The error message will indicate the period is locked.

6. **OneWorld subsidiary requirement:** In OneWorld accounts (multi-subsidiary), nearly all records require a `subsidiary` field. Omitting it produces a "missing mandatory field" error.

7. **No idempotency keys:** Calling ns_createRecord twice with identical data creates two separate records. There is no built-in duplicate detection. If in doubt, query first to check if the record already exists.

---

## Dangerous Operations

> Operations that are destructive, irreversible, or have significant side effects.
> The workspace agent should confirm with the user before executing these.

| Operation                        | Why Dangerous                                       | Safeguard                                     |
| -------------------------------- | --------------------------------------------------- | --------------------------------------------- |
| ns_createRecord for transactions | Creates real financial records (invoices, POs)      | Confirm record type and key fields with user  |
| ns_updateRecord on transactions  | May alter financial data, affect GL balances        | Confirm specific changes with user            |
| Setting `isinactive = 'T'`       | Deactivates record; may affect dependent records    | Warn user about downstream effects            |
| Changing `entity` on transaction | Reassigns transaction to different customer/vendor  | Always confirm this is intentional            |
| Modifying transaction line items | May delete existing lines if not included in update | Retrieve current lines first, confirm changes |

---

_Generated from the investigation questionnaire, Phases 3-4._

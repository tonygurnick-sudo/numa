---
api_name: NetSuite AI Connector Service (MCP)
api_slug: netsuite
doc: on-demand mutation-patterns reference (companion to 01-llm-api-rules.md)
call_surface: MCP via mcp_call
write_tools: ns_createRecord, ns_updateRecord ONLY — both take recordType + stringified-JSON data. No delete tool exists in MCP Standard Tools.
confidence: confirmed unless tagged [UNKNOWN]
---

# NetSuite MCP — Mutation Patterns Reference

All write operations + the mandatory metadata-first workflow. Companion to `01-llm-api-rules.md`.

## Write capabilities

| Operation          | Supported | Tool            | Notes                                     |
| ------------------ | --------- | --------------- | ----------------------------------------- |
| Create             | Yes       | ns_createRecord | Any record type; `data` stringified JSON  |
| Update             | Yes       | ns_updateRecord | Any type; partial by record id            |
| Delete             | **No**    | —               | Not in MCP Standard Tools                 |
| Bulk create/update | No        | —               | One record at a time                      |
| State transitions  | Indirect  | ns_updateRecord | Change status field if transition allowed |

## Mandatory pre-flight: metadata discovery

Before ANY create/update, call `ns_getRecordTypeMetadata({"recordType":"customer"})`. Returns: available fields + types, required vs optional, value constraints, sublist/line structures (transactions). Skipping → malformed payloads and failures.

## Pattern 1 — create

`{"name":"ns_createRecord","arguments":{"recordType":"customer","data":"{\"companyname\": \"New Customer Ltd\", \"email\": \"info@newcustomer.com\", \"subsidiary\": \"1\"}"}}`

- `data` MUST be stringified (escaped) JSON, not a raw object. `recordType` must be a valid identifier. Required fields vary — check metadata. Response format [UNKNOWN]; expected to include the new internal id.

**Typical required fields by record type:**
| Record type | Required | Notes |
| --- | --- | --- |
| `customer` / `vendor` | companyname, subsidiary | subsidiary only in OneWorld |
| `salesorder` / `invoice` | entity (customer id), subsidiary | line items in sublist |
| `purchaseorder` / `vendorbill` | entity (vendor id), subsidiary | line items in sublist |
| `inventoryitem` | itemid, subsidiary | |
| `journalentry` | subsidiary | debit/credit lines in sublist |
| `contact` | firstname or lastname | |
| `employee` | firstname, lastname | |

## Pattern 2 — update

`{"name":"ns_updateRecord","arguments":{"recordType":"customer","recordId":"12345","data":"{\"email\": \"newemail@example.com\", \"phone\": \"+64 21 999 8888\"}"}}`

- Only fields in `data` change; omitted fields unchanged. `recordId` = internal id. `data` stringified (same as create). Computed/read-only fields (balance, total) ignored if sent.

## Pattern 3 — create transaction with line items

1. Discover schema: `{"name":"ns_getRecordTypeMetadata","arguments":{"recordType":"salesorder"}}`
2. Create: `{"name":"ns_createRecord","arguments":{"recordType":"salesorder","data":"{\"entity\": \"12345\", \"subsidiary\": \"1\", \"memo\": \"Q1 2026 Order\", \"item\": {\"items\": [{\"item\": \"100\", \"quantity\": 10, \"rate\": 25.00}, {\"item\": \"200\", \"quantity\": 5, \"rate\": 50.00}]}}"}}`

- Lines live in a sublist object — exact field name from metadata (sales orders use `item.items[]`; journal entries use `line.items[]`). Each line references an item by internal id; `rate` = unit price, `amount` computed.

## Pattern 4 — update a transaction

`{"name":"ns_updateRecord","arguments":{"recordType":"salesorder","recordId":"67890","data":"{\"memo\": \"Updated memo\", \"duedate\": \"2026-06-30\"}"}}`

- **Line-item update [UNKNOWN] for MCP.** In REST: sending a sublist replaces all lines; omitted lines are deleted; include existing line IDs to preserve them. Recommendation: `ns_getRecord` first, then include ALL lines (modified + unmodified) in the update.

## Pattern 5 — create a contact for a customer

`{"name":"ns_createRecord","arguments":{"recordType":"contact","data":"{\"firstname\": \"Jane\", \"lastname\": \"Smith\", \"email\": \"jane@acme.com\", \"company\": \"12345\", \"title\": \"CFO\"}"}}`

- `company` links to a customer/vendor by internal id. firstname OR lastname typically required.

## Field validation rules

| Context          | Field            | Rule                                 | Error if violated             |
| ---------------- | ---------------- | ------------------------------------ | ----------------------------- |
| All (OneWorld)   | subsidiary       | Required                             | Missing mandatory field       |
| Customer/Vendor  | companyname      | Required, non-empty                  | Missing mandatory field       |
| Transaction      | entity           | Required, valid customer/vendor id   | INVALID_CONTENT               |
| Transaction line | item             | Required, valid item id              | INVALID_CONTENT + o:errorPath |
| Transaction line | quantity         | Required, > 0                        | Validation error              |
| Invoice          | trandate         | Must be in an open accounting period | Period is closed              |
| Journal entry    | debits/credits   | Must balance (debits = credits)      | Out of balance error          |
| All              | read-only fields | Cannot be set                        | Ignored or error              |

**Data types:** int-ref fields (subsidiary, entity, item) = string of internal id; currency = number (`25.00`); date = ISO 8601 string (`"2026-03-30"`); boolean behavior varies — check metadata.

## Server-side defaults (auto-populated)

| Entity      | Field             | Default                  | When           |
| ----------- | ----------------- | ------------------------ | -------------- |
| All         | id                | Auto internal id         | Create         |
| All         | datecreated       | Current timestamp        | Create         |
| All         | lastmodifieddate  | Current timestamp        | Create, update |
| Transaction | tranid            | Auto (SO-1234, INV-5678) | Create         |
| Transaction | total             | Computed from lines      | Create, update |
| Transaction | amountremaining   | total − payments applied | Ongoing        |
| Customer    | balance           | Sum of open transactions | Ongoing        |
| Item        | quantityavailable | Computed from inventory  | Ongoing        |

## Worked examples

1. **Create customer** — metadata then create. `subsidiary:"1"` (primary, required for OneWorld); `terms` references a payment-terms record by id; server auto-sets id + datecreated:
   `{"name":"ns_getRecordTypeMetadata","arguments":{"recordType":"customer"}}` →
   `{"name":"ns_createRecord","arguments":{"recordType":"customer","data":"{\"companyname\": \"Advance Electrical NZ\", \"email\": \"accounts@advanceelectrical.co.nz\", \"phone\": \"+64 9 555 1234\", \"subsidiary\": \"1\", \"terms\": \"2\"}"}}`

2. **Create purchase order** — `entity` is vendor id, lines carry item/quantity/rate, server computes totals:
   `{"name":"ns_getRecordTypeMetadata","arguments":{"recordType":"purchaseorder"}}` →
   `{"name":"ns_createRecord","arguments":{"recordType":"purchaseorder","data":"{\"entity\": \"500\", \"subsidiary\": \"1\", \"memo\": \"Restock order - March 2026\", \"item\": {\"items\": [{\"item\": \"150\", \"quantity\": 100, \"rate\": 12.50}, {\"item\": \"160\", \"quantity\": 50, \"rate\": 8.75}]}}"}}`

3. **Update invoice memo + due date** — only listed fields change; cannot update `total`/`amountremaining` or a voided/fully-paid invoice's financial fields:
   `{"name":"ns_updateRecord","arguments":{"recordType":"invoice","recordId":"98765","data":"{\"memo\": \"Updated: Extended payment terms per customer request\", \"duedate\": \"2026-05-15\"}"}}`

## Gotchas

1. **Stringified JSON is mandatory** for `data` (escaped string, not raw object) — the most common create/update error.
2. **No delete** — explain the limitation; alternatives: set `isinactive='T'` (soft-delete) or, for transactions, void via status update.
3. **Sublist field names vary** by record type — always check metadata (sales order `item.items[]` vs journal `line.items[]`).
4. **Transaction line replacement on update** — a partial list may delete omitted lines; retrieve current record first to preserve.
5. **Closed accounting period** — create/modify of transactions there fails; error says the period is locked.
6. **OneWorld subsidiary requirement** — nearly all records need `subsidiary`; omitting it → "missing mandatory field".
7. **No idempotency keys** — two identical `ns_createRecord` calls create two records; no duplicate detection. Query first if unsure.

## Dangerous operations (confirm with user before executing)

| Operation                        | Why dangerous                                  | Safeguard                             |
| -------------------------------- | ---------------------------------------------- | ------------------------------------- |
| ns_createRecord for transactions | Creates real financial records (invoices, POs) | Confirm record type + key fields      |
| ns_updateRecord on transactions  | May alter financial data / GL balances         | Confirm specific changes              |
| Setting `isinactive='T'`         | Deactivates; may affect dependents             | Warn about downstream effects         |
| Changing `entity` on transaction | Reassigns to a different customer/vendor       | Confirm intentional                   |
| Modifying transaction line items | May delete existing lines if omitted           | Retrieve current lines first, confirm |

---
doc: mutation-patterns
api_version: 24.200.001
mutation_method: PUT = upsert (create + update). NO POST for create, NO PATCH. DELETE for delete, POST for actions.
companion_of: 01-llm-api-rules.md
base_path: /entity/Default/24.200.001/{Entity}
confidence: [DOCUMENTED] unless tagged
---

# MYOB Acumatica — Mutation Patterns

## Write capabilities

| Operation                 | Method | `id`                   | Body                                                     |
| ------------------------- | ------ | ---------------------- | -------------------------------------------------------- |
| Create                    | PUT    | omit                   | full entity (required + optional)                        |
| Update                    | PUT    | include (or key match) | changed fields + `id` (line items: send ALL — see below) |
| Delete                    | DELETE | in URL                 | —                                                        |
| Action / state transition | POST   | in URL                 | action-specific body                                     |
| File upload               | PUT    | in URL                 | binary body to files sub-resource                        |
| Bulk create/update        | —      | —                      | NOT supported; loop individual PUT calls                 |

PUT is upsert: no key match (or no `id`) = create; `id` or matching key = update. There is NO POST for entity creation and NO PATCH (both → 405).
Source: help.acumatica.com/Wiki/ShowWiki.aspx?pageid=9d966d50-a0a1-4456-a9ff-1cc2159d48d4

## Create

Simple entity (`PUT /entity/Default/24.200.001/Customer`):
`{"CustomerID":{"value":"ACME01"},"CustomerName":{"value":"Acme Corporation"},"CustomerClass":{"value":"DEFAULT"},"Status":{"value":"Active"},"MainContact":{"Email":{"value":"billing@acme.com"},"Phone1":{"value":"+64 9 555 0100"}},"BillingAddress":{"AddressLine1":{"value":"123 Main Street"},"City":{"value":"Auckland"},"State":{"value":"AUK"},"PostalCode":{"value":"1010"},"Country":{"value":"NZ"}}}`
→ `200 OK` with full entity incl. system-generated `id`, `rowNumber`, `note`.

Entity with line items (`PUT /entity/Default/24.200.001/SalesOrder`):
`{"OrderType":{"value":"SO"},"CustomerID":{"value":"ACME01"},"Date":{"value":"2026-03-30"},"Description":{"value":"March order"},"Details":[{"InventoryID":{"value":"WIDGET01"},"Quantity":{"value":10},"UnitPrice":{"value":25.00},"WarehouseID":{"value":"MAIN"}},{"InventoryID":{"value":"GADGET02"},"Quantity":{"value":5},"UnitPrice":{"value":50.00}}]}`

Auto-numbered entities: omit the business key (e.g. `OrderNbr`) when auto-numbering is configured; the system assigns it and returns it in the response.

## Update

Include `id` + only the fields to change (except line items):
`PUT /entity/Default/24.200.001/Customer` → `{"id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","CustomerName":{"value":"Acme Corp (Updated)"},"MainContact":{"Phone1":{"value":"+64 9 555 0200"}}}`

Alternative — update by key via `$filter` instead of `id`:
`PUT /entity/Default/24.200.001/Customer?$filter=CustomerID eq 'ACME01'` → `{"CustomerName":{"value":"Acme Corp (Updated)"}}`
Source: help.acumatica.com/Wiki/ShowWiki.aspx?pageid=af48c02a-afbc-4fdb-b1e5-635ac7ebbaf1

### Line-item update — FULL ARRAY REPLACEMENT (critical)

The submitted `Details` array completely replaces existing lines. Procedure: (1) GET with `$expand=Details` to get line `id`s; (2) PUT all lines. Existing lines: include their `id` to preserve. New lines: omit `id` (system assigns). Any existing line NOT in the array is DELETED. To remove a line: omit it.
Example — order with 2 lines, add a 3rd + change line-1 qty:
`PUT /entity/Default/24.200.001/SalesOrder` → `{"id":"order-guid-here","Details":[{"id":"existing-line-1-guid","InventoryID":{"value":"WIDGET01"},"Quantity":{"value":20},"UnitPrice":{"value":25.00}},{"id":"existing-line-2-guid","InventoryID":{"value":"GADGET02"},"Quantity":{"value":5},"UnitPrice":{"value":50.00}},{"InventoryID":{"value":"NEWITEM03"},"Quantity":{"value":3},"UnitPrice":{"value":75.00}}]}`

## Delete (by GUID or key path)

By GUID: `DELETE /entity/Default/24.200.001/Customer/a1b2c3d4-e5f6-7890-abcd-ef1234567890`
By key values (separated by `/` in path, e.g. OrderType `SO` + OrderNbr `000123`): `DELETE /entity/Default/24.200.001/SalesOrder/SO/000123`
→ `204 No Content`. Constraints: cannot delete records with dependent children (e.g. Customer with open orders) or released financial docs (void first) — returns 400/500 with explanatory `exceptionMessage`.
Source: help.acumatica.com/Wiki/ShowWiki.aspx?pageid=d806636f-3cb8-4fd6-bc1e-fef9cdf9683d

## Actions (state transitions)

POST to an action sub-resource:
`POST /entity/Default/24.200.001/{Entity}/{guid}/action/{ActionName}` → `{"entity":{"id":"{guid}"}}`
With parameters: `POST /entity/Default/24.200.001/SalesOrder/{guid}/action/CreateShipment` → `{"entity":{"id":"{guid}"},"parameters":{"WarehouseID":{"value":"MAIN"}}}`
Response: **204** = completed immediately (no body); **202** = long-running, includes `Location` header — poll that URL (202 = still processing, 204 = completed).
Source: help.acumatica.com/Wiki/ShowWiki.aspx?pageid=91bf9106-062a-47a8-be1f-b48517a54324

Key actions:
| Entity | Action | Purpose |
| --- | --- | --- |
| SalesInvoice | ReleaseSalesInvoice | release (makes immutable) |
| SalesInvoice | EmailSalesInvoice | email to customer |
| SalesOrder | ConfirmSalesOrder | confirm for processing |
| SalesOrder | CreateShipment | create shipment (param: WarehouseID) |
| Bill | ReleaseBill | release (makes immutable) |
| PurchaseOrder | ApprovePurchaseOrder | approve PO |
| JournalTransaction | ReleaseJournalTransaction | post journal entry |
| JournalTransaction | ReverseJournalTransaction | create reversal entry |
| Lead | ConvertLeadToOpportunity | convert lead → opportunity |
| Opportunity | CreateSalesOrderFromOpportunity | create SO from won opportunity |
| Project | ActivateProject | activate a planned project |

## File attachments

Attach — PUT binary to files sub-resource (keys in path separated by `/`):
`PUT /entity/Default/24.200.001/SalesOrder/SO/000042/files/invoice-scan.pdf` · `Content-Type: application/octet-stream` · body = binary → `204 No Content`. Since System Contract 4 (Default 20.200.001+) can also attach to detail items.
Download: `GET /entity/Default/24.200.001/SalesOrder/SO/000042/files/invoice-scan.pdf` → binary.
List files on an entity: `GET /entity/Default/24.200.001/SalesOrder/SO/000042?$expand=files`.
Source: asiablog.acumatica.com/index.php/2018/01/attach-files-with-rest-api/

## Dangerous operations — checklist

- **Releasing financial docs:** irreversible (released = read-only). Verify line items, customer/vendor, dates/period, tax before releasing. If wrong after release → void + recreate.
- **Deleting:** permanent (no recycle bin). Verify no dependent records, confirm correct id; consider deactivating (Status=Inactive) instead.
- **Updating line items:** omitting a line deletes it. GET `$expand=Details` first, include ALL existing line `id`s, verify the new `Details` array is complete.
- **Journal entries:** affects financial statements. Verify debits=credits, correct period, correct GL accounts before releasing.

## Concurrency (optimistic, via DB TStamp/PXDBTimestamp)

On PUT, Acumatica validates the row timestamp hasn't changed since GET. If changed → error `"Another process has updated the '{EntityName}' record. Your changes will be lost."` Resolution: re-GET, merge, retry PUT (409 path).
Source: asiablog.acumatica.com/index.php/2018/03/another-process-has-added-updated-deleted/

## Common mutation mistakes

| Mistake                                   | Result                     | Fix                                 |
| ----------------------------------------- | -------------------------- | ----------------------------------- |
| POST to create                            | 405 Method Not Allowed     | use PUT                             |
| PATCH to update                           | 405 Method Not Allowed     | use PUT                             |
| Omitting `{"value":...}` wrapper          | 400 Bad Request            | wrap all field values               |
| Sending computed fields (OrderTotal)      | ignored or error           | omit computed fields                |
| Partial line-item array on update         | lines silently deleted     | send ALL lines                      |
| Editing released document                 | 400/422                    | void + recreate                     |
| Omitting required fields on create        | 400 with field name        | check entity required fields        |
| No `$expand=Details` on GET before update | missing line IDs           | always expand before updating lines |
| Treating action 202 as failure            | missed long-running result | poll `Location` header URL          |

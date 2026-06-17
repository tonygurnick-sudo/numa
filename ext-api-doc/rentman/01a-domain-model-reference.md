---
api_name: Rentman
api_slug: rentman
base_url: https://api.rentman.net
path_version_segment: none
call_surface: HTTP via `connectors(name="request", ...)` — relative paths
id_format: integer
linked_fields: path strings ("/contacts/12"); expand to inline (≤3 levels)
field_casing: snake_case
doc_role: on-demand reference (01a) — entity catalog, hierarchy, fields, link semantics
confidence: spec-derived [SPEC] (OpenAPI 1.13.0, fetched 2026-06-10) unless tagged [DOCS] or [UNVERIFIED]. NOT live-validated through Numa — GET one real record and mirror what comes back; field tables list the high-value subset, the spec is authoritative for full lists.
---

# Rentman — Domain Model Reference

## Domain

Rental & event-production management. Core loop: a **Project** (job/event) contains **Subprojects** (phases/options); each subproject carries planned **equipment** (`projectequipment`), planned **crew** (`projectfunctions` → `projectcrew`), **vehicles**, extra **costs**. Warehouse: equipment stock, serial numbers, subrentals. Commercial: quotes, contracts, invoices (+payments). People = **contacts** (company/private) with **contactpersons**; staff = **crew** with availability, rates, time registration.

## Hierarchy

```
Project (name, number, customer→/contacts, account_manager→/crew)
  └── Subproject (≥1 ALWAYS; status→/statuses, location, discounts, in_planning/in_financial)
        ├── ProjectEquipmentGroup ── ProjectEquipment (planned items → /equipment)   [read-only]
        ├── ProjectFunctionGroup ── ProjectFunction (job to do: crew_function/transport/shift)
        │      ├── ProjectCrew (crew planned on a function → /crew)                   [read-only]
        │      └── ProjectVehicle (vehicle planned on a function → /vehicles)         [read-only]
        └── Costs (extra line costs; writable)
  ├── Quotes / Contracts / Invoices ── InvoiceLines, Payments  (read-only except payments)
  ├── Files / FileFolders  (read-only)
  └── Tasks (attachable to most item types)

Equipment (catalog; type: item|case|set)
  ├── SerialNumbers ── ActualContent, EquipmentAssignedSerials
  ├── Accessories / Alternatives (equipment ↔ equipment links)
  ├── EquipmentSetsContent (what a set contains)
  ├── Suppliers (contact ↔ equipment, with purchase price)
  ├── StockMovements (stock changes; bulk items only)
  └── Repairs                                                                          [read-only]

Crew (staff)
  ├── CrewAvailability (B=available / N=unavailable / O=unknown)
  ├── CrewRates → Rates → RateFactors
  ├── Invitations (availability/reservation/planning requests)                         [read-only]
  ├── Appointments (via AppointmentCrew)
  └── TimeRegistration ── TimeRegistrationActivities; LeaveRequest/LeaveMutation/LeaveTypes

Contact (company|private) ── ContactPersons
Subrental (renting in) ── SubrentalEquipment(Group)                                    [read-only]
PurchaseOrder ── PurchaseOrderCosts / GlobalCosts                                       [read-only]
ProjectRequest ── ProjectRequestEquipment (raw external intake → converted in UI)
Folders (tree for contacts/equipment/crew/vehicles) · Statuses · ProjectTypes · TaxClasses · LedgerCodes
```

Key structural facts:

- **Every project has ≥1 subproject** — even when the UI shows none. Subproject owns `status`, `location`, discounts, `in_planning`/`in_financial`.
- Project-level prices (`project_total_price` etc.) are **roll-ups of non-cancelled subprojects**.
- "Planned equipment" ≠ "equipment": `/equipment` is the catalog; `/projectequipment` is the planning line (quantity, price, group) pointing at a catalog item.
- Crew planning is two-step: a **ProjectFunction** ("need 2 riggers Saturday") and **ProjectCrew** rows (actual people on it).

## ID & link semantics

- Ids are **integers**; records carry `id`, `created`, `modified`, `creator`.
- **Linked fields are path strings** (`"customer":"/contacts/12"`, `"equipment":"/equipment/8"`). Parse the trailing integer, or `?expand=` to inline (≤3 levels).
- **Polymorphic links** = plain integer `item` + `itemtype` enum string (files, tasks, file_folders: `itemtype` ∈ Contact, Container, Contract, SerialNumber, Factuur, Subrental, Project, Equipment, …). `Factuur` = invoice.
- `displayname` is a GENERATED FIELD on everything — the human label to show users.
- `updateHash` — per-item hash of `id`+`modified`; changes exactly when the item changes.
- `custom` object holds workspace custom fields keyed `custom_<n>`; not queryable. `/extrainputfields` lists extra input fields; `custom_<n>`→label mapping is NOT exposed [UNVERIFIED] — ask the user what their custom fields mean.
- Dutch heritage: invoices=`Factuur`, crew rates use `naam`/`medewerker`, task recurrence `recurhoe`/`recureind`/`recurperiode`. Treat as opaque names.

## Entity catalog (all 63 resources)

Writability from spec methods. C=create (POST), U=update (PUT), D=delete. Sub-resource creates happen under the parent path (e.g. POST /contacts/{id}/tasks).

| Resource (path)                                           | Write                     | Notes                                                          |
| --------------------------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| /projects                                                 | C                         | HIGH — anchor entity; no update/delete                         |
| /subprojects                                              | C (under project)         | HIGH — status & financials; no update/delete                   |
| /projectequipment                                         | —                         | HIGH — planned equipment lines                                 |
| /projectequipmentgroup                                    | —                         | groups of planned equipment                                    |
| /projectfunctions                                         | C (under project)         | crew/transport jobs to fill                                    |
| /projectfunctiongroups                                    | C (under project)         | grouping of functions                                          |
| /projectcrew                                              | —                         | HIGH — who is planned on what                                  |
| /projectvehicles                                          | —                         | vehicle planning                                               |
| /costs                                                    | C (under project), U, D   | extra project costs                                            |
| /projecttypes, /statuses                                  | —                         | lookup tables (status names workspace-specific)                |
| /projectrequests                                          | C, U, D                   | external lead/request intake — best "create rich job" path     |
| /projectrequestequipment                                  | C (under request), U, D   | raw equipment lines on a request                               |
| /contacts                                                 | C, U, D                   | HIGH — companies & private persons                             |
| /contactpersons                                           | C (under contact), U, D   | people within a contact                                        |
| /crew                                                     | —                         | HIGH — staff; read-only                                        |
| /crewavailability                                         | C (under crew), U, D      | availability blocks (B/N/O)                                    |
| /crewrates, /rates, /ratefactors, /factors, /factorgroups | —                         | pricing lookups                                                |
| /invitations                                              | —                         | crew planning invitations + email status                       |
| /equipment                                                | C, U                      | HIGH — catalog; **no delete**                                  |
| /serialnumbers                                            | C (under equipment), U, D | individual physical units                                      |
| /accessories, /alternatives                               | C (under equipment), U, D | equipment↔equipment links                                      |
| /equipmentsetscontent                                     | C (under equipment), U, D | what a set contains                                            |
| /equipmentassignedserials, /actualcontent                 | —                         | serialized-combination contents                                |
| /suppliers                                                | C (under equipment), U, D | contact-supplies-equipment link                                |
| /stockmovements                                           | C (under equipment), U, D | **manual type + bulk items only**                              |
| /stocklocations                                           | —                         | warehouses (POST under it creates vehicles)                    |
| /repairs                                                  | —                         | equipment repairs                                              |
| /subrentals (+equipment/group)                            | —                         | renting in from suppliers                                      |
| /invoices                                                 | —                         | HIGH — read-only (`Factuur`)                                   |
| /invoicelines                                             | —                         | generated accounting lines; sum to invoice total               |
| /payments                                                 | C (under invoice), U      | record payments; **no delete**                                 |
| /quotes                                                   | —                         | HIGH — read-only (`Quotation`)                                 |
| /contracts                                                | —                         | read-only                                                      |
| /purchaseorders (+costs/globalcosts)                      | —                         | read-only                                                      |
| /ledgercodes, /taxclasses                                 | —                         | accounting lookups                                             |
| /files                                                    | —                         | metadata + download URLs; **no upload**                        |
| /file_folders                                             | —                         | folders files live in (per item)                               |
| /folders                                                  | C, U                      | org tree for contacts/equipment/crew/vehicles                  |
| /tasks                                                    | C, U, D                   | full CRUD; attachable to most item types                       |
| /subtasks                                                 | C (under task), U, D      | checklist items                                                |
| /taskassignments                                          | C (under task), U, D      | task → crew member                                             |
| /taskstatuses                                             | C, U, D                   | workspace task statuses                                        |
| /appointments                                             | C, U, D                   | calendar items; crew via /appointmentcrew (C under appt, U, D) |
| /timeregistration                                         | C, U, D                   | worked hours; activities read-only                             |
| /leaverequest                                             | C, U                      | leave workflow (pending → approved/rejected)                   |
| /leavemutation                                            | C                         | **immutable** — correct mistakes with an opposite mutation     |
| /leavetypes                                               | —                         | lookup                                                         |
| /vehicles                                                 | C, U, D                   | fleet                                                          |
| /extrainputfields                                         | —                         | extra input field definitions                                  |

## Key entities (high-value field subset)

### Project

| Field                                                                                                                                                                  | Type                              | Notes                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `id`, `created`, `modified`, `creator`                                                                                                                                 | int/datetime/link                 | standard                                                                 |
| `name`, `number`, `reference`                                                                                                                                          | string                            | `number` is the human project number                                     |
| `customer`, `cust_contact`                                                                                                                                             | link → /contacts, /contactpersons | who it's for                                                             |
| `location`, `loc_contact`                                                                                                                                              | link → /contacts, /contactpersons | venue                                                                    |
| `account_manager`                                                                                                                                                      | link → /crew                      | owner                                                                    |
| `project_type`                                                                                                                                                         | link → /projecttypes              |                                                                          |
| `color`, `conditions`, `tags`                                                                                                                                          | string                            | `tags` is GENERATED                                                      |
| `project_total_price`, `project_rental_price`, `project_sale_price`, `project_crew_price`, `project_transport_price`, `project_other_price`, `project_insurance_price` | number                            | GENERATED roll-ups — omitted from lists unless in `?fields`              |
| `estimated_cost`, `planned_cost`, `actual_cost`, `already_invoiced`                                                                                                    | number                            | GENERATED                                                                |
| `planperiod_start/end`, `usageperiod_start/end`, `equipment_period_from/to`                                                                                            | datetime                          | **GENERATED — not filterable**; real dates live on functions/subprojects |
| `weight`, `power`, `volume`, `current`, `purchasecosts`                                                                                                                | number                            | GENERATED logistics totals                                               |

Writable on create (ProjectRequest body): only `name`, `reference`, `number`, `custom`.

### Subproject

`project` (link), `order`, `name`, `status` (→/statuses), `is_template`, `location`, `loc_contact`, `insurance_rate`, `discount_rental/sale/crew/transport/additional_costs/subproject`, `discount_fixed` + `discount_fixed_amount`, `fixed_price`, `in_planning`, `in_financial`, `asset_location_from`, + same GENERATED price/period roll-ups as Project. Writable on create: `name`, `custom` only.

### ProjectEquipment (planned line) — read-only

`equipment` (→/equipment), `parent` (combination line), `equipment_group` (link), `quantity` (string!), `quantity_total` (int), `unit_price`, `discount`, `factor`, `is_option`, `name`, `external_remark` (financial docs), `internal_remark` (packing lists). GENERATED: `planperiod_start/end`, `has_missings`, `warehouse_reservations`, `subrent_reservations`, `serial_number_ids`.

### ProjectFunction & ProjectCrew

ProjectFunction: `type` ∈ `crew_function | transport_function | remark | shift`, `name` (packing lists) / `name_external` (financial docs), `project`/`subproject`/`group` links, `planperiod_start/end`, `usageperiod_start/end`, `amount` (heads needed), rates & per-head costs, GENERATED totals.
ProjectCrew (read-only): `function` (link), `crewmember` (→/crew), `planperiod_start/end`, `transport` ∈ `no_transport | round_trip | only_way_there | only_way_back`, `remark`, `project_leader`, GENERATED `hours_registered`, `hours_planned`, `activity_status` (`no_registration | planned | exceeds_time | aligned | under_time`).

### Crew (read-only) & CrewAvailability

Crew: name parts + `displayname`, `email`, `phone`, address fields, `active`, `external` (freelancer flag [UNVERIFIED interpretation]), `default_warehouse`, `external_reference` (accounting id).
CrewAvailability: `start`, `end` (required on create), `status` ∈ `B` available / `N` unavailable / `O` unknown, `remark`, recurrence fields.

### Contact & ContactPerson

Contact: `type` ∈ `private | company`, `name`, `firstname`/`surname` (private), three address blocks (`mailing_*`, `visit_*`, `invoice_*`), `country` (ISO-3166 alpha-2 lowercase enum, e.g. `gb`, `nz`), `phone_1/2`, `email_1/2`, `website`, `VAT_code`, `code` (auto-generated if empty), `accounting_code`, default discounts per category, `default_person`/`admin_contactperson` links.
ContactPerson: `contact` (link), name parts, `function` (job title), `email`, `phone`, `mobilephone`.

### Equipment & SerialNumber

Equipment: `name`, `code`, `folder` (link), `type` ∈ `set | case | item`, `rental_sales` ∈ `Rental | Sale`, `price` (rental day price [UNVERIFIED unit]), `list_price`, `subrental_costs`, `critical_stock_level`, `stock_management` ∈ `Track stock | Exclude from stock tracking`, physical dims (`weight`, `volume`, `power`, …), `country_of_origin`, `in_planner`, `in_archive`, shop fields. GENERATED stock: `current_quantity`, `current_quantity_excl_cases`, `quantity_in_cases`, `location_in_warehouse`, `qrcodes`.
SerialNumber: `equipment` (link), `serial`, `purchasedate`, `book_value`, `purchase_costs`, `active`, `asset_location` (→/stocklocations). GENERATED `current_book_value`, `next_inspection`, `last_subproject`.

### Invoice (`Factuur`), InvoiceLine, Payment

Invoice (read-only): `number`, `customer`/`contact`/`project` links, `date`, `expiration` (due date), `subject`, `finalized`, `procent` (invoiced %, [UNVERIFIED]). GENERATED: `price` (ex VAT), `price_invat`, `vat_amount`, `outstanding_balance`, `total_paid`, `is_paid`, `date_sent`, `payment_date`, `days_after_expiry`, `invoicetype` ∈ `C | F` (credit/final [UNVERIFIED]).
InvoiceLine (read-only): `base`, `ledger`, GENERATED `vatrate`, `vatamount`, `priceincl`, `ledgercode`.
Payment: `invoice` (link), `moment` (required), `amount`, `description`, `payment_import_source` ∈ `none | exactonline | quickbooks | xero | publicapi`.

### Quote (`Quotation`) — read-only

`number`, `customer`/`contact`/`project` links, `date`, `expiration_date`, `version`, `subject`. GENERATED `price`, `price_invat`, `vat_amount` + project price roll-ups.

### File / FileFolder — read-only

File: `readable_name`, `size`, `type`, `image` (bool), dual link sets — `file_item`+`file_itemtype` (origin, e.g. the quote that generated the PDF) and `item`+`itemtype` (UI attachment). GENERATED `url` and `proxy_url` (download), `path`, `extension`. URL lifetime/signing [UNVERIFIED] — fetch fresh, don't store.

### Task / Subtask / TaskAssignment

Task: `name`, `details`, **`color` (required on create)**, `priority` ∈ `no_priority | low_priority | medium_priority | high_priority`, `status` (→/taskstatuses [UNVERIFIED format]), `deadline` or relative-deadline fields, `completed_at`, polymorphic `item`+`itemtype`, `assignment_type` ∈ `all_crewmembers | selected_crewmembers | creator_only`, recurrence (`recurhoe`, `recureind`, `recurperiode`). Subtask: `title`, `completed`. TaskAssignment: `crew` (required, link).

### Appointment & TimeRegistration

Appointment: `name`, **`start`, `end` (required)**, `location`, `remark`, `is_public`, `is_plannable`, recurrence fields; crew via `/appointments/{id}/appointmentcrew`.
TimeRegistration: `crewmember` (link), `start`, `end`, `duration` (auto-calculated for worked hours), `break_duration`, `travel_time`, `remark`, `status` ∈ `pending | approved | rejected`, `leavetype`/`leaverequest` links.

### ProjectRequest (external intake)

The designed write path for pushing a job in from outside: free-text `contact_*` and `location_*` fields (no pre-matching needed), `linked_contact` (optional link), `name`, `remark`, `price`, **`planperiod_start`, `planperiod_end` (required)**, `usageperiod_*`, `external_reference`. The user converts it into a real project in the Rentman UI, matching contacts/equipment there.

## Domain rules

1. Every project ⇒ ≥1 subproject; subprojects own status/financial flags.
2. Planning data (equipment, crew, vehicles) hangs off subprojects via groups/functions.
3. `in_planning=false` subprojects are excluded from planning; `in_financial=false` from pricing [field names confirmed; semantics [UNVERIFIED]].
4. Invoice/quote PDFs are NOT reconstructable from `/invoicelines` — lines are accounting-grade, not the rendered document.
5. Stock movements: only `manual` type writable, bulk (non-serialized) items only.
6. Leave mutations are immutable; corrections = opposite mutation. Leave requests editable only while `pending` (approved → cancellable only); the crew member can't be changed.
7. Statuses, project types, task statuses, ledger codes, tax classes are workspace-configured lookups — resolve names per workspace, never hardcode.

## What we do NOT know [UNVERIFIED] (read before assuming)

- Datetime serialization / timezone handling (`date-time` strings in spec, no examples) — mirror what the API returns.
- PUT semantics: full-replace vs partial-merge — send only intended fields AND verify (01c).
- Status code for role-permission denials and for rate-limit breaches.
- Error body shapes (only status codes declared).
- `custom_<n>` → label mapping per workspace.
- File `url`/`proxy_url` expiry and auth requirements.

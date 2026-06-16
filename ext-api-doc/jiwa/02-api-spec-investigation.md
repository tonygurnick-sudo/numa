---
api_name: Jiwa Financials REST API
api_slug: jiwa
doc: api-spec-investigation (developer reference)
base_url: '' # per-customer instance URL — NO shared host, NO default base URL. api.jiwa.com.au is Jiwa's own hosted instance (demo/spec source).
path_version_segment: none (API "1.0"/"Jiwa 8" is a label; routes are unversioned — no /v1/)
spec_format: Swagger 2.0
spec_url: 'https://{instance}/openapi (public copy: https://api.jiwa.com.au/openapi); Swagger UI https://jiwa.com.au/swagger/'
docs_url: 'Jiwa Atlassian wiki, space J7UG ("About the REST API", "Consuming the REST API")'
call_surface: HTTP via `numa integrations request` (connector jiwa), authType api-key — NOT Pipedream, NOT OAuth, NOT a file source
field_casing: PascalCase
id_format: RecID — opaque ~20-char string
scale: 816 paths / 1,381 operations / 2,022 definitions / 37 tags. Methods GET 680 · DELETE 239 · PATCH 226 · POST 217 · PUT 19 [SPEC]
confidence: spec/docs-derived, NOT live-validated. [DOCS]=wiki, [SPEC]=OpenAPI, [UNVERIFIED]=inferred. Single live observation: unauthenticated `GET https://api.jiwa.com.au/Debtors` → 401, empty body. Verify §Known Unknowns before first customer use.
---

# Jiwa Financials — API Specification & Investigation

Developer reference, condensed from `00-api-investigation-questionnaire.md`. Compiled from the official OpenAPI document (Swagger 2.0) and Jiwa's Atlassian wiki.

## Overview

- **Vendor:** Jiwa Financials — Australian ERP (inventory/distribution focus), SQL Server 2016+ backed [DOCS].
- **API version:** `1.0` (unversioned routes); the API is itself a **Jiwa plugin** shipped per Jiwa release [DOCS].
- **Min product version:** Jiwa **8.00.00+** for the REST API (API keys exist since Jiwa **7.2**) [DOCS].
- **Base URL:** per-customer instance, e.g. `https://erp.customer.com.au/` — **no shared SaaS host, no default** [DOCS].
- **API type:** REST on **ServiceStack** — DTO-in/DTO-out ("every request accepts a DTO and almost every response is a DTO"); some requests (auth, queries) can be URL-encoded instead [DOCS].
- **Data format:** JSON (default), XML, CSV — negotiable via `Accept`, `?format=json|xml|csv`, or `.json`/`.xml`/`.csv` route suffix. Browser-style requests without an override get an **HTML razor view** [DOCS].
- **Spec:** `GET /openapi` (requires the "REST API OpenAPI" plugin; also ships Swagger UI) [DOCS]; `securityDefinitions: basic` only [SPEC].
- **Typed clients:** ServiceStack DTO generation served at `/types/csharp|vbnet|fsharp|typescript|java|kotlin|swift` [DOCS].
- **MCP:** Jiwa has announced an official MCP server on this API (announced, not shipped) [DOCS].

**Summary:** Full-surface ERP API — customers (Debtors), suppliers (Creditors), products (Inventory), sales orders/quotes, purchasing (PO → Shipment/GRN → Purchase Invoice), manufacturing (Bills, Work Orders), service jobs, GL journals, staff/timesheets — plus 152 read-only AutoQuery routes ideal for AI data questions, and built-in webhooks.

**Numa integration:** native data connector (`authType: api-key`, NOT Pipedream). The agent calls `numa integrations request` (connector `jiwa`, e.g. `GET /Queries/DB_Main?Take=25`). Backend expands relative URLs against the **admin-configured `instance_url`** (`connector-config-jiwa` — required despite the generic wizard marking it optional) and injects `Authorization: Bearer {user's api_key}` from the user's personal vault. Agent never sees the key.

## Authentication

Two methods [DOCS]. **Numa uses API Key (Bearer) exclusively** — rides the existing token-connector header-injection path with zero new auth code.

### Method 1 — API Key (Jiwa 7.2+) — used by Numa

- **No auth handshake.** Supply the key on every request: `Authorization: Bearer {api-key}` (recommended; what Numa injects). Also accepted: HTTP Basic, or a URL/form parameter (avoid — keys leak into request logs, especially with `RequestLogging`/`DebugMode`) [DOCS].
- Keys belong to a **Jiwa staff member**; effective permissions are exactly that member's — identical to a username/password login [DOCS].
- Keys support an **expiration date** and **revocation** (Enabled flag). Expired/revoked → `401 Not Authenticated` [DOCS].

**Two key types** [DOCS]:

| Key type           | Created in                        | Intended for                                                             | Numa stance                                                                                                                           |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Staff API Key**  | Staff Maintenance form            | Staff member as alternate credential                                     | The only type Numa users should paste                                                                                                 |
| **Debtor API Key** | Debtor Maintenance → API Keys tab | Customers / web portals (linked to a debtor AND a nominated staff login) | Never — wiki: "must not trust any request" made with them; plugin force-filters requests/responses (cost stripping, DebtorID scoping) |

Wiki security guidance: don't give admin users API keys; permit only the routes needed; turn off DebugMode in production; prefer IP whitelisting / Cloudflare fronting [DOCS].

### Method 2 — User credentials / session (NOT used by Numa)

- `POST /auth` (or `GET /auth?UserName=…&Password=…`) → `AuthenticateResponse`:
  `{"UserId":"…","SessionId":"…","UserName":"…","DisplayName":"…","BearerToken":"…","RefreshToken":"…","Roles":[],"Permissions":[]}` [SPEC] — whether `BearerToken`/`RefreshToken` (ServiceStack JWT) are usable is [UNVERIFIED].
- Subsequent requests: `Cookie: ss-id={SessionId}` **or** header `X-ss-id: {SessionId}` [DOCS].
- Session expires after `SessionExpiryInMinutes` of inactivity; `GET /KeepAlive` (204) extends it; `GET /auth/logout` ends it; `GET /Sessions[/Current]` inspect sessions [DOCS][SPEC].

### Failure semantics [DOCS]

- **401** = not authenticated — missing/bad/expired/revoked credentials (observed once live: **empty body**).
- **403** = authenticated, but the **route is not permitted** for the user's User Group — a Jiwa configuration matter, not a code bug.

## Authorization: User Group route-permission model

Permissions are **route-level, per User Group**, set in Jiwa's User Group Maintenance form [DOCS]:

1. **Default REST API Permission** (per group): `Undefined` | `Allow` | `Disallow`.
   - `Disallow` → members can invoke **no route**, regardless of anything else (**disallow anywhere wins**).
   - `Allow` → members can invoke any route, unless another group membership or explicit route permission disallows it.
   - `Undefined` → **deny**, unless another group allows or an explicit route permission allows (and nothing disallows).
2. **Explicit per-route permissions:** the REST API tab imports the live route list from `{api}/RestPaths` (also `GET /RestPaths` [SPEC]) and lets the admin Allow/Disallow each route. No explicit entry → the group default applies.

**Consequences for Numa:** A user's reachable surface is **whatever their User Group grants** — two users on the same instance can see different 403 patterns. Treat 403 as "ask the Jiwa admin", never retry. Recommended customer setup: a dedicated User Group for Numa users, Default = `Undefined`, explicit Allows on the needed `/Queries/*` + entity routes (least privilege). After a Jiwa upgrade, new routes default to the group's Default — re-import RestPaths.

## Endpoint inventory

> 816 paths / 1,381 ops across 37 tags [SPEC]. Full route list: `GET /RestPaths` or `/openapi` on any instance.

### Route conventions [DOCS][SPEC]

```
GET    /{Plural}/{RecID}                  read one          → 200 (204 if nothing to return)
POST   /{Plural}                          create            → 201 (RecID generated server-side)
PATCH  /{Plural}/{RecID}                  partial update    → 200 (full DTO returned)
DELETE /{Plural}/{RecID}                  delete            → 204
GET    /{Plural}/{RecID}/{Children}       list child collection (NOT paginated)
POST/PATCH/DELETE on …/{Children}/{ChildRecID}              child CRUD
PUT    …/{SetCollection}                  replace a whole set (TagMembership, LineDetails — 19 ops total)
POST   /{Plural}/Activate/{RecID}         post/activate a draft document (GRN, Shipment, PI, BookIn, transfers)
POST   /{Plural}/From{Source}/{ids}       construct from upstream docs (e.g. GRN FromPurchaseOrders)
DELETE /{Plural}/Cache/{RecID}            cache invalidation (only live when caching plugins enabled)
GET    /{Plural}/CustomFields             custom-field definitions; …/{RecID}/CustomFieldValues values
```

- **No list GET on entity roots** (`GET /Debtors` exists but is the _Debtor-key self-lookup_, not a list [SPEC]). All listing/filtering goes through `/Queries/*`.
- Compound writes: parent POST/PATCH DTOs accept nested child arrays (Lines, Notes, Payments, ContactNames…) — child with ID = update, without ID = append [DOCS].

### Per-tag operation counts [SPEC]

| Tag                  | Ops | Tag                 | Ops | Tag                                               | Ops    |
| -------------------- | --- | ------------------- | --- | ------------------------------------------------- | ------ |
| Inventory            | 176 | Purchase Invoices   | 38  | Currencies                                        | 10     |
| Queries              | 152 | Staff               | 37  | Tax Rates                                         | 10     |
| Debtors              | 136 | Purchase Orders     | 35  | Customer Web Portal                               | 8      |
| Service Manager      | 112 | Warehouse Transfers | 21  | Languages                                         | 6      |
| Work Orders          | 105 | To Dos              | 19  | Stock Transfers                                   | 5      |
| Sales Orders         | 82  | Webhooks            | 18  | Prepaid Labour                                    | 4      |
| Bills                | 70  | Carriers            | 15  | Regions                                           | 4      |
| Creditors            | 56  | Email Messages      | 15  | Supplier Returns                                  | 4      |
| Goods Received Notes | 51  | auth                | 11  | System                                            | 3      |
| Shipments            | 48  |                     |     | Services                                          | 2      |
| Sales Quotes         | 44  |                     |     | Warehouse                                         | 2      |
| Journal Sets         | 39  |                     |     | DocumentTypes / KeepAlive / NoteTypes / RestPaths | 1 each |
| BookIns              | 39  |                     |     |                                                   |        |

### Debtors (customers) — 136 ops

| Route pattern                                                                                                        | Methods                  | Notes                                                    |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------- |
| `/Debtors/{DebtorID}`                                                                                                | GET, PATCH, DELETE       | Full 87-field DTO                                        |
| `/Debtors`                                                                                                           | POST · GET               | POST = create; GET = **Debtor-API-key self-lookup only** |
| `/Debtors/{id}/ContactNames[/{ContactNameID}]`                                                                       | GET, POST, PATCH, DELETE | + per-contact TagMembership, CustomFieldValues           |
| `/Debtors/{id}/DeliveryAddresses[/{id}]`                                                                             | full CRUD                |                                                          |
| `/Debtors/{id}/Notes · Documents · GroupMemberships · DebtorPartNumbers · FreightForwarderAddresses · DebtorSystems` | full CRUD                | Standard child-collection pattern                        |
| `/Debtors/{id}/Backorders`                                                                                           | GET                      | Convenience read                                         |
| `/Debtors/{id}/StatementReport/{ReportID}/At/{AsAtDate}`                                                             | GET                      | Rendered statement                                       |
| `/Debtors/Classifications · Categories · PricingGroups · Tag · NoteTypes · DocumentTypes`                            | lookup CRUD              | Reference data                                           |
| `/DebtorSystemTemplates/...`                                                                                         | full CRUD                | Debtor-system template admin                             |

### Inventory (products) — 176 ops (largest family)

| Route pattern                                                                                                | Methods            | Notes                                                  |
| ------------------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------ |
| `/Inventory/{InventoryID}`                                                                                   | GET, PATCH, DELETE | 89-field DTO; `POST /Inventory` creates                |
| `/Inventory/{id}/SellingPrices`                                                                              | GET, PATCH         | Price maintenance                                      |
| `/Inventory/{id}/DebtorSpecificPrices · DebtorClassificationPrices · DebtorPriceGroupPrices`                 | CRUD               | Price-list layers                                      |
| `/Inventory/{id}/Pricing/{DebtorID}/{IN_LogicalID}/{Date}/{Quantity}`                                        | GET                | **Effective-price calculator** for a customer/date/qty |
| `/Inventory/{id}/Components · AlternateChildren/Parents · CrossSells · UpSells`                              | CRUD               | BOM + merchandising                                    |
| `/Inventory/{id}/Regions/{RegionName}/Suppliers[/{SupplierID}]/SupplierWarehouses`                           | CRUD               | Supplier sourcing per region                           |
| `/Inventory/{id}/Budgets/{LogicalWarehouseID}/Months/{MonthIndex}`                                           | GET, PATCH         | Sales budgets                                          |
| `/Inventory/{id}/ProductAvailabilities · OrderLevels · UnitOfMeasures · Images · Ledgers`                    | CRUD               | Stock/UoM/media                                        |
| `/Inventory/Classifications · Categories · PricingGroups · Tag · WebStoreCategory · AttributeGroupTemplates` | lookup CRUD        |                                                        |

### Sales Orders — 82 ops (snapshot model)

| Route pattern                                                                                     | Methods                                  | Notes                                                             |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `/SalesOrders`                                                                                    | POST                                     | Create with nested Lines/Payments/Notes                           |
| `/SalesOrders/{InvoiceID}`                                                                        | GET, PATCH                               | **No top-level DELETE**                                           |
| `/SalesOrders/{InvoiceID}/Historys[/{InvoiceHistoryID}]`                                          | GET, PATCH                               | Snapshots; some fields only patchable via the parent order [DOCS] |
| `/SalesOrders/{InvoiceID}/Historys/{hid}/Lines[/{InvoiceLineID}]`                                 | GET, POST, PATCH, DELETE                 | Lines live under a history snapshot                               |
| `…/Lines/{lid}/LineDetails`                                                                       | GET, POST, PATCH, DELETE, PUT(set)       | Serial/bin allocations [UNVERIFIED semantics]                     |
| `/SalesOrders/{InvoiceID}/Payments[/{PaymentID}]`                                                 | GET, PATCH, DELETE (+POST under history) |                                                                   |
| `/SalesOrders/{InvoiceID}/Process`                                                                | **GET (side-effecting!)**                | Posts journals + debtor transactions [DOCS]                       |
| `/SalesOrders/{InvoiceID}/Save` · `…/Abandon`                                                     | GET · DELETE                             | Stateful edit-session endpoints [DOCS]                            |
| `…/Historys/{hid}/Carrier/ConsignmentNotes · FreightItems`                                        | CRUD                                     | Freight                                                           |
| `…/{InvoiceID}/InvoiceReport/{ReportID}` · `/{InvoiceHistoryID}/InvoiceSnapshotReport/{ReportID}` | GET                                      | Rendered documents                                                |
| `/SalesOrders/CreditReasons · PaymentTypes · NoteTypes · DocumentTypes · CustomFields`            | lookup CRUD                              |                                                                   |

Sales Quotes (44 ops) mirror this shape and add `POST /SalesQuotes/{QuoteID}/MakeOrder` and `MakeOrderB2B` (quote → order conversion) [SPEC].

### Purchasing chain — Creditors 56 · Purchase Orders 35 · Shipments 48 · GRNs 51 · BookIns 39 · Purchase Invoices 38

| Flow step        | Key routes                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Supplier master  | `/Creditors/{CreditorID}` CRUD + Classifications/Tags/WarehouseAddresses/Documents/Notes                                           |
| Order            | `/PurchaseOrders` POST · `/{id}` GET/PATCH/DELETE · `/Lines` CRUD · `POST /PurchaseOrders/Activate/{id}`                           |
| Inbound freight  | `/Shipments` POST · `FromPurchaseOrders/{OrderNos}` · `Activate/{id}` · Lines/Notes/Documents                                      |
| Receiving        | `/GoodsReceivedNotes` POST · `FromPurchaseOrders/{OrderNos}` · `FromPurchaseOrderLines` · `Activate/{GRNID}` · Lines + LineDetails |
| Book-in          | `/BookIns/FromShipmentID/{ShipmentID}` · `FromShipmentNo/{No}` · `Activate/{BookInID}`                                             |
| Supplier invoice | `/PurchaseInvoices` POST · `FromGoodsReceivedNotes/{GRNNos}` · `Activate/{PurchaseInvoiceID}`                                      |
| Returns          | `/SupplierReturns/Credit/FromShipments` · `Credit/Activate/{CreditID}`                                                             |

Every `Activate/*` posts a financial document — treat like `/Process` (human confirmation in Numa).

### Manufacturing & service — Bills 70 · Work Orders 105 · Service Manager 112

- **Bills:** `/Bills/{BillID}` + Stages → Inputs/Instructions, Outputs — BOM definitions [SPEC].
- **Work Orders:** `/WorkOrders/{id}` + Stages → Inputs (+Wastage)/Instructions, Outputs (+LineDetails), Allocations; `POST /WorkOrders/Reversal` [SPEC].
- **Service Manager:** `/ServiceManager/Jobs/{JobID}/Tasks/{TaskID}` + LabourLines/PartLines/CustomerReturns (each with LineDetails); actions `ProcessSalesOrder`, `ProcessCreditNote`, `Retire`, `Unretire`; lookup Priorities/Statuses/Activities [SPEC].

### Other families (summary)

- **Journal Sets (39):** GL journals `/JournalSets/{id}` + Lines + Notes/Documents — recommend read-only for Numa.
- **Staff (37):** Departments + Categories, Timesheets + Lines, `GET /Sessions[/Current]`, `GET/POST /UserSettings`; password reset/change routes (Customer Web Portal tag adds tokenised variants).
- **To Dos (19):** `/ToDos/{id}` + Collaborations + Dependencies + Documents.
- **Email Messages (15):** stored messages + attachments (incl. AttachmentTypes).
- **Reference:** Carriers (+FreightDescriptions/Services), Currencies (+Rates), TaxRates, Regions, Languages, Warehouse (`GET/PATCH /LogicalWarehouses/Current`).
- **Utility/system:** `GET /SystemInfo` (versions, DB, currency — ideal test-connection), `GET /RestPaths`, `GET /KeepAlive`, `GET /Services/Restart` · `/Services/Stop` (**never expose to the agent**), `GET /Queries/StartupLog` · `/Queries/PluginExceptions` (System tag).

## AutoQuery: the `/Queries/*` routes (152 ops — workhorse for AI data questions)

ServiceStack **AutoQuery** over named SQL tables/views. Read-only GETs. 79 plain views + 75 `/Queries/OR/{View}` twins (+2 System-tagged) [SPEC].

### Available views (plain set) [SPEC]

`BM_Main`, `BM_WorkOrder`, `BM_WorkCentreSelection`, `BM_WorkOrderSelection`, `BMProductsForOutputs`, `BackOrderList`, `BinLocationQuantities`, `BinLocationSelection`, `CR_Main`, `CR_Warehouse`, `ContactNameMultiples`, `DB_Categories`, `DB_Classification`, `DB_DebtorSystemTemplates`, `DB_DebtorSystems`, `DB_Main`, `DB_PricingGroups`, `DebtorList`, `DebtorTransactionList`, `EM_Main`, `FR_Carriers`, `FX_Currency`, `FX_CurrencyRates`, `GL_Category`, `GL_Ledger`, `GL_Sets`, `GR_ReceivalDocuments`, `HR_Departments`, `HR_Staff`, `INSOHWithBinLocations`, `IN_AttributeGroupTemplate`, `IN_BinLocationLookup`, `IN_Categories`, `IN_Classification`, `IN_Logical`, `IN_Main`, `IN_Physical`, `IN_Region`, `IN_SOH`, `IN_Transfer`, `IN_WarehouseSOH`, `InventoryBarCodeList`, `InventoryItemList`, `JobCostingSelection`, `PI_Main`, `PO_Main`, `PurchaseOrderSelection`, `QO_Main`, `RE_Main`, `SH_BookInMain`, `SH_Main`, `SO_Main`, `SY_Branch`, `SY_Plugin`, `SY_Report`, `SY_ReportSection`, `SY_SysValues`, `SY_WebhookSubscriber`, `SalesOrderList`, `SalesQuoteList`, `ServiceManagerActivities`, `ServiceManagerSelectionQuery`, `ServiceManagerStatuses`, `StaffTimesheets`, `StaffUserGroups`, `TX_Main`, `TimeSheetCombined`, `TimeSheetSelection`, `TimeSheetSelectionWithFlags`, `TimeSheetWithWorkOrdersSelection`, `WH_Transfer`, `WarehouseSelection`, `WorkOrderSelection`, `WorkOrderStageSelection`, `WorkOrderStatusesSelection`, `WorkOrderToDoSelection`, `v_Jiwa_SalesInformation` (+ System-tagged: `StartupLog`, `PluginExceptions`).

Naming: `XX_` prefix = raw table (DB=debtors, IN=inventory, SO=sales orders, CR=creditors, GL=ledger, HR=staff, FX=currency, SH=shipments, PI/PO=purchasing, QO=quotes, SY=system); friendly names (`DebtorList`, `SalesOrderList` = `v_Jiwa_SalesOrder_List`) are richer pre-joined views [DOCS].

### Generated parameter grammar [SPEC]

Each view route exposes convention-generated params per column (`DB_Main`: 494 params), plus common AutoQuery controls:

| Parameter form                                                         | Meaning                                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `{Field}=v`                                                            | exact match                                                            |
| `{Field}StartsWith` / `EndsWith` / `Contains` / `Like`                 | string operators                                                       |
| `{Field}In=a,b,c`                                                      | IN list                                                                |
| `{Field}Between`                                                       | range                                                                  |
| `{Field}GreaterThan[OrEqualTo]` / `LessThan[OrEqualTo]` / `NotEqualTo` | comparisons (dates/numbers)                                            |
| `Skip` / `Take`                                                        | offset pagination (`Take` ≤ `AutoQueryMaxLimit` system setting [DOCS]) |
| `OrderBy` / `OrderByDesc` (csv)                                        | sorting                                                                |
| `Fields=a,b,c`                                                         | sparse field selection                                                 |
| `Include=Total`                                                        | adds total match count                                                 |

Conditions combine with **AND**; the `/Queries/OR/{View}` twin presumably ORs them [UNVERIFIED]. Requests may also be sent as a DTO body instead of URL params [DOCS].

### Response envelope (`QueryResponse<T>`) [SPEC]

`{"Offset":0,"Total":132,"Results":[{…row…}],"Meta":null,"ResponseStatus":null}`. Last page: `Offset + len(Results) >= Total`. Always set `OrderBy` when paging.

### Worked examples (from the wiki, sanitized) [DOCS]

```http
GET /Queries/DebtorList?WebAccess=true&LastSavedDateTimeGreaterThan=2026-06-01T00:00:00.000&Fields=AccountNo,Name&Include=Total
GET /Queries/DB_Main?AccountNoStartsWith=1&OrderBy=AccountNo&Take=5&Skip=5&Fields=DebtorID,AccountNo,Name,EmailAddress
GET /Queries/SalesOrderList?PhysicalWarehouseDescription=New South Wales&LogicalWarehouseDescription=Main&Fields=InvoiceID,InvoiceNo,InvoiceInitDate,DebtorID,AccountNo,DebtorName&OrderBy=InvoiceNo&Include=Total&Take=25
GET /Queries/SO_Main?Fields=InvoiceID,InvoiceNo,InvoiceInitDate,DebtorID&OrderBy=InvoiceNo&Take=25&Include=Total
```

## Data models

> 2,022 definitions [SPEC]. RecIDs are opaque ~20-char strings (`0000000061000000001V`, `babce67cdbf64f778536`). `LastSavedDateTime` + `RowHash` appear on virtually every entity. Wiki examples URL-encode **trailing space padding** on custom-field SettingIDs (`…/CustomFieldValues/1ae102b94dc54dfc8a45                /`) — looks like CHAR-padded keys; behavior without padding [UNVERIFIED].

### Debtor (87 props) [SPEC]

| Field                                                                                                                                                      | Type        | Writable | Notes                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- | ---------------------------------------------------- |
| DebtorID                                                                                                                                                   | RecID       | no       | Server-generated                                     |
| AccountNo / AltAccountNo                                                                                                                                   | string      | yes      | Auto-generated if omitted; supply in practice [DOCS] |
| Name / EmailAddress / Phone / Fax / Address1–4 / Postcode / Country                                                                                        | string      | yes      |                                                      |
| ABN / ACN / TaxExemptionNo                                                                                                                                 | string      | yes      | AU business identifiers                              |
| CreditLimit / StandingDiscountOnInvoices / EarlyPaymentDiscount\*                                                                                          | number      | yes      | Terms                                                |
| TermsDays / TermsType / PeriodType / TradingStatus                                                                                                         | mixed       | yes      |                                                      |
| AccountOnHold / IsCashOnly / WebAccess / ExcludeFromAging                                                                                                  | boolean     | yes      |                                                      |
| CurrentBalance / Period1–4Balance / LastPurchaseDate / LastPaymentDate                                                                                     | number/date | no       | Computed                                             |
| Classification / Category1–5 / PricingGroup                                                                                                                | objects     | yes      | Lookups                                              |
| ContactNames / DeliveryAddresses / Notes / Documents / CustomFieldValues / GroupMemberships / TagMemberships / DebtorPartNumbers / Budgets / DebtorLedgers | arrays      | yes      | Inline children                                      |
| LastSavedDateTime                                                                                                                                          | date-time   | no       | Change detection                                     |

### InventoryItem (89 props) [SPEC]

| Field                                                                                                    | Type      | Writable | Notes                                                      |
| -------------------------------------------------------------------------------------------------------- | --------- | -------- | ---------------------------------------------------------- |
| InventoryID                                                                                              | RecID     | no       |                                                            |
| PartNo / Description / UnitMeasure                                                                       | string    | yes      | PartNo usable instead of InventoryID in order lines [DOCS] |
| DefaultPrice / RRPPrice                                                                                  | number    | yes      | Sell prices                                                |
| LCost / SCost / StandardCost / SalesManCost / SecondaryCost                                              | number    | —        | **Costs — stripped for Debtor-key callers** [DOCS]         |
| Status / Classification / Category1–5 / Style / Colour / Size                                            | mixed     | yes      | Taxonomy                                                   |
| PhysicalItem / BackOrderable / WebEnabled / UseSerialNo / UseExpiryDate / Discountable / SellPriceIncTax | boolean   | yes      | Flags                                                      |
| Picture                                                                                                  | binary    | yes      | Encoding [UNVERIFIED]                                      |
| MinimumGP / Weight / Cubic / DecimalPlaces                                                               | number    | yes      |                                                            |
| LastSavedDateTime                                                                                        | date-time | no       |                                                            |

### SalesOrder (105 props) / SalesOrderLine (68 props) [SPEC]

Header: `InvoiceID` (RecID, ro), `InvoiceNo` (ro), `DebtorID`/`DebtorAccountNo` (either; ID wins [DOCS]), `InitiatedDate`, `ExpectedDeliveryDate`, `OrderNo`, `SOReference`, `Status`/`SalesOrderType`/`OrderType` (string; values [UNVERIFIED]), `CreditNote` (bool), warehouse fields (`LogicalID`, `LogicalWarehouseDescription`, `PhysicalWarehouseDescription`), totals (computed), `Lines[]`, `Payments[]`, `Notes[]`, `Documents[]`, `CustomFieldValues[]`, `Historys[]`.
Line: `InvoiceLineID` (supply = update, omit = append [DOCS]), `InventoryID`/`PartNo` (either; ID wins), `QuantityOrdered`, `DiscountedPrice` (omit → pricing engine), `CommentLine`+`CommentText`, `CustomFieldValues[]`, computed `LineTotal`/`TaxToCharge`/`PriceExGst`/`PriceIncGst`/`QuantityBackOrd`/`QuantityThisDel`, `TaxRate` (object), `UserDefinedFloat1–3`.

### Error / envelope DTOs [SPEC]

```json
// ResponseStatus (ServiceStack standard error body)
{"ErrorCode":"…","Message":"…","StackTrace":null,"Errors":[{"ErrorCode":"…","FieldName":"…","Message":"…"}],"Meta":{}}
// QueryResponse<T>
{"Offset":0,"Total":0,"Results":[],"Meta":{},"ResponseStatus":{}}
// SystemInformationGETResponse (GET /SystemInfo)
{"JiwaVersion":"…","JiwaRESTAPIPluginVersion":"…","ServiceStackVersion":"…","DotNETVersion":"…","OSVersion":"…","SQLServerDateTime":"…","CacheProvider":"…","DatabaseName":"…","DatabaseServer":"…","SQLVersion":"…","LicensedCompany":"…","CurrencyName":"…","CurrencyShortName":"…","MoneyDecimalPlaces":2}
```

## Pagination

- **Type:** offset — `Skip` + `Take` on `/Queries/*` routes only [DOCS].
- **Default Take:** [UNVERIFIED]; ceiling = `AutoQueryMaxLimit` system setting (per-instance; clamp-vs-error [UNVERIFIED]) [DOCS].
- **Total count:** `?Include=Total` → `Total` in `QueryResponse` [DOCS].
- **Entity child collections** (`/Debtors/{id}/ContactNames`, order `Lines`…) are **unpaginated full arrays** [SPEC].
- **Last page detection:** `Offset + len(Results) >= Total`, or short/empty `Results`.

```
Page 1: GET /Queries/DB_Main?OrderBy=AccountNo&Take=25&Include=Total
Page 2: GET /Queries/DB_Main?OrderBy=AccountNo&Take=25&Skip=25
Stop:   when Skip + returned rows >= Total
```

## Rate limits

| Scope    | Limit                                                             | Window              |
| -------- | ----------------------------------------------------------------- | ------------------- |
| Default  | **none**                                                          | —                   |
| Optional | per-IP, "REST API Rate Limit" plugin (if the customer enables it) | configurable [DOCS] |

No rate-limit headers documented; plugin 429 behavior [UNVERIFIED]. **Self-throttle anyway** — this is a customer's production ERP box, usually modest Windows hardware. `AutoQueryMaxLimit` is the only built-in guard (DoS protection) [DOCS].

## Error handling

**Documented behavior** [DOCS]: HTTP status code + response **body text describing the problem** (e.g. "product not found"). `DebugMode=true` adds stack traces (and exposes request logs — wiki says turn it OFF in production). Structured form is the ServiceStack `ResponseStatus` DTO (above) [SPEC]; **actual wire shape per failure class is [UNVERIFIED]** — observed: 401 with empty body.

| Status | Meaning                                                                                                                         | Retryable  | Recovery                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------- |
| 200    | OK (most GETs, PATCH)                                                                                                           | —          |                                               |
| 201    | Created (successful POST)                                                                                                       | —          |                                               |
| 204    | No Content (successful DELETE; GET with nothing to return)                                                                      | —          | Not an error — handle empty body              |
| 401    | Not authenticated (bad/expired/revoked key)                                                                                     | No         | Fix/rotate key; do NOT retry                  |
| 403    | Route not permitted (User Group config)                                                                                         | No         | Jiwa admin grants route; surface to user      |
| 404    | Invalid route OR record not found                                                                                               | No         | Verify RecID/path                             |
| 409    | Business-logic veto (delete a referenced product) OR **optimistic-concurrency conflict** (record changed between read and save) | Sometimes  | Re-read, reconcile, retry deliberately        |
| 500    | Server error (plugin compile failures → Windows event log)                                                                      | Cautiously | Inspect body text; often environmental [DOCS] |

**Parse defensively:** status first → try JSON `ResponseStatus` → fall back to raw body text → tolerate empty bodies (401, 204).

**Idempotency:** no idempotency keys. GET idempotent **except** side-effecting action GETs (`/Process`, `/Save`, `/Services/Restart`). PATCH retries can **duplicate appended children** (ID-less array elements append). POST retries duplicate records — query before retrying after a timeout.

## Webhooks / events

Built-in (18 ops, Webhooks tag) [SPEC]; configured via system settings [DOCS]. A future Numa Automations trigger source.
**Model:** Subscriber (named registration) → Subscriptions (event + delivery URL):

```
POST /Webhooks/Subscribers/                       {"Name":"Numa","IsEnabled":true}  → SY_WebhookSubscriber {RecID}
POST /Webhooks/Subscribers/{SubscriberID}/Subscriptions/  {"URL":"https://…","EventName":"…","RequestHeaders":[{"Name":"X-Numa-Secret","Value":"…"}]}
GET  /Webhooks/Events/                            → [{"Name":"…","Description":"…"}]  (catalog instance-served [SPEC]; names [UNVERIFIED])
POST /Webhooks/Test/                              test fire
GET  /Webhooks/Subscribers/{id}/Messages[/Responses]   delivery audit/replay data
```

**Security:** no signature/HMAC in spec or wiki [UNVERIFIED — assume none]. Use a shared-secret custom RequestHeader + receiver-side validation.
**Reliability** [DOCS]: retry backoff `10^(RetryNo × WebhooksRetryInterval)` seconds up to `WebhooksMaxRetries`; messages retained `WebhooksMessagesRetentionDays` (event log 8 days default); multi-host installs nominate a retry-handler host. **`HostURL`/`URLBase` system setting must be set or webhooks (and cache invalidation) don't function.**
**Polling fallback:** `/Queries/{View}?LastSavedDateTimeGreaterThan={iso}` — `LastSavedDateTime` is ubiquitous [SPEC].

## Deployment model: self-hosted, per-customer instance (THE structural caveat)

There is **no Jiwa SaaS API**. Each customer runs the REST API themselves [DOCS]:

1. **Windows service only** (Jiwa 8): installed with Jiwa; configured in `JiwaAPISelfHostedService.exe.config` — `ServerName`, `DatabaseName`, `JiwaUsername`, `JiwaPassword`, `URLBase` (**trailing slash required**, e.g. `https://erp.example.com:443/`). IIS reverse-proxy hosting **no longer supported** in v8. Service user consumes a Jiwa licence (non-interactive recommended).
2. **Plugin prerequisites:** REST API plugin enabled in Plugin Maintenance (then re-login). "REST API OpenAPI" plugin → `/openapi` + Swagger UI. Caching plugins → `Cache/` routes. Rate-limit plugin optional. Fourteen system settings govern sessions, AutoQuery limit, DebugMode, request logging, webhooks, cache keys, and `CustomerWebPortalJiwaUser`.
3. **TLS:** Windows cert binding (`netsh http add sslcert …`); wiki recommends Let's Encrypt via win-acme auto-renewal. Invalid/expired certs make clients drop the connection.
4. **Exposure guidance** [DOCS]: don't expose publicly unless needed; IP-whitelist where possible; consider Cloudflare in front; never run the service as a Windows admin account.

**Reachability constraint for Numa:** the Numa backend (AWS Lambda, per-client account) must reach the customer's instance over the public internet with valid TLS. Consequences:

- LAN-only installs **cannot** be connected until the customer publishes the API (DNS + cert + port-forward/proxy).
- If the customer IP-whitelists, they must allow Numa's egress (per-client NAT/egress IPs not currently stable — coordinate before promising whitelist support).
- Connectivity failures look like timeouts/Cloudflare challenges, not API errors — the connector test should distinguish network-unreachable from 401/403.
- `instance_url` differs per customer and **must include scheme + host (+ port)**; relative connector URLs are joined against it. No default.

**Recommended test-connection sequence (wizard / first use):**

1. `GET /SystemInfo` — validates key + reachability, returns Jiwa + plugin versions (log them).
2. `GET /Sessions/Current` — confirms the staff identity the key acts as.
3. `GET /Queries/DB_Main?Take=1` — proves AutoQuery route permission is granted.

## Known Unknowns — verify on a test instance before customer rollout

1. **Date/time wire format** — ServiceStack can emit WCF `/Date(ms)/` JSON dates unless configured for ISO 8601. Wiki examples don't show raw response bodies. Affects every downstream consumer — verify FIRST.
2. **Error body shapes** per failure class (400/403/404/409/500): `ResponseStatus` JSON vs plain text vs empty; effect of `DebugMode`.
3. **Default `Take`** when omitted, the instance's `AutoQueryMaxLimit` value, and whether exceeding it clamps or errors.
4. **`/Queries/OR/{View}` semantics** — confirm conditions are OR-combined.
5. **API key mechanics** — key format/length; whether HTTP Basic places the key as username or password; whether the URL-parameter form is actually enabled.
6. **`AuthenticateResponse.BearerToken` / `RefreshToken`** — is ServiceStack JWT usable, or session-cookie only?
7. **Custom-field `SettingID` trailing-space padding** in URLs — required or tolerated?
8. **`RowHash` / optimistic concurrency** — must PATCH echo `RowHash` to avoid 409s, or is conflict detection purely timestamp-based?
9. **POST status** — 200 vs 201 consistency (spec declares both per route).
10. **Document/Image upload encoding** — base64-in-JSON vs multipart; size limits.
11. **Webhook event catalog** (`GET /Webhooks/Events/`), payload shape, and absence/presence of signing headers.
12. **Version drift** — route coverage on a Jiwa 7.2 instance vs the 8.x spec used here; re-pull and diff per-customer `/openapi` at onboarding.
13. **Enum/status values** for `SalesOrder.Status`, `SalesOrderType`, etc. — spec types them as bare strings; one wiki example PATCHes `{"Status":2}` (integer) to a history.
14. **Behavior of `GET /Debtors`** (no ID) under a Staff key — spec says it's the Debtor-key self-lookup; expected 4xx for staff keys [UNVERIFIED].

## Known limitations

1. **No live validation** — this whole pack is docs/spec-derived.
2. **Per-customer surface drift** — plugins, route permissions, and Jiwa versions change what's actually callable.
3. **Self-hosted reachability** — internet exposure, TLS, and whitelisting are customer-side work.
4. **No API versioning** — breaking changes arrive with Jiwa releases; pin expectations per instance.
5. **No batch endpoints** — compound DTOs only; no partial-failure reporting documented.
6. **Entity child collections unpaginated** — large child sets return whole arrays.
7. **Side-effecting GETs** (`/Process`, `/Save`, `/Services/*`) violate REST idempotency — never auto-retry GETs blindly.
8. **No default rate limiting** — Numa must self-throttle against production ERP hardware.
9. **Costs/margins in DTOs** — `InventoryItem` carries cost fields; users see whatever their staff permissions allow. Flag to admins during onboarding.

## SDKs & tooling

| SDK                        | Language                                        | Repository                           | Quality | Notes                                                           |
| -------------------------- | ----------------------------------------------- | ------------------------------------ | ------- | --------------------------------------------------------------- |
| ServiceStack typed clients | C#, VB.NET, F#, TypeScript, Java, Kotlin, Swift | generated per-instance at `/types/*` | good    | First-class per wiki; unnecessary for Numa (generic HTTP proxy) |

**Postman collection:** not available. **OpenAPI spec:** `https://{instance}/openapi` (Swagger 2.0) — public copy `https://api.jiwa.com.au/openapi`; Swagger UI at `https://jiwa.com.au/swagger/`.

## Integration path assessment

**Recommended path:** Direct API via Numa native data connector (`request` operation), `authType: api-key` — NOT Pipedream, NOT OAuth.

**Justification:** Bearer-token API keys ride the existing token-connector backend unchanged: the admin contributes only the **instance URL** (ApiKeyWizard; required), each user pastes a personal **Staff API Key** into the chat credential card on first use (vault secret `connector-jiwa`, field `api_key`), and the backend injects `Authorization: Bearer …` on every proxied call. Per-user keys preserve Jiwa's own audit trail and User Group permission enforcement — a shared key would collapse all Numa activity onto one staff identity and over-privilege everyone.

**Connector compatibility:** N/A — not a file source (`list_files`/`download_file` don't apply). Entity `Documents` attachments could later back a download capability once upload/download encoding is verified (Known Unknown #10).

**Rollout checklist (per customer):**

1. Customer: Jiwa 8.x, REST API plugin enabled, API internet-reachable with valid TLS.
2. Customer: dedicated User Group for Numa users; route permissions imported from `/RestPaths` and granted least-privilege.
3. Customer: Staff API Key per Numa user (no admin accounts, no Debtor keys).
4. Numa admin: add Jiwa in Integrations → wizard → set Instance URL.
5. Verify: `/SystemInfo` → `/Sessions/Current` → `/Queries/DB_Main?Take=1`.
6. Burn down §Known Unknowns on the first connected instance; update `01-llm-api-rules.md` with findings.

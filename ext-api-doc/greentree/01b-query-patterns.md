---
api_name: MYOB Greentree
api_slug: greentree
doc: query patterns (list/filter/sort/page reads, per-entity modifier model) — companion to 01-llm-api-rules.md (on-demand)
call_surface: HTTP via connectors(name="request", connector="greentree"); bare relative path STARTING WITH THE COMPANY CODE (/01/...); backend injects ApiKey header + per-user Basic and expands the URL against the admin instance_url. Never set auth headers; never use an absolute URL; always include the company code.
path_rule: /{company}/{entity}[/{identifier}]; identifier = human key, NOT OidString
confidence: docs-derived (MYOB Greentree official docs); NOT live-validated. Treat all as [DOCS] unless tagged [UNVERIFIED]; verify modifier support + version gates. Per-customer differences: version gates whole entities AND individual modifiers; the authenticated user's permissions filter every result.
---

# MYOB Greentree — Query Patterns

```
connectors(name="request", params={"connector":"greentree","method":"GET","url":"/01/Customer?page=1&pageSize=50"})
```

## Query capabilities summary

| Capability                  | Supported       | Syntax                                                                                                                                          | Notes                                                              |
| --------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Filter by field value       | per-entity      | `?customer=CUST1234`, `?status=Entered`                                                                                                         | NOT generic — each entity declares its OWN modifiers               |
| Filter by changed-since     | yes (universal) | `?modifiedSince=2013-02-28T16:45:00`                                                                                                            | present on essentially every entity                                |
| Filter by string pattern    | no (generic)    | —                                                                                                                                               | no `Contains`/`StartsWith`; use specific modifiers or globalSearch |
| Global search               | yes (2020.1+)   | `?globalSearch=041`                                                                                                                             | runs Greentree's configured Global Search across columns           |
| Filter by tree/branch       | many entities   | `?treeName=Colour-AUS&treeBranch=Blue`                                                                                                          | org-structure filtering                                            |
| Sort by field               | 2021+ rollout   | `?sortBy1=orderNumber&sortDesc1=true`                                                                                                           | per-entity rollout; started on ARInvoice                           |
| Field trimming              | limited         | `?listOnly=true` (StockItem)                                                                                                                    | a few entities offer a slim list mode; no generic `Fields=`        |
| Include related collections | yes (opt-in)    | `?includeAttachments=true`, `?includeStickyNotes=true`, `?includeApprovals=true`, `?includeLinkedObjects=true`, `?includePluginProperties=true` | off by default                                                     |
| Aggregation / count         | no              | —                                                                                                                                               | no total-count field documented [UNVERIFIED]                       |
| Logical OR across filters   | no              | —                                                                                                                                               | multiple modifiers AND; no OR construct [UNVERIFIED]               |
| Pagination                  | yes             | `?page=1&pageSize=50`                                                                                                                           | 100-record hard cap per list GET                                   |

## The filter model: per-entity modifiers (NOT a generic query grammar)

Greentree does NOT expose a uniform "every column is filterable with operators" grammar. Each entity's docs page declares a fixed set of supported modifiers, in two tiers:

1. **Common modifiers** (most entities): `modifiedSince` (universal change filter, ISO8601 server-local); `treeName`+`treeBranch` (org-tree membership); `respectAdvancedSecurityForUser={user}`; the `include*` collection toggles (Attachments, StickyNotes, Approvals, LinkedObjects, PluginProperties); `globalSearch` (2020.1+); `sortBy{n}`/`sortDesc{n}` (2021+, per-entity rollout).
2. **Entity-specific modifiers:**
   - `Customer`: `isActive`, `emailAddress`, `includeWebUsers`
   - `ARInvoice`: `customer`, `holdCode`, `outstandingOnly`, `postingDate` (2021.1+)
   - `Supplier`: `isActive`, `taxReference`, `status`
   - `StockItem`: `isActive`, `analysisCode`, `stockingLocation`, `listOnly`, `includeBarcodes`/`includeSerialLots`/`includeAliases`
   - `POPurchaseOrder`: `supplier`, `status` (pipe-list 2021.1+), `branch` (2017.1+), `canBeApprovedByUser` (2019.1+)
   - `SOSalesOrder`: `customer`, `status`, `salesPerson`, `branch`, `customerOrderNumber`
   - `JCJob`: `customer`, `jobManager`, `accountManager`, `parentJob`, `jobType`, `excludeClosed`, `excludeFinalised`, `includeSubJobs`, `isOpen`, `profitCentre`
   - `GLAccount`: `accountType`, `includeTransactionTrees`, `includeOpeningBalance={fiscalYear}`

> Before filtering an entity, look up its supported modifiers (docs page or `01a`). An unsupported param is silently ignored or errors per version [UNVERIFIED]. **There is no `?AnyField=value` fallthrough** — `?Name=Acme` on Customer is not a documented filter; use `globalSearch` or fetch + filter client-side. Multiple modifiers AND together [UNVERIFIED — standard expectation]; no OR construct. URL-encode spaces/special chars (`respectAdvancedSecurityForUser=Susan%20Smith`).

## Response shape

A list GET returns up to `pageSize` (max 100) records; a single GET (`/{entity}/{identifier}`) returns one full record. Docs show XML samples; through the connector you get JSON (Accept negotiation). No envelope/`total`/`offset` metadata documented — the response is the record array (list) or record object (single); detect list end by a short/empty page [UNVERIFIED — no total-count field]. `include*` toggles graft extra collections onto each record (e.g. `Attachments collection='true' count='2'`); off by default to keep payloads small.

## Two read surfaces

1. **List GET** — `/{company}/{entity}` (+ modifiers + paging). The right surface for "find/list/report" questions. Narrow server-side with the entity's specific modifiers; page with `page`/`pageSize`.
2. **Single GET by identifier** — `/{company}/{entity}/{identifier}`. Returns the full record (and, with `include*`, its sub-collections). Use when you have the human key and need the whole object.

When you only have a name/email, resolve to the key first via a list GET with the matching modifier (`?emailAddress=`, `?customer=`, `?globalSearch=`), then read by identifier.

## Common patterns

**1. List & filter (entity modifiers + paging):**

```
connectors(name="request", params={"connector":"greentree","method":"GET","url":"/01/Customer?isActive=true&page=1&pageSize=50"})
```

Up to 50 active customers; page with `&page=2`. `Customer` declares `isActive`, `emailAddress`, `modifiedSince`, `treeName`/`treeBranch`.

**2. Get by identifier (full record):**

```
connectors(name="request", params={"connector":"greentree","method":"GET","url":"/01/Customer/CUST1234"})
```

Path identifier is the **human key** (`Code` here), NOT the `OidString`. Resolve a name → `Code` via a list GET first. Same shape for `/01/GLAccount/1000`, `/01/StockItem/{Code}`, `/01/ARInvoice/{Reference}`, `/01/SOSalesOrder/{Reference}`, `/01/JCJob/{Code}`.

**3. Include related collections (opt-in):**

```
connectors(name="request", params={"connector":"greentree","method":"GET","url":"/01/StockItem/00AOPEN17MONITOR?includeAttachments=true&includeStickyNotes=true"})
```

Each `include*` toggle adds a sub-collection:

- `includeAttachments=true` → Attachments[] (Name, FileName, FileSize, Type, OidString)
- `includeStickyNotes=true` → StickyNotes[] (Type, Note, IsActive) — `stickyNoteType=` to filter
- `includeApprovals=true` → Approvals[] (Status, Approvers[])
- `includeLinkedObjects=true` → LinkedObjects[] (2020+)
- `includePluginProperties=true` → PlugInProperties (2020+)
  > Confidential/inactive Sticky Notes are NOT returned via the API.

**4. Changed-since (incremental reads / polling):** `modifiedSince` is the universal change filter:

```
connectors(name="request", params={"connector":"greentree","method":"GET","url":"/01/Customer?modifiedSince=2026-06-09T22:00:00&isActive=true&page=1&pageSize=100"})
```

Standard incremental-sync pattern — see `01d`. ISO8601, server-local, no timezone offset.

**5. Sorting (version-gated, 2021+):**

```
connectors(name="request", params={"connector":"greentree","method":"GET","url":"/01/ARInvoice?customer=CUST1234&sortBy1=documentDate&sortDesc1=true&page=1&pageSize=25"})
```

`sortBy{n}` takes a property name; `sortDesc{n}=true` reverses it. Chain multiple (`sortBy1=...&sortBy2=...&sortDesc2=true`) and sort by reference props (`sortBy1=myCustomer.code`). Started on `ARInvoice` (2021 preview), rolls through other entities — don't assume it works on every entity or older instances.

**6. Global Search (2020.1+):**

```
connectors(name="request", params={"connector":"greentree","method":"GET","url":"/01/Customer?globalSearch=041"})
```

Runs Greentree's configured Global Search across configured columns — useful when you don't know which field holds the value. NOT a substitute for precise modifiers when you DO know the field.

**7. Stock price calc (action read):**

```
connectors(name="request", params={"connector":"greentree","method":"GET","url":"/01/StockItem/00AOPEN17MONITOR?action=sellingPrice&customer=CUST1234&quantity=10&priceLevel=Retail&taxInclusive=true"})
```

`action=sellingPrice` computes the price for a customer/quantity/level/date/location context — a read-only action GET. Add `tracePriceSteps=true` to see how the price was derived.

**8. Lookup/reference tables:** plain list GETs — `/01/SOStatusDefinition`, `/01/POStatusDefinition`, `/01/JCStatus`, `/01/UTTaxCode`, `/01/UTCurrencyCode`, `/01/UTPaymentTerm`, `/01/Branch`, `/01/ProfitCentre`, `/01/INLocation`. Cheap; fetch once and cache in-conversation.

## Pagination

- **Type:** page-number — `page` (1-based) + `pageSize`.
- **Hard cap:** 100 records per list GET. A `pageSize` above 100 is clamped to 100 [UNVERIFIED exact behavior; docs state the 100 cap].
- **Default page size:** omitted → 100 (page 1). Always pass `page` when paging.
- **No total count** documented — can't know page count up front.

Loop:

```
GET /01/SOSalesOrder?status=Entered&page=1&pageSize=50   → 50 rows
GET /01/SOSalesOrder?status=Entered&page=2&pageSize=50   → 50 rows
GET /01/SOSalesOrder?status=Entered&page=3&pageSize=50   → 17 rows  ← short page = last
```

Overview states: "continue to increment `page` after each call, until the resulting packet returns less than `pageSize` entities."

Agent defaults: `pageSize=50` for display lists, up to `100` for programmatic scans (the cap). Always pass `page` explicitly; treat `< pageSize` (or empty) as last page. Narrow with the entity's modifiers BEFORE paging (server-side filtering beats walking thousands of rows). If sorting is available (2021+), set a `sortBy1` for stable paging; otherwise page order is not guaranteed stable [UNVERIFIED].

## Worked examples (built from documented routes + modifiers; response shapes illustrative [UNVERIFIED]; company `01`)

**1. A customer's outstanding invoices, newest first:**

```
GET /01/ARInvoice?customer=CUST1234&outstandingOnly=true&sortBy1=documentDate&sortDesc1=true&page=1&pageSize=25
```

`customer`+`outstandingOnly` are `ARInvoice`-specific; `sortBy1`/`sortDesc1` need 2021.1+ (on older instances drop the sort, sort client-side). Each row: `Reference`, `DocumentDate`, `NetAmount`, `TaxAmount`, `HoldCode`, `IsPrinted`, `LineItems`.

**2. Stock items at a location, slim list:**

```
GET /01/StockItem?stockingLocation=01.03&isActive=true&listOnly=true&page=1&pageSize=100
```

`listOnly=true` returns just `Code`+`Description` (cheap scan); drop it for full records (`QuantityOnHand`/`Available`/`Committed`, prices, locations). `stockingLocation` filters to a warehouse/bin (`01.03` = dotted location code).

**3. Open jobs for an account manager:**

```
GET /01/JCJob?accountManager=JSMITH&excludeClosed=true&excludeFinalised=true&includeSubJobs=true&page=1&pageSize=50
```

`excludeClosed`/`excludeFinalised` key off `IsClosed`/`IsFinalised`; `includeSubJobs` walks the hierarchy. Returns `Code`, `Name`, `Customer`, `Status`, `Value`, `StartDate`, `ExpectedEndDate`, `JobManager`.

**4. GL accounts with opening balances for a fiscal year:**

```
GET /01/GLAccount?accountType=Income&includeOpeningBalance=2014/2015&page=1&pageSize=100
```

`accountType` filters the chart; `includeOpeningBalance={fiscalYear}` grafts the opening balance per account for that year. `IsPosting=true` distinguishes postable accounts from headings.

## Gotchas (recap — all detailed above)

No generic field filtering (only declared modifiers filter server-side; `?SomeRandomField=x` does nothing); company code in the path on every list GET (`/01/Customer?...`, never `?company=01`); 100-record hard cap (always page); no total count (detect last page by a short page); sorting version-gated + per-entity (verify before relying; otherwise page order not stable); path identifier = human key not OidString; `include*` off by default (opt in only when needed); confidential/inactive Sticky Notes never returned (don't promise "all notes"); user permissions filter results ("missing" = a Greentree-role gap, not a query bug); version-gated modifiers may be ignored on older instances.

> **Action GETs are still GETs but DO things** — `action=sellingPrice` is read-only, but state-changing action GETs exist on other entities; never sweep `action=` URLs blindly.

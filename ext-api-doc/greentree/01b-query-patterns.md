---
api_name: 'MYOB Greentree'
api_slug: 'greentree'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-06-11'
update_source: 'MYOB Greentree official docs (api-overview paging/modifiers + per-entity api-documentation pages) — NO live testing'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# MYOB Greentree -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Covers list/filter/sort/page reads, the entity-specific
> modifier model, and worked examples.

> ⚠️ **Docs-derived — NOT yet live-validated through the Numa connector path.** Everything here
> is from MYOB Greentree's official docs [DOCS]; inferences are [UNVERIFIED]. Expect per-customer
> differences: Greentree version gates whole entities and individual modifiers, and the
> authenticated user's permissions filter every result.

> **Auth note:** Examples use the Numa request form with bare relative paths that START WITH THE
> COMPANY CODE (`/01/...`). The Numa backend injects the site `ApiKey` header and the user's
> Greentree Basic-auth login, and expands the relative URL against the admin-configured instance
> URL. Never set auth headers; never use an absolute URL; always include the company code.

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/Customer?page=1&pageSize=50",
  "method": "GET"
})
```

---

## Query Capabilities Summary

| Capability                 | Supported    | Syntax                                            | Notes                                                              |
| -------------------------- | ------------ | ------------------------------------------------- | ------------------------------------------------------------------ |
| Filter by field value      | Per-entity   | `?customer=CUST1234`, `?status=Entered`           | NOT generic — each entity declares its OWN modifiers [DOCS]        |
| Filter by changed-since    | Yes (universal) | `?modifiedSince=2013-02-28T16:45:00`           | Present on essentially every entity [DOCS]                         |
| Filter by string pattern   | No (generic) | —                                                 | No `Contains`/`StartsWith` operators; use specific modifiers or globalSearch |
| Global search              | Yes (2020.1+)| `?globalSearch=041`                               | Runs Greentree's configured Global Search across columns [DOCS]    |
| Filter by tree/branch      | Many entities| `?treeName=Colour-AUS&treeBranch=Blue`            | Org-structure filtering [DOCS]                                     |
| Sort by field              | 2021+ rollout| `?sortBy1=orderNumber&sortDesc1=true`             | Per-entity rollout; started on ARInvoice [DOCS]                    |
| Field trimming             | Limited      | `?listOnly=true` (StockItem)                      | A few entities offer a slim list mode; no generic `Fields=` [DOCS] |
| Include related collections| Yes (opt-in) | `?includeAttachments=true`, `?includeStickyNotes=true`, `?includeApprovals=true`, `?includeLinkedObjects=true`, `?includePluginProperties=true` | Off by default [DOCS] |
| Aggregation / count        | No           | —                                                 | No total-count field documented [UNVERIFIED]                       |
| Logical OR across filters  | No           | —                                                 | Multiple modifiers AND; no OR construct [UNVERIFIED]               |
| Pagination                 | Yes          | `?page=1&pageSize=50`                              | 100-record hard cap per list GET [DOCS]                            |

---

## The Filter Model: Per-Entity Modifiers (NOT a generic query grammar)

Unlike AutoQuery-style APIs, Greentree does **not** expose a uniform "every column is filterable
with operators" grammar. Instead, **each entity's docs page declares a fixed set of supported
query modifiers** [DOCS]. There are two tiers:

1. **Common modifiers** (shared across most entities):
   - `modifiedSince` — changed-since filter (ISO8601, server-local) — the universal one [DOCS]
   - `treeName` + `treeBranch` — filter by org-tree membership [DOCS]
   - `respectAdvancedSecurityForUser={user}` — apply that user's advanced-security filtering [DOCS]
   - the `include*` collection toggles (Attachments, StickyNotes, Approvals, LinkedObjects, PluginProperties) [DOCS]
   - `globalSearch` — Global Search match (2020.1+) [DOCS]
   - `sortBy{n}` / `sortDesc{n}` — sorting (2021+, per-entity rollout) [DOCS]

2. **Entity-specific modifiers** — declared per entity, e.g.:
   - `Customer`: `isActive`, `emailAddress`, `includeWebUsers` [DOCS]
   - `ARInvoice`: `customer`, `holdCode`, `outstandingOnly`, `postingDate` (2021.1+) [DOCS]
   - `Supplier`: `isActive`, `taxReference`, `status` [DOCS]
   - `StockItem`: `isActive`, `analysisCode`, `stockingLocation`, `listOnly`, `includeBarcodes`/`includeSerialLots`/`includeAliases` [DOCS]
   - `POPurchaseOrder`: `supplier`, `status` (pipe-list 2021.1+), `branch` (2017.1+), `canBeApprovedByUser` (2019.1+) [DOCS]
   - `SOSalesOrder`: `customer`, `status`, `salesPerson`, `branch`, `customerOrderNumber` [DOCS]
   - `JCJob`: `customer`, `jobManager`, `accountManager`, `parentJob`, `jobType`, `excludeClosed`, `excludeFinalised`, `includeSubJobs`, `isOpen`, `profitCentre` [DOCS]
   - `GLAccount`: `accountType`, `includeTransactionTrees`, `includeOpeningBalance={fiscalYear}` [DOCS]

> **Consequence:** before filtering an entity, look up its supported modifiers on the docs page
> (or in `01a`). An unsupported param is silently ignored or errors depending on version
> [UNVERIFIED]. **There is no `?AnyField=value` fallthrough** — `?Name=Acme` on Customer is not a
> documented filter; use `globalSearch` or fetch + filter client-side.

**Combining filters:** multiple modifiers AND together [UNVERIFIED — standard expectation]. No OR
construct exists.

**Modifier values:** URL-encode spaces and special chars (e.g. `respectAdvancedSecurityForUser=Susan%20Smith`).

---

## Response Shape

A list GET returns up to `pageSize` (max 100) records of the entity. A single GET
(`/{entity}/{identifier}`) returns one full record. The docs show **XML sample responses**;
through the Numa connector you get **JSON** (Accept negotiation). [DOCS]

- No envelope/`total`/`offset` metadata is documented — the response is the record array (list)
  or the record object (single). Detect the end of a list by a short/empty page. [UNVERIFIED — no
  total-count field]
- `include*` toggles graft extra collections onto each returned record (e.g.
  `Attachments collection='true' count='2'`). Off by default to keep payloads small. [DOCS]

---

## The Two Read Surfaces

1. **List GET** — `/{company}/{entity}` (+ modifiers + paging). Returns many records. **This is
   the right surface for "find / list / report" questions.** Use the entity's specific modifiers
   to narrow server-side; page with `page`/`pageSize`.
2. **Single GET by identifier** — `/{company}/{entity}/{identifier}`. Returns the full record
   (and, with `include*`, its sub-collections). Use when you already have the human key and need
   the whole object. [DOCS]

When you only have a name/email and need the record, resolve to the key first via a list GET with
the matching modifier (`?emailAddress=`, `?customer=`, `?globalSearch=`), then read by identifier.

---

## Common Patterns

### Pattern 1: List & filter (entity modifiers + paging)

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/Customer?isActive=true&page=1&pageSize=50",
  "method": "GET"
})
```

Returns up to 50 active customers. Page with `&page=2`. `Customer` declares `isActive`,
`emailAddress`, `modifiedSince`, `treeName`/`treeBranch`. [DOCS]

### Pattern 2: Get by identifier (full record)

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/Customer/CUST1234",
  "method": "GET"
})
```

- The path identifier is the **human key** (`Code` here), NOT the `OidString`. Resolve a name →
  `Code` via a list GET first if you only have the name. [DOCS]
- Same shape for `/01/GLAccount/1000`, `/01/StockItem/{Code}`, `/01/ARInvoice/{Reference}`,
  `/01/SOSalesOrder/{Reference}`, `/01/JCJob/{Code}`. [DOCS]

### Pattern 3: Include related collections (opt-in)

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/StockItem/00AOPEN17MONITOR?includeAttachments=true&includeStickyNotes=true",
  "method": "GET"
})
```

Each `include*` toggle adds a sub-collection to the response [DOCS]:

```
includeAttachments=true     → Attachments[] (Name, FileName, FileSize, Type, OidString)
includeStickyNotes=true     → StickyNotes[] (Type, Note, IsActive)   (stickyNoteType= to filter)
includeApprovals=true       → Approvals[] (Status, Approvers[])
includeLinkedObjects=true   → LinkedObjects[]      (2020+)
includePluginProperties=true→ PlugInProperties     (2020+)
```

> Confidential and inactive Sticky Notes are NOT returned via the API. [DOCS]

### Pattern 4: Changed-since (incremental reads / polling)

`modifiedSince` is the universal change filter — present on essentially every entity [DOCS]:

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/Customer?modifiedSince=2026-06-09T22:00:00&isActive=true&page=1&pageSize=100",
  "method": "GET"
})
```

This is the standard incremental-sync pattern — see `01d-event-and-error-handling.md`. ISO8601,
server-local time, no timezone offset (`2013-02-28T16:45:00`). [DOCS]

### Pattern 5: Sorting (version-gated, 2021+)

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/ARInvoice?customer=CUST1234&sortBy1=documentDate&sortDesc1=true&page=1&pageSize=25",
  "method": "GET"
})
```

- `sortBy{n}` takes a property name; `sortDesc{n}=true` reverses that key. You can chain multiple
  (`sortBy1=...&sortBy2=...&sortDesc2=true`) and sort by reference properties (e.g.
  `sortBy1=myCustomer.code`). [DOCS]
- Sorting started on `ARInvoice` (2021 preview) and rolls through other entities — **don't assume
  it works on every entity or on older instances.** [DOCS]

### Pattern 6: Global Search (2020.1+)

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/Customer?globalSearch=041",
  "method": "GET"
})
```

Runs Greentree's configured Global Search and returns matches across the configured columns —
useful when you don't know which field holds the value. NOT a substitute for precise modifiers
(`customer=`, `status=`) when you DO know the field. [DOCS]

### Pattern 7: Stock price calc (action read)

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/StockItem/00AOPEN17MONITOR?action=sellingPrice&customer=CUST1234&quantity=10&priceLevel=Retail&taxInclusive=true",
  "method": "GET"
})
```

`action=sellingPrice` computes the price for a customer/quantity/level/date/location context — a
read-only action GET. Add `tracePriceSteps=true` to see how the price was derived. [DOCS]

### Pattern 8: Lookup / reference tables

Reference data are plain list GETs: `/01/SOStatusDefinition`, `/01/POStatusDefinition`,
`/01/JCStatus`, `/01/UTTaxCode`, `/01/UTCurrencyCode`, `/01/UTPaymentTerm`, `/01/Branch`,
`/01/ProfitCentre`, `/01/INLocation`. Cheap; fetch once and cache in-conversation rather than
re-querying. [DOCS]

---

## Pagination Handling

### Model [DOCS]

- **Type:** page-number based — `page` (1-based) + `pageSize`.
- **Hard cap:** **100 records per list GET.** A `pageSize` above 100 is clamped to 100 [UNVERIFIED exact behavior — docs state the 100 cap].
- **Default page size:** `pageSize` omitted → 100 (page 1). Always pass `page` when paging.
- **No total count** is documented — you cannot know up front how many pages there are.

### Full Pagination Loop

```
Request 1: GET /01/SOSalesOrder?status=Entered&page=1&pageSize=50   → 50 rows
Request 2: GET /01/SOSalesOrder?status=Entered&page=2&pageSize=50   → 50 rows
Request 3: GET /01/SOSalesOrder?status=Entered&page=3&pageSize=50   → 17 rows  ← short page = last page
```

The overview states this exact flow: "continue to increment `page` after each call, until the
resulting packet returns less than `pageSize` entities." [DOCS]

### Recommended defaults for the agent

- `pageSize=50` for display lists, up to `pageSize=100` for programmatic scans (the cap).
- Always pass `page` explicitly; treat a page with `< pageSize` rows (or empty) as the last page.
- Narrow with the entity's modifiers BEFORE paging — server-side filtering beats walking
  thousands of rows 100 at a time. Use `modifiedSince` for "recent" questions.
- If sorting is available (2021+), set a `sortBy1` for stable, deterministic paging; otherwise
  page order is not guaranteed stable between requests [UNVERIFIED].

---

## Worked Examples

> URLs below are built from MYOB Greentree's documented routes + modifiers [DOCS]; response shapes
> are illustrative [UNVERIFIED]. None were executed live. Company `01` assumed.

### Example 1: A customer's outstanding invoices, newest first

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/ARInvoice?customer=CUST1234&outstandingOnly=true&sortBy1=documentDate&sortDesc1=true&page=1&pageSize=25",
  "method": "GET"
})
```

**Key points:**

- `customer` + `outstandingOnly` are `ARInvoice`-specific modifiers; `sortBy1`/`sortDesc1` need
  2021.1+. On an older instance, drop the sort params and sort client-side. [DOCS]
- Each row carries `Reference`, `DocumentDate`, `NetAmount`, `TaxAmount`, `HoldCode`, `IsPrinted`,
  and a `LineItems` collection. [DOCS]

### Example 2: Stock items at a location, slim list

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/StockItem?stockingLocation=01.03&isActive=true&listOnly=true&page=1&pageSize=100",
  "method": "GET"
})
```

**Key points:**

- `listOnly=true` returns just `Code` + `Description` — a cheap inventory scan. Drop it to get full
  records (`QuantityOnHand`/`Available`/`Committed`, prices, locations). [DOCS]
- `stockingLocation` filters to a warehouse/bin (`01.03` = a dotted location code). [DOCS]

### Example 3: Open jobs for an account manager

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/JCJob?accountManager=JSMITH&excludeClosed=true&excludeFinalised=true&includeSubJobs=true&page=1&pageSize=50",
  "method": "GET"
})
```

**Key points:**

- `excludeClosed`/`excludeFinalised` key off the `IsClosed`/`IsFinalised` flags; `includeSubJobs`
  walks the job hierarchy. [DOCS]
- Returns `Code`, `Name`, `Customer`, `Status`, `Value`, `StartDate`, `ExpectedEndDate`,
  `JobManager`. [DOCS]

### Example 4: GL accounts with opening balances for a fiscal year

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/GLAccount?accountType=Income&includeOpeningBalance=2014/2015&page=1&pageSize=100",
  "method": "GET"
})
```

**Key points:**

- `accountType` filters the chart; `includeOpeningBalance={fiscalYear}` grafts the opening balance
  onto each account for that year. [DOCS]
- `IsPosting=true` distinguishes postable accounts from headings. [DOCS]

---

## Gotchas & Counter-Exceptions

1. **No generic field filtering.** Only the entity's declared modifiers filter server-side
   (`?customer=`, `?status=`, `?modifiedSince=`…). `?SomeRandomField=x` does nothing useful. Look
   up the entity's modifier list first. [DOCS]
2. **The company code is in the path, on every list GET too.** `/01/Customer?...`, never
   `/Customer?company=01`. [DOCS]
3. **100-record hard cap.** Even a huge `pageSize` returns ≤ 100. Always page. [DOCS]
4. **No total count.** You can't size a result set up front — detect the last page by a short/empty
   page. [UNVERIFIED]
5. **Sorting is version-gated and per-entity.** `sortBy1` works on `ARInvoice` (2021+) and is
   rolling out elsewhere — verify before relying on it; without it, page order is not guaranteed
   stable. [DOCS]
6. **The path identifier is the human key, not OidString.** `/Customer/CUST1234`, not
   `/Customer/{OidString}`. [DOCS]
7. **`include*` collections are off by default.** A plain GET won't return attachments/notes/
   approvals — opt in explicitly, and only when needed (they enlarge the payload). [DOCS]
8. **Confidential/inactive Sticky Notes are never returned.** Don't promise the user "all notes" —
   the API filters these out. [DOCS]
9. **The user's Greentree permissions filter results.** "Missing" records often mean the
   authenticated user can't see them in Greentree — not a query bug. [DOCS]
10. **Version-gated modifiers.** Many params carry a minimum Greentree version (`postingDate`
    2021.1, `branch` on PO 2017.1, `includeWebUsers` post-2018.3…). On an older instance they may
    be ignored. [DOCS]
11. **Action GETs are still GETs but DO things** — `action=sellingPrice` (price calc) is read-only,
    but `GET /SalesOrders/.../Process`-style state-changing GETs exist in other entities; never
    sweep `action=` URLs blindly. [DOCS]

---

_Generated 2026-06-11 from MYOB Greentree's official API documentation (overview paging/modifier
sections + per-entity pages). Not yet validated against a live instance — verify modifier support
and version gates before first customer use._

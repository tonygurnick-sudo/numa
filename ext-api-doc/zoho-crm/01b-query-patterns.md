---
api_name: 'Zoho CRM'
api_slug: 'zoho-crm'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-04-23'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Zoho CRM -- Query Patterns Reference

> Read operations: list, search, get-by-id, related lists, date ranges, COQL, pagination.
> Companion to `01-llm-api-rules.md`.

---

## Query Capabilities Summary

| Capability              | Supported | Syntax / Where                                                                     | Notes                                    |
| ----------------------- | --------- | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| Filter by field value   | yes       | `/search?criteria=((Field:equals:Value))`                                          | Search endpoint, not list                |
| Filter by date range    | yes       | `/search?criteria=((Created_Time:between:d1,d2))`                                  | ISO 8601 w/ offset; URL-encode the `+`   |
| Full-text search        | yes       | `/search?word=Acme`                                                                | Per module only — no cross-module search |
| Sort by field           | yes       | `?sort_by=Modified_Time`                                                           | List endpoint                            |
| Sort direction          | yes       | `?sort_order=asc\|desc`                                                            | Default `desc`                           |
| Field selection         | yes (req) | `?fields=Last_Name,Email,Phone`                                                    | MANDATORY on list; max 50                |
| Include related records | partial   | `?include_child=true` on some endpoints                                            | Not universal — check per endpoint       |
| Aggregate / count       | partial   | Use COQL: `select count(Id) from Leads`                                            | Non-COQL count not available             |
| Logical AND / OR        | yes       | `((A)and(B))`, `((A)or(B))`                                                        | Nest with extra parens                   |
| Comparison operators    | yes       | `equals`, `not_equal`, `greater_than`, `less_than`, `between`, `starts_with`, `in` |                                          |
| Null checks             | partial   | `:equals:null` on some fields                                                      | Inconsistent across field types          |
| Regex / pattern         | no        | only `starts_with` for prefix                                                      |                                          |

---

## Common Patterns

### Pattern 1: List & Filter

List records with required field selection — filter server-side via `/search` instead of `/` when you need more than sort.

**Base list:**

```http
GET /crm/v8/Leads?fields=Last_Name,First_Name,Email,Phone,Company,Lead_Status,Owner&per_page=200&page=1
```

**Filter via search:**

```http
GET /crm/v8/Leads/search?criteria=((Lead_Status:equals:Contacted))&fields=Last_Name,Email,Phone&per_page=200
```

**Combining filters:**

```http
GET /crm/v8/Deals/search?criteria=((Stage:not_equal:Closed%20Lost)and(Amount:greater_than:10000))
```

Multiple filters are combined by explicit `and` / `or` keywords inside the criteria expression. Nesting is supported with extra parens.

---

### Pattern 2: Search

Zoho search is **per-module** — there's no global search endpoint.

**By single field (criteria):**

```http
GET /crm/v8/Contacts/search?criteria=((Last_Name:starts_with:Smi))&fields=Full_Name,Email,Phone
```

**By email (shortcut):**

```http
GET /crm/v8/Contacts/search?email=jane%40acme.example
```

**By phone (shortcut):**

```http
GET /crm/v8/Contacts/search?phone=%2B61390000000
```

**Full-text word search (global across the module's fields):**

```http
GET /crm/v8/Leads/search?word=Acme
```

- **Searchable fields:** most indexed text fields. Long textarea fields may not be indexed.
- **Fuzzy matching:** not supported — `starts_with` is the closest.
- **Minimum query length:** ≥1 non-whitespace char on `word`.
- **One param per call:** if you pass more than one of `criteria`/`email`/`phone`/`word`, only the highest-priority one is processed (criteria > email > phone > word).
- **Max retrievable:** 2000 records via search. Beyond that, use COQL.

---

### Pattern 3: Get by ID

```http
GET /crm/v8/Leads/410405000002264040
```

Response: single record wrapped in `data[0]`.

```http
GET /crm/v8/Leads/410405000002264040?fields=Last_Name,First_Name,Email,Phone
```

`fields` is optional here (unlike the list endpoint).

---

### Pattern 4: Related Records

Zoho exposes related lists as sub-resources on a record.

**Get all notes on a Deal:**

```http
GET /crm/v8/Deals/410405000002264100/Notes
```

**Get attachments on a Contact:**

```http
GET /crm/v8/Contacts/410405000002264050/Attachments
```

**Get all Deals for a specific Account (filter-by-parent):**

```http
GET /crm/v8/Deals/search?criteria=((Account_Name.name:equals:Acme))
```

Note the `.name` dotted path inside the criteria — that's the field on the lookup object.

---

### Pattern 5: Date Range Query

```http
GET /crm/v8/Tasks/search?criteria=((Due_Date:between:2026-04-21,2026-04-27))
```

**Date format:** `YYYY-MM-DD`.
**DateTime:** ISO 8601 with offset. URL-encode `+` as `%2B`.

```http
GET /crm/v8/Leads/search?criteria=((Modified_Time:between:2026-04-23T00:00:00%2B10:00,2026-04-23T23:59:59%2B10:00))
```

**Common date fields:** `Created_Time`, `Modified_Time` (all modules), `Closing_Date` (Deals), `Due_Date` (Tasks), `Last_Activity_Time`.

---

### Pattern 6: Aggregation / Count

No count endpoint on list — use COQL:

```http
POST /crm/v8/coql
Content-Type: application/json

{ "select_query": "select count(Id) from Leads where Lead_Status = 'Contacted'" }
```

Response:

```json
{ "data": [{ "count": 147 }], "info": { "count": 1, "more_records": false } }
```

Group-by also supported:

```json
{ "select_query": "select Stage, count(Id) from Deals where Stage not in ('Closed Won','Closed Lost') group by Stage" }
```

---

## Pagination Handling

### Model

- **Type:** hybrid — offset-based up to record 2000, then cursor-based.
- **Default page size:** 200.
- **Max page size:** 200.
- **Total count available:** per-page only via `info.count`. Use COQL `count(Id)` for a true global total.

### Request Parameters

| Parameter    | Type   | Default | Description                                                                           |
| ------------ | ------ | ------- | ------------------------------------------------------------------------------------- |
| `page`       | int    | 1       | 1-based. Mutually exclusive with `page_token`.                                        |
| `per_page`   | int    | 200     | Max 200.                                                                              |
| `page_token` | string | —       | Use instead of `page` once you've hit record 2000. Comes from `info.next_page_token`. |
| `sort_by`    | string | `id`    | Single field.                                                                         |
| `sort_order` | enum   | `desc`  | `asc` or `desc`.                                                                      |

### Response Structure

```json
{
  "data": [{ "id": "…" }],
  "info": {
    "per_page": 200,
    "count": 200,
    "page": 1,
    "more_records": true,
    "next_page_token": null,
    "sort_by": "Modified_Time",
    "sort_order": "desc"
  }
}
```

### Last Page Detection

`info.more_records === false`. On the last page `next_page_token` is `null` AND `more_records` is `false`. An HTTP 204 also signals zero results.

### Full Pagination Loop

```
# Phase A — offset pagination (records 1–2000)
GET /crm/v8/Leads?fields=id,Email&per_page=200&page=1
→ info.more_records=true, info.next_page_token=null

GET /crm/v8/Leads?fields=id,Email&per_page=200&page=2
→ info.more_records=true, info.next_page_token=null

… (up to page=10, records 1801–2000)

# Phase B — cursor pagination (records 2001+). At page 10 the response carries a token.
GET /crm/v8/Leads?fields=id,Email&per_page=200&page=10
→ info.more_records=true, info.next_page_token="eyJpZCI6...4MH0="

GET /crm/v8/Leads?fields=id,Email&per_page=200&page_token=eyJpZCI6...4MH0=
→ info.more_records=true, info.next_page_token="eyJpZCI6...9MH0="

…until info.more_records=false.
```

**Do not combine `page` and `page_token`** — the API returns 400.

---

## COQL Queries

For anything the `/search` endpoint can't express — joins, aggregates, complex filters, >2000 record extracts.

### Syntax

```sql
select {field_list}
from {module}
[where {conditions}]
[group by {field}]
[order by {field} {asc|desc}]
[limit {n}]
[offset {m}]
```

### Request

```http
POST /crm/v8/coql
Content-Type: application/json

{ "select_query": "select Last_Name, Email, Company from Leads where Lead_Status = 'Contacted' order by Modified_Time desc limit 50" }
```

### Constraints

- Max 2000 records per call (use `limit` + `offset` to page).
- Max 2 joins per query.
- Field names are case-sensitive (use api_name).
- Scope required: `ZohoCRM.coql.READ`.

---

## Worked Examples

### Example 1: List Deals closing this quarter, sorted by amount

```http
GET /crm/v8/Deals/search?criteria=((Closing_Date:between:2026-04-01,2026-06-30)and(Stage:not_equal:Closed%20Lost)and(Stage:not_equal:Closed%20Won))&fields=Deal_Name,Amount,Stage,Closing_Date,Account_Name,Owner&sort_by=Amount&sort_order=desc&per_page=50
```

```json
{
  "data": [
    {
      "id": "410405000002264100",
      "Deal_Name": "Acme – Q2 renewal",
      "Amount": 45000,
      "Stage": "Negotiation/Review",
      "Closing_Date": "2026-06-30",
      "Account_Name": { "id": "…", "name": "Acme Pty Ltd" },
      "Owner": { "id": "…", "name": "Sarah Owner" }
    },
    {
      "id": "410405000002264101",
      "Deal_Name": "Initech – expansion",
      "Amount": 28000,
      "Stage": "Proposal/Price Quote",
      "Closing_Date": "2026-05-31",
      "Account_Name": { "id": "…", "name": "Initech" },
      "Owner": { "id": "…", "name": "Sarah Owner" }
    }
  ],
  "info": { "per_page": 50, "count": 2, "page": 1, "more_records": false }
}
```

**Key points:**

- Compound `and` criteria with URL-encoded spaces (`%20`) in values.
- Lookup fields return as nested `{id, name}` objects on read.
- Sort by `Amount` requires the field to be in `fields` or sortable — generally numeric fields are always sortable.

---

### Example 2: Find all open tasks for the current user, due this week

```http
POST /crm/v8/coql
{ "select_query": "select Subject, Status, Priority, Due_Date, What_Id from Tasks where Owner = 410405000000123456 and Status != 'Completed' and Due_Date between '2026-04-21' and '2026-04-27' order by Due_Date asc" }
```

```json
{
  "data": [
    {
      "id": "410405000002264200",
      "Subject": "Prep Acme proposal",
      "Status": "In Progress",
      "Priority": "High",
      "Due_Date": "2026-04-24",
      "What_Id": { "id": "410405000002264100", "name": "Acme – Q2 renewal", "module": "Deals" }
    }
  ],
  "info": { "count": 1, "more_records": false }
}
```

**Key points:**

- COQL is concise for "my stuff" queries — avoids URL-encoding hell.
- `What_Id` comes back as `{id, name, module}` — the `module` field tells you what parent entity to follow.
- Dates in COQL use single quotes and `YYYY-MM-DD`.

---

### Example 3: Full-text search for a company across Leads, Contacts, and Accounts

Zoho has no cross-module search, so fan out:

```http
GET /crm/v8/Leads/search?word=Acme&fields=Last_Name,Email,Company,Owner
GET /crm/v8/Contacts/search?word=Acme&fields=Full_Name,Email,Account_Name,Owner
GET /crm/v8/Accounts/search?word=Acme&fields=Account_Name,Phone,Website,Owner
```

Merge results client-side, label each by source module.

**Key points:**

- Three concurrent requests OK — stays inside the 15-concurrent limit on Professional plans and below.
- `word` is a looser match than `criteria` with `equals` — good for "find anything about Acme".

---

## Gotchas & Counter-Exceptions

1. **`fields` on list is mandatory but on get-by-id it's optional.** Forgetting it on list returns 400 `REQUIRED_PARAM_MISSING`.
2. **Search silently drops extra params.** If you pass both `criteria` and `word`, only `criteria` is used — the `word` is dropped without warning.
3. **`starts_with` is not case-sensitive** but `equals` IS case-sensitive. Mismatched case on picklist values will silently return zero results.
4. **Search max 2000.** Hitting record 2001 via search just returns nothing; switch to COQL or bulk read.
5. **`info.count` is per-page, not total.** Never add it up across pages to get a total — use COQL `count(Id)`.
6. **Spaces in picklist values need URL-encoding** in criteria: `Lead_Status:equals:Not%20Contacted`.
7. **Lookup field comparisons need `.name` or `.id`** — `Account_Name:equals:Acme` won't work; use `Account_Name.name:equals:Acme` or `Account_Name:equals:410405000000123456`.
8. **COQL requires explicit `order by`** for stable pagination with `offset`. Without it, records may appear on multiple pages or be missed.

---

_Generated from `00-api-investigation-questionnaire.md` Phases 5–6._

---
api_name: Zoho CRM
api_slug: zoho-crm
doc: query patterns — list, search, get-by-id, related lists, date ranges, COQL, pagination
base_url: https://{api_domain}/crm/v8 (region-pinned; see 01)
call_surface: HTTP via `numa integrations request`
confidence: verified 2026-04-23 unless tagged
companion_of: 01-llm-api-rules.md
---

# Zoho CRM — Query Patterns

## Capabilities

| Capability            | Supported              | Syntax / where                                                               | Notes                                       |
| --------------------- | ---------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| Filter by field value | yes                    | `/search?criteria=((Field:equals:Value))`                                    | search endpoint, not list                   |
| Filter by date range  | yes                    | `/search?criteria=((Created_Time:between:d1,d2))`                            | ISO 8601 w/ offset; URL-encode `+` as `%2B` |
| Full-text search      | yes                    | `/search?word=Acme`                                                          | per-module only — no cross-module           |
| Sort by field         | yes                    | `?sort_by=Modified_Time`                                                     | list endpoint                               |
| Sort direction        | yes                    | `?sort_order=asc\|desc`                                                      | default `desc`                              |
| Field selection       | yes (REQUIRED on list) | `?fields=Last_Name,Email,Phone`                                              | max 50                                      |
| Include related       | partial                | `?include_child=true` on some endpoints                                      | check per endpoint                          |
| Aggregate / count     | via COQL               | `select count(Id) from Leads`                                                | no non-COQL count                           |
| Logical AND/OR        | yes                    | `((A)and(B))`,`((A)or(B))`                                                   | nest with extra parens                      |
| Comparison ops        | yes                    | `equals`,`not_equal`,`greater_than`,`less_than`,`between`,`starts_with`,`in` |                                             |
| Null checks           | partial                | `:equals:null` on some fields                                                | inconsistent across types                   |
| Regex / pattern       | no                     | only `starts_with` (prefix)                                                  |                                             |

## Patterns

### List & filter

Base list (field selection mandatory): `GET /crm/v8/Leads?fields=Last_Name,First_Name,Email,Phone,Company,Lead_Status,Owner&per_page=200&page=1`
Filter server-side via `/search` when you need more than sort:
`GET /crm/v8/Leads/search?criteria=((Lead_Status:equals:Contacted))&fields=Last_Name,Email,Phone&per_page=200`
Combine with `and`/`or` + nested parens: `GET /crm/v8/Deals/search?criteria=((Stage:not_equal:Closed%20Lost)and(Amount:greater_than:10000))`

### Search (per-module — no global search endpoint)

- Criteria: `GET /crm/v8/Contacts/search?criteria=((Last_Name:starts_with:Smi))&fields=Full_Name,Email,Phone`
- Email shortcut: `GET /crm/v8/Contacts/search?email=jane%40acme.example`
- Phone shortcut: `GET /crm/v8/Contacts/search?phone=%2B61390000000`
- Word (full-text across module fields): `GET /crm/v8/Leads/search?word=Acme`
- Searchable: most indexed text fields (long textareas may not be indexed). Fuzzy: not supported (`starts_with` is closest). `word` min ≥1 non-whitespace char.
- One param/call: passing >1 of `criteria`/`email`/`phone`/`word` → only highest-priority processed (criteria>email>phone>word).
- Max 2000 rows via search → use COQL beyond.

### Get by ID

`GET /crm/v8/Leads/410405000002264040` → single record in `data[0]`. `fields` optional here (unlike list): `GET /crm/v8/Leads/410405000002264040?fields=Last_Name,First_Name,Email,Phone`.

### Related records (sub-resources on a record)

- Notes on a Deal: `GET /crm/v8/Deals/410405000002264100/Notes`
- Attachments on a Contact: `GET /crm/v8/Contacts/410405000002264050/Attachments`
- Deals for an Account (filter-by-parent): `GET /crm/v8/Deals/search?criteria=((Account_Name.name:equals:Acme))` — note the `.name` dotted path = the field on the lookup object.

### Date range

`GET /crm/v8/Tasks/search?criteria=((Due_Date:between:2026-04-21,2026-04-27))`. Date = `YYYY-MM-DD`. DateTime = ISO 8601 w/ offset, URL-encode `+` as `%2B`:
`GET /crm/v8/Leads/search?criteria=((Modified_Time:between:2026-04-23T00:00:00%2B10:00,2026-04-23T23:59:59%2B10:00))`
Common date fields: `Created_Time`,`Modified_Time` (all modules), `Closing_Date` (Deals), `Due_Date` (Tasks), `Last_Activity_Time`.

### Aggregation / count (COQL — no list count endpoint)

`POST /crm/v8/coql` `{"select_query":"select count(Id) from Leads where Lead_Status = 'Contacted'"}` → `{"data":[{"count":147}],"info":{"count":1,"more_records":false}}`
Group-by: `{"select_query":"select Stage, count(Id) from Deals where Stage not in ('Closed Won','Closed Lost') group by Stage"}`

## Pagination

Hybrid — offset to record 2000, then cursor. Default+max `per_page=200`. Total count: per-page only via `info.count`; global total via COQL `count(Id)`.

| Param        | Type   | Default | Notes                                                                                                                                                                                                         |
| ------------ | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`       | int    | 1       | 1-based; mutually exclusive with `page_token`                                                                                                                                                                 |
| `per_page`   | int    | 200     | max 200                                                                                                                                                                                                       |
| `page_token` | string | —       | from `info.next_page_token`; use once past record 2000. Cursor chain caps at 100,000 total; each token expires 24h after issue. `previous_page_token` also returned. [VERIFIED 2026-05-19 — get-records.html] |
| `sort_by`    | string | `id`    | single field                                                                                                                                                                                                  |
| `sort_order` | enum   | `desc`  | `asc`/`desc`                                                                                                                                                                                                  |

Response: `{"data":[{"id":"…"}],"info":{"per_page":200,"count":200,"page":1,"more_records":true,"next_page_token":null,"sort_by":"Modified_Time","sort_order":"desc"}}`

Last page: `info.more_records === false` (and `next_page_token` null). HTTP 204 = zero results.

Full loop:

```
# Phase A — offset (records 1–2000)
GET /crm/v8/Leads?fields=id,Email&per_page=200&page=1   → more_records=true, next_page_token=null
GET /crm/v8/Leads?fields=id,Email&per_page=200&page=2   → more_records=true, next_page_token=null
… (up to page=10, records 1801–2000)
# Phase B — cursor (records 2001+); at page 10 the response carries a token
GET /crm/v8/Leads?fields=id,Email&per_page=200&page=10                  → next_page_token="eyJ...4MH0="
GET /crm/v8/Leads?fields=id,Email&per_page=200&page_token=eyJ...4MH0=   → next_page_token="eyJ...9MH0="
…until more_records=false
```

Do NOT combine `page` and `page_token` → 400.

## COQL

For anything `/search` can't express — joins, aggregates, complex filters, >2000-record extracts.
Syntax: `select {fields} from {module} [where {conditions}] [group by {field}] [order by {field} {asc|desc}] [limit {n}] [offset {m}]`
Request: `POST /crm/v8/coql` `{"select_query":"select Last_Name, Email, Company from Leads where Lead_Status = 'Contacted' order by Modified_Time desc limit 50"}`
Constraints: max 2000 records/call (page with `limit`+`offset`); max 2 joins/query; field names case-sensitive (api_name); scope `ZohoCRM.coql.READ` required.

## Worked Examples

### 1. Deals closing this quarter, by amount

`GET /crm/v8/Deals/search?criteria=((Closing_Date:between:2026-04-01,2026-06-30)and(Stage:not_equal:Closed%20Lost)and(Stage:not_equal:Closed%20Won))&fields=Deal_Name,Amount,Stage,Closing_Date,Account_Name,Owner&sort_by=Amount&sort_order=desc&per_page=50`
→ `{"data":[{"id":"410405000002264100","Deal_Name":"Acme – Q2 renewal","Amount":45000,"Stage":"Negotiation/Review","Closing_Date":"2026-06-30","Account_Name":{"id":"…","name":"Acme Pty Ltd"},"Owner":{"id":"…","name":"Sarah Owner"}},{"id":"410405000002264101","Deal_Name":"Initech – expansion","Amount":28000,"Stage":"Proposal/Price Quote","Closing_Date":"2026-05-31","Account_Name":{"id":"…","name":"Initech"},"Owner":{"id":"…","name":"Sarah Owner"}}],"info":{"per_page":50,"count":2,"page":1,"more_records":false}}`
Notes: compound `and` criteria with URL-encoded spaces (`%20`) in values; lookup fields return nested `{id,name}` on read; numeric fields always sortable.

### 2. Open tasks for current user, due this week (COQL)

`POST /crm/v8/coql` `{"select_query":"select Subject, Status, Priority, Due_Date, What_Id from Tasks where Owner = 410405000000123456 and Status != 'Completed' and Due_Date between '2026-04-21' and '2026-04-27' order by Due_Date asc"}`
→ `{"data":[{"id":"410405000002264200","Subject":"Prep Acme proposal","Status":"In Progress","Priority":"High","Due_Date":"2026-04-24","What_Id":{"id":"410405000002264100","name":"Acme – Q2 renewal","module":"Deals"}}],"info":{"count":1,"more_records":false}}`
Notes: COQL avoids URL-encoding hell for "my stuff" queries; `What_Id` returns `{id,name,module}` — `module` tells you the parent entity; COQL dates use single quotes + `YYYY-MM-DD`.

### 3. Find a company across Leads, Contacts, Accounts (no cross-module search → fan out)

`GET /crm/v8/Leads/search?word=Acme&fields=Last_Name,Email,Company,Owner`
`GET /crm/v8/Contacts/search?word=Acme&fields=Full_Name,Email,Account_Name,Owner`
`GET /crm/v8/Accounts/search?word=Acme&fields=Account_Name,Phone,Website,Owner`
Merge client-side, label by source module. Notes: 3 concurrent OK (within 15-concurrent limit on Professional+); `word` is a looser match than `criteria:equals` — good for "find anything about Acme".

## Gotchas

1. `fields` mandatory on list (omit → 400 `REQUIRED_PARAM_MISSING`), optional on get-by-id.
2. Search silently drops extra params — both `criteria`+`word` → only `criteria` used, `word` dropped.
3. `starts_with` is case-INsensitive; `equals` IS case-sensitive — wrong case on picklist values → silently zero results.
4. Search max 2000 — record 2001 just returns nothing; switch to COQL or bulk read.
5. `info.count` is per-page, not total — never sum across pages; use COQL `count(Id)`.
6. Spaces in picklist values need URL-encoding in criteria: `Lead_Status:equals:Not%20Contacted`.
7. Lookup comparisons need `.name` or `.id` — `Account_Name:equals:Acme` won't work; use `Account_Name.name:equals:Acme` or `Account_Name:equals:410405000000123456`.
8. COQL needs explicit `order by` for stable `offset` pagination — without it records may repeat or be missed.

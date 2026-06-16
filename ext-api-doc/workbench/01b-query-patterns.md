---
api_name: Workbench International (ERP)
api_slug: workbench
doc: query patterns (read-side; companion to 01-llm-api-rules.md)
confidence: query-param family, pagination model, envelope shape are NOT public — everything here is [INFERRED] 🔬 unless tagged otherwise. Pull {instance_url}/swagger FIRST and replace these patterns with the real ones; when the live spec disagrees, it wins.
path_note: /api/v1 prefix is a placeholder — read the real prefix from the Swagger base path.
call_surface: HTTP via `numa integrations request`. Not a Files connector.
---

# Workbench International — Query Patterns

## Step 0 — Discover before you query

```
GET {instance_url}/swagger                      # Swagger UI
GET {instance_url}/swagger/v1/swagger.json       # raw OpenAPI spec [path 🔬]
```

From the spec capture, per resource: (1) real path + API prefix, (2) filter query-param names (`jobNo`? `jobId`? `fromDate`?), (3) pagination params (`page`/`pageSize`? `offset`/`limit`?), (4) response envelope (`items`/`data`, `totalCount`/`total`). Do not query a resource until you've read its Swagger entry.

## Query Capabilities (`[INFERRED]` 🔬)

| Capability                | Supported      | Syntax (assumed)              | Notes                            |
| ------------------------- | -------------- | ----------------------------- | -------------------------------- |
| Filter by id              | likely         | `/{resource}/{id}` or `?id=`  | —                                |
| Filter by job             | likely         | `?jobNo=` / `?jobId=`         | which key is real? 🔬            |
| Filter by date range      | likely         | `?fromDate=&toDate=`          | param names + date format 🔬     |
| Filter by status          | likely         | `?status=`                    | enum spelling 🔬                 |
| Filter by supplier/client | likely         | `?supplierId=` / `?clientId=` | —                                |
| Full-text search          | `[UNKNOWN]` 🔬 | —                             | not confirmed                    |
| Sort by field/direction   | `[UNKNOWN]` 🔬 | —                             | not confirmed                    |
| Field selection (sparse)  | `[UNKNOWN]` 🔬 | —                             | not confirmed                    |
| Include/expand related    | `[UNKNOWN]` 🔬 | e.g. job → transactions       | sub-resource path may serve this |
| Page size                 | likely         | `?pageSize=` / `?limit=`      | —                                |

General filter pattern (entirely `[INFERRED]`): `GET {instance_url}/api/v1/{resource}?jobNo=J-10042&fromDate=2026-01-01&pageSize=200`. Multiple filters assumed AND-combined; nested/OR `[UNKNOWN]` 🔬.

## Common Patterns

- **List & filter:** `GET /api/v1/jobs?status=Active&pageSize=200`
- **Get by id:** `GET /api/v1/jobs/{id}` — verify single-entity fetch is `/{resource}/{id}` vs extra segments (some ERPs differ) 🔬.
- **Get related (sub-resource):** `GET /api/v1/jobs/{id}/transactions?fromDate=2026-01-01&pageSize=200`, OR filter the flat collection: `GET /api/v1/transactions?jobNo=J-10042&pageSize=200`. Confirm which form the API exposes 🔬.
- **Date range:** `GET /api/v1/transactions?jobNo=J-10042&fromDate=2026-01-01&toDate=2026-03-31&pageSize=200`. Date format assumed ISO-8601 — some ERPs want `dd/mm/yyyy` 🔬.
- **Cost analysis (core use case)** — "what's been spent on job X by activity/GL?":
  1. Resolve the job → `GET /api/v1/jobs?jobNo=J-10042` (or `/jobs/{id}`).
  2. Pull its transactions → `GET /api/v1/jobs/{id}/transactions?pageSize=200` (paginate).
  3. For each tx, iterate `lines[]` (distribution), group by `line.activityCode` and `line.glAccount`, sum `line.amount` (+ tax).
     No documented server-side aggregation endpoint — sum client-side from distribution lines 🔬.

## Pagination

Type `[INFERRED]` 🔬 — likely `page`+`pageSize`, could be `offset`/`limit`. **Always send an explicit `pageSize`** (start 200; halve+retry if rejected/slow; max `[UNKNOWN]` 🔬). Total likely a `totalCount`/`total` field. Assumed envelope (field names 🔬): `{"items":[…],"totalCount":312,"page":1,"pageSize":50}`. Last page = `(page*pageSize) >= totalCount`, OR a short/empty `items[]`; if neither total nor a `next` indicator exists, stop when a page returns < `pageSize` items.

Defensive loop (adapts to either field naming):

```python
page = 1; all_rows = []
while True:
    body = GET(f"/api/v1/transactions?jobNo=J-10042&page={page}&pageSize=200").json()
    rows = body.get("items") or body.get("data") or []
    all_rows.extend(rows)
    total = body.get("totalCount") or body.get("total")
    if total is not None:
        if page * 200 >= total: break
    elif len(rows) < 200: break        # no total field → short page = done
    page += 1
```

No documented batch/bulk endpoints. Paginate one resource at a time; small delay between pages (rate limits unknown 🔬).

## Worked Examples (`[INFERRED]` 🔬)

1. **Find a job by number** — `GET /api/v1/jobs?jobNo=J-10042` → `{"items":[{"id":"10042","jobNo":"J-10042","name":"Riverside Bridge Upgrade","status":"Active","manager":"Aroha Ngata"}],"totalCount":1,"page":1,"pageSize":50}`
   - If `?jobNo=` is not a real filter, fall back to `/jobs/{id}` with the internal id, or page `/jobs` and match `jobNo` client-side 🔬.
   - Human `jobNo` ("J-10042") and internal `id` ("10042") may differ — capture both.

2. **Job cost transactions for a date range, with distribution** — `GET /api/v1/jobs/10042/transactions?fromDate=2026-01-01&toDate=2026-03-31&pageSize=200` → `{"items":[{"id":"TX-88231","type":"Purchase","date":"2026-03-14","amount":4200.0,"taxCode":"GST","taxAmount":630.0,"lines":[{"activityCode":"STEEL","glAccount":"6100","amount":4200.0,"tax":630.0}]},{"id":"TX-88407","type":"Time","date":"2026-03-15","amount":920.0,"taxAmount":0,"lines":[{"activityCode":"LABOUR","glAccount":"6000","amount":920.0,"tax":0}]}],"totalCount":47,"page":1,"pageSize":200}`
   - Distribution lives in `lines[]` — sum that for cost-by-activity/GL; don't rely on header `amount` alone.
   - `type` is the documented cost-transaction type — group by it for "cost by type".

3. **AP invoices for a supplier** — `GET /api/v1/creditors?supplierId=SUP-77&fromDate=2026-01-01&pageSize=100` → `{"items":[{"id":"AP-9001","supplierId":"SUP-77","invoiceNo":"INV-4471","date":"2026-02-20","total":12450.0,"status":"Approved","lines":[{"jobNo":"J-10042","activityCode":"SUBBIE","glAccount":"6300","amount":12450.0}]}],"totalCount":8,"page":1,"pageSize":100}`
   - AP invoice lines carry the **same distribution shape** (job/activity/GL) — that's how AP cost is allocated to jobs. `[DOCUMENTED]` concept.

## Gotchas

1. **`jobNo` vs `id`.** Human job number and internal numeric id can differ; a filter taking one may reject the other. Capture both 🔬.
2. **Date format may not be ISO.** A NZ/AU ERP may want `dd/mm/yyyy` on filters even if it returns ISO. If a date filter errors/returns nothing, try the alternate 🔬.
3. **Distribution is the data, not the header.** For any cost breakdown read `lines[]`; the header `amount` is the roll-up.
4. **Always send `pageSize`.** With an unknown default, omitting it can silently truncate and make totals look wrong.
5. **No confirmed full-text search.** Don't promise free-text search until the Swagger confirms a search param 🔬.

---
api_name: 'Workbench International (ERP)'
api_slug: 'workbench'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Workbench International — Query Patterns

> Read-side reference. Companion to `01-llm-api-rules.md`.
>
> ⚠️ **The query-parameter family, pagination model and envelope shape are NOT public.** Everything
> here is `[INFERRED]` 🔬 unless tagged otherwise. **Pull `{instance_url}/swagger` first** and replace
> these patterns with the real ones. When the live spec disagrees, the live spec wins.

---

## Step 0 — Discover before you query

```http
GET {instance_url}/swagger                       # Swagger UI
GET {instance_url}/swagger/v1/swagger.json        # raw OpenAPI spec [path 🔬]
```

From the spec, capture, for every resource you need:

1. the **real path** (and the API prefix — `/api`, `/api/v1`, or other),
2. the **filter query-param names** (`jobNo`? `jobId`? `fromDate`?),
3. the **pagination params** (`page`/`pageSize`? `offset`/`limit`?),
4. the **response envelope** (`items`/`data`, `totalCount`/`total`).

Do not query a resource until you've read its Swagger entry.

---

## Query Capabilities Summary (`[INFERRED]` 🔬)

| Capability                | Supported   | Syntax (assumed)              | Notes                            |
| ------------------------- | ----------- | ----------------------------- | -------------------------------- |
| Filter by id              | likely      | `/{resource}/{id}` or `?id=`  | 🔬                               |
| Filter by job             | likely      | `?jobNo=` / `?jobId=`         | 🔬 which key is real?            |
| Filter by date range      | likely      | `?fromDate=&toDate=`          | 🔬 param names + date format     |
| Filter by status          | likely      | `?status=`                    | 🔬 enum spelling                 |
| Filter by supplier/client | likely      | `?supplierId=` / `?clientId=` | 🔬                               |
| Full-text search          | `[UNKNOWN]` | 🔬                            | Not confirmed                    |
| Sort by field / direction | `[UNKNOWN]` | 🔬                            | Not confirmed                    |
| Field selection (sparse)  | `[UNKNOWN]` | 🔬                            | Not confirmed                    |
| Include / expand related  | `[UNKNOWN]` | e.g. job → transactions       | Sub-resource path may serve this |
| Page size                 | likely      | `?pageSize=` / `?limit=`      | 🔬                               |

**General filter pattern (entirely `[INFERRED]` — confirm against Swagger):**

```
GET {instance_url}/api/v1/{resource}?jobNo=J-10042&fromDate=2026-01-01&pageSize=200
```

---

## Common Patterns

### Pattern 1 — List & filter

```http
GET /api/v1/jobs?status=Active&pageSize=200 HTTP/1.1
Authorization: Bearer <bearer_token>
Accept: application/json
```

- Multiple filters are assumed AND-combined. Nested/OR conditions: `[UNKNOWN]` 🔬.

### Pattern 2 — Get by id

```http
GET /api/v1/jobs/{id} HTTP/1.1
Authorization: Bearer <bearer_token>
```

> Verify whether single-entity fetch is `/{resource}/{id}` or requires extra path segments (some
> ERPs do). 🔬

### Pattern 3 — Get related records (sub-resource)

```http
GET /api/v1/jobs/{id}/transactions?fromDate=2026-01-01&pageSize=200
```

Or filter the flat collection by parent:

```http
GET /api/v1/transactions?jobNo=J-10042&pageSize=200
```

Confirm which form the API exposes (sub-resource vs `?jobNo=`). 🔬

### Pattern 4 — Date range query

```http
GET /api/v1/transactions?jobNo=J-10042&fromDate=2026-01-01&toDate=2026-03-31&pageSize=200
```

**Date format:** assumed ISO-8601 (`2026-01-01`). 🔬 — some ERPs want `dd/mm/yyyy`. Verify.

### Pattern 5 — Cost analysis (the core use case)

To answer "what's been spent on job X, by activity / GL account?":

```
1. Resolve the job → GET /api/v1/jobs?jobNo=J-10042   (or /jobs/{id})
2. Pull its transactions → GET /api/v1/jobs/{id}/transactions?pageSize=200 (paginate)
3. For each transaction, iterate lines[] (distribution) and group by
   line.activityCode and line.glAccount, summing line.amount (+ tax).
```

There is **no documented server-side aggregation** endpoint — sum client-side from distribution
lines. `[INFERRED]` 🔬

---

## Pagination

- **Type:** `[INFERRED]` 🔬 — likely page/offset (`page` + `pageSize`). Could be `offset`/`limit`. Confirm.
- **Default page size:** `[UNKNOWN]` 🔬 — **always send an explicit `pageSize`**; never rely on a default.
- **Max page size:** `[UNKNOWN]` 🔬 — start at 200; halve and retry if a request is rejected/slow.
- **Total count:** likely a `totalCount`/`total` field in the envelope. 🔬

### Assumed envelope (🔬 discover actual field names)

```json
{
  "items": [
    /* … */
  ],
  "totalCount": 312,
  "page": 1,
  "pageSize": 50
}
```

### Last-page detection

`(page * pageSize) >= totalCount`, OR a short/empty `items[]` page. If neither `totalCount` nor a
`next` indicator is present, stop when a page returns fewer than `pageSize` items. 🔬

### Full pagination loop (defensive — adapts to either field naming)

```python
page = 1
all_rows = []
while True:
    resp = GET(f"/api/v1/transactions?jobNo=J-10042&page={page}&pageSize=200")
    body = resp.json()
    rows = body.get("items") or body.get("data") or []
    all_rows.extend(rows)
    total = body.get("totalCount") or body.get("total")
    if total is not None:
        if page * 200 >= total:
            break
    elif len(rows) < 200:        # no total field → short page = done
        break
    page += 1
```

**Bulk reads:** No documented batch/bulk endpoints. Paginate one resource at a time; add a small
delay between pages (rate limits unknown). `[UNKNOWN]` 🔬

---

## Worked Examples

### Example 1: Find a job by number (`[INFERRED]` 🔬)

```http
GET /api/v1/jobs?jobNo=J-10042 HTTP/1.1
Authorization: Bearer <bearer_token>
Accept: application/json
```

```json
{
  "items": [
    {
      "id": "10042",
      "jobNo": "J-10042",
      "name": "Riverside Bridge Upgrade",
      "status": "Active",
      "manager": "Aroha Ngata"
    }
  ],
  "totalCount": 1,
  "page": 1,
  "pageSize": 50
}
```

**Key points:**

- If `?jobNo=` is not a real filter, fall back to `/jobs/{id}` with the internal id, or page `/jobs`
  and match `jobNo` client-side. 🔬
- The human `jobNo` ("J-10042") and the internal `id` ("10042") may differ — capture both.

### Example 2: Job cost transactions for a date range, with distribution (`[INFERRED]` 🔬)

```http
GET /api/v1/jobs/10042/transactions?fromDate=2026-01-01&toDate=2026-03-31&pageSize=200 HTTP/1.1
Authorization: Bearer <bearer_token>
Accept: application/json
```

```json
{
  "items": [
    {
      "id": "TX-88231",
      "type": "Purchase",
      "date": "2026-03-14",
      "amount": 4200.0,
      "taxCode": "GST",
      "taxAmount": 630.0,
      "lines": [{ "activityCode": "STEEL", "glAccount": "6100", "amount": 4200.0, "tax": 630.0 }]
    },
    {
      "id": "TX-88407",
      "type": "Time",
      "date": "2026-03-15",
      "amount": 920.0,
      "taxAmount": 0,
      "lines": [{ "activityCode": "LABOUR", "glAccount": "6000", "amount": 920.0, "tax": 0 }]
    }
  ],
  "totalCount": 47,
  "page": 1,
  "pageSize": 200
}
```

**Key points:**

- **Distribution lives in `lines[]`** — that's what you sum for cost-by-activity/GL. Don't rely on
  the top-level `amount` alone for breakdowns.
- `type` is the documented cost-transaction type (Time, Purchase, …) — group by it for "cost by type".

### Example 3: AP invoices for a supplier (`[INFERRED]` 🔬)

```http
GET /api/v1/creditors?supplierId=SUP-77&fromDate=2026-01-01&pageSize=100 HTTP/1.1
Authorization: Bearer <bearer_token>
Accept: application/json
```

```json
{
  "items": [
    {
      "id": "AP-9001",
      "supplierId": "SUP-77",
      "invoiceNo": "INV-4471",
      "date": "2026-02-20",
      "total": 12450.0,
      "status": "Approved",
      "lines": [{ "jobNo": "J-10042", "activityCode": "SUBBIE", "glAccount": "6300", "amount": 12450.0 }]
    }
  ],
  "totalCount": 8,
  "page": 1,
  "pageSize": 100
}
```

**Key points:**

- AP invoice lines carry the **same distribution shape** (job/activity/GL) — that's how AP cost is
  allocated to jobs. `[DOCUMENTED]` concept.

---

## Gotchas & Counter-Exceptions

1. **`jobNo` vs `id`.** The human job number and the internal numeric id can be different things. A
   filter that takes one may not accept the other. Capture both from list responses. 🔬
2. **Date format may not be ISO.** A NZ/AU ERP may expect `dd/mm/yyyy` on filters even if it returns
   ISO. If a date filter returns nothing or errors, try the alternate format. 🔬
3. **Distribution is the data, not the header.** For any cost breakdown, read `lines[]`. The
   transaction header `amount` is the roll-up, not the activity/GL detail.
4. **Always send `pageSize`.** With an unknown default, omitting it can silently truncate results to
   a small page and make totals look wrong.
5. **No confirmed full-text search.** Don't promise free-text search across jobs/transactions until
   the Swagger confirms a search param. 🔬

---

_Generated from the investigation questionnaire, Phases 5–6. Pagination and filter family are `[INFERRED]`/`[UNKNOWN]` pending Swagger discovery._

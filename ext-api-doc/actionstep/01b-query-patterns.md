---
api_name: Actionstep
api_slug: actionstep
companion_to: 01-llm-api-rules.md
role: read operations — listing, get-by-id, sideloading, pagination, filtering
call_surface: HTTP GET via `numa integrations request` to {api_endpoint}/api/rest/{resource}
confidence: doc-based 2026-05-27. Filter/sort/sideload PARAMETER NAMES are the largest doc gap — items tagged 🔬 must be confirmed against a live org. When in doubt, page through and filter client-side.
---

# Actionstep — Query Patterns

## Query Capabilities

| Capability                 | Supported  | Syntax                          | Notes                            |
| -------------------------- | ---------- | ------------------------------- | -------------------------------- |
| List a resource            | Yes        | `GET /api/rest/{resource}`      | Resource-keyed response          |
| Get by ID                  | Yes        | `GET /api/rest/{resource}/{id}` | Single keyed object              |
| Include related (sideload) | Yes        | `linked`/`links` in response    | JSON-API-style; request param 🔬 |
| Pagination                 | Yes        | `page`, `pageSize`              | Default 50, max 200              |
| Filter by field value      | Likely 🔬  | confirm                         | Not fully documented             |
| Filter by date range       | Likely 🔬  | confirm                         | Not fully documented             |
| Sort                       | Likely 🔬  | confirm                         | Not fully documented             |
| Full-text search           | Partial 🔬 | resource-specific               | Not fully documented             |

## Patterns

**1. List** — `GET {api_endpoint}/api/rest/actions?page=1&pageSize=50` (headers: `Authorization: Bearer <token>`, `Accept: application/vnd.api+json`). Response resource-keyed (array under a key named after the resource), with optional `links`/`linked` and `meta.paging`:
`{"actions":[{"id":123,"name":"Smith v Jones","status":"Active"}],"meta":{"paging":{"actions":{"recordCount":240,"pageCount":5,"page":1,"pageSize":50,"prevPage":null,"nextPage":2}}}}`

**2. Get by ID (sideloaded relations)** — `GET {api_endpoint}/api/rest/actions/123`:
`{"actions":{"id":123,"name":"Smith v Jones"},"linked":{"participants":[{"id":9,"displayName":"Jane Smith"}]},"links":{"actions.participants":{"href":"/api/rest/participants/{actions.participants}"}}}`
`links` = URI templates for related resources; `linked` = sideloaded records. Request param to _trigger_ sideloading (e.g. an `include`-style param) is 🔬.

**3. Get related records (filter by parent)** — `GET {api_endpoint}/api/rest/timeentries?action=123&pageSize=200`. 🔬 Confirm parent-filter spelling (`action` vs `action_id`) on a live org.

**4. Date range / filtering (UNCONFIRMED)** — Actionstep supports filtering but operator syntax isn't in public docs. Until confirmed: page through and filter in the agent/client. If confirming on a sandbox, test field-equality, comparison operators, and date ranges, then replace this with the verified syntax. 🔬

## Pagination

Page-number. Default size 50, **max 200** (`pageSize` hard cap). Total count via `meta.paging.{resource}.recordCount`/`.pageCount`.

| Param      | Type | Default | Description                |
| ---------- | ---- | ------- | -------------------------- |
| `page`     | int  | 1       | 1-based page number        |
| `pageSize` | int  | 50      | Records per page (max 200) |

Response: `{"actions":[...],"meta":{"paging":{"actions":{"recordCount":240,"pageCount":5,"page":1,"pageSize":50,"prevPage":null,"nextPage":2}}}}`. Last page when `meta.paging.{resource}.nextPage === null`.

Full loop:

```
page = 1
loop:
  GET /api/rest/{resource}?page={page}&pageSize=200
  process response[{resource}]
  next = response.meta.paging.{resource}.nextPage
  if next == null: stop
  page = next
```

## Worked Examples

1. **All active matters** — `GET {api_endpoint}/api/rest/actions?page=1&pageSize=200` → `{"actions":[{"id":123,"name":"Smith v Jones","status":"Active"}],"meta":{"paging":{"actions":{"recordCount":1,"pageCount":1,"page":1,"pageSize":200,"nextPage":null}}}}`. Read `meta.paging.actions` to know whether to fetch more; status filtering is client-side until server filter syntax is confirmed.
2. **Time entries for one matter** — `GET {api_endpoint}/api/rest/timeentries?action=123&pageSize=200`. Parent-filter param 🔬; loop on `nextPage` to total the matter's time.
3. **A contact + its linked matters** — `GET {api_endpoint}/api/rest/participants/9`. Related matters arrive under `linked`; follow `links` templates for full records.

## Gotchas

1. **Responses are objects, not arrays:** records sit under a resource-named key. Read `response["actions"]`, not `response[0]`.
2. **`meta.paging` is keyed by resource name** (e.g. `meta.paging.actions`), not a flat `paging`.
3. **`pageSize` > 200 is rejected/clamped** — never request more than 200.
4. **Filter syntax unconfirmed** — don't assume `?status=Active` works until verified; fall back to client-side filtering.

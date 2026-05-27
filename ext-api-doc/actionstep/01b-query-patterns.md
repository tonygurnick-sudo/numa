---
api_name: 'Actionstep'
api_slug: 'actionstep'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-27'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Actionstep — Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Read operations: listing, sideloading related records,
> pagination, and (where documented) filtering/sorting.
>
> ⚠️ Filter/sort/sideload **parameter names** are the largest documentation gap. Items tagged
> 🔬 must be confirmed against a live org before relying on server-side query features. When in
> doubt, page through and filter client-side.

---

## Query Capabilities Summary

| Capability                 | Supported | Syntax                          | Notes                         |
| -------------------------- | --------- | ------------------------------- | ----------------------------- |
| List a resource            | Yes       | `GET /api/rest/{resource}`      | Resource-keyed response       |
| Get by ID                  | Yes       | `GET /api/rest/{resource}/{id}` | Returns single keyed object   |
| Include related (sideload) | Yes       | `linked`/`links` in response    | JSON-API-style; param name 🔬 |
| Pagination                 | Yes       | `page`, `pageSize`              | Default 50, max 200           |
| Filter by field value      | Likely    | 🔬 confirm                      | Not fully documented          |
| Filter by date range       | Likely    | 🔬 confirm                      | Not fully documented          |
| Sort                       | Likely    | 🔬 confirm                      | Not fully documented          |
| Full-text search           | Partial   | 🔬 resource-specific            | Not fully documented          |

---

## Common Patterns

### Pattern 1: List

```http
GET {api_endpoint}/api/rest/actions?page=1&pageSize=50
Authorization: Bearer <token>
Accept: application/vnd.api+json
```

The response is **resource-keyed** (the array lives under a key named after the resource), with
optional `links`/`linked` for related data and `meta.paging` for pagination:

```json
{
  "actions": [{ "id": 123, "name": "Smith v Jones", "status": "Active" }],
  "meta": {
    "paging": {
      "actions": { "recordCount": 240, "pageCount": 5, "page": 1, "pageSize": 50, "prevPage": null, "nextPage": 2 }
    }
  }
}
```

### Pattern 2: Get by ID (with sideloaded relations)

```http
GET {api_endpoint}/api/rest/actions/123
Authorization: Bearer <token>
Accept: application/vnd.api+json
```

```json
{
  "actions": { "id": 123, "name": "Smith v Jones" },
  "linked": { "participants": [{ "id": 9, "displayName": "Jane Smith" }] },
  "links": { "actions.participants": { "href": "/api/rest/participants/{actions.participants}" } }
}
```

- `links` gives URI templates for related resources; `linked` holds the sideloaded records.
- The exact request parameter to _request_ sideloading (e.g. an `include`-style param) is 🔬.

### Pattern 3: Get related records (filter by parent)

```http
GET {api_endpoint}/api/rest/timeentries?action=123&pageSize=200
```

> 🔬 Confirm the parent-filter parameter spelling (`action` vs `action_id`) on a live org.

### Pattern 4: Date range / filtering (UNCONFIRMED)

Actionstep supports filtering, but operator syntax is not in the public docs. Until confirmed:

- **Preferred safe approach:** page through the resource and filter in the agent/client.
- **If confirming on a sandbox:** test field-equality, comparison operators, and date ranges,
  then replace this section with the verified syntax. 🔬

---

## Pagination Handling

### Model

- **Type:** page-number.
- **Default page size:** 50. **Max page size:** 200 (`pageSize` hard cap).
- **Total count available:** Yes — `meta.paging.{resource}.recordCount` and `.pageCount`.

### Request Parameters

| Parameter  | Type | Default | Description                |
| ---------- | ---- | ------- | -------------------------- |
| `page`     | int  | 1       | 1-based page number        |
| `pageSize` | int  | 50      | Records per page (max 200) |

### Response Structure

```json
{
  "actions": [ ... ],
  "meta": { "paging": { "actions": { "recordCount": 240, "pageCount": 5, "page": 1, "pageSize": 50, "prevPage": null, "nextPage": 2 } } }
}
```

### Last Page Detection

`meta.paging.{resource}.nextPage === null` → no more pages.

### Full Pagination Loop

```
page = 1
loop:
  GET /api/rest/{resource}?page={page}&pageSize=200
  process response[{resource}]
  next = response.meta.paging.{resource}.nextPage
  if next == null: stop
  page = next
```

---

## Worked Examples

### Example 1: All active matters

```http
GET {api_endpoint}/api/rest/actions?page=1&pageSize=200
```

```json
{
  "actions": [{ "id": 123, "name": "Smith v Jones", "status": "Active" }],
  "meta": {
    "paging": { "actions": { "recordCount": 1, "pageCount": 1, "page": 1, "pageSize": 200, "nextPage": null } }
  }
}
```

**Key points:** read `meta.paging.actions` to know whether to fetch more; status filtering is
client-side until the server filter syntax is confirmed.

### Example 2: Time entries for one matter

```http
GET {api_endpoint}/api/rest/timeentries?action=123&pageSize=200
```

**Key points:** parent-filter param 🔬; loop on `nextPage` to total the matter's time.

### Example 3: A contact and its linked matters

```http
GET {api_endpoint}/api/rest/participants/9
```

**Key points:** related matters arrive under `linked`; follow `links` templates for full records.

---

## Gotchas & Counter-Exceptions

1. **Responses are objects, not arrays:** the records sit under a resource-named key, not at the
   top level. Read `response["actions"]`, not `response[0]`.
2. **`meta.paging` is keyed by resource name**, e.g. `meta.paging.actions` — not a flat `paging`.
3. **`pageSize` over 200 is rejected/clamped** — never request more than 200.
4. **Filter syntax unconfirmed** — don't assume `?status=Active` works until verified; fall back
   to client-side filtering.

---

_Generated from the investigation questionnaire, Phases 5–6._

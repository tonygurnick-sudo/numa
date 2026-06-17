---
api_name: Rentman
api_slug: rentman
base_url: https://api.rentman.net
path_version_segment: none (no /v4/, no /v1/ — paths are bare; "v4" is a product label, never in a path)
route_prefix_injected_by_connector: none (pass flat paths like /projects, /contacts/{id})
call_surface: HTTP via `connectors(name="request", params={connector:"rentman", url, method, body?})` — relative URLs; Numa injects `Authorization: Bearer`, you NEVER set it
auth: per-user JWT, Bearer (long-lived, role-scoped; no OAuth/refresh/scopes)
field_casing: snake_case (planperiod_start, account_manager)
id_format: integer
linked_fields: path strings (e.g. "customer":"/contacts/12") — both in responses and write bodies
rate_limit: 50000/day · 10/s · 20 concurrent (per token)
spec: OpenAPI 1.13.0, fetched 2026-06-10 (221 paths, 64 resources)
confidence: every fact is OpenAPI-spec-derived [SPEC] unless tagged [DOCS] (support article) or [UNVERIFIED] (inferred). NOT yet live-validated through the Numa connector — trust real responses over this file.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Rentman — API Rules

## Paths (read first)

- Pass FLAT relative paths: `/projects`, `/contacts/{id}`. Base `https://api.rentman.net` injected.
- NO version segment. `/v4/...` and `/v1/...` → 404. Paths are bare. No trailing slash documented.

## Call mechanics

```
connectors(name="request", params={"connector":"rentman", "url":"/projects?limit=50", "method":"GET"})
```

- Numa injects `Authorization: Bearer <token>` from the user's vault — you never see it, never set it.
- POST/PUT: JSON in `body`, `Content-Type: application/json`. Single objects, not arrays.
- All paths relative; no other special headers exist.

## Auth

Token = per-user JWT from Rentman → **Configuration → Account → Integrations → API** ("Connect" if deactivated, then "Show token") [DOCS]. Valid 10yr (new) / 5yr (old) [DOCS]. Role-scoped: each call permitted per the Rentman role of the token-generating user; no scopes/OAuth; spec declares no 403.

- **Only the last generated token is valid.** Regenerating invalidates the old one instantly [DOCS].
- **401 = regenerated / revoked / expired.** User reconnects via the chat credential card. Do NOT retry/loop.

## Response envelope

Every successful GET: `{"data":..., "itemCount":n, "limit":n, "offset":n}`. `data` = array (collection) or object (single item). POST/PUT return the item under `data`. DELETE returns **no body**. Cursor pages add `next_page_url` (string|null). `itemCount` = items in THIS response, NOT a total — there is no total-count field; say "at least N" unless you drained all pages.

## CAN

- Read everything: projects, subprojects, planned equipment (`/projectequipment`), crew planning (`/projectcrew`, `/projectfunctions`), crew, contacts (+persons), equipment (+serials), invoices (+lines, payments), quotes, contracts, purchase orders, files, appointments, time registration.
- Query: filter non-generated fields with operators `[lt] [gt] [lte] [gte] [neq] [isnull]`; trim with `?fields=`; sort `?sort=+field,-field`; inline links with `?expand=` (dot-nest ≤3 levels).
- Page with `limit` (default 300, max 1500) + `next_page_url` cursor, or `offset`.
- Detect changes by polling `modified[gte]` + per-item `updateHash`.
- Create/update/delete: contacts, contactpersons, tasks, subtasks, taskassignments, appointments, appointmentcrew, crewavailability, time registration, vehicles, project costs, serialnumbers, suppliers, project requests.
- Create-only (no update/delete): **projects**, **subprojects**, project functions. Create+update (no delete): equipment, payments, folders, leaverequest. Create-only immutable: leavemutation.

## CANNOT

- Receive webhooks — **polling only** (none in spec or docs).
- **Update or delete projects/subprojects** — POST only; the rest is UI-land.
- Write invoices, quotes, contracts, crew members, projectequipment, projectcrew, projectvehicles, files, purchase orders — all read-only.
- Filter or sort on `GENERATED FIELD`s (e.g. `is_paid`, `planperiod_start` on projects) — not queryable; not sortable while `limit`/`offset` are set.
- Query custom fields (`custom_<n>`) — readable/writable but never filterable.
- Exceed 1500 records or 5 MB per response.
- Upload file binaries — `/files` is GET-only; download via the `url`/`proxy_url` fields.

## Critical gotchas

1. **Projects/subprojects are create-only.** No `PUT /projects/{id}`. To "update a project" only touch writable satellites (costs, tasks, functions) — say so, don't guess.
2. **`GENERATED FIELD` is the #1 query trap.** Computed fields (all `project_*_price`, `is_paid`, `usageperiod_*`/`planperiod_*` on projects & subprojects, `tags`, `displayname`) can't be filtered, nor sorted while paging. Workable change/date filter is `modified[gte]`.
3. **Generated money fields are omitted from collection responses** unless requested via `?fields=` — a project list with no `?fields` has no totals.
4. **Linked fields are path strings** (`"customer":"/contacts/12"`): split on `/` for the id, or `?expand=customer` to inline. Write bodies use the same form (`{"subproject":"/subprojects/7"}`).
5. **Financials live on subprojects.** Every project has ≥1 subproject (even when the UI hides it); status, location, discounts sit there. Project-level prices are roll-ups.
6. **Default page = 300 items**; `GET /projects` with no `limit` can be heavy. Use `?fields=` aggressively; mind the 5 MB cap.
7. **Multi-field sort + paging is unreliable** — only the first sort field is applied before pagination (backend limitation). Sort by one field when paging, or sort client-side.
8. **Dutch leaks into the schema:** invoices = `Factuur`/`FactuurResponse`, quotes = `Quotation`, crew rates have `naam`/`medewerker`, task recurrence is `recurhoe`/`recureind`/`recurperiode`. Don't "fix" these names.
9. **Error bodies undocumented** — only status codes (400/401/404/500/502) declared; rate-limit status also undocumented. Surface bodies verbatim.
10. **Cursor param naming is internally inconsistent in docs** (`cursor` vs `cursor_after`/`cursor_limit`) — never build a cursor; **follow `next_page_url` verbatim** (strip only the `https://api.rentman.net` host) until `null`.
11. **No idempotency keys** — a timed-out POST may have landed; search for the would-be record before re-POSTing.

## Default parameters (override only if the user specifies)

| Param    | Default                                      | Reason                          |
| -------- | -------------------------------------------- | ------------------------------- |
| `limit`  | 25–50 chat reads (API default 300, max 1500) | small responses; 5 MB hard cap  |
| `fields` | always set on collection reads               | omit bulky/generated fields     |
| `sort`   | `+id` (single field when paging)             | multi-field + paging unreliable |
| `expand` | only when you need the linked object         | saves follow-up GETs; ≤3 levels |
| pacing   | ≤5 req/s sequential                          | limit is 10/s, 20 concurrent    |

## Operations (core set — full 63-resource catalog in 01a)

| Operation                      | Method   | Path                            | Notes                                                                 |
| ------------------------------ | -------- | ------------------------------- | --------------------------------------------------------------------- |
| List / create projects         | GET/POST | /projects                       | no PUT/DELETE on items                                                |
| Get project                    | GET      | /projects/{id}                  | `?expand=customer` etc.; request GENERATED price fields via `?fields` |
| Subprojects of a project       | GET/POST | /projects/{id}/subprojects      | status/financials live here; no update/delete                         |
| Planned equipment              | GET      | /projects/{id}/projectequipment | read-only                                                             |
| Crew planning                  | GET      | /projects/{id}/projectcrew      | read-only; also /projectfunctions                                     |
| List equipment                 | GET/POST | /equipment                      | PUT /equipment/{id}; no DELETE                                        |
| Serial numbers                 | GET/POST | /equipment/{id}/serialnumbers   | PUT/DELETE /serialnumbers/{id}                                        |
| List / create contacts         | GET/POST | /contacts                       | PUT/DELETE /contacts/{id}                                             |
| Contact persons                | GET/POST | /contacts/{id}/contactpersons   | PUT/DELETE /contactpersons/{id}                                       |
| Invoices                       | GET      | /invoices, /invoices/{id}       | read-only; lines via /invoicelines                                    |
| Record payment                 | POST     | /invoices/{id}/payments         | PUT /payments/{id}; `moment` required; no DELETE                      |
| Quotes                         | GET      | /quotes, /projects/{id}/quotes  | read-only                                                             |
| Files (metadata + URLs)        | GET      | /files, /projects/{id}/files    | read-only; download via `url`                                         |
| Tasks                          | GET/POST | /tasks                          | full CRUD; `color` required on create                                 |
| Appointments                   | GET/POST | /appointments                   | full CRUD; `start`,`end` required                                     |
| Crew availability              | GET/POST | /crew/{id}/crewavailability     | PUT/DELETE /crewavailability/{id}                                     |
| Time registration              | GET/POST | /timeregistration               | full CRUD                                                             |
| Project requests (lead intake) | GET/POST | /projectrequests                | raw external data → user converts in UI                               |

## Errors

Spec declares only 400, 401, 404, 500, 502 — no bodies documented; plan for undocumented 429/403. Details in 01d.
| Status | Meaning | Action |
| --- | --- | --- |
| 400 | bad filter/expand/body; expanding a non-link field; sorting a GENERATED field with paging; >5 MB response | fix the query (drop bad params, reduce `limit`/`fields`); do NOT retry unchanged |
| 401 | token regenerated / revoked / expired | reconnect via the chat credential card; do not retry |
| 404 | wrong id or path (possibly role-hidden data [UNVERIFIED]) | verify the id and exact path (no `/v4/` prefix) |
| 429 | [UNVERIFIED — not in spec] possible rate-limit | back off 2s→10s→30s; halve pacing |
| 500/502 | "Something went wrong" / bad gateway | retry once after 5s; for writes, verify whether it landed first |

## Known limitations

Caps restated above (no webhooks→01d; projects/subprojects immutable post-create; invoices/quotes/projectequipment read-only; GENERATED unqueryable→01b; rate-limit/error bodies undocumented). One more: **MCP beta (`mcp.rentman.net`) not yet usable from Numa — REST is the only Rentman path.**

## Working examples

**1. List recent projects (trimmed):**

```
connectors(name="request", params={"connector":"rentman","method":"GET",
  "url":"/projects?fields=id,name,number,reference,customer,account_manager&sort=-id&limit=50"})
```

→ `{"data":[...],"itemCount":50,"limit":50,"offset":0}`

**2. One project, customer inlined, then its planned equipment:**

```
GET /projects/123?expand=customer,account_manager
GET /projects/123/projectequipment?fields=id,name,quantity,unit_price,equipment&limit=200
```

**3. Filtered read — GB contacts modified this month:**

```
GET /contacts?country=gb&modified[gte]=2026-06-01T00:00:00&fields=id,displayname,name,email_1,phone_1
```

**4. Create a contact (POST /contacts):**
`{"type":"company","name":"Acme Productions","email_1":"office@acme.example","phone_1":"+64 9 555 1234","country":"nz"}`
→ `{"data":{"id":...,...}}` — capture `data.id`.

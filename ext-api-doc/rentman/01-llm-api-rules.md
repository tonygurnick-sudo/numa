---
api_name: 'Rentman'
api_slug: 'rentman'
version: 'API v4 (api.rentman.net) — OpenAPI 1.13.0, last deployment 2026-06-01'
generated_from: 'Live OpenAPI spec (oas.json 1.13.0, fetched 2026-06-10) + support article 360013767839 + FEAT-209'
generated_date: '2026-06-10'
update_source: 'Spec mined live from api.rentman.net Redoc bundle — no live API calls made'
line_count_target: '< 300 lines'
---

# Rentman -- Workspace Agent API Rules

> ⚠️ **Docs-derived — NOT yet live-validated through the Numa connector path.**
>
> **This file is loaded into the workspace agent's context when the Rentman integration is active.**
> It must stay under 300 lines. Companion files (01a–01d) contain the detailed reference material.
> Facts are tagged [SPEC] (the machine-readable OpenAPI spec, fetched 2026-06-10), [DOCS] (Rentman
> support article / docs prose), or [UNVERIFIED] (inferred). Never claim live-confirmed behaviour —
> nothing here has been exercised with real credentials.

## Context

- **API:** Rentman v4 — rental & event-production management: projects, subprojects, planned
  equipment, crew planning, contacts, invoices, quotes, files, appointments, time registration [SPEC]
- **Base URL:** `https://api.rentman.net` — configured in Numa; use **relative URLs** like `/projects` [SPEC]
- **Auth:** per-user workspace API token (a long-lived JWT) sent as `Authorization: Bearer` —
  **injected automatically by Numa. Never set it.** [SPEC]
- **Integration path:** Data Connector — call via the `connectors` MCP tool, `request` operation
- **Versioning:** single rolling version, integrations auto-migrated; spec 1.13.0 [SPEC]
- **Rate limits:** 50,000 requests/day, 10 requests/second, max 20 concurrent [SPEC]
- **Field casing:** snake_case (`planperiod_start`, `account_manager`); ids are **integers** [SPEC]
- **Why this connector exists:** the Pipedream Rentman actions are broken for the customer
  (FEAT-209) — this native path replaces them. A first-party MCP server (`mcp.rentman.net`, beta)
  is the preferred future surface but is NOT available in Numa yet (see 01d).

## How to Call

```
connectors(name="request", params={
  "connector": "rentman",
  "url": "/projects?limit=50",
  "method": "GET"
})
```

- Numa injects `Authorization: Bearer <token>` from the user's vault — **you never see the token**.
- POST/PUT: pass JSON in `body` with `Content-Type: application/json` [SPEC]. Single objects, not arrays.
- All paths are relative to `https://api.rentman.net` — no version segment in paths [SPEC].

## Auth Structure

Token = per-user JWT generated in Rentman → **Configuration → Account → Integrations → API**
("Connect", then "Show token") [DOCS]. Valid 10 years for newly created tokens [DOCS].

- **Only the last generated token is valid.** Regenerating invalidates the old one instantly [DOCS].
- **401 = token regenerated, revoked, or expired.** The user reconnects Rentman via the chat
  credential card. Do not retry. [DOCS]
- **Access is role-scoped:** each call is permitted per the Rentman role of the user who generated
  the token [DOCS]. A denied call's status code is [UNVERIFIED] — expect 401/404-shaped failures.
- No scopes/OAuth on this surface; the spec declares no 403 responses anywhere [SPEC].

## Response Envelope

Every successful GET returns `{ "data": ..., "itemCount": n, "limit": n, "offset": n }` —
`data` is an array for collections, an object for single items [SPEC]. POST/PUT return the
created/updated item under `data`; successful DELETE has **no response body** [SPEC].
Cursor-paged responses add `next_page_url` (string or null) [SPEC].

## Capabilities

### CAN

1. Read everything: projects, subprojects, planned equipment (`/projectequipment`), crew planning
   (`/projectcrew`, `/projectfunctions`), crew, contacts (+persons), equipment (+serials), invoices
   (+lines, payments), quotes, contracts, purchase orders, files, appointments, time registration [SPEC]
2. Filter on (non-generated) fields with `[lt] [gt] [lte] [gte] [neq] [isnull]` operators [SPEC]
3. Trim payloads with `?fields=`, sort with `?sort=+field,-field`, inline linked records with
   `?expand=` (dot-nesting up to 3 levels) [SPEC]
4. Page with `limit` (default 300, max 1500) + `next_page_url` cursor, or `offset` [SPEC]
5. Create/update/delete: contacts, contactpersons, tasks, appointments, crew availability, time
   registration, vehicles, project costs, serial numbers, suppliers, project requests [SPEC]
6. Create (but not update/delete): **projects** and **subprojects**, project functions, payments
   (no delete), equipment (no delete), leave mutations [SPEC]
7. Detect changes by polling `modified[gte]` + per-item `updateHash` [SPEC]

### CANNOT

1. Receive webhooks — none documented anywhere in the spec or docs. **Polling only.** [SPEC]
2. **Update or delete projects/subprojects** — POST only; everything else is UI-land [SPEC]
3. Write invoices, quotes, contracts, crew members, planned equipment (`projectequipment`),
   crew assignments (`projectcrew`), files, purchase orders — all **read-only** [SPEC]
4. Filter or sort on `GENERATED FIELD`s (computed fields, e.g. `is_paid`, `planperiod_start` on
   projects) — they are not queryable, and not sortable while `limit`/`offset` are set [SPEC]
5. Query custom fields (`custom_<n>`) — readable/writable but never filterable [SPEC]
6. Exceed 1500 records or 5 MB per response — over-size requests error out [SPEC]
7. Upload file binaries — `/files` is GET-only; downloads go via the `url`/`proxy_url` fields [SPEC]

## Critical Gotchas

1. **Projects are create-only.** No `PUT /projects/{id}` exists. To "update a project" you can only
   touch its writable satellites (costs, tasks, functions) — say so instead of guessing. [SPEC]
2. **`GENERATED FIELD` is the #1 query trap.** Computed fields (all `project_*_price`, `is_paid`,
   `usageperiod_*`/`planperiod_*` on projects & subprojects, `tags`, `displayname`) cannot be used
   in filters or in `sort` when paging — the workable change/date filter is `modified[gte]`. [SPEC]
3. **Generated money fields are omitted from collection responses** unless you request them
   explicitly via `?fields=` — a project list without `?fields` has no totals. [SPEC]
4. **Linked fields are path strings**, e.g. `"customer": "/contacts/12"` — split on `/` for the id,
   or use `?expand=customer` to inline the object. In write bodies, references are these same path
   strings (e.g. `{"subproject": "/subprojects/7"}`). [SPEC]
5. **Financials live on subprojects.** Every project has ≥1 subproject (even when the UI hides it);
   status, location, and discounts sit there. Project-level prices are roll-ups. [SPEC]
6. **The default page is 300 items** — and a `GET /projects` with no `limit` can be heavy. Use
   `?fields=` aggressively; mind the 5 MB cap. [SPEC]
7. **Sorting on multiple fields while paginating is unreliable** — only the first sort field is
   applied before pagination (documented backend limitation). Sort by one field, or sort client-side. [SPEC]
8. **Dutch leaks into the schema:** invoices are `FactuurResponse`, crew rates have `naam` /
   `medewerker`, task recurrence is `recurhoe`/`recureind`. Don't "fix" these names. [SPEC]
9. **Error body format is undocumented** — only status codes (400/401/404/500/502) are declared.
   Surface response bodies verbatim. The rate-limit status code is also undocumented. [SPEC]
10. **Pagination param naming is internally inconsistent in the docs** (`cursor` vs
    `cursor_after`/`cursor_limit`) — never build a cursor yourself; **follow `next_page_url`
    verbatim** until it is `null`. [SPEC]

## Default Parameters

| Parameter | Default                                       | Reason                                        |
| --------- | --------------------------------------------- | --------------------------------------------- |
| `limit`   | 50–100 for chat reads (API default 300, max 1500) | Keep responses small; 5 MB hard cap [SPEC] |
| `fields`  | always set on collection reads                | Omit bulky fields; generated totals need it [SPEC] |
| `sort`    | `+id` (single field only when paging)         | Multi-field sort + paging is unreliable [SPEC] |
| `expand`  | only when you need the linked object          | Saves N follow-up GETs; ≤3 levels [SPEC]      |
| Pacing    | ≤ 5 req/s sequential                          | Documented limit is 10/s, 20 concurrent [SPEC] |

## Working Examples

### Example 1: List recent projects (trimmed fields)

```
connectors(name="request", params={"connector": "rentman", "method": "GET",
  "url": "/projects?fields=id,name,number,reference,customer,account_manager&sort=-id&limit=50"})
```

Response: `{"data": [...], "itemCount": 50, "limit": 50, "offset": 0}` [SPEC].

### Example 2: One project with its customer inlined, then its planned equipment

```
connectors(name="request", params={"connector": "rentman", "method": "GET",
  "url": "/projects/123?expand=customer,account_manager"})

connectors(name="request", params={"connector": "rentman", "method": "GET",
  "url": "/projects/123/projectequipment?fields=id,name,quantity,unit_price,equipment&limit=200"})
```

### Example 3: Filtered read — contacts in Great Britain, modified this month

```
connectors(name="request", params={"connector": "rentman", "method": "GET",
  "url": "/contacts?country=gb&modified[gte]=2026-06-01T00:00:00&fields=id,displayname,name,email_1,phone_1"})
```

### Example 4: Create a contact

```
connectors(name="request", params={"connector": "rentman", "method": "POST",
  "url": "/contacts",
  "body": {"type": "company", "name": "Acme Productions", "email_1": "office@acme.example",
           "phone_1": "+64 9 555 1234", "country": "nz"}})
```

Response: `{"data": {"id": ..., ...}}` — capture `data.id` [SPEC].

## Proxy API Operations (core set)

All relative paths; full catalog of 63 resources in 01a [SPEC].

| Operation                    | Method | Path                                  | Notes                              |
| ---------------------------- | ------ | ------------------------------------- | ---------------------------------- |
| List / create projects       | GET/POST | /projects                           | No PUT/DELETE on items             |
| Get project                  | GET    | /projects/{id}                        | `?expand=customer` etc.            |
| Subprojects of a project     | GET/POST | /projects/{id}/subprojects          | Status/financials live here        |
| Planned equipment            | GET    | /projects/{id}/projectequipment       | Read-only                          |
| Crew planning                | GET    | /projects/{id}/projectcrew            | Read-only; also /projectfunctions  |
| List equipment               | GET/POST | /equipment                          | PUT /equipment/{id}; no DELETE     |
| Serial numbers               | GET/POST | /equipment/{id}/serialnumbers       | PUT/DELETE /serialnumbers/{id}     |
| List / create contacts       | GET/POST | /contacts                           | PUT/DELETE /contacts/{id}          |
| Contact persons              | GET/POST | /contacts/{id}/contactpersons       | PUT/DELETE /contactpersons/{id}    |
| Invoices                     | GET    | /invoices, /invoices/{id}             | Read-only; lines via /invoicelines |
| Record payment on invoice    | POST   | /invoices/{id}/payments               | PUT /payments/{id}; required `moment` |
| Quotes                       | GET    | /quotes, /projects/{id}/quotes        | Read-only                          |
| Files (metadata + URLs)      | GET    | /files, /projects/{id}/files          | Read-only; download via `url`      |
| Tasks                        | GET/POST | /tasks                              | Full CRUD; `color` required on create |
| Appointments                 | GET/POST | /appointments                       | Full CRUD; `start`,`end` required  |
| Crew availability            | GET/POST | /crew/{id}/crewavailability         | PUT/DELETE /crewavailability/{id}  |
| Time registration            | GET/POST | /timeregistration                   | Full CRUD                          |
| Project requests (lead intake) | GET/POST | /projectrequests                  | Raw external data → user converts in UI |

## Error Handling

Spec declares only 400, 401, 404, 500, 502 — no bodies documented [SPEC]. Details in 01d.

| Status | Meaning                                   | Action                                                       |
| ------ | ----------------------------------------- | ------------------------------------------------------------ |
| 400    | Bad request — bad filter/expand/body; expanding a non-link field; >5 MB response | Fix the query (drop bad params, reduce `limit`/`fields`); do NOT retry unchanged |
| 401    | Token regenerated / revoked / expired     | Reconnect Rentman via the chat credential card; do not retry |
| 404    | Wrong id or path (possibly role-hidden data [UNVERIFIED]) | Verify the id and exact path        |
| 429    | [UNVERIFIED — not in spec] possible rate-limit signal | Back off 2s → 10s → 30s; halve pacing           |
| 500    | "Something went wrong"                    | Retry once after 5s; for writes, verify whether it landed first |
| 502    | Bad gateway                               | Retry once after 5s, same write caution                      |

## Known Limitations

1. **Nothing live-validated through Numa** — every shape here is spec-derived; trust real responses
   over this file and note discrepancies
2. **No webhooks** — change detection is polling only (see 01d)
3. **Projects/subprojects immutable via API** after creation; invoices/quotes/planned equipment read-only
4. **Generated fields unqueryable** — date-window and "unpaid invoices" style filters need
   client-side evaluation (see 01b)
5. **Rate-limit breach behaviour and error bodies undocumented** — fly conservatively
6. **MCP beta (`mcp.rentman.net`) not yet usable from Numa** — REST connector is today's only path

---

_Generated 2026-06-10 from the live OpenAPI spec (1.13.0). See companion files:_

- _01a-domain-model-reference.md — Entity catalog, hierarchy, fields, link semantics_
- _01b-query-patterns.md — Pagination, fields/sort/filter/expand, worked examples_
- _01c-mutation-patterns.md — What is writable, create/update/delete patterns_
- _01d-event-and-error-handling.md — Polling, rate limits, errors, MCP-beta future surface_

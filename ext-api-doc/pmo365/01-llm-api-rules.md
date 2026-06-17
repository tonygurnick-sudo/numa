---
api_name: PMO365 (Microsoft Dataverse)
api_slug: pmo365
underlying_api: Microsoft Dataverse Web API (OData v4, JSON)
base_url: '{environment_url}/api/data/v9.2/'
environment_url: 'https://{org}.crm.dynamics.com (admin-configured, workspace-wide; stored in connector credential field environment_url)'
path_version_segment: '/api/data/v9.2/ IS a literal path segment — every request path includes it. v9.2 is a real path component, NOT a label.'
path_construction: 'Pass FLAT relative paths (/solutions, /pmo_projects({id})). Backend expands them against {environment_url}/api/data/v9.2/. Do NOT construct the host; do NOT add /api/data/v9.2 yourself.'
call_surface: 'HTTP only, via connect_request (method + relative path + optional JSON body). NOT a file-browse connector — does NOT support list-files/search-files/download-file. surfaces=[chat].'
auth: 'Bearer {access_token} (standard scheme, Entra ID OAuth2; backend attaches it)'
field_casing: 'columns lowercase snake-ish LogicalName (pmo_name); navigation properties PascalCase (pmo_ProgramId)'
id_format: 'GUID 8-4-4-4-12 hex, no braces in URLs: /pmo_projects(f1a2b3c4-...)'
rate_limit: 'Dataverse service-protection, per-user, sliding 5-min window, three facets (see Errors)'
schema_confidence: 'PMO365 table/column names (pmo_*) are PROPRIETARY + UNDOCUMENTED [INFERRED] — discover at runtime, never hardcode. Dataverse PLATFORM behaviour (metadata tables, _x_value lookups, statecode/statuscode, paging, errors) is [DOCUMENTED] and reliable.'
companions: '01a=domain-model+discovery+state-machines · 01b=query patterns · 01c=mutation patterns · 01d=events+errors'
---

# PMO365 — API Rules

## Context (read first)

PMO365 has **NO API of its own**. It is a Project Portfolio Management solution by EPM Partners on the Microsoft Power Platform; its data lives in the customer's **Microsoft Dataverse** environment (same store as Dynamics 365 / Project for the web). You integrate via the **Dataverse Web API** (OData v4, JSON).

- **Base URL:** `{environment_url}/api/data/v9.2/` where `environment_url = https://{org}.crm.dynamics.com`. `/api/data/v9.2/` is a **literal path segment** present on every request — not a version label.
- **Call surface:** HTTP via `connect_request` (method + flat relative path + optional JSON body). Backend injects auth + OData headers, expands the path against the base, refreshes the token, retries once. You never see the token or build the host. NOT a file-browse connector — no list/search/download-file.
- **Auth:** Entra ID (Azure AD) OAuth2, authorization-code + refresh. Standard `Bearer`.

## DISCOVERY FIRST — the whole game

There is **no global "list PMO365 tables" call.** PMO365 is a Dataverse **solution**: custom tables sharing one publisher **customization prefix** (e.g. `pmo_*`). Standard Dataverse/Dynamics tables do NOT carry that prefix. **Real PMO365 table/column names are proprietary and undocumented — discover them at runtime. Never assume `pmo_project`/`pmo_risk` exist; they are ILLUSTRATIVE until a discovery query confirms them.**

Discovery sequence (run before any business query):

1. **Find solution** → `solutionid`: `GET /solutions?$select=solutionid,uniquename,friendlyname,version&$filter=contains(uniquename,'pmo') or contains(friendlyname,'pmo')`
2. **List its tables** (componenttype 1 = Entity; `objectid` = table MetadataId): `GET /solutioncomponents?$filter=_solutionid_value eq {solutionid} and componenttype eq 1&$select=objectid`
3. **Resolve a table** by MetadataId → the all-important `EntitySetName` (plural, used in URLs): `GET /EntityDefinitions({metadataid})?$select=LogicalName,EntitySetName,DisplayName,PrimaryIdAttribute,PrimaryNameAttribute`
4. **Or, prefix known**, list custom tables: `GET /EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName,IsCustomEntity&$filter=startswith(LogicalName,'pmo_')`
5. **Publisher prefix:** `GET /publishers?$select=customizationprefix,friendlyname`.
6. **Full schema (CSDL):** `GET {environment_url}/api/data/v9.2/$metadata`.

> `LogicalName` (singular, `pmo_project`) is for metadata/`$filter`/`$select`; **`EntitySetName` (plural, `pmo_projects`) goes in the URL.** Confusing them is the #1 cause of 404s.

## Auth & headers

`Authorization: Bearer {access_token}` — standard scheme, NOT custom (contrast Zoho's `Zoho-oauthtoken`). Authority = the **`organizations`** tenant endpoint:

- authUrl `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize` · tokenUrl `https://login.microsoftonline.com/organizations/oauth2/v2.0/token` · scope `{environment_url}/.default offline_access`.

Backend attaches these (listed so you know the wire + which `Prefer` to ask for):

- Always (reads): `OData-MaxVersion: 4.0`, `OData-Version: 4.0`, `Accept: application/json`.
- Writes also: `Content-Type: application/json`.

| Need                                          | Header                                  |
| --------------------------------------------- | --------------------------------------- |
| Readable lookup / option-set labels           | `Prefer: odata.include-annotations="*"` |
| Control page size (≤5000)                     | `Prefer: odata.maxpagesize=N`           |
| Force update-only PATCH (block upsert-create) | `If-Match: *`                           |
| Create-only PATCH (fail if exists)            | `If-None-Match: *`                      |
| Get the row back on POST/PATCH                | `Prefer: return=representation`         |

Multiple `Prefer` values are comma-joined: `Prefer: odata.maxpagesize=200,odata.include-annotations="*"`.

**Token lifecycle:** access token ~1h. On `401` backend refreshes via the token URL and retries **once**; a second 401 fails the call → user reconnects. `403` is a **privilege** problem (Application User's security role), not a token problem — do not retry, surface it.

## CAN

1. Discover the solution, its tables, `EntitySetName`s, column metadata at runtime (`/solutions`, `/solutioncomponents`, `/EntityDefinitions`, `/publishers`, `$metadata`).
2. Query any discovered table with OData: `$select`, `$filter`, `$orderby`, `$top`, `$expand`, `$count=true`, `$apply` (groupby/aggregate).
3. Create (POST), update (PATCH), delete (DELETE) rows; set lookups via `@odata.bind`.
4. Expand lookups for related rows; get formatted labels via the annotations Prefer header.
5. Call bound actions/functions: `POST /{entityset}({id})/Microsoft.Dynamics.CRM.{ActionName}`.

## CANNOT

1. Upload binary attachments/files — `connect_request` is JSON only. Direct user to the PMO365/Dynamics UI.
2. Subscribe to live events — Dataverse supports webhooks/Service Endpoints/Power Automate, but Numa exposes **no receiver yet**. Poll instead.
3. Use Dataverse relevance/`$search` — a separate search API, not the Web API. Text match = `$filter contains()`.
4. Query a different environment — `environment_url` is fixed per connection by the admin.

## Gotchas

1. **Discover before you query.** Never hardcode table/column names; `pmo_project` etc. are ILLUSTRATIVE until confirmed. A guessed name 404s.
2. **`EntitySetName` (plural) in URLs, `LogicalName` (singular) in metadata/`$filter`/`$select`.** Mixing them is the #1 404 cause.
3. **PATCH is UPSERT.** `PATCH /{entityset}({id})` **creates the row if the id is absent.** Send `If-Match: *` to force update-only (missing row → `404`, not a silent create).
4. **Lookups read as `_{logicalname}_value`** (raw GUID). To get the related row, `$expand` the navigation property; for its label add the annotations header.
5. **Set lookups on write with `@odata.bind`**, not the `_value` field: `"{Nav}@odata.bind": "/{targetentityset}({guid})"`. Nav name (PascalCase) ≠ `_value` name; casing matters.
6. **Status is a state machine.** `statecode` (state) gates which `statuscode` (reason) values are legal. Option sets are integers — fetch valid values from metadata, set both together; never guess.
7. **Pagination is server-driven.** Follow `@odata.nextLink` **verbatim** (opaque `$skiptoken`) until absent. Set page size with `Prefer: odata.maxpagesize` (max 5000). Never hand-roll `$skip`.
8. **Honour `Retry-After` on 429.** Per-user limits are real; Dataverse extends the penalty if you keep hammering. Never tight-loop or fan out parallel calls.
9. **GUIDs are opaque strings, no braces in URLs:** `/pmo_projects(f1a2b3c4-...)`.
10. **Create returns `204`, no body** — new GUID is in the `OData-EntityId` response header. Add `Prefer: return=representation` for `201` + body.

## Defaults (override only if the user specifies)

| Param                               | Default                                 | Reason                                                      |
| ----------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| `Prefer: odata.maxpagesize`         | `100`                                   | Keep payloads sane; bump only for bulk.                     |
| `Prefer: odata.include-annotations` | `"*"` on reads with lookups/option sets | Human-readable labels, not raw GUIDs/ints.                  |
| `$select`                           | name + key + dates, never `*`           | Dataverse penalises wide reads; pick columns from metadata. |
| `$orderby`                          | `modifiedon desc`                       | Freshest-first.                                             |
| `If-Match`                          | `*` on every PATCH                      | Prevent accidental upsert-create.                           |

## Operations

| Operation          | Method  | Path                                                  | Notes                                                                       |
| ------------------ | ------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Find solution      | GET     | `/solutions`                                          | `$filter contains(...)` — discovery step 1                                  |
| Solution tables    | GET     | `/solutioncomponents`                                 | `$filter _solutionid_value eq, componenttype eq 1`; `objectid` = MetadataId |
| Resolve table      | GET     | `/EntityDefinitions({metadataid})`                    | get `EntitySetName` for URLs                                                |
| List custom tables | GET     | `/EntityDefinitions`                                  | `$filter startswith(LogicalName,'pmo_')`                                    |
| Table columns      | GET     | `/EntityDefinitions(LogicalName='x')/Attributes`      | types, RequiredLevel, option sets                                           |
| Publisher prefix   | GET     | `/publishers`                                         | `$select customizationprefix`                                               |
| Identity check     | GET     | `/WhoAmI`                                             | UserId/BusinessUnitId/OrganizationId; first-call smoke test                 |
| Query / get / agg  | GET     | `/{entityset}` · `/{entityset}({id})` · `?$apply=...` | `$select,$filter,$orderby,$top,$expand,$count`                              |
| Create             | POST    | `/{entityset}`                                        | 204 + `OData-EntityId` header                                               |
| Update             | PATCH   | `/{entityset}({id})`                                  | UPSERT unless `If-Match: *`                                                 |
| Delete             | DELETE  | `/{entityset}({id})`                                  | hard delete                                                                 |
| Clear one column   | DELETE  | `/{entityset}({id})/{property}`                       | 204                                                                         |
| Set lookup         | (write) | body `"{Nav}@odata.bind": "/{set}({guid})"`           | not the `_value` field                                                      |
| Clear lookup       | DELETE  | `/{entityset}({id})/{nav}/$ref`                       | disassociate single-valued nav                                              |
| Bound action       | POST    | `/{entityset}({id})/Microsoft.Dynamics.CRM.{Action}`  | needs full namespace                                                        |
| Alt-key upsert     | PATCH   | `/{entityset}(altkey='value')`                        | only if an alternate key exists                                             |
| Schema (CSDL)      | GET     | `/$metadata`                                          | full table/column/relationship/option-set defs                              |

## Pagination

Server-driven cursor in `@odata.nextLink` (opaque `$skiptoken`). Set page size via `Prefer: odata.maxpagesize=N` (max 5000; >5000 clamps to 5000). Issue the first request, then GET `@odata.nextLink` **verbatim** (re-expand against `{environment_url}`, keep the SAME `maxpagesize`). **Last page = no `@odata.nextLink`.** Never hand-roll `$skip`. `?$count=true` adds `@odata.count`, but it **caps at 5000** for standard tables (500 elastic) regardless of page size — not the true total beyond that; detect truncation via the `Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded` annotation, or use `RetrieveTotalRecordCount` / the `/$count` segment for an exact total.

## Events

No Numa-hosted webhook receiver yet → **poll** on `modifiedon` (server-set, ISO-8601 UTC), order by it, keep a high-water mark advanced from `MAX(modifiedon)` not `now()`, interval **≥5 min**. Deletes are invisible to `modifiedon` polling (use change-tracking delta links for `@removed` if delete-detection matters — not wired in Numa). See 01d.

## Errors

Body: `{"error":{"code":"0x80040217","message":"pmo_project With Id = ... Does Not Exist"}}`. `error.code` is a **hex string, not the HTTP status, and may be `""`** — always parse `error.message` and surface it verbatim. Validation errors name the offending property inline in `message` (no field-by-field list).

Recovery by HTTP status:
| Status | Meaning | Action |
| --- | --- | --- |
| 400 | bad query / `$filter` / validation | fix per `message`; check `LogicalName` vs `EntitySetName`; re-check `$metadata` |
| 401 | token expired | backend refreshes + retries once; 2nd 401 → user reconnects |
| 403 | missing privilege | Application User's security role lacks read/write on the table — admin fix; do NOT retry |
| 404 | not found | wrong `EntitySetName` / row GUID, or `If-Match: *` PATCH on a missing row (guard worked) — re-run discovery |
| 412 | precondition failed | `If-None-Match: *` create-only but row exists, or `If-Match: W/"<etag>"` ETag mismatch — re-fetch, decide create vs update |
| 413 | payload too large | split the body / `$batch` |
| 429 | service protection | **honour `Retry-After` (seconds)**, then retry; never tight-loop or parallelise |
| 5xx | server error | exponential backoff (≤3) |

**Service-protection limits** (per user, per web server, sliding 5-min/300s window; 429 when any one trips):

- `0x80072322` — **6,000 requests** / 5 min.
- `0x80072321` — **1,200,000 ms (20 min)** combined request-execution time / 5 min.
- `0x80072326` — **52 concurrent requests** (a concurrency cap, NOT 52 seconds; trips immediately, no grace).

## Examples

> `pmo_*` names below are ILLUSTRATIVE (what discovery typically returns); always run discovery in the same session first.

1. Query active projects, expand a lookup, readable labels:
   `GET /pmo_projects?$select=pmo_name,pmo_startdate,modifiedon,statecode&$filter=statecode eq 0 and modifiedon gt 2026-05-01T00:00:00Z&$orderby=modifiedon desc&$expand=pmo_ProgramId($select=pmo_name)` + `Prefer: odata.include-annotations="*",odata.maxpagesize=100`
   → `{"value":[{"pmo_projectid":"f1a2b3c4-5d6e-7f80-9a1b-2c3d4e5f6071","pmo_name":"ERP Migration","pmo_startdate":"2026-04-15","modifiedon":"2026-05-28T09:14:22Z","statecode":0,"statecode@OData.Community.Display.V1.FormattedValue":"Active","_pmo_programid_value":"aa11bb22-cc33-dd44-ee55-ff6677889900","pmo_ProgramId":{"pmo_name":"Digital Transformation"}}],"@odata.nextLink":"https://contoso.crm.dynamics.com/api/data/v9.2/pmo_projects?$select=...&$skiptoken=..."}`
   Follow `@odata.nextLink` verbatim; stop when absent.

2. Create a project, lookup via @odata.bind:
   `POST /pmo_projects` body `{"pmo_name":"Warehouse Automation","pmo_startdate":"2026-06-01","pmo_ProgramId@odata.bind":"/pmo_programs(aa11bb22-cc33-dd44-ee55-ff6677889900)"}`
   → `204 No Content` + `OData-EntityId: https://contoso.crm.dynamics.com/api/data/v9.2/pmo_projects(7c9d0e1f-2a3b-4c5d-6e7f-8091a2b3c4d5)`. New GUID is in the header. Add `Prefer: return=representation` for `201` + body.

3. Update-only PATCH (no accidental create):
   `PATCH /pmo_projects(7c9d0e1f-2a3b-4c5d-6e7f-8091a2b3c4d5)` + `If-Match: *` body `{"pmo_name":"Warehouse Automation (Phase 2)"}`
   → `204 No Content`. Missing id → `404` (not a silent create).

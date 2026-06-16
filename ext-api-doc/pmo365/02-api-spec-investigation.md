---
api_name: PMO365 (Microsoft Dataverse)
api_slug: pmo365
underlying_api: Microsoft Dataverse Web API (OData v4, JSON)
base_url: '{environment_url}/api/data/v9.2/'
path_version_segment: '/api/data/v9.2/ IS a literal path segment on every request (v9.2 is a real path component, pinned explicitly), NOT a label'
environment_url: 'https://{org}.crm.dynamics.com (admin-configured, workspace-wide, in connector credential field environment_url)'
spec_format: 'OData v4 CSDL — machine-readable schema at {environment_url}/api/data/v9.2/$metadata (NOT OpenAPI/Swagger)'
call_surface: 'HTTP via connect_request (method + flat relative path + optional JSON body). NOT file-browse — surfaces=[chat].'
auth: 'OAuth2 (Microsoft Entra ID), authorization_code + refresh, organizations authority, standard Bearer'
docs_url: 'https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview'
schema_confidence: 'medium — Dataverse platform facts [DOCUMENTED]; every pmo_* schema name [INFERRED], confirm via discovery / $metadata. Promote to [CONFIRMED] only after a real WhoAmI + discovery query against the deployed integration.'
date_researched: '2026-05-29'
---

# PMO365 (Microsoft Dataverse) — API Spec & Investigation

Developer-facing condensed reference: everything to implement/extend the PMO365 integration. PMO365 has **no API of its own** — it is a Project Portfolio Management solution by EPM Partners on the Power Platform; its data lives in the customer's **Microsoft Dataverse** environment (the store behind Dynamics 365 / Project for the web). You integrate via the **Dataverse Web API** (OData v4, JSON). Every `pmo_*` name here is ILLUSTRATIVE [INFERRED]; the discovery queries obtain the real names at runtime. **Discovery-first is the governing theme.**

## Overview

- **Vendor:** EPM Partners (PMO365 solution) on Microsoft Power Platform / Dataverse.
- **API:** Microsoft Dataverse Web API — REST / OData v4, JSON.
- **Version:** `v9.2` (current Dataverse Web API minor version; a **literal path segment** `/api/data/v9.2/`, pinned explicitly).
- **Base URL:** `{environment_url}/api/data/v9.2/` where `environment_url = https://{org}.crm.dynamics.com` (admin-configured, workspace-wide, in the connector's `environment_url` credential field). All relative paths the agent emits are expanded against this base by the backend `connect_request`. Region is encoded in the host (`crm`=North America, `crm2`=SAM, `crm7`=Japan, …); the admin supplies the full host so you never construct it. Sandbox environments have their own `{org}.crm.dynamics.com` host — same URL shape, different org.
- **Schema:** no OpenAPI/Swagger — the machine-readable schema is the OData CSDL `$metadata` document (see §$metadata).
- **Docs:** https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview · reference: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/about
- **Status page:** Microsoft 365 / Power Platform Service health (tenant-scoped, admin only).

Dataverse exposes every table in the environment as an OData v4 entity set with full CRUD, OData query (`$select`/`$filter`/`$expand`/`$orderby`/`$apply`), bound actions/functions, and a complete `$metadata` schema. PMO365 ships as a **solution** — custom tables sharing one publisher customization prefix (e.g. `pmo_*`) layered into the environment. No global "list all PMO365 tables" endpoint; discover the solution and its tables at runtime.

## Authentication — OAuth 2.0 (Microsoft Entra ID)

Standard `authorization_code` flow against Microsoft Entra ID using the **`organizations`** authority (any work/school tenant can consent). Access token ~1h; a refresh token is issued because `offline_access` is requested. Header is the **standard `Bearer` scheme** — NOT custom (contrast Zoho's `Zoho-oauthtoken`): `Authorization: Bearer {access_token}`.

| Parameter         | Value                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Grant type        | `authorization_code` (also `refresh_token`)                                              |
| Authority         | `organizations` (multi-tenant work/school; not `common`, not `consumers`)                |
| Authorization URL | `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize`                  |
| Token URL         | `https://login.microsoftonline.com/organizations/oauth2/v2.0/token`                      |
| Revocation URL    | none — revoke via Entra admin (app consent / refresh-token revocation)                   |
| Access token TTL  | ~1 hour                                                                                  |
| Refresh           | `offline_access` returns a refresh token; backend refreshes on 401 + retries once        |
| PKCE              | recommended for public clients; Numa is confidential (client secret), PKCE not mandatory |

**Scope:** environment-specific resource scope + `offline_access`:
| Scope | Purpose | Required? |
| --- | --- | --- |
| `{environment_url}/.default` | all delegated permissions the app is consented for on this Dataverse environment | yes |
| `offline_access` | issue a refresh token so the backend can renew silently | yes |

> ⚠️ **Scope host is environment-specific and the wizard does NOT interpolate credential fields into scopes.** The admin edits the scope host by hand in the wizard's **Advanced** section (e.g. `https://contoso.crm.dynamics.com/.default`). The wizard only interpolates `authUrl`/`tokenUrl` — never the scope. Wrong host → consent fails / tokens for the wrong audience → 401 on every call.

**Entra app setup (admin, one-time):** (1) App registration in the customer's Entra tenant (or Arcanum's, with admin consent in the customer tenant). (2) Delegated permission `Dynamics CRM` → `user_impersonation`. (3) Grant admin consent. (4) Dataverse **Application User** mapped to the app registration, assigned a **security role** granting read/write on the PMO365 tables — without this, tokens authenticate but every data call returns `403` (`PrincipalPrivilegeDenied`).

**Token lifecycle (runtime):** access token ~1h. On `401` (`ExpiredAuthTicket`/`InvalidAuthTicket`) the backend refreshes via the token URL and **retries the call once**; a second `401` → fail the call, user must reconnect.

**Integration path: Direct API Only.** All calls through `connect_request` — the backend's single egress. The agent supplies method + relative path + optional JSON body; the backend injects `Authorization: Bearer`, the required OData headers, expands the path against `{environment_url}/api/data/v9.2/`, sends, and handles token refresh / single retry. The agent never sees the token or constructs the host.

## Required Headers

Backend attaches these; listed so you know the wire + which `Prefer` to ask for:
| Header | When | Purpose |
| --- | --- | --- |
| `Authorization: Bearer {token}` | always | Entra access token |
| `OData-MaxVersion: 4.0` | always | pin OData protocol max version |
| `OData-Version: 4.0` | always | pin OData protocol version |
| `Accept: application/json` | always | Web API only returns JSON (errors too) |
| `Content-Type: application/json` | writes (POST/PATCH) | request body is JSON |
| `Prefer: odata.include-annotations="*"` | reads needing labels | formatted values for lookups / option sets / dates |
| `Prefer: odata.maxpagesize=N` | reads, set page size | server-driven paging size; max **5000** (elastic 500) |
| `Prefer: return=representation` | writes, get row back | `POST`→`201`+body; `PATCH`→`200`+body (instead of `204`) |
| `If-Match: *` | `PATCH` update-only | forces update-only — prevents the upsert creating a new record |
| `If-None-Match: *` | `PATCH` create-only | prevents the upsert updating an existing record |

Multiple `Prefer` values comma-separated: `Prefer: odata.maxpagesize=200,odata.include-annotations="*"`.

## Discovery (find PMO365 inside Dataverse)

> No global "list every table" call worth scanning. PMO365 is a Dataverse **solution**: custom tables sharing one publisher **customization prefix** (e.g. `pmo_`). Standard tables (account, contact, systemuser…) don't carry it. Discovery is mandatory, in order:

1. **Find the solution:** `GET /solutions?$select=solutionid,uniquename,friendlyname,version&$filter=contains(uniquename,'pmo') or contains(friendlyname,'pmo')`
   → `{"value":[{"solutionid":"f1c2d3e4-0000-0000-0000-aaaabbbbcccc","uniquename":"PMO365Core","friendlyname":"PMO365","version":"8.4.0.0"}]}`
2. **List its tables** (`componenttype eq 1`=Entity; `objectid`=table `MetadataId`): `GET /solutioncomponents?$filter=_solutionid_value eq f1c2d3e4-0000-0000-0000-aaaabbbbcccc and componenttype eq 1&$select=objectid`
   → `{"value":[{"solutioncomponentid":"11111111-...","objectid":"9a8b7c6d-1111-2222-3333-444455556666"},{"solutioncomponentid":"22222222-...","objectid":"0f1e2d3c-7777-8888-9999-aaaabbbbcccc"}]}`
3. **Resolve each table's logical/set names from its `MetadataId`:** `GET /EntityDefinitions(9a8b7c6d-1111-2222-3333-444455556666)?$select=LogicalName,EntitySetName,DisplayName,PrimaryIdAttribute,PrimaryNameAttribute`
   → `{"LogicalName":"pmo_project","EntitySetName":"pmo_projects","PrimaryIdAttribute":"pmo_projectid","PrimaryNameAttribute":"pmo_name","DisplayName":{"UserLocalizedLabel":{"Label":"Project"}}}`
   > `EntitySetName` (plural, `pmo_projects`) goes in CRUD paths; `LogicalName` (singular, `pmo_project`) is for `$filter`/`$select`/metadata; `PrimaryIdAttribute` is the GUID column; `PrimaryNameAttribute` the human label.
4. **Prefix known → enumerate tables directly:** `GET /EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName,IsCustomEntity&$filter=startswith(LogicalName,'pmo_')`
5. **Find the publisher prefix:** `GET /publishers?$select=customizationprefix,friendlyname`
   → `{"value":[{"customizationprefix":"pmo","friendlyname":"EPM Partners"}]}`

## $metadata — the schema document

`GET {environment_url}/api/data/v9.2/$metadata` (use `Accept: application/xml`) returns the OData CSDL XML describing every `EntityType`, property, data type, navigation property, action, and function. The authoritative runtime source for PMO365's real `pmo_*` field names/types — never hardcode. For a single table's attribute metadata: `GET /EntityDefinitions(LogicalName='pmo_project')/Attributes?$select=LogicalName,AttributeType,RequiredLevel`.

## Endpoint Catalog

**Records** (per resolved entity set, e.g. `pmo_projects`):
| # | Method | Path | Purpose | Idempotent | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | GET | `/{entityset}` | list / query records | yes | server-driven paging; `$select`/`$filter`/`$top`/`$expand` |
| 2 | GET | `/{entityset}({id})` | get one record by GUID | yes | `$select`/`$expand` supported |
| 3 | GET | `/{entityset}({id})?$select=field` | get one property | yes | |
| 4 | POST | `/{entityset}` | create record | no | `204` + `OData-EntityId` header (or `201` w/ `Prefer: return=representation`) |
| 5 | PATCH | `/{entityset}({id})` | **upsert** (update, or create if GUID absent) | yes* | send `If-Match: *`to force update-only |
| 6 | PATCH |`/{entityset}(altkey='value')`| upsert by alternate key | yes* | requires an alternate key on the table |
| 7 | DELETE |`/{entityset}({id})`| delete record | yes |`204`on success |
| 8 | DELETE |`/{entityset}({id})/{property}`| clear a single property | yes | |
| 9 | POST |`/{entityset}({id})/Microsoft.Dynamics.CRM.{ActionName}`| call a **bound action** | depends | custom/built-in business operations; full namespace required |
| 10 | GET |`/{entityset}({id})/Microsoft.Dynamics.CRM.{FunctionName}` | call a **bound function** | yes | read-only operations |

\* PATCH is **UPSERT** — creates the row if the GUID doesn't exist. Use `If-Match: *` for update-only.

**Discovery / Metadata:**
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/solutions` | find the PMO365 solution (discovery step 1) |
| GET | `/solutioncomponents` | list a solution's component tables (`componenttype eq 1`) |
| GET | `/publishers` | read the publisher customization prefix |
| GET | `/EntityDefinitions` | list/enumerate tables (filter by prefix) |
| GET | `/EntityDefinitions({metadataid})` | resolve one table's logical/set names (discovery step 3) |
| GET | `/EntityDefinitions(LogicalName='x')/Attributes` | list a table's columns + types |
| GET | `/$metadata` | full CSDL schema document (XML) |
| GET | `/WhoAmI` | current user/org GUIDs — first-call identity smoke test (unbound function) |

## Data Models

> All `pmo_*` names ILLUSTRATIVE [INFERRED] — resolve real `LogicalName`/`EntitySetName`/columns via discovery + `$metadata`.

**Record identity (every Dataverse row):**
| Field | Type | Notes |
| --- | --- | --- |
| `{logicalname}id` | GUID (string) | PK, server-assigned, immutable (e.g. `pmo_projectid`) |
| `createdon` | datetime (ISO-8601 UTC) | system |
| `modifiedon` | datetime (ISO-8601 UTC) | system; use for polling deltas |
| `statecode` | integer (state) | record state machine (active/inactive) |
| `statuscode` | integer (status) | status reason; **valid values depend on `statecode`** |
| `_ownerid_value` | GUID lookup | owning user/team; exposed as `_..._value` |

**Lookups, option sets, labels:**

- **Lookups:** the FK GUID is exposed on read as **`_{logicalname}_value`** (e.g. `_pmo_owningprogram_value`). To pull the related row, `$expand` the nav property (e.g. `$expand=pmo_OwningProgram($select=pmo_name)`). The display name appears only with `Prefer: odata.include-annotations="*"` (as `..._value@OData.Community.Display.V1.FormattedValue`).
- **Option sets (choices):** stored and written as **integers**; the label comes from the formatted-value annotation. Resolve allowed values via `EntityDefinitions(...)/Attributes`.
- **State / status:** `statecode` + `statuscode`; `statuscode` is a state machine — which values are legal depends on the current `statecode`.

**Illustrative table — `pmo_project` [INFERRED]:**
| Field | Type | Notes |
| --- | --- | --- |
| `pmo_projectid` | GUID | PK |
| `pmo_name` | string | likely `PrimaryNameAttribute` |
| `_pmo_owningprogram_value` | GUID lookup | lookup to a program table |
| `pmo_status` | option set | integer choice |
| `createdon` / `modifiedon` | datetime | system columns (real, on every table) |

> Confirm everything via discovery. Other plausible tables (`pmo_risk`, `pmo_milestone`, `pmo_task`, `pmo_program`) are equally [INFERRED] placeholders.

## Querying (OData v4, read)

Supported: `$select`, `$filter`, `$orderby`, `$top`, `$expand`, `$count=true`, `$apply` (aggregation / `groupby`). `$filter` operators: `eq ne gt ge lt le`, `and or not`, and string functions `contains()`/`startswith()`/`endswith()`. Dates ISO-8601 UTC, unquoted in `$filter`.

```
GET /pmo_projects?$select=pmo_name,pmo_status,modifiedon&$filter=pmo_status eq 1 and modifiedon gt 2026-05-01T00:00:00Z&$orderby=modifiedon desc&$top=50
Prefer: odata.maxpagesize=50,odata.include-annotations="*"
```

→ `{"@odata.context":"https://contoso.crm.dynamics.com/api/data/v9.2/$metadata#pmo_projects(pmo_name,pmo_status,modifiedon)","value":[{"@odata.etag":"W/\"123456789\"","pmo_name":"Harbour Bridge Refit","pmo_status":1,"pmo_status@OData.Community.Display.V1.FormattedValue":"In Flight","modifiedon":"2026-05-28T21:14:03Z","pmo_projectid":"9a8b7c6d-1111-2222-3333-444455556666"}],"@odata.nextLink":"https://contoso.crm.dynamics.com/api/data/v9.2/pmo_projects?$select=pmo_name,pmo_status,modifiedon&$skiptoken=%3Ccookie..."}`

> **Text search:** use `$filter contains()`. Relevance/full-text **`$search`** is a **separate Dataverse Search API** (`/api/search`, different rules, ~1 req/sec/user throttle) — NOT the Web API query surface. Don't reach for it from `connect_request`.

## Pagination

Server-driven via `@odata.nextLink` (opaque `$skiptoken`); no client-controlled offset for large sets. Default page size server-decided (commonly 5000 standard / 500 elastic if unset). Max 5000 via `Prefer: odata.maxpagesize=N` (elastic caps 500). `$count=true` adds `@odata.count`, but **caps at 5,000** (standard) / 500 (elastic) regardless of page size — not the true total beyond that cap; detect truncation via the `Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded` annotation. `$top` = hard cap on total rows (small sets only). **Last page = `@odata.nextLink` absent.** ❌ Do NOT hand-roll `$skip` — Dataverse is server-driven; follow `@odata.nextLink` verbatim until gone.

## Mutation (OData v4, write)

**Create** — `POST /{entityset}`:

```
POST /pmo_projects   Content-Type: application/json
{"pmo_name":"Coastal Resilience Programme","pmo_status":1}
```

→ `HTTP/1.1 204 No Content` + `OData-EntityId: https://contoso.crm.dynamics.com/api/data/v9.2/pmo_projects(0f1e2d3c-7777-8888-9999-aaaabbbbcccc)`. Add `Prefer: return=representation` for `201 Created` + body.

**Update** — `PATCH /{entityset}({id})`. PATCH is **upsert** (creates if absent); send `If-Match: *` for update-only:

```
PATCH /pmo_projects(0f1e2d3c-7777-8888-9999-aaaabbbbcccc)   Content-Type: application/json   If-Match: *
{"pmo_status":2}
```

→ `204 No Content` (or `200` + body with `Prefer: return=representation`).

**Set a lookup on write** — bind by nav property + target entity set + GUID: `{"pmo_name":"Phase 2","pmo_OwningProgram@odata.bind":"/pmo_programs(11112222-3333-4444-5555-666677778888)"}`

**Delete** — `DELETE /{entityset}({id})` → `204 No Content`.
**Bound action / function** — `POST /{entityset}({id})/Microsoft.Dynamics.CRM.{ActionName}` with an optional JSON parameter body.
**Alternate-key upsert** — `PATCH /{entityset}(altkey='value')` when the table defines an alternate key (upsert without first knowing the GUID).

## Rate Limits — service protection API limits

Per user, sliding 5-minute (300s) window, three facets evaluated independently:
| Facet | Limit (per user, 5-min sliding window) | Hex on breach |
| --- | --- | --- |
| Number of requests | ~6,000 requests | `0x80072322` |
| Combined exec time | ~20 minutes (1,200,000 ms) of combined request-execution time | `0x80072321` |
| Concurrent requests | ~52 concurrent requests (exceeding → immediate 429) | `0x80072326` |

Platform defaults; can vary by environment. Don't pin logic to the numbers — react to `429` + `Retry-After`.
**Headers:** `Retry-After` (on 429 — seconds to wait, **MUST honor**); `x-ms-ratelimit-burst-remaining-xrm-requests` + `x-ms-ratelimit-time-remaining-xrm-requests` (debug only — don't gate on them).
**When exceeded:** `429 Too Many Requests` + `Retry-After` (seconds).
**Strategy:** (1) honor `Retry-After` exactly. (2) avoid tight loops / parallel fan-out. (3) exponential backoff with jitter only if `Retry-After` is absent. (4) surface to the user after repeated 429s.

## Error Handling

```json
{
  "error": {
    "code": "0x80040217",
    "message": "pmo_project With Id = 0f1e2d3c-7777-8888-9999-aaaabbbbcccc Does Not Exist"
  }
}
```

`code` is a Dataverse hex error code (NOT the HTTP status; may be empty). `Prefer: odata.include-annotations="*"` adds `@Microsoft.PowerApps.CDS.*` detail annotations (help link, inner error, trace).
| Status | Meaning | Retryable | Recovery |
| --- | --- | --- | --- |
| 200 | OK (body returned) | — | — |
| 201 | Created (`return=representation`) | — | — |
| 204 | No Content (write succeeded) | — | read `OData-EntityId` header for the new row URL |
| 400 | bad request / invalid `$filter` | No | fix query, field names, OData syntax |
| 401 | token expired / invalid | Yes (1) | backend refreshes + retries once; 2nd 401 → user reconnects |
| 403 | missing privilege | No | App user's security role lacks read/write on the table |
| 404 | record or wrong `EntitySetName` | No | re-resolve via discovery; verify GUID + plural set name |
| 405 | method/resource mismatch | No | e.g. DELETE/PATCH on a collection — fix the path |
| 412 | `If-Match` precondition failed | Maybe | ETag/concurrency conflict — re-fetch and retry |
| 413 | payload too large | No | reduce body / split the operation |
| 429 | service-protection limit | Yes | **honor `Retry-After`**, then retry |
| 5xx | server error / unavailable | Yes | retry with backoff |

Common hex codes: `0x80040217` (record does not exist), `0x80040265` (plug-in / business error), `0x80072322`/`0x80072321`/`0x80072326` (the three service-protection limits). Full reference: `01d-event-and-error-handling.md`.

## Webhooks / Events

Dataverse natively supports **webhooks**, **Service Endpoints** (Azure messaging), and **Power Automate** triggers. But the Numa PMO365 connector exposes **NO Numa-hosted receiver yet** — no public endpoint to register against. **Current approach: polling.** Filter on `modifiedon`, order by it:

```
GET /pmo_projects?$select=pmo_name,modifiedon&$filter=modifiedon gt 2026-05-29T00:00:00Z&$orderby=modifiedon asc
Prefer: odata.maxpagesize=200
```

Persist the high-water `modifiedon` between polls; interval **≥5 min**; walk `@odata.nextLink` to drain each poll. Full detail in `01d`.

## Known Limitations

1. **No PMO365 API and no public PMO365 schema.** All real `pmo_*` names are proprietary — obtain at runtime via discovery / `$metadata`. Never hardcode.
2. **No global table list worth scanning.** Discover the **solution** first, then its component tables, then resolve names.
3. **`EntitySetName` (plural) ≠ `LogicalName` (singular).** CRUD paths need the plural set name; `$select`/`$filter`/metadata use the singular logical name. Mixing → 404/400.
4. **PATCH is upsert.** Forgetting `If-Match: *` can silently create an orphan record instead of failing on a bad GUID.
5. **Lookups read as `_x_value` (GUID only).** Display names require `Prefer: odata.include-annotations="*"` or an `$expand`.
6. **Option sets / state are integers.** Labels aren't in the raw value; `statuscode` legality depends on `statecode`.
7. **Server-driven paging only.** `$skip` is not a reliable way to walk large sets — follow `@odata.nextLink`.
8. **`$search` is a different API** (`/api/search`, 1 req/sec/user) — not on the Web API query surface. Use `$filter contains()`.
9. **No connector-hosted webhooks yet** — polling only, ≥5 min interval.
10. **Strict per-user service protection limits** — 429s carry a mandatory `Retry-After`.

## SDKs & Tooling

| SDK / Tool                                 | Language | Source                  | Quality | Notes                                           |
| ------------------------------------------ | -------- | ----------------------- | ------- | ----------------------------------------------- |
| `Microsoft.PowerPlatform.Dataverse.Client` | .NET     | NuGet (Microsoft)       | good    | official; handles 429/Retry-After automatically |
| Dataverse Web API (raw HTTP)               | any      | —                       | n/a     | **What Numa uses** — `connect_request` + httpx  |
| Postman: Dataverse Web API collection      | n/a      | Microsoft Learn samples | good    | useful for manual probing                       |

No vendor SDK — all calls are raw HTTP through `connect_request`. OpenAPI: none — use the OData `$metadata` CSDL.

## Integration Path Assessment

**Recommended: Direct API Only.**

- Dataverse is a structured-records platform (projects, programs, risks, milestones), not a file tree — it doesn't fit the "browse files" Data Connector UX.
- All value comes from the agent issuing OData calls via `connect_request`: discover → query → create/update.
- `surfaces: ['chat']` in the connector registry keeps PMO365 out of Files > Remote.

Connector-method feasibility (all **none** — no file model): `list_files`, `download_file` (notes/attachments only), `search_files` (record query, not file search), `get_file_metadata`.

Any HTTP client that performs the Entra `authorization_code` flow against `organizations` with scope `{environment_url}/.default offline_access`, injects `Authorization: Bearer {token}` + the required OData headers, and targets `{environment_url}/api/data/v9.2/` can drive the entire surface. No vendor SDK required. (Numa-internal wiring — vault keys, registry entries — lives in the connector skill and Numa-side docs, not here.)

## Sources

- Dataverse Web API (OData v4): https://learn.microsoft.com/power-apps/developer/data-platform/webapi/overview
- Query data with the Web API: https://learn.microsoft.com/power-apps/developer/data-platform/webapi/query-data-web-api
- Create / Update / Delete via Web API: https://learn.microsoft.com/power-apps/developer/data-platform/webapi/create-entity-web-api
- Service protection (API) limits: https://learn.microsoft.com/power-apps/developer/data-platform/api-limits
- Web API EntityType / EntityDefinitions metadata: https://learn.microsoft.com/power-apps/developer/data-platform/webapi/query-metadata-web-api
- OAuth with Dataverse: https://learn.microsoft.com/power-apps/developer/data-platform/authenticate-oauth
- PMO365 (EPM Partners): https://www.pmo365.com/

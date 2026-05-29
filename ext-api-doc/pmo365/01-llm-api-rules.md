---
api_name: 'PMO365'
api_slug: 'pmo365'
version: 'Dataverse Web API v9.2 (OData v4)'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# PMO365 -- Workspace Agent API Rules

> Loaded into the workspace agent's context when the PMO365 integration is active.
> Companion files (01a–01d) carry the detailed reference. Keep this one ≤300 lines.

## Context

- **PMO365 has NO API of its own.** It is a Project Portfolio Management solution by EPM Partners built on the Microsoft Power Platform. Its data lives in the customer's **Microsoft Dataverse** environment (the same store behind Dynamics 365 / Project for the web). **You integrate by talking to the Dataverse Web API.**
- **API:** Microsoft Dataverse Web API — OData v4, JSON.
- **Base URL:** `{environment_url}/api/data/v9.2/` where `environment_url = https://{org}.crm.dynamics.com`. Admin-configured, workspace-wide, stored in the connector's `environment_url` credential field. The backend expands every relative path you pass against this base.
- **Auth:** Entra ID (Azure AD) OAuth 2.0, authorization-code + refresh. Standard `Bearer` header.
- **Integration path:** Direct API Only — all interactions through `connect_request`.
- **Rate model:** Dataverse service-protection limits (per-user, sliding 5-min window). 429 carries `Retry-After`. See 01d.

## DISCOVERY FIRST — this is the whole game

There is **no global "list PMO365 tables" call**. PMO365 is a Dataverse **solution**: a bundle of custom tables sharing one publisher **customization prefix** (e.g. `pmo_*`). Standard Dataverse/Dynamics tables do NOT carry that prefix. **Real PMO365 table/column names are proprietary and undocumented — you MUST discover them at runtime. Never assume `pmo_project`/`pmo_risk` exist; they are illustrative until a discovery query confirms them.**

Discovery sequence (run before any business query):

1. **Find the solution** → get its `solutionid`:
   `GET /solutions?$select=solutionid,uniquename,friendlyname,version&$filter=contains(uniquename,'pmo') or contains(friendlyname,'pmo')`
2. **List its tables** (componenttype 1 = Entity; `objectid` = table MetadataId):
   `GET /solutioncomponents?$filter=_solutionid_value eq {solutionid} and componenttype eq 1&$select=objectid`
3. **Resolve a table** by MetadataId → get the all-important `EntitySetName` (plural, used in URLs):
   `GET /EntityDefinitions({metadataid})?$select=LogicalName,EntitySetName,DisplayName,PrimaryIdAttribute,PrimaryNameAttribute`
4. **Or, once the prefix is known**, list custom tables directly:
   `GET /EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName,IsCustomEntity&$filter=startswith(LogicalName,'pmo_')`
5. **Publisher prefix** (when unsure): `GET /publishers?$select=customizationprefix,friendlyname`.
6. **Full schema** (CSDL): `{environment_url}/api/data/v9.2/$metadata`.

> `LogicalName` (singular, e.g. `pmo_project`) is for metadata/`$filter`; **`EntitySetName` (plural, e.g. `pmo_projects`) is what goes in the URL.** Confusing the two causes 404s.

## Auth Structure

```
Authorization: Bearer {access_token}
```

Standard `Bearer` — NOT a custom scheme. Authority is the **`organizations`** tenant endpoint:

- authUrl: `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize`
- tokenUrl: `https://login.microsoftonline.com/organizations/oauth2/v2.0/token`
- scope: `{environment_url}/.default offline_access` (environment-specific host)

**Token lifecycle:**

- Access token ~1 hour. Backend refreshes via the admin-configured token URL using `offline_access`.
- On `401`, backend refreshes and retries **once**; a second 401 fails the tool call — user must reconnect.
- `403` is a **privilege** problem (Application User's security role), not a token problem — do not retry, surface it.

## Required Headers

Always send on reads: `OData-MaxVersion: 4.0`, `OData-Version: 4.0`, `Accept: application/json`.
On writes also: `Content-Type: application/json`.

| Need                                | Header                                  |
| ----------------------------------- | --------------------------------------- |
| Readable lookup / option-set labels | `Prefer: odata.include-annotations="*"` |
| Control page size (≤5000)           | `Prefer: odata.maxpagesize=N`           |
| Force update-only PATCH (no upsert) | `If-Match: *`                           |
| Get created row back on POST        | `Prefer: return=representation`         |

## Capabilities

### CAN

1. Discover the PMO365 solution, its tables, their `EntitySetName`s, and column metadata at runtime (`/solutions`, `/solutioncomponents`, `/EntityDefinitions`, `$metadata`).
2. Query any discovered table with OData: `$select`, `$filter`, `$orderby`, `$top`, `$expand`, `$count=true`, `$apply` (groupby/aggregate).
3. Create (`POST`), update (`PATCH`), and delete (`DELETE`) rows; set lookups via `@odata.bind`.
4. Expand lookups to pull related rows and get formatted display names via the annotations Prefer header.
5. Call bound actions/functions: `POST /{entityset}({id})/Microsoft.Dynamics.CRM.{ActionName}`.

### CANNOT

1. Upload binary attachments/files — `connect_request` sends JSON only. Direct the user to the PMO365/Dynamics UI.
2. Subscribe to live events — Dataverse supports webhooks/Service Endpoints/Power Automate, but Numa exposes **no receiver yet**. Use polling.
3. Use Dataverse relevance/`$search` — that is a separate search API, not the Web API. For text matching use `$filter contains()`.
4. Query a different environment — `environment_url` is fixed per connection by the admin.

## Critical Gotchas

1. **Discover before you query.** Never hardcode table or column names. `pmo_project`, `pmo_risk`, etc. are **illustrative only** — confirm each via the discovery queries / `$metadata` before use. A guessed name 404s.
2. **`EntitySetName` (plural) in URLs, `LogicalName` (singular) in metadata/`$filter`.** Mixing them is the #1 cause of 404s.
3. **PATCH is UPSERT.** `PATCH /{entityset}({id})` **creates the row if the id is absent.** Send `If-Match: *` to force update-only and avoid accidental creates.
4. **Lookups read as `_{logicalname}_value`** (the raw GUID). To get the related row's data, `$expand` the navigation property. To get its display label, add the annotations Prefer header.
5. **Pagination is server-driven.** Follow `@odata.nextLink` **verbatim** until it's absent. Control page size with `Prefer: odata.maxpagesize` (max 5000). Do NOT hand-roll `$skip` for large sets.
6. **Set lookups on write with `@odata.bind`,** not the `_value` field: `"{nav}@odata.bind": "/{targetentityset}({guid})"`.
7. **Status is a state machine.** `statecode` (state) gates which `statuscode` (reason) values are legal. Option sets are integers — fetch valid values from metadata, don't guess.
8. **Honour `Retry-After` on 429.** Service-protection limits are real and per-user. Never tight-loop.
9. **GUIDs are opaque strings** (`f1a2…`), no braces in URLs: `/pmo_projects(f1a2b3c4-...)`.
10. **No `/me` shortcut for the table list.** Discovery (above) is the only way to enumerate PMO365 tables.

## Default Parameters

| Parameter                           | Default                                 | Reason                                                      |
| ----------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| `Prefer: odata.maxpagesize`         | `100`                                   | Keep payloads sane; bump only when the user wants bulk.     |
| `Prefer: odata.include-annotations` | `"*"` on reads with lookups/option sets | Get human-readable labels, not just GUIDs/ints.             |
| `$select`                           | name + key + dates, never `*`           | Dataverse penalises wide reads; pick columns from metadata. |
| `$orderby`                          | `modifiedon desc`                       | Freshest-first is what users expect.                        |
| `If-Match`                          | `*` on every PATCH                      | Prevent accidental upsert-create.                           |

## Working Examples

> `pmo_*` names below are ILLUSTRATIVE — they are what discovery _typically_ returns, not confirmed. Always run the discovery step in the same session first.

### Example 1: Discover the PMO365 solution and its tables

```http
GET /solutions?$select=solutionid,uniquename,friendlyname,version&$filter=contains(uniquename,'pmo') or contains(friendlyname,'pmo') HTTP/1.1
Accept: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0
```

```json
{
  "value": [
    {
      "solutionid": "8d9c0f12-3a4b-4c5d-9e6f-001122334455",
      "uniquename": "pmo365core",
      "friendlyname": "PMO365",
      "version": "4.2.1.0"
    }
  ]
}
```

Then resolve a table's `EntitySetName` from a solution component's `objectid`:

```http
GET /EntityDefinitions(2b7e1f99-...)?$select=LogicalName,EntitySetName,DisplayName,PrimaryIdAttribute,PrimaryNameAttribute HTTP/1.1
```

```json
{
  "LogicalName": "pmo_project",
  "EntitySetName": "pmo_projects",
  "PrimaryIdAttribute": "pmo_projectid",
  "PrimaryNameAttribute": "pmo_name",
  "DisplayName": { "UserLocalizedLabel": { "Label": "Project" } }
}
```

### Example 2: Query active projects with a lookup expanded + readable labels

```http
GET /pmo_projects?$select=pmo_name,pmo_startdate,modifiedon,statecode&$filter=statecode eq 0 and modifiedon gt 2026-05-01T00:00:00Z&$orderby=modifiedon desc&$expand=pmo_ProgramId($select=pmo_name) HTTP/1.1
Accept: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0
Prefer: odata.include-annotations="*", odata.maxpagesize=100
```

```json
{
  "value": [
    {
      "pmo_projectid": "f1a2b3c4-5d6e-7f80-9a1b-2c3d4e5f6071",
      "pmo_name": "ERP Migration",
      "pmo_startdate": "2026-04-15",
      "modifiedon": "2026-05-28T09:14:22Z",
      "statecode": 0,
      "statecode@OData.Community.Display.V1.FormattedValue": "Active",
      "_pmo_programid_value": "aa11bb22-cc33-dd44-ee55-ff6677889900",
      "pmo_ProgramId": { "pmo_name": "Digital Transformation" }
    }
  ],
  "@odata.nextLink": "https://contoso.crm.dynamics.com/api/data/v9.2/pmo_projects?$select=...&$skiptoken=..."
}
```

Follow `@odata.nextLink` verbatim for the next page; stop when it is absent.

### Example 3: Create a project, setting a lookup via @odata.bind

```http
POST /pmo_projects HTTP/1.1
Content-Type: application/json
Accept: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0

{
  "pmo_name": "Warehouse Automation",
  "pmo_startdate": "2026-06-01",
  "pmo_ProgramId@odata.bind": "/pmo_programs(aa11bb22-cc33-dd44-ee55-ff6677889900)"
}
```

```http
HTTP/1.1 204 No Content
OData-EntityId: https://contoso.crm.dynamics.com/api/data/v9.2/pmo_projects(7c9d0e1f-2a3b-4c5d-6e7f-8091a2b3c4d5)
```

The new row's GUID is in the `OData-EntityId` header. Add `Prefer: return=representation` to get `201` + the full row body instead.

### Example 4: Update-only PATCH (no accidental create)

```http
PATCH /pmo_projects(7c9d0e1f-2a3b-4c5d-6e7f-8091a2b3c4d5) HTTP/1.1
Content-Type: application/json
If-Match: *

{ "pmo_name": "Warehouse Automation (Phase 2)" }
```

```http
HTTP/1.1 204 No Content
```

If the id does not exist, `If-Match: *` yields `404` instead of silently creating a row.

## Proxy API Operations

| Operation          | Method  | Path                                                  | Notes                                                                       |
| ------------------ | ------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Find solution      | GET     | `/solutions`                                          | `$filter contains(...)` — discovery step 1                                  |
| Solution tables    | GET     | `/solutioncomponents`                                 | `$filter _solutionid_value eq, componenttype eq 1`; `objectid` = MetadataId |
| Resolve table      | GET     | `/EntityDefinitions({metadataid})`                    | Get the `EntitySetName` for URLs                                            |
| List custom tables | GET     | `/EntityDefinitions`                                  | `$filter startswith(LogicalName,'pmo_')`                                    |
| Publisher prefix   | GET     | `/publishers`                                         | `$select customizationprefix`                                               |
| Query / get / agg  | GET     | `/{entityset}` · `/{entityset}({id})` · `?$apply=...` | `$select,$filter,$orderby,$top,$expand`                                     |
| Create             | POST    | `/{entityset}`                                        | 204 + `OData-EntityId` header                                               |
| Update             | PATCH   | `/{entityset}({id})`                                  | UPSERT unless `If-Match: *`                                                 |
| Delete             | DELETE  | `/{entityset}({id})`                                  | Hard delete                                                                 |
| Set lookup         | (write) | body `"{nav}@odata.bind": "/{set}({guid})"`           | Not the `_value` field                                                      |
| Bound action       | POST    | `/{entityset}({id})/Microsoft.Dynamics.CRM.{Action}`  | e.g. state transitions                                                      |
| Alt-key upsert     | PATCH   | `/{entityset}(altkey='value')`                        | When an alternate key exists                                                |
| Schema (CSDL)      | GET     | `/$metadata`                                          | Full table/column definitions                                               |

## Pagination

- **Type:** server-driven (cursor in `@odata.nextLink`).
- **Default page size:** set via `Prefer: odata.maxpagesize=N`. **Max:** 5000.
- **How to paginate:** issue the first request, then GET `@odata.nextLink` **verbatim** (it carries an opaque `$skiptoken`).
- **Last page detection:** response has **no** `@odata.nextLink`.

```http
GET /pmo_projects?$select=pmo_name&$orderby=modifiedon desc
Prefer: odata.maxpagesize=100
→ body has "@odata.nextLink": ".../pmo_projects?...&$skiptoken=..."

GET .../pmo_projects?...&$skiptoken=...   (follow verbatim)
→ no "@odata.nextLink" → done
```

Do NOT hand-roll `$skip` for large sets — Dataverse server paging is the supported path.

## Webhooks / Events

Dataverse supports webhooks / Service Endpoints / Power Automate triggers, but **Numa's PMO365 connector exposes no Numa-hosted receiver yet.** Use polling:

```http
GET /pmo_projects?$select=pmo_name,modifiedon&$filter=modifiedon gt 2026-05-29T09:00:00Z&$orderby=modifiedon desc
Prefer: odata.maxpagesize=100
```

Track the max `modifiedon` seen as the next watermark. Interval **≥5 minutes** — service-protection limits make tighter polling self-defeating.

## Error Handling

**Standard error format:**

```json
{ "error": { "code": "0x80040217", "message": "pmo_project With Id = ... Does Not Exist" } }
```

**Recovery by status:**

| Status | Meaning               | Action                                                                                                                         |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 400    | Bad query / `$filter` | Fix syntax; check `LogicalName` vs `EntitySetName`; re-check `$metadata`                                                       |
| 401    | Token expired         | Backend refreshes + retries once; if re-raised, user reconnects                                                                |
| 403    | Missing privilege     | Application User's security role lacks read/write on the table — admin fix                                                     |
| 404    | Not found             | Wrong `EntitySetName` or row GUID; or `If-Match: *` PATCH on a missing row (update-only guard worked) — re-run discovery       |
| 412    | Precondition failed   | `If-None-Match: *` create-only but the row already exists, or an `If-Match: W/"<etag>"` ETag mismatch (optimistic concurrency) |
| 429    | Service protection    | **Honour `Retry-After` (seconds)**, then retry; never tight-loop                                                               |
| 5xx    | Server error          | Retry with exponential backoff                                                                                                 |

Service-protection limits (per user, sliding 5-min window) have three distinct facets: ~6000 requests / 5 min, ~20 minutes (1,200,000 ms) of combined request-execution time / 5 min, and a concurrency cap of ~52 concurrent requests. (52 is the concurrency cap, NOT 52 seconds of execution time.) On 429 honour the `Retry-After` header (seconds). Always show the user the `error.message` verbatim — don't paraphrase.

## Known Limitations

1. **PMO365 table/column names are proprietary** and not publicly documented. Discovery + `$metadata` are the only authoritative source. Mark them `[INFERRED]` at best until confirmed in-session.
2. JSON-only request path — no file/attachment upload from chat.
3. No live event delivery yet — polling on `modifiedon` only.
4. No relevance/`$search`; text matching is `$filter contains()`.
5. Single environment per connection (`environment_url` fixed by admin).

---

_Companions: 01a domain model (discovery deep-dive, solution/table model, statecode/statuscode) · 01b query patterns (`$filter`, `$expand`, `$apply`, annotations, server paging) · 01c mutation patterns (create, PATCH-upsert, `@odata.bind`, bound actions, alt-key upsert) · 01d events & errors (polling, service-protection limits, error recovery)._

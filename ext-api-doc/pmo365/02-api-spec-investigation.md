---
api_name: 'PMO365 (Microsoft Dataverse)'
api_slug: 'pmo365'
base_url: '{environment_url}/api/data/v9.2/'
version: 'v9.2'
spec_format: 'OData v4 ($metadata CSDL)'
spec_url: '{environment_url}/api/data/v9.2/$metadata'
docs_url: 'https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview'
date_researched: '2026-05-29'
---

# PMO365 (Microsoft Dataverse) -- API Specification & Investigation

> Developer-facing condensed reference. Everything needed to implement or extend the
> PMO365 integration, in one page. Derived from `00-api-investigation-questionnaire.md`.
>
> **Read this first:** PMO365 has **no API of its own.** It is a Project Portfolio
> Management solution by EPM Partners built on the Microsoft Power Platform. Its data
> lives in the customer's **Microsoft Dataverse** environment (the same datastore behind
> Dynamics 365 and Project for the web). You integrate by talking to the **Dataverse
> Web API** — OData v4, JSON. Every table/field name in this doc that starts with `pmo_`
> is an **illustrative example only** ([INFERRED]); PMO365's real schema is proprietary
> and **not publicly documented**. The discovery queries in this file are how the real
> names are obtained at runtime. Treat discovery-first as the governing theme.

---

## Overview

- **Vendor:** EPM Partners (PMO365 solution) on Microsoft Power Platform / Microsoft Dataverse
- **API:** Microsoft Dataverse Web API — OData v4, JSON
- **API version:** `v9.2` (current Dataverse Web API minor version; pin it explicitly)
- **Base URL (environment-pinned):** `{environment_url}/api/data/v9.2/`
  - `environment_url = https://{org}.crm.dynamics.com` (admin-configured, workspace-wide)
  - Stored in the connector's `environment_url` credential field. All relative paths the
    agent emits are expanded against this base by the backend `connect_request` path.
  - Region is encoded in the host (`crm` = North America, `crm2` = SAM, `crm7` = Japan,
    etc.); the admin supplies the full host so you never construct it.
- **Sandbox:** Dataverse sandbox environments have their own `{org}.crm.dynamics.com`
  host — same URL shape, different org. No separate base-URL pattern.
- **API type:** REST / OData v4
- **Data format:** JSON
- **Documentation:** [Use the Dataverse Web API](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview)
- **API reference:** [Web API EntityType / Action / Function reference](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/about)
- **OpenAPI spec:** Not an OpenAPI/Swagger doc — the machine-readable schema is the OData
  CSDL `$metadata` document (see [§ $metadata](#metadata-the-schema-document)).
- **Status page:** [Microsoft 365 / Power Platform Service health](https://admin.microsoft.com/Adminportal/Home#/servicehealth) (tenant-scoped, admin only)

**Summary:** Dataverse is Microsoft's managed, multi-tenant data backbone for the Power
Platform. The Web API exposes every table in the environment as an OData v4 entity set
with full CRUD, OData query (`$select`/`$filter`/`$expand`/`$orderby`/`$apply`), bound
actions/functions, and a complete `$metadata` schema document. PMO365 ships as a
**solution** — a bundle of custom tables sharing one publisher customization prefix
(e.g. `pmo_*`) — layered into the customer's environment. There is no global "list all
PMO365 tables" endpoint; you discover the solution and its tables at runtime.

---

## Authentication

### Method: OAuth 2.0 (Microsoft Entra ID) — authorization code + refresh

Standard OAuth 2.0 `authorization_code` flow against Microsoft Entra ID (Azure AD),
using the **`organizations`** authority so any work/school tenant can consent. Access
token lives ~1 hour; a refresh token is issued because `offline_access` is requested.

**Header format:**

```
Authorization: Bearer {access_token}
```

This is the **standard `Bearer` scheme** — NOT a custom scheme. (Contrast Zoho CRM,
which uses `Zoho-oauthtoken`.) Build the header verbatim as `Bearer <token>`.

### OAuth 2.0 Details

| Parameter         | Value                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Grant type        | `authorization_code` (also `refresh_token`)                                                            |
| Authority         | `organizations` (multi-tenant work/school; not `common`, not `consumers`)                              |
| Authorization URL | `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize`                                |
| Token URL         | `https://login.microsoftonline.com/organizations/oauth2/v2.0/token`                                    |
| Revocation URL    | No dedicated revoke endpoint — revoke via Entra admin (app consent / refresh-token revocation)         |
| Access token TTL  | ~1 hour                                                                                                |
| Refresh mechanism | `offline_access` returns a refresh token; backend refreshes on 401 and retries once (see below)        |
| PKCE required     | Recommended for public clients; Numa runs as a confidential client (client secret), PKCE not mandatory |

### Required Scope

Dataverse uses a single **environment-specific** resource scope plus `offline_access`:

| Scope                        | Purpose                                                                          | Required? |
| ---------------------------- | -------------------------------------------------------------------------------- | --------- |
| `{environment_url}/.default` | All delegated permissions the app is consented for on this Dataverse environment | yes       |
| `offline_access`             | Issue a refresh token so the backend can renew silently                          | yes       |

> ⚠️ **Scope host is environment-specific and the wizard does NOT interpolate credential
> fields into scopes.** The admin edits the scope host by hand in the wizard's **Advanced**
> section (e.g. swaps `https://contoso.crm.dynamics.com/.default`). The wizard only
> interpolates `authUrl` / `tokenUrl` — never the scope string. Get the host right or
> consent fails / tokens are issued for the wrong audience.

### Entra app setup (admin, one-time)

1. **App registration** in the customer's Entra tenant (or Arcanum's, with admin consent
   in the customer tenant).
2. **Delegated permission:** `Dynamics CRM` → `user_impersonation`.
3. **Admin consent** granted for the permission.
4. **Dataverse Application User** mapped to the app registration, assigned a **security
   role** that grants read/write on the PMO365 tables. Without this, tokens authenticate
   but every data call returns `403` (`PrincipalPrivilegeDenied`).

### Token lifecycle (runtime)

- Access token ~1h. On `401` (`ExpiredAuthTicket` / `InvalidAuthTicket`), the backend
  refreshes via the token URL and **retries the call once**.
- A **second `401`** after refresh → fail the tool call; the user must reconnect.

### Integration path: Direct API Only

All calls go through `connect_request` — the backend's single egress for this connector.
The agent supplies a **method + relative path + optional JSON body**; the backend injects
the `Authorization: Bearer` header, the required OData headers, expands the relative path
against `{environment_url}/api/data/v9.2/`, sends the request, and handles token refresh /
single retry. The agent never sees the token and never constructs the host. (Mirror of
the `connect_request` model documented in `zoho-crm/01-llm-api-rules.md`.)

---

## Required Headers

The backend attaches these; listed so you know what the wire looks like and which
`Prefer` values to ask for.

| Header                                  | When                        | Purpose                                                             |
| --------------------------------------- | --------------------------- | ------------------------------------------------------------------- |
| `Authorization: Bearer {token}`         | Always                      | Entra access token                                                  |
| `OData-MaxVersion: 4.0`                 | Always                      | Required — pin OData protocol max version                           |
| `OData-Version: 4.0`                    | Always                      | Required — pin OData protocol version                               |
| `Accept: application/json`              | Always                      | Web API only returns JSON; errors come back as JSON too             |
| `Content-Type: application/json`        | Writes (POST/PATCH)         | Request body is JSON                                                |
| `Prefer: odata.include-annotations="*"` | Reads needing labels        | Returns formatted values for lookups / option sets / dates          |
| `Prefer: odata.maxpagesize=N`           | Reads, to set page size     | Server-driven paging size; max **5000** (elastic tables: 500)       |
| `Prefer: return=representation`         | Writes, to get the row back | `POST` → `201` + body; `PATCH` → `200` + body (instead of `204`)    |
| `If-Match: *`                           | `PATCH` update-only         | Forces update-only — prevents the upsert from creating a new record |
| `If-None-Match: *`                      | `PATCH` create-only         | Prevents the upsert from updating an existing record                |

Multiple `Prefer` values are comma-separated, e.g.
`Prefer: odata.maxpagesize=200,odata.include-annotations="*"`.

---

## Discovery (find PMO365 inside Dataverse)

> **There is no global "list every table" call you'd want to scan.** PMO365 is a Dataverse
> **solution**: a bundle of custom tables sharing one publisher **customization prefix**
> (e.g. `pmo_`). Standard Dataverse/Dynamics tables (account, contact, systemuser…) do
> **not** carry that prefix. Discovery is mandatory and runs in this order.

**1. Find the PMO365 solution:**

```http
GET /solutions?$select=solutionid,uniquename,friendlyname,version&$filter=contains(uniquename,'pmo') or contains(friendlyname,'pmo')
```

```json
{
  "value": [
    {
      "solutionid": "f1c2d3e4-0000-0000-0000-aaaabbbbcccc",
      "uniquename": "PMO365Core",
      "friendlyname": "PMO365",
      "version": "8.4.0.0"
    }
  ]
}
```

**2. List the solution's tables** (`componenttype eq 1` = Entity; `objectid` = the table's
`MetadataId`):

```http
GET /solutioncomponents?$filter=_solutionid_value eq f1c2d3e4-0000-0000-0000-aaaabbbbcccc and componenttype eq 1&$select=objectid
```

```json
{
  "value": [
    { "solutioncomponentid": "11111111-...", "objectid": "9a8b7c6d-1111-2222-3333-444455556666" },
    { "solutioncomponentid": "22222222-...", "objectid": "0f1e2d3c-7777-8888-9999-aaaabbbbcccc" }
  ]
}
```

**3. Resolve each table's logical/set names from its `MetadataId`:**

```http
GET /EntityDefinitions(9a8b7c6d-1111-2222-3333-444455556666)?$select=LogicalName,EntitySetName,DisplayName,PrimaryIdAttribute,PrimaryNameAttribute
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

> `EntitySetName` (plural, e.g. `pmo_projects`) is what you put in CRUD paths.
> `LogicalName` (singular, e.g. `pmo_project`) is what `$filter`/`$select`/metadata use.
> `PrimaryIdAttribute` is the GUID column; `PrimaryNameAttribute` is the human label
> column. **All `pmo_*` names above are [INFERRED] illustrative examples — confirm via
> these queries / `$metadata`.**

**4. Once the prefix is known, enumerate tables directly:**

```http
GET /EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName,IsCustomEntity&$filter=startswith(LogicalName,'pmo_')
```

**5. Find the publisher prefix** (to learn what the prefix even is):

```http
GET /publishers?$select=customizationprefix,friendlyname
```

```json
{ "value": [{ "customizationprefix": "pmo", "friendlyname": "EPM Partners" }] }
```

---

## $metadata — the schema document

The full schema is the OData CSDL document:

```http
GET {environment_url}/api/data/v9.2/$metadata
```

Returns XML (CSDL) describing every `EntityType`, property, data type, navigation
property, action, and function in the environment. Use `Accept: application/xml`. This is
the authoritative, runtime source for PMO365's real `pmo_*` field names and types — never
hardcode field names; resolve them here or via `EntityDefinitions`.

For a single table's attribute metadata (types, option-set values, requirement level):

```http
GET /EntityDefinitions(LogicalName='pmo_project')/Attributes?$select=LogicalName,AttributeType,RequiredLevel
```

---

## Endpoint Catalog

### Records (per resolved entity set, e.g. `pmo_projects`)

| Method | Path                                                       | Purpose                        | Auth | Paginated | Idempotent | Notes                                                |
| ------ | ---------------------------------------------------------- | ------------------------------ | ---- | --------- | ---------- | ---------------------------------------------------- |
| GET    | `/{entityset}`                                             | List / query records           | yes  | yes       | yes        | Add `$select`/`$filter`/`$top`/`$expand`             |
| GET    | `/{entityset}({id})`                                       | Get one record by GUID         | yes  | no        | yes        | `$select`/`$expand` supported                        |
| GET    | `/{entityset}({id})?$select=field`                         | Get one property               | yes  | no        | yes        |                                                      |
| POST   | `/{entityset}`                                             | Create record                  | yes  | no        | no         | `204` + `OData-EntityId` header (or `201` w/ Prefer) |
| PATCH  | `/{entityset}({id})`                                       | **Upsert** (update, or create) | yes  | no        | yes\*      | Send `If-Match: *` to force update-only              |
| PATCH  | `/{entityset}(altkey='value')`                             | Upsert by alternate key        | yes  | no        | yes\*      | Requires an alternate key defined on the table       |
| DELETE | `/{entityset}({id})`                                       | Delete record                  | yes  | no        | yes        | `204` on success                                     |
| DELETE | `/{entityset}({id})/{property}`                            | Clear a single property        | yes  | no        | yes        |                                                      |
| POST   | `/{entityset}({id})/Microsoft.Dynamics.CRM.{ActionName}`   | Call a **bound action**        | yes  | no        | depends    | Custom/built-in business operations                  |
| GET    | `/{entityset}({id})/Microsoft.Dynamics.CRM.{FunctionName}` | Call a **bound function**      | yes  | no        | yes        | Read-only operations                                 |

\* Dataverse `PATCH` is **UPSERT** — it creates the row if the GUID doesn't exist. Use
`If-Match: *` whenever you intend update-only.

### Discovery / Metadata

| Method | Path                                             | Purpose                                  |
| ------ | ------------------------------------------------ | ---------------------------------------- |
| GET    | `/solutions`                                     | Find the PMO365 solution                 |
| GET    | `/solutioncomponents`                            | List a solution's component tables       |
| GET    | `/publishers`                                    | Read the publisher customization prefix  |
| GET    | `/EntityDefinitions`                             | List/enumerate tables (filter by prefix) |
| GET    | `/EntityDefinitions({metadataid})`               | Resolve one table's logical/set names    |
| GET    | `/EntityDefinitions(LogicalName='x')/Attributes` | List a table's columns + types           |
| GET    | `/$metadata`                                     | Full CSDL schema document                |
| GET    | `/WhoAmI`                                        | Current user/org GUIDs (first-call gate) |

### Full Endpoint Index

| #   | Method | Path                                                     | Purpose                  | Notes                            |
| --- | ------ | -------------------------------------------------------- | ------------------------ | -------------------------------- |
| 1   | GET    | `/{entityset}`                                           | List/query records       | server-driven paging             |
| 2   | GET    | `/{entityset}({id})`                                     | Get one record           |                                  |
| 3   | POST   | `/{entityset}`                                           | Create record            | `OData-EntityId` response header |
| 4   | PATCH  | `/{entityset}({id})`                                     | Upsert / update          | `If-Match: *` for update-only    |
| 5   | DELETE | `/{entityset}({id})`                                     | Delete record            |                                  |
| 6   | POST   | `/{entityset}({id})/Microsoft.Dynamics.CRM.{ActionName}` | Bound action             |                                  |
| 7   | GET    | `/solutions`                                             | Discover solution        | discovery step 1                 |
| 8   | GET    | `/solutioncomponents`                                    | List solution tables     | `componenttype eq 1`             |
| 9   | GET    | `/EntityDefinitions(...)`                                | Resolve table names      | discovery step 3                 |
| 10  | GET    | `/publishers`                                            | Get customization prefix |                                  |
| 11  | GET    | `/$metadata`                                             | Full schema (CSDL XML)   |                                  |
| 12  | GET    | `/WhoAmI`                                                | Identity smoke test      | unbound function                 |

---

## Data Models

> All `pmo_*` names below are **[INFERRED] illustrative examples**, not confirmed PMO365
> schema. Resolve the real `LogicalName` / `EntitySetName` / column names with the
> discovery queries and `$metadata` before relying on them.

### Record identity (every Dataverse row)

| Field             | Type                | Notes                                                          |
| ----------------- | ------------------- | -------------------------------------------------------------- |
| `{logicalname}id` | GUID (string)       | Primary key, server-assigned, immutable (e.g. `pmo_projectid`) |
| `createdon`       | datetime (ISO-8601) | System; UTC                                                    |
| `modifiedon`      | datetime (ISO-8601) | System; UTC — use for polling deltas                           |
| `statecode`       | integer (state)     | Record state machine (active/inactive)                         |
| `statuscode`      | integer (status)    | Status reason; **valid values depend on `statecode`**          |
| `_ownerid_value`  | GUID lookup         | Owning user/team; exposed as `_..._value`                      |

### Lookups, option sets, and labels

- **Lookups:** the foreign-key GUID is exposed on read as **`_{logicalname}_value`**
  (e.g. `_pmo_owningprogram_value`). To pull the related row, `$expand` the navigation
  property (e.g. `$expand=pmo_OwningProgram($select=pmo_name)`). The human-readable
  display name only appears when you send `Prefer: odata.include-annotations="*"`
  (returned as `..._value@OData.Community.Display.V1.FormattedValue`).
- **Option sets (choices):** stored and written as **integers**. The label likewise comes
  from the formatted-value annotation. Resolve allowed integer values via
  `EntityDefinitions(...)/Attributes`.
- **State / status:** `statecode` + `statuscode`. `statuscode` is a state machine — which
  status values are legal depends on the current `statecode`.

### Illustrative PMO365 table — `pmo_project` [INFERRED]

| Field                      | Type        | Notes                                        |
| -------------------------- | ----------- | -------------------------------------------- |
| `pmo_projectid`            | GUID        | PK (illustrative)                            |
| `pmo_name`                 | string      | Likely `PrimaryNameAttribute` (illustrative) |
| `_pmo_owningprogram_value` | GUID lookup | Lookup to a program table (illustrative)     |
| `pmo_status`               | option set  | Integer choice (illustrative)                |
| `createdon` / `modifiedon` | datetime    | System columns (real, on every table)        |

> **Confirm everything in this table with discovery.** Do not present these field names
> as fact to the user. Other plausible PMO365 tables (`pmo_risk`, `pmo_milestone`,
> `pmo_task`, `pmo_program`) are equally [INFERRED] placeholders.

---

## Querying (OData v4, read)

Supported query options: `$select`, `$filter`, `$orderby`, `$top`, `$expand`,
`$count=true`, and `$apply` (aggregation / `groupby`).

`$filter` operators: `eq ne gt ge lt le`, `and or not`, and the string functions
`contains()`, `startswith()`, `endswith()`. Dates are ISO-8601 in UTC.

```http
GET /pmo_projects?$select=pmo_name,pmo_status,modifiedon&$filter=pmo_status eq 1 and modifiedon gt 2026-05-01T00:00:00Z&$orderby=modifiedon desc&$top=50
Prefer: odata.maxpagesize=50,odata.include-annotations="*"
```

```json
{
  "@odata.context": "https://contoso.crm.dynamics.com/api/data/v9.2/$metadata#pmo_projects(pmo_name,pmo_status,modifiedon)",
  "value": [
    {
      "@odata.etag": "W/\"123456789\"",
      "pmo_name": "Harbour Bridge Refit",
      "pmo_status": 1,
      "pmo_status@OData.Community.Display.V1.FormattedValue": "In Flight",
      "modifiedon": "2026-05-28T21:14:03Z",
      "pmo_projectid": "9a8b7c6d-1111-2222-3333-444455556666"
    }
  ],
  "@odata.nextLink": "https://contoso.crm.dynamics.com/api/data/v9.2/pmo_projects?$select=pmo_name,pmo_status,modifiedon&$skiptoken=%3Ccookie..."
}
```

> **Text search:** Use `$filter contains()` for substring matching. Relevance / full-text
> **`$search`** is a **separate Dataverse Search API** (`/api/search`, different rules and
> a ~1 req/sec/user throttle) — **not** the Web API query surface. Don't reach for it from
> `connect_request`.

---

## Pagination

- **Type:** **server-driven** (`@odata.nextLink`). No client-controlled offset for large sets.
- **Default page size:** server-decided (commonly 5000 standard / 500 elastic if unset)
- **Max page size:** 5000 (set via `Prefer: odata.maxpagesize=N`; elastic tables cap 500)
- **Total count:** `$count=true` adds `@odata.count`, but it caps at a fixed **5,000**
  for standard tables (500 for elastic) regardless of the page size you set — not the true
  total beyond that cap; request the `Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded`
  annotation to detect truncation.

**Parameters / mechanism:**

| Mechanism                     | Type   | Description                                                           |
| ----------------------------- | ------ | --------------------------------------------------------------------- |
| `Prefer: odata.maxpagesize=N` | header | Page size, 1–5000                                                     |
| `@odata.nextLink`             | URL    | Opaque next-page URL (contains `$skiptoken`). **Follow it verbatim.** |
| `$top`                        | query  | Hard cap on total rows returned (small result sets only)              |

**Last page detection:** `@odata.nextLink` is **absent** in the response.

> ❌ **Do NOT hand-roll `$skip`** to walk large sets — Dataverse is server-driven; `$skip`
> is not a substitute for following `@odata.nextLink` and can silently misbehave at scale.
> Loop on `nextLink` until it's gone.

---

## Mutation (OData v4, write)

**Create** — `POST /{entityset}` with a JSON body:

```http
POST /pmo_projects
Content-Type: application/json

{ "pmo_name": "Coastal Resilience Programme", "pmo_status": 1 }
```

```http
HTTP/1.1 204 No Content
OData-EntityId: https://contoso.crm.dynamics.com/api/data/v9.2/pmo_projects(0f1e2d3c-7777-8888-9999-aaaabbbbcccc)
```

Add `Prefer: return=representation` to get `201 Created` + the new row in the body.

**Update** — `PATCH /{entityset}({id})`. Dataverse PATCH is **upsert** (creates if absent);
send `If-Match: *` to force update-only:

```http
PATCH /pmo_projects(0f1e2d3c-7777-8888-9999-aaaabbbbcccc)
Content-Type: application/json
If-Match: *

{ "pmo_status": 2 }
```

`204 No Content` on success (or `200` + body with `Prefer: return=representation`).

**Set a lookup on write** — bind by navigation property + target entity set + GUID:

```json
{
  "pmo_name": "Phase 2",
  "pmo_OwningProgram@odata.bind": "/pmo_programs(11112222-3333-4444-5555-666677778888)"
}
```

**Delete** — `DELETE /{entityset}({id})` → `204 No Content`.

**Bound action / function** — `POST /{entityset}({id})/Microsoft.Dynamics.CRM.{ActionName}`
with an optional JSON parameter body.

**Alternate-key upsert** — `PATCH /{entityset}(altkey='value')` when the table defines an
alternate key, letting you upsert without first knowing the GUID.

---

## Rate Limits

Dataverse enforces **service protection API limits per user** on a **sliding 5-minute
(300-second) window**, across three facets evaluated independently:

| Facet               | Limit (per user, 5-min sliding window)                        | Window        |
| ------------------- | ------------------------------------------------------------- | ------------- |
| Number of requests  | ~6,000 requests                                               | 5 min / 300s  |
| Combined exec time  | ~20 minutes (1,200,000 ms) of combined request-execution time | 5 min / 300s  |
| Concurrent requests | ~52 concurrent requests (exceeding → immediate 429)           | instantaneous |

> These are platform defaults; they can vary by environment and may change. Don't pin
> business logic to the exact numbers — react to `429` + `Retry-After` instead.

### Headers

| Header                                        | Meaning                                                               |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `Retry-After`                                 | **On 429** — seconds to wait before retrying. **MUST honor it.**      |
| `x-ms-ratelimit-burst-remaining-xrm-requests` | Remaining requests for the connection (debug only — don't gate on it) |
| `x-ms-ratelimit-time-remaining-xrm-requests`  | Remaining combined exec time for the user (debug only)                |

### When exceeded

HTTP `429 Too Many Requests` with a `Retry-After` header (seconds). The companion error
codes are `0x80072322` (request count), `0x80072321` (execution time), and `0x80072326`
(concurrency).

### Strategy

1. **Honor `Retry-After` exactly** — it's the server telling you the recovery window.
2. Avoid tight loops / parallel fan-out; let the server set the pace.
3. Exponential backoff with jitter only if `Retry-After` is somehow absent.
4. Surface to the user after repeated 429s rather than spinning.

---

## Error Handling

### Standard format

```json
{
  "error": {
    "code": "0x80040217",
    "message": "pmo_project With Id = 0f1e2d3c-7777-8888-9999-aaaabbbbcccc Does Not Exist"
  }
}
```

The `code` is a Dataverse hex error code (not the HTTP status). Sending
`Prefer: odata.include-annotations="*"` adds `@Microsoft.PowerApps.CDS.*` detail
annotations (help link, inner error, trace text) to the error body.

### Status codes

| Status | Meaning                           | Retryable | Recovery                                                    |
| ------ | --------------------------------- | --------- | ----------------------------------------------------------- |
| 200    | OK (body returned)                | —         | —                                                           |
| 201    | Created (`return=representation`) | —         | —                                                           |
| 204    | No Content (write succeeded)      | —         | Read `OData-EntityId` header for the new row URL            |
| 400    | Bad request / invalid `$filter`   | No        | Fix query, field names, OData syntax                        |
| 401    | Token expired / invalid           | Yes (1)   | Backend refreshes + retries once; 2nd 401 → user reconnects |
| 403    | Missing privilege                 | No        | App user's security role lacks read/write on the table      |
| 404    | Record or wrong `EntitySetName`   | No        | Re-resolve via discovery; verify GUID + plural set name     |
| 405    | Method/resource mismatch          | No        | e.g. DELETE/PATCH on a collection — fix the path            |
| 412    | `If-Match` precondition failed    | Maybe     | ETag/concurrency conflict — re-fetch and retry              |
| 413    | Payload too large                 | No        | Reduce body / split the operation                           |
| 429    | Service-protection limit          | Yes       | **Honor `Retry-After`**, then retry                         |
| 5xx    | Server error / unavailable        | Yes       | Retry with backoff                                          |

Common hex codes: `0x80040217` (record does not exist), `0x80040265`
(plug-in / business error), `0x80072322`/`0x80072321`/`0x80072326` (the three
service-protection limits). Full reference: `01d-event-and-error-handling.md`.

---

## Webhooks / Events

Dataverse natively supports **webhooks**, **Service Endpoints** (Azure messaging), and
**Power Automate** triggers. **But the Numa PMO365 connector exposes NO Numa-hosted
receiver yet** — there is no public endpoint to register against.

**Current approach: polling.** Filter on `modifiedon` and order by it:

```http
GET /pmo_projects?$select=pmo_name,modifiedon&$filter=modifiedon gt 2026-05-29T00:00:00Z&$orderby=modifiedon asc
Prefer: odata.maxpagesize=200
```

- Persist the high-water `modifiedon` between polls.
- **Poll interval ≥ 5 minutes** to stay well clear of service-protection limits.
- Walk `@odata.nextLink` to drain each poll fully.

---

## Known Limitations

1. **No PMO365 API and no public PMO365 schema.** All real table/field names (`pmo_*`)
   are proprietary — obtain them at runtime via discovery / `$metadata`. Never hardcode.
2. **No global table list worth scanning.** You must discover the **solution** first, then
   its component tables, then resolve names. Discovery-first is mandatory.
3. **`EntitySetName` (plural) ≠ `LogicalName` (singular).** CRUD paths need the plural set
   name; `$select`/`$filter`/metadata use the singular logical name. Mixing them → 404/400.
4. **PATCH is upsert.** Forgetting `If-Match: *` can silently create an orphan record
   instead of failing on a bad GUID.
5. **Lookups read as `_x_value` (GUID only).** Display names require
   `Prefer: odata.include-annotations="*"` or an `$expand`.
6. **Option sets / state are integers.** Labels aren't in the raw value; `statuscode`
   legality depends on `statecode`.
7. **Server-driven paging only.** `$skip` is not a reliable way to walk large sets — follow
   `@odata.nextLink`.
8. **`$search` is a different API** (`/api/search`, 1 req/sec/user) — not available via the
   Web API query surface. Use `$filter contains()`.
9. **No connector-hosted webhooks yet** — polling only, ≥ 5 min interval.
10. **Strict per-user service protection limits** — 429s carry a mandatory `Retry-After`.

---

## SDKs & Tooling

| SDK / Tool                                 | Language | Source                  | Quality | Notes                                           |
| ------------------------------------------ | -------- | ----------------------- | ------- | ----------------------------------------------- |
| `Microsoft.PowerPlatform.Dataverse.Client` | .NET     | NuGet (Microsoft)       | good    | Official; handles 429/Retry-After automatically |
| Dataverse Web API (raw HTTP)               | any      | —                       | n/a     | **What Numa uses** — `connect_request` + httpx  |
| Postman: Dataverse Web API collection      | n/a      | Microsoft Learn samples | good    | Useful for manual probing                       |

**Postman collection:** Microsoft publishes Dataverse Web API Postman samples on Learn.
**OpenAPI spec:** None — use the OData `$metadata` CSDL document instead.

Numa does not use a vendor SDK — all calls are raw HTTP through `connect_request`.

---

## Integration Path Assessment

**Recommended path:** **Direct API Only**

**Justification:**

- Dataverse is a structured-records platform (projects, programs, risks, milestones) —
  not a file tree. It doesn't fit the "browse files" Data Connector UX.
- All value comes from the workspace agent issuing OData calls via `connect_request`:
  discover → query → create/update.
- `surfaces: ['chat']` in the connector registry keeps PMO365 out of Files > Remote.

**Connector compatibility:**

| Connector Method    | API Endpoint                        | Feasibility |
| ------------------- | ----------------------------------- | ----------- |
| `list_files`        | n/a — no file model                 | none        |
| `download_file`     | n/a — `notes`/attachments only      | none        |
| `search_files`      | n/a — record query, not file search | none        |
| `get_file_metadata` | n/a                                 | none        |

Dataverse is a fully documented public OData v4 API. Any HTTP client that performs the
Entra `authorization_code` flow against the `organizations` authority with scope
`{environment_url}/.default offline_access`, injects `Authorization: Bearer {token}` plus
the required OData headers, and targets `{environment_url}/api/data/v9.2/` can drive the
entire surface. No vendor SDK required.

> Numa-internal wiring details (vault keys, registry entries, integration commits) live in
> the Numa connector skill and Numa-side docs — not in this API reference.

---

_Researched on 2026-05-29. Source: `00-api-investigation-questionnaire.md` + Microsoft Dataverse Web API docs (learn.microsoft.com). Confidence: medium — Dataverse platform facts are [DOCUMENTED]; all PMO365 `pmo_\*`schema names are [INFERRED] and MUST be confirmed via the discovery queries /`$metadata`. Promote markers to [CONFIRMED] only after a successful `GET /WhoAmI` and a real discovery query against the deployed integration.\_

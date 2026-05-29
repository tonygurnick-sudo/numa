---
api_name: 'PMO365'
api_slug: 'pmo365'
researcher: 'Claude Code (doc-based investigation, Microsoft Dataverse Web API)'
date_researched: '2026-05-29'
integration_path: 'Direct API Only (spec-driven, chat-only)'
auth_type: 'oauth2'
---

# PMO365 — API Investigation Questionnaire

> **Confidence markers:** `[CONFIRMED]` = verified against a live API call · `[DOCUMENTED]` =
> stated in official Microsoft Dataverse Web API docs (learn.microsoft.com) · `[INFERRED]` =
> deduced from conventions/partial docs · `[UNKNOWN]` = not yet established.
>
> ⚠️ **PMO365 has NO API of its own.** PMO365 is a Project Portfolio Management (PPM) solution by
> EPM Partners built on the Microsoft Power Platform. Its data lives in the customer's **Microsoft
> Dataverse** environment (the same datastore behind Dynamics 365 / Project for the web). You
> integrate by talking to the **Dataverse Web API** (OData v4). Every Dataverse-platform claim
> below is `[DOCUMENTED]` against learn.microsoft.com; nothing here was run against a live
> customer environment, so the Phase 2 "first successful call" gate is **NOT satisfied** — items
> needing a live tenant are tagged **🔬 LIVE-CONFIRM**.
>
> 🚨 **HONESTY RULE (load-bearing).** PMO365's actual custom table and column names (`pmo_project`,
> `pmo_risk`, …) are **proprietary and NOT publicly documented**. They are NEVER `[CONFIRMED]`
> here. Wherever a `pmo_*` name appears it is an **illustrative example marked `[INFERRED]`**, and
> it is always paired with the runtime **discovery query** that obtains the real name. The theme
> of this whole package is **discovery-first**: resolve names from `solutions` /
> `solutioncomponents` / `EntityDefinitions` / `$metadata` at runtime, never hard-code them.

---

## Phase 1 — Documentation Discovery

| Item                  | Value                                                                                     | Confidence   |
| --------------------- | ----------------------------------------------------------------------------------------- | ------------ |
| Vendor (solution)     | EPM Partners — PMO365 PPM solution on Microsoft Power Platform                            | [DOCUMENTED] |
| Vendor (platform API) | Microsoft — Dataverse Web API is the real integration surface                             | [DOCUMENTED] |
| PMO365 product site   | https://pmo365.com/                                                                       | [DOCUMENTED] |
| Web API overview      | https://learn.microsoft.com/power-apps/developer/data-platform/webapi/overview            | [DOCUMENTED] |
| HTTP + errors         | .../webapi/compose-http-requests-handle-errors                                            | [DOCUMENTED] |
| Query (OData)         | .../webapi/query/overview                                                                 | [DOCUMENTED] |
| Create / update       | .../webapi/create-entity-web-api , /update-delete-entities-using-web-api                  | [DOCUMENTED] |
| Conditional ops       | .../webapi/perform-conditional-operations-using-web-api (If-Match upsert control)         | [DOCUMENTED] |
| Service-protection    | .../api-limits                                                                            | [DOCUMENTED] |
| Auth (Entra ID)       | https://learn.microsoft.com/power-apps/developer/data-platform/authenticate-oauth         | [DOCUMENTED] |
| Metadata / discovery  | .../webapi/use-web-api-metadata , `$metadata` CSDL document                               | [DOCUMENTED] |
| PMO365 schema docs    | **NONE public** — table/column names are proprietary; discover at runtime via `$metadata` | [UNKNOWN] 🔬 |

**Documentation quality:** Dataverse platform docs are **excellent** (comprehensive, versioned,
worked request/response examples). PMO365's own schema is **nonexistent** publicly — the entire
domain model must be discovered at runtime inside the customer tenant.

---

## Phase 2 — Authentication & First Call (HARD GATE — not satisfied, see warning above)

| Item              | Value                                                                                                              | Confidence   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------ |
| Auth standard     | OAuth 2.0 via Microsoft Entra ID — authorization_code + refresh_token                                              | [DOCUMENTED] |
| Authority         | `organizations` (multi-tenant work/school accounts; no personal MSAs)                                              | [DOCUMENTED] |
| authUrl           | `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize`                                            | [DOCUMENTED] |
| tokenUrl          | `https://login.microsoftonline.com/organizations/oauth2/v2.0/token`                                                | [DOCUMENTED] |
| scope             | `{environment_url}/.default offline_access` — environment-specific; host edited in wizard Advanced section         | [DOCUMENTED] |
| Auth header       | `Authorization: Bearer {access_token}` — **standard Bearer, NOT a custom scheme**                                  | [DOCUMENTED] |
| Delegated perm    | Dynamics CRM (Dataverse) → `user_impersonation`; admin consent required                                            | [DOCUMENTED] |
| App-side setup    | Entra app registration + a Dataverse **Application User** mapped to the app, with a security role on PMO365 tables | [DOCUMENTED] |
| Access token life | ~1 hour                                                                                                            | [DOCUMENTED] |
| Refresh token     | Obtained via `offline_access`; backend refreshes on 401 and retries once                                           | [DOCUMENTED] |
| Reconnect trigger | Second consecutive 401 after refresh → user must reconnect                                                         | [INFERRED]   |

**Scope nuance (load-bearing, do not get wrong):** the connector wizard does **NOT** interpolate
credential fields into scopes. `authUrl` and `tokenUrl` use the fixed `organizations` authority;
only the **scope** carries the environment host, and the admin edits that host by hand in the
wizard's Advanced section. The host must match the `environment_url` credential
(`https://{org}.crm.dynamics.com`). A scope pointing at the wrong environment yields tokens that
401 against the real one. 🔬 LIVE-CONFIRM the exact `{org}` host per customer.

**First call (documented shape — the smoke test to run once a tenant exists):**

```http
GET {environment_url}/api/data/v9.2/WhoAmI HTTP/1.1
Authorization: Bearer {access_token}
Accept: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0
```

```json
{
  "@odata.context": "https://contoso.crm.dynamics.com/api/data/v9.2/$metadata#Microsoft.Dynamics.CRM.WhoAmIResponse",
  "BusinessUnitId": "6f202eb8-3d8e-ee11-8179-000d3a9933c9",
  "UserId": "0d9d2f80-3e8e-ee11-8179-000d3a9933c9",
  "OrganizationId": "2e3a1cda-9a8c-4f6b-9c3e-1a2b3c4d5e6f"
}
```

`WhoAmI` is the canonical zero-privilege probe: a `200` with a `UserId` proves the Bearer token,
the environment host, and the Application User mapping are all wired correctly.

- [ ] **GATE CHECK: first successful live call — NOT DONE (no customer Dataverse tenant at research time)** 🔬

---

## Phase 3 — Domain Model & Behaviour (discovery-first)

> There is **no global table list** and **no public PMO365 schema**. Dataverse exposes thousands
> of system tables; PMO365's tables are a **solution** (a bundle of custom tables sharing one
> publisher customization prefix, e.g. `pmo_*`). Standard Dataverse/Dynamics tables do NOT carry
> that prefix. The reliable entities below are **Dataverse system tables** used to _discover_ the
> PMO365 tables — those are `[DOCUMENTED]`. The PMO365 tables themselves are `[INFERRED]`
> illustrative only.

### Discovery entities (Dataverse system tables — real, documented)

| System table       | EntitySet            | Purpose in discovery                                                         | Confidence   |
| ------------------ | -------------------- | ---------------------------------------------------------------------------- | ------------ |
| Solution           | `solutions`          | Find the PMO365 solution bundle (`solutionid`, `uniquename`, `friendlyname`) | [DOCUMENTED] |
| Solution component | `solutioncomponents` | List the tables in that solution (`componenttype eq 1` = Entity; `objectid`) | [DOCUMENTED] |
| Entity definition  | `EntityDefinitions`  | Resolve a table's `LogicalName` / `EntitySetName` / display / primary keys   | [DOCUMENTED] |
| Publisher          | `publishers`         | Read the `customizationprefix` (e.g. `pmo`) that all custom tables share     | [DOCUMENTED] |
| $metadata (CSDL)   | `$metadata`          | Full schema document: every table, column, navigation property, option set   | [DOCUMENTED] |

**Discovery query sequence (the heart of this connector):**

```http
# 1. Find the PMO365 solution
GET /solutions?$select=solutionid,uniquename,friendlyname,version&$filter=contains(uniquename,'pmo') or contains(friendlyname,'pmo')

# 2. List the solution's tables  (componenttype 1 = Entity; objectid = the table's MetadataId)
GET /solutioncomponents?$filter=_solutionid_value eq {solutionid} and componenttype eq 1&$select=objectid

# 3. Resolve one table by MetadataId
GET /EntityDefinitions({metadataid})?$select=LogicalName,EntitySetName,DisplayName,PrimaryIdAttribute,PrimaryNameAttribute

# 3b. Or, once the prefix is known, list all custom tables at once
GET /EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName,IsCustomEntity&$filter=startswith(LogicalName,'pmo_')

# 4. Read the publisher prefix
GET /publishers?$select=customizationprefix,friendlyname
```

**Illustrative PMO365 tables — `[INFERRED]` ONLY, names must be confirmed via discovery above:**

| Illustrative table       | Likely logical name | Likely EntitySetName | Confidence (must discover)      |
| ------------------------ | ------------------- | -------------------- | ------------------------------- |
| Project / portfolio item | `pmo_project`       | `pmo_projects`       | [INFERRED] 🔬 — never CONFIRMED |
| Risk                     | `pmo_risk`          | `pmo_risks`          | [INFERRED] 🔬 — never CONFIRMED |
| Issue                    | `pmo_issue`         | `pmo_issues`         | [INFERRED] 🔬 — never CONFIRMED |
| Milestone / phase        | `pmo_milestone`     | `pmo_milestones`     | [INFERRED] 🔬 — never CONFIRMED |
| Resource / assignment    | `pmo_resource`      | `pmo_resources`      | [INFERRED] 🔬 — never CONFIRMED |

> ⚠️ Do **not** state any `pmo_*` name as fact to a user. Say e.g. "likely `pmo_project` — let me
> confirm via the solution discovery query / `$metadata`". The `EntitySetName` is frequently NOT a
> naive pluralisation (Dataverse pluralisation is irregular), which is exactly why step 3 exists.

### Cross-cutting Dataverse field conventions (DOCUMENTED)

| Convention            | Detail                                                                                        | Confidence   |
| --------------------- | --------------------------------------------------------------------------------------------- | ------------ |
| Primary key           | GUID, column `{logicalname}id` (e.g. `pmo_projectid`)                                         | [DOCUMENTED] |
| Lookup columns        | Exposed read-side as `_{logicalname}_value` (the related GUID)                                | [DOCUMENTED] |
| Lookup labels         | Only present when `Prefer: odata.include-annotations="*"` is sent (FormattedValue annotation) | [DOCUMENTED] |
| Set a lookup on write | `"{nav}@odata.bind": "/{targetentityset}({guid})"`                                            | [DOCUMENTED] |
| Audit timestamps      | `createdon`, `modifiedon` (ISO-8601 UTC) on every table                                       | [DOCUMENTED] |
| Option sets           | Integer-valued; label comes from the FormattedValue annotation                                | [DOCUMENTED] |
| ETag                  | `@odata.etag` returned on every row; usable for optimistic concurrency via `If-Match`         | [DOCUMENTED] |

### State machine — record state (DOCUMENTED, applies to all tables incl. PMO365)

Every Dataverse table carries `statecode` (high-level state) and `statuscode` (reason). They form
a coupled state machine — valid `statuscode` values depend on the current `statecode`.

```
statecode 0 (Active) --deactivate--> statecode 1 (Inactive)
        ^                                   |
        +--------- reactivate --------------+
   statuscode ∈ {active reasons}      statuscode ∈ {inactive reasons}
```

| From state   | Action          | To state     | Reversible | Notes                                                 |
| ------------ | --------------- | ------------ | ---------- | ----------------------------------------------------- |
| Active (0)   | set statecode 1 | Inactive (1) | Yes        | PATCH `statecode`/`statuscode` together               |
| Inactive (1) | set statecode 0 | Active (0)   | Yes        | `statuscode` must be valid for the target `statecode` |

> The concrete integer values for `statuscode` are **org-customisable** and PMO365-specific. 🔬
> LIVE-CONFIRM via `GET /EntityDefinitions(LogicalName='pmo_project')/Attributes/Microsoft.Dynamics.CRM.StatusAttributeMetadata?$expand=OptionSet`.

### Business rules (DOCUMENTED platform behaviour)

- **Dataverse PATCH is UPSERT** — a PATCH to a non-existent id _creates_ the row. Send `If-Match: *`
  to force update-only. This is the single biggest write footgun. [DOCUMENTED]
- **EntitySetName ≠ LogicalName**, and pluralisation is irregular — always resolve it before use. [DOCUMENTED]
- **Lookups read as `_x_value`, write as `x@odata.bind`** — the read and write shapes differ. [DOCUMENTED]
- **Privileges are row/column-scoped** by the Application User's security role; a `403` means the
  role lacks a privilege, not that the data is missing. [DOCUMENTED]

---

## Phase 4 — Endpoint Catalog

- **Base URL:** `{environment_url}/api/data/v9.2/` where `environment_url = https://{org}.crm.dynamics.com`
  (admin-configured, workspace-wide, stored in the `environment_url` credential field). All relative
  paths the agent emits are expanded against this base by the backend `connect_request` path. [DOCUMENTED]
- **Protocol/format:** HTTPS, OData v4, JSON. [DOCUMENTED]
- **Verbs:** `GET` (read/function), `POST` (create/action), `PATCH` (update/upsert), `DELETE`. [DOCUMENTED]

| Method | Path (relative)                                         | Purpose                                  | Confidence   |
| ------ | ------------------------------------------------------- | ---------------------------------------- | ------------ |
| GET    | `WhoAmI`                                                | Auth/connectivity probe                  | [DOCUMENTED] |
| GET    | `$metadata`                                             | Full CSDL schema (discovery)             | [DOCUMENTED] |
| GET    | `solutions?$filter=...`                                 | Find PMO365 solution                     | [DOCUMENTED] |
| GET    | `solutioncomponents?$filter=...`                        | List solution tables                     | [DOCUMENTED] |
| GET    | `EntityDefinitions(...)` / `EntityDefinitions?$filter=` | Resolve table set names / metadata       | [DOCUMENTED] |
| GET    | `{entityset}?$select=...&$filter=...`                   | List/query rows                          | [DOCUMENTED] |
| GET    | `{entityset}({id})?$select=...&$expand=...`             | Get one row + related rows               | [DOCUMENTED] |
| POST   | `{entityset}`                                           | Create → `204` + `OData-EntityId` header | [DOCUMENTED] |
| PATCH  | `{entityset}({id})` (with `If-Match: *`)                | Update (force update-only)               | [DOCUMENTED] |
| DELETE | `{entityset}({id})`                                     | Delete                                   | [DOCUMENTED] |
| POST   | `{entityset}({id})/Microsoft.Dynamics.CRM.{Action}`     | Bound action                             | [DOCUMENTED] |

**Create — worked example (note the response is a header, not a body):**

```http
POST {environment_url}/api/data/v9.2/pmo_projects HTTP/1.1
Authorization: Bearer {access_token}
Accept: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0
Content-Type: application/json

{ "pmo_name": "FY26 Data Platform Migration", "pmo_startdate": "2026-07-01T00:00:00Z" }
```

```http
HTTP/1.1 204 No Content
OData-EntityId: https://contoso.crm.dynamics.com/api/data/v9.2/pmo_projects(b21f9c44-1234-ee11-8179-000d3a9933c9)
```

(Send `Prefer: return=representation` to get `201 Created` with the row body instead.) See
`02-api-spec-investigation.md` for the full catalog. `pmo_projects` / `pmo_name` here are
**illustrative `[INFERRED]`** — resolve real names via Phase 3 discovery first.

---

## Phase 5 — Query & Filter Capabilities (OData v4)

| Capability               | Supported | Syntax                                                                 | Confidence   |
| ------------------------ | --------- | ---------------------------------------------------------------------- | ------------ |
| Field selection          | Yes       | `$select=col1,col2`                                                    | [DOCUMENTED] |
| Filter by value          | Yes       | `$filter=field eq 'value'`                                             | [DOCUMENTED] |
| Comparison operators     | Yes       | `eq ne gt ge lt le`                                                    | [DOCUMENTED] |
| Logical operators        | Yes       | `and or not`                                                           | [DOCUMENTED] |
| String functions         | Yes       | `contains() startswith() endswith()`                                   | [DOCUMENTED] |
| Date range               | Yes       | ISO-8601 UTC, e.g. `modifiedon gt 2026-05-01T00:00:00Z`                | [DOCUMENTED] |
| Sort                     | Yes       | `$orderby=field asc` / `desc`                                          | [DOCUMENTED] |
| Include related (expand) | Yes       | `$expand=nav($select=...)`                                             | [DOCUMENTED] |
| Aggregate / group        | Yes       | `$apply=groupby((field),aggregate(x with sum as y))`                   | [DOCUMENTED] |
| Count                    | Yes       | `$count=true` → `@odata.count` (capped at a fixed 5000, not page size) | [DOCUMENTED] |
| Lookup label resolution  | Yes       | `Prefer: odata.include-annotations="*"` → FormattedValue               | [DOCUMENTED] |
| `$skip`                  | **No**    | Unsupported on Dataverse Web API — use server-driven paging            | [DOCUMENTED] |
| `$search` (Web API)      | **No**    | Relevance search is a _separate_ API; for text use `contains()`        | [DOCUMENTED] |

**Worked query (filter + expand a lookup + readable labels):**

```http
GET {environment_url}/api/data/v9.2/pmo_projects
    ?$select=pmo_name,pmo_startdate,statuscode
    &$filter=statuscode eq 1 and modifiedon gt 2026-05-01T00:00:00Z
    &$orderby=modifiedon desc
    &$expand=pmo_OwnerId($select=fullname)
Authorization: Bearer {access_token}
Accept: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0
Prefer: odata.include-annotations="*"
```

> Column names above are **illustrative `[INFERRED]`**. The two non-obvious traps: (a) reading a
> lookup GUID needs `_{name}_value`, but _expanding_ it needs the **navigation property** name
> (often CamelCase, e.g. `pmo_OwnerId`) — both come from `$metadata`; (b) Dataverse does **not**
> support `$skip` or Web-API `$search`. See `01b-query-patterns.md`.

---

## Phase 6 — Pagination & Bulk

| Item              | Value                                                                                                                                             | Confidence   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Pagination model  | **Server-driven** — follow `@odata.nextLink` verbatim until absent                                                                                | [DOCUMENTED] |
| Page size control | `Prefer: odata.maxpagesize=N` (max **5000**; elastic tables 500)                                                                                  | [DOCUMENTED] |
| Default page size | Up to 5000 standard-table rows per page                                                                                                           | [DOCUMENTED] |
| `$skip`           | NOT supported — do **not** hand-roll `$skip` offsets for large sets                                                                               | [DOCUMENTED] |
| Total count       | `$count=true` → `@odata.count`, capped at a fixed 5000 regardless of page size (use `totalrecordcountlimitexceeded` / `RetrieveTotalRecordCount`) | [DOCUMENTED] |
| Last-page detect  | `@odata.nextLink` absent in the response                                                                                                          | [DOCUMENTED] |
| Bulk write        | `$batch` (POST multipart) or change-sets — not exposed from chat in this connector                                                                | [DOCUMENTED] |

**Pagination worked example:**

```
Page 1: GET {entityset}?$select=...   +  header  Prefer: odata.maxpagesize=500
        → response has "@odata.nextLink": ".../api/data/v9.2/pmo_projects?$select=...&$skiptoken=..."
Page 2: GET {that exact @odata.nextLink URL, verbatim, headers re-applied}
Last:   response has no "@odata.nextLink"
```

The `$skiptoken` inside `@odata.nextLink` is opaque — never construct or mutate it; echo the URL.

---

## Phase 7 — Real-Time & Events

- Dataverse supports webhooks / Service Endpoints / Power Automate triggers at the platform level. [DOCUMENTED]
- **The Numa connector exposes NO Numa-hosted receiver yet** — there is nowhere for Dataverse to
  POST events. [INFERRED — Numa side]
- **Recommended mechanism: polling.** Filter on `modifiedon gt {ISO-timestamp}`, order by
  `modifiedon`, interval **≥ 5 minutes** (respect service-protection limits — see Phase 8). [DOCUMENTED platform / INFERRED interval]

```http
GET {environment_url}/api/data/v9.2/pmo_projects
    ?$select=pmo_name,modifiedon&$filter=modifiedon gt 2026-05-29T08:00:00Z&$orderby=modifiedon asc
```

🔬 LIVE-CONFIRM: whether the customer wants change-tracking (`Prefer: odata.track-changes`) instead
of timestamp polling — it is more efficient but requires the table to have change tracking enabled.

---

## Phase 8 — Operational Concerns

| Item                 | Value                                                                                               | Confidence   |
| -------------------- | --------------------------------------------------------------------------------------------------- | ------------ |
| Rate model           | **Service protection limits**, per user, sliding 5-min window                                       | [DOCUMENTED] |
| Request count limit  | ~6000 requests / 5 min per user                                                                     | [DOCUMENTED] |
| Execution-time limit | ~20 min (1,200,000 ms) combined request-execution time / 5 min per user                             | [DOCUMENTED] |
| Concurrency limit    | ~52 concurrent requests per user (52 = concurrent requests, NOT seconds)                            | [DOCUMENTED] |
| Limit-exceeded code  | `429 Too Many Requests`                                                                             | [DOCUMENTED] |
| `Retry-After`        | **Present (seconds) — MUST honor it.** Do not tight-loop                                            | [DOCUMENTED] |
| Backoff              | Honor `Retry-After`, then exponential backoff for 5xx                                               | [DOCUMENTED] |
| Error envelope       | `{"error":{"code":"0x80040217","message":"..."}}` (the `code` is a hex platform code, not the HTTP) | [DOCUMENTED] |

**Status-code map (DOCUMENTED):**

| HTTP | Meaning (Dataverse)                                 | Retryable | Recovery                                       |
| ---- | --------------------------------------------------- | --------- | ---------------------------------------------- |
| 200  | OK (body returned)                                  | —         | —                                              |
| 201  | Created (with `Prefer: return=representation`)      | —         | —                                              |
| 204  | No Content (create/update success; no body)         | —         | read `OData-EntityId` header for the new id    |
| 400  | Bad request / bad `$filter` / invalid arg           | No        | Fix query; check column names via `$metadata`  |
| 401  | Token expired / invalid                             | Yes       | Refresh token, retry once; 2nd 401 → reconnect |
| 403  | Missing privilege                                   | No        | Application User's security role lacks access  |
| 404  | Record missing or wrong `EntitySetName`             | No        | Re-resolve set name via `EntityDefinitions`    |
| 405  | Method/resource mismatch (e.g. DELETE a collection) | No        | Use the correct verb                           |
| 412  | `If-Match` precondition failed                      | Depends   | Re-read ETag; resolve concurrency conflict     |
| 429  | Service-protection limit hit                        | Yes       | **Honor `Retry-After`**, then backoff          |
| 5xx  | Service error                                       | Yes       | Exponential backoff + retry                    |

---

## Phase 9 — Integration Path

**Selected: Direct API Only (spec-driven, chat-only).** [DECISION]

**Justification:** PMO365 in Dataverse exposes **structured relational PPM data** (projects, risks,
issues, milestones, resources) — it is **not** a browsable file/folder store, so it is NOT a
Files-Remote / Data Connector. It mirrors the **zoho-crm / netsuite / actionstep** pattern: an
OAuth2 connector whose API specs live in `ext-api-doc/pmo365/` and are read by the workspace agent
— **no `lib/oauth-providers/` provider class**. All interactions go through the backend
`connect_request` (method + relative path + optional JSON body); the backend expands relative
paths against the admin-configured `environment_url`, attaches the `Bearer` token, and refreshes on 401. `surfaces: ['chat']`. The `connect_request`-only model also bounds capability: it sends JSON,
so file/attachment upload to Dataverse `annotation` records is out of scope from chat.

**Workspace agent — CAN (in scope):**

1. **Discover** the PMO365 solution, its tables, set names, and columns at runtime
   (`solutions` → `solutioncomponents` → `EntityDefinitions` / `$metadata`) before any read/write.
2. Read/query rows with `$select / $filter / $orderby / $expand / $apply / $count`, resolving
   lookup labels via the annotations `Prefer` header and paging via `@odata.nextLink`.
3. Create / update / delete rows, using `If-Match: *` on PATCH to avoid accidental upsert-create,
   and `@odata.bind` to set lookups.
4. Call bound actions/functions on a row when the user explicitly asks.

**Workspace agent — CANNOT (out of scope / dangerous):**

1. Hard-code or assert `pmo_*` table/column names — must discover them; never present as confirmed.
2. Receive Dataverse webhooks — no Numa-hosted receiver yet; use polling on `modifiedon`.
3. Upload file attachments to Dataverse (`annotation`/`Note` body) — `connect_request` is JSON-only.
4. Cross into a different environment — `environment_url` is fixed per connection at admin time.

| Default                             | Value  | Reason                                          |
| ----------------------------------- | ------ | ----------------------------------------------- |
| `Prefer: odata.maxpagesize`         | 500    | Bounded pages; honors server-driven paging      |
| `Prefer: odata.include-annotations` | `"*"`  | Get human-readable lookup/option-set labels     |
| `If-Match` on PATCH                 | `*`    | Force update-only; prevent silent upsert-create |
| API version                         | `v9.2` | Current GA Dataverse Web API version            |

---

## Phase 10 — Readiness Checklist

- [x] Documentation located (Dataverse platform docs — excellent; PMO365 schema — none, by design)
- [ ] **Phase 2 first successful live call — NOT DONE (no customer tenant)** 🔬
- [x] Auth flow documented (Entra `organizations` authority, scope, Bearer, refresh, Application User)
- [x] Discovery-first domain model documented (system tables real; `pmo_*` illustrative only)
- [x] Endpoint catalog + create/read/update/delete worked examples documented
- [x] Query/filter capabilities documented (incl. `$skip`/`$search` NOT supported)
- [x] Pagination model documented (server-driven `@odata.nextLink`, `odata.maxpagesize` ≤ 5000)
- [x] Events assessed — no Numa receiver; polling on `modifiedon`
- [x] Rate-limit + error envelope + status map documented (`Retry-After` must be honored)
- [x] Integration path selected + justified (Direct API Only, chat-only, no provider class)

**Top unknowns blocking full production trust (all need a live customer environment):**

1. **Real PMO365 table/column/option-set names** — obtained at runtime via the Phase 3 discovery
   queries and `$metadata`; NEVER assume `pmo_*` names. (The single biggest item.) 🔬
2. The exact `{org}` host for `environment_url` and that the scope host matches it. 🔬
3. Per-table `statuscode` integer values behind the state machine. 🔬
4. Whether change tracking is enabled (vs. timestamp polling) for near-real-time needs. 🔬

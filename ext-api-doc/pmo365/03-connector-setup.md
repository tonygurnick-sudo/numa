---
api_name: 'PMO365 (Microsoft Dataverse)'
connector_id: 'pmo365'
auth_type: 'oauth2'
tier: 'standard'
category: 'project-management'
integration_path: 'direct-api (spec-driven, chat-only)'
---

# PMO365 (Microsoft Dataverse) — Connector & Integration Setup

> Build instructions for the PMO365 connector. **Integration path: Direct API, chat-only,
> spec-driven** — same shape as Actionstep / NetSuite / Zoho CRM. PMO365 has **no API of its
> own**: it is a Project Portfolio Management solution by EPM Partners built on the Microsoft
> Power Platform, and its data lives in the customer's **Microsoft Dataverse** environment. You
> integrate by talking to the **Dataverse Web API** (OData v4, JSON) at
> `{environment_url}/api/data/v9.2/`. The workspace agent reads the `ext-api-doc/pmo365/` specs
> (this folder) and calls Dataverse through the connector request path. **No
> `lib/oauth-providers/` provider class is required** (it is not a Files-Remote / file-browsing
> connector).
>
> Prerequisites: read `00-api-investigation-questionnaire.md` and activate the `numa-connectors`
> skill.

---

## Integration Type

**Selected path:** Direct API (spec-driven, chat-only)

| Component                       | Required? | Status                                           |
| ------------------------------- | --------- | ------------------------------------------------ |
| Connector Registry entry        | Yes       | ✅ Done — `connectorRegistry.ts`                 |
| `ext-api-doc/pmo365/` specs     | Yes       | ✅ Done — this folder                            |
| Admin OAuth wizard              | Yes       | ✅ Generated from registry (no bespoke code)     |
| User integration (Connect)      | Yes       | ✅ Generated from registry (no bespoke code)     |
| OAuth scope picker entry        | No        | ❌ Not used — single `.default` scope, no picker |
| Native-connector catalog entry  | Yes       | ⏳ Confirm `infra/config/connectors.ts` lists it |
| `lib/oauth-providers/` provider | No        | ❌ Not needed (chat-only, not file-browsing)     |
| Auto-derive Dataverse scope     | Optional  | ⏳ Enhancement (see §3 — recommended follow-up)  |
| Entra app credentials           | Yes       | ⛔ External — register an app per customer       |

---

## 1. Connector Registry Entry (DONE)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

The entry is already committed (in the "Tier 2: OAuth2 (Microsoft Dataverse — PPM)" block). Its
shape, reproduced verbatim:

```typescript
{
  id: 'pmo365',
  displayName: 'PMO365',
  icon: 'bi-diagram-3',
  description:
    'PMO365 project portfolio management — projects, risks, benefits, and financials, served from Microsoft Dataverse',
  category: 'Project Management',
  authType: 'oauth2',
  surfaces: ['chat'],
  cachingPolicy: CACHING_PRESETS.projectManagement,
  oauth: {
    authUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
    scopes: 'https://YOUR-ENV.crm.dynamics.com/.default offline_access',
    extraAuthParams: '{"response_mode":"query"}',
  },
  credentialFields: [
    {
      key: 'environment_url',
      label: 'Dataverse environment URL',
      type: 'url',
      placeholder: 'https://yourorg.crm.dynamics.com',
      required: true,
      helpText:
        'Your PMO365 environment Dataverse URL (Power Platform admin center → Environments → your environment → Environment URL). All users in this workspace share it; the Web API is served from {environment_url}/api/data/v9.2/.',
    },
  ],
  oauthSetupSteps: [ /* Entra app registration steps — see §4 */ ],
}
```

Field-by-field rationale:

- **`surfaces: ['chat']`** — chat-only. PMO365 records are queried/mutated by the agent through
  the connector request path; they are not browsed in Files Remote. (No `'files'` surface, hence
  no provider class.)
- **`authType: 'oauth2'`** + the `organizations` authority — Dataverse is a work/school-account
  resource only (no personal Microsoft accounts), so the authority is `organizations`, **not**
  `common` or `consumers`.
- **`scopes: 'https://YOUR-ENV.crm.dynamics.com/.default offline_access'`** — the Dataverse
  resource scope is **environment-specific**. `.default` requests every delegated permission the
  Entra app has been granted (here: Dynamics CRM `user_impersonation`). `offline_access` is what
  yields a **refresh token**. The literal `YOUR-ENV.crm.dynamics.com` is a placeholder the admin
  must replace (see §3).
- **`extraAuthParams: '{"response_mode":"query"}'`** — forces the v2.0 authorize endpoint to
  return the code on the query string (the redirect flow Numa expects), persisted to the
  connection's `extra_auth_params` field by the wizard.
- **`credentialFields: [environment_url]`** — workspace-wide base host, exactly analogous to
  Actionstep's `api_endpoint` and Total Synergy's `instance_url`. The backend `connect_request`
  path expands every relative path the agent issues against `{environment_url}/api/data/v9.2/`.
- **`cachingPolicy: CACHING_PRESETS.projectManagement`** — 30-minute (`ttl: 1800`) read cache,
  the shared preset for PM connectors.

---

## 2. Backend Provider Class — NOT REQUIRED

PMO365 is chat-only and spec-driven. There is **no** `lib/oauth-providers/pmo365_provider.py` and
no `handleListProviders` / `getProviderConfig` Files-Remote wiring. The workspace agent issues
authenticated requests through the standard `connect_request` path (`method` + relative `path` +
optional JSON body) using the OAuth token Numa already stores, guided by the `01*` rules in this
folder. The Bearer token is attached as `Authorization: Bearer {access_token}` (standard scheme —
**no** `authHeaderScheme` override is set for this connector).

(If a future requirement adds Files-Remote browsing of Dataverse documents / `annotation`
attachments, then — and only then — add a provider class and set `surfaces: ['files','chat']`.)

---

## 3. The `environment_url` credential field + the scope wrinkle

### 3a. `environment_url` (workspace-wide base host)

The admin records the Dataverse environment URL (e.g. `https://contoso.crm.dynamics.com`) in the
`environment_url` credential field — workspace-wide, like Actionstep's `api_endpoint`. The backend
expands every relative path the agent uses against `{environment_url}/api/data/v9.2/`, so the
agent never hard-codes a host. The value is found in **Power Platform admin center → Environments →
(your environment) → Environment URL**.

### 3b. The environment-specific scope wrinkle ⚠️

Dataverse OAuth requires a **resource-specific** scope: `{environment_url}/.default offline_access`.
But the OAuth wizard's dynamic URL interpolation **only rewrites `authUrl` and `tokenUrl`** — it
splices credential-field values into those two URLs via `<KEY>` placeholders
(`OAuthWizard.tsx`, the "Dynamic URL interpolation" block). It does **not** touch the `scopes`
string. For PMO365 the auth/token endpoints are static (`login.microsoftonline.com/organizations/…`),
so there is nothing to interpolate there — and the one field that _would_ need to flow into the
scope (`environment_url`) is never substituted.

**Consequence:** the registry ships the scope with the literal placeholder
`https://YOUR-ENV.crm.dynamics.com/.default offline_access`. After pasting `environment_url`, the
admin **must open the wizard's Advanced section and replace `YOUR-ENV.crm.dynamics.com` in the
scope with their environment host** so it matches the resource they are requesting. This is exactly
what the last `oauthSetupSteps` line instructs. If the scope host does not match the environment,
the token will be issued for the wrong resource and Dataverse returns **401** on every call.

### 3c. Recommended follow-up — auto-derive the scope from `environment_url`

The manual Advanced-section edit is the only fiddly step in setup and the most likely place for an
admin to get it wrong (host typo, leftover placeholder, trailing slash). Two clean ways to remove
it, in increasing order of effort:

1. **Wizard-side interpolation (preferred, frontend-only).** Extend the interpolation step in
   `OAuthWizard.tsx` so it also substitutes `<KEY>` placeholders into the `scopes` string (not
   just `authUrl` / `tokenUrl`). Then change the registry scope to
   `<ENVIRONMENT_URL>/.default offline_access`, and the wizard rewrites it from the
   `environment_url` field automatically. Normalise the value (strip any trailing `/`) before
   splicing. This generalises cleanly to any future resource-scoped Microsoft connector.
2. **Backend derivation at token exchange.** Have the OAuth token-exchange handler construct the
   Dataverse scope from the stored `environment_url` (`f"{environment_url.rstrip('/')}/.default
offline_access"`) rather than trusting the persisted scope string, making the Advanced field a
   fallback/override only.

Either removes the hand-edited scope host. Scope this as a follow-up task — it is **not** required
for first testing; the manual edit works.

---

## 4. Entra app registration (`oauthSetupSteps`)

These steps are surfaced in the admin wizard (the `oauthSetupSteps` array). They produce the
**Application (client) ID** and **client secret** the admin pastes into the wizard, plus a
**Dataverse Application User** so the app can actually read/write PMO365 tables:

1. **App registration.** Entra admin center → **App registrations → New registration**; under
   _Supported account types_ choose **"Accounts in any organizational directory"** (matches the
   `organizations` authority).
2. **Redirect URI.** Add the redirect URI shown in the wizard as type **Web**.
3. **API permission.** **API permissions → Add a permission → Dynamics CRM → Delegated →
   `user_impersonation`**, then **Grant admin consent**. (`user_impersonation` is the delegated
   permission `.default` resolves to for Dataverse.)
4. **Client secret.** **Certificates & secrets → New client secret** → copy the **Value** (not the
   secret ID); copy the **Application (client) ID** from the **Overview** page.
5. **Application User + security role.** Power Platform admin center → add an **Application User**
   for this app registration and assign a **security role** granting read/write on the PMO365
   tables. Without this, tokens authenticate but every call returns **403** (missing privilege).
6. **Environment URL + scope.** Paste the `environment_url` above, then open **Advanced** and
   replace `YOUR-ENV.crm.dynamics.com` in the scope with your environment host (see §3b).

---

## 5. Workspace Agent Specs (DONE) & Deploy mechanism

The `01*` files in this folder are the agent knowledge pack:

- `01-llm-api-rules.md` (main rules, **< 300 lines**)
- `01a-domain-model-reference.md`, `01b-query-patterns.md`, `01c-mutation-patterns.md`,
  `01d-event-and-error-handling.md`

**Deploy.** `numa-client-stack.ts` walks the `ext-api-doc/` tree at synth time (skipping
`_templates/`) and uploads every file to the per-client `ext-api-doc` S3 bucket as an `S3Object`,
keyed by its path **relative to `ext-api-doc/`** (so this file lands at S3 key
`pmo365/03-connector-setup.md`). At runtime the workspace agent's S3 sync downloads the **`01-*.md`**
files for each active connector into **`/workdir/api-docs/pmo365/`** (`s3_workspace.py`), and the
system prompt advertises that path to the model (`prompts.py`:
`/workdir/api-docs/{name}/`). The folder name **`pmo365`** must equal the registry `id` — that
parity is enforced by `tools/check-connector-docs.mjs`.

> Note: only the `01-*.md` files are pulled into the agent's `/workdir`. `00`, `02`, `03`
> (this file), and `04` are developer/reference docs that live in S3 but are not loaded into the
> model's context.

---

## 6. Deployment Checklist

### Code (done in this branch)

- [x] Registry entry added (`connectorRegistry.ts` — `pmo365`)
- [x] `ext-api-doc/pmo365/` specs committed (`01`–`01d`, plus `00`/`02`/`03`/`04`)
- [ ] Parity check passes (`node tools/check-connector-docs.mjs`)
- [ ] Native-connector catalog entry confirmed in `infra/config/connectors.ts`
- [ ] Frontend lint + typecheck clean (`yarn lint && yarn typecheck`)

### External / deploy (developer)

- [ ] Register an Entra app per customer and capture **Client ID** + **secret** (see §4)
- [ ] Add the **Dataverse Application User** with a read/write security role on the PMO365 tables
- [ ] Deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` S3 sync + `NATIVE_CONNECTORS`)
- [ ] Verify `s3://numa-<client>-ext-api-doc/pmo365/01-*.md` objects exist after deploy
- [ ] Confirm the connector appears in **/integrations** (gated by `DATA_CONNECTORS_ENABLED`)
- [ ] **Phase 2 smoke test** against the customer's Dataverse environment (see §7 and
      `04-connection-and-reauth.md`)
- [ ] Confirm the 🔬/[INFERRED] items: real `pmo_*` table & column names (via the discovery
      queries / `$metadata`), option-set values, statecode/statuscode state machine

---

## 7. Testing Plan

### Manual sequence

1. **Admin setup:** open the PMO365 OAuth wizard, enter Client ID/Secret, paste the
   `environment_url`, then in **Advanced** replace `YOUR-ENV.crm.dynamics.com` in the scope with
   the environment host (§3b). Save.
2. **User connect:** click **Connect** → authorize on `login.microsoftonline.com/organizations`
   (consent to Dynamics CRM `user_impersonation`) → token exchange. `offline_access` ⇒ a refresh
   token is stored.
3. **Discovery (the theme — Phase 2 gate):** ask the agent to "find the PMO365 solution and list
   its tables". Expect, in order:
   - `GET /solutions?$select=solutionid,uniquename,friendlyname,version&$filter=contains(uniquename,'pmo') or contains(friendlyname,'pmo')`
   - `GET /solutioncomponents?$filter=_solutionid_value eq {solutionid} and componenttype eq 1&$select=objectid`
   - `GET /EntityDefinitions({metadataid})?$select=LogicalName,EntitySetName,DisplayName,PrimaryIdAttribute,PrimaryNameAttribute`

   This resolves the real `pmo_*` `EntitySetName`s at runtime — they are **proprietary and never
   hard-coded** (see the honesty rule below).

4. **Read:** "list the active PMO365 projects" → e.g. (ILLUSTRATIVE — confirm the entity set via
   discovery)
   `GET /pmo_projects?$select=pmo_name,pmo_projectid,statuscode&$top=20`
   with header `Prefer: odata.include-annotations="*"` so option-set / lookup labels come back as
   `@OData.Community.Display.V1.FormattedValue`. Sample response shape:

   ```json
   {
     "@odata.context": "https://contoso.crm.dynamics.com/api/data/v9.2/$metadata#pmo_projects(pmo_name,pmo_projectid,statuscode)",
     "value": [
       {
         "@odata.etag": "W/\"123456\"",
         "pmo_name": "Customer Portal Rebuild",
         "pmo_projectid": "8f2c1e90-7c4a-4f12-9b3a-0c1d2e3f4a5b",
         "statuscode": 1,
         "statuscode@OData.Community.Display.V1.FormattedValue": "Active"
       }
     ],
     "@odata.nextLink": "https://contoso.crm.dynamics.com/api/data/v9.2/pmo_projects?$select=pmo_name,pmo_projectid,statuscode&$skiptoken=..."
   }
   ```

   Follow `@odata.nextLink` **verbatim** for the next page (server-driven paging); control page
   size with `Prefer: odata.maxpagesize=N` (max 5000). Do **not** hand-roll `$skip`.

5. **Expand a lookup:** "show project X with its owning programme" →
   `GET /pmo_projects({id})?$expand=pmo_ProgrammeId($select=pmo_name)` (ILLUSTRATIVE nav property —
   confirm via `$metadata`). The lookup GUID column is exposed as `_pmo_programmeid_value`.
6. **Write (create):** "create a risk on project X" →
   `POST /pmo_risks` with body
   `{ "pmo_name": "Vendor delay", "pmo_ProjectId@odata.bind": "/pmo_projects({id})" }`
   ⇒ **204 No Content** with an `OData-EntityId` response header (URL of the new row), or
   **201** + body if `Prefer: return=representation` is sent.
7. **Write (update):** "set that risk's status" →
   `PATCH /pmo_risks({id})` with header **`If-Match: *`** to force update-only (Dataverse PATCH is
   an **upsert** — without `If-Match: *` it will create a row if the id is absent).
8. **Polling for changes (events):** there is **no Numa-hosted webhook receiver** for Dataverse
   yet. Verify the agent polls instead:
   `GET /pmo_projects?$filter=modifiedon gt 2026-05-29T00:00:00Z&$orderby=modifiedon asc` at an
   interval **≥ 5 min**.
9. **Disconnect:** user disconnect removes the user secret only; the workspace-wide
   `environment_url` and Entra app config remain.

### Edge cases

- [ ] **401** (access token expired, ~1h) → backend refreshes via `offline_access` and retries
      once; a second 401 ⇒ user must reconnect
- [ ] **401 on every call** → wrong scope host (placeholder not replaced in Advanced, §3b)
- [ ] **403** → Application User missing / security role lacks the privilege on the table (§4 step 5)
- [ ] **404** → wrong `EntitySetName` (it is **not** the logical name — `pmo_project` →
      `pmo_projects`; resolve via discovery) or a wrong record GUID
- [ ] **412** → `If-Match: *` precondition failed on PATCH
- [ ] **429** service-protection limit → honour the **`Retry-After`** header (seconds) before
      retrying; avoid tight loops (per-user sliding 5-min window, three facets: ~6,000 requests / ~20 min (1,200,000 ms) of combined execution time / concurrency cap of ~52 concurrent requests)
- [ ] **Pagination** beyond one page → `@odata.nextLink` followed verbatim until absent

---

## Honesty rule (carry into every spec)

PMO365's actual custom table and column names (`pmo_project`, `pmo_risk`, `pmo_benefit`, …) are
**proprietary and not publicly documented**. Every such name in this folder is an **ILLUSTRATIVE
[INFERRED]** example, always paired with the **discovery query** that yields the real name at
runtime. Never mark a specific `pmo_*` name as `[CONFIRMED]`. Discovery-first (`/solutions` →
`/solutioncomponents` → `/EntityDefinitions`, or `$metadata`) is the recurring theme — it is how
the real schema is obtained, not by guessing.

---

## Sources

- Dataverse Web API (OData v4): https://learn.microsoft.com/power-apps/developer/data-platform/webapi/overview
- Query data with the Web API: https://learn.microsoft.com/power-apps/developer/data-platform/webapi/query-data-web-api
- Create / Update / Delete via Web API: https://learn.microsoft.com/power-apps/developer/data-platform/webapi/create-entity-web-api
- Service protection (API) limits: https://learn.microsoft.com/power-apps/developer/data-platform/api-limits
- Web API EntityType / EntityDefinitions metadata: https://learn.microsoft.com/power-apps/developer/data-platform/webapi/query-metadata-web-api
- OAuth (use OAuth with Dataverse): https://learn.microsoft.com/power-apps/developer/data-platform/authenticate-oauth
- PMO365 (EPM Partners): https://www.pmo365.com/

_Generated from the investigation questionnaire. Pair with the `numa-connectors` skill. See also
`00-api-investigation-questionnaire.md`, the `01*` agent specs, and `04-connection-and-reauth.md`._

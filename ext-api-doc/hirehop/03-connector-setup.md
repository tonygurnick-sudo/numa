---
api_name: HireHop
connector_id: hirehop
auth_type: api-key
tier: standard
category: Equipment & Rental
integration_path: direct-api
call_surface: HTTP via connect_request — path = {base_url}{path} incl. .php script. NOT a Files connector (no browsable tree)
prereqs: read 02-api-spec-investigation.md + ../../documentation/connectors/README.md; activate the numa-connectors skill before changing connector code
---

# HireHop — Connector & Integration Setup

The connector **already exists**. This reproduces the actual registry entry (so docs match shipped config) and explains how `ext-api-doc/hirehop/` reaches the workspace agent at runtime.

## Integration Type

Direct API via `connect_request` (API-key connector). NOT a Files connector — no browsable document tree. The agent calls HireHop directly through `connect_request`, which injects the stored `api_token` and uses the per-tenant `base_url` to build each call as `{base_url}{path}`.

| Component                | Required? | Notes                                                                                         |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------- |
| Connector Registry entry | Yes       | Already present — `id: 'hirehop'` (below)                                                     |
| Admin setup wizard       | No\*      | Generic api-key credential form driven by `credentialFields` — no bespoke wizard              |
| Backend provider class   | No        | Not a Files connector — no `lib/oauth-providers/` provider; requests go via `connect_request` |
| Workspace agent prompt   | Yes       | `01-*.md` + companions, deployed to the ext-api-doc S3 bucket (§3)                            |
| Feature flag             | Yes       | `DATA_CONNECTORS_ENABLED` gates connectors + the Secrets Vault                                |
| i18n keys                | Yes       | `credentialFields` labels/help are i18n keys (e.g. `dataConnectors.fields.apiToken`)          |

\*Credential form rendered generically from `credentialFields` — no HireHop-specific wizard code.

## 1. Connector Registry Entry (actual)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (the live registry; the generic template's `src/Config/connectorRegistry.ts` is outdated). The `hirehop` entry verbatim:

```typescript
{
  id: 'hirehop',
  displayName: 'HireHop',
  icon: 'bi-truck',
  description: 'Equipment rental and event hire management',
  category: 'Equipment & Rental',
  authType: 'api-key',
  credentialFields: [
    { key: 'api_token', label: 'dataConnectors.fields.apiToken', type: 'password', placeholder: 'Paste your HireHop API token', required: true, helpText: 'dataConnectors.fields.apiTokenHint' },
    { key: 'base_url', label: 'dataConnectors.fields.baseUrl', type: 'url', placeholder: 'https://myhirehop.com', required: true, helpText: 'dataConnectors.fields.baseUrlHint' },
  ],
},
```

Notes on the actual config:

- `authType: 'api-key'` — no `oauth` block, no `authUrl`/`tokenUrl`/`scopes`/`extraAuthParams`. Static-token connector matching the API's auth model (see `02`/`04`).
- Two `required: true` credential fields: `api_token` (`type: 'password'`, stored as a secret, never echoed) and `base_url` (`type: 'url'`, placeholder `https://myhirehop.com`). `base_url` is the **per-tenant host** — HireHop runs the same app on `myhirehop.com`/`hirehop.net`/`myhirehop.co.uk` (or a vanity domain), so it must be captured per customer. Every call is `{base_url}{path}` with the token attached.
- `icon: 'bi-truck'` — Bootstrap Icons class (not an SVG asset path). `category: 'Equipment & Rental'`.
- **No `surfaces` array** on this entry (unlike e.g. `actionstep` → `surfaces: ['chat']`), no `cachingPolicy`, no `apiReference` block. Do not add fields the shipped entry lacks unless deliberately extending — keep docs aligned with the real config.
- Sits under the "Tier 2: API Key" registry section, alongside `connecteam-api` and `totalsynergy-api`.

## 2. Credentials & Auth Injection at Runtime

No backend provider class. At request time `connect_request` resolves the stored `hirehop` credentials and builds the call:

- **Base:** stored `base_url` (e.g. `https://myhirehop.com`) — prepended to the endpoint path.
- **Token:** stored `api_token`, preferably attached as the `X-TOKEN` header (keeps secret out of URLs/logs, avoids URL-encoding bugs). Fallbacks supported by the API: `?token=` (URL-encoded), POST form field `token`, JSON body `"token"`.
- The agent never sees the raw token — `connect_request` attaches it. Never log or echo it.

Credential storage follows the standard connector vault pattern (`connector-*` secrets). See `../../documentation/connectors/README.md` for the two-secret model; nothing HireHop-specific required.

## 3. Reference-Doc Deployment (how 01–04 reach the agent)

The `ext-api-doc/hirehop/` markdown files ship to client stacks and load into the workspace agent at runtime. Actual mechanism (do not hand-deploy):

1. **Build/synth — CDKTF uploads to S3.** `infra/stacks/numa-client-stack.ts` ("Sync ext-api-doc files to S3" block) walks `ext-api-doc/`, skips `_templates/`, and creates an `S3Object` per file under each connector folder. They land in the per-client **`{clientName}-ext-api-doc`** bucket (`core.extApiDocBucket`), preserving `{slug}/{filename}` keys — e.g. `hirehop/01-llm-api-rules.md`. Each object is content-hashed (`Fn.filemd5`) so a changed file re-uploads on the next deploy.
2. **Runtime — the agent downloads the LLM docs on demand.** `services/numa-workspace-agent/numa_workspace_agent/s3_workspace.py` → `sync_ext_api_docs_for_connectors(connector_names)` runs at container init for the conversation's connected connectors. For each slug it lists `s3://{EXT_API_DOC_BUCKET}/{slug}/` and downloads the markdown into `/workdir/api-docs/{slug}/`.
   - The `00-*.md` questionnaire is **explicitly excluded** (human investigation template — must stay out of agent context).
   - Everything `01/02/03/04` is downloaded (the code filters out only files starting with `00`). `01-llm-api-rules.md` is the primary in-context rules file; `01a–01d`, `02`, `03`, `04` are deeper reference alongside it.
   - Already-synced slugs are skipped for the life of the container (docs only change on deploy).

To update what the agent knows about HireHop, edit the files in `ext-api-doc/hirehop/` and **deploy** the client stack (CDKTF). No separate prompt-registration step.

## 4. i18n Keys

File: `numa-frontend/src/locales/en/integrations.json` (and other locales). The credential labels/help in the registry are i18n keys that must resolve:

```json
{
  "dataConnectors.fields.apiToken": "API token",
  "dataConnectors.fields.apiTokenHint": "Your HireHop API token (Settings → Users → your API user → Menu → API Token).",
  "dataConnectors.fields.baseUrl": "Base URL",
  "dataConnectors.fields.baseUrlHint": "Your HireHop host, e.g. https://myhirehop.com (NOT www.hirehop.com)."
}
```

`dataConnectors.fields.apiToken`/`apiKey`/`baseUrl`/`instanceUrl` are **shared** across api-key connectors (Connecteam, Total Synergy, etc.). Confirm the generic strings exist before adding HireHop-specific copy; only add new keys for HireHop-specific wording.

## 5. Verification Checklist

**Config alignment:**

- [ ] `id: 'hirehop'` entry present in `connectorRegistry.ts`
- [ ] `authType: 'api-key'`, two required fields (`api_token` password, `base_url` url)
- [ ] i18n keys `apiToken`/`apiTokenHint`/`baseUrl`/`baseUrlHint` resolve in all locales
- [ ] `bi-truck` icon renders in the Integrations surface

**Reference docs:**

- [ ] `ext-api-doc/hirehop/` contains `01-*.md` (+ companions), `02`, `03`, `04` — and NO `00-*.md` reaches the agent (excluded at sync)
- [ ] After a client-stack deploy, files appear in `s3://{clientName}-ext-api-doc/hirehop/`
- [ ] Agent log shows `_name=EXT_API_DOC_SYNCED` listing `hirehop` for a conversation with HireHop connected

**Functional (against a real tenant — once credentials exist):**

- [ ] Connect HireHop with a real `api_token` + `base_url`
- [ ] Smoke test: `GET {base_url}/php_functions/get_user_info.php` returns the token owner (verifies token)
- [ ] Read a job: `GET {base_url}/api/job_data.php?job={id}` returns metadata
- [ ] **Discovery task:** enumerate the tenant's job-status integers before relying on `status_save.php`
- [ ] Rate-limit: confirm ≤3/s, ≤60/min; observe `X-Request-Count` / `X-RateLimit-Available`

## 6. Testing Plan

**Manual sequence (workspace chat):**

1. **Connect:** add the HireHop connector as a user with a valid `api_token` + `base_url`.
2. **Identity:** "who am I in HireHop?" → `get_user_info.php`.
3. **Read:** "show me job 52" → `job_data.php` (metadata only; line items absent).
4. **Reference data:** "list our depots" → `get_depots.php`.
5. **Availability:** "is product 123 available 10–15 June?" → `availability_get_available.php`.
6. **Write (guarded):** "create a quote for Jane Smith out 10 June…" → `save_job.php` with `job=0`. Confirm it does NOT re-create on retry (creates are not idempotent).
7. **Status:** "mark job 53 as booked" → only after the tenant's status integers are known.
8. **Lock respect:** attempt a write on a `LOCKED` job → agent should refuse.

**Edge cases:**

- [ ] Wrong host (`www.hirehop.com`) → 403; confirm the agent uses the stored `base_url`
- [ ] Token in query string is URL-encoded (or `X-TOKEN` header is used)
- [ ] Application error in a 2xx body (`{"error":3}`) is detected, not ignored
- [ ] Rate-limit 429 / error 327 → back off and retry
- [ ] Expired/invalidated token (user re-login or pw change) → 401/403 → prompt re-credential

See also: `02-api-spec-investigation.md` (API reference), `04-connection-and-reauth.md` (credential generation & rotation), `../../documentation/connectors/README.md`.

---
api_name: 'HireHop'
connector_id: 'hirehop'
auth_type: 'api-key'
tier: 'standard'
category: 'Equipment & Rental'
integration_path: 'direct-api'
---

# HireHop -- Connector & Integration Setup

> Build/reference notes for the HireHop connector in Numa.
>
> **The connector already exists.** This document reproduces and describes the **actual** registry
> entry (so the docs match the shipped config), and explains how the `ext-api-doc/hirehop/` reference
> files reach the workspace agent at runtime.
>
> **Prerequisites:** read `02-api-spec-investigation.md` (API reference) and the
> [Numa Connectors documentation](../../documentation/connectors/README.md) first. Activate the
> `numa-connectors` skill before changing any connector code.

---

## Integration Type

**Selected path:** Direct API via `connect_request` (API-key connector).

HireHop is NOT a Files connector — there is no browsable document tree. The workspace agent calls the
HireHop API directly through `connect_request`, which injects the stored `api_token` credential and uses
the per-tenant `base_url` to build each request as `{base_url}{path}`.

| Component                | Required? | Notes                                                                                         |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------- |
| Connector Registry entry | Yes       | **Already present** — `id: 'hirehop'` (reproduced below)                                      |
| Admin setup wizard       | No\*      | Generic api-key credential form driven by `credentialFields` — no bespoke wizard component    |
| Backend provider class   | No        | Not a Files connector — no `lib/oauth-providers/` provider; requests go via `connect_request` |
| Workspace agent prompt   | Yes       | `01-*.md` + companions, deployed to the ext-api-doc S3 bucket (see §3)                        |
| Feature flag             | Yes       | `DATA_CONNECTORS_ENABLED` gates connectors + the Secrets Vault (frontend `CLAUDE.md`)         |
| i18n keys                | Yes       | `credentialFields` labels/help are i18n keys (e.g. `dataConnectors.fields.apiToken`)          |

\* The credential form is rendered generically from `credentialFields` — no HireHop-specific wizard code.

---

## 1. Connector Registry Entry (actual)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
> (Note: this is the real path. The generic template's `src/Config/connectorRegistry.ts` is outdated —
> the live registry lives under `Components/DataConnectors/`.)

The `hirehop` entry as it exists in the registry today, verbatim:

```typescript
{
  id: 'hirehop',
  displayName: 'HireHop',
  icon: 'bi-truck',
  description: 'Equipment rental and event hire management',
  category: 'Equipment & Rental',
  authType: 'api-key',
  credentialFields: [
    {
      key: 'api_token',
      label: 'dataConnectors.fields.apiToken',
      type: 'password',
      placeholder: 'Paste your HireHop API token',
      required: true,
      helpText: 'dataConnectors.fields.apiTokenHint',
    },
    {
      key: 'base_url',
      label: 'dataConnectors.fields.baseUrl',
      type: 'url',
      placeholder: 'https://myhirehop.com',
      required: true,
      helpText: 'dataConnectors.fields.baseUrlHint',
    },
  ],
},
```

**Notes on the actual config:**

- `authType: 'api-key'` — no `oauth` block, no `authUrl`/`tokenUrl`/`scopes`/`extraAuthParams`. This is a
  static-token connector, exactly matching the API's auth model (see `02-api-spec-investigation.md` and
  `04-connection-and-reauth.md`).
- **Two credential fields, both `required: true`:**
  - `api_token` (`type: 'password'`) — the HireHop API token. Stored as a secret; never echoed.
  - `base_url` (`type: 'url'`, placeholder `https://myhirehop.com`) — the **per-tenant host**. HireHop runs
    the same app on `myhirehop.com` / `hirehop.net` / `myhirehop.co.uk` (or a vanity domain), so the base
    URL must be captured per customer rather than hard-coded. Both fields are needed at request time:
    every call is `{base_url}{path}` with the token attached.
- `icon: 'bi-truck'` — Bootstrap Icons class (not an SVG asset path).
- `category: 'Equipment & Rental'`.
- There is **no `surfaces` array** on this entry (unlike e.g. `actionstep`, which sets `surfaces: ['chat']`),
  no `cachingPolicy`, and no `apiReference` block. Do not add fields that the shipped entry does not have
  unless you are deliberately extending it — keep the docs aligned with the real config.

The entry sits under the **"Tier 2: API Key"** section of the registry, alongside `connecteam-api` and
`totalsynergy-api`.

---

## 2. Credentials & Auth Injection at Runtime

There is no backend provider class. At request time `connect_request` resolves the stored connector
credentials for `hirehop` and builds the call:

- **Base:** the stored `base_url` (e.g. `https://myhirehop.com`) — prepend it to the endpoint path.
- **Token:** the stored `api_token`, preferably attached as the `X-TOKEN` header (keeps the secret out of
  URLs/access logs and avoids URL-encoding bugs). Fallback locations supported by the API: `?token=`
  (URL-encoded), POST form field `token`, or JSON body `"token"`.
- The agent never sees the raw token — `connect_request` attaches it. Never log or echo it.

Credential storage follows the standard connector vault pattern (`connector-*` secrets). See the
[Numa Connectors documentation](../../documentation/connectors/README.md) for the two-secret model and
vault wiring; nothing HireHop-specific is required there.

---

## 3. Reference-Doc Deployment (how 01–04 reach the agent)

The `ext-api-doc/hirehop/` markdown files are shipped to client stacks and loaded into the workspace agent
at runtime. This is the actual mechanism (do not hand-deploy):

1. **Build/synth time — CDKTF uploads the files to S3.**
   `infra/stacks/numa-client-stack.ts` (the "Sync ext-api-doc files to S3" block near the end of the stack)
   walks `ext-api-doc/`, skips the `_templates/` directory, and creates an `S3Object` for every file under
   each connector folder. They land in the per-client **`{clientName}-ext-api-doc`** bucket
   (`core.extApiDocBucket`), preserving the `{slug}/{filename}` key layout — e.g. `hirehop/01-llm-api-rules.md`.
   Each object is content-hashed (`Fn.filemd5`) so a changed file re-uploads on the next deploy.

2. **Runtime — the workspace agent downloads the LLM docs on demand.**
   `services/numa-workspace-agent/numa_workspace_agent/s3_workspace.py` →
   `sync_ext_api_docs_for_connectors(connector_names)` runs at container init for the conversation's
   connected connectors. For each connector slug it lists `s3://{EXT_API_DOC_BUCKET}/{slug}/` and downloads
   the reference markdown into `/workdir/api-docs/{slug}/`.
   - **The `00-*.md` questionnaire is explicitly excluded** — it is the human investigation template and
     must stay out of the agent context.
   - **Everything `01/02/03/04` is downloaded** (the code filters out only files starting with `00`; the
     `01-llm-api-rules.md` is the primary in-context rules file, with `01a–01d`, `02`, `03`, `04` available
     as deeper reference alongside it).
   - Already-synced slugs are skipped for the life of the container (docs only change on deploy).

**Net effect:** when a customer connects HireHop, the agent loads `01-llm-api-rules.md` (and companions)
for the `hirehop` slug into its workspace, giving it the auth model, gotchas, endpoint table, and working
examples needed to drive the API safely.

> So: to update what the agent knows about HireHop, edit the files in `ext-api-doc/hirehop/` and **deploy**
> the client stack (CDKTF). There is no separate prompt-registration step.

---

## 4. i18n Keys

> File: `numa-frontend/src/locales/en/integrations.json` (and other locale files)

The credential field labels/help in the registry are i18n keys — they must resolve. The shared keys used
by this entry:

```json
{
  "dataConnectors.fields.apiToken": "API token",
  "dataConnectors.fields.apiTokenHint": "Your HireHop API token (Settings → Users → your API user → Menu → API Token).",
  "dataConnectors.fields.baseUrl": "Base URL",
  "dataConnectors.fields.baseUrlHint": "Your HireHop host, e.g. https://myhirehop.com (NOT www.hirehop.com)."
}
```

`dataConnectors.fields.apiToken` / `apiKey` / `baseUrl` / `instanceUrl` are **shared** across api-key
connectors (Connecteam, Total Synergy, etc.) — confirm the generic strings exist before adding
HireHop-specific copy. Only add new keys if you need HireHop-specific wording.

---

## 5. Verification Checklist

Since the connector already ships, verification is mostly "does it still match and work":

### Config alignment

- [ ] `id: 'hirehop'` entry present in `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
- [ ] `authType: 'api-key'`, two required credential fields (`api_token` password, `base_url` url)
- [ ] i18n keys for `dataConnectors.fields.apiToken` / `apiTokenHint` / `baseUrl` / `baseUrlHint` resolve in all locales
- [ ] `bi-truck` icon renders in the Integrations surface

### Reference docs

- [ ] `ext-api-doc/hirehop/` contains `01-*.md` (+ companions), `02`, `03`, `04` — and NO `00-*.md` reaches the agent (it must, but is excluded at sync)
- [ ] After a client-stack deploy, files appear in `s3://{clientName}-ext-api-doc/hirehop/`
- [ ] Agent log shows `_name=EXT_API_DOC_SYNCED` listing `hirehop` for a conversation with HireHop connected

### Functional (against a real tenant — once credentials exist)

- [ ] Connect HireHop with a real `api_token` + `base_url`
- [ ] Smoke test: `GET {base_url}/php_functions/get_user_info.php` returns the token owner (verifies token)
- [ ] Read a job: `GET {base_url}/api/job_data.php?job={id}` returns metadata
- [ ] **Discovery task:** enumerate the tenant's job-status integers before relying on `status_save.php`
- [ ] Rate-limit behaviour: confirm ≤3/sec, ≤60/min; observe `X-Request-Count` / `X-RateLimit-Available`

---

## 6. Testing Plan

### Manual Testing Sequence (workspace chat)

1. **Connect:** add the HireHop connector as a user with a valid `api_token` + `base_url`.
2. **Identity:** ask the agent "who am I in HireHop?" → it calls `get_user_info.php`.
3. **Read:** "show me job 52" → `job_data.php` (metadata only; note line items are absent).
4. **Reference data:** "list our depots" → `get_depots.php`.
5. **Availability:** "is product 123 available 10–15 June?" → `availability_get_available.php`.
6. **Write (guarded):** "create a quote for Jane Smith out 10 June…" → `save_job.php` with `job=0`.
   Confirm it does NOT re-create on retry (creates are not idempotent).
7. **Status:** "mark job 53 as booked" → only after the tenant's status integers are known.
8. **Lock respect:** attempt a write on a `LOCKED` job → agent should refuse.

### Edge Cases

- [ ] Wrong host (`www.hirehop.com`) → 403; confirm the agent uses the stored `base_url`
- [ ] Token in query string is URL-encoded (or `X-TOKEN` header is used)
- [ ] Application error in a 2xx body (`{"error": 3}`) is detected, not ignored
- [ ] Rate-limit 429 / error 327 → back off and retry
- [ ] Expired/invalidated token (user re-login or pw change) → 401/403 → prompt re-credential

---

_Generated from the investigation questionnaire (`00-api-investigation-questionnaire.md`). See also:_

- _`02-api-spec-investigation.md` — clean API reference_
- _`04-connection-and-reauth.md` — credential generation & rotation_
- _[Connector Framework Documentation](../../documentation/connectors/README.md)_

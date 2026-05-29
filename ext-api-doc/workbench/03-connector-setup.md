---
api_name: 'Workbench International (ERP)'
connector_id: 'workbench'
auth_type: 'token'
tier: 'standard'
category: 'ERP'
integration_path: 'direct-api (spec-driven, chat-only)'
---

# Workbench International — Connector & Integration Setup

> Build/setup reference for the Workbench International connector. **Integration path: Direct API,
> chat-only, spec-driven** — same shape as Total Synergy / Actionstep / NetSuite. The workspace agent
> reads the `ext-api-doc/workbench/` specs (this folder) and calls the API through the standard
> connector request (`connect_request`) path using the stored `bearer_token` + `instance_url`.
> **No `lib/oauth-providers/` provider class is required** (it is not a Files-Remote / file-browsing
> connector).
>
> Prerequisites: read `00-api-investigation-questionnaire.md` + `02-api-spec-investigation.md`, and
> activate the `numa-connectors` skill.
>
> ⚠️ **Discovery-first connector.** The registry entry already exists and the connector can
> authenticate, but the API _reference_ (endpoints, fields, pagination, errors) is gated behind each
> customer's per-instance Swagger and is `[INFERRED]`/`[UNKNOWN]` until dumped. See the caveat in §1
> and the smoke-test in `04-connection-and-reauth.md`.

---

## Integration Type

**Selected path:** Direct API (spec-driven, chat-only)

| Component                       | Required? | Status                                                               |
| ------------------------------- | --------- | -------------------------------------------------------------------- |
| Connector Registry entry        | Yes       | ✅ Done — `connectorRegistry.ts` (`id: 'workbench'`)                 |
| `ext-api-doc/workbench/` specs  | Yes       | ✅ This folder (`00`, `01*`, `02`, `03`, `04`)                       |
| Admin setup wizard              | No        | ✅ Generated from registry `credentialFields` (no bespoke code)      |
| User connect flow (token entry) | Yes       | ✅ Generated from registry (token form: bearer token + instance URL) |
| `lib/oauth-providers/` provider | No        | ❌ Not needed (chat-only, not file-browsing — no Files-Remote)       |
| OAuth scope picker entry        | No        | ❌ Not OAuth — no `oauth` block in the entry                         |
| Workspace agent prompt (`01*`)  | Yes       | ✅ This folder — synced to S3 on deploy (see §3)                     |
| Feature flag                    | Yes       | `DATA_CONNECTORS_ENABLED` gates connectors + the Secrets Vault       |
| i18n keys                       | Yes       | ✅ Field labels reference existing shared keys (see §4)              |

---

## 1. Connector Registry Entry (DONE)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

The Workbench entry is **already committed**. This is the **actual** entry (verbatim, `id: 'workbench'`):

```typescript
{
  id: 'workbench',
  displayName: 'Workbench International',
  icon: 'bi-pc-display',
  description: 'ERP for trade and distribution businesses',
  category: 'ERP',
  authType: 'token',
  credentialFields: [
    {
      key: 'bearer_token',
      label: 'dataConnectors.fields.bearerToken',
      type: 'password',
      placeholder: 'Paste your Workbench bearer token',
      required: true,
    },
    {
      key: 'instance_url',
      label: 'dataConnectors.fields.instanceUrl',
      type: 'url',
      placeholder: 'https://yourcompany.workbench.com',
      required: true,
    },
  ],
},
```

**What the entry tells us (and what it deliberately omits):**

| Field              | Value                                            | Note                                                                             |
| ------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `id`               | `'workbench'`                                    | Must match this folder name (`ext-api-doc/workbench/`) for the docs parity check |
| `displayName`      | `'Workbench International'`                      | Shown in the connector list                                                      |
| `icon`             | `'bi-pc-display'`                                | Bootstrap Icons class (not an SVG path) — no custom asset needed                 |
| `description`      | `'ERP for trade and distribution businesses'`    | Catalog blurb                                                                    |
| `category`         | `'ERP'`                                          | Connector category                                                               |
| `authType`         | `'token'`                                        | Static bearer token — **no `oauth` block, no `scopes`, no refresh token**        |
| `credentialFields` | `bearer_token` (password) + `instance_url` (url) | The two values the user pastes; both `required: true`                            |
| `surfaces`         | _(absent)_                                       | No `surfaces` array → treated as **chat-only** (not added to Files-Remote)       |
| `cachingPolicy`    | _(absent)_                                       | No caching preset on this entry (cf. NetSuite's `{ ttl: 3600 }`)                 |
| `oauth`            | _(absent)_                                       | Correct for `authType: 'token'` — there is no authorize/token URL or scope list  |

> ⚠️ **Do not invent an `oauth` block, scopes, or auth endpoints for Workbench.** The live entry has
> none — auth is a pre-issued bearer token plus a per-tenant `instance_url`. The questionnaire and
> `02-api-spec-investigation.md` reflect exactly this; keep the docs aligned with the registry.

**Credential field labels** resolve via i18n to the shared `dataConnectors.fields.*` keys
(`bearerToken`, `instanceUrl`) — they are **not** Workbench-specific keys (see §4). The token entry
form (password input for the secret + URL input for the instance) is **rendered generically from
`credentialFields`** — there is no bespoke Workbench wizard component.

---

## 2. Backend Provider Class — NOT REQUIRED

Workbench is **chat-only and spec-driven**. There is **no** `lib/oauth-providers/workbench_provider.py`
and **no** `handleListProviders` / `getProviderConfig` Files-Remote wiring. The workspace agent issues
authenticated requests through the standard connector request (`connect_request`) path using the
`bearer_token` + `instance_url` Numa already stores, guided by the `01*` rules in this folder.

(If a future requirement adds Files-Remote document browsing — e.g. surfacing Workbench Document
Management attachments or invoice/claim PDFs as a file tree — then, and only then, add a provider class
and set `surfaces: ['files', 'chat']`. That surface is **not** part of this connector today; whether
the API even exposes attachments is `[UNKNOWN]` 🔬.)

---

## 3. Workspace Agent Specs & Deployment

The `01*` files in this folder are the agent knowledge pack loaded when the Workbench connector is active:

- `01-llm-api-rules.md` (main rules, < 300 lines)
- companion files (`01a`–`01d`) for the detailed domain / query / mutation / event reference, when present

**How the specs reach the agent (deploy mechanism):**

- These markdown files are **synced to the per-client `ext-api-doc` S3 bucket at deploy time by
  `infra/stacks/numa-client-stack.ts`** (the same stack that generates `config.json` / `capabilities.json`).
- At runtime the **workspace agent loads the `01-*.md` rules** for the active connector from that S3
  location and injects them into context. The agent reads `01-*` (not `02`/`03`/`04`) — `02` is the
  developer reference, `03`/`04` are build/setup docs for humans.
- The **folder name (`workbench`) must match the registry `id` (`'workbench'`)**, which is what keeps
  the connector and its docs in sync (and satisfies the connector-docs parity check,
  `tools/check-connector-docs.mjs`).

> So the lifecycle is: edit `01-*.md` here → `numa-client-stack` syncs `ext-api-doc/workbench/` to the
> client's S3 bucket on deploy → workspace agent loads the rules when a user has the Workbench
> connector connected. No code change is needed to update agent guidance — only a deploy that re-syncs
> the folder.

---

## 4. i18n Keys

> File: `numa-frontend/src/locales/en/*.json`

The credential field labels reference **shared** connector keys (already present), not Workbench-specific ones:

```json
{
  "dataConnectors.fields.bearerToken": "Bearer token",
  "dataConnectors.fields.instanceUrl": "Instance URL"
}
```

`displayName` (`'Workbench International'`) and `description` (`'ERP for trade and distribution
businesses'`) are inline literals on the registry entry, consistent with the other connector entries —
no extra i18n keys are required for Workbench specifically. The placeholders
(`'Paste your Workbench bearer token'`, `'https://yourcompany.workbench.com'`) are also inline on the
entry.

---

## 5. Deployment Checklist

### Code (done)

- [x] Registry entry committed (`connectorRegistry.ts`, `id: 'workbench'`, `authType: 'token'`)
- [x] Icon set via Bootstrap Icons class (`bi-pc-display`) — no SVG asset needed
- [x] `ext-api-doc/workbench/` specs committed (`00`, `01-*`, `02`, `03`, `04`)
- [x] Folder name matches registry id (parity: `node tools/check-connector-docs.mjs`)
- [ ] Frontend lint + typecheck clean after any edits

### External / deploy (developer)

- [ ] Obtain a customer **`bearer_token`** + **`instance_url`** (and confirm **Workbench Online** vs **Workbench SBO**)
- [ ] Deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` S3 sync via `numa-client-stack`; `DATA_CONNECTORS_ENABLED` on)
- [ ] **Phase 2 smoke test** against the live instance (see `04-connection-and-reauth.md`)
- [ ] **Pull `{instance_url}/swagger` and backfill** the 🔬 gaps: real path prefix, resource/field
      names, query params, pagination envelope, error-body schema, rate limits, auth header
- [ ] Update `01-*` + `02-api-spec-investigation.md` from the dumped spec, then re-deploy to re-sync

---

## 6. Testing Plan

### Manual sequence

1. **User connect:** open the Workbench connector → paste the `bearer_token` and `instance_url` → save.
2. **Spec discovery (do first):** ask the agent to fetch `{instance_url}/swagger` (and the raw
   `swagger.json`) → read the **real** base path + resource names before anything else.
3. **Smoke test (Phase 2 gate):** "list my Workbench jobs" → `GET {instance_url}/{prefix}/jobs?pageSize=1`
   → expect `200` with a list envelope. `401`/`403` → see `04-connection-and-reauth.md`.
4. **Read:** "show job J-10042 and its cost transactions" → job record + transactions with distribution lines.
5. **Cost analysis:** "what's been spent on job J-10042 by activity / GL account?" → read transactions, sum distribution lines.
6. **Write (gated, HITL only):** "log 7.5 hours on job J-10042 for formwork" → `POST .../timesheets`
   — confirm the field schema from the Swagger first; never auto-retry a financial POST.
7. **Disconnect:** user disconnect removes the stored credentials.

### Edge cases

- [ ] `instance_url` with a trailing slash / missing scheme → normalise before composing URLs (no double-slash)
- [ ] `401` → token invalid/expired or wrong auth header (`X-Api-Key`?) → user re-issues token
- [ ] `403` → issuing user's Workbench role lacks permission
- [ ] `404` (HTML) → wrong path prefix → re-read the Swagger base path
- [ ] `400`/`422` on write → business-rule rejection (closed job, invalid activity, unbalanced distribution) → fix payload, don't retry
- [ ] Pagination beyond one page (param names / envelope unconfirmed 🔬)
- [ ] Rate-limit / `429` handling (limits unknown 🔬)

---

_Generated from the investigation questionnaire. Pair with the `numa-connectors` skill. See also
`02-api-spec-investigation.md` (dev API reference) and `04-connection-and-reauth.md` (auth setup)._

---
api_name: Total Synergy (API Key)
connector_id: totalsynergy-api
auth_type: api-key
tier: standard
category: project-management
integration_path: direct-api (spec-driven, chat-only) — same shape as Actionstep/NetSuite/Zoho CRM. No lib/oauth-providers/ class (not a Files-Remote connector).
call_surface: HTTP via the connector request path (`numa integrations request`). NOT file-browse.
sibling: totalsynergy-oauth — same API behind OAuth2 instead of a static key. Both registry entries + both ext-api-doc folders are committed. Keep entity/endpoint/pagination sections consistent — only the auth differs.
prereq: read 00-api-investigation-questionnaire.md + 02-api-spec-investigation.md; activate the numa-connectors skill.
---

# Total Synergy (API Key) — Connector & Integration Setup

Build instructions. The workspace agent reads the `ext-api-doc/totalsynergy-api/` specs and calls the API via the connector request path; the connector layer injects the stored `api_key` into the `access-token` header. This is the **lower-friction** Total Synergy variant — one pasted key, no redirect, no token exchange, no refresh.

## Integration type: Direct API (spec-driven, chat-only)

| Component                              | Required? | Status                                                                                       |
| -------------------------------------- | --------- | -------------------------------------------------------------------------------------------- |
| Connector Registry entry               | Yes       | ✅ Done — `connectorRegistry.ts` (id `totalsynergy-api`)                                     |
| `ext-api-doc/totalsynergy-api/` specs  | Yes       | ✅ Done — this folder (`00`, `01`–`01d`, `02`–`04`)                                          |
| Admin setup wizard (API-key fields)    | Yes       | ✅ Generated from registry (`credentialFields`)                                              |
| User integration (Connect / paste key) | Yes       | ✅ Generated from registry (no bespoke code)                                                 |
| `lib/oauth-providers/` provider class  | No        | ❌ Not needed (chat-only, not file-browsing)                                                 |
| OAuth scope picker entry               | No        | ❌ Not needed — Total Synergy has **no scopes**                                              |
| External app registration              | No        | ❌ Not needed — no OAuth app; the user generates a key                                       |
| **Custom auth adapter**                | No\*      | ❌ No OAuth flow, BUT confirm the framework can send a **custom `access-token` header** (§3) |

\*Unlike `totalsynergy-oauth` (which needs a bespoke OAuth adapter), this connector needs no custom OAuth flow. The only framework requirements are the `access-token` header and the `api.totalsynergy.com` host + org `{Slug}` path (§3).

## 1. Connector Registry Entry (DONE)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (around line 589). Actual shape on disk:

```typescript
{
  id: 'totalsynergy-api',
  displayName: 'Total Synergy (API Key)',
  icon: 'bi-building',
  description: 'Architecture and engineering practice management (API key)',
  category: 'Project Management',
  authType: 'api-key',
  credentialFields: [
    { key: 'api_key', label: 'dataConnectors.fields.apiKey', type: 'password', placeholder: 'Paste your Total Synergy API key', required: true },
    { key: 'instance_url', label: 'dataConnectors.fields.instanceUrl', type: 'url', placeholder: 'https://yourcompany.totalsynergy.com', required: true },
  ],
}
```

- `authType: 'api-key'` — the static-key variant. The sibling `totalsynergy-oauth` uses `authType: 'oauth2'` with an `oauth` block + `oauthSetupSteps`.
- `credentialFields[0]` = **`api_key`** (`type: 'password'`) — the long-lived static key from the user's Synergy profile. Stored as a **user** secret in the vault; sent verbatim in the `access-token` header. The only credential the connector truly needs.
- `credentialFields[1]` = **`instance_url`** (`type: 'url'`, placeholder `https://yourcompany.totalsynergy.com`) — **misleading; see 🚩 below.**
- `label` values (`dataConnectors.fields.apiKey`, `dataConnectors.fields.instanceUrl`) are i18n keys resolved from `numa-frontend/src/locales/*/integrations.json` (or the relevant connector namespace). The `placeholder` strings are literal.
- `icon: 'bi-building'` and `category: 'Project Management'` match the OAuth sibling.
- **No** `oauth` block, no `oauthSetupSteps`, no `oauthScopeDefinitions.ts` entry — correct: Total Synergy has no scope system and this variant has no OAuth flow.

> 🚩 **`instance_url` does NOT match the real API base — reconcile before first call (§3).** The REST API is served from the **shared host** `https://api.totalsynergy.com/api/v2/`, not a per-tenant `*.totalsynergy.com` subdomain. Tenancy is the org **`{Slug}`** in the path (`…/Organisation/{Slug}/{Resource}`). A customer who pastes `https://acme.totalsynergy.com` expecting it to be the endpoint will see calls go to the wrong host.

## 2. Backend Provider Class — NOT REQUIRED

Chat-only and spec-driven. There is **no** `lib/oauth-providers/totalsynergy_api_provider.py` and no `handleListProviders`/`getProviderConfig` Files-Remote wiring. The workspace agent issues authenticated requests through the standard connector request path, guided by the `01*` rules, with the connector layer injecting the stored `api_key` into the `access-token` header. (No document/file surface exists; if the vendor ever exposes invoice PDFs/exports, revisit — see `02`'s file-handling note.)

## 3. 🚩 Two build-time concerns (no OAuth adapter, but two things to verify)

No OAuth fragility — no custom authorize params, no `Oauth2/*` token/refresh endpoints, no refresh-token rotation. But two non-standard requirements must be honoured or every call 401s/404s:

| Aspect            | Generic / registry assumption                           | Total Synergy reality (DOCUMENTED)                                                  |
| ----------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Credential header | `Authorization: Bearer <key>` (or `X-API-Key`)          | **`access-token: <apiKey>`** — a custom header. `Bearer`/`X-API-Key` → 401          |
| API base / host   | `instance_url` (`https://yourcompany.totalsynergy.com`) | **`https://api.totalsynergy.com/api/v2/`** (shared host) + org `{Slug}` in the path |

**Resolution:**

1. **Custom header.** Confirm the framework can send the credential in a custom **`access-token`** header (not `Authorization: Bearer`, not `X-API-Key`). If the generic api-key adapter defaults to either, configure/extend it to use `access-token`. #1 thing to verify.
2. **Host + slug, not `instance_url`.** Always call `api.totalsynergy.com` with the org `{Slug}` in the path. Either (a) reinterpret the `instance_url` field as the org slug, (b) derive the slug from a `GET …/Organisation` / `…/Organisation/MySlug` lookup using the key, or (c) treat `instance_url` as informational and hard-code the host. Reconcile before the connector makes a single call. 🔬 confirm how the slug is discovered.

Until both are handled, expect 401s (wrong header) or 404s (wrong host/missing slug) even with a valid key.

## 4. Workspace Agent Specs (DONE) — how they reach the agent

The `ext-api-doc/totalsynergy-api/` files are the agent knowledge pack: `01-llm-api-rules.md` (the file the agent loads when the connector is active), `01a`–`01d` (on-demand reference), `02` (dev reference), `03` (this file), `04` (reauth).

**Deployment mechanism:** `infra/stacks/numa-client-stack.ts` (around line 1135, "Sync ext-api-doc files to S3") walks the `ext-api-doc/` tree at deploy time and creates an `S3Object` for every file (excluding `_templates/`), keyed by its path relative to `ext-api-doc/` (e.g. `totalsynergy-api/01-llm-api-rules.md`), uploaded to the per-client ext-api-doc bucket (`core.extApiDocBucket`). At runtime the agent looks up `s3://…-ext-api-doc/{id}/` and loads that folder's `01-*.md` rules into context when the connector is active.

> ⚠️ **The folder name (`totalsynergy-api`) MUST equal the registry `id` (`totalsynergy-api`).** If it drifts, the agent silently falls through with "no dedicated API docs for this connector" even though the files exist (at the wrong prefix). The `tools/check-connector-docs.mjs` parity check enforces this invariant (exits 1 on drift) — run it in lint/CI.

## 5. Deployment Checklist

**Code (done in this branch):**

- [x] Registry entry present (`connectorRegistry.ts`, id `totalsynergy-api`)
- [x] `ext-api-doc/totalsynergy-api/` specs committed (`00`, `01`–`01d`, `02`–`04`)
- [ ] Parity check passes (`node tools/check-connector-docs.mjs`)
- [ ] Frontend lint + typecheck clean
- [ ] i18n keys present for `dataConnectors.fields.apiKey` + `dataConnectors.fields.instanceUrl` (shared keys; likely already defined for other api-key connectors)

**Auth wiring (verify — see §3):**

- [ ] Framework sends the credential in a custom **`access-token`** header (not `Authorization: Bearer`, not `X-API-Key`)
- [ ] Decide how the org `{Slug}` is supplied: repurpose `instance_url`, derive from `…/Organisation/MySlug`, or hard-code the host
- [ ] Calls target `api.totalsynergy.com`, not the per-tenant `*.totalsynergy.com` from `instance_url`

**External / deploy (developer):**

- [ ] In Synergy, have a user generate a static API key (Profile settings → ⋯ → API Key → copy the 1yr or 3yr key) — no OAuth app registration needed
- [ ] Deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` S3 sync)
- [ ] **Phase 2 smoke test** against a live tenant (see `04-connection-and-reauth.md`) — closes the gate the questionnaire flags as NOT satisfied
- [ ] Confirm the 🔬 items: org-slug resolution, full endpoint catalog (Swagger dump), write field schemas, error-body shape, exact 429/`Retry-After` behaviour, static-key format/length, revocation behaviour on regeneration

## 6. Testing Plan

**Manual sequence:**

1. **Setup:** open the Total Synergy (API Key) wizard, paste the static key into `api_key` (and `instance_url`, pending the §3 decision), save. Key stored as a user secret.
2. **Resolve slug (first real call):** ask the agent to identify the organisation → `GET …/Organisation` or `…/Organisation/MySlug` with the `access-token` header 🔬.
3. **Smoke test (Phase 2 gate):** "list my Total Synergy projects" → `GET /api/v2/Organisation/{Slug}/Projects?criteria.pagesize=1` → expect `{ "totalItems": …, "items": [ … ] }`.
4. **Read:** "show contacts" / "show staff" → `Contacts` / `Staff` lists (same envelope).
5. **Read timesheets:** "show this week's timesheet" → `Timesheet/Week`.
6. **Write (sparingly — Transactions budget):** "log 7.5 hours on project X" → `POST …/Transactions` (confirm field schema first; counts against the 50/day cap; not idempotent).
7. **User disconnect:** removes the user secret (the pasted key) only.

**Edge cases:**

- [ ] 401 with `Authorization: Bearer` (and with `X-API-Key`) → confirm both fail, then `access-token` works (the #1 gotcha)
- [ ] 401 on an **expired** key → confirm there is **no refresh**; recovery is user regenerates a key + re-pastes it
- [ ] Rate limit hit (daily) → confirm status/`Retry-After`; verify retries within the day don't reset 🔬
- [ ] Wrong `{Slug}` → 404
- [ ] Transaction POST retried → confirm duplicate risk (no idempotency key)
- [ ] Regenerate the key in Synergy → confirm the old key is immediately invalidated 🔬

## Sources

- Developer portal (endpoints, `access-token` header): https://developers.totalsynergy.com/
- API FAQ (static-key acquisition, limits, pagination, base URLs): https://help.totalsynergy.com/en/articles/8696457-api-faq
- Swagger reference (SPA): https://developers.totalsynergy.com/swagger/ui/index

Pair with the `numa-connectors` skill. Keep consistent with the sibling `totalsynergy-oauth` doc set — only the auth differs.

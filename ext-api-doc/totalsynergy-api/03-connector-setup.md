---
api_name: 'Total Synergy (API Key)'
connector_id: 'totalsynergy-api'
auth_type: 'api-key'
tier: 'standard'
category: 'project-management'
integration_path: 'direct-api (spec-driven, chat-only)'
---

# Total Synergy (API Key) — Connector & Integration Setup

> Build instructions for the Total Synergy (API Key) connector. **Integration path: Direct API,
> chat-only, spec-driven** — same shape as Actionstep / NetSuite / Zoho CRM. The workspace agent
> reads the `ext-api-doc/totalsynergy-api/` specs (this folder) and calls the API through the
> connector request path. **No `lib/oauth-providers/` provider class is required** (it is not a
> Files-Remote / file-browsing connector).
>
> 📌 **Sibling connector:** `totalsynergy-oauth` (slug `totalsynergy-oauth`) is the **same API**
> behind an OAuth2 flow instead of a static key. Both registry entries already exist and both
> `ext-api-doc/` folders are committed. Keep the entity/endpoint/pagination sections of the two doc
> sets consistent — **only the auth differs.** This connector is the **lower-friction** variant:
> one pasted key, no redirect, no token exchange, no refresh.
>
> Prerequisites: read `00-api-investigation-questionnaire.md` + `02-api-spec-investigation.md`, and
> activate the `numa-connectors` skill.

---

## Integration Type

**Selected path:** Direct API (spec-driven, chat-only)

| Component                              | Required? | Status                                                                                                  |
| -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| Connector Registry entry               | Yes       | ✅ Done — `connectorRegistry.ts` (id `totalsynergy-api`)                                                |
| `ext-api-doc/totalsynergy-api/` specs  | Yes       | ✅ Done — this folder (`00`, `01`–`01d`, `02`–`04`)                                                     |
| Admin setup wizard (API-key fields)    | Yes       | ✅ Generated from registry (`credentialFields`)                                                         |
| User integration (Connect / paste key) | Yes       | ✅ Generated from registry (no bespoke code)                                                            |
| `lib/oauth-providers/` provider class  | No        | ❌ Not needed (chat-only, not file-browsing)                                                            |
| OAuth scope picker entry               | No        | ❌ Not needed — Total Synergy has **no scopes**                                                         |
| External app registration              | No        | ❌ Not needed — there is no OAuth app; the user generates a key                                         |
| **Custom auth adapter**                | No\*      | ❌ Not needed for OAuth, BUT confirm the framework can send a **custom `access-token` header** (see §3) |

\* Unlike `totalsynergy-oauth` (which needs a bespoke OAuth adapter), this connector needs **no**
custom OAuth flow. The only framework requirements are the `access-token` header and the
`api.totalsynergy.com` host + org `{Slug}` path. See §3.

---

## 1. Connector Registry Entry (DONE)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

The entry is already committed (around line 589). This is the **actual** shape on disk:

```typescript
{
  id: 'totalsynergy-api',
  displayName: 'Total Synergy (API Key)',
  icon: 'bi-building',
  description: 'Architecture and engineering practice management (API key)',
  category: 'Project Management',
  authType: 'api-key',
  credentialFields: [
    {
      key: 'api_key',
      label: 'dataConnectors.fields.apiKey',
      type: 'password',
      placeholder: 'Paste your Total Synergy API key',
      required: true,
    },
    {
      key: 'instance_url',
      label: 'dataConnectors.fields.instanceUrl',
      type: 'url',
      placeholder: 'https://yourcompany.totalsynergy.com',
      required: true,
    },
  ],
}
```

Notes on the entry as committed:

- `authType: 'api-key'` — the static-key credential variant. The sibling `totalsynergy-oauth` entry
  uses `authType: 'oauth2'` with an `oauth` block + `oauthSetupSteps` instead.
- `credentialFields[0]` = **`api_key`** (`type: 'password'`) — the long-lived static key the user
  copies from their Synergy profile. Stored as a **user** secret in the vault and sent verbatim in
  the `access-token` header on every call. This is the only credential the connector truly needs.
- `credentialFields[1]` = **`instance_url`** (`type: 'url'`, placeholder
  `https://yourcompany.totalsynergy.com`) — **see the 🚩 below; this field is misleading.**
- `label` values (`dataConnectors.fields.apiKey`, `dataConnectors.fields.instanceUrl`) are i18n
  keys resolved from `numa-frontend/src/locales/*/integrations.json` (or the relevant connector
  namespace). The `placeholder` strings are literal.
- `icon: 'bi-building'` and `category: 'Project Management'` match the OAuth sibling.
- There is **no** `oauth` block, no `oauthSetupSteps`, and no `oauthScopeDefinitions.ts` entry —
  correct: Total Synergy has no scope system and this variant has no OAuth flow at all.

> 🚩 **`instance_url` does NOT match the real API base — reconcile before first call (§3).** The
> REST API is served from the **shared host** `https://api.totalsynergy.com/api/v2/`, not a
> per-tenant `*.totalsynergy.com` subdomain. Tenancy is the org **`{Slug}`** in the path
> (`…/Organisation/{Slug}/{Resource}`). A customer who pastes `https://acme.totalsynergy.com`
> expecting it to be the endpoint will see calls go to the wrong host.

---

## 2. Backend Provider Class — NOT REQUIRED

Total Synergy (API Key) is chat-only and spec-driven. There is **no**
`lib/oauth-providers/totalsynergy_api_provider.py` and no `handleListProviders` /
`getProviderConfig` Files-Remote wiring. The workspace agent issues authenticated requests through
the standard connector request path, guided by the `01*` rules in this folder, with the connector
layer injecting the stored `api_key` into the `access-token` header.

(There is no document/file surface on this API, so a Files-Remote provider would have nothing to
browse. If the vendor ever exposes invoice PDFs/exports, revisit — see `02`'s file-handling note.)

---

## 3. 🚩 Two build-time concerns (no OAuth adapter, but two things to verify)

This connector has **none** of the OAuth fragility of its sibling — no custom authorize params, no
`Oauth2/*` token/refresh endpoints, no refresh-token rotation. But two non-standard requirements
must be honoured or every call 401s/404s:

| Aspect            | Generic / registry assumption                           | Total Synergy reality (DOCUMENTED)                                                  |
| ----------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Credential header | `Authorization: Bearer <key>` (or `X-API-Key`)          | **`access-token: <apiKey>`** — a custom header. A `Bearer`/`X-API-Key` header → 401 |
| API base / host   | `instance_url` (`https://yourcompany.totalsynergy.com`) | **`https://api.totalsynergy.com/api/v2/`** (shared host) + org `{Slug}` in the path |

**Resolution:**

1. **Custom header.** Confirm the connector framework can send the credential in a **custom
   `access-token` header**, not `Authorization: Bearer` and not `X-API-Key`. If the generic
   api-key adapter defaults to either of those, it must be configured/extended to use `access-token`
   for this connector. This is the #1 thing to verify.
2. **Host + slug, not `instance_url`.** Always call `api.totalsynergy.com` and put the org `{Slug}`
   in the path. Either (a) reinterpret/repurpose the `instance_url` field as the org slug,
   (b) derive the slug from a `GET …/Organisation` / `…/Organisation/MySlug` lookup using the key,
   or (c) treat `instance_url` as informational and hard-code the host. Reconcile this before the
   connector makes a single call. 🔬 confirm how the slug is discovered.

Until both are handled, expect 401s (wrong header) or 404s (wrong host/missing slug) even with a
valid key.

---

## 4. Workspace Agent Specs (DONE) — how they reach the agent

The `ext-api-doc/totalsynergy-api/` files are the agent knowledge pack:

- `01-llm-api-rules.md` (main rules, < 300 lines) — **the file the agent loads when the connector is active**
- `01a-domain-model-reference.md`, `01b-query-patterns.md`, `01c-mutation-patterns.md`, `01d-event-and-error-handling.md`
- `02-api-spec-investigation.md` (this dev reference), `03-connector-setup.md` (this file), `04-connection-and-reauth.md`

**Deployment mechanism:** `infra/stacks/numa-client-stack.ts` (around line 1135, the "Sync
ext-api-doc files to S3" block) walks the `ext-api-doc/` tree at deploy time and creates an
`S3Object` for every file (excluding `_templates/`), keyed by its path relative to `ext-api-doc/`
(e.g. `totalsynergy-api/01-llm-api-rules.md`), uploaded to the per-client ext-api-doc bucket
(`core.extApiDocBucket`). At runtime the workspace agent looks up `s3://…-ext-api-doc/{id}/` and
loads that folder's `01-*.md` rules into context when the connector is active.

> ⚠️ **The folder name (`totalsynergy-api`) MUST equal the registry `id` (`totalsynergy-api`).** If
> it drifts, the agent silently falls through with "no dedicated API docs for this connector" even
> though the files exist (just at the wrong prefix). The `tools/check-connector-docs.mjs` parity
> check enforces this invariant (exits 1 on drift) — run it in lint/CI.

---

## 5. Deployment Checklist

### Code (done in this branch)

- [x] Registry entry present (`connectorRegistry.ts`, id `totalsynergy-api`)
- [x] `ext-api-doc/totalsynergy-api/` specs committed (`00`, `01`–`01d`, `02`–`04`)
- [ ] Parity check passes (`node tools/check-connector-docs.mjs`)
- [ ] Frontend lint + typecheck clean
- [ ] i18n keys present for `dataConnectors.fields.apiKey` and `dataConnectors.fields.instanceUrl` (shared keys; likely already defined for other api-key connectors)

### Auth wiring (verify — see §3)

- [ ] Confirm the framework sends the credential in a custom **`access-token`** header (not `Authorization: Bearer`, not `X-API-Key`)
- [ ] Decide how the org `{Slug}` is supplied: repurpose `instance_url`, derive from `…/Organisation/MySlug`, or hard-code the host
- [ ] Confirm calls target `api.totalsynergy.com`, not the per-tenant `*.totalsynergy.com` from `instance_url`

### External / deploy (developer)

- [ ] In Synergy, have a user generate a static API key (Profile settings → ⋯ → API Key → copy the 1yr or 3yr key) — **no OAuth app registration needed**
- [ ] Deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` S3 sync)
- [ ] **Phase 2 smoke test** against a live tenant (see `04-connection-and-reauth.md`) — this closes the gate the questionnaire flags as NOT satisfied
- [ ] Confirm the 🔬 items: org-slug resolution, full endpoint catalog (Swagger dump), write field schemas, error-body shape, exact 429/`Retry-After` behaviour, static-key format/length, and revocation behaviour on regeneration

---

## 6. Testing Plan

### Manual sequence

1. **Admin/user setup:** open the Total Synergy (API Key) wizard, paste the static key into the
   `api_key` field (and the `instance_url`, pending the §3 decision), save. The key is stored as a
   user secret.
2. **Resolve slug (first real call):** ask the agent to identify the organisation →
   `GET …/Organisation` or `…/Organisation/MySlug` with the `access-token` header 🔬.
3. **Smoke test (Phase 2 gate):** "list my Total Synergy projects" →
   `GET /api/v2/Organisation/{Slug}/Projects?criteria.pagesize=1` with the `access-token` header →
   expect `{ "totalItems": …, "items": [ … ] }`.
4. **Read:** "show contacts" / "show staff" → `Contacts` / `Staff` lists (same envelope).
5. **Read timesheets:** "show this week's timesheet" → `Timesheet/Week`.
6. **Write (sparingly — Transactions budget):** "log 7.5 hours on project X" →
   `POST …/Transactions` (confirm field schema first; counts against the 50/day cap; not idempotent).
7. **User disconnect:** removes the user secret (the pasted key) only.

### Edge cases

- [ ] 401 with `Authorization: Bearer` (and with `X-API-Key`) → confirm both fail, then confirm `access-token` works (the #1 gotcha)
- [ ] 401 on an **expired** key → confirm there is **no refresh**; the recovery is user regenerates a key in their profile and re-pastes it
- [ ] Rate limit hit (daily) → confirm status/`Retry-After`; verify retries within the day don't reset 🔬
- [ ] Wrong `{Slug}` → 404
- [ ] Transaction POST retried → confirm duplicate risk (no idempotency key)
- [ ] Regenerate the key in Synergy → confirm the old key is immediately invalidated 🔬

---

## Sources

- Developer portal (endpoints, `access-token` header): https://developers.totalsynergy.com/
- API FAQ (static-key acquisition, limits, pagination, base URLs): https://help.totalsynergy.com/en/articles/8696457-api-faq
- Swagger reference (SPA): https://developers.totalsynergy.com/swagger/ui/index

_Generated from the investigation questionnaire. Pair with the `numa-connectors` skill. Keep
consistent with the sibling `totalsynergy-oauth` doc set — only the auth differs._

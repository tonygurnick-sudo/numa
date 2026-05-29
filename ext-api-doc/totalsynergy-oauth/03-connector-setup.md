---
api_name: 'Total Synergy (OAuth)'
connector_id: 'totalsynergy-oauth'
auth_type: 'oauth2'
tier: 'standard'
category: 'project-management'
integration_path: 'direct-api (spec-driven, chat-only)'
---

# Total Synergy (OAuth) — Connector & Integration Setup

> Build instructions for the Total Synergy (OAuth) connector. **Integration path: Direct API,
> chat-only, spec-driven** — same shape as Actionstep / NetSuite / Zoho CRM. The workspace agent
> reads the `ext-api-doc/totalsynergy-oauth/` specs (this folder) and calls the API through the
> connector request path. **No `lib/oauth-providers/` provider class is required** (it is not a
> Files-Remote / file-browsing connector).
>
> 📌 **Sibling connector:** `totalsynergy-api` (slug `totalsynergy-api`) is the **same API** behind
> a static API key instead of OAuth. Both registry entries already exist and both `ext-api-doc/`
> folders are committed. Keep the entity/endpoint/pagination sections of the two doc sets
> consistent — only the auth differs.
>
> Prerequisites: read `00-api-investigation-questionnaire.md` + `02-api-spec-investigation.md`, and
> activate the `numa-connectors` skill.

---

## Integration Type

**Selected path:** Direct API (spec-driven, chat-only)

| Component                                     | Required?  | Status                                                                          |
| --------------------------------------------- | ---------- | ------------------------------------------------------------------------------- |
| Connector Registry entry                      | Yes        | ✅ Done — `connectorRegistry.ts` (id `totalsynergy-oauth`)                      |
| `ext-api-doc/totalsynergy-oauth/` specs       | Yes        | ✅ Done — this folder (`00`, `01`–`01d`, `02`–`04`)                             |
| Admin OAuth wizard                            | Yes        | ✅ Generated from registry (`oauth` block + `oauthSetupSteps`)                  |
| User integration (Connect)                    | Yes        | ✅ Generated from registry (no bespoke code)                                    |
| `lib/oauth-providers/` provider class         | No         | ❌ Not needed (chat-only, not file-browsing)                                    |
| OAuth scope picker entry                      | No         | ❌ Not needed — Total Synergy has **no scopes**                                 |
| OAuth app credentials                         | Yes        | ⛔ External — register at `app.totalsynergy.com/Applications`                   |
| **Total-Synergy OAuth adapter (custom flow)** | **Yes** 🚩 | ⛔ **Not done** — generic OAuth machinery does not match the real flow (see §3) |

---

## 1. Connector Registry Entry (DONE)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

The entry is already committed (around line 378). This is the **actual** shape on disk:

```typescript
{
  id: 'totalsynergy-oauth',
  displayName: 'Total Synergy (OAuth)',
  icon: 'bi-building',
  description: 'Architecture and engineering practice management (OAuth)',
  category: 'Project Management',
  authType: 'oauth2',
  oauth: {
    authUrl: 'https://app.totalsynergy.com/oauth2/authorize',
    tokenUrl: 'https://app.totalsynergy.com/oauth2/token',
    scopes: '',
  },
  oauthSetupSteps: [
    'Contact Total Synergy support to register an OAuth application',
    'Provide them with the redirect URI shown below',
    'They will supply you with a Client ID and Client Secret',
  ],
}
```

Notes on the entry as committed:

- `authType: 'oauth2'` — the OAuth credential variant. The sibling `totalsynergy-api` entry uses
  `authType: 'api-key'` with `credentialFields` (`api_key` + `instance_url`) instead.
- `oauth.scopes: ''` — correct in spirit: Total Synergy has **no OAuth scope system** (access is
  governed by the authenticating user's Synergy role). No `oauthScopeDefinitions.ts` entry needed.
- `icon: 'bi-building'` and `category: 'Project Management'` match the API-key sibling.
- `oauthSetupSteps` drive the admin wizard's instructions (request creds, supply redirect URI).

> 🚩 **The `oauth.authUrl` / `oauth.tokenUrl` in the committed entry are the standard-shaped
> placeholders and do NOT match Total Synergy's real flow.** See §3 — this must be reconciled (and
> a custom adapter added) before the connector can authenticate.

---

## 2. Backend Provider Class — NOT REQUIRED

Total Synergy (OAuth) is chat-only and spec-driven. There is **no**
`lib/oauth-providers/totalsynergy_oauth_provider.py` and no `handleListProviders` /
`getProviderConfig` Files-Remote wiring. The workspace agent issues authenticated requests through
the standard connector request path, guided by the `01*` rules in this folder.

(There is no document/file surface on this API, so a Files-Remote provider would have nothing to
browse. If the vendor ever exposes invoice PDFs/exports, revisit — see `02`'s file-handling note.)

---

## 3. 🚩 The OAuth flow is non-standard — adapter required (build blocker)

This is the **#1 thing to fix before the connector works.** The committed registry entry assumes
RFC-6749-standard OAuth; Total Synergy's real flow differs on host, path, parameter names, and the
credential header. Full setup detail is in `04-connection-and-reauth.md`; the deltas the generic
machinery gets wrong:

| Aspect            | Generic / registry assumption                         | Total Synergy reality (DOCUMENTED)                                                |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Authorize host    | `app.totalsynergy.com/oauth2/authorize` (lowercase)   | `app.totalsynergy.com/OAuth2/Authorize`                                           |
| Authorize params  | `client_id`, `redirect_uri`, `response_type`, `scope` | `ApplicationKey`, `RedirectUri`, `tenant` (+ optional `simple=true`)              |
| Token host/path   | `app.totalsynergy.com/oauth2/token`                   | **`api.totalsynergy.com/api/v2/Oauth2/GetAccessToken`** (different host AND path) |
| Token body        | `client_id`, `client_secret`, `code`, `grant_type`    | `applicationKey`, `ApplicationSecret`, `code`, `grant_type=authorization_code`    |
| Refresh path      | reuse token URL                                       | **`api.totalsynergy.com/api/v2/Oauth2/RefreshAccessToken`**                       |
| Credential header | `Authorization: Bearer <token>`                       | **`access-token: <token>`**                                                       |
| Scopes            | space-separated scope string                          | none                                                                              |

**Resolution options:**

- **(a)** Add a small Total-Synergy-specific OAuth adapter to the connector framework that: builds
  the custom authorize URL, POSTs to `…/api/v2/Oauth2/GetAccessToken` / `…/RefreshAccessToken`, and
  injects the `access-token` header on outbound calls.
- **(b)** For OAuth-averse tenants, steer customers to the **`totalsynergy-api` static-key
  connector** (same API, a long-lived 1yr/3yr key copied from a Synergy user profile, plain
  `access-token` header — no custom OAuth at all).

Until (a) ships, expect 401s at the proxy even after a "successful" consent.

---

## 4. Workspace Agent Specs (DONE) — how they reach the agent

The `ext-api-doc/totalsynergy-oauth/` files are the agent knowledge pack:

- `01-llm-api-rules.md` (main rules, < 300 lines) — the file the agent loads when the connector is active
- `01a-domain-model-reference.md`, `01b-query-patterns.md`, `01c-mutation-patterns.md`, `01d-event-and-error-handling.md`
- `02-api-spec-investigation.md` (this dev reference), `03-connector-setup.md` (this file), `04-connection-and-reauth.md`

**Deployment mechanism:** `infra/stacks/numa-client-stack.ts` syncs the `ext-api-doc/` tree to the
per-client S3 bucket (`{client}-ext-api-doc`) at deploy time. At runtime the workspace agent loads
the matching folder's `01-*.md` rules into context when the Total Synergy (OAuth) connector is
active. The folder name (`totalsynergy-oauth`) **must** equal the registry `id`, which satisfies
the `tools/check-connector-docs.mjs` parity check.

---

## 5. Deployment Checklist

### Code (done in this branch)

- [x] Registry entry present (`connectorRegistry.ts`, id `totalsynergy-oauth`)
- [x] `ext-api-doc/totalsynergy-oauth/` specs committed (`00`, `01`–`01d`, `02`–`04`)
- [ ] Parity check passes (`node tools/check-connector-docs.mjs`)
- [ ] Frontend lint + typecheck clean

### Custom auth (blocker — see §3)

- [ ] Add Total-Synergy OAuth adapter (custom authorize params, `api/v2/Oauth2/*` token/refresh, `access-token` header), **or** decide to route tenants to `totalsynergy-api`
- [ ] Reconcile `oauth.authUrl` / `oauth.tokenUrl` in the registry with the real endpoints

### External / deploy (developer)

- [ ] Register an OAuth application at `https://app.totalsynergy.com/Applications` → obtain `ApplicationKey` + `ApplicationSecret`; register the redirect URI shown in the wizard
- [ ] Deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` S3 sync)
- [ ] **Phase 2 smoke test** against a live tenant (see `04-connection-and-reauth.md`) — this closes the gate the questionnaire flags as NOT satisfied
- [ ] Confirm the 🔬 items: org-slug resolution, full endpoint catalog (Swagger dump), write field schemas, error-body shape, exact 429/`Retry-After` behaviour, refresh-token rotation, access-token TTL

---

## 6. Testing Plan

### Manual sequence

1. **Admin setup:** open the Total Synergy (OAuth) wizard, enter the `ApplicationKey` /
   `ApplicationSecret`, set the redirect URI to match the registered app, save.
2. **User connect:** click Connect → authorize on `app.totalsynergy.com/OAuth2/Authorize` → token
   exchange via `…/api/v2/Oauth2/GetAccessToken` (requires the custom adapter from §3).
3. **Resolve slug (first real call):** ask the agent to identify the organisation →
   `GET …/Organisation` or `…/Organisation/MySlug` 🔬.
4. **Smoke test (Phase 2 gate):** "list my Total Synergy projects" →
   `GET /api/v2/Organisation/{Slug}/Projects?criteria.pagesize=1` with the `access-token` header →
   expect `{ "totalItems": …, "items": [ … ] }`.
5. **Read:** "show contacts" / "show staff" → `Contacts` / `Staff` lists (same envelope).
6. **Read timesheets:** "show this week's timesheet" → `Timesheet/Week`.
7. **Write (sparingly — Transactions budget):** "log 7.5 hours on project X" →
   `POST …/Transactions` (confirm field schema first; counts against the 50/day cap; not idempotent).
8. **User disconnect:** removes the user secret only.

### Edge cases

- [ ] 401 with `Authorization: Bearer` → confirm it fails, then confirm `access-token` works (the #1 gotcha)
- [ ] 401 on access-token expiry → refresh via `RefreshAccessToken`; confirm whether the refresh token rotates
- [ ] Refresh token expired (≥1 month idle) → full re-consent
- [ ] Rate limit hit (daily) → confirm status/`Retry-After`; verify retries within the day don't reset 🔬
- [ ] Wrong `{Slug}` → 404
- [ ] Transaction POST retried → confirm duplicate risk (no idempotency key)

---

## Sources

- Developer portal (OAuth flow, endpoints): https://developers.totalsynergy.com/
- API FAQ (auth, limits, pagination, base URLs): https://help.totalsynergy.com/en/articles/8696457-api-faq
- Swagger reference (SPA): https://developers.totalsynergy.com/swagger/ui/index
- App registration: https://app.totalsynergy.com/Applications

_Generated from the investigation questionnaire. Pair with the `numa-connectors` skill. Keep
consistent with the sibling `totalsynergy-api` doc set._

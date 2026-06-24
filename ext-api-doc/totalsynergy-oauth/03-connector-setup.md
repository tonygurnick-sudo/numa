---
api_name: Total Synergy (OAuth)
connector_id: totalsynergy-oauth
auth_type: oauth2
tier: standard
category: project-management
integration_path: direct-api (spec-driven, chat-only) — same shape as Actionstep / NetSuite / Zoho CRM. Workspace agent reads ext-api-doc/totalsynergy-oauth/ specs + calls via the connector request path. NO lib/oauth-providers/ class (not a Files-Remote / file-browsing connector).
sibling: totalsynergy-api (same API behind a static API key instead of OAuth). Both registry entries + ext-api-doc/ folders committed. Keep entity/endpoint/pagination sections consistent — only auth differs.
prereq: read 00-api-investigation-questionnaire.md + 02-api-spec-investigation.md; activate the numa-connectors skill.
---

# Total Synergy (OAuth) — Connector & Integration Setup

## Component status

| Component                                     | Required?  | Status                                                                                                                                                                                                       |
| --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Connector Registry entry                      | Yes        | ✅ Done — `connectorRegistry.ts` (id `totalsynergy-oauth`)                                                                                                                                                   |
| `ext-api-doc/totalsynergy-oauth/` specs       | Yes        | ✅ Done — this folder (`00`, `01`–`01d`, `02`–`04`)                                                                                                                                                          |
| Admin OAuth wizard                            | Yes        | ✅ Generated from registry (`oauth` block + `oauthSetupSteps`)                                                                                                                                               |
| User integration (Connect)                    | Yes        | ✅ Generated from registry (no bespoke code)                                                                                                                                                                 |
| `lib/oauth-providers/` provider class         | No         | ❌ Not needed (chat-only, not file-browsing)                                                                                                                                                                 |
| OAuth scope picker entry                      | No         | ❌ Not needed — no scopes                                                                                                                                                                                    |
| OAuth app credentials                         | Yes        | ⛔ External — register at `app.totalsynergy.com/Applications`                                                                                                                                                |
| **Total-Synergy OAuth adapter (custom flow)** | **Yes** 🚩 | ✅ **Done** — `TOTALSYNERGY_OAUTH` adapter in `oauth-auth-handler` + custom outbound `access-token` header in `connect_tools.py` / `oauth_tools.py` (§3). Live token test BLOCKED on vendor app credentials. |

## 1. Connector Registry Entry (DONE)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (around line 378). Actual shape on disk:

```typescript
{ id: 'totalsynergy-oauth', displayName: 'Total Synergy (OAuth)', icon: 'bi-building',
  description: 'Architecture and engineering practice management (OAuth)', category: 'Project Management',
  authType: 'oauth2',
  oauth: { authUrl: 'https://app.totalsynergy.com/OAuth2/Authorize', tokenUrl: 'https://api.totalsynergy.com/api/v2/Oauth2/GetAccessToken', scopes: '' },
  baseUrl: 'https://api.totalsynergy.com/api/v2',
  oauthAdapter: 'totalsynergy',          // dispatch key for the custom flow in oauth-auth-handler
  authHeaderScheme: 'access-token',       // sentinel: outbound token rides in the `access-token` header, NOT Authorization
  oauthSetupSteps: [ 'Register an application at app.totalsynergy.com/Applications (or contact support)', 'Set the redirect/callback URI to the value shown below', 'They will supply you with an ApplicationKey (Client ID) and ApplicationSecret (Client Secret)' ] }
```

- `authType: 'oauth2'` — OAuth credential variant. Sibling `totalsynergy-api` uses `authType: 'api-key'` with `credentialFields` (`api_key` + `instance_url`).
- `oauth.authUrl` / `oauth.tokenUrl` now hold the REAL endpoints (verified against the dev portal). The custom param/body shapes are applied by the `totalsynergy` adapter, not by these URLs alone.
- `oauthAdapter: 'totalsynergy'` selects the bespoke authorize/exchange/refresh path in `oauth-auth-handler` (custom params `ApplicationKey`/`RedirectUri`/`tenant`, body `applicationKey`/`ApplicationSecret`, no `response_type`/`scope`/PKCE).
- `authHeaderScheme: 'access-token'` is read by the backend request path as a SENTINEL meaning "send the bare token in a header literally named `access-token`" — distinct from the Zoho-style use where it is an `Authorization` scheme prefix. See §3 for the backend branch.
- `oauth.scopes: ''` — correct: no OAuth scope system (access governed by the user's Synergy role). No `oauthScopeDefinitions.ts` entry.
- `icon`/`category` match the API-key sibling. `oauthSetupSteps` drive the admin wizard's instructions.

## 2. Backend Provider Class — NOT REQUIRED

Chat-only + spec-driven. No `lib/oauth-providers/totalsynergy_oauth_provider.py`, no `handleListProviders`/`getProviderConfig` Files-Remote wiring. The workspace agent issues authenticated requests through the standard connector request path, guided by the `01*` rules here. No document/file surface exists; revisit only if the vendor exposes invoice PDFs/exports.

## 3. The OAuth flow is non-standard — adapter SHIPPED

**This was the build blocker.** RFC-6749-standard OAuth does not match Total Synergy's real flow (host, path, param names, credential header). The fix is a `totalsynergy` OAuth adapter wired into three shared files (patch specs returned with this task — author/integrator applies them):

1. **`lambdas/node/oauth-auth-handler/index.ts`** — adapter dispatch keyed on the provider id `totalsynergy-oauth`:
   - `handleAuthorize`: builds `https://app.totalsynergy.com/OAuth2/Authorize?ApplicationKey=<clientId>&RedirectUri=<redirect>&tenant=<tenant>` (no `response_type`/`scope`/`code_challenge`). PKCE session is still stored for CSRF `state`, but no `code_verifier` is sent.
   - `exchangeCodeForTokens`: `POST https://api.totalsynergy.com/api/v2/Oauth2/GetAccessToken` with form body `applicationKey=<id>&ApplicationSecret=<secret>&code=<code>&grant_type=authorization_code`. Normalises the response (`accessToken`/`access_token`, `refreshToken`/`refresh_token`, `expiresIn`/`expires_in`).
   - `refreshTokens`: `POST .../Oauth2/RefreshAccessToken` with `applicationKey&ApplicationSecret&refreshToken&grant_type=authorization_code`.
2. **`lambdas/python/oauth-workspace-tools/tools/connect_tools.py`** (`do_request`) — when the connector's persisted `auth_header_scheme` equals `access-token`, emit the OAuth token in a header literally named `access-token` instead of `Authorization: Bearer`.
3. **`lambdas/python/oauth-workspace-tools/tools/oauth_tools.py`** (`_refresh_access_token`) — lazy in-request refresh uses the Total Synergy refresh body/endpoint and normalises the custom response field names, so a token expiring mid-chat is refreshed transparently.

Full detail in `04-connection-and-reauth.md`. Deltas the generic machinery got wrong (all now handled by the adapter):

| Aspect            | Generic / registry assumption                         | Total Synergy reality (DOCUMENTED)                                                |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Authorize host    | `app.totalsynergy.com/oauth2/authorize` (lowercase)   | `app.totalsynergy.com/OAuth2/Authorize`                                           |
| Authorize params  | `client_id`, `redirect_uri`, `response_type`, `scope` | `ApplicationKey`, `RedirectUri`, `tenant` (+ optional `simple=true`)              |
| Token host/path   | `app.totalsynergy.com/oauth2/token`                   | **`api.totalsynergy.com/api/v2/Oauth2/GetAccessToken`** (different host AND path) |
| Token body        | `client_id`, `client_secret`, `code`, `grant_type`    | `applicationKey`, `ApplicationSecret`, `code`, `grant_type=authorization_code`    |
| Refresh path      | reuse token URL                                       | **`api.totalsynergy.com/api/v2/Oauth2/RefreshAccessToken`**                       |
| Credential header | `Authorization: Bearer <token>`                       | **`access-token: <token>`**                                                       |
| Scopes            | space-separated scope string                          | none                                                                              |

**Resolution (shipped):**

- **(a)** The `totalsynergy` OAuth adapter (3 files above) builds the custom authorize URL, POSTs to `…/api/v2/Oauth2/GetAccessToken` / `…/RefreshAccessToken`, normalises the custom token-response casing, and injects the `access-token` outbound header.
- **(b)** For OAuth-averse tenants, steer to the **`totalsynergy-api` static-key connector** (same API, long-lived 1yr/3yr key copied from a Synergy user profile, plain `access-token` header — no custom OAuth).

> Vendor facts verified 2026-06-24 against `developers.totalsynergy.com`: authorize `app.totalsynergy.com/OAuth2/Authorize` (`ApplicationKey`/`RedirectUri`/`tenant`, `&simple=true` optional); exchange `POST api.totalsynergy.com/api/v2/Oauth2/GetAccessToken` (`applicationKey`/`ApplicationSecret`/`code`/`grant_type=authorization_code`); refresh `POST …/Oauth2/RefreshAccessToken` (`applicationKey`/`ApplicationSecret`/`refreshToken`/`grant_type=authorization_code`); outbound header literally `access-token`; refresh token life ~1 month. Token-response field casing is NOT published — the adapter accepts both camelCase and snake_case.

## 4. Workspace Agent Specs (DONE) — how they reach the agent

The `ext-api-doc/totalsynergy-oauth/` files are the agent knowledge pack: `01-llm-api-rules.md` (main rules — loaded when the connector is active), `01a`–`01d` (domain/query/mutation/event-error), `02` (dev reference), `03` (this), `04` (reauth).

**Deployment:** `infra/stacks/numa-client-stack.ts` syncs the `ext-api-doc/` tree to the per-client S3 bucket (`{client}-ext-api-doc`) at deploy time. At runtime the workspace agent loads the matching folder's `01-*.md` rules into context when the connector is active. Folder name (`totalsynergy-oauth`) **must** equal the registry `id` — satisfies the `tools/check-connector-docs.mjs` parity check.

## 5. Deployment Checklist

**Code (done in branch):**

- [x] Registry entry present (`connectorRegistry.ts`, id `totalsynergy-oauth`)
- [x] `ext-api-doc/totalsynergy-oauth/` specs committed (`00`, `01`–`01d`, `02`–`04`)
- [ ] Parity check passes (`node tools/check-connector-docs.mjs`)
- [ ] Frontend lint + typecheck clean

**Custom auth (§3) — SHIPPED (patch specs in this task):**

- [x] Total-Synergy OAuth adapter (custom authorize params, `api/v2/Oauth2/*` token/refresh, `access-token` outbound header) across `oauth-auth-handler` + `connect_tools.py` + `oauth_tools.py`
- [x] Reconcile `oauth.authUrl` / `oauth.tokenUrl` in the registry with the real endpoints (+ `baseUrl`, `oauthAdapter`, `authHeaderScheme: 'access-token'`)
- [ ] **BLOCKED_LIVE_CRED** — live token exchange untested: needs a registered vendor app (`ApplicationKey` + `ApplicationSecret` from `app.totalsynergy.com/Applications`) and a Synergy tenant login to run the Phase 2 smoke test

**External / deploy (developer):**

- [ ] Register an OAuth app at `https://app.totalsynergy.com/Applications` → obtain `ApplicationKey` + `ApplicationSecret`; register the redirect URI shown in the wizard
- [ ] Deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` S3 sync)
- [ ] **Phase 2 smoke test** against a live tenant (`04-connection-and-reauth.md`) — closes the gate the questionnaire flags as NOT satisfied
- [ ] Confirm the 🔬 items: org-slug resolution, full endpoint catalog (Swagger dump), write field schemas, error-body shape, exact 429/`Retry-After` behaviour, refresh-token rotation, access-token TTL

## 6. Testing Plan

**Manual sequence:**

1. **Admin setup:** open the wizard, enter `ApplicationKey`/`ApplicationSecret`, set the redirect URI to match the registered app, save.
2. **User connect:** Connect → authorize on `app.totalsynergy.com/OAuth2/Authorize` → token exchange via `…/api/v2/Oauth2/GetAccessToken` (needs the §3 adapter).
3. **Resolve slug (first real call):** ask the agent to identify the organisation → `GET Organisation` or `Organisation/MySlug` 🔬.
4. **Smoke test (Phase 2 gate):** "list my Total Synergy projects" → `GET Organisation/{Slug}/Projects?criteria.pagesize=1` with the `access-token` header → expect `{ "totalItems": …, "items": [ … ] }`.
5. **Read:** "show contacts" / "show staff" → `Contacts` / `Staff` (same envelope).
6. **Read timesheets:** "show this week's timesheet" → `Timesheet/Week`.
7. **Write (sparingly — Transactions budget):** "log 7.5 hours on project X" → `POST …/Transactions` (confirm field schema first; 50/day cap; not idempotent).
8. **User disconnect:** removes the user secret only.

**Edge cases:**

- [ ] 401 with `Authorization: Bearer` → confirm it fails, then confirm `access-token` works (#1 gotcha)
- [ ] 401 on access-token expiry → refresh via `RefreshAccessToken`; confirm whether the refresh token rotates
- [ ] Refresh token expired (≥1 month idle) → full re-consent
- [ ] Rate limit hit (daily) → confirm status/`Retry-After`; verify retries within the day don't reset 🔬
- [ ] Wrong `{Slug}` → 404
- [ ] Transaction POST retried → confirm duplicate risk (no idempotency key)

## Sources

Developer portal (OAuth flow, endpoints) https://developers.totalsynergy.com/ · API FAQ (auth, limits, pagination, base URLs) https://help.totalsynergy.com/en/articles/8696457-api-faq · Swagger (SPA) https://developers.totalsynergy.com/swagger/ui/index · App registration https://app.totalsynergy.com/Applications. Pair with the `numa-connectors` skill; keep consistent with the sibling `totalsynergy-api` doc set.

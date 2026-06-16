---
doc: connection-and-reauth (Numa connector wiring + reauth)
vendor: MYOB Acumatica (Acumatica-based ERP, AU/NZ mid-market)
auth: OAuth 2.0 ONLY — Authorization Code (+ optional PKCE), Bearer tokens, refresh-token rotation, per-instance IdentityServer. NO PAT/API-key path.
model: PER-INSTANCE — authorize/token/OIDC/base URLs AND client_id/client_secret all scoped to one instance https://{instance}.myobadvanced.com. No central MYOB/Acumatica OAuth gateway. Cannot bootstrap without the instance hostname.
registry: connectorRegistry.ts id:'myob-acumatica' ships EMPTY authUrl/tokenUrl (instance-scoped; admin fills via wizard). See §1 discrepancy.
confidence: all auth facts VERIFIED 2026-03-30 (sourced from 00/02/03 siblings) unless tagged [INFERRED]/[UNKNOWN]/[VERIFIED <date>]
---

# MYOB Acumatica — Connection & Reauthorization

OAuth-only. Acumatica's IdentityServer also exposes client_credentials/implicit/resource-owner flows on some instances, but this connector uses **Authorization Code** — the only flow yielding a refresh token for unattended reconnection.

## 1. Register the OAuth Application (Connected Application)

Registered **inside each customer's instance** (not a MYOB-wide portal):

1. Log in at `https://{instance}.myobadvanced.com`.
2. **Connected Applications** — screen `SM303010`.
3. Click **+**.
4. Fill in:

| Field                     | Value                                    | Notes                                                                 |
| ------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| Flow Type                 | `Authorization Code`                     | not Implicit / Resource Owner / Client Credentials                    |
| Name                      | `Numa Integration` (or per-client)       | shown on consent screen                                               |
| Redirect URI              | exact URI from the Numa connector wizard | byte-for-byte (incl. trailing slash); HTTPS in prod; multiple allowed |
| Allow PKCE without secret | check only for a **public** client       | leave unchecked for the standard confidential-client flow Numa uses   |

5. Save → **Client ID** (see `@CompanyId` gotcha) + **Client Secret** (confidential only; shown once — copy immediately).

> ⚠️ **`client_id` format gotcha** [VERIFIED 2026-05-19 — fast-programmer/myob_acumatica + Keboola oauth_helper.sh line 15]: Client ID is NOT a bare GUID — it carries a `@CompanyId` suffix, e.g. `392B04F6-6CA4-43FA-48D9-45A6E6DF5579@Company`. Without it the OAuth server cannot resolve the tenant and **every `/identity/connect/token` request fails**. Send the full `{GUID}@{CompanyId}` string in both the authorize redirect and the token POST.

> ⚠️ **Paid API License prerequisite:** beyond the Connected Application, the instance must have the **Acumatica API License** add-on active. Without it, every _authenticated_ call returns `403` even though the OAuth handshake succeeds. Check this first when a fresh integration 403s on every call.

> ⚠️ **Registry-scope discrepancy (resolve at wiring time):** `connectorRegistry.ts` sets `scopes: 'api'` (omitting `offline_access`). The verified requirement is **`api offline_access`** — without `offline_access` Acumatica returns no `refresh_token` and the connector dies after one ~1-hour access-token lifetime. Correct the registry to `api offline_access` when wiring (do not change it in this doc — flagged for the wiring task).

## 2. OAuth flow

| Property          | Value                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Grant type        | `authorization_code` (+ `refresh_token` for renewal)                                         |
| Authorization URL | `https://{instance}.myobadvanced.com/identity/connect/authorize`                             |
| Token URL         | `https://{instance}.myobadvanced.com/identity/connect/token`                                 |
| OIDC discovery    | `https://{instance}.myobadvanced.com/identity/.well-known/openid-configuration` [DOCUMENTED] |
| Redirect URI      | the registered Numa redirect URI (exact match)                                               |
| Scopes            | `api offline_access` (`api`=REST access; `offline_access`=refresh token — **mandatory**)     |
| Header scheme     | `Authorization: Bearer {access_token}`                                                       |
| PKCE required?    | **No** (not enforced). Required for _public_ clients; optional-recommended for confidential. |

> **`{instance}` is mandatory connector input.** Both endpoints embed the customer hostname, so the wizard must capture it (e.g. `mgccivil`) before any OAuth step. The registry ships empty `authUrl`/`tokenUrl` so the admin supplies per-instance values.

### Authorization request

`GET https://{instance}.myobadvanced.com/identity/connect/authorize?response_type=code&client_id={GUID}@{CompanyId}&redirect_uri={REDIRECT_URI}&scope=api%20offline_access&state={RANDOM_STATE}&code_challenge={SHA256(code_verifier)}&code_challenge_method=S256`
(`code_challenge`/`code_challenge_method` public/PKCE clients only.)
| Param | Required | Notes |
| --- | --- | --- |
| `response_type` | yes | always `code` |
| `client_id` | yes | full `{GUID}@{CompanyId}` (§1) |
| `redirect_uri` | yes | byte-for-byte match to a Connected Application URI |
| `scope` | yes | space-separated, URL-encoded; **must include `offline_access`** |
| `state` | strongly recommended | CSRF — validate on callback |
| `code_challenge`(+method) | PKCE clients only | public clients, or confidential with "Allow PKCE without secret" |

User signs in + consents → redirect to `{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}`. The code is **single-use, ~60s** — exchange immediately.

### Token exchange

`POST https://{instance}.myobadvanced.com/identity/connect/token` · `Content-Type: application/x-www-form-urlencoded`
Body: `grant_type=authorization_code&code={AUTH_CODE}&redirect_uri={REDIRECT_URI}&client_id={GUID}@{CompanyId}&client_secret={CLIENT_SECRET}&code_verifier={ORIGINAL_VERIFIER}`
(`client_secret` confidential clients only; `code_verifier` only if PKCE used.) Credentials are **form-body fields**, NOT HTTP Basic.
Response: `{"access_token":"eyJ0eXAiOiJKV1Qi...","token_type":"Bearer","expires_in":3600,"refresh_token":"abc123def456...","scope":"api offline_access"}`

- `access_token` — Bearer, ~1-hour lifetime (`expires_in:3600`, instance-configurable).
- `refresh_token` — opaque; **persist it**; rotates on every refresh (§3).

## 3. Token refresh

`POST .../identity/connect/token` · form-urlencoded: `grant_type=refresh_token&refresh_token={REFRESH_TOKEN}&client_id={GUID}@{CompanyId}&client_secret={CLIENT_SECRET}`
Response shape = §2 token response — **including a brand-new `refresh_token`**.
| Property | Value |
| --- | --- |
| Access token lifetime | ~1 hour (`expires_in:3600`); instance-configurable |
| Refresh token lifetime | 30 days default (absolute). Configurable from Acumatica 2023 R2 via `SM303010` (Absolute / Infinite / Sliding) |
| Refresh token rotation | **Yes — rotates on every use.** Each refresh returns a NEW `refresh_token`; the old one is immediately invalidated |
| Re-consent required | when refresh token expires/revoked (full re-authorize), or on scope change. Pre-2023 R2 instances: fixed 30-day absolute lifetime, no config |

> ⚠️ **Headline operational risk — rotation.** The refresh token is one-time-use: the storage layer **must persist the new `refresh_token` atomically on every refresh, before the next call**. A lost refresh response (crash before persist) kills the stored token → full re-consent. Never fire two concurrent refreshes with the same token — one wins and kills the other. Acumatica documents no grace window for the previous token [UNKNOWN — not in vendor docs]; treat it as immediately dead.

## 4. Token revocation

`POST https://{instance}.myobadvanced.com/identity/connect/revocation` · form-urlencoded: `token={ACCESS_OR_REFRESH_TOKEN}&token_type_hint=refresh_token&client_id={GUID}@{CompanyId}&client_secret={CLIENT_SECRET}`

> **[UNKNOWN] — programmatic revocation endpoint NOT confirmed for Acumatica.** No sibling doc (00/02/03) documents one. Acumatica runs on IdentityServer (per the `/identity/connect/*` paths + OIDC discovery), which conventionally exposes `/connect/revocation` (RFC 7009) — so the path above is the _inferred_ IdentityServer default, not a verified Acumatica URL. Do NOT hardcode it. **Resolve at runtime** from OIDC discovery (`.../identity/.well-known/openid-configuration` → `revocation_endpoint`); fall back to the UI path if absent. [INFERRED — IdentityServer/RFC 7009 convention]
> **UI revocation (always available):** the **Connected Applications** screen (`SM303010`) lets an admin revoke a registered application's access; revoking the grant invalidates its refresh tokens. This is the reliable path when no `revocation_endpoint` is advertised. On a Numa-side disconnect, delete stored tokens; the admin can additionally revoke the grant in `SM303010`.

## 5. Reauthorization triggers

| Trigger                              | Detection                                              | Action                                                                                            |
| ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Access token expired                 | `401` on a data call                                   | refresh, retry the call once                                                                      |
| Refresh token expired / rotated-away | refresh returns `400 invalid_grant` / `401`            | full re-consent (authorize)                                                                       |
| Refresh token > 30 days old          | refresh returns `invalid_grant`                        | full re-consent                                                                                   |
| Scopes changed                       | `403` on a newly-needed resource (not a token problem) | re-consent with updated `scope`                                                                   |
| User/admin revoked in `SM303010`     | refresh fails (`invalid_grant`) or data calls `401`    | full re-consent                                                                                   |
| API License missing/lapsed           | `403` on **every** call (handshake fine)               | NOT a token issue — customer (re)purchases the API License add-on; do NOT loop refresh/re-consent |

> ⚠️ **Distinguish `401` from `403`.** `401` = access token expired/invalid → refresh, then re-consent if refresh fails. `403` is almost never a token problem on Acumatica — it means the **API License is inactive** or the **user's role lacks permission** for that entity. Do NOT trigger a refresh/re-consent loop on `403`.

## Numa connector wiring

### Credentials to store

| Key             | Type   | Scope   | Description                                                                                |
| --------------- | ------ | ------- | ------------------------------------------------------------------------------------------ |
| `instance_host` | string | Company | instance hostname, e.g. `mgccivil` (or full `mgccivil.myobadvanced.com`); builds every URL |
| `client_id`     | string | Company | Connected Application Client ID — full `{GUID}@{CompanyId}` (§1)                           |
| `client_secret` | secret | Company | Connected Application Client Secret (shown once in `SM303010`; vault it)                   |
| `access_token`  | secret | User    | ~1-hour Bearer; refreshed automatically                                                    |
| `refresh_token` | secret | User    | rotating, one-time-use; re-persist on every refresh                                        |
| `api_version`   | string | Company | contract version pinned in the URL, e.g. `24.200.001` (no "latest" alias)                  |
| `company`       | string | Company | login company name (the `CompanyId` half of client_id; also the OData/GI feed path)        |

Company creds (`instance_host`, `client_id`, `client_secret`, `api_version`, `company`) — admin supplies once per instance. `access_token`/`refresh_token` — per-user, captured during the user connect flow.

### Test connection sequence

```
1. GET https://{instance}.myobadvanced.com/identity/.well-known/openid-configuration   (no auth)
   → 200 JSON OIDC discovery (authorization_endpoint, token_endpoint, revocation_endpoint if present)
     — verifies the instance host is correct & reachable
2. GET https://{instance}.myobadvanced.com/entity/Default/{api_version}/Customer?$top=1&$select=CustomerID
     Authorization: Bearer {access_token} · Accept: application/json
   → 200 one-element Customer array (each field {"value":...}) — verifies token AND that API License is active
   → 403 — API License inactive OR user lacks permission (NOT a token problem)
   → 401 — access token expired → refresh, retry step 2 once
```

Use `Customer?$top=1&$select=CustomerID` as the smoke test — cheapest read, present on every instance. `200` proves token validity AND that the paid API License gate is open.

### Auto-reconnect logic

```
on 401 (data call):
  refresh_token()                 # POST {instance}/identity/connect/token, grant_type=refresh_token
  persist the NEW refresh_token   # rotates on every use — save before the next call
  retry the original request once
  if refresh returns invalid_grant / 401:
    trigger full re-consent (authorize)   # refresh token stale / >30d / revoked in SM303010
on 403 (data call):
  do NOT refresh — license or permission problem
  if every call 403s:   surface "MYOB Acumatica API License is not active for this instance"
  else (single entity): surface "the connected user lacks permission for {Entity}"
on 429:
  no Retry-After documented — back off exponentially (1s, 2s, 4s, …) and retry
  (Acumatica throttles by CONCURRENCY not RPM: ~6 concurrent L-series; cap parallelism at 3–4)
```

## Quick-reference URLs

| Resource                                            | URL                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Customer instance (per-tenant)                      | `https://{instance}.myobadvanced.com`                                                   |
| Authorize                                           | `https://{instance}.myobadvanced.com/identity/connect/authorize`                        |
| Token                                               | `https://{instance}.myobadvanced.com/identity/connect/token`                            |
| OIDC discovery                                      | `https://{instance}.myobadvanced.com/identity/.well-known/openid-configuration`         |
| Revocation                                          | **[UNKNOWN]** — resolve via `revocation_endpoint` in OIDC discovery; else `SM303010` UI |
| Connected Applications (register/revoke)            | `SM303010` (inside the instance)                                                        |
| License Monitoring Console                          | `SM604000` (inside the instance)                                                        |
| Developer portal                                    | https://enterprise-support.myob.com/acudev/                                             |
| API docs hub                                        | https://enterprise-support.myob.com/acudev/api-documentation                            |
| Contract-based REST guide                           | https://enterprise-support.myob.com/adv/contract-based-rest-api                         |
| Acumatica help (vanilla — OAuth/Connected Apps)     | https://help.acumatica.com                                                              |
| Ruby SDK (community, authoritative for OAuth shape) | https://github.com/fast-programmer/myob_acumatica                                       |
| Official C# REST client                             | https://github.com/Acumatica/AcumaticaRESTAPIClientForCSharp                            |

Siblings: `02` = full API reference; `03` = MYOB-side credential setup; `01` (+ `01a`–`01d`) = workspace-agent knowledge pack. The revocation **endpoint path** is the only [UNKNOWN] — Acumatica documents UI revocation via `SM303010` but no confirmed programmatic endpoint; resolve `revocation_endpoint` from OIDC discovery at runtime.

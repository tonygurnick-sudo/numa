# MYOB Acumatica — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to MYOB Acumatica (Acumatica-based ERP for the AU / NZ mid-market).
> Auth type: **OAuth 2.0** (Authorization Code flow with `offline_access`, refresh-token rotation).
> Goal: enough detail that Numa could automate connector setup via script.
>
> ⚠️ **Everything here is per-instance.** Every customer runs their own Acumatica server at
> `https://{instance}.myobadvanced.com`. The authorize URL, token URL, OIDC discovery doc, base
> URL, **and** the Connected Application `client_id`/`client_secret` are all scoped to that one
> instance. There is **no** central MYOB / Acumatica OAuth gateway. The connector cannot be
> bootstrapped without the customer's instance hostname.
>
> The registry entry (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`,
> `id: 'myob-acumatica'`) ships **empty** `authUrl`/`tokenUrl` for exactly this reason — they are
> instance-scoped and the admin fills them in via the wizard. See the discrepancy note in §1.

---

## Auth Type: OAuth 2.0

MYOB Acumatica is **OAuth-only** — there is no PAT / API-key path. Authentication is OAuth 2.0
Authorization Code (with optional PKCE), Bearer tokens, per-instance IdentityServer.
[VERIFIED 2026-03-30 — `02-api-spec-investigation.md` §Authentication; `00-api-investigation-questionnaire.md` Q1]

(Acumatica's IdentityServer also exposes a `client_credentials`/implicit/resource-owner flow on
some instances, but this connector uses the standard web-app Authorization Code flow — the only
flow that yields a refresh token for unattended reconnection.)

---

## Option A: OAuth 2.0

### 1. Create the OAuth Application in MYOB Acumatica

A **Connected Application** must be registered **inside each customer's Acumatica instance** — it
is not created on a MYOB-wide developer portal.
[VERIFIED 2026-03-30 — `03-connector-setup.md` §3; `00` Q2]

1. Log in to the customer's MYOB Acumatica instance at `https://{instance}.myobadvanced.com`.
2. Navigate to **Connected Applications** — screen ID **`SM303010`**.
3. Click **+** to create a new application.
4. Fill in:

   | Field                     | Value                                                         | Notes                                                                                                |
   | ------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
   | OAuth 2.0 / Flow Type     | `Authorization Code`                                          | Select the Authorization Code flow (not Implicit / Resource Owner / Client Credentials).             |
   | Name                      | `Numa Integration` (or per-client name)                       | Shown to the user on the consent screen.                                                             |
   | Redirect URI              | the **exact** redirect URI shown in the Numa connector wizard | **Must match byte-for-byte** (incl. trailing slash). HTTPS required in production. Multiple allowed. |
   | Allow PKCE without secret | check only for a **public** client (no `client_secret`)       | Leave unchecked for the standard confidential-client flow Numa uses.                                 |

5. Save. Acumatica generates and displays:
   - **Client ID** — see the `@CompanyId` format gotcha below. ⚠️
   - **Client Secret** — confidential clients only; **shown once**, not displayed again. Copy immediately.

> ### ⚠️ `client_id` format gotcha
>
> The issued Client ID is **not a bare GUID** — it carries a `@CompanyId` suffix:
>
> ```
> 392B04F6-6CA4-43FA-48D9-45A6E6DF5579@Company
> ```
>
> Without the `@CompanyId` suffix the OAuth server cannot resolve which Acumatica tenant the
> credential belongs to, and **every `/identity/connect/token` request fails**. Always store and
> send the full `{GUID}@{CompanyId}` string — in both the authorize redirect and the token POST.
> [VERIFIED 2026-05-19 — `fast-programmer/myob_acumatica` README + Keboola `oauth_helper.sh` line 15; `03` §3, `00` Q2]

> **Prerequisite — the paid API License.** Beyond registering the Connected Application, the
> instance must have the **Acumatica API License** add-on purchased and active. Without it, every
> _authenticated_ API call returns `403` even though the OAuth handshake succeeds. Check this first
> when a freshly connected integration 403s on every call.
> [VERIFIED 2026-03-30 — `03` §2, `00` Q2]

> ### ⚠️ Registry-scope discrepancy (resolve at wiring time)
>
> The current `connectorRegistry.ts` entry sets `scopes: 'api'` (omitting `offline_access`).
> The verified vendor requirement is **`api offline_access`** — without `offline_access`,
> Acumatica does **not** return a `refresh_token` and the connector dies after one
> ~1-hour access-token lifetime. The registry value must be corrected to `api offline_access`
> when this connector is wired. (Do not change it in this doc — flagged here for the wiring task.)
> [VERIFIED 2026-03-30 — `02` §Authentication "Required scopes"; `03` §4.1]

### 2. OAuth Flow

| Property          | Value                                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grant type        | `authorization_code` (+ `refresh_token` for renewal) [VERIFIED 2026-03-30 — `02` §Authentication]                                                                 |
| Authorization URL | `https://{instance}.myobadvanced.com/identity/connect/authorize` [VERIFIED 2026-03-30 — `02`/`03` §4; `00` Q1]                                                    |
| Token URL         | `https://{instance}.myobadvanced.com/identity/connect/token` [VERIFIED 2026-03-30 — `02`/`03` §4; `00` Q1]                                                        |
| OIDC discovery    | `https://{instance}.myobadvanced.com/identity/.well-known/openid-configuration` [DOCUMENTED — `03` §4.4]                                                          |
| Redirect URI      | the registered Numa connector redirect URI (exact match) [VERIFIED — `03` §3]                                                                                     |
| Scopes            | `api offline_access` [VERIFIED 2026-03-30 — `02` §Authentication; `03` §4.1]                                                                                      |
| Header scheme     | `Authorization: Bearer {access_token}` [VERIFIED 2026-03-30 — `02` §Authentication "Header format"]                                                               |
| PKCE required?    | **No** — not enforced. Required for _public_ clients; optional-but-recommended for confidential. [VERIFIED — `02` §Authentication "PKCE required: No"; `03` §4.1] |

> **`{instance}` is mandatory connector input.** Because both endpoints embed the customer
> hostname, the Numa wizard must capture the instance hostname (e.g. `mgccivil`) before any OAuth
> step. The registry ships empty `authUrl`/`tokenUrl` placeholders precisely so the admin supplies
> the per-instance values. [VERIFIED — registry `id: 'myob-acumatica'`, comment "Per-instance"]

> **Scopes — `offline_access` is mandatory.** `api` grants REST access; `offline_access` is
> required to receive a `refresh_token`. Drop it and the connector cannot stay connected past the
> ~1-hour access-token lifetime. [VERIFIED 2026-03-30 — `02`/`03` §4.1]

#### Authorization Request

```http
GET https://{instance}.myobadvanced.com/identity/connect/authorize?
  response_type=code&
  client_id={GUID}@{CompanyId}&
  redirect_uri={REDIRECT_URI}&
  scope=api%20offline_access&
  state={RANDOM_STATE}&
  code_challenge={SHA256(code_verifier)}&        # public/PKCE clients only
  code_challenge_method=S256                       # public/PKCE clients only
```

| Parameter                 | Required             | Notes                                                                             |
| ------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| `response_type`           | yes                  | Always `code`                                                                     |
| `client_id`               | yes                  | The full `{GUID}@{CompanyId}` string (see §1 gotcha)                              |
| `redirect_uri`            | yes                  | Must match a Connected Application redirect URI byte-for-byte                     |
| `scope`                   | yes                  | Space-separated, URL-encoded; **must include `offline_access`**                   |
| `state`                   | strongly recommended | CSRF protection — validate on callback                                            |
| `code_challenge`(+method) | PKCE clients only    | Only for public clients, or confidential clients with "Allow PKCE without secret" |

The user signs in to their Acumatica instance and consents. Acumatica redirects to
`{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}`. The authorization code is **single-use** and
lives **~60 seconds** — exchange it immediately. [VERIFIED 2026-03-30 — `00` Q5; `03` §4.5]

#### Token Exchange

```http
POST https://{instance}.myobadvanced.com/identity/connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code={AUTH_CODE}&
redirect_uri={REDIRECT_URI}&
client_id={GUID}@{CompanyId}&
client_secret={CLIENT_SECRET}&        # confidential clients only
code_verifier={ORIGINAL_VERIFIER}      # if PKCE was used
```

> Credentials are sent as **form-body fields** (`client_id` / `client_secret`), not HTTP Basic.
> This matches the verified Acumatica/IdentityServer token requests in the sibling docs.
> [VERIFIED 2026-03-30 — `02` §Authentication "Token exchange"; `03` §4.2]

#### Token Response

```json
{
  "access_token": "eyJ0eXAiOiJKV1Qi...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "abc123def456...",
  "scope": "api offline_access"
}
```

- `access_token` — Bearer token, **~1-hour** lifetime (`expires_in: 3600`, instance-configurable).
- `refresh_token` — opaque string, **persist it**; it **rotates on every refresh** (see §3).
  [VERIFIED 2026-03-30 — `02`/`03` §4.2–4.3; `00` Q5]

### 3. Token Refresh

```http
POST https://{instance}.myobadvanced.com/identity/connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token={REFRESH_TOKEN}&
client_id={GUID}@{CompanyId}&
client_secret={CLIENT_SECRET}        # confidential clients only
```

Response is the same shape as §2 Token Response — **including a brand-new `refresh_token`**.

| Property                | Value                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token lifetime   | **~1 hour** (`expires_in: 3600`); instance-configurable [VERIFIED 2026-03-30 — `00` Q5; `02` §Authentication]                                                                                  |
| Refresh token lifetime  | **30 days** default (absolute). Configurable from Acumatica **2023 R2** via `SM303010` (Absolute / Infinite / Sliding). [VERIFIED 2026-03-30 — `00` Q5; `02`/`03`]                             |
| Refresh token rotation? | **Yes — rotates on every use.** Each successful refresh returns a NEW `refresh_token`; the old one is immediately invalidated. [VERIFIED 2026-03-30 — `00` Q5; `03` §4.3]                      |
| Re-consent required?    | When the refresh token expires/is revoked (full re-authorize), or on scope change. Pre-2023 R2 instances have a fixed 30-day absolute lifetime with no config. [VERIFIED 2026-03-30 — `00` Q5] |

> ⚠️ **Headline operational risk — rotation.** Because the refresh token is one-time-use, the
> storage layer **must persist the new `refresh_token` atomically on every refresh, before the
> next call**. If a refresh response is lost (crash before persist), the stored token is dead →
> full re-consent. Never fire two concurrent refreshes with the same token — one wins and kills the
> other. Acumatica's docs do not document any grace window for the previous token, so treat the
> previous token as immediately dead. [VERIFIED 2026-03-30 — rotation per `00` Q5/`03` §4.3; grace-window absence marked [UNKNOWN] — not in vendor docs]

### 4. Token Revocation

```http
POST https://{instance}.myobadvanced.com/identity/connect/revocation   # [UNKNOWN] — endpoint path NOT confirmed for Acumatica
Content-Type: application/x-www-form-urlencoded

token={ACCESS_OR_REFRESH_TOKEN}&
token_type_hint=refresh_token&
client_id={GUID}@{CompanyId}&
client_secret={CLIENT_SECRET}
```

> **[UNKNOWN] — programmatic revocation endpoint not confirmed.** None of the sibling docs
> (`00`/`02`/`03`) document a token-revocation endpoint for MYOB Acumatica. Acumatica runs on
> **IdentityServer** (confirmed by the `/identity/connect/*` paths and the OIDC discovery doc), and
> IdentityServer conventionally exposes `/connect/revocation` per RFC 7009 — so the path above is
> the _inferred_ IdentityServer default, **not a verified Acumatica URL**. Do **not** hardcode it.
> **Resolve it at runtime** from the OIDC discovery document
> (`GET https://{instance}.myobadvanced.com/identity/.well-known/openid-configuration` →
> `revocation_endpoint`), and fall back to the UI path below if it is absent.
> [INFERRED — IdentityServer/RFC 7009 convention; revocation_endpoint discovery is the authoritative resolver]

> **UI revocation (always available).** Acumatica's **Connected Applications** screen (`SM303010`)
> lets an admin review and **revoke** access granted to a registered application — revoking the
> grant invalidates its refresh tokens. This is the reliable revocation path when no
> `revocation_endpoint` is advertised. [VERIFIED — Acumatica "Connected Applications" help page;
>
> > see Sources] On a Numa-side disconnect, delete the stored tokens; the admin can additionally
> > revoke the grant in `SM303010`.

### 5. Reauthorization Triggers

| Trigger                              | Detection                                              | Action                                                                                                    |
| ------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Access token expired                 | `401` on a data call                                   | Refresh using the refresh token, retry the call once                                                      |
| Refresh token expired / rotated-away | Refresh returns `400 invalid_grant` / `401`            | Full re-consent (authorize) flow                                                                          |
| Refresh token > 30 days old          | Refresh returns `invalid_grant`                        | Full re-consent flow                                                                                      |
| Scopes changed                       | `403` on a newly-needed resource (not a token problem) | Re-consent with the updated `scope`                                                                       |
| User/admin revoked in `SM303010`     | Refresh fails (`invalid_grant`) or data calls `401`    | Full re-consent flow                                                                                      |
| API License missing/lapsed           | `403` on **every** call (handshake fine)               | **Not** a token issue — customer must (re)purchase the API License add-on; do NOT loop refresh/re-consent |

> ⚠️ **Distinguish `401` from `403`.** A `401` means the access token is expired/invalid → refresh,
> then re-consent if refresh fails. A `403` is almost never a token problem on Acumatica — it means
> either the **API License is not active** or the **user's role lacks permission** for that entity.
> Do **not** trigger a refresh/re-consent loop on `403`. [VERIFIED 2026-03-30 — `00` Q33/error table; `02` §Error Handling; `03` §6]

---

## Numa Connector Wiring

### Credentials to Store

| Key             | Type   | Scope   | Description                                                                                              |
| --------------- | ------ | ------- | -------------------------------------------------------------------------------------------------------- |
| `instance_host` | string | Company | The customer instance hostname, e.g. `mgccivil` (or full `mgccivil.myobadvanced.com`). Builds every URL. |
| `client_id`     | string | Company | Connected Application Client ID — **full `{GUID}@{CompanyId}` string** (see §1 gotcha)                   |
| `client_secret` | secret | Company | Connected Application Client Secret (shown once in `SM303010` — store in the vault)                      |
| `access_token`  | secret | User    | ~1-hour Bearer token; refreshed automatically                                                            |
| `refresh_token` | secret | User    | **Rotating, one-time-use**; re-persist on every refresh                                                  |
| `api_version`   | string | Company | Contract version pinned in the URL, e.g. `24.200.001` (no "latest" alias — pin it)                       |
| `company`       | string | Company | Login company name (the `CompanyId` half of the client_id; also used for the OData/GI feed path)         |

The `instance_host`, `client_id`, `client_secret`, `api_version`, and `company` are **company**
credentials (the customer admin supplies them once, per instance). The `access_token` /
`refresh_token` pair is **per-user**, captured during the user connect flow.
[VERIFIED — per-instance + per-user split per `00` "Integration Path", `03` §9]

### Test Connection Sequence

```
1. GET https://{instance}.myobadvanced.com/identity/.well-known/openid-configuration
     (no auth)
   → 200 with a JSON OIDC discovery doc (authorization_endpoint, token_endpoint,
     and revocation_endpoint if present)   — verifies the instance host is correct & reachable

2. GET https://{instance}.myobadvanced.com/entity/Default/{api_version}/Customer?$top=1&$select=CustomerID
     Authorization: Bearer {access_token}
     Accept: application/json
   → 200 with a one-element array of Customer objects (each field wrapped {"value": ...})
       — verifies the access token AND that the API License is active
   → 403  → API License not active OR user lacks permission (NOT a token problem)
   → 401  → access token expired → refresh, then retry step 2 once
```

> Use `Customer` with `$top=1&$select=CustomerID` as the smoke test — it's the cheapest read and is
> present on every Acumatica instance. A `200` here proves token validity **and** that the paid API
> License gate is open (a missing license 403s every authenticated call). [VERIFIED 2026-03-30 — `03` §6 smoke test; `00` Q33]

### Auto-Reconnect Logic

```
on 401 response (data call):
  refresh_token()                       # POST {instance}/identity/connect/token, grant_type=refresh_token
  persist the NEW refresh_token         # rotates on every use — save before the next call
  retry the original request once
  if refresh returns invalid_grant / 401:
    trigger full re-consent (authorize) flow   # refresh token stale / >30d / revoked in SM303010

on 403 response (data call):
  do NOT refresh — this is a license or permission problem
  if every call 403s:   surface "MYOB Acumatica API License is not active for this instance"
  else (single entity): surface "the connected user lacks permission for {Entity}"

on 429 response:
  no Retry-After header is documented — back off exponentially (1s, 2s, 4s, …) and retry
  (Acumatica throttles by CONCURRENCY, not RPM: ~6 concurrent for L-series; cap parallelism at 3–4)
```

[VERIFIED 2026-03-30 — 401/refresh/rotation per `00` Q5; 403 license/permission per `00` Q33; 429 no-Retry-After + concurrency per `00` Q9/Q11, `02`/`03` §Rate limits]

---

## Quick-Reference URLs

| Resource                                            | URL                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Customer instance (per-tenant)                      | `https://{instance}.myobadvanced.com`                                                   |
| Authorize endpoint                                  | `https://{instance}.myobadvanced.com/identity/connect/authorize`                        |
| Token endpoint                                      | `https://{instance}.myobadvanced.com/identity/connect/token`                            |
| OIDC discovery                                      | `https://{instance}.myobadvanced.com/identity/.well-known/openid-configuration`         |
| Revocation endpoint                                 | **[UNKNOWN]** — resolve via `revocation_endpoint` in OIDC discovery; else `SM303010` UI |
| Connected Applications screen (register/revoke)     | `SM303010` (inside the customer instance)                                               |
| License Monitoring Console                          | `SM604000` (inside the customer instance)                                               |
| Developer portal                                    | https://enterprise-support.myob.com/acudev/                                             |
| API documentation hub                               | https://enterprise-support.myob.com/acudev/api-documentation                            |
| Contract-based REST guide                           | https://enterprise-support.myob.com/adv/contract-based-rest-api                         |
| Acumatica help (vanilla — OAuth/Connected Apps)     | https://help.acumatica.com                                                              |
| Ruby SDK (community, authoritative for OAuth shape) | https://github.com/fast-programmer/myob_acumatica                                       |
| Official C# REST client                             | https://github.com/Acumatica/AcumaticaRESTAPIClientForCSharp                            |

---

_See `02-api-spec-investigation.md` for the full API reference, `03-connector-setup.md` for the
MYOB-side credential setup, and `01-llm-api-rules.md` (+ `01a`–`01d`) for the workspace-agent
knowledge pack. All auth facts above are sourced from those siblings; the revocation **endpoint
path** is the only [UNKNOWN] (Acumatica documents UI revocation via `SM303010` but no confirmed
programmatic endpoint — resolve `revocation_endpoint` from OIDC discovery at runtime)._

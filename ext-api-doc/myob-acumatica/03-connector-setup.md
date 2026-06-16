---
doc: connector-setup (MYOB-side credential setup; no Numa wiring)
vendor: MYOB Acumatica (Acumatica-based ERP, AU/NZ enterprise)
model: PER-INSTANCE — every customer runs their own server at https://{instance}.myobadvanced.com; URLs, OAuth endpoints, Connected Applications all per-instance. No central API.
base_url: https://{instance}.myobadvanced.com
path: /entity/Default/24.200.001/{Entity}
auth: OAuth 2.0 Authorization Code (+ optional PKCE), per-instance IdentityServer
confidence: [DOCUMENTED] unless tagged
---

# Connecting to MYOB Acumatica

## 1. Product context

|                           |                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Vendor / Product          | MYOB Acumatica — ERP (financials, projects, manufacturing, distribution)                                                                 |
| Customer instance URL     | `https://{instance}.myobadvanced.com` (e.g. `mgccivil.myobadvanced.com`) [VERIFIED 2026-05-19 — DNS + wildcard TLS `*.myobadvanced.com`] |
| Developer portal          | https://enterprise-support.myob.com/acudev/                                                                                              |
| API docs hub              | https://enterprise-support.myob.com/acudev/api-documentation                                                                             |
| Contract-based REST guide | https://enterprise-support.myob.com/adv/contract-based-rest-api                                                                          |
| Vanilla Acumatica docs    | https://help.acumatica.com (most general REST/OAuth docs apply)                                                                          |

> ⚠️ **Domain:** customer instances are on `.myobadvanced.com` (NOT `.myob.com`). Earlier drafts using `{instance}.myob.com` are wrong; wildcard TLS is `*.myobadvanced.com`. Only the `enterprise-support.myob.com` developer portal lives on `.myob.com`. [corrected 2026-05-19]

## 2. Prerequisites

- Active MYOB Acumatica instance with a known hostname.
- **API License** add-on purchased + active — without it every authenticated call returns `403` (separate from the base subscription).
- A user account with appropriate record-level permissions (calls inherit the user's role).
- Customer admin must register a **Connected Application** in the instance (§3).

## 3. Register a Connected Application

In the customer's instance:

1. Navigate to **Connected Applications** (screen `SM303010`).
2. Click **+**.
3. Flow Type: `Authorization Code`.
4. Configure: **Name** (shown on consent screen) · **Redirect URI** (must match the callback byte-for-byte; HTTPS in prod) · **Allow PKCE without secret** (check for a public client with no `client_secret`).
5. Save → Acumatica generates **Client ID** (see gotcha) + **Client Secret** (confidential clients only; not shown after first display).

> ⚠️ **`client_id` format gotcha** [VERIFIED 2026-05-19]: the Client ID is NOT a bare GUID — it's a GUID with a `@CompanyId` suffix, e.g. `392B04F6-6CA4-43FA-48D9-45A6E6DF5579@Company`. Without the suffix the OAuth server cannot resolve the tenant and every `/identity/connect/token` request fails. Always store + send the full `{GUID}@{CompanyId}` string. Confirmed by: fast-programmer/myob_acumatica README (`MYOB_ACUMATICA_CLIENT_ID=...@Company`); keboola/component-acumatica `scripts/oauth_helper.sh` line 15.

## 4. OAuth 2.0 — Authorization Code (optional PKCE)

All endpoints are per-instance, derived from the hostname.

### 4.1 Authorize

`GET https://{instance}.myobadvanced.com/identity/connect/authorize?response_type=code&client_id={GUID}@{CompanyId}&redirect_uri={REDIRECT_URI}&scope=api offline_access&state={OPAQUE_STRING}&code_challenge={SHA256(code_verifier)}&code_challenge_method=S256`

- `scope=api offline_access`: `api` grants API access; `offline_access` is required to receive a `refresh_token`.
- `code_challenge`/`code_challenge_method=S256`: PKCE — **required for public clients** (no secret); optional-but-recommended for confidential clients when "Allow PKCE without secret" is enabled.
- User signs in → redirect to `{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}`.

### 4.2 Token exchange

`POST https://{instance}.myobadvanced.com/identity/connect/token` · `Content-Type: application/x-www-form-urlencoded`
Body: `grant_type=authorization_code&code={AUTH_CODE}&redirect_uri={REDIRECT_URI}&client_id={GUID}@{CompanyId}&client_secret={CLIENT_SECRET}&code_verifier={ORIGINAL_VERIFIER}`
(`client_secret` confidential clients only; `code_verifier` only if PKCE used.)
Response: `{"access_token":"eyJ0eXAiOiJKV1Qi...","token_type":"Bearer","expires_in":3600,"refresh_token":"abc123...","scope":"api offline_access"}`

### 4.3 Refresh

`POST .../identity/connect/token` · form-urlencoded: `grant_type=refresh_token&refresh_token={REFRESH_TOKEN}&client_id={GUID}@{CompanyId}&client_secret={CLIENT_SECRET}`

> ⚠️ Refresh tokens **rotate on every successful refresh** — persist the new `refresh_token` immediately; the old one is dead.

### 4.4 OIDC discovery (optional)

`GET https://{instance}.myobadvanced.com/identity/.well-known/openid-configuration`

### 4.5 Token lifetimes

|                    | Default                     | Configurable                                      |
| ------------------ | --------------------------- | ------------------------------------------------- |
| Access token       | ~1 hour (`expires_in` 3600) | Yes (instance setting)                            |
| Authorization code | ~60s, single-use            | No                                                |
| Refresh token      | 30 days                     | From Acumatica 2023 R2, per Connected Application |

## 5. Base URL & headers

```
Base:    https://{instance}.myobadvanced.com/entity/{EndpointName}/{Version}/
Common:  https://{instance}.myobadvanced.com/entity/Default/24.200.001/{Entity}
Authorization: Bearer {ACCESS_TOKEN}
Accept: application/json
Content-Type: application/json     ← POST/PUT only
```

`Default` is the standard endpoint name (~280 entities: Customer, SalesOrder, Bill, StockItem, …). Custom endpoints can be created per-instance.

### 5.1 Contract version (a REAL path segment)

APIs are pinned to a contract version like `24.200.001` — it is a literal segment in the URL, reflecting the Acumatica release the client was generated against. There is NO "latest" alias; always include the version. Multiple versions can be deployed on one instance simultaneously; older clients keep using older versions after an upgrade.

- `24.200.001` (2024 R2) — most common in production
- `25.200.001` (2025 R2) — available
- `26.200.001` (2026 R2) — newer preview

## 6. First call — smoke test

`GET https://{instance}.myobadvanced.com/entity/Default/24.200.001/Customer?$top=1&$select=CustomerID` · `Authorization: Bearer {ACCESS_TOKEN}` · `Accept: application/json`
Expected `200 OK` — one-element array, each field wrapped `{"value":...}`.
| Status | Body / Name | Action |
| --- | --- | --- |
| 401 | — | access token expired → refresh |
| 403 | "API License not active" or similar | customer must purchase the API License add-on |
| 403 (no license msg) | — | user lacks entity permission; check their role |
| 404 | — | wrong endpoint name or version; verify against Connected Applications |
| 429 | — | concurrency limit hit; back off |

## 7. Rate limits (concurrency, not RPM)

| Limit                   | Value                   | Confidence                                         |
| ----------------------- | ----------------------- | -------------------------------------------------- |
| Concurrent API requests | 6 (L-series default)    | [DOCUMENTED — community forum + license-tier docs] |
| Request queue depth     | 20                      | [INFERRED — single community-forum post]           |
| Queue timeout           | 60s                     | [INFERRED — same post]                             |
| Beyond queue            | `429 Too Many Requests` | [DOCUMENTED]                                       |
| Per-request timeout     | 600s (long-running ops) | [DOCUMENTED]                                       |

No `Retry-After` header — exponential backoff (1s, 2s, 4s, …). Per-instance, shared across all integrations. S-series tier has lower concurrency (exact number not public). License Monitoring Console `SM604000` shows current API usage.

## 8. Error response shape

`{"message":"<short error name>","exceptionMessage":"<detailed business-rule explanation>","exceptionType":"PX.Api.ContractBased...","stackTrace":"..."}`
`exceptionMessage` carries Acumatica's specific business-rule explanation — surface it directly; the bare HTTP status rarely tells the whole story.

## 9. Integration constraints

1. **Per-instance everything** — hostname, OAuth endpoints, Connected Application client IDs, user accounts. Cannot bootstrap without the instance URL.
2. **API License gate** — no add-on → every call 403. Check first.
3. **`client_id` must include `@CompanyId`** — else OAuth fails silently.
4. **Refresh tokens rotate** — persist the new one each refresh.
5. **Multi-version coexistence** — pin a known contract version, don't assume "latest".
6. **`{"value":...}` field wrapping** — almost every field; plan for it in deserialisation.

## 10. Quick-reference URLs

| Resource                                            | URL                                                             |
| --------------------------------------------------- | --------------------------------------------------------------- |
| Developer portal                                    | https://enterprise-support.myob.com/acudev/                     |
| API docs hub                                        | https://enterprise-support.myob.com/acudev/api-documentation    |
| Contract-based REST guide                           | https://enterprise-support.myob.com/adv/contract-based-rest-api |
| Acumatica help (vanilla)                            | https://help.acumatica.com                                      |
| Connected Applications screen                       | `SM303010` (inside the instance)                                |
| License Monitoring Console                          | `SM604000` (inside the instance)                                |
| Ruby SDK (community, authoritative for OAuth shape) | https://github.com/fast-programmer/myob_acumatica               |
| OmniAuth strategy (community)                       | https://github.com/dropstream/omniauth-acumatica                |
| Official C# REST client                             | https://github.com/Acumatica/AcumaticaRESTAPIClientForCSharp    |
| Contract NuGet packages                             | https://www.nuget.org/packages?q=Acumatica.Default              |

# Connecting to MYOB Acumatica

> Step-by-step setup for obtaining credentials and getting the first successful API call against an MYOB Acumatica instance. Pure MYOB-side reference — no Numa-specific wiring.

MYOB Acumatica is **per-instance** — every customer has their own Acumatica server hosted on `{instance}.myobadvanced.com`. URLs, OAuth endpoints, and Connected Applications are all per-instance. There is no central API.

---

## 1. Product context

|                           |                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Vendor                    | MYOB (regional Acumatica build for AU / NZ enterprise)                                                                                        |
| Product                   | MYOB Acumatica (ERP — financials, projects, manufacturing, distribution)                                                                      |
| Customer instance URL     | `https://{instance}.myobadvanced.com` (e.g. `mgccivil.myobadvanced.com`) [VERIFIED 2026-05-19 — DNS + wildcard TLS cert `*.myobadvanced.com`] |
| Developer portal          | https://enterprise-support.myob.com/acudev/                                                                                                   |
| API documentation hub     | https://enterprise-support.myob.com/acudev/api-documentation                                                                                  |
| Contract-based REST guide | https://enterprise-support.myob.com/adv/contract-based-rest-api                                                                               |
| Vanilla Acumatica docs    | https://help.acumatica.com (most general Acumatica REST/OAuth docs apply)                                                                     |

> ⚠️ **Domain corrected 2026-05-19.** Earlier drafts of this folder used `{instance}.myob.com` — that's wrong. The DNS apex for the customer-instance pattern is **`.myobadvanced.com`**. The wildcard TLS cert is for `*.myobadvanced.com`. The `enterprise-support.myob.com` developer portal lives on `.myob.com` (correct, it's MYOB's general support host), but customer **instances** do not.

---

## 2. Prerequisites

- An active MYOB Acumatica instance with a known hostname.
- The **API License** add-on must be purchased and active — without it every authenticated API call returns `403`. The license is separate from the base Acumatica subscription.
- A user account with appropriate record-level permissions. API calls inherit the authenticated user's role permissions.
- For per-instance OAuth, the customer admin must register a **Connected Application** inside the instance (see §3).

---

## 3. Register a Connected Application

Inside the customer's MYOB Acumatica instance:

1. Navigate to **Connected Applications** (screen `SM303010`).
2. Click **+** to create a new application.
3. Choose **Flow Type:** `Authorization Code`.
4. Configure the application:
   - **Name** — shown to users on the consent screen.
   - **Redirect URI** — must match the callback your application will use byte-for-byte. Must use HTTPS in production.
   - **Allow PKCE without secret** — check if you want a public client (no `client_secret`).
5. Save. Acumatica generates and displays:
   - **Client ID** — see format gotcha below
   - **Client Secret** — confidential clients only; not shown after first display

### ⚠️ `client_id` format gotcha (verified 2026-05-19)

The issued Client ID is **not a bare GUID**. It's a GUID with a `@CompanyId` suffix:

```
392B04F6-6CA4-43FA-48D9-45A6E6DF5579@Company
```

Without the `@CompanyId` suffix the OAuth server cannot resolve which Acumatica tenant the credential belongs to, and every `/identity/connect/token` request fails. Always store and send the full `{GUID}@{CompanyId}` string.

Confirmed by:

- Official Ruby gem [`fast-programmer/myob_acumatica`](https://github.com/fast-programmer/myob_acumatica) — `MYOB_ACUMATICA_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx@Company`
- Keboola's working OAuth helper [`keboola/component-acumatica/scripts/oauth_helper.sh`](https://github.com/keboola/component-acumatica/blob/main/scripts/oauth_helper.sh) line 15

---

## 4. OAuth 2.0 — Authorization Code (with optional PKCE)

All OAuth endpoints are **per-instance**, derived from the customer's hostname.

### 4.1 Authorize

```
GET https://{instance}.myobadvanced.com/identity/connect/authorize
  ?response_type=code
  &client_id={GUID}@{CompanyId}
  &redirect_uri={REDIRECT_URI}
  &scope=api offline_access
  &state={OPAQUE_STRING}
  &code_challenge={SHA256(code_verifier)}      ← public clients (PKCE)
  &code_challenge_method=S256                   ← public clients (PKCE)
```

- `scope=api offline_access` is the standard pair. `api` grants API access; `offline_access` is required to receive a `refresh_token`.
- PKCE is **required for public clients** (no `client_secret`); **optional but recommended for confidential clients** when the "Allow PKCE without secret" box is enabled on the Connected Application.

The user signs in to their Acumatica instance and is redirected to `{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}`.

### 4.2 Token exchange

```
POST https://{instance}.myobadvanced.com/identity/connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={AUTH_CODE}
&redirect_uri={REDIRECT_URI}
&client_id={GUID}@{CompanyId}
&client_secret={CLIENT_SECRET}        ← confidential clients only
&code_verifier={ORIGINAL_VERIFIER}    ← if PKCE was used
```

Response:

```json
{
  "access_token": "eyJ0eXAiOiJKV1Qi...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "abc123...",
  "scope": "api offline_access"
}
```

### 4.3 Refresh

```
POST https://{instance}.myobadvanced.com/identity/connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token={REFRESH_TOKEN}
&client_id={GUID}@{CompanyId}
&client_secret={CLIENT_SECRET}        ← confidential clients only
```

> ⚠️ **Refresh tokens rotate on every successful refresh.** Persist the new `refresh_token` from the response immediately — the old one is dead.

### 4.4 OIDC discovery (optional)

If the client supports OpenID Connect Discovery:

```
GET https://{instance}.myobadvanced.com/identity/.well-known/openid-configuration
```

### 4.5 Token lifetimes

|                    | Default                     | Configurable                                                   |
| ------------------ | --------------------------- | -------------------------------------------------------------- |
| Access token       | ~1 hour (`expires_in` 3600) | Yes (instance setting)                                         |
| Authorization code | ~60 seconds, single-use     | No                                                             |
| Refresh token      | 30 days                     | From Acumatica 2023 R2, configurable per Connected Application |

---

## 5. Base URL & required headers

```
Base URL:       https://{instance}.myobadvanced.com/entity/{EndpointName}/{Version}/
Common path:    https://{instance}.myobadvanced.com/entity/Default/24.200.001/{Entity}

Authorization:  Bearer {ACCESS_TOKEN}
Accept:         application/json
Content-Type:   application/json     ← POST/PUT only
```

`Default` is the most common endpoint name and exposes ~280 entities (Customer, SalesOrder, Bill, StockItem, etc.). Custom endpoints can be created per-instance.

### 5.1 API contract version

Acumatica APIs are pinned to a "contract" version like `24.200.001`. The version reflects the Acumatica release the client was generated against.

- `24.200.001` (2024 R2) — most common in production today
- `25.200.001` (2025 R2) — available
- `26.200.001` (2026 R2) — newer preview

Each instance can have multiple contract versions deployed simultaneously. Always include the version in the URL — there is no "latest" alias. Older clients can continue using older versions even after an upgrade.

---

## 6. First successful call — smoke test

After obtaining `access_token`:

```http
GET https://{instance}.myobadvanced.com/entity/Default/24.200.001/Customer?$top=1&$select=CustomerID
Authorization: Bearer {ACCESS_TOKEN}
Accept: application/json
```

Expected: `200 OK` with a one-element array of customer objects (each field wrapped `{"value": ...}` — Acumatica's standard response shape).

Failure modes:

| Status               | Body / `Name`                       | Action                                                                       |
| -------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| 401                  | —                                   | Access token expired → refresh                                               |
| 403                  | "API License not active" or similar | Customer must purchase the Acumatica API License add-on                      |
| 403 (no license msg) | —                                   | User lacks permission for the entity; check their role                       |
| 404                  | —                                   | Wrong endpoint name or version; verify against Connected Applications screen |
| 429                  | —                                   | Concurrency limit hit; back off                                              |

---

## 7. Rate limits

Acumatica governs API usage by **concurrency** (parallel in-flight requests), not RPM.

| Limit                   | Value                          | Confidence                                         |
| ----------------------- | ------------------------------ | -------------------------------------------------- |
| Concurrent API requests | 6 (L-series license default)   | [DOCUMENTED — community forum + license-tier docs] |
| Request queue depth     | 20                             | [INFERRED — single community-forum post]           |
| Queue timeout           | 60 seconds                     | [INFERRED — same single community post]            |
| Beyond queue            | `429 Too Many Requests`        | [DOCUMENTED]                                       |
| Per-request timeout     | 600 seconds (long-running ops) | [DOCUMENTED]                                       |

There's no `Retry-After` header — back off exponentially (1s, 2s, 4s, …). Rate limiting is per-instance, shared across all integrations.

The S-series license tier has lower concurrency (exact number not publicly documented). The License Monitoring Console (`SM604000`) shows current API usage on the instance.

---

## 8. Error response shape

Acumatica returns standardised error JSON for `4xx`/`5xx`:

```json
{
  "message": "<short error name>",
  "exceptionMessage": "<detailed business-rule explanation>",
  "exceptionType": "PX.Api.ContractBased...",
  "stackTrace": "..."
}
```

The most useful field is `exceptionMessage` — it carries Acumatica's specific business-rule explanation. Surface it directly in user-facing errors; the bare HTTP status rarely tells the whole story.

---

## 9. Known integration constraints

1. **Per-instance everything.** Hostname, OAuth endpoints, Connected Application client IDs, user accounts — all per customer instance. You cannot bootstrap a connector without the instance URL.
2. **API License gate.** Without the paid add-on, every API call returns 403. Check this first before debugging anything else.
3. **`client_id` must include `@CompanyId` suffix.** Without it, OAuth fails silently with an unhelpful error.
4. **Refresh tokens rotate.** Persist the new one on every refresh response.
5. **Multi-version coexistence.** Multiple contract versions can be deployed on one instance — pin your client to a known version, don't assume "latest".
6. **`{"value": ...}` field wrapping.** Acumatica wraps almost every field in `{"value": ...}`. Plan for it in any deserialisation layer.

---

## 10. Quick-reference URLs

| Resource                                            | URL                                                             |
| --------------------------------------------------- | --------------------------------------------------------------- |
| Developer portal                                    | https://enterprise-support.myob.com/acudev/                     |
| API documentation hub                               | https://enterprise-support.myob.com/acudev/api-documentation    |
| Contract-based REST guide                           | https://enterprise-support.myob.com/adv/contract-based-rest-api |
| Acumatica help (vanilla)                            | https://help.acumatica.com                                      |
| Connected Applications screen                       | `SM303010` (inside the customer instance)                       |
| License Monitoring Console                          | `SM604000` (inside the customer instance)                       |
| Ruby SDK (community, authoritative for OAuth shape) | https://github.com/fast-programmer/myob_acumatica               |
| OmniAuth strategy (community)                       | https://github.com/dropstream/omniauth-acumatica                |
| Official C# REST client                             | https://github.com/Acumatica/AcumaticaRESTAPIClientForCSharp    |
| Contract NuGet packages                             | https://www.nuget.org/packages?q=Acumatica.Default              |

---
api_name: Simpro
api_slug: simpro
auth_type: oauth2 (+ Direct Access API key alternative)
category: field-service-management
base_url: https://{build}.simprosuite.com/api/v1.0/ (/api/v1.0 is a real path segment)
oauth_host: per-build https://{build}.simprosuite.com — NO central host (auth.simpro.co is NXDOMAIN)
doc: Simpro-side credential/setup walkthrough (no Numa-specific wiring)
---

# Connecting to the Simpro API

Simpro is a **per-build (per-customer-tenant) SaaS** — every OAuth URL and API URL contains the customer's `{build}` subdomain (the subdomain they sign into, e.g. `markscompany.simprosuite.com`). There is NO central OAuth or API host.

## 1. Product context

|                    |                                                                         |
| ------------------ | ----------------------------------------------------------------------- |
| Vendor             | Simpro Software Pty Ltd (Australia)                                     |
| Product            | Simpro — field-service management for trades/contractors                |
| Website            | https://www.simprogroup.com                                             |
| Developer portal   | https://developer.simprogroup.com                                       |
| API forum          | https://apiforum.simprogroup.com                                        |
| Customer build URL | `https://{build}.simprosuite.com` (e.g. `markscompany.simprosuite.com`) |

## 2. Create the API application

Customer (or admin with **Manage Applications**): sign in to `https://{build}.simprosuite.com` → **System → Setup → API → Applications** → **Add**:
| Field | Notes |
| --- | --- |
| Name | free text, shown on consent screen |
| Description | optional |
| Access Type | **OAuth 2.0** (user-context) OR **Direct Access (API Key)** (server-to-server, no consent) |
| Redirect URI | must match the callback URL byte-for-byte on every OAuth request |
| Grant Type | `authorization_code` for standard web-app flow (other grants in §3.4) |
Save → Simpro shows **Client ID** and **Client Secret** (shown once — capture immediately).
For API-key access: Simpro emits a long-lived bearer token instead of client_id/secret — treat like a PAT.

## 3. OAuth 2.0 flow — per-build

> ⚠️ OAuth endpoints are **per-build**. The widely-cited central host `auth.simpro.co` does NOT exist in DNS (NXDOMAIN, verified 2026-05-19). Every URL uses `{build}.simprosuite.com` — matching the official PHP SDK `simPRO-Software/simpro-restapi-php/src/OAuth2/Provider.php` lines 225+230.

### 3.1 Authorize

`https://{build}.simprosuite.com/oauth2/login?client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&response_type=code&state={RANDOM_OPAQUE_STRING}`
User signs in → `{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}` (error: `?error={code}&error_description={message}`).

### 3.2 Token exchange

`POST https://{build}.simprosuite.com/oauth2/token` (Content-Type: application/x-www-form-urlencoded)
`grant_type=authorization_code&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&code={AUTH_CODE}&redirect_uri={REDIRECT_URI}`
Response: `{"access_token":"...","refresh_token":"...","expires_in":3600,"token_type":"bearer"}`

### 3.3 Refresh

`POST https://{build}.simprosuite.com/oauth2/token` (application/x-www-form-urlencoded)
`grant_type=refresh_token&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&refresh_token={REFRESH_TOKEN}`

> ⚠️ Refresh tokens are **single-use** — each refresh returns a NEW `refresh_token`; persist it immediately. The old one is dead after the response.

### 3.4 Grant types (PHP SDK `OAuth2/Provider.php`)

| Grant                       | Use              | Notes                                              |
| --------------------------- | ---------------- | -------------------------------------------------- |
| `authorization_code`        | standard web-app | recommended                                        |
| `client_credentials`        | server-to-server | no user context                                    |
| `password` (resource_owner) | direct user/pass | **deprecated**, legacy only                        |
| `implicit`                  | browser-only     | **deprecated by OAuth 2.1 / RFC 9700**; do not use |

### 3.5 Token lifetimes

Access token: 3600s (1 hour). Refresh token: 14 days, single-use. [INFERRED — forum (paywalled), not independently verifiable]

## 4. Base URL & headers

```
Base URL:       https://{build}.simprosuite.com/api/v1.0/
Authorization:  Bearer {ACCESS_TOKEN_OR_API_KEY}
Accept:         application/json
Content-Type:   application/json     ← POST/PATCH only
```

Official PHP SDK adds these via `getAuthorizationHeaders()` (Provider.php:200).

## 5. Multi-company support

A build can host multiple **companies**. Nearly every resource path includes `{companyId}`: `/api/v1.0/companies/{companyId}/jobs/` etc.
Discover the company ID: `GET /api/v1.0/companies/` (no `{companyId}`) → array of company objects each with `ID`; use the one the user intends. The PHP SDK `examples/AuthorisationCode.php` does this and picks the last entry (`$companyArray[count($companyArray)-1]->ID`). **Do NOT hardcode `companyId=0`** — that is folklore from a forum post, only works on some legacy single-company builds; the canonical pattern is fetch-then-use.

## 6. First call — smoke test

After obtaining `access_token` + `companyId`:

```http
GET https://{build}.simprosuite.com/api/v1.0/companies/{companyId}/customers/?pageSize=1
Authorization: Bearer {ACCESS_TOKEN}
Accept: application/json
```

Expected `200 OK`: body = array of customer objects; headers `Result-Total`, `Result-Pages`, `Result-Count`.
| Failure | Meaning | Action |
| --- | --- | --- |
| 401 | token expired/invalid | refresh token |
| 403 | Access Type doesn't grant resource — or wrong companyId | check Direct vs User Token + verify companyId |
| 404 | wrong path / unknown companyId | verify path against dev portal; verify ID via `GET /companies/` |
| 429 | rate limit (10 req/sec) | backoff; respect 80% threshold |

## 7. Rate limits

| Limit                 | Value                                                      | Source                         |
| --------------------- | ---------------------------------------------------------- | ------------------------------ |
| Per build, per second | **10 req/sec** (strict, server-enforced since Aug 2022)    | forum + Laravel SDK config     |
| Recommended threshold | 8 req/sec (80%) — leaves headroom                          | Laravel SDK `threshold => 0.8` |
| Daily                 | exists anecdotally, no public number — treat as [INFERRED] | forum                          |
| Exceeded              | HTTP 429                                                   | —                              |

Source: github.com/stitch-digital/laravel-simpro-api (active Laravel SDK; rate-limit threshold + per-second limit encoded in package config).

## 8. Pagination

|                         |                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Default / max page size | 30 / 250                                                                                   |
| Query params            | `?page={N}&pageSize={N}`                                                                   |
| Total-count headers     | `Result-Total` (total rows), `Result-Pages` (total pages), `Result-Count` (rows this page) |
| Filter                  | `?Status=Open&...` (resource-specific)                                                     |
| Modified-since          | `If-Modified-Since` header — server returns `304` if unchanged                             |

> Anomaly: `If-Modified-Since` + `?orderby=` + the `AssignedTo` column can return `500`. Avoid that combination. [INFERRED — forum]

## 9. Quick-reference URLs

| Resource                       | URL                                                            |
| ------------------------------ | -------------------------------------------------------------- |
| Developer portal               | https://developer.simprogroup.com                              |
| API forum                      | https://apiforum.simprogroup.com                               |
| Customer build URL             | `https://{build}.simprosuite.com`                              |
| OAuth login (per-build)        | `https://{build}.simprosuite.com/oauth2/login?client_id={CID}` |
| OAuth token (per-build)        | `https://{build}.simprosuite.com/oauth2/token`                 |
| Base API URL                   | `https://{build}.simprosuite.com/api/v1.0/`                    |
| Official PHP SDK               | https://github.com/simPRO-Software/simpro-restapi-php          |
| Community Laravel SDK (active) | https://github.com/stitch-digital/laravel-simpro-api           |

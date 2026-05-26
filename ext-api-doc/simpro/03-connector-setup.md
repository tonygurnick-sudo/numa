---
api_name: 'Simpro'
auth_type: 'oauth2'
category: 'field-service-management'
---

# Connecting to the Simpro API

> Step-by-step setup for obtaining credentials and getting the first successful API call against Simpro. Pure Simpro-side reference — no Numa-specific wiring.

Simpro is a **per-build** (per-customer-tenant) SaaS — every URL contains the customer's build subdomain. There is no centralised OAuth or API host.

---

## 1. Product context

|                    |                                                                         |
| ------------------ | ----------------------------------------------------------------------- |
| Vendor             | Simpro Software Pty Ltd (Australia)                                     |
| Product            | Simpro — field service management for trades/contractors                |
| Website            | https://www.simprogroup.com                                             |
| Developer portal   | https://developer.simprogroup.com                                       |
| API forum          | https://apiforum.simprogroup.com                                        |
| Customer build URL | `https://{build}.simprosuite.com` (e.g. `markscompany.simprosuite.com`) |

The customer's `{build}` is the subdomain they sign into Simpro at. It appears in **every** OAuth URL and API URL — there is no shared/central API host.

---

## 2. Create the API application

The customer (or an admin with the **Manage Applications** permission) must:

1. Sign in to their Simpro build (`https://{build}.simprosuite.com`).
2. Go to **System → Setup → API → Applications**.
3. Click **Add** and fill in:

   | Field        | Notes                                                                                                                   |
   | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
   | Name         | Free text shown on the consent screen                                                                                   |
   | Description  | Optional                                                                                                                |
   | Access Type  | Choose **OAuth 2.0** for user-context access, or **Direct Access (API Key)** for server-to-server with no user consent. |
   | Redirect URI | Must match the callback URL byte-for-byte on every OAuth request                                                        |
   | Grant Type   | `authorization_code` for standard web-app flow; other grants below                                                      |

4. Save. Simpro displays:
   - **Client ID** — capture immediately
   - **Client Secret** — capture immediately, shown once

For API-key access (no OAuth): Simpro emits a long-lived bearer token instead of client_id/secret; treat it like a PAT.

---

## 3. OAuth 2.0 flow — per-build

> ⚠️ **The OAuth endpoints are per-build.** A widely-cited centralised host `auth.simpro.co` **does not exist in DNS (NXDOMAIN, verified 2026-05-19)**. Every OAuth example here uses `{build}.simprosuite.com`. This is what the official PHP SDK `simPRO-Software/simpro-restapi-php/src/OAuth2/Provider.php` (lines 225 and 230) uses.

### 3.1 Authorize URL

```
https://{build}.simprosuite.com/oauth2/login?
  client_id={CLIENT_ID}
  &redirect_uri={REDIRECT_URI}
  &response_type=code
  &state={RANDOM_OPAQUE_STRING}
```

The user signs in and is redirected to `{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}` (error case: `?error={code}&error_description={message}`).

### 3.2 Token exchange

```
POST https://{build}.simprosuite.com/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id={CLIENT_ID}
&client_secret={CLIENT_SECRET}
&code={AUTH_CODE}
&redirect_uri={REDIRECT_URI}
```

Response:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600,
  "token_type": "bearer"
}
```

### 3.3 Refresh

```
POST https://{build}.simprosuite.com/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&client_id={CLIENT_ID}
&client_secret={CLIENT_SECRET}
&refresh_token={REFRESH_TOKEN}
```

> ⚠️ **Refresh tokens are single-use.** Each successful refresh returns a NEW `refresh_token`; persist it immediately. The old one is dead after the response is sent.

### 3.4 Other grant types

The PHP SDK enumerates four grant types in `OAuth2/Provider.php`:

| Grant                       | Use                               | Notes                                                           |
| --------------------------- | --------------------------------- | --------------------------------------------------------------- |
| `authorization_code`        | Standard web-app flow             | Recommended                                                     |
| `client_credentials`        | Server-to-server                  | No user context                                                 |
| `password` (resource_owner) | Direct username/password exchange | **Deprecated**, only for legacy clients                         |
| `implicit`                  | Browser-only                      | **Deprecated by OAuth 2.1 / RFC 9700**; do not use for new work |

### 3.5 Token lifetimes

|               | Value                 | Source            |
| ------------- | --------------------- | ----------------- |
| Access token  | 3600 seconds (1 hour) | Forum (paywalled) |
| Refresh token | 14 days, single-use   | Forum (paywalled) |

[INFERRED — forum source not independently verifiable]

---

## 4. Base URL & required headers

```
Base URL:       https://{build}.simprosuite.com/api/v1.0/
Authorization:  Bearer {ACCESS_TOKEN_OR_API_KEY}
Accept:         application/json
Content-Type:   application/json     ← POST/PATCH only
```

The official PHP SDK adds these via `getAuthorizationHeaders()` (`Provider.php:200`).

---

## 5. Multi-company support

A single Simpro build can host multiple **companies**. Almost every resource path includes the `{companyId}` segment:

```
/api/v1.0/companies/{companyId}/jobs/
/api/v1.0/companies/{companyId}/customers/
/api/v1.0/companies/{companyId}/invoices/customer/
```

### How to discover the company ID

1. Call `GET /api/v1.0/companies/` (no `{companyId}` in the path).
2. The response is an array of company objects, each with an `ID`. Use the one the user intends to work in.

The official PHP SDK example (`examples/AuthorisationCode.php`) does exactly this and picks the last entry — `$companyArray[count($companyArray)-1]->ID`. **Do not hardcode `companyId=0`** — that's a folklore shortcut from a forum post and only works on some legacy single-company builds; the canonical pattern is to fetch and use the real ID.

---

## 6. First successful call — smoke test

After obtaining `access_token` + `companyId`:

```http
GET https://{build}.simprosuite.com/api/v1.0/companies/{companyId}/customers/?pageSize=1
Authorization: Bearer {ACCESS_TOKEN}
Accept: application/json
```

Expected: `200 OK` with:

- Body: array of customer objects
- Headers: `Result-Total`, `Result-Pages`, `Result-Count`

Failure modes:

| Status | Meaning                                                                    | Action                                                                    |
| ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 401    | Access token expired/invalid                                               | Refresh token                                                             |
| 403    | Application's Access Type doesn't grant this resource — or wrong companyId | Check Direct Access vs User Token + verify companyId                      |
| 404    | Wrong path / unknown companyId                                             | Verify path against the developer portal; verify ID via `GET /companies/` |
| 429    | Rate-limit (10 req/sec)                                                    | Backoff; respect 80% threshold pattern                                    |

---

## 7. Rate limits

| Limit                 | Value                                                                           | Source                                |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------- |
| Per build, per second | **10 requests/sec** (strict, server-enforced since Aug 2022)                    | Forum + Laravel SDK config            |
| Recommended threshold | 8 req/sec (80%) — leaves headroom                                               | Laravel SDK config `threshold => 0.8` |
| Daily limit           | Anecdotally exists but no public number — treat as `[INFERRED]` until confirmed | Forum                                 |
| Exceeded              | HTTP `429`                                                                      | —                                     |

[Sources: https://github.com/stitch-digital/laravel-simpro-api — actively maintained Laravel SDK; the rate-limit threshold + per-second limit are encoded directly in the package config.]

---

## 8. Pagination

|                     |                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Default page size   | 30                                                                                                     |
| Max page size       | 250                                                                                                    |
| Query params        | `?page={N}&pageSize={N}`                                                                               |
| Total-count headers | `Result-Total` (total matching rows), `Result-Pages` (total pages), `Result-Count` (rows in this page) |
| Filter              | `?Status=Open&...` (resource-specific)                                                                 |
| Modified-since      | `If-Modified-Since` header — server returns `304` if unchanged                                         |

**Known anomaly:** combining `If-Modified-Since` with `?orderby=` plus the `AssignedTo` column can return `500`. Avoid that combination. [INFERRED — forum-sourced]

---

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

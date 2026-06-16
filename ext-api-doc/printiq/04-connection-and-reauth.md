---
api_name: PrintIQ
api_slug: printiq
content: connection & reauthorization guide (credential exchange → session token)
auth_type: username-password — credential exchange (username + password + app_name + app_key → session token); NOT OAuth 2.0, NOT a single static PAT
base_url: per-tenant — https://{instance}.printiq.com/ (custom domains also exist); API base path [UNKNOWN]
call_surface: HTTP via connect_request (Direct API)
confidence: LOW. The credential MODEL (four fields, issued by printIQ support) is confirmed from public material. The token-exchange endpoint, token header name, token format, and lifetime are all [INFERRED]/[UNKNOWN] — IQConnect reference is partner-gated, never accessed. Verify everything marked inferred against a live instance before trusting it.
---

# PrintIQ — Connection & Reauthorization Guide

Setup for connecting Numa to printIQ ("IQConnect" API). Detailed enough to script connector setup.

## 1. Product context

|               |                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Vendor        | printIQ — cloud print MIS / estimating & workflow software (NZ-founded, AU/global)                |
| Product       | printIQ + the **IQConnect** API surface                                                           |
| Website       | https://printiq.com                                                                               |
| API marketing | https://printiq.com/iqconnect-api/ (overview only; real reference partner-gated)                  |
| API base URL  | per-tenant — `https://{instance}.printiq.com/` (custom domains also exist); base path `[UNKNOWN]` |
| OpenAPI spec  | none public                                                                                       |
| Dev / support | printIQ support / integrations team — provisions credentials, instance access, and webhooks       |

## 2. Where to get the credentials

printIQ is per-tenant and does NOT self-service API credentials. Unlike a PAT you generate yourself, all five pieces come from two places:

1. **From printIQ support / your account manager** (not a self-service UI): `username` (an API user inside the instance), `password`, `app_name` (application name), `app_key` (application key).
2. **From the customer / instance owner:** instance URL — e.g. `https://myco.printiq.com` (the host the API lives on).
   How to request: ask printIQ support to "issue IQConnect API credentials (username, password, app_name, app_key) for our integration on the customer's instance," and ALSO ask for the **IQConnect API documentation pack + Postman collection** — the authoritative reference this public investigation could not reach. [DOCUMENTED that credentials are support-issued]
   There is NO admin OAuth-app creation step (no client_id/secret, no redirect URI) — `authType` is `username-password`, not `oauth2`.

## 3. Authentication: credential exchange → session token

POST the four credentials to a token endpoint on the instance, receive a session/access token, send it on subsequent calls.

### 3.1 Token exchange (INFERRED — path, fields, response shape ALL unverified)

`POST https://{instance}.printiq.com/api/Site/Token` Content-Type application/json
`{ "username": "apiuser", "password": "••••••••", "app_name": "MyApp", "app_key": "••••••••" }`
Candidate paths to probe during discovery: `/api/Site/Token`, `/api/Token`, `/api/Authenticate`.

### 3.2 Token response (INFERRED)

`{ "token": "eyJhbGciOi...", "expires": "2026-05-29T12:00:00Z" }`
| Property | Value |
| --- | --- |
| Token format | `[UNKNOWN]` — likely a JWT or an opaque session token |
| Token header | `[UNKNOWN]` — `Authorization: Bearer {token}`, a custom header, or a query token all possible |
| Token lifetime | `[UNKNOWN]` — treat short-lived; be ready to re-mint |
| Refresh | `[INFERRED]` — NO refresh-token grant documented; re-POST the four credentials to re-mint |
| Scopes | `[INFERRED]` — inherited from the API user's role inside the printIQ instance |

### 3.3 Authenticated request (INFERRED header)

`GET https://{instance}.printiq.com/api/Customer/CUST001` + `Authorization: Bearer {token}` + `Content-Type: application/json` + `Accept: application/json`.
**`app_name` + `app_key` belong to the token exchange, NOT to data requests** — send them once to mint the token; do NOT append to every API call.

## 4. Token refresh / rotation

| Property            | Value                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Refresh mechanism   | None documented — no refresh tokens. On expiry, re-run the token exchange (re-POST the four credentials). [INFERRED] |
| Can extend a token? | `[UNKNOWN]` — assume no                                                                                              |
| `app_key` rotation  | Reissued by printIQ support; update the stored credential when it changes [INFERRED]                                 |
| Password rotation   | If the API user's password changes in printIQ, update the stored `password`                                          |

Re-minting needs only the four stored credentials (no user interaction, no redirect), so refresh is **automatic** — on a 401 the proxy re-runs the token exchange and retries. Re-consent is only needed if the credentials themselves become invalid (password/app_key changed or revoked by printIQ support).

## 5. First successful call — smoke test

After obtaining the four credentials AND the instance URL (every path `[INFERRED]`):

```
Step 1 — Token exchange:
  POST https://{instance}.printiq.com/api/Site/Token
  { "username": "...", "password": "...", "app_name": "...", "app_key": "..." }
  Expected: 200 + token + expiry.  401 → bad credentials.

Step 2 — GetPrice (DOCUMENTED hero endpoint; INFERRED path/payload):
  POST https://{instance}.printiq.com/api/Quote/GetPrice   Authorization: Bearer {token}
  { "productCode": "BC-350GSM", "quantity": 500, "options": { "finish": "Matte Laminate", "sides": "Double Sided" } }
  Expected: 200 + price. Validates auth + the product/pricing model in one call.

Step 3 — A simple read:
  GET https://{instance}.printiq.com/api/Customer/{customerCode}   Authorization: Bearer {token}
  Expected: 200 + a customer record.
```

If `GetPrice` 404s, the path is wrong — discover the real one from the doc pack. If a known-good token 401s, the token header name is wrong — try a custom header or a query-string token. If a well-formed JSON body 400s with a parse error, the endpoint may expect **XML**.
Failure modes: 401 = credentials invalid / token expired/header wrong → re-mint token, verify the token header name · 403 = authenticated but API user lacks permission → check the API user's role in printIQ · 404 = wrong path OR wrong instance host → verify the endpoint AND the instance URL · 400 = bad request / wrong content type → fix the body, check REST-vs-XML.

## 6. Reauthorization triggers

| Trigger                        | Detection                  | Action                                                             |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| Session token expired          | 401 response               | Auto-refresh: re-run the token exchange with stored creds, retry   |
| Token header / mechanism wrong | 401 on a fresh token       | Try alternative header (custom / query token); capture what works  |
| Credentials revoked / changed  | 401 persists after re-mint | Prompt admin to obtain new credentials from printIQ support        |
| Insufficient permissions       | 403 response               | Check the API user's role in the printIQ instance                  |
| Missing instance URL           | No host to call            | STOP and ask the user for their printIQ instance URL — never guess |

## 7. Numa connector wiring

Credentials to store:
| Key | Type | Description |
| --- | --- | --- |
| `username` | text | API username (from printIQ support) |
| `password` | secret | API user password |
| `app_name` | text | Application name (from printIQ support) |
| `app_key` | secret | Application key (from printIQ support) |
| `instance_url` | url | **GAP — not in `credentialFields` today.** Per-tenant host (e.g. `https://myco.printiq.com`). Required; see 03 §1 |
The first four are the actual `credentialFields` in `connectorRegistry.ts`. The instance URL is the open gap — the API cannot target a host without it; resolve before go-live (add an `instance_url` field, store in connector metadata, or ask the user).

Test connection sequence (both steps `[INFERRED]` paths — confirm live):

```
1. POST {instance}/api/Site/Token  (4 credentials)   → 200: token returned   401: bad credentials
2. POST {instance}/api/Quote/GetPrice  (with token)  → 200: price   404: wrong path   401: token header wrong
```

Auto-reconnect logic:

```
on 401:  # credential-exchange refresh is automatic (no user interaction, no redirect)
  re-run token exchange (re-POST username/password/app_name/app_key)
  if re-mint succeeds: retry the original request with the new token
  if re-mint also 401s: mark connector "needs reauthorization";
    notify admin: "PrintIQ credentials invalid — request fresh IQConnect credentials from printIQ support"
on 403:
  notify admin: "PrintIQ API user lacks permission — check the API user's role in printIQ"
on missing instance URL:
  STOP — ask the user for their printIQ instance URL; do not guess a hostname
```

## 8. Quick-reference

| Resource            | Value / URL                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| Base URL            | `https://{instance}.printiq.com/api/` (per-tenant) `[UNKNOWN exact path]`    |
| Token endpoint      | `POST /api/Site/Token` `[INFERRED]`                                          |
| Hero endpoint       | `POST .../GetPrice` `[DOCUMENTED exists / INFERRED path]`                    |
| API marketing page  | https://printiq.com/iqconnect-api/                                           |
| Credentials source  | printIQ support / integrations team (NOT self-service)                       |
| Instance URL source | The customer / instance owner                                                |
| Authoritative ref   | IQConnect API documentation pack + Postman collection (request from support) |

_Auth type: `username-password` (credential exchange). Web research only; partner-gated docs; no live call. See 02 (full API reference) and 03 (registry entry + deployment)._

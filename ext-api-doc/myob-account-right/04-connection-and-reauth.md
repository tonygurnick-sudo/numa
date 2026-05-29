# MYOB AccountRight (MYOB Business API v2) — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to the MYOB Business API (the single API
> behind AccountRight / Essentials / MYOB Business).
> Auth type: **OAuth 2.0** (Authorization-Code flow, Post-March 2025 variant).
> Goal: enough detail that Numa could automate connector setup via script.
>
> The auth/token endpoints below are the **exact** values in the connector registry
> (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, `id: 'myob-account-right'`).
> Do not substitute alternatives — MYOB serves both the authorize redirect and the token exchange
> from `secure.myob.com`, but on **different paths** (`/oauth2/account/authorize` vs
> `/oauth2/v1/authorize`), and both are load-bearing.
>
> ⚠️ **Two headers, always.** Unlike most OAuth APIs, every MYOB data call needs **both** an
> `Authorization: Bearer {access_token}` header **and** an `x-myobapi-key: {client_id}` header
> (the registered API key). A valid bearer token alone returns `403 DeveloperInactive`.

---

## Auth Type: OAuth 2.0

MYOB is OAuth-only — there is no PAT/API-key user path. The "API key" (`client_id`) is a
**company-level app credential** (admin-supplied once per client), not a per-user token. Per-user
auth is always the authorization-code OAuth flow below.

> The connector registry sets `authType: 'oauth2'`. [VERIFIED 2026-05-29 — connectorRegistry.ts:423]

---

## 1. Create the OAuth Application in MYOB

These steps mirror the registry's `oauthSetupSteps`, expanded from `03-connector-setup.md` §2.

1. Visit **https://developer.myob.com** and submit the **"Register for API Access"** form.
   MYOB creates **my.MYOB** portal login credentials and emails them to you.
   [DOCUMENTED https://developer.myob.com/api/myob-business-api/api-overview/getting-started/]
2. Accept the **shared sandbox company file** invitation from inside my.MYOB before testing.
3. In **my.MYOB**, open the **Developer** tab → **Register App**.
4. Fill in:

   | Field        | Value                                                         | Notes                                                                                                              |
   | ------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
   | App name     | `Numa Integration` (or per-client name)                       | Shown on the user's consent screen.                                                                                |
   | Redirect URI | the **exact** redirect URI shown in the Numa connector wizard | **Must match byte-for-byte** including trailing slash; it must equal the `redirect_uri` used in the authorize URL. |

5. Save, then copy:
   - **API Key** = **Client ID** (also sent on every call as `x-myobapi-key`).
   - **API Secret** = **Client Secret** — **shown once**, capture immediately.

> **Post-March-2025 enrolment.** If the company file is cloud-hosted and the API key was created
> **after 12 March 2025**, you must additionally submit the enrolment ticket
> (https://apisupport.myob.com/hc/en-us/requests/new?ticket_form_id=6175906535311) to be moved
> into the new flow. Without enrolment the new `prompt=consent` redirect behaviour (which returns
> `businessId`) does not apply. [DOCUMENTED — 03-connector-setup.md §2]

> **Administrator requirement.** Only a user with the **Administrator** role on the company file
> can complete the consent screen. Non-admins get an Access Denied at consent time and cannot
> connect — surface this to the end user **before** sending them to the authorize URL.
> [DOCUMENTED — 03-connector-setup.md §3.5]

---

## 2. OAuth Flow

| Property          | Value                                                                             | Confidence                           |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------ |
| Grant type        | `authorization_code`                                                              | [VERIFIED 2026-05-29 — 02 §Auth]     |
| Authorization URL | `https://secure.myob.com/oauth2/account/authorize`                                | [VERIFIED 2026-05-29 — registry:425] |
| Token URL         | `https://secure.myob.com/oauth2/v1/authorize`                                     | [VERIFIED 2026-05-29 — registry:426] |
| Revocation URL    | None officially documented — revoke manually in `secure.myob.com` (see §4)        | [UNKNOWN]                            |
| Redirect URI      | the registered Numa connector redirect URI (exact byte-for-byte match)            | [DOCUMENTED — 03 §2]                 |
| Scopes            | space-separated `sme-*` (e.g. `sme-company-file sme-contacts-customer sme-sales`) | [DOCUMENTED — 02 §OAuth Scopes]      |
| `prompt` param    | **`consent` — MANDATORY** (without it the redirect omits `businessId`)            | [DOCUMENTED — 02/03]                 |
| PKCE required?    | Not documented as used in the MYOB authorization-code flow                        | [INFERRED — not in sibling docs]     |

> ⚠️ **`prompt=consent` is mandatory** in the post-March-2025 flow. Without it, the redirect back
> does **not** include `businessId`, and every subsequent API call has no base-URL target.
> [DOCUMENTED — 02 §Authorization URL Required Parameters; 03 §3.1]

### 2.1 Authorization Request

```http
GET https://secure.myob.com/oauth2/account/authorize?
  client_id={CLIENT_ID}&
  redirect_uri={REDIRECT_URI}&
  response_type=code&
  scope=sme-company-file%20sme-contacts-customer%20sme-sales&
  prompt=consent&
  state={RANDOM_STATE}
```

| Parameter       | Required             | Notes                                                                            |
| --------------- | -------------------- | -------------------------------------------------------------------------------- |
| `client_id`     | yes                  | The API key from my.MYOB                                                         |
| `redirect_uri`  | yes                  | Must match a registered URI **exactly** (incl. trailing slash)                   |
| `response_type` | yes                  | Always `code`                                                                    |
| `scope`         | yes                  | Space-separated (URL-encoded) `sme-*` scopes; `sme-company-file` always required |
| `prompt`        | **yes**              | Must be `consent` — otherwise `businessId` is omitted from the redirect          |
| `state`         | strongly recommended | CSRF protection — validate on callback                                           |

The Administrator user authenticates, **chooses which company file to connect**, and consents.

### 2.2 Redirect Response

MYOB redirects back to `{REDIRECT_URI}` with:

```
{REDIRECT_URI}?code={AUTH_CODE}
              &scope={GRANTED_SCOPES}
              &state={OPTIONAL_STATE}
              &businessId={COMPANY_FILE_GUID}
              &businessName={COMPANY_FILE_DISPLAY_NAME}
```

> 🔑 **`businessId` is the primary identifier for every subsequent call** — it is the `{businessId}`
> placeholder in the base URL `https://api.myob.com/accountright/{businessId}/`. **Persist it
> alongside the tokens.** It is captured here and **only** here for cloud files — the legacy
> "list my company files" endpoint (`GET /accountright/`) was removed for new API keys post-March 2025.
> For multi-file accounts, run the OAuth flow **once per company file** (each with `prompt=consent`)
> and store each returned `businessId`. [DOCUMENTED — 02/03 §3.6]

### 2.3 Token Exchange

```http
POST https://secure.myob.com/oauth2/v1/authorize
Content-Type: application/x-www-form-urlencoded

client_id={CLIENT_ID}&
client_secret={CLIENT_SECRET}&
code={AUTH_CODE}&
redirect_uri={REDIRECT_URI}&
grant_type=authorization_code
```

> Credentials are passed as **form fields in the body** (`client_id`/`client_secret`), not HTTP
> Basic auth. [DOCUMENTED — 02 §Token Request; 03 §3.3]

### 2.4 Token Response

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "scope": "sme-company-file sme-contacts-customer sme-sales",
  "expires_in": 1200,
  "token_type": "bearer"
}
```

- `access_token` — bearer token for API calls; lifetime per `expires_in` (anecdotally ~20 min — see §3).
- `refresh_token` — **rotates on every refresh; persist the new value each time** (see §3).
- `scope` — the granted scopes (may be narrower than requested).
- `token_type` — `bearer` (lowercase in MYOB's response).

[DOCUMENTED — 02 §Token Response Fields; 03 §3.3]

---

## 3. Token Refresh

```http
POST https://secure.myob.com/oauth2/v1/authorize
Content-Type: application/x-www-form-urlencoded

client_id={CLIENT_ID}&
client_secret={CLIENT_SECRET}&
refresh_token={REFRESH_TOKEN}&
grant_type=refresh_token
```

Response is the same shape as §2.4 — **including a brand-new `refresh_token`**.

| Property                | Value                                                                                    | Confidence                        |
| ----------------------- | ---------------------------------------------------------------------------------------- | --------------------------------- |
| Access token lifetime   | Trust `expires_in` from each response (anecdotally **~20 min**, `expires_in: 1200`)      | [UNKNOWN — MYOB does not publish] |
| Refresh token lifetime  | Not published by MYOB — refresh defensively; treat refresh failure as re-consent signal  | [UNKNOWN — MYOB does not publish] |
| Refresh token rotation? | **Yes.** Each successful refresh returns a NEW `refresh_token`; the old one dies at once | [DOCUMENTED — 02 §Token Response] |
| Re-consent required?    | On refresh failure (token stale/expired/revoked), on scope change, or on user revocation | [INFERRED — 01-llm-api-rules]     |

> ⚠️ **The headline operational risk.** Because refresh tokens are one-time-use, the storage layer
> **must persist the new `refresh_token` atomically on every refresh** — "the old one is dead the
> moment the response is sent" (`03-connector-setup.md §3.4`). Never fire two concurrent refreshes
> with the same token — one will win and invalidate the other, forcing a full re-consent.

> ⚠️ **Exact lifetimes are [UNKNOWN].** MYOB does not publish access- or refresh-token lifetimes.
> The connector must **trust `expires_in`** from each token response and refresh **defensively on a
> 401** rather than relying on a hard-coded TTL. [DOCUMENTED — 01-llm-api-rules.md §Known UNKNOWNs;
>
> > 03 §3.3]

---

## 4. Token Revocation

**There is no officially documented programmatic revocation endpoint.** [UNKNOWN]

To revoke access, the my.MYOB account holder must log in to **`https://secure.myob.com`** with the
account used to authenticate and revoke the app's access through the web UI — this **cannot** be done
via the API or the AccountRight program.
[DOCUMENTED https://community.myob.com/discussions/accountrightapiquestions/oauth2-refresh-token-revocation/561739]

> A community-reported, RFC-7009-style endpoint `POST https://secure.myob.com/oauth2/v1/revoke`
> exists but is **not** in MYOB's official documentation and MYOB support has stated revocation must
> be handled through the web interface. **Do not rely on it** — treat it as [UNKNOWN]. For Numa's
> "disconnect" action, delete the stored tokens locally and direct the admin to revoke at
> `secure.myob.com` if a hard server-side revoke is required.

---

## 5. Reauthorization Triggers

When to prompt the user to reauthorize:

| Trigger                        | Detection                                             | Action                                                                              |
| ------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Access token expired           | `401` on a data call                                  | Refresh using refresh token, persist rotated token, retry once                      |
| Refresh fails (token dead)     | Refresh response is an error / non-200                | Full re-consent flow (`prompt=consent`)                                             |
| Scopes changed (new data area) | `403 AccessDenied` on a resource needing a new scope  | Full re-consent flow with the added `sme-*` scope                                   |
| User revoked access in my.MYOB | Refresh fails, or data calls `401`/`403 AccessDenied` | Full re-consent flow                                                                |
| Not an Administrator           | `403 AccessDenied` at consent or on calls             | Surface "must be a company-file Administrator to connect"                           |
| Missing `x-myobapi-key`        | `403 DeveloperInactive`                               | **Not** a reauth issue — fix the header / API-key config; do NOT trigger re-consent |

> ⚠️ **403 is ambiguous in MYOB — inspect the response body `Name` field before reacting.**
> `RateLimitError` → back off and retry (rate limits return **403, not 429**).
> `DeveloperInactive` → API key missing/inactive → config issue, **do not** re-consent.
> `AccessDenied` → permission/scope/role issue → re-consent only if it's a scope gap.
> A `401` is the real "token expired" signal that should drive a refresh.
> [DOCUMENTED — 01d-event-and-error-handling.md §4; 02 §Rate Limits]

---

## Numa Connector Wiring

### Credentials to Store

| Key                          | Type   | Scope   | Description                                                                                            |
| ---------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------ |
| `client_id` (API key)        | string | Company | MYOB API Key. Used **both** as OAuth `client_id` **and** sent as `x-myobapi-key` on every call         |
| `client_secret` (API secret) | secret | Company | MYOB API Secret (shown once — store in the vault)                                                      |
| `access_token`               | secret | User    | Bearer token; refreshed automatically (lifetime per `expires_in`, ~20 min)                             |
| `refresh_token`              | secret | User    | **Rotating, one-time-use** — re-persist on every refresh                                               |
| `business_id` (per file)     | string | User    | Company-file GUID from the OAuth redirect; the `{businessId}` in the base URL — required on every call |
| `business_name` (per file)   | string | User    | Display name from the OAuth redirect; for UI labelling                                                 |

The Client ID/Secret are **company** credentials (admin supplies them once per client). The tokens
and `business_id`/`business_name` are **per-user**, captured during the user connect flow. For
multi-company-file users, store one `business_id` per file (one OAuth pass each).

### Test Connection Sequence

```
1. (post-token) Confirm businessId was captured from the OAuth redirect.
   If absent → prompt=consent was skipped → re-run the authorize step.

2. GET https://api.myob.com/accountright/{business_id}/Contact/Customer?$top=1
     Authorization:     Bearer {access_token}
     x-myobapi-key:     {client_id}
     x-myobapi-version: v2
   → 200 OK with { "Count": …, "Items": [ … ], "NextPageLink": … }
     (verifies bearer token + API-key header + businessId + read scope)
```

> Interpreting failures of the smoke test (from `03-connector-setup.md §7`):
>
> - **401** → access token bad/expired → refresh and retry.
> - **403 `Name: "RateLimitError"`** → hit 8 req/s → back off.
> - **403 `Name: "DeveloperInactive"`** → `x-myobapi-key` missing/invalid → fix header / API key.
> - **403 `Name: "AccessDenied"`** → user isn't an Administrator, or scope gap.
> - **400 / missing `businessId`** → `prompt=consent` was skipped in the authorize URL.

> Use `Contact/Customer?$top=1` (covered by `sme-contacts-customer`) as the smoke test. Pick a test
> endpoint covered by the scopes you actually requested — calling a resource outside the granted
> `sme-*` scopes returns `403 AccessDenied` and makes a valid connection look broken.

### Auto-Reconnect Logic

```
on 401 response (data call):
  refresh_token()                       # POST secure.myob.com/oauth2/v1/authorize, grant_type=refresh_token
  persist the NEW refresh_token         # one-time-use — MUST save before next call
  retry the original request once
  if refresh fails (non-200):
    trigger full re-consent flow        # stored refresh token is stale/revoked → prompt=consent

on 403 response (data call):
  inspect response body "Name":
    "RateLimitError"  -> exponential backoff (2^attempt s, up to 3x), then retry  # NOT a 429
    "DeveloperInactive" -> do NOT refresh/re-consent; fix x-myobapi-key / API-key config
    "AccessDenied"    -> permission/scope/role issue:
                           if a needed sme-* scope is missing -> re-consent with the added scope
                           else surface "must be a company-file Administrator"

on 504 GatewayTimeout:
  linear backoff (5*attempt s), retry up to 3x   # MYOB ~30s server timeout, worse around 20th-5th of month
```

---

## Quick-Reference URLs

| Resource                      | URL                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Developer portal              | https://developer.myob.com                                                    |
| my.MYOB (AU)                  | https://my.myob.com.au                                                        |
| Authorize endpoint            | https://secure.myob.com/oauth2/account/authorize                              |
| Token / refresh endpoint      | https://secure.myob.com/oauth2/v1/authorize                                   |
| Post-March-2025 flow guide    | https://apisupport.myob.com/hc/en-us/articles/13065472856719                  |
| Authentication overview       | https://developer.myob.com/api/myob-business-api/api-overview/authentication/ |
| Scopes reference              | https://developer.myob.com/api/myob-business-api/api-overview/scopes/         |
| Error messages reference      | https://developer.myob.com/api/myob-business-api/api-overview/error-messages/ |
| Revocation (manual, web only) | https://secure.myob.com                                                       |
| API support centre            | https://apisupport.myob.com/hc/en-us                                          |
| API status page               | https://status.myob.com/                                                      |

---

_See `02-api-spec-investigation.md` for the API reference, `03-connector-setup.md` for the MYOB-side
credential setup and OAuth flow, `01d-event-and-error-handling.md` for the full error map and retry
logic, and `01-llm-api-rules.md` (+ `01a`–`01d`) for the workspace-agent knowledge pack._

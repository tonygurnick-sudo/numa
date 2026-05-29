# Flowingly — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to Flowingly.
> Auth type: **Username/Password → Bearer token** (custom token exchange — NOT OAuth, NOT a PAT).
> Goal: enough detail that Numa could automate connector setup via script.
>
> ⚠️ **DISCOVERY-REQUIRED.** Everything below is [DOCUMENTED] (Flowingly Help Center) or
> [INFERRED]/[UNKNOWN]. **No live API call has been made — there are NO [CONFIRMED] facts.**
> Credential placement (query vs body), token lifetime, and refresh behaviour MUST be verified
> against a live instance before production use.

---

## Auth Type: Username/Password Token Exchange

Flowingly's Public API does not use OAuth redirect or a long-lived Personal Access Token. Instead,
the connector stores a Flowingly **username + password**, and the backend exchanges them for a
short-lived **bearer access token** via `POST /public/authorise`. The token is then sent as
`Authorization: Bearer {accessToken}` on every subsequent call.

This is the registry's `authType: 'username-password'`. It is **not** standard OAuth2 (no
`grant_type`, no `/token` endpoint), so neither Option A (OAuth) nor Option B (PAT) of the generic
template applies cleanly — this guide documents the actual token-exchange flow.

---

## 1. Where to get the credentials

There is **no app registration, no client_id/secret, no token-generation UI** to visit. The
"credential" is simply a Flowingly login that has the right role.

| Field    | What to supply                                                                     |
| -------- | ---------------------------------------------------------------------------------- |
| Username | The **email** of a Flowingly user who is a **Business Administrator** [DOCUMENTED] |
| Password | That user's Flowingly account password                                             |

Requirements / notes:

1. The account **must be a Business Administrator** in Flowingly, or the Public API will reject
   calls. [DOCUMENTED]
2. There is no way to scope or restrict the credential — it inherits whatever the Business
   Administrator can do. [UNKNOWN — no scope model published]
3. Best practice (recommendation): create a **dedicated service account** with Business
   Administrator rights for the Numa integration, rather than reusing a person's login, so password
   rotation and offboarding don't break the connector. [INFERRED — not a Flowingly requirement]
4. A "Get an Access Token for Flowingly API" Help Center article exists but its full contents were
   not retrievable; the auth flow below is reconstructed from the integration-example and start-flow
   articles. [DOCUMENTED, partial]

---

## 2. Token Exchange (authorise)

| Property     | Value                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| Endpoint     | `POST https://publicapi.flowingly.net/public/authorise` [DOCUMENTED]                      |
| Credentials  | `username` + `password` as **query-string parameters** [DOCUMENTED]                       |
| Content-Type | `application/x-www-form-urlencoded` [DOCUMENTED]                                          |
| Auth header  | None — this _is_ the auth call                                                            |
| ⚠️ Base URL  | `publicapi.flowingly.net` (docs). Brief's `api.flowingly.io` is **unconfirmed** [UNKNOWN] |

### Request

```http
POST /public/authorise?username=admin@company.com&password=******** HTTP/1.1
Host: publicapi.flowingly.net
Content-Type: application/x-www-form-urlencoded
```

> ⚠️ The docs put credentials in the **query string** even though the `Content-Type` is
> `application/x-www-form-urlencoded`. Whether the credentials also work in the form **body** is
> unverified — test both on live. **URL-encode the password** (it may contain reserved characters).
> [DOCUMENTED — placement needs verification]

### Token Response

```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": null,
  "idToken": "",
  "tokenType": "Bearer",
  "expiresIn": 0
}
```

| Field          | Meaning / status                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `accessToken`  | Bearer token for `Authorization: Bearer {accessToken}` on all resource calls [DOCUMENTED]          |
| `tokenType`    | `"Bearer"` [DOCUMENTED]                                                                            |
| `expiresIn`    | Token lifetime. Documented example shows `0`; **real value and unit (seconds?) UNKNOWN** [UNKNOWN] |
| `refreshToken` | Documented as `null` — **refresh likely NOT supported** [INFERRED]                                 |
| `idToken`      | Empty string in the example; purpose unclear [UNKNOWN]                                             |

### Using the token

```http
POST /public/startflow HTTP/1.1
Host: publicapi.flowingly.net
Authorization: Bearer {accessToken}
Content-Type: application/json
```

The API authorises the request (token check) **before** validating the payload model. [DOCUMENTED]

---

## 3. Expiry & Refresh

| Property              | Value                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------- |
| Access token lifetime | **UNKNOWN** — `expiresIn` documented as `0`; discover the real value/unit on live      |
| Refresh mechanism     | **None known** — `refreshToken` is `null`; no refresh grant documented [INFERRED]      |
| Re-authorise strategy | Re-run `POST /public/authorise` with the stored username/password to get a fresh token |
| Re-consent required?  | No interactive consent — re-auth is silent (backend re-POSTs stored credentials)       |

Because there is no refresh token, the backend cannot exchange a refresh token for a new access
token. Two viable strategies (pick based on the real `expiresIn` once discovered):

1. **Re-authorise on 401 (recommended):** Treat the access token as opaque/short-lived. On a 401
   from any resource call, re-run `/authorise`, then **retry the original request once**. Cache the
   token in memory between calls. This is robust without knowing the exact lifetime.
2. **Proactive refresh (after discovery):** Once `expiresIn` is known and reliable, refresh the
   token shortly before it expires.

Until `expiresIn` is verified, **use strategy 1.** [INFERRED]

---

## 4. Reauthorization Triggers

| Trigger                  | Detection                                 | Action                                                       |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------ |
| Access token expired     | 401 response                              | Re-run `/authorise` with stored credentials, retry once      |
| Credentials invalid      | 401/400 on `/authorise` itself            | Prompt admin/user to update the Flowingly username/password  |
| Password changed/rotated | 401/400 on `/authorise`                   | Prompt for new password; old stored password no longer works |
| Account not BizAdmin     | 403 (or `success:false`) on resource call | Confirm the account has **Business Administrator** role      |

> ⚠️ It is **UNKNOWN** whether auth/permission failures return a 4xx or HTTP 200 with
> `success: false`. Detection logic must check **both** the HTTP status and the response `success`
> field. [UNKNOWN]

---

## Numa Connector Wiring

### Credentials to Store

| Key        | Type   | Description                                                            |
| ---------- | ------ | ---------------------------------------------------------------------- |
| `username` | Secret | Flowingly **Business Administrator** email (registry field `username`) |
| `password` | Secret | That account's password (registry field `password`)                    |

Stored per-user in the vault (this is a `username-password` connector; the user supplies their own
credentials). The bearer `accessToken` is a derived, in-memory artifact obtained by the backend at
call time — **not** a stored credential. No instance/base URL is stored; the host is centralised in
the backend as `https://publicapi.flowingly.net/public/` (pending discovery of the brief's
`api.flowingly.io`).

### Test Connection Sequence

```
1. POST https://publicapi.flowingly.net/public/authorise?username={u}&password={p}
   Content-Type: application/x-www-form-urlencoded
   Expected: 200 with { accessToken, tokenType: "Bearer", ... }
   401/400: bad credentials, or account is not a Business Administrator
   [NOT live-tested — placement (query vs body) and failure status are UNKNOWN]

2. (No documented lightweight "whoami"/health endpoint.) To fully validate, the cheapest real
   action is to read a step on a KNOWN flow:
   GET https://publicapi.flowingly.net/public/flow/{flowIdentifier}/step/{stepName}
   Authorization: Bearer {accessToken}
   — but this requires a known flowIdentifier, so it is not a generic connection probe.
   A successful /authorise (step 1) is the practical "connected" signal until discovery finds a
   health endpoint. [INFERRED]
```

> There is **no documented health/`/version`/`/me` endpoint** (unlike Fergus's `GET /version`). If
> discovery finds one (e.g. via a Swagger probe), prefer it for the connection test.

### Auto-Reconnect Logic

```
on 401 response (resource call):
  # username-password token exchange — no refresh token
  token = POST /public/authorise (stored username, password)   # re-authorise
  if authorise succeeds:
    retry the original request once with the new Bearer token
  else (authorise itself returns 401/400):
    mark connector "needs reauthorization"
    notify user: "Flowingly sign-in failed — check the Business Administrator
                  username/password for the Flowingly connector"
    disable connector until valid credentials are provided

on success:false in body (HTTP 200):
  do NOT treat as success — surface errorMessage; do not auto-retry startflow (not idempotent)
```

### Idempotency caution

`POST /public/startflow` is **not idempotent** — each call starts a new flow instance. The
auto-reconnect "retry once" rule above is safe for GET step-fields and POST update-fields (both
idempotent), but **`startflow` must not be blindly retried**. On an ambiguous `startflow` failure
(e.g. network timeout after the request may have landed), confirm with the user before re-calling to
avoid duplicate flows. [INFERRED]

---

_Sources: help.flowingly.net articles 5608036 (Start Flow), 5572732 (Integration Example),
5578808 (Update Step Fields). NOT live-tested — see discovery checklist in
`00-api-investigation-questionnaire.md`._

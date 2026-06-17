---
api_name: Flowingly
api_slug: flowingly
auth: Username/Password → Bearer token (custom token exchange — NOT OAuth, NOT a PAT)
base_url: https://publicapi.flowingly.net (paths begin /public/...); brief's api.flowingly.io is UNCONFIRMED [UNKNOWN]
authorise_endpoint: POST /public/authorise (credentials in QUERY STRING, Content-Type application/x-www-form-urlencoded)
refresh: none (refreshToken is null) → re-authorise on 401, retry once
confidence: everything is [DOCUMENTED] (Flowingly Help Center) or [INFERRED]/[UNKNOWN] — NOT live-tested, NO [CONFIRMED] facts. Credential placement (query vs body), token lifetime, refresh MUST be verified on a live instance. Tags inline where not [DOCUMENTED].
sources: help.flowingly.net articles 5608036 (Start Flow), 5572732 (Integration Example), 5578808 (Update Step Fields). Discovery checklist in 00-api-investigation-questionnaire.md
---

# Flowingly — Connection & Reauthorization Guide

## Auth type: Username/Password token exchange

No OAuth redirect, no long-lived PAT. The connector stores a Flowingly **username + password**; the backend exchanges them for a short-lived **bearer access token** via `POST /public/authorise`, then sends `Authorization: Bearer {accessToken}` on every subsequent call. This is the registry's `authType: 'username-password'`. NOT standard OAuth2 (no `grant_type`, no `/token`), so neither generic-template Option A (OAuth) nor B (PAT) applies — this guide documents the actual token-exchange flow.

## 1. Where to get the credentials

No app registration, no client_id/secret, no token-generation UI — the "credential" is a Flowingly login with the right role.
| Field | Supply |
| --- | --- |
| Username | the **email** of a Flowingly user who is a **Business Administrator** [DOCUMENTED] |
| Password | that user's Flowingly account password |

Notes: (1) account **must be a Business Administrator** or the Public API rejects calls [DOCUMENTED]. (2) No way to scope/restrict the credential — it inherits whatever the Business Administrator can do [UNKNOWN — no scope model]. (3) Best practice: use a **dedicated service account** with Business Administrator rights (not a person's login) so password rotation/offboarding don't break the connector [INFERRED — not a Flowingly requirement]. (4) A "Get an Access Token for Flowingly API" Help Center article exists but its full contents weren't retrievable; the flow below is reconstructed from the integration-example + start-flow articles [DOCUMENTED, partial].

## 2. Token Exchange (authorise)

| Property     | Value                                                                              |
| ------------ | ---------------------------------------------------------------------------------- |
| Endpoint     | `POST https://publicapi.flowingly.net/public/authorise` [DOCUMENTED]               |
| Credentials  | `username` + `password` as **query-string params** [DOCUMENTED]                    |
| Content-Type | `application/x-www-form-urlencoded` [DOCUMENTED]                                   |
| Auth header  | none — this _is_ the auth call                                                     |
| ⚠️ Base URL  | `publicapi.flowingly.net` (docs). Brief's `api.flowingly.io` unconfirmed [UNKNOWN] |

Request: `POST /public/authorise?username=admin@company.com&password=********`, `Content-Type: application/x-www-form-urlencoded`
⚠️ Docs put credentials in the **query string** despite the form-urlencoded Content-Type; whether they also work in the form **body** is unverified — test both on live. **URL-encode the password** (may contain reserved characters) [DOCUMENTED — placement needs verification].

Response: `{"accessToken":"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...","refreshToken":null,"idToken":"","tokenType":"Bearer","expiresIn":0}`
| Field | Meaning / status |
| --- | --- |
| `accessToken` | bearer token for `Authorization: Bearer {accessToken}` on all resource calls [DOCUMENTED] |
| `tokenType` | `"Bearer"` [DOCUMENTED] |
| `expiresIn` | token lifetime; example shows `0`; **real value and unit (seconds?) UNKNOWN** [UNKNOWN] |
| `refreshToken` | `null` — **refresh likely NOT supported** [INFERRED] |
| `idToken` | empty string in the example; purpose unclear [UNKNOWN] |

Using the token: `POST /public/startflow`, `Authorization: Bearer {accessToken}`, `Content-Type: application/json`. The API authorises the request (token check) **before** validating the payload model [DOCUMENTED].

## 3. Expiry & Refresh

| Property              | Value                                                                           |
| --------------------- | ------------------------------------------------------------------------------- |
| Access token lifetime | **UNKNOWN** — `expiresIn` shows `0`; discover the real value/unit on live       |
| Refresh mechanism     | **none known** — `refreshToken` is null; no refresh grant documented [INFERRED] |
| Re-authorise strategy | re-run `POST /public/authorise` with stored username/password for a fresh token |
| Re-consent required?  | no — re-auth is silent (backend re-POSTs stored credentials)                    |

No refresh token, so the backend can't exchange one for a new access token. Two strategies (pick once the real `expiresIn` is known): (1) **Re-authorise on 401 (recommended)** — treat the token as opaque/short-lived; on a 401 from any resource call, re-run `/authorise` then **retry the original request once**; cache the token in memory between calls. Robust without knowing the lifetime. (2) **Proactive refresh (after discovery)** — once `expiresIn` is known/reliable, refresh shortly before expiry. **Until `expiresIn` is verified, use strategy 1** [INFERRED].

## 4. Reauthorization Triggers

| Trigger                  | Detection                                   | Action                                                       |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| Access token expired     | 401 response                                | re-run `/authorise` with stored credentials, retry once      |
| Credentials invalid      | 401/400 on `/authorise` itself              | prompt admin/user to update the Flowingly username/password  |
| Password changed/rotated | 401/400 on `/authorise`                     | prompt for new password; old stored password no longer works |
| Account not BizAdmin     | 403 (or `success:false`) on a resource call | confirm the account has **Business Administrator** role      |

⚠️ UNKNOWN whether auth/permission failures return a 4xx or HTTP 200 + `success:false` — detection must check **both** the HTTP status and the `success` field [UNKNOWN].

## Numa Connector Wiring

### Credentials to store

| Key        | Type   | Description                                                            |
| ---------- | ------ | ---------------------------------------------------------------------- |
| `username` | Secret | Flowingly **Business Administrator** email (registry field `username`) |
| `password` | Secret | that account's password (registry field `password`)                    |

Stored per-user in the vault (a `username-password` connector — users supply their own credentials). The bearer `accessToken` is a derived, in-memory artifact obtained by the backend at call time — **not** a stored credential. No instance/base URL is stored; the host is centralised as `https://publicapi.flowingly.net/public/` (pending discovery of the brief's `api.flowingly.io`).

### Test Connection sequence

```
1. POST https://publicapi.flowingly.net/public/authorise?username={u}&password={p}
   Content-Type: application/x-www-form-urlencoded
   Expected: 200 with { accessToken, tokenType: "Bearer", ... }
   401/400: bad credentials, or account is not a Business Administrator
   [NOT live-tested — placement (query vs body) and failure status are UNKNOWN]

2. (No documented lightweight whoami/health endpoint.) The cheapest real action is to read a step on a KNOWN flow:
   GET https://publicapi.flowingly.net/public/flow/{flowIdentifier}/step/{stepName}
   Authorization: Bearer {accessToken}
   — requires a known flowIdentifier, so it is not a generic connection probe.
   A successful /authorise (step 1) is the practical "connected" signal until discovery finds a health endpoint. [INFERRED]
```

There is **no documented health/`/version`/`/me` endpoint** (unlike Fergus's `GET /version`). If discovery finds one (e.g. via a Swagger probe), prefer it for the connection test.

### Auto-Reconnect logic

```
on 401 (resource call):                                  # username-password exchange — no refresh token
  token = POST /public/authorise (stored username, password)   # re-authorise
  if authorise succeeds:
    retry the original request once with the new Bearer token
  else (authorise itself 401/400):
    mark connector "needs reauthorization"
    notify user: "Flowingly sign-in failed — check the Business Administrator username/password for the Flowingly connector"
    disable connector until valid credentials are provided

on success:false in body (HTTP 200):
  do NOT treat as success — surface errorMessage; do NOT auto-retry startflow (not idempotent)
```

### Idempotency caution

`POST /public/startflow` is **not idempotent** — each call starts a new flow instance. The "retry once" rule above is safe for GET step-fields and POST update-fields (both idempotent), but **`startflow` must not be blindly retried**. On an ambiguous `startflow` failure (e.g. network timeout after the request may have landed), confirm with the user before re-calling to avoid duplicate flows [INFERRED].

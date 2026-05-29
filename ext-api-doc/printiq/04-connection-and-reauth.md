# PrintIQ — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to PrintIQ ("IQConnect" API).
> Auth type: **username-password** — a **credential exchange** (`username` + `password` + `app_name` +
> `app_key` → session token). This is **not** OAuth 2.0 and **not** a single static PAT.
> Goal: enough detail that Numa could automate connector setup via script.
>
> ⚠️ **CONFIDENCE: LOW.** The credential _model_ (the four fields, issued by printIQ support) is confirmed
> from public material. **The token-exchange endpoint, token header name, token format, and lifetime are
> all `[INFERRED]`/`[UNKNOWN]`** — the IQConnect reference is partner-gated and was never accessed. Verify
> everything marked inferred against a live instance before trusting it.

---

## 1. Product context

|               |                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| Vendor        | printIQ — cloud print MIS / estimating & workflow software (NZ-founded, AU/global)                        |
| Product       | printIQ + the **IQConnect** API surface                                                                   |
| Website       | https://printiq.com                                                                                       |
| API marketing | https://printiq.com/iqconnect-api/ (overview only; the real reference is partner-gated)                   |
| API base URL  | **Per-tenant** — `https://{instance}.printiq.com/` (custom domains also exist). API base path `[UNKNOWN]` |
| OpenAPI spec  | None public                                                                                               |
| Dev / support | printIQ support / integrations team — provisions credentials, instance access, and webhooks               |

---

## 2. Where to get the credentials

PrintIQ is **per-tenant**: each customer has their own printIQ instance, and **printIQ does not self-service
API credentials.** Unlike a PAT you generate yourself in a settings page, all five pieces come from two
places:

1. **From printIQ support / your printIQ account manager** (NOT from a self-service UI):
   - **Username** (`username`) — an API user inside the printIQ instance
   - **Password** (`password`)
   - **Application name** (`app_name`)
   - **Application key** (`app_key`)
2. **From the customer / the printIQ instance owner:**
   - **Instance URL** — e.g. `https://myco.printiq.com` (the host the API lives on)

> **How to request them:** ask printIQ support to "issue IQConnect API credentials (username, password,
> app_name, app_key) for our integration on the customer's instance," and **also ask for the IQConnect API
> documentation pack + Postman collection** — that pack is the authoritative reference this public
> investigation could not reach. [DOCUMENTED that credentials are support-issued.]

There is **no admin OAuth-app creation step** (no client_id/secret, no redirect URI) — `authType` is
`username-password`, not `oauth2`.

---

## 3. Authentication: credential exchange → session token

PrintIQ uses a **credential-exchange** model, not a long-lived static token. You POST the four credentials
to a token endpoint on the instance and receive a session/access token, which you then send on subsequent
calls.

### 3.1 Token exchange (INFERRED — path, fields, and response shape ALL unverified)

```http
POST https://{instance}.printiq.com/api/Site/Token HTTP/1.1
Content-Type: application/json

{ "username": "apiuser", "password": "••••••••", "app_name": "MyApp", "app_key": "••••••••" }
```

Candidate paths to probe during discovery: `/api/Site/Token`, `/api/Token`, `/api/Authenticate`.

### 3.2 Token response (INFERRED)

```json
{ "token": "eyJhbGciOi...", "expires": "2026-05-29T12:00:00Z" }
```

| Property           | Value                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Token format       | `[UNKNOWN]` — likely a JWT or an opaque session token                                         |
| Token header       | `[UNKNOWN]` — `Authorization: Bearer {token}`, a custom header, or a query token all possible |
| Token lifetime     | `[UNKNOWN]` — treat as short-lived; be ready to re-mint                                       |
| Refresh mechanism  | `[INFERRED]` — **no refresh-token grant documented**; re-POST the four credentials to re-mint |
| Scopes/permissions | `[INFERRED]` — inherited from the API user's role inside the printIQ instance                 |

### 3.3 Authenticated request (INFERRED header)

```http
GET https://{instance}.printiq.com/api/Customer/CUST001 HTTP/1.1
Authorization: Bearer {token}
Content-Type:  application/json
Accept:        application/json
```

> ⚠️ **`app_name` + `app_key` belong to the token exchange, not to data requests.** Send them once to mint
> the token; do NOT append them to every API call.

---

## 4. Token refresh / rotation

| Property            | Value                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Refresh mechanism   | **None documented** — no refresh tokens. On expiry, **re-run the token exchange** (re-POST the four credentials). [INFERRED] |
| Can extend a token? | `[UNKNOWN]` — assume no                                                                                                      |
| `app_key` rotation  | Reissued by printIQ support; update the stored credential when it changes [INFERRED]                                         |
| Password rotation   | If the API user's password changes in printIQ, update the stored `password`                                                  |

Because re-minting only needs the four stored credentials (no user interaction, no redirect), refresh is
**automatic** — on a 401, the proxy re-runs the token exchange and retries. Re-consent is only needed if the
credentials themselves become invalid (password/app_key changed or revoked by printIQ support).

---

## 5. First successful call — smoke test

After obtaining the four credentials **and** the instance URL:

```
Step 1 — Token exchange (INFERRED path):
  POST https://{instance}.printiq.com/api/Site/Token
  { "username": "...", "password": "...", "app_name": "...", "app_key": "..." }
  Expected: 200 with a token + expiry. 401 → bad credentials.

Step 2 — GetPrice (DOCUMENTED hero endpoint; INFERRED path/payload):
  POST https://{instance}.printiq.com/api/Quote/GetPrice
  Authorization: Bearer {token}
  { "productCode": "BC-350GSM", "quantity": 500,
    "options": { "finish": "Matte Laminate", "sides": "Double Sided" } }
  Expected: 200 with a price. This validates auth + the product/pricing model in one call.

Step 3 — A simple read (INFERRED path):
  GET https://{instance}.printiq.com/api/Customer/{customerCode}
  Authorization: Bearer {token}
  Expected: 200 with a customer record.
```

> ⚠️ Every path above is `[INFERRED]`. If `GetPrice` 404s, the path is wrong — discover the real one from the
> IQConnect doc pack. If a known-good token 401s, the **token header name** is wrong — try a custom header or
> a query-string token. If a well-formed JSON body 400s with a parse error, the endpoint may expect **XML**.

Failure modes:

| Status | Meaning                                          | Action                                                   |
| ------ | ------------------------------------------------ | -------------------------------------------------------- |
| 401    | Credentials invalid / token expired/header wrong | Re-mint token; verify the token header name              |
| 403    | Authenticated but API user lacks permission      | Check the API user's role/permissions in printIQ         |
| 404    | Wrong path **or** wrong instance host            | Verify the endpoint AND that the instance URL is correct |
| 400    | Bad request / wrong content type                 | Fix the body; check REST-vs-XML expectation              |

---

## 6. Reauthorization triggers

| Trigger                        | Detection                  | Action                                                                 |
| ------------------------------ | -------------------------- | ---------------------------------------------------------------------- |
| Session token expired          | 401 response               | **Auto-refresh:** re-run the token exchange with stored creds, retry   |
| Token header / mechanism wrong | 401 on a fresh token       | Try alternative header (custom / query token); capture what works      |
| Credentials revoked / changed  | 401 persists after re-mint | Prompt admin to obtain new credentials from printIQ support            |
| Insufficient permissions       | 403 response               | Check the API user's role in the printIQ instance                      |
| Missing instance URL           | No host to call            | **STOP and ask** the user for their printIQ instance URL — never guess |

---

## 7. Numa connector wiring

### Credentials to store

| Key            | Type   | Description                                                                                                                                                 |
| -------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `username`     | text   | API username (from printIQ support)                                                                                                                         |
| `password`     | secret | API user password                                                                                                                                           |
| `app_name`     | text   | Application name (from printIQ support)                                                                                                                     |
| `app_key`      | secret | Application key (from printIQ support)                                                                                                                      |
| `instance_url` | url    | **GAP — not in `credentialFields` today.** Per-tenant host (e.g. `https://myco.printiq.com`). Required for the API to work; see `03-connector-setup.md` §1. |

> The first four are the actual `credentialFields` in `connectorRegistry.ts`. The **instance URL is the open
> gap** — the API cannot target a host without it. Resolve before go-live (add an `instance_url` field,
> store in connector metadata, or ask the user).

### Test connection sequence

```
1. POST {instance}/api/Site/Token  (4 credentials)        — verify credentials valid → get token
   200: token returned    401: bad credentials
2. POST {instance}/api/Quote/GetPrice  (with token)        — verify auth + product model end-to-end
   200: price returned    404: wrong path    401: token header wrong
```

(Both steps are `[INFERRED]` paths — confirm against a live instance / the IQConnect doc pack.)

### Auto-reconnect logic

```
on 401 response:
  # credential-exchange — refresh is automatic (no user interaction, no redirect)
  re-run token exchange (re-POST username/password/app_name/app_key)
  if re-mint succeeds:
    retry the original request with the new token
  if re-mint also 401s:
    mark connector "needs reauthorization"
    notify admin: "PrintIQ credentials invalid — request fresh IQConnect credentials from printIQ support"

on 403 response:
  notify admin: "PrintIQ API user lacks permission — check the API user's role in printIQ"

on missing instance URL:
  STOP — ask the user for their printIQ instance URL; do not guess a hostname
```

---

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

---

_Auth type: `username-password` (credential exchange). Web research only; partner-gated docs; no live call._
_See `02-api-spec-investigation.md` for the full API reference and `03-connector-setup.md` for the registry
entry and deployment._

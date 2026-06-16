---
api_name: Claris FileMaker Data API
api_slug: filemaker
auth_type: username-password → short-lived session Bearer token (NOT OAuth, NOT static API key, NOT a PAT)
base_url: https://{server_url}/fmi/data/vLatest/databases/{database}
path_version_segment: vLatest (real path segment, in the URL — not a label)
call_surface: Direct API via connect_request proxy (token minted on demand by the proxy, never persisted)
scope: connection setup + reauthorization. Per-tenant — every customer hosts their own FileMaker Server (on-prem) or FileMaker Cloud, addressed by their own server_url. No central API, no Claris sandbox.
---

# Claris FileMaker — Connection & Reauthorization Guide

Auth: **username-password → short-lived session token**. The credentials are the _input to a login round-trip_; the bearer token they produce expires ~15 min after the last call. You send the account **username + password** as HTTP Basic auth to a login endpoint, receive a **session token**, and use it as `Authorization: Bearer {token}` for ~15 min of activity; on expiry, log in again with the same username/password. The connector stores the **username + password** (not a token); the token is minted on demand by the `connect_request` proxy and never persisted.

|                      |                                                                                  |
| -------------------- | -------------------------------------------------------------------------------- |
| What Numa stores     | `server_url`, `username`, `password`, `database` (password = the vaulted secret) |
| What the proxy mints | a session token, on demand, per the 15-min sliding window                        |
| OAuth?               | No                                                                               |
| Refresh token?       | No — re-login (`POST /sessions`) is the only "refresh"                           |

## 1. Where to get the credentials

**Nothing to create in a vendor developer portal** — FileMaker has no app registration, no client ID/secret, no PAT issuance. The four values come from the customer's own FileMaker Server / Cloud deployment and an account on it.

**1.1 `server_url`** — the HTTPS host of the customer's FileMaker Server / Cloud, e.g. Cloud `https://myserver.fmi.filemaker-cloud.com`, on-prem `https://fms.example.com`. Must be **HTTPS with a valid SSL certificate** — the Data API rejects plain HTTP and self-signed certs (unless trusted). Registry `server_url` field (`type:'url'`, placeholder `https://myserver.fmi.filemaker-cloud.com`). Do **not** include the `/fmi/data/...` path — the proxy appends `/fmi/data/vLatest/databases/{database}`.

**1.2 `database`** — the hosted `.fmp12` solution name (e.g. `Inventory`, `MyDatabase`). Visible in the FileMaker Server Admin Console under hosted databases. **Case-sensitive on some platforms** — use it exactly. Registry `database` field (placeholder `MyDatabase`, `helpText:'dataConnectors.fields.databaseHint'`).

**1.3 `username` + `password`** — a FileMaker **account** defined inside that database (FileMaker Pro → File → Manage → Security), e.g. `admin` / its password. Two server-side prerequisites must hold or login fails:

1. **Data API enabled** on the server (Admin Console → Connectors → FileMaker Data API → ON; on FileMaker Cloud it is on by default).
2. The account's **privilege set has the `fmrest` extended privilege**. Without it, login errors even with correct credentials. Data access (which layouts/records/scripts) is exactly what that privilege set grants — scope to least privilege.
   > The connector inherits the account's privilege set. There are no API scopes — permissions are set in FileMaker, not Numa.

## 2. Authentication flow (session/token exchange)

**2.1 Log in — Basic credentials → token:**

```http
POST /fmi/data/vLatest/databases/{database}/sessions HTTP/1.1
Host: {server_url}
Authorization: Basic {base64(username:password)}
Content-Type: application/json
{}
```

Response (HTTP 200) — token in the body **and** echoed in the `X-FM-Data-Access-Token` header:
`{"response":{"token":"c4d2e429122e9cdeda19bb23c55cd2a8f282c3cc50c60943a110"},"messages":[{"code":"0","message":"OK"}]}`

**2.2 Use the token — Bearer on every subsequent call:**

```http
GET /fmi/data/vLatest/databases/{database}/layouts HTTP/1.1
Host: {server_url}
Authorization: Bearer c4d2e429122e9cdeda19bb23c55cd2a8f282c3cc50c60943a110
```

> The Data API session token uses **`Authorization: Bearer {token}`**. (`Authorization: FMID {token}` is a _different_ flow — Claris-ID tokens on FileMaker Cloud — **not** what this connector uses.)

**2.3 Log out — free the session slot:**
`DELETE /fmi/data/vLatest/databases/{database}/sessions/{token}` → `{"response":{},"messages":[{"code":"0","message":"OK"}]}`
FileMaker Server allows a finite number of concurrent Data API sessions — log out when finished with a burst of work (or let idle expiry reclaim the slot).

## 3. Token lifetime, expiry & "refresh"

| Property          | Value                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Token format      | opaque session token (not a JWT)                                                                                                                                                                                         |
| Lifetime          | valid until logout **or 15 minutes after the last call that used it** — sliding idle timeout                                                                                                                             |
| Idle reset        | every authenticated call resets the 15-min clock. **The `validateSession` probe does NOT extend it** — only a _real_ call does                                                                                           |
| Refresh mechanism | **None.** No refresh token, no extension endpoint                                                                                                                                                                        |
| How to "refresh"  | re-run `POST /sessions` with the same Basic credentials to mint a fresh token                                                                                                                                            |
| Expiry signal     | the next call after expiry returns FileMaker error code **`952`** (invalid Data API token) in `messages[].code` (usually HTTP 401/500 — but key off `messages`, not the HTTP status)                                     |
| Recovery          | on `952`: re-login and **retry the failed call once**                                                                                                                                                                    |
| Scarce resource   | concurrent session slots (configurable server cap). Reuse one token within its window; log out promptly. There is **no `429`** — the realistic load failure is session exhaustion, surfaced when a new login is rejected |

> **Strategy Numa uses:** the `connect_request` proxy logs in lazily on the first call of a task, caches the token for its 15-min window, sends `Bearer {token}` on subsequent calls, and re-logs-in transparently on `952`. The agent never handles the raw token.

## 4. Reauthorization triggers

| Trigger                       | Detection                                                                       | Action                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Token expired (idle > 15 min) | FileMaker code `952` in `messages[].code`                                       | re-login (`POST /sessions`) + retry the call once — automatic, no user prompt          |
| Bad credentials               | **HTTP `401`** on `POST /sessions` (true HTTP 401, distinct from FM code `401`) | prompt the user to fix `username`/`password` (or the `fmrest` privilege)               |
| Data API disabled / wrong DB  | FileMaker code `802` ("Unable to open the file"), or HTTP `403`/`404`           | check `server_url`, `database` name/case, and that the Data API is enabled             |
| `fmrest` privilege missing    | login fails for valid-looking credentials                                       | enable the `fmrest` extended privilege on the account's privilege set in FileMaker Pro |
| Per-license cap / feature off | FileMaker code `953`                                                            | Data API limit reached or disabled — server/licensing issue, notify admin              |
| Session exhaustion under load | new login rejected (no slots)                                                   | reuse one token, log out promptly; reduce concurrency                                  |
| Empty find (NOT a re-auth!)   | FileMaker code `401` in `messages[].code`                                       | means "no records matched" — report as empty result, do **not** re-auth                |

> **Two different "401"s.** True **HTTP `401`** at login = bad Basic credentials → prompt the user. FileMaker **`code: "401"`** in `messages` = a find returned no records → an empty result, not an auth problem. Do not conflate them.

## Numa Connector Wiring

**Credentials to store** (map 1:1 to the registry `credentialFields` in `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` — see `03-connector-setup.md`; the token is **not** stored, minted on demand by the proxy):
| Key | Type | Description |
| --- | --- | --- |
| `server_url` | URL | FileMaker Server / Cloud host, e.g. `https://myserver.fmi.filemaker-cloud.com` (no `/fmi/data` path) |
| `username` | string | FileMaker account name (must hold the `fmrest` extended privilege) |
| `password` | secret | FileMaker account password — the vaulted secret |
| `database` | string | hosted `.fmp12` solution name, e.g. `MyDatabase` (case-sensitive on some platforms) |

**Test connection sequence:**

```
1. POST https://{server_url}/fmi/data/vLatest/databases/{database}/sessions
   Authorization: Basic base64(username:password) ; Content-Type: application/json ; Body: {}
   → 200 + response.token + messages[0].code == "0"   ✅ credentials valid, DB reachable, Data API on
   → HTTP 401                                          ❌ bad username/password (or fmrest privilege off)
   → FM code 802 / HTTP 404                            ❌ wrong database name, or Data API disabled
   → TLS error                                         ❌ bad/self-signed cert or wrong server_url
2. GET https://{server_url}/fmi/data/vLatest/databases/{database}/layouts   Authorization: Bearer {token}
   → 200 + response.layouts[]                          ✅ token works; structure discoverable
3. (cleanup) DELETE .../sessions/{token}               frees the session slot
```

> Use step 2 (authenticated `GET /layouts`) as the real validity check — step 1 proves the credentials log in, step 2 proves the token is usable and the account can actually read.

**Auto-reconnect logic:**

```
on FileMaker error code "952" (invalid token):
  re-login: POST /sessions (Basic username:password); retry the failed call once with the new Bearer token
  if re-login itself returns HTTP 401:
    notify user: "FileMaker credentials rejected — check username/password / fmrest privilege"; disable connector until updated
on HTTP 200 with messages[0].code != "0":
  treat as a LOGICAL error (read the code) — do NOT treat as success
on FileMaker error code "401" in a find response:
  treat as an empty result set — NOT an auth failure, do NOT re-login
```

**Reference URLs:**
| Resource | URL |
| --- | --- |
| Data API Guide (home) | https://help.claris.com/en/data-api-guide/content/index.html |
| Log in to a database session | https://help.claris.com/en/data-api-guide/content/log-in-database-session.html |
| Log out of a database session | https://help.claris.com/en/data-api-guide/content/log-out-database-session.html |
| Write Data API calls (URLs/headers) | https://help.claris.com/en/data-api-guide/content/write-data-api-calls.html |
| Working around Data API authorization timeouts (15-min idle) | https://support.claris.com/s/article/Working-around-FileMaker-Data-API-authorization-timeouts |
| Live per-server OpenAPI UI | `https://{server_url}/fmi/data/apidoc/` (renders the spec for that exact server version) |

> No Claris developer portal, no sandbox, no app registration. Setup is entirely server-side: enable the Data API, grant the `fmrest` privilege, ensure a valid SSL cert, then plug the four values into the connector.

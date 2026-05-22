# 12d Synergy — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to 12d Synergy.
> Auth type: **PAT** (Personal Access Token). No OAuth.

---

## Auth Type: PAT (Personal Access Token)

12d Synergy uses Personal Access Tokens exclusively. There is no OAuth flow. PATs can be created programmatically via the API.

---

## 1. Generate a PAT

### Option A: Via API (Preferred — Automatable)

```http
POST /api/v1/auth/generate-pat HTTP/1.1
Host: {instance}
Authorization: Bearer {existing_PAT_or_session}
Content-Type: application/json

{
  "ClientId": "numa-integration",
  "Name": "Numa Connector",
  "ExpireInDays": 90
}
```

| Field          | Type   | Description                                    |
| -------------- | ------ | ---------------------------------------------- |
| `ClientId`     | string | Identifier for the client application          |
| `Name`         | string | Human-readable token name                      |
| `ExpireInDays` | int    | Token lifetime in days (Numa uses 90, max 180) |

### Option B: Via Swagger UI

1. Go to `https://{instance}/api-docs/ui/index`
2. Navigate to the **Authorisation** section
3. Find `POST /api/v1/auth/generate-pat`
4. Execute with the JSON body above
5. Copy the returned token immediately

### Option C: Via 12d Synergy Web UI

1. Log in to `https://{instance}`
2. Navigate to User Settings > API Access (exact path may vary by version)
3. Create new Personal Access Token
4. Set expiry (Numa uses 90 days, max 180)
5. Copy the token immediately — shown only once

---

## 2. Token Format

| Property           | Value                                         |
| ------------------ | --------------------------------------------- |
| Header             | `Authorization: Bearer {PAT}`                 |
| Token format       | Opaque string                                 |
| Max lifetime       | **90 days** from creation (Synergy max: 180)  |
| Scopes/permissions | Inherited from the user's role in 12d Synergy |

---

## 3. Token Refresh / Rotation

| Property           | Value                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Refresh mechanism  | **None** — no refresh tokens, no extension                                 |
| Can extend expiry? | No                                                                         |
| Rotation strategy  | Create new PAT via `POST /api/v1/auth/generate-pat` before old one expires |

### Automated Rotation (Implemented)

Numa automates PAT rotation with two mechanisms:

**Lazy rotation (on API use):** Every Synergy API call checks the PAT
expiry. If within 30 days of expiry, a new PAT is generated automatically
before the request proceeds. The old token is archived in `pat_history`.

**Manual rotation (API endpoint):** Admins can trigger immediate rotation
via `POST /api/data-connectors/synergy/rotate-pat`.

**PAT status endpoint:** `GET /api/data-connectors/synergy/pat-status`
returns expiry info, days remaining, status level, and rotation history.

```
Flow:
1. PAT created with 90-day TTL, pat_created_at/pat_expires_at tracked
2. On each API call, if days_remaining <= 30:
   POST /api/v1/auth/generate-pat → new 90-day PAT
3. Old token info archived in pat_history (capped at 50 entries)
4. New PAT + expiry stored in Secrets Manager + DynamoDB
5. Old PAT continues working until its original expiry
```

### Status Levels & Frontend Indicators

| Days remaining | Status     | UI indicator                         |
| -------------- | ---------- | ------------------------------------ |
| > 30 days      | `healthy`  | Green shield — token valid           |
| 8–30 days      | `warning`  | Yellow shield + manual rotate button |
| 1–7 days       | `critical` | Red shield + manual rotate button    |
| 0 days         | `expired`  | Red shield — connector stops working |

---

## 4. Programmatic PAT Management

```http
# List PATs for current user
GET /api/v1/auth/getPersonalAccessTokens
Authorization: Bearer {PAT}
# → returns 200 with PAT list; 401 unauthenticated [VERIFIED 2026-05-19 via live probe]

# Create new PAT
POST /api/v1/auth/generate-pat
Authorization: Bearer {PAT}
Content-Type: application/json
# Body fields unverified — confirm against {instanceUrl}/swagger before relying on field names

# Revoke PAT
POST /api/v1/auth/delete-pat
Authorization: Bearer {PAT}
Content-Type: application/json
# → requires body; verb is POST not DELETE [VERIFIED 2026-05-19 via live probe — endpoint returns 411 Length Required when called without body]
```

> **Corrected 2026-05-19:** the prior version listed `GET /api/v1/auth/tokens` and `DELETE /api/v1/auth/tokens/{id}` — both return **404** against a live 12d Synergy instance. They were fabricated. The real endpoints are `getPersonalAccessTokens` (GET, returns 401 unauth = exists) and `delete-pat` (POST, returns 411 = exists, wants body).

---

## 5. Reauthorization Triggers

| Trigger                  | Detection                              | Action                                                |
| ------------------------ | -------------------------------------- | ----------------------------------------------------- |
| PAT expired              | 401 response on any authenticated call | Auto-rotate if possible, else prompt admin            |
| PAT revoked              | 401 response + health check passes     | Prompt admin to generate new PAT                      |
| Insufficient permissions | 403 response                           | User's role in 12d Synergy lacks required permissions |
| Server unreachable       | `GET /health` fails                    | Check instance URL, network — not an auth issue       |

### Detection Flow

```
on API error:
  if status == 401:
    health = GET /health  (no auth needed)
    if health == 200:
      # Server up, token is the problem
      try auto-rotate:
        POST /api/v1/auth/generate-pat (using a backup admin PAT if available)
      if auto-rotate fails:
        notify admin: "12d Synergy PAT expired — generate new token"
        disable connector
    else:
      # Server is down — retry with backoff
  if status == 403:
    log endpoint and response
    notify admin: "Insufficient permissions in 12d Synergy"
```

---

## Numa Connector Wiring

### Credentials to Store

| Key           | Type   | Description                                                        |
| ------------- | ------ | ------------------------------------------------------------------ |
| `instanceUrl` | URL    | Client's 12d Synergy instance (e.g. `https://acme.12dsynergy.com`) |
| `accessToken` | Secret | Personal Access Token (Bearer token)                               |

### Test Connection Sequence

```
1. GET {instanceUrl}/health (no auth) — verify server reachable
   Expected: 200
   Failure: wrong URL or server down

2. GET {instanceUrl}/api/v1/auth/getPersonalAccessTokens (with Bearer token) — verify PAT valid
   Expected: 200 with a list of PAT entries
   401: PAT invalid or expired
   403: PAT user lacks API permissions
```

### Reference URLs

| Resource              | URL                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Swagger UI            | `{instanceUrl}/swagger` (verified 200 against live demo 2026-05-19; the prior `/api-docs/ui/index` path returns 404 on the public demo) |
| Swagger JSON          | `{instanceUrl}/api-docs/api/v1` (only reachable from inside an authenticated session; public demo returns 404)                          |
| Public demo Swagger   | `https://synergy.12dsynergycloud.com/swagger` (200)                                                                                     |
| API examples download | `https://www.12dsynergy.com/downloads/5.1/api/SynergyWebAPI_Examples.zip`                                                               |

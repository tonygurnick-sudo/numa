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
  "ExpireInDays": 180
}
```

| Field          | Type   | Description                           |
| -------------- | ------ | ------------------------------------- |
| `ClientId`     | string | Identifier for the client application |
| `Name`         | string | Human-readable token name             |
| `ExpireInDays` | int    | Token lifetime in days (max 180)      |

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
4. Set expiry (max 180 days)
5. Copy the token immediately — shown only once

---

## 2. Token Format

| Property           | Value                                         |
| ------------------ | --------------------------------------------- |
| Header             | `Authorization: Bearer {PAT}`                 |
| Token format       | Opaque string                                 |
| Max lifetime       | **180 days** from creation                    |
| Scopes/permissions | Inherited from the user's role in 12d Synergy |

---

## 3. Token Refresh / Rotation

| Property           | Value                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Refresh mechanism  | **None** — no refresh tokens, no extension                                 |
| Can extend expiry? | No                                                                         |
| Rotation strategy  | Create new PAT via `POST /api/v1/auth/generate-pat` before old one expires |

### Automated Rotation (Recommended)

Since PAT creation is an API call, Numa can automate rotation:

```
1. Track PAT creation date
2. At 150 days (30 before expiry):
   POST /api/v1/auth/generate-pat with new Name
3. Store new PAT in connector config
4. Old PAT continues working until its expiry
5. Optionally revoke old PAT via DELETE /api/v1/auth/tokens/{id}
```

### Proactive Warning Timeline

| Days before expiry | Action                                 |
| ------------------ | -------------------------------------- |
| 30 days            | Display warning in Numa admin settings |
| 14 days            | Email notification to admin            |
| 7 days             | Urgent warning banner                  |
| 0 days             | Token expires, connector stops working |

---

## 4. Programmatic PAT Management

```http
# List PATs for current user
GET /api/v1/auth/tokens
Authorization: Bearer {PAT}

# Create new PAT
POST /api/v1/auth/generate-pat
Authorization: Bearer {PAT}
Content-Type: application/json
{"ClientId": "numa", "Name": "Numa Connector", "ExpireInDays": 180}

# Revoke PAT
DELETE /api/v1/auth/tokens/{id}
Authorization: Bearer {PAT}
```

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

2. GET {instanceUrl}/api/v1/attributes/1/1 (with Bearer token) — verify PAT valid
   Expected: 200 with PagedResultModel response
   401: PAT invalid or expired
   403: PAT user lacks API permissions
```

### Reference URLs

| Resource              | URL                                                                       |
| --------------------- | ------------------------------------------------------------------------- |
| Swagger UI            | `{instanceUrl}/api-docs/ui/index`                                         |
| Swagger JSON          | `{instanceUrl}/api-docs/api/v1`                                           |
| Public demo spec      | `https://synergy.12dsynergycloud.com/api-docs/ui/index`                   |
| API examples download | `https://www.12dsynergy.com/downloads/5.1/api/SynergyWebAPI_Examples.zip` |

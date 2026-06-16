---
api_name: 12d Synergy
api_slug: synergy
doc: connection & reauthorization — Numa connector wiring
auth: PAT (Personal Access Token). NO OAuth, no refresh tokens. PATs can be created programmatically (requires an existing PAT).
ttl: Numa creates PATs with a 90-day TTL; Synergy hard max is 180 days. No extension/refresh — rotate by generating a new PAT.
path_version_segment: /api/v1 except GET /health (no prefix) and POST /api/Tasks (no /v1/).
swagger_ui: {instance}/swagger (the prior /api-docs/ui/index returns 404 on the live demo). Spec JSON {instance}/api-docs/api/v1 (only inside an authed browser session; 404 from outside).
confidence: verified against live demo 2026-05-19 where tagged; PAT body field names [INFERRED] — confirm against {instance}/swagger.
links: demo swagger https://synergy.12dsynergycloud.com/swagger · demo health https://synergy.12dsynergycloud.com/health · examples zip https://www.12dsynergy.com/downloads/5.1/api/SynergyWebAPI_Examples.zip
---

# 12d Synergy — Connection & Reauthorization

## Generate a PAT

Option A — via API (preferred, automatable; requires an existing PAT or session):

```http
POST /api/v1/auth/generate-pat HTTP/1.1
Host: {instance}
Authorization: Bearer {existing_PAT_or_session}
Content-Type: application/json
{"ClientId":"numa-integration","Name":"Numa Connector","ExpireInDays":90}
```

| Field          | Type   | Description                              |
| -------------- | ------ | ---------------------------------------- |
| `ClientId`     | string | identifier for the client application    |
| `Name`         | string | human-readable token name                |
| `ExpireInDays` | int    | lifetime in days (Numa uses 90, max 180) |

Option B — via Swagger UI: go to `https://{instance}/swagger`, find `POST /api/v1/auth/generate-pat` (Authorisation section), execute with the body above, copy the returned token immediately.

Option C — via Synergy Web UI: log in to `https://{instance}` → My Profile → Personal Access Tokens → Generate → set Client ID, Name, expiry (Numa uses 90 days, max 180) → copy the token immediately (shown only once). (Path is My Profile → Personal Access Tokens, NOT "User Settings → API Access".)

## Token format

| Property           | Value                                         |
| ------------------ | --------------------------------------------- |
| Header             | `Authorization: Bearer {PAT}`                 |
| Token format       | opaque string                                 |
| Numa TTL           | 90 days from creation                         |
| Synergy max        | 180 days                                      |
| Scopes/permissions | inherited from the user's role in 12d Synergy |

## Refresh / rotation

No refresh mechanism, no extension. Rotate by creating a new PAT via `POST /api/v1/auth/generate-pat` before the old one expires.

Automated rotation (implemented in Numa):

- Lazy (on API use): every Synergy call checks PAT expiry; if within 30 days, a new 90-day PAT is generated before the request proceeds; the old token is archived in `pat_history` (capped at 50 entries) and continues working until its original expiry.
- Manual: `POST /api/data-connectors/synergy/rotate-pat` triggers immediate rotation.
- Status: `GET /api/data-connectors/synergy/pat-status` returns expiry info, days remaining, status level, rotation history.

Flow: PAT created with 90-day TTL (track `pat_created_at`/`pat_expires_at`) → on each call, if `days_remaining<=30` generate a new 90-day PAT → archive old token in `pat_history` → store new PAT + expiry in Secrets Manager + DynamoDB → old PAT works until original expiry.

Status levels / UI: `>30d` healthy (green shield) · `8–30d` warning (yellow + manual rotate) · `1–7d` critical (red + manual rotate) · `0d` expired (red — connector stops).

## Programmatic PAT management

```http
GET  /api/v1/auth/getPersonalAccessTokens   # list PATs for current user; 200 + list, 401 unauth [VERIFIED 2026-05-19 live probe]
Authorization: Bearer {PAT}

POST /api/v1/auth/generate-pat               # create; body fields unverified — confirm against {instance}/swagger
Authorization: Bearer {PAT}
Content-Type: application/json

POST /api/v1/auth/delete-pat                 # revoke; verb is POST not DELETE; requires body [VERIFIED 2026-05-19 — returns 411 Length Required without body]
Authorization: Bearer {PAT}
Content-Type: application/json
```

Corrected 2026-05-19: prior version listed `GET /api/v1/auth/tokens` and `DELETE /api/v1/auth/tokens/{id}` — both 404 against a live instance (fabricated). Real endpoints: `getPersonalAccessTokens` (GET, 401 unauth = exists) and `delete-pat` (POST, 411 = exists, wants body).

## Reauthorization triggers

| Trigger                  | Detection                 | Action                                           |
| ------------------------ | ------------------------- | ------------------------------------------------ |
| PAT expired              | 401 on any authed call    | auto-rotate if possible, else prompt admin       |
| PAT revoked              | 401 + health check passes | prompt admin to generate new PAT                 |
| Insufficient permissions | 403                       | user's Synergy role lacks required permissions   |
| Server unreachable       | `GET /health` fails       | check instance URL / network — not an auth issue |

Detection flow:

```
on API error:
  if 401:
    if GET /health == 200:                      # server up, token is the problem
      try auto-rotate: POST /api/v1/auth/generate-pat (use a backup admin PAT if available)
      on failure: notify admin "12d Synergy PAT expired — generate new token"; disable connector
    else: server down — retry with backoff
  if 403:
    log endpoint + response; notify admin "Insufficient permissions in 12d Synergy"
```

## Numa connector wiring

Credentials to store:
| Key | Type | Description |
| --- | --- | --- |
| `instanceUrl` | URL | client's instance (e.g. `https://acme.12dsynergy.com`) |
| `accessToken` | Secret | PAT (Bearer token) |

Test-connection sequence:

```
GET {instanceUrl}/health                                  # no auth — verify reachable; 200 ok, else wrong URL / server down
GET {instanceUrl}/api/v1/auth/getPersonalAccessTokens     # with Bearer — verify PAT; 200 + PAT list ok, 401 invalid/expired, 403 lacks API permissions
```

Reference URLs:
| Resource | URL |
| --- | --- |
| Swagger UI | `{instanceUrl}/swagger` (✅ 200 live demo 2026-05-19; prior `/api-docs/ui/index` 404s) |
| Swagger JSON | `{instanceUrl}/api-docs/api/v1` (only inside an authed session; demo 404 from outside) |
| Public demo Swagger | https://synergy.12dsynergycloud.com/swagger |
| API examples zip | https://www.12dsynergy.com/downloads/5.1/api/SynergyWebAPI_Examples.zip |

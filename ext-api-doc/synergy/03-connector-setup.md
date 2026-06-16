---
api_name: 12d Synergy
api_slug: synergy
doc: connector setup — obtaining credentials + first successful call (pure 12d-side; no Numa wiring)
vendor: 12d Solutions Pty Ltd (Australia). Product: 12d Synergy — construction/civil-engineering project collaboration.
deployment: per-instance. Each customer hosts (or 12d hosts) their own server; URLs are scoped to the instance hostname; no central API. The instance URL is part of every API call, Swagger URL, and PAT — you cannot bootstrap a connector without it.
base_url: https://{instance}/api/v1/
auth: Bearer {PAT}. PAT-only — NO OAuth, no refresh-token, no API-key issuance outside the PAT flow.
path_version_segment: /api/v1 on all endpoints EXCEPT two — GET /health (no prefix) and POST /api/Tasks (no /v1/).
swagger_ui: {instance}/swagger (NOT /api-docs/ui/index — 404s). Spec JSON: {instance}/api-docs/api/v1 (reachable only inside an authed browser session; 404 from outside).
rate_limit: not publicly documented. Be conservative.
errors: many endpoints return plain-text error strings, not JSON. Treat error bodies as opaque text; key off HTTP status.
confidence: facts verified against the public demo synergy.12dsynergycloud.com 2026-05-19 unless tagged [INFERRED].
links: vendor https://www.12dsynergy.com · help https://help.12dsynergy.com · demo https://synergy.12dsynergycloud.com · examples zip https://www.12dsynergy.com/downloads/5.1/api/SynergyWebAPI_Examples.zip
---

# 12d Synergy — Connector Setup

## Prerequisites

- A live 12d Synergy instance reachable on HTTPS.
- System setting "Creation and Authentication of Personal Access Tokens" enabled by a Synergy administrator (System Settings). PATs do not work until this is on.
- A user account with API-level permissions for the target data. A PAT inherits that user's role and permissions.

## Authentication — PAT (only)

PAT bearer auth only. No OAuth, no refresh, no API-key issuance outside the PAT flow.

Generate a PAT in the Synergy UI [VERIFIED — help.12dsynergy.com v5profile doc]:

1. Sign in to the instance.
2. Open My Profile → Personal Access Tokens (NOT "User Settings → API Access" — that path was an earlier-doc error; verified against [help.12dsynergy.com/docs/v5profile](https://help.12dsynergy.com/docs/v5profile) and [.../synergyclientgenerateapersonalaccesstokenpatinsynergyclientdoc](https://help.12dsynergy.com/docs/synergyclientgenerateapersonalaccesstokenpatinsynergyclientdoc)).
3. Click Generate / New.
4. Fill: Client ID (free-text, e.g. `numa-integration`), Name/description, Expire in days (max 180).
5. Save. The PAT is shown once — capture it immediately.

PAT lifecycle: max lifetime 180 days from creation; no refresh flow (generate a new PAT before expiry); user gets an email 1 week before expiry and another at expiry; revoke via `POST /api/v1/auth/delete-pat` (requires body) or the My Profile UI. The first PAT must be created interactively in the UI — there is no bootstrapping endpoint.

Programmatic PAT management (requires an existing PAT):

```http
GET  https://{instance}/api/v1/auth/getPersonalAccessTokens   # list your PATs
Authorization: Bearer {EXISTING_PAT}

POST https://{instance}/api/v1/auth/delete-pat                 # revoke; requires body
Authorization: Bearer {EXISTING_PAT}
Content-Type: application/json
# Body shape unverified — confirm against {instance}/swagger before relying on field names
```

⚠️ Corrected 2026-05-19: prior docs listed `GET /api/v1/auth/tokens` and `DELETE /api/v1/auth/tokens/{id}` — both 404 on the live demo (fabricated). Real endpoints: `/auth/getPersonalAccessTokens` (GET; 401 unauth = exists) and `/auth/delete-pat` (POST; 411 Length Required when called without body = exists, wants body). Verified by live probe against synergy.12dsynergycloud.com.

## Base URL & headers

```
Base URL:       https://{instance}/api/v1/
Authorization:  Bearer {PAT}
Content-Type:   application/json     ← POST/PUT only
Accept:         application/json
```

⚠️ Path-versioning quirks — two paths skip `/api/v1/`:

- `GET /health` — no version prefix → `{"status":"Healthy"}`. [VERIFIED 2026-05-19]
- `POST /api/Tasks` — task create/update uses `/api/Tasks` (no `/v1/`). [Reported in 02-api-spec-investigation.md; not independently verifiable from public docs]

## First successful call — smoke test

```http
GET https://{instance}/health                                  # server reachable (no auth)
→ 200 {"status":"Healthy"}

GET https://{instance}/api/v1/auth/getPersonalAccessTokens     # PAT valid
Authorization: Bearer {PAT}
→ 200 with a list of PATs   | 401 PAT invalid/expired | 403 PAT user lacks API permissions
```

⚠️ Do NOT use `/health` as an auth check — it needs no auth, so a 200 proves nothing about token validity.

## Swagger / reference

|              | URL                                | Verified                                                                      |
| ------------ | ---------------------------------- | ----------------------------------------------------------------------------- |
| Swagger UI   | https://{instance}/swagger         | ✅ 200 on the demo 2026-05-19 (prior `/api-docs/ui/index` 404s)               |
| Swagger JSON | https://{instance}/api-docs/api/v1 | reachable only inside an authed browser session; 404 from outside on the demo |

The spec dump in 02-api-spec-investigation.md reports 359 paths / 369 operations. The "369 endpoints / 274 models" headline in older drafts conflated operations with endpoints; the model count is not independently verifiable — treat counts as [INFERRED].

## Known integration constraints

1. Per-instance — every customer URL is different; cannot bootstrap without the instance URL.
2. PAT is the only auth — no OAuth, no API-key issuance, no service accounts; the first PAT is created by a human in the UI.
3. No refresh — PATs expire at most 180 days from creation; user generates a replacement before expiry.
4. Composite IDs + mixed casing — path params mix Pascal- and snake-case across endpoints; the Swagger is authoritative — don't infer paths from naming conventions.
5. No webhooks — polling is the only change-detection option.
6. Path quirks — `/health` and `/api/Tasks` skip the `/api/v1/` prefix; everything else uses it.
7. Rate limits not published; error bodies are often plain text, not JSON.

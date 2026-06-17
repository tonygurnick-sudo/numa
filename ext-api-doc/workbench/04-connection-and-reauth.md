---
api_name: Workbench International (ERP)
api_slug: workbench
doc: connection & reauthorization guide
auth: token (static, pre-issued bearer) + per-customer instance_url. NO OAuth, NO refresh.
header: Authorization Bearer {bearer_token} [INFERRED 🔬 — verify; fallback X-Api-Key/apikey]
route_prefix: discover from Swagger base path (likely /api or /api/v1) — [INFERRED] 🔬; /api/v1 below is a placeholder
call_surface: HTTP via `numa integrations request`. Not a Files connector.
confidence: connector can authenticate from the two stored fields, but the token-issuance UI, auth header name, and token lifetime are NOT publicly documented — confirm against a live tenant (🔬). Per-instance: every customer hosts their own Workbench server, so the instance hostname is part of every API call and Swagger URL.
---

# Workbench International — Connection & Reauthorization Guide

Auth type: **token** (static, pre-issued bearer token) + per-customer `instance_url`. **No OAuth, no refresh.** The "OAuth 2.0" section of the connection template is intentionally omitted — it does not apply. The admin/user generates a token inside their Workbench instance, then pastes it + the instance URL into Numa.

| Vendor / product context |                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------- |
| Vendor                   | Workbench International Limited (NZ/APAC)                                               |
| Product                  | Workbench — job-costing / construction-management ERP                                   |
| Website                  | https://www.workbenchcentral.com                                                        |
| Technology page          | https://www.workbenchcentral.com/technology (JSON REST API + Swagger)                   |
| API docs (Confluence)    | https://webwbdoc.atlassian.net/wiki/spaces/WAPI (renders client-side)                   |
| Support portal           | https://wbi.freshdesk.com/support/login                                                 |
| Per-customer instance    | `https://{customer-instance-hostname}` (e.g. `https://yourcompany.workbench.com`)       |
| Per-instance Swagger     | `{instance_url}/swagger` (UI) · `{instance_url}/swagger/v1/swagger.json` (raw, path 🔬) |
| Registry entry           | `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id: 'workbench'`)  |

## 1. Generate the API token in Workbench

⚠️ **`[UNKNOWN]` 🔬 — the exact issuance UI is not publicly documented.** Steps below are the `[INFERRED]` flow from ERP convention + Workbench's statement that the API "retains the business rules and validations of the Workbench application" (so the token inherits the issuing user's role). Confirm against a live tenant or Workbench support.

Likely flow (verify on the customer's instance):

1. Sign in to `https://{instance}` as an admin / API-capable user.
2. Open the token issuance area — likely **My Profile / User Settings → API Access / Personal Access Tokens**, or **Admin → API / Integrations** (exact menu path 🔬).
3. Generate a token (name it `Numa Integration`).
4. **Copy the token immediately** — assume it is shown only once.
5. Note whether an **expiry** is set (Workbench's is `[UNKNOWN]` 🔬).

Alternative: the token may be **issued by Workbench support / the hosting team** rather than self-served. If there's no token UI on the instance, raise a Workbench support ticket (Freshdesk) to have one issued for the integration user. 🔬

## 2. Token Format

| Property           | Value                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Header             | `Authorization: Bearer {bearer_token}` — **assumed `[INFERRED]`; verify header name** 🔬 |
| Alternate header   | Some ERPs use `X-Api-Key: {token}` or `apikey: {token}` — try if `Bearer` returns 401 🔬 |
| Token format       | Opaque string (likely) — JWT vs opaque `[UNKNOWN]` 🔬                                    |
| Max lifetime       | `[UNKNOWN]` 🔬 — static (no refresh field) or expiring                                   |
| Scopes/permissions | Inherited from the issuing user's Workbench role, not OAuth scopes `[INFERRED]` 🔬       |
| Base URL           | per-customer `instance_url`; path prefix `/api` or `/api/v1` — confirm from Swagger 🔬   |

Request shape (assumed — replace the path from the instance Swagger): `GET {instance_url}/api/v1/jobs?pageSize=1` with `Authorization: Bearer {bearer_token}` + `Accept: application/json`.

## 3. Token Refresh / Rotation

| Property           | Value                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Refresh mechanism  | **None** in the connector — no refresh token field. Treat the token as **static**.          |
| Can extend expiry? | `[UNKNOWN]` 🔬 — depends on whether tokens expire at all                                    |
| Rotation strategy  | **Manual** — on 401, the user re-issues a new token in Workbench and re-pastes it into Numa |

**No automated rotation** (unlike the 12d Synergy connector, which has a programmatic `generate-pat` endpoint and lazy rotation). Workbench publishes **no token-mgmt API**, so rotation is human-driven: track the token creation date if an expiry is known; on a `401`, prompt the user to generate a new token and update the connector; the old token cannot be recovered.

> **🔬 DISCOVER:** whether Workbench tokens expire at all, any max lifetime, and whether the instance exposes a programmatic token list/create/revoke endpoint. If one exists in the instance Swagger, this section can be upgraded to a Synergy-style automated rotation flow.

## 4. Programmatic Token Management (if available)

No token-management API is documented publicly for Workbench `[UNKNOWN]` 🔬. If the instance Swagger exposes one (e.g. under an `/auth` or `/admin` tag), record: List `GET {instance_url}/{prefix}/...`, Create `POST {instance_url}/{prefix}/...`, Revoke `POST/DELETE {instance_url}/{prefix}/...` (all 🔬). Until confirmed, assume tokens are **managed manually through the Workbench UI / support**; the first token is always created by a human.

## 5. Reauthorization Triggers

| Trigger                      | Detection                          | Action                                                                                        |
| ---------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Token expired / invalid      | `401` on any authenticated call    | Prompt user to generate a new token in Workbench and re-paste it                              |
| Wrong auth header            | `401` on a known-good path         | Try the alternate header (`X-Api-Key`/`apikey`) before re-issuing 🔬                          |
| Insufficient permissions     | `403` response                     | Issuing user's Workbench role lacks permission — escalate role / re-issue with a capable user |
| Wrong / unreachable instance | `404` (HTML) or connection failure | Verify `instance_url` (scheme present, no trailing slash, correct host) — not an auth issue   |
| Token revoked                | `401` + instance reachable         | Prompt user to generate a new token                                                           |

Detection flow:

```
on API error:
  if status == 401:                                  # expired token OR wrong auth header
    retry once with the alternate header (X-Api-Key) on a known-good path  🔬
    if still 401:
      notify: "Workbench token expired/invalid — generate a new token and update the connector"
      disable connector until a new token is provided
  if status == 403:
    log endpoint + response; notify: "Insufficient permissions — the token's user role lacks access"
  if status == 404 (HTML) or connection failure:
    check instance_url normalisation (scheme, trailing slash, host) — likely not an auth problem
```

## Numa Connector Wiring

**Credentials to store** (the two `credentialFields` from the registry entry, `id: 'workbench'`):
| Key | Type | Description |
| --- | --- | --- |
| `bearer_token` | Secret | Pre-issued Workbench bearer token (password field; sent as `Authorization: Bearer`) |
| `instance_url` | URL | Customer's Workbench instance base URL (e.g. `https://yourcompany.workbench.com`) |

> Normalise `instance_url` before composing requests: ensure a scheme is present and strip any trailing slash so `{instance_url}/{prefix}/...` never double-slashes. A wrong/odd base URL is the #1 cause of "nothing works".

**Test Connection Sequence:**

```
1. PULL THE SWAGGER FIRST (no firm auth assumption needed beyond the token):
   GET {instance_url}/swagger          (UI)
   GET {instance_url}/swagger/v1/swagger.json   (raw spec — exact path 🔬)
   → resolves the real path prefix, jobs resource name, pagination + field schemas.
2. SMOKE TEST AUTH (use the real jobs path from the Swagger):
   GET {instance_url}/{prefix}/jobs?pageSize=1   with Authorization: Bearer {bearer_token}
   → 200  : auth works, gate satisfied
   → 401  : token invalid/expired OR wrong header (retry with X-Api-Key) 🔬
   → 403  : token valid but the issuing user's role lacks permission
   → 404 (HTML): wrong path prefix — re-read the Swagger base path
```

> ⚠️ **No unauthenticated health endpoint** confirmed (unlike Synergy's `/health`). Do not assume one exists; the Swagger fetch + an authenticated `jobs` call are the connection test. 🔬

**Auto-Reconnect Logic:**

```
on 401 response:                  # auth_type == "token" (no OAuth, no refresh)
  retry once with alternate auth header (X-Api-Key) on a known-good path   🔬
  if still failing:
    notify: "Workbench token expired/invalid — generate a new token in Workbench"
    disable connector until a new token is provided
```

**Reference URLs:** Vendor https://www.workbenchcentral.com · Technology https://www.workbenchcentral.com/technology · Integration solutions https://www.workbenchcentral.com/integrationsolutions · API docs (Confluence) https://webwbdoc.atlassian.net/wiki/spaces/WAPI · Support https://wbi.freshdesk.com/support/login · Per-instance Swagger `{instance_url}/swagger` (+ `/swagger/v1/swagger.json` 🔬) · Registry entry `connectorRegistry.ts` (`id: 'workbench'`).

## Discovery checklist (do this with a live token + instance)

- [ ] Confirm **Workbench Online** (cloud) vs **Workbench SBO** (SAP Business One) — surfaces may differ
- [ ] Confirm the **token issuance UI path** (or that support issues it) — fill in §1
- [ ] Confirm the **auth header** (`Authorization: Bearer` vs `X-Api-Key`/`apikey`) — fill in §2
- [ ] Confirm **token lifetime / expiry** and whether any **token-management API** exists — fill in §3/§4
- [ ] Confirm the **API path prefix** + jobs resource name from the Swagger — fill in the smoke test

_See also: `02-api-spec-investigation.md` (dev API reference) and `03-connector-setup.md` (registry + deploy)._

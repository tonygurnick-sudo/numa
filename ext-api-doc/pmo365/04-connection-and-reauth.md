---
api_name: PMO365 (Microsoft Dataverse)
api_slug: pmo365
auth_type: 'OAuth 2.0 (Microsoft Entra ID) — authorization_code + offline_access refresh. No PAT, no API key.'
base_url: '{environment_url}/api/data/v9.2/'
call_surface: 'HTTP via connect_request (not file-browse)'
authority: 'organizations (work/school accounts, any tenant)'
header_scheme: "standard Bearer (NOT custom — contrast Zoho's Zoho-oauthtoken)"
covers: 'Entra app registration, Application User + security role, OAuth flow, token refresh/rotation, revocation, reauth triggers, Numa connector wiring'
---

# PMO365 — Connection & Reauthorization Guide

Complete setup for connecting Numa to **PMO365 (Microsoft Dataverse)**. PMO365 has **no API of its own** — data lives in the customer's **Microsoft Dataverse** environment (the store behind Dynamics 365 / Project for the web), integrated via the **Dataverse Web API** (OData v4, JSON). Auth is standard **Entra ID OAuth 2.0** against the `organizations` authority. Every call runs in a **user's** security context — the Dataverse Application User + security role (§2) defines what the token may read/write. Header is **standard `Bearer`**, not custom.

- **Base URL:** `{environment_url}/api/data/v9.2/` where `environment_url = https://{org}.crm.dynamics.com` — admin-configured, workspace-wide, in the connector's `environment_url` credential field. The backend expands every relative path against this base via `connect_request`.
- **Integration path:** Direct API Only — all interactions through `connect_request` (method + relative path + optional JSON body).

> **Why `organizations` and not a tenant GUID?** Numa connects many customers; pinning the authority to one tenant breaks the next. `organizations` accepts any work/school account and lets the token's `aud` resolve to the per-customer `environment_url`. (`common` would also admit personal MSA accounts, which Dataverse rejects.)

## 1. Register the Application in Microsoft Entra ID

Admin does this **once per Numa deployment**, in the Entra tenant that owns the target Dataverse environment.

**1a. App registration** — [Entra admin center](https://entra.microsoft.com/) (or Azure portal → Microsoft Entra ID) as tenant admin → **Identity → Applications → App registrations → + New registration**:
| Field | Value | Notes |
| --- | --- | --- |
| Name | `Numa Integration` | shown on the consent screen |
| Supported account types | **Accounts in any organizational directory (Multitenant)** | matches the `organizations` authority |
| Redirect URI (platform) | **Web** → `https://{client-name}.numa.arcanum.ai/oauth/callback/pmo365` | **Copy the exact string shown in the Numa wizard** — Entra does byte-for-byte match |

**Register**, then on **Overview** copy: **Application (client) ID** (a GUID, e.g. `11112222-aaaa-3333-bbbb-4444cccc5555`); **Directory (tenant) ID** is informational — you do **not** put it in the authority (use `organizations`).

**1b. Dataverse delegated permission** — **Manage → API permissions → + Add a permission** → **Dynamics CRM** (UI name "Dataverse" / `https://{org}.crm.dynamics.com`) → **Delegated permissions** → tick **`user_impersonation`** ("Access Dynamics 365 as organization users") → **Add permissions** → **Grant admin consent for {tenant}** → **Yes** (status must show green **Granted for {tenant}**). Granting up front means users won't get blocked by a "needs admin approval" prompt during connect.

**1c. Client secret** — **Manage → Certificates & secrets → Client secrets → + New client secret**, description `Numa`, expiry **24 months** (max) → **Add**. **Copy the secret VALUE immediately** (shown once, unrecoverable; copy the _Value_, not the _Secret ID_). Record the **expiry date** — rotate before then (§6).

**1d. Paste into the Numa wizard** — **Data Connectors → PMO365**. Paste **Application (client) ID** → `client_id`, **secret value** → `client_secret`, environment URL `https://{org}.crm.dynamics.com` → `environment_url`. In the wizard's **Advanced** section set the **scope host** to match the environment (§2/§3) — the wizard interpolates credential fields into **authUrl/tokenUrl only**, NOT into the scope, so the scope host is hand-edited here.

## 2. Provision the Dataverse Application User + security role

The Entra app must be mapped to a **Dataverse Application User** with a **security role** granting read/write on the PMO365 tables. Without this, OAuth succeeds but every API call returns **403** (no privilege).

1. [Power Platform admin center](https://admin.powerplatform.microsoft.com/) → **Manage → Environments →** target environment **→ Settings → Users + permissions → Application users**.
2. **+ New app user → + Add an app** → search **`Numa Integration`** by name or client ID → **Add**.
3. Pick a **Business unit** (usually root BU) and an **Email address** for the app user.
4. Under **Security roles**, assign a role granting **read + write** on the PMO365 custom tables AND the platform tables the discovery queries touch: `Solution`, `Solution Component`, `Publisher`, plus Entity Definition metadata. Use the customer's existing **"PMO365 Service"**-style role if EPM Partners shipped one, or a custom role scoped to the `pmo_*` tables. **Save → Create**. (Least privilege: only the PMO365 tables Numa touches + the metadata/solution read for discovery. Don't hand it System Administrator unless the customer insists.)

This Application User is **unlicensed** — no paid Dynamics seat.

## 3. OAuth Flow

| Property          | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| Grant type        | `authorization_code`                                                    |
| Authorization URL | `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize` |
| Token URL         | `https://login.microsoftonline.com/organizations/oauth2/v2.0/token`     |
| Redirect URI      | `https://{client-name}.numa.arcanum.ai/oauth/callback/pmo365`           |
| Scope             | `{environment_url}/.default offline_access`                             |
| PKCE?             | No (confidential client — secret-based). PKCE optional, not used.       |
| Authority         | `organizations` (work/school accounts, any tenant)                      |

> **Scope nuance.** `{environment_url}/.default` requests every Dataverse permission already consented for the app (`user_impersonation` from §1b) — the confidential-client pattern. `offline_access` is **mandatory** for a `refresh_token`. The host in `{environment_url}/.default` is environment-specific and set in the wizard **Advanced** section; the wizard does **not** interpolate the `environment_url` credential field into the scope automatically.

**Authorization request** — Numa redirects the user to:

```
GET https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?response_type=code&client_id=11112222-aaaa-3333-bbbb-4444cccc5555&redirect_uri=https%3A%2F%2Farcanum-demo-tony.numa.arcanum.ai%2Foauth%2Fcallback%2Fpmo365&scope=https%3A%2F%2Fcontoso.crm.dynamics.com%2F.default%20offline_access&state={random_state}
```

The user signs into their Microsoft work account, reviews consent, approves. Entra redirects to `redirect_uri` with `?code={auth_code}&state={same_state}` — or `?error=...&error_description=...` on denial.

**Token exchange:**

```
POST https://login.microsoftonline.com/organizations/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded
grant_type=authorization_code&code={auth_code}&redirect_uri=https%3A%2F%2Farcanum-demo-tony.numa.arcanum.ai%2Foauth%2Fcallback%2Fpmo365&scope=https%3A%2F%2Fcontoso.crm.dynamics.com%2F.default%20offline_access&client_id=11112222-aaaa-3333-bbbb-4444cccc5555&client_secret={client_secret}
```

**Token response:** `{"token_type":"Bearer","scope":"https://contoso.crm.dynamics.com/user_impersonation","expires_in":3599,"ext_expires_in":3599,"access_token":"eyJ0eXAiOiJKV1Qi...","refresh_token":"0.ATcAxxxx..."}`
The `access_token` is a JWT; put it in the **standard** header `Authorization: Bearer {access_token}` on every Dataverse call. (Unlike Zoho, this **is** real `Bearer`.)

**First call after connect — verify the security context:**

```
GET https://contoso.crm.dynamics.com/api/data/v9.2/WhoAmI
Authorization: Bearer {access_token} | OData-MaxVersion: 4.0 | OData-Version: 4.0 | Accept: application/json
```

→ `{"@odata.context":"https://contoso.crm.dynamics.com/api/data/v9.2/$metadata#Microsoft.Dynamics.CRM.WhoAmIResponse","BusinessUnitId":"8a1b...c4","UserId":"3f2c...9e","OrganizationId":"d77e...01"}`
A 200 proves the token is valid AND the Application User + security role mapping (§2) resolved. A 403 here means the OAuth handshake worked but the security role is missing or too narrow.

## 4. Token Refresh

Access token ~1h. Before expiry (or on the first 401), exchange the refresh token. `offline_access` must have been in the original scope or there is no refresh token.

```
POST https://login.microsoftonline.com/organizations/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded
grant_type=refresh_token&refresh_token={refresh_token}&scope=https%3A%2F%2Fcontoso.crm.dynamics.com%2F.default%20offline_access&client_id=11112222-aaaa-3333-bbbb-4444cccc5555&client_secret={client_secret}
```

**Response** (same shape; note a **new** `refresh_token`): `{"token_type":"Bearer","scope":"https://contoso.crm.dynamics.com/user_impersonation","expires_in":3599,"access_token":"eyJ0eXAiOiJKV1Qi...","refresh_token":"0.ATcAyyyy..."}`
| Property | Value |
| --- | --- |
| Access token lifetime | ~1 hour (`expires_in` ≈ 3599s) |
| Refresh token lifetime | 90-day sliding window (refreshed each use); revoked sooner on password/MFA/conditional-access change |
| Refresh token rotation? | **Yes** — Entra returns a **new** `refresh_token` on each refresh; persist it, overwrite the old one |
| Re-consent required? | client secret expires/rotates, admin consent revoked, requested scope changes, or refresh token invalidated |

> **Rotation matters.** Always overwrite the stored refresh token with the one from each refresh response. Keep using the old one → next refresh fails with `invalid_grant`.

## 5. Token Revocation

Entra ID has **no per-token revocation endpoint** Numa calls. Revocation happens Microsoft-side; Numa learns via failed refresh:

- **Admin** revokes app consent: Entra → **Enterprise applications → Numa Integration → Permissions → Revoke**, or deletes the Application User in Power Platform.
- **User** changes password / re-registers MFA / falls under a tightened conditional-access policy → existing refresh tokens invalidated.
- **Secret expiry** (the common one): after the 24-month secret lapses, refresh and auth-code exchange both fail.

In every case the refresh call returns **4xx `invalid_grant` / `invalid_client`** → treat the connection as ended → full re-consent (and, for secret expiry, a new secret first — §6).

## 6. Reauthorization Triggers

| Trigger                        | Detection                                                              | Action                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Access token expired           | HTTP **401** on a Dataverse call                                       | backend refreshes via `refresh_token`; retry the call **once**                                           |
| Refresh fails — token invalid  | refresh returns **400 `invalid_grant`**                                | mark user disconnected; prompt full re-consent                                                           |
| **Client secret expired**      | refresh / auth-code returns **401 `invalid_client`** / `AADSTS7000222` | **admin rotates the secret** in Entra (§1c), updates `client_secret` in the wizard, then users reconnect |
| Admin consent revoked          | refresh **400** + `WhoAmI` **401**                                     | admin re-grants consent (§1b); users reconnect                                                           |
| Scope / environment changed    | admin edits scope or `environment_url` in the wizard                   | full re-consent (token `aud` no longer matches the new environment)                                      |
| Missing/insufficient privilege | HTTP **403** with `error.code` like `0x80040220`                       | fix the **Application User security role** (§2) — NOT a token problem; do not refresh                    |
| Service-protection limit       | HTTP **429** + `Retry-After` header                                    | honor `Retry-After` (seconds); back off — **not** a reauth event                                         |

> **The 401 → refresh → second-401 chain.** First 401 → backend refreshes + retries **once**. A 401 on the retry means the refresh produced a dead token (revoked consent, invalidated refresh token, expired secret) — stop, mark disconnected, surface a reconnect prompt. Don't loop refresh attempts.

## Numa Connector Wiring

**Credentials to store:**
| Key | Type | Description |
| --- | --- | --- |
| `client_id` | company | Entra app (client) GUID — company vault, admin-supplied |
| `client_secret` | company | Entra client secret value — company vault; expires ≤24mo, rotate before lapse (§6) |
| `environment_url` | conn | `https://{org}.crm.dynamics.com` — admin-set; base for `/api/data/v9.2/` and the scope host |
| `access_token` | user | per-user Bearer JWT (~1h) |
| `refresh_token` | user | per-user refresh token (90d sliding, **rotating** — overwrite on every refresh) |

**Test Connection Sequence (Phase 2 smoke test):**

```
1. POST token endpoint (grant=authorization_code)
     -> expect 200 + access_token + refresh_token (offline_access present)
2. GET {environment_url}/api/data/v9.2/WhoAmI
     Authorization: Bearer {access_token} | OData-MaxVersion: 4.0 | OData-Version: 4.0 | Accept: application/json
     -> expect 200 + { UserId, BusinessUnitId, OrganizationId }   (token + security role OK)
3. GET {environment_url}/api/data/v9.2/solutions?$select=solutionid,uniquename,friendlyname,version&$filter=contains(uniquename,'pmo') or contains(friendlyname,'pmo')
     -> expect 200 + the PMO365 solution row (confirms the solution is present & readable)
```

Step 3 starts **discovery** — PMO365 ships its tables as a Dataverse _solution_ under a publisher customization prefix (e.g. `pmo_*`). No global table list; find the solution, enumerate `solutioncomponents` (componenttype 1 = Entity), resolve each table via `EntityDefinitions(...)`. Running these three against a live environment closes the Phase 2 gate.

> **Honesty note:** concrete PMO365 table/column names (`pmo_project`, `pmo_risk`, etc.) are **proprietary and not publicly documented** — treat any such name as ILLUSTRATIVE / [INFERRED], confirmed at runtime via the discovery queries above and `{environment_url}/api/data/v9.2/$metadata`. Never assert a specific `pmo_*` name as [CONFIRMED].

**Auto-Reconnect Logic:**

```
on 401 response (Dataverse call):
    try refresh_token()                 # ~1h access tokens expire often
    persist the NEW refresh_token       # Entra rotates — must overwrite
    if refresh returns 200: retry the original call ONCE
    if the retry returns 401, OR refresh returns 4xx (invalid_grant/invalid_client):
        mark user disconnected — full re-consent required
        (if invalid_client / AADSTS7000222: admin must rotate the client secret first)
on 403 response:
    do NOT refresh — it's a security-role privilege gap (§2), surface to admin
on 429 response:
    read Retry-After (seconds); sleep then retry; serialise bursty calls
    (service-protection limits: ~6000 req / 5-min sliding window, per user)
```

## Sources

- https://learn.microsoft.com/en-us/power-apps/developer/data-platform/authenticate-oauth
- https://learn.microsoft.com/en-us/power-apps/developer/data-platform/walkthrough-register-app-azure-active-directory
- https://learn.microsoft.com/en-us/power-platform/admin/manage-application-users
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/discover-service-url

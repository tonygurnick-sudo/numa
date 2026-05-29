# PMO365 — Connection & Reauthorization Guide

> Complete setup for connecting Numa to **PMO365 (Microsoft Dataverse)**.
> **Auth type:** OAuth 2.0 (Microsoft Entra ID — Authorization Code grant + `offline_access` refresh). No PAT, no API key.
> Detailed enough to automate connector setup, or to walk an admin through Entra + Power Platform step-by-step.

---

## Auth Type: OAuth 2.0 (Microsoft Entra ID)

PMO365 has **no API of its own**. It is a Project Portfolio Management solution by EPM Partners built on the Microsoft Power Platform, and all of its data lives in the customer's **Microsoft Dataverse** environment (the same datastore behind Dynamics 365 / Project for the web). You integrate by talking to the **Dataverse Web API** (OData v4, JSON).

Authentication is therefore standard **Entra ID OAuth 2.0** against the `organizations` authority. Every call runs in a **user's** security context — the Dataverse Application User + security role (below) defines what that token is allowed to read/write. The header is a **standard `Bearer`** scheme, not a custom one.

- **API base URL:** `{environment_url}/api/data/v9.2/` where `environment_url = https://{org}.crm.dynamics.com` — admin-configured, workspace-wide, stored in the connector's `environment_url` credential field. The backend expands every relative path the agent uses against this base via `connect_request`.
- **Integration path:** Direct API Only — all interactions go through `connect_request` (method + relative path + optional JSON body). Mirror how `zoho-crm/01-llm-api-rules.md` describes `connect_request`.

> **Why the `organizations` authority and not a tenant GUID?** Numa connects many customers; pinning the authority to one tenant breaks the next. `organizations` accepts any work/school account and lets the token's `aud` resolve to the per-customer `environment_url`. (`common` would also admit personal MSA accounts, which Dataverse rejects — use `organizations`.)

---

## 1. Register the Application in Microsoft Entra ID

The admin does this **once per Numa deployment**, in the Entra tenant that owns the target Dataverse environment.

### 1a. Create the app registration

1. Sign in to the [Entra admin center](https://entra.microsoft.com/) (or [Azure portal](https://portal.azure.com/) → **Microsoft Entra ID**) as a tenant admin.
2. Go to **Identity → Applications → App registrations → + New registration**.
3. Fill in:

   | Field                   | Value                                                                   | Notes                                                                               |
   | ----------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
   | Name                    | `Numa Integration`                                                      | Shown to users on the consent screen                                                |
   | Supported account types | **Accounts in any organizational directory (Multitenant)**              | Matches the `organizations` authority below                                         |
   | Redirect URI (platform) | **Web** → `https://{client-name}.numa.arcanum.ai/oauth/callback/pmo365` | **Copy the exact string shown in the Numa wizard** — Entra does byte-for-byte match |

4. Click **Register**. On the **Overview** blade copy:
   - **Application (client) ID** — a GUID, e.g. `11112222-aaaa-3333-bbbb-4444cccc5555`.
   - **Directory (tenant) ID** — informational; you do **not** put this in the authority (we use `organizations`).

### 1b. Add the Dataverse delegated permission

1. In the app registration, go to **Manage → API permissions → + Add a permission**.
2. Select **Dynamics CRM** (the API display name is "Dataverse" / `https://{org}.crm.dynamics.com`).
3. Choose **Delegated permissions** and tick **`user_impersonation`** — shown in the UI as **"Access Dynamics 365 as organization users"**. Click **Add permissions**.
4. Click **Grant admin consent for {tenant}**, then **Yes**. The status column must show a green **Granted for {tenant}**.

   > Granting admin consent up front means individual users won't get blocked by a "needs admin approval" prompt during the Numa connect flow.

### 1c. Create a client secret

1. Go to **Manage → Certificates & secrets → Client secrets → + New client secret**.
2. Description `Numa`, expiry **24 months** (the maximum). Click **Add**.
3. **Copy the secret VALUE immediately** — it is shown only once and is unrecoverable after you leave the blade. (Copy the _Value_, not the _Secret ID_.)
4. Record the secret's **expiry date** — you will need to rotate it before then (see §6).

### 1d. Paste into the Numa wizard

1. In Numa: **Data Connectors → PMO365**.
2. Paste **Application (client) ID** → `client_id`, **secret value** → `client_secret`, and the environment URL `https://{org}.crm.dynamics.com` → `environment_url`.
3. In the wizard's **Advanced** section, set the **scope host** to match the environment (see §2). The wizard interpolates credential fields into the **authUrl/tokenUrl only** — it does **not** substitute credential fields into the scope, so the scope host is edited by hand here.

---

## 2. Provision the Dataverse Application User + security role

The Entra app must be mapped to a **Dataverse Application User** and given a **security role** that grants read/write on the PMO365 tables. Without this, OAuth succeeds but every API call returns **403** (no privilege).

1. Sign in to the [Power Platform admin center](https://admin.powerplatform.microsoft.com/).
2. **Manage → Environments →** select the target environment **→ Settings → Users + permissions → Application users**.
3. **+ New app user → + Add an app** → search for **`Numa Integration`** by name or client ID → **Add**.
4. Pick a **Business unit** (usually the root BU) and an **Email address** for the app user.
5. Under **Security roles**, assign a role that grants **read + write** on the PMO365 custom tables (and on the platform tables the discovery queries touch: `Solution`, `Solution Component`, `Publisher`, plus Entity Definition metadata). Use the customer's existing **"PMO365 Service"**-style role if EPM Partners shipped one, or a custom role scoped to the `pmo_*` tables. Click **Save → Create**.

   > Least privilege: the app user only needs the PMO365 tables Numa actually touches plus the metadata/solution read needed for discovery. Don't hand it System Administrator unless the customer insists.

This Application User is **unlicensed** and does not consume a paid Dynamics seat.

---

## 3. OAuth Flow

| Property          | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| Grant type        | `authorization_code`                                                    |
| Authorization URL | `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize` |
| Token URL         | `https://login.microsoftonline.com/organizations/oauth2/v2.0/token`     |
| Redirect URI      | `https://{client-name}.numa.arcanum.ai/oauth/callback/pmo365`           |
| Scope             | `{environment_url}/.default offline_access`                             |
| PKCE required?    | No (confidential client — secret-based). PKCE optional, not used here.  |
| Authority         | `organizations` (work/school accounts, any tenant)                      |

> **Scope nuance.** `{environment_url}/.default` requests every Dataverse permission already consented for the app (i.e. `user_impersonation` from §1b) — this is the **confidential-client** pattern Microsoft documents. `offline_access` is **mandatory** to receive a `refresh_token`. The host in `{environment_url}/.default` is environment-specific and is set in the wizard **Advanced** section; the wizard does **not** interpolate the `environment_url` credential field into the scope automatically.

### Authorization request

Numa builds and redirects the user to:

```http
GET https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?
  response_type=code&
  client_id=11112222-aaaa-3333-bbbb-4444cccc5555&
  redirect_uri=https%3A%2F%2Farcanum-demo-tony.numa.arcanum.ai%2Foauth%2Fcallback%2Fpmo365&
  scope=https%3A%2F%2Fcontoso.crm.dynamics.com%2F.default%20offline_access&
  state={random_state}
```

The user signs into their Microsoft work account, reviews the consent screen, and approves. Entra redirects back to `redirect_uri` with `?code={auth_code}&state={same_state}` — or `?error=...&error_description=...` on denial.

### Token exchange

Numa backend exchanges the auth code for tokens:

```http
POST https://login.microsoftonline.com/organizations/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code={auth_code}&
redirect_uri=https%3A%2F%2Farcanum-demo-tony.numa.arcanum.ai%2Foauth%2Fcallback%2Fpmo365&
scope=https%3A%2F%2Fcontoso.crm.dynamics.com%2F.default%20offline_access&
client_id=11112222-aaaa-3333-bbbb-4444cccc5555&
client_secret={client_secret}
```

### Token response

```json
{
  "token_type": "Bearer",
  "scope": "https://contoso.crm.dynamics.com/user_impersonation",
  "expires_in": 3599,
  "ext_expires_in": 3599,
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6...",
  "refresh_token": "0.ATcAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx..."
}
```

The `access_token` is a JWT; put it in the **standard** header `Authorization: Bearer {access_token}` on every Dataverse call. (Unlike Zoho, this **is** real `Bearer`.)

### First call after connect — verify the security context

```http
GET https://contoso.crm.dynamics.com/api/data/v9.2/WhoAmI
Authorization: Bearer {access_token}
OData-MaxVersion: 4.0
OData-Version: 4.0
Accept: application/json
```

```json
{
  "@odata.context": "https://contoso.crm.dynamics.com/api/data/v9.2/$metadata#Microsoft.Dynamics.CRM.WhoAmIResponse",
  "BusinessUnitId": "8a1b...c4",
  "UserId": "3f2c...9e",
  "OrganizationId": "d77e...01"
}
```

A 200 from `WhoAmI` proves the token is valid AND the Application User + security role mapping (§2) resolved. A 403 here means the OAuth handshake worked but the security role is missing or too narrow.

---

## 4. Token Refresh

The access token lives ~1 hour. Before it expires (or on the first 401), exchange the refresh token for a fresh access token. `offline_access` must have been in the original scope or there is no refresh token.

```http
POST https://login.microsoftonline.com/organizations/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token={refresh_token}&
scope=https%3A%2F%2Fcontoso.crm.dynamics.com%2F.default%20offline_access&
client_id=11112222-aaaa-3333-bbbb-4444cccc5555&
client_secret={client_secret}
```

**Response** (same shape as the auth-code response — note a **new** `refresh_token`):

```json
{
  "token_type": "Bearer",
  "scope": "https://contoso.crm.dynamics.com/user_impersonation",
  "expires_in": 3599,
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1Ni...",
  "refresh_token": "0.ATcAyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy..."
}
```

| Property                | Value                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Access token lifetime   | ~1 hour (`expires_in` ≈ 3599s)                                                                                                                         |
| Refresh token lifetime  | 90-day sliding window (refreshed each use); revoked sooner on password/MFA/conditional-access change                                                   |
| Refresh token rotation? | **Yes** — Entra returns a **new** `refresh_token` on each refresh; persist it, overwrite the old one                                                   |
| Re-consent required?    | When the **client secret expires/rotates**, when admin consent is revoked, when the requested scope changes, or after the refresh token is invalidated |

> **Rotation matters.** Because the refresh token rotates, always overwrite the stored refresh token with the one from each refresh response. Keep using the old one and the next refresh fails with `invalid_grant`.

---

## 5. Token Revocation

Entra ID has **no per-token revocation endpoint** Numa calls. Revocation happens on the Microsoft side and Numa learns about it via failed refresh:

- **Admin** revokes app consent: Entra → **Enterprise applications → Numa Integration → Permissions → Revoke**, or deletes the Application User in Power Platform.
- **User** changes password / re-registers MFA / falls under a tightened conditional-access policy → existing refresh tokens are invalidated.
- **Secret expiry** (the common one): after the 24-month secret lapses, refresh and auth-code exchange both fail.

In every case the refresh call returns **4xx `invalid_grant` / `invalid_client`** and Numa must treat the connection as ended → full re-consent (and, for secret expiry, a new secret first — see §6).

---

## 6. Reauthorization Triggers

| Trigger                        | Detection                                                              | Action                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Access token expired           | HTTP **401** on a Dataverse call                                       | Backend refreshes via `refresh_token`; retry the call **once**                                           |
| Refresh fails — token invalid  | Refresh returns **400 `invalid_grant`**                                | Mark user disconnected; prompt full re-consent flow                                                      |
| **Client secret expired**      | Refresh / auth-code returns **401 `invalid_client`** / `AADSTS7000222` | **Admin rotates the secret** in Entra (§1c), updates `client_secret` in the wizard, then users reconnect |
| Admin consent revoked          | Refresh **400** + `WhoAmI` **401**                                     | Admin re-grants consent (§1b); users reconnect                                                           |
| Scope / environment changed    | Admin edits scope or `environment_url` in the wizard                   | Full re-consent flow (token `aud` no longer matches the new environment)                                 |
| Missing/insufficient privilege | HTTP **403** with `error.code` like `0x80040220`                       | Fix the **Application User security role** (§2) — this is NOT a token problem; do not refresh            |
| Service-protection limit       | HTTP **429** + `Retry-After` header                                    | Honor `Retry-After` (seconds); back off — **not** a reauth event                                         |

> **The 401 → refresh → second-401 chain.** On the first 401 the backend refreshes and retries **once**. A 401 on the retry means the refresh itself produced a dead token (revoked consent, invalidated refresh token, expired secret) — stop, mark disconnected, and surface a reconnect prompt. Don't loop refresh attempts.

---

## Numa Connector Wiring

### Credentials to Store

| Key               | Type    | Description                                                                                 |
| ----------------- | ------- | ------------------------------------------------------------------------------------------- |
| `client_id`       | company | Entra app (client) GUID — company vault, admin-supplied                                     |
| `client_secret`   | company | Entra client secret value — company vault; expires ≤24mo, rotate before lapse (§6)          |
| `environment_url` | conn    | `https://{org}.crm.dynamics.com` — admin-set; base for `/api/data/v9.2/` and the scope host |
| `access_token`    | user    | Per-user Bearer JWT (~1h)                                                                   |
| `refresh_token`   | user    | Per-user refresh token (90d sliding, **rotating** — overwrite on every refresh)             |

### Test Connection Sequence (Phase 2 smoke test)

```
1. POST token endpoint (grant=authorization_code)
     -> expect 200 + access_token + refresh_token (offline_access present)
2. GET {environment_url}/api/data/v9.2/WhoAmI
     Authorization: Bearer {access_token}
     OData-MaxVersion: 4.0 | OData-Version: 4.0 | Accept: application/json
     -> expect 200 + { UserId, BusinessUnitId, OrganizationId }   (token + security role OK)
3. GET {environment_url}/api/data/v9.2/solutions
       ?$select=solutionid,uniquename,friendlyname,version
       &$filter=contains(uniquename,'pmo') or contains(friendlyname,'pmo')
     -> expect 200 + the PMO365 solution row (confirms the solution is present & readable)
```

Step 3 is the start of **discovery** — PMO365 ships its tables as a Dataverse _solution_ under a publisher customization prefix (e.g. `pmo_*`). There is no global table list; you find the solution, enumerate its `solutioncomponents` (componenttype 1 = Entity), and resolve each table via `EntityDefinitions(...)`. Running these three steps against a live environment is what closes the Phase 2 gate flagged in the questionnaire.

> **Honesty note:** the concrete PMO365 table/column names (`pmo_project`, `pmo_risk`, etc.) are **proprietary and not publicly documented** — treat any such name as ILLUSTRATIVE / [INFERRED] only, always confirmed at runtime via the discovery queries above and `{environment_url}/api/data/v9.2/$metadata`. Never assert a specific `pmo_*` name as [CONFIRMED].

### Auto-Reconnect Logic

```
on 401 response (Dataverse call):
    try refresh_token()                 # ~1h access tokens expire often
    persist the NEW refresh_token       # Entra rotates — must overwrite
    if refresh returns 200:
        retry the original call ONCE
    if the retry returns 401, OR refresh returns 4xx (invalid_grant/invalid_client):
        mark user disconnected — full re-consent required
        (if invalid_client / AADSTS7000222: admin must rotate the client secret first)

on 403 response:
    do NOT refresh — it's a security-role privilege gap (§2), surface to admin

on 429 response:
    read Retry-After (seconds); sleep then retry; serialise bursty calls
    (service-protection limits: ~6000 req / 5-min sliding window, per user)
```

---

## Sources

- https://learn.microsoft.com/en-us/power-apps/developer/data-platform/authenticate-oauth
- https://learn.microsoft.com/en-us/power-apps/developer/data-platform/walkthrough-register-app-azure-active-directory
- https://learn.microsoft.com/en-us/power-platform/admin/manage-application-users
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/discover-service-url

---
api_name: 'Cin7 Omni'
api_slug: 'cin7-omni'
auth_type: 'username-password (per-user API username + API key, sent as HTTP Basic)'
generated_date: '2026-06-10'
---

# Cin7 Omni — Connector & Integration Setup

> How the Cin7 Omni connector is wired into Numa: registry entry, admin wizard flow, what gets
> stored where, and how the backend injects auth on every request. The wiring below is the real
> implementation; the Cin7 side has NOT been live-validated (no credentials yet).

---

## 1. Product context

|              |                                                                  |
| ------------ | ----------------------------------------------------------------- |
| Vendor       | Cin7                                                              |
| Product      | Cin7 Omni — inventory and order management (formerly just "Cin7") |
| App URL      | `go.cin7.com` / `app.cin7.com`                                    |
| API base URL | `https://api.cin7.com/api` (fixed SaaS host, HTTPS)               |
| Rate limits  | 3/sec, 60/min, 5,000/day per API connection                       |

⚠️ **Cin7 sells two products with separate APIs.** This connector is for **Omni** only. Cin7
**Core** (formerly DEAR; `inventory.dearsystems.com`, custom-header auth) has its own connector,
`cin7-core`. If the customer logs in at `inventory.dearsystems.com`, set up Cin7 Core instead.

---

## 2. Auth model — HTTP Basic, per-user credentials

Every API call carries one header:

```
Authorization: Basic base64(api-username:api-key)
```

- **API Username** — account-level, from Cin7 Omni → Settings → Integrations & API → API v1
- **API Key** — generated per API connection on the same page

Both values are **per-user secrets in Numa**: the user pastes them into the inline chat credential
card on first use (stored as `username` + `password` in their personal vault). The admin wizard
collects **no credential at all** — there is no separate account-level secret (unlike ProWorkflow's
`apikey` header).

**Permission quirk to remember:** Cin7 Omni keys carry per-endpoint Create/Read/Update/Write
toggles. A **403 means the key lacks that endpoint's permission — not bad credentials** (that's
a 401). See `04-connection-and-reauth.md` §4.

---

## 3. Connector Registry entry

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

```typescript
{
  id: 'cin7-omni',
  displayName: 'Cin7 Omni',
  icon: 'bi-boxes',
  description: 'Inventory and order management (Cin7 Omni)',
  category: 'Inventory',
  authType: 'username-password',
  baseUrl: 'https://api.cin7.com/api',
  rateLimitRpm: 60,               // 3/sec, 60/min, 5,000/day per API connection
  rateLimitDaily: 5000,
  cachingPolicy: CACHING_PRESETS.projectManagement,
  credentialFields: [             // per-user, captured in chat
    { key: 'username', type: 'text',     required: true },  // API username (helpText: cin7OmniKeyHint)
    { key: 'password', type: 'password', required: true },  // API key (label: apiKey)
  ],
}
```

Notes:

- `authType: 'username-password'` routes the backend to the **Basic-auth** credential path
  (same mechanism as ProWorkflow), with the API key riding in the `password` field.
- There are **no `adminFields`** — the admin flow is register + metadata only.
- The `password` field's label is the generic `apiKey` i18n key and its placeholder is
  "Paste your Cin7 Omni API key", so the chat card reads naturally even though the vault field
  is named `password`.

The slug is also listed in `infra/config/connectors.ts` → `NATIVE_CONNECTORS` (under the
"Inventory (Cin7 is two separate products with separate APIs)" group), which feeds the unified
Integrations catalog endpoint. That slug list is mirrored in
`lambdas/python/workspace-chat-tools/tools/user_profile.py` (`_NATIVE_CONNECTOR_SLUGS`) — keep
them in sync if the slug ever changes.

---

## 4. Admin setup (Integrations → Cin7 Omni)

The admin flow uses the generic `ApiKeyWizard` (`wizards/ApiKeyWizard.tsx`):

1. Open **Integrations**, pick **Cin7 Omni**, start the wizard.
2. Step 1 (overview) shows the per-user notice: *no credential is needed here* — each user is
   asked for their own credentials the first time they use the connector from chat.
3. Step 2 (review & save) — metadata only. **Leave Instance URL empty** (Omni is a fixed-host
   SaaS; the registry `baseUrl` is used). Optional: override display name/icon/description or the
   rate-limit numbers.
4. Save → step 3 confirms. No credentials are collected anywhere in this flow.

### 4.1 What gets stored — company secret `connector-config-cin7-omni`

The wizard persists a single company vault secret (category "Connector Config"):

| Field               | Value                                                                  |
| ------------------- | ----------------------------------------------------------------------- |
| `display_name`      | `Cin7 Omni` (or admin override)                                          |
| `icon`, `description` | Registry defaults / admin overrides                                    |
| `connector_type`    | `username-password`                                                     |
| `base_url`          | `https://api.cin7.com/api` — written from the registry when no instance URL is entered |
| `rate_limit_rpm` / `rate_limit_daily` | `60` / `5000` (admin-overridable)                    |
| `credential_fields` | JSON snapshot of the per-user fields (username + password) — drives the inline chat credential card |

No `api_key`/`api_key_header` (no admin credential) and no `credential_header_map` (that mechanism
is for Cin7 **Core**'s custom-header auth). Re-running the wizard updates this same secret; a
legacy `connector-cin7-omni` company secret, if present, is migrated and deleted on save.

### 4.2 Prerequisite on the Cin7 side

Before users connect, a Cin7 Omni administrator must create an API connection
(**Settings → Integrations & API → API v1 → Add New API Connection**) and enable the per-endpoint
permissions Numa needs (Read on the entities users will query; Create/Update only if writes are in
scope). Recommended: a **dedicated connection for Numa** — its 5,000/day budget is then isolated
from the customer's other integrations. Note Cin7 caps connections per account.

---

## 5. Backend request flow (oauth-workspace-tools)

> File: `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`

The agent calls
`connectors(name="request", params={connector: "cin7-omni", url: "/v1/Products?page=1&rows=50", method: "GET"})`.
`handle_connect_request` then:

1. Expands the relative URL against the stored `base_url`
   (`_resolve_connector_base_url` → `https://api.cin7.com/api` + `/v1/Products...`).
2. Looks for an OAuth token (none), then a single per-user token via `_user_connector_token`
   (none — no `api_key`-style field), then **`_user_connector_basic_creds`** → the user's
   `connector-cin7-omni` personal-vault secret → builds
   `Authorization: Basic base64(username:password)`.
3. `_connector_static_headers` contributes nothing (no `api_key`/`api_key_header` on the config).
4. No stored user credential → returns the structured `needs_credential` error
   (`_needs_credential_response`), which the agent surfaces as the **inline chat credential card**
   built from the `credential_fields` snapshot. On submit, the values are written to the user's
   personal vault (`connector-cin7-omni`, fields `username` + `password`) via the PAT credentials
   endpoint, and the request retries.

The agent must **never** set the `Authorization` header itself — it is injected by the backend and
the agent never sees the credentials.

---

## 6. Smoke test after setup

```http
# Cheapest authenticated probe (needs Read on Users)
GET https://api.cin7.com/api/v1/Users?rows=1
→ 200 with a JSON array        — credentials valid, permission present
→ 401 "Unauthorized access"    — wrong API username or key
→ 403 "Access is forbidden"    — credentials VALID but the key lacks Read on Users
                                 (fix the toggle in Cin7, or probe another entity)
```

From chat: ask the agent to "list Cin7 Omni products" — first use triggers the credential card;
after the user enters the API username + key, the request retries and returns the product list.
Then spot-check each entity the customer cares about (Stock, SalesOrders, Contacts) to surface
missing per-endpoint permission toggles before real use.

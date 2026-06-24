---
api_name: Cin7 Omni
api_slug: cin7-omni
base_url: https://api.cin7.com/api
auth_type: username-password (per-user API Username + API Key, sent as HTTP Basic)
call_surface: HTTP via Numa native data connector, `request` operation
doc_role: connector wiring — registry entry, admin wizard, vault secrets, backend auth injection
confidence: wiring below is the real implementation; the Cin7 side is NOT yet live-validated (no credentials).
---

# Cin7 Omni — Connector & Integration Setup

> How the connector is wired into Numa: registry entry, admin wizard flow, what's stored where, and how the backend injects auth.

## 1. Product context

|                  |                                                                          |
| ---------------- | ------------------------------------------------------------------------ |
| Vendor / product | Cin7 / Cin7 Omni — inventory and order management (formerly just "Cin7") |
| App URL          | `go.cin7.com` / `app.cin7.com`                                           |
| API base URL     | `https://api.cin7.com/api` (fixed SaaS host, HTTPS)                      |
| Rate limits      | 3/sec, 60/min, 5,000/day per API connection                              |

⚠️ **Cin7 sells two products with separate APIs.** This connector is **Omni** only. **Core** (formerly DEAR; `inventory.dearsystems.com`, custom-header auth) has its own connector `cin7-core`. If the customer logs in at `inventory.dearsystems.com`, set up Cin7 Core instead.

## 2. Auth model — HTTP Basic, per-user credentials

Every call carries one header: `Authorization: Basic base64(api-username:api-key)`.

- **API Username** — account-level, from Cin7 Omni → Settings → Integrations & API → API v1.
- **API Key** — generated per API connection on the same page.

Both are **per-user secrets in Numa**: the user pastes them into the inline chat credential card on first use (stored as `username` + `password` in their personal vault). The admin wizard collects **no credential** — no separate account-level secret (unlike ProWorkflow's `apikey` header).

**Permission quirk:** Omni keys carry per-endpoint Create/Read/Update/Write toggles. A **403 = the key lacks that endpoint's permission, NOT bad credentials** (that's a 401). See `04-connection-and-reauth.md` §4.

## 3. Connector registry entry

> `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

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

- `authType: 'username-password'` routes the backend to the **Basic-auth** credential path (same as ProWorkflow), with the API key in the `password` field.
- **No `adminFields`** — admin flow is register + metadata only.
- The `password` field's label is the generic `apiKey` i18n key, placeholder "Paste your Cin7 Omni API key", so the chat card reads naturally even though the vault field is named `password`.

The slug is also in `infra/config/connectors.ts` → `NATIVE_CONNECTORS` (group "Inventory (Cin7 is two separate products with separate APIs)"), which feeds the unified Integrations catalog endpoint. Mirrored in `lambdas/python/workspace-chat-tools/tools/user_profile.py` (`_NATIVE_CONNECTOR_SLUGS`) — keep in sync if the slug changes.

## 4. Admin setup (Integrations → Cin7 Omni)

Uses the generic `ApiKeyWizard` (`wizards/ApiKeyWizard.tsx`):

1. Open Integrations, pick Cin7 Omni, start the wizard.
2. Step 1 (overview): per-user notice — _no credential needed here_; each user is asked for their own credentials the first time they use the connector from chat.
3. Step 2 (review & save): metadata only. **Leave Instance URL empty** (Omni is a fixed-host SaaS; the registry `baseUrl` is used). Optional: override display name/icon/description or rate-limit numbers.
4. Save → step 3 confirms. No credentials collected anywhere.

### 4.1 What gets stored — company secret `connector-config-cin7-omni` (category "Connector Config")

| Field                                 | Value                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `display_name`                        | `Cin7 Omni` (or admin override)                                                                     |
| `icon`,`description`                  | registry defaults / admin overrides                                                                 |
| `connector_type`                      | `username-password`                                                                                 |
| `base_url`                            | `https://api.cin7.com/api` — written from the registry when no instance URL is entered              |
| `rate_limit_rpm` / `rate_limit_daily` | `60` / `5000` (admin-overridable)                                                                   |
| `credential_fields`                   | JSON snapshot of the per-user fields (username + password) — drives the inline chat credential card |

No `api_key`/`api_key_header` (no admin credential) and no `credential_header_map` (that's for Cin7 **Core**'s custom-header auth). Re-running the wizard updates this same secret; a legacy `connector-cin7-omni` company secret, if present, is migrated and deleted on save.

### 4.2 Prerequisite on the Cin7 side

Before users connect, a Cin7 Omni admin must create an API connection (**Settings → Integrations & API → API v1 → Add New API Connection**) and enable the per-endpoint permissions Numa needs (Read on queried entities; Create/Update only if writes are in scope). Recommended: a **dedicated connection for Numa** — its 5,000/day budget is then isolated from the customer's other integrations. Cin7 caps connections per account.

## 5. Backend request flow

> `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`

Agent calls `connectors(name="request", params={connector:"cin7-omni", url:"/v1/Products?page=1&rows=50", method:"GET"})`. `handle_connect_request`:

1. Expands the relative URL against the stored `base_url` (`_resolve_connector_base_url` → `https://api.cin7.com/api` + `/v1/Products...`).
2. Resolves auth in `do_request`: an OAuth token first (none); then, because the company config declares `connector_type: username-password` and has no `credential_header_map`, the **`elif declared == "username-password":` branch** reads the user's `connector-cin7-omni` personal-vault fields (`_user_connector_fields`) and calls `_basic_from_fields`, building `Authorization: Basic base64(username:password)`. A missing username or password yields no header and counts as not connected.
3. `_connector_static_headers` contributes nothing (no `api_key`/`api_key_header` on the config).
4. No stored user credential → returns the structured `needs_credential` error (`_needs_credential_response`), surfaced as the **inline chat credential card** built from the `credential_fields` snapshot. On submit, values are written to the user's personal vault (`connector-cin7-omni`, fields `username`+`password`) via the PAT credentials endpoint, and the request retries.

The agent must **never** set `Authorization` itself — injected by the backend; the agent never sees credentials.

## 6. Smoke test after setup

```http
# Cheapest authenticated probe (needs Read on Users)
GET https://api.cin7.com/api/v1/Users?rows=1
→ 200 (JSON array)          — credentials valid, permission present
→ 401 "Unauthorized access" — wrong API username or key
→ 403 "Access is forbidden" — credentials VALID but the key lacks Read on Users (fix the toggle in Cin7, or probe another entity)
```

From chat: ask the agent to "list Cin7 Omni products" — first use triggers the credential card; after the user enters API username + key, the request retries and returns the product list. Then spot-check each entity the customer cares about (Stock, SalesOrders, Contacts) to surface missing per-endpoint permission toggles before real use.

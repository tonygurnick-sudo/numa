---
api_name: Better Impact
api_slug: betterimpact
doc: connector & integration setup (registry, admin wizard, storage, backend auth injection)
auth_type: username-password (admin-generated API key pair, sent as HTTP Basic)
base_url: https://api.betterimpact.com/v1
confidence: the Numa wiring is the real implementation; the Better Impact side is NOT live-validated (no credentials yet). [UNKNOWN] tagged inline.
---

# Better Impact — Connector & Integration Setup

## 1. Product context

|              |                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------- |
| Vendor       | Better Impact (`betterimpact.com`) — Volunteer Impact (also Donor/Client/Member Impact — same API) |
| API base URL | `https://api.betterimpact.com/v1` (fixed SaaS host, HTTPS, v1 only — already ends in `/v1`)        |
| API surface  | **Read-only** — users/volunteers, timelog (hours) entries, lookups. Rate limits [UNKNOWN]          |

⚠️ **No webhooks** — polling only (`updated_since`). **Module-scoped keys:** a key returns data only for modules checked at creation — a missing module yields **empty data, not an error**. The connector's defining gotcha.

## 2. Auth model — per-user Basic pair, no admin credential

Every call carries one header — `Authorization: Basic base64(username:password)` — injected by the Numa backend.

- The credential is an **API key created by a Better Impact administrator** (Configuration → Organisation Settings → Security Settings → API Keys → [+ Create API Key]). Creating a key generates a **username+password pair** — that pair IS the credential (not a user's Better Impact login).
- In Numa it is a **per-user secret**: each user pastes the pair into the inline chat credential card on first use (vault fields `username`+`password`). The admin wizard collects **no credential at all** — unlike ProWorkflow, no account-level API key or extra header.
- **Deleting/disabling the key in Better Impact invalidates the pair immediately** → stored copies 401 → users reconnect via the same chat card. **Editing the key's modules** silently changes returned data. See `04-connection-and-reauth.md`.

## 3. Connector registry entry

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

```typescript
{
  id: 'betterimpact',
  displayName: 'Better Impact',
  icon: 'bi-people',
  description: 'Volunteer management (Volunteer Impact)',
  category: 'Volunteer Management',
  authType: 'username-password',
  baseUrl: 'https://api.betterimpact.com/v1',
  cachingPolicy: CACHING_PRESETS.projectManagement,
  // Admin-created API key yields a username+password pair sent as HTTP Basic.
  // Key scope is module-based — no Volunteer module → returns no volunteers.
  credentialFields: [
    { key: 'username', label: 'dataConnectors.fields.username', type: 'text', placeholder: 'API key username', required: true, helpText: 'dataConnectors.fields.betterimpactKeyHint' },
    { key: 'password', label: 'dataConnectors.fields.password', type: 'password', placeholder: 'API key password', required: true },
  ],
}
```

Notes:

- `authType:'username-password'` routes the backend to the **Basic-auth** path (ProWorkflow precedent) via `_user_connector_basic_creds` — per-user vault fields `username`+`password`.
- No `adminFields`, `apiKeyHeader`, or `credentialHeaderMap` — plain per-user Basic via the metadata-only wizard. No `rateLimitRpm`/`rateLimitDaily` defaults (Better Impact documents no limits; admins can add wizard overrides if throttling shows up).
- `helpText` i18n key `betterimpactKeyHint` (`locales/en/integrations.json`): _"Username + password generated when an admin creates an API key in Better Impact. Key access is module-scoped — missing modules return empty data."_
- Slug listed in `infra/config/connectors.ts` → `NATIVE_CONNECTORS` (Username/password group, next to `proworkflow`) — feeds the unified Integrations catalog endpoint; mirrored in `_NATIVE_CONNECTOR_SLUGS` (`lambdas/python/workspace-chat-tools/tools/user_profile.py`) for `integration:betterimpact` memory scoping.

## 4. Admin setup (Integrations → Better Impact)

Generic `ApiKeyWizard` (`wizards/ApiKeyWizard.tsx`) — open Integrations, pick Better Impact:

1. Step 1 (overview): per-user notice — _no credential needed here_; each user asked for the API-key username+password on first chat use.
2. Step 2 (review & save): metadata only. **Leave Instance URL empty** (fixed-host SaaS; registry `baseUrl` used). Optional: override display name/icon/description/rate limits.
3. Save → step 3 confirms. No credentials collected anywhere.

### 4.1 What gets stored — company secret `connector-config-betterimpact`

Single company vault secret (category "Connector Config"):
| Field | Value |
| --- | --- |
| `display_name` | `Better Impact` (or admin override) |
| `icon`, `description` | Registry defaults / admin overrides |
| `connector_type` | `username-password` |
| `base_url` | `https://api.betterimpact.com/v1` — from the registry when no instance URL entered (an admin-entered `instance_url` takes precedence) |
| `credential_fields` | JSON snapshot of the per-user fields (`username` text + `password` password, with "API key username/password" placeholders) — drives the inline chat credential card |

No `api_key`/`api_key_header`/`credential_header_map` (no admin credential or static account header). Re-running the wizard updates this same secret; a legacy `connector-betterimpact` **company** secret, if present, is deleted on save (per-user vault secrets untouched).

### 4.2 Prerequisite on the Better Impact side

A Better Impact **administrator** creates the API key first: Configuration → Organisation Settings → Security Settings → API Keys → [+ Create API Key] — check **Enabled**, check the **modules** the team needs (Volunteer at minimum), create, share the generated username/password pair. One pair shared, or one key per user — Better Impact does not tie keys to people, so per-user keys are purely an ops/rotation choice.

## 5. Backend request flow (oauth-workspace-tools)

File: `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`
Agent calls `connectors(name="request", params={connector:"betterimpact", url:"/organization/users/?page_size=50", method:"GET"})`. `handle_connect_request`:

1. Expands the relative URL against the stored `base_url` (`_resolve_connector_base_url` reads `connector-config-betterimpact` → `https://api.betterimpact.com/v1` + path).
2. Looks for an OAuth token (none), then a single per-user token via `_user_connector_token` (none — no `api_key`/`bearer_token` fields), then **`_user_connector_basic_creds`** — the user's `connector-betterimpact` vault secret's `username`+`password` — and builds `Authorization: Basic base64(username:password)`.
3. `_connector_static_headers` contributes nothing (no account-level header); any agent-supplied `headers` merged last. Better Impact needs none.
4. No stored user credential → returns the structured `needs_credential` error (`_needs_credential_response`), surfaced as the **inline chat credential card** built from the `credential_fields` snapshot (username + password). On submit, the pair is written to the user's vault (`connector-betterimpact`) via `POST /api/pat/betterimpact/credentials`, and the request retries.

The agent must **never** set `Authorization` itself — the backend injects it; the agent never sees the credentials. No other Better Impact headers exist.

## 6. Smoke test after setup

```http
# Cheapest authenticated probe (includes off, one record)
GET https://api.betterimpact.com/v1/organization/users/?page_size=1&include_custom_fields=false&include_qualifications=false
→ 200 with { "Header": {...}, "Users": [...] }   — pair valid, envelope confirmed
→ 401                                             — pair invalid/deleted/disabled → re-enter via chat card
→ 200 with empty Users on a populated org         — suspect the key's MODULE scope, not the connector
```

From chat: ask the agent to "list our accepted volunteers in Better Impact" — first use triggers the credential card; after the pair is pasted, the request retries and returns users. Then spot-check timelog entries and lookups for the customer's modules, and capture one bad-credential 401 body.

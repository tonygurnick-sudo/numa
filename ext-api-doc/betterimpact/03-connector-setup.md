---
api_name: 'Better Impact'
api_slug: 'betterimpact'
auth_type: 'username-password (admin-generated API key pair, sent as HTTP Basic)'
generated_date: '2026-06-10'
---

# Better Impact — Connector & Integration Setup

> How the Better Impact connector is wired into Numa: registry entry, admin wizard, storage,
> and backend auth injection. The wiring is the real implementation; the Better Impact side
> has NOT been live-validated (no credentials yet).

---

## 1. Product context

|              |                                                                              |
| ------------ | ----------------------------------------------------------------------------- |
| Vendor       | Better Impact (`betterimpact.com`) — Volunteer Impact (also Donor/Client/Member Impact — same API) |
| API base URL | `https://api.betterimpact.com/v1` (fixed SaaS host, HTTPS, v1 only)            |
| API surface  | **Read-only** — users/volunteers, timelog (hours) entries, lookups. Rate limits [UNKNOWN — not documented] |

⚠️ **No webhooks** — polling only (`updated_since`). **Module-scoped keys:** an API key only
returns data for the modules checked at creation — a missing module yields **empty data, not
an error**. This is the connector's defining gotcha.

---

## 2. Auth model — per-user Basic pair, no admin credential

Every API call carries one secret header — `Authorization: Basic base64(username:password)`
— injected by the Numa backend.

- The credential is an **API key created by a Better Impact administrator** (**Configuration
  → Organisation Settings → Security Settings → API Keys → [+ Create API Key]**). Creating a
  key generates a **username + password pair** — that pair IS the credential (not a user's
  Better Impact login).
- In Numa it is a **per-user secret**: each user pastes the pair into the inline chat
  credential card on first use (vault fields `username` + `password`). The admin wizard
  collects **no credential at all** — unlike ProWorkflow there is no account-level API key
  or extra header.
- **Deleting (or disabling) the key in Better Impact invalidates the pair immediately** →
  stored copies go 401 → users reconnect via the same chat card. **Editing the key's modules**
  silently changes what data it returns. See `04-connection-and-reauth.md`.

---

## 3. Connector Registry entry

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

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
  // An admin-created API key yields a username + password pair sent as
  // HTTP Basic auth. Key scope is module-based — a key without the
  // Volunteer module checked returns no volunteers.
  credentialFields: [
    {
      key: 'username',
      label: 'dataConnectors.fields.username',
      type: 'text',
      placeholder: 'API key username',
      required: true,
      helpText: 'dataConnectors.fields.betterimpactKeyHint',
    },
    {
      key: 'password',
      label: 'dataConnectors.fields.password',
      type: 'password',
      placeholder: 'API key password',
      required: true,
    },
  ],
}
```

Notes:

- `authType: 'username-password'` routes the backend to the **Basic-auth** credential path
  (ProWorkflow precedent) via `_user_connector_basic_creds` — the per-user vault fields
  `username` + `password`.
- No `adminFields`, no `apiKeyHeader`, no `credentialHeaderMap` — plain per-user Basic, via
  the metadata-only wizard path. No `rateLimitRpm`/`rateLimitDaily` defaults either — Better
  Impact documents no limits; admins can add wizard overrides if throttling ever shows up.
- The `helpText` i18n key (`betterimpactKeyHint`, `locales/en/integrations.json`): *"Username
  + password generated when an admin creates an API key in Better Impact. Key access is
  module-scoped — missing modules return empty data."*
- The slug is listed in `infra/config/connectors.ts` → `NATIVE_CONNECTORS` (in the
  "Username/password" group, next to `proworkflow`), which feeds the unified Integrations
  catalog endpoint, and is mirrored in `_NATIVE_CONNECTOR_SLUGS`
  (`lambdas/python/workspace-chat-tools/tools/user_profile.py`) for
  `integration:betterimpact` memory scoping.

---

## 4. Admin setup (Integrations → Better Impact)

The admin flow uses the generic `ApiKeyWizard` (`wizards/ApiKeyWizard.tsx`) — open
**Integrations**, pick **Better Impact**, start the wizard:

1. Step 1 (overview) shows the per-user notice: *no credential is needed here* — each user is
   asked for the API-key username + password on first chat use.
2. Step 2 (review & save) — metadata only. **Leave Instance URL empty** (fixed-host SaaS; the
   registry `baseUrl` is used). Optional: override display name/icon/description/rate limits.
3. Save → step 3 confirms. No credentials are collected anywhere in this flow.

### 4.1 What gets stored — company secret `connector-config-betterimpact`

The wizard persists a single company vault secret (category "Connector Config"):

| Field                 | Value                                                                     |
| --------------------- | -------------------------------------------------------------------------- |
| `display_name`        | `Better Impact` (or admin override)                                        |
| `icon`, `description` | Registry defaults / admin overrides                                        |
| `connector_type`      | `username-password`                                                        |
| `base_url`            | `https://api.betterimpact.com/v1` — written from the registry when no instance URL is entered (an admin-entered `instance_url` would take precedence) |
| `credential_fields`   | JSON snapshot of the per-user fields (`username` text + `password` password, with the "API key username/password" placeholders) — drives the inline chat credential card |

No `api_key`/`api_key_header`/`credential_header_map` (no admin credential or static account
header). Re-running the wizard updates this same secret; a legacy `connector-betterimpact`
**company** secret, if present, is deleted on save (per-user vault secrets are untouched).

### 4.2 Prerequisite on the Better Impact side

A Better Impact **administrator** must create the API key first: **Configuration →
Organisation Settings → Security Settings → API Keys → [+ Create API Key]** — check
**Enabled**, check the **modules** the team needs (Volunteer at minimum), create, and share
the generated username/password pair with the connecting user(s). One pair can be shared, or
the admin can create one key per user — Better Impact does not tie keys to people, so
per-user keys are purely an ops/rotation choice.

---

## 5. Backend request flow (oauth-workspace-tools)

> File: `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`

The agent calls `connectors(name="request", params={connector: "betterimpact",
url: "/organization/users/?page_size=50", method: "GET"})`. `handle_connect_request` then:

1. Expands the relative URL against the stored `base_url` (`_resolve_connector_base_url`
   reads `connector-config-betterimpact` → `https://api.betterimpact.com/v1` + path).
2. Looks for an OAuth token (none), then a single per-user token via `_user_connector_token`
   (none — no `api_key`/`bearer_token` fields), then **`_user_connector_basic_creds`** — the
   user's `connector-betterimpact` personal-vault secret's `username` + `password` — and
   builds `Authorization: Basic base64(username:password)`.
3. `_connector_static_headers` contributes nothing (no account-level header on the config);
   any agent-supplied `headers` are merged last. Better Impact needs none.
4. No stored user credential → returns the structured `needs_credential` error
   (`_needs_credential_response`), surfaced as the **inline chat credential card** built from
   the `credential_fields` snapshot (two fields: username + password). On submit, the pair is
   written to the user's personal vault (`connector-betterimpact`) via
   `POST /api/pat/betterimpact/credentials`, and the request retries.

The agent must **never** set the `Authorization` header itself — the backend injects it and
the agent never sees the credentials. No other Better Impact headers exist.

---

## 6. Smoke test after setup

```http
# Cheapest authenticated probe (includes off, one record)
GET https://api.betterimpact.com/v1/organization/users/?page_size=1&include_custom_fields=false&include_qualifications=false
→ 200 with { "Header": {...}, "Users": [...] }   — pair valid, envelope confirmed
→ 401                                             — pair invalid/deleted/disabled → re-enter via chat card
→ 200 with empty Users on a populated org         — suspect the key's MODULE scope, not the connector
```

From chat: ask the agent to "list our accepted volunteers in Better Impact" — first use
triggers the credential card; after the pair is pasted, the request retries and returns
users. Then spot-check timelog entries and lookups for the modules the customer cares
about, and capture one bad-credential 401 body for the record.

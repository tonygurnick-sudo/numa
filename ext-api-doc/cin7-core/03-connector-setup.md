---
api_name: Cin7 Core
api_slug: cin7-core
auth_type: api-key (per-user Account ID + Application Key, sent as two custom headers via credentialHeaderMap)
base_url: https://inventory.dearsystems.com/externalapi/v2
call_surface: HTTP via `numa integrations request cin7-core <METHOD> <relative-url>` (native connector)
role: connector wiring — registry entry, admin wizard flow, stored secrets, backend auth injection
confidence: wiring below is the real implementation; the Cin7 side has NOT been live-validated (no credentials yet)
---

# Cin7 Core — Connector & Integration Setup

## 1. Product context

|              |                                                                      |
| ------------ | -------------------------------------------------------------------- |
| Vendor       | Cin7                                                                 |
| Product      | Cin7 Core — inventory/ERP (formerly DEAR Inventory)                  |
| App URL      | `inventory.dearsystems.com`                                          |
| API base URL | `https://inventory.dearsystems.com/externalapi/v2` (fixed SaaS host) |
| Rate limit   | 60/min per Application Key                                           |

⚠️ **Cin7 sells two products with separate APIs.** This connector is for **Core** only. Cin7 **Omni** (`api.cin7.com`, HTTP Basic auth, integer IDs) has its own connector, `cin7-omni` — if the customer logs in at `go.cin7.com`/`app.cin7.com`, set up that one instead.

## 2. Auth model — two custom headers, per-user credentials

Every call carries **two custom headers** (no Authorization header at all):

```
api-auth-accountid:      <account-id>
api-auth-applicationkey: <application-key>
```

Both come from Cin7 Core → **Integrations → API → New Application**, and both are **per-user secrets in Numa**: the user pastes them into the inline chat credential card on first use (stored as `account_id` + `application_key` in their personal vault). The admin wizard collects **no credential at all**. First connector using the registry's **`credentialHeaderMap`** mechanism — a header-name → credential-field map telling the backend which vault field rides in which custom header.

**Auth semantics:** Cin7 Core returns **403 for bad credentials** (not a permission issue — Core has no per-endpoint permission model). See `04-connection-and-reauth.md` §4.

## 3. Connector Registry entry

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

```typescript
{
  id: 'cin7-core',
  displayName: 'Cin7 Core',
  icon: 'bi-boxes',
  description: 'Inventory and order management (Cin7 Core, formerly DEAR)',
  category: 'Inventory',
  authType: 'api-key',
  baseUrl: 'https://inventory.dearsystems.com/externalapi/v2',
  rateLimitRpm: 60,               // 60/min per application key
  cachingPolicy: CACHING_PRESETS.projectManagement,
  // Cin7 Core authenticates with TWO custom headers, not Authorization —
  // the map below tells the backend which user credential field rides in
  // which header on every request.
  credentialHeaderMap: {
    'api-auth-accountid': 'account_id',
    'api-auth-applicationkey': 'application_key',
  },
  credentialFields: [             // per-user, captured in chat
    { key: 'account_id',      type: 'text',     required: true },  // helpText: cin7CoreKeyHint
    { key: 'application_key', type: 'password', required: true },  // label: applicationKey
  ],
}
```

Notes:

- `authType: 'api-key'` + `credentialHeaderMap` routes the backend to the **custom-header** credential path (the `if header_map:` branch in `do_request`, building the headers via `_headers_from_fields`) — not Bearer, not Basic. That branch is checked **first**, ahead of the declared `connector_type`, so a `credential_header_map` always wins.
- **No `adminFields`** (admin flow is register + metadata only) and no `rateLimitDaily` — Core has no documented daily cap (unlike Omni's 5,000/day).

The slug is also listed in `infra/config/connectors.ts` → `NATIVE_CONNECTORS` (under "Inventory (Cin7 is two separate products with separate APIs)"), feeding the unified Integrations catalog endpoint. That slug list is mirrored in `lambdas/python/workspace-chat-tools/tools/user_profile.py` (`_NATIVE_CONNECTOR_SLUGS`) — keep in sync if the slug ever changes.

## 4. Admin setup (Integrations → Cin7 Core)

Uses the generic `ApiKeyWizard` (`wizards/ApiKeyWizard.tsx`):

1. Open **Integrations**, pick **Cin7 Core**, start the wizard.
2. Step 1 (overview): per-user notice — _no credential needed here_; each user is asked for their own credentials the first time they use the connector from chat.
3. Step 2 (review & save): metadata only. **Leave Instance URL empty** (fixed-host SaaS; the registry `baseUrl` is used). Optional: override display name/icon/description/rate limit.
4. Save → step 3 confirms. No credentials collected anywhere in this flow.

### 4.1 What gets stored — company secret `connector-config-cin7-core`

The wizard persists a single company vault secret (category "Connector Config"):
| Field | Value |
| --- | --- |
| `display_name` | `Cin7 Core` (or admin override) |
| `icon`, `description` | Registry defaults / admin overrides |
| `connector_type` | `api-key` |
| `base_url` | `https://inventory.dearsystems.com/externalapi/v2` — written from the registry when no instance URL is entered |
| `rate_limit_rpm` | `60` (admin-overridable) |
| `credential_header_map` | `{"api-auth-accountid":"account_id","api-auth-applicationkey":"application_key"}` (JSON) — drives the backend's custom-header auth |
| `credential_fields` | JSON snapshot of the per-user fields (account_id + application_key) — drives the inline chat credential card |

No `api_key`/`api_key_header` (no admin credential — that mechanism is for connectors like ProWorkflow with an account-level key). Re-running the wizard updates this same secret; a legacy `connector-cin7-core` company secret, if present, is migrated and deleted on save.

### 4.2 Prerequisite on the Cin7 side

Before users connect, someone with Cin7 Core access must create an API Application (**Integrations → API → New Application**) and note the **Account ID** + **Application Key**. Recommended: a **dedicated Application for Numa** (isolated 60/min budget). In multi-company setups the Account ID is per company — use the right company's ID. Webhooks (customer's own endpoints) additionally require the **Automation module add-on**.

## 5. Backend request flow (oauth-workspace-tools)

> File: `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`

The agent calls `numa integrations request cin7-core GET "/Product?page=1&limit=100"`, routed to `handle_connect_request`, which:

1. Expands the relative URL against the stored `base_url` (`_resolve_connector_base_url` → `https://inventory.dearsystems.com/externalapi/v2` + `/Product...`).
2. Resolves auth in `do_request`: an OAuth token first (none for this connector), then — because a `credential_header_map` is present on `connector-config-cin7-core` — the **`if header_map:` custom-header branch** wins ahead of any `connector_type`/Basic/token fallback. It reads the user's `connector-cin7-core` personal-vault fields (`_user_connector_fields`) and calls `_headers_from_fields(header_map, fields)`, resolving each mapped field into its header and building **both** custom headers. **All-or-nothing:** if either mapped field is missing, `_headers_from_fields` returns `{}` and the user counts as not connected (`_entry_has_usable_credential` mirrors this exactly for the status payload).
3. `_connector_static_headers` contributes nothing (no `api_key`/`api_key_header` on the config).
4. No stored user credential → returns the structured `needs_credential` error (`_needs_credential_response`), surfaced as the **inline chat credential card** built from the `credential_fields` snapshot. On submit, values written to the user's personal vault (`connector-cin7-core`, fields `account_id` + `application_key`) via the PAT credentials endpoint, and the request retries.

The agent must **never** set `api-auth-accountid` or `api-auth-applicationkey` itself — both injected by the backend; the agent never sees the credentials.

## 6. Smoke test after setup

```
# Cheapest authenticated probe — account details, no business data
GET /me
→ 200 with a JSON object   — credential pair valid
→ 403                       — wrong/revoked Account ID or Application Key (re-enter via card)
→ 404                       — wrong path (check the /externalapi/v2 prefix in base_url), NOT an auth failure
```

From chat: ask the agent to "list Cin7 Core products" — first use triggers the credential card; after the user enters the Account ID + Application Key, the request retries and returns `{"Products":[...],"Total":n}`. Then spot-check `/SaleList` and `/ProductAvailability`, and `/webhooks` if event-driven flows are planned (an error there may instead mean the Automation module add-on is missing).

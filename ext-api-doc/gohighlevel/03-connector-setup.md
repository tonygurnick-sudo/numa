---
api_name: GoHighLevel
api_slug: gohighlevel
base_url: https://services.leadconnectorhq.com
auth_type: token (per-user Private Integration Token, sent as Bearer)
path_version_segment: none (version is the Version header, never a path)
call_surface: HTTP via `numa integrations request`. NOT a file-store connector.
confidence: wiring below is the real implementation; the GoHighLevel API side is NOT live-validated (no credentials yet).
companions: 02=api-spec, 04=connection-and-reauth
---

# GoHighLevel — Connector & Integration Setup

How the connector is wired into Numa: registry entry, admin wizard, storage, backend auth injection.

## 1. Product context

|              |                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vendor       | HighLevel Inc. (branded "HighLevel"; known as GoHighLevel / GHL)                                                                                               |
| Product      | all-in-one CRM + marketing platform for agencies and SMBs                                                                                                      |
| App URL      | `app.gohighlevel.com` (agencies may use white-label domains)                                                                                                   |
| API base URL | `https://services.leadconnectorhq.com` (API 2.0; fixed SaaS host, HTTPS)                                                                                       |
| Rate limits  | burst 100 req/10s + 200,000 req/day, per resource (location/company); 429 on breach with `X-RateLimit-*` headers — back off [DOCS marketplace.gohighlevel.com] |

⚠️ **API 2.0 only** — legacy API 1.0 (`rest.gohighlevel.com`) is deprecated; never call it.
⚠️ **No webhooks on this connector** — they require an OAuth marketplace app, not a PIT. Polling only.

## 2. Auth model — Bearer PIT (per-user) + per-request Version header

Every call carries two GoHighLevel-specific headers:

```
Authorization: Bearer pit-…        ← injected by the Numa backend (the secret)
Version: 2021-07-28                ← injected by the Numa backend as a static header (a constant, not a secret); agent may override per-call (e.g. 2023-02-21 for the newest contacts schema)
```

- **PIT** — created in HighLevel → Settings → Private Integrations → Create New Integration. Scopes chosen at creation; issued per sub-account (location); begins `pit-`.
- The PIT is a **per-user secret in Numa**: pasted into the inline chat credential card on first use (stored as `api_key` in the personal vault). The admin wizard collects **no credential**.
- The **Version header is mandatory** and selects the response shape. The backend **adds it automatically** from the registry's `staticHeaders` (`Version: 2021-07-28`), persisted to the company config secret as `static_headers` and merged into every request by `_connector_static_headers`. The agent does **not** need to set it — but a per-call `--headers '{"Version":"2023-02-21"}'` still wins (caller-supplied headers merge last), so use that to pin a specific endpoint family to a newer schema.
- **Scope quirk:** a **403 means the PIT lacks a scope** chosen at creation — not bad credentials (that's 401). Fixed in HighLevel, never in Numa. See 04 §4.

## 3. Connector registry entry

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

```typescript
{
  id: 'gohighlevel',
  displayName: 'GoHighLevel',
  icon: 'bi-megaphone',
  description: 'CRM, marketing automation and sales pipelines (HighLevel)',
  category: 'CRM',
  authType: 'token',
  baseUrl: 'https://services.leadconnectorhq.com',
  cachingPolicy: CACHING_PRESETS.projectManagement,
  // PIT ("pit-...") from HighLevel → Settings → Private Integrations, sent as Bearer;
  // every request also needs a `Version` header — injected automatically by the
  // backend from staticHeaders (agent can override per-call for a newer schema).
  staticHeaders: { Version: '2021-07-28' },
  credentialFields: [
    {
      key: 'api_key',
      label: 'dataConnectors.fields.pat',          // "Personal Access Token"
      type: 'password',
      placeholder: 'pit-…',
      required: true,
      helpText: 'dataConnectors.fields.gohighlevelTokenHint',
    },
  ],
}
```

- `authType: 'token'` routes to the **single-token Bearer** credential path (same as Fergus/Workbench), with the PIT in the `api_key` vault field — the first key `_user_connector_token` looks for.
- **No `adminFields`** — the admin flow is register + metadata only.
- `staticHeaders: { Version: '2021-07-28' }`: the only account-level header GHL requires on every call; the wizard persists it as `static_headers` JSON and the backend merges it in. This is the connector's one non-secret constant header.
- No `rateLimitRpm`/`rateLimitDaily`: GHL's published limits are **burst-based** (100 req/10s, 200,000/day per location/company), not a flat per-minute quota, and the generic request path enforces no proactive cap — it surfaces the 429 to the agent, which backs off. Leaving these unset is intentional (a misleading RPM number would imply enforcement that doesn't exist). Admins can still enter advisory overrides in the wizard's advanced section.
- `helpText` i18n key (`gohighlevelTokenHint`, `locales/en/integrations.json`) tells the user where the PIT comes from and that 401/403 usually means a missing scope.

The slug is also in `infra/config/connectors.ts` → `NATIVE_CONNECTORS` (under "CRM / marketing"), feeding the unified Integrations catalog endpoint, and in `_NATIVE_CONNECTOR_SLUGS` in `lambdas/python/workspace-chat-tools/tools/user_profile.py` (the Python mirror that gates `integration:{slug}` memory scoping) — both lists are in sync.

## 4. Admin setup (Integrations → GoHighLevel)

Uses the generic `ApiKeyWizard` (`wizards/ApiKeyWizard.tsx`):

1. Open Integrations, pick GoHighLevel, start the wizard.
2. Step 1 (overview): per-user notice — _no credential needed here_; each user is asked for their own PIT the first time they use the connector from chat.
3. Step 2 (review & save): metadata only. **Leave Instance URL empty** (fixed-host SaaS; the registry `baseUrl` is used). Optional: override display name/icon/description or rate limits.
4. Save → step 3 confirms. No credentials collected anywhere in this flow.

### 4.1 What gets stored — company secret `connector-config-gohighlevel`

Single company vault secret (category "Connector Config"):
| Field | Value |
| --- | --- |
| `display_name` | `GoHighLevel` (or admin override) |
| `icon`, `description` | registry defaults / admin overrides |
| `connector_type` | `token` |
| `base_url` | `https://services.leadconnectorhq.com` — written from the registry when no instance URL is entered |
| `credential_fields` | JSON snapshot of the per-user field (`api_key`, password, `pit-…` placeholder) — drives the inline chat credential card |
| `static_headers` | `{"Version":"2021-07-28"}` (JSON) — the constant Version header merged into every outbound request by `_connector_static_headers` |
No `api_key`/`api_key_header` (no admin credential carried as a header) and no `credential_header_map` (Cin7 Core-style custom-header auth only). Re-running the wizard updates this same secret; a legacy `connector-gohighlevel` company secret is migrated and deleted on save.

### 4.2 Prerequisite on the GoHighLevel side

Before users connect, someone with access to the relevant sub-account must create a Private Integration (Settings → Private Integrations → Create New Integration) and select the scopes Numa needs — view scopes for the queried modules (Contacts, Conversations, Opportunities, Calendars, Payments, Locations, Custom Fields …); edit scopes only if writes are agreed. A missing scope surfaces later as a 403, fixed by editing/recreating the integration. PITs are per sub-account: multi-location agencies need a PIT from the right location.

## 5. Backend request flow (oauth-workspace-tools)

File: `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`
The agent calls `numa integrations request gohighlevel GET "/contacts/search?locationId=…&limit=100" --headers '{"Version":"2021-07-28"}'`. `handle_connect_request` then:

1. Expands the relative URL against the stored `base_url` (`_resolve_connector_base_url` → `https://services.leadconnectorhq.com` + `/contacts/search…`).
2. Looks for an OAuth token (none), then the per-user token via **`_user_connector_token`** — the user's `connector-gohighlevel` personal-vault secret, first populated of `api_key`/`bearer_token`/`access_token`/`token` — and builds `Authorization: Bearer pit-…` (default Bearer scheme; no `_auth_header_scheme` override).
3. `_connector_static_headers` contributes the `Version: 2021-07-28` header from the config secret's `static_headers` JSON (no `api_key`/`api_key_header` is set, so no account credential header). Any agent-supplied `--headers` (e.g. a `Version` override) merge last and win.
4. No stored user credential → returns the structured `needs_credential` error (`_needs_credential_response`), surfaced as the **inline chat credential card** built from the `credential_fields` snapshot. On submit the PIT is written to the user's personal vault (`connector-gohighlevel`, field `api_key`) via the PAT credentials endpoint, and the request retries.

The agent must **never** set `Authorization` (backend-injected; agent never sees the token). It does **not** need to set `Version` either (backend-injected from `static_headers`) — only pass `--headers '{"Version":"2023-02-21"}'` when deliberately pinning an endpoint family to a newer schema.

## 6. Smoke test after setup

```http
# Cheapest authenticated probe (needs the Locations view scope).
# Both headers below are backend-injected; the agent sends neither.
GET https://services.leadconnectorhq.com/locations/search?limit=1
Authorization: Bearer pit-…      ← from the user's vault
Version: 2021-07-28              ← from static_headers
→ 200 { locations: [...] }   — token valid, scope present; note the locationId
→ 401                        — bad/rotated/revoked PIT
→ 403                        — token VALID but the PIT lacks the Locations scope (fix in HighLevel)
```

From chat: ask the agent to "list my GoHighLevel pipelines" — first use triggers the credential card; after the user pastes the PIT, the request retries and returns the pipelines. Then spot-check each module the customer cares about (Contacts, Conversations, Opportunities, Payments) to surface missing scopes before real use.

---
api_name: ProWorkflow
api_slug: proworkflow
auth: dual — per-user username/password (Basic) + account API key (apikey header); NO OAuth
base_url: https://api.proworkflow.net
doc: connector setup — registry entry, admin wizard, secret storage, backend request flow
confidence: live-verified against trial "ArcanumAI" (Advanced plan) 2026-06-10
---

# ProWorkflow — Connector & Integration Setup

## 1. Product context

|              |                                                           |
| ------------ | --------------------------------------------------------- |
| Vendor       | ProActive Software Ltd (New Zealand)                      |
| Product      | ProWorkflow — project, task and time management           |
| App URL      | `https://app.proworkflow.com/<AccountSlug>`               |
| API base URL | `https://api.proworkflow.net` (single shared host, HTTPS) |
| Rate limit   | 500 req / 30s per account API key (registry: 1000 RPM)    |

## 2. Auth model — two mechanisms on EVERY request

ProWorkflow has **no OAuth**. Every call carries both:

1. **`apikey: <account API key>` header** — one key per account, admin-managed.
2. **HTTP Basic auth** — the individual user's ProWorkflow email + password. ProWorkflow enforces that user's own permissions server-side ("View Work" rules from the main app).

Maps onto Numa's two-secret model: API key = account-level config (company vault), Basic credentials = per-user (personal vault, captured in chat). The admin never collects user passwords.
A missing/bad API key **or** bad user credentials both return **401 with an empty body** — see `04-connection-and-reauth.md` for how to tell them apart.

## 3. Connector Registry entry

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

```typescript
{
  id: 'proworkflow',
  displayName: 'ProWorkflow',
  icon: 'bi-kanban',
  description: 'Project, task and time management platform',
  category: 'Project Management',
  authType: 'username-password',
  baseUrl: 'https://api.proworkflow.net',
  rateLimitRpm: 1000,             // API allows 500 requests per 30s
  cachingPolicy: CACHING_PRESETS.projectManagement,
  apiKeyHeader: 'apikey',         // header carrying the account key
  adminFields: [                  // admin-entered, account-level
    { key: 'api_key', type: 'password', required: true, ... },
  ],
  credentialFields: [             // per-user, captured in chat
    { key: 'username', type: 'text', required: true },     // ProWorkflow email
    { key: 'password', type: 'password', required: true },
  ],
}
```

`adminFields` is the registry concept introduced for ProWorkflow: account-level config the **admin** supplies in the wizard, distinct from `credentialFields` which each **user** supplies in chat on first use.

## 4. Admin setup (Integrations → ProWorkflow)

Uses the generic `ApiKeyWizard` (`wizards/ApiKeyWizard.tsx`):

1. Open Integrations, pick ProWorkflow, start the wizard.
2. Step 1 (overview): explains the split — admin enters the account-level key now; each user is asked for their own login on first chat use.
3. Step 2 (review & save): enter the **account API key** under "Account configuration". Instance URL stays empty (ProWorkflow is a fixed-host SaaS).
4. Save → step 3 confirms. No per-user credentials collected here.

### 4.1 Where the admin finds the API key

Two routes, both verified:

- **ProWorkflow Client Area** — visible to the **Account Holder only**. Other admins ask the Account Holder or use the API route below.
- **`GET https://api.proworkflow.net/login?url=<account-slug>`** with **Basic auth only** (the user's own email + password — no apikey for this one call). Returns account details including `apikey`, `accounturl`, `plan`, `permissions`. Slug = the path segment of the account's app URL — for `https://app.proworkflow.com/ArcanumAI` it's `arcanumai` (case-insensitive).

### 4.2 What gets stored — company secret `connector-config-proworkflow`

| Field                 | Value                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `display_name`        | `ProWorkflow` (or admin override)                                                               |
| `icon`, `description` | registry defaults / admin overrides                                                             |
| `connector_type`      | `username-password`                                                                             |
| `base_url`            | `https://api.proworkflow.net` (from registry when no instance URL entered)                      |
| `api_key`             | the account API key (admin-entered)                                                             |
| `api_key_header`      | `apikey` (from the registry's `apiKeyHeader`)                                                   |
| `credential_fields`   | JSON snapshot of per-user fields (username + password) — drives the inline chat credential card |
| `rate_limit_rpm`      | optional admin override                                                                         |

Re-running the wizard updates this same secret — that is also the **API key rotation** path (see `04-connection-and-reauth.md`).

## 5. Backend request flow (oauth-workspace-tools)

File: `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`
The agent calls `connectors(name="request", params={connector:"proworkflow", url:"/projects?pagesize=20&pagenumber=1", ...})`. `handle_connect_request` then:

1. Expands relative URLs against the stored `base_url` (`_resolve_connector_base_url`).
2. Looks for an OAuth token (none), then a single per-user token (none), then `_user_connector_basic_creds` → the user's `connector-proworkflow` personal-vault secret → `Authorization: Basic base64(username:password)`.
3. Merges `_connector_static_headers` → `apikey: <account key>` from `connector-config-proworkflow` (`api_key` + `api_key_header`).
4. No stored user credential → returns the structured `needs_credential` error (`_needs_credential_response`), surfaced as the inline chat credential card built from the `credential_fields` snapshot.

The agent must **never** set `Authorization` or `apikey` headers itself — both are backend-injected and the agent never sees the secrets.

## 6. Smoke test after setup

```http
# 1. Account key + slug sanity (Basic auth only — no apikey)
GET https://api.proworkflow.net/login?url=<account-slug>
→ 200 with { apikey, accounturl, plan, permissions, ... }

# 2. Full dual-auth check (apikey header + Basic auth)
GET https://api.proworkflow.net/contacts/me
→ 200 {"status":"Success", ...}    — both mechanisms valid
→ 401 (empty body)                 — bad apikey OR bad user credentials
```

From chat: ask "list my ProWorkflow projects" — first use triggers the credential card; after the user enters email + password the request retries and returns the project list.

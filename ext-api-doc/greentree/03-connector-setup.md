---
api_name: 'MYOB Greentree'
api_slug: 'greentree'
auth_type: 'username-password (per-user Basic) + account-level ApiKey header'
generated_date: '2026-06-11'
---

# MYOB Greentree — Connector & Integration Setup

> How the Greentree connector is wired into Numa: customer-side prerequisites, registry
> entry, admin wizard flow, what gets stored where, and how the backend injects auth.
> Greentree combines both connector twins — **customer-hosted** (instance URL required,
> like Jiwa) and **dual-auth** (account ApiKey header + per-user Basic, like ProWorkflow).
>
> ⚠️ **Not live-validated** — no test instance, no credentials; auth/hosting facts come
> from MYOB Greentree's official Knowledge Base. **NOT OAuth** — HTTP Basic + `ApiKey`
> header. Verify before first customer use.

---

## 1. Product context

|                       |                                                                                  |
| --------------------- | -------------------------------------------------------------------------------- |
| Vendor                | MYOB Greentree (formerly Greentree International)                                 |
| Product               | Greentree — enterprise ERP (GL, AR/AP, sales/purchase orders, inventory, job costing, HR, CRM, fixed assets) |
| API framework         | RESTful HTTP over the Greentree **Jade** database — the API is **its own web server** (no IIS) [DOCS] |
| Versioning            | None — ships with the Greentree product; feature availability tracks the release [DOCS] |
| Hosting               | **Customer-hosted, on-premise only** — per-customer instance URL, default port **9000** [DOCS] |
| Per-customer instance | `http(s)://{customer-host}:{port}` — there is no central cloud API                |
| Company code          | Part of **every** URL path (e.g. `/01/...`) — commonly `01`; confirm per customer [DOCS] |

---

## 2. Customer prerequisites (the customer-IT conversation)

The Greentree API is its own web server on the customer's box (default port 9000, no IIS). Because
Numa calls it from AWS, the customer's IT must have all of the following in place before the
connector can work — **Numa cannot probe or fix any of them remotely** (same shape as Jiwa):

1. **API enabled and running** — as its own Windows service or as part of the database service
   (`ServerApplication<n>=ApiSchema,ApiStartup` in `[JadeServer]`); from 2021.4+ it **must** run
   inside the database service. `[GreentreeApi]` in `jadegt.ini` sets the listen port. [DOCS]
2. **HTTPS / internet-reachable** — the docs' examples use internal `http://...:9000`; Numa calls
   from AWS, so the instance must be published over **HTTPS** — typically a **reverse proxy** (the KB
   article "Achieving an SSL connection by configuring IIS as a Reverse Proxy") or **Cloudflare** /
   port-forward with a valid TLS cert. IP-whitelisting must allow Numa's egress IPs (ask Arcanum). [DOCS]
3. **Company code known** — every API URL embeds the Greentree company code (e.g. `01`); the agent
   includes it in every relative URL. Confirm the customer's code at kickoff. [DOCS]
4. **Site serial number (the ApiKey)** — the account-level `ApiKey` is the Greentree **site serial
   number**, found in **licensing / About** (or from the Greentree admin); admin enters it in the wizard. [DOCS]
5. **A Greentree login per Numa user** — each user authenticates with their **own** Greentree
   username + password; the API runs with exactly that user's permissions (set least-privilege Greentree-side). [DOCS]

Items 1–3 are one-off customer-side infrastructure work — treat them as the kickoff-call checklist.

---

## 3. Auth model — account ApiKey header + per-user Basic [DOCS]

Greentree requires **two mechanisms on every request** (no OAuth, no tokens, no expiry/refresh):

1. **`ApiKey` header** — the site serial number; account-level; **admin-entered once** in the wizard
   and sent on every call.
2. **HTTP Basic** — the *individual user's* Greentree login (email/username + password); captured in
   chat on first use; Greentree enforces that user's own permissions server-side.

This maps cleanly onto Numa's two-secret model: the ApiKey is account-level config (company vault),
the Basic credentials are per-user (personal vault). The admin never collects user passwords. The
only company-level config beyond the ApiKey is the **instance URL** (customer-hosted — no fixed base
URL).

---

## 4. Connector Registry entry

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

```typescript
{
  id: 'greentree',
  displayName: 'MYOB Greentree',
  icon: 'bi-tree',
  description: 'Enterprise ERP — GL, AR/AP, job costing, inventory, HR, purchasing',
  category: 'ERP',
  authType: 'username-password',
  instanceUrlRequired: true,          // customer-hosted: admin MUST set the instance URL
  cachingPolicy: CACHING_PRESETS.projectManagement,
  apiKeyHeader: 'ApiKey',             // header that carries the account-level site serial
  adminFields: [                      // admin-entered, account-level
    { key: 'api_key', label: 'dataConnectors.fields.greentreeApiKey',
      type: 'password', placeholder: 'Greentree site serial number', required: true,
      helpText: 'dataConnectors.fields.greentreeApiKeyHint' },
  ],
  credentialFields: [                 // per-user, captured in chat
    { key: 'username', label: 'dataConnectors.fields.username', type: 'text',
      placeholder: 'Your Greentree username', required: true,
      helpText: 'dataConnectors.fields.greentreeUserHint' },
    { key: 'password', label: 'dataConnectors.fields.password', type: 'password',
      placeholder: 'Your Greentree password', required: true },
  ],
}
```

This entry combines both twins: `instanceUrlRequired: true` with **no `baseUrl`** is the
Jiwa/customer-hosted half (admin must set the instance URL — no fixed cloud host); `apiKeyHeader:
'ApiKey'` + `adminFields: [api_key]` is the ProWorkflow/dual-auth half (the account-level site
serial, admin-entered, sent as the `ApiKey` header); `authType: 'username-password'` +
`credentialFields: [username, password]` is the per-user Basic login captured in chat.

`greentree` is also listed in `NATIVE_CONNECTORS` in `infra/config/connectors.ts` (under the
"Username/password (per-user Basic auth + admin-level account API key)" group, alongside
`proworkflow` and `betterimpact`) — the catalog listing that exposes the connector to the backend.

---

## 5. Admin setup (Integrations → MYOB Greentree)

The admin flow uses the generic `ApiKeyWizard` (`wizards/ApiKeyWizard.tsx`):

1. Open **Integrations**, pick **MYOB Greentree**, start the wizard.
2. Step 1 (overview) explains the split: the admin enters the account-level **site ApiKey** and the
   **instance URL** now; each user is additionally asked for their own Greentree login on first chat
   use.
3. Step 2 (review & save) — under "Account configuration" enter the **Site ApiKey (serial number)**,
   and enter the **Instance URL**.

   > ⚠️ **Instance URL is REQUIRED for Greentree** (`instanceUrlRequired: true`). Greentree is
   > customer-hosted with no registry `baseUrl` fallback, so left blank every relative request from
   > chat fails with `"No base URL is configured for connector 'greentree'"`. Enter the full HTTPS
   > URL of the customer's API, e.g. `https://greentree.customer.com.au` (or with an explicit port,
   > `https://greentree.customer.com.au:9000`). The wizard validates http(s) URL structure only — it
   > does not probe the host. **Do not put the company code in the instance URL** — it belongs in the
   > per-request path (`/01/...`).

4. Save → step 3 confirms. No per-user credentials are collected here. Re-running the wizard updates
   the same secret — this is also how to fix a wrong/changed instance URL **or** rotate the ApiKey.

### 5.1 Where the admin finds the ApiKey (site serial number)

The `ApiKey` is the **Greentree site serial number** — an account-level value, the same for every
user of that Greentree site. Find it in the Greentree **licensing / About** screen, or ask the
Greentree administrator. It is not a per-user secret and not something a user generates. [DOCS]

### 5.2 What gets stored — company secret `connector-config-greentree`

The wizard persists a single company vault secret (company-secret writes **merge** fields):

| Field               | Value                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| `display_name`      | `MYOB Greentree` (or admin override)                                               |
| `icon`, `description` | Registry defaults / admin overrides                                              |
| `connector_type`    | `username-password`                                                                |
| `instance_url`      | Admin-entered API base, e.g. `https://greentree.customer.com.au` (**required**)    |
| `api_key`           | The site serial number (admin-entered)                                             |
| `api_key_header`    | `ApiKey` (from the registry's `apiKeyHeader`)                                      |
| `credential_fields` | JSON snapshot of the per-user fields (username + password) — drives the inline chat credential card |
| `rate_limit_rpm` / `rate_limit_daily` | Optional admin overrides (Greentree has no documented API limit) |

Note `instance_url` and `api_key` both live here. The serial is the only secret material at the
company level; the per-user passwords live in user vaults.

---

## 6. Backend request flow (oauth-workspace-tools)

> File: `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`

The agent calls `connectors(name="request", params={connector: "greentree", url: "/01/GLAccount?page=1&pageSize=50", method: "GET"})`.
`handle_connect_request` then:

1. Expands the relative URL against `instance_url` from `connector-config-greentree`
   (`_resolve_connector_base_url` — generic vault lookup, no per-connector branching; precedence is
   `api_endpoint` → `instance_url` → `base_url`). The **company code (`01`) is already in the URL
   the agent supplied** — the backend does not add it.
2. Picks the user credential by the **declared `connector_type`**: for `username-password`,
   `_basic_from_fields` reads `username` + `password` from the user's `connector-greentree`
   personal-vault secret → `Authorization: Basic base64(username:password)`. (A stray token-like
   field on the entry cannot hijack the request — the declared type pins the auth shape.)
3. Merges in `_connector_static_headers` → `ApiKey: {site serial}` from `connector-config-greentree`
   (`api_key` + `api_key_header`).
4. No stored user credential → structured `needs_credential` error (`_needs_credential_response`) →
   inline chat credential card built from the `credential_fields` snapshot.

So every Greentree request carries `Authorization: Basic …` (user) **and** `ApiKey: …` (account).
The agent must **never** set the `Authorization` or `ApiKey` headers itself — both are injected by
the backend and the agent never sees the secrets.

---

## 7. Smoke test after setup

```http
# 1. Liveness + auth + reachability (Basic + ApiKey both injected by the backend)
GET {instance_url}/{company}/Ping
→ 200            instance reachable, ApiKey valid, user login valid
→ 401            bad Greentree login OR wrong ApiKey (serial)   [exact code UNVERIFIED]
→ 404            wrong company code / entity in the path
→ conn error     instance unreachable (TLS/firewall/service down) — not an auth issue

# 2. A representative data read (paged list)
GET {instance_url}/{company}/GLAccount?page=1&pageSize=1
→ 200 with one GL account row [UNVERIFIED response shape]
```

From chat: ask the agent to "list Greentree GL accounts for company 01" — first use triggers the
credential card; after the user enters their Greentree username + password the request retries and
returns data. [UNVERIFIED end-to-end — the card flow is the same code path as ProWorkflow.]

---
api_name: Jiwa Financials
api_slug: jiwa
doc: connector-setup
auth_type: token (per-user Staff API key, Bearer)
call_surface: HTTP via `numa integrations request` (connector jiwa) — NOT a file source, NOT OAuth, NOT Pipedream
base_url: per-customer self-hosted instance; admin sets instance_url (required — no registry baseUrl fallback)
confidence: spec/docs-derived, NOT live-validated. [DOCS]=wiki, [SPEC]=OpenAPI. Single live observation: unauthenticated `GET https://api.jiwa.com.au/Debtors` → 401.
---

# Jiwa Financials — Connector & Integration Setup

How the Jiwa connector wires into Numa: customer prerequisites, registry entry, admin wizard, storage, backend auth injection.

## 1. Product context

|                       |                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Vendor                | Jiwa Financials (Australia)                                                                              |
| Product               | Jiwa — ERP for inventory, sales and distribution; SQL Server 2016+ backed                                |
| API framework         | ServiceStack REST API, shipped as a Jiwa **plugin** [DOCS]                                               |
| Minimum version       | Jiwa **8.00.00+** for the REST API; API keys exist since 7.2 [DOCS]                                      |
| Hosting               | **Self-hosted Windows service only** — per-customer instance URL [DOCS]                                  |
| Per-customer instance | `https://{customer-hostname}[:port]` — no central cloud API; `api.jiwa.com.au` is Jiwa's own hosted demo |

## 2. Customer prerequisites (the customer-IT conversation)

Jiwa 8 ships the REST API as a self-hosted Windows service installed alongside Jiwa (IIS reverse-proxy hosting **no longer supported** in v8 [DOCS]). All of the below must be in place before the connector works — items 1–5 are one-off customer-side infrastructure (kickoff-call checklist); Numa cannot probe or fix any remotely:

1. **REST API plugin enabled** — Plugin Maintenance → REST API → "Enabled" → save, re-login. The API doesn't exist until this is on [DOCS].
2. **Windows service configured** — edit `JiwaAPISelfHostedService.exe.config` (`ServerName`, `DatabaseName`, `JiwaUsername`, `JiwaPassword`, `URLBase` — trailing slash **required**). Service user needs a Jiwa licence (non-interactive is fine) [DOCS].
3. **HTTPS** — TLS is a Windows certificate binding (`netsh http add sslcert`), not a Jiwa setting. Wiki recommends **Let's Encrypt via win-acme** for auto-renewal; an expired cert makes clients (incl. Numa) refuse the connection [DOCS].
4. **Internet-reachable** — Numa calls from AWS, so the instance must be publicly reachable over HTTPS [DOCS]: front it with a proxy such as **Cloudflare** or apply an **IP-whitelist** (Numa's egress IPs are per-client — ask Arcanum); consider the optional **REST API Rate Limit** plugin (per-IP limits); turn **DebugMode off** (logs requests _including credentials_); don't run the service as a Windows Administrator account.
5. **Route permissions set** — User Group Maintenance: set "Default REST API Permission" (Undefined/Allow/Disallow) and/or import the explicit route list from `{api}/RestPaths` and allow per route. Disallow anywhere wins; Undefined = deny unless allowed elsewhere. Permit only what's needed [DOCS].
6. **Staff API keys per Numa user** — created in **Staff Maintenance** (see `04-connection-and-reauth.md`). **Staff** keys only (never Debtor keys); don't issue keys to privileged/admin Jiwa accounts [DOCS].

## 3. Auth model — per-user Staff API key, Bearer [DOCS]

Numa uses **API keys only** (not Jiwa's session auth): no auth step, the key travels on every request as `Authorization: Bearer {api_key}`. Keys bind to a Jiwa staff member and carry exactly that member's route permissions — two Numa users in different Jiwa user groups see different data through the same connector. **No account-level credential**: the only company-level config is the **instance URL**; each user's Staff key is captured in chat on first use.

## 4. Connector Registry entry

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

```typescript
{
  id: 'jiwa',
  displayName: 'Jiwa Financials',
  icon: 'bi-box-seam',
  description: 'ERP for inventory, sales and distribution businesses',
  category: 'ERP',
  authType: 'token',
  cachingPolicy: CACHING_PRESETS.projectManagement,
  // Customer-hosted — no fixed cloud base URL. The admin MUST set the
  // instance URL in the wizard; the API must be reachable over HTTPS.
  credentialFields: [
    {
      key: 'api_key',
      label: 'dataConnectors.fields.apiKey',
      type: 'password',
      placeholder: 'Paste your Jiwa Staff API key',
      required: true,
      helpText: 'dataConnectors.fields.jiwaApiKeyHint',
    },
  ],
}
```

**Absent** (intentionally): no `baseUrl` (customer-hosted — see §5), no `adminFields`, no `apiKeyHeader` (the per-user key goes in `Authorization`). `jiwa` is also listed in `NATIVE_CONNECTORS` in `infra/config/connectors.ts` (Token group) — the catalog listing.

## 5. Admin setup (Integrations → Jiwa Financials)

Uses the generic `ApiKeyWizard` (`wizards/ApiKeyWizard.tsx`):

1. Open **Integrations**, pick **Jiwa Financials**, start the wizard.
2. Step 1 (overview) — no credential collected here; each user is asked for their own Staff key in chat on first use.
3. Step 2 (review & save) — enter the **Instance URL**.

   > **Instance URL is REQUIRED for Jiwa** even though the generic wizard labels it "(optional)" — that label is only correct for fixed-host SaaS connectors with a registry `baseUrl` fallback, which Jiwa lacks. Left blank, every relative request fails with `"No base URL is configured for connector 'jiwa'"`.

   Enter the full HTTPS URL, e.g. `https://jiwa.customer.com.au` (wizard validates http(s) structure only — doesn't probe the host).

4. Save → step 3 confirms. Re-running the wizard updates the same secret (also how to fix a wrong/changed instance URL).

### 5.1 What gets stored — company secret `connector-config-jiwa`

No secret material at the company level — config/metadata only.

| Field                                 | Value                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `display_name`                        | `Jiwa Financials` (or admin override)                                                                       |
| `icon`, `description`                 | Registry defaults / admin overrides                                                                         |
| `connector_type`                      | `token`                                                                                                     |
| `instance_url`                        | Admin-entered API base, e.g. `https://jiwa.customer.com.au` (**required in practice**)                      |
| `credential_fields`                   | JSON snapshot of the per-user field (`api_key`) — drives the inline chat credential card                    |
| `rate_limit_rpm` / `rate_limit_daily` | Optional admin overrides (Jiwa has no default API limit; set if the customer enables the Rate Limit plugin) |

## 6. Backend request flow (oauth-workspace-tools)

> File: `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`

Agent calls `numa integrations request` (connector `jiwa`, e.g. `GET /Inventory/{InventoryID}`). `handle_connect_request` then:

1. Expands the relative URL against `instance_url` from `connector-config-jiwa` (`_resolve_connector_base_url` — generic vault lookup, no per-connector branching).
2. Finds the user's credential — `_user_connector_token` reads `api_key` from the `connector-jiwa` secret in the **user's personal vault** → injected as `Authorization: Bearer {api_key}` (no OAuth path for Jiwa).
3. No stored credential → structured `needs_credential` error (`_needs_credential_response`) → inline chat credential card built from the `credential_fields` snapshot.

Agent must **never** set the `Authorization` header — backend injects it; agent never sees the key.

## 7. Smoke test after setup

```http
# 1. Instance reachable + key valid + permissions sane (Bearer auth)
GET {instance_url}/RestPaths
→ 200 with the full route list [DOCS — same endpoint Jiwa's own permission import uses]
→ 401 key invalid/revoked/expired · 403 route not permitted for the user's group
# 2. A representative data read (AutoQuery route)
GET {instance_url}/Queries/DebtorList
→ 200 with rows (capped by the AutoQueryMaxLimit system setting) [SPEC]
```

From chat: ask the agent to "list Jiwa debtors" — first use triggers the credential card; after the user pastes their Staff key the request retries and returns data. [UNVERIFIED end-to-end — same code path as ProWorkflow/Workbench.]

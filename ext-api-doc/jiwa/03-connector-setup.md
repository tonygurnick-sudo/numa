---
api_name: 'Jiwa Financials'
api_slug: 'jiwa'
auth_type: 'token (per-user Staff API key, Bearer)'
generated_date: '2026-06-10'
---

# Jiwa Financials — Connector & Integration Setup

> How the Jiwa connector is wired into Numa: customer-side prerequisites, registry
> entry, admin wizard flow, what gets stored where, and how the backend injects auth.
>
> ⚠️ **Not live-validated** — no test instance; everything here is from Jiwa's official
> OpenAPI spec and Atlassian wiki ([DOCS]/[SPEC]). Only live observation: unauthenticated
> `GET https://api.jiwa.com.au/Debtors` → 401. Verify before first customer use.

---

## 1. Product context

|                       |                                                                          |
| --------------------- | ------------------------------------------------------------------------ |
| Vendor                | Jiwa Financials (Australia)                                              |
| Product               | Jiwa — ERP for inventory, sales and distribution; SQL Server 2016+ backed |
| API framework         | ServiceStack REST API, shipped as a Jiwa **plugin** [DOCS]               |
| Minimum version       | Jiwa **8.00.00+** for the REST API; API keys exist since 7.2 [DOCS]      |
| Hosting               | **Self-hosted Windows service only** — per-customer instance URL [DOCS]  |
| Per-customer instance | `https://{customer-hostname}[:port]` — there is no central cloud API; `api.jiwa.com.au` is Jiwa's own hosted demo |

---

## 2. Customer prerequisites (the customer-IT conversation)

Jiwa 8 ships the REST API as a self-hosted Windows service installed alongside Jiwa
(IIS reverse-proxy hosting is **no longer supported** in v8 [DOCS]). The customer's IT
must have all of the following in place before the Numa connector can work:

1. **REST API plugin enabled** — Plugin Maintenance form → REST API → "Enabled" →
   save, then re-login to Jiwa. The API does not exist until this is on. [DOCS]
2. **Windows service configured** — edit `JiwaAPISelfHostedService.exe.config`
   (`ServerName`, `DatabaseName`, `JiwaUsername`, `JiwaPassword`, `URLBase` — trailing
   slash **required**). The service user needs a Jiwa licence (non-interactive is fine). [DOCS]
3. **HTTPS** — TLS is a Windows certificate binding (`netsh http add sslcert`), not a
   Jiwa setting. The wiki recommends **Let's Encrypt via win-acme** for auto-renewal;
   an expired certificate makes clients (including Numa) refuse the connection. [DOCS]
4. **Internet-reachable** — Numa calls the API from AWS, so the instance must be
   publicly reachable over HTTPS. The wiki's own hardening guidance applies [DOCS]:
   - front it with a proxy such as **Cloudflare**, or apply an **IP-whitelist**
     policy (Numa's egress IPs are per-client — ask Arcanum);
   - consider the optional **REST API Rate Limit** plugin (per-IP limits);
   - turn **DebugMode off** (it logs requests *including credentials*) and don't run
     the service as a Windows Administrator account.
5. **Route permissions set** — User Group Maintenance form: set "Default REST API
   Permission" (Undefined / Allow / Disallow) and/or import the explicit route list
   from `{api}/RestPaths` and allow per route. Disallow anywhere wins; Undefined =
   deny unless allowed elsewhere. Only permit what's needed. [DOCS]
6. **Staff API keys for each Numa user** — created in the **Staff Maintenance** form
   (see `04-connection-and-reauth.md`). Use **Staff** keys only — never Debtor keys —
   and don't issue keys to privileged/admin Jiwa accounts. [DOCS]

Items 1–5 are one-off customer-side infrastructure work — treat them as the kickoff-call
checklist. Numa cannot probe or fix any of them remotely.

---

## 3. Auth model — per-user Staff API key, Bearer [DOCS]

Jiwa supports two auth methods: session auth (`/auth` → `ss-id` cookie) and **API
keys**. Numa uses **API keys only**: no auth step, the key simply travels on every
request as `Authorization: Bearer {api_key}`. Keys are bound to a Jiwa staff member
and carry exactly that staff member's route permissions — two Numa users with
different Jiwa user groups see different data through the same connector.

There is **no account-level credential at all**: the only company-level config is the
**instance URL**. Each user's Staff API key is captured in chat on first use.

---

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

Note what is **absent**: no `baseUrl` (customer-hosted — see §5), no `adminFields`,
no `apiKeyHeader` (the per-user key goes in `Authorization`). `jiwa` is also listed in
`NATIVE_CONNECTORS` in `infra/config/connectors.ts` (Token group) — the catalog listing.

---

## 5. Admin setup (Integrations → Jiwa Financials)

The admin flow uses the generic `ApiKeyWizard` (`wizards/ApiKeyWizard.tsx`):

1. Open **Integrations**, pick **Jiwa Financials**, start the wizard.
2. Step 1 (overview) — explains that no credential is collected here; each user is
   asked for their own Staff API key in chat on first use.
3. Step 2 (review & save) — enter the **Instance URL**.

   > ⚠️ **Instance URL is REQUIRED for Jiwa** even though the generic wizard labels it
   > "(optional)" — that label is only correct for fixed-host SaaS connectors with a
   > registry `baseUrl` fallback, which Jiwa lacks. Left blank, every relative request
   > from chat fails with `"No base URL is configured for connector 'jiwa'"`.

   Enter the full HTTPS URL of the customer's API, e.g. `https://jiwa.customer.com.au`
   (the wizard validates http(s) structure only — it does not probe the host).
4. Save → step 3 confirms. Re-running the wizard updates the same secret (this is
   also how to fix a wrong/changed instance URL).

### 5.1 What gets stored — company secret `connector-config-jiwa`

| Field               | Value                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| `display_name`      | `Jiwa Financials` (or admin override)                                  |
| `icon`, `description` | Registry defaults / admin overrides                                  |
| `connector_type`    | `token`                                                                |
| `instance_url`      | Admin-entered API base, e.g. `https://jiwa.customer.com.au` (**required in practice**) |
| `credential_fields` | JSON snapshot of the per-user field (`api_key`) — drives the inline chat credential card |
| `rate_limit_rpm` / `rate_limit_daily` | Optional admin overrides (Jiwa has no default API limit; set these if the customer enables the Rate Limit plugin) |

No secret material lives at the company level — the secret holds config/metadata only.

---

## 6. Backend request flow (oauth-workspace-tools)

> File: `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`

The agent calls `connectors(name="request", params={connector: "jiwa", url: "/Inventory/{InventoryID}", method: "GET"})`.
`handle_connect_request` then:

1. Expands the relative URL against `instance_url` from `connector-config-jiwa`
   (`_resolve_connector_base_url` — generic vault lookup, no per-connector branching).
2. Finds the user's credential — `_user_connector_token` reads `api_key` from the
   `connector-jiwa` secret in the **user's personal vault** → injected as
   `Authorization: Bearer {api_key}` (no OAuth path exists for Jiwa).
3. No stored credential → structured `needs_credential` error
   (`_needs_credential_response`) → inline chat credential card built from the
   `credential_fields` snapshot.

The agent must **never** set the `Authorization` header itself — the backend injects
it and the agent never sees the key.

---

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

From chat: ask the agent to "list Jiwa debtors" — first use triggers the credential
card; after the user pastes their Staff API key the request retries and returns data.
[UNVERIFIED end-to-end — the card flow is the same code path as ProWorkflow/Workbench.]

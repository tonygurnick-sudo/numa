---
api_name: 'PrintIQ'
connector_id: 'printiq'
auth_type: 'username-password' # credential exchange (username/password + app_name/app_key → token)
tier: 'standard'
category: 'Manufacturing'
integration_path: 'direct-api' # Direct API via connect_request — NOT a Files browser
---

# PrintIQ -- Connector & Integration Setup

> Build/reference instructions for the PrintIQ integration in Numa.
>
> **This connector already exists in the registry.** This document **reproduces and describes the actual
> registry entry** (it is not a proposal). The registry entry is the source of truth; if it diverges from
> this doc, the registry wins — update this doc to match.
>
> **Prerequisites:** Read `00-api-investigation-questionnaire.md`, `01-llm-api-rules.md`,
> `02-api-spec-investigation.md`, and the [Numa Connectors documentation](../../documentation/connectors/README.md) first.
>
> ⚠️ **Integration path:** **Direct API via `connect_request`** — action-oriented (price/quote/order/lookup),
> **not** a Files > Remote browser. Mirrors the Fergus connector pattern.

---

## Integration Type

**Selected path:** Direct API via `connect_request` (the workspace agent calls the stored printIQ
credentials through the connector proxy to hit the IQConnect REST endpoints).

| Component                | Required? | Notes                                                                                                                                                                                 |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connector Registry entry | Yes       | **Already present** — `id: 'printiq'` in `connectorRegistry.ts` (reproduced below)                                                                                                    |
| Admin setup wizard       | Yes       | Credential wizard for `username-password` connectors (collects the 4 credential fields)                                                                                               |
| Backend provider class   | No        | This is a **Direct API** connector, **not** a Files connector — there is no `OAuthProvider` file-browser class. Requests go via the `connect_request` proxy using stored credentials. |
| Workspace agent prompt   | Yes       | `01-llm-api-rules.md` (+ companions) — always needed                                                                                                                                  |
| Feature flag             | Yes       | `DATA_CONNECTORS_ENABLED` gates the connectors surface + Secrets Vault (see frontend CLAUDE.md)                                                                                       |
| i18n keys                | Yes       | Field labels reference existing `dataConnectors.fields.*` keys (mostly already present)                                                                                               |

---

## 1. Connector Registry Entry (ACTUAL)

> **File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`**
> (the path in the upstream template — `numa-frontend/src/Config/connectorRegistry.ts` — is stale; the live
> file is under `Components/DataConnectors/`.)

This is the **verbatim** `printiq` entry as it exists in the registry today:

```typescript
{
  id: 'printiq',
  displayName: 'PrintIQ',
  icon: 'bi-printer',
  description: 'Print MIS and workflow management',
  category: 'Manufacturing',
  authType: 'username-password',
  credentialFields: [
    {
      key: 'username',
      label: 'dataConnectors.fields.username',
      type: 'text',
      placeholder: 'apiuser',
      required: true,
    },
    {
      key: 'password',
      label: 'dataConnectors.fields.password',
      type: 'password',
      placeholder: 'Enter your password',
      required: true,
    },
    {
      key: 'app_name',
      label: 'dataConnectors.fields.appName',
      type: 'text',
      placeholder: 'MyApp',
      required: true,
    },
    {
      key: 'app_key',
      label: 'dataConnectors.fields.appKey',
      type: 'password',
      placeholder: 'Paste your app key',
      required: true,
    },
  ],
},
```

**What the entry declares:**

| Property           | Value                                         | Notes                                                               |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------- |
| `id`               | `printiq`                                     | Connector ID and vault secret key base                              |
| `displayName`      | `PrintIQ`                                     | Shown in the connectors UI                                          |
| `icon`             | `bi-printer`                                  | Bootstrap Icons class (not an SVG path) — a printer glyph           |
| `description`      | `Print MIS and workflow management`           | Card subtitle                                                       |
| `category`         | `Manufacturing`                               | Connector category grouping                                         |
| `authType`         | `username-password`                           | Credential-exchange auth (NOT `oauth2`, NOT `token`, NOT `api-key`) |
| `credentialFields` | `username`, `password`, `app_name`, `app_key` | All four `required: true`                                           |

**There is intentionally NO `oauth` block** (`authUrl`/`tokenUrl`/`scopes`/`extraAuthParams`), **no
`baseUrl`**, **no `cachingPolicy`**, **no `apiReference`**, and **no `oauthSetupSteps`** on this entry — it
is a lean `username-password` entry. Compare to the OAuth connectors in the same file (which carry an `oauth`
block) and to the FileMaker entry directly above it (which has a `server_url` credential field). The
`ConnectorTemplate` type (`connectorRegistry.ts` lines ~53–110) makes all of those optional.

### ⚠️ Known gap: no instance / base URL field

The four `credentialFields` collect `username`, `password`, `app_name`, `app_key` — but **not** the
per-tenant printIQ **instance URL**, which the API cannot function without (printIQ is per-tenant; there is
no global host). The sibling **FileMaker** entry _does_ collect a host via a `server_url` field
(`type: 'url'`); printIQ does not.

**Options to resolve (decide with the user — this is a config/data-model change, not a silent fix):**

1. **Add an `instance_url` credential field** to the printIQ entry, e.g.:
   ```typescript
   { key: 'instance_url', label: 'dataConnectors.fields.instanceUrl', type: 'url',
     placeholder: 'https://myco.printiq.com', required: true }
   ```
   (`dataConnectors.fields.instanceUrl` already exists in `integrations.json` → reusable.) This is the
   cleanest fix and matches the FileMaker precedent.
2. **Capture it in connector metadata / setup** outside `credentialFields`.
3. **Ask the user at chat time** — worst option; brittle and repetitive.

Until resolved, the workspace agent rules (`01-llm-api-rules.md`) instruct the agent to **STOP and ask** for
the instance URL rather than guess a hostname.

---

## 2. Credential storage (vault)

For a `username-password` connector, the admin wizard stores the four credential values as a single secret
for the connector (keyed off `getOAuthSecretId('printiq')` → `printiq`, since there is no `oauthPlatform`).
The backend `connect_request` proxy reads that secret, performs the **token exchange** (POST the four
credentials to the printIQ token endpoint), and attaches the resulting token to the IQConnect request.

> The token-exchange path, token header name, and token lifetime are **`[INFERRED]`/`[UNKNOWN]`** — see
> `02-api-spec-investigation.md` §Authentication and `04-connection-and-reauth.md`. They must be confirmed
> against a live instance before the proxy round-trip can be trusted.

---

## 3. ext-api-doc deployment (how the agent gets these rules)

The files in this folder (`ext-api-doc/printiq/*.md`) are **deployed to S3 per client and loaded by the
workspace agent** when the connector is active. The mechanism:

- **Bucket:** `core-numa-infra-construct.ts` creates a per-client `${numaClient}-ext-api-doc` private bucket
  (exposed as `core.extApiDocBucket`).
- **Sync:** at the **end** of `infra/stacks/numa-client-stack.ts` (the "Sync ext-api-doc files to S3" block,
  ~line 1135), the stack walks `ext-api-doc/` recursively and creates an `S3Object` for **every** `.md` file
  (one resource per file, `contentType: 'text/markdown'`, keyed by its relative path, hashed via
  `Fn.filemd5`). The `_templates/` directory is **excluded** (dev-only reference; also produces invalid
  construct IDs).
- **What the agent loads:** the workspace agent loads **`01-*.md`** (the LLM API rules + companions
  `01a`–`01d`) into context when the printIQ connector is active — that is the runtime-facing material and
  why `01-llm-api-rules.md` must stay under ~300 lines. The `00`/`02`/`03`/`04` files are developer/human
  reference that also ship to the bucket but are **not** the per-request agent context.

So: **edit the docs here → they deploy to S3 on the next client stack deploy → the agent picks up the new
`01-*.md` rules.** No separate registration step is needed for the docs themselves.

---

## 4. i18n keys

The credential-field labels reference **existing** keys under `integrations.json` →
`dataConnectors.fields.*`:

| Field      | `label` key                      | English value (existing) |
| ---------- | -------------------------------- | ------------------------ |
| `username` | `dataConnectors.fields.username` | "Username"               |
| `password` | `dataConnectors.fields.password` | "Password"               |
| `app_name` | `dataConnectors.fields.appName`  | "Application Name"       |
| `app_key`  | `dataConnectors.fields.appKey`   | "Application Key"        |

If the instance-URL field is added (§1), reuse `dataConnectors.fields.instanceUrl` ("Instance URL") and its
hint `dataConnectors.fields.baseUrlHint`. Connector display name/description can use the literal
`displayName`/`description` from the registry or dedicated `connectors.printiq.*` keys if added — currently
the registry strings are used directly.

---

## 5. Deployment Checklist

### Code

- [x] Registry entry present in `connectorRegistry.ts` (`id: 'printiq'`)
- [x] Connector icon set (`bi-printer` Bootstrap Icons glyph)
- [x] `username-password` credential wizard collects all four fields
- [x] Credential-field i18n keys exist (`dataConnectors.fields.username|password|appName|appKey`)
- [ ] **Instance/base URL captured** (the open gap — see §1; decide with the user)
- [ ] Backend `connect_request` token-exchange step verified against a live instance
- [ ] ext-api-doc `01-*.md` rules finalised and deployed to the client's `*-ext-api-doc` bucket

### Auth flow (credential exchange)

- [ ] Admin wizard saves the 4 credentials to the connector vault secret
- [ ] Proxy performs the token exchange and attaches the token (header name confirmed)
- [ ] 401 handling re-mints the token (re-POST credentials)
- [ ] Disconnect deletes the stored credentials

### Workspace agent

- [ ] `01-llm-api-rules.md` (+ `01a`–`01d`) deployed and loaded when printiq is active
- [ ] Agent can price a product via `GetPrice` (once the endpoint is confirmed)
- [ ] Agent looks up quotes / jobs / customers / products by reference
- [ ] Agent confirms-first before any write (create quote/customer)
- [ ] Agent STOPs and asks for the instance URL if it is missing

### CI/CD

- [ ] No new Lambda needed (Direct API via existing proxy) — confirm against the connectors checklist
- [ ] ext-api-doc files ship via the client-stack S3 sync (automatic; no matrix change)

---

## 6. Testing Plan

> ⚠️ **None of this can be exercised end-to-end without a real printIQ instance + credentials from printIQ
> support.** The first run is a **discovery exercise** — capture real request/response pairs and re-tag the
> `[INFERRED]` items in `02-api-spec-investigation.md` and `01-*.md`.

### Manual sequence

1. **Admin setup:** add the PrintIQ connector via the credential wizard; enter `username`, `password`,
   `app_name`, `app_key` (and the instance URL once the gap is resolved).
2. **Token exchange:** confirm the proxy mints a token against the instance token endpoint.
3. **GetPrice:** ask the agent to price a known product + spec + quantity; verify against printIQ.
4. **Reads:** ask the agent to fetch a quote, a job/order status, and a customer by reference.
5. **Write (confirm-first):** ask the agent to create/save a draft quote — verify it confirms before POSTing.
6. **Disconnect:** remove the connector; verify the stored credentials are deleted.

### Edge cases

- [ ] Missing instance URL → agent asks rather than guessing
- [ ] Expired token → proxy re-mints (re-POST credentials)
- [ ] Wrong token header → 401 even with good credentials (try Bearer / custom header / query token)
- [ ] REST-vs-XML mismatch on a malformed-body 400
- [ ] Rate limiting (limits unknown — back off conservatively)

---

_Generated from the investigation questionnaire (web research only; partner-gated docs; no live call)._
_Registry entry reproduced verbatim from `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`._
_See also: `02-api-spec-investigation.md`, `04-connection-and-reauth.md`, and the
[Connector Framework Documentation](../../documentation/connectors/README.md)._

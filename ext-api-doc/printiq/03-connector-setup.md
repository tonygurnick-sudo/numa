---
api_name: PrintIQ
connector_id: printiq
auth_type: username-password (credential exchange: username/password + app_name/app_key → token)
tier: standard
category: Manufacturing
integration_path: direct-api (Direct API via connect_request — NOT a Files browser, NOT MCP)
status: connector ALREADY EXISTS in the registry; this doc reproduces the actual entry (registry wins if it diverges)
prerequisites: read 00-questionnaire, 01-llm-api-rules, 02-api-spec-investigation, documentation/connectors/README.md
---

# PrintIQ — Connector & Integration Setup

Build/reference for the printIQ integration in Numa. Integration path: **Direct API via `connect_request`** (action-oriented — price/quote/order/lookup), NOT a Files > Remote browser. Mirrors the Fergus connector pattern.

## Integration Type

The workspace agent calls the stored printIQ credentials through the connector proxy to hit the IQConnect REST endpoints.
| Component | Required? | Notes |
| --- | --- | --- |
| Connector Registry entry | Yes | **Already present** — `id: 'printiq'` in `connectorRegistry.ts` (reproduced below) |
| Admin setup wizard | Yes | Credential wizard for `username-password` connectors (collects the 4 fields) |
| Backend provider class | No | Direct API connector, NOT a Files connector — no `OAuthProvider` file-browser class. Requests go via the `connect_request` proxy using stored credentials |
| Workspace agent prompt | Yes | `01-llm-api-rules.md` (+ companions) |
| Feature flag | Yes | `DATA_CONNECTORS_ENABLED` gates the connectors surface + Secrets Vault |
| i18n keys | Yes | Field labels reference existing `dataConnectors.fields.*` keys |

## 1. Connector Registry Entry (ACTUAL — verbatim)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (the upstream-template path `numa-frontend/src/Config/connectorRegistry.ts` is stale; live file is under `Components/DataConnectors/`).

```typescript
{
  id: 'printiq',
  displayName: 'PrintIQ',
  icon: 'bi-printer',
  description: 'Print MIS and workflow management',
  category: 'Manufacturing',
  authType: 'username-password',
  credentialFields: [
    { key: 'username', label: 'dataConnectors.fields.username', type: 'text', placeholder: 'apiuser', required: true },
    { key: 'password', label: 'dataConnectors.fields.password', type: 'password', placeholder: 'Enter your password', required: true },
    { key: 'app_name', label: 'dataConnectors.fields.appName', type: 'text', placeholder: 'MyApp', required: true },
    { key: 'app_key', label: 'dataConnectors.fields.appKey', type: 'password', placeholder: 'Paste your app key', required: true },
  ],
},
```

What it declares: `id`=`printiq` (connector ID + vault secret key base) · `displayName`=`PrintIQ` · `icon`=`bi-printer` (Bootstrap Icons class, not an SVG path) · `description`=`Print MIS and workflow management` · `category`=`Manufacturing` · `authType`=`username-password` (NOT `oauth2`/`token`/`api-key`) · `credentialFields`=`username`, `password`, `app_name`, `app_key` (all `required: true`).

Intentionally NO `oauth` block (`authUrl`/`tokenUrl`/`scopes`/`extraAuthParams`), NO `baseUrl`, NO `cachingPolicy`, NO `apiReference`, NO `oauthSetupSteps` — a lean `username-password` entry. Compare to OAuth connectors (which carry an `oauth` block) and to the FileMaker entry directly above (which has a `server_url` credential field). The `ConnectorTemplate` type (`connectorRegistry.ts` ~lines 53–110) makes all of those optional.

### Known gap: no instance / base URL field

The four `credentialFields` do NOT include the per-tenant printIQ **instance URL**, which the API cannot function without (printIQ is per-tenant; no global host). The sibling **FileMaker** entry DOES collect a host via a `server_url` field (`type: 'url'`); printIQ does not.
Resolution options (decide with the user — a config/data-model change, not a silent fix):

1. **Add an `instance_url` credential field** (cleanest; matches FileMaker precedent): `{ key: 'instance_url', label: 'dataConnectors.fields.instanceUrl', type: 'url', placeholder: 'https://myco.printiq.com', required: true }` (`dataConnectors.fields.instanceUrl` already exists in `integrations.json` → reusable).
2. **Capture it in connector metadata / setup** outside `credentialFields`.
3. **Ask the user at chat time** — worst option; brittle and repetitive.
   Until resolved, `01-llm-api-rules.md` instructs the agent to STOP and ask for the instance URL rather than guess a hostname.

## 2. Credential storage (vault)

For a `username-password` connector, the admin wizard stores the four values as a single secret keyed off `getOAuthSecretId('printiq')` → `printiq` (no `oauthPlatform`). The backend `connect_request` proxy reads that secret, performs the **token exchange** (POST the four credentials to the printIQ token endpoint), and attaches the resulting token to the IQConnect request. Token-exchange path, header name, and lifetime are `[INFERRED]`/`[UNKNOWN]` (see 02 §Authentication and 04) — confirm against a live instance before trusting the proxy round-trip.

## 3. ext-api-doc deployment (how the agent gets these rules)

`ext-api-doc/printiq/*.md` are deployed to S3 per client and loaded by the workspace agent when the connector is active:

- **Bucket:** `core-numa-infra-construct.ts` creates a per-client `${numaClient}-ext-api-doc` private bucket (exposed as `core.extApiDocBucket`).
- **Sync:** at the end of `infra/stacks/numa-client-stack.ts` ("Sync ext-api-doc files to S3" block, ~line 1135), the stack walks `ext-api-doc/` recursively and creates an `S3Object` for EVERY `.md` file (one resource per file, `contentType: 'text/markdown'`, keyed by relative path, hashed via `Fn.filemd5`). `_templates/` is excluded (dev-only; also produces invalid construct IDs).
- **What the agent loads:** `01-*.md` (LLM API rules + companions `01a`–`01d`) into context when printiq is active — that is the runtime-facing material, why `01-llm-api-rules.md` stays under ~300 lines. The `00`/`02`/`03`/`04` files are developer/human reference that also ship to the bucket but are NOT the per-request agent context.
  Edit docs here → they deploy to S3 on the next client stack deploy → the agent picks up the new `01-*.md` rules. No separate registration step for the docs.

## 4. i18n keys

Credential-field labels reference EXISTING keys under `integrations.json` → `dataConnectors.fields.*`: `username`→`dataConnectors.fields.username` ("Username") · `password`→`dataConnectors.fields.password` ("Password") · `app_name`→`dataConnectors.fields.appName` ("Application Name") · `app_key`→`dataConnectors.fields.appKey` ("Application Key").
If the instance-URL field is added (§1), reuse `dataConnectors.fields.instanceUrl` ("Instance URL") + its hint `dataConnectors.fields.baseUrlHint`. Display name/description use the literal registry strings (or dedicated `connectors.printiq.*` keys if added — currently registry strings are used directly).

## 5. Deployment Checklist

**Code:** [x] Registry entry present (`id: 'printiq'`) · [x] Icon set (`bi-printer`) · [x] `username-password` wizard collects all 4 fields · [x] Credential-field i18n keys exist · [ ] **Instance/base URL captured** (open gap, §1) · [ ] Backend `connect_request` token-exchange verified live · [ ] ext-api-doc `01-*.md` finalised and deployed.
**Auth flow (credential exchange):** [ ] Wizard saves the 4 credentials to the vault secret · [ ] Proxy performs token exchange + attaches token (header name confirmed) · [ ] 401 handling re-mints the token (re-POST credentials) · [ ] Disconnect deletes stored credentials.
**Workspace agent:** [ ] `01-*` deployed + loaded when printiq active · [ ] Agent prices a product via `GetPrice` (once endpoint confirmed) · [ ] Agent looks up quotes/jobs/customers/products by reference · [ ] Agent confirms-first before any write · [ ] Agent STOPs and asks for the instance URL if missing.
**CI/CD:** [ ] No new Lambda (Direct API via existing proxy) — confirm against the connectors checklist · [ ] ext-api-doc ships via the client-stack S3 sync (automatic; no matrix change).

## 6. Testing Plan

None of this can be exercised end-to-end without a real printIQ instance + credentials from printIQ support. The first run is a DISCOVERY exercise — capture real request/response pairs and re-tag the `[INFERRED]` items in 02 and 01-\*.
Manual sequence: (1) Admin setup — add the connector via the wizard; enter `username`, `password`, `app_name`, `app_key` (and the instance URL once the gap is resolved). (2) Token exchange — confirm the proxy mints a token against the instance token endpoint. (3) GetPrice — price a known product + spec + quantity; verify against printIQ. (4) Reads — fetch a quote, a job/order status, a customer by reference. (5) Write (confirm-first) — create/save a draft quote; verify it confirms before POSTing. (6) Disconnect — remove the connector; verify stored credentials are deleted.
Edge cases: [ ] Missing instance URL → agent asks rather than guessing · [ ] Expired token → proxy re-mints (re-POST credentials) · [ ] Wrong token header → 401 even with good credentials (try Bearer / custom header / query token) · [ ] REST-vs-XML mismatch on a malformed-body 400 · [ ] Rate limiting (limits unknown — back off conservatively).

_Registry entry reproduced verbatim from `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`. See 02 (full API reference) and 04 (connection/reauth). Connector framework: `documentation/connectors/README.md`._

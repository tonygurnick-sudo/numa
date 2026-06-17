---
api_name: Flowingly
connector_id: flowingly
auth_type: username-password
tier: standard
category: Workflow
integration_path: direct-api (action-oriented; NOT a Files connector — no list_files/download_file)
call_surface: HTTP via `numa integrations request`; backend does the /public/authorise token exchange + re-authorise-on-401
status: connector ALREADY EXISTS in the registry — this reproduces the actual entry, not a proposal
confidence: everything API-side is [DOCUMENTED]/[INFERRED]/[UNKNOWN] from web research — NOT live-tested (see 02 discovery banner)
prereqs: read 02-api-spec-investigation.md + documentation/connectors/README.md
---

# Flowingly — Connector & Integration Setup

## Integration Type

Direct API via `numa integrations request`. Flowingly is **not** a file-browser (no `list_files`/`download_file`), so it does NOT use the Data Connector (Files) pattern. The backend performs the username/password → bearer-token exchange and re-authorises on 401.

| Component                | Required? | Notes                                                                                             |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------- |
| Connector Registry entry | Yes       | **Already present** — see §1 (verbatim)                                                           |
| Admin setup wizard       | Reused    | generic `username-password` credential-field wizard; no Flowingly-specific UI                     |
| Backend provider class   | No        | not a Files connector — no `lib/oauth-providers/` class; calls go via `numa integrations request` |
| Workspace agent prompt   | Yes       | `01-llm-api-rules.md` (+ companions) deployed to S3, loaded when active                           |
| Feature flag             | Yes       | `DATA_CONNECTORS_ENABLED` (gates connectors + Secrets Vault)                                      |
| i18n keys                | Reused    | shared `dataConnectors.fields.username`/`.password` labels — no new keys                          |

---

## 1. Connector Registry Entry (actual)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (single source of truth; type `ConnectorTemplate`). The Flowingly entry **already exists** in `CONNECTOR_REGISTRY`, verbatim:

```typescript
{
  id: 'flowingly',
  displayName: 'Flowingly',
  icon: 'bi-arrow-repeat',
  description: 'Business process management and workflow automation',
  category: 'Workflow',
  authType: 'username-password',
  credentialFields: [
    { key: 'username', label: 'dataConnectors.fields.username', type: 'text', placeholder: 'user@company.com', required: true },
    { key: 'password', label: 'dataConnectors.fields.password', type: 'password', placeholder: 'Enter your password', required: true },
  ],
},
```

Notes:

- **`authType: 'username-password'`** — no `oauth` block (no `authUrl`/`tokenUrl`/`scopes`/`extraAuthParams`), correct: Flowingly POSTs username+password to `/public/authorise` for a bearer token; the backend owns that exchange, the registry just declares the two credential fields.
- **`credentialFields`** = `username` (text, placeholder `user@company.com`) + `password`. The `username` MUST be a Flowingly **Business Administrator** email (see 04).
- **No base/instance URL field** — the host is centralised in the backend as `https://publicapi.flowingly.net/public/` [DOCUMENTED]. ⚠️ Brief's `api.flowingly.io` is unconfirmed and likely wrong; resolve during discovery before wiring the backend base URL.
- **`icon: 'bi-arrow-repeat'`** — a Bootstrap Icons glyph, not an SVG asset path.
- **`category: 'Workflow'`** — surfaces under the Workflow group in the Integrations / Files Remote picker.
- **No `cachingPolicy`** — appropriate; step field values change as users fill forms, so reads should not be cached (or only a very short TTL).
- Labels reuse shared i18n keys — no Flowingly-specific keys required.

## 2. Backend Provider Class — Not required

A `lib/oauth-providers/<id>_provider.py` is only for **Files** connectors implementing `list_files`/`download_file`/`search_files`/`get_file_metadata`. Flowingly is Direct-API with no file surface, so: no `flowingly_provider.py`; no `PROVIDER_REGISTRY` entry in `lib/oauth-providers/__init__.py`. Calls go via `numa integrations request` with the stored credentials; the backend handles `/public/authorise` + the re-authorise-on-401 loop (see 04).

## 3. Integration Prompt Deployment (ext-api-doc → S3)

The agent's Flowingly rules live in this folder and ship to each client via the normal infra deploy — **you do not hand-deploy these files.**
Mechanism — `infra/stacks/numa-client-stack.ts` (the `// ── Sync ext-api-doc files to S3 ──` block) walks the repo-root `ext-api-doc/` recursively (skipping dotfiles + the dev-only `_templates/`), creates an `S3Object` for every markdown file → uploads to the per-client **`{client}-ext-api-doc`** bucket (`core.extApiDocBucket`), preserving the relative path as the S3 key (e.g. `flowingly/01-llm-api-rules.md`), `contentType: 'text/markdown'`, with a `filemd5` `sourceHash` so changed files re-upload next deploy. Bucket name is exposed to the agent runtime via `EXT_API_DOC_BUCKET_NAME`.
Agent-facing files: the **`01-*.md`** files (loaded when the connector is active) — `01-llm-api-rules.md` (primary) + `01a`/`01b`/`01c`/`01d` companions. The **`00`/`02`/`03`/`04`** files are dev/build references (shipped too — the sync is path-agnostic — but not the agent's primary runtime context). To update agent behaviour, edit the `01-*.md` files and run a normal client deploy; no separate publish step.

## 4. i18n Keys

None required — reuse `{"dataConnectors.fields.username":"Username","dataConnectors.fields.password":"Password"}`. A Flowingly-specific blurb (if later wanted) goes under `connectors.flowingly.*`; current entry needs none.

## 5. Deployment Checklist

Code (status): [x] registry entry present (id `flowingly`, `username-password`) · [x] icon `bi-arrow-repeat` · [x] credential fields `username`+`password` with shared i18n labels · [x] reuses generic `username-password` admin wizard · [ ] N/A no backend Files provider · [ ] N/A no `PROVIDER_REGISTRY` registration · [x] `01-llm-api-rules.md` authored + shipped via ext-api-doc→S3 · [ ] **backend base URL confirmed** (`publicapi.flowingly.net` vs brief's `api.flowingly.io`) — discovery · [ ] **token exchange wired** in the `numa integrations request` backend (authorise → bearer → re-authorise on 401).
Auth flow: [ ] admin/user enters Business Administrator `username`+`password` · [ ] credentials stored in user vault (per-user secret) · [ ] backend exchanges credentials for a bearer token on first call · [ ] re-authorise on 401 verified (refreshToken is null) — see 04 · [ ] disconnect deletes the stored credential secret.
Workspace agent: [ ] can start a flow (`POST /public/startflow`) from a user-supplied model name · [ ] can read a step's fields and discover identifiers · [ ] can update step field values with correct per-type encoding · [ ] does NOT blind-retry `startflow` (not idempotent).
CI/CD: [ ] N/A — no new Lambda (no Files provider); the ext-api-doc markdown ships with the client stack.

## 6. Testing Plan

Frontend-only items testable today; API items **blocked on discovery** (no live credentials — see 02/04 banners).
Manual sequence: 1) **connect** — pick Flowingly, enter Business Administrator email + password, save; verify the credential is in the vault. 2) **authorise (backend)** — first agent call triggers `POST /public/authorise`; confirm a bearer token is obtained (verify query-string placement). 3) **start flow** — ask the agent to start a known model for a named user; verify a `FLOW-…` `flowIdentifier` returns. 4) **read step** — read the started step's fields; verify `identifier` values. 5) **update step** — populate a Text + Email + Date field; verify per-type encoding (Date `dd/MM/yyyy`, CheckBox `"true"`/`"false"`, SelectList option object). 6) **re-auth on expiry** — force/await token expiry; verify a 401 triggers a silent re-authorise + single retry. 7) **disconnect** — verify the stored credential is removed and further calls fail cleanly.
Edge cases: [ ] bad credentials → 400/401 (error placement unverified) · [ ] `success:false` on HTTP 200 (surface `errorMessage`, don't treat as success) · [ ] unknown flow model `Name` → validation error · [ ] URL-encoding of step names with spaces/parens · [ ] non-idempotent `startflow` — confirm no duplicate flows on retry.

See also: 02-api-spec-investigation.md (API reference) · 04-connection-and-reauth.md (credentials, token exchange, expiry) · documentation/connectors/README.md · registry source `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`.

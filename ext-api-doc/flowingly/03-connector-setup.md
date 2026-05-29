---
api_name: 'Flowingly'
connector_id: 'flowingly'
auth_type: 'username-password'
tier: 'standard'
category: 'Workflow'
integration_path: 'direct-api' # action-oriented; NOT a Files connector
---

# Flowingly -- Connector & Integration Setup

> Build/reference notes for the Flowingly connector in Numa. **This connector already exists** in
> the registry — this document reproduces and explains the **actual** entry, not a proposal.
>
> **Prerequisites:** Read `02-api-spec-investigation.md` and the
> [Numa Connectors documentation](../../documentation/connectors/README.md) first.
>
> ⚠️ Everything API-side is [DOCUMENTED]/[INFERRED]/[UNKNOWN] from web research — **not live-tested.**
> See the discovery banner in `02-api-spec-investigation.md`.

---

## Integration Type

**Selected path:** Direct API via `connect_request` (action-oriented). Flowingly is **not** a
file-browser (Drive/Gmail/OneDrive/Dropbox), so it does **not** use the Data Connector (Files)
pattern — there are no `list_files` / `download_file` operations. The workspace agent reaches
Flowingly through the standard direct-API mechanism (`connect_request`); the backend performs the
username/password → bearer-token exchange and re-authorises on 401.

| Component                | Required? | Notes                                                                                   |
| ------------------------ | --------- | --------------------------------------------------------------------------------------- |
| Connector Registry entry | Yes       | **Already present** — see §1 (reproduced verbatim)                                      |
| Admin setup wizard       | Reused    | Generic `username-password` credential-field wizard; no Flowingly-specific UI           |
| Backend provider class   | No        | Not a Files connector — no `lib/oauth-providers/` class. Calls go via `connect_request` |
| Workspace agent prompt   | Yes       | `01-llm-api-rules.md` (+ companions) deployed to S3 and loaded when active              |
| Feature flag             | Yes       | `DATA_CONNECTORS_ENABLED` (gates connectors + Secrets Vault)                            |
| i18n keys                | Reused    | Uses shared `dataConnectors.fields.username` / `.password` labels — no new keys needed  |

---

## 1. Connector Registry Entry (actual)

> **File:** `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
> (the single source of truth for all connector platforms — type `ConnectorTemplate`).

The Flowingly entry **already exists** in the `CONNECTOR_REGISTRY` array, reproduced verbatim:

```typescript
{
  id: 'flowingly',
  displayName: 'Flowingly',
  icon: 'bi-arrow-repeat',
  description: 'Business process management and workflow automation',
  category: 'Workflow',
  authType: 'username-password',
  credentialFields: [
    {
      key: 'username',
      label: 'dataConnectors.fields.username',
      type: 'text',
      placeholder: 'user@company.com',
      required: true,
    },
    {
      key: 'password',
      label: 'dataConnectors.fields.password',
      type: 'password',
      placeholder: 'Enter your password',
      required: true,
    },
  ],
},
```

**Notes on the actual config:**

- **`authType: 'username-password'`** — there is **no `oauth` block** (no `authUrl`/`tokenUrl`/
  `scopes`/`extraAuthParams`), which is correct: Flowingly authenticates by POSTing
  username+password to `/public/authorise` and exchanging them for a bearer token. The backend owns
  that exchange; the registry only declares the two credential fields to collect.
- **`credentialFields`** are exactly `username` (text, placeholder `user@company.com`) and
  `password` (password). The `username` MUST be a Flowingly **Business Administrator** email (see
  `04-connection-and-reauth.md`).
- **No base/instance URL field.** The registry entry stores no host. The Public API host is
  centralised in the backend as `https://publicapi.flowingly.net/public/` [DOCUMENTED]. ⚠️ The
  connector brief named `api.flowingly.io` — that host is **unconfirmed and likely wrong**; resolve
  during discovery before wiring the backend base URL.
- **`icon: 'bi-arrow-repeat'`** — a Bootstrap Icons glyph (not an SVG asset path).
- **`category: 'Workflow'`** — surfaces under the Workflow group in the Integrations / Files Remote
  picker.
- **No `cachingPolicy`** — appropriate. Step field values change as users fill forms; reads should
  not be cached (or only with a very short TTL).
- **Labels reuse shared i18n keys** (`dataConnectors.fields.username`, `dataConnectors.fields.password`)
  — no Flowingly-specific i18n keys are required.

---

## 2. Backend Provider Class

**Not required.** A `lib/oauth-providers/<id>_provider.py` class is only needed for **Files**
connectors that implement `list_files` / `download_file` / `search_files` / `get_file_metadata`.
Flowingly is a Direct-API connector with no browsable file surface, so:

- There is **no** `flowingly_provider.py`.
- There is **no** entry in `lib/oauth-providers/__init__.py` `PROVIDER_REGISTRY`.
- API calls are issued by the workspace agent via `connect_request`, using the stored credentials.
  The backend handles the `/public/authorise` token exchange and the re-authorise-on-401 loop
  described in `04-connection-and-reauth.md`.

---

## 3. Integration Prompt Deployment (ext-api-doc → S3)

The workspace agent's Flowingly rules live in this folder and are shipped to each client as part of
the normal infra deploy. **You do not hand-deploy these files.**

**Mechanism — `numa-client-stack.ts` → S3:**

- `infra/stacks/numa-client-stack.ts` walks the repo-root `ext-api-doc/` directory (recursively),
  skipping dotfiles and the dev-only `_templates/` folder, and creates an `S3Object` for every
  markdown file. (See `numa-client-stack.ts` around the `// ── Sync ext-api-doc files to S3 ──`
  block.)
- Each file is uploaded to the per-client **`{client}-ext-api-doc`** bucket
  (`core.extApiDocBucket`), preserving its relative path as the S3 key
  (e.g. `flowingly/01-llm-api-rules.md`), with `contentType: 'text/markdown'` and a
  `filemd5`-based `sourceHash` so changed files re-upload on the next deploy.
- The bucket name is exposed to the workspace agent runtime via the `EXT_API_DOC_BUCKET_NAME`
  environment variable.

**Which files the agent loads:** The **`01-*.md`** files are the agent-facing context (loaded when
the Flowingly connector is active):

- `01-llm-api-rules.md` (main rules, < 300 lines) — **the primary file the agent reads**
- `01a-domain-model-reference.md`, `01b-query-patterns.md`, `01c-mutation-patterns.md`,
  `01d-event-and-error-handling.md` — companion detail (create as needed)

The **`00-`/`02-`/`03-`/`04-`** files are developer/build references; they are shipped to the bucket
too (the sync is path-agnostic) but are reference material for engineers, not the agent's primary
runtime context.

> To update the agent's Flowingly behaviour, edit the `01-*.md` files here and run a normal client
> deploy — `numa-client-stack.ts` re-uploads the changed objects. No separate publish step.

---

## 4. i18n Keys

No new keys required. The credential field labels reuse the shared keys already present for
username/password connectors:

```json
{
  "dataConnectors.fields.username": "Username",
  "dataConnectors.fields.password": "Password"
}
```

If a Flowingly-specific setup blurb is later wanted, add it under a `connectors.flowingly.*`
namespace — but the current entry needs none.

---

## 5. Deployment Checklist

### Code (status)

- [x] Registry entry present in `connectorRegistry.ts` (id `flowingly`, `username-password`)
- [x] Icon set (`bi-arrow-repeat`, Bootstrap Icons glyph)
- [x] Credential fields defined (`username`, `password`) with shared i18n labels
- [x] Reuses the generic `username-password` admin setup wizard (no custom component needed)
- [ ] N/A — no backend Files provider class (Direct-API connector)
- [ ] N/A — no `PROVIDER_REGISTRY` registration
- [x] `01-llm-api-rules.md` authored and shipped via `ext-api-doc` → S3
- [ ] **Backend base URL confirmed** (`publicapi.flowingly.net` vs brief's `api.flowingly.io`) — discovery
- [ ] **Token exchange wired** in the `connect_request` backend (authorise → bearer → re-authorise on 401)

### Auth Flow

- [ ] User connect flow: admin/user enters Business Administrator `username` + `password`
- [ ] Credentials stored in the user vault (per-user secret)
- [ ] Backend exchanges credentials for a bearer token on first call
- [ ] Re-authorise on 401 verified (since `refreshToken` is null) — see `04-connection-and-reauth.md`
- [ ] User disconnect deletes the stored credential secret

### Workspace Agent

- [ ] Agent can start a flow (`POST /public/startflow`) from a user-supplied model name
- [ ] Agent can read a step's fields (`GET …/step/{stepId}`) and discover identifiers
- [ ] Agent can update step field values (`POST …/step/{stepId}`) with correct per-type encoding
- [ ] Agent does NOT blind-retry `startflow` (not idempotent)

### CI/CD

- [ ] N/A — no new Lambda (no Files provider). The `ext-api-doc` markdown ships with the client stack.

---

## 6. Testing Plan

> Frontend-only items can be tested today; API items are **blocked on discovery** (no live
> credentials yet — see `02`/`04` discovery banners).

### Manual sequence

1. **Admin/user connect:** In Integrations, pick Flowingly, enter a Business Administrator email +
   password, save. Verify the credential is stored in the vault.
2. **Authorise (backend):** First agent call triggers `POST /public/authorise`; confirm a bearer
   token is obtained. (Verify credential placement — query string per docs.)
3. **Start flow:** Ask the agent to start a known flow model for a named user. Verify a
   `flowIdentifier` (`FLOW-…`) comes back.
4. **Read step:** Ask the agent to read the started step's fields; verify `identifier` values.
5. **Update step:** Ask the agent to populate a Text + Email + Date field; verify per-type encoding
   (Date `dd/MM/yyyy`, CheckBox `"true"`/`"false"`, SelectList option object).
6. **Re-auth on expiry:** Force/await token expiry; verify a 401 triggers a silent re-authorise +
   single retry.
7. **Disconnect:** Disconnect Flowingly; verify the stored credential is removed and further calls
   fail cleanly.

### Edge cases

- [ ] Bad credentials → expect 400/401 (placement of error unverified)
- [ ] `success: false` envelope on HTTP 200 (surface `errorMessage`, do not treat as success)
- [ ] Unknown flow model `Name` → validation error
- [ ] URL-encoding of step names with spaces/parentheses
- [ ] Non-idempotent `startflow` — confirm no duplicate flows are created on retry

---

_See also:_

- _`02-api-spec-investigation.md` — clean API reference (endpoints, field-value encodings, errors)_
- _`04-connection-and-reauth.md` — credential sourcing, token exchange, expiry/refresh_
- _[Connector Framework Documentation](../../documentation/connectors/README.md)_
- _Registry source: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`_

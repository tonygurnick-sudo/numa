---
api_name: Gmail API
connector_id: gmail
auth_type: oauth2
oauth_platform: google
tier: standard
category: email
integration_path: data-connector-files (provider class) + scope-gated send
call_surface: file-browse (list_files/search_files/download_file/get_file_metadata) + send_email action
base_url: https://gmail.googleapis.com/gmail/v1/users/me (version /gmail/v1 already in base; userId hardcoded to me)
registry_scope: https://www.googleapis.com/auth/gmail.readonly (send 403s until gmail.send added)
status: registry entry AND backend provider both committed — this doc describes ACTUAL config, not a scaffold
---

# Gmail — Connector & Integration Setup

Build/reference doc. **Integration path: Data Connector (Files)** — labels=folders, emails=files, in **Files > Remote** — plus a scope-gated `send_email` action. Same lane as Google Drive/OneDrive/Dropbox, **not** the chat-only `connect_request` lane (Actionstep/NetSuite/Zoho). Prereqs: read `00-api-investigation-questionnaire.md`; activate the `numa-connectors` skill before changing anything.

## Integration Type

Data Connector (Files), provider-class, `surfaces:['files','chat']`.

| Component                       | Required? | Status                                                                               |
| ------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| Connector Registry entry        | Yes       | ✅ `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id:'gmail'`) |
| Backend provider class          | Yes       | ✅ `lib/oauth-providers/oauth_providers/gmail_provider.py` (`GmailProvider`)         |
| `ext-api-doc/gmail/` specs      | Yes       | ✅ this folder (`01*` agent rules)                                                   |
| Admin OAuth wizard              | Yes       | ✅ generated from registry (`oauthSetupSteps`, no bespoke code)                      |
| User integration (Connect)      | Yes       | ✅ generated from registry (OAuth redirect, no bespoke code)                         |
| Event types (Automations)       | Yes       | ✅ `eventTypes` array in the registry entry                                          |
| OAuth app credentials           | Yes       | ⛔ external — create a Google Cloud OAuth client (see `04`)                          |
| Feature flag                    | Yes       | `DATA_CONNECTORS_ENABLED` gates connectors + the Secrets Vault                       |
| Send write-scope (`gmail.send`) | Optional  | ⏳ not granted — registry scope is `gmail.readonly`; send 403s until added 🔬        |

## 1. Connector Registry Entry (DONE)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`. Actual config, verbatim:

```typescript
{
  id: 'gmail',
  displayName: 'Gmail',
  icon: 'bi-envelope',
  description: 'Read, search, and send emails via Gmail',
  category: 'Email & Communication',
  authType: 'oauth2',
  oauthPlatform: 'google',
  surfaces: ['files', 'chat'],
  cachingPolicy: CACHING_PRESETS.email,   // { ttl: 60 } — mail is high-churn
  oauth: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: 'https://www.googleapis.com/auth/gmail.readonly',
    extraAuthParams: '{"access_type":"offline","prompt":"consent"}',
    discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
  },
  oauthSetupSteps: [
    'Enable the Gmail API in Google Cloud Console → APIs & Services → Library',
    'Go to Credentials → Create Credentials → OAuth Client ID',
    'Select "Web Application" as the application type',
    'Add the redirect URI below under "Authorized redirect URIs"',
    'Copy the Client ID and Client Secret',
  ],
  eventTypes: [
    { id: 'new_email',     label: 'dataConnectors.events.newEmail',     description: 'dataConnectors.events.newEmailDesc',     defaultTags: ['email', 'incoming'],     defaultEnabled: true  },
    { id: 'email_read',    label: 'dataConnectors.events.emailRead',    description: 'dataConnectors.events.emailReadDesc',    defaultTags: ['email', 'status'],       defaultEnabled: false },
    { id: 'label_changed', label: 'dataConnectors.events.labelChanged', description: 'dataConnectors.events.labelChangedDesc', defaultTags: ['email', 'organization'], defaultEnabled: false },
    { id: 'email_sent',    label: 'dataConnectors.events.emailSent',    description: 'dataConnectors.events.emailSentDesc',    defaultTags: ['email', 'outgoing'],     defaultEnabled: true  },
  ],
}
```

Field notes:

- **`oauthPlatform:'google'`** — shares an OAuth client family with Drive and Calendar; one Google Cloud OAuth client can back all three, consent per-scope.
- **`surfaces:['files','chat']`** — opts Gmail into **Files > Remote** (default is `['chat']`); this routes Numa to the provider class.
- **`scopes`** is a single string `https://www.googleapis.com/auth/gmail.readonly` — read/list/search/download work, **send does not** (§4). No separate `oauthScopeDefinitions.ts` checkbox; scope is fixed in the registry.
- **`extraAuthParams`** is a JSON **string** (not an object). `access_type=offline` + `prompt=consent` force a **refresh token** on every consent — without them you get only a 1h access token, no refresh.
- **`cachingPolicy: CACHING_PRESETS.email`** = `{ttl:60}` (defined at top of the same file); 60s because mail changes constantly.
- **`eventTypes`** feed Numa Automations' source/trigger picker. `label`/`description` are i18n keys (`dataConnectors.events.*`), not literal strings. Gmail emits only a single mailbox-changed Pub/Sub ping; Numa derives these four events by diffing `history.list` (see `01d`/`02`).

## 2. Backend Provider Class (DONE)

File: `lib/oauth-providers/oauth_providers/gmail_provider.py` — `GmailProvider(OAuthProvider)`. As a Files-Remote connector it **has** a provider class (unlike chat-only spec-driven connectors). Subclasses `OAuthProvider`, maps the connector file interface onto Gmail endpoints. Token refresh / vault wiring handled by the base — the provider implements only the data methods.

| Provider method                   | Gmail endpoint(s)                                                  | Behaviour                                                            |
| --------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `list_files(folder_id=None)`      | no folder → `GET /labels`; with folder → `GET /messages?labelIds=` | no folder_id → labels as folders; with folder_id → emails as files   |
| `search_files(query, folder_id?)` | `GET /messages?q=…[&labelIds=…]`                                   | Gmail `q` syntax; optional label scoping                             |
| `download_file(file_id)`          | `GET /messages/{id}?format=full`                                   | extracts HTML body (falls back to plain text), returns UTF-8 bytes   |
| `get_file_metadata(file_id)`      | `GET /messages/{id}?format=metadata` (Subject/From/Date/To)        | maps to `OAuthFileMetadata`                                          |
| `send_email(to, subject, body)`   | `POST /messages/send` (`{raw}` base64url)                          | **scope-gated** — 403s under `gmail.readonly`; needs `gmail.send` 🔬 |

Implementation details:

- **`BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me"`** — `userId` hardcoded to `me`; always the consented mailbox.
- **Labels → folders.** `_list_labels` shows system labels in fixed order (`INBOX, SENT, DRAFT, STARRED, IMPORTANT, SPAM, TRASH`) with friendly display names, then all user labels, annotating each with its `messagesTotal` count (e.g. `Inbox (1284)`).
- **N+1 metadata fetch.** `_list_messages`/`search_files` get `{id,threadId}` stubs from `messages.list`, then call `messages.get?format=metadata` per stub to build the `Sender — Subject` display name. `maxResults` capped at `min(page_size, 100)`.
- **base64url decoding.** `_decode_body_data` pads to a multiple of 4 then `base64.urlsafe_b64decode` — plain `b64decode` would corrupt Gmail's URL-safe payloads.
- **Date parsing.** Uses RFC 2822 `Date` header, falls back to `internalDate` (epoch ms) when it won't parse.
- **No upload / delete.** `upload_file`/`delete_file` intentionally absent — a mailbox isn't a drop target, and delete needs full `https://mail.google.com/`.

Registered via the standard `oauth-providers` registry so the Files-Remote backend resolves `"gmail"` → `GmailProvider`. Confirm it appears in the provider registry / `handleListProviders` / `getProviderConfig` lookups when changing the file surface.

## 3. Workspace Agent Specs & Deployment (DONE)

The `01*` files are the agent knowledge pack: `01-llm-api-rules.md` (main rules, loaded into the agent's context when Gmail is active) + `01a`/`01b`/`01c`/`01d`.

**Deploy:** `infra/stacks/numa-client-stack.ts` walks the `ext-api-doc/` tree at synth time and creates one `S3Object` per file (skipping dotfiles and `_templates/`), keyed by relative path, into the per-client **ext-api-doc S3 bucket** (`core.extApiDocBucket`). The workspace agent reads these `01-*.md` files from that bucket at runtime when the Gmail connector is active — that's how the API rules enter the agent's context. The folder name (`gmail`) **must match the registry `id`** (`gmail`) so the `tools/check-connector-docs.mjs` parity check passes. Because deploy = "walk folder → one S3 object per file", committing a new/edited `.md` and redeploying the client stack updates what the agent sees — no Lambda or container rebuild.

## 4. Scope Decision for `send_email` 🔬

Registry grants only `gmail.readonly`. The provider's `send_email` POSTs to `…/messages/send`, which needs a **write** scope (`gmail.send`, `gmail.compose`, `gmail.modify`, or full `https://mail.google.com/`). Under `gmail.readonly` it returns **403 `insufficientPermissions`**.

To ship send:

1. Add `https://www.googleapis.com/auth/gmail.send` to the registry `oauth.scopes` (space-separated alongside `gmail.readonly`).
2. Re-deploy the frontend and re-consent every connected user (Google shows an incremental-consent screen — be aware it re-prompts and can alarm users).
3. `gmail.send` is also a restricted scope, so it factors into Google's OAuth verification / CASA assessment.

Recommendation: keep Gmail **read-only** unless send is an explicit product requirement; the read/search/download surface is complete and lower-risk.

## 5. Deployment Checklist

Code (in repo): [x] registry entry committed · [x] backend provider committed · [x] `surfaces:['files','chat']` set · [x] event types committed · [x] `ext-api-doc/gmail/` specs committed (`01*`, this `03`, `02`/`04`) · [x] folder name matches registry id → parity check passes.

External / deploy (developer):

- [ ] Create a Google Cloud project, enable the Gmail API, create a **Web Application** OAuth client (Client ID + Secret) — see `04`
- [ ] Register Numa's redirect URI under "Authorized redirect URIs"
- [ ] Configure the OAuth consent screen with the `gmail.readonly` (restricted) scope
- [ ] Admin enters Client ID + Secret in the Gmail OAuth wizard (saved to the company vault)
- [ ] `DATA_CONNECTORS_ENABLED` on for the client
- [ ] Deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` S3 sync)
- [ ] **Phase 2 smoke test** against a real Google account (see `04`)
- [ ] Confirm 🔬 items: the 403 on send under readonly; Pub/Sub push plumbing for triggers; restricted-scope verification status

## 6. Testing Plan

Manual sequence:

1. **Admin setup:** open the Gmail OAuth wizard, follow `oauthSetupSteps`, paste Client ID/Secret, save (company secret → vault).
2. **User connect:** Connect → Google consent (`gmail.readonly`) → token exchange. Verify a refresh token is captured (`access_type=offline` + `prompt=consent`).
3. **Browse (Files > Remote):** open Gmail → system labels (`Inbox (N)`, `Sent`, …) + user labels as folders. Open a label → emails as `Sender — Subject` files.
4. **Search:** `is:unread newer_than:7d` → matching emails appear.
5. **Read:** open an email → body renders (HTML preferred, plain-text fallback).
6. **Workspace chat:** ask "list my unread emails from the last week" and "summarise the latest invoice email" → agent uses the files tool against the provider.
7. **Send (only if `gmail.send` added):** ask to send a test email → expect success; under `gmail.readonly`, expect a clean 403 and a "scope not granted" message, not a retry loop.
8. **User disconnect:** removes the per-user secret only; admin company secret stays.

Edge cases: [ ] empty label / no results · [ ] large attachment (`attachments.get`, base64url-decoded) · [ ] non-ASCII subjects / sender names · [ ] 401 → token refresh (1h) → retry · [ ] 403 `userRateLimitExceeded` → exponential backoff · [ ] `nextPageToken` pagination beyond one page · [ ] send under readonly → clean 403, no infinite retry.

## Sources

- developers.google.com/workspace/gmail/api (overview, REST reference, scopes)
- developers.google.com/identity/protocols/oauth2/web-server (Google OAuth web server flow)
- In-repo: `lib/oauth-providers/oauth_providers/gmail_provider.py`, `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, `infra/stacks/numa-client-stack.ts` (ext-api-doc → S3 sync)

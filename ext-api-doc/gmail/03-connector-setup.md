---
api_name: 'Gmail API'
connector_id: 'gmail'
auth_type: 'oauth2'
tier: 'standard'
category: 'email'
integration_path: 'data-connector-files (provider class) + scope-gated send'
---

# Gmail — Connector & Integration Setup

> Build/reference doc for the Gmail connector. **Integration path: Data Connector (Files)** —
> labels are folders, emails are files, surfaced in **Files > Remote** — plus a scope-gated
> `send_email` action. This is the same lane as Google Drive, OneDrive, and Dropbox, **not** the
> chat-only `connect_request` lane (Actionstep / NetSuite / Zoho).
>
> Both the registry entry **and** the backend provider already exist and are committed. This
> document reproduces and describes the ACTUAL config — it is not a scaffold to fill in.
>
> Prerequisites: read `00-api-investigation-questionnaire.md`, and activate the `numa-connectors`
> skill before changing any of this.

---

## Integration Type

**Selected path:** Data Connector (Files), provider-class implementation (`surfaces: ['files','chat']`).

| Component                       | Required? | Status                                                                                       |
| ------------------------------- | --------- | -------------------------------------------------------------------------------------------- |
| Connector Registry entry        | Yes       | ✅ Done — `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id: 'gmail'`) |
| Backend provider class          | Yes       | ✅ Done — `lib/oauth-providers/oauth_providers/gmail_provider.py` (`GmailProvider`)          |
| `ext-api-doc/gmail/` specs      | Yes       | ✅ Done — this folder (`01*` agent rules)                                                    |
| Admin OAuth wizard              | Yes       | ✅ Generated from registry (`oauthSetupSteps`, no bespoke code)                              |
| User integration (Connect)      | Yes       | ✅ Generated from registry (OAuth redirect, no bespoke code)                                 |
| Event types (Automations)       | Yes       | ✅ Done — `eventTypes` array in the registry entry                                           |
| OAuth app credentials           | Yes       | ⛔ External — create a Google Cloud OAuth client (see `04-…`)                                |
| Feature flag                    | Yes       | `DATA_CONNECTORS_ENABLED` gates connectors + the Secrets Vault                               |
| Send write-scope (`gmail.send`) | Optional  | ⏳ Not granted — registry scope is `gmail.readonly`; send 403s until added 🔬                |

---

## 1. Connector Registry Entry (DONE)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

The entry is already committed. **This is the actual config** (reproduced verbatim from the file):

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

- **`oauthPlatform: 'google'`** — Gmail shares an OAuth client family with Google Drive and Google
  Calendar. One Google Cloud OAuth client can back all three; consent is per-scope.
- **`surfaces: ['files', 'chat']`** — opts Gmail in to the **Files > Remote** browser (default is
  `['chat']`). This is what makes Numa treat it as a file connector and route to the provider class.
- **`scopes`** is a single string — `https://www.googleapis.com/auth/gmail.readonly`. Read/list/
  search/download work; **send does not** (see §4). There is no separate `oauthScopeDefinitions.ts`
  checkbox entry for Gmail — the scope is fixed in the registry.
- **`extraAuthParams: '{"access_type":"offline","prompt":"consent"}'`** is a JSON **string** (not
  an object). `access_type=offline` + `prompt=consent` force Google to return a **refresh token**
  on every consent — without these you only get a one-hour access token and no refresh.
- **`cachingPolicy: CACHING_PRESETS.email`** resolves to `{ ttl: 60 }` (`CACHING_PRESETS` is
  defined at the top of the same file). 60s because mail changes constantly.
- **`eventTypes`** feed Numa Automations' source/trigger picker. The `label`/`description` values
  are i18n keys (`dataConnectors.events.*`), not literal strings. Gmail emits only a single
  mailbox-changed Pub/Sub ping; Numa derives these four discrete events by diffing `history.list`
  (see `01d` / `02`).

---

## 2. Backend Provider Class (DONE)

> File: `lib/oauth-providers/oauth_providers/gmail_provider.py` — `GmailProvider(OAuthProvider)`

Because Gmail is a Files-Remote connector, it **does** have a provider class (unlike the chat-only
spec-driven connectors). It subclasses `OAuthProvider` and maps the connector file interface onto
Gmail endpoints. The token refresh / vault wiring is handled by the `OAuthProvider` base — the
provider only implements the data methods.

| Provider method                   | Gmail endpoint(s)                                                  | Behaviour                                                            |
| --------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `list_files(folder_id=None)`      | no folder → `GET /labels`; with folder → `GET /messages?labelIds=` | No folder_id → labels as folders; with folder_id → emails as files   |
| `search_files(query, folder_id?)` | `GET /messages?q=…[&labelIds=…]`                                   | Gmail `q` syntax; optional label scoping                             |
| `download_file(file_id)`          | `GET /messages/{id}?format=full`                                   | Extracts HTML body (falls back to plain text), returns UTF-8 bytes   |
| `get_file_metadata(file_id)`      | `GET /messages/{id}?format=metadata` (Subject/From/Date/To)        | Maps to `OAuthFileMetadata`                                          |
| `send_email(to, subject, body)`   | `POST /messages/send` (`{raw}` base64url)                          | **Scope-gated** — 403s under `gmail.readonly`; needs `gmail.send` 🔬 |

Implementation details worth knowing:

- **`BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me"`** — `userId` is hardcoded to
  `me`; the provider always operates on the consented mailbox.
- **Labels → folders.** `_list_labels` shows system labels in a fixed order
  (`INBOX, SENT, DRAFT, STARRED, IMPORTANT, SPAM, TRASH`) with friendly display names, then all
  user labels, annotating each with its `messagesTotal` count (e.g. `Inbox (1284)`).
- **N+1 metadata fetch.** `_list_messages` / `search_files` get `{id, threadId}` stubs from
  `messages.list`, then call `messages.get?format=metadata` per stub to build the
  `Sender — Subject` display name. `maxResults` is capped at `min(page_size, 100)`.
- **base64url decoding.** `_decode_body_data` pads the data to a multiple of 4 then
  `base64.urlsafe_b64decode` — plain `b64decode` would corrupt Gmail's URL-safe payloads.
- **Date parsing.** Uses the RFC 2822 `Date` header, falling back to `internalDate` (epoch ms)
  when the header won't parse.
- **No upload / delete.** `upload_file` and `delete_file` are intentionally absent — a mailbox is
  not a drop target, and delete needs the full `https://mail.google.com/` scope.

The provider is registered through the standard `oauth-providers` registry so the Files-Remote
backend can resolve `"gmail"` to `GmailProvider`. Confirm it appears in the provider registry /
`handleListProviders` / `getProviderConfig` lookups when changing the file surface.

---

## 3. Workspace Agent Specs & Deployment (DONE)

The `01*` files in this folder are the agent knowledge pack for Gmail:

- `01-llm-api-rules.md` (main rules, < 300 lines — loaded into the agent's context when Gmail is active)
- `01a-domain-model-reference.md`, `01b-query-patterns.md`, `01c-mutation-patterns.md`, `01d-event-and-error-handling.md`

**How they deploy.** `infra/stacks/numa-client-stack.ts` walks the `ext-api-doc/` tree at synth
time and creates one `S3Object` per file (skipping dotfiles and the `_templates/` folder), keyed
by relative path, into the per-client **ext-api-doc S3 bucket** (`core.extApiDocBucket`). The
workspace agent reads these `01-*.md` files from that bucket at runtime when the Gmail connector is
active — that is the mechanism that puts the API rules into the agent's context. The folder name
(`gmail`) **must match the registry `id`** (`gmail`) so the `tools/check-connector-docs.mjs` parity
check passes and the agent can find the right pack.

> Because deployment is "walk the folder → one S3 object per file", simply committing a new or
> edited `.md` in `ext-api-doc/gmail/` and redeploying the client stack is enough to update what
> the agent sees — no Lambda or container rebuild required.

---

## 4. Scope Decision for `send_email` 🔬

The registry grants only `gmail.readonly`. The provider's `send_email` POSTs to
`…/messages/send`, which requires a **write** scope (`gmail.send`, `gmail.compose`, `gmail.modify`,
or full `https://mail.google.com/`). Under `gmail.readonly` it returns
**403 `insufficientPermissions`**.

To ship send:

1. Add `https://www.googleapis.com/auth/gmail.send` to the registry `oauth.scopes` (space-separated
   alongside `gmail.readonly`).
2. Re-deploy the frontend and re-consent every connected user (Google shows an incremental-consent
   screen — be aware this re-prompts and can alarm users).
3. Note that `gmail.send` is also a restricted scope, so it factors into Google's OAuth
   verification / CASA assessment.

Recommendation: keep Gmail **read-only** unless send is an explicit product requirement; the
read/search/download surface is complete and lower-risk.

---

## 5. Deployment Checklist

### Code (already in the repo)

- [x] Registry entry committed (`connectorRegistry.ts`, `id: 'gmail'`)
- [x] Backend provider committed (`gmail_provider.py`, `GmailProvider`)
- [x] `surfaces: ['files', 'chat']` set (Files-Remote opt-in)
- [x] Event types for Automations committed (`eventTypes` array)
- [x] `ext-api-doc/gmail/` specs committed (`01*`, this `03`, plus `02`/`04`)
- [x] Folder name matches registry id → `tools/check-connector-docs.mjs` parity check passes

### External / deploy (developer)

- [ ] Create a Google Cloud project, enable the Gmail API, create a **Web Application** OAuth
      client (Client ID + Secret) — see `04-connection-and-reauth.md`
- [ ] Register Numa's redirect URI under "Authorized redirect URIs"
- [ ] Configure the OAuth consent screen with the `gmail.readonly` (restricted) scope
- [ ] Admin enters Client ID + Secret in the Gmail OAuth wizard (saved to the company vault)
- [ ] `DATA_CONNECTORS_ENABLED` is on for the client
- [ ] Deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` S3 sync)
- [ ] **Phase 2 smoke test** against a real Google account (see `04-…`)
- [ ] Confirm 🔬 items: the 403 on send under readonly; Pub/Sub push plumbing for triggers;
      restricted-scope verification status

---

## 6. Testing Plan

### Manual sequence

1. **Admin setup:** open the Gmail OAuth wizard, follow `oauthSetupSteps`, paste Client ID/Secret,
   save (company secret → vault).
2. **User connect:** click Connect → Google consent screen (`gmail.readonly`) → token exchange.
   Verify a refresh token is captured (`access_type=offline` + `prompt=consent`).
3. **Browse (Files > Remote):** open Gmail → see system labels (`Inbox (N)`, `Sent`, …) + user
   labels as folders. Open a label → emails listed as `Sender — Subject` files.
4. **Search:** search `is:unread newer_than:7d` → matching emails appear.
5. **Read:** open an email → body renders (HTML preferred, plain-text fallback).
6. **Workspace chat:** ask the agent to "list my unread emails from the last week" and "summarise
   the latest invoice email" → agent uses the files tool against the provider.
7. **Send (only if `gmail.send` added):** ask the agent to send a test email → expect success;
   under `gmail.readonly`, expect a clean 403 and a "scope not granted" message, not a retry loop.
8. **User disconnect:** removes the per-user secret only; admin company secret stays.

### Edge cases

- [ ] Empty label / no search results
- [ ] Large attachment (fetched via `attachments.get`, base64url-decoded)
- [ ] Non-ASCII subjects / sender names
- [ ] 401 → token refresh (1h access token) → retry
- [ ] 403 `userRateLimitExceeded` → exponential backoff
- [ ] `nextPageToken` pagination beyond one page
- [ ] Send attempted under readonly → clean 403, no infinite retry

---

## Sources

- API overview: https://developers.google.com/workspace/gmail/api
- REST reference: https://developers.google.com/workspace/gmail/api/reference/rest
- Scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Google OAuth (web server): https://developers.google.com/identity/protocols/oauth2/web-server
- In-repo: `lib/oauth-providers/oauth_providers/gmail_provider.py`,
  `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`,
  `infra/stacks/numa-client-stack.ts` (ext-api-doc → S3 sync)

_Generated from the investigation questionnaire. Pair with the `numa-connectors` skill._

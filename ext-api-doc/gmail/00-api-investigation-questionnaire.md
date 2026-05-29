---
api_name: 'Gmail API'
api_slug: 'gmail'
vendor: 'Google LLC'
website: 'https://developers.google.com/workspace/gmail/api'
investigation_started: '2026-05-29'
investigator: 'Claude Code (doc-based investigation)'
investigation_status: 'complete'
documentation_quality: 'excellent'
api_types: [REST]
overall_confidence: 'high'
researcher: 'Claude Code (doc-based investigation)'
date_researched: '2026-05-29'
integration_path: 'Data Connector (Files) + selective API (provider-class, files + chat)'
auth_type: 'oauth2'
blockers: []
---

# Gmail API — API Investigation Questionnaire

> **Confidence markers:** `[CONFIRMED]` = verified against a live API call · `[DOCUMENTED]` =
> stated in official Google docs · `[INFERRED]` = deduced from conventions/SDKs/codebase ·
> `[UNKNOWN]` = not yet established.
>
> ⚠️ **This is a documentation-based investigation.** No live Gmail API call was made during
> research (no OAuth-consented mailbox available at research time), so **Phase 2's "first
> successful call" gate is NOT satisfied by a live call**. However — unusually for this
> questionnaire set — a working backend provider **already exists** in this repo
> (`lib/oauth-providers/oauth_providers/gmail_provider.py`). It exercises `messages.list`,
> `messages.get` (metadata + full), `messages/send`, and `labels` against the real API. Its
> request shapes are therefore treated as effectively battle-tested and marked `[INFERRED]`
> (from working code) where they corroborate the docs. Items still needing a live smoke test
> are tagged **🔬 LIVE-CONFIRM**.

---

## Phase 1 — Information Sources

### 1.1 Primary Documentation [REQUIRED]

| Item                | Value                                                                  | Confidence   |
| ------------------- | ---------------------------------------------------------------------- | ------------ |
| Official API docs   | https://developers.google.com/workspace/gmail/api                      | [DOCUMENTED] |
| REST reference      | https://developers.google.com/workspace/gmail/api/reference/rest       | [DOCUMENTED] |
| Auth / scopes guide | https://developers.google.com/workspace/gmail/api/auth/scopes          | [DOCUMENTED] |
| OAuth 2.0 (Google)  | https://developers.google.com/identity/protocols/oauth2/web-server     | [DOCUMENTED] |
| Search operators    | https://support.google.com/mail/answer/7190                            | [DOCUMENTED] |
| Usage limits        | https://developers.google.com/workspace/gmail/api/reference/quota      | [DOCUMENTED] |
| Error handling      | https://developers.google.com/workspace/gmail/api/guides/handle-errors | [DOCUMENTED] |
| Push notifications  | https://developers.google.com/workspace/gmail/api/guides/push          | [DOCUMENTED] |
| Sending mail guide  | https://developers.google.com/workspace/gmail/api/guides/sending       | [DOCUMENTED] |
| OIDC discovery      | https://accounts.google.com/.well-known/openid-configuration           | [DOCUMENTED] |

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Discovery doc:** `https://gmail.googleapis.com/$discovery/rest?version=v1` — Google
  publishes a machine-readable **Discovery Document** (not OpenAPI, but equivalent: full method +
  schema catalog). This is the closest thing to a spec and is authoritative. [DOCUMENTED]
- **Official SDKs:**
  - Python: `google-api-python-client` (`googleapis/google-api-python-client`) — generated client. [DOCUMENTED]
  - Node.js: `googleapis` (`googleapis/google-api-nodejs-client`). [DOCUMENTED]
  - Java/Go/.NET: official generated clients all exist. [DOCUMENTED]
- **Stack Overflow tag:** `gmail-api`. [DOCUMENTED]
- **In-repo reference (gold):** `lib/oauth-providers/oauth_providers/gmail_provider.py` — a working
  Numa provider that already calls this API. [INFERRED — working code]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                          |
| ------------------------- | ------ | ------------------------------------------------------------------------------ |
| Authentication            | 5      | Google OAuth 2.0 is among the best-documented auth flows on the web            |
| Endpoint reference        | 5      | Every method has its own page with params, body, response, scopes, try-it      |
| Request/response examples | 4      | Schemas + examples per method; some examples are language-SDK rather than HTTP |
| Error documentation       | 4      | Dedicated "Resolve errors" guide with reason codes + backoff guidance          |
| Rate limit documentation  | 4      | Quota-unit model published per method; numbers are explicit                    |
| Pagination documentation  | 5      | Uniform `pageToken`/`nextPageToken` across all list methods                    |
| Webhook documentation     | 4      | Push via Cloud Pub/Sub fully documented (but heavyweight to set up)            |
| SDKs / code examples      | 5      | First-party SDKs in 6+ languages, all generated from the discovery doc         |
| Changelog / versioning    | 4      | API is stable at `v1`; release notes published for Workspace                   |

**Overall documentation quality:** **excellent**

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Found Discovery Document (Google's equivalent of OpenAPI)
- [x] Identified authentication method (Google OAuth 2.0, authorization code + refresh)
- [x] Found at least one working example (in-repo `gmail_provider.py`)
- [x] Identified rate limit information (quota-unit model)
- [x] Identified pagination approach (`pageToken` / `nextPageToken`)
- [x] Checked for webhook/event support (Pub/Sub push via `users.watch`)
- [x] Checked for official SDKs (yes, first-party, multi-language)

---

## Phase 2 — Authentication (HARD GATE — not live-confirmed, see warning above)

> Auth values below are taken **verbatim from the connector registry entry**
> (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, `id: 'gmail'`) and
> cross-checked against Google's OAuth docs. The registry is the source of truth for what Numa
> actually sends.

| Item                  | Value                                                                          | Confidence   |
| --------------------- | ------------------------------------------------------------------------------ | ------------ |
| Auth standard         | OAuth 2.0 (Google), Authorization Code grant + refresh token                   | [DOCUMENTED] |
| Auth location         | HTTP header — `Authorization: Bearer {access_token}`                           | [DOCUMENTED] |
| `oauthPlatform`       | `google` (shared OAuth client family with Google Drive in the registry)        | [DOCUMENTED] |
| **Authorize URL**     | `https://accounts.google.com/o/oauth2/v2/auth`                                 | [DOCUMENTED] |
| **Token URL**         | `https://oauth2.googleapis.com/token`                                          | [DOCUMENTED] |
| **Revocation URL**    | `https://oauth2.googleapis.com/revoke`                                         | [DOCUMENTED] |
| Discovery URL         | `https://accounts.google.com/.well-known/openid-configuration`                 | [DOCUMENTED] |
| **Scope (registry)**  | `https://www.googleapis.com/auth/gmail.readonly`                               | [DOCUMENTED] |
| `extraAuthParams`     | `{"access_type":"offline","prompt":"consent"}`                                 | [DOCUMENTED] |
| PKCE required?        | No (web-server flow uses client secret); Google supports PKCE but not required | [DOCUMENTED] |
| State parameter       | Yes — Numa's OAuth wizard sends `state` for CSRF protection                    | [INFERRED]   |
| Redirect URI          | Must be pre-registered in Google Cloud Console "Authorized redirect URIs"      | [DOCUMENTED] |
| Access token lifetime | ~3600s (1 hour)                                                                | [DOCUMENTED] |
| Refresh token         | Long-lived; returned only when `access_type=offline` + `prompt=consent`        | [DOCUMENTED] |
| Refresh behaviour     | Manual exchange at token URL with `grant_type=refresh_token`                   | [DOCUMENTED] |

**⚠️ SCOPE MISMATCH — must resolve before send works.** The registry grants only
`gmail.readonly`. The existing backend provider (`gmail_provider.py`) implements a `send_email`
method that POSTs to `…/messages/send`. **`messages.send` requires a write scope**
(`gmail.send`, `gmail.compose`, `gmail.modify`, or full `https://mail.google.com/`) — it will
**403** under `gmail.readonly`. Reading/listing/searching all work under `gmail.readonly`.
**Decision needed:** either keep Gmail read-only (drop `send_email` from the exposed surface) or
broaden the registry scope to include `gmail.send`. Recommend: add `gmail.send` only if the
send capability is intentionally shipped, since the incremental consent screen scares users.
[DOCUMENTED — scope requirements] / **🔬 LIVE-CONFIRM** the 403 under readonly.

**Required-scope reference (Gmail):**

| Scope                      | Purpose                                         | Needed for Numa?                     |
| -------------------------- | ----------------------------------------------- | ------------------------------------ |
| `…/auth/gmail.readonly`    | Read all resources + metadata (no write)        | **Yes** (current registry scope)     |
| `…/auth/gmail.metadata`    | Headers + labels only, **no body/`q` search**   | No (too restrictive — breaks search) |
| `…/auth/gmail.send`        | Send mail only (no read)                        | Only if send is shipped (see above)  |
| `…/auth/gmail.compose`     | Create/update drafts + send                     | No                                   |
| `…/auth/gmail.modify`      | Read + write (labels, modify), no permanent del | No (overbroad)                       |
| `https://mail.google.com/` | Full mailbox incl. permanent delete             | No (most dangerous — avoid)          |

> **Note on `gmail.metadata`:** it cannot be combined with the `q` (search) parameter and does
> not return message bodies. Because Numa's provider does full-text `q` search and downloads
> bodies, **`gmail.readonly` is the correct floor** — do not "tighten" to metadata. [DOCUMENTED]

**Token response (Google standard shape):**

```json
{
  "access_token": "ya29.a0Af...",
  "expires_in": 3599,
  "refresh_token": "1//0gF...",
  "scope": "https://www.googleapis.com/auth/gmail.readonly",
  "token_type": "Bearer"
}
```

### 2.4 First Successful Call [REQUIRED] — CRITICAL GATE

> Not run live. The call below is the smoke test a developer should run with a consented token.
> It mirrors exactly what `gmail_provider._list_labels` already issues.

```http
GET /gmail/v1/users/me/labels HTTP/1.1
Host: gmail.googleapis.com
Authorization: Bearer ya29.a0Af...
```

**Expected response (200):**

```json
{
  "labels": [
    {
      "id": "INBOX",
      "name": "INBOX",
      "type": "system",
      "messagesTotal": 1284,
      "messagesUnread": 12,
      "threadsTotal": 1102
    },
    { "id": "SENT", "name": "SENT", "type": "system" },
    { "id": "DRAFT", "name": "DRAFT", "type": "system" },
    { "id": "Label_42", "name": "Clients/Acme", "type": "user", "messagesTotal": 57 }
  ]
}
```

- **HTTP status code:** 200 (expected) — **🔬 LIVE-CONFIRM**
- **Time to first call:** Google OAuth is well-trodden; main friction is enabling the Gmail API
  in the Cloud project and OAuth consent-screen verification for sensitive scopes.
- **Gotchas:**
  - **Sensitive-scope verification:** `gmail.readonly` (and all Gmail scopes) are
    "restricted/sensitive". Unverified apps see an "unverified app" warning and a 100-user cap.
    Production use requires Google's OAuth verification (CASA security assessment for restricted
    scopes). **This is the single biggest operational hurdle.** [DOCUMENTED]
  - **Refresh token only on first consent:** `prompt=consent` is set in `extraAuthParams`
    precisely so re-auth always returns a refresh token. [DOCUMENTED]
  - **`userId` is `me`:** the provider hardcodes `…/users/me` — always the consented user. [INFERRED]

- [ ] **GATE CHECK: First successful live call — NOT DONE (no consented token at research time)** 🔬

---

## Phase 3 — Domain Model & Behaviour

### 3.1 Core Entities [REQUIRED]

| Entity     | Resource path                         | CRUD (under readonly)     | Notes                                           |
| ---------- | ------------------------------------- | ------------------------- | ----------------------------------------------- |
| Message    | `users/{userId}/messages`             | R (list/get) · send=W 🔬  | The email itself. Immutable id; `threadId` link |
| Thread     | `users/{userId}/threads`              | R                         | A conversation; groups messages by `threadId`   |
| Label      | `users/{userId}/labels`               | R (CRUD needs `modify`)   | Folders/tags. System + user labels              |
| Draft      | `users/{userId}/drafts`               | R (write needs `compose`) | Unsent message                                  |
| Attachment | `…/messages/{id}/attachments/{attId}` | R                         | Binary part body, base64url-encoded             |
| History    | `users/{userId}/history`              | R                         | Incremental change feed keyed by `historyId`    |
| Profile    | `users/{userId}/profile`              | R                         | `emailAddress`, `messagesTotal`, `historyId`    |

#### Entity: Message

- **Path:** `users/{userId}/messages/{id}` · **CRUD:** Read (+ send to create); no update of an
  existing message (labels change via `messages.modify`, which needs `gmail.modify`).

**Fields (from `messages.get`):** [DOCUMENTED]

| Field          | Type              | Writable?  | Description                                           | Example                 |
| -------------- | ----------------- | ---------- | ----------------------------------------------------- | ----------------------- |
| `id`           | string            | No         | Immutable message id (hex)                            | `"17c4a7e5f8b9c2d1"`    |
| `threadId`     | string            | No         | Id of the containing thread                           | `"17c4a7e5f8b9c2d0"`    |
| `labelIds`     | string[]          | via modify | Labels applied (`INBOX`, `UNREAD`, `Label_42`, …)     | `["INBOX","IMPORTANT"]` |
| `snippet`      | string            | No         | Short plain-text preview                              | `"This is a preview…"`  |
| `historyId`    | string            | No         | History marker at last change                         | `"9876543210"`          |
| `internalDate` | string (epoch ms) | No         | Internal receive timestamp                            | `"1620000000000"`       |
| `sizeEstimate` | integer (bytes)   | No         | Approx message size                                   | `2048`                  |
| `payload`      | MessagePart       | No         | MIME tree: `mimeType`, `headers[]`, `body`, `parts[]` | (nested)                |
| `raw`          | string (b64url)   | No         | Whole RFC 2822 message (only when `format=raw`)       | `"RnJvbTog…"`           |

**MessagePart / MessagePartBody:** `payload.headers` is an array of `{name, value}`;
`payload.body` is `{attachmentId?, size, data (base64url)}`; `payload.parts[]` recurses for
multipart messages. Attachment bytes are fetched separately via `…/attachments/{id}`. [DOCUMENTED]

#### Entity: Label

**Fields (from `labels.get` / `labels.list`):** [DOCUMENTED]

| Field                   | Type    | Description                                         |
| ----------------------- | ------- | --------------------------------------------------- |
| `id`                    | string  | Immutable id (`INBOX`, `Label_42`)                  |
| `name`                  | string  | Display name (`Clients/Acme` — `/` denotes nesting) |
| `type`                  | enum    | `system` \| `user`                                  |
| `messageListVisibility` | enum    | `show` \| `hide`                                    |
| `labelListVisibility`   | enum    | `labelShow` \| `labelShowIfUnread` \| `labelHide`   |
| `messagesTotal`         | integer | Count of messages with the label                    |
| `messagesUnread`        | integer | Unread count                                        |
| `threadsTotal`          | integer | Thread count                                        |
| `color`                 | object  | `{textColor, backgroundColor}` (user labels only)   |

### 3.2 Entity Relationships [IMPORTANT]

```
┌──────────┐  N:M (labelIds[])   ┌──────────┐
│ Message  │────────────────────>│  Label   │   (system: INBOX/SENT/DRAFT… + user labels)
└──────────┘                     └──────────┘
     │ N:1 (threadId)
     ▼
┌──────────┐
│  Thread  │
└──────────┘
     ▲
     │ payload.parts[] (recursive MIME)
┌──────────┐  body.attachmentId  ┌────────────┐
│ Message  │────────────────────>│ Attachment │  (fetched via attachments/{id})
└──────────┘                     └────────────┘
```

- A **Message** belongs to exactly one **Thread** (`threadId`) and carries N **Labels**
  (`labelIds`). Numa's provider models **labels as folders, messages as files**. [INFERRED — code]

### 3.3 State Machines [IMPORTANT]

Gmail has no rich entity lifecycle exposed via the read API. The only meaningful "state" is
label membership (e.g. `UNREAD` present/absent, `INBOX` vs archived). Transitions require
`messages.modify` (out of scope under `gmail.readonly`). [DOCUMENTED]

| From State         | Action (`messages.modify`) | To State   | Needs scope       |
| ------------------ | -------------------------- | ---------- | ----------------- |
| has `UNREAD` label | removeLabelIds=[UNREAD]    | read       | `gmail.modify` 🚫 |
| has `INBOX` label  | removeLabelIds=[INBOX]     | archived   | `gmail.modify` 🚫 |
| —                  | `messages.trash`           | in `TRASH` | `gmail.modify` 🚫 |

🚫 = out of scope for the current `gmail.readonly` connector.

### 3.4 Business Rules [IMPORTANT]

- **`userId` is always `me`** for an OAuth-consented user; the API does not let you read other
  mailboxes without domain-wide delegation (Workspace admin only). [DOCUMENTED]
- **`format=metadata` cannot use `q`** and returns no body — incompatible with search/download. [DOCUMENTED]
- **Sending requires a write scope** — see Phase 2 mismatch. [DOCUMENTED]
- **Label `name` uses `/` for nesting** (`Clients/Acme`); ids are opaque. [DOCUMENTED]
- **`internalDate` is the reliable timestamp** — the provider falls back to it when the RFC `Date`
  header fails to parse. [INFERRED — code]
- **Attachment bytes are not inline by default** for large parts — `body.data` is empty and you
  must call `attachments.get` with the `attachmentId`. [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

| Format       | Pattern                     | Example                           | Notes                                      |
| ------------ | --------------------------- | --------------------------------- | ------------------------------------------ |
| Message id   | opaque hex string           | `17c4a7e5f8b9c2d1`                | Stable, immutable                          |
| Label id     | `INBOX` / `Label_NN`        | `Label_42`                        | System ids are UPPERCASE words             |
| internalDate | epoch milliseconds (string) | `"1620000000000"`                 | Convert /1000 for seconds                  |
| RFC Date hdr | RFC 2822                    | `Mon, 03 May 2021 00:00:00 +0000` | Parse `%a, %d %b %Y %H:%M:%S %z`           |
| Body data    | **base64url** (RFC 4648 §5) | `VGhpcyBpcyB0aGU…`                | URL-safe alphabet; pad to %4 before decode |
| Raw message  | base64url of full RFC 2822  | `RnJvbTog…`                       | `format=raw` only                          |
| historyId    | unsigned integer (string)   | `"9876543210"`                    | Monotonic per mailbox                      |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Field                   | Allowed Values                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label `type`            | `system`, `user`                                                                                                                                                                          |
| System label ids        | `INBOX`, `SENT`, `DRAFT`, `SPAM`, `TRASH`, `UNREAD`, `STARRED`, `IMPORTANT`, `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS`, `CHAT` |
| `format` (messages.get) | `minimal`, `full`, `raw`, `metadata`                                                                                                                                                      |
| `messageListVisibility` | `show`, `hide`                                                                                                                                                                            |
| `labelListVisibility`   | `labelShow`, `labelShowIfUnread`, `labelHide`                                                                                                                                             |

> Numa's provider surfaces a curated subset at root: `INBOX, SENT, DRAFT, STARRED, IMPORTANT,
SPAM, TRASH` + all user labels. [INFERRED — code]

---

## Phase 4 — Endpoint Catalog

> **Base URL:** `https://gmail.googleapis.com/gmail/v1` · **userId:** `me`
> **Content-Type:** `application/json; charset=UTF-8` (send upload variant differs). [DOCUMENTED]

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /users/me/labels (labels.list — connector root)

- **Purpose:** List all labels → rendered as the Files-Remote root folders.
- **Auth:** yes · **Quota cost:** 1 unit · **Idempotent:** yes

**Success response (200):**

```json
{
  "labels": [
    { "id": "INBOX", "name": "INBOX", "type": "system", "messagesTotal": 1284, "messagesUnread": 12 },
    { "id": "Label_42", "name": "Clients/Acme", "type": "user", "messagesTotal": 57 }
  ]
}
```

#### Endpoint: GET /users/me/messages (messages.list — folder listing / search)

- **Purpose:** List message ids in a label, or search the mailbox with `q`.
- **Auth:** yes · **Quota cost:** 5 units · **Idempotent:** yes

**Query parameters:** [DOCUMENTED]

| Parameter          | Type     | Required | Default | Description                                           |
| ------------------ | -------- | -------- | ------- | ----------------------------------------------------- |
| `q`                | string   | No       | —       | Gmail search syntax (`from:`, `is:unread`, `after:`…) |
| `labelIds`         | string[] | No       | —       | Filter to messages carrying ALL listed labels         |
| `maxResults`       | integer  | No       | 100     | Page size; **max 500**                                |
| `pageToken`        | string   | No       | —       | Opaque token from prior `nextPageToken`               |
| `includeSpamTrash` | boolean  | No       | false   | Include SPAM/TRASH                                    |

**Success response (200):**

```json
{
  "messages": [
    { "id": "17c4a7e5f8b9c2d1", "threadId": "17c4a7e5f8b9c2d0" },
    { "id": "17c4a7e1aa00bb22", "threadId": "17c4a7e1aa00bb22" }
  ],
  "nextPageToken": "08945763213548163492",
  "resultSizeEstimate": 2
}
```

> **N+1 cost note:** `messages.list` returns only `{id, threadId}` stubs. To show subject/sender,
> the provider then calls `messages.get` per stub (`format=metadata`, headers Subject/From/Date).
> A 50-message page = 1 × list (5) + 50 × get-metadata (5 each) ≈ **255 quota units**. Keep page
> sizes modest. [INFERRED — code + quota docs]

#### Endpoint: GET /users/me/messages/{id} (messages.get — open an email)

- **Purpose:** Fetch a single message — metadata (headers) or full (body + parts).
- **Auth:** yes · **Quota cost:** 5 units · **Idempotent:** yes

**Query parameters:** `format` ∈ {`minimal`,`full`,`raw`,`metadata`}; `metadataHeaders[]` when
`format=metadata`. [DOCUMENTED]

**Success response (200, `format=full`):**

```json
{
  "id": "17c4a7e5f8b9c2d1",
  "threadId": "17c4a7e5f8b9c2d0",
  "labelIds": ["INBOX", "IMPORTANT"],
  "snippet": "This is a preview of the message content...",
  "internalDate": "1620000000000",
  "sizeEstimate": 2048,
  "payload": {
    "mimeType": "multipart/alternative",
    "headers": [
      { "name": "From", "value": "Acme Billing <billing@acme.example>" },
      { "name": "To", "value": "me@company.example" },
      { "name": "Subject", "value": "Invoice #4471" },
      { "name": "Date", "value": "Mon, 03 May 2021 00:00:00 +0000" }
    ],
    "parts": [
      { "mimeType": "text/plain", "body": { "size": 512, "data": "SW52b2ljZSBhdHRhY2hlZA==" } },
      { "mimeType": "text/html", "body": { "size": 1024, "data": "PGh0bWw+Li4uPC9odG1sPg==" } },
      {
        "mimeType": "application/pdf",
        "filename": "invoice-4471.pdf",
        "body": { "attachmentId": "ANGjdJ8...", "size": 84213 }
      }
    ]
  }
}
```

#### Endpoint: GET /users/me/messages/{messageId}/attachments/{id} (attachments.get)

- **Purpose:** Download attachment bytes (base64url).
- **Auth:** yes · **Quota cost:** 5 units · **Idempotent:** yes

**Success response (200):**

```json
{ "size": 84213, "data": "JVBERi0xLjQKJ...base64url..." }
```

#### Endpoint: POST /users/me/messages/send (messages.send — write, scope-gated)

- **Purpose:** Send an email. **Requires `gmail.send`/`compose`/`modify`/full — NOT readonly.** 🔬
- **Auth:** yes · **Quota cost:** 100 units · **Idempotent:** no

**Request body** (metadata variant — message under ~existing limits):

```json
{ "raw": "RnJvbTogbWVAY29tcGFueS5leGFtcGxlDQpUbzogYUBleC5jb20NClN1YmplY3Q6IEhpDQoNCkJvZHk=" }
```

> `raw` is the **base64url-encoded** full RFC 2822 message. The provider builds it with
> `email.mime.text.MIMEText` then `base64.urlsafe_b64encode`. For attachments use the
> `/upload/gmail/v1/users/me/messages/send` endpoint. [INFERRED — code + DOCUMENTED]

**Success response (200):**

```json
{ "id": "msg_id_123", "threadId": "thread_456", "labelIds": ["SENT"] }
```

### 4.2 Full Endpoint Index [IMPORTANT]

| Method | Path                                        | Purpose                 | Auth | Pagination | Scope floor   |
| ------ | ------------------------------------------- | ----------------------- | ---- | ---------- | ------------- |
| GET    | `/users/me/profile`                         | Mailbox profile/email   | yes  | no         | readonly      |
| GET    | `/users/me/labels`                          | List labels             | yes  | no         | readonly      |
| GET    | `/users/me/labels/{id}`                     | Get one label           | yes  | no         | readonly      |
| GET    | `/users/me/messages`                        | List/search messages    | yes  | yes        | readonly      |
| GET    | `/users/me/messages/{id}`                   | Get a message           | yes  | no         | readonly      |
| GET    | `/users/me/messages/{mid}/attachments/{id}` | Get attachment bytes    | yes  | no         | readonly      |
| GET    | `/users/me/threads`                         | List/search threads     | yes  | yes        | readonly      |
| GET    | `/users/me/threads/{id}`                    | Get a thread (msgs)     | yes  | no         | readonly      |
| GET    | `/users/me/drafts`                          | List drafts             | yes  | yes        | readonly      |
| GET    | `/users/me/history`                         | Incremental change feed | yes  | yes        | readonly      |
| POST   | `/users/me/messages/send`                   | Send email              | yes  | no         | **send** 🔬   |
| POST   | `/users/me/messages/{id}/modify`            | Add/remove labels       | yes  | no         | **modify** 🚫 |
| POST   | `/users/me/watch`                           | Start Pub/Sub push      | yes  | no         | readonly      |
| POST   | `/users/me/stop`                            | Stop Pub/Sub push       | yes  | no         | readonly      |

🚫 out of scope (readonly) · 🔬 needs scope broadening to ship.

---

## Phase 5 — Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported? | Syntax                                 | Notes                                          |
| ------------------------------- | ---------- | -------------------------------------- | ---------------------------------------------- |
| Filter by field value           | Yes        | `q=from:x@y.com`                       | Via Gmail search operators                     |
| Filter by date range            | Yes        | `q=after:2026/01/01 before:2026/02/01` | `older_than:`/`newer_than:` also               |
| Full-text search                | Yes        | `q=invoice`                            | Searches subject + body + attachments          |
| Sort by field                   | **No**     | —                                      | Always reverse-chronological; not configurable |
| Sort direction                  | **No**     | —                                      | Newest-first, fixed                            |
| Field selection / sparse fields | Partial    | `format=metadata&metadataHeaders=…`    | Only on `messages.get`, not list               |
| Include related records         | No         | —                                      | Must fetch thread/attachments separately       |
| Aggregate / count               | Partial    | `resultSizeEstimate`, `messagesTotal`  | Estimate only, not exact via list              |
| Logical operators (AND/OR)      | Yes        | space=AND, `OR`/`{}`=OR, `-`=NOT       | `from:a OR from:b`; `-in:spam`                 |
| Comparison operators            | Partial    | `larger:5M`, `smaller:1M`, dates       | Size + date only                               |
| Null checks                     | Partial    | `has:attachment`, `is:unread`          | Presence-style                                 |
| Regex / pattern matching        | No         | —                                      | Plain token matching only                      |

### 5.2 Filter Syntax [REQUIRED]

```
GET /users/me/messages?q=<gmail search expression>&labelIds=<id>&maxResults=50
```

The `q` parameter uses the **same operators as the Gmail search box**. Key operators: [DOCUMENTED]

```
from:billing@acme.example          # sender
to:me                              # recipient
subject:invoice                    # subject contains
is:unread  is:read  is:starred  is:important
has:attachment  filename:pdf
label:Clients/Acme  in:inbox  in:sent  -in:spam
after:2026/01/01  before:2026/03/01  newer_than:7d  older_than:1y
larger:5M  smaller:500K
rfc822msgid:<abc@mail.example>      # exact Message-ID header lookup
```

- **Combining:** whitespace = AND. `OR` (uppercase) or `{a b}` = OR. `-term` = NOT. Parentheses
  group. [DOCUMENTED]

### 5.3 Sort Syntax [IMPORTANT]

**Not supported.** Results are always newest-first by `internalDate`. To get oldest-first, the
client must page through and reverse, or bound with `after:`/`before:`. [DOCUMENTED]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1 — Unread in inbox:**

```http
GET /users/me/messages?q=is:unread in:inbox&maxResults=25
```

**Pattern 2 — From a sender, last 30 days:**

```http
GET /users/me/messages?q=from:billing@acme.example newer_than:30d
```

**Pattern 3 — Messages with PDF attachments:**

```http
GET /users/me/messages?q=has:attachment filename:pdf
```

**Pattern 4 — List a specific label/folder (no search):**

```http
GET /users/me/messages?labelIds=Label_42&maxResults=50
```

---

## Phase 6 — Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

| Item                | Value                                                       | Confidence   |
| ------------------- | ----------------------------------------------------------- | ------------ |
| Pagination type     | **Cursor (opaque page token)**                              | [DOCUMENTED] |
| Default page size   | 100 (`maxResults`)                                          | [DOCUMENTED] |
| Maximum page size   | **500** (`maxResults`) — provider caps its own calls at 100 | [DOCUMENTED] |
| Total count         | `resultSizeEstimate` (approximate, not exact)               | [DOCUMENTED] |
| Request param       | `pageToken`                                                 | [DOCUMENTED] |
| Response param      | `nextPageToken`                                             | [DOCUMENTED] |
| Last-page detection | `nextPageToken` absent from the response                    | [DOCUMENTED] |

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /users/me/messages?labelIds=INBOX&maxResults=50
        → { messages:[…50…], nextPageToken:"08945763213548163492" }
Page 2: GET /users/me/messages?labelIds=INBOX&maxResults=50&pageToken=08945763213548163492
        → { messages:[…50…], nextPageToken:"11920043928374650091" }
Last:   GET …&pageToken=11920043928374650091
        → { messages:[…7…] }      # no nextPageToken → stop
```

### 6.3 Bulk Operations [IMPORTANT]

| Operation             | Endpoint                            | Max Batch | Notes                                     |
| --------------------- | ----------------------------------- | --------- | ----------------------------------------- |
| Bulk modify labels    | `POST …/messages/batchModify`       | 1000 ids  | Needs `gmail.modify` 🚫 (out of scope)    |
| Bulk delete           | `POST …/messages/batchDelete`       | 1000 ids  | Needs full `https://mail.google.com/` 🚫  |
| Bulk read / batch get | HTTP **batch** to `/batch/gmail/v1` | 100 reqs  | Multipart batch wrapper; reduces RT count |

- **Partial failure:** the HTTP batch endpoint returns per-sub-request status; failures don't
  abort the batch. [DOCUMENTED]
- Numa's provider does **not** use the batch endpoint today — it issues serial `messages.get`
  calls per stub. A future optimisation. [INFERRED — code]

### 6.4 Export [NICE-TO-HAVE]

No bulk export endpoint. `format=raw` on `messages.get` yields the full RFC 2822 message for
archival. Google Takeout (out-of-band) is the mass-export path. [DOCUMENTED]

---

## Phase 7 — Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism              | Supported? | Notes                                                     |
| ---------------------- | ---------- | --------------------------------------------------------- |
| Webhooks (direct HTTP) | No         | No direct webhook; push is Pub/Sub-mediated               |
| Cloud Pub/Sub push     | **Yes**    | `users.watch` → topic → push subscription → your endpoint |
| WebSocket              | No         | —                                                         |
| Server-Sent Events     | No         | —                                                         |
| Change feed            | **Yes**    | `users.history.list` (poll with `startHistoryId`)         |

### 7.2 Push Notifications (`users.watch`) [IMPORTANT]

> The connector registry declares `eventTypes` (`new_email`, `email_read`, `label_changed`,
> `email_sent`) for Numa Automations triggers. Gmail itself does **not** emit those discrete
> event types — it emits a single "mailbox changed" Pub/Sub ping; Numa must derive the specific
> event by diffing `history.list`. [INFERRED — registry + docs]

**Setup:** Create a Cloud Pub/Sub topic, grant `gmail-api-push@system.gserviceaccount.com` the
Publisher role, then call: [DOCUMENTED]

```http
POST /users/me/watch
{
  "topicName": "projects/<gcp-project>/topics/gmail-numa",
  "labelIds": ["INBOX"],
  "labelFilterBehavior": "INCLUDE"
}
```

**Watch response:**

```json
{ "historyId": "1234567890", "expiration": "1431990098200" }
```

**Notification payload (Pub/Sub message `data`, base64-decoded):**

```json
{ "emailAddress": "user@example.com", "historyId": "9876543210" }
```

**Reliability / lifecycle:**

- **Must re-call `watch` at least every 7 days** (Google recommends daily) or push stops. [DOCUMENTED]
- The notification carries **only** `historyId` — you must call `history.list?startHistoryId=…`
  to learn what actually changed (messagesAdded, labelsAdded/Removed, etc.). [DOCUMENTED]
- Pub/Sub gives at-least-once delivery → **duplicate notifications are possible**; dedupe on
  `historyId`. [DOCUMENTED]
- **Operational weight:** this requires a GCP Pub/Sub topic in Numa's Google project — heavier
  than an HMAC webhook. **🔬 LIVE-CONFIRM** the full plumbing before relying on triggers.

### 7.4 Polling Fallback [IMPORTANT]

- **Endpoint:** `users.history.list?startHistoryId=<last seen>` (incremental) or
  `messages.list?q=newer_than:1h` (coarse). [DOCUMENTED]
- **Interval:** Respect quota; the registry `cachingPolicy.email` TTL is **60s** — polling much
  faster than that is wasteful. [INFERRED — registry]
- **Change-detection field:** `historyId` (preferred) or `internalDate`. [DOCUMENTED]

---

## Phase 8 — Operational Concerns

### 8.1 Rate Limits [REQUIRED]

Gmail uses a **quota-unit** model, not raw request counts. [DOCUMENTED]

| Scope                          | Limit                  | Window  | Notes                              |
| ------------------------------ | ---------------------- | ------- | ---------------------------------- |
| Per project                    | 1,200,000 quota units  | /minute | Project-wide ceiling               |
| Per user per project           | **6,000 quota units**  | /minute | **The limit you'll actually hit**  |
| Per project (daily, free tier) | 80,000,000 quota units | /day    | Above this, billing/quota increase |

**Per-method quota-unit cost:** [DOCUMENTED]

| Method            | Units |
| ----------------- | ----- |
| `messages.list`   | 5     |
| `messages.get`    | 5     |
| `messages.send`   | 100   |
| `messages.modify` | 5     |
| `labels.list`     | 1     |
| `drafts.send`     | 100   |
| `history.list`    | 2     |
| `attachments.get` | 5     |

> At 6,000 units/user/min, you can do ~1,200 `messages.get` calls/min/user. A 50-row folder
> listing (≈255 units) is cheap; runaway pagination over thousands of messages is the risk.

**Rate-limit exceeded response (403):** [DOCUMENTED]

```json
{
  "error": {
    "code": 403,
    "message": "User-rate limit exceeded.  Retry after 2026-05-29T12:00:05.000Z",
    "errors": [{ "domain": "usageLimits", "reason": "userRateLimitExceeded", "message": "User Rate Limit Exceeded" }]
  }
}
```

- Common reasons: `rateLimitExceeded`, `userRateLimitExceeded`, `dailyLimitExceeded` (all 403),
  plus 429 `Too Many Requests` on the newer quota system. [DOCUMENTED]
- **`Retry-After`:** not reliably present — Google's guidance is **truncated exponential backoff**
  with jitter, max backoff 32–64s. The in-repo `_make_request_with_retry` already implements
  retry. [DOCUMENTED]

### 8.2 Error Handling [REQUIRED]

**Standard Google error envelope** (`error` object + `errors[]`): [DOCUMENTED]

```json
{
  "error": {
    "code": 401,
    "message": "Invalid Credentials",
    "errors": [
      {
        "domain": "global",
        "reason": "authError",
        "message": "Invalid Credentials",
        "locationType": "header",
        "location": "Authorization"
      }
    ],
    "status": "UNAUTHENTICATED"
  }
}
```

| HTTP | Reason                                                               | Meaning                                  | Retryable? | Recovery                      |
| ---- | -------------------------------------------------------------------- | ---------------------------------------- | ---------- | ----------------------------- |
| 400  | `invalidArgument` / parse                                            | Bad `q`, bad param                       | No         | Fix request                   |
| 401  | `authError`                                                          | Expired/invalid access token             | Yes        | Refresh token, retry once     |
| 403  | `insufficientPermissions`                                            | Scope missing (e.g. send under readonly) | No         | Re-consent with broader scope |
| 403  | `rateLimitExceeded` / `userRateLimitExceeded` / `dailyLimitExceeded` | Quota                                    | Yes        | Exponential backoff           |
| 403  | `domainPolicy`                                                       | Workspace admin blocked the API          | No         | Admin must allow              |
| 404  | `notFound`                                                           | Message/label id doesn't exist           | No         | —                             |
| 429  | `RESOURCE_EXHAUSTED`                                                 | Quota (newer surface)                    | Yes        | Backoff + retry               |
| 500  | `backendError`                                                       | Transient server error                   | Yes        | Retry with backoff            |
| 503  | `SERVICE_UNAVAILABLE`                                                | Overloaded                               | Yes        | Retry with backoff            |

**OAuth token errors** (token endpoint, not API): `{"error":"invalid_grant"}` — refresh token
revoked/expired → force full re-consent. [DOCUMENTED]

### 8.3 Idempotency [IMPORTANT]

- **No idempotency-key header.** [DOCUMENTED]
- GET = naturally idempotent. `messages.send` = **not** idempotent (re-POST sends a duplicate) —
  out of scope for the readonly connector anyway. [DOCUMENTED]

### 8.5 File Handling [IMPORTANT]

- **Attachments (download):** `GET …/messages/{mid}/attachments/{attId}` → `{size, data}` where
  `data` is **base64url**. Inline-small parts arrive in `payload…body.data`; large ones require
  the attachment fetch. [DOCUMENTED]
- **Send with attachment (upload):** `POST /upload/gmail/v1/users/me/messages/send` (resumable/
  multipart MIME). Out of scope under readonly. [DOCUMENTED]
- **Body decoding:** all body/attachment `data` is base64url; pad to a multiple of 4 then
  `base64.urlsafe_b64decode` (exactly what the provider does). [INFERRED — code]

---

## Phase 9 — Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                         | Fits?   | Notes                                             |
| -------------------------- | --------------------------------------------------- | ------- | ------------------------------------------------- |
| Data Connector             | API has file-like content to browse/search/download | —       | Subsumed by the Files variant below               |
| **Data Connector (Files)** | API is primarily a file/document store              | **✅**  | Labels → folders, emails → files; provider exists |
| Direct API Only            | Action-oriented, no browsable content               | partial | Send is an action, but it's a minor add-on        |
| Hybrid                     | Browsable content AND action capabilities           | (✅)    | Read = files browser; send = optional API action  |

**Selected integration path:** **Data Connector (Files), provider-class implementation — surfaces
`['files', 'chat']`.** With an optional, scope-gated send action (Hybrid leaning).

**Justification:** Unlike the spec-driven `connect_request` connectors (Zoho, Actionstep,
NetSuite — `surfaces: ['chat']`, no provider class), **Gmail is the file-browser case**. The
registry sets `surfaces: ['files', 'chat']`, and a concrete
`GmailProvider(OAuthProvider)` already exists at
`lib/oauth-providers/oauth_providers/gmail_provider.py`, modelling **labels as folders and emails
as files** so the mailbox renders in the generic **Files > Remote** tab with no bespoke UI. This
is the same architectural lane as Google Drive, OneDrive, and Dropbox. The agent reads emails via
the standard connector file interface (`list_files` / `search_files` / `download_file` /
`get_file_metadata`); a `send_email` action is also implemented but is **scope-gated** and not yet
enabled by the registry's `gmail.readonly` scope (see Phase 2 mismatch).

### 9.2 Connector Requirements [IMPORTANT]

> Maps directly to the implemented `GmailProvider` methods. [INFERRED — code]

| Connector Method         | API Endpoint                                          | Notes                                            |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------ |
| `list_files`             | `labels.list` (root) / `messages.list?labelIds=`      | No folder_id → labels; with folder_id → messages |
| `search_files`           | `messages.list?q=…`                                   | Gmail search syntax; optional `labelIds` scope   |
| `download_file`          | `messages.get?format=full` → extract HTML/text body   | Returns decoded body as UTF-8 bytes              |
| `get_file_metadata`      | `messages.get?format=metadata` (Subject/From/Date/To) | Maps to `OAuthFileMetadata`                      |
| `upload_file` (optional) | n/a                                                   | Not implemented (mailbox isn't a drop target)    |
| `delete_file` (optional) | n/a                                                   | Out of scope (needs full mail scope)             |
| `send_email` (action)    | `messages.send` (`{raw}` base64url)                   | **Scope-gated — needs `gmail.send`** 🔬          |

**Auth type for connector:** OAuth 2.0 (Google) · **Connector category:** email
**Caching appropriate:** yes — `CACHING_PRESETS.email`, **TTL 60s** (mail changes often; short TTL).

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope, under `gmail.readonly`):**

1. Browse labels as folders and list emails within them (Files > Remote).
2. Full-text search the mailbox with Gmail operators (`from:`, `is:unread`, date ranges, `has:attachment`).
3. Open and read an email's body (HTML/plain) and metadata; download attachment bytes.

**CANNOT do (out of scope or dangerous):**

1. **Send email** — `messages.send` 403s under `gmail.readonly`. Requires adding `gmail.send`. 🔬
2. **Modify/label/trash/delete** — `messages.modify`/`trash`/`batchDelete` need `gmail.modify`
   or full `https://mail.google.com/`; intentionally not granted.
3. **Read other users' mailboxes** — only `me`; no domain-wide delegation.

**Default parameters:**

| Parameter    | Default                           | Reason                                                 |
| ------------ | --------------------------------- | ------------------------------------------------------ |
| `userId`     | `me`                              | Always the consented user                              |
| `maxResults` | 50 (cap 100)                      | Provider caps; balances UX vs. N+1 `messages.get` cost |
| `format`     | `metadata` (list) / `full` (open) | Cheap listing; full only when reading                  |
| cache TTL    | 60s                               | Email is high-churn (`CACHING_PRESETS.email`)          |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK                        | Language | Quality   | Maintained? | Worth Using? | Notes                                            |
| -------------------------- | -------- | --------- | ----------- | ------------ | ------------------------------------------------ |
| `google-api-python-client` | Python   | excellent | yes         | **No**       | Numa uses raw `httpx` via the OAuthProvider base |
| `googleapis` (node)        | Node.js  | excellent | yes         | No           | Same — provider pattern, not SDK                 |

---

## Phase 10 — Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 — sources identified, quality assessed (excellent)
- [ ] **Phase 2 — first successful LIVE call NOT done (no consented mailbox)** 🔬 — but a working
      in-repo provider corroborates every read endpoint shape
- [x] Phase 3 — core entities + fields + relationships documented
- [x] Phase 4 — >5 critical endpoints with request/response
- [x] Phase 5 — query/filter (Gmail `q` syntax) documented
- [x] Phase 6 — pagination model + worked example
- [x] Phase 7 — events assessed (Pub/Sub push + history change feed)
- [x] Phase 8 — rate limits (quota-unit model) + error envelope documented
- [x] Phase 9 — integration path selected + justified

**Overall investigation confidence:** **high** (read surface) / **medium** (send + push, pending
scope decision and live plumbing test).

**Known gaps that will reduce output quality:**

1. **Scope decision for send** — registry is `gmail.readonly`; `send_email` will 403 until
   `gmail.send` is added. Resolve before exposing send. 🔬
2. **Push triggers plumbing** — `eventTypes` in the registry require Cloud Pub/Sub + `history.list`
   diffing; not yet validated end-to-end. 🔬
3. **OAuth verification** — restricted-scope (CASA) verification is required for production;
   operational, not technical. 🔬

### 10.2 Generation Prompts [REQUIRED]

Standard set. Because this is a **Data Connector (Files)** path, **`03-connector-setup.md` IS in
scope** (unlike the chat-only Direct API connectors). The provider already exists, so `03` should
document the existing `GmailProvider` rather than scaffold a new one.

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps                                            |
| ---------------------------- | ------------- | ---------- | ----------------------------------------------- |
| 01-llm-api-rules             | Yes           | High       | Note read-only scope limit                      |
| 01a-domain-model-reference   | Yes           | High       | Message/Label/Thread well documented            |
| 01b-query-patterns           | Yes           | High       | Gmail `q` operators + cursor pagination         |
| 01c-mutation-patterns        | Partial       | Medium     | Only `send` (scope-gated); read-only otherwise  |
| 01d-event-and-error-handling | Yes           | High       | Push setup is heavyweight; error envelope solid |
| 02-api-spec-investigation    | Yes           | High       | —                                               |
| 03-connector-setup           | Yes           | High       | Document existing provider; flag scope/send     |

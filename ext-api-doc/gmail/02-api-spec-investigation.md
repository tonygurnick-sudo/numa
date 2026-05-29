---
api_name: 'Gmail API'
api_slug: 'gmail'
base_url: 'https://gmail.googleapis.com/gmail/v1'
version: 'v1'
spec_format: 'Google Discovery Document (OpenAPI-equivalent)'
spec_url: 'https://gmail.googleapis.com/$discovery/rest?version=v1'
docs_url: 'https://developers.google.com/workspace/gmail/api'
date_researched: '2026-05-29'
---

# Gmail API — API Specification & Investigation

> Clean developer reference for the Gmail API. Condensed output of the investigation
> questionnaire — everything needed to integrate, in one place.
>
> **Doc-based investigation.** No live OAuth call was made at research time, but a working
> Numa provider (`lib/oauth-providers/oauth_providers/gmail_provider.py`) already exercises the
> read endpoints, so request/response shapes are corroborated by running code. Items still
> needing a live smoke test are tagged 🔬.

---

## Overview

- **Vendor:** Google LLC.
- **API version:** `v1` (stable).
- **Base URL:** `https://gmail.googleapis.com/gmail/v1` — all paths are under `/users/{userId}`,
  and `userId` is always `me` (the consented mailbox).
- **Upload base URL:** `https://gmail.googleapis.com/upload/gmail/v1` (for send-with-attachment;
  out of scope under the current read-only scope).
- **Sandbox URL:** None — Gmail has no separate sandbox. You test against a real Google account
  (ideally a throwaway one), gated by the OAuth consent screen.
- **API type:** REST. **Data format:** JSON (`application/json; charset=UTF-8`).
- **Documentation:** [developers.google.com/workspace/gmail/api](https://developers.google.com/workspace/gmail/api)
- **API reference:** [REST reference](https://developers.google.com/workspace/gmail/api/reference/rest)
- **OpenAPI / spec:** Google publishes a machine-readable **Discovery Document** (not OpenAPI but
  equivalent — full method + schema catalog): `https://gmail.googleapis.com/$discovery/rest?version=v1`
- **Status page:** [Google Workspace Status Dashboard](https://www.google.com/appsstatus/dashboard/)

**Summary:** Gmail API v1 is a REST/JSON API over a user's mailbox — list/get/search messages and
threads, read labels, download attachments, and (with a write scope) send mail. In Numa it is
wired as a **Data Connector (Files)**: labels render as folders and emails as files in
**Files > Remote**.

---

## Authentication

### Method: OAuth 2.0 (Google) — Authorization Code grant + refresh

User-context only. Every call carries a bearer access token for the consented mailbox; there is
no machine-to-machine mode (domain-wide delegation is a Workspace-admin feature, not used here).
The values below are taken **verbatim from the connector registry entry**
(`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, `id: 'gmail'`).

**Header format:**

```
Authorization: Bearer <access_token>
Content-Type: application/json; charset=UTF-8
```

**OAuth 2.0:**

| Parameter         | Value                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Grant type        | `authorization_code` (refresh via `grant_type=refresh_token`)                                         |
| Authorization URL | `https://accounts.google.com/o/oauth2/v2/auth`                                                        |
| Token URL         | `https://oauth2.googleapis.com/token`                                                                 |
| Revocation URL    | `https://oauth2.googleapis.com/revoke`                                                                |
| Discovery URL     | `https://accounts.google.com/.well-known/openid-configuration`                                        |
| `extraAuthParams` | `{"access_type":"offline","prompt":"consent"}` (forces refresh token)                                 |
| Token lifetime    | access ~3600s (1h); refresh long-lived, non-rotating                                                  |
| Refresh mechanism | POST token URL with `grant_type=refresh_token`                                                        |
| PKCE required     | No — web-server flow uses a client secret (Google supports PKCE but does not require it for web apps) |

`oauthPlatform: 'google'` in the registry — Gmail shares an OAuth client family with Google Drive
and Google Calendar.

**Required scopes:**

| Scope                                            | Purpose                                                                          | Required for Integration?              |
| ------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------- |
| `https://www.googleapis.com/auth/gmail.readonly` | Read all resources + metadata; full-text `q` search; download bodies/attachments | **Yes** — the registry scope           |
| `https://www.googleapis.com/auth/gmail.metadata` | Headers + labels only — **no body, no `q` search**                               | No — too restrictive, breaks search    |
| `https://www.googleapis.com/auth/gmail.send`     | Send mail (no read)                                                              | Only if send is shipped (see below) 🔬 |
| `https://www.googleapis.com/auth/gmail.compose`  | Create/update drafts + send                                                      | No                                     |
| `https://www.googleapis.com/auth/gmail.modify`   | Read + write (labels, modify); no permanent delete                               | No — overbroad                         |
| `https://mail.google.com/`                       | Full mailbox incl. permanent delete                                              | No — most dangerous, avoid             |

> **Scope mismatch to resolve before send works.** The registry grants only `gmail.readonly`. The
> provider implements `send_email` (POST `…/messages/send`), but `messages.send` requires a write
> scope (`gmail.send`/`compose`/`modify`/full) and **403s under `gmail.readonly`**. Reading,
> listing, searching, and downloading all work. Decision: keep read-only, or broaden the registry
> scope to add `gmail.send` if send is intentionally shipped. 🔬 LIVE-CONFIRM the 403.
>
> **Do not "tighten" to `gmail.metadata`.** It cannot be combined with the `q` (search) parameter
> and returns no body — `gmail.readonly` is the correct floor for a search-and-read connector.

> **Operational hurdle — restricted-scope verification.** All Gmail scopes are "restricted/
> sensitive". An unverified app shows an "unverified app" warning and is capped at 100 test users.
> Production use requires Google's OAuth verification, including a third-party CASA security
> assessment for restricted scopes. This is the single biggest operational gate. [DOCUMENTED]

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

---

## Endpoint Catalog

> Base: `https://gmail.googleapis.com/gmail/v1`. All paths under `/users/me`.

### Labels

| Method | Path                    | Purpose         | Auth | Paginated | Idempotent |
| ------ | ----------------------- | --------------- | ---- | --------- | ---------- |
| GET    | `/users/me/labels`      | List all labels | Yes  | No        | Yes        |
| GET    | `/users/me/labels/{id}` | Get one label   | Yes  | No        | Yes        |

### Messages

| Method | Path                                        | Purpose                | Auth | Paginated | Idempotent |
| ------ | ------------------------------------------- | ---------------------- | ---- | --------- | ---------- |
| GET    | `/users/me/messages`                        | List / search messages | Yes  | Yes       | Yes        |
| GET    | `/users/me/messages/{id}`                   | Get a message          | Yes  | No        | Yes        |
| GET    | `/users/me/messages/{mid}/attachments/{id}` | Get attachment bytes   | Yes  | No        | Yes        |
| POST   | `/users/me/messages/send`                   | Send email 🔬          | Yes  | No        | **No**     |
| POST   | `/users/me/messages/{id}/modify`            | Add/remove labels 🚫   | Yes  | No        | No         |

### Threads, Drafts, History, Profile, Watch

| Method | Path                     | Purpose                 | Auth | Paginated | Idempotent |
| ------ | ------------------------ | ----------------------- | ---- | --------- | ---------- |
| GET    | `/users/me/threads`      | List / search threads   | Yes  | Yes       | Yes        |
| GET    | `/users/me/threads/{id}` | Get a thread (messages) | Yes  | No        | Yes        |
| GET    | `/users/me/drafts`       | List drafts             | Yes  | Yes       | Yes        |
| GET    | `/users/me/history`      | Incremental change feed | Yes  | Yes       | Yes        |
| GET    | `/users/me/profile`      | Mailbox profile/email   | Yes  | No        | Yes        |
| POST   | `/users/me/watch`        | Start Pub/Sub push      | Yes  | No        | No         |
| POST   | `/users/me/stop`         | Stop Pub/Sub push       | Yes  | No        | Yes        |

🚫 needs `gmail.modify` (out of scope under readonly) · 🔬 needs a write scope to ship.

### Full Endpoint Index

| #   | Method | Path                                        | Purpose                 | Scope floor   |
| --- | ------ | ------------------------------------------- | ----------------------- | ------------- |
| 1   | GET    | `/users/me/profile`                         | Mailbox profile/email   | readonly      |
| 2   | GET    | `/users/me/labels`                          | List labels (root)      | readonly      |
| 3   | GET    | `/users/me/labels/{id}`                     | Get one label           | readonly      |
| 4   | GET    | `/users/me/messages`                        | List / search messages  | readonly      |
| 5   | GET    | `/users/me/messages/{id}`                   | Get a message           | readonly      |
| 6   | GET    | `/users/me/messages/{mid}/attachments/{id}` | Get attachment bytes    | readonly      |
| 7   | GET    | `/users/me/threads`                         | List / search threads   | readonly      |
| 8   | GET    | `/users/me/threads/{id}`                    | Get a thread            | readonly      |
| 9   | GET    | `/users/me/drafts`                          | List drafts             | readonly      |
| 10  | GET    | `/users/me/history`                         | Incremental change feed | readonly      |
| 11  | POST   | `/users/me/messages/send`                   | Send email              | **send** 🔬   |
| 12  | POST   | `/users/me/messages/{id}/modify`            | Add/remove labels       | **modify** 🚫 |
| 13  | POST   | `/users/me/watch`                           | Start Pub/Sub push      | readonly      |
| 14  | POST   | `/users/me/stop`                            | Stop Pub/Sub push       | readonly      |

### Worked Examples

**List labels** (the Files-Remote root) — `labels.list`, 1 quota unit:

```http
GET /gmail/v1/users/me/labels
Authorization: Bearer ya29.a0Af...
```

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

**List / search messages** — `messages.list`, 5 quota units. Query params: `q` (Gmail search
syntax), `labelIds[]`, `maxResults` (default 100, **max 500**), `pageToken`, `includeSpamTrash`:

```http
GET /gmail/v1/users/me/messages?q=is:unread%20subject:invoice%20newer_than:30d&maxResults=25
Authorization: Bearer ya29.a0Af...
```

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

> **N+1 cost note.** `messages.list` returns only `{id, threadId}` stubs. To show subject/sender,
> the provider calls `messages.get` (`format=metadata`, headers Subject/From/Date) per stub. A
> 50-message page = 1 × list (5) + 50 × get-metadata (5 each) ≈ **255 quota units**. Keep page
> sizes modest (the provider caps `maxResults` at 100).

**Get a message** — `messages.get`, 5 quota units. `format` ∈ {`minimal`,`full`,`raw`,`metadata`};
`metadataHeaders[]` when `format=metadata`:

```http
GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1?format=full
Authorization: Bearer ya29.a0Af...
```

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

**Download an attachment** — `attachments.get`, 5 quota units:

```http
GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1/attachments/ANGjdJ8...
Authorization: Bearer ya29.a0Af...
```

```json
{ "size": 84213, "data": "JVBERi0xLjQKJ...base64url..." }
```

> `data` is **base64url** (URL-safe alphabet, not standard base64). Pad to a multiple of 4 then
> `urlsafe_b64decode`. Small parts arrive inline in `payload…body.data`; large parts have an
> empty `data` and an `attachmentId` that must be fetched here.

**Send email** (scope-gated — usually BLOCKED) — `messages.send`, 100 quota units, **not idempotent**:

```http
POST /gmail/v1/users/me/messages/send
Authorization: Bearer ya29.a0Af...
Content-Type: application/json

{ "raw": "RnJvbTogbWVAY29tcGFueS5leGFtcGxlDQpUbzogYUBleC5jb20NClN1YmplY3Q6IEhpDQoNCkJvZHk=" }
```

```json
{ "id": "msg_id_123", "threadId": "thread_456", "labelIds": ["SENT"] }
```

> `raw` = base64url-encoded full RFC 2822 message. **403s under `gmail.readonly`.** The provider
> builds it via `MIMEText` + `base64.urlsafe_b64encode`.

---

## Data Models

### Message

| Field          | Type              | Required | Writable   | Description                                            |
| -------------- | ----------------- | -------- | ---------- | ------------------------------------------------------ |
| `id`           | string            | —        | No         | Immutable message id (hex), e.g. `17c4a7e5f8b9c2d1`    |
| `threadId`     | string            | —        | No         | Id of the containing thread                            |
| `labelIds`     | string[]          | —        | via modify | Labels applied (`INBOX`, `UNREAD`, `Label_42`, …)      |
| `snippet`      | string            | —        | No         | Short plain-text preview                               |
| `historyId`    | string            | —        | No         | History marker at last change                          |
| `internalDate` | string (epoch ms) | —        | No         | Internal receive timestamp; the reliable timestamp     |
| `sizeEstimate` | integer (bytes)   | —        | No         | Approx message size                                    |
| `payload`      | MessagePart       | —        | No         | MIME tree (`mimeType`, `headers[]`, `body`, `parts[]`) |
| `raw`          | string (b64url)   | —        | on send    | Whole RFC 2822 message (only when `format=raw`)        |

**MessagePart / MessagePartBody:** `payload.headers` is an array of `{name, value}`;
`payload.body` is `{attachmentId?, size, data (base64url)}`; `payload.parts[]` recurses for
multipart messages.

### Label

| Field                   | Type    | Writable   | Description                                         |
| ----------------------- | ------- | ---------- | --------------------------------------------------- |
| `id`                    | string  | No         | Immutable id (`INBOX`, `Label_42`)                  |
| `name`                  | string  | via modify | Display name (`Clients/Acme` — `/` denotes nesting) |
| `type`                  | enum    | No         | `system` \| `user`                                  |
| `messageListVisibility` | enum    | via modify | `show` \| `hide`                                    |
| `labelListVisibility`   | enum    | via modify | `labelShow` \| `labelShowIfUnread` \| `labelHide`   |
| `messagesTotal`         | integer | No         | Count of messages with the label                    |
| `messagesUnread`        | integer | No         | Unread count                                        |
| `threadsTotal`          | integer | No         | Thread count                                        |
| `color`                 | object  | via modify | `{textColor, backgroundColor}` (user labels only)   |

### Attachment

| Field  | Type            | Description                   |
| ------ | --------------- | ----------------------------- |
| `size` | integer (bytes) | Decoded attachment size       |
| `data` | string (b64url) | URL-safe base64-encoded bytes |

**Relationships:**

- A **Message** belongs to exactly one **Thread** (`threadId`) and carries N **Labels**
  (`labelIds`) — an N:M message↔label relationship.
- A **Message** has 0..N **Attachments**, reached via `payload.parts[].body.attachmentId`.
- Numa's provider models **labels as folders and emails as files**.

**Enum reference:**

| Field                   | Allowed values                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label `type`            | `system`, `user`                                                                                                                                                                          |
| System label ids        | `INBOX`, `SENT`, `DRAFT`, `SPAM`, `TRASH`, `UNREAD`, `STARRED`, `IMPORTANT`, `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS`, `CHAT` |
| `format` (messages.get) | `minimal`, `full`, `raw`, `metadata`                                                                                                                                                      |

---

## Pagination

- **Type:** cursor (opaque page token).
- **Default page size:** 100 (`maxResults`).
- **Max page size:** 500 (`maxResults`); the provider caps its own calls at 100.
- **Total count:** `resultSizeEstimate` — **approximate, not exact**. Never treat as authoritative.

**Parameters:**

| Parameter    | Type    | Default | Description                             |
| ------------ | ------- | ------- | --------------------------------------- |
| `maxResults` | integer | 100     | Page size (max 500)                     |
| `pageToken`  | string  | —       | Opaque token from prior `nextPageToken` |

**Response structure:**

```json
{
  "messages": [{ "id": "...", "threadId": "..." }],
  "nextPageToken": "08945763213548163492",
  "resultSizeEstimate": 240
}
```

**Worked example:**

```
Page 1: GET /users/me/messages?labelIds=INBOX&maxResults=50
        → { messages:[…50…], nextPageToken:"08945763213548163492" }
Page 2: GET /users/me/messages?labelIds=INBOX&maxResults=50&pageToken=08945763213548163492
        → { messages:[…50…], nextPageToken:"11920043928374650091" }
Last:   GET …&pageToken=11920043928374650091
        → { messages:[…7…] }      # no nextPageToken → stop
```

**Last page detection:** `nextPageToken` absent from the response.

### Query & filter (the `q` parameter)

The `q` parameter on `messages.list` / `threads.list` uses the **same operators as the Gmail
search box**. No sorting is supported — results are always newest-first by `internalDate`; bound
with `after:`/`before:` to constrain the range.

```
from:billing@acme.example        # sender            to:me                # recipient
subject:invoice                  # subject contains  is:unread is:read is:starred is:important
has:attachment  filename:pdf     # attachments       label:Clients/Acme  in:inbox  -in:spam
after:2026/01/01  before:2026/03/01  newer_than:7d  older_than:1y         # dates
larger:5M  smaller:500K          # size              rfc822msgid:<abc@mail.example>  # Message-ID
```

Combining: whitespace = AND, `OR` (uppercase) or `{a b}` = OR, `-term` = NOT, `()` groups.

---

## Rate Limits

Gmail uses a **quota-unit** model, not raw request counts.

| Scope                          | Limit                  | Window  | Notes                              |
| ------------------------------ | ---------------------- | ------- | ---------------------------------- |
| Per project                    | 1,200,000 quota units  | /minute | Project-wide ceiling               |
| Per user per project           | **6,000 quota units**  | /minute | **The limit you'll actually hit**  |
| Per project (daily, free tier) | 80,000,000 quota units | /day    | Above this, billing/quota increase |

**Per-method quota cost:** `messages.list` 5 · `messages.get` 5 · `attachments.get` 5 ·
`messages.modify` 5 · `labels.list` 1 · `history.list` 2 · `messages.send` 100 · `drafts.send` 100.

> At 6,000 units/user/min you can do ~1,200 `messages.get` calls/min/user. A 50-row folder listing
> (≈255 units) is cheap; runaway pagination over thousands of messages is the real risk.

**Headers:** `Retry-After` is **not reliably present**. Google's guidance is truncated exponential
backoff with jitter, max backoff ~32–64s.

**When exceeded:** 403 with reason `userRateLimitExceeded` / `rateLimitExceeded` /
`dailyLimitExceeded`, or 429 `RESOURCE_EXHAUSTED` on the newer quota surface.

```json
{
  "error": {
    "code": 403,
    "message": "User-rate limit exceeded.  Retry after 2026-05-29T12:00:05.000Z",
    "errors": [{ "domain": "usageLimits", "reason": "userRateLimitExceeded", "message": "User Rate Limit Exceeded" }]
  }
}
```

**Recommended strategy:** truncated exponential backoff + jitter; the in-repo
`_make_request_with_retry` already implements retry.

---

## Error Handling

**Standard error format (Google envelope):**

```json
{
  "error": {
    "code": 403,
    "message": "Request had insufficient authentication scopes.",
    "errors": [{ "domain": "global", "reason": "insufficientPermissions", "message": "Insufficient Permission" }],
    "status": "PERMISSION_DENIED"
  }
}
```

**Status codes:**

| Status | Meaning      | Retryable | Recovery                                                                                                                               |
| ------ | ------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | Bad request  | No        | Fix `q`/params (`invalidArgument`)                                                                                                     |
| 401    | Unauthorized | Yes       | `authError` → refresh access token, retry once                                                                                         |
| 403    | Forbidden    | Mixed     | `insufficientPermissions` = scope (re-consent, don't retry); `*rateLimitExceeded` = back off; `domainPolicy` = Workspace admin blocked |
| 404    | Not found    | No        | Verify message/label id                                                                                                                |
| 429    | Rate limited | Yes       | `RESOURCE_EXHAUSTED` → exponential backoff + jitter                                                                                    |
| 5xx    | Server error | Yes       | `backendError`/`SERVICE_UNAVAILABLE` → retry with backoff (max ~32–64s)                                                                |

> **OAuth token-endpoint errors** (token URL, not the API): `{"error":"invalid_grant"}` = refresh
> token revoked/expired → force full re-consent.
>
> **Idempotency:** no idempotency-key header. GET is naturally idempotent; `messages.send` is
> **not** (re-POST sends a duplicate) — out of scope under readonly anyway.

---

## Webhooks / Events

**Supported** via Cloud Pub/Sub push (`users.watch`) — no direct HTTP webhook. The registry
declares `eventTypes` (`new_email`, `email_read`, `label_changed`, `email_sent`) for Numa
Automations, but Gmail itself emits only a single "mailbox changed" Pub/Sub ping; Numa must
derive the discrete event by diffing `history.list`.

**Registration:** `POST /users/me/watch`

```json
{
  "topicName": "projects/<gcp-project>/topics/gmail-numa",
  "labelIds": ["INBOX"],
  "labelFilterBehavior": "INCLUDE"
}
```

**Events:**

| Event           | Trigger (derived)                | Payload Summary             |
| --------------- | -------------------------------- | --------------------------- |
| `new_email`     | Message added to a watched label | `{emailAddress, historyId}` |
| `email_read`    | `UNREAD` label removed           | `{emailAddress, historyId}` |
| `label_changed` | Labels added/removed             | `{emailAddress, historyId}` |
| `email_sent`    | Message added to `SENT`          | `{emailAddress, historyId}` |

**Verification:** Pub/Sub message authentication (the push request to your endpoint carries a
Google-signed OIDC token); there is no per-message HMAC.

**Retry policy:** Pub/Sub at-least-once → **duplicate notifications possible**; dedupe on
`historyId`. The ping carries only `{emailAddress, historyId}` — call `history.list?startHistoryId=…`
to learn what changed. **`watch` must be re-called at least every 7 days** (Google recommends
daily) or push stops. 🔬 The full Pub/Sub plumbing (topic + IAM grant to
`gmail-api-push@system.gserviceaccount.com`) needs end-to-end validation before relying on triggers.

**Polling fallback:** `users.history.list?startHistoryId=<last seen>` (incremental) or
`messages.list?q=newer_than:1h` (coarse). Honour the `cachingPolicy.email` TTL (60s) — don't poll
faster than that.

---

## Known Limitations

1. **Read-only by default** — `messages.send`, `modify`, `trash`, `delete` all need broader scopes
   not granted by the `gmail.readonly` registry scope. Send is implemented but will 403. 🔬
2. **No sorting** — results are always newest-first by `internalDate`; bound with `after:`/`before:`.
3. **N+1 reads** — `messages.list` returns stubs; subject/sender require a `messages.get` per id,
   so listings are quota-heavy (≈255 units for a 50-row page).
4. **`format=metadata` excludes `q` and bodies** — `gmail.readonly` is the floor; don't use the
   `gmail.metadata` scope.
5. **`userId` is always `me`** — no reading other mailboxes without Workspace domain-wide delegation.
6. **Restricted-scope verification** — production requires Google OAuth verification + CASA
   assessment; an operational, not technical, blocker.

---

## SDKs & Tooling

| SDK                        | Language | Repository                          | Quality   | Notes                                                          |
| -------------------------- | -------- | ----------------------------------- | --------- | -------------------------------------------------------------- |
| `google-api-python-client` | Python   | googleapis/google-api-python-client | excellent | Numa uses raw `httpx` via the OAuthProvider base, not this SDK |
| `googleapis`               | Node.js  | googleapis/google-api-nodejs-client | excellent | Not used — provider pattern, not SDK                           |

**Postman collection:** Not first-party. **OpenAPI spec:** Use the Google Discovery Document:
`https://gmail.googleapis.com/$discovery/rest?version=v1`.

---

## Integration Path Assessment

**Recommended path:** **Data Connector (Files)** — provider-class implementation, surfacing
`['files', 'chat']` (Hybrid-leaning, with an optional scope-gated send action).

**Justification:** Unlike the spec-driven `connect_request` connectors (Actionstep, NetSuite,
Zoho — `surfaces: ['chat']`, no provider class), Gmail is the **file-browser case**, the same lane
as Google Drive, OneDrive, and Dropbox. The registry sets `surfaces: ['files', 'chat']`, and a
concrete `GmailProvider(OAuthProvider)` already exists at
`lib/oauth-providers/oauth_providers/gmail_provider.py`, modelling **labels as folders and emails
as files** so the mailbox renders in **Files > Remote** with no bespoke UI. The agent reads emails
through the standard connector file interface (`list_files` / `search_files` / `download_file` /
`get_file_metadata`). A `send_email` action also exists but is **scope-gated** and not enabled by
the registry's `gmail.readonly` scope.

**Connector compatibility:**

| Connector Method    | API Endpoint                                          | Feasibility              |
| ------------------- | ----------------------------------------------------- | ------------------------ |
| list_files          | `labels.list` (root) / `messages.list?labelIds=`      | good                     |
| download_file       | `messages.get?format=full` → extract HTML/text body   | good                     |
| search_files        | `messages.list?q=…`                                   | good                     |
| get_file_metadata   | `messages.get?format=metadata` (Subject/From/Date/To) | good                     |
| send_email (action) | `messages.send` (`{raw}` base64url)                   | partial — scope-gated 🔬 |

---

_Researched on 2026-05-29 (documentation-based; corroborated by the in-repo `GmailProvider`; live
smoke test pending). Source: investigation questionnaire._

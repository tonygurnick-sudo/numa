---
api_name: Gmail API
api_slug: gmail
base_url: https://gmail.googleapis.com/gmail/v1 (version /gmail/v1 already in base; do NOT add a second /v1 segment)
upload_base_url: https://gmail.googleapis.com/upload/gmail/v1
path_rule: all paths under /users/me; userId is ALWAYS "me"
call_surface: file-browse connector (list-files/search-files/download-file); raw HTTP below is reference/debug. Scope-gated send_email action also exists.
spec_format: Google Discovery Document (OpenAPI-equivalent)
spec_url: https://gmail.googleapis.com/$discovery/rest?version=v1
docs_url: https://developers.google.com/workspace/gmail/api
auth: OAuth2 (Google) — Authorization Code + refresh; Bearer; user-context only
registry_scope: https://www.googleapis.com/auth/gmail.readonly
confidence: [DOCUMENTED] or corroborated by in-repo GmailProvider (lib/oauth-providers/oauth_providers/gmail_provider.py); no live OAuth call at research time. 🔬 = needs live smoke test.
date_researched: 2026-05-29
---

# Gmail — API Specification & Investigation

Developer reference for the Gmail API. Gmail API `v1` (stable) is a REST/JSON API over a user's mailbox — list/get/search messages and threads, read labels, download attachments, and (with a write scope) send mail. In Numa it is a **Data Connector (Files)**: labels render as folders, emails as files in **Files > Remote**.

## Overview

- Vendor: Google LLC. API version `v1` (stable). Data format JSON (`application/json; charset=UTF-8`).
- Base URL `https://gmail.googleapis.com/gmail/v1` — all paths under `/users/me` (`userId` always `me`). The `/gmail/v1` version segment is part of the base URL; do NOT add another.
- Upload base URL `https://gmail.googleapis.com/upload/gmail/v1` (send-with-attachment; out of scope under readonly).
- Sandbox: none — test against a real Google account (throwaway ideal), gated by the OAuth consent screen.
- Docs: developers.google.com/workspace/gmail/api · REST reference: …/api/reference/rest · Discovery doc (machine-readable, OpenAPI-equivalent): `https://gmail.googleapis.com/$discovery/rest?version=v1` · Status: google.com/appsstatus/dashboard.

## Authentication

OAuth 2.0 (Google), Authorization Code grant + refresh. User-context only — every call carries a bearer access token for the consented mailbox; no machine-to-machine (domain-wide delegation is a Workspace-admin feature, not used). Values taken verbatim from the connector registry (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, `id:'gmail'`). Header: `Authorization: Bearer <access_token>` + `Content-Type: application/json; charset=UTF-8`.

| Parameter         | Value                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| Grant type        | `authorization_code` (refresh via `grant_type=refresh_token`)         |
| Authorization URL | `https://accounts.google.com/o/oauth2/v2/auth`                        |
| Token URL         | `https://oauth2.googleapis.com/token`                                 |
| Revocation URL    | `https://oauth2.googleapis.com/revoke`                                |
| Discovery URL     | `https://accounts.google.com/.well-known/openid-configuration`        |
| `extraAuthParams` | `{"access_type":"offline","prompt":"consent"}` (forces refresh token) |
| Token lifetime    | access ~3600s (1h); refresh long-lived, non-rotating                  |
| PKCE required     | No — web-server flow uses a client secret                             |

`oauthPlatform:'google'` — Gmail shares an OAuth client family with Google Drive and Calendar.

**Scopes:**
| Scope | Purpose | Required? |
| --- | --- | --- |
| `https://www.googleapis.com/auth/gmail.readonly` | read all resources + metadata; full-text `q` search; download bodies/attachments | **Yes** — the registry scope |
| `https://www.googleapis.com/auth/gmail.metadata` | headers + labels only — **no body, no `q` search** | No — too restrictive, breaks search |
| `https://www.googleapis.com/auth/gmail.send` | send mail (no read) | only if send is shipped 🔬 |
| `https://www.googleapis.com/auth/gmail.compose` | create/update drafts + send | No |
| `https://www.googleapis.com/auth/gmail.modify` | read + write (labels, modify); no permanent delete | No — overbroad |
| `https://mail.google.com/` | full mailbox incl. permanent delete | No — most dangerous, avoid |

**Scope mismatch to resolve before send works.** Registry grants only `gmail.readonly`. The provider implements `send_email` (POST `…/messages/send`), but `messages.send` needs a write scope and **403s under `gmail.readonly`**. Read/list/search/download all work. Decision: keep read-only, or broaden to add `gmail.send`. 🔬 LIVE-CONFIRM the 403. **Do not "tighten" to `gmail.metadata`** — it cannot combine with `q` and returns no body; `gmail.readonly` is the correct floor.

**Restricted-scope verification (operational gate).** All Gmail scopes are restricted/sensitive. An unverified app shows an "unverified app" warning and is capped at 100 test users. Production requires Google's OAuth verification, including a third-party CASA security assessment for restricted scopes — the single biggest operational gate. [DOCUMENTED]

**Token response (Google standard):** `{"access_token":"ya29.a0Af...","expires_in":3599,"refresh_token":"1//0gF...","scope":"https://www.googleapis.com/auth/gmail.readonly","token_type":"Bearer"}`

## Endpoint Catalog

Base `https://gmail.googleapis.com/gmail/v1`; all paths under `/users/me`. 🚫 needs `gmail.modify` (out of scope) · 🔬 needs a write scope to ship.

| #   | Method | Path                                        | Purpose                 | Scope floor   | Paginated | Idempotent |
| --- | ------ | ------------------------------------------- | ----------------------- | ------------- | --------- | ---------- |
| 1   | GET    | `/users/me/profile`                         | mailbox profile/email   | readonly      | No        | Yes        |
| 2   | GET    | `/users/me/labels`                          | list labels (root)      | readonly      | No        | Yes        |
| 3   | GET    | `/users/me/labels/{id}`                     | get one label           | readonly      | No        | Yes        |
| 4   | GET    | `/users/me/messages`                        | list / search messages  | readonly      | Yes       | Yes        |
| 5   | GET    | `/users/me/messages/{id}`                   | get a message           | readonly      | No        | Yes        |
| 6   | GET    | `/users/me/messages/{mid}/attachments/{id}` | get attachment bytes    | readonly      | No        | Yes        |
| 7   | GET    | `/users/me/threads`                         | list / search threads   | readonly      | Yes       | Yes        |
| 8   | GET    | `/users/me/threads/{id}`                    | get a thread (messages) | readonly      | No        | Yes        |
| 9   | GET    | `/users/me/drafts`                          | list drafts             | readonly      | Yes       | Yes        |
| 10  | GET    | `/users/me/history`                         | incremental change feed | readonly      | Yes       | Yes        |
| 11  | POST   | `/users/me/messages/send`                   | send email              | **send** 🔬   | No        | **No**     |
| 12  | POST   | `/users/me/messages/{id}/modify`            | add/remove labels       | **modify** 🚫 | No        | No         |
| 13  | POST   | `/users/me/watch`                           | start Pub/Sub push      | readonly      | No        | No         |
| 14  | POST   | `/users/me/stop`                            | stop Pub/Sub push       | readonly      | No        | Yes        |

### Worked Examples

**List labels** (`labels.list`, 1 unit): `GET /gmail/v1/users/me/labels`
→ `{"labels":[{"id":"INBOX","name":"INBOX","type":"system","messagesTotal":1284,"messagesUnread":12,"threadsTotal":1102},{"id":"SENT","name":"SENT","type":"system"},{"id":"DRAFT","name":"DRAFT","type":"system"},{"id":"Label_42","name":"Clients/Acme","type":"user","messagesTotal":57}]}`

**List / search messages** (`messages.list`, 5 units; params `q`, `labelIds[]`, `maxResults` default 100 **max 500**, `pageToken`, `includeSpamTrash`): `GET /gmail/v1/users/me/messages?q=is:unread%20subject:invoice%20newer_than:30d&maxResults=25`
→ `{"messages":[{"id":"17c4a7e5f8b9c2d1","threadId":"17c4a7e5f8b9c2d0"},{"id":"17c4a7e1aa00bb22","threadId":"17c4a7e1aa00bb22"}],"nextPageToken":"08945763213548163492","resultSizeEstimate":2}`
N+1 cost: list returns only `{id,threadId}` stubs. For subject/sender the provider calls `messages.get` (`format=metadata`, headers Subject/From/Date) per stub. A 50-message page = 1×list(5) + 50×get-metadata(5 each) ≈ **255 units**. Provider caps `maxResults` at 100.

**Get a message** (`messages.get`, 5 units; `format` ∈ {`minimal`,`full`,`raw`,`metadata`}, `metadataHeaders[]` when `format=metadata`): `GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1?format=full`
→ `{"id":"17c4a7e5f8b9c2d1","threadId":"17c4a7e5f8b9c2d0","labelIds":["INBOX","IMPORTANT"],"snippet":"This is a preview...","internalDate":"1620000000000","sizeEstimate":2048,"payload":{"mimeType":"multipart/alternative","headers":[{"name":"From","value":"Acme Billing <billing@acme.example>"},{"name":"To","value":"me@company.example"},{"name":"Subject","value":"Invoice #4471"},{"name":"Date","value":"Mon, 03 May 2021 00:00:00 +0000"}],"parts":[{"mimeType":"text/plain","body":{"size":512,"data":"SW52b2ljZSBhdHRhY2hlZA=="}},{"mimeType":"text/html","body":{"size":1024,"data":"PGh0bWw+Li4uPC9odG1sPg=="}},{"mimeType":"application/pdf","filename":"invoice-4471.pdf","body":{"attachmentId":"ANGjdJ8...","size":84213}}]}}`

**Download an attachment** (`attachments.get`, 5 units): `GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1/attachments/ANGjdJ8...`
→ `{"size":84213,"data":"JVBERi0xLjQKJ...base64url..."}`
`data` is **base64url** (URL-safe, not standard base64). Pad to %4 then `urlsafe_b64decode`. Small parts arrive inline in `payload…body.data`; large parts have empty `data` and an `attachmentId` fetched here.

**Send email** (scope-gated — usually BLOCKED; `messages.send`, 100 units, **not idempotent**): `POST /gmail/v1/users/me/messages/send` + `Content-Type: application/json`, body `{"raw":"RnJvbTogbWVAY29tcGFueS5leGFtcGxlDQpUbzogYUBleC5jb20NClN1YmplY3Q6IEhpDQoNCkJvZHk="}`
→ `{"id":"msg_id_123","threadId":"thread_456","labelIds":["SENT"]}`
`raw` = base64url full RFC 2822. **403s under `gmail.readonly`.** Provider builds it via `MIMEText` + `base64.urlsafe_b64encode`.

## Data Models

### Message

| Field          | Type              | Writable   | Description                                            |
| -------------- | ----------------- | ---------- | ------------------------------------------------------ |
| `id`           | string            | No         | immutable hex message id, e.g. `17c4a7e5f8b9c2d1`      |
| `threadId`     | string            | No         | containing thread id                                   |
| `labelIds`     | string[]          | via modify | labels applied (`INBOX`, `UNREAD`, `Label_42`, …)      |
| `snippet`      | string            | No         | short plain-text preview                               |
| `historyId`    | string            | No         | history marker at last change                          |
| `internalDate` | string (epoch ms) | No         | internal receive time; the reliable timestamp          |
| `sizeEstimate` | integer (bytes)   | No         | approx message size                                    |
| `payload`      | MessagePart       | No         | MIME tree (`mimeType`, `headers[]`, `body`, `parts[]`) |
| `raw`          | string (b64url)   | on send    | whole RFC 2822 message (only `format=raw`)             |

MessagePart/MessagePartBody: `payload.headers` = array of `{name,value}`; `payload.body` = `{attachmentId?, size, data (base64url)}`; `payload.parts[]` recurses for multipart.

### Label

| Field                   | Type    | Writable   | Description                                         |
| ----------------------- | ------- | ---------- | --------------------------------------------------- |
| `id`                    | string  | No         | immutable id (`INBOX`, `Label_42`)                  |
| `name`                  | string  | via modify | display name (`Clients/Acme` — `/` denotes nesting) |
| `type`                  | enum    | No         | `system` \| `user`                                  |
| `messageListVisibility` | enum    | via modify | `show` \| `hide`                                    |
| `labelListVisibility`   | enum    | via modify | `labelShow` \| `labelShowIfUnread` \| `labelHide`   |
| `messagesTotal`         | integer | No         | messages with the label                             |
| `messagesUnread`        | integer | No         | unread count                                        |
| `threadsTotal`          | integer | No         | thread count                                        |
| `color`                 | object  | via modify | `{textColor, backgroundColor}` (user labels only)   |

### Attachment

`size` (integer bytes, decoded) · `data` (string, URL-safe base64-encoded bytes).

**Relationships:** Message belongs to exactly one Thread (`threadId`) and carries N Labels (`labelIds`) — N:M message↔label. Message has 0..N Attachments via `payload.parts[].body.attachmentId`. Provider models labels=folders, emails=files.

**Enums:** Label `type` = `system`/`user`. System label ids = `INBOX`, `SENT`, `DRAFT`, `SPAM`, `TRASH`, `UNREAD`, `STARRED`, `IMPORTANT`, `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS`, `CHAT`. `format` (messages.get) = `minimal`, `full`, `raw`, `metadata`.

## Pagination

Cursor (opaque page token). Default size 100 (`maxResults`), max 500 (provider caps its own calls at 100). `resultSizeEstimate` = approximate, never authoritative.

| Parameter    | Type    | Default | Description                             |
| ------------ | ------- | ------- | --------------------------------------- |
| `maxResults` | integer | 100     | page size (max 500)                     |
| `pageToken`  | string  | —       | opaque token from prior `nextPageToken` |

Response: `{"messages":[{"id":"...","threadId":"..."}],"nextPageToken":"08945763213548163492","resultSizeEstimate":240}`. Last page = `nextPageToken` absent.

```
Page 1: GET /users/me/messages?labelIds=INBOX&maxResults=50  → {messages:[…50…], nextPageToken:"08945763213548163492"}
Page 2: GET …&maxResults=50&pageToken=08945763213548163492    → {messages:[…50…], nextPageToken:"11920043928374650091"}
Last:   GET …&pageToken=11920043928374650091                  → {messages:[…7…]}   # no nextPageToken → stop
```

### Query & filter (the `q` parameter)

`q` on `messages.list`/`threads.list` uses the **same operators as the Gmail search box**. No sorting — always newest-first by `internalDate`; bound with `after:`/`before:`.

```
from:billing@acme.example   # sender         to:me              # recipient
subject:invoice             # subject         is:unread is:read is:starred is:important
has:attachment  filename:pdf # attachments    label:Clients/Acme  in:inbox  -in:spam
after:2026/01/01  before:2026/03/01  newer_than:7d  older_than:1y   # dates
larger:5M  smaller:500K     # size            rfc822msgid:<abc@mail.example>  # Message-ID
```

Combining: whitespace=AND, `OR` (uppercase) or `{a b}`=OR, `-term`=NOT, `()` groups.

## Rate Limits (quota-unit model)

Gmail uses quota units, not raw request counts.

| Scope                          | Limit            | Window  | Notes                             |
| ------------------------------ | ---------------- | ------- | --------------------------------- |
| Per project                    | 1,200,000 units  | /minute | project-wide ceiling              |
| Per user per project           | **6,000 units**  | /minute | **the limit you'll actually hit** |
| Per project (daily, free tier) | 80,000,000 units | /day    | above → billing/quota increase    |

Per-method cost: `messages.list` 5 · `messages.get` 5 · `attachments.get` 5 · `messages.modify` 5 · `labels.list` 1 · `history.list` 2 · `messages.send` 100 · `drafts.send` 100. At 6,000 units/user/min ≈ 1,200 `messages.get`/min/user; a 50-row listing (≈255 units) is cheap, runaway pagination is the real risk.

`Retry-After` is **not reliably present** → truncated exponential backoff with jitter, max ~32–64s. When exceeded: 403 reason `userRateLimitExceeded`/`rateLimitExceeded`/`dailyLimitExceeded`, or 429 `RESOURCE_EXHAUSTED` on the newer surface: `{"error":{"code":403,"message":"User-rate limit exceeded.  Retry after 2026-05-29T12:00:05.000Z","errors":[{"domain":"usageLimits","reason":"userRateLimitExceeded","message":"User Rate Limit Exceeded"}]}}`. In-repo `_make_request_with_retry` implements the retry.

## Error Handling

Standard Google envelope: `{"error":{"code":403,"message":"Request had insufficient authentication scopes.","errors":[{"domain":"global","reason":"insufficientPermissions","message":"Insufficient Permission"}],"status":"PERMISSION_DENIED"}}`

| Status | Retryable | Recovery                                                                                                                               |
| ------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | No        | fix `q`/params (`invalidArgument`)                                                                                                     |
| 401    | Yes       | `authError` → refresh access token, retry once                                                                                         |
| 403    | Mixed     | `insufficientPermissions` = scope (re-consent, don't retry); `*rateLimitExceeded` = back off; `domainPolicy` = Workspace admin blocked |
| 404    | No        | verify message/label id                                                                                                                |
| 429    | Yes       | `RESOURCE_EXHAUSTED` → exponential backoff + jitter                                                                                    |
| 5xx    | Yes       | `backendError`/`SERVICE_UNAVAILABLE` → retry with backoff (max ~32–64s)                                                                |

OAuth token-endpoint errors (token URL, not the API): `{"error":"invalid_grant"}` = refresh token revoked/expired → force full re-consent. Idempotency: no idempotency-key header; GET naturally idempotent; `messages.send` is **not** (re-POST sends a duplicate) — out of scope under readonly anyway.

## Webhooks / Events

Via Cloud Pub/Sub push (`users.watch`) — no direct HTTP webhook. Registry declares `eventTypes` (`new_email`, `email_read`, `label_changed`, `email_sent`) for Numa Automations, but Gmail emits only a single "mailbox changed" Pub/Sub ping; Numa derives the discrete event by diffing `history.list`.

Registration: `POST /users/me/watch` body `{"topicName":"projects/<gcp-project>/topics/gmail-numa","labelIds":["INBOX"],"labelFilterBehavior":"INCLUDE"}`.

| Event           | Trigger (derived)                | Payload                     |
| --------------- | -------------------------------- | --------------------------- |
| `new_email`     | message added to a watched label | `{emailAddress, historyId}` |
| `email_read`    | `UNREAD` label removed           | `{emailAddress, historyId}` |
| `label_changed` | labels added/removed             | `{emailAddress, historyId}` |
| `email_sent`    | message added to `SENT`          | `{emailAddress, historyId}` |

Verification: Pub/Sub push request carries a Google-signed OIDC token; no per-message HMAC. Retry: Pub/Sub at-least-once → duplicate notifications; dedupe on `historyId`. Ping carries only `{emailAddress, historyId}` — call `history.list?startHistoryId=…` to learn what changed. **`watch` must be re-called ≥ every 7 days** (Google recommends daily) or push stops. 🔬 Full plumbing (topic + IAM grant to `gmail-api-push@system.gserviceaccount.com`) needs end-to-end validation. Polling fallback: `users.history.list?startHistoryId=<last seen>` (incremental) or `messages.list?q=newer_than:1h` (coarse). Honour `cachingPolicy.email` TTL (60s) — don't poll faster.

## Known Limitations

1. **Read-only by default** — `messages.send`, `modify`, `trash`, `delete` need broader scopes not granted by `gmail.readonly`. Send is implemented but 403s. 🔬
2. **No sorting** — always newest-first by `internalDate`; bound with `after:`/`before:`.
3. **N+1 reads** — `messages.list` returns stubs; subject/sender need a `messages.get` per id (≈255 units for a 50-row page).
4. **`format=metadata` excludes `q` and bodies** — `gmail.readonly` is the floor; don't use `gmail.metadata`.
5. **`userId` always `me`** — no other mailboxes without Workspace domain-wide delegation.
6. **Restricted-scope verification** — production requires Google OAuth verification + CASA assessment; operational, not technical.

## SDKs & Tooling

| SDK                        | Language | Repository                          | Notes                                                                     |
| -------------------------- | -------- | ----------------------------------- | ------------------------------------------------------------------------- |
| `google-api-python-client` | Python   | googleapis/google-api-python-client | excellent; Numa uses raw `httpx` via the OAuthProvider base, not this SDK |
| `googleapis`               | Node.js  | googleapis/google-api-nodejs-client | excellent; not used — provider pattern, not SDK                           |

Postman: not first-party. OpenAPI: use the Google Discovery Document (`…/$discovery/rest?version=v1`).

## Integration Path Assessment

**Recommended:** Data Connector (Files), provider-class implementation, `surfaces: ['files','chat']` (Hybrid-leaning, with an optional scope-gated send action).

**Justification:** Unlike spec-driven `connect_request` connectors (Actionstep, NetSuite, Zoho — `surfaces:['chat']`, no provider class), Gmail is the **file-browser case** — same lane as Google Drive, OneDrive, Dropbox. Registry sets `surfaces:['files','chat']`, and a concrete `GmailProvider(OAuthProvider)` exists at `lib/oauth-providers/oauth_providers/gmail_provider.py`, modelling labels=folders, emails=files so the mailbox renders in **Files > Remote** with no bespoke UI. The agent reads emails through the standard connector file interface (`list_files`/`search_files`/`download_file`/`get_file_metadata`). A `send_email` action also exists but is scope-gated, not enabled by `gmail.readonly`.

| Connector method    | API endpoint                                          | Feasibility              |
| ------------------- | ----------------------------------------------------- | ------------------------ |
| list_files          | `labels.list` (root) / `messages.list?labelIds=`      | good                     |
| download_file       | `messages.get?format=full` → extract HTML/text body   | good                     |
| search_files        | `messages.list?q=…`                                   | good                     |
| get_file_metadata   | `messages.get?format=metadata` (Subject/From/Date/To) | good                     |
| send_email (action) | `messages.send` (`{raw}` base64url)                   | partial — scope-gated 🔬 |

Sources: developers.google.com/workspace/gmail/api (overview, REST reference, scopes), developers.google.com/identity/protocols/oauth2/web-server (OAuth), `lib/oauth-providers/oauth_providers/gmail_provider.py`.

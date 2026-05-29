---
api_name: 'Gmail API'
api_slug: 'gmail'
version: 'v1'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# Gmail API — Workspace Agent API Rules

> **Loaded into the workspace agent's context when the Gmail integration is active.**
> Gmail is wired as a **Data Connector (Files)** — labels are folders, emails are files —
> surfaced in **Files > Remote**. The connector also exposes a scope-gated `send_email` action.
> Companion files (01a–01d) hold the detailed reference.

## Context

- **API:** Gmail API `v1` (REST, JSON). `userId` is always `me` (the consented mailbox).
- **Base URL:** `https://gmail.googleapis.com/gmail/v1` (uploads: `https://gmail.googleapis.com/upload/gmail/v1`).
- **Auth:** OAuth 2.0 (Google), authorization-code + refresh. Bearer access token, user-context only.
- **Integration path:** Data Connector (Files) + selective API (Hybrid-leaning, `surfaces: ['files','chat']`).
- **Rate limits:** quota-unit model — **6,000 units/user/minute** is the limit you'll hit. Back off on 403/429.

## Auth Structure

Bearer token in the `Authorization` header. Numa's connector layer manages the OAuth dance and
token refresh — you do **not** handle it yourself. You read/search/download through the standard
connector file interface; raw HTTP examples below are for reference and debugging.

```
Authorization: Bearer <access_token>
Content-Type: application/json; charset=UTF-8
```

**Token lifecycle:**

- Access token lives ~3600s (1 hour); the connector auto-refreshes via `grant_type=refresh_token`.
- Registry scope is **`https://www.googleapis.com/auth/gmail.readonly`** — read/list/search/download work; **send does not** (see gotcha #1).

## Capabilities

### CAN

1. Browse labels as folders and list the emails inside them (Files > Remote).
2. Full-text search the mailbox with Gmail operators (`from:`, `is:unread`, date ranges, `has:attachment`).
3. Open and read an email's body (HTML/plain) + metadata, and download attachment bytes (base64url).

### CANNOT

1. **Send email under the current scope** — `messages.send` 403s under `gmail.readonly`. Needs `gmail.send`. 🔬
2. **Modify / label / archive / trash / delete** — needs `gmail.modify` or full `https://mail.google.com/` (not granted).
3. **Read another user's mailbox** — only `me`; no domain-wide delegation, no sorting (always newest-first).

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Scope is read-only:** `messages.send` (and any modify/trash/delete) returns **403
   `insufficientPermissions`** under `gmail.readonly`. Do not attempt to send unless the connector
   reports a broadened scope (`gmail.send`). If asked to send, say so and stop — don't retry.
2. **`messages.list` returns only `{id, threadId}` stubs.** To show subject/sender you must call
   `messages.get` per stub (`format=metadata`). This is an N+1 — keep page sizes modest (≤50).
3. **All body/attachment `data` is base64url** (URL-safe alphabet, not standard base64). Pad to a
   multiple of 4 before decoding, then `urlsafe_b64decode`. Plain `b64decode` will fail or corrupt.
4. **Large attachments are not inline.** `payload…body.data` is empty for big parts — fetch bytes
   via `…/messages/{mid}/attachments/{attId}`. Small parts arrive inline.
5. **`format=metadata` cannot use `q`** and returns no body. Use `format=full`/`metadata` to read,
   never `metadata` for search. `gmail.readonly` is the correct scope floor — don't "tighten" to `gmail.metadata`.

## Default Parameters

Use these unless the user specifies otherwise:

| Parameter    | Default                          | Reason                                                       |
| ------------ | -------------------------------- | ------------------------------------------------------------ |
| `userId`     | `me`                             | Always the consented user                                    |
| `maxResults` | 50 (cap 100; API max 500)        | Balances UX vs N+1 `messages.get` cost                       |
| `format`     | `metadata` (list), `full` (open) | Cheap listing; full body only when actually reading an email |
| cache TTL    | 60s (`CACHING_PRESETS.email`)    | Mail is high-churn                                           |

## Working Examples

### Example 1: List labels (the Files-Remote root)

```http
GET /gmail/v1/users/me/labels
Authorization: Bearer <token>
```

```json
{
  "labels": [
    { "id": "INBOX", "name": "INBOX", "type": "system", "messagesTotal": 1284, "messagesUnread": 12 },
    { "id": "SENT", "name": "SENT", "type": "system" },
    { "id": "Label_42", "name": "Clients/Acme", "type": "user", "messagesTotal": 57 }
  ]
}
```

### Example 2: Search the mailbox (unread invoices, last 30 days)

```http
GET /gmail/v1/users/me/messages?q=is:unread%20subject:invoice%20newer_than:30d&maxResults=25
Authorization: Bearer <token>
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

> Returns **stubs only**. Call `messages.get` per id to get Subject/From/Date.

### Example 3: Open an email (full body + headers)

```http
GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1?format=full
Authorization: Bearer <token>
```

```json
{
  "id": "17c4a7e5f8b9c2d1",
  "threadId": "17c4a7e5f8b9c2d0",
  "labelIds": ["INBOX", "IMPORTANT"],
  "snippet": "This is a preview of the message content...",
  "internalDate": "1620000000000",
  "payload": {
    "mimeType": "multipart/alternative",
    "headers": [
      { "name": "From", "value": "Acme Billing <billing@acme.example>" },
      { "name": "Subject", "value": "Invoice #4471" },
      { "name": "Date", "value": "Mon, 03 May 2021 00:00:00 +0000" }
    ],
    "parts": [
      { "mimeType": "text/plain", "body": { "size": 512, "data": "SW52b2ljZSBhdHRhY2hlZA==" } },
      {
        "mimeType": "application/pdf",
        "filename": "invoice-4471.pdf",
        "body": { "attachmentId": "ANGjdJ8...", "size": 84213 }
      }
    ]
  }
}
```

### Example 4: Download an attachment

```http
GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1/attachments/ANGjdJ8...
Authorization: Bearer <token>
```

```json
{ "size": 84213, "data": "JVBERi0xLjQKJ...base64url..." }
```

> `data` is **base64url** — pad to %4 and `urlsafe_b64decode` to get the raw PDF bytes.

### Example 5: Send email (scope-gated — usually BLOCKED)

```http
POST /gmail/v1/users/me/messages/send
Authorization: Bearer <token>
Content-Type: application/json

{ "raw": "RnJvbTogbWVAY29tcGFueS5leGFtcGxlDQpUbzogYUBleC5jb20NClN1YmplY3Q6IEhpDQoNCkJvZHk=" }
```

> `raw` = base64url-encoded full RFC 2822 message. **403s under `gmail.readonly`.** Only works if
> the connector scope includes `gmail.send`/`compose`/`modify`. See 01c. 🔬

## Proxy API Operations

| Operation           | Method | Path                                        | Key Parameters                             | Notes                  |
| ------------------- | ------ | ------------------------------------------- | ------------------------------------------ | ---------------------- |
| List labels         | GET    | `/users/me/labels`                          | —                                          | Folder roots           |
| List/search msgs    | GET    | `/users/me/messages`                        | `q`, `labelIds`, `maxResults`, `pageToken` | Returns stubs          |
| Get message         | GET    | `/users/me/messages/{id}`                   | `format`, `metadataHeaders`                | `full` for body        |
| Get attachment      | GET    | `/users/me/messages/{mid}/attachments/{id}` | —                                          | base64url bytes        |
| List/search threads | GET    | `/users/me/threads`                         | `q`, `labelIds`, `maxResults`              | Conversation view      |
| Get thread          | GET    | `/users/me/threads/{id}`                    | `format`                                   | All msgs in convo      |
| Mailbox profile     | GET    | `/users/me/profile`                         | —                                          | email + `historyId`    |
| Change feed         | GET    | `/users/me/history`                         | `startHistoryId`, `historyTypes`           | Incremental (triggers) |
| Send email          | POST   | `/users/me/messages/send`                   | body `{raw}`                               | **Scope-gated** 🔬     |

## Pagination

- **Type:** cursor (opaque page token).
- **Default page size:** 100. **Max page size:** 500 (`maxResults`); connector caps lower.
- **How to paginate:**

```http
GET /gmail/v1/users/me/messages?labelIds=INBOX&maxResults=50&pageToken=08945763213548163492
```

- **Last page detection:** `nextPageToken` absent from the response → stop.
- `resultSizeEstimate` is an **estimate**, not an exact count — never treat it as authoritative.

## Webhooks / Events

**Supported** via Cloud Pub/Sub push (`users.watch`) — heavyweight; no direct HTTP webhook.

| Event           | Trigger (derived)                | Key Payload Fields          |
| --------------- | -------------------------------- | --------------------------- |
| `new_email`     | Message added to a watched label | `emailAddress`, `historyId` |
| `email_read`    | `UNREAD` label removed           | `emailAddress`, `historyId` |
| `label_changed` | Labels added/removed             | `emailAddress`, `historyId` |
| `email_sent`    | Message added to `SENT`          | `emailAddress`, `historyId` |

**Setup:** `POST /users/me/watch {topicName, labelIds, labelFilterBehavior}` → Pub/Sub pings carry
**only** `{emailAddress, historyId}`. Numa must call `history.list?startHistoryId=…` to learn what
actually changed and derive the discrete event. Re-call `watch` at least every 7 days. Pub/Sub is
at-least-once → **dedupe on `historyId`**. See 01d.

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

**Recovery by status:**

| Status | Meaning      | Action                                                                           |
| ------ | ------------ | -------------------------------------------------------------------------------- |
| 400    | Bad request  | Fix `q`/params (e.g. `invalidArgument`)                                          |
| 401    | Unauthorized | Token expired → refresh and retry once                                           |
| 403    | Forbidden    | `insufficientPermissions` = scope (don't retry); `*rateLimitExceeded` = back off |
| 404    | Not found    | Verify message/label id                                                          |
| 429    | Rate limited | `RESOURCE_EXHAUSTED` → exponential backoff + jitter                              |
| 5xx    | Server error | Retry with exponential backoff (max ~32–64s)                                     |

> `Retry-After` is **not reliably present** — use truncated exponential backoff with jitter.
> Token-endpoint `{"error":"invalid_grant"}` = refresh token revoked → full re-consent required.

## Known Limitations

1. **Read-only by default** — send/modify/delete need broader scopes not granted by the registry. 🔬
2. **No sorting** — results are always newest-first by `internalDate`; bound with `after:`/`before:` instead.
3. **N+1 reads + quota-unit cost** — list returns stubs; `messages.get` (5 units) and `send` (100 units) per call.

---

_Generated from investigation questionnaire. See companion files:_

- _01a-domain-model-reference.md — entities (Message/Thread/Label/Attachment), relationships, formats_
- _01b-query-patterns.md — Gmail `q` operators, listing, pagination_
- _01c-mutation-patterns.md — send (scope-gated), why modify/delete are out of scope_
- _01d-event-and-error-handling.md — Pub/Sub push, history change feed, errors, rate limits_

---
api_name: Gmail API
api_slug: gmail
base_url: https://gmail.googleapis.com/gmail/v1
upload_base_url: https://gmail.googleapis.com/upload/gmail/v1
path_version_segment: /gmail/v1 is REAL and already baked into base_url — do NOT add a second version segment; "v1" is not a separate prefix
path_rule: all paths are /users/me/...; userId is ALWAYS "me" (the consented mailbox)
call_surface: FILE-BROWSE connector — use `numa integrations list-files` / `search-files` / `download-file` (labels=folders, emails=files, Files>Remote). The raw HTTP shown here is reference/debug ONLY; the connector layer makes the calls. There is also a scope-gated `send_email` action.
auth: OAuth2 (Google) — Bearer <access_token>; connector auto-refreshes, you don't
field_casing: camelCase
id_format: opaque hex string (message/thread); label id = INBOX or Label_NN
rate_limit: quota-unit model — 6,000 units/user/minute is the real ceiling (back off on 403/429)
registry_scope: https://www.googleapis.com/auth/gmail.readonly (read/list/search/download work; SEND does NOT — 403)
confidence: [DOCUMENTED] or corroborated by in-repo GmailProvider unless tagged [INFERRED] (provider code) or 🔬 (needs live smoke test)
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Gmail — API Rules

## Call surface (read first)

- This is a **Files-Remote connector**: labels=folders, emails=files. Drive it via `numa integrations list-files` / `search-files` / `download-file` — NOT `numa integrations request`.
- Raw HTTP below is reference/debug. Numa's connector handles OAuth + token refresh; you never construct `Authorization` yourself.
- `userId` is always `me`. Path version `/gmail/v1` is already in base_url — never add another `/v1/`.

## Auth

`Authorization: Bearer <access_token>` + `Content-Type: application/json; charset=UTF-8`. Access token ~3600s (1h); auto-refreshed via `grant_type=refresh_token`. Registry scope = `gmail.readonly`.

## CAN

1. Browse labels as folders, list emails inside (Files>Remote).
2. Full-text mailbox search with Gmail operators (`from:`, `is:unread`, `has:attachment`, date ranges).
3. Open an email body (HTML/plain) + metadata; download attachment bytes (base64url).

## CANNOT

1. **Send** — `messages.send` 403s under `gmail.readonly` (needs `gmail.send`). 🔬
2. **Modify/label/archive/trash/delete** — needs `gmail.modify` or full `https://mail.google.com/` (not granted).
3. **Read another mailbox** — only `me`; no domain-wide delegation. No sorting (always newest-first).

## Gotchas

1. **Read-only scope:** `messages.send` (+ any modify/trash/delete) → **403 `insufficientPermissions`** (`status:"PERMISSION_DENIED"`). NOT retryable — it's a scope problem, not transient. If asked to send, say it's not available and STOP; don't retry.
2. **`messages.list` returns only `{id, threadId}` stubs.** Subject/sender need a `messages.get` per stub (`format=metadata`) → N+1. Keep page sizes ≤50.
3. **All body/attachment `data` is base64url** (URL-safe alphabet, not standard base64). Pad to a multiple of 4, then `urlsafe_b64decode`. Plain `b64decode` corrupts.
4. **Large attachments not inline:** `payload…body.data` is empty for big parts → fetch via `…/messages/{mid}/attachments/{attId}`. Small parts arrive inline.
5. **`format=metadata` cannot use `q`** and returns no body. Read with `full`/`metadata`, never `metadata` for search. `gmail.readonly` is the correct floor — don't narrow to `gmail.metadata`.
6. **No sorting** — always newest-first by `internalDate`; bound with `after:`/`before:`/`newer_than:` instead of scanning whole labels (runaway pagination is the real quota risk).

## Defaults (override only if user specifies)

`userId=me` · `maxResults=50` (cap 100, API max 500) · `format=metadata` for listing, `full` to open · cache TTL 60s (`CACHING_PRESETS.email`, mail is high-churn).

## Operations

| Operation           | Method | Path                                        | Key params / notes                                                   |
| ------------------- | ------ | ------------------------------------------- | -------------------------------------------------------------------- |
| List labels         | GET    | `/users/me/labels`                          | folder roots; unpaginated; 1 unit                                    |
| List/search msgs    | GET    | `/users/me/messages`                        | `q`, `labelIds`, `maxResults`, `pageToken`; returns stubs; 5 units   |
| Get message         | GET    | `/users/me/messages/{id}`                   | `format`, `metadataHeaders`; `full` for body; 5 units                |
| Get attachment      | GET    | `/users/me/messages/{mid}/attachments/{id}` | base64url bytes; 5 units                                             |
| List/search threads | GET    | `/users/me/threads`                         | `q`, `labelIds`, `maxResults`                                        |
| Get thread          | GET    | `/users/me/threads/{id}`                    | `format`; all msgs in convo                                          |
| Mailbox profile     | GET    | `/users/me/profile`                         | `{emailAddress, historyId}`                                          |
| Change feed         | GET    | `/users/me/history`                         | `startHistoryId`, `historyTypes`; triggers; 2 units                  |
| Send email          | POST   | `/users/me/messages/send`                   | body `{raw}` (base64url RFC 2822); **scope-gated 403** 🔬; 100 units |

## Pagination

Cursor (opaque page token). Default size 100, max 500 (`maxResults`); connector caps lower. Loop: `?maxResults=50` then `&pageToken=<nextPageToken>`. **Last page = `nextPageToken` absent.** `resultSizeEstimate` is an estimate only — never authoritative, never use for loop termination.

## Webhooks / Events

Via Cloud Pub/Sub push (`users.watch`) — no direct HTTP webhook. `POST /users/me/watch {topicName, labelIds, labelFilterBehavior}`. Pings carry **only** `{emailAddress, historyId}` — call `history.list?startHistoryId=…` to learn what changed and derive the discrete event. Re-call `watch` ≥ every 7 days. Pub/Sub is at-least-once → **dedupe on `historyId`**. Registry event types: `new_email`, `email_read`, `label_changed`, `email_sent`. See 01d.

## Errors (Google envelope)

`{"error":{"code":403,"message":"Request had insufficient authentication scopes.","errors":[{"domain":"global","reason":"insufficientPermissions","message":"Insufficient Permission"}],"status":"PERMISSION_DENIED"}}`

Detect errors by presence of top-level `error`. Branch on `errors[].reason`, NOT bare status:

| Status                                    | Action                                        |
| ----------------------------------------- | --------------------------------------------- |
| 400                                       | fix `q`/params (`invalidArgument`); no retry  |
| 401                                       | `authError` → refresh token, retry once       |
| 403 `insufficientPermissions`             | scope missing → re-consent; **do NOT retry**  |
| 403 `*rateLimitExceeded` / `domainPolicy` | quota → backoff+jitter / admin blocked → stop |
| 404                                       | verify id (history 404 → full re-sync)        |
| 429 `RESOURCE_EXHAUSTED`                  | backoff+jitter                                |
| 5xx                                       | exponential backoff (max ~32–64s)             |

`Retry-After` is **not reliably present** — use truncated exponential backoff + jitter. Token-endpoint `{"error":"invalid_grant"}` = refresh token revoked → full re-consent.

## Examples

1. List labels (Files-Remote root): `GET /gmail/v1/users/me/labels`
   → `{"labels":[{"id":"INBOX","name":"INBOX","type":"system","messagesTotal":1284,"messagesUnread":12},{"id":"SENT","name":"SENT","type":"system"},{"id":"Label_42","name":"Clients/Acme","type":"user","messagesTotal":57}]}`

2. Search (unread invoices, last 30d): `GET /gmail/v1/users/me/messages?q=is:unread%20subject:invoice%20newer_than:30d&maxResults=25`
   → `{"messages":[{"id":"17c4a7e5f8b9c2d1","threadId":"17c4a7e5f8b9c2d0"},{"id":"17c4a7e1aa00bb22","threadId":"17c4a7e1aa00bb22"}],"nextPageToken":"08945763213548163492","resultSizeEstimate":2}`
   → **stubs only**; call `messages.get` per id for Subject/From/Date.

3. Open an email (full body + headers): `GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1?format=full`
   → `{"id":"17c4a7e5f8b9c2d1","threadId":"17c4a7e5f8b9c2d0","labelIds":["INBOX","IMPORTANT"],"snippet":"This is a preview...","internalDate":"1620000000000","payload":{"mimeType":"multipart/alternative","headers":[{"name":"From","value":"Acme Billing <billing@acme.example>"},{"name":"Subject","value":"Invoice #4471"},{"name":"Date","value":"Mon, 03 May 2021 00:00:00 +0000"}],"parts":[{"mimeType":"text/plain","body":{"size":512,"data":"SW52b2ljZSBhdHRhY2hlZA=="}},{"mimeType":"application/pdf","filename":"invoice-4471.pdf","body":{"attachmentId":"ANGjdJ8...","size":84213}}]}}`

4. Download attachment: `GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1/attachments/ANGjdJ8...`
   → `{"size":84213,"data":"JVBERi0xLjQKJ...base64url..."}` — `data` is base64url; pad to %4 + `urlsafe_b64decode`.

5. Send (scope-gated — usually BLOCKED): `POST /gmail/v1/users/me/messages/send` body `{"raw":"RnJvbTogbWVAY29tcGFueS5leGFtcGxlDQpUbzogYUBleC5jb20NClN1YmplY3Q6IEhpDQoNCkJvZHk="}`
   → `raw` = base64url full RFC 2822. **403s under `gmail.readonly`.** Only works with `gmail.send`/`compose`/`modify`. See 01c. 🔬

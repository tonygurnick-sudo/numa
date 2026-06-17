---
api_name: Gmail API
api_slug: gmail
companion_of: 01-llm-api-rules.md
base_url: https://gmail.googleapis.com/gmail/v1 (version /gmail/v1 already in base; do NOT add /v1)
upload_base_url: https://gmail.googleapis.com/upload/gmail/v1
call_surface: file-browse connector; the only write the provider implements is the `send_email` action (raw HTTP below is reference/debug)
confidence: [DOCUMENTED] unless tagged [INFERRED]. 🔬 = needs live smoke test.
source_phases: Phase 3 (Domain Model), Phase 4 (Endpoint Catalog)
---

# Gmail — Mutation Patterns Reference

⚠️ **The connector is read-only under its registry scope (`gmail.readonly`).** The only write the provider implements is `send_email` (`messages.send`), which **403s** until the scope is broadened to `gmail.send` (or `compose`/`modify`/full mail). Everything else (modify/trash/delete) is intentionally out of scope. Do not attempt writes unless the connector reports a write-capable scope.

## Write Capabilities

| Operation            | Supported here?      | Method | Scope needed                        | Notes                             |
| -------------------- | -------------------- | ------ | ----------------------------------- | --------------------------------- |
| Send email           | **Gated** 🔬         | POST   | `gmail.send` / `compose` / `modify` | 403s under `gmail.readonly`       |
| Send with attachment | **Gated** 🔬         | POST   | `gmail.send` (upload endpoint)      | resumable/multipart MIME          |
| Create draft         | No (read-only)       | POST   | `gmail.compose` / `modify`          | not exposed                       |
| Add/remove labels    | No (out of scope) 🚫 | POST   | `gmail.modify`                      | `messages.modify` / `batchModify` |
| Trash / untrash      | No (out of scope) 🚫 | POST   | `gmail.modify`                      | `messages.trash` / `untrash`      |
| Permanent delete     | No (out of scope) 🚫 | DELETE | full `https://mail.google.com/`     | most dangerous — never granted    |

🔬 = needs a scope decision before it can ship · 🚫 = deliberately not granted.

## Send Email (scope-gated)

`messages.send` with a base64url RFC 2822 message:
`POST /gmail/v1/users/me/messages/send` + `Content-Type: application/json`, body `{"raw":"RnJvbTogbWVAY29tcGFueS5leGFtcGxlDQpUbzogYUBleC5jb20NClN1YmplY3Q6IEhpDQoNCkJvZHk="}`
Response (200): `{"id":"msg_id_123","threadId":"thread_456","labelIds":["SENT"]}`

How `raw` is built: construct a full RFC 2822 message (headers + body), then base64url-encode it. The provider uses `email.mime.text.MIMEText` → `base64.urlsafe_b64encode`. Headers (`From`, `To`, `Cc`, `Subject`) go **inside** the MIME message, **not** in the JSON body. [INFERRED — provider]

```python
msg = MIMEText(body); msg["to"] = "a@ex.com"; msg["subject"] = "Hi"
raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()  # POST {"raw": raw}
```

**Reply in-thread:** include `threadId` alongside `raw`, and set `In-Reply-To` / `References` headers in the MIME message so Gmail threads it correctly. [DOCUMENTED]

**Send with attachment (upload endpoint):** for messages over the ~5 MB simple-send limit or with attachments, use the **upload** host:
`POST /upload/gmail/v1/users/me/messages/send?uploadType=multipart` + `Content-Type: message/rfc822`, body = full MIME message with attachment parts. `uploadType=media`/`multipart`/`resumable` supported. Out of scope under `gmail.readonly`. [DOCUMENTED]

## Why modify / trash / delete are NOT available

These exist in the Gmail API but need scopes the connector does **not** request. Listed so you know what's possible if the scope is broadened — **do not call them today**:

| Endpoint                               | Effect                        | Scope                           |
| -------------------------------------- | ----------------------------- | ------------------------------- |
| `POST /users/me/messages/{id}/modify`  | add/remove `labelIds`         | `gmail.modify`                  |
| `POST /users/me/messages/batchModify`  | bulk label change (≤1000 ids) | `gmail.modify`                  |
| `POST /users/me/messages/{id}/trash`   | move to TRASH                 | `gmail.modify`                  |
| `POST /users/me/messages/{id}/untrash` | restore from TRASH            | `gmail.modify`                  |
| `DELETE /users/me/messages/{id}`       | permanent delete              | full `https://mail.google.com/` |
| `POST /users/me/messages/batchDelete`  | bulk permanent delete (≤1000) | full `https://mail.google.com/` |

State transitions (read↔unread, inbox↔archived) are all label operations → all require `gmail.modify`. See the state-machine table in `01a`.

## Idempotency

- **No idempotency-key header.** [DOCUMENTED]
- `messages.send` is **NOT idempotent** — re-POSTing sends a **duplicate** email. On a timeout/ambiguous failure, do **not** blindly retry; verify via the `SENT` label / `rfc822msgid` search before resending.
- All read GETs are naturally idempotent and safe to retry.

## Server-Generated Fields (on send)

`id` (new message id) · `threadId` (existing if replying, new otherwise) · `labelIds` (`SENT`, + `INBOX` for self-sends) · `historyId` (mailbox history advances) · `internalDate` (server send time).

## Gotchas

1. **Read-only by default** — a 403 `insufficientPermissions` means scope missing, not broken token; don't retry as transient. If read-only, tell the user you cannot send and STOP. 🔬
2. **`raw` is base64url of the whole MIME message** — recipient/subject headers live **inside** the MIME, not in the JSON body. A bare `{"to":…,"subject":…}` body is wrong.
3. **Send is not idempotent** — never auto-retry after an ambiguous failure; verify first.
4. **Upload endpoint differs** — attachments/large messages use `/upload/gmail/v1/...`, a different host path and content type from the simple JSON send.

## Dangerous Operations

Confirm with the user before executing — most are blocked by scope anyway.

| Operation                   | Why dangerous                                  | Safeguard                                  |
| --------------------------- | ---------------------------------------------- | ------------------------------------------ |
| `messages.send`             | sends real email; not idempotent               | confirm recipients/body; never auto-retry  |
| `messages.trash`/`delete`   | removes mail (delete permanent)                | blocked by scope; require explicit consent |
| `batchModify`/`batchDelete` | mass label change / permanent loss (≤1000 ids) | blocked by scope; require explicit consent |

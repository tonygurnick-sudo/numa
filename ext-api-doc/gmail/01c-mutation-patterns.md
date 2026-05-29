---
api_name: 'Gmail API'
api_slug: 'gmail'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Gmail API — Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Write operations.
>
> ⚠️ **The Gmail connector is read-only under its registry scope (`gmail.readonly`).** The only
> write the provider implements is `send_email` (`messages.send`), and it **403s** until the scope
> is broadened to include `gmail.send` (or `compose`/`modify`/full mail). Everything else
> (modify/trash/delete) is intentionally out of scope. Do not attempt writes unless the connector
> reports a write-capable scope.

---

## Write Capabilities Summary

| Operation            | Supported here?      | Method | Scope needed                        | Notes                             |
| -------------------- | -------------------- | ------ | ----------------------------------- | --------------------------------- |
| Send email           | **Gated** 🔬         | POST   | `gmail.send` / `compose` / `modify` | 403s under `gmail.readonly`       |
| Send with attachment | **Gated** 🔬         | POST   | `gmail.send` (upload endpoint)      | Resumable/multipart MIME          |
| Create draft         | No (read-only)       | POST   | `gmail.compose` / `modify`          | Not exposed                       |
| Add/remove labels    | No (out of scope) 🚫 | POST   | `gmail.modify`                      | `messages.modify` / `batchModify` |
| Trash / untrash      | No (out of scope) 🚫 | POST   | `gmail.modify`                      | `messages.trash` / `untrash`      |
| Permanent delete     | No (out of scope) 🚫 | DELETE | full `https://mail.google.com/`     | Most dangerous — never granted    |

🔬 = needs a scope decision before it can ship · 🚫 = deliberately not granted.

---

## Send Email (scope-gated)

### Pattern: `messages.send` with a base64url RFC 2822 message

```http
POST /gmail/v1/users/me/messages/send
Authorization: Bearer <token>
Content-Type: application/json

{ "raw": "RnJvbTogbWVAY29tcGFueS5leGFtcGxlDQpUbzogYUBleC5jb20NClN1YmplY3Q6IEhpDQoNCkJvZHk=" }
```

**Response (200):**

```json
{ "id": "msg_id_123", "threadId": "thread_456", "labelIds": ["SENT"] }
```

**How `raw` is built:** construct a full RFC 2822 message (headers + body), then base64url-encode
it. The provider does this with `email.mime.text.MIMEText` → `base64.urlsafe_b64encode`. Headers
go inside the MIME message (`From`, `To`, `Cc`, `Subject`), **not** in the JSON body. [INFERRED — provider]

```python
# Shape of what the provider builds (reference)
msg = MIMEText(body)
msg["to"] = "a@ex.com"
msg["subject"] = "Hi"
raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
# POST {"raw": raw}
```

**Reply in-thread:** include the `threadId` alongside `raw` in the body, and set `In-Reply-To` /
`References` headers in the MIME message so Gmail threads it correctly. [DOCUMENTED]

### Send with attachment (upload endpoint)

For messages over the simple-send size limit (~5 MB) or with attachments, use the **upload** host:

```http
POST /upload/gmail/v1/users/me/messages/send?uploadType=multipart
Authorization: Bearer <token>
Content-Type: message/rfc822

<full MIME message with attachment parts>
```

> `uploadType=media`/`multipart`/`resumable` supported. Out of scope under `gmail.readonly`. [DOCUMENTED]

---

## Why modify / trash / delete are NOT available

These exist in the Gmail API but require scopes the connector does **not** request. They are listed
so you know what's possible if the scope is ever broadened — **do not call them today**:

| Endpoint                               | Effect                        | Scope                           |
| -------------------------------------- | ----------------------------- | ------------------------------- |
| `POST /users/me/messages/{id}/modify`  | Add/remove `labelIds`         | `gmail.modify`                  |
| `POST /users/me/messages/batchModify`  | Bulk label change (≤1000 ids) | `gmail.modify`                  |
| `POST /users/me/messages/{id}/trash`   | Move to TRASH                 | `gmail.modify`                  |
| `POST /users/me/messages/{id}/untrash` | Restore from TRASH            | `gmail.modify`                  |
| `DELETE /users/me/messages/{id}`       | Permanent delete              | full `https://mail.google.com/` |
| `POST /users/me/messages/batchDelete`  | Bulk permanent delete (≤1000) | full `https://mail.google.com/` |

State transitions (read ↔ unread, inbox ↔ archived) are all label operations → all require
`gmail.modify`. See the state-machine table in `01a`.

---

## Idempotency

- **No idempotency-key header.** [DOCUMENTED]
- `messages.send` is **NOT idempotent** — re-POSTing sends a **duplicate** email. On a timeout or
  ambiguous failure, do **not** blindly retry; verify via the `SENT` label / `rfc822msgid` search
  before resending.
- All read GETs are naturally idempotent and safe to retry.

---

## Server-Generated Fields

| Field          | Set when | Notes                               |
| -------------- | -------- | ----------------------------------- |
| `id`           | send     | New message id assigned by Gmail    |
| `threadId`     | send     | Existing if replying; new otherwise |
| `labelIds`     | send     | `SENT` (and `INBOX` for self-sends) |
| `historyId`    | send     | Mailbox history advances            |
| `internalDate` | send     | Server receive/send time            |

---

## Worked Examples

### Example 1: Send a plain text email (requires `gmail.send`)

```http
POST /gmail/v1/users/me/messages/send
Content-Type: application/json

{ "raw": "<base64url of: To: a@ex.com\\r\\nSubject: Hi\\r\\n\\r\\nHello there>" }
```

**Response (200):** `{ "id": "msg_id_123", "threadId": "thread_456", "labelIds": ["SENT"] }`
**Note:** 403s under `gmail.readonly`. If the connector reports read-only, **tell the user you
cannot send and stop** — do not retry. 🔬

### Example 2: Reply within a thread

```http
POST /gmail/v1/users/me/messages/send
Content-Type: application/json

{
  "threadId": "thread_456",
  "raw": "<base64url MIME with In-Reply-To and References headers set>"
}
```

**Note:** `threadId` + matching `In-Reply-To`/`References` headers keep the reply threaded.

---

## Gotchas & Counter-Exceptions

1. **Read-only by default** — assume you cannot send/modify/delete. A 403 with
   `insufficientPermissions` means the scope is missing, not that the token is broken. Don't retry
   it as if it were transient.
2. **`raw` is base64url of the whole MIME message** — recipient/subject headers live **inside** the
   MIME, not in the JSON body. A bare `{"to": …, "subject": …}` body is wrong.
3. **Send is not idempotent** — never auto-retry a send after an ambiguous failure; verify first.
4. **Upload endpoint differs** — attachments/large messages use `/upload/gmail/v1/...`, a different
   host path and content type from the simple JSON send.

---

## Dangerous Operations

> Confirm with the user before executing — and most are blocked by scope anyway.

| Operation                   | Why Dangerous                                  | Safeguard                                  |
| --------------------------- | ---------------------------------------------- | ------------------------------------------ |
| `messages.send`             | Sends real email; not idempotent               | Confirm recipients/body; never auto-retry  |
| `messages.trash`/`delete`   | Removes mail (delete is permanent)             | Blocked by scope; require explicit consent |
| `batchModify`/`batchDelete` | Mass label change / permanent loss (≤1000 ids) | Blocked by scope; require explicit consent |

---

_Generated from the investigation questionnaire, Phases 3–4._

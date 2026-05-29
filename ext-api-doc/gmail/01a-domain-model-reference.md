---
api_name: 'Gmail API'
api_slug: 'gmail'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# Gmail API — Domain Model Reference

> Companion to `01-llm-api-rules.md`. Entity catalog, relationships, formats and business rules.
>
> **Mental model for the connector:** **labels are folders, emails (messages) are files.** The
> mailbox renders in **Files > Remote** through the generic provider interface (`list_files` /
> `search_files` / `download_file` / `get_file_metadata`) — same lane as Google Drive / OneDrive.
>
> ⚠️ Confidence: `[DOCUMENTED]` = in official Google docs · `[INFERRED]` = from the in-repo
> `GmailProvider` working code or conventions. No live call was made during research, but the
> read endpoint shapes are corroborated by the existing provider. Items needing a live smoke
> test are tagged 🔬.

---

## Entity Catalog

### Message [DOCUMENTED]

**Resource path:** `/users/me/messages/{id}`
**Description:** A single email. Immutable `id`; linked to a conversation by `threadId`; carries
labels via `labelIds`. This is the "file" in the Files-Remote model.
**CRUD (under `gmail.readonly`):** GET (list/get) only. Creating happens via `messages.send`
(write scope) — no in-place update; label changes need `messages.modify` (out of scope).

| Field          | Type              | Writable   | Description                                            | Example                 |
| -------------- | ----------------- | ---------- | ------------------------------------------------------ | ----------------------- |
| `id`           | string (hex)      | no         | Immutable message id                                   | `"17c4a7e5f8b9c2d1"`    |
| `threadId`     | string (hex)      | no         | Id of the containing thread                            | `"17c4a7e5f8b9c2d0"`    |
| `labelIds`     | string[]          | via modify | Applied labels (`INBOX`, `UNREAD`, `Label_42`, …)      | `["INBOX","IMPORTANT"]` |
| `snippet`      | string            | no         | Short plain-text preview                               | `"This is a preview…"`  |
| `historyId`    | string (uint)     | no         | History marker at last change                          | `"9876543210"`          |
| `internalDate` | string (epoch ms) | no         | Internal receive timestamp — the **reliable** time     | `"1620000000000"`       |
| `sizeEstimate` | integer (bytes)   | no         | Approx message size                                    | `2048`                  |
| `payload`      | MessagePart       | no         | MIME tree (`mimeType`, `headers[]`, `body`, `parts[]`) | (nested)                |
| `raw`          | string (b64url)   | no         | Whole RFC 2822 message (only when `format=raw`)        | `"RnJvbTog…"`           |

**Relationships:**

| Related Entity | Type | Expression                  | Notes                                    |
| -------------- | ---- | --------------------------- | ---------------------------------------- |
| Thread         | N:1  | `threadId`                  | Each message belongs to one thread       |
| Label          | N:M  | `labelIds[]`                | System + user labels                     |
| Attachment     | 1:N  | `payload…body.attachmentId` | Fetched separately via `attachments.get` |

---

### MessagePart / MessagePartBody [DOCUMENTED]

The recursive MIME tree under `message.payload`. Read bodies and discover attachments here.

| Field       | Type             | Description                                                    |
| ----------- | ---------------- | -------------------------------------------------------------- |
| `mimeType`  | string           | `text/plain`, `text/html`, `multipart/*`, `application/pdf`, … |
| `filename`  | string           | Set on attachment parts; empty for inline body parts           |
| `headers[]` | `{name,value}[]` | Per-part headers; top-level holds `From`/`To`/`Subject`/`Date` |
| `body`      | MessagePartBody  | `{attachmentId?, size, data?}`                                 |
| `parts[]`   | MessagePart[]    | Child parts — **recurse** for multipart messages               |

**MessagePartBody:** `{ "attachmentId": "...", "size": 84213, "data": "<base64url>" }`. For small
inline parts, `data` is populated. For larger attachments, `data` is empty and `attachmentId` is
present → call `attachments.get`. Body extraction = walk `parts[]`, prefer `text/html` then
`text/plain`, base64url-decode `body.data`. [INFERRED — provider]

---

### Thread [DOCUMENTED]

**Resource path:** `/users/me/threads/{id}`
**Description:** A conversation grouping all messages sharing a `threadId`.
**CRUD:** GET (list/get).

| Field       | Type      | Description                               |
| ----------- | --------- | ----------------------------------------- |
| `id`        | string    | Thread id (equals the first message's id) |
| `snippet`   | string    | Preview of the latest message             |
| `historyId` | string    | History marker                            |
| `messages`  | Message[] | Full messages (on `threads.get`)          |

---

### Label [DOCUMENTED]

**Resource path:** `/users/me/labels/{id}`
**Description:** Folder/tag. System labels (`INBOX`, `SENT`, …) plus user labels. Rendered as the
Files-Remote **root folders**.
**CRUD (under `gmail.readonly`):** GET (list/get). Create/update/delete need `gmail.modify`.

| Field                   | Type    | Description                                        |
| ----------------------- | ------- | -------------------------------------------------- |
| `id`                    | string  | Immutable id (`INBOX`, `Label_42`)                 |
| `name`                  | string  | Display name; `/` denotes nesting (`Clients/Acme`) |
| `type`                  | enum    | `system` \| `user`                                 |
| `messageListVisibility` | enum    | `show` \| `hide`                                   |
| `labelListVisibility`   | enum    | `labelShow` \| `labelShowIfUnread` \| `labelHide`  |
| `messagesTotal`         | integer | Count of messages with the label                   |
| `messagesUnread`        | integer | Unread count                                       |
| `threadsTotal`          | integer | Thread count                                       |
| `color`                 | object  | `{textColor, backgroundColor}` (user labels only)  |

> The provider surfaces a curated root subset: `INBOX, SENT, DRAFT, STARRED, IMPORTANT, SPAM,
TRASH` + all user labels. [INFERRED — provider]

---

### Attachment [DOCUMENTED]

**Resource path:** `/users/me/messages/{messageId}/attachments/{id}`
**Description:** Binary part body. Returns `{size, data}` where `data` is base64url.
**CRUD:** GET only.

| Field  | Type            | Description                          |
| ------ | --------------- | ------------------------------------ |
| `size` | integer (bytes) | Decoded byte length                  |
| `data` | string (b64url) | URL-safe base64; pad to %4 to decode |

---

### Draft / History / Profile (summary) [DOCUMENTED]

| Entity  | Resource            | Purpose                                                           |
| ------- | ------------------- | ----------------------------------------------------------------- |
| Draft   | `/users/me/drafts`  | Unsent messages. Read under readonly; create/send needs `compose` |
| History | `/users/me/history` | Incremental change feed keyed by `historyId` (powers triggers)    |
| Profile | `/users/me/profile` | `{emailAddress, messagesTotal, threadsTotal, historyId}`          |

---

## Entity Relationship Diagram

```
┌──────────┐   N:M (labelIds[])    ┌──────────┐
│ Message  │──────────────────────>│  Label   │  (system: INBOX/SENT/DRAFT/UNREAD… + user labels)
└──────────┘                       └──────────┘
     │ N:1 (threadId)
     ▼
┌──────────┐
│  Thread  │  (groups messages of one conversation)
└──────────┘

┌──────────┐  body.attachmentId    ┌────────────┐
│ Message  │──────────────────────>│ Attachment │  (fetched via …/attachments/{id})
│ .payload │  (recursive parts[])  └────────────┘
└──────────┘
```

- A Message belongs to exactly one Thread and carries N Labels. Connector models labels→folders,
  messages→files, attachments→child files. [INFERRED — provider]

---

## State Machines

Gmail exposes no rich lifecycle via the read API. The only meaningful "state" is **label
membership** — and every transition requires `messages.modify` (out of scope under `gmail.readonly`).

| From State         | Action (`messages.modify`)  | To State   | Needs scope       |
| ------------------ | --------------------------- | ---------- | ----------------- |
| has `UNREAD` label | `removeLabelIds=["UNREAD"]` | read       | `gmail.modify` 🚫 |
| has `INBOX` label  | `removeLabelIds=["INBOX"]`  | archived   | `gmail.modify` 🚫 |
| —                  | `messages.trash`            | in `TRASH` | `gmail.modify` 🚫 |
| in `TRASH`         | `messages.delete`           | gone       | full mail 🚫      |

🚫 = not available under the connector's `gmail.readonly` scope. Read-only consumers observe state
via `labelIds` but cannot change it.

---

## Business Rules

- **`userId` is always `me`.** No reading other mailboxes without domain-wide delegation (Workspace
  admin only). [DOCUMENTED]
- **`internalDate` is the reliable timestamp.** Prefer it over the RFC `Date` header, which can be
  malformed; the provider falls back to it on parse failure. [INFERRED — provider]
- **Label `name` uses `/` for nesting** (`Clients/Acme`); `id`s are opaque (`Label_42`). [DOCUMENTED]
- **`format=metadata` cannot use `q`** and returns no body — incompatible with search/download.
  `gmail.readonly` is the correct scope floor; do not narrow to `gmail.metadata`. [DOCUMENTED]
- **Attachment bytes are not inline for large parts** — `body.data` is empty; use `attachmentId`. [DOCUMENTED]
- **Sending requires a write scope** — `messages.send` 403s under readonly. [DOCUMENTED]

---

## Field Format Reference

| Format       | Pattern                     | Example                           | Notes                                    |
| ------------ | --------------------------- | --------------------------------- | ---------------------------------------- |
| Message id   | opaque hex string           | `17c4a7e5f8b9c2d1`                | Stable, immutable                        |
| Label id     | `INBOX` / `Label_NN`        | `Label_42`                        | System ids are UPPERCASE words           |
| internalDate | epoch milliseconds (string) | `"1620000000000"`                 | Divide by 1000 for seconds               |
| RFC Date hdr | RFC 2822                    | `Mon, 03 May 2021 00:00:00 +0000` | Parse `%a, %d %b %Y %H:%M:%S %z`         |
| Body/attach  | **base64url** (RFC 4648 §5) | `VGhpcyBpcyB0aGU…`                | URL-safe alphabet; pad to %4 then decode |
| Raw message  | base64url of full RFC 2822  | `RnJvbTog…`                       | `format=raw` only                        |
| historyId    | unsigned integer (string)   | `"9876543210"`                    | Monotonic per mailbox                    |

---

## Enum Value Reference

| Field                   | Allowed Values                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label `type`            | `system`, `user`                                                                                                                                                                          |
| System label ids        | `INBOX`, `SENT`, `DRAFT`, `SPAM`, `TRASH`, `UNREAD`, `STARRED`, `IMPORTANT`, `CHAT`, `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS` |
| `format` (messages.get) | `minimal`, `full`, `raw`, `metadata`                                                                                                                                                      |
| `messageListVisibility` | `show`, `hide`                                                                                                                                                                            |
| `labelListVisibility`   | `labelShow`, `labelShowIfUnread`, `labelHide`                                                                                                                                             |
| `historyTypes`          | `messageAdded`, `messageDeleted`, `labelAdded`, `labelRemoved`                                                                                                                            |

---

_Generated from the investigation questionnaire, Phase 3._

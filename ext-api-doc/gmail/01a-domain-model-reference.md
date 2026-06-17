---
api_name: Gmail API
api_slug: gmail
companion_of: 01-llm-api-rules.md
base_url: https://gmail.googleapis.com/gmail/v1 (version /gmail/v1 already in base; do NOT add /v1)
call_surface: file-browse connector (list-files/search-files/download-file); labels=folders, emails=files, Files>Remote
confidence: [DOCUMENTED] = official Google docs · [INFERRED] = from in-repo GmailProvider code · 🔬 = needs live smoke test. No live call made at research; read endpoint shapes corroborated by the provider.
source_phase: Phase 3 (Domain Model & Behavior)
---

# Gmail — Domain Model Reference

Entity catalog, relationships, formats, business rules. Mental model: **labels=folders, messages=files, attachments=child files**, rendered in Files>Remote via the generic provider interface (`list_files`/`search_files`/`download_file`/`get_file_metadata`) — same lane as Google Drive / OneDrive.

## Entity: Message

Path `/users/me/messages/{id}`. A single email — the "file". Immutable `id`; linked to a conversation by `threadId`; labels via `labelIds`. CRUD under `gmail.readonly`: GET only. Creating = `messages.send` (write scope); label changes = `messages.modify` (out of scope).

| Field          | Type              | Writable   | Description                                            | Example                 |
| -------------- | ----------------- | ---------- | ------------------------------------------------------ | ----------------------- |
| `id`           | string (hex)      | no         | Immutable message id                                   | `"17c4a7e5f8b9c2d1"`    |
| `threadId`     | string (hex)      | no         | Containing thread id                                   | `"17c4a7e5f8b9c2d0"`    |
| `labelIds`     | string[]          | via modify | Applied labels                                         | `["INBOX","IMPORTANT"]` |
| `snippet`      | string            | no         | Short plain-text preview                               | `"This is a preview…"`  |
| `historyId`    | string (uint)     | no         | History marker at last change                          | `"9876543210"`          |
| `internalDate` | string (epoch ms) | no         | Internal receive time — the **reliable** timestamp     | `"1620000000000"`       |
| `sizeEstimate` | integer (bytes)   | no         | Approx message size                                    | `2048`                  |
| `payload`      | MessagePart       | no         | MIME tree (`mimeType`, `headers[]`, `body`, `parts[]`) | (nested)                |
| `raw`          | string (b64url)   | no         | Whole RFC 2822 message (only `format=raw`)             | `"RnJvbTog…"`           |

Relationships: Thread N:1 via `threadId` · Label N:M via `labelIds[]` (system + user) · Attachment 1:N via `payload…body.attachmentId` (fetched separately via `attachments.get`).

## Entity: MessagePart / MessagePartBody

Recursive MIME tree under `message.payload`. Read bodies and discover attachments here.

| Field       | Type             | Description                                                    |
| ----------- | ---------------- | -------------------------------------------------------------- |
| `mimeType`  | string           | `text/plain`, `text/html`, `multipart/*`, `application/pdf`, … |
| `filename`  | string           | Set on attachment parts; empty for inline body parts           |
| `headers[]` | `{name,value}[]` | Per-part headers; top-level holds `From`/`To`/`Subject`/`Date` |
| `body`      | MessagePartBody  | `{attachmentId?, size, data?}`                                 |
| `parts[]`   | MessagePart[]    | Child parts — **recurse** for multipart                        |

MessagePartBody = `{"attachmentId":"...","size":84213,"data":"<base64url>"}`. Small inline parts: `data` populated. Larger attachments: `data` empty, `attachmentId` present → call `attachments.get`. Body extraction = walk `parts[]`, prefer `text/html` then `text/plain`, base64url-decode `body.data`. [INFERRED — provider]

## Entity: Thread

Path `/users/me/threads/{id}`. Conversation grouping all messages sharing a `threadId`. CRUD: GET only.

| Field       | Type      | Description                           |
| ----------- | --------- | ------------------------------------- |
| `id`        | string    | Thread id (equals first message's id) |
| `snippet`   | string    | Preview of latest message             |
| `historyId` | string    | History marker                        |
| `messages`  | Message[] | Full messages (on `threads.get`)      |

## Entity: Label

Path `/users/me/labels/{id}`. Folder/tag — system labels + user labels; rendered as Files-Remote **root folders**. CRUD under `gmail.readonly`: GET only. Create/update/delete need `gmail.modify`.

| Field                   | Type    | Description                                        |
| ----------------------- | ------- | -------------------------------------------------- |
| `id`                    | string  | Immutable id (`INBOX`, `Label_42`)                 |
| `name`                  | string  | Display name; `/` denotes nesting (`Clients/Acme`) |
| `type`                  | enum    | `system` \| `user`                                 |
| `messageListVisibility` | enum    | `show` \| `hide`                                   |
| `labelListVisibility`   | enum    | `labelShow` \| `labelShowIfUnread` \| `labelHide`  |
| `messagesTotal`         | integer | Messages with the label                            |
| `messagesUnread`        | integer | Unread count                                       |
| `threadsTotal`          | integer | Thread count                                       |
| `color`                 | object  | `{textColor, backgroundColor}` (user labels only)  |

Provider surfaces a curated root subset: `INBOX, SENT, DRAFT, STARRED, IMPORTANT, SPAM, TRASH` + all user labels. [INFERRED — provider]

## Entity: Attachment

Path `/users/me/messages/{messageId}/attachments/{id}`. Binary part body, `{size, data}` where `data` is base64url. CRUD: GET only.

| Field  | Type            | Description                          |
| ------ | --------------- | ------------------------------------ |
| `size` | integer (bytes) | Decoded byte length                  |
| `data` | string (b64url) | URL-safe base64; pad to %4 to decode |

## Entities: Draft / History / Profile [DOCUMENTED]

| Entity  | Resource            | Purpose                                                           |
| ------- | ------------------- | ----------------------------------------------------------------- |
| Draft   | `/users/me/drafts`  | Unsent messages. Read under readonly; create/send needs `compose` |
| History | `/users/me/history` | Incremental change feed keyed by `historyId` (powers triggers)    |
| Profile | `/users/me/profile` | `{emailAddress, messagesTotal, threadsTotal, historyId}`          |

## State Machines

No rich lifecycle via the read API. The only meaningful state is **label membership**, and every transition needs `messages.modify` (🚫 out of scope under `gmail.readonly`). Read-only consumers observe state via `labelIds` but cannot change it.

| From         | Action (`messages.modify`)  | To         | Needs scope       |
| ------------ | --------------------------- | ---------- | ----------------- |
| has `UNREAD` | `removeLabelIds=["UNREAD"]` | read       | `gmail.modify` 🚫 |
| has `INBOX`  | `removeLabelIds=["INBOX"]`  | archived   | `gmail.modify` 🚫 |
| —            | `messages.trash`            | in `TRASH` | `gmail.modify` 🚫 |
| in `TRASH`   | `messages.delete`           | gone       | full mail 🚫      |

## Business Rules

- **`userId` is always `me`** — no other mailboxes without domain-wide delegation (Workspace admin only). [DOCUMENTED]
- **`internalDate` is the reliable timestamp** — prefer over the RFC `Date` header (can be malformed; provider falls back to `internalDate` on parse failure). [INFERRED — provider]
- **Label `name` uses `/` for nesting** (`Clients/Acme`); `id`s are opaque (`Label_42`). [DOCUMENTED]
- **`format=metadata` cannot use `q`** and returns no body. `gmail.readonly` is the floor; don't narrow to `gmail.metadata`. [DOCUMENTED]
- **Large attachments not inline** — `body.data` empty; use `attachmentId`. [DOCUMENTED]
- **Sending needs a write scope** — `messages.send` 403s under readonly. [DOCUMENTED]

## Field Formats

| Format       | Pattern                     | Example                           | Notes                            |
| ------------ | --------------------------- | --------------------------------- | -------------------------------- |
| Message id   | opaque hex                  | `17c4a7e5f8b9c2d1`                | stable, immutable                |
| Label id     | `INBOX` / `Label_NN`        | `Label_42`                        | system ids = UPPERCASE words     |
| internalDate | epoch ms (string)           | `"1620000000000"`                 | ÷1000 for seconds                |
| RFC Date hdr | RFC 2822                    | `Mon, 03 May 2021 00:00:00 +0000` | parse `%a, %d %b %Y %H:%M:%S %z` |
| Body/attach  | **base64url** (RFC 4648 §5) | `VGhpcyBpcyB0aGU…`                | URL-safe; pad to %4 then decode  |
| Raw message  | base64url of full RFC 2822  | `RnJvbTog…`                       | `format=raw` only                |
| historyId    | unsigned int (string)       | `"9876543210"`                    | monotonic per mailbox            |

## Enums

| Field                   | Allowed values                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label `type`            | `system`, `user`                                                                                                                                                                          |
| System label ids        | `INBOX`, `SENT`, `DRAFT`, `SPAM`, `TRASH`, `UNREAD`, `STARRED`, `IMPORTANT`, `CHAT`, `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS` |
| `format` (messages.get) | `minimal`, `full`, `raw`, `metadata`                                                                                                                                                      |
| `messageListVisibility` | `show`, `hide`                                                                                                                                                                            |
| `labelListVisibility`   | `labelShow`, `labelShowIfUnread`, `labelHide`                                                                                                                                             |
| `historyTypes`          | `messageAdded`, `messageDeleted`, `labelAdded`, `labelRemoved`                                                                                                                            |

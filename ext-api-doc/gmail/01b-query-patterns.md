---
api_name: 'Gmail API'
api_slug: 'gmail'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Gmail API — Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Read operations: listing labels/messages, full-text search
> with Gmail operators, opening messages, downloading attachments, and cursor pagination.
>
> All reads work under `gmail.readonly`. Confidence: `[DOCUMENTED]` unless noted. The Gmail `q`
> syntax is the **same operators as the Gmail search box** — well documented and stable.

---

## Query Capabilities Summary

| Capability                 | Supported | Syntax                                 | Notes                                        |
| -------------------------- | --------- | -------------------------------------- | -------------------------------------------- |
| List a label's messages    | Yes       | `messages?labelIds=<id>`               | Returns `{id, threadId}` stubs               |
| Get a message by id        | Yes       | `messages/{id}?format=full`            | `metadata`/`minimal`/`raw` also              |
| Full-text search           | Yes       | `messages?q=invoice`                   | Searches subject + body + attachment text    |
| Filter by sender/recipient | Yes       | `q=from:x@y.com`, `q=to:me`            | Gmail operators                              |
| Filter by date range       | Yes       | `q=after:2026/01/01 before:2026/02/01` | `newer_than:`/`older_than:` also             |
| Filter by state            | Yes       | `q=is:unread`, `q=is:starred`          | Presence-style                               |
| Filter by attachment       | Yes       | `q=has:attachment filename:pdf`        |                                              |
| Logical operators          | Yes       | space=AND, `OR`/`{}`=OR, `-`=NOT       | `from:a OR from:b`; `-in:spam`               |
| Size comparison            | Yes       | `q=larger:5M`, `q=smaller:500K`        |                                              |
| **Sort**                   | **No**    | —                                      | Always newest-first by `internalDate`; fixed |
| Field selection (sparse)   | Partial   | `format=metadata&metadataHeaders=…`    | On `get` only, not `list`                    |
| Include related records    | No        | —                                      | Fetch thread / attachments separately        |
| Regex / pattern matching   | No        | —                                      | Token matching only                          |
| Exact count                | No        | `resultSizeEstimate` (estimate only)   | Not authoritative                            |

---

## Common Patterns

### Pattern 1: List labels (the Files-Remote root)

```http
GET /gmail/v1/users/me/labels
Authorization: Bearer <token>
```

```json
{
  "labels": [
    { "id": "INBOX", "name": "INBOX", "type": "system", "messagesTotal": 1284, "messagesUnread": 12 },
    { "id": "Label_42", "name": "Clients/Acme", "type": "user", "messagesTotal": 57 }
  ]
}
```

> No pagination — labels come back in one call. These become the root folders.

### Pattern 2: List a label's messages (folder contents)

```http
GET /gmail/v1/users/me/messages?labelIds=Label_42&maxResults=50
Authorization: Bearer <token>
```

```json
{
  "messages": [
    { "id": "17c4a7e5f8b9c2d1", "threadId": "17c4a7e5f8b9c2d0" },
    { "id": "17c4a7e1aa00bb22", "threadId": "17c4a7e1aa00bb22" }
  ],
  "nextPageToken": "08945763213548163492",
  "resultSizeEstimate": 57
}
```

> **Stubs only** — `{id, threadId}`. To show subject/sender, call `messages.get` per stub
> (`format=metadata`, `metadataHeaders=Subject,From,Date`). This is the N+1 cost — keep pages ≤50.

### Pattern 3: Full-text search with operators

```http
GET /gmail/v1/users/me/messages?q=from:billing@acme.example%20has:attachment%20newer_than:30d&maxResults=25
Authorization: Bearer <token>
```

The `q` parameter uses Gmail search syntax. Key operators:

```
from:billing@acme.example          # sender
to:me                              # recipient
subject:invoice                    # subject contains
is:unread  is:read  is:starred  is:important
has:attachment  filename:pdf
label:Clients/Acme  in:inbox  in:sent  -in:spam
after:2026/01/01  before:2026/03/01  newer_than:7d  older_than:1y
larger:5M  smaller:500K
rfc822msgid:<abc@mail.example>     # exact Message-ID header lookup
```

- **Combining:** whitespace = AND · `OR` (uppercase) or `{a b}` = OR · `-term` = NOT · `()` groups.
- **Scope `q` to a label** with `&labelIds=<id>` alongside `q`.

### Pattern 4: Open a message (read the body)

```http
GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1?format=full
Authorization: Bearer <token>
```

```json
{
  "id": "17c4a7e5f8b9c2d1",
  "labelIds": ["INBOX", "IMPORTANT"],
  "internalDate": "1620000000000",
  "payload": {
    "mimeType": "multipart/alternative",
    "headers": [
      { "name": "From", "value": "Acme Billing <billing@acme.example>" },
      { "name": "Subject", "value": "Invoice #4471" }
    ],
    "parts": [
      { "mimeType": "text/plain", "body": { "size": 512, "data": "SW52b2ljZSBhdHRhY2hlZA==" } },
      { "mimeType": "text/html", "body": { "size": 1024, "data": "PGh0bWw+Li4uPC9odG1sPg==" } }
    ]
  }
}
```

- **Body extraction:** walk `payload.parts[]` recursively, prefer `text/html` then `text/plain`,
  base64url-decode `body.data`. Headers (`From`/`Subject`/`Date`) live in `payload.headers`. [INFERRED]

### Pattern 5: Cheap metadata-only read (subject/sender/date)

```http
GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date
```

> Use this when hydrating a list view — returns headers without the (potentially large) body.

### Pattern 6: Download an attachment

```http
GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1/attachments/ANGjdJ8...
Authorization: Bearer <token>
```

```json
{ "size": 84213, "data": "JVBERi0xLjQKJ...base64url..." }
```

> `data` is **base64url** — pad to a multiple of 4, then `urlsafe_b64decode` for the raw bytes.

---

## Pagination Handling

### Model

- **Type:** cursor (opaque page token). [DOCUMENTED]
- **Default page size:** 100 (`maxResults`). **Max:** 500 (API); connector caps lower for cost.
- **Total count:** `resultSizeEstimate` — **estimate only**, never exact.
- **Applies to:** `messages.list`, `threads.list`, `drafts.list`, `history.list`. Labels are unpaginated.

### Request / Response Parameters

| Parameter       | Where    | Description                                 |
| --------------- | -------- | ------------------------------------------- |
| `maxResults`    | request  | Page size (default 100, max 500)            |
| `pageToken`     | request  | Opaque token from the prior `nextPageToken` |
| `nextPageToken` | response | Cursor for the next page; **absent = done** |

### Worked Example

```
Page 1: GET /users/me/messages?labelIds=INBOX&maxResults=50
        → { messages:[…50…], nextPageToken:"08945763213548163492" }
Page 2: GET /users/me/messages?labelIds=INBOX&maxResults=50&pageToken=08945763213548163492
        → { messages:[…50…], nextPageToken:"11920043928374650091" }
Last:   GET …&pageToken=11920043928374650091
        → { messages:[…7…] }      # no nextPageToken → stop
```

### Full Pagination Loop

```
token = null
loop:
  GET /users/me/messages?labelIds=INBOX&maxResults=50[&pageToken={token}]
  process response.messages
  token = response.nextPageToken
  if token is absent: stop
```

---

## Bulk Reads

| Operation        | Mechanism                          | Limit       | Notes                                       |
| ---------------- | ---------------------------------- | ----------- | ------------------------------------------- |
| Batch HTTP reads | `POST /batch/gmail/v1` (multipart) | 100 sub-req | Per-sub-request status; partial failures OK |
| Hydrate a page   | serial `messages.get` per stub     | —           | What the provider does today; N+1 cost      |

> The provider does **not** use the batch endpoint today — serial `messages.get`. Batch is a
> future optimisation to cut round-trips. [INFERRED — provider]

---

## Quota Cost Awareness (read)

Gmail bills **quota units**, not requests — 6,000 units/user/minute is the practical ceiling.

| Method            | Units | Implication                                          |
| ----------------- | ----- | ---------------------------------------------------- |
| `labels.list`     | 1     | Cheap — list freely                                  |
| `messages.list`   | 5     | One per page                                         |
| `messages.get`    | 5     | **Per message** — a 50-row hydrated page ≈ 255 units |
| `attachments.get` | 5     | Per attachment                                       |
| `history.list`    | 2     | Polling                                              |

> A 50-message folder listing (1×list + 50×get-metadata ≈ 255 units) is cheap; **runaway
> pagination over thousands of messages is the real quota risk.** Bound searches with `newer_than:`
> / `after:` rather than scanning whole labels.

---

## Gotchas & Counter-Exceptions

1. **List returns stubs, not full messages** — `messages.list` gives only `{id, threadId}`. Don't
   expect subjects from it; hydrate with `messages.get`.
2. **No sorting** — results are always newest-first. For oldest-first, bound with `after:`/`before:`
   and reverse client-side; there is no `orderBy`.
3. **`resultSizeEstimate` is an estimate** — don't render it as an exact count or use it to decide
   loop termination. Use `nextPageToken` presence instead.
4. **`format=metadata` + `q` is invalid** — metadata reads can't combine with search and return no
   body. Use `full`/`metadata` for reading, default `format` (or `minimal`) is fine for listing.
5. **base64url, not base64** — every `body.data` / attachment `data` is URL-safe base64; pad to %4.

---

_Generated from the investigation questionnaire, Phases 5–6._

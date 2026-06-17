---
api_name: Gmail API
api_slug: gmail
companion_of: 01-llm-api-rules.md
base_url: https://gmail.googleapis.com/gmail/v1 (version /gmail/v1 already in base; do NOT add /v1)
call_surface: file-browse connector (list-files/search-files/download-file); raw HTTP below is reference/debug only
confidence: [DOCUMENTED] unless tagged [INFERRED]. Gmail `q` = same operators as the Gmail search box.
source_phases: Phase 5 (Query & Filter), Phase 6 (Pagination & Bulk)
---

# Gmail — Query Patterns Reference

Read ops: listing labels/messages, full-text search with Gmail operators, opening messages, downloading attachments, cursor pagination. All reads work under `gmail.readonly`.

## Query Capabilities

| Capability               | Supported | Syntax                                 | Notes                                        |
| ------------------------ | --------- | -------------------------------------- | -------------------------------------------- |
| List a label's messages  | Yes       | `messages?labelIds=<id>`               | returns `{id,threadId}` stubs                |
| Get a message by id      | Yes       | `messages/{id}?format=full`            | `metadata`/`minimal`/`raw` also              |
| Full-text search         | Yes       | `messages?q=invoice`                   | searches subject + body + attachment text    |
| By sender/recipient      | Yes       | `q=from:x@y.com`, `q=to:me`            | Gmail operators                              |
| By date range            | Yes       | `q=after:2026/01/01 before:2026/02/01` | `newer_than:`/`older_than:` also             |
| By state                 | Yes       | `q=is:unread`, `q=is:starred`          | presence-style                               |
| By attachment            | Yes       | `q=has:attachment filename:pdf`        |                                              |
| Logical operators        | Yes       | space=AND, `OR`/`{}`=OR, `-`=NOT       | `from:a OR from:b`; `-in:spam`               |
| Size comparison          | Yes       | `q=larger:5M`, `q=smaller:500K`        |                                              |
| **Sort**                 | **No**    | —                                      | always newest-first by `internalDate`; fixed |
| Field selection (sparse) | Partial   | `format=metadata&metadataHeaders=…`    | on `get` only, not `list`                    |
| Include related records  | No        | —                                      | fetch thread / attachments separately        |
| Regex / pattern matching | No        | —                                      | token matching only                          |
| Exact count              | No        | `resultSizeEstimate` (estimate only)   | not authoritative                            |

## Patterns

**1. List labels (Files-Remote root):** `GET /gmail/v1/users/me/labels`
→ `{"labels":[{"id":"INBOX","name":"INBOX","type":"system","messagesTotal":1284,"messagesUnread":12},{"id":"Label_42","name":"Clients/Acme","type":"user","messagesTotal":57}]}`
No pagination — labels return in one call; these become root folders.

**2. List a label's messages (folder contents):** `GET /gmail/v1/users/me/messages?labelIds=Label_42&maxResults=50`
→ `{"messages":[{"id":"17c4a7e5f8b9c2d1","threadId":"17c4a7e5f8b9c2d0"},{"id":"17c4a7e1aa00bb22","threadId":"17c4a7e1aa00bb22"}],"nextPageToken":"08945763213548163492","resultSizeEstimate":57}`
**Stubs only** — `{id,threadId}`. For subject/sender, call `messages.get` per stub (`format=metadata`, `metadataHeaders=Subject,From,Date`). N+1 cost — keep pages ≤50.

**3. Full-text search with operators:** `GET /gmail/v1/users/me/messages?q=from:billing@acme.example%20has:attachment%20newer_than:30d&maxResults=25`
`q` uses Gmail search syntax. Operators:

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

Combining: whitespace=AND · `OR` (uppercase) or `{a b}`=OR · `-term`=NOT · `()` groups. Scope `q` to a label with `&labelIds=<id>`.

**4. Open a message (read body):** `GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1?format=full`
→ `{"id":"17c4a7e5f8b9c2d1","labelIds":["INBOX","IMPORTANT"],"internalDate":"1620000000000","payload":{"mimeType":"multipart/alternative","headers":[{"name":"From","value":"Acme Billing <billing@acme.example>"},{"name":"Subject","value":"Invoice #4471"}],"parts":[{"mimeType":"text/plain","body":{"size":512,"data":"SW52b2ljZSBhdHRhY2hlZA=="}},{"mimeType":"text/html","body":{"size":1024,"data":"PGh0bWw+Li4uPC9odG1sPg=="}}]}}`
Body extraction: walk `payload.parts[]` recursively, prefer `text/html` then `text/plain`, base64url-decode `body.data`. Headers (`From`/`Subject`/`Date`) live in `payload.headers`. [INFERRED]

**5. Cheap metadata-only read (subject/sender/date):** `GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`
Use when hydrating a list view — headers without the (potentially large) body.

**6. Download attachment:** `GET /gmail/v1/users/me/messages/17c4a7e5f8b9c2d1/attachments/ANGjdJ8...`
→ `{"size":84213,"data":"JVBERi0xLjQKJ...base64url..."}` — `data` is base64url; pad to %4 then `urlsafe_b64decode`.

## Pagination

- Type: cursor (opaque page token). Default size 100 (`maxResults`), max 500 (API; connector caps lower for cost). [DOCUMENTED]
- `resultSizeEstimate` = estimate only, never exact.
- Applies to `messages.list`, `threads.list`, `drafts.list`, `history.list`. Labels are unpaginated.

| Parameter       | Where    | Description                             |
| --------------- | -------- | --------------------------------------- |
| `maxResults`    | request  | page size (default 100, max 500)        |
| `pageToken`     | request  | opaque token from prior `nextPageToken` |
| `nextPageToken` | response | cursor for next page; **absent = done** |

Worked:

```
Page 1: GET /users/me/messages?labelIds=INBOX&maxResults=50  → {messages:[…50…], nextPageToken:"08945763213548163492"}
Page 2: GET …&maxResults=50&pageToken=08945763213548163492    → {messages:[…50…], nextPageToken:"11920043928374650091"}
Last:   GET …&pageToken=11920043928374650091                  → {messages:[…7…]}   # no nextPageToken → stop
```

Loop: `token=null; loop: GET …[&pageToken={token}]; process messages; token=nextPageToken; stop if absent`.

## Bulk Reads

| Operation        | Mechanism                          | Limit       | Notes                                       |
| ---------------- | ---------------------------------- | ----------- | ------------------------------------------- |
| Batch HTTP reads | `POST /batch/gmail/v1` (multipart) | 100 sub-req | per-sub-request status; partial failures OK |
| Hydrate a page   | serial `messages.get` per stub     | —           | what the provider does today; N+1 cost      |

Provider does **not** use the batch endpoint today — serial `messages.get`. Batch is a future optimisation. [INFERRED — provider]

## Quota Cost (read)

Gmail bills **quota units**, not requests — 6,000 units/user/minute ceiling.

| Method            | Units | Implication                                          |
| ----------------- | ----- | ---------------------------------------------------- |
| `labels.list`     | 1     | cheap — list freely                                  |
| `messages.list`   | 5     | one per page                                         |
| `messages.get`    | 5     | **per message** — a 50-row hydrated page ≈ 255 units |
| `attachments.get` | 5     | per attachment                                       |
| `history.list`    | 2     | polling                                              |

A 50-message folder listing (1×list + 50×get-metadata ≈ 255 units) is cheap; **runaway pagination over thousands of messages is the real quota risk.** Bound searches with `newer_than:`/`after:` rather than scanning whole labels.

## Gotchas

1. **List returns stubs** — `messages.list` gives only `{id,threadId}`; hydrate with `messages.get`.
2. **No sorting** — always newest-first. For oldest-first, bound with `after:`/`before:` and reverse client-side; no `orderBy`.
3. **`resultSizeEstimate` is an estimate** — don't render as exact count or use for loop termination; use `nextPageToken` presence.
4. **`format=metadata` + `q` is invalid** — metadata reads can't combine with search and return no body. Read with `full`/`metadata`; default `format` (or `minimal`) is fine for listing.
5. **base64url, not base64** — every `body.data` / attachment `data` is URL-safe base64; pad to %4.

# Gmail Integration Tips

All Gmail calls go through `numa integrations pipedream-call gmail <action>` or
`numa integrations request gmail <METHOD> <url>`. The auth prop is always
required — pass `"gmail": {"authProvisionId": "auto"}` on every call. Gmail also
has native file-browse commands (`numa integrations list-files gmail`, etc.).

Prop names below are verified against the live action schemas — don't guess
them; if in doubt, `numa integrations pipedream-props gmail <action>`.

## Identity — `gmail-get-current-user`

Fastest way to learn the connected address. No params beyond auth; returns
`{name, emailAddress, messagesTotal, threadsTotal}`:

```bash
numa integrations pipedream-call gmail gmail-get-current-user \
  --props '{"gmail":{"authProvisionId":"auto"}}' -m "Get connected Gmail identity"
```

You usually don't even need this before sending: **`"me"` is a valid address** in
`to`/`cc`/`bcc` for both `send-email` and `create-draft` — it resolves to the
authenticated user at runtime.

## Multiple Connected Mailboxes (FEAT-019)

If the **Connected Integrations** section lists more than one `gmail` account:

- `"authProvisionId": "auto"` resolves to ONE account (the oldest). Fine when the user implicitly means "any" / "my Gmail".
- When the user says "each mailbox", "all my inboxes", "from both accounts", or names a specific one, **iterate** — call once per account with its explicit `apn_xxx`. Don't claim "only one account is connected" without checking the multi-account list.
- Label results back with the account name (e.g. "tom@wiltshireland.com"), not the apn_xxx.

```bash
numa integrations pipedream-call gmail gmail-find-email \
  --props '{"gmail":{"authProvisionId":"apn_AAAA"},"maxResults":5}' -m "5 from work mailbox"
numa integrations pipedream-call gmail gmail-find-email \
  --props '{"gmail":{"authProvisionId":"apn_BBBB"},"maxResults":5}' -m "5 from personal mailbox"
```

## Finding Emails — `gmail-find-email`

Props: `q` (search query, optional — omit for most recent), `maxResults`
(**default 25**, max 500 per call), `format` (`"metadata"` default, or `"full"`),
`labelIds` (string[] of IDs or names), `includeSpamTrash` (default false).

- **`maxResults` works — there is no hidden 5-result cap.** Verified 5→5, 50→50. Fewer results than requested means fewer matched your filter, not a cap. Widen the filter or raise `maxResults`; do **not** fall back to looping raw `numa integrations request` calls.
- **`format` controls the payload:** `"metadata"` (default) returns `id`, `threadId`, `labelIds`, `subject`, `sender`, `recipient`, `date`, `snippet` per message — enough for find/count/list/summarise-from-snippet. `"full"` adds the decoded body and `payload.parts[]` (needed for attachment IDs). Use `metadata` unless you need body text or attachments.
- **One call, not one-per-message:** a single `find-email` with `maxResults: 50` returns 50 fully-populated messages. Don't loop `request` to re-fetch each message's metadata — it's already in the result.
- Be precise: "your 25 most recent" ≠ "25 emails this week". You know what was _returned_, not what _exists_. A `nextPageToken` in the response means more exist.

### Timezone — the #1 cause of "missing" emails

`after:` / `before:` filters use **UTC dates**, not the user's local day. For users east of UTC (NZ = UTC+12/13, AU = UTC+10), `after:2026/06/03` starts at UTC midnight ≈ mid-morning local time, silently dropping everything sent earlier that local morning — looks exactly like "it only returned 5". For "today"/"this morning":

- Prefer **rolling** operators — `newer_than:1d`, `newer_than:12h` — timezone-agnostic and usually what's meant.
- For an exact "since local midnight" boundary, pass a **Unix epoch second**: `after:1780444800` (compute from the user's local midnight).

Never answer an under-returning date filter by firing dozens of `request` calls — fix the filter.

## Attachments

### Discovering them

Call `find-email` with `format: "full"` (or `gmail-list-thread-messages`), then
walk `payload.parts[]` recursively — attachments are parts where both `filename`
and `body.attachmentId` are non-empty. Structure can be deeply nested
(`parts[0].parts[1]...`).

### Downloading — `gmail-download-attachment`

Needs `messageId` (the email's hex ID) and `attachmentId` (from the payload).
Pass `--stash-id NEW` or the file isn't captured:

```bash
numa integrations pipedream-call gmail gmail-download-attachment \
  --props '{"gmail":{"authProvisionId":"auto"},"messageId":"19c2129741a92183","attachmentId":"ANGjdJ_...","filename":"document.pdf"}' \
  --stash-id NEW -m "Download document.pdf"
```

The file is delivered into the workspace automatically — **use the path in
`downloaded_files[0]`** (under `/workdir/tmp/integrations-results/`), **not**
`ret.filePath` (that's the Pipedream Lambda's internal `/tmp/...` path, not
accessible to you). If the user wants to keep it, `cp` it to `/workdir/outputs/`.
`convertToPdf: true` converts images / HTML / plain text / DOCX to PDF on
download (other MIME types error).

## Sending Emails & Drafts

`gmail-send-email` and `gmail-create-draft` share a parameter shape (difference:
Sent vs Drafts). Key props: `to`/`cc`/`bcc` (string[], accept `"me"`), `body`
(required), `bodyType` (`"plaintext"` default / `"html"`), `subject` (ignored
when replying — auto `Re:`), `fromName`, `fromEmail`, `replyTo`,
`inReplyToMessageId`, `replyAll`.

```bash
numa integrations pipedream-call gmail gmail-send-email \
  --props '{"gmail":{"authProvisionId":"auto"},"to":["me"],"subject":"Report","body":"<p>See attached.</p>","bodyType":"html"}' \
  -m "Send report to self"
```

- **`bodyType: "html"`** whenever the body has any tags, links, or formatting.
- **Replying:** pass any `message.id` from the target thread as `inReplyToMessageId` — the action preserves `References`/`In-Reply-To` and sets the right `threadId` (verified: reply lands in the parent thread). `replyAll: true` fans out to the original From/To/Cc (minus self); only applies when `inReplyToMessageId` is set.
- **`fromEmail`** (send-as alias) is optional — omit to use the account default. You _can_ resolve aliases with `pipedream-props-options gmail gmail-send-email fromEmail` (returns the send-as addresses), or just call `get-current-user` for the primary.

**Two attachment mechanisms (send-email):**

1. **Inline** (best for generated text/small content): `attachmentContent` (string) + `attachmentFilename` (string with extension). No file path needed.
2. **File paths / URLs:** `attachments` (string[]) + `attachmentFilenames` (string[], parallel array). Workspace paths (`/workdir/outputs/report.pdf`) auto-convert to presigned URLs; public URLs also work.

> `gmail-create-draft` supports only the **file-path** mechanism (`attachments` + `attachmentFilenames`) — it has **no `attachmentContent` prop**. Use `send-email` if you need an inline-content attachment.

**"Updating" a draft = replace, not duplicate.** There's no in-place draft edit.
To revise a draft: list it (`GET /gmail/v1/users/me/drafts`), delete it
(`DELETE /gmail/v1/users/me/drafts/{id}` via `numa integrations request`), then
create a fresh one. Leaving two near-identical drafts behind is a defect. And a
draft is a draft — don't send unless told to.

## Labels — prefer `gmail-modify-labels`

`gmail-modify-labels` adds/removes labels across up to 1000 messages in one call.
Props: `messageIds` (string[]), `addLabels`, `removeLabels` — each accepts label
**IDs or display names** (names resolved server-side). This is the clean
programmatic path; **prefer it over the legacy single-message actions**
(`gmail-add-label-to-email`, `gmail-remove-label-from-email`, `gmail-archive-email`),
whose `message` prop is a `useQuery`+`remoteOptions` dropdown that's awkward to
drive from the CLI.

```json
{"messageIds":["..."],"removeLabels":["INBOX"]}                              // archive
{"messageIds":["..."],"addLabels":["TRASH"]}                                 // to Trash
{"messageIds":["..."],"removeLabels":["TRASH"],"addLabels":["INBOX"]}        // restore
{"messageIds":["..."],"addLabels":["STARRED"]}                               // star
{"messageIds":["..."],"removeLabels":["UNREAD"]}                             // mark read
{"messageIds":["..."],"addLabels":["Projects/Alpha"],"removeLabels":["INBOX"]} // label + archive
```

Other label actions:

- **`gmail-list-labels`** → user labels first (IDs like `Label_1`, `Label7218...`), then system labels (`INBOX`, `SENT`, `UNREAD`, `TRASH`, `STARRED`, `SPAM`).
- **`gmail-create-label`** — `name` (use `/` for nesting: `"Projects/Alpha"`). **Idempotent**: if it exists, returns `{"alreadyExisted": true}` with the existing ID — safe to call without pre-checking. `textColor`+`backgroundColor` must be set together from Gmail's fixed palette. Returns the new ID (e.g. `Label_2`) — reuse it this session.
- **`gmail-delete-label`** — permanently deletes the label everywhere; takes the label **ID** (e.g. `Label_2`), not the name. To just detach a label from messages, use `modify-labels` with `removeLabels`.
- **`gmail-bulk-archive-emails`** — `messages` (string[], `remoteOptions`), max 1000, batchModify under the hood. `modify-labels` with `removeLabels:["INBOX"]` is usually cleaner.

## Delete — `gmail-delete-email`

Moves the message to Trash (not permanent). `message` accepts a raw message ID.
The response is **unusually verbose** — a full axios object including
`data.config.headers` etc. Extract `data.id` and `data.labelIds` (which will
include `TRASH`); don't assume a clean top-level shape.

## Signatures & Delegation — service-account-gated actions

- **`gmail-list-signature-options`** → the HTML value + plain-text label for each send-as alias (read the current signature before changing it).
- **`gmail-update-primary-signature`** — `signature` accepts HTML (same format `list-signature-options` returns). Overwrites immediately, no undo — read the current value first.
- **`gmail-update-org-signature`** and **`gmail-list-delegate-options`** require a Google Cloud **service account with delegated domain-wide authority**. They **fail for standard OAuth** connections (`list-delegate-options` returns `403 Access restricted to service accounts...`, confirmed live). Don't attempt them for normal user connections.

## Direct API Requests (`numa integrations request gmail`)

Use when you need pagination beyond 500, draft management, or operations no
action covers. **No special headers needed** — unlike Notion, Gmail wants no
`x-pd-proxy-*` version header; the proxy injects OAuth.

```bash
# List drafts
numa integrations request gmail GET "https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=5" -m "List drafts"
# Delete a draft
numa integrations request gmail DELETE "https://gmail.googleapis.com/gmail/v1/users/me/drafts/{draftId}" -m "Delete draft"
# Paginate messages
numa integrations request gmail GET "https://gmail.googleapis.com/gmail/v1/users/me/messages?pageToken=<token>&maxResults=500" -m "Paginate messages"
```

The built-in `find-email` strips `nextPageToken`, so `pipedream-call` can't
paginate past its single (≤500) call — use `request` and follow `nextPageToken`
(passed back as `pageToken=...`) until it's absent.

## Search Query Cheatsheet (`q`)

```
from:alice@example.com     by sender ADDRESS (not display name)
to:me                      to the authenticated account
subject:"quarterly report" subject phrase
has:attachment             has an attachment        filename:pdf  attachment is a PDF
is:unread   is:starred     label:INBOX
newer_than:7d              within last 7 days (timezone-safe)
older_than:1m              older than 1 month
after:2026/01/01           after date (UTC)         before:2026/12/31  before date (UTC)
after:1782054000           after Unix epoch (timezone-precise)
category:primary           Primary tab              category:promotions  Promotions tab
```

`from:` matches the **email address, not the display name** — `from:"Alice Smith"`
won't reliably work. If you only know a name, search subject/body for it or list
recent senders to resolve the address first. Combine operators freely:
`from:alice@example.com has:attachment newer_than:30d`.

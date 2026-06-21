# Gmail Integration Tips

All Gmail calls go through the `numa integrations` CLI. Action keys below are
real (`numa integrations pipedream-actions gmail` lists them). The auth prop is
always required — pass `"gmail": {"authProvisionId": "auto"}` and the proxy
resolves the user's connected account. Gmail also has native file-browse
commands (`numa integrations list-files gmail`, etc.) for surfacing mailbox files.

## Multiple Connected Mailboxes (FEAT-019)

If the **Connected Integrations** section above lists more than one account under `gmail` (e.g. work + personal mailbox), each one is a separate Gmail account with its own inbox.

- `"authProvisionId": "auto"` resolves to ONE account only (the oldest). Useful when the user implicitly means "any" / "my Gmail" — pick this when context doesn't disambiguate.
- When the user says "each mailbox", "all my inboxes", "from both accounts", or names a specific account (e.g. "from my work email"), **iterate**: call the action once per account with the explicit `apn_xxx`. Don't claim "only one account is connected" — check the multi-account list first.
- When labelling results back to the user, use the account name (e.g. "tom@wiltshireland.com") from the multi-account list rather than the apn_xxx.

Example (list 5 emails from each of two Gmail accounts):

```bash
numa integrations pipedream-call gmail gmail-find-email \
  --props '{"gmail":{"authProvisionId":"apn_AAAA"},"maxResults":5}' \
  -m "Listing 5 emails from work mailbox"

numa integrations pipedream-call gmail gmail-find-email \
  --props '{"gmail":{"authProvisionId":"apn_BBBB"},"maxResults":5}' \
  -m "Listing 5 emails from personal mailbox"
```

## Searching for Emails with Attachments

Before searching for emails with attachments, understand that attachment metadata (`attachmentId`) requires specific settings:

- Set `metadataOnly=false` — otherwise no `payload`/`parts` are returned
- Set `withTextPayload=false` — otherwise the `parts[]` structure is flattened to a string and `attachmentId`s are lost

## Discovering Attachments

Attachments appear in nested `payload.parts[].body.attachmentId`. The structure can be deeply nested (e.g., `parts[0].parts[1].body.attachmentId`). Look for parts where `filename` is non-empty and `body.attachmentId` exists.

## Downloading Attachments

Requires both `messageId` (the email's hex ID) and `attachmentId` from the payload. Add `--stash-id NEW` so the attachment is captured:

```bash
numa integrations pipedream-call gmail gmail-download-attachment \
  --props '{"gmail":{"authProvisionId":"auto"},"messageId":"19c2129741a92183","attachmentId":"ANGjdJ_PP9uiRstD...","filename":"document.pdf"}' \
  --stash-id NEW \
  -m "Downloading document.pdf"
```

The file is delivered automatically — reference the `downloaded_files` path in the result (default `/workdir/tmp/integrations-results/`). No manual base64 decode needed.

## Sending Emails with Attachments

The `attachmentFilenames` and `attachmentUrlsOrPaths` must be parallel arrays. Workspace paths (`/workdir/...`) are automatically converted to presigned URLs and work correctly:

```bash
numa integrations pipedream-call gmail gmail-send-email \
  --props '{"gmail":{"authProvisionId":"auto"},"to":["recipient@example.com"],"subject":"Report attached","body":"Please see attached.","attachmentFilenames":["report.pdf"],"attachmentUrlsOrPaths":["/workdir/outputs/report.pdf"]}' \
  -m "Sending report.pdf"
```

Public URLs also work: `"attachmentUrlsOrPaths": ["https://example.com/files/report.pdf"]`

## HTML Emails

Set `bodyType="html"` when your content includes links, lists, bold/italics, or any HTML formatting. Default is plaintext.

## Threading / Replies

Use `inReplyTo` with the Gmail message ID (hex string like `19c216feb2f7b960`) to keep replies in the same thread. The response will show matching `threadId` confirming proper threading.

## Listing Emails — count, timezone, and getting details in one call

**`maxResults` works — there is no hidden 5-result cap.** `gmail-find-email` defaults to **20** and honours whatever you set, up to **500 in a single call** (verified live: 5→5, 20→20, 50→50). If you get fewer results than expected, it's because **only that many matched your filter** — do **not** conclude "the action caps at N" and fall back to raw `numa integrations request` API calls. Widen the filter or raise `maxResults` instead.

- Be precise about what you fetched: 20 emails with no time filter is "your 20 most recent", **not** "20 emails this week". You know how many were _returned_, not how many _exist_.
- If the response includes a `nextPageToken`, more results exist beyond what you fetched.

### Timezone — the #1 cause of "missing" emails

`after:` / `before:` date filters use **UTC dates**, not the user's local day. For users east of UTC (NZ = UTC+12/13, AU = UTC+10), `after:2026/06/03` begins at UTC midnight ≈ mid-morning local time, so it **silently drops everything sent earlier that local morning** — which looks exactly like "it only returned 5". For "today" / "this morning":

- Prefer **rolling** operators — `newer_than:1d`, `newer_than:12h` — which are timezone-agnostic and usually what the user means.
- For an exact "since local midnight" boundary, pass a **Unix timestamp** (Gmail accepts epoch seconds): `after:1780444800`. Compute it from the user's local midnight, not UTC.

Never respond to an under-returning date filter by firing dozens of `numa integrations request` calls — fix the filter.

### Getting email details — one call, not one-per-message

`gmail-find-email` already returns, **per message**: `id`, `threadId`, `subject`, `sender`, `recipient`, `date`, `snippet`, `labelIds`, and the full `payload`. So a single call with `maxResults: 50` gives you 50 fully-populated emails — subjects, senders, dates, and snippets included. **Do not** loop `numa integrations request` (or `gmail-get-email`) to fetch each message's metadata individually; it's already in the find result. Set `withTextPayload: true` if you want the body flattened to text for summarising.

### Beyond 500 results / true pagination

Only needed for >500 messages or to walk every page: call `https://gmail.googleapis.com/gmail/v1/users/me/messages` and follow `nextPageToken` (pass it back as `pageToken=...`) until it's absent — the built-in action strips `nextPageToken`, so `pipedream-call` alone can't paginate past its single (up-to-500) call:

```bash
numa integrations request gmail GET \
  "https://gmail.googleapis.com/gmail/v1/users/me/messages?pageToken=..." \
  -m "Paginating messages beyond 500"
```

## Search Query Syntax

Uses Gmail's standard search operators in the `q` parameter:

- `has:attachment` — emails with attachments
- `from:alice@example.com` — from specific sender
- `newer_than:7d` — within last 7 days
- `subject:"quarterly report"` — subject contains phrase
- Combine with spaces: `from:alice has:attachment newer_than:30d`
- **`from:` matches the email address, not the display name.** `from:alice@example.com` works; `from:"Alice Smith"` (a display name) usually won't. If you only know a person's name, search the **subject**/body for it or list recent senders and resolve the address first — don't assume `from:Name` finds their mail.

## Drafts — "update" means replace, not duplicate

There is no in-place draft-edit action. When the user asks you to "update" or "revise" a draft, do NOT create a second draft — find the existing draft, delete it (`numa integrations request gmail DELETE https://gmail.googleapis.com/gmail/v1/users/me/drafts/{id}`), then create the corrected one. Leaving two drafts behind ("update her draft" → two copies) is a defect. Same rule for any "update X" on an external record: replace or truly update, never append a duplicate. And a draft is a draft — don't send it unless the user said to send.

## Labels

Use `pipedream-props-options` on the `labels` prop to get available label IDs. Custom labels have IDs like `Label_1`, while system labels use names like `INBOX`, `SENT`, `UNREAD`.

```bash
numa integrations pipedream-props-options gmail gmail-find-email labels \
  --gmail '{"authProvisionId":"auto"}' -m "Listing Gmail labels"
```

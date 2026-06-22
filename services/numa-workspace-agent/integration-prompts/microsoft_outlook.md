# Microsoft Outlook Integration Tips

All Outlook calls go through the `numa integrations` CLI. Pass
`"microsoft_outlook": {"authProvisionId": "auto"}` as the auth prop — the proxy
accepts it for every action (the auth key is normalised, so casing doesn't
matter). Action keys follow `microsoft_outlook-<name>` (run
`numa integrations pipedream-actions microsoft_outlook` to list them).
Prop names below are verified against the live schemas — if unsure,
`numa integrations pipedream-props microsoft_outlook <action>`.

## Account Type Caveat (personal vs M365)

Works with both personal Microsoft accounts (outlook.com/hotmail.com/live.com)
and organisational Exchange/M365 accounts. **Org-directory features need M365:**
on a personal account, `find-shared-folder-email` errors (its `userId`
props-options returns `bad options response for prop: userId` — verified), and
`list-important-mail` comes back empty (no Focused Inbox scoring). Don't retry
these on a personal account — they can't work without a tenant directory.

## Multiple Connected Mailboxes (FEAT-019)

If the **Connected Integrations** section lists more than one `microsoft_outlook` account:

- `"authProvisionId": "auto"` resolves to ONE account (the oldest). Use it only when context implies "any" / "my Outlook".
- When the user references multiple mailboxes ("each", "all", "work and personal") or names a specific one, iterate — call once per account with the explicit `apn_xxx` (passed as `authProvisionId`). Don't claim "only one mailbox is connected" without checking.
- Report results with the account display name (e.g. "tom@arcanum.ai"), not the apn_xxx.

## Prefer the Consolidated Actions

The set includes newer consolidated actions — prefer them over the legacy ones:

| Prefer                                    | Over                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `send-email` (with `isDraft: true`)       | `create-draft-email`                                                    |
| `send-email` (with `inReplyToMessageId`)  | `reply-to-email`, `create-draft-reply`                                  |
| `modify-email`                            | `move-email-to-folder`, `add-label-to-email`, `remove-label-from-email` |
| `save-contact` (with/without `contactId`) | `create-contact`, `update-contact`                                      |
| `find-contacts`                           | `list-contacts` (when searching by name/email)                          |

The legacy actions still work and are fine for single-purpose calls.

## `modify-email` — multi-op in one call

Applies any combination of mutations in a single Graph call — pass only the props you want to change. Props: `messageId`, `isRead`, `addCategories`, `removeCategories`, `destinationFolderId`, `flagStatus`.

```bash
numa integrations pipedream-call microsoft_outlook microsoft_outlook-modify-email \
  --props '{"microsoft_outlook":{"authProvisionId":"auto"},"messageId":"AAMk...","isRead":true,"addCategories":["Blue category"],"destinationFolderId":"archive","flagStatus":"flagged"}' \
  -m "Mark read + categorise + archive + flag"
```

`destinationFolderId` accepts well-known names (`inbox`, `archive`, `deleteditems`, `drafts`, `junkemail`, `sentitems`) or a raw folder ID from `list-folders`.

## ⚠️ Message IDs change on every move

When you move an email — via `move-email-to-folder` **OR** `modify-email` with a `destinationFolderId` — the returned message has a **new `id`**, and the old one is immediately invalid (`ErrorItemNotFound`). Always carry the `id` from the move response into subsequent label/reply/modify calls. (This bites multi-step flows: archive-then-label fails if you reuse the pre-move ID.)

## `send-email` — unified send / draft / reply

One action covers three modes. Props: `recipients`, `ccRecipients`, `bccRecipients` (string[]), `subject`, `content`, `contentType` (`html`/`text`), `inReplyToMessageId`, `isDraft`, `files`.

- **New email:** set `recipients`, `subject`, `content`.
- **Reply:** add `inReplyToMessageId` (threads correctly; no need to re-set recipients/subject).
- **Draft:** add `isDraft: true` to save to Drafts instead of sending.

```bash
numa integrations pipedream-call microsoft_outlook microsoft_outlook-send-email \
  --props '{"microsoft_outlook":{"authProvisionId":"auto"},"recipients":["you@example.com"],"subject":"Hello","content":"<p>Hi</p>","contentType":"html","isDraft":true}' \
  -m "Save Outlook draft"
```

All modes accept `files` for attachments — workspace paths convert automatically (`["/workdir/uploads/report.pdf"]`).

**Legacy reply actions use `comment`, not `content`:** `reply-to-email` and `create-draft-reply` put the body in `comment` (whereas `send-email`/`create-draft-email` use `content`). Mixing them up sends a silent empty body.

## `find-email` — search vs filter vs count

Props: `search`, `filter`, `orderBy`, `isRead`, `folderScope`, `countOnly`, `maxResults`.

- **`search` and `filter` cannot be combined** → `InefficientFilter` (400). **`filter` + `orderBy`** also fails the same way.
- **`search` + `isRead` is fine** — the action converts `search` to a `contains(subject,...)` filter and joins it with the read condition. Note this narrows to **subject only** (a bare `$search` also matches body/from).
- **`countOnly` can't combine with `search`.**
- Use `folderScope: "inbox"` to keep Sent/Drafts/Junk from inflating counts.

```bash
numa integrations pipedream-call microsoft_outlook microsoft_outlook-find-email \
  --props '{"microsoft_outlook":{"authProvisionId":"auto"},"isRead":false,"folderScope":"inbox","countOnly":true}' \
  -m "Count unread inbox messages"
```

`find-email` returns metadata only (no body). Use `get-message` with a known `messageId` for the full body and/or attachment list.

## Attachments — two-step via `get-message`

`find-email` includes `hasAttachments` but **not** the attachment IDs. To download:

1. `get-message` with `includeAttachments: true` — each entry in `attachments[]` has an `id`:
   ```bash
   numa integrations pipedream-call microsoft_outlook microsoft_outlook-get-message \
     --props '{"microsoft_outlook":{"authProvisionId":"auto"},"messageId":"AAMk...","includeAttachments":true}' \
     -m "Get message + attachments"
   ```
2. `download-attachment` with `messageId` + `attachmentId` (+ `filename`), `--stash-id NEW`:
   ```bash
   numa integrations pipedream-call microsoft_outlook microsoft_outlook-download-attachment \
     --props '{"microsoft_outlook":{"authProvisionId":"auto"},"messageId":"AAMk...","attachmentId":"<ATT_ID>","filename":"report.pdf"}' \
     --stash-id NEW -m "Download attachment"
   ```

`--stash-id NEW` is required for downloads. The file is delivered automatically — reference the `downloaded_files` path (default `/workdir/tmp/integrations-results/`); `cp` to `/workdir/outputs/` if the user wants it. For `text/*` and JSON attachments, `download-attachment` also returns the decoded content inline so you can read it without saving. `convertToPdf: true` converts images/HTML/text/DOCX to PDF.

## Labels (categories)

`list-labels` returns the available categories (Red/Orange/Yellow/Green/Blue/Purple by default). Use the `displayName` (e.g. `"Blue category"`) when categorising — via `modify-email`'s `addCategories`/`removeCategories` (preferred) or the legacy `add-label-to-email`.

The `label` prop on `add-label-to-email` **does** resolve options — `pipedream-props-options` returns the category names as a `stringOptions` array (excluding ones already on that message, so the list is message-dependent). Pass the `displayName` string directly: `{"label": "Blue category"}`.

## Contacts — `save-contact` upsert

`save-contact` is an upsert: omit `contactId` to create, provide it to update (only the props you pass are changed). Get the `contactId` from `find-contacts` (supports `searchString` by name/email). Props: `givenName`, `surname`, `emailAddresses`, `businessPhones`. `emailAddresses` takes a plain string array (`["a@b.com"]`) — the API stores them as `[{"name":"Email #1","address":"a@b.com"}]` objects, conversion handled for you.

## Deleting (no built-in delete action)

Use `numa integrations request` with `DELETE`:

```bash
numa integrations request microsoft_outlook DELETE \
  "https://graph.microsoft.com/v1.0/me/messages/<MESSAGE_ID>" -m "Delete email"
numa integrations request microsoft_outlook DELETE \
  "https://graph.microsoft.com/v1.0/me/contacts/<CONTACT_ID>" -m "Delete contact"
```

A successful DELETE is `204 No Content` — the proxy returns it as `{"binary": true, "base64_body": "", "size": 0}`. That `size: 0` + `binary: true` shape **is success**, not an error.

## Pagination — follow `@odata.nextLink` verbatim

For bulk fetches use `numa integrations request` against the raw Graph endpoint and follow the `@odata.nextLink` URL on each response until it's absent:

```bash
numa integrations request microsoft_outlook GET \
  "https://graph.microsoft.com/v1.0/me/messages?\$top=100&\$select=subject,from,receivedDateTime,bodyPreview,hasAttachments" \
  -m "Walking the inbox"
```

- **Follow the returned `nextLink` URL verbatim.** It contains `$skip` plus query state — do **not** hand-construct your own `$skip` offsets (a manual linear scan costs one approval + round-trip per page).
- Built-in actions (`find-email`) strip the pagination token, so `pipedream-call` can't page past its single call — use `request`.
- Decide your full `$select` set up front (`$top` max 1000 for messages).

## Shared mailboxes (M365/Exchange only)

`find-shared-folder-email` accesses other users' mailboxes — resolve `userId` (org members), then `sharedFolderId` for that user. Requires delegation rights. **Fails on personal accounts** (the `userId` resolver returns `bad options response`). For org accounts:

```bash
numa integrations pipedream-props-options microsoft_outlook \
  microsoft_outlook-find-shared-folder-email userId \
  --configured '{"microsoft_outlook":{"authProvisionId":"auto"}}' -m "List org users"
```

## `approve-workflow`

A Pipedream workflow-orchestration primitive (suspends a flow until someone clicks an approval link). Not a Numa-native concept — generally not useful here.

# Microsoft Outlook Integration Tips

All Outlook calls go through the `numa integrations` CLI. The auth prop is the
slug name `microsoft_outlook` — pass `"microsoft_outlook": {"authProvisionId": "auto"}`
and the proxy resolves the user's connected account. Action keys follow
`microsoft_outlook-<name>` (run `numa integrations pipedream-actions microsoft_outlook`
to list them).

## Multiple Connected Mailboxes (FEAT-019)

If the **Connected Integrations** section above lists more than one account under `microsoft_outlook`, each one is a separate Outlook mailbox.

- `"authProvisionId": "auto"` resolves to ONE account only (the oldest). Use it only when context implies "any" / "my Outlook".
- When the user references multiple mailboxes ("each", "all", "from work and personal", etc.) or names a specific one, iterate by calling `pipedream-call` once per account with the explicit `apn_xxx` from the multi-account list (pass it as the `authProvisionId`). Don't claim "only one mailbox is connected" without checking.
- Use the account display name (e.g. "tom@arcanum.ai") when reporting results back, not the apn_xxx.

## Establishing Context

Before performing Outlook operations, establish context:

- Use `microsoft_outlook-list-folders` to get folder IDs (`Inbox`, `Archive`, `Deleted Items`, etc.) — needed for move operations
- Use `microsoft_outlook-list-labels` to get available categories — needed for `add-label` operations (the `label` prop's options come back empty, so you must list them)

## Search vs Filter

The `microsoft_outlook-find-email` action supports both `search` and `filter` params, but they **cannot be used together**. Additionally, combining `filter` with `orderBy` causes `InefficientFilter` errors. Use `search` for keyword lookups (supports `subject:`, `from:`, `to:` prefixes), or `filter` alone for OData queries like `contains(subject, 'keyword')`.

## Pagination — Follow `@odata.nextLink`, Never Iterate `$skip`

For bulk fetches that span more than one page, use `numa integrations request` against the raw Graph endpoint (e.g. `https://graph.microsoft.com/v1.0/me/messages`) and follow the `@odata.nextLink` URL returned in each response. Keep following until the field is absent.

```bash
numa integrations request microsoft_outlook GET \
  "https://graph.microsoft.com/v1.0/me/messages?\$top=100&\$select=subject,from,receivedDateTime,bodyPreview,hasAttachments" \
  -m "Walking the inbox"
```

- **Never iterate `$skip=0, 100, 200, ...` manually.** That's a linear scan that costs one approval + one round-trip per page (real example: 91 calls to walk one inbox).
- **Built-in actions (`find-email`, etc.) strip pagination tokens** — `@odata.nextLink` does not survive `pipedream-call`. If the user needs more than `find-email`'s default page, use `request`.
- **Decide your full `$select` field set up front** (e.g. `subject,from,receivedDateTime,bodyPreview,hasAttachments`). Re-walking the same window with a different `$select` doubles the cost.
- **Use `$top` to control page size** (max 1000 for messages).

## Attachments Require Two-Step Lookup

The `find-email` response includes `hasAttachments: true/false` but **NOT** the `attachments[]` array. To download attachments:

1. Get the `messageId` from `find-email` results
2. Resolve `attachmentId` options with the `messageId` to get attachment IDs and filenames:

   ```bash
   numa integrations pipedream-props-options microsoft_outlook microsoft_outlook-download-attachment attachmentId \
     --props '{"microsoft_outlook":{"authProvisionId":"auto"},"messageId":"<MESSAGE_ID>"}' \
     -m "Listing attachments"
   ```

3. Call `download-attachment` with both `messageId` and `attachmentId`, including `--stash-id NEW`:

   ```bash
   numa integrations pipedream-call microsoft_outlook microsoft_outlook-download-attachment \
     --props '{"microsoft_outlook":{"authProvisionId":"auto"},"messageId":"<MESSAGE_ID>","attachmentId":"<ATTACHMENT_ID>"}' \
     --stash-id NEW -m "Downloading attachment"
   ```

   The file is delivered automatically — reference the `downloaded_files` path in the result (default `/workdir/tmp/integrations-results/`).

## Reply Uses `comment`, Not `content`

The `reply-to-email` action uses `comment` for the reply body, while `send-email` and `create-draft-email` use `content`. This is an easy mistake to make.

## Labels Need `displayName` from `list-labels`

The options for the `label` prop come back empty. Instead, call `microsoft_outlook-list-labels` to get available categories, then use the `displayName` value (e.g., `"Red category"`, `"Blue category"`) in `add-label-to-email`.

## File Attachments

For `send-email`, `create-draft-email`, and `reply-to-email`, pass workspace paths directly in the `files` array (e.g., `["/workdir/uploads/report.pdf"]`). The system converts them to presigned URLs automatically.

## Message IDs Change After Move

When you move an email with `move-email-to-folder`, the returned message has a **new** `id`. The old ID becomes invalid. Always use the ID from the move response for subsequent operations.

## Email Addresses in Contacts

The `emailAddresses` prop accepts a simple string array `["email@example.com"]`, but the API stores it as objects `[{"name": "Email #1", "address": "email@example.com"}]`. The conversion is automatic.

## No Delete Actions for Contacts/Emails

Use `numa integrations request` with the `DELETE` method to delete contacts (`/me/contacts/{id}`) or emails (`/me/messages/{id}`). Moving to the "Deleted Items" folder is an alternative for emails.

```bash
numa integrations request microsoft_outlook DELETE \
  "https://graph.microsoft.com/v1.0/me/messages/<MESSAGE_ID>" \
  -m "Deleting email"
```

## Download Attachment Requires `--stash-id`

Always include `--stash-id NEW` when calling `download-attachment`. Files land in `/workdir/tmp/integrations-results/` (scratch — hidden from the user's Files page); reference the `downloaded_files` path in the result. If the user asked for the attachment as a deliverable, `cp` it to `/workdir/outputs/`.

## Business/Organization Accounts

### Shared Folder Access

The `find-shared-folder-email` action allows accessing other users' mailboxes in the organization:

- Resolve `userId` options to get a list of organization members
- Resolve `sharedFolderId` options with the selected `userId` to get their folders
- **Important:** Accessing another user's folders requires delegation rights. If you don't have access, the `sharedFolderId` options come back empty.

```bash
numa integrations pipedream-props-options microsoft_outlook microsoft_outlook-find-shared-folder-email userId \
  --props '{"microsoft_outlook":{"authProvisionId":"auto"}}' \
  -m "Listing organization users"
```

### Organization User Lookup

The `userId` prop in `find-shared-folder-email` returns **all** users in the tenant. This is useful for identifying shared mailboxes or other users to query (if delegation is configured).

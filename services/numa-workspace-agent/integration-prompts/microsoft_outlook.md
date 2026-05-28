# Microsoft Outlook Integration Tips

## Multiple Connected Mailboxes (FEAT-019)

If the **Connected Integrations** section above lists more than one account under `microsoft_outlook`, each one is a separate Outlook mailbox.

- `"authProvisionId": "auto"` resolves to ONE account only (the oldest). Use it only when context implies "any" / "my Outlook".
- When the user references multiple mailboxes ("each", "all", "from work and personal", etc.) or names a specific one, iterate by calling `run_action` once per account with the explicit `apn_xxx` from the multi-account list. Don't claim "only one mailbox is connected" without checking.
- Use the account display name (e.g. "tom@arcanum.ai") when reporting results back, not the apn_xxx.

## Establishing Context

Before performing Outlook operations, establish context:

- Use `list-folders` to get folder IDs (`Inbox`, `Archive`, `Deleted Items`, etc.) — needed for move operations
- Use `list-labels` to get available categories — needed for `add-label` operations (`configure_props` returns empty for labels)

## Search vs Filter

The `find-email` action supports both `search` and `filter` params, but they **cannot be used together**. Additionally, combining `filter` with `orderBy` causes `InefficientFilter` errors. Use `search` for keyword lookups (supports `subject:`, `from:`, `to:` prefixes), or `filter` alone for OData queries like `contains(subject, 'keyword')`.

## Pagination — Follow `@odata.nextLink`, Never Iterate `$skip`

For bulk fetches that span more than one page, use `proxy_request` against the raw Graph endpoint (e.g. `https://graph.microsoft.com/v1.0/me/messages`) and follow the `@odata.nextLink` URL returned in each response. Keep following until the field is absent.

- **Never iterate `$skip=0, 100, 200, ...` manually.** That's a linear scan that costs one approval + one round-trip per page (real example: 91 calls to walk one inbox).
- **Built-in actions (`find-email`, etc.) strip pagination tokens** — `@odata.nextLink` does not survive `run_action`. If the user needs more than `find-email`'s default page, you have to use `proxy_request`.
- **Decide your full `$select` field set up front** (e.g. `subject,from,receivedDateTime,bodyPreview,hasAttachments`). Re-walking the same window with a different `$select` doubles the cost.
- **Use `$top` to control page size** (max 1000 for messages).

## Attachments Require Two-Step Lookup

The `find-email` response includes `hasAttachments: true/false` but **NOT** the `attachments[]` array. To download attachments:

1. Get the `messageId` from `find-email` results
2. Call `configure_props` for `attachmentId` with the `messageId` to get attachment IDs and filenames
3. Call `download-attachment` with both `messageId` and `attachmentId`, including `stash_id="NEW"`

## Reply Uses `comment`, Not `content`

The `reply-to-email` action uses `comment` for the reply body, while `send-email` and `create-draft-email` use `content`. This is an easy mistake to make.

## Labels Need `displayName` from `list-labels`

The `configure_props` for the `label` prop returns empty. Instead, call `list-labels` to get available categories, then use the `displayName` value (e.g., `"Red category"`, `"Blue category"`) in `add-label-to-email`.

## File Attachments

For `send-email`, `create-draft-email`, and `reply-to-email`, pass workspace paths directly in the `files` array (e.g., `["/workdir/uploads/report.pdf"]`). The system converts them to presigned URLs automatically.

## Message IDs Change After Move

When you move an email with `move-email-to-folder`, the returned message has a **new** `id`. The old ID becomes invalid. Always use the ID from the move response for subsequent operations.

## Email Addresses in Contacts

The `emailAddresses` prop accepts a simple string array `["email@example.com"]`, but the API stores it as objects `[{"name": "Email #1", "address": "email@example.com"}]`. The conversion is automatic.

## No Delete Actions for Contacts/Emails

Use `proxy_request` with `DELETE` method to delete contacts (`/me/contacts/{id}`) or emails (`/me/messages/{id}`). Moving to the "Deleted Items" folder is an alternative for emails.

## Download Attachment Requires `stash_id`

Always include `stash_id: "NEW"` when calling `download-attachment`. Files land in `/workdir/tmp/integrations-results/` (scratch — hidden from the user's Files page). If the user asked for the attachment as a deliverable, `cp` it to `/workdir/outputs/`.

## Business/Organization Accounts

### Shared Folder Access

The `find-shared-folder-email` action allows accessing other users' mailboxes in the organization:

- Use `configure_props` for `userId` to get a list of organization members
- Use `configure_props` for `sharedFolderId` with the selected `userId` to get their folders
- **Important:** Accessing another user's folders requires delegation rights. If you don't have access, `configure_props` returns an empty array for `sharedFolderId`.

### Organization User Lookup

The `userId` prop in `find-shared-folder-email` returns all users in the tenant via `configure_props`. This is useful for identifying shared mailboxes or other users to query (if delegation is configured).

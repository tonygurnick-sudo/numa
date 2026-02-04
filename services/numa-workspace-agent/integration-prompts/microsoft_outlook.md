# Microsoft Outlook Integration Tips

## Establishing Context
Before performing Outlook operations, establish context:
- Use `list-folders` to get folder IDs (`Inbox`, `Archive`, `Deleted Items`, etc.) — needed for move operations
- Use `list-labels` if applicable to see available categories — needed for `add-label` operations (`configure_props` returns empty for labels)

## Search vs Filter
The `find-email` action supports both `search` and `filter` params, but they **cannot be used together**. Additionally, combining `filter` with `orderBy` causes `InefficientFilter` errors. Use `search` for keyword lookups (supports `subject:`, `from:`, `to:` prefixes), or `filter` alone for OData queries like `contains(subject, 'keyword')`.

## Attachments Require Two-Step Lookup
The `find-email` response includes `hasAttachments: true/false` but **NOT** the `attachments[]` array. To download attachments:
1. Get the `messageId` from `find-email` results
2. Call `configure_props` for `attachmentId` with the `messageId` to get attachment IDs and filenames
3. Call `download-attachment` with both `messageId` and `attachmentId`

## Reply Uses `comment`, Not `content`
The `reply-to-email` action uses `comment` for the reply body, while `send-email` uses `content`. This is an easy mistake to make.

## Labels Need `displayName` from `list-labels`
The `configure_props` for the `label` prop returns empty. Instead, call `list-labels` to get available categories, then use the `displayName` value (e.g., `"Red category"`) in `add-label-to-email`.

## File Attachments
For `send-email` and `reply-to-email`, pass workspace paths directly in the `files` array (e.g., `["/workdir/uploads/report.pdf"]`). The system converts them to presigned URLs automatically.

## Message IDs Change After Move
When you move an email with `move-email-to-folder`, the returned message has a **new** `id`. The old ID becomes invalid.

## Email Addresses in Contacts
The `emailAddresses` prop accepts a simple string array `["email@example.com"]`, but the API stores it as objects `[{"name": "Email #1", "address": "email@example.com"}]`. The conversion is automatic.

## No Delete Actions for Contacts/Emails
Use `proxy_request` with `DELETE` method to delete contacts (`/me/contacts/{id}`) or emails (`/me/messages/{id}`). Moving to the "Deleted Items" folder is an alternative for emails.

## Download Attachment Requires `stash_id`
Always include `stash_id: "NEW"` when calling `download-attachment`. Files are saved to `/workdir/session/integrations-results/`.

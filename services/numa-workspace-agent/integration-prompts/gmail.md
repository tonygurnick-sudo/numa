# Gmail Integration Tips

## Searching for Emails with Attachments
Before searching for emails with attachments, understand that attachment metadata (`attachmentId`) requires specific settings:
- Set `metadataOnly=false` — otherwise no `payload`/`parts` are returned
- Set `withTextPayload=false` — otherwise the `parts[]` structure is flattened to a string and `attachmentId`s are lost

## Discovering Attachments
Attachments appear in nested `payload.parts[].body.attachmentId`. The structure can be deeply nested (e.g., `parts[0].parts[1].body.attachmentId`). Look for parts where `filename` is non-empty and `body.attachmentId` exists.

## Downloading Attachments
Requires both `messageId` (the email's hex ID) and `attachmentId` from the payload. Always include `stash_id="NEW"` in the `run_action` call:
```json
{
  "gmail": {"authProvisionId": "auto"},
  "messageId": "19c2129741a92183",
  "attachmentId": "ANGjdJ_PP9uiRstD...",
  "filename": "document.pdf"
}
```

## Sending Emails with Attachments
The `attachmentFilenames` and `attachmentUrlsOrPaths` must be parallel arrays. Workspace paths (`/workdir/...`) are automatically converted to presigned URLs and work correctly:
```json
{
  "gmail": {"authProvisionId": "auto"},
  "to": ["recipient@example.com"],
  "subject": "Report attached",
  "body": "Please see attached.",
  "attachmentFilenames": ["report.pdf"],
  "attachmentUrlsOrPaths": ["/workdir/session/report.pdf"]
}
```
Public URLs also work: `"attachmentUrlsOrPaths": ["https://example.com/files/report.pdf"]`

## HTML Emails
Set `bodyType="html"` when your content includes links, lists, bold/italics, or any HTML formatting. Default is plaintext.

## Threading / Replies
Use `inReplyTo` with the Gmail message ID (hex string like `19c216feb2f7b960`) to keep replies in the same thread. The response will show matching `threadId` confirming proper threading.

## Search Query Syntax
Uses Gmail's standard search operators in the `q` parameter:
- `has:attachment` — emails with attachments
- `from:alice@example.com` — from specific sender
- `newer_than:7d` — within last 7 days
- `subject:"quarterly report"` — subject contains phrase
- Combine with spaces: `from:alice has:attachment newer_than:30d`

## Labels
Use `configure_props` on the `labels` prop to get available label IDs. Custom labels have IDs like `Label_1`, while system labels use names like `INBOX`, `SENT`, `UNREAD`.

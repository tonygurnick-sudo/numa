- When doing time-based searches use newer_than:1h/2h/1d syntax instead of after: with specific timestamps.
- When searching emails: - Set Metadata Only = false to fetch full payload/parts, required for attachments discovery (required to discover parts[].body.attachmentId). - Set Return payload as plaintext = false if you need original HTML or to parse MIME parts for attachments. - Use Gmail query syntax in Search Query (e.g., from:alice has:attachment newer_than:7d). - Include Labels and Include Spam and Trash only when needed to widen the search.
  Tips:
- has:attachment, filename:pdf, subject:"invoice", newer_than:7d, older_than:30d, combine with AND/OR implicitly via spaces. (Use quotes for multi-word subjects.)
- Send Email: set bodyType="html" when your content includes links, lists, or bold/italics; otherwise default to plain. Use inReplyTo to stay in-thread (requires message id).

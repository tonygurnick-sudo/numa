Outlook Mail — Send Email
- Choose Content Type (text vs html)
- If replying in-thread, pass the original message id to a dedicated reply action (if available) or include In-Reply-To-style headers if surfaced.  ￼

Outlook Mail — Search / Get Message / Download Attachment
- Search with Graph query filters (sender, subject, date range).
- Get message with full payload to enumerate attachments[], capturing attachmentId (not just filename).
- Download attachment with both messageId and attachmentId. Also prefer temp file path over base64 bytes.

Outlook Contacts — List Contacts / Create Contact
- List Contacts: paginate; optional filter by email to narrow results. Capture {id, emailAddresses[], displayName}.
- Create Contact: set givenName, businessPhones, emailAddresses[], etc., per Graph’s contact object. Use this to seed address books for future sends.  ￼

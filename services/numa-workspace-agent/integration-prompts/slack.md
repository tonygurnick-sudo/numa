# Slack Integration Tips

## Default Parameters

Always override these unless the user specifies otherwise:

- `as_user: true` — Send as the authenticated user (schema defaults to `false`, which sends as a bot).
- `include_sent_via_pipedream_flag: false` — Remove the Pipedream footer (schema defaults to `true`).

## Key Gotchas

### File Uploads

File uploads work with `/workdir/` paths — the system auto-converts them to presigned URLs. A `shares: {}` response is normal; Slack populates it asynchronously after the API returns. The file will appear in the channel even though the response shows empty shares.

```json
{
  "conversation": "C1234567890",
  "content": "/workdir/uploads/report.pdf",
  "initialComment": "Message text here"
}
```

Use `configure_props` to resolve the `conversation` parameter (channel ID).

### Emoji Reactions

Emoji reaction names must be **without colons**: use `"icon_emoji": "thumbsup"` not `":thumbsup:"` (causes `invalid_name` error). In message text, emojis still use colons: `:rocket:`.

### Timestamp Parameter Names

Names vary by action — always check the schema:

- `update-message`, `delete-message`, `add-emoji-reaction` → use `timestamp`
- `reply-to-a-message`, threading → use `thread_ts`

### Block Kit

`blocks` must be a JSON string:

```json
{
  "passArrayOrConfigure": "array",
  "blocks": "[{\"type\":\"section\",\"text\":{\"type\":\"mrkdwn\",\"text\":\"Hello\"}}]"
}
```

### Channel and User Lookups

- `list-channels` returns **all** channels (archived, not joined) — use `configure_props` for the `conversation` param to get a filtered list of member channels only.
- `list-members-in-channel` returns user IDs only — use `find-user-by-email` or `list-users` to get full user details.

### Direct Messages

For `send-message-to-user-or-group`, use the `users` array: `"users": ["U036X8Z6728"]` — not a channel ID.

### Downloading File Attachments from Messages

Slack messages (from `find-message`, `list-replies`, etc.) may contain a `files` array with attached files. Each file object has:

- `url_private_download` — authenticated download URL
- `name` / `title` — filename
- `id` — unique file ID (e.g. `F0ACCBWBC83`)
- `mimetype` — file type

To download these files, use `proxy_request` with GET on the `url_private_download` URL. The proxy returns binary files as a JSON object with `{"binary": true, "base64_body": "..."}`. After getting the result, decode and save the file using bash:

```bash
python3 -c "
import json, base64, sys
data = json.load(open(sys.argv[1]))
result = data.get('result', data)
if result.get('binary') and result.get('base64_body'):
    with open(sys.argv[2], 'wb') as f:
        f.write(base64.b64decode(result['base64_body']))
    print(f'Saved {sys.argv[2]}')
else:
    print('Response is not binary')
" /path/to/proxy-result.json /workdir/outputs/integrations-results/filename.png
```

When multiple files share the same name (common with `image.png`), deduplicate by appending the file ID: `image_F0ACCBWBC83.png`.

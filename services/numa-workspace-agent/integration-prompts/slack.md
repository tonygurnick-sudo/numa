# Slack Integration Tips

All Slack calls go through the `numa integrations` CLI. Action keys below are
real (`numa integrations pipedream-actions slack` lists them). The auth prop is
always required — pass `"slack": {"authProvisionId": "auto"}` and the proxy
resolves the user's connected account.

## Default Parameters

Always override these unless the user specifies otherwise:

- `as_user: true` — Send as the authenticated user (schema defaults to `false`, which sends as a bot).
- `include_sent_via_pipedream_flag: false` — Remove the Pipedream footer (schema defaults to `true`).

## Common Recipes

### Find a user (one call)

`slack-find-user-by-email` resolves an email to a user — no listing/searching needed:

```bash
numa integrations pipedream-call slack slack-find-user-by-email \
  --props '{"slack":{"authProvisionId":"auto"},"email":"lily.coats@arcanum.ai"}' \
  -m "Looking up Lily on Slack"
```

Returns the user object including `id` (e.g. `U0AAK118PMW`) — use that ID to DM
them or to `@`-mention them in a message (`<@U0AAK118PMW>`).

### Resolve a channel by name → channel ID

`conversation` is a `remoteOptions` prop, so resolve it with `pipedream-props-options`.
This returns **every** channel the connected account can see (the proxy paginates
through all of Pipedream's pages — important in large workspaces where there can
be hundreds of channels and DMs):

```bash
numa integrations pipedream-props-options slack slack-send-message-to-channel conversation \
  --slack '{"authProvisionId":"auto"}' -m "Finding the #sales channel"
```

Result shape: `{"options": [{"label": "Public channel: sales", "value": "C0ACQBE9X5L"}, ...]}`.
Labels are prefixed `Public channel:` / `Private channel:` / `Group messaging with: …`.
Match the channel name against the label and take its `value` (the channel ID).

If `options_truncated: true` is present, the list hit the pagination cap (very
large workspaces) — narrow by piping the result through a grep for the name.

If a channel genuinely isn't in the list, it either doesn't exist or it's a
**private** channel the connected account isn't a member of (Slack only returns
private channels to members). Say so rather than guessing a near-match.

### Send a message to a channel

```bash
numa integrations pipedream-call slack slack-send-message-to-channel \
  --props '{"slack":{"authProvisionId":"auto"},"conversation":"C0ACQBE9X5L","text":"Your message","as_user":true,"include_sent_via_pipedream_flag":false}' \
  -m "Posting to #sales"
```

### DM a user (or group)

Use `slack-send-message-to-user-or-group` with the `users` array of user IDs
(from `find-user-by-email`) — **not** a channel ID:

```bash
numa integrations pipedream-call slack slack-send-message-to-user-or-group \
  --props '{"slack":{"authProvisionId":"auto"},"users":["U0AAK118PMW"],"text":"Your message","as_user":true,"include_sent_via_pipedream_flag":false}' \
  -m "DMing Lily"
```

## Key Gotchas

### File Uploads

File uploads work with `/workdir/` paths — the system auto-converts them to presigned URLs. A `shares: {}` response is normal; Slack populates it asynchronously after the API returns. The file will appear in the channel even though the response shows empty shares.

```json
{
  "slack": { "authProvisionId": "auto" },
  "conversation": "C1234567890",
  "content": "/workdir/uploads/report.pdf",
  "initialComment": "Message text here"
}
```

Resolve the `conversation` channel ID with `pipedream-props-options` (see "Resolve a channel by name" above).

### Channel and User Lookups

- To find a channel, **resolve it by name via `pipedream-props-options`** (see the recipe above) — that's the paginated, member-aware list. Do not assume a channel is missing from a single `slack-list-channels` page; the picker is the reliable source.
- `slack-list-members-in-channel` returns user IDs only — use `slack-find-user-by-email` or `slack-list-users` to get full user details.

**Multiple files in ONE message:** the stock `slack-upload-file` posts a separate message per file. To attach several files to a single message, use the custom action **`slack-upload-files`** — pass `fileUrls` (array of `/workdir/` paths or URLs), `filenames` (array, same order — drives how each renders), `initialComment` (the message text), and optionally `threadTs`. All files land in one message via Slack's native `files.completeUploadExternal`.

### Emoji Reactions

Emoji reaction names must be **without colons**: use `"icon_emoji": "thumbsup"` not `":thumbsup:"` (causes `invalid_name` error). In message text, emojis still use colons: `:rocket:`.

### Timestamp Parameter Names

Names vary by action — always check the schema (`numa integrations pipedream-props slack <action>`):

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

### Downloading File Attachments from Messages

Slack messages (from `find-message`, `list-replies`, etc.) may contain a `files` array with attached files. Each file object has:

- `url_private_download` — authenticated download URL
- `name` / `title` — filename
- `id` — unique file ID (e.g. `F0ACCBWBC83`)
- `mimetype` — file type

To download these files, use `proxy_request` with GET on the `url_private_download` URL. The proxy returns binary files as a JSON object with `{"binary": true, "base64_body": "..."}`. After getting the result, decode and save the file using bash. Default to `/workdir/tmp/integrations-results/` (scratch — hidden from the user's Files page); promote to `/workdir/outputs/` only if the user asked for the file as a deliverable:

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
" /path/to/proxy-result.json /workdir/tmp/integrations-results/filename.png
```

When multiple files share the same name (common with `image.png`), deduplicate by appending the file ID: `image_F0ACCBWBC83.png`.

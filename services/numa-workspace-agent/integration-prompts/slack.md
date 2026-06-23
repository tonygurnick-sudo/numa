# Slack Integration Tips

All Slack calls go through the `numa integrations` CLI. Action keys below are
real (`numa integrations pipedream-actions slack` lists them). The auth prop is
always required — pass `"slack": {"authProvisionId": "auto"}` and the proxy
resolves the user's connected account.

## Default Parameters

Always override these unless the user specifies otherwise:

- `as_user: true` — Intended to send as the authenticated user (schema defaults to `false`, which sends as a bot). **Caveat:** depending on the workspace's bot-profile config, messages may still _display_ the Pipedream bot identity even with this set — it's the right flag to send, but don't promise the user it'll show as them.
- `include_sent_via_pipedream_flag: false` — Remove the Pipedream footer (schema defaults to `true`).

## Common Recipes

### Identify the connected account (start here)

`slack-get-current-user` confirms which account is active and returns the user's ID, team, and scopes:

```bash
numa integrations pipedream-call slack slack-get-current-user \
  --props '{"slack":{"authProvisionId":"auto"}}' \
  -m "Get connected Slack user identity"
```

Returns `ret.authContext` (`{team, user, team_id, user_id, response_metadata.scopes}`). The user's own Slack ID is at `ret.authContext.user_id` — handy for self-DMs.

### Find a user by email (one call)

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
through all of Pipedream's pages — important in large workspaces with hundreds of
channels). Prefer this over `slack-list-channels`, which caps at one page (~200).

```bash
numa integrations pipedream-props-options slack slack-send-message-to-channel conversation \
  --configured '{"slack":{"authProvisionId":"auto"}}' -m "Finding the #sales channel"
```

Result shape: `{"options": [{"label": "Public channel: sales", "value": "C0ACQBE9X5L"}, ...]}`.
Labels are prefixed `Public channel:` / `Private channel:` / `Group messaging with: …`.
Match the channel name against the label and take its `value` (the channel ID).

If `options_truncated: true` is present, the list hit the pagination cap (very
large workspaces) — narrow by grepping the labels for the name.

If a channel genuinely isn't in the list, it either doesn't exist or it's a
**private** channel the connected account isn't a member of (Slack only returns
private channels to members). Say so rather than guessing a near-match.

### Send a message to a channel

The connected Pipedream app **must be a member of the channel** or the call returns
`not_in_channel` (HTTP 200 with a Slack-level error). For private channels the app
must be explicitly invited first.

```bash
numa integrations pipedream-call slack slack-send-message-to-channel \
  --props '{"slack":{"authProvisionId":"auto"},"conversation":"C0ACQBE9X5L","text":"Your message","as_user":true,"include_sent_via_pipedream_flag":false}' \
  -m "Posting to #sales"
```

### DM a user (or self-DM)

Use `slack-send-message-to-user-or-group` with the `users` array of user IDs
(from `find-user-by-email` or `get-current-user`) — **not** a channel ID:

```bash
numa integrations pipedream-call slack slack-send-message-to-user-or-group \
  --props '{"slack":{"authProvisionId":"auto"},"users":["U0AAK118PMW"],"text":"Your message","as_user":true,"include_sent_via_pipedream_flag":false}' \
  -m "DMing Lily"
```

Self-DM (your own user ID) always works and is the safe target when you need to test a send without disturbing anyone.

### Reply in a thread

`slack-reply-to-a-message` uses `thread_ts` (not `timestamp`) for the parent message:

```bash
numa integrations pipedream-call slack slack-reply-to-a-message \
  --props '{"slack":{"authProvisionId":"auto"},"conversation":"C0ACQBE9X5L","text":"Reply text","thread_ts":"1403051575.000407","as_user":true,"include_sent_via_pipedream_flag":false}' \
  -m "Replying in thread"
```

### Block Kit message

`blocks` must be a JSON **string**, and `passArrayOrConfigure` must be `"array"`:

```bash
numa integrations pipedream-call slack slack-send-block-kit-message \
  --props '{"slack":{"authProvisionId":"auto"},"conversation":"C0ACQBE9X5L","text":"Fallback text","as_user":true,"include_sent_via_pipedream_flag":false,"passArrayOrConfigure":"array","blocks":"[{\"type\":\"section\",\"text\":{\"type\":\"mrkdwn\",\"text\":\"Hello\"}}]"}' \
  -m "Send Block Kit message"
```

The same `passArrayOrConfigure: "array"` + `blocks` pattern applies to `slack-send-message-advanced`.

## Reading Data (result shapes — these vary, so they're worth knowing)

- **`slack-list-messages`** (`conversation`, `pageSize`, `numPages`) → `ret.messages` — array of message objects (`ts`, `text`, `user`, `reactions`, optional `files`).
- **`slack-find-message`** (`query`, `maxResults`) → `ret` is a **flat array of message objects** — NOT `{messages: {matches: []}}`. Each item carries `ts`, `text`, `channel` (an object with `id` + `name`), and optional `files`.
- **`slack-list-replies`** (`conversation`, `timestamp`, `pageSize`) → `ret.messages`, root message first. Uses `timestamp` (not `thread_ts`) for the parent.
- **`slack-list-members-in-channel`** (`conversation`, `returnUsernames`, `pageSize`) → `ret` is a flat list. `returnUsernames: true` → `[{id, username}]`; `false` (default) → `["U...", ...]` (plain IDs). (Externally-shared channels may return `{id}` only.)
- **`slack-list-users`** (`pageSize`, `numPages`) → `ret` is `{members: [...]}` (a dict — unlike `list-members-in-channel`, which is flat).
- **`slack-list-emojis`** → shape depends on params: default → `ret` is `string[]` (names only); with `includeEmojiImage: true` + `includeCategories: true` → `ret` is `{emojis: [{name, value}], categories: [...]}`. Branch on what you passed.

For bulk / fully-paginated pulls, call the API directly and follow the cursor:

```bash
numa integrations request slack GET "https://slack.com/api/users.list?limit=200" \
  -m "Paginate workspace users"
```

Response carries `response_metadata.next_cursor` — follow with `?cursor=<next_cursor>`.

## File Operations

### Upload a single file

```bash
numa integrations pipedream-call slack slack-upload-file \
  --props '{"slack":{"authProvisionId":"auto"},"conversation":"C0ACQBE9X5L","content":"/workdir/uploads/report.pdf","initialComment":"Here is the report"}' \
  -m "Upload report.pdf to #sales"
```

`content` accepts `/workdir/` paths (auto-converted to presigned URLs). A `shares: {}`
response is normal — Slack populates it asynchronously; the file still appears in the
channel. The file object is at `ret.files[0]` (`id`, `name`, `url_private_download`).

### Upload multiple files in ONE message

The stock `slack-upload-file` posts a separate message per file. To attach several
files to a single message, use **`slack-upload-files`**:

```bash
numa integrations pipedream-call slack slack-upload-files \
  --props '{"slack":{"authProvisionId":"auto"},"conversation":"C0ACQBE9X5L","fileUrls":["/workdir/uploads/file1.pdf","/workdir/uploads/file2.png"],"filenames":["report.pdf","chart.png"],"initialComment":"Two attachments"}' \
  -m "Upload two files in one message"
```

- `conversation` takes a raw channel ID here (pass it directly, not via `remoteOptions`).
- `fileUrls`: array of `/workdir/` paths or public URLs.
- `filenames`: same order — drives Slack's type detection and how each renders.
- **Known flaky:** the first attempt occasionally returns `execution_failed` with an empty `ret`. Retry once immediately — it succeeds.

### Download a file from a message

Message objects (from `find-message`, `list-replies`, `list-files`, etc.) carry a `files`
array; each file has `url_private_download`, `name`, `id`, `mimetype`. GET the URL via
`numa integrations request` — the binary is delivered into the workspace automatically:

```bash
numa integrations request slack GET "https://files.slack.com/files-pri/..." \
  -m "Download Slack attachment"
```

The file lands under `/workdir/tmp/integrations-results/` keeping its **real name**
(reported in the result's `downloaded_files`). If the user asked for it as a
deliverable, `cp` it to `/workdir/outputs/`. When several files share the same name
(common with `image.png`), append the file ID to disambiguate before they overwrite
each other: `image_F0ACCBWBC83.png`.

### File info / delete

`slack-get-file` and `slack-delete-file` both require **`conversation` as well as `file`** (the file ID), even though Slack's underlying API only needs the file ID — pass any channel the connected user can read:

```bash
numa integrations pipedream-call slack slack-get-file \
  --props '{"slack":{"authProvisionId":"auto"},"conversation":"C0ACQBE9X5L","file":"F0ACCBWBC83"}' \
  -m "Get file info"
```

## Update / Delete Messages

Both use `timestamp` for the message ts; only messages the authenticated user sent can be deleted:

```bash
numa integrations pipedream-call slack slack-update-message \
  --props '{"slack":{"authProvisionId":"auto"},"conversation":"C0ACQBE9X5L","timestamp":"1403051575.000407","text":"Updated text","as_user":true}' \
  -m "Update message"

numa integrations pipedream-call slack slack-delete-message \
  --props '{"slack":{"authProvisionId":"auto"},"conversation":"C0ACQBE9X5L","timestamp":"1403051575.000407","as_user":true}' \
  -m "Delete message"
```

## Reactions and Status

```bash
numa integrations pipedream-call slack slack-add-emoji-reaction \
  --props '{"slack":{"authProvisionId":"auto"},"conversation":"C0ACQBE9X5L","timestamp":"1403051575.000407","icon_emoji":"thumbsup"}' \
  -m "React with thumbsup"
```

- **Emoji names go without colons:** `"thumbsup"`, not `":thumbsup:"` (colons cause `invalid_name`). In message _text_, emojis still use colons: `:rocket:`.
- The `icon_emoji` / `statusEmoji` props are `remoteOptions` — you can resolve the full list (including custom emoji) via `pipedream-props-options`, but passing the name directly is simpler and works fine.
- Set status with `slack-set-status` (`statusText`, `statusEmoji` without colons, `statusExpiration` as ISO 8601). Clear it by passing empty strings for `statusText` and `statusEmoji`.

## Timestamp Parameter Names

Names vary by action — check the schema if unsure:

| Action                                                                   | Param for the message ts |
| ------------------------------------------------------------------------ | ------------------------ |
| `update-message`, `delete-message`, `add-emoji-reaction`, `list-replies` | `timestamp`              |
| `reply-to-a-message` (threading)                                         | `thread_ts`              |

## Channel Management

```bash
numa integrations pipedream-call slack slack-create-channel \
  --props '{"slack":{"authProvisionId":"auto"},"channelName":"new-channel","isPrivate":false}' \
  -m "Create #new-channel"
```

There is **no `delete-channel` action** — archive via a direct request instead:

```bash
numa integrations request slack POST "https://slack.com/api/conversations.archive" \
  --body '{"channel":"C0ACQBE9X5L"}' -m "Archive channel"
```

## Direct API Requests

For anything not covered by an action (bulk paginated pulls, archiving, `conversations.history`, etc.), use `numa integrations request slack <METHOD> <url>` — no extra headers needed; the proxy injects auth. Slack returns `{ok: true, ...}` with errors as `ok: false` even on HTTP 200, so check `ok`.

## Notes on `slack-send-message` (the generic sender)

If you use the generic `slack-send-message` instead of the `-to-channel` / `-to-user-or-group` variants, resolve `channelType` first — its enum values are `Channels` (public/private channels), `mpim` (group), and `im` (DM, lowercase). The `conversation` options are filtered by the `channelType` you set.

## Not Safely Auto-Testable / Restricted

These touch real people or need admin rights — only run when the user explicitly asks:
`slack-invite-user-to-channel`, `slack-kick-user`, `slack-update-group-members`,
`slack-verify-slack-signature` (needs a signing secret), and the admin-restricted
`slack-set-channel-topic` / `slack-set-channel-description` / `slack-archive-channel` /
`slack-approve-workflow` / `slack-update-profile`.

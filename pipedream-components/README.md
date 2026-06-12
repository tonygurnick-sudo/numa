# Custom Pipedream Connect Components

Custom (privately published) Pipedream components that fill gaps in the public
registry — actions an integration's upstream Pipedream app doesn't provide (e.g.
Pipedrive has no file-upload action). Published to **Arcanum's Pipedream Connect
project** with `pd publish`; they then appear in the same Connect list/run APIs the
Numa integration stack already uses, keyed with a `~/` prefix
(`pipedrive-add-file` → `~/pipedrive-add-file`).

Docs: [Connect custom tools](https://pipedream.com/docs/connect/components/custom-tools)
· [Component API](https://pipedream.com/docs/components/api)

**Requires a Pipedream Business plan or higher** (failure mode on publish/run:
"Private Component API Not Enabled").

## Layout

Mirrors [PipedreamHQ/pipedream](https://github.com/PipedreamHQ/pipedream/tree/master/components)
(`{app}/actions/{action-name}/{action-name}.mjs`) so any component here can be
contributed upstream as a drop-in PR later.

```
pipedream-components/
└── pipedrive/
    └── actions/
        └── add-file/
            └── add-file.mjs    # multipart file upload → POST {api_domain}/api/v1/files
```

## Authoring rules

1. **Self-contained single file.** `pd publish` takes one file — no relative imports
   (inline the `{ type: "app", app: "<slug>" }` prop instead of importing an app
   file). npm imports are fine; Pipedream auto-installs them.
2. **Name the auth prop exactly the app slug** (e.g. `pipedrive`, not `pipedriveApp`).
   Numa's proxy resolves `authProvisionId: "auto"` for `~/` keys via the prop-name
   fallback in `_inject_auth_provision_id` (`lambdas/python/pipedream-proxy/
pipedream_operations.py`) — the action-key prefix match misses on `~/` keys, and
   the schema lookup (`_get_action_schema_cached`) can't resolve `~/` keys either, so
   the prop name is the only signal left. Wrong prop name = "No connected account
   found".
3. **Key without the `~/` prefix** in source (`key: "pipedrive-add-file"`). The prefix
   is added by Pipedream in the Connect APIs.
4. **Bump `version` on every publish.**
5. **Write the description for the agent.** The first ~200 chars land in the
   workspace `_index.json` that the chat agent reads — lead with what it does and
   what it attaches to, not implementation detail.
6. File-input props take a **URL string**. In chat, the agent passes a `/workdir/...`
   path and workspace-chat-tools rewrites it to a short-lived redirect/presigned URL
   before the proxy call — same mechanism as Gmail/Outlook/Jira attachments.

## Publish

```bash
# one-time: install pd CLI (https://pipedream.com/docs/cli/install) and log in
# as the workspace that owns the Connect project
pd login

# stage to the development environment first (also the cheap plan-gate check)
pd publish pipedrive/actions/add-file/add-file.mjs --connect-environment development

# then production (NOTE: visible to ALL Numa clients with the app connected — the
# Connect project is shared fleet-wide, this is not a per-client rollout)
pd publish pipedrive/actions/add-file/add-file.mjs --connect-environment production
```

Components published to `development` are only visible in the development
environment and vice versa. Numa runs `environment=production`
(`pipedream/credentials-prod` secret), so end-to-end testing through Numa chat
requires the production publish.

## Post-publish (Numa side — no deploys needed)

1. Refresh the schema cache (otherwise it updates on the weekly EventBridge run):
   ```bash
   AWS_PROFILE=pipedream-proxy aws lambda invoke --function-name pipedream-schema-refresh \
     --region us-east-1 /tmp/schema-refresh.json && cat /tmp/schema-refresh.json
   ```
2. Proxy in-memory caches (action schemas / MCP tool lists) expire within 10 min.
3. Workspace agents write `/workdir/tools/integrations/{slug}/_index.json` at
   **conversation start** — existing conversations keep the old index; new
   conversations see the new action. Keys with `/` are sanitized in filenames
   (`~_pipedrive-add-file.json`) but the `key` field stays `~/pipedrive-add-file`.

## Verify

```bash
# appears in the app-filtered listing?
GET /v1/connect/{project_id}/components?app=pipedrive&component_type=action
#   → expect "~/pipedrive-add-file" alongside the 26 public actions

# runs? (same endpoint the proxy uses)
POST /v1/connect/{project_id}/actions/run
  {"id": "~/pipedrive-add-file", "external_user_id": "...", "configured_props": {...}}
```

Then e2e in nd-labs chat with a connected test account before telling a customer.
No upstream account? Pipedrive offers a free
[developer sandbox](https://developers.pipedrive.com/) — connect it through the
Numa integrations page like any user account.

## Published components

| Component            | Key (Connect)          | Version | Environments | Published | Notes                                                                                            |
| -------------------- | ---------------------- | ------- | ------------ | --------- | ------------------------------------------------------------------------------------------------ |
| Pipedrive — Add File | `~/pipedrive-add-file` | 0.0.1   | — (pending)  | —         | Fills missing upload action; built for TAB NZ (see `dev-notes/tasks/tab-pipedrive-file-upload/`) |

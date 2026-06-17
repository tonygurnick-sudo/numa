---
name: connect
description: Find files beyond the workspace — check the user's Numa Files (Personal / Company Files / shared folders) via numa files commands, and connected drives (Google Drive, Gmail, OneDrive, Dropbox, Synergy 12d) via the numa integrations file commands. Use when a user asks about files not in /workdir/
---

# Connect Skill

Browse and download files from external connectors with the `numa integrations`
file commands (`list-files` / `search-files` / `download-file` / `file-info`),
and make authenticated HTTP API calls with `numa integrations request`. For Numa
Files (Personal / Company Files / shared folders) use `numa files` commands —
see the `numa-files-search` skill for the full reference.

## When to Use

Use these tools when:

- A user asks for a document, template, or file that isn't in `/workdir/`
- A user references shared company files, their personal files, or files on a connected drive
- A user wants to browse, search, or download from an external source

**Strategy — check in this order:**

1. **Numa Files first** (always connected, fast) — use `numa files search` (see the `numa-files-search` skill)
2. **Connected drives** — use the `numa integrations` file commands, only if Numa Files doesn't have what you need
3. **Skip disconnected connectors** — don't waste tool calls; tell the user where to connect instead

Always check what external connectors are available via `numa integrations list` first.

---

## Browsing connector files (list-files / search-files / download-file / file-info)

This is the way to browse, search, and pull files from a connector. It works
for **Synergy 12d** and the **OAuth cloud-storage** providers (Google Drive,
Gmail, OneDrive, Dropbox).

| Command                                                                   | Purpose                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| `numa integrations list`                                                  | Check which connectors are available and connected     |
| `numa integrations list-files <slug> [--folder-id <id>] [--query <text>]` | Browse folders/files (omit `--folder-id` for the root) |
| `numa integrations search-files <slug> <query>`                           | Search files/jobs by name                              |
| `numa integrations download-file <slug> <file-id>`                        | Download a file into the workspace                     |
| `numa integrations file-info <slug> <file-id>`                            | Detailed file metadata (OAuth providers only)          |

File-browsing connector slugs: `synergy`, `googledrive`, `gmail`, `onedrive`, `dropbox`.

```
Bash("numa integrations list --json -m 'Check connected integrations'")
Bash("numa integrations list-files synergy -m 'List Synergy jobs'")
Bash("numa integrations list-files synergy --folder-id job:100_1 -m 'Open Synergy job 100_1'")
Bash("numa integrations search-files googledrive 'quarterly report' -m 'Search Google Drive for quarterly report'")
Bash("numa integrations download-file synergy <file-id> -m 'Download the Synergy file'")
```

Downloaded files land in `/workdir/uploads/connect-{connector}/`. Max file size: 50MB.

### Synergy Navigation (folder_id prefixes)

Synergy models jobs as folders. Walk the tree with `list-files`:

| Level  | folder_id            | What it returns        |
| ------ | -------------------- | ---------------------- |
| Root   | _(omit)_             | Top-level jobs         |
| Job    | `job:{job_id}`       | Folders within the job |
| Folder | `folder:{folder_id}` | Subfolders + files     |

> **Synergy is a file-store connector — use these file commands, not
> `request`.** Synergy does not support `numa integrations request`; browse and
> download its jobs/folders/files with `list-files` / `search-files` /
> `download-file`.

### Connector Types

| Connector ID  | Auth Type | File browsing | Description                                                       |
| ------------- | --------- | ------------- | ----------------------------------------------------------------- |
| `googledrive` | OAuth     | yes           | Google Drive cloud storage                                        |
| `gmail`       | OAuth     | yes           | Gmail (attachments / messages)                                    |
| `onedrive`    | OAuth     | yes           | Microsoft OneDrive                                                |
| `dropbox`     | OAuth     | yes           | Dropbox cloud storage                                             |
| `synergy`     | PAT       | yes           | Synergy 12d document management (jobs/folders/files)              |
| _other_       | OAuth/PAT | no            | API-only connectors (Fergus, simPRO, NetSuite, …) — use `request` |

---

## Authenticated HTTP (request)

Use `numa integrations request <slug> <METHOD> <url>` for ad-hoc API calls to
connectors that expose an HTTP API — **OAuth providers** (Google Drive, Gmail,
…) and **API/PAT connectors** (Fergus, simPRO, Workbench, MYOB Acumatica,
NetSuite, …). The backend injects the right `Authorization` header from the
user's stored credential; you don't handle auth yourself.

> **The per-connector reference docs are the SOURCE OF TRUTH for every
> `request` call.** They live at `/workdir/api-docs/<slug>/` (synced for enabled
> connectors) — or run `numa integrations docs <slug>` to get the paths. **Read
> `01-llm-api-rules.md` first**, then the companion file for your task. Derive
> every endpoint, path, version segment, header, and parameter from the docs —
> never guess a URL or invent a path prefix (e.g. a `/v1/`) from memory. If the
> docs and your assumptions disagree, the docs win.

> `request` is for HTTP APIs, **not** Synergy. For Synergy files use the
> `list-files` / `search-files` / `download-file` commands above.

**Pass a path, not a full URL, for connectors with an admin-configured
instance URL.** The backend expands `/api/v1/...` to `{instance_url}/api/v1/...`
automatically for Workbench, MYOB Acumatica, and any other customer-hosted HTTP
API — you never have to discover or store the instance URL. Relative paths (a
leading `/`) are allowed for `numa integrations request`; you don't need a
fully-qualified URL.

**NetSuite supports two surfaces depending on the integration record's scope:**

- **REST scope** (`rest_webservices` / `restlets` / `suite_analytics`): use the
  `request` command. Pass a relative path like `/services/rest/record/v1/customer?limit=1`
  or `/services/rest/query/v1/suiteql` — the backend prepends
  `https://<accountId>.suitetalk.api.netsuite.com` from the saved Account ID.
  See `ext-api-doc/netsuite/01-llm-api-rest-rules.md`.
- **MCP scope** (`mcp`): use the `mcp_call` operation (see MCP section below). MCP and
  REST scopes are mutually exclusive on one integration record — a given
  NetSuite connection supports one or the other, not both.

If a NetSuite REST call returns `INVALID_LOGIN_ATTEMPT — Insufficient scope`,
the integration record is mcp-scoped — switch to `mcp_call`. If `mcp_call`
returns the same error, the integration record is REST-scoped — switch to
`request`.

```
# Fully-qualified URL (OAuth providers — their API hosts are fixed):
Bash("numa integrations request googledrive GET 'https://www.googleapis.com/drive/v3/about?fields=user' -m 'Get Google Drive user info'")

# Relative path (API/PAT connectors with customer-hosted APIs):
Bash("numa integrations request workbench GET '/api/v1/jobs' -m 'List Workbench jobs'")

# Absolute URL for an API connector also works if you need it:
Bash("numa integrations request fergus GET 'https://api.fergus.com/api/v2/customers' -m 'List Fergus customers'")
```

If you pass a relative path for a connector whose admin hasn't configured
an `instance_url`, you'll get a clear error naming the missing config. The
`data-bucket` (internal S3) and `synergy` (file-store — use the file commands)
reject the `request` operation.

### MCP Calls (mcp_call operation)

For connectors that expose a Model Context Protocol (JSON-RPC 2.0) endpoint
rather than plain REST — today that's NetSuite via the AI Connector Service
SuiteApp. Pass `connector`, `method`, and `arguments`:

```
Bash("numa integrations request netsuite MCP --method ns_runCustomSuiteQL --arguments '{\"sqlQuery\":\"SELECT id, companyname FROM customer WHERE ROWNUM <= 10\",\"description\":\"List 10 customers\"}' -m 'Query NetSuite customers'")
```

Available NetSuite MCP methods: `ns_getRecordTypeMetadata`, `ns_getRecord`,
`ns_createRecord`_, `ns_updateRecord`_, `ns_runCustomSuiteQL`,
`ns_getSuiteQLMetadata`, `ns_listSavedSearches`, `ns_runSavedSearch`,
`ns_listAllReports`, `ns_runReport`, `ns_getSubsidiaries`.

Methods marked `*` write to NetSuite and require user approval. For create /
update, always call `ns_getRecordTypeMetadata` first to discover fields.
SuiteQL uses Oracle dialect (ROWNUM, not LIMIT; `||` for concat; `'T'`/`'F'`
for booleans).

### What to tell users when not connected

| Connector                                               | Where to connect                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| OAuth providers (googledrive, gmail, onedrive, dropbox) | Navigate to `/integrations` in the Numa UI (or deep-link `/integrations#<slug>` for that card)  |
| synergy                                                 | Navigate to `/integrations` in the Numa UI (or deep-link `/integrations#synergy` for that card) |

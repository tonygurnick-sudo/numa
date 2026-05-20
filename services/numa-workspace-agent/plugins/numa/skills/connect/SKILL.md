---
name: connect
description: Find files beyond the workspace — check the user's Numa Files (Personal / Company Files / shared folders) via numa_tool with name="numa_files", and connected drives (Google Drive, OneDrive, Dropbox, Synergy 12d) via the connectors tool. Use when a user asks about files not in /workdir/
---

# Connect Skill

Access files from external sources using the **connectors** MCP tool (OAuth cloud storage, Synergy 12d, generic HTTP). For Numa Files (Personal / Company Files / shared folders) use the **numa_files** operation in **numa_tool** — see the `numa-files-search` skill for the full reference.

## When to Use

Use these tools when:

- A user asks for a document, template, or file that isn't in `/workdir/`
- A user references shared company files, their personal files, or files on a connected drive
- A user wants to browse, search, or download from an external source

**Strategy — check in this order:**

1. **Numa Files first** (always connected, fast) — use `numa_tool` with `name="numa_files"` (see the `numa-files-search` skill)
2. **Connected drives** — use `connectors` tool, only if Numa Files doesn't have what you need
3. **Skip disconnected connectors** — don't waste tool calls; tell the user where to connect instead

Always call `connectors` with `name="status"` first to see what external connectors are available.

---

## External Connectors (connectors tool)

Use `connectors` with an operation name to access OAuth cloud storage, Synergy 12d, and authenticated HTTP APIs.

### Operations

| Operation       | Purpose                                            |
| --------------- | -------------------------------------------------- |
| `status`        | Check which connectors are available and connected |
| `list_files`    | Browse files and folders from a connector          |
| `search_files`  | Search for files across a connector                |
| `download_file` | Download a file to the workspace                   |
| `get_file_info` | Get detailed file metadata (OAuth providers only)  |
| `request`       | Make authenticated HTTP calls to any OAuth API     |

### Connector Types

| Connector ID  | Auth Type | Description                                          |
| ------------- | --------- | ---------------------------------------------------- |
| `googledrive` | OAuth     | Google Drive cloud storage                           |
| `onedrive`    | OAuth     | Microsoft OneDrive                                   |
| `dropbox`     | OAuth     | Dropbox cloud storage                                |
| `synergy`     | PAT       | Synergy 12d document management (jobs/folders/files) |
| _any custom_  | OAuth     | Custom OAuth connectors configured by the company    |

### Examples

```
connectors(name="status", params={})
connectors(name="list_files", params={connector: "googledrive"})
connectors(name="list_files", params={connector: "googledrive", folder_id: "abc123"})
connectors(name="search_files", params={connector: "googledrive", query: "quarterly report"})
connectors(name="download_file", params={connector: "googledrive", file_id: "abc123"})
connectors(name="get_file_info", params={connector: "googledrive", file_id: "abc123"})
```

Downloaded files land in `/workdir/uploads/connect-{connector}/`. Max file size: 50MB.

### Synergy Navigation (folder_id prefixes)

| Level  | folder_id            | What it returns        |
| ------ | -------------------- | ---------------------- |
| Root   | _(omit)_             | Top-level jobs         |
| Job    | `job:{job_id}`       | Folders within the job |
| Folder | `folder:{folder_id}` | Subfolders + files     |

### Authenticated HTTP (request operation)

Make ad-hoc API calls to any connected service — works for **both** OAuth
providers (Google Drive, Gmail, …) **and** PAT connectors (Synergy, Fergus,
simPRO, …). The backend injects `Authorization: Bearer {access_token}` using
whichever credential the user has stored; you don't handle auth yourself.

**Pass a path, not a full URL, for connectors with an admin-configured
instance URL.** The backend expands `/api/v1/...` to `{instance_url}/api/v1/...`
automatically for Synergy, Workbench, MYOB Acumatica, and any other
customer-hosted HTTP API. You never have to discover or store the instance URL.

**NetSuite supports two surfaces depending on the integration record's scope:**

- **REST scope** (`rest_webservices` / `restlets` / `suite_analytics`): use the
  `request` op. Pass a relative path like `/services/rest/record/v1/customer?limit=1`
  or `/services/rest/query/v1/suiteql` — the backend prepends
  `https://<accountId>.suitetalk.api.netsuite.com` from the saved Account ID.
  See `ext-api-doc/netsuite/01-llm-api-rest-rules.md`.
- **MCP scope** (`mcp`): use the `mcp_call` op (see MCP section below). MCP and
  REST scopes are mutually exclusive on one integration record — a given
  NetSuite connection supports one or the other, not both.

If a NetSuite REST call returns `INVALID_LOGIN_ATTEMPT — Insufficient scope`,
the integration record is mcp-scoped — switch to `mcp_call`. If `mcp_call`
returns the same error, the integration record is REST-scoped — switch to
`request`.

```
# Fully-qualified URL (OAuth providers — their API hosts are fixed):
connectors(name="request", params={
    connector: "googledrive",
    url: "https://www.googleapis.com/drive/v3/about?fields=user",
    description: "Get Google Drive user info"
})

# Relative path (PAT connectors with customer-hosted APIs):
connectors(name="request", params={
    connector: "synergy",
    url: "/api/v1/projects",
    description: "List Synergy projects"
})

# Absolute URL for a PAT connector also works if you need it:
connectors(name="request", params={
    connector: "fergus",
    url: "https://api.fergus.com/api/v2/customers",
    description: "List Fergus customers"
})
```

If you pass a relative path for a connector whose admin hasn't configured
an `instance_url`, you'll get a clear error naming the missing config. Only
the `data-bucket` (internal S3) rejects the request operation outright.

### MCP Calls (mcp_call operation)

For connectors that expose a Model Context Protocol (JSON-RPC 2.0) endpoint
rather than plain REST — today that's NetSuite via the AI Connector Service
SuiteApp. Pass `connector`, `method`, and `arguments`:

```
connectors(name="mcp_call", params={
    connector: "netsuite",
    method: "ns_runCustomSuiteQL",
    arguments: {
        sqlQuery: "SELECT id, companyname FROM customer WHERE ROWNUM <= 10",
        description: "List 10 customers"
    }
}, description: "Query NetSuite customers")
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

| Connector                                        | Where to connect                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| OAuth providers (googledrive, onedrive, dropbox) | Navigate to `/integrations` in the Numa UI (or deep-link `/integrations#<slug>` for that card)  |
| synergy                                          | Navigate to `/integrations` in the Numa UI (or deep-link `/integrations#synergy` for that card) |

---
name: connect
description: Find files beyond the workspace — check My Files / Company Files via numa_tool files, and connected drives (Google Drive, OneDrive, Dropbox, Synergy 12d) via the connectors tool. Use when a user asks about files not in /workdir/
---

# Connect Skill

Access files from external sources using the **connectors** MCP tool (OAuth cloud storage, Synergy 12d, generic HTTP) and the **files** operation in **numa_tool** (My Files / Company Files from the S3 data bucket).

## When to Use

Use these tools when:

- A user asks for a document, template, or file that isn't in `/workdir/`
- A user references shared company files, their personal files, or files on a connected drive
- A user wants to browse, search, or download from an external source

**Strategy — check in this order:**

1. **My Files / Company Files first** (always connected, fast) — use `numa_tool` with `name="files"`
2. **Connected drives** — use `connectors` tool, only if files doesn't have what you need
3. **Skip disconnected connectors** — don't waste tool calls; tell the user where to connect instead

Always call `connectors` with `name="status"` first to see what external connectors are available.

---

## My Files / Company Files (numa_tool → files)

Use `numa_tool` with `name="files"` to browse the S3 data bucket.

### List files

```
numa_tool(name="files", params={operation: "list"})                           # Root — shows My Files and Company Files
numa_tool(name="files", params={operation: "list", folder_id: "files:my"})    # My Files
numa_tool(name="files", params={operation: "list", folder_id: "files:company"})  # Company Files
numa_tool(name="files", params={operation: "list", folder_id: "files:my/Reports"})  # Subfolder
```

### Search files

```
numa_tool(name="files", params={operation: "search", query: "quarterly report"})
numa_tool(name="files", params={operation: "search", query: "budget", folder_id: "files:company"})
```

### Download files

```
numa_tool(name="files", params={operation: "download", file_id: "files/company/report.pdf"})
```

Files are saved to `/workdir/uploads/files/` and can then be read, analyzed, or processed.

### Folder ID Reference

| Level             | folder_id            | S3 prefix                        |
| ----------------- | -------------------- | -------------------------------- |
| Root              | _(omit)_             | Returns: My Files, Company Files |
| My files          | `files:my`           | `files/user/{user_sub}/`         |
| My subfolder      | `files:my/path`      | `files/user/{user_sub}/path/`    |
| Company files     | `files:company`      | `files/company/`                 |
| Company subfolder | `files:company/path` | `files/company/path/`            |

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
automatically for Synergy, Workbench, NetSuite, MYOB Acumatica, and any other
customer-hosted API. You never have to discover or store the instance URL.

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

### What to tell users when not connected

| Connector                                        | Where to connect                               |
| ------------------------------------------------ | ---------------------------------------------- |
| OAuth providers (googledrive, onedrive, dropbox) | Navigate to `/files?tab=remote` in the Numa UI |
| synergy                                          | Navigate to `/data-connectors` in the Numa UI  |

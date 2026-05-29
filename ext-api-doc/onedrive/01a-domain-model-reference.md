---
api_name: 'OneDrive (Microsoft Graph)'
api_slug: 'onedrive'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# OneDrive (Microsoft Graph) — Domain Model Reference

> Companion to `01-llm-api-rules.md`. Entity catalog, relationships and business rules.
>
> **The whole model is two entities:** a **`drive`** (a file container) and a **`driveItem`**
> (a file, folder, or other item). Everything you browse, search, or download is a `driveItem`.
> Item behavior is determined by **facets** — small objects on the item (`folder`, `file`,
> `remoteItem`, `deleted`) whose **presence** tells you what the item is.
>
> Confidence markers: `[CONFIRMED]` = verified against official docs AND the shipped provider that
> calls Graph in production · `[DOCUMENTED]` = in Microsoft Graph docs · `[INFERRED]` · `[UNKNOWN]`.

---

## Entity Catalog

### drive

**Resource path:** `/me/drive`, `/drives/{drive-id}`, `/users/{id}/drive`, `/sites/{id}/drive`
**Description:** A logical container of files — a user's OneDrive or a SharePoint document library.
The connector only ever uses the signed-in user's default drive: `/me/drive`.
**CRUD:** Read only (this connector).

| Field     | Type        | Writable | Description                                 |
| --------- | ----------- | -------- | ------------------------------------------- |
| id        | string      | no       | Drive identifier (opaque, e.g. `b!xyz`)     |
| driveType | string      | no       | `personal` / `business` / `documentLibrary` |
| owner     | identitySet | no       | Owning user/group                           |
| quota     | quota       | no       | `{ total, used, remaining, deleted }` bytes |
| root      | driveItem   | no       | The root folder driveItem                   |

> `driveType` matters: it decides the **hash algorithm** (`quickXorHash` for business/SP,
> `sha1Hash` for personal) and whether `cTag` is present. [DOCUMENTED]

---

### driveItem (the central entity)

**Resource path:** `/me/drive/items/{item-id}` (by id) OR `/me/drive/root:/path/to/file` (by path).
**Description:** A file, folder, or other item in a drive. Its **facets** define its behavior.
**CRUD:** Read (this connector). Create/update/delete exist in Graph but are out of scope under
`Files.Read.All`.

**Fields — the subset the connector selects, plus key extras:** [CONFIRMED for the selected set]

| Field                          | Type           | Writable | Description                                            | Example                       |
| ------------------------------ | -------------- | -------- | ------------------------------------------------------ | ----------------------------- |
| id                             | string         | no       | Unique item id within the drive (opaque)               | `01ABC...123`                 |
| name                           | string         | rw\*     | Filename + extension                                   | `Budget.xlsx`                 |
| size                           | Int64          | no       | Size in bytes (0 for folders)                          | `84213`                       |
| folder                         | folder facet   | no       | **Present ⇒ item is a folder**; has `childCount`       | `{ "childCount": 8 }`         |
| file                           | file facet     | no       | **Present ⇒ item is a file**; has `mimeType`, `hashes` | `{ "mimeType": "..." }`       |
| createdDateTime                | DateTimeOffset | no       | Creation timestamp (ISO 8601 UTC)                      | `2026-03-01T16:40:00Z`        |
| lastModifiedDateTime           | DateTimeOffset | no       | Last-modified timestamp                                | `2026-05-28T08:22:10Z`        |
| parentReference                | itemReference  | rw\*     | `{ driveId, id, path }` of parent                      | `{ "id": "01ROOT..." }`       |
| webUrl                         | string         | no       | Browser URL to view the item                           | `https://...sharepoint.com/…` |
| eTag                           | string         | no       | eTag for whole item (metadata + content)               | `"aRDQ...0"`                  |
| cTag                           | string         | no       | eTag for content only; **omitted for folders**         | `"aYzp...256"`                |
| file.hashes                    | hashes         | no       | `quickXorHash` (business) or `sha1Hash` (personal)     | `{ "quickXorHash": "..." }`   |
| `@microsoft.graph.downloadUrl` | string         | no       | Short-lived (~1 hr) preauth download URL; `$select` it | `https://...1drv.com/...`     |
| remoteItem                     | remoteItem     | no       | **Present ⇒ item lives in another drive** (shared)     | `{ "id": "...", ... }`        |
| deleted                        | deleted facet  | no       | **Present in delta ⇒ item was removed**                | `{}`                          |
| root                           | root facet     | no       | **Present ⇒ this is the drive root** (no parent)       | `{}`                          |

> \* `name`/`parentReference` are writable in Graph generally, but this connector is read-only —
> treat all fields as read-only.

**Relationships:**

| Related Entity       | Relationship                 | How Expressed             | Notes                                 |
| -------------------- | ---------------------------- | ------------------------- | ------------------------------------- |
| drive                | item belongs to drive        | `parentReference.driveId` | Every item lives in exactly one drive |
| driveItem (children) | folder → many items          | `/items/{id}/children`    | Only folder-facet items have children |
| driveItem (parent)   | item → one parent            | `parentReference.id`      | Root item has `root` facet, no parent |
| driveItem (shared)   | item → item in another drive | `remoteItem` facet        | Surfaced by `/me/drive/search`        |
| driveItemVersion     | item → many versions         | `/items/{id}/versions`    | Out of scope                          |
| permission           | item → many permissions      | `/items/{id}/permissions` | Out of scope (read-only browsing)     |

---

## Entity Relationship Diagram

```
┌──────────┐    1:N    ┌────────────────────────┐
│  drive   │──────────▶│ driveItem (root facet) │
└──────────┘           └────────────────────────┘
                                  │ 1:N  children (folder-facet items only)
                                  ▼
                       ┌────────────────────────────┐
                       │ driveItem (file OR folder)  │◀── parentReference.id (N:1 → parent)
                       └────────────────────────────┘
                                  │ remoteItem facet
                                  ▼
                       ┌────────────────────────────┐
                       │ driveItem in ANOTHER drive  │  (shared with the user)
                       └────────────────────────────┘
```

---

## State Machines

driveItems are **not** stateful workflow objects. The only lifecycle relevant here is
**live → deleted (recycle bin) → permanently deleted**, surfaced through the `deleted` facet in
**delta** responses. No state transitions are driven by this read-only connector. [DOCUMENTED]

```
[live item] ──delete──> [deleted facet appears in delta] ──purge──> [gone]
```

---

## Business Rules

### Type / facet rules

- **Facet presence defines type.** A folder is "an item with a `folder` facet"; a file is "an item
  with a `file` facet." There is **no `type` field** — never look for one. The provider branches on
  `"folder" in item`. [CONFIRMED]
- **`cTag` is omitted for folders.** Don't rely on it for directory items. [DOCUMENTED]
- **`root` facet ⇒ no parent.** The drive root has a `root` facet and no `parentReference.id`. [DOCUMENTED]
- **`remoteItem` facet ⇒ the item physically lives in another drive** (shared with the user). Its
  own `id` is local; the real item is `remoteItem.id` in `remoteItem.parentReference.driveId`. [DOCUMENTED]

### Download / hash rules

- **`@microsoft.graph.downloadUrl` is short-lived (~1 hr) and preauthenticated** — fetch per-download,
  never cache or store it. [DOCUMENTED]
- **`/content` returns a 302** to a `*.1drv.com` / SharePoint host. The token must **not** be forwarded
  to that redirect target — the provider uses `follow_redirects=False`, then re-requests `Location`
  with no `Authorization` header. [CONFIRMED]
- **Hash algorithm differs by account type:** `quickXorHash` for OneDrive for Business / SharePoint,
  `sha1Hash` for personal OneDrive. The provider prefers `sha1Hash`, falls back to `quickXorHash`. [CONFIRMED]

### Safety rules

- **Item IDs are opaque and must never be parsed.** The provider rejects ids containing `/`, `\`, or
  `..` (regex `[/\\\.]{2,}|[/\\]`) before interpolating them into URLs, to block path traversal. [CONFIRMED]
- **Size guard:** downloads over **100 MB** (`MAX_DOWNLOAD_SIZE`) are rejected, checked via
  `Content-Length` on both the 302 redirect and the final response. [CONFIRMED]

### Read-only / computed fields

- Everything is server-set for this connector. `id`, timestamps, `size`, `eTag`/`cTag`, and hashes
  are all read-only. [CONFIRMED]

---

## Field Format Reference

| Format    | Pattern                                | Example                                   | Notes                                     |
| --------- | -------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| DateTime  | ISO 8601 UTC `DateTimeOffset`          | `2026-05-28T08:22:10Z`                    | `createdDateTime`, `lastModifiedDateTime` |
| ID        | Opaque string (alphanumeric + `!`/`.`) | `01ABCDEF!123` / `D4648F06C91D9D3D!54927` | **Treat as opaque; never parse**          |
| Size      | Int64 (bytes)                          | `84213`                                   | `0` for folders                           |
| Path      | Colon-escaped relative path            | `/me/drive/root:/Reports/Q1:`             | `:` brackets the path segment             |
| eTag/cTag | Quoted opaque string                   | `"aRDQ...0"`                              | Use for `if-none-match` / `if-match`      |
| Hash      | Base64-ish opaque string               | `quickXorHash: "AbC123..."`               | Algorithm depends on `driveType`          |

---

## Enum Value Reference

| Entity      | Field     | Allowed Values                                                     | Default | Notes                                  |
| ----------- | --------- | ------------------------------------------------------------------ | ------- | -------------------------------------- |
| drive       | driveType | `personal`, `business`, `documentLibrary`                          | —       | Determines hash algo + `cTag` behavior |
| delta token | token     | `latest`, ISO timestamp (Business/SP only), or a prior delta token | —       | Controls change enumeration            |
| file.hashes | algorithm | `quickXorHash` (business/SP), `sha1Hash` (personal)                | —       | Provider prefers sha1, then quickXor   |

---

_Generated from the investigation questionnaire, Phase 3._

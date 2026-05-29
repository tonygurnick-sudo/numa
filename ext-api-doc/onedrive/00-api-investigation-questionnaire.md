---
api_name: 'OneDrive (Microsoft Graph)'
api_slug: 'onedrive'
vendor: 'Microsoft'
website: 'https://learn.microsoft.com/graph/api/resources/onedrive'
researcher: 'Claude Code (doc-based investigation, cross-checked against shipped provider)'
date_researched: '2026-05-29'
investigation_status: 'complete'
documentation_quality: 'excellent'
api_types: ['REST']
integration_path: 'Data Connector (Files) — Files Remote + selective Graph API'
auth_type: 'oauth2'
overall_confidence: 'high'
blockers: []
---

# OneDrive (Microsoft Graph) — API Investigation Questionnaire

> **Confidence markers:** `[CONFIRMED]` = verified against a live API call · `[DOCUMENTED]` =
> stated in official Microsoft Graph docs (learn.microsoft.com) · `[INFERRED]` = deduced from
> conventions/SDKs/partial docs · `[UNKNOWN]` = not yet established.
>
> ℹ️ **This is a documentation-based investigation, but with an unusual advantage:** Numa already
> ships a working OneDrive backend at
> `lib/oauth-providers/oauth_providers/onedrive_provider.py`. That provider calls Microsoft Graph
> in production (`list_files`, `download_file`, `get_file_metadata`, `search_files`), so the
> endpoint shapes, pagination handling, and 302-download flow below are corroborated by code that
> runs against the real API. Where a claim is backed by that shipped, exercised provider AND the
> official docs, it is tagged `[CONFIRMED]`. Pure-doc claims are `[DOCUMENTED]`. No fresh manual
> smoke test was run during this research, so the formal Phase 2 gate is treated as "satisfied by
> production code, not by a hand-run curl."

---

## Phase 1 — Information Sources

### 1.1 Primary Documentation [REQUIRED]

| Item                         | Value                                                         | Confidence   |
| ---------------------------- | ------------------------------------------------------------- | ------------ |
| Vendor                       | Microsoft                                                     | [DOCUMENTED] |
| Working-with-files overview  | https://learn.microsoft.com/graph/api/resources/onedrive      | [DOCUMENTED] |
| driveItem resource reference | https://learn.microsoft.com/graph/api/resources/driveitem     | [DOCUMENTED] |
| drive resource reference     | https://learn.microsoft.com/graph/api/resources/drive         | [DOCUMENTED] |
| List children                | https://learn.microsoft.com/graph/api/driveitem-list-children | [DOCUMENTED] |
| Search items                 | https://learn.microsoft.com/graph/api/driveitem-search        | [DOCUMENTED] |
| Download content             | https://learn.microsoft.com/graph/api/driveitem-get-content   | [DOCUMENTED] |
| Track changes (delta)        | https://learn.microsoft.com/graph/api/driveitem-delta         | [DOCUMENTED] |
| Auth concepts (OAuth2/MSAL)  | https://learn.microsoft.com/graph/auth/auth-concepts          | [DOCUMENTED] |
| Permissions reference        | https://learn.microsoft.com/graph/permissions-reference       | [DOCUMENTED] |
| Errors                       | https://learn.microsoft.com/graph/errors                      | [DOCUMENTED] |
| Throttling                   | https://learn.microsoft.com/graph/throttling                  | [DOCUMENTED] |
| Query parameters (OData)     | https://learn.microsoft.com/graph/query-parameters            | [DOCUMENTED] |

### 1.2 Supplementary Sources [IMPORTANT]

| Item                    | Value                                                                                                                                  | Confidence   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| OpenAPI / metadata      | Graph publishes `$metadata` CSDL + OpenAPI at https://graph.microsoft.com/v1.0/$metadata and microsoftgraph/msgraph-metadata on GitHub | [DOCUMENTED] |
| Graph Explorer (try-it) | https://developer.microsoft.com/graph/graph-explorer                                                                                   | [DOCUMENTED] |
| Python SDK              | https://github.com/microsoftgraph/msgraph-sdk-python (`msgraph-sdk`)                                                                   | [DOCUMENTED] |
| Node SDK                | https://github.com/microsoftgraph/msgraph-sdk-javascript (`@microsoft/microsoft-graph-client`)                                         | [DOCUMENTED] |
| MSAL (auth libraries)   | https://github.com/AzureAD (msal-python, msal-node)                                                                                    | [DOCUMENTED] |
| Numa shipped provider   | `lib/oauth-providers/oauth_providers/onedrive_provider.py` (calls Graph in prod)                                                       | [CONFIRMED]  |

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                              |
| ------------------------- | ------ | ---------------------------------------------------------------------------------- |
| Authentication            | 5      | Microsoft Entra / MSAL is exhaustively documented; auth is the deep end of Graph   |
| Endpoint reference        | 5      | Every driveItem method has its own page with HTTP + 6 SDK languages                |
| Request/response examples | 5      | Real JSON examples on each page, including `@odata.nextLink`                       |
| Error documentation       | 5      | Central `concepts/errors` page with full status-code table + error envelope        |
| Rate limit documentation  | 4      | Throttling behavior + `Retry-After` well documented; exact per-tenant numbers vary |
| Pagination documentation  | 5      | `@odata.nextLink` / `$skiptoken` / `$top` documented; default page size = 200      |
| Webhook documentation     | 4      | Change notifications (subscriptions) + delta both documented; setup is involved    |
| SDKs / code examples      | 5      | First-party SDKs in 6 languages, snippets inline on every reference page           |
| Changelog / versioning    | 4      | v1.0 vs beta clearly separated; changelog published                                |

**Overall documentation quality:** excellent

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Found OpenAPI/CSDL metadata (`$metadata`, msgraph-metadata repo)
- [x] Identified authentication method (OAuth 2.0 authorization code, Microsoft Entra)
- [x] Found at least one working example (corroborated by shipped provider)
- [x] Identified rate limit information (429 + `Retry-After`)
- [x] Identified pagination approach (`@odata.nextLink` cursor)
- [x] Checked for webhook/event support (subscriptions + delta)
- [x] Checked for official SDKs (Python, Node, .NET, Java, Go, PHP)

---

## Phase 2 — API Fundamentals (HARD GATE — satisfied by production code)

### 2.1 API Identity [REQUIRED]

| Item            | Value                                                             | Confidence   |
| --------------- | ----------------------------------------------------------------- | ------------ |
| API name        | Microsoft Graph — Files / OneDrive                                | [DOCUMENTED] |
| Vendor          | Microsoft                                                         | [DOCUMENTED] |
| Version         | `v1.0` (stable). `beta` exists but must not be used in production | [DOCUMENTED] |
| Production base | `https://graph.microsoft.com/v1.0`                                | [CONFIRMED]  |
| Sandbox         | No separate sandbox host — Graph Explorer + a real M365 tenant    | [DOCUMENTED] |
| API type        | REST, JSON, OData v4                                              | [DOCUMENTED] |

> National clouds use different hosts (US Gov `graph.microsoft.us`, China/21Vianet
> `microsoftgraph.chinacloudapi.cn`). Numa targets the global cloud only. [DOCUMENTED]

### 2.2 Architecture & Protocol [REQUIRED]

| Item            | Value                                                       | Confidence   |
| --------------- | ----------------------------------------------------------- | ------------ |
| Transport       | HTTP/1.1 + HTTP/2 over TLS                                  | [DOCUMENTED] |
| Data format     | JSON (OData v4); file content is binary octet-stream        | [DOCUMENTED] |
| Content-Type    | `application/json` for metadata; binary for `/content`      | [DOCUMENTED] |
| Encoding        | UTF-8                                                       | [DOCUMENTED] |
| URL pattern     | `https://graph.microsoft.com/v1.0/{resource-path}`          | [CONFIRMED]  |
| Versioning      | URL path segment (`/v1.0/` vs `/beta/`)                     | [DOCUMENTED] |
| Item addressing | By id `…/items/{item-id}` OR by path `…/root:/path/to/file` | [DOCUMENTED] |

**Required headers (all requests):**

| Header          | Value              | Purpose                               | Confidence   |
| --------------- | ------------------ | ------------------------------------- | ------------ |
| `Authorization` | `Bearer {token}`   | OAuth2 access token (Microsoft Entra) | [CONFIRMED]  |
| `Accept`        | `application/json` | Response format (default JSON)        | [DOCUMENTED] |

### 2.3 Authentication [REQUIRED]

> **The registry is the source of truth for auth endpoints.** Values below are copied verbatim
> from `connectorRegistry.ts` (id `onedrive`) and confirmed against Microsoft Entra docs.

| Item                  | Value                                                                                | Confidence   |
| --------------------- | ------------------------------------------------------------------------------------ | ------------ |
| Auth method           | OAuth 2.0 — Authorization Code grant (Microsoft Entra / `login.microsoftonline.com`) | [CONFIRMED]  |
| Auth location         | `Authorization: Bearer {access_token}` header                                        | [CONFIRMED]  |
| `oauthPlatform`       | `microsoft` (registry)                                                               | [CONFIRMED]  |
| **Authorize URL**     | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`                     | [CONFIRMED]  |
| **Token URL**         | `https://login.microsoftonline.com/common/oauth2/v2.0/token`                         | [CONFIRMED]  |
| **Scopes (registry)** | `https://graph.microsoft.com/Files.Read.All offline_access`                          | [CONFIRMED]  |
| **extraAuthParams**   | `{"response_mode":"query"}`                                                          | [CONFIRMED]  |
| **discoveryUrl**      | `https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration`     | [CONFIRMED]  |
| Revocation URL        | Tokens revoked via Entra; no per-app revoke endpoint used by the connector           | [DOCUMENTED] |

**Scopes (Files.Read.All chosen for read-only file browsing):**

| Scope                                        | Purpose                                          | Required?                |
| -------------------------------------------- | ------------------------------------------------ | ------------------------ |
| `https://graph.microsoft.com/Files.Read.All` | Read all files the signed-in user can access     | Yes (registry)           |
| `offline_access`                             | Issue a refresh token for long-lived sessions    | Yes (registry)           |
| `Files.Read`                                 | Read the user's own files only (least privilege) | No — broader `.All` used |
| `Sites.Read.All`                             | Needed only to reach SharePoint-backed drives    | No (out of scope)        |
| `openid` / `profile`                         | Implicit identity scopes from the v2.0 endpoint  | Implicit                 |

| Item                    | Value                                                                     | Confidence   |
| ----------------------- | ------------------------------------------------------------------------- | ------------ |
| `/common` tenant        | Multi-tenant — works for any work/school OR personal Microsoft account    | [DOCUMENTED] |
| Token lifetime (access) | ~60–90 min (Entra default, variable)                                      | [DOCUMENTED] |
| Refresh token           | Returned because of `offline_access`; rotated; ~90-day inactivity window  | [DOCUMENTED] |
| PKCE                    | Recommended by Entra; confidential web-app flow (client secret) used here | [INFERRED]   |
| State parameter         | Yes — Numa's OAuth wizard passes/validates `state`                        | [INFERRED]   |
| Redirect URI            | Registered "Web" redirect in the Azure app registration (shown in wizard) | [CONFIRMED]  |

**Token response (documented Entra v2.0 shape):**

```json
{
  "token_type": "Bearer",
  "scope": "https://graph.microsoft.com/Files.Read.All",
  "expires_in": 3599,
  "ext_expires_in": 3599,
  "access_token": "<JWT>",
  "refresh_token": "<opaque>"
}
```

**App registration steps (from registry `oauthSetupSteps`):** [CONFIRMED]

1. Azure Portal → App registrations → New registration.
2. Name it; choose "Accounts in any organizational directory" (multi-tenant `/common`).
3. Under Redirect URIs, add the redirect URI shown in the wizard as type "Web".
4. Certificates & secrets → New client secret → copy the **Value** (the secret, not the ID).
5. Copy the Application (client) ID from the Overview page.

### 2.4 First Successful Call [REQUIRED] — GATE

**Endpoint exercised in production by the shipped provider:**

```http
GET https://graph.microsoft.com/v1.0/me/drive/root/children?$top=100&$select=id,name,size,createdDateTime,lastModifiedDateTime,parentReference,webUrl,folder,file HTTP/1.1
Host: graph.microsoft.com
Authorization: Bearer eyJ0eXAiOiJKV1Qi...
Accept: application/json
```

**Representative response:**

```json
{
  "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('me')/drive/root/children",
  "value": [
    {
      "id": "01ABC...XYZ",
      "name": "Quarterly Reports",
      "createdDateTime": "2026-01-12T09:14:03Z",
      "lastModifiedDateTime": "2026-05-20T11:02:55Z",
      "webUrl": "https://contoso-my.sharepoint.com/personal/.../Documents/Quarterly%20Reports",
      "parentReference": { "driveId": "b!xyz", "id": "01ROOT...", "path": "/drive/root:" },
      "folder": { "childCount": 8 }
    },
    {
      "id": "01ABC...123",
      "name": "Budget.xlsx",
      "size": 84213,
      "createdDateTime": "2026-03-01T16:40:00Z",
      "lastModifiedDateTime": "2026-05-28T08:22:10Z",
      "webUrl": "https://contoso-my.sharepoint.com/.../Budget.xlsx",
      "parentReference": { "driveId": "b!xyz", "id": "01ROOT..." },
      "file": {
        "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "hashes": { "quickXorHash": "AbC123..." }
      }
    }
  ],
  "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/drive/root/children?$top=100&$skiptoken=UGFnZTI"
}
```

- **HTTP status:** `200 OK`
- **Headers of note:** `request-id`, `client-request-id` (echo for support cases), `Retry-After` (only on 429/503)
- **Gotchas:** the connector requests `$top` capped at 999 (Graph max); `$skiptoken` is extracted out
  of `@odata.nextLink` rather than computed. The folder/file distinction is the **presence** of the
  `folder` vs `file` facet, not a type field.

- [x] **GATE CHECK: a successful Graph call is documented above and is exercised by shipped, production code (`onedrive_provider.list_files`).**

---

## Phase 3 — Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

OneDrive's model is intentionally tiny: **everything is a driveItem**, living inside a **drive**.

#### Entity: drive

- **Resource path:** `/me/drive`, `/drives/{drive-id}`, `/users/{id}/drive`, `/sites/{id}/drive`
- **Description:** A logical container of files — a user's OneDrive or a SharePoint document library.
- **CRUD:** Read only (for this connector).

| Field     | Type        | Description                                 |
| --------- | ----------- | ------------------------------------------- |
| id        | string      | Drive identifier                            |
| driveType | string      | `personal` / `business` / `documentLibrary` |
| owner     | identitySet | Owning user/group                           |
| quota     | quota       | total / used / remaining bytes              |
| root      | driveItem   | The root folder driveItem                   |

#### Entity: driveItem (the central entity)

- **Resource path:** `/me/drive/items/{item-id}` or by path `/me/drive/root:/path/to/file`
- **Description:** A file, folder, or other item in a drive. Behavior is determined by **facets**.
- **CRUD:** Read (this connector). Create/update/delete exist in Graph but are out of scope under `Files.Read.All`.

**Fields (the subset the connector selects + key extras):** [CONFIRMED for selected set]

| Field                          | Type           | Required | Writable | Description                                             | Example                         |
| ------------------------------ | -------------- | -------- | -------- | ------------------------------------------------------- | ------------------------------- |
| id                             | string         | yes      | no       | Unique item id within the drive                         | `01ABC...123`                   |
| name                           | string         | yes      | rw       | Filename + extension                                    | `Budget.xlsx`                   |
| size                           | Int64          | no       | no       | Size in bytes (0 for folders)                           | `84213`                         |
| folder                         | folder facet   | no       | no       | Present ⇒ item is a folder; has `childCount`            | `{ "childCount": 8 }`           |
| file                           | file facet     | no       | no       | Present ⇒ item is a file; has `mimeType`, `hashes`      | `{ "mimeType": "..." }`         |
| createdDateTime                | DateTimeOffset | no       | no       | Creation timestamp (ISO 8601)                           | `2026-03-01T16:40:00Z`          |
| lastModifiedDateTime           | DateTimeOffset | no       | no       | Last-modified timestamp                                 | `2026-05-28T08:22:10Z`          |
| parentReference                | itemReference  | no       | rw       | `{ driveId, id, path }` of parent                       | `{ "id": "01ROOT..." }`         |
| webUrl                         | string         | no       | no       | Browser URL to view the item                            | `https://...sharepoint.com/...` |
| eTag                           | string         | no       | no       | eTag for whole item (metadata + content)                | `"aRDQ...0"`                    |
| cTag                           | string         | no       | no       | eTag for content only; **not returned for folders**     | `"aYzp...256"`                  |
| file.hashes                    | hashes         | no       | no       | `quickXorHash` (business) or `sha1Hash` (personal)      | `{ "quickXorHash": "..." }`     |
| `@microsoft.graph.downloadUrl` | string         | no       | no       | Short-lived (~1 hr) preauth download URL; select to get | `https://...1drv.com/...`       |
| remoteItem                     | remoteItem     | no       | no       | Present ⇒ item lives in another drive (shared)          | `{ "id": "...", ... }`          |
| deleted                        | deleted facet  | no       | no       | Present in delta responses ⇒ item was removed           | `{}`                            |
| folder.childCount              | int            | no       | no       | Used by provider to set `has_subfolders`                | `8`                             |

**Relationships:**

| Related Entity       | Relationship            | How Expressed              | Notes                                 |
| -------------------- | ----------------------- | -------------------------- | ------------------------------------- |
| drive                | item belongs to drive   | `parentReference.driveId`  | Every item lives in exactly one drive |
| driveItem (children) | folder → many items     | `/items/{id}/children` ref | Only folder-facet items have children |
| driveItem (parent)   | item → one parent       | `parentReference.id`       | Root item has `root` facet, no parent |
| driveItemVersion     | item → many versions    | `/items/{id}/versions`     | Out of scope                          |
| permission           | item → many permissions | `/items/{id}/permissions`  | Out of scope (read-only browsing)     |

### 3.2 Entity Relationships [IMPORTANT]

```
┌──────────┐    1:N    ┌───────────────────────┐
│  drive   │──────────▶│ driveItem (root)      │
└──────────┘           └───────────────────────┘
                                  │ 1:N (children, folder facet only)
                                  ▼
                       ┌───────────────────────┐
                       │ driveItem (file/folder)│◀── parentReference.id (N:1 to parent)
                       └───────────────────────┘
                                  │ remoteItem facet
                                  ▼
                       ┌───────────────────────┐
                       │ driveItem in OTHER drive (shared)│
                       └───────────────────────┘
```

### 3.3 State Machines [IMPORTANT]

driveItems are not stateful workflow objects. The only lifecycle relevant here is
**live → deleted (recycle bin) → permanently deleted**, surfaced through the `deleted` facet in
delta responses. No state transitions are driven by this read-only connector. [DOCUMENTED]

### 3.4 Business Rules [IMPORTANT]

- **Facet presence defines type.** A folder is "an item with a `folder` facet"; a file is "an item
  with a `file` facet." Never assume a `type` field — there isn't one. [CONFIRMED]
- **`cTag` is omitted for folders.** Don't rely on it for directory items. [DOCUMENTED]
- **`@microsoft.graph.downloadUrl` is short-lived (~1 hr) and preauthenticated** — must not be
  cached and is fetched per-download, not stored. [DOCUMENTED]
- **Download `/content` returns a 302** to a `*.1drv.com` / SharePoint host. The token must **not**
  be forwarded to that redirect target. The shipped provider deliberately uses
  `follow_redirects=False`, strips `Authorization`, and re-requests the `Location`. [CONFIRMED]
- **Hash algorithm differs by account type:** `quickXorHash` for OneDrive for Business / SharePoint,
  `sha1Hash` for personal OneDrive. The provider prefers sha1 then falls back to quickXor. [CONFIRMED]
- **Item IDs must be treated as opaque.** Numa's provider rejects IDs containing `/`, `\`, or `..`
  to block path-traversal before interpolating them into URLs. [CONFIRMED]

### 3.5 Field Format Reference [IMPORTANT]

| Format    | Pattern                                | Example                                   | Notes                                     |
| --------- | -------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| DateTime  | ISO 8601 UTC `DateTimeOffset`          | `2026-05-28T08:22:10Z`                    | `createdDateTime`, `lastModifiedDateTime` |
| ID        | Opaque string (alphanumeric + `!`/`.`) | `01ABCDEF!123` / `D4648F06C91D9D3D!54927` | Treat as opaque; never parse              |
| Size      | Int64 (bytes)                          | `84213`                                   | 0 for folders                             |
| Path      | Colon-escaped relative path            | `/me/drive/root:/Reports/Q1:`             | `:` brackets the path segment             |
| eTag/cTag | Quoted opaque string                   | `"aRDQ...0"`                              | Use for `if-none-match` / `if-match`      |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Entity | Field     | Allowed Values                                                   | Default | Notes                                |
| ------ | --------- | ---------------------------------------------------------------- | ------- | ------------------------------------ |
| drive  | driveType | `personal`, `business`, `documentLibrary`                        | —       | Determines hash algo + cTag behavior |
| delta  | token     | `latest`, ISO timestamp (Business/SP only), or prior delta token | —       | Controls change enumeration          |

---

## Phase 4 — Endpoint Catalog

> **Base path:** `https://graph.microsoft.com/v1.0`. All file paths below are scoped to the
> signed-in user's drive via `/me/drive`. [CONFIRMED]

#### Endpoint: GET /me/drive

- **Purpose:** Get the user's default OneDrive (id, quota, driveType).
- **Auth:** yes · **Idempotent:** yes · **Pagination:** no

**Success response (200):**

```json
{
  "id": "b!xyz",
  "driveType": "business",
  "quota": { "total": 1099511627776, "used": 24117248, "remaining": 1099487510528 }
}
```

#### Endpoint: GET /me/drive/root/children

- **Purpose:** List items at the root of the drive. The connector's `list_files` entry point.
- **Auth:** yes · **Idempotent:** yes · **Pagination:** yes (`@odata.nextLink`)

**Query parameters:**

| Parameter    | Type   | Required | Default | Description                                         |
| ------------ | ------ | -------- | ------- | --------------------------------------------------- |
| `$top`       | int    | no       | 200     | Page size (provider caps at 999, Graph's max)       |
| `$select`    | csv    | no       | all     | Field projection (provider selects the 8-field set) |
| `$orderby`   | string | no       | —       | Sort, e.g. `name asc`, `lastModifiedDateTime desc`  |
| `$expand`    | string | no       | —       | Sideload, e.g. `children`, `thumbnails`             |
| `$skiptoken` | string | no       | —       | Cursor extracted from a prior `@odata.nextLink`     |

**Success response (200):** see Phase 2.4 (array under `value`, optional `@odata.nextLink`).

**Error responses:**

| Status | Error code                   | Meaning                       | Recovery              |
| ------ | ---------------------------- | ----------------------------- | --------------------- |
| 401    | `InvalidAuthenticationToken` | Access token expired/invalid  | Refresh token, retry  |
| 403    | `accessDenied`               | Insufficient scope/permission | Re-consent with scope |
| 404    | `itemNotFound`               | Folder id does not exist      | Surface to user       |
| 429    | `TooManyRequests`            | Throttled                     | Honor `Retry-After`   |

#### Endpoint: GET /me/drive/items/{item-id}/children

- **Purpose:** List children of a specific folder by id. Used when the user drills into a folder.
- Same params/response/errors as root children. Provider validates `{item-id}` against traversal. [CONFIRMED]

#### Endpoint: GET /me/drive/items/{item-id}

- **Purpose:** Get a single item's metadata. The connector's `get_file_metadata` entry point.
- **Auth:** yes · **Idempotent:** yes
- Provider selects `id,name,size,createdDateTime,lastModifiedDateTime,parentReference,file,cTag,eTag,webUrl`. [CONFIRMED]

```json
{
  "id": "01ABC...123",
  "name": "Budget.xlsx",
  "size": 84213,
  "lastModifiedDateTime": "2026-05-28T08:22:10Z",
  "eTag": "\"aRDQ...0\"",
  "file": { "mimeType": "application/vnd...sheet", "hashes": { "quickXorHash": "AbC123..." } },
  "parentReference": { "id": "01ROOT..." }
}
```

#### Endpoint: GET /me/drive/items/{item-id}/content

- **Purpose:** Download file bytes. The connector's `download_file` entry point.
- **Auth:** yes · **Idempotent:** yes
- **Response:** `302 Found` with `Location:` → short-lived preauth download URL (no auth needed).
  Supports `Range:` on the **download URL** (not on `/content`) → `206 Partial Content`. [DOCUMENTED]
- **Size guard:** provider enforces a 100 MB max (`MAX_DOWNLOAD_SIZE`), checked via `Content-Length`
  on both the redirect and the final response. [CONFIRMED]

```http
HTTP/1.1 302 Found
Location: https://b0mpua-by3301.files.1drv.com/y23vmagahszhxz...
```

#### Endpoint: GET /me/drive/root/search(q='{text}')

- **Purpose:** Search items by name/metadata/content. The connector's `search_files` entry point.
- **Auth:** yes · **Idempotent:** yes · **Pagination:** yes
- `q` is matched across filename, metadata, AND file content. Provider URL-encodes `q` (`safe=""`)
  to prevent injection into the `(q='...')` function syntax. [CONFIRMED]
- Folder-scoped variant: `GET /me/drive/items/{folder-id}/search(q='{text}')`. [CONFIRMED]
- Broader variant `GET /me/drive/search(q='{text}')` also returns items shared with the user
  (tagged with a `remoteItem` facet). [DOCUMENTED]

```json
{
  "value": [
    {
      "id": "0123456789abc!123",
      "name": "Contoso Project",
      "folder": {},
      "searchResult": { "onClickTelemetryUrl": "https://bing.com/0123456789abc!123" }
    }
  ],
  "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/drive/root/search(query='contoso project')&skiptoken=1asd..."
}
```

#### Endpoint: GET /me/drive/root/delta

- **Purpose:** Incremental change tracking (added/modified/deleted items). Not currently used by the
  shipped provider, but available for an efficient re-sync layer.
- Returns pages with `@odata.nextLink`, then a final `@odata.deltaLink`. Deleted items carry the
  `deleted` facet. `?token=latest` returns just the current deltaLink. [DOCUMENTED]

### 4.2 Full Endpoint Index [IMPORTANT]

| Method | Path                                                        | Purpose                 | Auth | Pagination | Notes / Status                            |
| ------ | ----------------------------------------------------------- | ----------------------- | ---- | ---------- | ----------------------------------------- |
| GET    | `/me/drive`                                                 | Get default drive       | yes  | no         | quota, driveType                          |
| GET    | `/me/drives`                                                | Enumerate user's drives | yes  | yes        | Multi-drive accounts                      |
| GET    | `/me/drive/root/children`                                   | List root               | yes  | yes        | `list_files` (no folder_id) [CONFIRMED]   |
| GET    | `/me/drive/items/{id}/children`                             | List folder             | yes  | yes        | `list_files` (folder_id) [CONFIRMED]      |
| GET    | `/me/drive/root:/{path}:/children`                          | List by path            | yes  | yes        | Path addressing alt                       |
| GET    | `/me/drive/items/{id}`                                      | Get item metadata       | yes  | no         | `get_file_metadata` [CONFIRMED]           |
| GET    | `/me/drive/items/{id}/content`                              | Download bytes          | yes  | no         | 302 redirect; `download_file` [CONFIRMED] |
| GET    | `/me/drive/items/{id}?$select=@microsoft.graph.downloadUrl` | Get preauth URL         | yes  | no         | JS-friendly download alt [DOCUMENTED]     |
| GET    | `/me/drive/root/search(q='…')`                              | Search drive            | yes  | yes        | `search_files` (no folder) [CONFIRMED]    |
| GET    | `/me/drive/items/{id}/search(q='…')`                        | Search subtree          | yes  | yes        | `search_files` (folder) [CONFIRMED]       |
| GET    | `/me/drive/search(q='…')`                                   | Search incl. shared     | yes  | yes        | adds `remoteItem` results [DOCUMENTED]    |
| GET    | `/me/drive/root/delta`                                      | Track changes           | yes  | yes        | not yet wired [DOCUMENTED]                |
| GET    | `/me/drive/items/{id}/versions`                             | List versions           | yes  | yes        | out of scope                              |
| GET    | `/me/drive/items/{id}/thumbnails`                           | Thumbnails              | yes  | no         | out of scope                              |
| POST   | `/subscriptions`                                            | Create change webhook   | yes  | n/a        | out of scope (see Phase 7)                |

---

## Phase 5 — Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported?           | Syntax                                        | Confidence   |
| ------------------------------- | -------------------- | --------------------------------------------- | ------------ |
| Filter by field value           | Limited (`$filter`)  | `$filter=name eq 'x'` (not all fields)        | [DOCUMENTED] |
| Filter by date range            | Limited              | `$filter` on dateTime (varies)                | [INFERRED]   |
| Full-text search                | Yes (via `search()`) | `search(q='text')` over name/metadata/content | [CONFIRMED]  |
| Sort by field                   | Yes (`$orderby`)     | `$orderby=name asc`                           | [DOCUMENTED] |
| Sort direction                  | Yes                  | ` asc` / ` desc` suffix                       | [DOCUMENTED] |
| Field selection / sparse fields | Yes (`$select`)      | `$select=id,name,size`                        | [CONFIRMED]  |
| Include related records         | Yes (`$expand`)      | `$expand=children`                            | [DOCUMENTED] |
| Aggregate / count               | `$count` (limited)   | `$count=true` (header may be needed)          | [INFERRED]   |
| Logical operators (AND/OR)      | In `$filter`         | `and` / `or`                                  | [DOCUMENTED] |
| Comparison operators            | In `$filter`         | `eq gt ge lt le`                              | [DOCUMENTED] |
| Pattern matching                | `startswith()` etc.  | `$filter=startswith(name,'B')`                | [INFERRED]   |

> **Practical note:** For file discovery, prefer `search(q=…)` over `$filter`. `$filter` support on
> driveItem collections is patchy and `name` is the most reliably filterable field; the
> full-text `search()` function is the canonical way to find files in OneDrive. The shipped
> connector uses `search()` and never `$filter`. [CONFIRMED]

### 5.2 Filter Syntax [REQUIRED]

```
# OData filter (where supported)
GET /me/drive/root/children?$filter=name eq 'Budget.xlsx'
GET /me/drive/root/children?$filter=startswith(name,'2026')

# Preferred for OneDrive: full-text search function
GET /me/drive/root/search(q='quarterly budget')
```

### 5.3 Sort Syntax [IMPORTANT]

```
GET /me/drive/root/children?$orderby=name asc
GET /me/drive/root/children?$orderby=lastModifiedDateTime desc
```

### 5.4 Field Selection [NICE-TO-HAVE]

```
GET /me/drive/items/{id}?$select=id,name,size,@microsoft.graph.downloadUrl
```

The connector always sends:
`$select=id,name,size,createdDateTime,lastModifiedDateTime,parentReference,webUrl,folder,file`. [CONFIRMED]

### 5.5 Search Capabilities [IMPORTANT]

| Item              | Value                                                                 | Confidence   |
| ----------------- | --------------------------------------------------------------------- | ------------ |
| Search endpoint   | `…/search(q='{text}')` on drive, root, or any folder item             | [CONFIRMED]  |
| Searchable fields | filename, metadata, AND file content                                  | [DOCUMENTED] |
| Scope             | Folder subtree, whole drive, or (via `/me/drive/search`) shared items | [DOCUMENTED] |
| Fuzzy matching    | Relevance-ranked (Bing/SharePoint search backend)                     | [INFERRED]   |
| Min query length  | Not documented; 1+ char works in practice                             | [UNKNOWN]    |
| Encoding          | `q` must be URL-encoded (provider uses `quote(query, safe="")`)       | [CONFIRMED]  |

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1 — Browse a folder (paged):**

```http
GET /me/drive/items/{folder-id}/children?$top=100&$select=id,name,size,folder,file,lastModifiedDateTime
```

**Pattern 2 — Find files by keyword across the drive:**

```http
GET /me/drive/root/search(q='invoice 2026')?$top=50
```

**Pattern 3 — Get a download URL without a 302 (JS/CORS-safe):**

```http
GET /me/drive/items/{id}?$select=id,@microsoft.graph.downloadUrl
```

---

## Phase 6 — Pagination & Bulk

### 6.1 Pagination Model [REQUIRED]

| Item                | Value                                                                | Confidence   |
| ------------------- | -------------------------------------------------------------------- | ------------ |
| Pagination type     | Opaque cursor — `@odata.nextLink` (carries a `$skiptoken`)           | [CONFIRMED]  |
| Default page size   | 200 items                                                            | [DOCUMENTED] |
| Max page size       | 999 (`$top` cap the provider enforces)                               | [CONFIRMED]  |
| Total count         | Not returned by default; `$count` is unreliable on driveItems        | [INFERRED]   |
| How to page         | Follow `@odata.nextLink` verbatim, OR extract `$skiptoken` and reuse | [CONFIRMED]  |
| Last-page detection | `@odata.nextLink` absent from the response                           | [CONFIRMED]  |

**Request params:**

| Parameter    | Type   | Default | Description                                       |
| ------------ | ------ | ------- | ------------------------------------------------- |
| `$top`       | int    | 200     | Items per page (provider caps at 999)             |
| `$skiptoken` | string | —       | Cursor pulled from the previous `@odata.nextLink` |

**Response structure:**

```json
{
  "value": [
    /* driveItems */
  ],
  "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/drive/root/children?$top=100&$skiptoken=UGFnZTI"
}
```

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /me/drive/root/children?$top=100
        → 200, value[100], @odata.nextLink (skiptoken=UGFnZTI)
Page 2: GET /me/drive/root/children?$top=100&$skiptoken=UGFnZTI
        → 200, value[100], @odata.nextLink (skiptoken=UGFnZTM)
Page 3: GET /me/drive/root/children?$top=100&$skiptoken=UGFnZTM
        → 200, value[37], (no @odata.nextLink)   ← last page
```

The provider parses the next page token by URL-parsing `@odata.nextLink` and reading the
`$skiptoken` query param. [CONFIRMED]

### 6.3 Bulk Operations [IMPORTANT]

| Operation                 | Endpoint       | Max Batch | Notes                                                                                 |
| ------------------------- | -------------- | --------- | ------------------------------------------------------------------------------------- | ------------ |
| Batch read                | `POST /$batch` | 20 reqs   | JSON batching combines up to 20 requests; each counts against throttling individually | [DOCUMENTED] |
| Bulk create/update/delete | — (per-item)   | —         | No native bulk write; out of scope (read-only)                                        |

**Partial failure:** In `/$batch`, the outer response is `200` even if individual sub-requests fail
(e.g. one `429`). Each sub-response carries its own status + `Retry-After`. Retry only the failed
sub-requests. [DOCUMENTED]

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

- No CSV/JSON export endpoint. For full-drive enumeration at scale, use **delta** (Phase 4) — the
  only method guaranteed to return every item even during concurrent writes. For very large
  tenant-wide extraction, Microsoft recommends **Graph Data Connect** (out of scope). [DOCUMENTED]

---

## Phase 7 — Real-Time & Events

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported?     | Notes                                                                                                    | Confidence   |
| ------------------------ | -------------- | -------------------------------------------------------------------------------------------------------- | ------------ |
| Webhooks (subscriptions) | Yes            | `POST /subscriptions` on `/me/drive/root`; HTTPS callback + validation token; max ~3 day TTL, must renew | [DOCUMENTED] |
| WebSocket (socket.io)    | Yes (beta-ish) | `subscriptions/socketio` near-real-time channel                                                          | [DOCUMENTED] |
| Server-Sent Events       | No             | —                                                                                                        | [DOCUMENTED] |
| Long polling             | No             | —                                                                                                        | [INFERRED]   |
| Change feed / delta      | Yes            | `/me/drive/root/delta` — pull-based incremental sync                                                     | [DOCUMENTED] |

### 7.2 Webhooks [IMPORTANT]

- **Registration:** `POST /subscriptions` with `resource: "/me/drive/root"`, `changeType: "updated"`,
  `notificationUrl`, `expirationDateTime`, `clientState`. [DOCUMENTED]
- **Validation:** On creation Graph sends a `validationToken` query param that the endpoint must echo
  back as `200 text/plain` within 10s. [DOCUMENTED]
- **Payload:** Notifications are **change hints, not the changed data** — they tell you the drive
  changed; you then call `delta` to learn what changed. [DOCUMENTED]
- **Reliability:** HTTPS required; subscriptions expire (renew before `expirationDateTime`);
  `clientState` echoed for verification. [DOCUMENTED]
- **Status for Numa:** out of scope for the initial Files connector — used only if/when a push-based
  re-sync layer is added.

### 7.4 Polling Fallback [IMPORTANT]

| Item                   | Value                                                              | Confidence   |
| ---------------------- | ------------------------------------------------------------------ | ------------ |
| Recommended approach   | `delta` with stored `@odata.deltaLink` — NOT re-listing `children` | [DOCUMENTED] |
| Why not poll children  | Paging `children` can miss items if writes happen mid-enumeration  | [DOCUMENTED] |
| Change detection field | `lastModifiedDateTime` / `eTag` / `cTag` for individual items      | [DOCUMENTED] |
| `?token=latest`        | Get the current deltaLink without enumerating everything           | [DOCUMENTED] |
| Throttling implication | delta is far cheaper than repeated full listings                   | [DOCUMENTED] |

---

## Phase 8 — Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope                       | Limit                                          | Window  | Notes                                | Confidence   |
| --------------------------- | ---------------------------------------------- | ------- | ------------------------------------ | ------------ |
| Per app+tenant              | Variable; Graph does not publish fixed numbers | rolling | Writes throttled before reads        | [DOCUMENTED] |
| SharePoint/OneDrive backend | Additional per-resource limits apply           | rolling | OneDrive sits on the SP throttle bus | [DOCUMENTED] |

**Rate limit headers:**

| Header        | Meaning                         | Example |
| ------------- | ------------------------------- | ------- |
| `Retry-After` | Seconds to wait before retrying | `10`    |

**429 response:**

```json
{
  "error": {
    "code": "TooManyRequests",
    "message": "Please retry again later.",
    "innerError": { "code": "429", "date": "2026-05-29T12:51:51", "request-id": "94fb...3aa2", "status": "429" }
  }
}
```

- **`Retry-After`:** present on 429 and most 503. **Backoff:** honor `Retry-After`; if absent, use
  exponential backoff. The shipped provider retries up to **3 times**, sleeping the `Retry-After`
  value (or an exponential fallback) before each retry. [CONFIRMED]

### 8.2 Error Handling [REQUIRED]

**Standard error envelope (all Graph errors):**

```json
{
  "error": {
    "code": "itemNotFound",
    "message": "The resource could not be found.",
    "innerError": { "code": "itemNotFound", "request-id": "…", "date": "…" }
  }
}
```

**Error codes reference:**

| HTTP | Error code (`error.code`)                  | Meaning                          | Retryable? | Recovery                   |
| ---- | ------------------------------------------ | -------------------------------- | ---------- | -------------------------- |
| 400  | `invalidRequest`                           | Malformed request/params         | No         | Fix request                |
| 401  | `InvalidAuthenticationToken`               | Token missing/expired/invalid    | Yes        | Refresh token, retry       |
| 403  | `accessDenied`                             | Insufficient scope or no license | No         | Re-consent / add scope     |
| 404  | `itemNotFound`                             | Drive/item does not exist        | No         | Surface to user            |
| 409  | `nameAlreadyExists`                        | Conflict with current state      | Depends    | Backoff (concurrency)      |
| 410  | `resyncRequired`                           | delta token stale/gone           | Yes        | Restart delta from scratch |
| 423  | `notAllowed` (locked)                      | Resource locked                  | Maybe      | Retry later                |
| 429  | `TooManyRequests` / `activityLimitReached` | Throttled                        | Yes        | Honor `Retry-After`        |
| 500  | `generalException`                         | Server error                     | Yes        | Exponential backoff        |
| 503  | `serviceNotAvailable`                      | Temporary unavailability         | Yes        | Honor `Retry-After`        |
| 507  | `quotaLimitReached`                        | Storage quota exhausted          | No         | n/a for reads              |
| 509  | (bandwidth)                                | Bandwidth cap exceeded           | Yes        | Wait + retry               |

> **Support tip:** capture `request-id` / `client-request-id` from the response — Microsoft support
> needs these to trace a failed call. [DOCUMENTED]

### 8.3 Idempotency [IMPORTANT]

- All connector operations are `GET` → naturally idempotent. [CONFIRMED]
- `if-none-match: {eTag}` → `304 Not Modified` to cheaply check for changes. [DOCUMENTED]
- No idempotency-key header (irrelevant for a read-only connector).

### 8.5 File Handling [IMPORTANT]

| Item              | Value                                                                   | Confidence   |
| ----------------- | ----------------------------------------------------------------------- | ------------ |
| Download endpoint | `GET /me/drive/items/{id}/content` → `302` → preauth URL                | [CONFIRMED]  |
| Download method   | Follow `Location` WITHOUT `Authorization` (avoid token leak)            | [CONFIRMED]  |
| Range support     | `Range: bytes=0-1023` on the **download URL** → `206`                   | [DOCUMENTED] |
| Max size (Numa)   | 100 MB enforced by provider (`MAX_DOWNLOAD_SIZE`)                       | [CONFIRMED]  |
| Upload            | `PUT /content` / upload sessions exist but are out of scope (read-only) | [DOCUMENTED] |

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- Optimistic concurrency via `eTag` (whole item) and `cTag` (content only). [DOCUMENTED]
- delta feed shows **latest state per item**, not each change; the same item may appear more than
  once — use the **last** occurrence, and track by **id** (delta omits `parentReference.path`). [DOCUMENTED]

---

## Phase 9 — Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                         | Fits?   | Notes                                          |
| -------------------------- | --------------------------------------------------- | ------- | ---------------------------------------------- |
| Data Connector             | API has file-like content to browse/search/download | Partial | Subsumed by the Files variant                  |
| **Data Connector (Files)** | API is primarily a file storage/document system     | ✅ YES  | OneDrive IS a file store; Files Remote surface |
| Direct API Only            | Action-oriented, no browsable content               | No      | OneDrive is browsable, not action-oriented     |
| Hybrid                     | Browsable content AND action capabilities           | No      | Connector is read-only file browsing           |

**Selected integration path:** **Data Connector (Files) — Files Remote + selective Graph API.**

**Justification:** OneDrive is a pure file/folder storage system, and Numa **already ships** a
file-browsing backend for it: `lib/oauth-providers/oauth_providers/onedrive_provider.py` subclasses
`OAuthProvider` and implements `list_files`, `download_file`, `get_file_metadata`, and
`search_files` against Microsoft Graph. The registry entry sets `surfaces: ['files', 'chat']` and
`cachingPolicy: CACHING_PRESETS.cloudStorage`, exactly matching the Drive/Dropbox/Gmail
file-browser pattern. This is **not** the spec-driven, chat-only "Direct API via `connect_request`"
path used by NetSuite/Actionstep/simPRO — those have no `lib/oauth-providers/` provider class.
OneDrive sits firmly in the **`lib/oauth-providers/` file-browsing layer**, surfaced through Files
Remote, with the same selective Graph endpoints also reachable from chat. [DECISION]

### 9.2 Connector Requirements [IMPORTANT]

| Connector Method    | Graph Endpoint                                                  | Status / Notes                                                                  |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `list_files`        | `GET /me/drive/root/children` or `/items/{folder-id}/children`  | ✅ Implemented; `$top`≤999, `$select` 8 fields, `$skiptoken` paging [CONFIRMED] |
| `download_file`     | `GET /me/drive/items/{id}/content` (302 → preauth URL)          | ✅ Implemented; strips auth on redirect, 100 MB cap [CONFIRMED]                 |
| `search_files`      | `GET /me/drive/root/search(q='…')` or `/items/{id}/search(...)` | ✅ Implemented; URL-encodes `q`, paged [CONFIRMED]                              |
| `get_file_metadata` | `GET /me/drive/items/{id}?$select=…,cTag,eTag,…`                | ✅ Implemented; prefers sha1 then quickXor hash [CONFIRMED]                     |
| `upload_file`       | `PUT /me/drive/items/{id}/content` / upload session             | ❌ Not implemented (read-only scope)                                            |
| `delete_file`       | `DELETE /me/drive/items/{id}`                                   | ❌ Not implemented (read-only scope)                                            |

| Item               | Value                                                                                            | Confidence  |
| ------------------ | ------------------------------------------------------------------------------------------------ | ----------- |
| Auth type          | OAuth 2.0 (authorization code, Microsoft Entra `/common`)                                        | [CONFIRMED] |
| Connector category | cloud-storage                                                                                    | [CONFIRMED] |
| Caching            | Yes — `CACHING_PRESETS.cloudStorage` (registry)                                                  | [CONFIRMED] |
| Caching rationale  | File metadata/listings are stable enough to cache; content is fetched fresh via short-lived URLs | [INFERRED]  |

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Browse the user's OneDrive (root and any folder) with pagination.
2. Search files by keyword across filename, metadata, and content.
3. Download file content (up to 100 MB) for analysis/summarization.
4. Fetch detailed metadata (size, hashes, timestamps, eTag, webUrl) for a given item.

**CANNOT do (out of scope or dangerous):**

1. Upload, modify, move, copy, or delete files (read-only `Files.Read.All`; no write methods wired).
2. Manage sharing/permissions (`/permissions`, `/invite`, `/createLink`).
3. Reach SharePoint document libraries / other users' drives (no `Sites.Read.All`, `/me/drive` only).

**Default parameters:**

| Parameter    | Default                                                                                | Reason                                        |
| ------------ | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| `$top`       | 100 (capped to 999)                                                                    | Balance latency vs round-trips; Graph max 999 |
| `$select`    | `id,name,size,createdDateTime,lastModifiedDateTime,parentReference,webUrl,folder,file` | Minimal payload for listing                   |
| folder scope | root (`/me/drive/root/children`) when no folder id given                               | Start at drive root                           |
| max download | 100 MB                                                                                 | `MAX_DOWNLOAD_SIZE` guard                     |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK          | Language | Quality   | Maintained? | Worth Using? | Notes                                                           |
| ------------ | -------- | --------- | ----------- | ------------ | --------------------------------------------------------------- |
| msgraph-sdk  | Python   | Excellent | Yes (MS)    | No           | Numa calls Graph via raw httpx in the provider; SDK adds weight |
| graph-client | Node     | Excellent | Yes (MS)    | Situational  | Useful if a Node lambda ever needs Graph                        |
| MSAL         | Py/Node  | Excellent | Yes (MS)    | Auth only    | Token handling is done by Numa's OAuth wizard                   |

---

## Phase 10 — Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified, quality excellent
- [x] Phase 2 complete: auth confirmed against registry + Entra; first call documented (production code)
- [x] Phase 3 complete: drive + driveItem entities, facets, fields, business rules documented
- [x] Phase 4 complete: 6+ critical endpoints with request/response
- [x] Phase 5 complete: query/filter/search/sort documented (search is the primary discovery path)
- [x] Phase 6 complete: cursor pagination with worked example
- [x] Phase 7 complete: subscriptions + delta assessed; polling fallback = delta
- [x] Phase 8 complete: rate limits, error envelope, status codes, retry, file handling documented
- [x] Phase 9 complete: Data Connector (Files) path selected and justified against the shipped provider

**Overall investigation confidence:** high

**Known gaps that will reduce output quality:**

1. Exact per-tenant throttling thresholds are intentionally unpublished by Microsoft (mitigated by
   honoring `Retry-After`). [DOCUMENTED]
2. `$filter` field support on driveItem collections is patchy — `search()` is the reliable path;
   precise `$filter` capabilities per field are [INFERRED], not exhaustively verified.
3. delta/subscriptions are documented but **not yet wired** into the connector (no re-sync layer);
   no production code path corroborates them the way the four file methods are corroborated.

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence  | Gaps                                             |
| ---------------------------- | ------------- | ----------- | ------------------------------------------------ |
| 01-llm-api-rules             | Yes           | High        | None material — endpoints code-verified          |
| 01a-domain-model-reference   | Yes           | High        | Out-of-scope facets (audio/photo/etc.) light     |
| 01b-query-patterns           | Yes           | High        | `$filter` precision is INFERRED                  |
| 01c-mutation-patterns        | N/A           | —           | Read-only connector; no mutations in scope       |
| 01d-event-and-error-handling | Yes           | Medium-High | delta/webhooks documented but not wired          |
| 02-api-spec-investigation    | Yes           | High        | None material                                    |
| 03-connector-setup           | Yes           | High        | Provider already exists — doc the shipped wiring |

---
api_name: 'Google Drive'
connector_id: 'googledrive'
auth_type: 'oauth2'
tier: 'standard'
category: 'cloud-storage'
integration_path: 'data-connector-files (Files-Remote + selective API)'
---

# Google Drive — Connector & Integration Setup

> Build / reference doc for the Google Drive connector. \*\*Integration path: Data Connector (Files)
>
> - selective API** — same shape as Dropbox / OneDrive / Gmail. The connector surfaces in
>   **Files > Remote** and chat, and is backed by a Python `OAuthProvider` subclass — **not\*\* a
>   spec-driven chat-only `connect_request` connector (that is the Actionstep / NetSuite pattern).
>
> **This connector already exists.** The registry entry and the backend provider are committed.
> This document reproduces the real configuration and the deploy/load mechanism rather than
> scaffolding a new one.
>
> Prerequisites: read `00-api-investigation-questionnaire.md`, then `04-connection-and-reauth.md`
> for the OAuth app setup, and activate the `numa-connectors` skill.

---

## Integration Type

**Selected path:** Data Connector (Files) + selective API.

| Component                          | Required? | Status                                                                                             |
| ---------------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| Connector Registry entry           | Yes       | ✅ Done — `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id: 'googledrive'`) |
| Backend provider class             | Yes       | ✅ Done — `lib/oauth-providers/oauth_providers/google_drive_provider.py`                           |
| `ext-api-doc/googledrive/` specs   | Yes       | ✅ Done — this folder (synced to S3, read by the agent)                                            |
| Admin OAuth wizard                 | Yes       | ✅ Generated from the registry entry (no bespoke component)                                        |
| User connect flow (OAuth redirect) | Yes       | ✅ Generated from the registry entry                                                               |
| Feature flag                       | Yes       | `DATA_CONNECTORS_ENABLED` gates data connectors + the Secrets Vault                                |
| OAuth app credentials              | Yes       | ⛔ External — create a Google OAuth client per client (see `04-...`)                               |

---

## 1. Connector Registry Entry (DONE)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

The entry is already committed (`CONNECTOR_REGISTRY`, `id: 'googledrive'`). Reproduced verbatim:

```typescript
{
  id: 'googledrive',
  displayName: 'Google Drive',
  icon: 'bi-google',
  description: 'Access and browse Google Drive files',
  category: 'Cloud Storage',
  authType: 'oauth2',
  oauthPlatform: 'google',
  surfaces: ['files', 'chat'],
  cachingPolicy: CACHING_PRESETS.cloudStorage,
  oauth: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: 'https://www.googleapis.com/auth/drive.readonly',
    extraAuthParams: '{"access_type":"offline","prompt":"consent"}',
    discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
  },
  oauthSetupSteps: [
    'Go to Google Cloud Console → APIs & Services → Credentials',
    'Click "Create Credentials" → "OAuth Client ID"',
    'Select "Web Application" as the application type',
    'Add the redirect URI below under "Authorized redirect URIs"',
    'Copy the Client ID and Client Secret',
  ],
}
```

### Field notes

- **`authType: 'oauth2'`** — drives the generic OAuth wizard. No bespoke wizard component is
  needed; the wizard renders from `oauth` + `oauthSetupSteps`.
- **`oauthPlatform: 'google'`** — this is **load-bearing**. Drive and Gmail both set
  `oauthPlatform: 'google'`, so they **share one Google OAuth client** (one Client ID/Secret per
  workspace), and the vault secret key / redirect-URI slug is the **platform** name, not the
  connector id. `getOAuthSecretId('googledrive')` returns `'google'` (see
  `connectorRegistry.ts:getOAuthSecretId`), so the redirect URI is
  `https://<client>.numa.arcanum.ai/oauth/callback/google` — **not** `.../oauth/callback/googledrive`.
  (Detail covered in `04-connection-and-reauth.md`.)
- **`surfaces: ['files', 'chat']`** — opts the connector into **Files > Remote** (the file picker)
  in addition to chat. `surfacesInFiles('googledrive')` is therefore `true`.
- **`cachingPolicy: CACHING_PRESETS.cloudStorage`** — `{ ttl: 300 }` (5 min). `useRemoteBrowse`
  caches folder listings in memory + sessionStorage for that TTL before refetching.
- **`oauth.scopes`** — a single restricted scope. There is **no** `oauthScopeDefinitions.ts`
  scope-picker entry for Drive (unlike the spec-driven OAuth connectors); the scope is fixed.
- **`extraAuthParams`** — `access_type=offline` + `prompt=consent` so Google issues a long-lived
  refresh token on every consent. The wizard appends these to the authorize URL.
- **No `credentialFields`** — Drive is pure OAuth; there is no instance/region URL to collect
  (unlike Synergy or Actionstep). The base URL is fixed at `https://www.googleapis.com/drive/v3`.

---

## 2. Backend Provider Class (DONE)

> File: `lib/oauth-providers/oauth_providers/google_drive_provider.py`

`GoogleDriveProvider(OAuthProvider)` is committed and implements the full Files-Remote contract.
Key facts (verified against the source):

- `provider_name = "googledrive"` (must match the registry `id` and this folder name).
- `BASE_URL = "https://www.googleapis.com/drive/v3"`.
- **`list_files`** — at the root it returns **virtual** navigation folders, not real Drive items:
  `virtual:my-drive` ("My Drive"), `virtual:shared-with-me` ("Shared with me"), and one
  `shared-drive:<driveId>` per shared drive. Drilling in maps to:
  - My Drive → `q="'root' in parents and trashed=false"`, `corpora=user`
  - Shared with me → `q="sharedWithMe=true and trashed=false"`, `corpora=user`
  - Shared drive → `q="'<driveId>' in parents and trashed=false"`, `corpora=drive&driveId=<id>`
  - Any other folder id → `q="'<id>' in parents and trashed=false"`, `corpora=allDrives`
    It always sends `supportsAllDrives=true` + `includeItemsFromAllDrives=true`, `pageSize` clamped
    to `min(page_size, 1000)`, `orderBy=folder,modifiedTime desc`, and a trimmed `fields` selector.
- **`download_file`** — first `GET /files/{id}?fields=mimeType,name,size`, enforces a size cap,
  then **branches on the `application/vnd.google-apps.` prefix**: native docs → `GET /files/{id}/export`
  with the mapped export mimeType; everything else → `GET /files/{id}?alt=media`.
- **`get_file_metadata`** — `GET /files/{id}?fields=id,name,mimeType,size,modifiedTime,createdTime,parents,md5Checksum,version,permissions`.
  Native mimeTypes are converted to their export equivalents for `content_type`.
- **`search_files`** — escapes the query and builds `q="name contains '<q>' and trashed=false"`
  (**filename-only**, not `fullText`); optionally scoped with `'<folderId>' in parents`.
- **`_get_export_mime_type`** — Doc→DOCX, Sheet→XLSX, Slides→PPTX, Drawing→PDF, Form→ZIP,
  Script→JSON, default→PDF.

> Provider registration: the file lives in `lib/oauth-providers/oauth_providers/` alongside the
> other Files-Remote providers (`dropbox_provider.py`, `onedrive_provider.py`, `gmail_provider.py`).
> The provider factory in `oauth_providers/__init__.py` resolves a provider by `provider_name` /
> `googledrive`. No additional registration is needed for an existing provider — confirm the
> factory mapping is intact if you ever rename it.

---

## 3. `ext-api-doc/googledrive/` — agent knowledge pack & how it ships

The `00`–`04` files in this folder (and especially the `01-*` rules) are the agent's knowledge
pack for Drive. They reach the running workspace agent via S3:

**Deploy mechanism** (`infra/stacks/numa-client-stack.ts`, the "Sync ext-api-doc files to S3"
block at the end of the stack):

- On deploy, the stack walks `ext-api-doc/` recursively, **skips `_templates/`**, and uploads every
  non-dotfile as an `S3Object` to the per-client **ext-api-doc bucket**
  (`core.extApiDocBucket`), keyed by its relative path (e.g. `googledrive/01-llm-api-rules.md`),
  with `contentType: 'text/markdown'` and a `sourceHash` (`Fn.filemd5`) so changed files re-upload.
- At runtime the workspace agent loads the relevant `01-*.md` rules from that bucket **when the
  Google Drive connector is active**, putting Drive's API rules and gotchas into context. You do
  not hand-call Drive HTTP from chat — the agent uses the connector's file-browse / search /
  download tools, with these docs as guidance.

> The folder name (`googledrive`) **must** equal the registry `id` and the provider
> `provider_name`. `tools/check-connector-docs.mjs` enforces this parity — run it after any change
> here.

---

## 4. Feature flag & vault

- **`DATA_CONNECTORS_ENABLED`** gates the whole data-connectors surface (and the Secrets Vault that
  stores the OAuth client + per-user tokens). Drive will not appear unless this flag is on for the
  client.
- **Vault keys** (see `04-connection-and-reauth.md` for detail):
  - Company secret — the shared Google OAuth client, stored under the **`google` platform** key
    (`oauth-client-google`), supplied by the admin in the wizard.
  - User secret — per-user `access_token` + `refresh_token`, captured on the user's OAuth connect.

---

## 5. Deployment Checklist

### Code (already committed)

- [x] Registry entry present (`connectorRegistry.ts`, `id: 'googledrive'`)
- [x] Backend provider present (`google_drive_provider.py`, `provider_name = "googledrive"`)
- [x] `ext-api-doc/googledrive/` specs present (this folder)
- [x] `bi-google` icon resolves (Bootstrap Icons)
- [ ] Parity check passes — `node tools/check-connector-docs.mjs`
- [ ] Frontend lint + typecheck clean

### External / per-client setup (admin + developer)

- [ ] Create a **Google OAuth client** in the client's Google Cloud Console (Web Application type),
      enable the **Drive API**, register the redirect URI
      `https://<client>.numa.arcanum.ai/oauth/callback/google` (see `04-...`)
- [ ] **Restricted-scope readiness:** confirm the OAuth app is verified and (for production)
      has passed the **CASA** assessment for `drive.readonly` — this is an onboarding blocker 🔬
- [ ] Admin enters the Client ID + Secret in the Google OAuth wizard → saved to the company vault
      (shared with Gmail under the `google` platform)
- [ ] Deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` sync); `DATA_CONNECTORS_ENABLED` on
- [ ] **Phase 2 smoke test** with a real consent (see `04-connection-and-reauth.md`)

### Functionality

- [ ] Files > Remote shows "Google Drive" with the Google icon
- [ ] Root shows My Drive / Shared with me / shared drives
- [ ] Browse into a folder lists files + sub-folders
- [ ] Filename search returns results
- [ ] Download a binary file (e.g. a PDF) returns bytes
- [ ] Export a Google Doc returns DOCX bytes
- [ ] File metadata (size, modified, permissions) displays

### Workspace Agent

- [ ] `01-*` rules load when Drive is active (agent knows the gotchas)
- [ ] Agent can list / search / download / export via the files tool

---

## 6. Testing Plan

### Manual sequence

1. **Admin setup:** open the Google OAuth wizard, enter the Google Client ID/Secret, copy the
   redirect URI (`.../oauth/callback/google`) into the Google Cloud Console, save.
2. **User connect:** click Connect → consent on `accounts.google.com` (`drive.readonly`) → token
   exchange. Because `prompt=consent` is set, expect a `refresh_token` in the response.
3. **Smoke test (Phase 2 gate):** ask the agent to "list my Google Drive files" → root returns
   the virtual folders; drilling into My Drive runs `GET /files?q='root' in parents and trashed=false`.
4. **Search:** "find files named quarterly" → `q=name contains 'quarterly' and trashed=false`.
5. **Download binary:** download a PDF → `GET /files/{id}?alt=media`.
6. **Export native:** open a Google Doc → `GET /files/{id}/export?mimeType=...wordprocessingml.document`
   returns DOCX.
7. **Shared drive:** browse a shared drive → `corpora=drive&driveId=<id>` items appear (proves
   `supportsAllDrives`/`includeItemsFromAllDrives` are set).
8. **User disconnect:** disconnect removes the **user** token only; the shared `google` company
   client stays (still used by Gmail and other users).

### Edge cases

- [ ] Empty folder / no search results
- [ ] `?alt=media` on a Google-native doc → `403 fileNotDownloadable` handled (falls to export)
- [ ] Native file > 10 MB export cap → fall back to `exportLinks`
- [ ] 401 → connector refreshes the access token and retries
- [ ] 403 `userRateLimitExceeded` / 429 → exponential backoff
- [ ] File over the provider's `MAX_DOWNLOAD_SIZE` → `FILE_TOO_LARGE` raised before download
- [ ] Special characters / single quotes in a search term (provider escapes `\` and `'`)

---

## Sources

- Registry entry: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id: 'googledrive'`)
- Backend provider: `lib/oauth-providers/oauth_providers/google_drive_provider.py`
- Deploy/load: `infra/stacks/numa-client-stack.ts` (ext-api-doc → S3 sync block)
- Drive API: https://developers.google.com/workspace/drive/api/reference/rest/v3
- Restricted scopes / verification: https://developers.google.com/workspace/drive/api/guides/api-specific-auth

_Generated from the investigation questionnaire. Pair with the `numa-connectors` skill._

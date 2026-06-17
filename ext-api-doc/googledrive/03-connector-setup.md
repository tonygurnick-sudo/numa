---
api_name: Google Drive
connector_id: googledrive
auth_type: oauth2
oauth_platform: google
tier: standard
category: cloud-storage
integration_path: data-connector-files (Files-Remote + selective API) — same shape as Dropbox / OneDrive / Gmail; backed by a Python OAuthProvider subclass, NOT a spec-driven `connect_request` connector (Actionstep/NetSuite pattern)
call_surface: file-store connector (list-files/search-files/download-file); NOT `numa integrations request`
status: ALREADY EXISTS — registry entry + backend provider committed. This doc reproduces the real config + deploy/load mechanism, not new scaffolding.
prerequisites: read 00-questionnaire, then 04-connection-and-reauth (OAuth app setup); activate the `numa-connectors` skill
---

# Google Drive — Connector & Integration Setup

Surfaces in **Files > Remote** and chat.

## Integration Components

| Component                          | Required? | Status                                                                                     |
| ---------------------------------- | --------- | ------------------------------------------------------------------------------------------ |
| Connector Registry entry           | Yes       | ✅ `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id:'googledrive'`) |
| Backend provider class             | Yes       | ✅ `lib/oauth-providers/oauth_providers/google_drive_provider.py`                          |
| `ext-api-doc/googledrive/` specs   | Yes       | ✅ this folder (synced to S3, read by the agent)                                           |
| Admin OAuth wizard                 | Yes       | ✅ Generated from registry entry (no bespoke component)                                    |
| User connect flow (OAuth redirect) | Yes       | ✅ Generated from registry entry                                                           |
| Feature flag                       | Yes       | `DATA_CONNECTORS_ENABLED` gates data connectors + Secrets Vault                            |
| OAuth app credentials              | Yes       | ⛔ External — create a Google OAuth client per client (see 04)                             |

## 1. Connector Registry Entry (DONE)

`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, `CONNECTOR_REGISTRY`, `id:'googledrive'`, verbatim:

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

**Field notes:**

- `authType:'oauth2'` — drives the generic OAuth wizard (renders from `oauth` + `oauthSetupSteps`); no bespoke component.
- `oauthPlatform:'google'` — **load-bearing.** Drive and Gmail both set it, so they **share one Google OAuth client** (one Client ID/Secret per workspace); the vault secret key + redirect-URI slug are the **platform** name. `getOAuthSecretId('googledrive')==='google'`, so redirect URI is `https://<client>.numa.arcanum.ai/oauth/callback/google` — **NOT** `.../googledrive`. (Detail in 04.)
- `surfaces:['files','chat']` — opts into **Files > Remote** plus chat; `surfacesInFiles('googledrive')`=`true`.
- `cachingPolicy:CACHING_PRESETS.cloudStorage` — `{ttl:300}` (5 min); `useRemoteBrowse` caches folder listings in memory + sessionStorage for that TTL.
- `oauth.scopes` — single restricted scope; **no** `oauthScopeDefinitions.ts` scope-picker entry (scope is fixed).
- `extraAuthParams` — `access_type=offline` + `prompt=consent` so Google issues a long-lived refresh token on every consent.
- **No `credentialFields`** — pure OAuth; no instance/region URL to collect (unlike Synergy/Actionstep). Base URL fixed.

## 2. Backend Provider Class (DONE)

`lib/oauth-providers/oauth_providers/google_drive_provider.py` — `GoogleDriveProvider(OAuthProvider)`, full Files-Remote contract. Verified against source:

- `provider_name = "googledrive"` (must match registry `id` and this folder name).
- `BASE_URL = "https://www.googleapis.com/drive/v3"`.
- **`list_files`** — at root returns **virtual** navigation folders, not real items: `virtual:my-drive`, `virtual:shared-with-me`, one `shared-drive:<driveId>` per shared drive. Drill-in maps:
  - My Drive → `q="'root' in parents and trashed=false"`, `corpora=user`
  - Shared with me → `q="sharedWithMe=true and trashed=false"`, `corpora=user`
  - Shared drive → `q="'<driveId>' in parents and trashed=false"`, `corpora=drive&driveId=<id>`
  - Any other folder id → `q="'<id>' in parents and trashed=false"`, `corpora=allDrives`
    Always sends `supportsAllDrives=true` + `includeItemsFromAllDrives=true`, `pageSize` clamped `min(page_size,1000)`, `orderBy=folder,modifiedTime desc`, trimmed `fields` selector.
- **`download_file`** — first `GET /files/{id}?fields=mimeType,name,size`, enforces size cap, then **branches on the `application/vnd.google-apps.` prefix**: native docs → `GET /files/{id}/export` with mapped export mimeType; else → `GET /files/{id}?alt=media`.
- **`get_file_metadata`** — `GET /files/{id}?fields=id,name,mimeType,size,modifiedTime,createdTime,parents,md5Checksum,version,permissions`. Native mimeTypes converted to export equivalents for `content_type`.
- **`search_files`** — escapes query, builds `q="name contains '<q>' and trashed=false"` (**filename-only**, not `fullText`); optionally scoped with `'<folderId>' in parents`.
- **`_get_export_mime_type`** — Doc→DOCX, Sheet→XLSX, Slides→PPTX, Drawing→PDF, Form→ZIP, Script→JSON, default→PDF.

Provider lives alongside other Files-Remote providers (`dropbox_provider.py`, `onedrive_provider.py`, `gmail_provider.py`); the factory in `oauth_providers/__init__.py` resolves by `provider_name`=`googledrive`. No extra registration for an existing provider — confirm the factory mapping is intact if you rename it.

## 3. ext-api-doc → S3 (agent knowledge pack)

The `00`–`04` files (especially `01-*` rules) are the agent's Drive knowledge pack, shipped via S3.
**Deploy** (`infra/stacks/numa-client-stack.ts`, "Sync ext-api-doc files to S3" block): on deploy the stack walks `ext-api-doc/` recursively, **skips `_templates/`**, uploads every non-dotfile as an `S3Object` to the per-client **ext-api-doc bucket** (`core.extApiDocBucket`), keyed by relative path (e.g. `googledrive/01-llm-api-rules.md`), `contentType:'text/markdown'`, with a `sourceHash` (`Fn.filemd5`) so changed files re-upload.
**Runtime:** agent loads the relevant `01-*.md` rules from that bucket **when the Google Drive connector is active**. The agent uses the connector's file-browse/search/download tools (not hand-called HTTP), with these docs as guidance.

> Folder name (`googledrive`) **must** equal the registry `id` and provider `provider_name`. `tools/check-connector-docs.mjs` enforces this parity — run after any change here.

## 4. Feature flag & vault

- **`DATA_CONNECTORS_ENABLED`** gates the whole data-connectors surface + the Secrets Vault (OAuth client + per-user tokens). Drive won't appear unless on for the client.
- **Vault keys** (detail in 04):
  - Company secret — shared Google OAuth client, stored under the **`google` platform** key (`oauth-client-google`), supplied by admin in the wizard.
  - User secret — per-user `access_token` + `refresh_token`, captured on the user's OAuth connect.

## 5. Deployment Checklist

**Code (committed):**

- [x] Registry entry (`connectorRegistry.ts`, `id:'googledrive'`)
- [x] Backend provider (`google_drive_provider.py`, `provider_name="googledrive"`)
- [x] `ext-api-doc/googledrive/` specs (this folder)
- [x] `bi-google` icon resolves (Bootstrap Icons)
- [ ] Parity check passes — `node tools/check-connector-docs.mjs`
- [ ] Frontend lint + typecheck clean

**External / per-client (admin + dev):**

- [ ] Create a **Google OAuth client** (Web Application) in the client's Google Cloud Console, enable the **Drive API**, register redirect URI `https://<client>.numa.arcanum.ai/oauth/callback/google` (see 04)
- [ ] **Restricted-scope readiness:** confirm OAuth app verified and (production) passed **CASA** for `drive.readonly` — onboarding blocker 🔬
- [ ] Admin enters Client ID + Secret in the Google OAuth wizard → company vault (shared with Gmail under `google` platform)
- [ ] Deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` sync); `DATA_CONNECTORS_ENABLED` on
- [ ] **Phase 2 smoke test** with a real consent (see 04)

## 6. Testing Plan (verifies the Functionality + Workspace-Agent gates)

**Manual sequence** (each step is also the functional acceptance check):

1. **Admin setup:** open Google OAuth wizard, enter Client ID/Secret, copy redirect URI (`.../oauth/callback/google`) into Google Cloud Console, save.
2. **User connect:** Connect → consent on `accounts.google.com` (`drive.readonly`) → token exchange. `prompt=consent` set → expect a `refresh_token`.
3. **Files > Remote** shows "Google Drive" with the Google icon.
4. **Smoke test (Phase 2 gate):** "list my Google Drive files" → root returns the virtual folders (My Drive / Shared with me / shared drives); drilling into My Drive runs `GET /files?q='root' in parents and trashed=false` and lists files + sub-folders.
5. **Search:** "find files named quarterly" → `q=name contains 'quarterly' and trashed=false` returns results.
6. **Download binary:** download a PDF → `GET /files/{id}?alt=media` returns bytes.
7. **Export native:** open a Google Doc → `GET /files/{id}/export?mimeType=...wordprocessingml.document` returns DOCX.
8. **Metadata:** file size / modified / permissions display (via `get_file_metadata`).
9. **Shared drive:** browse a shared drive → `corpora=drive&driveId=<id>` items appear (proves `supportsAllDrives`/`includeItemsFromAllDrives` set).
10. **Agent:** `01-*` rules load when Drive is active (agent knows the gotchas); agent can list/search/download/export via the files tool.
11. **User disconnect:** removes the **user** token only; the shared `google` company client stays (used by Gmail + other users).

**Edge cases:**

- [ ] Empty folder / no search results
- [ ] `?alt=media` on a native doc → `403 fileNotDownloadable` handled (falls to export)
- [ ] Native file > 10 MB export cap → fall back to `exportLinks`
- [ ] 401 → connector refreshes access token + retries
- [ ] 403 `userRateLimitExceeded` / 429 → exponential backoff
- [ ] File over provider's `MAX_DOWNLOAD_SIZE` → `FILE_TOO_LARGE` raised before download
- [ ] Special characters / single quotes in a search term (provider escapes `\` and `'`)

## Sources

- Registry: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id:'googledrive'`)
- Provider: `lib/oauth-providers/oauth_providers/google_drive_provider.py`
- Deploy/load: `infra/stacks/numa-client-stack.ts` (ext-api-doc → S3 sync block)
- Drive API: https://developers.google.com/workspace/drive/api/reference/rest/v3
- Restricted scopes / verification: https://developers.google.com/workspace/drive/api/guides/api-specific-auth

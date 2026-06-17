---
api_name: Dropbox
connector_id: dropbox
auth_type: oauth2
tier: standard
category: cloud-storage
integration_path: data-connector-files (Files Remote) + selective API
status: connector already exists and is committed — this doc describes the actual wiring, not new scaffolding
prereqs: read 00-api-investigation-questionnaire.md + 02-api-spec-investigation.md; activate the numa-connectors skill
---

# Dropbox — Connector & Integration Setup

**Integration path: Data Connector (Files)** — same shape as Google Drive / OneDrive / Box. Surfaced in **Files > Remote** and chat; executable integration is the backend **provider class** (`lib/oauth-providers/oauth_providers/dropbox_provider.py`), not a spec-driven chat-only `request` path.

## Integration components

| Component                    | Required? | Status                                                         |
| ---------------------------- | --------- | -------------------------------------------------------------- |
| Connector Registry entry     | Yes       | ✅ `connectorRegistry.ts` (id `dropbox`)                       |
| Backend provider class       | Yes       | ✅ `dropbox_provider.py` (`DropboxProvider`)                   |
| Provider registration        | Yes       | ✅ Automatic — auto-discovered, no manual edit                 |
| `ext-api-doc/dropbox/` specs | Yes       | ✅ this folder (agent reference)                               |
| Admin OAuth wizard           | Yes       | ✅ generated from registry (no bespoke code)                   |
| User integration (Connect)   | Yes       | ✅ generated from registry (no bespoke code)                   |
| Feature flag                 | Yes       | `DATA_CONNECTORS_ENABLED` gates the whole Files-Remote surface |
| OAuth app credentials        | Yes       | ⛔ external — admin self-serves from the Dropbox App Console   |

## 1. Connector Registry Entry (DONE)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`. Actual committed object for id `dropbox`:

```typescript
{
  id: 'dropbox',
  displayName: 'Dropbox',
  icon: 'bi-dropbox',
  description: 'Access and browse Dropbox files',
  category: 'Cloud Storage',
  cachingPolicy: CACHING_PRESETS.cloudStorage,   // { ttl: 300 } — 5 min
  authType: 'oauth2',
  surfaces: ['files', 'chat'],                    // → Files > Remote AND chat
  oauth: {
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: 'files.metadata.read files.content.read',
    extraAuthParams: '{"token_access_type":"offline"}',   // → issues a refresh token
    discoveryUrl: 'https://www.dropbox.com/.well-known/openid-configuration',
  },
  oauthSetupSteps: [
    'Go to Dropbox App Console → Create app',
    'Choose "Scoped access" and "Full Dropbox" access type',
    'Under Settings → OAuth 2 → Redirect URIs, add the redirect URI below',
    'Copy the App key (Client ID) and App secret (Client Secret)',
  ],
}
```

Notes:

- **`surfaces:['files','chat']`** opts Dropbox into the Files > Remote browser (default is `['chat']` only) — the marker distinguishing a file-browsing connector from an API-only one.
- **`extraAuthParams:'{"token_access_type":"offline"}'`** is load-bearing — without it Dropbox returns no refresh token and the connection dies after ~4h. It's a JSON **string** (wizard parses and appends it to the authorize URL).
- **`cachingPolicy`** = `{ ttl: 300 }` — listing/search/metadata cached 5 min; `rev`/`content_hash` make ideal content cache keys.
- `oauthSetupSteps` render verbatim in the admin wizard. `displayName`/`description`/`category` are literal strings (not i18n keys) — matching every other registry entry; no extra i18n keys needed.

## 2. Backend Provider Class (DONE)

File: `lib/oauth-providers/oauth_providers/dropbox_provider.py` — class `DropboxProvider`. The **executable** integration: subclasses `OAuthProvider`, implements the four Files-Remote methods against Dropbox API v2.

| Method              | Dropbox endpoint(s)                               | Implementation notes                                                                                             |
| ------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `list_files`        | `/2/files/list_folder` (+`/list_folder/continue`) | `folder_id`/`"root"`/null → `path:""`; `limit=min(page_size,2000)`; `page_token`→continue cursor                 |
| `download_file`     | `/2/files/download` (content host)                | path in `Dropbox-API-Arg` header; returns `response.content` (bytes)                                             |
| `get_file_metadata` | `/2/files/get_metadata`                           | maps `server_modified`→`modified_at`, `client_modified`→`created_at`, `content_hash`→`checksum`, `rev`→`version` |
| `search_files`      | `/2/files/search_v2` (+`/search/continue_v2`)     | reads double-nested `match.metadata.metadata`; `max_results=min(page_size,1000)`; `file_status:"active"`         |

Key constants:

```python
BASE_URL    = "https://api.dropboxapi.com/2"        # metadata / JSON-RPC
CONTENT_URL = "https://content.dropboxapi.com/2"    # binary download

@property
def provider_name(self) -> str:
    return "dropbox"                                # MUST equal the registry id
```

All requests go through the base class `_make_request_with_retry` (single place for `Retry-After`/backoff on `429`). `_get_content_type_from_name` maps file extensions to MIME (Dropbox returns no content type).

**Known provider gaps (backlog, not blockers):** 1) `path_display` used as `file_id`/`folder_id` → ids break on rename/move (stable `id:...` exists). 2) `has_subfolders` hard-coded `False` (avoids a second call). 3) `web_view_link` is `None`, `permissions` is `{}` (no `sharing.read`).

## 3. Provider Registration — AUTOMATIC (no edit needed)

File: `lib/oauth-providers/oauth_providers/__init__.py`. No manual registry edit — the package auto-discovers: scans every `*_provider.py`, finds concrete `OAuthProvider` subclasses, instantiates each to read `provider_name`, builds `PROVIDERS={provider_name:class}`. `create_provider("dropbox",...)` resolves `DropboxProvider`.
**Contract:** `DropboxProvider.provider_name` (`"dropbox"`) must exactly equal the registry `id` (`'dropbox'`) and this folder name (`ext-api-doc/dropbox/`). All three already match.

## 4. ext-api-doc Deployment (how the agent gets these docs)

The `01-*.md` files are the workspace agent's Dropbox knowledge pack, shipped per-client at deploy time:

- **Generation/sync:** `infra/stacks/numa-client-stack.ts` walks `ext-api-doc/` recursively (excluding `_templates/`), creates an `S3Object` per file keyed by relative path into the per-client **ext-api-doc S3 bucket** (`core.extApiDocBucket`). Files change-detect via `Fn.filemd5(source)` — editing a doc and redeploying re-uploads only what changed.
- **Runtime load:** when the Dropbox connector is active, the agent loads `01-llm-api-rules.md` (+ `01a`–`01d`) from that bucket into context. The folder name `dropbox` matching the registry id is what lets the agent locate the right pack.
- **Parity:** `tools/check-connector-docs.mjs` enforces `ext-api-doc/<id>/` folder name == registry id.
- Editing only `02`/`03`/`04` does NOT change agent behavior — the agent loads only the `01-*` files; `02`–`04` are for humans.

## 5. Deployment Checklist

**Code (done in repo):** [x] registry entry committed (`connectorRegistry.ts`, id `dropbox`, `surfaces:['files','chat']`) · [x] backend provider committed (`dropbox_provider.py`, `provider_name=="dropbox"`) · [x] provider auto-discovered · [x] `ext-api-doc/dropbox/` specs committed (folder name matches id) · [x] connector-docs parity passes (`node tools/check-connector-docs.mjs`).
**External / deploy:** [ ] `DATA_CONNECTORS_ENABLED` on for the target client (gates Files > Remote + vault) · [ ] admin creates a Dropbox app + supplies App key + App secret (see 04) · [ ] admin registers the Numa redirect URI in the Dropbox app (shown in wizard) · [ ] deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` S3 sync) · [ ] **Phase 2 smoke test** — close the live-call gate (see 04).

## 6. Testing Plan

**Manual sequence:**

1. **Admin setup:** open the Dropbox OAuth wizard, paste App key/secret, copy the shown redirect URI into the Dropbox App Console, save.
2. **User connect:** Connect → authorize on `www.dropbox.com/oauth2/authorize` (consent shows `files.metadata.read`+`files.content.read`) → token exchange returns access + refresh tokens.
3. **Browse (Files > Remote):** open Dropbox → expect account root (`list_folder path:""`); open a subfolder → `list_folder path:"/Sub"`.
4. **Smoke test (Phase 2 gate):** ask the agent "list my Dropbox files" → expect a `list_folder` call returning `{entries,cursor,has_more}`.
5. **Search:** "find invoices in my Dropbox" → `search_v2` (verify double-nested matches resolve).
6. **Download/analyze:** "summarize the latest report in my Dropbox" → `download` on the content host returns bytes, agent ingests.
7. **Metadata:** confirm size / modified time / version display correctly.
8. **User disconnect:** removes the user secret only.

**Edge cases:** [ ] root vs `/` — `""` works, `"/"` never sent (provider maps `root`/null→`""`) · [ ] 401 → connector refreshes access token, retries once · [ ] 409 `path/not_found` (stale path after rename/move) → re-list parent · [ ] 409 `unsupported_file` (Dropbox Paper) → skip/export · [ ] 429 → honor `Retry-After`, backoff · [ ] pagination beyond one page (`has_more`→`continue` cursor) · [ ] non-ASCII in `Dropbox-API-Arg` (must be `\uXXXX`-escaped on download) · [ ] large file download streams without OOM.

## Sources

- HTTP reference: https://www.dropbox.com/developers/documentation/http/documentation
- OAuth guide: https://developers.dropbox.com/oauth-guide
- Error handling: https://developers.dropbox.com/error-handling-guide
- Detecting changes (delta): https://developers.dropbox.com/detecting-changes-guide
- App Console: https://www.dropbox.com/developers/apps

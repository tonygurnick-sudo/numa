---
api_name: 'Dropbox'
connector_id: 'dropbox'
auth_type: 'oauth2'
tier: 'standard'
category: 'cloud-storage'
integration_path: 'data-connector-files (Files Remote) + selective API'
---

# Dropbox — Connector & Integration Setup

> Build/reference notes for the Dropbox connector. **Integration path: Data Connector (Files)** —
> same shape as Google Drive / OneDrive / Box. The connector is surfaced in **Files > Remote** and
> chat, and the executable integration is the backend **provider class**
> (`lib/oauth-providers/oauth_providers/dropbox_provider.py`), not a spec-driven chat-only request
> path.
>
> **The connector already exists and is committed.** This document reproduces and describes the
> _actual_ wiring rather than scaffolding new code.
>
> Prerequisites: read `00-api-investigation-questionnaire.md` + `02-api-spec-investigation.md`, and
> activate the `numa-connectors` skill.

---

## Integration Type

**Selected path:** Data Connector (Files) + selective API

| Component                    | Required? | Status                                                         |
| ---------------------------- | --------- | -------------------------------------------------------------- |
| Connector Registry entry     | Yes       | ✅ Done — `connectorRegistry.ts` (id `dropbox`)                |
| Backend provider class       | Yes       | ✅ Done — `dropbox_provider.py` (`DropboxProvider`)            |
| Provider registration        | Yes       | ✅ Automatic — auto-discovered, no manual edit                 |
| `ext-api-doc/dropbox/` specs | Yes       | ✅ Done — this folder (agent reference)                        |
| Admin OAuth wizard           | Yes       | ✅ Generated from registry (no bespoke code)                   |
| User integration (Connect)   | Yes       | ✅ Generated from registry (no bespoke code)                   |
| Feature flag                 | Yes       | `DATA_CONNECTORS_ENABLED` gates the whole Files-Remote surface |
| OAuth app credentials        | Yes       | ⛔ External — admin self-serves from the Dropbox App Console   |

---

## 1. Connector Registry Entry (DONE)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

The entry is already committed. This is the **actual** registry object for id `dropbox`:

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

Notes on the actual config:

- **`surfaces: ['files', 'chat']`** is what opts Dropbox into the Files > Remote browser (the
  default is `['chat']` only). This is the marker that distinguishes a file-browsing connector
  from an API-only one.
- **`extraAuthParams: '{"token_access_type":"offline"}'`** is the load-bearing part of the OAuth
  config — without it Dropbox does not return a refresh token, and the connection would die after
  ~4 hours. It is a JSON **string** (the wizard parses and appends it to the authorize URL).
- **`cachingPolicy: CACHING_PRESETS.cloudStorage`** = `{ ttl: 300 }`. Listing/search/metadata
  results are cached 5 minutes; `rev` / `content_hash` make ideal cache keys for content.
- **`oauthSetupSteps`** render verbatim in the admin OAuth wizard.
- `displayName`, `description`, and `category` are literal strings here (not i18n keys) — matching
  every other registry entry; no extra i18n keys are needed for this connector.

---

## 2. Backend Provider Class (DONE)

> File: `lib/oauth-providers/oauth_providers/dropbox_provider.py` — class `DropboxProvider`

This is the **executable** integration. It subclasses `OAuthProvider` and implements the four
Files-Remote methods against Dropbox API v2:

| Connector method    | Dropbox endpoint(s)                                | Implementation notes                                                                                             |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `list_files`        | `/2/files/list_folder` (+ `/list_folder/continue`) | `folder_id`/`"root"`/null → `path: ""`; `limit=min(page_size,2000)`; `page_token` → continue cursor              |
| `download_file`     | `/2/files/download` (content host)                 | path in `Dropbox-API-Arg` header; returns `response.content` (bytes)                                             |
| `get_file_metadata` | `/2/files/get_metadata`                            | maps `server_modified`→`modified_at`, `client_modified`→`created_at`, `content_hash`→`checksum`, `rev`→`version` |
| `search_files`      | `/2/files/search_v2` (+ `/search/continue_v2`)     | reads the double-nested `match.metadata.metadata`; `max_results=min(page_size,1000)`; `file_status: "active"`    |

Key constants in the class:

```python
BASE_URL    = "https://api.dropboxapi.com/2"        # metadata / JSON-RPC
CONTENT_URL = "https://content.dropboxapi.com/2"    # binary download

@property
def provider_name(self) -> str:
    return "dropbox"                                # MUST equal the registry id
```

All requests go through the base class's `_make_request_with_retry` (the single place that should
honor `Retry-After` / backoff on `429`). `_get_content_type_from_name` maps file extensions to MIME
types since Dropbox does not return a content type.

**Known provider gaps (improvement backlog, not blockers):**

1. Uses `path_display` as `file_id`/`folder_id` → ids break on rename/move (stable `id:...` exists).
2. `has_subfolders` is hard-coded `False` (avoids a second call) — the folder tree can't pre-know.
3. `web_view_link` is `None` and `permissions` is `{}` (no `sharing.read` scope requested).

---

## 3. Provider Registration — AUTOMATIC (no edit needed)

> File: `lib/oauth-providers/oauth_providers/__init__.py`

There is **no manual registry edit** for Dropbox. The package auto-discovers providers: `__init__`
scans every `*_provider.py` module, finds concrete `OAuthProvider` subclasses, instantiates each to
read its `provider_name`, and builds `PROVIDERS = { provider_name: class }`. `create_provider("dropbox", ...)`
then resolves `DropboxProvider`.

**The contract:** `DropboxProvider.provider_name` (`"dropbox"`) **must exactly equal** the registry
`id` (`'dropbox'`) and this folder name (`ext-api-doc/dropbox/`). All three already match.

---

## 4. ext-api-doc Deployment (how the agent gets these docs)

The `01-*.md` files in this folder are the workspace agent's knowledge pack for Dropbox. They are
shipped to each client at deploy time:

- **Generation/sync:** `infra/stacks/numa-client-stack.ts` walks `ext-api-doc/` recursively
  (excluding `_templates/`) and creates an `S3Object` for every file, keyed by its relative path,
  into the per-client **ext-api-doc S3 bucket** (`core.extApiDocBucket`). Files change-detect via
  `Fn.filemd5(source)`, so editing a doc and redeploying re-uploads only what changed.
- **Runtime load:** when the Dropbox connector is active, the workspace agent loads
  `01-llm-api-rules.md` (and the `01a`–`01d` companions) from that bucket into its context. The
  folder name `dropbox` matching the registry id is what lets the agent locate the right pack.
- **Parity:** `tools/check-connector-docs.mjs` enforces that the `ext-api-doc/<id>/` folder name
  lines up with the registry id.

> Editing only the `02`/`03`/`04` docs (developer/build reference) does not change agent behavior —
> the agent loads the `01-*` files. `02`–`04` are for humans.

---

## 5. Deployment Checklist

### Code (already done in the repo)

- [x] Registry entry committed (`connectorRegistry.ts`, id `dropbox`, `surfaces: ['files','chat']`)
- [x] Backend provider committed (`dropbox_provider.py`, `provider_name == "dropbox"`)
- [x] Provider auto-discovered (no `__init__.py` edit required)
- [x] `ext-api-doc/dropbox/` specs committed (folder name matches id)
- [x] Connector-docs parity check passes (`node tools/check-connector-docs.mjs`)

### External / deploy (developer + admin)

- [ ] Ensure `DATA_CONNECTORS_ENABLED` is on for the target client (gates Files > Remote + vault)
- [ ] Admin creates a Dropbox app in the App Console and supplies App key + App secret
      (see `04-connection-and-reauth.md`)
- [ ] Admin registers the Numa redirect URI in the Dropbox app (shown in the wizard)
- [ ] Deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` S3 sync)
- [ ] **Phase 2 smoke test** — close the live-call gate (see `04-connection-and-reauth.md`)

---

## 6. Testing Plan

### Manual sequence

1. **Admin setup:** open the Dropbox OAuth wizard, paste App key/secret, copy the shown redirect
   URI into the Dropbox App Console, save.
2. **User connect:** click Connect → authorize on `www.dropbox.com/oauth2/authorize` (consent shows
   `files.metadata.read` + `files.content.read`) → token exchange returns access + refresh tokens.
3. **Browse (Files > Remote):** open Dropbox → expect the account root (`list_folder` with
   `path: ""`). Open a subfolder → `list_folder` with `path: "/Sub"`.
4. **Smoke test (Phase 2 gate):** ask the agent to "list my Dropbox files" → expect a
   `list_folder` call returning `{ entries, cursor, has_more }`.
5. **Search:** "find invoices in my Dropbox" → `search_v2` (verify double-nested matches resolve).
6. **Download / analyze:** "summarize the latest report in my Dropbox" → `download` on the content
   host returns bytes, agent ingests.
7. **Metadata:** confirm size / modified time / version display correctly.
8. **User disconnect:** disconnect removes the user secret only.

### Edge cases

- [ ] Root vs `/` — confirm `""` works and `"/"` is never sent (provider maps `root`/null → `""`)
- [ ] 401 → connector refreshes the access token with the refresh token, retries once
- [ ] 409 `path/not_found` (stale path after rename/move) → re-list parent
- [ ] 409 `unsupported_file` (Dropbox Paper) → skip / export
- [ ] 429 → honor `Retry-After`, backoff
- [ ] Pagination beyond one page (`has_more` → `continue` cursor)
- [ ] Special characters / non-ASCII in `Dropbox-API-Arg` (must be `\uXXXX`-escaped on download)
- [ ] Large file download streams without OOM

---

## Sources

- HTTP reference: https://www.dropbox.com/developers/documentation/http/documentation
- OAuth guide: https://developers.dropbox.com/oauth-guide
- Error handling: https://developers.dropbox.com/error-handling-guide
- Detecting changes (delta): https://developers.dropbox.com/detecting-changes-guide
- App Console: https://www.dropbox.com/developers/apps

_Generated from the investigation questionnaire. Pair with the `numa-connectors` skill. Cites the
real registry entry at `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`._

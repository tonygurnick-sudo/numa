---
api_name: OneDrive (Microsoft Graph)
connector_id: onedrive
auth_type: oauth2
tier: standard
category: cloud-storage
integration_path: data-connector-files
call_surface: file-browse CLI (list-files/search-files/download-file/get-file-metadata), NOT chat-action `request`
status: SHIPPED — registry entry, backend provider, and 01* rules all committed
---

# OneDrive (Microsoft Graph) — Connector & Integration Setup

Build/reference doc. **Integration path: Data Connector (Files)** — Files Remote + selective Graph API. Same shape as Google Drive and Dropbox: an OAuth2 connector with a `lib/oauth-providers/` backend provider class and `surfaces: ['files', 'chat']`. This connector **already ships** — this document describes the **actual** wiring (reproduce/maintain), not a greenfield checklist.

Prerequisites: read `00-api-investigation-questionnaire.md` / `02-api-spec-investigation.md`; activate the `numa-connectors` skill.

## Components

| Component                                  | Status                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| Connector Registry entry                   | ✅ `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`    |
| Backend provider class                     | ✅ `lib/oauth-providers/oauth_providers/onedrive_provider.py`            |
| Provider registration                      | ✅ Automatic — auto-discovery in `oauth_providers/__init__.py` (no edit) |
| `ext-api-doc/onedrive/` agent rules        | ✅ this folder (01 + 01a–01d)                                            |
| Admin OAuth wizard                         | ✅ generated from the registry entry (no bespoke component)              |
| User integration (Connect)                 | ✅ generated from the registry entry                                     |
| OAuth app credentials (Client ID + Secret) | ⛔ External — admin registers an Azure app, supplies at setup            |
| Feature flag                               | `DATA_CONNECTORS_ENABLED` gates all data connectors + the Secrets Vault  |

## 1. Connector Registry Entry (DONE)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (grep `id: 'onedrive'`). Verbatim:

```typescript
{
  id: 'onedrive',
  displayName: 'OneDrive',
  icon: 'bi-microsoft',
  description: 'Access and browse Microsoft OneDrive files',
  category: 'Cloud Storage',
  authType: 'oauth2',
  oauthPlatform: 'microsoft',
  surfaces: ['files', 'chat'],
  cachingPolicy: CACHING_PRESETS.cloudStorage,
  oauth: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: 'https://graph.microsoft.com/Files.Read.All offline_access',
    extraAuthParams: '{"response_mode":"query"}',
    discoveryUrl: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
  },
  oauthSetupSteps: [
    'Go to Azure Portal → App registrations → New registration',
    'Set a name and choose "Accounts in any organizational directory"',
    'Under "Redirect URIs", add the redirect URI shown below as type "Web"',
    'Go to Certificates & secrets → New client secret → copy the Value',
    'Copy the Application (client) ID from the Overview page',
  ],
}
```

Key facts (source of truth for auth):

- `authType: 'oauth2'` + `oauthPlatform: 'microsoft'` — Microsoft Entra OAuth flow.
- `surfaces: ['files', 'chat']` — appears in **Files Remote** AND usable from chat (this is what makes it a Files connector; vs Actionstep/NetSuite which are `['chat']` only).
- `cachingPolicy: CACHING_PRESETS.cloudStorage` — metadata/listings cached; content fetched fresh via the short-lived preauth download URL.
- `scopes: 'https://graph.microsoft.com/Files.Read.All offline_access'` — **read-only** + refresh token. Space-separated single string.
- `extraAuthParams: '{"response_mode":"query"}'` — Entra returns the auth code as a query param (not fragment), consumed by the wizard.
- `discoveryUrl` — OIDC discovery for the `/common` multi-tenant endpoint.
- **No `credentialFields`** — admin provides OAuth Client ID + Secret via the generated wizard; base host is fixed (`graph.microsoft.com/v1.0`). `bi-microsoft` icon is a Bootstrap Icons glyph (no bespoke SVG).

## 2. Backend Provider Class (DONE)

File: `lib/oauth-providers/oauth_providers/onedrive_provider.py`. OneDrive **is** a Files-Remote connector → real provider class. `OneDriveProvider` subclasses `OAuthProvider` and implements the four file methods against Graph (opposite of chat-only/spec-driven Actionstep/NetSuite/simPRO, which have no provider class). Shipped (reference — do not re-create):

```python
class OneDriveProvider(OAuthProvider):
    """OneDrive Microsoft Graph API OAuth provider implementation."""
    BASE_URL = "https://graph.microsoft.com/v1.0"

    @property
    def provider_name(self) -> str:
        return "onedrive"   # MUST equal the registry id and this folder name

    async def list_files(self, access_token, folder_id=None, page_size=100, page_token=None):
        # GET /me/drive/root/children  OR  /me/drive/items/{folder_id}/children
        # $top=min(page_size, 999), $select=8-field set, $skiptoken from prior @odata.nextLink
        ...
    async def download_file(self, access_token, file_id, max_download_size=None):
        # GET /me/drive/items/{file_id}/content with follow_redirects=False
        # On 302: re-request Location WITHOUT the Authorization header (no token leak)
        # Enforce MAX_DOWNLOAD_SIZE (100 MB) via Content-Length on both hops
        ...
    async def get_file_metadata(self, access_token, file_id):
        # GET /me/drive/items/{file_id}?$select=...,cTag,eTag,...
        # checksum = hashes.sha1Hash or hashes.quickXorHash; version = eTag
        ...
    async def search_files(self, access_token, query, folder_id=None, page_size=100, page_token=None):
        # GET /me/drive/root/search(q='{encoded}')  OR  /items/{folder_id}/search(q='{encoded}')
        # query is urllib.parse.quote(query, safe="") to prevent (q='…') injection
        ...
```

Behaviours baked in (match these in docs and any change):

- **Path-traversal guard:** `_validate_item_id()` rejects ids containing `/`, `\`, or `..` before URL interpolation (`OAuthError(error_code="INVALID_ID")`).
- **8-field `$select`** on listings: `id,name,size,createdDateTime,lastModifiedDateTime,parentReference,webUrl,folder,file`.
- **`$top` capped at 999** (`min(page_size, 999)`).
- **Type via facet:** `is_folder = "folder" in item`. No `type` field read.
- **302 download** with `Authorization` stripped on the redirect, plus 100 MB `MAX_DOWNLOAD_SIZE` enforced from `Content-Length` on both hops.
- **Hash preference:** `sha1Hash` (personal) first, then `quickXorHash` (business) as the checksum.
- **Retry:** `_make_request_with_retry` retries up to 3 times, honoring `Retry-After` on 429/503.

## 3. Provider Registration — AUTOMATIC (no edit)

File: `lib/oauth-providers/oauth_providers/__init__.py`. Auto-discovered: `__init__.py` scans for `*_provider.py`, imports each, registers any concrete `OAuthProvider` subclass keyed by `provider_name`. **No** hand-maintained `PROVIDER_REGISTRY` dict — dropping `onedrive_provider.py` in (with `provider_name == "onedrive"`) is the entire registration.

```python
# __init__.py (excerpt) — do NOT add a manual entry; runs automatically
PROVIDERS: dict[str, type] = _discover_providers()  # finds OneDriveProvider via provider_name

def create_provider(provider_name, client_id, client_secret=None, **kwargs):
    if provider_name not in PROVIDERS:
        raise ValueError(f"No file-browsing implementation for provider: {provider_name}")
    return PROVIDERS[provider_name](client_id=client_id, client_secret=client_secret, **kwargs)
```

**Invariant:** registry `id` == provider's `provider_name` == this folder name (`ext-api-doc/onedrive/`) == `onedrive`. Files-Remote backend looks the provider up by that key; the agent loads rules from the folder of that name; `tools/check-connector-docs.mjs` parity check enforces it.

## 4. Agent Rules Deployment (`ext-api-doc` → S3)

The `01*` files are the agent knowledge pack: `01-llm-api-rules.md` (main), `01a-domain-model`, `01b-query-patterns`, `01c-mutation` (N/A — read-only), `01d-event-and-error`. During a client deploy, `infra/stacks/numa-client-stack.ts` walks `ext-api-doc/` recursively and uploads each markdown file as an `S3Object` to the per-client **ext-api-doc S3 bucket** (`core.extApiDocBucket`), preserving the relative path as the S3 key (`onedrive/01-llm-api-rules.md`, etc.). `_templates/` is excluded. The workspace agent loads the `01-*.md` rules for OneDrive from that bucket at runtime when the connector is active.

## 5. Setup & Deployment Checklist

Code (done in-tree):

- [x] Registry entry committed (`connectorRegistry.ts`, `id: 'onedrive'`)
- [x] Backend provider committed (`oauth_providers/onedrive_provider.py`)
- [x] Provider auto-discovered (no `__init__.py` edit)
- [x] `ext-api-doc/onedrive/` rules committed (01 + 01a/01d; 01c N/A read-only)
- [x] Folder name == registry id == `provider_name` (parity check)

External / per-client setup (admin):

- [ ] Register an Azure app (App registrations → multi-tenant; see `04-connection-and-reauth.md`)
- [ ] Add the redirect URI shown in the OneDrive admin wizard as a **Web** redirect
- [ ] Create a client secret; copy the **Value** (not the secret ID) + the Application (client) ID
- [ ] Ensure `DATA_CONNECTORS_ENABLED` is on (enables connectors + the Secrets Vault)
- [ ] In the admin wizard, paste Client ID + Secret → saved to the company vault
- [ ] User clicks **Connect** → Microsoft consent → token stored per-user

## 6. Testing Plan

Manual sequence:

1. **Admin setup:** open the OneDrive OAuth wizard, paste Azure Client ID + Secret, save.
2. **User connect:** **Connect** → consent on `login.microsoftonline.com` → token exchange.
3. **Browse:** Files Remote, confirm OneDrive appears (`bi-microsoft` icon), browse root → `GET /me/drive/root/children` returning `value[]` of driveItems.
4. **Drill in:** open a folder → `GET /me/drive/items/{id}/children`.
5. **Search:** search known content → `GET /me/drive/root/search(q='…')`.
6. **Download:** open a file → `GET /me/drive/items/{id}/content` → 302 → bytes (≤100 MB).
7. **Metadata:** verify size/modified/webUrl render (`get_file_metadata`).
8. **Workspace chat:** ask "list my OneDrive files" / "search OneDrive for invoices" / "download and summarise X" — exercises the same provider methods.
9. **User disconnect:** removes the user secret only (company vault secret stays).

Edge cases:

- [ ] Empty folder / no results (`value: []`, no `@odata.nextLink`)
- [ ] Pagination beyond one page (follow `$skiptoken`)
- [ ] File > 100 MB → `FILE_TOO_LARGE` (`MAX_DOWNLOAD_SIZE`)
- [ ] Item id with `/`/`\`/`..` → `INVALID_ID` (path-traversal guard)
- [ ] 401 → token refresh; refresh fails → re-consent
- [ ] 429 → honor `Retry-After` (provider retries up to 3×)
- [ ] Special characters in filenames / search query (query URL-encoded)

## Sources

- Connector entry: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
- Provider: `lib/oauth-providers/oauth_providers/onedrive_provider.py`
- Auto-discovery: `lib/oauth-providers/oauth_providers/__init__.py`
- Deploy/sync: `infra/stacks/numa-client-stack.ts` (ext-api-doc → S3)
- API: https://learn.microsoft.com/graph/api/resources/onedrive

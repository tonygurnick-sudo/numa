---
api_name: 'OneDrive (Microsoft Graph)'
connector_id: 'onedrive'
auth_type: 'oauth2'
tier: 'standard'
category: 'cloud-storage'
integration_path: 'data-connector-files'
---

# OneDrive (Microsoft Graph) — Connector & Integration Setup

> Build/reference doc for the OneDrive connector. **Integration path: Data Connector (Files)** —
> Files Remote + selective Graph API. Same shape as Google Drive and Dropbox: an OAuth2 connector
> with a `lib/oauth-providers/` backend provider class and `surfaces: ['files', 'chat']`.
>
> **This connector already ships.** The registry entry, the backend provider, and the `01*` agent
> rules in this folder are all committed. This document describes the **actual** wiring so it can be
> reproduced or maintained — it is not a greenfield checklist.
>
> Prerequisites: read `00-api-investigation-questionnaire.md` / `02-api-spec-investigation.md` and
> activate the `numa-connectors` skill.

---

## Integration Type

**Selected path:** Data Connector (Files) — Files Remote + selective Graph API.

| Component                                       | Required? | Status                                                                       |
| ----------------------------------------------- | --------- | ---------------------------------------------------------------------------- |
| Connector Registry entry                        | Yes       | ✅ Done — `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` |
| Backend provider class (`lib/oauth-providers/`) | Yes       | ✅ Done — `oauth_providers/onedrive_provider.py`                             |
| Provider registration                           | Yes       | ✅ Automatic — auto-discovery in `oauth_providers/__init__.py` (no edit)     |
| `ext-api-doc/onedrive/` agent rules             | Yes       | ✅ Done — this folder (01-llm-api-rules.md + 01a–01d)                        |
| Admin OAuth wizard                              | Yes       | ✅ Generated from the registry entry (no bespoke component)                  |
| User integration (Connect)                      | Yes       | ✅ Generated from the registry entry (no bespoke component)                  |
| OAuth app credentials (Client ID + Secret)      | Yes       | ⛔ External — admin registers an Azure app and supplies them at setup        |
| Feature flag                                    | Yes       | `DATA_CONNECTORS_ENABLED` gates all data connectors + the Secrets Vault      |

---

## 1. Connector Registry Entry (DONE)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

The entry is committed (grep `id: 'onedrive'`). Reproduced verbatim:

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

**Key facts from this entry (the source of truth for auth):**

- `authType: 'oauth2'` with `oauthPlatform: 'microsoft'` — the Microsoft Entra OAuth flow.
- `surfaces: ['files', 'chat']` — appears in **Files Remote** AND is usable from chat. This is what
  makes it a Files connector (vs. Actionstep/NetSuite, which are `['chat']` only).
- `cachingPolicy: CACHING_PRESETS.cloudStorage` — file metadata/listings are cached; content is
  fetched fresh via the short-lived preauth download URL.
- `scopes: 'https://graph.microsoft.com/Files.Read.All offline_access'` — **read-only**, plus the
  refresh token. Space-separated, single string.
- `extraAuthParams: '{"response_mode":"query"}'` — Entra returns the auth code as a query param
  (not a fragment), which the connector wizard consumes.
- `discoveryUrl` — the OIDC discovery doc for the `/common` (multi-tenant) endpoint.
- There are **no `credentialFields`** on this entry. Unlike a token/API-key connector (and unlike
  Actionstep's `api_endpoint` field), OneDrive supplies nothing extra — the admin provides the
  OAuth Client ID + Secret through the generated wizard, and the base host is fixed
  (`graph.microsoft.com/v1.0`).

> The `bi-microsoft` icon is a Bootstrap Icons glyph (no bespoke SVG needed). Display name and
> description are read straight from this entry by the Files Remote / Integrations UI.

---

## 2. Backend Provider Class (DONE)

> File: `lib/oauth-providers/oauth_providers/onedrive_provider.py`

OneDrive **is** a Files-Remote connector, so it has a real provider class — `OneDriveProvider`
subclasses `OAuthProvider` and implements the four file methods against Microsoft Graph. This is the
opposite of the chat-only/spec-driven connectors (Actionstep, NetSuite, simPRO), which have no
provider class at all.

The shipped implementation (do not re-create — this is for reference):

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

**Behaviours baked into the provider (match these in docs and any change):**

- **Path-traversal guard:** `_validate_item_id()` rejects any id containing `/`, `\`, or `..`
  before it is interpolated into a URL (`OAuthError(error_code="INVALID_ID")`).
- **8-field `$select`** on listings: `id,name,size,createdDateTime,lastModifiedDateTime,parentReference,webUrl,folder,file`.
- **`$top` capped at 999** (`min(page_size, 999)`) — Graph's max.
- **Type via facet:** `is_folder = "folder" in item`. No `type` field is read.
- **302 download** with the Authorization header stripped on the redirect, plus a 100 MB
  `MAX_DOWNLOAD_SIZE` ceiling enforced from `Content-Length` on both the redirect and the final hop.
- **Hash preference:** `sha1Hash` (personal) first, then `quickXorHash` (business) as the checksum.
- **Retry:** `_make_request_with_retry` retries up to 3 times, honoring `Retry-After` on 429/503.

---

## 3. Provider Registration — AUTOMATIC (no edit needed)

> File: `lib/oauth-providers/oauth_providers/__init__.py`

**This package is auto-discovered.** `__init__.py` scans for `*_provider.py` modules, imports each,
and registers any concrete `OAuthProvider` subclass keyed by its `provider_name`. There is **no**
hand-maintained `PROVIDER_REGISTRY` dict to edit — dropping `onedrive_provider.py` into the package
(with `provider_name == "onedrive"`) is the entire registration.

```python
# __init__.py (excerpt) — do NOT add a manual entry; this runs automatically
PROVIDERS: dict[str, type] = _discover_providers()  # finds OneDriveProvider via provider_name

def create_provider(provider_name, client_id, client_secret=None, **kwargs):
    if provider_name not in PROVIDERS:
        raise ValueError(f"No file-browsing implementation for provider: {provider_name}")
    return PROVIDERS[provider_name](client_id=client_id, client_secret=client_secret, **kwargs)
```

> **Invariant:** the registry `id`, the provider's `provider_name`, and this folder name
> (`ext-api-doc/onedrive/`) must all be the string `onedrive`. The Files-Remote backend looks the
> provider up by that key; the agent loads the rules from the folder of that name.

---

## 4. Agent Rules Deployment (`ext-api-doc` → S3)

The `01*` files in this folder are the agent knowledge pack:

- `01-llm-api-rules.md` (main rules, < 300 lines)
- `01a-domain-model-reference.md`, `01b-query-patterns.md`, `01c-mutation-patterns.md` (N/A —
  read-only), `01d-event-and-error-handling.md`

**How they reach the agent:** during a client deploy, `infra/stacks/numa-client-stack.ts` walks
`ext-api-doc/` recursively and uploads each markdown file as an `S3Object` to the per-client
**ext-api-doc S3 bucket** (`core.extApiDocBucket`), preserving the relative path as the S3 key
(`onedrive/01-llm-api-rules.md`, etc.). The `_templates/` directory is explicitly **excluded**. The
workspace agent then loads the `01-*.md` rules for OneDrive from that bucket at runtime when the
connector is active, so it knows the Graph endpoints, the facet model, the 302 download rule, and
the search-over-`$filter` preference.

> The folder name must match the registry id (`onedrive`) for the agent to find the right rules and
> for the `tools/check-connector-docs.mjs` parity check to pass.

---

## 5. Setup & Deployment Checklist

### Code (done in-tree)

- [x] Registry entry committed (`connectorRegistry.ts`, `id: 'onedrive'`)
- [x] Backend provider committed (`oauth_providers/onedrive_provider.py`)
- [x] Provider auto-discovered (no `__init__.py` edit required)
- [x] `ext-api-doc/onedrive/` rules committed (01 + 01a/01d; 01c is N/A read-only)
- [x] Folder name == registry id == `provider_name` (parity check)

### External / per-client setup (admin)

- [ ] Register an Azure app (App registrations → multi-tenant; see `04-connection-and-reauth.md`)
- [ ] Add the redirect URI shown in the OneDrive admin wizard as a **Web** redirect
- [ ] Create a client secret; copy the **Value** (not the secret ID) and the Application (client) ID
- [ ] Ensure `DATA_CONNECTORS_ENABLED` is on for the client (enables connectors + the Secrets Vault)
- [ ] In the OneDrive admin wizard, paste Client ID + Secret → saved to the company vault
- [ ] User clicks **Connect** → Microsoft consent → token stored per-user

---

## 6. Testing Plan

### Manual sequence

1. **Admin setup:** open the OneDrive OAuth wizard, paste the Azure Client ID + Secret, save.
2. **User connect:** click **Connect** → consent on `login.microsoftonline.com` → token exchange.
3. **Browse (Files Remote):** open Files Remote, confirm OneDrive appears (`bi-microsoft` icon),
   browse the root → expect `GET /me/drive/root/children` returning a `value[]` of driveItems.
4. **Drill into a folder:** open a folder → `GET /me/drive/items/{id}/children`.
5. **Search:** search for known content → `GET /me/drive/root/search(q='…')`.
6. **Download:** open a file → `GET /me/drive/items/{id}/content` → 302 → bytes (≤100 MB).
7. **Metadata:** verify size/modified/webUrl render (`get_file_metadata`).
8. **Workspace chat:** ask the agent to "list my OneDrive files" / "search OneDrive for invoices" /
   "download and summarise X" — exercises the same provider methods.
9. **User disconnect:** disconnect removes the user secret only (company vault secret stays).

### Edge cases

- [ ] Empty folder / no search results (`value: []`, no `@odata.nextLink`)
- [ ] Pagination beyond one page (follow `$skiptoken`)
- [ ] File > 100 MB → `FILE_TOO_LARGE` (`MAX_DOWNLOAD_SIZE`)
- [ ] Item id with `/`/`\`/`..` → rejected (`INVALID_ID` path-traversal guard)
- [ ] 401 → token refresh; refresh fails → re-consent
- [ ] 429 → honor `Retry-After` (provider retries up to 3×)
- [ ] Special characters in filenames / search query (query is URL-encoded)

---

## Sources

- Connector entry: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
- Provider: `lib/oauth-providers/oauth_providers/onedrive_provider.py`
- Auto-discovery: `lib/oauth-providers/oauth_providers/__init__.py`
- Deploy/sync: `infra/stacks/numa-client-stack.ts` (ext-api-doc → S3)
- API: https://learn.microsoft.com/graph/api/resources/onedrive

_Generated from the investigation questionnaire. Pair with the `numa-connectors` skill._

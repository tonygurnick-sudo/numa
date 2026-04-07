# MYOB Acumatica -- Numa Connector Setup

> **[TEMPLATE -- verify against current Numa codebase before implementation]**
> **Auth type:** OAuth 2.0 Authorization Code (per-instance)
> **Integration path:** Data Connector (OAuth2) + Direct API

---

## Overview

MYOB Acumatica uses per-instance OAuth 2.0. Unlike most SaaS connectors, there is no central authorization server. Each customer's Acumatica instance has its own OAuth endpoints, client credentials, and user database.

This means the connector must:

1. Store the instance URL as part of the company secret
2. Dynamically construct OAuth URLs using the instance URL
3. Handle per-instance token endpoints for refresh

---

## Prerequisites

Before configuring the Numa connector, the customer must:

- [ ] Have an active Acumatica instance URL (e.g., `https://company.myob.com`)
- [ ] Have purchased the **Acumatica API License** add-on (without this, all API calls return 403)
- [ ] Register a Connected Application in their Acumatica instance:
  - Navigate to Connected Applications screen (SM303010)
  - Create new application with flow type "Authorization Code"
  - Set redirect URI to Numa's OAuth callback URL
  - Note the `client_id` and `client_secret`
- [ ] Have a user account with appropriate API permissions (the connector inherits this user's access)

---

## Connector Registry Entry

**[TEMPLATE -- verify field names against current `connectorRegistry.ts`]**

```typescript
// In numa-frontend/src/Config/connectorRegistry.ts

{
    id: 'myob-acumatica',
    displayName: 'MYOB Acumatica',
    description: 'Connect to MYOB Acumatica ERP for customers, vendors, orders, invoices, and inventory',
    icon: 'myob-acumatica', // requires icon asset
    category: 'erp',
    authType: 'oauth2',
    credentialFields: [
        {
            key: 'instanceUrl',
            label: 'Instance URL',
            type: 'text',
            placeholder: 'https://company.myob.com',
            required: true,
            helpText: 'Your Acumatica instance URL (e.g., https://company.myob.com)'
        },
        {
            key: 'clientId',
            label: 'Client ID',
            type: 'text',
            required: true,
            helpText: 'OAuth Client ID from your Connected Application (SM303010)'
        },
        {
            key: 'clientSecret',
            label: 'Client Secret',
            type: 'password',
            required: true,
            helpText: 'OAuth Client Secret from your Connected Application'
        },
        {
            key: 'apiVersion',
            label: 'API Version',
            type: 'text',
            placeholder: '24.200.001',
            required: false,
            helpText: 'API contract version (defaults to 24.200.001)'
        }
    ],
    cachingPolicy: {
        enabled: true,
        defaultTtlSeconds: 300, // 5 minutes
        maxTtlSeconds: 3600
    },
    oauthConfig: {
        // These are dynamically constructed from instanceUrl
        authorizePath: '/identity/connect/authorize',
        tokenPath: '/identity/connect/token',
        scopes: ['api', 'offline_access'],
        // instanceUrl is prepended to authorizePath and tokenPath at runtime
        perInstanceUrls: true
    },
    apiReference: {
        capabilities: [
            'list_customers',
            'get_customer',
            'create_customer',
            'list_vendors',
            'list_sales_orders',
            'create_sales_order',
            'list_invoices',
            'list_bills',
            'list_stock_items',
            'list_purchase_orders',
            'list_leads',
            'list_opportunities',
            'list_employees',
            'list_projects',
            'release_invoice',
            'release_bill',
            'generic_inquiry'
        ]
    }
}
```

---

## OAuth Flow

### Step 1: Admin Setup (Company Secret)

Admin enters instance URL, client_id, and client_secret via the Data Connectors wizard. These are stored as the **company secret** in the vault.

**Company secret structure:**

```json
{
  "instanceUrl": "https://company.myob.com",
  "clientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "clientSecret": "secret_value_here",
  "apiVersion": "24.200.001"
}
```

### Step 2: User Connection (User Secret)

When a user clicks "Connect," the frontend redirects to:

```
https://company.myob.com/identity/connect/authorize
    ?response_type=code
    &client_id={clientId}
    &redirect_uri={numaCallbackUrl}
    &scope=api offline_access
    &state={encryptedState}
```

After user authenticates in Acumatica, the callback receives the authorization code, exchanges it for tokens, and stores them as the **user secret**.

**User secret structure:**

```json
{
  "accessToken": "eyJ0eXAiOiJKV1Qi...",
  "refreshToken": "abc123def456...",
  "expiresAt": 1743350400,
  "instanceUrl": "https://company.myob.com"
}
```

### Step 3: Token Refresh

The backend provider handles token refresh automatically when `expiresAt` is in the past:

```
POST https://company.myob.com/identity/connect/token

grant_type=refresh_token
&refresh_token={refreshToken}
&client_id={clientId}
&client_secret={clientSecret}
```

The refresh token rotates on each use (old token invalidated). The updated tokens are saved back to the user secret.

**Token lifetimes (defaults):**

- Access token: ~3600 seconds (1 hour), instance-configurable
- Refresh token: 30 days absolute, configurable from 2023 R2

---

## Backend Provider

**[TEMPLATE -- verify against current OAuthProvider interface in `lib/oauth-providers/`]**

```python
# In lib/oauth-providers/myob_acumatica_provider.py

class MyobAcumaticaProvider:
    """
    Backend provider for MYOB Acumatica connector.
    Implements the OAuthProvider interface for Numa data connectors.
    """

    PROVIDER_ID = "myob-acumatica"
    DEFAULT_API_VERSION = "24.200.001"

    def __init__(self, company_config: dict, user_tokens: dict):
        self.instance_url = company_config["instanceUrl"].rstrip("/")
        self.api_version = company_config.get("apiVersion", self.DEFAULT_API_VERSION)
        self.client_id = company_config["clientId"]
        self.client_secret = company_config["clientSecret"]
        self.access_token = user_tokens["accessToken"]
        self.refresh_token = user_tokens["refreshToken"]
        self.expires_at = user_tokens["expiresAt"]

    @property
    def base_url(self) -> str:
        return f"{self.instance_url}/entity/Default/{self.api_version}"

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }

    async def list_files(self, path: str = "", page_size: int = 100, page_token: str = "") -> dict:
        """
        Maps to entity listing. 'path' is the entity name (e.g., 'Customer', 'SalesOrder').
        """
        entity = path or "Customer"
        skip = int(page_token) if page_token else 0

        url = (f"{self.base_url}/{entity}"
               f"?$top={page_size}&$skip={skip}"
               f"&$orderby=LastModifiedDateTime desc")
        response = await self._get(url)

        items = response.json()
        next_token = str(skip + page_size) if len(items) == page_size else None

        return {
            "items": self._format_items(items, entity),
            "nextPageToken": next_token
        }

    async def search_files(self, query: str, entity: str = "Customer", page_size: int = 50) -> dict:
        """
        Search within an entity using OData $filter with contains().
        """
        filter_expr = self._build_search_filter(query, entity)
        url = f"{self.base_url}/{entity}?$top={page_size}&$filter={filter_expr}"
        response = await self._get(url)

        return {
            "items": self._format_items(response.json(), entity)
        }

    async def get_file_metadata(self, entity: str, record_id: str) -> dict:
        """Get a single record by ID."""
        url = f"{self.base_url}/{entity}/{record_id}"
        response = await self._get(url)
        return response.json()

    async def download_file(self, entity: str, record_id: str, filename: str) -> bytes:
        """Download a file attachment from a record."""
        keys = record_id  # Expected format: "SO/000042"
        url = f"{self.base_url}/{entity}/{keys}/files/{filename}"
        response = await self._get(url)
        return response.content

    async def test_connection(self) -> dict:
        """
        Verify the connection works.
        Tests: instance reachable, token valid, API license active, permissions OK.
        """
        try:
            url = f"{self.base_url}/Customer?$top=1&$select=CustomerID"
            response = await self._get(url)
            if response.status_code == 200:
                return {"success": True, "message": "Connected to MYOB Acumatica"}
            elif response.status_code == 401:
                refreshed = await self._refresh_token()
                if refreshed:
                    return {"success": True, "message": "Connected (token refreshed)"}
                return {"success": False, "message": "Authentication failed -- user may need to reconnect"}
            elif response.status_code == 403:
                return {"success": False, "message": "API License not active on this instance"}
            else:
                return {"success": False, "message": f"Unexpected status: {response.status_code}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def _build_search_filter(self, query: str, entity: str) -> str:
        """Map a free-text search query to an OData filter for the given entity."""
        search_fields = {
            "Customer": "CustomerName",
            "Vendor": "VendorName",
            "SalesOrder": "Description",
            "SalesInvoice": "Description",
            "Bill": "Description",
            "StockItem": "Description",
            "Lead": "CompanyName",
            "Opportunity": "Subject",
            "Employee": "EmployeeName",
            "Project": "Description",
            "PurchaseOrder": "Description",
            "JournalTransaction": "Description",
        }
        field = search_fields.get(entity, "Description")
        # Single quotes in query value must be escaped
        safe_query = query.replace("'", "''")
        return f"contains({field}, '{safe_query}')"

    def _format_items(self, items: list, entity: str) -> list:
        """Format Acumatica entity records into connector-standard format."""
        formatted = []
        for item in items:
            formatted.append({
                "id": item.get("id", ""),
                "name": self._get_display_name(item, entity),
                "type": entity,
                "lastModified": self._extract_value(item, "LastModifiedDateTime"),
                "raw": item
            })
        return formatted

    @staticmethod
    def _extract_value(item: dict, field: str) -> str:
        """Extract a value from the Acumatica {'value': ...} wrapper."""
        field_obj = item.get(field, {})
        if isinstance(field_obj, dict):
            return str(field_obj.get("value", ""))
        return str(field_obj)

    @staticmethod
    def _get_display_name(item: dict, entity: str) -> str:
        """Get a human-readable display name for a record."""
        name_fields = {
            "Customer": ["CustomerName", "CustomerID"],
            "Vendor": ["VendorName", "VendorID"],
            "SalesOrder": ["OrderNbr", "Description"],
            "SalesInvoice": ["ReferenceNbr", "Description"],
            "Bill": ["ReferenceNbr", "VendorRef"],
            "StockItem": ["Description", "InventoryID"],
            "Lead": ["LastName", "FirstName"],
            "Opportunity": ["Subject", "OpportunityID"],
            "Employee": ["EmployeeName", "EmployeeID"],
            "Project": ["Description", "ProjectID"],
            "PurchaseOrder": ["OrderNbr", "Description"],
            "JournalTransaction": ["BatchNbr", "Description"],
        }
        fields = name_fields.get(entity, ["id"])
        for field in fields:
            val = MyobAcumaticaProvider._extract_value(item, field)
            if val:
                return val
        return item.get("id", "Unknown")
```

---

## Per-Instance URL Handling

The critical difference from standard OAuth connectors: authorization and token URLs are constructed dynamically from the stored instance URL.

```python
def get_authorize_url(self) -> str:
    return f"{self.instance_url}/identity/connect/authorize"

def get_token_url(self) -> str:
    return f"{self.instance_url}/identity/connect/token"
```

This means:

- The backend provider cannot hardcode OAuth endpoints
- The frontend wizard must capture and validate the instance URL before starting OAuth
- Token refresh must use the stored instance URL, not a global endpoint
- OIDC discovery is available at `{instanceUrl}/identity/` if needed

---

## Deployment Checklist

**[TEMPLATE -- verify each step against current Numa deployment process]**

### Infrastructure

- [ ] Add `myob-acumatica` to connector registry in `connectorRegistry.ts`
- [ ] Create backend provider in `lib/oauth-providers/myob_acumatica_provider.py`
- [ ] Register provider in `handleListProviders` (connector listing Lambda)
- [ ] Add vault lookup patterns in `getProviderConfig` for `oauth-client-myob-acumatica` and `connector-myob-acumatica`
- [ ] Add icon asset for MYOB Acumatica

### Frontend

- [ ] Admin wizard component for setup (instance URL + client ID + client secret)
- [ ] User connection flow (OAuth redirect using per-instance URL)
- [ ] User disconnect flow (delete user secret only)
- [ ] Admin disconnect flow (delete company secret)
- [ ] Files Remote rendering (correct icon, connect/disconnect states)

### Testing

- [ ] Admin setup wizard creates company vault secret correctly
- [ ] User OAuth flow completes and stores user secret
- [ ] Test connection passes (returns success)
- [ ] Entity listing returns data with correct format
- [ ] Token refresh works when access token expires
- [ ] User disconnect removes only user secret
- [ ] Admin disconnect removes company secret
- [ ] Workspace agent can access connector via `files` tool

### Gotchas to Verify

- [ ] Instance URL stored without trailing slash
- [ ] Per-instance OAuth URLs constructed correctly (no hardcoded endpoints)
- [ ] Token refresh updates the stored user secret with new refresh token (rotation)
- [ ] API version defaults to `24.200.001` if not specified
- [ ] Error messages surface the `exceptionMessage` field, not just HTTP status
- [ ] Single quotes in search queries are escaped (`'` -> `''`) in OData filters

---

## Workspace Agent Integration

The MYOB Acumatica connector is accessed through the existing `files` tool in the workspace agent. No new tools needed.

**Capabilities exposed to agent:**

| Capability          | Files Tool Parameter                     | Maps To                                 |
| ------------------- | ---------------------------------------- | --------------------------------------- |
| Browse entities     | `list` with path = entity name           | `GET /{Entity}?$top=...`                |
| Search records      | `search` with query                      | `GET /{Entity}?$filter=contains(...)`   |
| Get record detail   | `get_metadata` with entity + ID          | `GET /{Entity}/{id}`                    |
| Download attachment | `download` with entity + keys + filename | `GET /{Entity}/{keys}/files/{filename}` |

The agent determines which entity to query based on the user's natural language request (e.g., "show me recent invoices" maps to `SalesInvoice`, "find customer Acme" maps to `Customer`).

---

## Security Notes

- **Per-instance isolation** -- Each customer's Acumatica instance is completely separate. No cross-instance data leakage possible.
- **Permission inheritance** -- API calls inherit the connected user's Acumatica permissions. Recommend connecting with a dedicated service account rather than a personal user account.
- **API License requirement** -- If the customer's API License expires, all API calls fail with 403. The test connection check surfaces this clearly.
- **Token rotation** -- Refresh tokens rotate on each use. If a token refresh fails, the user must re-authorize.
- **No webhook signature** -- Push Notifications do not include HMAC signatures. If using customer-configured webhooks, implement IP allowlisting or shared secret verification.

---

_Generated from the investigation questionnaire. See also:_

- _[Connector Framework Documentation](../../documentation/connectors/README.md)_
- _Investigation questionnaire for detailed API research_

# Pipedream Proxy Lambda

Secure cross-account proxy for Pipedream API operations with account validation and security mapping.

## Architecture

This lambda provides a secure proxy layer between client accounts and Pipedream APIs, eliminating the need to expose Pipedream OAuth credentials to tenant lambdas.

### Security Model

1. **Account Validation**: Callers generate a presigned STS `GetCallerIdentity` URL in their own account; the proxy validates this URL via HTTPS and parses the STS XML response. The proxy does not need `sts` IAM permissions.
2. **Account Allowlist**: Validates caller account exists in DynamoDB allowed accounts table with ACTIVE status
3. **Role Allowlist**: Only specific role patterns are permitted for pipedream-relay and ws-agent roles (regex: `^[a-zA-Z0-9-]+_(?:pipedream-relay|ws[-]agent)$`)
4. **Security Mapping**: DynamoDB table tracks account-to-user relationships with negative case handling
5. **STS URL Freshness**: Validates presigned URLs are fresh (max 2 minutes old, max 60 seconds expiration)
6. **STS Host Allowlist**: Only allows STS endpoints from us-east-1 and ap-southeast-2 regions

### Account-Based Access Control

The proxy validates that calling accounts are explicitly authorized:

- **Allowed Accounts Table**: DynamoDB table containing authorized AWS account IDs with status tracking
- **Account Status**: Only accounts with `ACTIVE` status are permitted access

**Security Features**:

- **External User ID Format**: Must contain underscore separator (tenant_userid format)
- **Cross-tenant Protection**: Security mapping prevents one account from accessing another account's external user IDs
- **First-request Registration**: New security mappings created automatically on first valid request

### Supported Operations

- `generate_connect_token` - Creates OAuth connect tokens for frontend
- `get_integration_status` - Lists connected integrations for user
- `create_mcp_client` - Creates MCP client connection details for chat agent
- `disconnect_integration` - Disconnects a user's integration accounts

## Request Format

```json
{
  "operation": "generate_connect_token|get_integration_status|create_mcp_client|disconnect_integration",
  "external_user_id": "arcanum_tenant_user123",
  "sts_proof_url": "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&...",
  "parameters": {
    "app_name": "slack", // Required for create_mcp_client; optional for disconnect_integration
    "account_id": "pa_abc123" // Optional for disconnect_integration (delete a specific account)
  }
}
```

**Required Fields:**

- `operation`: One of the supported operations
- `external_user_id`: Must follow format `tenant_userid` (contain underscore separator)
- `sts_proof_url`: Fresh STS presigned GetCallerIdentity URL (max 2 minutes old, max 60 seconds expiration)

## Response Format

**Note**: The `body` field contains a JSON string that needs to be parsed.

```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "operation": "get_integration_status",
    "data": {
      // Operation-specific response data
    }
  }
}
```

## API Operations & Examples

### 1. Generate Connect Token

**Request:**

```json
{
  "operation": "generate_connect_token",
  "external_user_id": "arcanum_demo_user123",
  "sts_proof_url": "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&..."
}
```

**Response:**

```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "operation": "generate_connect_token",
    "data": {
      "connectToken": "pd_oauth_connect_abc123def456...",
      "externalUserId": "arcanum_demo_user123",
      "expiresAt": "2025-08-13T11:30:00Z",
      "connectLinkUrl": "https://api.pipedream.com/connect/oauth/abc123"
    }
  }
}
```

### 2. Get Integration Status

**Request:**

```json
{
  "operation": "get_integration_status",
  "external_user_id": "arcanum_demo_user123",
  "sts_proof_url": "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&..."
}
```

**Response:**

```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "operation": "get_integration_status",
    "data": {
      "connections": [
        {
          "app_name": "slack",
          "status": "connected",
          "pipedream_account_id": "pa_abc123",
          "last_auth_check": "2025-08-13T10:00:00Z",
          "mcp_server_url": "https://remote.mcp.pipedream.net/arcanum_demo_user123/slack"
        },
        {
          "app_name": "gmail",
          "status": "not_connected",
          "pipedream_account_id": null,
          "last_auth_check": null,
          "mcp_server_url": null
        },
        {
          "app_name": "notion",
          "status": "connected",
          "pipedream_account_id": "pa_def456",
          "last_auth_check": "2025-08-12T15:30:00Z",
          "mcp_server_url": "https://remote.mcp.pipedream.net/arcanum_demo_user123/notion"
        }
      ],
      "external_user_id": "arcanum_demo_user123",
      "connected_apps": ["slack", "notion"]
    }
  }
}
```

### 3. Create MCP Client

**Request:**

```json
{
  "operation": "create_mcp_client",
  "external_user_id": "arcanum_demo_user123",
  "sts_proof_url": "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&...",
  "parameters": {
    "app_name": "slack"
  }
}
```

### 4. Disconnect Integration

Disconnect either a single account by `account_id` or all of the user's accounts for an app by `app_name`.

By account_id:

```json
{
  "operation": "disconnect_integration",
  "external_user_id": "arcanum_demo_user123",
  "sts_proof_url": "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&...",
  "parameters": { "account_id": "pa_abc123" }
}
```

Response (idempotent):

```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "operation": "disconnect_integration",
    "data": {
      "external_user_id": "arcanum_demo_user123",
      "account_id": "pa_abc123",
      "disconnected": true
    }
  }
}
```

By app_name (deletes all the user's accounts for that app):

```json
{
  "operation": "disconnect_integration",
  "external_user_id": "arcanum_demo_user123",
  "sts_proof_url": "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&...",
  "parameters": { "app_name": "slack" }
}
```

Response (idempotent if none found):

```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "operation": "disconnect_integration",
    "data": {
      "external_user_id": "arcanum_demo_user123",
      "app_name": "slack",
      "found_accounts": ["pa_1", "pa_2"],
      "deleted_account_ids": ["pa_1", "pa_2"],
      "failed_account_ids": [],
      "disconnected": true
    }
  }
}
```

**Response:**

```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "operation": "create_mcp_client",
    "data": {
      "base_url": "https://remote.mcp.pipedream.net/arcanum_demo_user123/slack",
      "headers": {
        "Authorization": "Bearer pd_oauth_access_token_xyz...",
        "x-pd-project-id": "prj_abc123def456",
        "x-pd-environment": "production"
      },
      "app_name": "slack",
      "external_user_id": "arcanum_demo_user123"
    }
  }
}
```

## Error Responses

### Security Validation Error (403)

```json
{
  "statusCode": 403,
  "body": {
    "success": false,
    "error": "Access denied"
  }
}
```

### Invalid Request (400)

```json
{
  "statusCode": 400,
  "body": {
    "success": false,
    "error": "Missing required parameter: operation"
  }
}
```

### Internal Server Error (500)

```json
{
  "statusCode": 500,
  "body": {
    "success": false,
    "error": "Internal server error"
  }
}
```

## Environment Variables

**Required:**

- `SECURITY_MAPPING_TABLE` - DynamoDB table name for security mappings
- `ALLOWED_ACCOUNTS_TABLE` - DynamoDB table name for allowed accounts
- `PIPEDREAM_SECRET_ARN` - ARN of Secrets Manager secret containing Pipedream credentials
- `SUPPORTED_INTEGRATIONS` - JSON array of supported integration app names (e.g., `["slack", "gmail", "notion"]`)

**Optional:**

- `LOG_LEVEL` - Logging level (INFO, DEBUG, etc.)
- `ENVIRONMENT` - Environment name for logging context

## Security Mapping Table Schema

```json
{
  "external_user_id": "arcanum_tenant_user123", // Partition Key
  "account_id": "123456789012", // AWS Account ID
  "role_name": "numa-tenant-lambda-execution-role",
  "created_at": "2025-08-13T10:00:00Z",
  "last_accessed": "2025-08-13T10:30:00Z"
}
```

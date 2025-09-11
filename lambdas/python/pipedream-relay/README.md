# Pipedream Relay Lambda

A client-side relay lambda that forwards frontend requests to the cross-account Pipedream proxy lambda.

## Architecture

```
Frontend → Local Relay Lambda (this) → Cross-Account Proxy Lambda
numa-chat-agent → Cross-Account Proxy Lambda (direct)
```

## Purpose

- **Frontend Gateway**: Provides a local endpoint for frontend calls to avoid complex cross-account credential management
- **Caller Identity**: Enables the proxy lambda to cryptographically verify the calling account via Lambda context
- **Simplified Permissions**: Frontend only needs permission to invoke local relay, not cross-account proxy

## Environment Variables

- `PIPEDREAM_PROXY_LAMBDA_ARN`: ARN of the cross-account Pipedream proxy lambda (required)
- `ENVIRONMENT`: Environment name for logging (optional)

## Request Format

Same as the proxy lambda:

```json
{
  "operation": "generate_connect_token|get_integration_status|create_mcp_client",
  "external_user_id": "client_name_user123",
  "parameters": {
    // Operation-specific parameters (optional)
  }
}
```

## Response Format

Returns the proxy lambda response unchanged.

## Deployment

This lambda is deployed to each client account as part of the core Numa infrastructure when Pipedream integrations are enabled.

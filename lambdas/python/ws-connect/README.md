# WebSocket Connect Handler

Lambda function that handles WebSocket `$connect` route with JWT authentication and connection management.

## Purpose

This Lambda function is the **security gateway** for WebSocket connections:

1. **JWT Authentication**: Validates Cognito ID tokens via API Gateway REQUEST authorizer
2. **User Context Extraction**: Extracts user information from validated JWT tokens
3. **Connection Storage**: Stores authenticated connection details in DynamoDB
4. **Security Foundation**: Creates the authenticated connection record for message validation

## Security Role

**Primary Security Layer**: This Lambda enforces authentication for all WebSocket connections.

- **Input**: JWT token in query string (`?Authorization=jwt-token`)
- **Validation**: API Gateway REQUEST authorizer validates token against Cognito User Pool
- **Storage**: Authenticated user context stored in DynamoDB for later validation
- **Output**: HTTP 200 (connection allowed) or HTTP 403 (authentication failed)

## Environment Variables

- `CONNECTION_TABLE`: DynamoDB table name for storing connection information

## Authentication Flow

```
Frontend → API Gateway → REQUEST Authorizer → ws-connect → DynamoDB
    ↓            ↓              ↓               ↓           ↓
JWT Token → Validation → User Context → Connection → Stored Record
```

## User Context Stored

For each authenticated connection, stores:
```json
{
  "connectionId": "abc123-connection-id",
  "timestamp": "aws-request-id",
  "connectedAt": 1234567890,
  "userSub": "cognito-user-sub",
  "userEmail": "user@example.com",
  "userGroups": ["admin", "users"]
}
```

## Response Codes

- **200**: Connection established successfully with authentication
- **500**: Internal error (authentication or DynamoDB failure)

## Infrastructure Integration

**Used By**: Numa Chat Agent WebSocket API (`numa-chat-agent-ws-construct.ts`)
**Route**: `$connect` (WebSocket connection establishment)
**Authorizer**: JWT REQUEST authorizer (validates Cognito tokens)
**Dependencies**:
- Cognito User Pool (for JWT validation)
- DynamoDB connection table (for storing connection state)

## Security Benefits

- **Authentication Required**: No anonymous connections allowed
- **User Context**: Full user information available for downstream processing
- **Audit Trail**: All connections logged with user details
- **Role-Based Access**: User groups available for permission checks
- **Token Validation**: Cognito JWT tokens validated by API Gateway

## Error Handling

- **Authentication Failure**: API Gateway blocks connection before reaching Lambda
- **DynamoDB Errors**: Lambda returns HTTP 500, connection rejected
- **Missing User Context**: Lambda handles gracefully, stores available information

## Monitoring

Logs include:
- Connection establishment events
- User authentication details (email, sub, groups)
- DynamoDB storage operations
- Error conditions with detailed context

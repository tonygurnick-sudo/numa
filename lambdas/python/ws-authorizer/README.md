# WebSocket JWT Authorizer

Lambda function that provides JWT token validation for WebSocket API Gateway REQUEST authorization.

## Purpose

This Lambda function serves as the **authentication layer** for WebSocket connections:

1. **JWT Validation**: Validates Cognito ID tokens for WebSocket connections
2. **User Context Extraction**: Extracts user information from validated JWT tokens
3. **Authorization Decision**: Returns allow/deny policy for API Gateway
4. **Security Enforcement**: Ensures only authenticated users can establish WebSocket connections

## Authentication Model

**REQUEST Authorizer**: This Lambda is invoked by API Gateway for each `$connect` request to validate the JWT token.

- **Input**: JWT token from query string (`?Authorization=jwt-token`)
- **Validation**: Verifies token signature, expiration, and claims against Cognito User Pool
- **Output**: IAM policy (Allow/Deny) + user context for downstream Lambdas

## Environment Variables

- `COGNITO_USER_POOL_ID`: Cognito User Pool ID for token validation
- `COGNITO_USER_POOL_CLIENT_ID`: Cognito User Pool Client ID
- `REGION`: AWS region for Cognito operations

## Authorization Flow

```
Frontend → API Gateway → ws-authorizer → Cognito → Policy Response
    ↓           ↓            ↓           ↓         ↓
JWT Token → REQUEST → Token Validation → User → Allow/Deny + Context
```

## Token Validation Process

1. **Extract Token**: Gets JWT token from `Authorization` query parameter
2. **Verify Signature**: Validates token signature against Cognito public keys
3. **Check Expiration**: Ensures token is not expired
4. **Validate Claims**: Verifies audience, issuer, and token usage
5. **Extract User Info**: Gets user details (sub, email, groups) from token claims

## Response Format

**Success Response:**
```json
{
  "principalId": "user-sub",
  "policyDocument": {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Action": "execute-api:Invoke",
        "Effect": "Allow",
        "Resource": "arn:aws:execute-api:*:*:*"
      }
    ]
  },
  "context": {
    "sub": "cognito-user-sub",
    "email": "user@example.com",
    "groups": "admin,users",
    "token_use": "id"
  }
}
```

**Failure Response:**
```json
{
  "principalId": "unauthorized",
  "policyDocument": {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Action": "execute-api:Invoke",
        "Effect": "Deny",
        "Resource": "*"
      }
    ]
  }
}
```

## Infrastructure Integration

**Used By**: Numa Chat Agent WebSocket API (`numa-chat-agent-ws-construct.ts`)
**Authorizer Type**: REQUEST (validates each connection attempt)
**Route**: `$connect` (connection establishment only)
**Dependencies**:
- Cognito User Pool (for JWT validation)
- API Gateway WebSocket API (REQUEST authorizer integration)

## Security Features

- **Token Signature Validation**: Cryptographic verification against Cognito
- **Expiration Checking**: Rejects expired tokens
- **Audience Validation**: Ensures token is for correct application
- **User Context Passing**: Provides user details to downstream Lambdas
- **Deny by Default**: Unknown or invalid tokens are rejected

## Error Handling

**Token Validation Errors:**
- **Missing Token**: Returns Deny policy
- **Invalid Signature**: Returns Deny policy
- **Expired Token**: Returns Deny policy
- **Wrong Audience**: Returns Deny policy
- **Malformed Token**: Returns Deny policy

**System Errors:**
- **Cognito Unavailable**: Returns Deny policy (fail secure)
- **Network Issues**: Returns Deny policy (fail secure)
- **Lambda Errors**: API Gateway treats as authorization failure

## Performance Considerations

- **Caching**: API Gateway caches authorization results for connection reuse
- **Cold Starts**: Optimized for fast JWT validation
- **Cognito Integration**: Uses efficient JWT validation libraries
- **Memory Usage**: Right-sized for JWT processing workload

## Monitoring

Logs include:
- Authorization attempts with token details (sanitized)
- Token validation results (success/failure reasons)
- User context extraction (email, groups)
- Performance metrics (validation time)
- Error conditions with detailed context

## AWS Limitations

**WebSocket Constraint**: AWS API Gateway WebSocket APIs only support authorization on the `$connect` route, not `$default` or `$disconnect`. This is why message-level authentication is handled via DynamoDB connection validation in the `ws-stream-initializer` Lambda.

## Development Notes

- **JWT Libraries**: Uses standard JWT validation libraries for Cognito
- **Error Logging**: Detailed logging for debugging authentication issues
- **Testing**: Can be tested with valid Cognito JWT tokens
- **Deployment**: Automatically configured when Cognito User Pool details are provided

# WebSocket Disconnect Handler

Lambda function that handles WebSocket `$disconnect` route for connection cleanup and resource management.

## Purpose

This Lambda function provides **graceful cleanup** when WebSocket connections are terminated:

1. **Connection Cleanup**: Removes connection record from DynamoDB
2. **Execution Cleanup**: Stops any running Step Functions executions for the connection
3. **Resource Management**: Prevents orphaned resources and ensures clean disconnection
4. **Audit Trail**: Logs disconnection events for monitoring

## Cleanup Operations

**DynamoDB Cleanup:**
- Removes connection record from connections table
- Prevents stale connection accumulation
- Frees up table storage

**Step Functions Cleanup:**
- Retrieves execution ARN from connection record
- Stops any running agent processing executions
- Prevents unnecessary compute usage after disconnect

## Environment Variables

- `CONNECTION_TABLE`: DynamoDB table name for connection tracking

## Disconnect Flow

```
WebSocket Close → API Gateway → ws-disconnect → DynamoDB + Step Functions
      ↓              ↓             ↓              ↓           ↓
  Connection      $disconnect    Cleanup      Remove      Stop Execution
   Closed          Route        Handler      Record      (if running)
```

## Operations Performed

1. **Retrieve Connection**: Gets connection details from DynamoDB
2. **Stop Execution**: If Step Functions execution is running, stops it gracefully
3. **Delete Record**: Removes connection from DynamoDB table
4. **Log Event**: Records disconnection with context

## Response Codes

- **200**: Cleanup completed successfully
- **404**: Connection not found (already cleaned up)
- **500**: Internal error during cleanup

## Infrastructure Integration

**Used By**: Numa Chat Agent WebSocket API (`numa-chat-agent-ws-construct.ts`)
**Route**: `$disconnect` (WebSocket connection termination)
**Authorizer**: None (cleanup operations don't require authentication)
**Dependencies**:
- DynamoDB connection table (for connection lookup and deletion)
- Step Functions (for stopping running executions)

## Error Handling

**Graceful Degradation**: Cleanup continues even if some operations fail

- **DynamoDB Errors**: Logs warning, continues with Step Functions cleanup
- **Step Functions Errors**: Logs warning, continues with DynamoDB cleanup
- **Missing Connection**: Normal case, returns success (already cleaned up)

## Resource Management Benefits

- **No Orphaned Connections**: DynamoDB table stays clean
- **No Wasted Compute**: Running executions stopped when client disconnects
- **Cost Optimization**: Prevents unnecessary Step Functions charges
- **Clean State**: Ensures fresh state for reconnections
- **Monitoring**: Clear audit trail of connection lifecycle

## Monitoring

Logs include:
- Disconnection events with connection ID
- Step Functions execution stopping (if applicable)
- DynamoDB cleanup operations
- Error conditions with detailed context
- Performance metrics for cleanup operations

## Security Considerations

- **No Authentication**: Disconnect operations don't require JWT validation
- **Safe Operations**: Only performs cleanup, no data access or modification
- **Idempotent**: Safe to call multiple times for the same connection
- **Isolated**: Each connection's cleanup is independent

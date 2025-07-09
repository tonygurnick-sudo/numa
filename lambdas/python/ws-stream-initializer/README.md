# WebSocket Stream Initializer

Lightweight Lambda function that handles WebSocket `$default` route messages and starts Step Functions executions for agent processing.

## Purpose

This Lambda solves the API Gateway WebSocket 30-second integration timeout issue by:

1. **Security Validation**: Verifies connection exists in DynamoDB (proves JWT authentication)
2. **Fast Response**: Returns HTTP 200 within 3 seconds to avoid API Gateway timeout
3. **Async Processing**: Starts Step Functions execution for actual agent work
4. **Connection Tracking**: Updates DynamoDB with execution information for cleanup

## Security Model

**Multi-Layer Authentication:**
- **Layer 1**: JWT validation at `$connect` route (API Gateway)
- **Layer 2**: Connection validation via DynamoDB lookup (this Lambda)
- **Layer 3**: User context extraction from authenticated connection record

Only connections that passed JWT authentication at `$connect` can send messages.

## Architecture

```
Frontend → ws-stream-initializer (< 30 sec) → Step Functions → numa-chat-agent (15 min)
                ↓                                  ↓                    ↓
         Connection Validation              Execution Tracking    WebSocket Messages
         (DynamoDB lookup)                  (CloudWatch logs)
```

## Environment Variables

- `STATE_MACHINE_ARN`: Step Function state machine ARN for agent processing
- `CONNECTIONS_TABLE`: DynamoDB table for tracking WebSocket connections

## Input Format

Expects WebSocket message body:
```json
{
  "prompt": "User's question",
  "messages": [...], // Conversation history
  "enabledTools": ["query_knowledge_base", "web_search"],
  "systemPrompt": "System instructions",
  "userAuth": {...} // User authentication context (optional)
}
```

## Response Handling

- **Success**: Returns HTTP 200, starts Step Functions execution
- **Unauthenticated**: Returns HTTP 403, sends WebSocket error message
- **Invalid Input**: Returns HTTP 400, sends WebSocket error message
- **System Error**: Returns HTTP 500, sends WebSocket error message

## Infrastructure Integration

**Used By**: Numa chat Agent WebSocket API (`numa-chat-agent-ws-construct.ts`)
**Route**: `$default` (all incoming WebSocket messages)
**Triggers**: Step Functions execution for `numa-chat-agent` Lambda
**Dependencies**: DynamoDB connection table, Step Functions state machine

## Benefits

- **Security**: Only authenticated connections can send messages
- **Performance**: Eliminates 30-second API Gateway timeout
- **Reliability**: Automatic retry logic via Step Functions
- **Monitoring**: Full execution history and CloudWatch integration
- **Cost**: Efficient execution model with quick response times

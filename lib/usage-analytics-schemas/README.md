# Usage Analytics Schemas

Shared Zod schemas for Numa usage analytics events. Used across frontend, backend Lambdas, and API documentation.

## Installation

This is a local library within the Numa monorepo. Import directly:

```typescript
import { validateUsageEvent, UsageEvent, ChatMessageEvent } from '../../../lib/usage-analytics-schemas';
```

## Event Types

### Authentication

- **login**: User authentication events (success/failure, IP, device info)

### Chat

- **chat_message**: Individual chat messages (V1 and V2)
- **chat_conversation**: Conversation lifecycle (created, deleted, renamed)

### Agents

- **agent_created**: Agent creation with tools/KBs configured
- **agent_executed**: Agent runs (manual or scheduled)

### Files

- **file_upload**: File uploads to chat, KB, or apps
- **file_delete**: File deletions and storage reclamation

### Knowledge Bases

- **kb_created**: Knowledge base creation
- **kb_deleted**: Knowledge base deletion
- **kb_query**: Knowledge base queries

### Integrations

- **integration_activated**: Integration connection/disconnection
- **integration_tool_call**: Tool invocations (Gmail, Slack, Jira, etc.)

### Security

- **secret_accessed**: Company secret access audit events

## Usage

### Validation (Backend)

```typescript
import { validateUsageEvent } from '../../../lib/usage-analytics-schemas';

try {
  const event = validateUsageEvent(req.body);
  // event is now typed and validated
  await storeEvent(event);
} catch (error) {
  return { statusCode: 400, body: { error: 'Invalid schema' } };
}
```

### Safe Validation (No Throw)

```typescript
import { safeValidateUsageEvent } from '../../../lib/usage-analytics-schemas';

const result = safeValidateUsageEvent(data);
if (result.success) {
  console.log('Valid:', result.data);
} else {
  console.error('Invalid:', result.error.format());
}
```

### Type Guards (Frontend)

```typescript
import type { UsageEvent, ChatMessageEvent } from '../../../lib/usage-analytics-schemas';

const handleEvent = (event: UsageEvent) => {
  if (event.eventType === 'chat_message') {
    // TypeScript knows event.eventData is ChatMessageEventData
    console.log(`Message: ${event.eventData.role}`);
  }
};
```

### OpenAPI Contract Generation

```typescript
import { generateOpenApiSpec } from '../../../lib/usage-analytics-schemas';

const spec = generateOpenApiSpec('https://api.example.com');
// Returns OpenAPI 3.0 JSON spec with all event schemas
```

## Event Structure

All events share a common base structure:

```typescript
{
  eventType: string,        // Discriminator: 'login', 'chat_message', etc.
  eventId: string,          // UUID v4
  timestamp: number,        // Unix timestamp (ms)
  isTest: boolean,          // Flag for test data (bulk deletable)
  userId: string,           // Cognito sub
  source: string,           // 'test-api', 'chat-v1', 'agent-scheduler', etc.
  eventData: {...}          // Event-specific fields (varies by eventType)
}
```

## Example Events

### Login Event

```typescript
{
  eventType: 'login',
  eventId: '123e4567-e89b-12d3-a456-426614174000',
  timestamp: 1704067200000,
  isTest: true,
  userId: 'user-123',
  source: 'cognito-post-auth',
  eventData: {
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0...',
    loginMethod: 'cognito',
    success: true,
    riskScore: 15
  }
}
```

### Chat Message Event

```typescript
{
  eventType: 'chat_message',
  eventId: '223e4567-e89b-12d3-a456-426614174001',
  timestamp: 1704067200000,
  isTest: false,
  userId: 'user-123',
  source: 'chat-v2',
  eventData: {
    conversationId: '323e4567-e89b-12d3-a456-426614174002',
    messageId: '423e4567-e89b-12d3-a456-426614174003',
    role: 'assistant',
    modelId: 'claude-sonnet-4.5',
    inputTokens: 150,
    outputTokens: 300,
    latencyMs: 2500,
    toolsUsed: ['query_knowledge_base', 'web_search'],
    chatVersion: 'v2'
  }
}
```

### Agent Execution Event

```typescript
{
  eventType: 'agent_executed',
  eventId: '523e4567-e89b-12d3-a456-426614174004',
  timestamp: 1704067200000,
  isTest: false,
  userId: 'user-123',
  source: 'agent-scheduler',
  eventData: {
    agentId: 'agent-xyz',
    executionId: '623e4567-e89b-12d3-a456-426614174005',
    trigger: 'scheduled',
    scheduleId: 'schedule-abc',
    messageCount: 8,
    totalTokens: 5000,
    durationMs: 45000,
    success: true
  }
}
```

## Schema Files

```
lib/usage-analytics-schemas/
├── index.ts                          # Main export with discriminated union
├── base-event.ts                     # BaseEventSchema
├── contract-generator.ts             # OpenAPI spec generator
├── events/
│   ├── login-event.ts
│   ├── chat-message-event.ts
│   ├── chat-conversation-event.ts
│   ├── agent-created-event.ts
│   ├── agent-executed-event.ts
│   ├── file-upload-event.ts
│   ├── file-delete-event.ts
│   ├── kb-created-event.ts
│   ├── kb-deleted-event.ts
│   ├── kb-query-event.ts
│   ├── integration-activated-event.ts
│   ├── integration-tool-call-event.ts
│   └── secret-accessed-event.ts
└── package.json
```

## Development

### Adding a New Event Type

1. Create `events/{event-name}-event.ts`:

```typescript
import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

export const MyEventDataSchema = z.object({
  // Event-specific fields
});

export const MyEventSchema = BaseEventSchema.extend({
  eventType: z.literal('my_event'),
  eventData: MyEventDataSchema,
});

export type MyEvent = z.infer<typeof MyEventSchema>;
```

2. Add to `base-event.ts` enum:

```typescript
eventType: z.enum([
  'login',
  // ... existing types
  'my_event', // Add here
]),
```

3. Add to discriminated union in `index.ts`:

```typescript
export const UsageEventSchema = z.discriminatedUnion('eventType', [
  LoginEventSchema,
  // ... existing schemas
  MyEventSchema, // Add here
]);
```

## Dependencies

- `zod@^3.22.4` - Schema validation
- `zod-to-json-schema@^3.22.3` - OpenAPI generation

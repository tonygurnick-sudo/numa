import { zodToJsonSchema } from 'zod-to-json-schema';
import { UsageEventSchema } from './index';

/**
 * Generates an OpenAPI 3.0 specification for the Usage Analytics API
 * @param apiBaseUrl Base URL for the API (e.g., https://api.example.com)
 * @returns OpenAPI 3.0 spec object
 */
export const generateOpenApiSpec = (apiBaseUrl: string) => {
  // Convert Zod schema to JSON Schema (cast needed: ZodDiscriminatedUnion is too deep for zod-to-json-schema's type parameter)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventJsonSchema = zodToJsonSchema(UsageEventSchema as any, {
    name: 'UsageEvent',
    $refStrategy: 'none', // Inline all schemas for better readability
  });

  return {
    openapi: '3.0.0',
    info: {
      title: 'Numa Usage Analytics API',
      version: '1.0.0',
      description: `
# Numa Usage Analytics API

This API allows you to ingest usage analytics events for testing and monitoring purposes.

## Authentication

All requests to the ingest endpoint require an API key passed in the \`X-Analytics-API-Key\` header.

## Event Types

The API supports the following event types:

- **login**: User authentication events
- **chat_message**: Individual chat messages (V1 and V2)
- **chat_conversation**: Conversation lifecycle events
- **agent_created**: Agent creation events
- **agent_executed**: Agent execution events (manual or scheduled)
- **file_upload**: File upload events
- **file_delete**: File deletion events
- **kb_created**: Knowledge base creation
- **kb_deleted**: Knowledge base deletion
- **kb_query**: Knowledge base queries
- **integration_activated**: Integration connection/disconnection
- **integration_tool_call**: Integration tool invocations
- **secret_accessed**: Company secret access audit events

## Test Data

All events with \`isTest: true\` can be bulk deleted via the admin UI. Use test data for development and verification purposes.

## Rate Limits

API Gateway throttling applies (10,000 requests/second default).
      `.trim(),
      contact: {
        name: 'Numa Support',
        url: 'https://hq.numa.arcanum.ai',
      },
    },
    servers: [
      {
        url: apiBaseUrl,
        description: 'Production API',
      },
    ],
    paths: {
      '/api/usage-analytics/ingest': {
        post: {
          summary: 'Ingest usage analytics event',
          description: 'Submit a usage analytics event. Validates the event schema and stores it in DynamoDB.',
          operationId: 'ingestEvent',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            description: 'Usage analytics event conforming to one of the supported event types',
            content: {
              'application/json': {
                schema: eventJsonSchema,
                examples: {
                  'login-success': {
                    summary: 'Successful login event',
                    value: {
                      eventType: 'login',
                      eventId: '123e4567-e89b-12d3-a456-426614174000',
                      timestamp: Date.now(),
                      isTest: true,
                      userId: 'user-123',
                      source: 'test-api',
                      eventData: {
                        ipAddress: '192.168.1.1',
                        userAgent: 'Mozilla/5.0...',
                        loginMethod: 'cognito',
                        success: true,
                      },
                    },
                  },
                  'chat-message': {
                    summary: 'Chat message event',
                    value: {
                      eventType: 'chat_message',
                      eventId: '223e4567-e89b-12d3-a456-426614174001',
                      timestamp: Date.now(),
                      isTest: true,
                      userId: 'user-123',
                      source: 'test-api',
                      eventData: {
                        conversationId: '323e4567-e89b-12d3-a456-426614174002',
                        messageId: '423e4567-e89b-12d3-a456-426614174003',
                        role: 'user',
                        inputTokens: 150,
                        chatVersion: 'v1',
                      },
                    },
                  },
                  'agent-created': {
                    summary: 'Agent creation event',
                    value: {
                      eventType: 'agent_created',
                      eventId: '523e4567-e89b-12d3-a456-426614174004',
                      timestamp: Date.now(),
                      isTest: true,
                      userId: 'user-123',
                      source: 'test-api',
                      eventData: {
                        agentId: 'agent-xyz',
                        agentTitle: 'My Custom Agent',
                        visibility: 'personal',
                        hasCustomInstructions: true,
                        toolsEnabled: ['web_search', 'query_kb'],
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Event successfully ingested',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: {
                        type: 'boolean',
                        example: true,
                      },
                      eventId: {
                        type: 'string',
                        format: 'uuid',
                        example: '123e4567-e89b-12d3-a456-426614174000',
                      },
                    },
                    required: ['success', 'eventId'],
                  },
                },
              },
            },
            '400': {
              description: 'Invalid event schema',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: {
                        type: 'string',
                        example: 'Invalid event schema',
                      },
                      details: {
                        type: 'string',
                        example: 'eventType: Required',
                      },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Invalid or missing API key',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: {
                        type: 'string',
                        example: 'Invalid or expired API key',
                      },
                    },
                  },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: {
                        type: 'string',
                        example: 'Internal server error',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Analytics-API-Key',
          description: 'API key for authentication. Format: `numa_{64 hex characters}`. Obtain from admin UI.',
        },
      },
      schemas: {
        UsageEvent: eventJsonSchema,
      },
    },
  };
};

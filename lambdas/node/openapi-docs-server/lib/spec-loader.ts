import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const logger = {
  warn: (msg: string, meta?: any) => console.warn(`WARN: ${msg}`, meta ? JSON.stringify(meta) : ''),
  error: (msg: string, meta?: any) => console.error(`ERROR: ${msg}`, meta ? JSON.stringify(meta) : ''),
};

/**
 * Load and process OpenAPI specification files
 * Supports both static YAML files and dynamic generation
 */
export async function loadOpenAPISpec(filename: string): Promise<string | null> {
  try {
    // Handle different specification files
    switch (filename) {
      case 'combined.yaml':
        return await generateCombinedSpec();
      case 'chat-agent.yaml':
        return await loadStaticSpec('chat-agent.yaml');
      case 'core-lambdas.yaml':
        return await loadStaticSpec('core-lambdas.yaml');
      case 'admin-apis.yaml':
        return await loadStaticSpec('admin-apis.yaml');
      case 'numa-apps.yaml':
        return await generateNumaAppsSpec();
      default:
        logger.warn('Unknown spec file requested', { filename });
        return null;
    }
  } catch (error) {
    logger.error('Error loading OpenAPI spec', { error, filename });
    return null;
  }
}

/**
 * Load a static YAML specification file
 */
async function loadStaticSpec(filename: string): Promise<string> {
  const specsDir = path.join(__dirname, '../../specs');
  const filePath = path.join(specsDir, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Specification file not found: ${filename}`);
  }

  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Generate the combined specification that includes all APIs
 */
async function generateCombinedSpec(): Promise<string> {
  const clientName = process.env.CLIENT_NAME || 'numa';
  const apiBaseUrl = process.env.API_BASE_URL || 'https://api.numa.ai';

  const combinedSpec = {
    openapi: '3.0.3',
    info: {
      title: `${clientName.charAt(0).toUpperCase() + clientName.slice(1)} API Documentation`,
      description: `Complete API documentation for all ${clientName} services including Chat Agent, Core Lambdas, Admin APIs, and Numa Apps.`,
      version: '1.0.0',
      contact: {
        name: 'Numa Platform',
        url: 'https://numa.ai',
      },
      license: {
        name: 'Proprietary',
        url: 'https://numa.ai/legal/terms',
      },
    },
    servers: [
      {
        url: apiBaseUrl,
        description: `${clientName} Production API`,
      },
    ],
    components: {
      securitySchemes: {
        CognitoAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Cognito JWT token obtained through authentication flow',
        },
        CloudFrontSecret: {
          type: 'apiKey',
          in: 'header',
          name: 'x-arcanum-cloudfront-secret',
          description: 'CloudFront shared secret for direct API access',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message',
            },
            code: {
              type: 'string',
              description: 'Error code',
            },
          },
          required: ['error'],
        },
        ChatMessage: {
          type: 'object',
          properties: {
            role: {
              type: 'string',
              enum: ['user', 'assistant', 'system'],
            },
            content: {
              type: 'string',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
          },
          required: ['role', 'content'],
        },
        KnowledgeBase: {
          type: 'object',
          properties: {
            kb_id: {
              type: 'string',
              description: 'Knowledge base identifier',
            },
            kb_name: {
              type: 'string',
              description: 'Knowledge base display name',
            },
            role: {
              type: 'string',
              enum: ['OWNER', 'EDITOR', 'VIEWER'],
              description: 'User role for this knowledge base',
            },
            is_shared: {
              type: 'boolean',
              description: 'Whether this knowledge base is shared',
            },
          },
          required: ['kb_id', 'kb_name', 'role'],
        },
      },
    },
    paths: await generateCombinedPaths(),
    tags: [
      {
        name: 'Chat Agent',
        description: 'AI chat and knowledge base operations',
      },
      {
        name: 'Core Lambdas',
        description: 'Utility and processing APIs',
      },
      {
        name: 'Admin APIs',
        description: 'Administrative and settings management',
      },
      {
        name: 'Numa Apps',
        description: 'Step Function orchestrated AI applications',
      },
    ],
  };

  return yaml.dump(combinedSpec, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
  });
}

/**
 * Generate combined paths from all API specifications
 */
async function generateCombinedPaths(): Promise<Record<string, any>> {
  const paths: Record<string, any> = {};

  try {
    // Add Chat Agent paths
    const chatAgentPaths = await getChatAgentPaths();
    Object.assign(paths, chatAgentPaths);

    // Add Core Lambda paths
    const coreLambdaPaths = await getCoreLambdaPaths();
    Object.assign(paths, coreLambdaPaths);

    // Add Admin API paths
    const adminApiPaths = await getAdminApiPaths();
    Object.assign(paths, adminApiPaths);

    // Add Numa Apps paths
    const numaAppsPaths = await getNumaAppsPaths();
    Object.assign(paths, numaAppsPaths);
  } catch (error) {
    logger.error('Error generating combined paths', { error });
  }

  return paths;
}

/**
 * Get Chat Agent API paths
 */
async function getChatAgentPaths(): Promise<Record<string, any>> {
  return {
    '/': {
      get: {
        tags: ['Chat Agent'],
        summary: 'Health check',
        description: 'Simple health check endpoint',
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    service: { type: 'string', example: 'numa-chat-agent' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/numa-chat-agent/stream': {
      post: {
        tags: ['Chat Agent'],
        summary: 'Streaming chat conversation',
        description: 'Start a streaming chat conversation with AI assistant',
        security: [{ CognitoAuth: [] }, { CloudFrontSecret: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: {
                    type: 'string',
                    description: 'User message',
                  },
                  conversation_id: {
                    type: 'string',
                    description: 'Optional conversation ID for continuity',
                  },
                  kb_id: {
                    type: 'string',
                    description: 'Knowledge base to use for context',
                  },
                },
                required: ['message'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Streaming response with NDJSON events',
            content: {
              'text/plain': {
                schema: {
                  type: 'string',
                  description: 'NDJSON stream of chat events',
                },
              },
            },
          },
          '400': {
            description: 'Bad request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
    '/api/numa-chat-agent/invoke': {
      post: {
        tags: ['Chat Agent'],
        summary: 'Non-streaming chat conversation',
        description: 'Send a message and receive complete response',
        security: [{ CognitoAuth: [] }, { CloudFrontSecret: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  conversation_id: { type: 'string' },
                  kb_id: { type: 'string' },
                },
                required: ['message'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Complete response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    response: { type: 'string' },
                    conversation_id: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/kb': {
      get: {
        tags: ['Chat Agent'],
        summary: 'List knowledge bases',
        description: 'Get all available knowledge bases for the user',
        security: [{ CognitoAuth: [] }, { CloudFrontSecret: [] }],
        responses: {
          '200': {
            description: 'List of knowledge bases',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/KnowledgeBase' },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Chat Agent'],
        summary: 'Create knowledge base',
        description: 'Create a new knowledge base',
        security: [{ CognitoAuth: [] }, { CloudFrontSecret: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  kb_name: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['kb_name'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Knowledge base created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/KnowledgeBase' },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Get Core Lambda API paths (placeholder - will be expanded)
 */
async function getCoreLambdaPaths(): Promise<Record<string, any>> {
  return {
    '/api/srp-hasher': {
      post: {
        tags: ['Core Lambdas'],
        summary: 'SRP hash generator',
        description: 'Generate SRP hash for authentication',
        security: [{ CloudFrontSecret: [] }],
        responses: {
          '200': {
            description: 'SRP hash generated successfully',
          },
        },
      },
    },
    '/api/web-search': {
      post: {
        tags: ['Core Lambdas'],
        summary: 'Web search',
        description: 'Perform web search queries',
        security: [{ CognitoAuth: [] }, { CloudFrontSecret: [] }],
        responses: {
          '200': {
            description: 'Search results returned',
          },
        },
      },
    },
  };
}

/**
 * Get Admin API paths (placeholder - will be expanded)
 */
async function getAdminApiPaths(): Promise<Record<string, any>> {
  return {
    '/api/settings/integrations': {
      get: {
        tags: ['Admin APIs'],
        summary: 'Get integration settings',
        description: 'Retrieve current integration configurations',
        security: [{ CognitoAuth: [] }, { CloudFrontSecret: [] }],
        responses: {
          '200': {
            description: 'Integration settings retrieved',
          },
        },
      },
    },
  };
}

/**
 * Get Numa Apps paths (placeholder - will be expanded)
 */
async function getNumaAppsPaths(): Promise<Record<string, any>> {
  const apps = [
    'document-summariser',
    'policy-builder',
    'candidate-screening',
    'financial-analysis',
    'contract-review',
    'market-research',
  ];

  const paths: Record<string, any> = {};

  for (const app of apps) {
    paths[`/api/${app}`] = {
      post: {
        tags: ['Numa Apps'],
        summary: `Start ${app} execution`,
        description: `Start a new ${app} workflow execution`,
        security: [{ CognitoAuth: [] }, { CloudFrontSecret: [] }],
        responses: {
          '200': {
            description: 'Execution started successfully',
          },
        },
      },
      get: {
        tags: ['Numa Apps'],
        summary: `Get ${app} status`,
        description: `Get status and results of ${app} execution`,
        security: [{ CognitoAuth: [] }, { CloudFrontSecret: [] }],
        responses: {
          '200': {
            description: 'Execution status retrieved',
          },
        },
      },
    };
  }

  return paths;
}

/**
 * Generate dynamic Numa Apps specification
 */
async function generateNumaAppsSpec(): Promise<string> {
  // This would dynamically discover apps from infrastructure
  // For now, return a static specification
  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'Numa Apps API',
      version: '1.0.0',
    },
    paths: await getNumaAppsPaths(),
  };

  return yaml.dump(spec);
}

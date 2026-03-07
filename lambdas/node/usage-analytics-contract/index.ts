import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { generateOpenApiSpec } from '../../../lib/usage-analytics-schemas/contract-generator';

const API_BASE_URL = process.env.API_BASE_URL ?? 'https://api.example.com';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

/**
 * Lambda handler for usage analytics API contract endpoint.
 * Returns OpenAPI 3.0 specification with Zod schemas.
 *
 * This is a public endpoint with no authentication required.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: HEADERS,
      body: '',
    };
  }

  try {
    // Generate OpenAPI spec from Zod schemas
    const spec = generateOpenApiSpec(API_BASE_URL);

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify(spec, null, 2),
    };
  } catch (error) {
    console.error('Failed to generate contract:', error);

    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

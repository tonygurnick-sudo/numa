import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as fs from 'fs';
import * as path from 'path';
import * as mime from 'mime-types';
import { loadOpenAPISpec } from './lib/spec-loader.js';
import { generateSwaggerConfig } from './lib/swagger-config.js';

// Simple logger without powertools to reduce bundle size
const logger = {
  info: (msg: string, meta?: any) => console.log(`INFO: ${msg}`, meta ? JSON.stringify(meta) : ''),
  error: (msg: string, meta?: any) => console.error(`ERROR: ${msg}`, meta ? JSON.stringify(meta) : ''),
};

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

/**
 * Main Lambda handler for OpenAPI documentation server
 * Serves Swagger UI, OpenAPI specifications, and handles authentication
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logger.info('Processing request', {
    path: event.path,
    method: event.httpMethod,
    headers: event.headers,
  });

  try {
    const path = event.path || '/';
    const method = event.httpMethod;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return createCorsResponse(200, '');
    }

    // Route requests
    if (path === '/docs' || path === '/docs/' || path === '/') {
      return serveSwaggerUI();
    } else if (path.startsWith('/docs/api/')) {
      return handleApiSpecRequest(path);
    } else if (path.startsWith('/docs/static/')) {
      return serveStaticAsset(path);
    } else {
      return createResponse(404, { error: 'Not Found' });
    }
  } catch (error) {
    logger.error('Error processing request', { error });
    return createResponse(500, { error: 'Internal Server Error' });
  }
};

/**
 * Serve the main Swagger UI interface
 */
function serveSwaggerUI(): LambdaResponse {
  try {
    // Get environment configuration
    const clientName = process.env.CLIENT_NAME || 'numa';
    const apiBaseUrl = process.env.API_BASE_URL || '';
    const cognitoUserPoolId = process.env.COGNITO_USER_POOL_ID || '';
    const cognitoUserPoolClientId = process.env.COGNITO_USER_POOL_CLIENT_ID || '';

    const swaggerConfig = generateSwaggerConfig({
      clientName,
      apiBaseUrl,
      cognitoUserPoolId,
      cognitoUserPoolClientId,
    });

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Numa API Documentation</title>
  <link rel="stylesheet" href="/docs/static/swagger-ui-bundle.css" />
  <link rel="stylesheet" href="/docs/static/swagger-ui-standalone-preset.css" />
  <style>
    html {
      box-sizing: border-box;
      overflow: -moz-scrollbars-vertical;
      overflow-y: scroll;
    }
    *, *:before, *:after {
      box-sizing: inherit;
    }
    body {
      margin:0;
      background: #fafafa;
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/static/swagger-ui-bundle.js"></script>
  <script src="/docs/static/swagger-ui-standalone-preset.js"></script>
  <script>
    const ui = SwaggerUIBundle({
      url: '/docs/api/combined.yaml',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIStandalonePreset
      ],
      plugins: [
        SwaggerUIBundle.plugins.DownloadUrl
      ],
      layout: "StandaloneLayout",
      onComplete: function() {
        // Add custom authentication handling
        ${swaggerConfig}
      }
    });
  </script>
</body>
</html>`;

    return createResponse(200, html, 'text/html');
  } catch (error) {
    logger.error('Error serving Swagger UI', { error });
    return createResponse(500, { error: 'Failed to load Swagger UI' });
  }
}

/**
 * Handle requests for OpenAPI specifications
 */
async function handleApiSpecRequest(path: string): Promise<LambdaResponse> {
  try {
    const specFile = path.replace('/docs/api/', '');
    const spec = await loadOpenAPISpec(specFile);

    if (!spec) {
      return createResponse(404, { error: 'Specification not found' });
    }

    return createResponse(200, spec, 'application/yaml');
  } catch (error) {
    logger.error('Error loading API specification', { error, path });
    return createResponse(500, { error: 'Failed to load API specification' });
  }
}

/**
 * Serve static assets (Swagger UI CSS/JS files)
 */
function serveStaticAsset(requestPath: string): LambdaResponse {
  try {
    const assetPath = requestPath.replace('/docs/static/', '');
    const swaggerUiPath = require.resolve('swagger-ui-dist/package.json');
    const swaggerUiDir = path.dirname(swaggerUiPath);
    const filePath = path.join(swaggerUiDir, assetPath);

    if (!fs.existsSync(filePath)) {
      return createResponse(404, { error: 'Asset not found' });
    }

    const content = fs.readFileSync(filePath);
    const mimeType = mime.lookup(assetPath) || 'application/octet-stream';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=86400', // 24 hours
        ...getCorsHeaders(),
      },
      body: content.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    logger.error('Error serving static asset', { error, path: requestPath });
    return createResponse(500, { error: 'Failed to serve static asset' });
  }
}

/**
 * Create a standardized HTTP response
 */
function createResponse(statusCode: number, body: any, contentType: string = 'application/json'): LambdaResponse {
  const responseBody = typeof body === 'string' ? body : JSON.stringify(body);

  return {
    statusCode,
    headers: {
      'Content-Type': contentType,
      ...getCorsHeaders(),
    },
    body: responseBody,
  };
}

/**
 * Create CORS preflight response
 */
function createCorsResponse(statusCode: number, body: string): LambdaResponse {
  return {
    statusCode,
    headers: {
      ...getCorsHeaders(),
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-arcanum-cloudfront-secret',
    },
    body,
  };
}

/**
 * Get standard CORS headers
 */
function getCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': 'false',
  };
}

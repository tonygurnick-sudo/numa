# OpenAPI Documentation Server

A comprehensive OpenAPI documentation server for all Numa APIs with interactive Swagger UI.

## Overview

This Lambda function serves as a centralized documentation hub for all Numa APIs, providing:

- **Interactive Documentation**: Full Swagger UI with live API testing capabilities
- **Comprehensive Coverage**: Documents Chat Agent, Core Lambdas, Admin APIs, and Numa Apps
- **Authentication Support**: Integrated Cognito authentication for API testing
- **Modular Design**: Organized OpenAPI specifications for maintainability

## Architecture

### Components

- **Lambda Handler** (`index.ts`): Main request routing and response handling
- **Spec Loader** (`lib/spec-loader.ts`): Dynamic OpenAPI specification generation
- **Swagger Config** (`lib/swagger-config.ts`): Authentication and UI configuration
- **OpenAPI Specs** (`specs/`): Modular YAML specifications for different API groups

### API Coverage

#### Chat Agent APIs

- Health check endpoint
- Streaming and non-streaming chat
- Knowledge base management (CRUD operations)

#### Core Lambda APIs

- Authentication (SRP hasher)
- Web search and content scraping
- Document processing and conversion
- Web crawler management

#### Admin APIs

- Integration settings management
- Agent configuration and management
- Branding configuration

#### Numa Apps

- Document Summariser
- Policy Builder
- Candidate Screening
- Financial Analysis
- Job management for batch operations

## Deployment

### Infrastructure Integration

The OpenAPI docs server is deployed using the `OpenAPIDocsConstruct`:

```typescript
import { OpenAPIDocsConstruct } from './constructs/openapi-docs-construct';

const openApiDocs = new OpenAPIDocsConstruct(this, 'openapi-docs', {
  clientName: 'your-client-name',
  cognitoUserPoolId: 'us-east-1_xxxxxx',
  cognitoUserPoolClientId: 'xxxxxxxxxx',
  apiBaseUrl: 'https://api.your-domain.com',
  cloudfrontSecretArn: 'arn:aws:ssm:...',
  logGroup: logGroup,
});
```

### CloudFront Integration

The documentation is accessible via CloudFront at `/docs/*` paths:

- `/docs/` or `/docs` - Main Swagger UI
- `/docs/api/{spec}.yaml` - OpenAPI specifications
- `/docs/static/*` - Swagger UI static assets

### Environment Variables

- `CLIENT_NAME`: Client identifier for branding
- `API_BASE_URL`: Base URL for API endpoints
- `COGNITO_USER_POOL_ID`: Cognito User Pool for authentication
- `COGNITO_USER_POOL_CLIENT_ID`: Cognito Client ID
- `CLOUDFRONT_SECRET_ARN`: SSM parameter for CloudFront shared secret

## Usage

### Accessing Documentation

Visit `https://{your-domain}/docs` to access the interactive API documentation.

### Authentication for Testing

1. Click the authentication section in the top-right corner of the Swagger UI
2. Enter your Cognito credentials (email and password)
3. The system will automatically inject JWT tokens for API requests
4. CloudFront shared secrets are automatically handled

### API Testing

Once authenticated, you can:

- Browse all available APIs organized by service
- View detailed request/response schemas
- Test APIs directly from the browser
- See example requests and responses
- Understand authentication requirements

## Development

### Building

```bash
yarn install    # Install dependencies
yarn build      # Compile TypeScript
yarn bundle     # Create Lambda deployment package
```

### Testing Locally

```bash
yarn lint       # Run ESLint and TypeScript checks
yarn test       # Run unit tests (when implemented)
```

### Adding New APIs

1. **Update Specifications**: Add new endpoints to the appropriate YAML file in `specs/`
2. **Dynamic Discovery**: Modify `spec-loader.ts` for runtime API discovery
3. **Authentication**: Ensure proper security schemes are defined
4. **Examples**: Include comprehensive request/response examples

### Specification Structure

```
specs/
├── chat-agent.yaml     # Chat and knowledge base APIs
├── core-lambdas.yaml   # Utility and processing APIs
├── admin-apis.yaml     # Administrative endpoints
└── numa-apps.yaml      # Step Function orchestrated applications
```

## Security

### Authentication Flow

1. **Public Access**: Documentation viewing requires no authentication
2. **Interactive Testing**: Requires Cognito JWT token
3. **CloudFront Protection**: All requests must include shared secret header
4. **CORS Configuration**: Properly configured for browser-based testing

### Headers Required

- `Authorization: Bearer {jwt-token}` - For authenticated API calls
- `x-arcanum-cloudfront-secret: {secret}` - Auto-injected by CloudFront

## Performance

- **Bundle Size**: ~48KB compressed Lambda package
- **Memory**: 256MB allocated
- **Timeout**: 30 seconds
- **Cold Start**: < 2 seconds with Swagger UI assets
- **Caching**: Static assets cached for 24 hours

## Troubleshooting

### Common Issues

1. **404 on /docs**: Ensure CloudFront cache behavior is configured for `/docs/*`
2. **Authentication Fails**: Verify Cognito pool configuration and user credentials
3. **API Calls Fail**: Check CloudFront secret configuration and JWT token validity
4. **Slow Loading**: Swagger UI assets are loaded from CDN, check network connectivity

### Logging

All requests and errors are logged to CloudWatch. Search for:

- `INFO: Processing request` - Request details
- `ERROR: Error processing request` - General errors
- `WARN: Unknown spec file requested` - Missing specification files

## Future Enhancements

### Planned Features

1. **Dynamic App Discovery**: Automatically detect and document new Numa Apps
2. **Real-time Updates**: WebSocket support for live API updates
3. **API Analytics**: Usage metrics and performance monitoring
4. **Custom Themes**: Client-specific branding and styling
5. **Multi-Environment**: Support for dev/staging/prod documentation

### Extensibility

The modular design supports easy extension:

- Add new specification files in `specs/`
- Implement custom authentication flows
- Add new output formats (PDF, JSON, etc.)
- Integrate with external documentation systems

## Support

For issues or questions:

1. Check CloudWatch logs for error details
2. Verify infrastructure configuration
3. Test individual API specifications
4. Contact the development team with specific error messages and request IDs

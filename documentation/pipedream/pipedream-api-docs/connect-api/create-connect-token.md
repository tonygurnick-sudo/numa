> ## Documentation Index
>
> Fetch the complete documentation index at: https://pipedream.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Create Connect token

> Create a Connect token for a user

Your app will initiate the account connection flow for your end users in your frontend. To securely scope connection to a specific end user, on your server, **you retrieve a short-lived token for that user**, and return that token to your frontend.

See [the Connect tokens docs](/connect/managed-auth/tokens/) for more information.

When using the Connect API to make requests from a client environment like a browser, you must specify the **allowed origins** for the token. Otherwise, this field is optional. This is a list of URLs that are allowed to make requests with the token. For example:

```json theme={null}
{
  "allowed_origins": ["https://myapp.com"]
}
```

## OpenAPI

```yaml post /v1/connect/{project_id}/tokens
openapi: 3.0.4
info:
  version: 2.0.0
  title: Pipedream REST API
servers:
  - url: https://api.pipedream.com
security: []
paths:
  /v1/connect/{project_id}/tokens:
    parameters:
      - name: project_id
        in: path
        required: true
        description: The project ID, which starts with `proj_`.
        schema:
          type: string
          pattern: ^proj_[a-zA-Z0-9]+$
        x-fern-sdk-variable: project_id
    post:
      summary: Create Connect token
      description: Generate a Connect token to use for client-side authentication
      operationId: createToken
      parameters:
        - name: x-pd-environment
          in: header
          required: true
          description: The environment in which the server client is running
          schema:
            $ref: '#/components/schemas/ProjectEnvironment'
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateTokenOpts'
      responses:
        '200':
          description: connect token created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CreateTokenResponse'
        '429':
          description: too many requests
          headers:
            Retry-After:
              description: Number of seconds until the rate limit resets
              schema:
                type: integer
            X-RateLimit-Limit:
              schema:
                type: integer
              description: The rate limit threshold
            X-RateLimit-Remaining:
              schema:
                type: integer
              description: Number of requests remaining (always 0 when throttled)
            X-RateLimit-Reset:
              schema:
                type: integer
              description: Unix timestamp when the rate limit resets
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    type: string
                    example: Throttled
      security:
        - connect_token: []
          oauth: []
components:
  schemas:
    ProjectEnvironment:
      type: string
      description: The environment in which the server client is running
      enum:
        - development
        - production
    CreateTokenOpts:
      type: object
      description: Request object for creating a connect token
      required:
        - external_user_id
        - project_id
      properties:
        allowed_origins:
          type: array
          items:
            type: string
          description: List of allowed origins for CORS
        error_redirect_uri:
          type: string
          description: URI to redirect to on error
        external_user_id:
          type: string
          description: Your end user ID, for whom you're creating the token
        success_redirect_uri:
          type: string
          description: URI to redirect to on success
        webhook_uri:
          type: string
          description: Webhook URI for notifications
    CreateTokenResponse:
      type: object
      description: Response received after creating a connect token
      required:
        - connect_link_url
        - expires_at
        - token
      properties:
        connect_link_url:
          type: string
          description: The Connect Link URL
        expires_at:
          type: string
          format: date-time
          description: The expiration time of the token in ISO 8601 format
        token:
          $ref: '#/components/schemas/ConnectToken'
    ConnectToken:
      type: string
      pattern: ^ctok_[0-9a-f]{32}$
      description: An authentication token with a limited lifespan
  securitySchemes:
    connect_token:
      type: http
      scheme: bearer
      bearerFormat: ^ctok_[0-9a-f]{32}$
    oauth:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://api.pipedream.com/v1/oauth/token
          scopes:
            '*': Full access to every OAuth-protected endpoint.
            connect:*: >-
              Full access to all Connect API endpoints (components, projects,
              triggers, accounts, etc.).
            connect:actions:*: Full access to Connect actions.
            connect:triggers:*: Full access to Connect triggers.
            connect:accounts:read: List and fetch Connect accounts for an external user.
            connect:accounts:write: Create or remove Connect accounts.
            connect:deployed_triggers:read: >-
              Read deployed triggers and related data like events, pipelines and
              webhooks.
            connect:deployed_triggers:write: Modify or delete deployed triggers.
            connect:users:read: List and fetch external users
            connect:users:write: Delete external users.
            connect:projects:read: List and fetch projects owned by the workspace.
            connect:projects:write: Create, update, or delete projects owned by the workspace.
            connect:usage:read: List Connect usage records for a time window.
            connect:tokens:create: Create Connect session tokens.
            connect:proxy: Invoke the Connect proxy.
            connect:workflow:invoke: Invoke Connect workflows on behalf of a user.
```

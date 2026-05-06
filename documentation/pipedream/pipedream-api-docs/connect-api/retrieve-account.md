> ## Documentation Index
>
> Fetch the complete documentation index at: https://pipedream.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Retrieve account

> Get the details for a specific connected account

<Note>
  To retrieve credentials for OAuth apps (Slack, Google Sheets, etc), **the connected account must be using [your own OAuth client](/connect/managed-auth/oauth-clients/#using-a-custom-oauth-client)**.
</Note>

<Warning>
  Never return user credentials to the client
</Warning>

## OpenAPI

```yaml get /v1/connect/{project_id}/accounts/{account_id}
openapi: 3.0.4
info:
  version: 2.0.0
  title: Pipedream REST API
servers:
  - url: https://api.pipedream.com
security: []
paths:
  /v1/connect/{project_id}/accounts/{account_id}:
    parameters:
      - name: project_id
        in: path
        required: true
        description: The project ID, which starts with `proj_`.
        schema:
          type: string
          pattern: ^proj_[a-zA-Z0-9]+$
        x-fern-sdk-variable: project_id
      - name: account_id
        in: path
        required: true
        schema:
          type: string
    get:
      summary: Retrieve account
      description: Get the details for a specific connected account
      operationId: retrieveAccount
      parameters:
        - name: x-pd-environment
          in: header
          required: true
          description: The environment in which the server client is running
          schema:
            $ref: '#/components/schemas/ProjectEnvironment'
        - name: include_credentials
          in: query
          description: Whether to retrieve the account's credentials or not
          schema:
            type: boolean
      responses:
        '200':
          description: account retrieved
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Account'
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
    Account:
      type: object
      description: End user account data, returned from the API.
      required:
        - id
      properties:
        id:
          $ref: '#/components/schemas/AccountId'
        name:
          type: string
          description: The custom name of the account if set.
          nullable: true
        external_id:
          type: string
          description: The external ID associated with the account.
        healthy:
          type: boolean
          description: >-
            Indicates if the account is healthy. Pipedream will periodically
            retry token refresh and test requests for unhealthy accounts
        dead:
          type: boolean
          nullable: true
          description: Indicates if the account is no longer active
        app:
          $ref: '#/components/schemas/App'
        created_at:
          type: string
          description: >-
            The date and time the account was created, an ISO 8601 formatted
            string
          format: date-time
        updated_at:
          type: string
          description: >-
            The date and time the account was last updated, an ISO 8601
            formatted string
          format: date-time
        credentials:
          type: object
          description: >-
            The credentials associated with the account, if the
            `include_credentials` parameter was set to true in the request
          nullable: true
        expires_at:
          type: string
          description: >-
            The date and time the account's credentials expiration, an ISO 8601
            formatted string
          format: date-time
        error:
          type: string
          description: >-
            The error message if the account is unhealthy or dead, null
            otherwise
          nullable: true
        last_refreshed_at:
          type: string
          description: >-
            The date and time the account was last refreshed, an ISO 8601
            formatted string
          format: date-time
        next_refresh_at:
          type: string
          description: >-
            The date and time the account will next be refreshed, an ISO 8601
            formatted string
          format: date-time
          nullable: true
    AccountId:
      type: string
      description: The unique ID of the account.
      pattern: ^apn_[a-zA-Z0-9]+$
    App:
      type: object
      description: Response object for a Pipedream app's metadata
      required:
        - name_slug
        - name
        - img_src
        - custom_fields_json
        - categories
        - featured_weight
      properties:
        id:
          type: string
          description: ID of the app. Only applies for OAuth apps.
          nullable: true
        name_slug:
          type: string
          description: >-
            The name slug of the target app (see
            https://pipedream.com/docs/connect/quickstart#find-your-apps-name-slug)
        name:
          type: string
          description: The human-readable name of the app
        auth_type:
          $ref: '#/components/schemas/AppAuthType'
        description:
          type: string
          description: A short description of the app
          nullable: true
        img_src:
          type: string
          description: The URL to the app's logo
        custom_fields_json:
          type: string
          description: A JSON string representing the custom fields for the app
          nullable: true
        categories:
          type: array
          items:
            type: string
          description: Categories associated with the app
        featured_weight:
          type: number
          description: >-
            A rough directional ordering of app popularity, subject to changes
            by Pipedream
    AppAuthType:
      type: string
      enum:
        - keys
        - oauth
        - none
      description: The authentication type used by the app
      nullable: true
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

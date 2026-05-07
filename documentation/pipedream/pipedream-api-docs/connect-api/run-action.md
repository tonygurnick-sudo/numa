> ## Documentation Index
>
> Fetch the complete documentation index at: https://pipedream.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Run action

> Execute an action with the provided configuration and return results

## OpenAPI

```yaml post /v1/connect/{project_id}/actions/run
openapi: 3.0.4
info:
  version: 2.0.0
  title: Pipedream REST API
servers:
  - url: https://api.pipedream.com
security: []
paths:
  /v1/connect/{project_id}/actions/run:
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
      summary: Run action
      description: Execute an action with the provided configuration and return results
      operationId: runAction
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
              $ref: '#/components/schemas/RunActionOpts'
      responses:
        '200':
          description: action ran
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RunActionResponse'
        '202':
          description: Async operation started
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
    RunActionOpts:
      type: object
      description: Request options for running an action
      required:
        - id
        - external_user_id
      properties:
        id:
          type: string
          description: The action component ID
        version:
          type: string
          description: >-
            Optional action component version (in SemVer format, for example
            '1.0.0'), defaults to latest
          example: 1.2.3
          nullable: true
        external_user_id:
          type: string
          description: The external user ID
        configured_props:
          $ref: '#/components/schemas/ConfiguredProps'
        dynamic_props_id:
          type: string
          description: The ID for dynamic props
        stash_id:
          $ref: '#/components/schemas/RunActionOptsStashId'
    RunActionResponse:
      type: object
      description: >-
        The response received after running an action. See
        https://pipedream.com/docs/components/api#returning-data-from-steps for
        more details.
      properties:
        exports:
          description: The key-value pairs resulting from calls to `$.export`
        os:
          description: Any logs produced during the execution of the action
        ret:
          description: The value returned by the action
        stash_id:
          $ref: '#/components/schemas/StashId'
    ConfiguredProps:
      type: object
      description: The configured properties of the component
      additionalProperties:
        $ref: '#/components/schemas/ConfiguredPropValue'
    RunActionOptsStashId:
      anyOf:
        - $ref: '#/components/schemas/StashId'
        - type: string
          enum:
            - NEW
        - type: boolean
      description: >-
        The ID of the File Stash to use for syncing the action's /tmp directory,
        or either `true` or 'NEW' to create a new stash
      nullable: true
    StashId:
      type: string
      description: The ID of the File Stash
      nullable: true
    ConfiguredPropValue:
      nullable: false
      oneOf:
        - $ref: '#/components/schemas/ConfiguredPropValueAny'
        - $ref: '#/components/schemas/ConfiguredPropValueApp'
        - $ref: '#/components/schemas/ConfiguredPropValueBoolean'
        - $ref: '#/components/schemas/ConfiguredPropValueInteger'
        - $ref: '#/components/schemas/ConfiguredPropValueObject'
        - $ref: '#/components/schemas/ConfiguredPropValueSql'
        - $ref: '#/components/schemas/ConfiguredPropValueString'
        - $ref: '#/components/schemas/ConfiguredPropValueStringArray'
    ConfiguredPropValueAny:
      nullable: false
    ConfiguredPropValueApp:
      type: object
      required:
        - authProvisionId
      properties:
        authProvisionId:
          $ref: '#/components/schemas/AccountId'
    ConfiguredPropValueBoolean:
      type: boolean
    ConfiguredPropValueInteger:
      type: number
    ConfiguredPropValueObject:
      type: object
    ConfiguredPropValueSql:
      type: object
      required:
        - value
        - query
        - params
        - usePreparedStatements
      properties:
        value:
          type: string
          description: The raw SQL query, as provided by the user
        query:
          type: string
          description: The SQL query to execute
        params:
          type: array
          description: The list of parameters for the prepared statement
          items:
            type: string
        usePreparedStatements:
          type: boolean
          description: Whether to use prepared statements for the query or not
    ConfiguredPropValueString:
      type: string
    ConfiguredPropValueStringArray:
      type: array
      items:
        type: string
    AccountId:
      type: string
      description: The unique ID of the account.
      pattern: ^apn_[a-zA-Z0-9]+$
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

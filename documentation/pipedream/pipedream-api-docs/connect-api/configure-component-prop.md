> ## Documentation Index
>
> Fetch the complete documentation index at: https://pipedream.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Configure component prop

> Retrieve remote options for a given prop for a component

## OpenAPI

```yaml post /v1/connect/{project_id}/components/configure
openapi: 3.0.4
info:
  version: 2.0.0
  title: Pipedream REST API
servers:
  - url: https://api.pipedream.com
security: []
paths:
  /v1/connect/{project_id}/components/configure:
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
      summary: Configure component prop
      description: Retrieve remote options for a given prop for a component
      operationId: configureComponentProp
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
              $ref: '#/components/schemas/ConfigurePropOpts'
      responses:
        '200':
          description: component configuration started
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ConfigurePropResponse'
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
    ConfigurePropOpts:
      type: object
      description: Request options for configuring a component's prop
      required:
        - id
        - external_user_id
        - prop_name
      properties:
        id:
          type: string
          description: The component ID
        version:
          type: string
          description: >-
            Optional component version (in SemVer format, for example '1.0.0'),
            defaults to latest
          example: 1.2.3
          nullable: true
        external_user_id:
          type: string
          description: The external user ID
        prop_name:
          type: string
          description: The name of the prop to configure
        blocking:
          type: boolean
          description: Whether this operation should block until completion
        configured_props:
          $ref: '#/components/schemas/ConfiguredProps'
        dynamic_props_id:
          type: string
          description: The ID for dynamic props
        page:
          type: number
          description: Page number for paginated results
        prev_context:
          type: object
          description: Previous context for pagination
        query:
          type: string
          description: Search query for filtering options
    ConfigurePropResponse:
      type: object
      description: Response received after configuring a component's prop
      properties:
        options:
          $ref: '#/components/schemas/ConfigurePropOptions'
        stringOptions:
          type: array
          items:
            type: string
          description: Available options for the configured prop
          nullable: true
        observations:
          type: array
          items:
            $ref: '#/components/schemas/Observation'
          nullable: true
        context:
          type: object
          description: New context after configuring the prop
          nullable: true
        errors:
          type: array
          items:
            type: string
          description: Any errors that occurred during configuration
    ConfiguredProps:
      type: object
      description: The configured properties of the component
      additionalProperties:
        $ref: '#/components/schemas/ConfiguredPropValue'
    ConfigurePropOptions:
      type: array
      items:
        anyOf:
          - $ref: '#/components/schemas/PropOption'
          - $ref: '#/components/schemas/PropOptionNested'
      description: Available options (with labels) for the configured prop
      nullable: true
    Observation:
      type: object
      description: Any logs produced during the configuration of the prop
      required:
        - k
        - ts
      properties:
        err:
          $ref: '#/components/schemas/ObservationError'
        k:
          type: string
          description: The source of the log (e.g. `console.log`)
        msg:
          type: string
          description: The log message
        ts:
          type: number
          description: >-
            The time at which the log was produced, as milliseconds since the
            epoch
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
    PropOption:
      type: object
      description: A configuration option for a component's prop
      required:
        - label
        - value
      properties:
        label:
          type: string
          description: The human-readable label for the option
        value:
          $ref: '#/components/schemas/PropOptionValue'
    PropOptionNested:
      type: object
      description: A configuration option for a component's prop (nested under `__lv`)
      required:
        - __lv
      properties:
        __lv:
          $ref: '#/components/schemas/PropOption'
    ObservationError:
      type: object
      description: Details about an observed error message
      properties:
        name:
          type: string
          description: The name of the error/exception
        message:
          type: string
          description: The error message
        stack:
          type: string
          description: The stack trace of the error
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
    PropOptionValue:
      description: The value of a prop option
      oneOf:
        - type: string
        - type: integer
        - type: boolean
      nullable: true
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

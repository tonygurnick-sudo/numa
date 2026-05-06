> ## Documentation Index
>
> Fetch the complete documentation index at: https://pipedream.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# List apps

> Retrieve all available apps with optional filtering and sorting

## OpenAPI

```yaml get /v1/connect/apps
openapi: 3.0.4
info:
  version: 2.0.0
  title: Pipedream REST API
servers:
  - url: https://api.pipedream.com
security: []
paths:
  /v1/connect/apps:
    get:
      summary: List apps
      description: Retrieve all available apps with optional filtering and sorting
      operationId: listApps
      parameters:
        - name: after
          in: query
          required: false
          description: The cursor to start from for pagination
          schema:
            type: string
        - name: before
          in: query
          required: false
          description: The cursor to end before for pagination
          schema:
            type: string
        - name: limit
          in: query
          required: false
          description: The maximum number of results to return
          schema:
            type: integer
        - name: q
          in: query
          required: false
          description: A search query to filter the apps
          schema:
            type: string
        - name: sort_key
          in: query
          required: false
          description: The key to sort the apps by
          schema:
            type: string
            enum:
              - name
              - name_slug
              - featured_weight
        - name: sort_direction
          in: query
          required: false
          description: The direction to sort the apps
          schema:
            type: string
            enum:
              - asc
              - desc
        - name: category_ids
          in: query
          required: false
          description: Only return apps in these categories
          schema:
            type: array
            items:
              type: string
              description: The ID of an app category
              pattern: ^appcat_[a-zA-Z0-9]+$
        - name: has_components
          in: query
          required: false
          description: Only return apps that have components (actions or triggers)
          schema:
            type: boolean
        - name: has_actions
          in: query
          required: false
          description: Only return apps that have actions
          schema:
            type: boolean
        - name: has_triggers
          in: query
          required: false
          description: Only return apps that have triggers
          schema:
            type: boolean
      responses:
        '200':
          description: apps listed
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListAppsResponse'
      security:
        - connect_token: []
          oauth: []
components:
  schemas:
    ListAppsResponse:
      type: object
      description: Response received when listing apps
      required:
        - data
        - page_info
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/App'
        page_info:
          $ref: '#/components/schemas/PageInfo'
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
    PageInfo:
      type: object
      properties:
        count:
          type: integer
        total_count:
          type: integer
        start_cursor:
          type: string
        end_cursor:
          type: string
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

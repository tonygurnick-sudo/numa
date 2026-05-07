> ## Documentation Index
>
> Fetch the complete documentation index at: https://pipedream.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Reload action props

> Reload the prop definition based on the currently configured props

## OpenAPI

```yaml post /v1/connect/{project_id}/actions/props
openapi: 3.0.4
info:
  version: 2.0.0
  title: Pipedream REST API
servers:
  - url: https://api.pipedream.com
security: []
paths:
  /v1/connect/{project_id}/actions/props:
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
      summary: Reload action props
      description: Reload the prop definition based on the currently configured props
      operationId: reloadActionProps
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
              $ref: '#/components/schemas/ReloadPropsOpts'
      responses:
        '200':
          description: action props reloaded
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ReloadPropsResponse'
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
    ReloadPropsOpts:
      type: object
      description: >-
        Request options for reloading a component's props when dealing with
        dynamic props
      required:
        - id
        - external_user_id
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
        blocking:
          type: boolean
          description: Whether this operation should block until completion
        configured_props:
          $ref: '#/components/schemas/ConfiguredProps'
        dynamic_props_id:
          type: string
          description: The ID for dynamic props
    ReloadPropsResponse:
      type: object
      description: Response from reloading component props
      properties:
        observations:
          type: array
          items:
            $ref: '#/components/schemas/Observation'
        errors:
          type: array
          items:
            type: string
          description: Any errors that occurred during configuration
        dynamicProps:
          $ref: '#/components/schemas/DynamicProps'
    ConfiguredProps:
      type: object
      description: The configured properties of the component
      additionalProperties:
        $ref: '#/components/schemas/ConfiguredPropValue'
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
    DynamicProps:
      type: object
      description: Dynamic properties of a saved component
      properties:
        id:
          type: string
          description: The unique ID of the dynamic prop
        configurableProps:
          type: array
          description: The updated configurable properties
          items:
            $ref: '#/components/schemas/ConfigurableProp'
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
    ConfigurableProp:
      description: >-
        A configuration or input field for a component. This is a discriminated
        union based on the type field.
      oneOf:
        - $ref: '#/components/schemas/ConfigurablePropAlert'
        - $ref: '#/components/schemas/ConfigurablePropAny'
        - $ref: '#/components/schemas/ConfigurablePropApp'
        - $ref: '#/components/schemas/ConfigurablePropBoolean'
        - $ref: '#/components/schemas/ConfigurablePropDataStore'
        - $ref: '#/components/schemas/ConfigurablePropDir'
        - $ref: '#/components/schemas/ConfigurablePropTimer'
        - $ref: '#/components/schemas/ConfigurablePropApphook'
        - $ref: '#/components/schemas/ConfigurablePropIntegerArray'
        - $ref: '#/components/schemas/ConfigurablePropHttp'
        - $ref: '#/components/schemas/ConfigurablePropHttpRequest'
        - $ref: '#/components/schemas/ConfigurablePropDb'
        - $ref: '#/components/schemas/ConfigurablePropSql'
        - $ref: '#/components/schemas/ConfigurablePropAirtableBaseId'
        - $ref: '#/components/schemas/ConfigurablePropAirtableTableId'
        - $ref: '#/components/schemas/ConfigurablePropAirtableViewId'
        - $ref: '#/components/schemas/ConfigurablePropAirtableFieldId'
        - $ref: '#/components/schemas/ConfigurablePropDiscordChannel'
        - $ref: '#/components/schemas/ConfigurablePropDiscordChannelArray'
        - $ref: '#/components/schemas/ConfigurablePropDiscord'
        - $ref: '#/components/schemas/ConfigurablePropInteger'
        - $ref: '#/components/schemas/ConfigurablePropObject'
        - $ref: '#/components/schemas/ConfigurablePropString'
        - $ref: '#/components/schemas/ConfigurablePropStringArray'
      discriminator:
        propertyName: type
        mapping:
          alert: '#/components/schemas/ConfigurablePropAlert'
          any: '#/components/schemas/ConfigurablePropAny'
          app: '#/components/schemas/ConfigurablePropApp'
          boolean: '#/components/schemas/ConfigurablePropBoolean'
          data_store: '#/components/schemas/ConfigurablePropDataStore'
          dir: '#/components/schemas/ConfigurablePropDir'
          $.interface.timer: '#/components/schemas/ConfigurablePropTimer'
          $.interface.apphook: '#/components/schemas/ConfigurablePropApphook'
          integer[]: '#/components/schemas/ConfigurablePropIntegerArray'
          $.interface.http: '#/components/schemas/ConfigurablePropHttp'
          http_request: '#/components/schemas/ConfigurablePropHttpRequest'
          $.service.db: '#/components/schemas/ConfigurablePropDb'
          sql: '#/components/schemas/ConfigurablePropSql'
          $.airtable.baseId: '#/components/schemas/ConfigurablePropAirtableBaseId'
          $.airtable.tableId: '#/components/schemas/ConfigurablePropAirtableTableId'
          $.airtable.viewId: '#/components/schemas/ConfigurablePropAirtableViewId'
          $.airtable.fieldId: '#/components/schemas/ConfigurablePropAirtableFieldId'
          $.discord.channel: '#/components/schemas/ConfigurablePropDiscordChannel'
          $.discord.channel[]: '#/components/schemas/ConfigurablePropDiscordChannelArray'
          integer: '#/components/schemas/ConfigurablePropInteger'
          object: '#/components/schemas/ConfigurablePropObject'
          string: '#/components/schemas/ConfigurablePropString'
          string[]: '#/components/schemas/ConfigurablePropStringArray'
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
    ConfigurablePropAlert:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to configure an alert component
          required:
            - type
            - content
          properties:
            type:
              type: string
              enum:
                - alert
            alertType:
              $ref: '#/components/schemas/ConfigurablePropAlertType'
            content:
              type: string
              description: The content of the alert, which can include HTML or plain text.
    ConfigurablePropAny:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop can accept any value.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - any
            default:
              $ref: '#/components/schemas/ConfiguredPropValueAny'
            options:
              type: array
              items:
                anyOf:
                  - $ref: '#/components/schemas/PropOption'
                  - $ref: '#/components/schemas/PropOptionNested'
                  - $ref: '#/components/schemas/PropOptionValue'
    ConfigurablePropApp:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to configure an account for a specific app
          required:
            - type
            - app
          properties:
            type:
              type: string
              enum:
                - app
            app:
              type: string
              description: >-
                The name slug of the app, e.g. 'github', 'slack', etc. This is
                used to identify the app for which the account is being
                configured.
    ConfigurablePropBoolean:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop can accept a boolean value.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - boolean
            default:
              $ref: '#/components/schemas/ConfiguredPropValueBoolean'
            options:
              type: array
              items:
                anyOf:
                  - $ref: '#/components/schemas/PropOption'
                  - $ref: '#/components/schemas/PropOptionNested'
                  - $ref: '#/components/schemas/PropOptionValue'
    ConfigurablePropDataStore:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to configure a data store for key-value storage.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - data_store
    ConfigurablePropDir:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to configure a directory path.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - dir
    ConfigurablePropTimer:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to configure a timer interface.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - $.interface.timer
            static:
              $ref: '#/components/schemas/ConfigurablePropTimerStatic'
            default:
              $ref: '#/components/schemas/ConfigurablePropTimerDefault'
            options:
              type: array
              nullable: true
              description: Available timer configuration options
              items:
                $ref: '#/components/schemas/ConfigurablePropTimerOption'
    ConfigurablePropApphook:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to configure an app webhook interface.
          required:
            - type
            - appProp
          properties:
            type:
              type: string
              enum:
                - $.interface.apphook
            appProp:
              type: string
              description: The name of the app prop that this apphook depends on
            eventNames:
              type: array
              items:
                type: string
              description: List of event names to listen for
              nullable: true
            remote:
              type: boolean
              description: Whether this apphook is remote
              nullable: true
            static:
              type: array
              items: {}
              description: Static configuration for the apphook
              nullable: true
    ConfigurablePropIntegerArray:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop can accept an array of integers.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - integer[]
            min:
              type: integer
              description: The minimum value for integers in this array
              nullable: true
            max:
              type: integer
              description: The maximum value for integers in this array
              nullable: true
            default:
              type: array
              items:
                $ref: '#/components/schemas/ConfiguredPropValueInteger'
              description: Default array of integers
              nullable: true
            options:
              type: array
              items:
                anyOf:
                  - $ref: '#/components/schemas/PropOption'
                  - $ref: '#/components/schemas/PropOptionNested'
                  - $ref: '#/components/schemas/PropOptionValue'
              description: Available options for the integer array
              nullable: true
    ConfigurablePropHttp:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to configure an HTTP interface.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - $.interface.http
            customResponse:
              type: boolean
              description: Whether this HTTP interface allows custom responses
              nullable: true
    ConfigurablePropHttpRequest:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: >-
            This prop is used to configure an HTTP request with URL, method,
            headers, params, body, and authentication.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - http_request
            default:
              $ref: '#/components/schemas/HttpRequestConfig'
    ConfigurablePropDb:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to configure a database service.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - $.service.db
    ConfigurablePropSql:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to configure SQL queries.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - sql
            auth:
              $ref: '#/components/schemas/ConfigurablePropSqlAuth'
            default:
              $ref: '#/components/schemas/ConfiguredPropValueSql'
            options:
              type: array
              items:
                anyOf:
                  - $ref: '#/components/schemas/PropOption'
                  - $ref: '#/components/schemas/PropOptionNested'
                  - $ref: '#/components/schemas/PropOptionValue'
    ConfigurablePropAirtableBaseId:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to select an Airtable base.
          required:
            - type
            - appProp
          properties:
            type:
              type: string
              enum:
                - $.airtable.baseId
            appProp:
              type: string
              description: The name of the app prop that provides Airtable authentication
    ConfigurablePropAirtableTableId:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to select an Airtable table.
          required:
            - type
            - baseIdProp
          properties:
            type:
              type: string
              enum:
                - $.airtable.tableId
            baseIdProp:
              type: string
              description: The name of the prop that provides the Airtable base ID
    ConfigurablePropAirtableViewId:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to select an Airtable view.
          required:
            - type
            - tableIdProp
          properties:
            type:
              type: string
              enum:
                - $.airtable.viewId
            tableIdProp:
              type: string
              description: The name of the prop that provides the Airtable table ID
    ConfigurablePropAirtableFieldId:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to select an Airtable field.
          required:
            - type
            - tableIdProp
          properties:
            type:
              type: string
              enum:
                - $.airtable.fieldId
            tableIdProp:
              type: string
              description: The name of the prop that provides the Airtable table ID
    ConfigurablePropDiscordChannel:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to select a Discord channel.
          required:
            - type
            - appProp
          properties:
            type:
              type: string
              enum:
                - $.discord.channel
            appProp:
              type: string
              description: The name of the app prop that provides Discord authentication
    ConfigurablePropDiscordChannelArray:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop is used to select multiple Discord channels.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - $.discord.channel[]
            appProp:
              type: string
              description: The name of the app prop that provides Discord authentication
    ConfigurablePropDiscord:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: For Discord components, this prop can accept a Discord channel ID.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - $.discord.channel
    ConfigurablePropInteger:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop can accept an integer value.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - integer
            min:
              type: integer
              description: The minimum value for this integer prop.
              nullable: true
            max:
              type: integer
              description: The maximum value for this integer prop.
              nullable: true
            default:
              $ref: '#/components/schemas/ConfiguredPropValueInteger'
            options:
              type: array
              items:
                anyOf:
                  - $ref: '#/components/schemas/PropOption'
                  - $ref: '#/components/schemas/PropOptionNested'
                  - $ref: '#/components/schemas/PropOptionValue'
              description: Available integer options
              nullable: true
    ConfigurablePropObject:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop can accept a set of key-value pairs.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - object
            default:
              $ref: '#/components/schemas/ConfiguredPropValueObject'
            options:
              type: array
              items:
                anyOf:
                  - $ref: '#/components/schemas/PropOption'
                  - $ref: '#/components/schemas/PropOptionNested'
                  - $ref: '#/components/schemas/PropOptionValue'
    ConfigurablePropString:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop can accept a string value.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - string
            secret:
              type: boolean
              description: >-
                If true, this prop is a secret and should not be displayed in
                plain text.
              nullable: true
            default:
              $ref: '#/components/schemas/ConfiguredPropValueString'
            options:
              type: array
              items:
                anyOf:
                  - $ref: '#/components/schemas/PropOption'
                  - $ref: '#/components/schemas/PropOptionNested'
                  - $ref: '#/components/schemas/PropOptionValue'
    ConfigurablePropStringArray:
      allOf:
        - $ref: '#/components/schemas/ConfigurablePropBase'
        - type: object
          description: This prop can accept an array of strings.
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - string[]
            secret:
              type: boolean
              description: >-
                If true, this prop is a secret and should not be displayed in
                plain text.
              nullable: true
            default:
              type: array
              items:
                $ref: '#/components/schemas/ConfiguredPropValueString'
              description: The default value for this prop
              nullable: true
            options:
              type: array
              items:
                anyOf:
                  - $ref: '#/components/schemas/PropOption'
                  - $ref: '#/components/schemas/PropOptionNested'
                  - $ref: '#/components/schemas/PropOptionValue'
    AccountId:
      type: string
      description: The unique ID of the account.
      pattern: ^apn_[a-zA-Z0-9]+$
    ConfigurablePropBase:
      type: object
      description: A configuration or input field for a component.
      required:
        - name
        - type
      properties:
        name:
          type: string
          description: >-
            When building `configuredProps`, make sure to use this field as the
            key when setting the prop value
        type:
          type: string
          enum:
            - $.airtable.baseId
            - $.airtable.fieldId
            - $.airtable.tableId
            - $.airtable.viewId
            - $.discord.channel
            - $.discord.channel[]
            - $.interface.apphook
            - $.interface.http
            - $.interface.timer
            - $.service.db
            - alert
            - any
            - app
            - boolean
            - data_store
            - dir
            - http_request
            - integer
            - integer[]
            - object
            - sql
            - string
            - string[]
          x-fern-enum:
            $.discord.channel[]:
              name: DiscordChannelArray
            integer[]:
              name: IntegerArray
            string[]:
              name: StringArray
        label:
          type: string
          description: >-
            Value to use as an input label. In cases where `type` is "app",
            should load the app via `getApp`, etc. and show `app.name` instead.
          nullable: true
        description:
          type: string
          description: >-
            A description of the prop, shown to the user when configuring the
            component.
          nullable: true
        optional:
          type: boolean
          description: If true, this prop does not need to be specified.
          nullable: true
        disabled:
          type: boolean
          description: If true, this prop will be ignored.
          nullable: true
        hidden:
          type: boolean
          description: If true, should not expose this prop to the user
          nullable: true
        remoteOptions:
          type: boolean
          description: >-
            If true, call `configureComponent` for this prop to load remote
            options. It is safe, and preferred, given a returned list of {
            label: string; value: any } objects to set the prop value to { __lv:
            { label: string; value: any } }. This way, on load, you can access
            label for the value without necessarily reloading these options
          nullable: true
        useQuery:
          type: boolean
          description: >-
            If true, calls to `configureComponent` for this prop support
            receiving a `query` parameter to filter remote options
          nullable: true
        reloadProps:
          type: boolean
          description: >-
            If true, after setting a value for this prop, a call to
            `reloadComponentProps` is required as the component has dynamic
            configurable props dependent on this one
          nullable: true
        withLabel:
          type: boolean
          description: >-
            If true, you must save the configured prop value as a "label-value"
            object which should look like: { __lv: { label: string; value: any }
            } because the execution needs to access the label
          nullable: true
    ConfigurablePropAlertType:
      type: string
      enum:
        - info
        - neutral
        - warning
        - error
      description: The severity level of the alert.
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
    PropOptionValue:
      description: The value of a prop option
      oneOf:
        - type: string
        - type: integer
        - type: boolean
      nullable: true
    ConfigurablePropTimerStatic:
      nullable: true
      description: Static timer configuration
      oneOf:
        - $ref: '#/components/schemas/TimerInterval'
        - $ref: '#/components/schemas/TimerCron'
    ConfigurablePropTimerDefault:
      nullable: true
      description: Default timer configuration
      oneOf:
        - $ref: '#/components/schemas/TimerInterval'
        - $ref: '#/components/schemas/TimerCron'
    ConfigurablePropTimerOption:
      nullable: true
      description: Timer configuration options
      oneOf:
        - $ref: '#/components/schemas/TimerInterval'
        - $ref: '#/components/schemas/TimerCron'
    HttpRequestConfig:
      type: object
      description: Configuration for an HTTP request prop
      nullable: true
      properties:
        auth:
          $ref: '#/components/schemas/HttpRequestAuth'
        body:
          $ref: '#/components/schemas/HttpRequestBody'
        headers:
          type: array
          items:
            $ref: '#/components/schemas/HttpRequestField'
          nullable: true
        params:
          type: array
          items:
            $ref: '#/components/schemas/HttpRequestField'
          nullable: true
        tab:
          type: string
          nullable: true
        method:
          type: string
          nullable: true
        url:
          type: string
          nullable: true
    ConfigurablePropSqlAuth:
      type: object
      properties:
        app:
          type: string
          description: The app that provides SQL authentication
      nullable: true
    TimerInterval:
      type: object
      description: Timer configuration using interval in seconds
      required:
        - intervalSeconds
      properties:
        intervalSeconds:
          type: integer
          description: Interval in seconds for timer execution
    TimerCron:
      type: object
      description: Timer configuration using cron expression
      required:
        - cron
      properties:
        cron:
          type: string
          description: Cron expression for timer execution
    HttpRequestAuth:
      type: object
      description: Authentication configuration for HTTP request
      nullable: true
      properties:
        type:
          type: string
          enum:
            - basic
            - bearer
            - none
          description: The authentication type
        username:
          type: string
          nullable: true
        password:
          type: string
          nullable: true
        token:
          type: string
          nullable: true
    HttpRequestBody:
      type: object
      description: Body configuration for HTTP request
      nullable: true
      properties:
        type:
          type: string
          enum:
            - fields
            - raw
          nullable: true
        contentType:
          type: string
          nullable: true
        fields:
          type: array
          items:
            $ref: '#/components/schemas/HttpRequestField'
          nullable: true
        mode:
          type: string
          enum:
            - fields
            - raw
          nullable: true
        raw:
          type: string
          nullable: true
    HttpRequestField:
      type: object
      description: A name-value field for HTTP request configuration
      required:
        - name
        - value
      properties:
        name:
          type: string
          description: The field name
        value:
          type: string
          description: The field value
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

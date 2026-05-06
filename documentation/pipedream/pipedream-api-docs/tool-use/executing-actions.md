> ## Documentation Index
>
> Fetch the complete documentation index at: https://pipedream.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Executing Actions

Actions are components that perform a task by taking input parameters and producing a result. They can be invoked on-demand to interact with third-party APIs on behalf of your users.

## Retrieving a component's definition

To configure and run a component for your end users, you need to understand the component's definition. Now that you have the component's key from the previous step, you can retrieve its structure from the Pipedream API. See the [component structure](/components/contributing/api/#component-structure) section in our docs for more details.

As an example, the following API call will return the structure of the **List Commits** action for GitLab:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const component = await client.components.retrieve("gitlab-list-commits");

// Parse and return the data you need

````

```bash HTTP (cURL) theme={null}
curl -X https://api.pipedream.com/v1/connect/{project_id}/components/gitlab-list-commits \
  -H "Content-Type: application/json" \
  -H "X-PD-Environment: {environment}" \
  -H "Authorization: Bearer {access_token}"

# Parse and return the data you need
````

</CodeGroup>

The response will contain the component's structure, including its user-friendly name, version, and most importantly, the configuration options the component accepts (also known as [props](/components/contributing/api/#props) or "properties"). Here's an example of the response for the component in the example above:

```json theme={null}
{
  "data": {
    "name": "List Commits",
    "version": "0.0.3",
    "key": "gitlab-list-commits",
    "configurable_props": [
      {
        "name": "gitlab",
        "type": "app",
        "app": "gitlab"
      },
      {
        "name": "projectId",
        "type": "integer",
        "label": "Project ID",
        "description": "The project ID, as displayed in the main project page",
        "remoteOptions": true
      },
      {
        "name": "refName",
        "type": "string",
        "label": "Branch Name",
        "description": "The name of the branch",
        "remoteOptions": true,
        "optional": true
      },
      {
        "name": "max",
        "type": "integer",
        "label": "Max Results",
        "description": "Max number of results to return. Default value is `100`",
        "optional": true,
        "default": 100
      }
    ]
  }
}
```

Using this information, you can now drive the configuration of the component for your end users, as described in the next section.

## Configuring action props

Component execution on behalf of your end users requires a few preliminary steps, focused on getting the right input parameters (aka [props](/workflows/building-workflows/using-props/)) to the component.

Configuring each prop for a component often involves an API call to retrieve the possible values, unless the values that a prop can take are static or free-form. The endpoint is accessible at:

```bash theme={null}
POST /v1/connect/{project_id}/components/configure
```

Typically, the options for a prop are linked to a specific user's account. Each of these props implements an `options` method that retrieves the necessary options from the third-party API, formats them, and sends them back in the response for the end user to select. Examples are listing Slack channels, Google Sheets, etc.

The payload for the configuration API call must contain the following fields:

1. `external_user_id`: the ID of your user on your end
2. `id`: the component's unique ID (aka **key**)
3. `prop_name`: the name of the prop you want to configure
4. `configured_props`: an object containing the props that have already been configured. The initial configuration call must contain the ID of the account (aka `authProvisionId`) that your user has connected to the target app (see [this section](/connect/managed-auth/quickstart/) for more details on how to create these accounts).

We'll use the [**List Commits** component for GitLab](https://github.com/PipedreamHQ/pipedream/blob/master/components/gitlab/actions/list-commits/list-commits.mjs#L4) as an example, to illustrate a call that retrieves the options for the `projectId` prop of that component:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const resp = await client.components.configureProps({
    externalUserId: "abc-123",
    id: "gitlab-list-commits",
    propName: "projectId",
    configuredProps: {
      gitlab: {
        authProvisionId: "apn_kVh9AoD",
      }
    }
  });
  ```

```sh HTTP (cURL) theme={null}
curl -X POST https://api.pipedream.com/v1/connect/{project_id}/components/configure \
  -H "Content-Type: application/json" \
  -H "X-PD-Environment: {environment}" \
  -H "Authorization: Bearer {access_token}" \
  -d '{
    "external_user_id": "abc-123",
    "id": "gitlab-list-commits",
    "prop_name": "projectId",
    "configured_props": {
      "gitlab": {
        "authProvisionId": "apn_kVh9AoD"
      }
    }
  }'
# Parse and return the data you need
```

</CodeGroup>

The response contains the possible values (and their human-readable labels when applicable) for the prop, as well as any possible errors that might have occurred. The response for the request above would look like this:

```json theme={null}
{
  "observations": [],
  "context": null,
  "options": [
    {
      "label": "jverce/foo-massive-10231-1",
      "value": 45672541
    },
    {
      "label": "jverce/foo-massive-10231",
      "value": 45672514
    },
    {
      "label": "jverce/foo-massive-14999-2",
      "value": 45672407
    },
    {
      "label": "jverce/foo-massive-14999-1",
      "value": 45672382
    },
    {
      "label": "jverce/foo-massive-14999",
      "value": 45672215
    },
    {
      "label": "jverce/gitlab-development-kit",
      "value": 21220953
    },
    {
      "label": "jverce/gitlab",
      "value": 21208123
    }
  ],
  "errors": [],
  "timings": {
    "api_to_sidekiq": 1734043172355.1042,
    "sidekiq_received": 1734043172357.867,
    "sidekiq_to_lambda": 1734043172363.6812,
    "sidekiq_done": 1734043173461.6406,
    "lambda_configure_prop_called": 1734043172462,
    "lambda_done": 1734043173455
  },
  "stringOptions": null
}
```

<Note>
  Fields inside `configuredProps` are written in camel case since they refer to the names of props as they appear in the component's code, they are not attributes that the API itself consumes.
</Note>

You configure props one-by-one, making a call to the component configuration API for each new prop. Subsequent prop configuration calls will be identical to the one above:

1. Add the prop you currently want to configure as the `prop_name`
2. Include the names and values of all previously-configured props in the `configured_props` object. Keep this object in your app's local state, add a prop once you or the end user selects a value, and pass it to the `configured_props` API param.

For example, to retrieve the configuration options for the `refName` prop:

```json theme={null}
{
  "async_handle": "IyvFeE5oNpYd",
  "external_user_id": "demo-34c13d13-a31e-4a3d-8b63-0ac954671095",
  "id": "gitlab-list-commits",
  "prop_name": "refName",
  "configured_props": {
    "gitlab": {
      "authProvisionId": "apn_oOhaBlD"
    },
    "projectId": 21208123
  }
}
```

## Configuring dynamic props

The set of props that a component can accept might not be static, and may change depending on the values of prior props. Props that behave this way are called [dynamic props](/components/contributing/api/#dynamic-props), and they need to be configured in a different way. Props that are dynamic will have a `reloadProps` attribute set to `true` in the component's definition.

After configuring a dynamic prop, the set of subsequent props must be recomputed (or reloaded), which is possible using the following API call:

```sh theme={null}
POST /v1/connect/components/props
```

The payload is similar to the one used for the configuration API, but it excludes the `prop_name` field since the goal of this call is to reload and retrieve the new set of props, not to configure a specific one.

Using the [Add Single Row action for Google Sheets](https://pipedream.com/apps/google-sheets/actions/add-single-row) as an example, the request payload would look like this:

```json theme={null}
{
  "async_handle": "PL41Yf3PuX61",
  "external_user_id": "demo-25092fa8-86c0-4d46-86c9-9dc9bde3b964",
  "id": "google_sheets-add-single-row",
  "configured_props": {
    "googleSheets": {
      "authProvisionId": "apn_V1hMoE7"
    },
    "sheetId": "1BfWjFF2dTW_YDiLISj5N9nKCUErShgugPS434liyytg"
  }
}
```

In this case, the `sheetId` prop is dynamic, and so after configuring it, the set of props must be reloaded. The response will contain the new set of props and their definition, similar to when the [component information was first retrieved](/connect/components/#retrieving-a-components-definition). The response will also contain an ID that can be used to reference the new set of props in subsequent configuration calls. If this is ID is not provided, the set of props will be based on the definition of the component that was retrieved initially.

To illustrate, the response for the request above would look like this:

```json theme={null}
{
  "observations": [],
  "errors": [],
  "dynamicProps": {
    "id": "dyp_6xUyVgQ",
    "configurableProps": [
      {
        "name": "googleSheets",
        "type": "app",
        "app": "google_sheets"
      },
      {
        "name": "drive",
        "type": "string",
        "label": "Drive",
        "description": "Defaults to `My Drive`. To select a [Shared Drive](https://support.google.com/a/users/answer/9310351) instead, select it from this list.",
        "optional": true,
        "default": "My Drive",
        "remoteOptions": true
      },
      {
        "name": "sheetId",
        "type": "string",
        "label": "Spreadsheet",
        "description": "The Spreadsheet ID",
        "useQuery": true,
        "remoteOptions": true,
        "reloadProps": true
      },
      {
        "name": "worksheetId",
        "type": "string[]",
        "label": "Worksheet(s)",
        "description": "Select a worksheet or enter a custom expression. When referencing a spreadsheet dynamically, you must provide a custom expression for the worksheet.",
        "remoteOptions": true,
        "reloadProps": true
      },
      {
        "name": "hasHeaders",
        "type": "boolean",
        "label": "Does the first row of the sheet have headers?",
        "description": "If the first row of your document has headers, we'll retrieve them to make it easy to enter the value for each column. Note: When using a dynamic reference for the worksheet ID (e.g. `{{steps.foo.$return_value}}`), this setting is ignored.",
        "reloadProps": true
      },
      {
        "name": "myColumnData",
        "type": "string[]",
        "label": "Values",
        "description": "Provide a value for each cell of the row. Google Sheets accepts strings, numbers and boolean values for each cell. To set a cell to an empty value, pass an empty string."
      }
    ]
  }
}
```

## Invoking an action

At the end of the configuration process for an action, you'll end up with a payload that you can use to invoke the action. The payload is similar to the one used for configuring a prop, with the exception of the `prop_name` attribute (because we're not configuring any props at this point):

```json theme={null}
{
  "async_handle": "xFfBakdTGTkI",
  "external_user_id": "abc-123",
  "id": "gitlab-list-commits",
  "configured_props": {
    "gitlab": {
      "authProvisionId": "apn_kVh9AoD"
    },
    "projectId": 45672541,
    "refName": "main"
  }
}
```

To run the action with this configuration, simply send it as the request payload to the following endpoint:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const resp = await client.actions.run({
    externalUserId: "abc-123",
    id: "gitlab-list-commits",
    configuredProps: {
      gitlab: {
        authProvisionId: "apn_kVh9AoD",
      },
      projectId: 45672541,
      refName: "main"
    }
  });

// Parse and return the data you need

````

```sh HTTP (cURL) theme={null}
curl -X POST https://api.pipedream.com/v1/connect/{project_id}/actions/run \
  -H "Content-Type: application/json" \
  -H "X-PD-Environment: {environment}" \
  -H "Authorization: Bearer {access_token}" \
  -d '{
    "external_user_id": "abc-123",
    "id": "gitlab-list-commits",
    "configured_props": {
      "gitlab": {
        "authProvisionId": "apn_kVh9AoD"
      },
      "projectId": 45672541,
    }
  }'

# Parse and return the data you need
````

</CodeGroup>

The output of executing the action will be a JSON object containing the following fields:

1. `exports`: all the named exports produced by the action, like when calling [`$.export` in a Node.js](/workflows/building-workflows/code/nodejs/#using-export) component.
2. `os`: a list of observations produced by the action (e.g. logs, errors, etc).
3. `ret`: the return value of the action, if any.
4. When using [File Stash](/connect/components/files/) to sync local files, the response will also include a `stash` property with file information.

The following (abbreviated) example shows the output of running the action above:

```json theme={null}
{
  "exports": {
    "$summary": "Retrieved 1 commit"
  },
  "os": [],
  "ret": [
    {
      "id": "387262aea5d4a6920ac76c1e202bc9fd0841fea5",
      "short_id": "387262ae",
      "created_at": "2023-05-03T03:03:25.000+00:00",
      "parent_ids": [],
      "title": "Initial commit",
      "message": "Initial commit",
      "author_name": "Jay Vercellone",
      "author_email": "nope@pipedream.com",
      "authored_date": "2023-05-03T03:03:25.000+00:00",
      "committer_name": "Jay Vercellone",
      "committer_email": "nope@pipedream.com",
      "committed_date": "2023-05-03T03:03:25.000+00:00",
      "trailers": {},
      "extended_trailers": {},
      "web_url": "https://gitlab.com/jverce/foo-massive-10231-1/-/commit/387262aea5d4a6920ac76c1e202bc9fd0841fea5"
    }
  ]
}
```

## Special Prop Types

### SQL Prop

The `sql` prop is a specialized prop type used for interacting with SQL databases. It enables developers to build applications that can:

- Execute custom SQL queries
- Introspect database schemas
- Support prepared statements

This prop type is used by these database actions:

- `postgresql-execute-custom-query`
- `snowflake-execute-sql-query`
- `mysql-execute-raw-query`
- `microsoft_sql_server-execute-raw-query`
- `azure_sql-execute-raw-query`
- `turso-execute-query`

#### Configuration

When configuring these actions, you'll need to provide:

1. Database app type and auth (e.g., `postgresql` in this example)
2. A `sql` prop with the following structure:

```js theme={null}
const configuredProps = {
  postgresql: {
    authProvisionId: 'apn_xxxxxxx',
  },
  sql: {
    auth: {
      app: 'postgresql', // Database type -- must match the app prop name
    },
    query: 'select * from products limit 1',
    params: [], // Optional array of parameters for prepared statements
  },
};
```

#### Using prepared statements

You can use prepared statements by including placeholders in your query and providing the parameter values in the `params` array. Different database systems use different placeholder syntax:

- **PostgreSQL** uses `$1`, `$2`, `$3`, etc. for numbered parameters
- **Snowflake**, **MySQL, Azure SQL, Microsoft SQL Server, and Turso** use `?` for positional parameters

<CodeGroup>
  ```js PostgreSQL example theme={null}
  const configuredProps = {
    postgresql: {
      authProvisionId: "apn_xxxxxxx"
    },
    sql: {
      auth: {
        app: "postgresql"
      },
      query: "select * from products where name = $1 and price > $2 limit 1",
      params: ["foo", 10.99]  // Values to replace $1 and $2 placeholders
    }
  }
  ```

```js MySQL example theme={null}
const configuredProps = {
  mysql: {
    authProvisionId: 'apn_xxxxxxx',
  },
  sql: {
    auth: {
      app: 'mysql',
    },
    query: 'select * from products where name = ? and price > ? limit 1',
    params: ['foo', 10.99], // Values to replace the ? placeholders
  },
};
```

</CodeGroup>

<Note>
  Using prepared statements helps prevent SQL injection attacks by separating the SQL command structure from the data values being used, and is strongly recommended.
</Note>

#### Retrieving database schema information

By retrieving the database schema, developers can:

- Provide database structure to AI agents for accurate SQL generation
- Build native SQL editors with autocomplete for tables and columns
- Validate queries against the actual database schema before execution

You can call `configureComponent` on the `sql` prop to retrieve database schema information:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const resp = await client.components.configureProps({
    external_user_id: externalUserId,
    prop_name: "sql",
    id: "postgresql-execute-custom-query",
    configuredProps: {
      postgresql: {
        authProvisionId: accountId
      },
    },
  });
  ```
</CodeGroup>

The response includes a `context.dbInfo` object containing detailed schema information for all tables in the database:

```json theme={null}
{
  "context": {
    "dbInfo": {
      "products": {
        "metadata": {},
        "schema": {
          "id": {
            "tableName": "products",
            "columnName": "id",
            "isNullable": "NO",
            "dataType": "integer",
            "columnDefault": "nextval('products_id_seq'::regclass)"
          },
          "name": {
            "tableName": "products",
            "columnName": "name",
            "isNullable": "NO",
            "dataType": "character varying",
            "columnDefault": null
          },
          "description": {
            "tableName": "products",
            "columnName": "description",
            "isNullable": "YES",
            "dataType": "text",
            "columnDefault": null
          },
          "price": {
            "tableName": "products",
            "columnName": "price",
            "isNullable": "NO",
            "dataType": "numeric",
            "columnDefault": null
          },
          "created_at": {
            "tableName": "products",
            "columnName": "created_at",
            "isNullable": "YES",
            "dataType": "timestamp with time zone",
            "columnDefault": "CURRENT_TIMESTAMP"
          }
        }
      }
    }
  }
}
```

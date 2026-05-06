> ## Documentation Index
>
> Fetch the complete documentation index at: https://pipedream.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Deploying Triggers

Triggers (also called sources) are different from actions - they are not invoked directly by end users, but rather by events that happen on a third-party service. For example, the "New File" source for Google Drive will be triggered every time a new file is created in a specific folder in Google Drive, then will emit an event for you to consume.

All this means is that actions can be invoked manually on demand, while sources are instead deployed and run automatically when the event they are listening for occurs.

## Categories of triggers

These are 2 categories of triggers you can deploy on behalf of your end users:

- [App-based event sources](/connect/components/triggers/#app-based-event-sources)
- [Native triggers](/connect/components/triggers/#native-triggers)

<Note>
  Refer to the [full Connect API reference](/connect/api-reference/deploy-trigger) to list, retrieve, delete, and manage triggers for your user.
</Note>

### App-based event sources

- Listen for events that occur in other systems: for example, when [a new file is added to Google Drive](https://pipedream.com/apps/google-drive/triggers/new-files-instant) or when [a new contact is created in HubSpot](https://pipedream.com/apps/hubspot/triggers/new-or-updated-contact)
- Deploying these triggers requires that your customers first connect their account using [Pipedream Connect Managed Auth](/connect/managed-auth/quickstart/), since the triggers are deployed on their behalf using account
- Refer to the [quickstart above](/connect/components/triggers/#deploying-a-source) to get started

#### Setting the polling interval

Some app-based triggers poll for new events rather than using webhooks. For these polling-based triggers, you can configure how frequently the trigger checks for new events by setting the `intervalSeconds` property in the `timer` configuration.

The polling interval is defined in the `configuredProps` when deploying a trigger:

```typescript TypeScript focus={8-10} theme={null}
const deployedTrigger = await client.triggers.deploy({
  externalUserId: 'abc-123',
  id: 'notion-page-or-subpage-updated',
  configuredProps: {
    notion: {
      authProvisionId: 'apn_xxxxxxx',
    },
    timer: {
      intervalSeconds: 60, // Poll every 60 seconds
    },
  },
  webhookUrl: 'https://events.example.com/webhook',
});
```

#### Handling test events

- Many event sources attempt to retrieve a small set of historical events on deploy to provide visibility into the event shape for end users and developers
- Exposing real test events make it easier to consume the event in downstream systems without requiring users to trigger real events ([more info](/components/contributing/guidelines/#surfacing-test-events))
- However, this results in emitting those events to the listening webhook immediately, which may not always be ideal, depending on your use case

<Note>
  To avoid emitting historical events on deploy, set [`emit_on_deploy`](/connect/api-reference/deploy-trigger#body-emit-on-deploy) to `false` when deploying the trigger
</Note>

### Native triggers

- You can also deploy native triggers, which don't require any authentication from your end users, so **you should skip the account connection process when configuring these triggers**
- Because these triggers don't use a connected account from your end users, APIs to deploy and manage them are slightly different (see below)

## Deploying a source

Because sources are exercised by events that happen on a third-party service, their semantics are different from actions. Once a source is configured, it must be deployed to start listening for events. When deploying a source, you can define either a webhook URL or a Pipedream workflow ID to consume those events.

Deploying a source is done by sending a payload similar to the one used for running an action, with the addition of the webhook URL or workflow ID. Using the **New Issue (Instant)** source for GitLab as an example, the payload would look something like this:

```json theme={null}
{
  "external_user_id": "abc-123",
  "id": "gitlab-new-issue",
  "prop_name": "http",
  "configured_props": {
    "gitlab": {
      "authProvisionId": "apn_kVh9AoD"
    },
    "projectId": 45672541
  },
  "webhook_url": "https://events.example.com/gitlab-new-issue"
}
```

Deploy a source for your users:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const deployedTrigger = await client.triggers.deploy({
    externalUserId: "abc-123",
    id: "gitlab-new-issue",
    configuredProps: {
      gitlab: {
        authProvisionId: "apn_kVh9AoD",
      },
      projectId: 45672541,
    },
    webhookUrl: "https://events.example.com/gitlab-new-issue"
  });

const {
id: triggerId, // The unique ID of the deployed trigger
name: triggerName, // The name of the deployed trigger
owner_id: userId, // The unique ID in Pipedream of your user
} = deployedTrigger;

// Parse and return the data you need

````

```sh HTTP (cURL) theme={null}
curl -X POST https://api.pipedream.com/v1/connect/{project_id}/components/triggers/deploy \
  -H "Content-Type: application/json" \
  -H "X-PD-Environment: {environment}" \
  -H "Authorization: Bearer {access_token}" \
  -d '{
    "external_user_id": "abc-123",
    "id": "gitlab-new-issue",
    "configured_props": {
      "gitlab": {
        "authProvisionId": "apn_kVh9AoD"
      },
      "projectId": 45672541,
    },
    "webhook_url": "https://events.example.com/gitlab-new-issue"
  }'
# Parse and return the data you need
````

</CodeGroup>

If the source deployment succeeds, the response will contain the information regarding the state of the source, including all the component's props metadata, as well as their values. It will also contain its name, creation date, owner, and most importantly its unique ID, which can be used to manage the source in the future (e.g. delete it). The response for the request above would look like this:

```json theme={null}
{
  "data": {
    "id": "dc_dAuGmW7",
    "owner_id": "exu_oedidz",
    "component_id": "sc_3vijzQr",
    "configurable_props": [
      {
        "name": "gitlab",
        "type": "app",
        "app": "gitlab"
      },
      {
        "name": "db",
        "type": "$.service.db"
      },
      {
        "name": "http",
        "type": "$.interface.http",
        "customResponse": true
      },
      {
        "name": "projectId",
        "type": "integer",
        "label": "Project ID",
        "description": "The project ID, as displayed in the main project page",
        "remoteOptions": true
      }
    ],
    "configured_props": {
      "gitlab": {
        "authProvisionId": "apn_kVh9AoD"
      },
      "db": {
        "type": "$.service.db"
      },
      "http": {
        "endpoint_url": "https://xxxxxxxxxx.m.pipedream.net"
      },
      "projectId": 45672541
    },
    "active": true,
    "created_at": 1734028283,
    "updated_at": 1734028283,
    "name": "My first project - exu_oedidz",
    "name_slug": "my-first-project---exu-oedidz-2"
  }
}
```

In the example above, the source ID is `dc_dAuGmW7`, which can be used to delete, retrieve, or update the source in the future.

Refer to the [full Connect API reference](/connect/api-reference/list-components) for questions and additional examples.

## Native trigger examples

### HTTP Webhook

Generate a unique HTTP webhook URL for your end users to configure in any other upstream service.

<CodeGroup>
  ```typescript TypeScript theme={null}
  const deployedTrigger = await client.triggers.deploy({
    externalUserId: "abc-123",
    id: "http-new-requests",
    webhook_url: "https://events.example.com/http-new-requests"
  });

const {
id: triggerId, // The unique ID of the deployed trigger
endpoint_url: endpointUrl, // The endpoint URL to return to the user
} = deployedTrigger;

// Parse and return the data you need

````

```sh HTTP (cURL) theme={null}
curl -X POST https://api.pipedream.com/v1/connect/{project_id}/components/triggers/deploy \
  -H "Content-Type: application/json" \
  -H "X-PD-Environment: {environment}" \
  -H "Authorization: Bearer {access_token}" \
  -d '{
    "external_user_id": "abc-123",
    "id": "http-new-requests",
    "webhook_url": "https://events.example.com/http-new-requests"
  }'

# Parse and return the data you need
````

</CodeGroup>

#### Example response

```json theme={null}
{
  "id": "hi_zbGHMx",
  "key": "xxxxxxxxxx",
  "endpoint_url": "http://xxxxxxxxxx.m.pipedream.net",
  "custom_response": true,
  "created_at": 1744508049,
  "updated_at": 1744508049
}
```

### Schedule

Deploy a timer to act as a cron job that will emit an event on a custom schedule you or your users define.

#### Configured props

`cron` (**object**)

When defining schedules, you can pass one of the following:

- `intervalSeconds`: Define the frequency in seconds
- `cron`: Define a custom cron schedule and optionally define the `timezone`. For example:

```json theme={null}
"cron": {
  "cron": "0 * * * *",
  "timezone": "America/Los_Angeles" // optional, defaults to UTC
}
```

<CodeGroup>
  ```typescript TypeScript theme={null}
  const deployedTrigger = await client.triggers.deploy({
    externalUserId: "abc-123",
    id: "schedule-custom-interval",
    configuredProps: {
      "cron": {
        "intervalSeconds": 900
      }
    },
    webhook_url: "https://events.example.com/schedule-custom-interval"
  });

const {
id: triggerId, // The unique ID of the deployed trigger
} = deployedTrigger;

// Parse and return the data you need

````

```sh HTTP(cURL) theme={null}
curl -X POST https://api.pipedream.com/v1/connect/{project_id}/components/triggers/deploy \
  -H "Content-Type: application/json" \
  -H "X-PD-Environment: {environment}" \
  -H "Authorization: Bearer {access_token}" \
  -d '{
    "external_user_id": "abc-123",
    "id": "schedule-custom-interval",
    "configured_props": {
      "cron": {
        "intervalSeconds": 900
      }
    },
    "webhook_url": "https://events.example.com/schedule-custom-interval"
  }'

# Parse and return the data you need
````

</CodeGroup>

#### Example response

```json theme={null}
{
  "id": "ti_aqGTJ2",
  "interval_seconds": 900,
  "cron": null,
  "timezone": "UTC",
  "schedule_changed_at": 1744508391,
  "created_at": 1744508391,
  "updated_at": 1744508391
}
```

### New emails received

Generate a unique email address for your customers to emit events to

<CodeGroup>
  ```typescript TypeScript theme={null}
  const deployedTrigger = await client.triggers.deploy({
    externalUserId: "abc-123",
    id: "email-new-email",
    webhook_url: "https://events.example.com/email-new-email"
  });

const {
id: triggerId, // The unique ID of the deployed trigger
email_address: emailAddress, // The unique email address to return to the user
} = deployedTrigger;

// Parse and return the data you need

````

```sh HTTP (cURL) theme={null}
curl -X POST https://api.pipedream.com/v1/connect/{project_id}/components/triggers/deploy \
  -H "Content-Type: application/json" \
  -H "X-PD-Environment: {environment}" \
  -H "Authorization: Bearer {access_token}" \
  -d '{
    "external_user_id": "abc-123",
    "id": "email-new-email",
    "webhook_url": "https://events.example.com/email-new-email"
  }'

# Parse and return the data you need
````

</CodeGroup>

#### Example response

```json theme={null}
{
  "id": "ei_QaJTb0",
  "email_address": "xxxxxxxxxx@upload.pipedream.net",
  "created_at": 1744499847,
  "updated_at": 1744499847
}
```

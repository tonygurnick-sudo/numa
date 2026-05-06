> ## Documentation Index
>
> Fetch the complete documentation index at: https://pipedream.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Pre built tools for your app or agent

export const PUBLIC_APPS = '3,000';

Pipedream Connect provides APIs to embed pre-built tools ([triggers and actions](/components/contributing/)) directly in your application or AI agent, enabling access to 10,000+ built-in API operations. Enable [your end users](/connect/api-reference/introduction) to configure, deploy, and invoke Pipedream triggers and actions for more than {PUBLIC_APPS}+ APIs.

## What are triggers and actions?

In Pipedream, we call triggers and actions [components](/components/contributing/), which are self-contained executable units of code. Your end users configure the inputs and these components produce a result that's exported as output. These components are developed and maintained by Pipedream and our community and their source code is available in our [public GitHub repo](https://github.com/PipedreamHQ/pipedream/tree/master/components).

<Note>
  Check out the [SDK playground](https://pipedream.com/connect/demo) to see the SDK in action. You can also [run it locally and explore the code](https://github.com/PipedreamHQ/pipedream-connect-examples/tree/master/connect-react-demo).
</Note>

## Implementation

You have two options for implementing Connect components in your application:

1. Use the `pipedream` [backend SDK](#backend-sdk) with your own frontend
2. Use the `connect-react` [frontend SDK](#connect-react-sdk) with Pipedream's pre-built frontend components

### Backend SDK

Use the Pipedream server SDK to handle all Connect operations on your backend, then build your own frontend UI. This gives you full control over the user experience.

<CodeGroup>
  ```typescript Backend theme={null}
  import { PipedreamClient } from '@pipedream/sdk';

// Initialize with OAuth credentials
const client = new PipedreamClient({
projectEnvironment: "development",
clientId: process.env.PIPEDREAM_CLIENT_ID,
clientSecret: process.env.PIPEDREAM_CLIENT_SECRET,
projectId: process.env.PIPEDREAM_PROJECT_ID,
});

// Run a pre-built action on behalf of your user
const result = await client.actions.run({
id: "slack-send-message-to-channel",
externalUserId: "user-123",
configuredProps: {
slack: {
authProvisionId: "apn_abc123", // User's connected account
},
channel: "#general",
text: "Hello from my app!",
},
});

````

```javascript Your frontend theme={null}
// Your frontend makes requests to your backend API
async function sendSlackMessage() {
  const response = await fetch('/api/pipedream/run-action', {
    method: 'POST',
    body: JSON.stringify({
      actionId: 'slack-send-message-to-channel',
      configuredProps: {
        channel: '#general',
        text: 'Hello from my app!',
      }
    })
  });

  return response.json();
}
````

</CodeGroup>

### Connect React SDK

Use Pipedream's pre-built React components to abstract the complexity of building a frontend form interface.

<CodeGroup>
  ```typescript Backend (actions.ts) theme={null}
  "use server";
  import { PipedreamClient } from "@pipedream/sdk";

const client = new PipedreamClient({
projectEnvironment: "development", // or "production"
projectId: process.env.PIPEDREAM_PROJECT_ID,
clientId: process.env.PIPEDREAM_CLIENT_ID,
clientSecret: process.env.PIPEDREAM_CLIENT_SECRET,
});

// Generate connect tokens for frontend requests
export async function fetchToken(opts: { externalUserId: string }) {
return await client.tokens.create({
externalUserId: opts.externalUserId,
allowedOrigins: JSON.parse(process.env.PIPEDREAM_ALLOWED_ORIGINS || "[]"),
});
}

````

```typescript Frontend (page.tsx) theme={null}
import { PipedreamClient } from '@pipedream/sdk';
import { FrontendClientProvider, ComponentFormContainer } from '@pipedream/connect-react';
import { fetchToken } from './actions';

function App() {
  const userId = "user-123";
  const client = new PipedreamClient({
    projectEnvironment: "development",
    externalUserId: userId,
    tokenCallback: fetchToken, // Backend function to generate connect tokens
  });

  return (
    <FrontendClientProvider client={client}>
      <ComponentFormContainer
        userId={userId}
        componentKey="slack-send-message"
      />
    </FrontendClientProvider>
  );
}
````

</CodeGroup>

## Getting started

The following guide walks through using the **backend SDK or REST API** to manually discover apps, list components, and configure them. If you're using the **Connect React SDK**, the `ComponentFormContainer` handles these steps automatically.

<Note>
  Refer to the [Connect API docs](/connect/api-reference/) for the full API reference. Below is a quickstart with a few specific examples.

You can skip steps 1 and 2 if you already know the component you want to use or if you'd prefer to [pass a natural language prompt to Pipedream's component search API](/rest-api/#search-for-registry-components).
</Note>

<Steps>
  <Step title="Authenticate to the Pipedream API">
    Before sending requests to the API, make sure to [authenticate using a Pipedream OAuth client](/connect/api-reference/authentication):

    <CodeGroup>
      ```typescript TypeScript theme={null}
      // Initialize the Pipedream SDK client

      import { PipedreamClient } from "@pipedream/sdk";

      const client = new PipedreamClient({
        projectEnvironment: "development | production",
        clientId: "{oauth_client_id}",
        clientSecret: "{oauth_client_secret}",
        projectId: "{your_project_id}"
      });
      ```

      ```sh HTTP (cURL) theme={null}
      # Get an access token for the REST API

      curl -X POST https://api.pipedream.com/v1/oauth/token \
        -H "Content-Type: application/json" \
        -d '{
          "grant_type": "client_credentials",
          "client_id": "{your_oauth_client_id}",
          "client_secret": "{your_oauth_client_secret}"
        }'
      ```
    </CodeGroup>

    <Note>
      All subsequent examples assume that you've either initialized the SDK client or have a valid access token.
    </Note>

  </Step>

  <Step title="Find the app you want to use">
    To find the right trigger or action to configure and run, first find the app. In this example, we'll search for `gitlab`.

    <CodeGroup>
      ```typescript TypeScript theme={null}
      const apps = await client.apps.list({ q: "gitlab" });

      // Parse and return the data you need
      ```

      ```sh HTTP (cURL) theme={null}
      curl 'https://api.pipedream.com/v1/connect/apps?q=gitlab' \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer {access_token}"

      # Parse and return the data you need
      ```
    </CodeGroup>

    Here's the response:

    ```json  theme={null}
    {
      "page_info": {
        "total_count": 1,
        "count": 1,
        "start_cursor": "Z2l0bGFi",
        "end_cursor": "Z2l0bGFi"
      },
      "data": [
        {
          "id": "app_1Z2hw1",
          "name_slug": "gitlab",
          "name": "GitLab",
          "auth_type": "oauth",
          "description": "GitLab is the most comprehensive AI-powered DevSecOps Platform.",
          "img_src": "https://assets.pipedream.net/s.v0/app_1Z2hw1/logo/orig",
          "custom_fields_json": "[{\"name\":\"base_api_url\",\"label\":\"Base API URL\",\"description\":\"The Base API URL defaults to `gitlab.com`. If you are using self-hosted Gitlab, enter your base url here, e.g. `gitlab.example.com`\",\"default\":\"gitlab.com\",\"optional\":null}]",
          "categories": [
            "Developer Tools"
          ],
          "featured_weight": 5000,
          "connect": {
            "proxy_enabled": true,
            "allowed_domains": ["gitlab.com"],
            "base_proxy_target_url": "https://{{custom_fields.base_api_url}}"
          }
        }
      ]
    }
    ```

  </Step>

  <Step title="List the available components for the app">
    Once you have the app you want to use, now you can list the triggers and/or actions for that app. We'll list the actions for GitLab and we'll pass the `name_slug` `gitlab` as the `app`.

    <CodeGroup>
      ```typescript TypeScript theme={null}
      const components = await client.components.list({ q: "gitlab" });

      // Parse and return the data you need
      ```

      ```bash HTTP (cURL) theme={null}
      curl -X 'https://api.pipedream.com/v1/connect/{project_id}/actions?app=gitlab' \
        -H "Content-Type: application/json" \
        -H "X-PD-Environment: {environment}" \
        -H "Authorization: Bearer {access_token}"

      # Parse and return the data you need
      ```
    </CodeGroup>

    Here's the response:

    ```json  theme={null}
    {
      "page_info": {
        "total_count": 20,
        "count": 10,
        "start_cursor": "c2NfbHlpRThkQQ",
        "end_cursor": "c2NfQjVpTkJBTA"
      },
      "data": [
        {
          "name": "List Commits",
          "version": "0.0.2",
          "key": "gitlab_developer_app-list-commits"
        },
        {
          "name": "Update Issue",
          "version": "0.0.1",
          "key": "gitlab_developer_app-update-issue"
        },
        {
          "name": "Update Epic",
          "version": "0.0.1",
          "key": "gitlab_developer_app-update-epic"
        },
        {
          "name": "Search Issues",
          "version": "0.0.1",
          "key": "gitlab_developer_app-search-issues"
        },
        {
          "name": "List Repo Branches",
          "version": "0.0.1",
          "key": "gitlab_developer_app-list-repo-branches"
        },
        {
          "name": "Get Repo Branch",
          "version": "0.0.1",
          "key": "gitlab_developer_app-get-repo-branch"
        },
        {
          "name": "Get Issue",
          "version": "0.0.1",
          "key": "gitlab_developer_app-get-issue"
        },
        {
          "name": "Create issue",
          "version": "0.0.1",
          "key": "gitlab_developer_app-create-issue"
        },
        {
          "name": "Create Epic",
          "version": "0.0.1",
          "key": "gitlab_developer_app-create-epic"
        },
        {
          "name": "Create Branch",
          "version": "0.0.1",
          "key": "gitlab_developer_app-create-branch"
        }
      ]
    }
    ```

  </Step>

  <Step title="Next steps">
    Now that you've found the components you want to use, you can proceed to configure and execute them:

    * **For actions**: See the [Actions guide](/connect/components/actions) to learn how to configure props, handle dynamic props, and invoke actions
    * **For triggers**: See the [Triggers guide](/connect/components/triggers) to learn how to deploy event sources and native triggers
    * **Need help?**: Check the [Troubleshooting guide](/connect/components/troubleshooting) for common issues and solutions

  </Step>
</Steps>

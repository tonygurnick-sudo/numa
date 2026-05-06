> ## Documentation Index
>
> Fetch the complete documentation index at: https://pipedream.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Introduction

Pipedream provides TypeScript, Python, and Java SDKs along with a REST API to interact with the Connect service. You'll find examples using the SDKs and the REST API in multiple languages below.

## REST API base URL

Pipedream Connect resources are scoped to [projects](/projects/), so you'll need to pass the project's ID as a part of the base URL or when initializing the SDK client. Visit your project's **Settings** to find the project ID.

<CodeGroup>
  ```curl HTTP (cURL) theme={null}
  https://api.pipedream.com/v1/connect/{project_id}
  ```

```typescript TypeScript theme={null}
import { PipedreamClient } from '@pipedream/sdk';

const client = new PipedreamClient({
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  projectEnvironment: 'YOUR_PROJECT_ENVIRONMENT',
  projectId: 'YOUR_PROJECT_ID',
});
```

```python Python theme={null}
from pipedream import Pipedream

pd = Pipedream(
    client_id="YOUR_CLIENT_ID",
    client_secret="YOUR_CLIENT_SECRET",
    project_id="YOUR_PROJECT_ID",
    project_environment="YOUR_PROJECT_ENVIRONMENT"
)
```

```java Java theme={null}
import com.pipedream.api.BaseClient;

BaseClient client = BaseClient
    .builder()
    .clientId("YOUR_CLIENT_ID")
    .clientSecret("YOUR_CLIENT_SECRET")
    .projectId("YOUR_PROJECT_ID")
    .projectEnvironment("YOUR_PROJECT_ENVIRONMENT")
    .build();
```

</CodeGroup>

## External users

When you use the Connect API, you'll pass an `external_user_id` parameter when initiating account connections and retrieving account info. This is your user's ID, in your system — whatever you use to uniquely identify them.

Pipedream associates this ID with user accounts, so you can retrieve account info for a specific user, and invoke actions on their behalf.

External User IDs are limited to 250 characters.

Read more about [external users](/connect/managed-auth/users/).

## Environment

Most API endpoints require an [environment](/connect/managed-auth/environments/) parameter. This lets you specify the environment (`production` or `development`) where resources will live in your project.

Always set the environment when you create the SDK client:

```javascript theme={null}
import { PipedreamClient } from '@pipedream/sdk';

const client = new PipedreamClient({
  clientId: 'your-oauth-client-id',
  clientSecret: 'your-oauth-client-secret',
  projectId: 'your-project-id',
  projectEnvironment: 'development', // change to "production" for production environment
});
```

or pass the `X-PD-Environment` header in HTTP requests:

```sh theme={null}
curl -X POST https://api.pipedream.com/v1/connect/{project_id}/tokens \
  -H "Content-Type: application/json" \
  -H "X-PD-Environment: development" \
  -H "Authorization: Bearer {access_token}" \
  -d '{
    "external_user_id": "your-external-user-id"
  }'
```

<Note>
  Pipedream’s SDKs make it easier to access the REST APIs. Check out installation instructions and more info in our [SDKs](/connect/api-reference/sdks) guide.
</Note>

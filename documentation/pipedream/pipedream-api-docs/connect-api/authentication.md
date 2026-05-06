> ## Documentation Index
>
> Fetch the complete documentation index at: https://pipedream.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Authentication

The Pipedream Connect API uses OAuth to authenticate requests.

**We use OAuth** for a few reasons:

✅ OAuth clients are tied to the Pipedream workspace, administered by workspace admins \
✅ Tokens are short-lived \
✅ OAuth clients support scopes, limiting access to specific operations \
✅ Limit access to specific Pipedream projects (coming soon!)

<Note>
  Since API requests are meant to be made server-side, and since grants are not tied to individual end users, all OAuth clients are [**Client Credentials** applications](https://www.oauth.com/oauth2-servers/access-tokens/client-credentials/).
</Note>

### Creating an OAuth client

1. Visit the [API settings](https://pipedream.com/settings/api) for your Pipedream workspace.
2. Click the **New OAuth Client** button.
3. Name your client and click **Create**.
4. Copy the client secret. **It will not be accessible again**. Click **Close**.
5. Copy the client ID from the list.

### OAuth scopes

OAuth clients support scopes to limit access to specific operations. When creating an access token, you can optionally specify a space-separated list of scopes. If no scope is specified, the token defaults to `*` (full access).

**Available scopes:**

| Scope                             | Description                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `*`                               | Full access to every OAuth-protected endpoint                                             |
| `connect:*`                       | Full access to all Connect API endpoints (components, projects, triggers, accounts, etc.) |
| `connect:actions:*`               | Full access to Connect actions                                                            |
| `connect:triggers:*`              | Full access to Connect triggers                                                           |
| `connect:accounts:read`           | List and fetch Connect accounts for an external user                                      |
| `connect:accounts:write`          | Create or remove Connect accounts                                                         |
| `connect:deployed_triggers:read`  | Read deployed triggers and related data like events, pipelines and webhooks               |
| `connect:deployed_triggers:write` | Modify or delete deployed triggers                                                        |
| `connect:usage:read`              | List Connect usage records for a time window                                              |
| `connect:users:read`              | List and fetch external users                                                             |
| `connect:users:write`             | Delete external users                                                                     |
| `connect:tokens:create`           | Create Connect session tokens                                                             |
| `connect:proxy`                   | Invoke the Connect proxy                                                                  |
| `connect:workflow:invoke`         | Invoke Connect workflows on behalf of a user                                              |

### How to get an access token

In the client credentials model, you exchange your OAuth client ID and secret for an access token. Then you use the access token to make API requests.

Pipedream offers [TypeScript](https://www.npmjs.com/package/@pipedream/sdk), [Python](https://pypi.org/project/pipedream), and [Java](https://central.sonatype.com/artifact/com.pipedream/pipedream) SDKs, which abstract the process of generating and refreshing fresh access tokens.

<CodeGroup>
  ```typescript TypeScript theme={null}
  import { PipedreamClient } from "@pipedream/sdk";

const client = new PipedreamClient({
clientId: "YOUR_CLIENT_ID",
clientSecret: "YOUR_CLIENT_SECRET",
projectEnvironment: "YOUR_PROJECT_ENVIRONMENT",
projectId: "YOUR_PROJECT_ID",
// Optional: specify scopes (defaults to "\*")
scope: "connect:accounts:read connect:accounts:write"
});
await client.accounts.retrieve("account_id");

````

```python Python theme={null}
from pipedream import Pipedream

pd = Pipedream(
    client_id="YOUR_CLIENT_ID",
    client_secret="YOUR_CLIENT_SECRET",
    project_id="YOUR_PROJECT_ID",
    project_environment="YOUR_PROJECT_ENVIRONMENT",
    # Optional: specify scopes (defaults to "*")
    scope="connect:accounts:read connect:accounts:write"
)
await pd.accounts.retrieve("account_id")
````

```java Java theme={null}
import com.pipedream.api.BaseClient;

BaseClient client = BaseClient
    .builder()
    .clientId("YOUR_CLIENT_ID")
    .clientSecret("YOUR_CLIENT_SECRET")
    .projectId("YOUR_PROJECT_ID")
    .projectEnvironment("YOUR_PROJECT_ENVIRONMENT")
    // Optional: specify scopes (defaults to "*")
    .scope("connect:accounts:read connect:accounts:write")
    .build();
```

</CodeGroup>

You can also manage this token refresh process yourself, using the `/oauth/token` API endpoint:

```bash theme={null}
curl https://api.pipedream.com/v1/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "<client_id>",
    "client_secret": "<client_secret>",
    "scope": "connect:accounts:read connect:accounts:write"
  }'
```

The `scope` parameter is optional and accepts a space-separated list of scopes. If omitted, the token defaults to `*` (full access).

Access tokens expire after 1 hour. Store access tokens securely, server-side.

### Revoking a client secret

1. Visit your workspace’s [API settings](https://pipedream.com/settings/api).
2. Click the **…** button to the right of the OAuth client whose secret you want to revoke, then click **Rotate client secret**.
3. Copy the new client secret. **It will not be accessible again**.

### OAuth security

See [the OAuth section of the security docs](/privacy-and-security/#pipedream-rest-api-security-oauth-clients) for more information on how Pipedream secures OAuth credentials.

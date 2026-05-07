> ## Documentation Index
>
> Fetch the complete documentation index at: https://pipedream.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Generate OAuth Token

> Learn how to generate an OAuth access token to authenticate requests to the Pipedream API

<Note>
  If using [one of the available SDKs](/connect/api-reference/introduction#available-sdks) in TypeScript, Python, or Java, the OAuth access token is automatically generated (and refreshed) for you when you initialize the client.
</Note>

**Create an OAuth client to get your client ID and secret:**

1. Visit the [API settings](https://pipedream.com/settings/api) for your Pipedream workspace.
2. Click the **New OAuth Client** button.
3. Name your client and click **Create**.
4. Copy the client secret. **It will not be accessible again**. Click **Close**.
5. Copy the client ID from the list.

<Info>
  Read more in the [Authentication](/connect/api-reference/authentication) section.
</Info>

## OAuth scopes

You can optionally specify a `scope` parameter in the request body to limit the access token to specific operations. The `scope` parameter accepts a space-separated list of scopes.

If no scope is specified, the token defaults to `*` (full access).

**Example request with scopes:**

```bash theme={null}
curl -X POST https://api.pipedream.com/v1/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET",
    "scope": "connect:accounts:read connect:accounts:write"
  }'
```

<Info>
  View the full list of available scopes in the [Authentication](/connect/api-reference/authentication#oauth-scopes) section.
</Info>

## OpenAPI

```yaml post /v1/oauth/token
openapi: 3.0.4
info:
  version: 2.0.0
  title: Pipedream REST API
servers:
  - url: https://api.pipedream.com
security: []
paths:
  /v1/oauth/token:
    post:
      summary: Create OAuth token
      description: Exchange OAuth credentials for an access token
      operationId: createOauthToken
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateOAuthTokenOpts'
      responses:
        '200':
          description: token created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CreateOAuthTokenResponse'
components:
  schemas:
    CreateOAuthTokenOpts:
      type: object
      description: Request object for creating an OAuth token
      required:
        - grant_type
        - client_id
        - client_secret
      properties:
        grant_type:
          type: string
          enum:
            - client_credentials
        client_id:
          type: string
        client_secret:
          type: string
        scope:
          type: string
          description: >-
            Optional space-separated scopes for the access token. Defaults to
            '*'.
    CreateOAuthTokenResponse:
      type: object
      description: Response object for creating an OAuth token
      required:
        - access_token
        - token_type
        - expires_in
      properties:
        access_token:
          type: string
        token_type:
          type: string
        expires_in:
          type: integer
```

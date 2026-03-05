# Branding configuration lambda

This Lambda powers the branding API exposed via API Gateway.

## Routes

- **GET** `/api/branding/{clientId}`
  Returns the current branding blob for the requested client when
  `BRANDING_PROVIDER_ENABLED` is true and an item exists.

- **PUT** `/api/branding/{clientId}` _(admin only)_
  Persists a branding blob (including an optional `enabled` flag) for the
  requested client when the feature flag is enabled.

## Environment variables

- `CLIENT_NAME`: Owning client stack name (provided by infra).
- `BRANDING_TABLE_NAME`: DynamoDB table storing branding configs.
- `BRANDING_PROVIDER_ENABLED`: String flag (`"true"`/`"false"`) gating the API.
- `BRANDING_ASSETS_PREFIX`: Optional S3 prefix for branding assets.

## IAM permissions

The deployer attaches the following policies:

- GET route: `dynamodb:GetItem`, `dynamodb:Query`, `dynamodb:Scan` on the
  branding table.
- PUT route: Same as GET plus `dynamodb:PutItem`, `dynamodb:UpdateItem`,
  `dynamodb:DeleteItem`.

Admin users must belong to a Cognito group that includes the
`manageBranding` feature (grants write access) while standard users receive
`brandingRead` for read-only access.

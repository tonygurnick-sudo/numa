# srp-hasher

This Lambda function is designed to compute a secret hash using the Secure Remote Password (SRP) protocol. It is used to securely interact with AWS Cognito by generating a hash from user credentials.

## Functionality

### Handler

The main handler function processes incoming HTTP requests. It supports the following operations:

- **OPTIONS**: Responds with CORS headers to allow cross-origin requests.
- **POST**: Accepts a JSON payload containing an email address, validates it, and returns a secret hash.

### Secret Hash Calculation

The secret hash is calculated using the user's email, the Cognito client ID, and a client secret. This hash is used to authenticate requests to AWS Cognito.

### CORS

The Lambda function responds to OPTIONS requests with an open CORS policy, allowing requests from specified origins.

## Building

Install dependencies with `yarn`.

Build the code with `yarn build`. This uses esbuild to create a bundled ESM file with a CommonJS compatibility banner.

To create a deployable zip for Lambda, use `yarn bundle`. This can then be deployed via the infrastructure code.

## Environment Variables

- `COGNITO_CLIENT_ID`: The client ID for AWS Cognito.
- `CLIENT_SECRET`: The client secret for AWS Cognito.
- `ALLOWED_ORIGIN`: The allowed origin for CORS requests (default is `http://localhost:5173`).

## Development

- **Linting**: Run `yarn lint` to check for code style issues.
- **Testing**: Currently, testing is not implemented (`NYI`).

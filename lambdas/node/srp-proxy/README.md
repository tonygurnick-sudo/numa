# srp-proxy

This Lambda implements a proxy allowing us to use the Secure Remote Password (SRP) protocol with a private secret. This is required by Q for making calls as a user.

## Functionality

### initiate

Creates the Secret Hash parameter from the username, client ID and client secret, combines it with the rest of the request and sends it onwards to Cognito to initiate an auth process. This returns a challenge for the client to solve.

### respond

Creates the Secret Hash parameter from the username, client ID and client secret, combines it with the rest of the request and sends it onwards to Cognito respond to the issued challenge. This returns access credentials.

### refresh

Creates the Secret Hash parameter from the username, client ID and client secret, combines it with the rest of the request and sends it onwards to Cognito to refresh access credentials.

### CORS

This lambda also responds to OPTIONS requests with an open CORS policy.

## Building

Install dependencies with `yarn`.

Build the code with `yarn build`. This will use esbuild to create a bundled ESM file with a commonjs compatibility banner.

To create a deployable zip for Lambda, use `yarn bundle`. This can then be deployed via the infra code.

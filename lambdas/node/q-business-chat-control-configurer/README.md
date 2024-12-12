# q-business-chat-control-configurer

This Lambda implements a mechanism for changing the chat control configuration on a Q app, primarily to enable access to the LLM and general knowledge. This is not currently exposed as a Cloudcontrol resource.

## Building

Install dependencies with `yarn`.

Build the code with `yarn build`. This will use esbuild to create a bundled ESM file with a commonjs compatibility banner.

To create a deployable zip for Lambda, use `yarn bundle`. This can then be deployed via the infra code.

Portal NextGen Broker Lambda
=================================

Purpose
- Broker sensitive operations for the Customer Success Portal:
  - Update AWS Organizations account name in the NextGen management org
  - Retrieve the `system-user-password` from the client account’s Secrets Manager (by assuming `ArcanumAIAccess`)

Environment
- `MANAGEMENT_ROLE_ARN` (optional): Role in the management account that allows Organizations `UpdateAccount` (and read as needed)
- `CLIENT_ASSUME_ROLE_NAME` (optional, default `ArcanumAIAccess`): Role name to assume in the target client account
- `DEFAULT_SECRET_NAME` (optional, default `system-user-password`): Secret name to read when not provided by the event

Actions
- `updateAccountName` → { accountId, newName }
- `getSystemUserSecret` → { accountId, secretName? }

Build/Bundling
- `yarn bundle` to produce `lambda_function.zip`

# Setup NextGen Client

Use the built-in portal wizard to create a NextGen client end‑to‑end without touching the AWS consoles.

## Prerequisites

- You can sign in to the Customer Success Portal.
- The portal is configured with a broker Lambda (NEXTGEN_BROKER_LAMBDA and NEXTGEN_BROKER_REGION in `config.json`).
- Your portal identity has permission to invoke the broker Lambda.

## Steps

1. Open Tools → Setup NextGen Client.
2. Step A — Rename AWS Account
   - Enter the 12‑digit account ID and the desired client ID (e.g., `acme-demo`).
   - Click “Rename Account”.
   - The portal calls the broker, which assumes into the target account role (`ArcanumAIAccess`) and invokes the AWS Account service `PutAccountName` API (`account:PutAccountName`).
   - The rename event is recorded in the Activity table for auditing.
3. Step B — Create/Update Client Config
   - Click “Open Create” (for new) or “Open Update”. These open in a new browser tab so the wizard page keeps its context (account ID, client ID).
   - Provide required fields (Account ID, Region). Optionally upload a JSON file to replace the full config.
   - Confirm and save.
4. Step C — Plan/Deploy (Step Functions)
   - Open Deployments (opens in a new tab).
   - Select the client and an image tag.
   - Run “Plan Only”, then “Start Deployment” to apply.
   - Monitor live logs and lock status.
5. Step D — Retrieve System User Password
   - Click “Retrieve Secret”. The broker assumes into the client account and reads the `system-user-password` secret. Copy (and share via your secure channel).
   - You can also use the standalone tool “Retrieve System User Secret” (Tools → Retrieve System User Secret) at any time.

## How It’s Set Up (Security + IAM)

- Broker Lambda: `portal-nextgen-broker` (deployer account, us‑east‑1)
  - Invoked directly from the browser using Cognito Identity Pool credentials.
  - Scoped invocation: optionally restricted to principals in the NextGen organization (by `aws:PrincipalOrgID`).
- Client Account Role: `ArcanumAIAccess`
  - The broker assumes this role in the client account to perform:
    - `account:PutAccountName` (rename) via the AWS Account service
    - `secretsmanager:GetSecretValue` for `system-user-password`
- Activity Table: `numa-portal-activity` (deployer account)
  - The portal logs rename attempts and outcomes for auditing.

## Tips

- Use “Download current JSON” from Update to get a baseline config to edit and re‑upload.
- If “Rename Account” fails, confirm that the broker and the management role are deployed and that your portal session can invoke the broker.
- If secret retrieval fails, verify the `ArcanumAIAccess` role exists in the client account and trust is correct.

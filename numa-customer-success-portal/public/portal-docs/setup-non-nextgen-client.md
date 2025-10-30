# Setup Non‑NextGen Client

Use this flow when the customer brings their own AWS account (not part of the NextGen organization).

## Prerequisites
- You can sign in to the Customer Success Portal.
- The target account exposes a cross‑account role (default name: `ArcanumAIAccess`) that your deployer account can assume.
- Optional: the broker Lambda is configured if you want to retrieve the system user password from Secrets Manager.

## Steps
1. Open Tools → Setup Non‑NextGen Client.
2. Run Pre‑checks
   - Enter the target AWS Account ID and the role name (default `ArcanumAIAccess`).
   - Click “Run Pre‑checks”. The portal calls the broker to attempt a role assumption. If it succeeds, the trust is good.
3. Create/Update Client Config
   - Click “Open Create” (for new) or “Open Update”. These open in a new browser tab so the wizard page keeps its context.
   - Provide required fields (Account ID, Region). Optionally upload a JSON file to replace the full config.
   - Confirm and save.
4. Plan/Deploy (Step Functions)
   - Open Deployments (opens in a new tab).
   - Select the client and an image tag.
   - Run “Plan Only”, then “Start Deployment” to apply.
   - Monitor live logs and lock status.
5. Retrieve System User Password (optional)
   - If present, use the Retrieve Secret action from the NextGen wizard or the standalone tool “Retrieve System User Secret” to fetch `system-user-password`.

## How It’s Set Up (Security + IAM)
- Cross‑account Role in Customer Account: `ArcanumAIAccess`
  - Trusts: your deployer account principal (or a specific execution role) so the broker/portal can assume it.
  - Permissions: at minimum, read access to the secret you need (e.g., `secretsmanager:GetSecretValue` for `system-user-password`) and any other actions required by your deployment flow.
- Broker Lambda: `portal-nextgen-broker` (deployer account, us‑east‑1)
  - Used for pre‑checks (assume role) and secret retrieval.
  - Invocation policy may be restricted to the NextGen organization via `aws:PrincipalOrgID`. If the BYO account is not part of that org, grant per‑account invocation permission or run retrieval via an internal operator path.

## Tips
- If pre‑checks fail, inspect the target role’s trust policy and ensure it trusts your deployer account/role.
- Start with Plan Only to validate permissions before applying changes.
- Use JSON upload/replace when porting an existing configuration.

---
name: numa-unlock-customer
description: Unblock stuck Numa customer deployments. Use when a customer deploy fails with Terraform state lock errors, resource conflict 409 errors, "already exists" errors, ConditionalCheckFailedException, CNAME conflicts, or API Gateway route conflicts.
---

# Numa Unlock Customer

## Purpose

End-to-end guide for resolving stuck Numa customer deployments caused by Terraform state lock issues or resource drift (resources exist in AWS but are missing from Terraform state).

## Prerequisites

- Working directory: `/Users/nathandouglas/arcanum/numa/infra`
- AWS credentials configured (default profile with access to assume the deployer role)
- Deployer role: `arn:aws:iam::207567759910:role/admin-delegated-access`
- Client role pattern: `arn:aws:iam::<clientAccountId>:role/ArcanumAIAccess`
- Terraform state backend: S3 bucket `arcanum-terraform-state`, DynamoDB lock table `arcanum-terraform-lock` (both in `ap-southeast-2`)
- State path pattern: `product/<clientName>/prod/numa-<clientName>/numa.tfstate`

## Instructions

### Step 1: Identify the Problem

Ask the user for the deploy error logs. Look for:

- **State lock error**: "Error acquiring the state lock" / `ConditionalCheckFailedException` — go to Step 2
- **Resource conflict (409)**: "already exists" errors for API Gateway routes, CloudFront CNAMEs, or other resources — go to Step 3
- **Both**: Handle the lock first (Step 2), then the conflicts (Step 3)

Extract the **client name** from the error (e.g., `numa-staglands` means client is `staglands`).

---

### Step 2: Force-Unlock Terraform State

When the error contains a Lock ID (e.g., `ID: 2bf50e89-843c-6235-8d4c-f76a4ebd63bd`):

```bash
# 1. Set the client override
export CLIENT_OVERRIDE=<clientName>

# 2. Synthesize the stack (run from /infra directory)
yarn cdktf synth

# 3. Navigate to the stack directory
cd cdktf.out/prod/stacks/numa-<clientName>

# 4. Initialize terraform (connects to remote backend)
terraform init -reconfigure

# 5. Force unlock using the Lock ID from the error
terraform force-unlock --force <LOCK_ID>
```

After unlocking, if the user only had a lock issue, they can redeploy. If there were also 409 errors, continue to Step 3.

---

### Step 3: Fix Resource Conflicts (409 "Already Exists" Errors)

These errors mean resources exist in AWS but are missing from the Terraform state. The fix is to **import** the existing resources.

#### 3a. Ensure Terraform is Initialized

If not already done in Step 2:

```bash
export CLIENT_OVERRIDE=<clientName>
yarn cdktf synth
cd cdktf.out/prod/stacks/numa-<clientName>
terraform init -reconfigure
```

#### 3b. Get the Client Account ID

Extract the client's AWS account ID from the terraform state:

```bash
terraform state show 'aws_apigatewayv2_api.numa-frontend_api-gw_7D99900E' | grep execution_arn
```

The account ID is in the ARN: `arn:aws:execute-api:<region>:<ACCOUNT_ID>:<api-id>`.

#### 3c. Assume into the Client Account

Use chained role assumption to query the client's AWS account:

```bash
DEPLOYER_CREDS=$(aws sts assume-role \
  --role-arn "arn:aws:iam::207567759910:role/admin-delegated-access" \
  --role-session-name "deployer" --output json)

export AWS_ACCESS_KEY_ID=$(echo $DEPLOYER_CREDS | python3 -c "import sys,json; print(json.load(sys.stdin)['Credentials']['AccessKeyId'])")
export AWS_SECRET_ACCESS_KEY=$(echo $DEPLOYER_CREDS | python3 -c "import sys,json; print(json.load(sys.stdin)['Credentials']['SecretAccessKey'])")
export AWS_SESSION_TOKEN=$(echo $DEPLOYER_CREDS | python3 -c "import sys,json; print(json.load(sys.stdin)['Credentials']['SessionToken'])")

CLIENT_CREDS=$(aws sts assume-role \
  --role-arn "arn:aws:iam::<clientAccountId>:role/ArcanumAIAccess" \
  --role-session-name "client-lookup" --output json)

export AWS_ACCESS_KEY_ID=$(echo $CLIENT_CREDS | python3 -c "import sys,json; print(json.load(sys.stdin)['Credentials']['AccessKeyId'])")
export AWS_SECRET_ACCESS_KEY=$(echo $CLIENT_CREDS | python3 -c "import sys,json; print(json.load(sys.stdin)['Credentials']['SecretAccessKey'])")
export AWS_SESSION_TOKEN=$(echo $CLIENT_CREDS | python3 -c "import sys,json; print(json.load(sys.stdin)['Credentials']['SessionToken'])")
```

**Important:** Shell state does not persist between Bash tool calls. You must include the full role assumption chain in every AWS CLI command that queries the client account.

#### 3d. Find and Import Conflicting Resources

For each 409 error, find the existing resource ID in AWS, then import it into Terraform state. Common resource types:

**API Gateway Route Conflict** ("Route with key POST /api/... already exists"):

```bash
# Get the API Gateway ID from terraform state
terraform state show 'aws_apigatewayv2_api.numa-frontend_api-gw_7D99900E' | head -20
# Look for: id = "<API_ID>"

# Find the route ID in AWS (include role assumption before this command)
aws apigatewayv2 get-routes --api-id <API_ID> --region <REGION> \
  --query "Items[?RouteKey=='<ROUTE_KEY>'].RouteId" --output text

# Import into terraform state
terraform import '<tf_resource_address_from_error>' "<API_ID>/<ROUTE_ID>"
```

The `tf_resource_address` comes from the error message, e.g., `aws_apigatewayv2_route.staglands-data-analysis_main-start_route_0_3EC02C1F`.

**CloudFront Distribution Conflict** ("CNAMEAlreadyExists"):

```bash
# Find the distribution in AWS (include role assumption before this command)
aws cloudfront list-distributions --region us-east-1 \
  --query "DistributionList.Items[].{Id:Id,Aliases:Aliases.Items}" --output json

# Import into terraform state
terraform import '<tf_resource_address_from_error>' "<DISTRIBUTION_ID>"
```

**Other Resource Types**: Follow the same pattern — find the existing resource ID via AWS CLI, then `terraform import '<address_from_error>' "<resource_id>"`. Check [Terraform AWS provider docs](https://registry.terraform.io/providers/hashicorp/aws/latest/docs) for the import ID format of each resource type.

---

### Step 4: Redeploy

After all imports are done, the user can trigger a redeploy from the Customer Success Portal. The imports write directly to the **remote S3 state backend**, so portal deploys will pick them up immediately — no need to push or sync anything.

## Notes

- The `terraform import` commands use the same provider config (chained role assumption) that was set up during `terraform init`, so they automatically authenticate to the client account.
- AWS CLI queries to the client account require **manual** role chaining (Step 3c) because the CLI doesn't use the Terraform provider config.
- If multiple resources have conflicts, import them all before redeploying.
- Always extract resource addresses exactly as shown in the error message — they include CDKTF-generated suffixes (e.g., `_3EC02C1F`).

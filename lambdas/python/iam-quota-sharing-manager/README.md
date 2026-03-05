# IAM Quota Sharing Manager

Idempotent Lambda for managing the `bedrock-quota-sharing` IAM role and policy.

## Purpose

When multiple Numa stacks are deployed to the same AWS account with `allowBedrockQuotaSharing: true`, they would normally conflict trying to create the same IAM resources. This Lambda solves that by:

1. Checking if the role/policy already exist
2. Creating them only if they don't exist
3. Returning the ARNs either way

This makes deployments fully idempotent - safe to run multiple times or from multiple stacks.

## Event Input

```json
{
  "assume_role_policy": {
    "Version": "2012-10-17",
    "Statement": [...]
  },
  "policy_document": {
    "Version": "2012-10-17",
    "Statement": [...]
  }
}
```

## Response

```json
{
  "role_arn": "arn:aws:iam::123456789012:role/bedrock-quota-sharing",
  "policy_arn": "arn:aws:iam::123456789012:policy/bedrock-quota-sharing",
  "status": "success",
  "created_role": false,
  "created_policy": false
}
```

## IAM Permissions Required

The Lambda execution role needs:

- `iam:GetRole`, `iam:CreateRole` on `arn:aws:iam::*:role/bedrock-quota-sharing`
- `iam:GetPolicy`, `iam:CreatePolicy` on `arn:aws:iam::*:policy/bedrock-quota-sharing`
- `iam:ListAttachedRolePolicies`, `iam:AttachRolePolicy` on the above resources
- `sts:GetCallerIdentity` to determine the account ID

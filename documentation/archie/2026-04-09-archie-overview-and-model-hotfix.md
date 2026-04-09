# Archie -- Overview & Model Hotfix (2026-04-09)

Archie is Arcanum's legacy AI-powered accounts payable / invoice processing assistant. It processes incoming emails with invoice attachments, classifies documents, extracts invoice data, and integrates with Xero. It is scheduled for retirement in mid-2026.

---

## What Archie Does

1. Email arrives (via SES inbound) with attachments
2. `archie-task` orchestrates the pipeline:
   - Calls `classify-document-task` to classify each attachment (Invoice, Receipt, UtilityBill, Statement, Logo, Other) using Claude on Bedrock
   - Calls `llm-invoice-extraction-task` to extract structured invoice data (vendor, amounts, line items, dates)
   - Calls `llm-account-code-classification-task` for account code mapping
   - Calls `archie-reply-task` to send email responses
   - Sends extracted data to Xero via the platform API
3. `archie-ar-task` handles accounts receivable risk assessment (separate flow)
4. `archie-weekly-report-task` generates weekly summaries

---

## Repositories

| Repo                               | Purpose                                                                                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `machine-learning-tasks`           | Core pipeline -- ECS Fargate tasks orchestrated by Step Functions. Contains all `archie-*-task`, `classify-document-task`, `llm-invoice-extraction-task`, shared libs (`bedrock-models`, `task-helpers`) |
| `platform` (`accelerate-platform`) | Django backend -- manages AssistantInstances (Archie configs per customer), user auth, platform API                                                                                                      |
| `arcanum_micro_services`           | Contains `task-runner` (API gateway for triggering Step Functions), `invoice-extraction-service`, `email-processing-service`                                                                             |
| `arcanum-infra`                    | CDKTF infra -- ECS cluster, CloudWatch log groups, canary healthchecks, S3 buckets, IAM policies                                                                                                         |

---

## Infrastructure

### AWS Accounts & Environments

| Env     | AWS Account                                      | AWS Profile    | Archie Domain               | API Domain               |
| ------- | ------------------------------------------------ | -------------- | --------------------------- | ------------------------ |
| dev     | `arcanum-dev` (458119850496)                     | `arcanum-dev`  | `archie.dev.arcanum.ai`     | `api-dev.arcanum.ai`     |
| staging | `arcanum-quota-sharing-account-1` (978450690680) | N/A            | `archie.staging.arcanum.ai` | `api-staging.arcanum.ai` |
| prod    | `arcanum-prod` (262893720581)                    | `arcanum-prod` | `archie.arcanum.ai`         | `api.arcanum.ai`         |

Region: `ap-southeast-2` (Sydney). Bedrock calls route to `us-west-2` (and cross-region via `us.` inference profiles).

### ECS Tasks (ECR repos in prod)

All run on ECS Fargate cluster `primary_cluster`, orchestrated by a Step Function (`task-runner-task`).

| ECR Repo                           | Purpose                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| `task/archie-task`                 | Main orchestrator -- classifies, extracts, sends to Xero |
| `task/archie-reply-task`           | Sends email responses to senders                         |
| `task/archie-ar-task`              | Accounts receivable risk assessment                      |
| `task/archie-ar-risk-task`         | AR risk sub-task                                         |
| `task/archie-weekly-report-task`   | Weekly reporting                                         |
| `task/classify-document-task`      | Document classification via Claude on Bedrock            |
| `task/llm-invoice-extraction-task` | Invoice data extraction via Claude on Bedrock            |

### Key S3 Buckets (prod)

- `arcanum-platform-prod` -- main storage, invoices at `company/public/workato/*`
- `arcanum-prod-async-jobs-bucket` -- task input/output (job configs and results)
- `archie-ses-inbound-prod` -- raw inbound emails from SES
- `invoice-extraction-failed-invoices-prod` -- failed invoice processing artifacts

### CloudWatch Log Groups

- `archie-task` -- main orchestrator logs (richest for debugging)
- `classify-document-task` -- classification logs
- `llm-invoice-extraction-task` -- extraction logs
- `archie-reply-task` -- email reply logs
- `account-code-classification-task` -- account code classification
- `invoice-extraction-task` -- legacy extraction logs

Pre-built CloudWatch query definitions exist: "Archie - All" (all groups) and "Archie Task - Job Flow ID" (filter by job).

### DynamoDB Tables (prod)

- `ml-tasks-reporting` -- task execution reporting
- `archie-ap-email-history` -- AP email processing history
- `archie-ar-risk` -- AR risk assessments

### IAM Roles (prod)

Each task has a `{task-name}-task` role and a `{task-name}-execution` role. Policies are Terraform-managed with names like `terraform-{date}{hash}`.

---

## Hotfix: Bedrock Model EOL (2026-04-09)

### Problem

All document classification and invoice extraction stopped working. Error in `classify-document-task` logs:

```
ResourceNotFoundException: An error occurred (ResourceNotFoundException) when calling the InvokeModel operation:
This model version has reached the end of its life.
```

The model `anthropic.claude-3-5-sonnet-20240620-v1:0` was EOL'd by AWS.

### Root Cause

Three locations had the dead model ID hardcoded:

1. `classify-document-task` -- `classify_document_task/main.py:45`
2. `llm-invoice-extraction-task` -- `llm_invoice_extraction_task/main.py:25`
3. `bedrock-models` shared lib default -- `bedrock_claude3.py:75` (used by `archie-ar-task` which doesn't pass an explicit model_id)

### Fix Applied (no CI/CD -- direct image patch)

Since Archie is approaching end of life, we avoided a full code deployment. Instead:

1. **Pulled** the three Docker images from ECR (prod, `ap-southeast-2`)
2. **Patched** the Python files inside each container, replacing the dead model ID with `us.anthropic.claude-sonnet-4-20250514-v1:0`
3. **Committed** the patched containers as new images
4. **Pushed** back to ECR with `:latest` tag

Images patched:

- `262893720581.dkr.ecr.ap-southeast-2.amazonaws.com/task/classify-document-task`
- `262893720581.dkr.ecr.ap-southeast-2.amazonaws.com/task/llm-invoice-extraction-task`
- `262893720581.dkr.ecr.ap-southeast-2.amazonaws.com/task/archie-ar-task`

### IAM Policy Changes

The new model uses `us.` inference profile routing, which requires broader Bedrock permissions. We updated all relevant IAM policies to `bedrock:InvokeModel` on `Resource: "*"`:

- `terraform-20240314024135516100000002` (base task policy, shared by all tasks)
- `terraform-20240626225824912300000001` (classify-document-task specific)
- `terraform-20240718042947165600000001` (llm-invoice-extraction-task specific)
- `terraform-20240829233417524500000002` (archie-ar-task specific)

### Verification

Ran a standalone `classify-document-task` against a real invoice PDF (`156I47_SefoAInvoice.pdf`). Classification succeeded on first attempt:

```json
{
  "classification": "Invoice",
  "description": "Tax invoice from The Institute of Directors in New Zealand for IOD 2026 Leadership Conference early bird non-member registration fee of $2,000 NZD"
}
```

### Important Notes for Future Fixes

- **No env var override exists for model IDs.** They are hardcoded in the Python code baked into Docker images. To change the model, you must pull/patch/push the image or do a full CI/CD deploy.
- **The `machine-learning-tasks` repo was NOT updated.** The fix was applied directly to the ECR images. If a CI/CD pipeline runs and rebuilds these images from source, the old dead model ID will be re-deployed. Either update the repo source code too, or be aware that a redeploy will regress this fix.
- **Dev and staging were NOT patched.** Only prod images were updated. If dev/staging are also broken, repeat the same process with `AWS_PROFILE=arcanum-dev` and the corresponding account's ECR.
- **Terraform state mismatch.** The IAM policy changes were made directly via AWS CLI, not through CDKTF. A future `cdktf deploy` of the `task-runner` stack may revert these policies to the old restrictive versions defined in `machine-learning-tasks/infra/stacks/task-runner-stack.ts`. Update the infra code if deploying.

### How to Repeat This Fix

```bash
# 1. Auth to ECR
AWS_PROFILE=arcanum-prod aws ecr get-login-password --region ap-southeast-2 | \
  docker login --username AWS --password-stdin 262893720581.dkr.ecr.ap-southeast-2.amazonaws.com

# 2. Pull the image
docker pull 262893720581.dkr.ecr.ap-southeast-2.amazonaws.com/task/<task-name>:latest

# 3. Create a container, copy file out, patch, copy back
docker create --platform linux/amd64 --name patch <image>:latest
docker cp patch:/opt/path/to/file.py /tmp/file.py
# edit /tmp/file.py
docker cp /tmp/file.py patch:/opt/path/to/file.py
docker commit patch <image>:latest

# 4. Push
docker push <image>:latest

# 5. Clean up
docker rm patch
```

Next ECS task execution will automatically pull the new `:latest` image.

### Test a Classification Without Affecting Clients

The `classify-document-task` is safe to run in isolation -- it only reads a PDF from S3 and returns a classification. It does not write to Xero or trigger downstream effects.

```bash
TEST_JOB_ID="test-classify-$(date +%s)"
echo '{"bucket": "arcanum-platform-prod", "key": "company/public/workato/<some-file>.pdf"}' | \
  AWS_PROFILE=arcanum-prod aws s3 cp - "s3://arcanum-prod-async-jobs-bucket/${TEST_JOB_ID}"

AWS_PROFILE=arcanum-prod aws ecs run-task \
  --cluster primary_cluster \
  --task-definition classify-document-task \
  --overrides "{\"containerOverrides\": [{\"name\": \"main\", \"environment\": [{\"name\": \"INPUT_URI\", \"value\": \"s3://arcanum-prod-async-jobs-bucket/${TEST_JOB_ID}\"}, {\"name\": \"RESULT_KEY\", \"value\": \"${TEST_JOB_ID}\"}]}]}"

# Watch logs
AWS_PROFILE=arcanum-prod aws logs tail "classify-document-task" --since 5m --format short
```

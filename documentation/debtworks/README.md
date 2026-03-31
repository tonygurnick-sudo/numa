# Debtworks — Aiden Email System

Debtworks is a New Zealand debt collection company and a legacy Arcanum client (pre-Numa). Their system "Aiden" is an AI-powered email response pipeline that classifies incoming debtor emails and generates appropriate responses. This is **not** part of the Numa platform — it's a standalone system built on separate repos and infrastructure.

## Architecture

```
Debtor sends email
        |
        v
  Workato (managed by Experieco)
        |
        |--- classify email ------> email-processing-service (ECS)
        |                                 |
        |                           Returns: classification
        |                           (PaymentRelated, Dispute, Query, HighRisk, Other)
        |                           + sub-classification
        |                           + summary
        |
        |--- generate response ---> llm-knowledgebase-query (ECS)
        |                                 |
        |                           Returns: drafted email response
        |                           (using classification-specific prompt templates)
        |
        v
  Workato sends response via email
```

### Components

| Component                    | Owner                   | Purpose                                                                            |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| **Workato**                  | Experieco (third party) | Orchestrates the email flow — receives emails, calls our services, sends responses |
| **email-processing-service** | Arcanum                 | Classifies emails by type, sub-type, and risk level; generates summaries           |
| **llm-knowledgebase-query**  | Arcanum                 | Generates email responses using classification-specific prompt templates           |

We do not control or have access to the Workato configuration. All changes to response content, classification logic, or prompt behaviour are made in our two services.

## Repositories

Both services live in GitLab under `arcanumai/machine-learning-packages/ml-microservices/`. The `feat/debtworks` branch is the deployment branch for both — pushing to it triggers CI.

| Service                  | GitLab Repo                                                                                                                                           | Deployment Branch |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| email-processing-service | [gitlab.com/arcanumai/.../email-processing-service](https://gitlab.com/arcanumai/machine-learning-packages/ml-microservices/email-processing-service) | `feat/debtworks`  |
| llm-knowledgebase-query  | [gitlab.com/arcanumai/.../llm-knowledgebase-query](https://gitlab.com/arcanumai/machine-learning-packages/ml-microservices/llm-knowledgebase-query)   | `feat/debtworks`  |

Local clones live at the repo root level (not inside `numa/`):

```
arcanum/
  llm-knowledgebase-query/       <-- use this
  email-processing-service/      <-- use this
  arcanum_micro_services/        <-- older copies, ignore
```

## AWS Accounts & Infrastructure

| Account        | ID           | Purpose                                             |
| -------------- | ------------ | --------------------------------------------------- |
| Arcanum ML     | 826326270637 | CI pushes built images here (Arcanum-owned ECR)     |
| Debtworks Prod | 598403821870 | Production ECS cluster, ECR repos, running services |

**AWS profile:** `debtworks-prod` (credentials in Bitwarden Engineering collection)
**Region:** `ap-southeast-2` (Sydney)

### ECS Services

Both services run on the `primary_cluster` ECS cluster in the Debtworks account:

| ECS Service           | Task Definition            | ECR Image                                                                      |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `knowledgebase-query` | `knowledgebase-query-task` | `598403821870.dkr.ecr.ap-southeast-2.amazonaws.com/knowledgebase-query:latest` |
| `email-preprocessor`  | `email-preprocessor-task`  | `598403821870.dkr.ecr.ap-southeast-2.amazonaws.com/email-preprocessor:latest`  |

Check service status:

```bash
export AWS_PROFILE=debtworks-prod AWS_REGION=ap-southeast-2

# Service health
aws ecs describe-services --cluster primary_cluster \
  --services knowledgebase-query email-preprocessor \
  --query 'services[].{name:serviceName,status:status,running:runningCount,desired:desiredCount,lastEvent:events[0].message}'

# Deployment status
aws ecs list-service-deployments \
  --service arn:aws:ecs:ap-southeast-2:598403821870:service/primary_cluster/knowledgebase-query \
  --query 'serviceDeployments[0]'
```

## Key Files

### email-processing-service

The email classifier. Handles three stages of classification:

| File                    | Purpose                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `docker/debtworks.json` | All classification prompts — primary classification, sub-classifications (payment type, high risk reason, query type), and summarisation |

**Primary classification categories:** `PaymentRelated`, `Dispute`, `Query`, `HighRisk`, `Other`, `UncleanedDebtworksThread`

**Sub-classifications:**

- PaymentRelated -> `HavePaid`, `WillPayInFull`, `WillPayViaInstalment`, `Other`
- HighRisk -> `LegalCompliance`, `ThreatenClient`, `MedicallyDependant`, `SelfHarm`, `ThreatenDebtworks`, `Hardship`, `MediaThreat`, `Vulnerable`, `Fraud`, `Other`
- Query -> `Balance`, `InvoiceCopy`, `DefaultRelated`, `ClientFAQs`, `Other`

### llm-knowledgebase-query

The response generator. Uses the classification from email-processing-service to select a prompt template and generate an email response.

| File                           | Purpose                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `docker/debtworks_config.json` | All response prompt templates — one per classification path, plus a KB query prompt |

**Response prompt keys** (under `PROMPTS.EMAIL`):

| Key                                       | When Used                                         |
| ----------------------------------------- | ------------------------------------------------- |
| `DEFAULT`                                 | Fallback for unclassified or generic emails       |
| `PAYMENT_RELATED_HAVE_PAID`               | Debtor confirms they've made a payment            |
| `PAYMENT_RELATED_WILL_PAY_IN_FULL`        | Debtor says they will pay in full                 |
| `PAYMENT_RELATED_WILL_PAY_VIA_INSTALMENT` | Debtor wants to set up instalments                |
| `HIGH_RISK_HARDSHIP`                      | Financial hardship situations                     |
| `HIGH_RISK_VULNERABLE`                    | Vulnerable debtor situations                      |
| `HIGH_RISK_MEDICALLY_DEPENDENT`           | Medically dependent debtor situations             |
| `QUERY_BALANCE`                           | Debtor asking about their balance                 |
| `QUERY_INVOICE_COPY`                      | Debtor requesting invoice copies                  |
| `QUERY_CLIENT_FAQS`                       | General questions about Debtworks or their client |

Each prompt contains:

1. **System instruction** — tells the LLM who it is (Aiden) and the response guidelines
2. **Few-shot example** — a sample email + ideal response (most prompts)
3. **Template variables** — `{title}` and `{content}` for the actual email being responded to

The `KB_QUERY` prompt (under `PROMPTS.KB_QUERY`) is used for knowledge base lookups, separate from the email flow.

## Common Changes

### Updating office hours or contact details

Office hours and the phone number (0800 922 922) are hardcoded into the prompt templates in `llm-knowledgebase-query/docker/debtworks_config.json`. They appear in both the instruction text AND the few-shot example responses. You must update both — if you only update the instruction but leave the old hours in the example, the LLM may follow the example.

Prompts that contain office hours / phone number: `PAYMENT_RELATED_WILL_PAY_VIA_INSTALMENT`, `HIGH_RISK_HARDSHIP`, `HIGH_RISK_VULNERABLE`, `HIGH_RISK_MEDICALLY_DEPENDENT`, `QUERY_BALANCE`, `QUERY_INVOICE_COPY`, `QUERY_CLIENT_FAQS`.

### Updating classification logic

Classification prompts live in `email-processing-service/docker/debtworks.json`. Each classifier uses few-shot examples. To add a new category or adjust classification behaviour, update the prompt text and examples in that file.

### Adding a new response template

Add a new key under `PROMPTS.EMAIL` in `debtworks_config.json` following the existing pattern: system instruction + few-shot example + template variables. The key name must match what Workato sends — coordinate with Experieco if a new classification path is needed.

## Deployment

There are two deployment paths. The standard CI path, and a local workaround for when CI runners are unavailable.

### Prerequisites (both paths)

- Docker Desktop running
- AWS credentials:
  - `debtworks-prod` profile (account `598403821870`) — push images and deploy
  - `arcanum-prod-images` profile (account `826326270637`) — push/pull from Arcanum ECR
- SSH access to the GitLab repos

### Path A: Standard CI Pipeline

CI builds the image on push to `feat/debtworks` and pushes to Arcanum's ECR. You then pull from there, retag for Debtworks' ECR, push, and trigger a redeployment.

**1. Make changes and push to `feat/debtworks`:**

```bash
cd /path/to/llm-knowledgebase-query  # or email-processing-service
git checkout feat/debtworks
# make changes, commit
git push origin feat/debtworks
```

**2. Wait for CI to build and push to Arcanum ECR.** Check the GitLab pipeline for completion.

**3. Pull, retag, and push the image:**

For llm-knowledgebase-query:

```bash
export AWS_REGION=ap-southeast-2

# Log in to Arcanum ECR
aws ecr get-login-password --region ap-southeast-2 --profile arcanum-prod-images | \
  docker login --username AWS --password-stdin 826326270637.dkr.ecr.ap-southeast-2.amazonaws.com

docker pull 826326270637.dkr.ecr.ap-southeast-2.amazonaws.com/knowledgebase-query:latest
docker tag 826326270637.dkr.ecr.ap-southeast-2.amazonaws.com/knowledgebase-query:latest \
  598403821870.dkr.ecr.ap-southeast-2.amazonaws.com/knowledgebase-query:latest

# Log in to Debtworks ECR
aws ecr get-login-password --region ap-southeast-2 --profile debtworks-prod | \
  docker login --username AWS --password-stdin 598403821870.dkr.ecr.ap-southeast-2.amazonaws.com

docker push 598403821870.dkr.ecr.ap-southeast-2.amazonaws.com/knowledgebase-query:latest
```

For email-processing-service:

```bash
docker pull 826326270637.dkr.ecr.ap-southeast-2.amazonaws.com/email-preprocessor:latest
docker tag 826326270637.dkr.ecr.ap-southeast-2.amazonaws.com/email-preprocessor:latest \
  598403821870.dkr.ecr.ap-southeast-2.amazonaws.com/email-preprocessor:latest
docker push 598403821870.dkr.ecr.ap-southeast-2.amazonaws.com/email-preprocessor:latest
```

**4. Continue to "Trigger ECS redeployment" below.**

### Path B: Local Image Patching (CI runners unavailable)

As of March 2025, the GitLab CI runners tagged `aws` + `docker` are offline, so the standard pipeline doesn't build. This workaround patches the existing production image locally without a full rebuild — useful for config-only changes where no code dependencies have changed.

The approach: pull the current production image from Debtworks' ECR, replace the config file inside it using `docker cp` + `docker commit`, then push the patched image back.

**1. Commit and push your changes to `feat/debtworks`** (keeps the source repo in sync even if CI can't build):

```bash
git push origin feat/debtworks
```

**2. Pull the current production image:**

```bash
aws ecr get-login-password --region ap-southeast-2 --profile debtworks-prod | \
  docker login --username AWS --password-stdin 598403821870.dkr.ecr.ap-southeast-2.amazonaws.com

docker pull 598403821870.dkr.ecr.ap-southeast-2.amazonaws.com/knowledgebase-query:latest
```

**3. Patch the config inside the image:**

```bash
# Create a stopped container from the image
CONTAINER_ID=$(docker create --platform linux/amd64 \
  598403821870.dkr.ecr.ap-southeast-2.amazonaws.com/knowledgebase-query:latest)

# Copy the updated config file into the container
docker cp docker/debtworks_config.json "$CONTAINER_ID:/data/debtworks_config.json"

# Commit the container as a new image, overwriting the tag
docker commit "$CONTAINER_ID" \
  598403821870.dkr.ecr.ap-southeast-2.amazonaws.com/knowledgebase-query:latest

# Clean up
docker rm "$CONTAINER_ID"
```

**4. Push to both ECRs:**

```bash
# Push to Debtworks ECR
docker push 598403821870.dkr.ecr.ap-southeast-2.amazonaws.com/knowledgebase-query:latest

# Also push to Arcanum ECR to keep them in sync
aws ecr get-login-password --region ap-southeast-2 --profile arcanum-prod-images | \
  docker login --username AWS --password-stdin 826326270637.dkr.ecr.ap-southeast-2.amazonaws.com

docker tag 598403821870.dkr.ecr.ap-southeast-2.amazonaws.com/knowledgebase-query:latest \
  826326270637.dkr.ecr.ap-southeast-2.amazonaws.com/knowledgebase-query:latest
docker push 826326270637.dkr.ecr.ap-southeast-2.amazonaws.com/knowledgebase-query:latest
```

**5. Continue to "Trigger ECS redeployment" below.**

> **When NOT to use Path B:** If code dependencies changed (new Python packages, updated `arcanumai` library, etc.), you need a full rebuild via Path A or a local `docker build` with the correct GitLab package registry credentials.

### Trigger ECS redeployment

```bash
export AWS_PROFILE=debtworks-prod AWS_REGION=ap-southeast-2

# For knowledgebase-query
aws ecs update-service \
  --service arn:aws:ecs:ap-southeast-2:598403821870:service/primary_cluster/knowledgebase-query \
  --force-new-deployment

# For email-preprocessor (only if that service was updated)
aws ecs update-service \
  --service arn:aws:ecs:ap-southeast-2:598403821870:service/primary_cluster/email-preprocessor \
  --force-new-deployment
```

### Verify deployment

```bash
# Wait ~2-3 minutes, then check
aws ecs describe-services --cluster primary_cluster \
  --services knowledgebase-query email-preprocessor \
  --query 'services[].{name:serviceName,status:status,running:runningCount,lastEvent:events[0].message}'
```

The service should report "has reached a steady state" with `runningCount: 1`.

### Testing the deployed service

The services are accessible via the public ALB at `arcanum-1421229116.ap-southeast-2.elb.amazonaws.com`. You can send a test request to verify a deployment:

```bash
# Healthcheck
curl -s http://arcanum-1421229116.ap-southeast-2.elb.amazonaws.com/api/knowledgebase-query/healthcheck/

# Generate a test email (knowledgebase-query)
curl -s -X POST http://arcanum-1421229116.ap-southeast-2.elb.amazonaws.com/api/knowledgebase-query/generate-email/ \
  -H "Content-Type: application/json" \
  -d '{
    "payload": {
      "type": "PaymentRelatedWillPayViaInstalment",
      "title": "Test",
      "content": "Hi, I would like to set up a weekly payment plan."
    }
  }'
# Returns: {"jobId": {"wf_id": "<uuid>"}}

# Poll for result (use the wf_id from above)
curl -s -X POST http://arcanum-1421229116.ap-southeast-2.elb.amazonaws.com/api/knowledgebase-query/complete/ \
  -H "Content-Type: application/json" \
  -d '{"jobId": {"wf_id": "<uuid>"}}'
# Returns: {"status": "COMPLETE", "answer": "...", ...}
```

The `type` field maps to the prompt keys via camelCase → CONSTANT_CASE conversion (e.g., `PaymentRelatedWillPayViaInstalment` → `PAYMENT_RELATED_WILL_PAY_VIA_INSTALMENT`).

## Contacts

| Who                | Role                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| **Bronwyn Caples** | Head of Operations - NZ at Debtworks. Primary contact for change requests |
| **Experieco**      | Manages the Workato integration. Contact them for flow/routing changes    |
| **Nathan Douglas** | Last Arcanum engineer to work on this system                              |

## References

- [Dave's Handover Notes (Notion)](https://www.notion.so/Dave-Handover-253cf755ee8280ae9cc7fd7a7e952b84#262cf755ee8280209338e42529fe3232) — original deployment instructions from the previous devops engineer. This doc supersedes those notes.

## History

- **Pre-2024:** System built by Arcanum's previous devops engineer (no longer at the company)
- **2024:** Various prompt improvements — dispute handling, hallucination fixes, FAQ knowledge base updates
- **March 2025:** CI pipeline updates, linting fixes, FAQ knowledge ID updates
- **March 2025:** Office hours updated to 8am–6:30pm Mon–Fri, 8am–12pm Sat. Deployed via local image patching (Path B) due to offline CI runners

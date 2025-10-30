Here’s a concise summary you can paste as context for a new chat.

Step Function Contract

Input (from portal):
clientName: string (e.g., arcanum-demo-sydney)
imageTag: string (numa-deploy image tag)
initiatedBy: string (email)
startedAt: ISO string
deploymentId: string (“deploy-<timestamp>”)
Output/Side Effects:
Writes/updates a row in DynamoDB table numa-portal-deployments with status, attempts, logs, ECS task ARN, and SFN execution ARN.
Does not return a payload to the portal; portal polls DDB to display progress/status and links.
State Machine Flow (NumaPortalDeployment)

InitRetryCount: retryCount = 0
RecordStart (DDB PutItem): status=running, attemptNumber=1, attemptLabel="1/2", startedAt, imageTag, initiatedBy, sfnExecutionArn
AssumeBackendRole (Lambda Invoke): calls portal-deploy-assume-backend to get STS creds for the Terraform backend account (root)
RegisterTaskDefinition (ECS Register): pins numa-deploy:<imageTag> and sets container env:
TF_ENVIRONMENT=prod
CLIENT_OVERRIDE=<clientName>
TF_CLI_ARGS_apply=-parallelism=20
AWS_ACCESS_KEY_ID/SECRET/SESSION_TOKEN from the Lambda response
RunTask (ECS Fargate): runs in cluster numa-portal-deployments, awsvpc public subnets, logs to /ecs/numa-portal-deploy
RecordRunTaskInfo (DDB UpdateItem): sets ecsTaskArn (overwrites per attempt so the UI points to the latest run)
WaitForStop → DescribeTasks loop until STOPPED
ExitOk?
Success: RecordSuccess or RecordSuccessNoLogs (updates status, endedAt, logsGroup and logsStream if present, and ecsTaskArn)
Failure: ComputeRetryWindow → RetryWindow?:
If ExitCode != 0 AND retryCount < 1 AND StoppedAt ∈ [StartedAt+25m, StartedAt+35m]:
RetryMarkAndBump (DDB UpdateItem): attemptNumber=2, attemptLabel="2/2", status=retrying
SetRetryCount=1 → re‑AssumeBackendRole → Register → Run (one-time auto-retry)
Else: record failure (RecordExitFailure/NoLogs)
DynamoDB Table (History)

Table: numa-portal-deployments
PK: deploymentId (S)
Attributes: clientName (S), imageTag (S), initiatedBy (S), status (S), startedAt (S), endedAt (S), sfnExecutionArn (S), ecsTaskArn (S), logsGroup (S), logsStream (S), attemptNumber (N), attemptLabel (S)
GSI: clientName-index (clientName as partition key, startedAt as sort key, desc scan for latest)
IAM and Roles (Key Points)

Backend (root) account 442483608950:
Role: terraform-backend-access
Trust: arn:aws:iam::207567759910:role/portal-deploy-assume-backend-role
Permissions: S3 List/Get/Put/Delete for arcanum-terraform-state tfstate path; DynamoDB Describe/Get/Put/Delete/Update for arcanum-terraform-lock (ap-southeast-2). Add KMS perms if SSE‑KMS is used.
Also allows sts:AssumeRole on deployer role arn:aws:iam::207567759910:role/admin-delegated-access (so providers can hop deployer→client).
Deployer account 207567759910:
Lambda: portal-deploy-assume-backend (returns STS creds for backend role)
Lambda role: portal-deploy-assume-backend-role (can sts:AssumeRole the above backend role)
SFN role: invokes Lambda; ecs:RegisterTaskDefinition|RunTask|DescribeTasks; iam:PassRole for ECS roles; DDB Put/Update on history table
ECS task role: has sts:AssumeRole to admin-delegated-access and ArcanumAIAccess (downstream provider hops)
ECS exec role: ECR pull + CloudWatch logs
ECS Task Behavior

Image: 826326270637.dkr.ecr.ap-southeast-2.amazonaws.com/numa-deploy:<imageTag>
Command: yarn workspace @arcanumai/q-apps-deployer-infra exec cdktf deploy --auto-approve numa-<clientName>
Env: TF_ENVIRONMENT=prod, CLIENT_OVERRIDE, TF_CLI_ARGS_apply=-parallelism=20, temporary AWS creds (backend)
Logging: group /ecs/numa-portal-deploy, stream ecs/deployer/<taskId>
Portal UI and Links

Config keys required for deployments:
DEPLOYMENTS_TABLE: numa-portal-deployments
DEPLOYMENT_SFN_ARN: state machine ARN
Shows recent deployments per client; polls DDB
Status badge includes attempt label e.g., “running (1/2)”, “failed (2/2)”
Logs link:
Uses logsGroup/logsStream from DDB when present
Fallback: infers group /ecs/numa-portal-deploy and stream ecs/deployer/<taskId> from ecsTaskArn
Performance & Reliability

Terraform parallelism: -parallelism=20 to shorten wall‑clock time; monitor for Lambda/IAM throttles (adaptive retries can help)
Token expiry:
One‑time auto‑retry if the first run fails within 25–35 minutes (heuristic)
If needed, extend MaxSessionDuration on roles and use longer STS durations in both the Lambda and provider assume_role configs
This reflects the final working setup, including the cross‑account backend role in 4424, the assume-role Lambda, the ECS deploy task, the retry heuristic, and how the DDB‑backed history and portal links are maintained.

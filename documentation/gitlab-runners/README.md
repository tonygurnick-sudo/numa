# GitLab Runners

GitLab CI/CD runners for the `arcanumai/numa` project (and any other projects in the `arcanumai` group that opt into the shared registration). They live in their own AWS account, separate from any client/Numa infrastructure, and are autoscaled based on the GitLab job queue.

## Where the source lives

- **Repo:** `arcanum/achive/arcanum-infra/` (yes, despite the `achive/` (sic) folder name — this is still the source of truth for the runners). CDKTF in TypeScript.
- **Stack:** `stacks/gitlab-runner-stack.ts`
- **Construct:** `constructs/gitlab-runner-template-construct.ts`
- The "archive" naming is misleading. Most of `arcanum-infra/` is genuinely retired, but the runner stack is live and deployed.

When making changes always prefer updating the source and re-deploying. Direct AWS edits should go in [`hotfix-log.md`](hotfix-log.md) so they get backported.

## Where the resources live

| Item                  | Value                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| AWS account           | `458119850496` (Arcanum dev account)                                                             |
| AWS profile           | `arcanum-dev`                                                                                    |
| Region                | `ap-southeast-2` (Sydney)                                                                        |
| ASG name              | `gitlab-runners` (`MinSize = 1`, `MaxSize = 25`, ceiling = 50 parallel jobs at `concurrent = 2`) |
| Launch template       | `lt-0a20e16ecb8296cc5` (`gitlab-runners-...`)                                                    |
| Instance profile      | `gitlab-runners-asg`                                                                             |
| Cache S3 bucket       | `arcanum-gitlab-runner-cache` (region `ap-southeast-2`)                                          |
| Queue monitor Lambda  | `gitlab-runners-queue-monitor` (Node 22, every 1 min via EventBridge; reconciles ASG directly)   |
| Scale-out alarm       | `gitlab-runners-pending-jobs-high` (`GitLabRunners/PendingJobs >= 1`)                            |
| Scale-out policy      | `gitlab-runners-scale-out` (StepScaling)                                                         |
| GitLab project polled | `arcanumai/numa`, project ID `61047472`                                                          |

## How the autoscaler works

Lambda-driven reconciliation loop. The CloudWatch alarm + step-scaling policy still exist but are redundant; they remain in place as fallback in case the Lambda fails.

1. **Lambda reconciliation** (primary path, runs every 1 min via EventBridge):
   - Lambda `gitlab-runners-queue-monitor` calls `GET /api/v4/projects/61047472/jobs?scope=pending` and `?scope=running` on GitLab.
   - Publishes `GitLabRunners/PendingJobs` to CloudWatch (used by the fallback alarm).
   - Computes ideal capacity directly from the queue:

     ```
     ideal = clamp(MinSize, MaxSize, ceil((pendingJobs + runningJobs) / CONCURRENT_PER_INSTANCE))
     ```

   - **Scale-out:** if `ideal > current`, calls `SetDesiredCapacity(ideal)` in a single shot. No alarm round-trip — ASG starts launching every needed instance in parallel within seconds of the Lambda invocation.
   - **Scale-in:** only when `pendingJobs == 0 && runningJobs == 0 && current > MinSize`. Drops by 10 if `current > 10`, otherwise by 1. Conservative on purpose: there is no graceful-drain hook, so terminating an instance with a job in flight kills that job.

2. **EC2 boot path** (same as before):
   - ASG launches new EC2 instances using the latest launch-template version. User-data installs Docker, downloads `gitlab-runner`, masks `ecs.service`, registers the runner, configures S3 cache, then starts the runner. ~2 to 3 min from "Pending" to actually accepting jobs.

3. **Fallback path** (CloudWatch alarm, redundant):
   - Alarm `gitlab-runners-pending-jobs-high` (period 60s, threshold `>= 1`) fires `gitlab-runners-scale-out` step-scaling policy if it ever fires:

     | Pending jobs | Capacity change |
     | ------------ | --------------- |
     | `1` to `5`   | `+1`            |
     | `5` to `15`  | `+3`            |
     | `15+`        | `+5`            |

   - In normal operation the Lambda will have already scaled to ideal capacity before the alarm transitions to ALARM, so step-scaling is a no-op. It only kicks in if the Lambda is broken or its IAM permissions revoked.

### Worst-case latency (queue empty → first new instance accepting jobs)

| Stage                                                        | Time                |
| ------------------------------------------------------------ | ------------------- |
| Wait for next Lambda invocation (1-min cadence)              | 0 to 60 sec         |
| GitLab API + CloudWatch put + ASG SetDesiredCapacity         | ~1 sec              |
| EC2 RunInstances + boot to running state                     | ~30 sec             |
| Cloud-init: install Docker, download gitlab-runner, register | ~2 min              |
| **Total**                                                    | **~2.5 to 3.5 min** |

Down from the old 5 to 8.5 min that involved waiting for both the polling cadence and the alarm period.

## Runner config

The launch template's user-data script does the per-instance setup:

- Installs Docker, `gitlab-runner` (latest binary from S3).
- Registers as a Docker executor:
  - `--docker-image alpine:latest` (default; overridden by jobs).
  - `--docker-privileged --docker-volumes /certs/client` (DinD enabled).
- Patches `/etc/gitlab-runner/config.toml`:
  - `concurrent = 2` (parallel jobs per instance — see hotfix log entries on 2026-05-05).
  - `[runners.cache]` pointed at S3 bucket `arcanum-gitlab-runner-cache` (shared cache across all runners).
- Listen address `:9252` for Prometheus metrics (currently not scraped, but the port is open in the SG).
- Disables and masks `ecs.service` (the AMI is ECS-optimized AL2023 and `amazon-ecs-init` was racing the gitlab-runner Docker socket).
- CloudWatch agent collects CPU / disk / mem metrics into the `EC2` namespace.
- Cron at 15:00 UTC daily: `docker image prune -fa && docker volume prune -f` to keep the EBS volume from filling up.

Default instance type: `m5.xlarge` (4 vCPU, 16 GB RAM, 100 GB gp3 root). Originally `c5.xlarge` (8 GB) but `concurrent = 4` cdktf yarn installs OOM'd. Moved to `m5.xlarge` for headroom, then dropped `concurrent` from 4 to 2 once it became clear the host's 4 vCPU could not actually carry 4 parallel docker-in-docker builds (Docker daemon timed out under contention even with memory free). At `concurrent = 2` each job gets ~2 vCPU and uncontended Docker. Each cdktf job also runs a `docker:dind` sidecar so on-host container count is `concurrent × 2`.

## Tokens

Two different tokens, easy to confuse:

| Token                       | Prefix   | Where stored                                                                | Purpose                                                                        | Rotation                                                                                                |
| --------------------------- | -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Runner authentication token | `glrt-`  | Hardcoded in launch-template user-data (`Runner authentication token...`)   | Used by `gitlab-runner register` so each instance registers itself with GitLab | Rare. Only when revoked or compromised. Issued in GitLab from project Settings to CI/CD to Runners.     |
| Project access token (API)  | `glpat-` | Lambda env var `GITLAB_TOKEN` on `gitlab-runners-queue-monitor` (plaintext) | Read-only API access so the Lambda can count pending/running jobs              | Whenever it expires. Issue from project Settings to Access Tokens with `read_api` scope, role Reporter. |

Both belong to the `arcanumai/numa` GitLab project. The `glpat-` is plaintext in a Lambda env var which is tech debt — flagged below.

To rotate the API token:

```bash
aws lambda update-function-configuration \
  --profile arcanum-dev --region ap-southeast-2 \
  --function-name gitlab-runners-queue-monitor \
  --environment 'Variables={GITLAB_TOKEN=<new>,ASG_NAME=gitlab-runners,GITLAB_PROJECT_ID=61047472}'
```

## Common operations

### Inspect current state

```bash
aws autoscaling describe-auto-scaling-groups \
  --profile arcanum-dev --region ap-southeast-2 \
  --auto-scaling-group-names gitlab-runners \
  --query "AutoScalingGroups[].{Min:MinSize,Max:MaxSize,Desired:DesiredCapacity,InService:length(Instances[?LifecycleState=='InService'])}"

aws cloudwatch describe-alarms \
  --profile arcanum-dev --region ap-southeast-2 \
  --alarm-names gitlab-runners-pending-jobs-high \
  --query "MetricAlarms[].{State:StateValue,Reason:StateReason}"
```

### Read queue monitor logs

```bash
aws logs tail /aws/lambda/gitlab-runners-queue-monitor \
  --profile arcanum-dev --region ap-southeast-2 --since 30m --format short
```

Healthy log line:

```
INFO {"action":"metric","trigger":"schedule","pendingJobs":<n>,"runningJobs":<n>}
```

### Force a queue check

```bash
aws lambda invoke \
  --profile arcanum-dev --region ap-southeast-2 \
  --function-name gitlab-runners-queue-monitor \
  --payload '{"source":"manual"}' --cli-binary-format raw-in-base64-out \
  /tmp/lambda_invoke.json && cat /tmp/lambda_invoke.json
```

### Manually adjust desired capacity (temporary, ASG will re-evaluate)

```bash
aws autoscaling set-desired-capacity \
  --profile arcanum-dev --region ap-southeast-2 \
  --auto-scaling-group-name gitlab-runners \
  --desired-capacity <n>
```

### Change `concurrent` per instance

This is set in the launch-template user-data. Update via:

1. Update the `arcanum-infra` source (`gitlab-runner-template-construct.ts`) and redeploy. **Preferred**.
2. Or hotfix: create a new launch-template version with the modified user-data, set it as default, then either roll the ASG (instance refresh) or wait for normal turnover. Plus SSM into the live instance to bump it immediately:

   ```bash
   aws ssm send-command \
     --profile arcanum-dev --region ap-southeast-2 \
     --instance-ids <id> \
     --document-name "AWS-RunShellScript" \
     --parameters 'commands=["sudo sed -i \"s/^concurrent = [0-9]\\+/concurrent = <n>/\" /etc/gitlab-runner/config.toml","sudo systemctl restart gitlab-runner"]'
   ```

### Change ASG MaxSize

Source is in `arcanum-infra/stacks/gitlab-runner-stack.ts`. For an emergency bump:

```bash
aws autoscaling update-auto-scaling-group \
  --profile arcanum-dev --region ap-southeast-2 \
  --auto-scaling-group-name gitlab-runners --max-size <n>
```

Then log it in the hotfix log.

### Roll the fleet onto a new launch-template version

Either trigger an instance refresh (graceful, slow):

```bash
aws autoscaling start-instance-refresh \
  --profile arcanum-dev --region ap-southeast-2 \
  --auto-scaling-group-name gitlab-runners \
  --preferences '{"MinHealthyPercentage":50,"InstanceWarmup":300}'
```

Or just wait for natural churn (scale-in then scale-out) which replaces instances with the latest version.

## Failure modes seen in the wild

| Symptom                                       | Likely cause                                                                                          | Fix                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Pipelines pile up, only 1 job runs at a time  | `concurrent = 1` AND queue monitor broken                                                             | See 2026-05-05 entry in [hotfix-log.md](hotfix-log.md) |
| `PendingJobs` metric stuck at 0 in CloudWatch | API token expired, or Lambda crashing                                                                 | Tail Lambda logs, re-issue token, redeploy if needed   |
| ASG never scales out despite queue            | Alarm `OK` because metric isn't being published                                                       | Same as above                                          |
| ASG never scales in                           | Lambda erroring before the `handleScaleIn` path                                                       | Tail Lambda logs                                       |
| Runners online in GitLab but jobs sit pending | Wrong tags on jobs vs runner, or runner registration token rotated and live instances still using old | Check runner registration in GitLab UI                 |

## Known tech debt

- **API token (`GITLAB_TOKEN`) lives in plaintext in a Lambda env var.** Should be in Secrets Manager (or SSM Parameter Store as `SecureString`) with the Lambda fetching at cold-start. While we're at it, the runner registration token in user-data has the same problem.
- **No expiry alerting on the API token.** A stale token silently broke autoscaling. Set a calendar reminder a week before expiry, or build a check that monitors the Lambda's success metric.
- **Source lives in a folder named `achive/`.** Either move it out or rename. Easy to lose track of.
- **Single AZ / single region.** Fine for dev, but a Sydney AZ outage takes down all CI.
- **No idle-instance protection.** A long-running job on the only `MinSize` instance can survive scale-in (Lambda only scale-ins when `running == 0`), but there's no draining hook so a force-terminate during deploy could kill jobs.
- **GitLab CLI metrics endpoint (`:9252`) not scraped.** Could expose richer per-runner metrics if we ever want them.

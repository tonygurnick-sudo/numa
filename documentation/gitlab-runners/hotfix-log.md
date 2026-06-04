# GitLab Runners — Hotfix Log

Log of changes made directly to deployed AWS resources that have NOT yet been backported to the `arcanum/achive/arcanum-infra/` source. Each entry should describe what was changed in AWS, why, and what needs to land in source so the hotfix is no longer needed.

When a hotfix is backported and the next deploy reconciles, mark it with `STATUS: backported`.

---

## 2026-06-04 — Temporary MaxSize bump 25 → 50 for an urgent deploy

**STATUS:** temporary (NOT a source change — revert after the pipeline drains)

**Reason:** Urgent HQ deploy pipeline (`arcanumai/numa` #2575226484 on `dev`) with the large `check` + `package` fan-out (~275 matrix jobs). At the documented ceiling (`MaxSize = 25`, `concurrent = 2` → 50 parallel slots) the fan-out runs in ~3 waves. Bumped to 100 parallel slots to cut wave count for this run.

### Changes made directly in AWS

| Resource             | Change                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| ASG `gitlab-runners` | `MaxSize` 25 → 50 (= 100 parallel jobs at `concurrent = 2`). vCPU quota is 968, well above the 200 needed. |
| ASG `gitlab-runners` | `DesiredCapacity` manually set to 50 to pre-warm the fleet (boot ~2.5–3.5 min) ahead of the fan-out.       |

### Revert

Self-corrects on `DesiredCapacity`: once the queue drains (`pending == 0 && running == 0`) the queue-monitor Lambda scales in (−10/min while > 10) back toward `MinSize = 1`. **`MaxSize` does NOT self-revert** — manually restore the documented baseline once the pipeline finishes:

```bash
aws autoscaling update-auto-scaling-group \
  --profile arcanum-dev --region ap-southeast-2 \
  --auto-scaling-group-name gitlab-runners --max-size 25
```

No source change needed — this is a one-off burst, not a new baseline.

---

## 2026-05-05 — Token expired + concurrent=1 throttle

**STATUS:** outstanding (not yet backported to `arcanum-infra`)

**Reported as:** "GitLab pipelines are only running one job at a time, should be like 10."

### Root cause

Two compounding problems:

1. The `glpat-` API token in Lambda env var `gitlab-runners-queue-monitor.GITLAB_TOKEN` had expired. GitLab returned `401 invalid_token` for every queue poll. The Lambda's parser assumed an array response, hit `{error: ...}.length === undefined`, summed it as `NaN`, and `PutMetricData` rejected the value. So `GitLabRunners/PendingJobs` had not been published in some unknown amount of time, the alarm was perpetually `OK`, and the ASG never scaled out.
2. Each runner was hardcoded `concurrent = 1` in launch-template user-data, so even when scale-out worked, each EC2 instance only ran one job at a time. Compounded with point 1, the entire fleet ran exactly one job at a time.

At time of incident, GitLab queue had **94 pending + 1 running**, ASG was sitting at `desired = 1`.

### Changes made directly in AWS

| Resource                                                 | Change                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlab-runners-queue-monitor` Lambda env `GITLAB_TOKEN` | Rotated to new `glpat-...` (project access token, role Reporter, scope `read_api`, on `arcanumai/numa`).                                                                                                                                                                                                                                                                   |
| `gitlab-runners-queue-monitor` Lambda code               | Replaced with a defensive version that: handles non-2xx responses with explicit log + reject; tolerates GitLab no longer returning `X-Total`; paginates via `X-Next-Page` with a fallback `count === per_page` heuristic; caps at 50 pages so a runaway loop cannot DoS itself. Code in `/tmp/gitlab-runner-monitor-fix/index.js` at time of fix; not preserved long-term. |
| Launch template `lt-0a20e16ecb8296cc5`                   | New version 11 with user-data `concurrent = 4` (was 1). Promoted to default. ASG already pinned to `$Latest`.                                                                                                                                                                                                                                                              |
| Live instance `i-01f00b6c83ad46d3b`                      | SSM `AWS-RunShellScript`: in-place edit of `/etc/gitlab-runner/config.toml` from `concurrent = 1` to `concurrent = 4`, then `systemctl restart gitlab-runner`. Verified runner re-registered.                                                                                                                                                                              |

After the fix the alarm tripped within ~1 min (94 pending), step-scaling fired `+5`, ASG went `1 -> 6` instances, and the existing instance immediately picked up 4 parallel jobs. Step-scaling caps growth at +5 per alarm trigger. (See follow-up entry below for the `MaxSize` cap that bounds steady-state parallelism.)

### What needs to be backported to `arcanum-infra`

In `arcanum/achive/arcanum-infra/`:

1. **`constructs/gitlab-runner-template-construct.ts`** (or wherever the user-data string is built): change the `sed` line from `concurrent = 1` to `concurrent = 4`.
2. **Lambda source for the queue monitor**: replace with the defensive parser. The code is currently inline in the construct (or a sibling file) in arcanum-infra. Specifically:
   - Reject on non-2xx with logged status + body snippet rather than letting `JSON.parse` throw silently.
   - Stop relying on `X-Total`.
   - Paginate via `X-Next-Page` and fall back to `count === per_page`.
   - Cap pagination at 50 pages.
3. **`GITLAB_TOKEN` storage**: while you are in there, move it from a plain Lambda env var to either Secrets Manager or SSM SecureString. Have the Lambda fetch on cold-start and cache. Same treatment ideally for the `glrt-` runner authentication token in user-data.
4. **Token expiry alerting**: add a CloudWatch alarm on the Lambda's `Errors` metric, or a metric filter that alerts when log line contains `gitlab-error` with `statusCode: 401`. Anything to make a stale token loud.

After landing those changes and redeploying `arcanum-infra`, mark this entry `STATUS: backported`.

### Files / commands referenced

- Lambda zip used: built from `/tmp/gitlab-runner-monitor-fix/index.js` (this file is in tmp and will be lost; re-derive from source when backporting).
- New launch template version: `aws ec2 describe-launch-template-versions --launch-template-id lt-0a20e16ecb8296cc5 --versions 11` (description `concurrent=4 hotfix 2026-05-05`).

---

## 2026-05-05 — Cap parallelism at 100 jobs

**STATUS:** outstanding (not yet backported to `arcanum-infra`)

**Reported as:** "200 is probably too large... could we set it to 100?"

### Change

`gitlab-runners` ASG `MaxSize` reduced from `50` to `25`. With `concurrent = 4` per instance, this gives a steady-state ceiling of **100 parallel jobs** (25 × 4) and capped cost-at-burn of ~$5/hr while fully scaled (`c5.xlarge` ≈ $0.20/hr in Sydney). Step-scaling (`+5` per alarm trigger when pending ≥ 15) is unaffected; the ASG now just refuses to grow past 25.

```bash
aws autoscaling update-auto-scaling-group --profile arcanum-dev --region ap-southeast-2 \
  --auto-scaling-group-name gitlab-runners --max-size 25
```

### What needs to be backported to `arcanum-infra`

In `stacks/gitlab-runner-stack.ts` (or wherever the ASG construct lives), set `maxSize: 25` for the `gitlab-runners` ASG. Mark this entry `STATUS: backported` after the next deploy reconciles.

### Tuning guidance for future operators

If queue depth regularly exceeds 100, the lever to reach for first is `concurrent` rather than `MaxSize`. CI jobs are mostly I/O-bound (npm/yarn installs, container pulls), so an `m5.xlarge` (16 GB) can probably handle `concurrent = 6` before something starts to give. Bumping `concurrent` from 4 to 6 lifts ceiling from 100 to 150 with no extra EC2 cost. Only raise `MaxSize` once you have evidence individual instances are CPU-saturated (load average sustained well above vCPU count).

---

## 2026-05-05 — c5.xlarge → m5.xlarge to fix OOM kills

**STATUS:** outstanding (not yet backported to `arcanum-infra`)

**Reported as:** CI jobs (e.g. `yarn install` in `cdktf` image) failing with bare `exit code 1` after fetch step, no error message logged.

### Root cause

After bumping `concurrent` from 1 to 4 earlier today, `c5.xlarge` (4 vCPU, **8 GB RAM**) was undersized. Probing a live instance via SSM showed two OOM kills within 6 minutes, both targeting `node` processes with ~3.7 GB anon-rss each. Four parallel `yarn install`s on cdktf packages comfortably exceed 8 GB once dockerd, the runner, ssm-agent and CloudWatch agent are accounted for. Load average was also `12.4 on 4 vCPU` so jobs were CPU-saturated before they OOM'd.

The OOM killer reaping a child of `yarn` produces exactly the symptom the user saw: a generic exit code 1 with no error message in CI logs.

### Change

Launch template `lt-0a20e16ecb8296cc5` v12 created with `InstanceType: m5.xlarge` (4 vCPU, **16 GB RAM**, same Intel Xeon family as c5). Promoted to default. User-data unchanged (still `concurrent = 4`).

```bash
aws ec2 create-launch-template-version --profile arcanum-dev --region ap-southeast-2 \
  --launch-template-id lt-0a20e16ecb8296cc5 --source-version '$Latest' \
  --version-description "instance-type m5.xlarge for headroom 2026-05-05" \
  --launch-template-data '{"InstanceType":"m5.xlarge"}'
aws ec2 modify-launch-template --profile arcanum-dev --region ap-southeast-2 \
  --launch-template-id lt-0a20e16ecb8296cc5 --default-version 12
```

**No instance refresh was triggered.** Existing `c5.xlarge` instances continue running until natural ASG turnover (Lambda scale-in when queue clears, then scale-out brings up `m5.xlarge`). They may continue to OOM-kill the occasional cdktf job in the meantime; CI retry should mask it. If jobs keep failing visibly, manually terminate the worst offenders with `aws autoscaling terminate-instance-in-auto-scaling-group --no-should-decrement-desired-capacity` to force ASG to replace them with the new instance type.

### Cost impact

Sydney on-demand: `c5.xlarge` $0.222/hr → `m5.xlarge` $0.240/hr (+8%). At full burn (25 instances) that is $5.55/hr → $6.00/hr, an additional ~$0.45/hr while fully scaled.

Cheaper alternative considered but rejected: `m5a.xlarge` (AMD EPYC) at $0.216/hr would be ~3% cheaper than the current c5.xlarge, but switching CPU vendor introduces a small risk of behavioural surprises in CI (rare but real for native deps), and we wanted to keep variables to a minimum.

### What needs to be backported to `arcanum-infra`

In the launch-template construct (`constructs/gitlab-runner-template-construct.ts`), change `InstanceType` from `c5.xlarge` to `m5.xlarge`. Mark this entry `STATUS: backported` after the next deploy reconciles.

---

## 2026-05-05 — concurrent 4 → 2 + disable ECS agent (Docker daemon contention)

**STATUS:** outstanding (not yet backported to `arcanum-infra`)

**Reported as:** `node-lambdas-check: [lambdas/node/budget-forwarder]` failing with `exit code 1` after fetch step, even on a fresh `m5.xlarge` runner with 14 GB RAM free.

### Root cause

Two issues, the first dominant:

1. **`concurrent = 4` was too aggressive for a 4-vCPU host running docker-in-docker.** Each gitlab-runner job spawns _two_ containers: the build container plus a `docker:dind` service container. So `concurrent = 4` means **8 containers** all hitting the same Docker daemon. The runner journal showed:

   ```
   WARNING: Failed to exec create to container: ...
            context deadline exceeded (docker.go:1619:9s)
   WARNING: Job failed: exit code 1  duration_s=208
   ```

   Load average was **28 on 4 cores** (7× oversubscribed) with memory only 5% used. So this was a CPU + Docker-daemon contention failure, not memory. Going from `c5.xlarge` (8 GB) to `m5.xlarge` (16 GB) earlier today moved the failure mode from OOM to Docker timeout but didn't actually fix anything because vCPU count stayed at 4.

2. **The launch-template AMI (`ami-031963113d1253d34`) is Amazon Linux 2023 ECS-optimized.** `ecs.service` was running and `amazon-ecs-init` was actively introspecting every gitlab-runner cache container ("Container name: /runner-...-cache-..." in its journal). Not the dominant cause but it added Docker-socket calls and CPU on every host. Wrong AMI for this workload.

### Changes made directly in AWS

| Resource                                                      | Change                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live instances (`i-0a628aba44c15db5d`, `i-0dde0f1909c223e06`) | SSM `AWS-RunShellScript`: `sed concurrent 4 → 2`, `systemctl disable --now ecs`, `systemctl mask ecs`, `systemctl restart gitlab-runner`. (`i-0cd7d870de470c422` got terminated by Lambda scale-in mid-command since the queue was empty; replacement comes up on the new LT below.) |
| Launch template `lt-0a20e16ecb8296cc5`                        | New version 13 with user-data: sed line changed from `concurrent = 4` to `concurrent = 2`, plus two new lines `systemctl disable --now ecs` and `systemctl mask ecs` inserted before the CloudWatch agent install. Promoted to default.                                              |

### Capacity / cost impact

- Steady-state ceiling drops from 100 (25 × 4) to **50 parallel jobs** (25 × 2). Still 50× more parallelism than the broken pre-incident baseline.
- Per-instance cost unchanged. Total cost-at-burn unchanged (~$6/hr fully scaled).
- If we ever need >50 parallel jobs, the right next move is to **bump `MaxSize`**, not `concurrent`. Or move to `c5.2xlarge` / `m5.2xlarge` (8 vCPU) and revisit `concurrent`.

### What needs to be backported to `arcanum-infra`

In `constructs/gitlab-runner-template-construct.ts`:

1. Change the `concurrent = 4` patch in user-data to `concurrent = 2`.
2. Add `systemctl disable --now ecs` and `systemctl mask ecs` lines to the user-data so future instances boot without `amazon-ecs-init` running.
3. Consider switching to a non-ECS-optimized Amazon Linux 2023 AMI altogether (cleaner long-term than masking the service). Look up the latest `al2023-ami-2023.*-kernel-*-x86_64` AMI ID for `ap-southeast-2`.

Mark this entry `STATUS: backported` after the next deploy reconciles.

### Tuning / diagnostic note

The Docker daemon's exec deadline in `gitlab-runner` is 9 seconds (hardcoded in `docker.go`). When you see `context deadline exceeded (docker.go:1619:9s)` in `journalctl -u gitlab-runner`, that is your signal that the Docker daemon is overloaded — not that the runner itself is broken. Drop `concurrent`, scale horizontally, or upgrade the host before doing anything else.

---

## 2026-05-05 — Lambda-driven direct scale-out + 1-min polling cadence

**STATUS:** outstanding (not yet backported to `arcanum-infra`)

**Reported as:** "Our flow is bursty, can we scale faster from cold?" The previous flow (Lambda polls every 5 min → publishes metric → alarm transitions over 60s → step-scaling adds at most +5 → repeat) meant a cold queue with 50 jobs took 5 to 8 min before the fleet hit useful capacity, with multiple alarm cycles to climb from 1 to 25 instances.

### Change

1. **Lambda code** (`gitlab-runners-queue-monitor`): the reconciliation function now computes ideal capacity in one shot and calls `SetDesiredCapacity` directly. Formula:

   ```
   ideal = clamp(MinSize, MaxSize, ceil((pendingJobs + runningJobs) / CONCURRENT_PER_INSTANCE))
   ```

   On scale-out, the ASG launches every needed instance in parallel from a single Lambda call. Scale-in logic is unchanged (still only fires when `pending == 0 && running == 0`, drops 10-at-a-time above 10, otherwise 1-at-a-time).

2. **New Lambda env var:** `CONCURRENT_PER_INSTANCE = 2` so the Lambda knows the per-instance job slot count without having to hardcode it.

3. **EventBridge schedule:** `gitlab-runners-queue-monitor` rule changed from `rate(5 minutes)` to `rate(1 minute)`. Lambda invocation cost stays well within free tier (1440 invocations/day).

4. **CloudWatch alarm + step-scaling policy left in place as fallback.** In normal operation the Lambda will scale to ideal capacity before the alarm transitions to ALARM, so the step-scaling policy becomes a no-op. It only fires if the Lambda is broken or has lost permissions, which is a useful safety net for a critical-path service.

### Effect

Worst-case cold-start latency drops from ~5 to 8.5 min to **~2.5 to 3.5 min**, dominated by EC2 boot time rather than orchestration latency. Verified with a manual test invoke: queue at 74 pending + 12 running, Lambda jumped ASG desired from 6 to 25 in a single `SetDesiredCapacity` call.

### Cost impact

Roughly neutral. Faster scale-up means more instances boot per burst (more boot overhead), but faster scale-in (1-min poll vs 5-min poll) means less idle capacity after the queue drains. For a bursty all-day workload the trade is approximately even, possibly 5 to 15% cheaper.

### What needs to be backported to `arcanum-infra`

In whatever construct holds the Lambda + EventBridge config:

1. Replace the Lambda source with the new version (the `reconcileAsg` function plus the `CONCURRENT_PER_INSTANCE` env var read). Source-of-truth is `/tmp/gitlab-runner-monitor-fix/index.js` at the time of fix; not preserved long-term, re-derive when backporting.
2. Add `CONCURRENT_PER_INSTANCE: '2'` to the Lambda's environment variables (alongside the existing three).
3. Change the EventBridge rule schedule from `rate(5 minutes)` to `rate(1 minute)`.
4. Optional: remove the alarm + step-scaling policy entirely once you're confident the Lambda path is solid. They are dead weight in normal operation. Keeping them is fine too; they cost nothing.

Mark this entry `STATUS: backported` after the next deploy reconciles.

### Future enhancement (not done)

Wire a **GitLab project webhook** to the Lambda (Function URL or API Gateway) so a pipeline-start event triggers an immediate reconcile instead of waiting up to 60 sec for the next scheduled poll. The Lambda already distinguishes `trigger=webhook` vs `trigger=schedule` in its log line; the receiving handler would just need to validate a webhook secret. Brings cold-start latency down to roughly EC2 boot time alone (~2.5 min). Skipped for now since the 1-min polling closes most of the gap and a webhook adds a moving part on the GitLab side.

# Scheduled Agents — CloudWatch Logs Insights Queries

These queries are emitted by the Phase 0 telemetry hook in
`lambdas/node/agent-schedule-runner/index.ts` (look for `[SCHEDULE_METRIC]`
log lines). Use them to validate the Level-1 platform-default quotas before
they bite, and to tune Level-2 (per-client) overrides via the CS portal.

All queries target the per-client `/numa/{clientName}-core` log group.

## Total scheduled runs in last 30 days

```
fields @timestamp, @message
| filter @message like /\[SCHEDULE_METRIC\] schedule_run_started/
| stats count() as runs by bin(30d)
```

## Runs per user (last 30 days, top 20)

```
fields @timestamp, @message
| filter @message like /\[SCHEDULE_METRIC\] schedule_run_started/
| parse @message /"userSub":"(?<sub>[^"]+)"/
| stats count() as runs by sub
| sort runs desc
| limit 20
```

## Runs per agent across the tenant (last 30 days, top 20)

```
fields @timestamp, @message
| filter @message like /\[SCHEDULE_METRIC\] schedule_run_started/
| parse @message /"agentId":"(?<agent>[^"]+)"/
| stats count() as runs by agent
| sort runs desc
| limit 20
```

## Schedules running more often than every 30 minutes

```
fields @timestamp, @message
| filter @message like /\[SCHEDULE_METRIC\] schedule_run_started/
| parse @message /"projectedIntervalMinutes":(?<int>[0-9]+)/
| filter int < 30
| parse @message /"scheduleId":"(?<sid>[^"]+)"/
| stats count() as runs, min(int) as intervalMin by sid
| sort runs desc
```

## Daily run volume (for capacity planning)

```
fields @timestamp, @message
| filter @message like /\[SCHEDULE_METRIC\] schedule_run_started/
| stats count() as runs by bin(1d)
| sort @timestamp desc
```

## Notes

- These are point-in-time observations of _actual_ run firings. The quota
  enforcement layer uses _projected_ runs (computed from the cron expression)
  not actual — but the actual numbers are the ground truth for tuning the
  projections.
- For multi-client / cross-tenant analysis, run the same queries against
  each client's core log group and aggregate manually. Phase-2 of any
  follow-up could pipe these to a central account-wide log group.

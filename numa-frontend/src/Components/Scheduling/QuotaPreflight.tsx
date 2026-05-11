/* eslint-disable i18next/no-literal-string -- automations preflight UI; translations deferred to round-2 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Spinner } from 'react-bootstrap';
import { ScheduleService, type QuotaSummary } from '../../Services/ScheduleService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { projectMonthlyRuns } from '../../utils/cronProjection';

type Verdict = 'ok' | 'needs-approval' | 'blocked';

type PreflightResult = {
  verdict: Verdict;
  /** One-line summary safe for any verdict. */
  headline: string;
  /** Optional secondary detail rendered under the headline. */
  detail?: string;
};

/**
 * Live quota check shown in the schedule builder + review steps. Tells the
 * user before they hit Save whether their cadence will:
 *   - go straight through (`ok`)
 *   - be created in pending-approval status (`needs-approval`)
 *   - be hard-rejected at create time (`blocked`)
 *
 * Re-fetches `quotaSummary` once on mount; recomputes the verdict on every
 * cron / triggerType change so the user sees feedback as they tweak the
 * cadence. For event triggers, only the concurrent-active caps are checked
 * (trigger-fire actuals can't be projected client-side).
 */
type Props = {
  triggerType: 'cron' | 'event';
  cronExpression?: string;
  /** Optional — affects the headline copy (e.g. "this agent's cap"). */
  agentTitle?: string;
  /**
   * Per-month run cap on the schedule itself (0/undefined = unlimited).
   * Clamps the cron projection downward — a 5-min cron with maxRuns=20
   * effectively projects to 20 runs/mo, not ~8,640. Also drives the
   * "set max runs to N to fit" suggestion when over user cap.
   */
  maxRuns?: number;
  /**
   * Fires whenever the verdict recomputes. The parent uses it to gate the
   * wizard's Next / Save button — `'blocked'` means "no path forward, do
   * not let the user proceed." `null` while loading or when there's nothing
   * to say.
   */
  onVerdictChange?: (verdict: Verdict | null) => void;
};

export const QuotaPreflight: React.FC<Props> = ({
  triggerType,
  cronExpression,
  agentTitle,
  maxRuns,
  onVerdictChange,
}) => {
  const { numaGet } = useNumaRequest();
  const [summary, setSummary] = useState<QuotaSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ScheduleService.quotaSummary(numaGet);
        if (!cancelled) setSummary(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  const result = useMemo<PreflightResult | null>(() => {
    if (!summary) return null;
    const q = summary.quotas;
    const WARN_PCT = 80;

    // Concurrent caps: only flag when this automation would actually breach
    // the cap. Below that we stay silent — no point warning at 80% concurrent.
    const userActiveAfter = summary.user.activeAutomationCount + 1;
    const companyActiveAfter = summary.company.activeScheduleCount + 1;
    if (companyActiveAfter > q.maxConcurrentActiveSchedulesPerCompany) {
      return {
        verdict: 'blocked',
        headline: `Company concurrent limit reached (${summary.company.activeScheduleCount} / ${q.maxConcurrentActiveSchedulesPerCompany}).`,
        detail: 'Pause or delete an existing automation before creating another.',
      };
    }
    if (userActiveAfter > q.maxConcurrentActiveSchedulesPerUser) {
      return {
        verdict: 'blocked',
        headline: `Your concurrent automation limit reached (${summary.user.activeAutomationCount} / ${q.maxConcurrentActiveSchedulesPerUser}).`,
        detail: 'Admin approval cannot raise this — pause or delete one of your existing automations.',
      };
    }

    // Event triggers: no monthly-runs projection (counted per-fire actually).
    // Stay silent — there's nothing useful to say until concurrent breaches.
    if (triggerType === 'event') return null;

    // Cron triggers: project monthly runs and compare against user + company caps.
    if (!cronExpression) return null;
    // Effective projection is clamped by maxRuns (the schedule auto-pauses
    // for the rest of the month after this many fires). 5-min cron + 20
    // max_runs ⇒ effective projection of 20, not ~8,640.
    const rawCronProjection = projectMonthlyRuns(cronExpression);
    const projected = maxRuns !== undefined && maxRuns > 0 ? Math.min(rawCronProjection, maxRuns) : rawCronProjection;
    const isClamped = projected < rawCronProjection;
    const userRunsAfter = summary.user.runsPerMonth + projected;
    const companyRunsAfter = summary.company.runsPerMonth + projected;
    const userRemaining = Math.max(0, q.maxRunsPerUserPerMonth - summary.user.runsPerMonth);
    const companyRemaining = Math.max(0, q.maxRunsPerCompanyPerMonth - summary.company.runsPerMonth);
    // Binding remaining = whichever cap fills up first. Setting Max-runs to
    // any larger value will still trip the smaller cap.
    const bindingRemaining = Math.min(userRemaining, companyRemaining);
    const userPctAfter = q.maxRunsPerUserPerMonth > 0 ? (userRunsAfter / q.maxRunsPerUserPerMonth) * 100 : 0;
    const companyPctAfter =
      q.maxRunsPerCompanyPerMonth > 0 ? (companyRunsAfter / q.maxRunsPerCompanyPerMonth) * 100 : 0;

    // Suggestion shown on any over-cap branch — tells the user the exact
    // Max-runs value that would let this schedule through.
    const fitTip =
      bindingRemaining > 0
        ? ` Set Max runs / month to ${bindingRemaining.toLocaleString()} or less to fit under the remaining ${bindingRemaining.toLocaleString()} ${bindingRemaining === companyRemaining && companyRemaining < userRemaining ? 'company' : 'personal'} runs this month.`
        : ` Remaining budget is 0 this month — pause an existing schedule to free up room.`;

    // Hard rejection — over company cap, no admin can rescue this.
    if (companyRunsAfter > q.maxRunsPerCompanyPerMonth) {
      return {
        verdict: 'blocked',
        headline: `Adding this would push the company to ${Math.round(companyPctAfter)}% of its monthly cap (${companyRunsAfter.toLocaleString()} / ${q.maxRunsPerCompanyPerMonth.toLocaleString()}).`,
        detail: `Reduce the frequency, or pause / delete other active schedules to free up budget.${fitTip}`,
      };
    }

    // Over user cap — either approval-required or hard reject depending on policy.
    if (userRunsAfter > q.maxRunsPerUserPerMonth) {
      if (q.requireApprovalAboveUserCap) {
        return {
          verdict: 'needs-approval',
          headline: `Adding this would put you at ${Math.round(userPctAfter)}% of your personal monthly cap.`,
          detail: `Within the company allowance — an admin will need to approve before this${
            agentTitle ? ` "${agentTitle}"` : ''
          } automation goes active. Once approved, it counts against the company quota only and won't eat into your personal cap.${fitTip}`,
        };
      }
      return {
        verdict: 'blocked',
        headline: `Adding this would put you at ${Math.round(userPctAfter)}% of your personal cap (${userRunsAfter.toLocaleString()} / ${q.maxRunsPerUserPerMonth.toLocaleString()}).`,
        detail: `Reduce the frequency to stay under your cap.${fitTip}`,
      };
    }

    // Approaching one of the caps — warn but allow.
    if (companyPctAfter >= WARN_PCT) {
      return {
        verdict: 'needs-approval',
        headline: `Heads up — this would push the company to ${Math.round(companyPctAfter)}% of its monthly cap.`,
      };
    }
    if (userPctAfter >= WARN_PCT) {
      return {
        verdict: 'needs-approval',
        headline: `Heads up — this would put you at ${Math.round(userPctAfter)}% of your personal monthly cap.`,
      };
    }

    // Comfortably under caps — only show a confirmation if we clamped a
    // high-frequency cron via maxRuns (otherwise stay quiet).
    if (isClamped) {
      return {
        verdict: 'ok',
        headline: `Capped at ${projected.toLocaleString()} runs/month by your Max-runs setting (the cron alone would project ~${rawCronProjection.toLocaleString()}/mo). Pauses when the cap is hit; resume manually any time.`,
      };
    }

    return null;
  }, [summary, triggerType, cronExpression, agentTitle, maxRuns]);

  // Fire the verdict change up to the parent so the wizard can gate Next
  // when the verdict is `blocked`. Stays in sync with `result` (recomputes
  // on every cron / maxRuns / summary change).
  useEffect(() => {
    onVerdictChange?.(result?.verdict ?? null);
  }, [result, onVerdictChange]);

  if (loading) {
    return (
      <div className="text-muted small d-flex align-items-center gap-2">
        <Spinner animation="border" size="sm" /> Checking quotas…
      </div>
    );
  }
  // Surface the failure rather than silently hiding. The wizard's Save button
  // isn't gated by `result === null` so the user could otherwise submit an
  // over-quota schedule and only find out via the lambda's 400. A neutral
  // alert is better than no signal.
  if (error) {
    return (
      <Alert variant="secondary" className="mb-0 small py-2">
        <i className="bi bi-info-circle me-1" /> Quota check unavailable — your save will still be validated
        server-side.
      </Alert>
    );
  }
  if (!summary || !result) return null;

  const variant = result.verdict === 'ok' ? 'success' : result.verdict === 'needs-approval' ? 'warning' : 'danger';
  const icon =
    result.verdict === 'ok'
      ? 'bi-check-circle-fill'
      : result.verdict === 'needs-approval'
        ? 'bi-exclamation-triangle-fill'
        : 'bi-x-circle-fill';

  return (
    <Alert variant={variant} className="mb-0 d-flex align-items-start gap-2 small py-2">
      <i className={`bi ${icon} mt-1`} />
      <div>
        <div className="fw-semibold">{result.headline}</div>
        {result.detail && <div className="mt-1">{result.detail}</div>}
      </div>
    </Alert>
  );
};

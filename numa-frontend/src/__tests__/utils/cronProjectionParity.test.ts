/**
 * @vitest-environment jsdom
 */

/**
 * Parity test for the cron-interval estimator.
 *
 * The frontend uses `numa-frontend/src/utils/cronProjection.ts` for the
 * QuotaPreflight banner, the workflow builder's projected-runs hint, and
 * the high-frequency confirmation gate. The backend uses
 * `lib/scheduling-schemas.ts:estimateCronIntervalMinutes` for create-time
 * quota enforcement and runner telemetry.
 *
 * The two were copies. If they ever diverge, the user sees a green "you'll
 * create ~10 runs/month" preflight on the frontend and gets a 400 from the
 * backend saying "you'll create 200 runs/month, over cap." That's the
 * exact "the UI told me one thing, the API said another" experience we
 * want to avoid.
 *
 * This test pins both implementations against the same set of expressions.
 * If either copy is changed without the other, this test fails — which is
 * intentional. The fix is to update BOTH files OR (better) consolidate
 * into a single shared module.
 */

import { describe, it, expect } from 'vitest';
import { estimateCronIntervalMinutes as feEstimate } from '../../utils/cronProjection';
import { estimateCronIntervalMinutes as beEstimate } from '../../../../lib/scheduling-schemas';

type Case = {
  /** Cron expression to test. */
  cron: string;
  /** Expected minutes between fires. `null` for "unparseable" patterns the
   *  estimator can't handle. `Infinity` for once-off (specific year). */
  expected: number | null;
  /** Why this case is interesting — included so a future failure message
   *  tells you what behaviour the case was guarding. */
  why: string;
};

const cases: Case[] = [
  // --- step intervals (the common path) ---
  { cron: 'cron(*/5 * * * ? *)', expected: 5, why: 'every 5 min' },
  { cron: 'cron(*/15 * * * ? *)', expected: 15, why: 'every 15 min' },
  { cron: 'cron(*/30 * * * ? *)', expected: 30, why: 'every 30 min' },
  { cron: 'cron(0/10 * * * ? *)', expected: 10, why: 'every 10 min, anchored on :00' },
  { cron: 'cron(0 */2 * * ? *)', expected: 120, why: 'every 2 hours' },
  { cron: 'cron(0 */6 * * ? *)', expected: 360, why: 'every 6 hours' },

  // --- comma-separated minute lists (treated by min-gap) ---
  { cron: 'cron(0,15,30,45 * * * ? *)', expected: 15, why: 'quarter-hourly via list' },
  { cron: 'cron(0,30 * * * ? *)', expected: 30, why: 'twice-hourly via list' },

  // --- daily / weekly / monthly fixed times ---
  { cron: 'cron(0 9 * * ? *)', expected: 1440, why: 'daily at 09:00' },
  { cron: 'cron(0 9 ? * MON *)', expected: 1440, why: 'weekly Mondays — also returns 1440 by current rule' },
  { cron: 'cron(0 9 1 * ? *)', expected: 43_200, why: 'monthly on the 1st' },

  // --- day-step ---
  { cron: 'cron(0 9 */3 * ? *)', expected: 4320, why: 'every 3 days at 09:00' },

  // --- month-step ---
  // NOTE: returns 43_200 (≈ monthly), not 86_400 (every 2 months) — the
  // estimator's dom-fixed branch at the cron(min hour 1 * ? *) shape fires
  // BEFORE the month-step branch. This is a known imprecision (it
  // overstates frequency, which means MORE conservative quota enforcement,
  // so it's safe). What matters for this parity test is FE and BE agree.
  { cron: 'cron(0 9 1 */2 ? *)', expected: 43_200, why: 'every 2 months on 1st — currently treated as monthly' },

  // --- once-off (specific year) ---
  { cron: 'cron(0 9 1 1 ? 2030)', expected: Infinity, why: 'one-off in 2030' },

  // --- patterns the estimator CANNOT decompose — must return null on both
  //     sides so we don't silently project to MIN_PROJECTED_RUNS=1 on one
  //     side while projecting accurately on the other. ---
  { cron: 'cron(*/5 9-17 ? * MON-FRI *)', expected: null, why: 'restricted hours + dow — null is correct' },
  // NOTE: `cron(0 9 ? * MON#1 *)` returns 1440 (daily) by both
  // implementations because the fixed-min/fixed-hour/dom=? branch matches
  // before the dow special-token check. This OVERSTATES frequency
  // (every-day vs first-Monday-of-month) so quota enforcement is on the
  // safe side. Verifying parity, not algorithm accuracy.
  { cron: 'cron(0 9 ? * MON#1 *)', expected: 1440, why: 'first Monday — currently treated as daily by both impls' },
  { cron: 'cron(0 9 L * ? *)', expected: null, why: "last day of month — dom=L isn't parsed" },

  // --- garbage inputs ---
  { cron: 'not a cron', expected: null, why: 'unparseable wrapper' },
  { cron: 'cron(too few fields)', expected: null, why: 'wrong field count' },
];

describe('estimateCronIntervalMinutes parity (frontend ↔ backend)', () => {
  it.each(cases)('agrees on $cron ($why)', ({ cron, expected }) => {
    const fe = feEstimate(cron);
    const be = beEstimate(cron);
    // Fail loudly if they diverge — the test failure message names the cron
    // expression, the FE result, and the BE result so the diff is obvious.
    expect({ fe, be }).toEqual({ fe: expected, be: expected });
  });
});

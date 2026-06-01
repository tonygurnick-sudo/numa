import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Card, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { AdminCreditsService, type CreditLedger } from '../../Services/AdminCreditsService';
import { UsersService, type WorkspaceUser } from '../../Services/UsersService';

/**
 * CreditsAdminPanel — the admin "value receipt": credits remaining + this month's delivered work
 * (title · who · duration · complexity · credits). Read-only — top-up + algorithm knobs live on the
 * Credit Admin tab. Deliberately shows NO cost or chat content (privacy decision).
 *
 * Body only — no page chrome; Settings supplies its own header. Lives under Settings → Admin → Credits.
 */

const TIER_BADGE: Record<string, string> = {
  low: 'secondary',
  medium: 'info',
  high: 'primary',
  very_high: 'warning',
  unclassified: 'light',
};

export const CreditsAdminPanel: React.FC = () => {
  const { t } = useTranslation('settings');
  const { numaGet } = useNumaRequest();

  const [balance, setBalance] = useState<number>(0);
  const [ledger, setLedger] = useState<CreditLedger | null>(null);
  const [userMap, setUserMap] = useState<Record<string, string>>({}); // cognito sub -> email
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bal, led, users] = await Promise.all([
        AdminCreditsService.getBalance(numaGet),
        AdminCreditsService.getLedger(undefined, numaGet),
        UsersService.list(numaGet).catch(() => [] as WorkspaceUser[]), // best-effort; for sub->email
      ]);
      setBalance(bal.balance);
      setLedger(led);
      const map: Record<string, string> = {};
      for (const u of users) if (u.sub) map[u.sub] = u.email;
      setUserMap(map);
    } catch (err) {
      console.error('[Credits] load failed', err);
      setError(t('credits.loadError', { defaultValue: 'Could not load credit data.' }));
    } finally {
      setLoading(false);
    }
  }, [numaGet, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="d-flex align-items-center gap-2 py-5 text-muted">
        <Spinner animation="border" size="sm" />
        <span>{t('credits.loading', { defaultValue: 'Loading credits…' })}</span>
      </div>
    );
  }

  // Remaining is derived (allocation − consumed this month), not a decremented counter, so
  // re-running backfill never double-burns. Live real-time burn is handled separately (#5).
  const usedThisMonth = ledger?.totalCredits ?? 0;
  const remaining = balance - usedThisMonth;

  // Resolve a conversation's owner (cognito sub) to an email; fall back to a short sub.
  const whoLabel = (sub: string | null): string =>
    sub ? (userMap[sub] ?? `${sub.slice(0, 8)}…`) : t('credits.unknownUser', { defaultValue: '—' });

  // Wall-clock span first→last message (a chat resumed days later shows "days"). Not a price driver.
  const fmtDuration = (first: string | null, last: string | null): string => {
    if (!first || !last) return '—';
    const ms = new Date(last).getTime() - new Date(first).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const min = ms / 60000;
    if (min < 1) return t('credits.durInstant', { defaultValue: '<1 min' });
    if (min < 60) return t('credits.durMin', { defaultValue: '{{n}} min', n: Math.round(min) });
    const hrs = min / 60;
    if (hrs < 24)
      return t('credits.durHrs', { defaultValue: '{{n}} hr', n: hrs < 10 ? hrs.toFixed(1) : String(Math.round(hrs)) });
    const days = hrs / 24;
    return t('credits.durDays', {
      defaultValue: '{{n}} days',
      n: days < 10 ? days.toFixed(1) : String(Math.round(days)),
    });
  };

  return (
    <>
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* ── Credits remaining (read-only; top-up lives on the Credit Admin tab) ── */}
      <Card className="mb-3">
        <Card.Header className="fw-semibold">
          <i className="bi bi-coin me-2" aria-hidden="true" />
          {t('credits.balanceTitle', { defaultValue: 'Credits remaining' })}
        </Card.Header>
        <Card.Body>
          <div className="display-6 mb-1">{remaining.toLocaleString()}</div>
          <div className="small text-muted">
            {t('credits.remainingSub', {
              defaultValue: '{{allocated}} allocated · {{used}} used this month',
              allocated: balance.toLocaleString(),
              used: usedThisMonth.toLocaleString(),
            })}
          </div>
        </Card.Body>
      </Card>

      {/* ── This month's delivered work (value receipt) ─────────────────── */}
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-semibold">
            <i className="bi bi-receipt me-2" aria-hidden="true" />
            {t('credits.ledgerTitle', { defaultValue: 'This month — work delivered' })}
          </span>
          {ledger && (
            <Badge bg="light" text="dark" className="border">
              {t('credits.totalThisMonth', { defaultValue: '{{count}} credits', count: ledger.totalCredits })}
            </Badge>
          )}
        </Card.Header>
        <Card.Body className="p-0">
          {!ledger || ledger.items.length === 0 ? (
            <div className="text-muted text-center py-4">
              {t('credits.empty', { defaultValue: 'No activity recorded this month yet.' })}
            </div>
          ) : (
            <Table size="sm" hover responsive className="mb-0 align-middle">
              <thead>
                <tr>
                  <th>{t('credits.colTitle', { defaultValue: 'What was done' })}</th>
                  <th>{t('credits.colBy', { defaultValue: 'By' })}</th>
                  <th>{t('credits.colDuration', { defaultValue: 'Duration' })}</th>
                  <th>{t('credits.colTier', { defaultValue: 'Complexity' })}</th>
                  <th className="text-end">{t('credits.colCredits', { defaultValue: 'Credits' })}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.items.map((row) => (
                  <tr key={row.conversationId}>
                    <td>
                      <div>{row.title}</div>
                      <div className="small text-muted">
                        {t('credits.rowMeta', {
                          defaultValue: '{{label}} · {{count}} msgs',
                          label: row.category ?? row.source,
                          count: row.msgCount,
                        })}
                      </div>
                    </td>
                    <td className="small">{whoLabel(row.userSub)}</td>
                    <td className="small text-muted">{fmtDuration(row.firstTs, row.lastTs)}</td>
                    <td>
                      <Badge
                        bg={TIER_BADGE[row.dominantTier] ?? 'light'}
                        text={TIER_BADGE[row.dominantTier] === 'light' ? 'dark' : undefined}
                      >
                        {row.dominantTier}
                      </Badge>
                    </td>
                    <td className="text-end font-monospace">{Number(row.creditsCharged).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </>
  );
};

export default CreditsAdminPanel;

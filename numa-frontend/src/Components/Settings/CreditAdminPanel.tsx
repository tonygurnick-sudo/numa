import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, InputGroup, Row, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import {
  AdminCreditsService,
  type CreditConfig,
  type CreditConfigEnvelope,
  type CreditLedgerFull,
  type CreditMonthly,
} from '../../Services/AdminCreditsService';

const TIER_BADGE: Record<string, string> = {
  low: 'secondary',
  medium: 'info',
  high: 'primary',
  very_high: 'warning',
  unclassified: 'light',
};

/**
 * CreditAdminPanel — Settings → Admin → Credit Admin. Edit the credit ALGORITHM knobs (credit value,
 * margin, trivial-cost cap, value tiers) + manual top-up + reset to defaults. The AWS token rates and
 * the 200K long-context threshold are fixed billing facts, not editable. Changes are FORWARD-ONLY:
 * already-charged conversations keep their values (the ledger snapshots at write time).
 */

const TIERS = ['low', 'medium', 'high', 'very_high'] as const;
const CONTEXTS = ['chat', 'agent'] as const;

export const CreditAdminPanel: React.FC = () => {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const { numaGet, numaPost } = useNumaRequest();
  const isAdmin = useMemo(
    () => ((user?.decoded_tokens?.idToken?.['cognito:groups'] as string[] | undefined) ?? []).includes('admin'),
    [user]
  );

  const [env, setEnv] = useState<CreditConfigEnvelope | null>(null);
  const [draft, setDraft] = useState<CreditConfig | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerFull | null>(null);
  const [balance, setBalance] = useState(0);
  const [monthly, setMonthly] = useState<CreditMonthly | null>(null);
  const [annualTotal, setAnnualTotal] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [topup, setTopup] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bal, led] = await Promise.all([
        AdminCreditsService.getBalance(numaGet),
        AdminCreditsService.getLedgerFull(undefined, numaGet),
      ]);
      setBalance(bal.balance);
      setLedger(led);
      setMonthly(bal.monthly ?? null);
      if (bal.config) {
        setEnv(bal.config);
        setDraft(JSON.parse(JSON.stringify(bal.config.current)) as CreditConfig);
        const sum = (bal.config.current.monthlyAllocations ?? []).reduce((s, n) => s + Number(n || 0), 0);
        setAnnualTotal(sum > 0 ? String(sum) : '');
      }
    } catch {
      setError(t('creditAdmin.loadError', { defaultValue: 'Could not load credit settings.' }));
    } finally {
      setLoading(false);
    }
  }, [numaGet, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const setNum = (key: 'creditUsd' | 'margin' | 'trivialConsumptionUsd', v: string) =>
    setDraft((d) => (d ? { ...d, [key]: v === '' ? 0 : Number(v) } : d));
  const setTier = (ctx: string, tier: string, v: string) =>
    setDraft((d) =>
      d
        ? { ...d, valueTiers: { ...d.valueTiers, [ctx]: { ...d.valueTiers[ctx], [tier]: v === '' ? 0 : Number(v) } } }
        : d
    );
  const setMargin = (tier: string, v: string) =>
    setDraft((d) => (d ? { ...d, marginsByTier: { ...d.marginsByTier, [tier]: v === '' ? 0 : Number(v) } } : d));
  const setAlloc = (i: number, v: string) =>
    setDraft((d) => {
      if (!d) return d;
      const arr = [...(d.monthlyAllocations ?? Array(12).fill(0))];
      arr[i] = v === '' ? 0 : Math.max(0, Math.round(Number(v)));
      return { ...d, monthlyAllocations: arr };
    });
  // Split an annual total evenly across 12 months; remainder lands on the earliest months so the
  // 12 sum exactly to the total.
  const splitEvenly = () => {
    const total = Math.max(0, Math.round(Number(annualTotal) || 0));
    const base = Math.floor(total / 12);
    const rem = total - base * 12;
    const arr = Array.from({ length: 12 }, (_, i) => base + (i < rem ? 1 : 0));
    setDraft((d) => (d ? { ...d, monthlyAllocations: arr } : d));
  };

  const save = useCallback(async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await AdminCreditsService.saveConfig(draft, numaPost);
      if (res) {
        setEnv(res);
        setDraft(JSON.parse(JSON.stringify(res.current)) as CreditConfig);
        setOk(t('creditAdmin.saved', { defaultValue: 'Saved — applies to future conversations.' }));
      }
    } catch {
      setError(t('creditAdmin.saveError', { defaultValue: 'Save failed: all values must be positive (margin ≥ 1).' }));
    } finally {
      setBusy(false);
    }
  }, [draft, numaPost, t]);

  const reset = useCallback(async () => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await AdminCreditsService.resetConfig(numaPost);
      if (res) {
        setEnv(res);
        setDraft(JSON.parse(JSON.stringify(res.current)) as CreditConfig);
        setOk(t('creditAdmin.resetDone', { defaultValue: 'Reset to sensible defaults.' }));
      }
    } catch {
      setError(t('creditAdmin.resetError', { defaultValue: 'Reset failed.' }));
    } finally {
      setBusy(false);
    }
  }, [numaPost, t]);

  const doTopup = useCallback(async () => {
    const n = Number(topup);
    if (!Number.isFinite(n) || n <= 0) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const r = await AdminCreditsService.topUp(n, numaPost);
      setBalance(r.balance);
      setTopup('');
      setOk(t('creditAdmin.toppedUp', { defaultValue: 'Credits added.' }));
    } catch {
      setError(t('creditAdmin.topUpError', { defaultValue: 'Top-up failed.' }));
    } finally {
      setBusy(false);
    }
  }, [topup, numaPost, t]);

  if (loading) {
    return (
      <div className="d-flex align-items-center gap-2 py-5 text-muted">
        <Spinner animation="border" size="sm" />
        <span>{t('creditAdmin.loading', { defaultValue: 'Loading credit settings…' })}</span>
      </div>
    );
  }
  if (!draft || !env) {
    return (
      <Alert variant="danger">
        {error ?? t('creditAdmin.unavailable', { defaultValue: 'Credit settings unavailable.' })}
      </Alert>
    );
  }
  if (!isAdmin) {
    return (
      <Alert variant="secondary">
        {t('creditAdmin.adminOnly', { defaultValue: 'Admin role required to adjust the credit algorithm.' })}
      </Alert>
    );
  }

  const tierLabel = (tier: string): string => t(`creditAdmin.tier.${tier}`, { defaultValue: tier });
  const ctxLabel = (ctx: string): string =>
    ctx === 'chat'
      ? t('creditAdmin.ctxChat', { defaultValue: 'Chat (interactive)' })
      : t('creditAdmin.ctxAgent', { defaultValue: 'Agent (one fire)' });
  const fmtTokens = (n: number): string =>
    n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);
  const fmtDur = (first: string | null, last: string | null): string => {
    if (!first || !last) return '—';
    const ms = new Date(last).getTime() - new Date(first).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const m = ms / 60000;
    return m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`;
  };
  // Localised short month name (no hardcoded strings — sourced from Intl).
  const monthLabel = (i: number): string => new Date(2000, i, 1).toLocaleString(undefined, { month: 'short' });
  const allocSum = (draft.monthlyAllocations ?? []).reduce((s, n) => s + Number(n || 0), 0);

  return (
    <>
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {ok && (
        <Alert variant="success" dismissible onClose={() => setOk(null)}>
          {ok}
        </Alert>
      )}

      {/* ── Algorithm knobs ─────────────────────────────────────────────── */}
      <Card className="mb-3">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-semibold">
            <i className="bi bi-sliders me-2" aria-hidden="true" />
            {t('creditAdmin.knobsTitle', { defaultValue: 'Pricing algorithm' })}
          </span>
          <Badge bg={env.isCustom ? 'warning' : 'light'} text={env.isCustom ? undefined : 'dark'} className="border">
            {env.isCustom
              ? t('creditAdmin.custom', { defaultValue: 'Custom' })
              : t('creditAdmin.defaults', { defaultValue: 'Defaults' })}
          </Badge>
        </Card.Header>
        <Card.Body>
          <p className="small text-muted">
            {t('creditAdmin.forwardOnly', {
              defaultValue:
                'Charge = max(value tier, cost-recovery floor). Changes apply to FUTURE conversations only — already-charged work keeps its credits.',
            })}
          </p>
          <Row className="g-3 mb-2">
            <Col md={4}>
              <Form.Label className="small fw-semibold">
                {t('creditAdmin.creditUsd', { defaultValue: '1 credit (USD)' })}
              </Form.Label>
              <InputGroup>
                <InputGroup.Text>$</InputGroup.Text>
                <Form.Control
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.creditUsd}
                  onChange={(e) => setNum('creditUsd', e.target.value)}
                />
              </InputGroup>
              <Form.Text muted>
                {t('creditAdmin.creditUsdHint', { defaultValue: 'USD value of one credit.' })}
              </Form.Text>
            </Col>
            <Col md={4}>
              <Form.Label className="small fw-semibold">
                {t('creditAdmin.trivial', { defaultValue: 'Trivial-cost cap (USD)' })}
              </Form.Label>
              <InputGroup>
                <InputGroup.Text>$</InputGroup.Text>
                <Form.Control
                  type="number"
                  min={0}
                  step="0.005"
                  value={draft.trivialConsumptionUsd}
                  onChange={(e) => setNum('trivialConsumptionUsd', e.target.value)}
                />
              </InputGroup>
              <Form.Text muted>
                {t('creditAdmin.trivialHint', { defaultValue: 'Below this cost, value tier is capped at "low".' })}
              </Form.Text>
            </Col>
          </Row>

          <Form.Label className="small fw-semibold mt-2">
            {t('creditAdmin.valueTiers', { defaultValue: 'Value-tier credits' })}
          </Form.Label>
          <Table size="sm" bordered className="align-middle mb-1" style={{ maxWidth: 560 }}>
            <thead>
              <tr>
                <th />
                {TIERS.map((tier) => (
                  <th key={tier} className="text-center small">
                    {tierLabel(tier)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONTEXTS.map((ctx) => (
                <tr key={ctx}>
                  <td className="small fw-semibold">{ctxLabel(ctx)}</td>
                  {TIERS.map((tier) => (
                    <td key={tier}>
                      <Form.Control
                        type="number"
                        min={0}
                        size="sm"
                        className="text-center"
                        value={draft.valueTiers[ctx]?.[tier] ?? 0}
                        onChange={(e) => setTier(ctx, tier, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>

          <Form.Label className="small fw-semibold mt-3">
            {t('creditAdmin.marginsByTier', { defaultValue: 'Cost-recovery margin (×) per tier' })}
          </Form.Label>
          <Table size="sm" bordered className="align-middle mb-1" style={{ maxWidth: 560 }}>
            <thead>
              <tr>
                <th />
                {TIERS.map((tier) => (
                  <th key={tier} className="text-center small">
                    {tierLabel(tier)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="small fw-semibold">{t('creditAdmin.marginRow', { defaultValue: 'Margin ×' })}</td>
                {TIERS.map((tier) => (
                  <td key={tier}>
                    <Form.Control
                      type="number"
                      min={1}
                      step="0.5"
                      size="sm"
                      className="text-center"
                      value={draft.marginsByTier?.[tier] ?? 2}
                      onChange={(e) => setMargin(tier, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </Table>
          <Form.Text muted className="d-block mb-1">
            {t('creditAdmin.marginsHint', {
              defaultValue:
                'The floor recovers ≥ this × measured cost for that tier. Raise high / very_high so token-heavy premium work keeps a margin instead of collapsing to the flat floor.',
            })}
          </Form.Text>

          <div className="d-flex gap-2 mt-3">
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {busy ? <Spinner size="sm" animation="border" className="me-1" /> : null}
              {t('creditAdmin.save', { defaultValue: 'Save' })}
            </Button>
            <Button variant="outline-secondary" disabled={busy || !env.isCustom} onClick={() => void reset()}>
              {t('creditAdmin.reset', { defaultValue: 'Reset to defaults' })}
            </Button>
          </div>

          <Alert variant="light" className="border small mt-3 mb-0">
            <i className="bi bi-info-circle me-1" aria-hidden="true" />
            {t('creditAdmin.fixedNote', {
              defaultValue:
                'Fixed (not editable): AWS token rates and the 200,000-token long-context threshold — these are billing facts, not policy knobs.',
            })}
          </Alert>
        </Card.Body>
      </Card>

      {/* ── Monthly credit allocation (expiry schedule) ─────────────────── */}
      <Card className="mb-3">
        <Card.Header className="fw-semibold">
          <i className="bi bi-calendar3 me-2" aria-hidden="true" />
          {t('creditAdmin.allocTitle', { defaultValue: 'Monthly credit allocation (expires monthly)' })}
        </Card.Header>
        <Card.Body>
          <p className="small text-muted">
            {t('creditAdmin.allocHelp', {
              defaultValue:
                'Credits granted each calendar month. Unused credits do NOT roll over — they expire at month end. Set an annual total to split evenly across 12 months, then fine-tune any month.',
            })}
          </p>
          <Row className="g-2 align-items-end mb-3">
            <Col xs="auto">
              <Form.Label className="small fw-semibold">
                {t('creditAdmin.annualTotal', { defaultValue: 'Annual total (credits)' })}
              </Form.Label>
              <Form.Control
                type="number"
                min={0}
                style={{ maxWidth: 200 }}
                value={annualTotal}
                onChange={(e) => setAnnualTotal(e.target.value)}
              />
            </Col>
            <Col xs="auto">
              <Button variant="outline-secondary" onClick={splitEvenly}>
                {t('creditAdmin.splitEvenly', { defaultValue: 'Split evenly → 12 months' })}
              </Button>
            </Col>
          </Row>
          <Row className="g-2">
            {draft.monthlyAllocations.map((v, i) => (
              <Col xs={6} sm={4} md={3} lg={2} key={i}>
                <Form.Label className="small fw-semibold mb-0">{monthLabel(i)}</Form.Label>
                <Form.Control type="number" min={0} size="sm" value={v} onChange={(e) => setAlloc(i, e.target.value)} />
              </Col>
            ))}
          </Row>
          <div className="d-flex justify-content-between mt-2 small">
            <span className="text-muted">{t('creditAdmin.allocSum', { defaultValue: 'Sum of 12 months' })}</span>
            <span className="fw-semibold font-monospace">{allocSum.toLocaleString()}</span>
          </div>
          {monthly && monthly.allocation > 0 && (
            <Alert variant={monthly.remaining < 0 ? 'danger' : 'light'} className="border small mt-3 mb-0">
              <i className="bi bi-info-circle me-1" aria-hidden="true" />
              {t('creditAdmin.thisMonth', {
                defaultValue:
                  '{{month}}: {{consumed}} / {{allocation}} credits used — {{remaining}} remaining (unused expires at month end).',
                month: monthly.month,
                consumed: monthly.consumed.toLocaleString(),
                allocation: monthly.allocation.toLocaleString(),
                remaining: monthly.remaining.toLocaleString(),
              })}
            </Alert>
          )}
          <div className="d-flex gap-2 mt-3">
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {busy ? <Spinner size="sm" animation="border" className="me-1" /> : null}
              {t('creditAdmin.saveAlloc', { defaultValue: 'Save allocation' })}
            </Button>
          </div>
        </Card.Body>
      </Card>

      {/* ── Per-chat cost & token breakdown (admin-only) ────────────────── */}
      <Card className="mb-3">
        <Card.Header className="fw-semibold">
          <i className="bi bi-table me-2" aria-hidden="true" />
          {t('creditAdmin.breakdownTitle', { defaultValue: 'This month — cost & token breakdown' })}
        </Card.Header>
        <Card.Body className="p-0">
          {!ledger || ledger.items.length === 0 ? (
            <div className="text-muted text-center py-4">
              {t('creditAdmin.breakdownEmpty', { defaultValue: 'No activity this month yet.' })}
            </div>
          ) : (
            <Table size="sm" hover responsive className="mb-0 align-middle">
              <thead>
                <tr>
                  <th>{t('creditAdmin.bChat', { defaultValue: 'Chat' })}</th>
                  <th>{t('creditAdmin.bTier', { defaultValue: 'Complexity' })}</th>
                  <th className="text-end">{t('creditAdmin.bCredits', { defaultValue: 'Credits' })}</th>
                  <th className="text-end">{t('creditAdmin.bMsgs', { defaultValue: 'Msgs' })}</th>
                  <th className="text-end">{t('creditAdmin.bSpan', { defaultValue: 'Span' })}</th>
                  <th className="text-end">{t('creditAdmin.bTokens', { defaultValue: 'Tokens' })}</th>
                  <th className="text-end">{t('creditAdmin.bCost', { defaultValue: 'Token cost' })}</th>
                  <th className="text-end">{t('creditAdmin.bMargin', { defaultValue: 'Margin' })}</th>
                </tr>
              </thead>
              <tbody>
                {[...ledger.items]
                  .sort((a, b) => Number(b.creditsCharged) - Number(a.creditsCharged))
                  .map((r) => (
                    <tr key={r.conversationId}>
                      <td>
                        <div>{r.title}</div>
                        <div className="small text-muted">{r.category ?? r.source}</div>
                      </td>
                      <td>
                        <Badge
                          bg={TIER_BADGE[r.dominantTier] ?? 'light'}
                          text={TIER_BADGE[r.dominantTier] === 'light' ? 'dark' : undefined}
                        >
                          {r.dominantTier}
                        </Badge>
                      </td>
                      <td className="text-end font-monospace">{Number(r.creditsCharged).toLocaleString()}</td>
                      <td className="text-end">{r.msgCount}</td>
                      <td className="text-end small">{fmtDur(r.firstTs, r.lastTs)}</td>
                      <td className="text-end small">{fmtTokens(Number(r.totalTokens))}</td>
                      <td className="text-end small">
                        ${Number(r.consumptionCostUsd).toFixed(Number(r.consumptionCostUsd) < 1 ? 4 : 2)}
                      </td>
                      <td className="text-end small">
                        {r.marginVsConsumption ? `${Number(r.marginVsConsumption).toFixed(1)}×` : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {/* ── Manual top-up ───────────────────────────────────────────────── */}
      <Card>
        <Card.Header className="fw-semibold">
          <i className="bi bi-coin me-2" aria-hidden="true" />
          {t('creditAdmin.topUpTitle', { defaultValue: 'Add credits' })}
        </Card.Header>
        <Card.Body>
          <div className="small text-muted mb-2">
            {t('creditAdmin.balanceNow', {
              defaultValue: 'Current allocation: {{n}} credits',
              n: balance.toLocaleString(),
            })}
          </div>
          <InputGroup style={{ maxWidth: 360 }}>
            <Form.Control
              type="number"
              min={1}
              placeholder={t('credits.topUpPlaceholder', { defaultValue: 'Credits to add' })}
              value={topup}
              onChange={(e) => setTopup(e.target.value)}
              disabled={busy}
            />
            <Button variant="primary" disabled={busy || !topup} onClick={() => void doTopup()}>
              {t('credits.topUp', { defaultValue: 'Top up' })}
            </Button>
          </InputGroup>
        </Card.Body>
      </Card>
    </>
  );
};

export default CreditAdminPanel;

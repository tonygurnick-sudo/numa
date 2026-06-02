import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, InputGroup, Row, Spinner } from 'react-bootstrap';
import { Coin } from 'react-bootstrap-icons';
import { ClientSelectGroup } from '@/components/ClientSelectGroup';
import { clientService } from '@/services/clientService';
import { creditsService, DEFAULT_CREDIT_CONFIG, type CreditStanding } from '@/services/creditsService';
import type { Client, CreditConfig } from '@/types';

/**
 * Numa Credits — central authoring for the Numa Credit System (SPK-015).
 *
 * Pick a client, tune the pricing config (1 credit price, defence margins per complexity, value-tier
 * credits, AgentCore uplift, monthly allocation) and top up credits. On save the config is written to
 * the central numa-client-config AND pushed into the client account's credit-ledger (assume-role); the
 * client's in-app view is read-only. Per-client metering runs regardless of this page.
 */

const TIERS = ['low', 'medium', 'high', 'very_high'] as const;
const CONTEXTS = ['chat', 'agent'] as const;
const TIER_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', very_high: 'Very high' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type FullConfig = Required<CreditConfig>;

function withDefaults(c?: CreditConfig): FullConfig {
  return {
    ...DEFAULT_CREDIT_CONFIG,
    ...c,
    valueTiers: {
      chat: { ...DEFAULT_CREDIT_CONFIG.valueTiers.chat, ...c?.valueTiers?.chat },
      agent: { ...DEFAULT_CREDIT_CONFIG.valueTiers.agent, ...c?.valueTiers?.agent },
    },
    marginsByTier: { ...DEFAULT_CREDIT_CONFIG.marginsByTier, ...c?.marginsByTier },
    monthlyAllocations:
      c?.monthlyAllocations && c.monthlyAllocations.length === 12
        ? c.monthlyAllocations
        : DEFAULT_CREDIT_CONFIG.monthlyAllocations,
  };
}

export default function NumaCredits() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState('');
  const [config, setConfig] = useState<FullConfig>(withDefaults());
  const [topUp, setTopUp] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [standing, setStanding] = useState<CreditStanding | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setClients(await clientService.getAllClients());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load clients');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const client = useMemo(() => clients.find((c) => c.name === selected), [clients, selected]);

  useEffect(() => {
    setNotice(null);
    setError(null);
    setConfig(withDefaults(client?.config.creditConfig));
  }, [client]);

  const refreshStanding = useCallback(async () => {
    if (!client) {
      setStanding(null);
      return;
    }
    try {
      setStanding(await creditsService.getStanding(client.name, client.config.clientAccountId, client.config.region));
    } catch {
      setStanding(null); // standing is informational — never block authoring on a read failure
    }
  }, [client]);

  useEffect(() => {
    void refreshStanding();
  }, [refreshStanding]);

  const isCustom = !!client?.config.creditConfig;

  const num = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const setGlobal = (k: keyof FullConfig, v: number) => setConfig((c) => ({ ...c, [k]: v }));
  const setTier = (ctx: string, tier: string, v: number) =>
    setConfig((c) => ({ ...c, valueTiers: { ...c.valueTiers, [ctx]: { ...c.valueTiers[ctx], [tier]: v } } }));
  const setMargin = (tier: string, v: number) =>
    setConfig((c) => ({ ...c, marginsByTier: { ...c.marginsByTier, [tier]: v } }));
  const setAllMonths = (v: number) =>
    setConfig((c) => ({ ...c, monthlyAllocations: Array.from({ length: 12 }, () => v) }));
  const setMonth = (i: number, v: number) =>
    setConfig((c) => {
      const next = Array.from({ length: 12 }, (_, j) => c.monthlyAllocations[j] ?? 0);
      next[i] = v;
      return { ...c, monthlyAllocations: next };
    });

  const handleSave = async () => {
    if (!client) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await creditsService.saveConfig(client.name, client.config.clientAccountId, client.config.region, config);
      setNotice(`Saved pricing config for ${client.name} (central + pushed to the client account).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleTopUp = async () => {
    if (!client) return;
    const credits = num(topUp);
    if (credits <= 0) {
      setError('Top-up must be a positive number of credits.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const bal = await creditsService.topUp(client.name, client.config.clientAccountId, client.config.region, credits);
      setNotice(`Added ${credits.toLocaleString()} credits to ${client.name}. New balance: ${bal.toLocaleString()}.`);
      setTopUp('');
      void refreshStanding();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Top-up failed');
    } finally {
      setSaving(false);
    }
  };

  // ── live-standing derivation (current calendar year) ──
  const year = new Date().getFullYear();
  const curIdx = new Date().getMonth(); // 0=Jan
  const monthKey = (i: number): string => `${year}-${String(i + 1).padStart(2, '0')}`;
  const usedCredits = (i: number): number => {
    const m = standing?.months[monthKey(i)];
    if (!m || !config.creditUsd) return 0;
    return Math.round(m.revenueUsd / config.creditUsd);
  };
  const curAllocated = config.monthlyAllocations[curIdx] ?? 0;
  const curUsed = usedCredits(curIdx);

  return (
    <div>
      <h2 className="mb-1 d-flex align-items-center">
        <Coin className="me-2" /> Numa Credits
      </h2>
      <p className="text-muted">
        Author the Numa Credit System pricing per client. Config is the source of truth here and is pushed to the client
        account; the client&apos;s in-app view is read-only. Metering runs for all clients regardless.
      </p>

      <Card className="mb-3">
        <Card.Body>
          <Form.Label className="fw-semibold">Client</Form.Label>
          <ClientSelectGroup value={selected} onChange={setSelected} clients={clients} disabled={loading} />
          {client && (
            <div className="small text-muted mt-2">
              Account {client.config.clientAccountId} · {client.config.region} ·{' '}
              <Badge bg={isCustom ? 'primary' : 'secondary'}>{isCustom ? 'Custom config' : 'Defaults'}</Badge>
            </div>
          )}
        </Card.Body>
      </Card>

      {loading && (
        <div className="d-flex align-items-center gap-2 text-muted">
          <Spinner animation="border" size="sm" /> Loading clients…
        </div>
      )}
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert variant="success" dismissible onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {client && (
        <>
          <Card className="mb-3">
            <Card.Header className="fw-semibold">Current standing</Card.Header>
            <Card.Body>
              {standing ? (
                <>
                  <Row className="g-3 text-center">
                    <Col xs={6} md={3}>
                      <div className="fs-4 fw-semibold">{curAllocated.toLocaleString()}</div>
                      <div className="small text-muted">Allocated ({monthKey(curIdx)})</div>
                    </Col>
                    <Col xs={6} md={3}>
                      <div className="fs-4 fw-semibold">{curUsed.toLocaleString()}</div>
                      <div className="small text-muted">Used this month</div>
                    </Col>
                    <Col xs={6} md={3}>
                      <div className={`fs-4 fw-semibold ${curAllocated - curUsed < 0 ? 'text-danger' : ''}`}>
                        {(curAllocated - curUsed).toLocaleString()}
                      </div>
                      <div className="small text-muted">Remaining (use-it-or-lose-it)</div>
                    </Col>
                    <Col xs={6} md={3}>
                      <div className="fs-4 fw-semibold">{standing.balance.toLocaleString()}</div>
                      <div className="small text-muted">Top-up balance (persistent)</div>
                    </Col>
                  </Row>
                  <div className="small text-muted mt-3">
                    Monthly allocation resets each calendar month (unused credits expire); the top-up balance is a
                    separate pool that carries over. How usage draws between the two — and whether anything is ever
                    enforced at zero — is still being defined.
                  </div>
                </>
              ) : (
                <div className="small text-muted">No usage recorded yet for this client.</div>
              )}
            </Card.Body>
          </Card>

          <Card className="mb-3">
            <Card.Header className="fw-semibold">Pricing algorithm</Card.Header>
            <Card.Body>
              <div className="small text-muted mb-3">
                Charge per conversation = max(value-tier credits, ceil(token$ × AgentCore × per-tier margin ÷ credit$)).
                Changes apply to conversations metered AFTER the save.
              </div>
              <Row className="g-3">
                <Col md={3}>
                  <Form.Label>1 credit (USD)</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.05"
                    value={config.creditUsd}
                    onChange={(e) => setGlobal('creditUsd', num(e.target.value))}
                  />
                </Col>
                <Col md={3}>
                  <Form.Label>AgentCore multiplier</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.001"
                    value={config.agentcoreMult}
                    onChange={(e) => setGlobal('agentcoreMult', num(e.target.value))}
                  />
                </Col>
                <Col md={3}>
                  <Form.Label>Fallback margin</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.1"
                    value={config.margin}
                    onChange={(e) => setGlobal('margin', num(e.target.value))}
                  />
                  <Form.Text className="text-muted">
                    Only used when a conversation can&apos;t be classified. The per-complexity defence margins below are
                    the real control.
                  </Form.Text>
                </Col>
                <Col md={3}>
                  <Form.Label>Trivial-cost cap (USD)</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    value={config.trivialConsumptionUsd}
                    onChange={(e) => setGlobal('trivialConsumptionUsd', num(e.target.value))}
                  />
                </Col>
              </Row>

              <Form.Label className="fw-semibold mt-4">Defence margin per complexity (scales up)</Form.Label>
              <Row className="g-2">
                {TIERS.map((tier) => (
                  <Col xs={6} md={3} key={`m-${tier}`}>
                    <Form.Label className="small text-muted">{TIER_LABEL[tier]}</Form.Label>
                    <Form.Control
                      type="number"
                      step="0.05"
                      value={config.marginsByTier[tier]}
                      onChange={(e) => setMargin(tier, num(e.target.value))}
                    />
                  </Col>
                ))}
              </Row>

              {CONTEXTS.map((ctx) => (
                <div key={`vt-${ctx}`}>
                  <Form.Label className="fw-semibold mt-4">
                    Value credits per tier — {ctx === 'chat' ? 'chat' : 'agent run'}
                  </Form.Label>
                  <Row className="g-2">
                    {TIERS.map((tier) => (
                      <Col xs={6} md={3} key={`vt-${ctx}-${tier}`}>
                        <Form.Label className="small text-muted">{TIER_LABEL[tier]}</Form.Label>
                        <Form.Control
                          type="number"
                          value={config.valueTiers[ctx]?.[tier] ?? 0}
                          onChange={(e) => setTier(ctx, tier, num(e.target.value))}
                        />
                      </Col>
                    ))}
                  </Row>
                </div>
              ))}

              <Button className="mt-4" variant="primary" disabled={saving} onClick={handleSave}>
                {saving ? 'Saving…' : 'Save & push to client'}
              </Button>
            </Card.Body>
          </Card>

          <Card className="mb-3">
            <Card.Header className="fw-semibold">Monthly credit allocation</Card.Header>
            <Card.Body>
              <Row className="g-2 align-items-end mb-3">
                <Col xs={12} md={4}>
                  <Form.Label className="small text-muted">Set every month to…</Form.Label>
                  <Form.Control
                    type="number"
                    step="100"
                    placeholder="e.g. 5000"
                    onChange={(e) => setAllMonths(num(e.target.value))}
                  />
                </Col>
                <Col xs={12} md={8} className="small text-muted">
                  Set each calendar month independently, or use “set every month” for a flat plan. Saved with the
                  pricing config above (the <strong>Save &amp; push</strong> button). “Used” reflects live consumption
                  for {year}.
                </Col>
              </Row>
              <Row className="g-2">
                {MONTHS.map((m, i) => (
                  <Col xs={6} sm={4} md={3} lg={2} key={m}>
                    <Form.Label className="small text-muted">{m}</Form.Label>
                    <Form.Control
                      type="number"
                      step="100"
                      value={config.monthlyAllocations[i] ?? 0}
                      onChange={(e) => setMonth(i, num(e.target.value))}
                    />
                    <div className="small text-muted mt-1">used {usedCredits(i).toLocaleString()}</div>
                  </Col>
                ))}
              </Row>
            </Card.Body>
          </Card>

          <Row className="g-3">
            <Col md={6}>
              <Card className="h-100">
                <Card.Header className="fw-semibold">Top up credits</Card.Header>
                <Card.Body>
                  <div className="mb-2">
                    Current balance: <span className="fw-semibold">{(standing?.balance ?? 0).toLocaleString()}</span>{' '}
                    credits
                    {standing?.balanceUpdatedAt && (
                      <span className="small text-muted">
                        {' '}
                        · updated {new Date(standing.balanceUpdatedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <Form.Label>Add credits to {client.name}&apos;s balance</Form.Label>
                  <InputGroup>
                    <Form.Control
                      type="number"
                      step="100"
                      value={topUp}
                      placeholder="e.g. 1000"
                      onChange={(e) => setTopUp(e.target.value)}
                    />
                    <Button variant="outline-primary" disabled={saving} onClick={handleTopUp}>
                      Top up
                    </Button>
                  </InputGroup>
                  <div className="small text-muted mt-2">
                    Pushed straight to the client ledger balance (persistent pool).
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}

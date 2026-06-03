import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Form,
  InputGroup,
  ProgressBar,
  Row,
  Spinner,
} from 'react-bootstrap';
import { Coin, ChevronDown, ChevronRight, PencilSquare } from 'react-bootstrap-icons';
import { ClientSelectGroup } from '@/components/ClientSelectGroup';
import { clientService } from '@/services/clientService';
import { creditsService, DEFAULT_CREDIT_CONFIG, type CreditStanding } from '@/services/creditsService';
import type { Client, CreditConfig } from '@/types';

/**
 * Numa Credits — central authoring for the Numa Credit System (SPK-015).
 *
 * Pick a client, tune the pricing config (1 credit price, minimum enforced margins per value tier, value-tier
 * credits, AgentCore uplift) and the monthly allocation, and top up credits. On save the config is
 * written to the central numa-client-config AND pushed into the client account's credit-ledger
 * (assume-role); the client's in-app view is read-only. Per-client metering runs regardless of this page.
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

/** One hero stat tile (allocated / used / remaining / balance). */
function StatTile({ value, label, tone }: { value: string; label: string; tone?: 'danger' }) {
  return (
    <Card className="h-100 text-center">
      <Card.Body className="py-3">
        <div className={`fs-3 fw-semibold ${tone === 'danger' ? 'text-danger' : ''}`}>{value}</div>
        <div className="small text-muted">{label}</div>
      </Card.Body>
    </Card>
  );
}

export default function NumaCredits() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState('');
  const [config, setConfig] = useState<FullConfig>(withDefaults());
  const [savedConfig, setSavedConfig] = useState<FullConfig>(withDefaults());
  const [topUp, setTopUp] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [standing, setStanding] = useState<CreditStanding | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(true);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [fxNzd, setFxNzd] = useState(1.69); // NZD per USD — display-only sense-check (billing stays USD)
  const [showCredits, setShowCredits] = useState(false); // in-app credits view visible to the client?

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
    const c = withDefaults(client?.config.creditConfig);
    setConfig(c);
    setSavedConfig(c); // dirty-tracking baseline
    setSelectorOpen(!client); // collapse the picker once a client is chosen
    setShowCredits(!!client?.config?.showCredits);
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
  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(savedConfig), [config, savedConfig]);

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
      setSavedConfig(config); // clears the dirty bar
      setNotice(`Saved pricing + allocation for ${client.name} (central + pushed to the client account).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setConfig(savedConfig);
    setNotice(null);
    setError(null);
  };

  const handleTopUp = async () => {
    if (!client) return;
    const credits = num(topUp);
    if (credits <= 0) {
      setError('Top-up must be a positive number of credits.');
      return;
    }
    const worth = credits * config.creditUsd * fxNzd;
    const ok = window.confirm(
      `Allocate ${credits.toLocaleString()} top-up credits to ${client.name}?\n\n` +
        `≈ NZD $${worth.toLocaleString(undefined, { maximumFractionDigits: 0 })} ` +
        `(${credits.toLocaleString()} × $${config.creditUsd}/credit × ${fxNzd} NZD/USD).`
    );
    if (!ok) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await creditsService.topUp(client.name, client.config.clientAccountId, client.config.region, credits);
      setNotice(`Added ${credits.toLocaleString()} credits to ${client.name}.`);
      setTopUp('');
      void refreshStanding();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Top-up failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!client) return;
    const startMonthly = DEFAULT_CREDIT_CONFIG.monthlyAllocations[0] ?? 0;
    const ok = window.confirm(
      `Reset ${client.name} to DEFAULT pricing + ${startMonthly.toLocaleString()} credits/mo allocation, and ` +
        `zero the top-up balance?\n\nThe balance reset is recorded as an adjustment (auditable, not a deletion).`
    );
    if (!ok) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const defaults = withDefaults(); // pure code defaults (pricing + 2000/mo allocation)
      const { name, config: cc } = client;
      await creditsService.saveConfig(name, cc.clientAccountId, cc.region, defaults);
      const settled = standing?.settledBalance ?? 0;
      if (settled !== 0) {
        await creditsService.adjustBalance(name, cc.clientAccountId, cc.region, -settled, 'reset to defaults');
      }
      setConfig(defaults);
      setSavedConfig(defaults);
      setNotice(`Reset ${name} to defaults (pricing, allocation, and balance zeroed).`);
      void refreshStanding();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleVisibility = async (next: boolean) => {
    if (!client) return;
    setShowCredits(next); // optimistic
    setError(null);
    setNotice(null);
    try {
      await creditsService.setVisibility(client.name, next);
      setNotice(`Credits view ${next ? 'enabled' : 'hidden'} for ${client.name} — applies on the next deploy.`);
    } catch (e) {
      setShowCredits(!next); // revert on failure
      setError(e instanceof Error ? e.message : 'Failed to update visibility');
    }
  };

  // ── live-standing derivation (NZ billing calendar) ──
  const nzNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
  const year = nzNow.getFullYear();
  const curIdx = nzNow.getMonth(); // 0=Jan, on the NZ calendar
  const monthKey = (i: number): string => `${year}-${String(i + 1).padStart(2, '0')}`;
  const usedCredits = (i: number): number => standing?.months[monthKey(i)]?.used ?? 0;
  const nzd = (credits: number): number => credits * config.creditUsd * fxNzd;
  const nzdLabel = (credits: number): string =>
    `≈ NZD $${nzd(credits).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const curAllocated = config.monthlyAllocations[curIdx] ?? 0;
  const curUsed = usedCredits(curIdx);
  const curRemaining = curAllocated - curUsed;
  const usedPct = curAllocated > 0 ? Math.min(100, Math.round((curUsed / curAllocated) * 100)) : 0;
  const annualAllocation = config.monthlyAllocations.reduce((s, v) => s + (v ?? 0), 0);
  const balance = standing?.availableBalance ?? 0;

  return (
    <div style={{ paddingBottom: client && dirty ? 96 : 0 }}>
      <h2 className="mb-1 d-flex align-items-center">
        <Coin className="me-2" /> Numa Credits
      </h2>
      <p className="text-muted">
        Author the Numa Credit System per client. This page is the source of truth; config is pushed to the client
        account and the client&apos;s in-app view is read-only. Metering runs for all clients regardless.
      </p>

      {/* ── Client selector — collapses to a slim bar once chosen ── */}
      <Card className="mb-3">
        <Card.Body>
          {client && !selectorOpen ? (
            <div className="d-flex align-items-center justify-content-between flex-wrap gap-3">
              <div>
                <span className="fw-semibold me-2">{client.name}</span>
                <Badge bg={isCustom ? 'primary' : 'secondary'} className="me-1">
                  {isCustom ? 'Custom config' : 'Defaults'}
                </Badge>
                <Badge bg={showCredits ? 'success' : 'secondary'}>
                  {showCredits ? 'Visible to client' : 'Hidden (metering only)'}
                </Badge>
                <div className="small text-muted">
                  Account {client.config.clientAccountId} · {client.config.region}
                </div>
              </div>
              <div className="d-flex align-items-center gap-3">
                <Form.Check
                  type="switch"
                  id="show-credits-switch"
                  label="Show in client app"
                  checked={showCredits}
                  disabled={saving}
                  title="Applies on the next deploy. Metering runs regardless."
                  onChange={(e) => handleToggleVisibility(e.target.checked)}
                />
                <Button variant="outline-secondary" size="sm" onClick={() => setSelectorOpen(true)}>
                  <PencilSquare className="me-1" /> Change
                </Button>
                <Button variant="outline-danger" size="sm" disabled={saving} onClick={handleReset}>
                  Reset to defaults
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Form.Label className="fw-semibold">Client</Form.Label>
              <ClientSelectGroup value={selected} onChange={setSelected} clients={clients} disabled={loading} />
            </>
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
          {/* ── Hero: current standing ── */}
          <Row className="g-3 mb-2">
            <Col xs={6} lg={3}>
              <StatTile value={curAllocated.toLocaleString()} label={`Allocated · ${MONTHS[curIdx]} ${year}`} />
            </Col>
            <Col xs={6} lg={3}>
              <StatTile value={curUsed.toLocaleString()} label="Used this month" />
            </Col>
            <Col xs={6} lg={3}>
              <StatTile
                value={curRemaining.toLocaleString()}
                label="Remaining"
                tone={curRemaining < 0 ? 'danger' : undefined}
              />
            </Col>
            <Col xs={6} lg={3}>
              <StatTile
                value={balance.toLocaleString()}
                label={`Top-up balance · ${nzdLabel(balance)}`}
                tone={balance < 0 ? 'danger' : undefined}
              />
            </Col>
          </Row>
          {curAllocated > 0 && (
            <ProgressBar
              className="mb-2"
              now={usedPct}
              variant={curUsed > curAllocated ? 'danger' : 'primary'}
              label={`${usedPct}%`}
            />
          )}
          <p className="small text-muted mb-2">
            Monthly allocation resets each NZ month (unused credits expire) and draws first; the overflow draws the
            top-up balance, which carries over and can go <strong>negative</strong> — the invoice signal. No hard cutoff
            at zero.
            {balance < 0 && (
              <span className="text-danger fw-semibold">
                {' '}
                Overdrawn by {Math.abs(balance).toLocaleString()} credits.
              </span>
            )}
          </p>
          <div className="d-flex flex-wrap align-items-center gap-3 mb-3 small text-muted">
            <span>
              Annual allocation: <strong>{annualAllocation.toLocaleString()}</strong> credits ·{' '}
              {nzdLabel(annualAllocation)}/yr
            </span>
            <span className="d-flex align-items-center gap-2">
              NZD rate
              <Form.Control
                type="number"
                step="0.01"
                size="sm"
                style={{ width: 90 }}
                value={fxNzd}
                onChange={(e) => setFxNzd(num(e.target.value) || 1.69)}
              />
              NZD/USD · display only (billing is USD)
            </span>
          </div>

          {/* ── Two-column body: allocation (left) · top-up + advanced pricing (right) ── */}
          <Row className="g-3">
            <Col lg={7}>
              <Card className="h-100">
                <Card.Header className="fw-semibold">Monthly credit allocation</Card.Header>
                <Card.Body>
                  <Row className="g-2 align-items-end mb-3">
                    <Col xs={12} sm={5}>
                      <Form.Label className="small text-muted">Set every month to…</Form.Label>
                      <Form.Control
                        type="number"
                        step="100"
                        placeholder="e.g. 5000"
                        onChange={(e) => {
                          if (e.target.value !== '') setAllMonths(num(e.target.value));
                        }}
                      />
                    </Col>
                    <Col xs={12} sm={7} className="small text-muted">
                      Set each month independently, or broadcast a flat plan. Resets monthly — unused credits expire.
                      “Used” reflects live consumption for {year}.
                    </Col>
                  </Row>
                  <Row className="g-2">
                    {MONTHS.map((m, i) => (
                      <Col xs={6} sm={4} md={3} key={m}>
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
            </Col>

            <Col lg={5}>
              {/* Top-up — immediate, separate from the config Save */}
              <Card className="mb-3">
                <Card.Header className="fw-semibold">Top up balance</Card.Header>
                <Card.Body>
                  <div className="mb-2">
                    Current balance:{' '}
                    <span className={`fw-semibold ${balance < 0 ? 'text-danger' : ''}`}>
                      {balance.toLocaleString()}
                    </span>{' '}
                    credits <span className="small text-muted">{nzdLabel(balance)}</span>
                  </div>
                  <Form.Label className="small text-muted">
                    Add credits to {client.name} (applied immediately)
                  </Form.Label>
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
                    Persistent pool — carries over month to month. Separate from the monthly allocation.
                  </div>
                </Card.Body>
              </Card>

              {/* Advanced pricing — collapsed by default (set rarely) */}
              <Card>
                <Card.Header
                  role="button"
                  onClick={() => setPricingOpen((o) => !o)}
                  className="d-flex justify-content-between align-items-center fw-semibold"
                  style={{ cursor: 'pointer' }}
                >
                  <span>Advanced pricing</span>
                  {pricingOpen ? <ChevronDown /> : <ChevronRight />}
                </Card.Header>
                <Collapse in={pricingOpen}>
                  <div>
                    <Card.Body>
                      <div className="small text-muted mb-3">
                        Charge per conversation = max(value-tier credits, ceil(token$ × AgentCore × per-tier margin ÷
                        credit$)). Changes apply to conversations metered after the save.
                      </div>
                      <Row className="g-2">
                        <Col xs={6}>
                          <Form.Label className="small">1 credit (USD)</Form.Label>
                          <Form.Control
                            type="number"
                            step="0.05"
                            value={config.creditUsd}
                            onChange={(e) => setGlobal('creditUsd', num(e.target.value))}
                          />
                        </Col>
                        <Col xs={6}>
                          <Form.Label className="small">AgentCore multiplier</Form.Label>
                          <Form.Control
                            type="number"
                            step="0.001"
                            value={config.agentcoreMult}
                            onChange={(e) => setGlobal('agentcoreMult', num(e.target.value))}
                          />
                        </Col>
                        <Col xs={6}>
                          <Form.Label className="small">Fallback margin</Form.Label>
                          <Form.Control
                            type="number"
                            step="0.1"
                            value={config.margin}
                            onChange={(e) => setGlobal('margin', num(e.target.value))}
                          />
                        </Col>
                        <Col xs={6}>
                          <Form.Label className="small">Trivial-cost cap (USD)</Form.Label>
                          <Form.Control
                            type="number"
                            step="0.01"
                            value={config.trivialConsumptionUsd}
                            onChange={(e) => setGlobal('trivialConsumptionUsd', num(e.target.value))}
                          />
                        </Col>
                      </Row>
                      <Form.Text className="text-muted d-block mb-2">
                        Fallback margin only applies when a conversation can&apos;t be classified — the minimum enforced
                        margins per value tier below are the real control.
                      </Form.Text>

                      <Form.Label className="fw-semibold mt-3">Minimum enforced margin per value tier</Form.Label>
                      <div className="small text-muted mb-2">
                        Whatever the credit prices and allocations work out to, a conversation is never charged less
                        than this multiple of its underlying cost (tokens + AgentCore). Higher tiers keep a fuller
                        margin.
                      </div>
                      <Row className="g-2">
                        {TIERS.map((tier) => (
                          <Col xs={6} key={`m-${tier}`}>
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
                          <Form.Label className="fw-semibold mt-3">
                            Value credits per tier — {ctx === 'chat' ? 'chat' : 'agent run'}
                          </Form.Label>
                          <Row className="g-2">
                            {TIERS.map((tier) => (
                              <Col xs={6} key={`vt-${ctx}-${tier}`}>
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
                    </Card.Body>
                  </div>
                </Collapse>
              </Card>
            </Col>
          </Row>
        </>
      )}

      {/* ── Dirty-aware sticky save bar (pricing + allocation save together) ── */}
      {client && dirty && (
        <div
          className="d-flex align-items-center justify-content-between"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1030,
            background: '#fff',
            borderTop: '1px solid #dee2e6',
            boxShadow: '0 -2px 8px rgba(0,0,0,0.08)',
            padding: '0.75rem 1.5rem',
          }}
        >
          <span className="text-muted">
            <strong>Unsaved changes</strong> — pricing &amp; allocation for {client.name}
          </span>
          <div className="d-flex gap-2">
            <Button variant="outline-secondary" disabled={saving} onClick={handleDiscard}>
              Discard
            </Button>
            <Button variant="primary" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save & push to client'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

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
  ListGroup,
  ProgressBar,
  Row,
  Spinner,
} from 'react-bootstrap';
import { Coin, ChevronDown, ChevronRight } from 'react-bootstrap-icons';
import { clientService, groupClientsByType } from '@/services/clientService';
import { creditsService, DEFAULT_CREDIT_CONFIG, type CreditStanding } from '@/services/creditsService';
import BillingAdminsPanel from '@/components/BillingAdminsPanel';
import type { Client, CreditConfig } from '@/types';

/**
 * Numa Credits — central authoring for the Numa Credit System (SPK-015).
 *
 * Dashboard-style: a left rail (Overview + per-client list) drives the main pane. Overview shows the
 * global default config (the pricing index) + an on-demand fleet rollup. Per client: tune pricing,
 * the monthly allocation, top-ups, visibility, and reset. On save the config is written to the central
 * numa-client-config AND pushed into the client account's credit-ledger; the client's view is read-only.
 */

const TIERS = ['low', 'medium', 'high', 'very_high'] as const;
const CONTEXTS = ['chat', 'agent'] as const;
const TIER_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', very_high: 'Very high' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type FullConfig = Required<CreditConfig>;

/** Fleet rollup computed on demand by sweeping every client's ledger standing (cross-account). */
interface FleetAggregate {
  owed: number; // Σ of negative balances (credits clients owe us — accounts payable)
  prepaid: number; // Σ of positive top-up balances
  usedThisMonth: number; // Σ credits used this NZ month
  visible: number; // clients with showCredits on
  custom: number; // clients on a custom (non-default) config
  withLedger: number; // clients whose ledger read succeeded
  failed: number; // clients whose read failed / have no ledger yet
  total: number;
}

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

/** One hero stat tile. */
function StatTile({ value, label, tone }: { value: string; label: string; tone?: 'danger' | 'success' }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : '';
  return (
    <Card className="h-100 text-center">
      <Card.Body className="py-3">
        <div className={`fs-3 fw-semibold ${color}`}>{value}</div>
        <div className="small text-muted">{label}</div>
      </Card.Body>
    </Card>
  );
}

export default function NumaCredits() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState('');
  const [railSearch, setRailSearch] = useState('');
  const [config, setConfig] = useState<FullConfig>(withDefaults());
  const [savedConfig, setSavedConfig] = useState<FullConfig>(withDefaults());
  const [topUp, setTopUp] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [standing, setStanding] = useState<CreditStanding | null>(null);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [fxNzd, setFxNzd] = useState(1.69); // NZD per USD — display-only sense-check (billing stays USD)
  const [showCredits, setShowCredits] = useState(false); // in-app credits view visible to the client?
  const [aggregate, setAggregate] = useState<FleetAggregate | null>(null);
  const [aggLoading, setAggLoading] = useState(false);
  const [aggProgress, setAggProgress] = useState({ done: 0, total: 0 });

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

  // ── NZ billing calendar (current month) ──
  const nzNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
  const year = nzNow.getFullYear();
  const curIdx = nzNow.getMonth(); // 0=Jan, on the NZ calendar
  const monthKey = (i: number): string => `${year}-${String(i + 1).padStart(2, '0')}`;

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

  /** On-demand fleet sweep — reads every client's balance cross-account (concurrency-limited). */
  const loadAggregate = async () => {
    setAggLoading(true);
    setError(null);
    const curKey = monthKey(curIdx);
    const visible = clients.filter((c) => c.config.showCredits).length;
    const custom = clients.filter((c) => c.config.creditConfig).length;
    const queue = [...clients];
    const total = queue.length;
    setAggProgress({ done: 0, total });
    let owed = 0;
    let prepaid = 0;
    let usedThisMonth = 0;
    let withLedger = 0;
    let failed = 0;
    let done = 0;
    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        try {
          const st = await creditsService.getStanding(c.name, c.config.clientAccountId, c.config.region);
          withLedger += 1;
          if (st.availableBalance < 0) owed += -st.availableBalance;
          else prepaid += st.availableBalance;
          usedThisMonth += st.months[curKey]?.used ?? 0;
        } catch {
          failed += 1;
        }
        done += 1;
        setAggProgress({ done, total });
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, total) }, worker));
    setAggregate({ owed, prepaid, usedThisMonth, visible, custom, withLedger, failed, total });
    setAggLoading(false);
  };

  // ── per-client derivations ──
  const usedCredits = (i: number): number => standing?.months[monthKey(i)]?.used ?? 0;
  // Internal economics for the month (Arcanum-only): real consumption cost (USD) + realised margin.
  const monthCostUsd = (i: number): number => standing?.months[monthKey(i)]?.costUsd ?? 0;
  const monthMargin = (i: number): number | null => {
    const m = standing?.months[monthKey(i)];
    return m && m.costUsd > 0 ? m.revenueUsd / m.costUsd : null;
  };
  const nzd = (credits: number): number => credits * config.creditUsd * fxNzd;
  const nzdLabel = (credits: number): string =>
    `≈ NZD $${nzd(credits).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const curAllocated = config.monthlyAllocations[curIdx] ?? 0;
  const curUsed = usedCredits(curIdx);
  const curRemaining = curAllocated - curUsed;
  const usedPct = curAllocated > 0 ? Math.min(100, Math.round((curUsed / curAllocated) * 100)) : 0;
  const annualAllocation = config.monthlyAllocations.reduce((s, v) => s + (v ?? 0), 0);
  const balance = standing?.availableBalance ?? 0;

  // ── rail grouping ──
  const { devClients, productionClients } = useMemo(() => groupClientsByType(clients), [clients]);
  const matches = (c: Client) => c.name.toLowerCase().includes(railSearch.trim().toLowerCase());
  const railDev = devClients.filter(matches);
  const railProd = productionClients.filter(matches);

  const railItem = (c: Client) => (
    <ListGroup.Item action active={selected === c.name} onClick={() => setSelected(c.name)} key={c.name}>
      <span
        className="d-inline-block rounded-circle me-2"
        title={c.config.showCredits ? 'Credits visible to client' : 'Hidden (metering only)'}
        style={{ width: 8, height: 8, background: c.config.showCredits ? '#198754' : '#ced4da' }}
      />
      {c.name}
      {c.config.creditConfig && (
        <Badge bg="light" text="dark" className="ms-2 fw-normal">
          custom
        </Badge>
      )}
    </ListGroup.Item>
  );

  const nzdAt = (credits: number) =>
    `≈ NZD $${(credits * DEFAULT_CREDIT_CONFIG.creditUsd * fxNzd).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div style={{ paddingBottom: client && dirty ? 96 : 0 }}>
      <h2 className="mb-1 d-flex align-items-center">
        <Coin className="me-2" /> Numa Credits
      </h2>
      <p className="text-muted">
        Source of truth for the Numa Credit System. Config is pushed to each client account; the client&apos;s in-app
        view is read-only. Metering runs for all clients regardless.
      </p>

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

      <div className="d-flex gap-3">
        {/* ── Left rail ── */}
        <div style={{ width: 270, flexShrink: 0 }}>
          <Form.Control
            size="sm"
            placeholder="Search clients…"
            value={railSearch}
            onChange={(e) => setRailSearch(e.target.value)}
            className="mb-2"
          />
          <ListGroup className="mb-2">
            <ListGroup.Item action active={!selected} onClick={() => setSelected('')}>
              <strong>Overview</strong>
              {/* Drop text-muted (it's !important, so it stays dark/low-contrast on the active blue bg)
                  and use a translucent-white subtitle when active, muted otherwise. */}
              <div
                className={selected ? 'small text-muted' : 'small'}
                style={selected ? undefined : { color: 'rgba(255,255,255,0.85)' }}
              >
                Defaults &amp; fleet rollup
              </div>
            </ListGroup.Item>
          </ListGroup>
          {loading && (
            <div className="d-flex align-items-center gap-2 text-muted small px-1">
              <Spinner animation="border" size="sm" /> Loading…
            </div>
          )}
          {railDev.length > 0 && (
            <>
              <div className="small text-uppercase text-muted mt-2 mb-1 px-1">Dev / Demo</div>
              <ListGroup className="mb-2">{railDev.map(railItem)}</ListGroup>
            </>
          )}
          {railProd.length > 0 && (
            <>
              <div className="small text-uppercase text-muted mt-2 mb-1 px-1">Clients</div>
              <ListGroup>{railProd.map(railItem)}</ListGroup>
            </>
          )}
        </div>

        {/* ── Main pane ── */}
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          {!client ? (
            /* ───────── Overview (index): global defaults + on-demand fleet rollup ───────── */
            <>
              <Card className="mb-3">
                <Card.Header className="fw-semibold">
                  Global defaults — how every client is priced unless customised
                </Card.Header>
                <Card.Body>
                  <Row className="g-3">
                    <Col xs={6} md={3}>
                      <StatTile
                        value={`$${DEFAULT_CREDIT_CONFIG.creditUsd} USD`}
                        label={`per credit · ≈ NZD $${(DEFAULT_CREDIT_CONFIG.creditUsd * fxNzd).toFixed(2)} ea`}
                      />
                    </Col>
                    <Col xs={6} md={3}>
                      <StatTile
                        value={(DEFAULT_CREDIT_CONFIG.monthlyAllocations[0] ?? 0).toLocaleString()}
                        label={`default allocation / mo · ${nzdAt(DEFAULT_CREDIT_CONFIG.monthlyAllocations[0] ?? 0)}`}
                      />
                    </Col>
                    <Col xs={6} md={3}>
                      <StatTile value="USD" label="billed (no FX); NZ calendar" />
                    </Col>
                    <Col xs={6} md={3}>
                      <StatTile value="1.234×" label="AgentCore uplift in floor" />
                    </Col>
                  </Row>
                  <Row className="g-3 mt-1">
                    <Col md={4}>
                      <div className="small text-muted">Value credits per tier — chat</div>
                      <div className="fw-semibold">
                        {TIERS.map((t) => DEFAULT_CREDIT_CONFIG.valueTiers.chat[t]).join(' / ')}{' '}
                        <span className="text-muted fw-normal">(low/med/high/v.high)</span>
                      </div>
                    </Col>
                    <Col md={4}>
                      <div className="small text-muted">Value credits per tier — agent</div>
                      <div className="fw-semibold">
                        {TIERS.map((t) => DEFAULT_CREDIT_CONFIG.valueTiers.agent[t]).join(' / ')}
                      </div>
                    </Col>
                    <Col md={4}>
                      <div className="small text-muted">Min enforced margin per tier</div>
                      <div className="fw-semibold">
                        {TIERS.map((t) => `${DEFAULT_CREDIT_CONFIG.marginsByTier[t]}×`).join(' / ')}
                      </div>
                    </Col>
                  </Row>
                  <div className="small text-muted mt-3">
                    Charge per conversation = max(value-tier credits, ceil(token$ × AgentCore × tier margin ÷ credit$)).
                    Plain chat uses the chat tier; agent chats and scheduled runs use the agent tier. Pick a client on
                    the left to view or customise their plan.
                  </div>
                </Card.Body>
              </Card>

              <Card>
                <Card.Header className="d-flex justify-content-between align-items-center fw-semibold">
                  <span>Fleet rollup</span>
                  <Button size="sm" variant="outline-primary" disabled={aggLoading || loading} onClick={loadAggregate}>
                    {aggLoading ? 'Loading…' : aggregate ? 'Refresh' : 'Load fleet overview'}
                  </Button>
                </Card.Header>
                <Card.Body>
                  {aggLoading ? (
                    <>
                      <ProgressBar
                        now={aggProgress.total ? (100 * aggProgress.done) / aggProgress.total : 0}
                        label={`${aggProgress.done}/${aggProgress.total}`}
                      />
                      <div className="small text-muted mt-2">Sweeping each client&apos;s ledger (cross-account)…</div>
                    </>
                  ) : aggregate ? (
                    <>
                      <Row className="g-3">
                        <Col xs={6} md={3}>
                          <StatTile
                            value={Math.round(aggregate.owed).toLocaleString()}
                            label={`Owed (negative) · ${nzdAt(aggregate.owed)}`}
                            tone={aggregate.owed > 0 ? 'danger' : undefined}
                          />
                        </Col>
                        <Col xs={6} md={3}>
                          <StatTile
                            value={Math.round(aggregate.prepaid).toLocaleString()}
                            label={`Prepaid balances · ${nzdAt(aggregate.prepaid)}`}
                            tone="success"
                          />
                        </Col>
                        <Col xs={6} md={3}>
                          <StatTile
                            value={Math.round(aggregate.usedThisMonth).toLocaleString()}
                            label={`Used · ${MONTHS[curIdx]} ${year}`}
                          />
                        </Col>
                        <Col xs={6} md={3}>
                          <StatTile value={`${aggregate.visible}/${aggregate.total}`} label="Visible to client" />
                        </Col>
                      </Row>
                      <div className="small text-muted mt-3">
                        {aggregate.custom} on custom config · {aggregate.withLedger} ledgers read
                        {aggregate.failed > 0 && ` · ${aggregate.failed} no ledger / unreadable`}. Owed = sum of
                        negative balances (accounts-payable view); NZD is indicative at the default $
                        {DEFAULT_CREDIT_CONFIG.creditUsd}/credit.
                      </div>
                    </>
                  ) : (
                    <div className="text-muted">
                      Load an on-demand sweep of every client&apos;s balance — total owed (accounts payable), prepaid
                      balances, credits used this month, and how many have the view enabled. Reads each client account,
                      so it takes a few moments.
                    </div>
                  )}
                </Card.Body>
              </Card>
            </>
          ) : (
            /* ───────── Per-client detail ───────── */
            <>
              <Card className="mb-3">
                <Card.Body className="d-flex align-items-center justify-content-between flex-wrap gap-3">
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
                    <Button variant="outline-danger" size="sm" disabled={saving} onClick={handleReset}>
                      Reset to defaults
                    </Button>
                  </div>
                </Card.Body>
              </Card>

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
                top-up balance, which carries over and can go <strong>negative</strong> — the invoice signal. No hard
                cutoff at zero.
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
                          Set each month independently, or broadcast a flat plan. Resets monthly — unused credits
                          expire. “Used” reflects live consumption for {year}.
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
                            <div className="small text-muted mt-1">
                              used {usedCredits(i).toLocaleString()}
                              {monthCostUsd(i) > 0 && (
                                <>
                                  {' · '}${monthCostUsd(i).toFixed(2)} cost
                                  {monthMargin(i) != null && ` · ${monthMargin(i)!.toFixed(1)}× margin`}
                                </>
                              )}
                            </div>
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

                      {/* Top-up activity — the balance event log (top-ups + month-close settlements +
                          adjustments) from the client ledger (CLIENT#/TXN#…). Balance above = Σ of these. */}
                      {standing && (
                        <div className="mt-3">
                          <div className="small fw-semibold text-muted mb-1">Activity</div>
                          {standing.txns.length === 0 ? (
                            <div className="small text-muted">No top-up activity yet.</div>
                          ) : (
                            <div className="table-responsive" style={{ maxHeight: 220, overflowY: 'auto' }}>
                              <table className="table table-sm align-middle mb-0" style={{ fontSize: '0.8rem' }}>
                                <thead>
                                  <tr className="text-muted">
                                    <th>Date</th>
                                    <th>Type</th>
                                    <th className="text-end">Credits</th>
                                    <th>By</th>
                                    <th>Note</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {standing.txns.map((t, i) => {
                                    const label =
                                      t.kind === 'topup'
                                        ? 'Top-up'
                                        : t.kind === 'settlement'
                                          ? `Settlement${t.month ? ` (${t.month})` : ''}`
                                          : t.kind === 'adjustment'
                                            ? 'Adjustment'
                                            : t.kind;
                                    const when = t.createdAt
                                      ? new Date(t.createdAt).toLocaleDateString('en-NZ', {
                                          day: '2-digit',
                                          month: 'short',
                                          year: 'numeric',
                                        })
                                      : '—';
                                    return (
                                      <tr key={`${t.createdAt}-${i}`}>
                                        <td className="text-nowrap">{when}</td>
                                        <td>{label}</td>
                                        <td
                                          className={`text-end fw-semibold ${t.credits < 0 ? 'text-danger' : 'text-success'}`}
                                        >
                                          {t.credits > 0 ? '+' : ''}
                                          {t.credits.toLocaleString()}
                                        </td>
                                        <td className="text-muted">{t.createdBy ?? '—'}</td>
                                        <td className="text-muted">{t.note ?? ''}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </Card.Body>
                  </Card>

                  {/* Billing admins — who may see credit data in-client (seed the first here) */}
                  <BillingAdminsPanel
                    clientName={client.name}
                    accountId={client.config.clientAccountId}
                    region={client.config.region}
                  />

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
                            Charge per conversation = max(value-tier credits, ceil(token$ × AgentCore × per-tier margin
                            ÷ credit$)). Changes apply to conversations metered after the save.
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
                            Fallback margin only applies when a conversation can&apos;t be classified — the minimum
                            enforced margins per value tier below are the real control.
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
        </div>
      </div>

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

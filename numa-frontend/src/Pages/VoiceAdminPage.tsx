import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, Card, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../Providers/AuthProvider';
import { useNumaRequest } from '../Providers/RequestProvider';
import { getFlag } from '../utils/featureFlags';
import { VoiceAdminService, type VoiceAdminStatus, type OutboundCountryResult } from '../Services/VoiceAdminService';

/**
 * Voice Admin — manage the tenant's Amazon Connect setup: instance status,
 * phone numbers (claim/release + outbound caller-ID), Approved Origins + agent,
 * and an outbound-country enablement request (the one thing with no Connect API).
 * Reads render for any user; mutations are admin-only (enforced server-side too).
 */

const CLAIM_COUNTRIES = ['US', 'AU', 'NZ'];

export const VoiceAdminPage: React.FC = () => {
  const { t } = useTranslation('voice');
  const { user } = useAuth();
  const { numaGet, numaPost, numaDelete } = useNumaRequest();

  const isAdmin = useMemo(() => {
    const groups = (user?.decoded_tokens?.idToken?.['cognito:groups'] as string[] | undefined) ?? [];
    return groups.includes('admin');
  }, [user]);

  const [status, setStatus] = useState<VoiceAdminStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outboundResult, setOutboundResult] = useState<OutboundCountryResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await VoiceAdminService.getStatus(numaGet));
    } catch (err) {
      console.error('[VoiceAdmin] status load failed', err);
      setError(t('admin.error', { defaultValue: 'Could not load Connect status.' }));
    } finally {
      setLoading(false);
    }
  }, [numaGet, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>) => {
      setBusy(key);
      setError(null);
      try {
        await fn();
        await load();
      } catch (err) {
        console.error('[VoiceAdmin] action failed', key, err);
        setError(t('admin.actionError', { defaultValue: 'That action failed. Check your permissions and try again.' }));
      } finally {
        setBusy(null);
      }
    },
    [load, t]
  );

  const requestOutbound = useCallback(async () => {
    setBusy('outbound');
    setError(null);
    try {
      const res = await VoiceAdminService.requestOutboundCountry(numaPost, 'New Zealand');
      setOutboundResult(res);
    } catch (err) {
      console.error('[VoiceAdmin] outbound request failed', err);
      setError(t('admin.actionError', { defaultValue: 'That action failed. Check your permissions and try again.' }));
    } finally {
      setBusy(null);
    }
  }, [numaPost, t]);

  if (!getFlag('NUMA_VOICE')) {
    return (
      <div className="container py-5 text-center text-muted">
        {t('admin.disabled', { defaultValue: 'Numa Voice is not enabled for this workspace.' })}
      </div>
    );
  }

  const numaOrigin = status?.instanceAlias
    ? `https://${status.instanceAlias.replace(/^numa-/, '')}.numa.arcanum.ai`
    : '';

  return (
    <div className="container-fluid py-4">
      <header className="mb-4">
        <h1 className="h3 d-flex align-items-center gap-2 mb-1">
          <i className="bi bi-sliders text-primary" aria-hidden="true" />
          {t('admin.title', { defaultValue: 'Voice Admin' })}
        </h1>
        <p className="text-muted mb-0">
          {t('admin.subtitle', { defaultValue: 'Manage the Amazon Connect setup for your SDR team.' })}
        </p>
      </header>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="d-flex align-items-center gap-2 py-5 text-muted">
          <Spinner animation="border" size="sm" />
          <span>{t('page.loading', { defaultValue: 'Loading…' })}</span>
        </div>
      ) : !status?.configured ? (
        <Alert variant="warning">
          <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
          {t('admin.notConfigured', {
            defaultValue:
              'No Amazon Connect instance found for this workspace yet. Deploy with autoProvision enabled, then refresh.',
          })}
        </Alert>
      ) : (
        <>
          {/* ── Instance status ─────────────────────────────────────────── */}
          <Card className="mb-3">
            <Card.Header className="fw-semibold">
              <i className="bi bi-hdd-network me-2" aria-hidden="true" />
              {t('admin.instance', { defaultValue: 'Instance' })}
            </Card.Header>
            <Card.Body className="small">
              <div className="d-flex flex-wrap gap-4">
                <div>
                  <div className="text-muted">{t('admin.alias', { defaultValue: 'Alias' })}</div>
                  <div className="font-monospace">{status.instanceAlias}</div>
                </div>
                <div>
                  <div className="text-muted">{t('admin.numaOrigin', { defaultValue: 'Numa origin approved' })}</div>
                  <div>
                    {status.numaOriginPresent ? (
                      <Badge bg="success">{t('admin.yes', { defaultValue: 'Yes' })}</Badge>
                    ) : (
                      <Badge bg="danger">{t('admin.no', { defaultValue: 'No' })}</Badge>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-muted">{t('admin.agents', { defaultValue: 'Agents' })}</div>
                  <div className="font-monospace">
                    {(status.agents ?? []).map((a) => a.username).join(', ') ||
                      t('admin.none', { defaultValue: 'none' })}
                  </div>
                </div>
              </div>
            </Card.Body>
          </Card>

          {/* ── Phone numbers ───────────────────────────────────────────── */}
          <Card className="mb-3">
            <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="fw-semibold">
                <i className="bi bi-telephone me-2" aria-hidden="true" />
                {t('admin.numbers', { defaultValue: 'Phone numbers' })}
              </span>
              {isAdmin && (
                <ButtonGroup size="sm">
                  {CLAIM_COUNTRIES.map((c) => (
                    <Button
                      key={c}
                      variant="outline-primary"
                      disabled={busy !== null}
                      onClick={() => void run(`claim:${c}`, () => VoiceAdminService.claimNumber(numaPost, c))}
                    >
                      {busy === `claim:${c}` ? <Spinner size="sm" animation="border" className="me-1" /> : null}
                      {t('admin.claim', { defaultValue: 'Claim' })} {c}
                    </Button>
                  ))}
                </ButtonGroup>
              )}
            </Card.Header>
            <Card.Body className="p-0">
              {(status.phoneNumbers ?? []).length === 0 ? (
                <div className="text-muted text-center py-4">
                  {t('admin.noNumbers', { defaultValue: 'No numbers claimed yet.' })}
                </div>
              ) : (
                <Table size="sm" hover responsive className="mb-0 align-middle">
                  <tbody>
                    {(status.phoneNumbers ?? []).map((n) => (
                      <tr key={n.id}>
                        <td className="font-monospace">{n.number}</td>
                        <td>
                          <Badge bg="light" text="dark" className="border">
                            {n.countryCode} {n.type}
                          </Badge>
                        </td>
                        <td className="text-end">
                          {isAdmin && (
                            <>
                              <Button
                                variant="outline-secondary"
                                size="sm"
                                className="me-2"
                                disabled={busy !== null || !n.id}
                                onClick={() =>
                                  void run(`callerid:${n.id}`, () => VoiceAdminService.setCallerId(numaPost, n.id!))
                                }
                              >
                                {t('admin.setCallerId', { defaultValue: 'Set as caller-ID' })}
                              </Button>
                              <Button
                                variant="outline-danger"
                                size="sm"
                                disabled={busy !== null || !n.id}
                                onClick={() =>
                                  void run(`release:${n.id}`, () => VoiceAdminService.releaseNumber(numaDelete, n.id!))
                                }
                              >
                                {busy === `release:${n.id}` ? (
                                  <Spinner size="sm" animation="border" />
                                ) : (
                                  t('admin.release', { defaultValue: 'Release' })
                                )}
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>

          {/* ── Approved origins ────────────────────────────────────────── */}
          <Card className="mb-3">
            <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="fw-semibold">
                <i className="bi bi-globe me-2" aria-hidden="true" />
                {t('admin.origins', { defaultValue: 'Approved origins' })}
              </span>
              {isAdmin && numaOrigin && !status.numaOriginPresent && (
                <Button
                  size="sm"
                  variant="outline-primary"
                  disabled={busy !== null}
                  onClick={() => void run('addOrigin', () => VoiceAdminService.addOrigin(numaPost, numaOrigin))}
                >
                  {busy === 'addOrigin' ? <Spinner size="sm" animation="border" className="me-1" /> : null}
                  {t('admin.addNumaOrigin', { defaultValue: 'Approve Numa domain' })}
                </Button>
              )}
            </Card.Header>
            <Card.Body className="p-0">
              {(status.approvedOrigins ?? []).length === 0 ? (
                <div className="text-muted text-center py-4">
                  {t('admin.noOrigins', { defaultValue: 'No approved origins.' })}
                </div>
              ) : (
                <Table size="sm" hover responsive className="mb-0 align-middle">
                  <tbody>
                    {(status.approvedOrigins ?? []).map((o) => (
                      <tr key={o}>
                        <td className="font-monospace">{o}</td>
                        <td className="text-end">
                          {isAdmin && (
                            <Button
                              variant="outline-danger"
                              size="sm"
                              disabled={busy !== null}
                              onClick={() =>
                                void run(`rmOrigin:${o}`, () => VoiceAdminService.removeOrigin(numaDelete, o))
                              }
                            >
                              {t('admin.remove', { defaultValue: 'Remove' })}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>

          {/* ── Outbound country request ────────────────────────────────── */}
          <Card className="mb-3">
            <Card.Header className="fw-semibold">
              <i className="bi bi-send me-2" aria-hidden="true" />
              {t('admin.outbound', { defaultValue: 'Outbound country (NZ)' })}
            </Card.Header>
            <Card.Body>
              <p className="small text-muted">
                {t('admin.outboundHelp', {
                  defaultValue:
                    'Amazon Connect has no API to enable an outbound destination — it needs an AWS Support case. This files one for you (if your account has a Business+ support plan), otherwise it returns the details to submit in the console.',
                })}
              </p>
              {isAdmin && (
                <Button
                  variant="outline-primary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void requestOutbound()}
                >
                  {busy === 'outbound' ? <Spinner size="sm" animation="border" className="me-1" /> : null}
                  {t('admin.requestOutbound', { defaultValue: 'Request NZ outbound' })}
                </Button>
              )}
              {outboundResult && (
                <Alert variant={outboundResult.filed ? 'success' : 'info'} className="mt-3 mb-0 small">
                  {outboundResult.filed
                    ? t('admin.caseFiled', { defaultValue: 'Support case filed: {{id}}', id: outboundResult.caseId })
                    : t('admin.caseManual', {
                        defaultValue: 'No support plan — submit this in the console:',
                      })}
                  {!outboundResult.filed && outboundResult.manual && (
                    <pre className="mt-2 mb-0 small">{outboundResult.manual.communicationBody}</pre>
                  )}
                </Alert>
              )}
            </Card.Body>
          </Card>

          {!isAdmin && (
            <Alert variant="secondary" className="small">
              {t('admin.readOnly', {
                defaultValue: 'You have read-only access — admin role required to make changes.',
              })}
            </Alert>
          )}
        </>
      )}
    </div>
  );
};

export default VoiceAdminPage;

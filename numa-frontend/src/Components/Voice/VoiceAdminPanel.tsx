import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, Card, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { getFlag } from '../../utils/featureFlags';
import { VoiceAdminService, type VoiceAdminStatus, type VoiceUsage } from '../../Services/VoiceAdminService';

/**
 * VoiceAdminPanel — manage the tenant's Amazon Connect setup: instance status,
 * phone numbers (claim/release + outbound caller-ID), and Approved Origins + agent.
 * Reads render for any user; mutations are admin-only (enforced server-side too).
 *
 * This is the reusable body — it carries no page header chrome so it can be
 * dropped into the admin Settings panel (Settings supplies its own header).
 * Lives under Settings → Admin → Voice; the old /voice/admin route redirects here.
 */

const CLAIM_COUNTRIES = ['US', 'AU', 'NZ'];

/** Pull a human-readable message out of whatever useNumaRequest throws (Error,
 *  string, or a `{ error }` / `{ message }` body from the Lambda). */
function extractErrorMessage(err: unknown): string | null {
  if (!err) return null;
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  const e = err as { error?: unknown; message?: unknown };
  if (typeof e.error === 'string') return e.error;
  if (typeof e.message === 'string') return e.message;
  return null;
}

export const VoiceAdminPanel: React.FC = () => {
  const { t } = useTranslation('voice');
  const { user } = useAuth();
  const { numaGet, numaPost, numaDelete } = useNumaRequest();

  const isAdmin = useMemo(() => {
    const groups = (user?.decoded_tokens?.idToken?.['cognito:groups'] as string[] | undefined) ?? [];
    return groups.includes('admin');
  }, [user]);

  const [status, setStatus] = useState<VoiceAdminStatus | null>(null);
  const [usage, setUsage] = useState<VoiceUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Two-click confirm for irreversible actions (release DID / remove origin):
  // the key of the action currently awaiting its second click, or null.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

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
    // FEAT-170 usage is best-effort decoration — never block or fail the panel on it.
    try {
      setUsage(await VoiceAdminService.getUsage(numaGet));
    } catch (err) {
      console.warn('[VoiceAdmin] usage load failed (non-fatal)', err);
      setUsage(null);
    }
  }, [numaGet, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, successMsg?: string) => {
      setBusy(key);
      setError(null);
      setSuccess(null);
      try {
        await fn();
        await load();
        if (successMsg) setSuccess(successMsg);
      } catch (err) {
        console.error('[VoiceAdmin] action failed', key, err);
        // Surface the server's actual message (e.g. "No default outbound queue…")
        // rather than a generic failure, so misconfigurations are diagnosable.
        setError(
          extractErrorMessage(err) ??
            t('admin.actionError', { defaultValue: 'That action failed. Check your permissions and try again.' })
        );
      } finally {
        setBusy(null);
      }
    },
    [load, t]
  );

  /**
   * Render a destructive action as a two-click confirm: first click swaps the
   * trigger for a "<consequence> · Confirm / Cancel" inline group; the second
   * click runs it. Prevents a single misclick from releasing the company's
   * caller-ID DID or de-approving the origin (a tenant-wide softphone outage).
   */
  const renderDestructive = useCallback(
    (opts: {
      actionKey: string;
      triggerLabel: string;
      confirmLabel: string;
      warning: string;
      onConfirm: () => Promise<unknown>;
      successMsg?: string;
      className?: string;
    }): React.JSX.Element => {
      if (confirmKey === opts.actionKey) {
        return (
          <span className={`d-inline-flex align-items-center gap-2 flex-wrap ${opts.className ?? ''}`}>
            <span className="small text-danger-emphasis">{opts.warning}</span>
            <Button
              variant="danger"
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                setConfirmKey(null);
                void run(opts.actionKey, opts.onConfirm, opts.successMsg);
              }}
            >
              {busy === opts.actionKey ? <Spinner size="sm" animation="border" className="me-1" /> : null}
              {opts.confirmLabel}
            </Button>
            <Button variant="outline-secondary" size="sm" disabled={busy !== null} onClick={() => setConfirmKey(null)}>
              {t('admin.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </span>
        );
      }
      return (
        <Button
          variant="outline-danger"
          size="sm"
          className={opts.className}
          disabled={busy !== null}
          onClick={() => setConfirmKey(opts.actionKey)}
        >
          {opts.triggerLabel}
        </Button>
      );
    },
    [confirmKey, busy, run, t]
  );

  // FEAT-170: per-DID month-to-date minutes, keyed by phone-number id.
  // (Hook — must run before the flag-gate early return.)
  const usageById = useMemo(() => {
    const map = new Map<string, { minutes: number; contacts: number }>();
    for (const u of usage?.numbers ?? []) {
      if (u.id) map.set(u.id, { minutes: u.minutes, contacts: u.contacts });
    }
    return map;
  }, [usage]);

  if (!getFlag('NUMA_VOICE')) {
    return (
      <div className="container py-5 text-center text-muted">
        {t('admin.disabled', { defaultValue: 'Numa Voice is not enabled for this workspace.' })}
      </div>
    );
  }

  // Prefer the backend's authoritative approved-origin (correct for custom-domain
  // tenants); fall back to the alias-derived subdomain for older deployments.
  const numaOrigin =
    status?.numaOrigin ??
    (status?.instanceAlias ? `https://${status.instanceAlias.replace(/^numa-/, '')}.numa.arcanum.ai` : '');

  return (
    <>
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          <i className="bi bi-exclamation-octagon-fill me-2" aria-hidden="true" />
          {error}
        </Alert>
      )}

      {success && (
        <Alert variant="success" dismissible onClose={() => setSuccess(null)}>
          <i className="bi bi-check-circle-fill me-2" aria-hidden="true" />
          {success}
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
              'No phone system is set up for this workspace yet. Deploy with autoProvision enabled, then refresh.',
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
                      onClick={() =>
                        void run(
                          `claim:${c}`,
                          () => VoiceAdminService.claimNumber(numaPost, c),
                          t('admin.numberClaimed', { defaultValue: 'New {{country}} number claimed.', country: c })
                        )
                      }
                    >
                      {busy === `claim:${c}` ? <Spinner size="sm" animation="border" className="me-1" /> : null}
                      {t('admin.claim', { defaultValue: 'Claim' })} {c}
                    </Button>
                  ))}
                </ButtonGroup>
              )}
            </Card.Header>
            <Card.Body className="p-0">
              {/* Inbound routing mode (tenant-wide): personal lines vs one shared team line. */}
              <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 px-3 py-2 border-bottom bg-light small">
                <span>
                  <i className="bi bi-signpost-split me-1" aria-hidden="true" />
                  {t('admin.inboundMode', { defaultValue: 'Inbound routing' })}:{' '}
                  <strong>
                    {status.mode === 'personal'
                      ? t('admin.modePersonal', { defaultValue: 'Personal lines' })
                      : t('admin.modeShared', { defaultValue: 'Shared team line' })}
                  </strong>
                </span>
                {isAdmin && (
                  <ButtonGroup size="sm">
                    <Button
                      variant={status.mode !== 'personal' ? 'primary' : 'outline-primary'}
                      disabled={busy !== null}
                      onClick={() =>
                        void run(
                          'mode:shared',
                          () => VoiceAdminService.setMode(numaPost, 'shared'),
                          t('admin.modeSetShared', { defaultValue: 'Inbound now rings the whole team.' })
                        )
                      }
                    >
                      {t('admin.modeShared', { defaultValue: 'Shared team line' })}
                    </Button>
                    <Button
                      variant={status.mode === 'personal' ? 'primary' : 'outline-primary'}
                      disabled={busy !== null}
                      onClick={() =>
                        void run(
                          'mode:personal',
                          () => VoiceAdminService.setMode(numaPost, 'personal'),
                          t('admin.modeSetPersonal', { defaultValue: 'Owned lines now ring their owner.' })
                        )
                      }
                    >
                      {t('admin.modePersonal', { defaultValue: 'Personal lines' })}
                    </Button>
                  </ButtonGroup>
                )}
              </div>
              {!status.inboundReady && (
                <Alert variant="info" className="m-3 mb-0 small">
                  <i className="bi bi-info-circle me-2" aria-hidden="true" />
                  {t('admin.inboundNotReady', {
                    defaultValue:
                      'Inbound calling isn’t set up yet — numbers can make outbound calls but won’t receive any until the next deploy.',
                  })}
                </Alert>
              )}
              {(status.phoneNumbers ?? []).length === 0 ? (
                <div className="text-muted text-center py-4">
                  {t('admin.noNumbers', { defaultValue: 'No numbers claimed yet.' })}
                </div>
              ) : (
                <>
                  {!status.outboundCallerIdNumberId && (
                    <Alert variant="warning" className="m-3 mb-0 small">
                      <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
                      {isAdmin
                        ? t('admin.noCallerId', {
                            defaultValue:
                              'No outbound caller ID is set — outbound calls will fail until you set one below.',
                          })
                        : t('admin.noCallerIdUser', {
                            defaultValue:
                              'No outbound caller ID is set — outbound calls will fail. Ask your workspace admin to set one.',
                          })}
                    </Alert>
                  )}
                  {usage && (usage.totalMinutes > 0 || (usage.unattributed?.minutes ?? 0) > 0) && (
                    <p className="text-body-secondary small mb-2">
                      <i className="bi bi-graph-up me-1" aria-hidden="true" />
                      {t('admin.usageMonth', {
                        defaultValue: '{{minutes}} talk minutes this month',
                        minutes: usage.totalMinutes,
                      })}
                      {(usage.unattributed?.minutes ?? 0) > 0 && (
                        <span className="ms-2">
                          {t('admin.usageUnattributed', {
                            defaultValue: '({{minutes}} min on shared/unassigned lines)',
                            minutes: usage.unattributed?.minutes,
                          })}
                        </span>
                      )}
                    </p>
                  )}
                  <Table size="sm" hover responsive className="mb-0 align-middle">
                    <tbody>
                      {(status.phoneNumbers ?? []).map((n) => (
                        <tr key={n.id}>
                          <td className="font-monospace">{n.number}</td>
                          <td>
                            <Badge bg="light" text="dark" className="border me-2">
                              {n.countryCode} {n.type}
                            </Badge>
                            {n.id && n.id === status.outboundCallerIdNumberId && (
                              <Badge bg="success" className="me-1">
                                <i className="bi bi-telephone-outbound me-1" aria-hidden="true" />
                                {t('admin.callerIdBadge', { defaultValue: 'Caller ID' })}
                              </Badge>
                            )}
                            {n.owner ? (
                              <Badge bg={n.mine ? 'primary' : 'secondary'}>
                                <i className="bi bi-person-fill me-1" aria-hidden="true" />
                                {n.mine ? t('admin.yourLine', { defaultValue: 'Your line' }) : n.owner}
                              </Badge>
                            ) : (
                              <Badge bg="light" text="dark" className="border">
                                <i className="bi bi-people me-1" aria-hidden="true" />
                                {t('admin.sharedLine', { defaultValue: 'Shared' })}
                              </Badge>
                            )}
                            {n.id && (usageById.get(n.id)?.minutes ?? 0) > 0 && (
                              <Badge bg="light" text="dark" className="border ms-1">
                                <i className="bi bi-stopwatch me-1" aria-hidden="true" />
                                {t('admin.usageMinutes', {
                                  defaultValue: '{{minutes}} min this month',
                                  minutes: usageById.get(n.id)?.minutes,
                                })}
                              </Badge>
                            )}
                          </td>
                          <td className="text-end">
                            {/* Owner controls — available to ALL users (self-claim). The server
                              still enforces who may release which line. */}
                            {!n.owner && (
                              <Button
                                variant="outline-primary"
                                size="sm"
                                className="me-2"
                                disabled={busy !== null || !n.id}
                                onClick={() =>
                                  void run(
                                    `claim-own:${n.id}`,
                                    () => VoiceAdminService.setOwner(numaPost, n.id!),
                                    t('admin.claimedForYou', { defaultValue: 'This line is now yours.' })
                                  )
                                }
                              >
                                {busy === `claim-own:${n.id}` ? (
                                  <Spinner size="sm" animation="border" className="me-1" />
                                ) : null}
                                {t('admin.claimForMe', { defaultValue: 'Claim for me' })}
                              </Button>
                            )}
                            {n.owner && (isAdmin || n.mine) && (
                              <Button
                                variant="outline-warning"
                                size="sm"
                                className="me-2"
                                disabled={busy !== null || !n.id}
                                onClick={() =>
                                  void run(
                                    `unown:${n.id}`,
                                    () => VoiceAdminService.unsetOwner(numaDelete, n.id!),
                                    t('admin.lineReleased', { defaultValue: 'Line released to the shared pool.' })
                                  )
                                }
                              >
                                {busy === `unown:${n.id}` ? (
                                  <Spinner size="sm" animation="border" className="me-1" />
                                ) : null}
                                {t('admin.unassign', { defaultValue: 'Unassign' })}
                              </Button>
                            )}
                            {isAdmin && (
                              <>
                                {n.id && n.id === status.outboundCallerIdNumberId ? (
                                  <Button variant="success" size="sm" className="me-2" disabled>
                                    <i className="bi bi-check-lg me-1" aria-hidden="true" />
                                    {t('admin.callerIdBadge', { defaultValue: 'Caller ID' })}
                                  </Button>
                                ) : (
                                  <Button
                                    variant="outline-secondary"
                                    size="sm"
                                    className="me-2"
                                    disabled={busy !== null || !n.id}
                                    onClick={() =>
                                      void run(
                                        `callerid:${n.id}`,
                                        () => VoiceAdminService.setCallerId(numaPost, n.id!),
                                        t('admin.callerIdSet', {
                                          defaultValue: 'Outbound caller ID set to {{number}}.',
                                          number: n.number,
                                        })
                                      )
                                    }
                                  >
                                    {busy === `callerid:${n.id}` ? (
                                      <Spinner size="sm" animation="border" className="me-1" />
                                    ) : null}
                                    {t('admin.setCallerId', { defaultValue: 'Set as caller-ID' })}
                                  </Button>
                                )}
                                {n.id
                                  ? renderDestructive({
                                      actionKey: `release:${n.id}`,
                                      triggerLabel: t('admin.release', { defaultValue: 'Release' }),
                                      confirmLabel: t('admin.releaseConfirm', { defaultValue: 'Release number' }),
                                      warning: t('admin.releaseWarning', {
                                        defaultValue: 'Returns this number to AWS — it may not be reclaimable.',
                                      }),
                                      onConfirm: () => VoiceAdminService.releaseNumber(numaDelete, n.id!),
                                    })
                                  : null}
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
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
                          {isAdmin &&
                            renderDestructive({
                              actionKey: `rmOrigin:${o}`,
                              triggerLabel: t('admin.remove', { defaultValue: 'Remove' }),
                              confirmLabel: t('admin.removeOriginConfirm', { defaultValue: 'Remove origin' }),
                              warning:
                                o === numaOrigin
                                  ? t('admin.removeOriginWarningNuma', {
                                      defaultValue: 'This breaks the softphone for EVERY user in this workspace.',
                                    })
                                  : t('admin.removeOriginWarning', {
                                      defaultValue: 'Removing this origin may break the softphone for its users.',
                                    }),
                              onConfirm: () => VoiceAdminService.removeOrigin(numaDelete, o),
                            })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
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
    </>
  );
};

export default VoiceAdminPanel;

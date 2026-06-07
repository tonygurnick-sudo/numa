import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, Card, Dropdown, DropdownButton, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { getFlag } from '../../utils/featureFlags';
import { VoiceAdminService, type VoiceAdminStatus } from '../../Services/VoiceAdminService';

/**
 * VoiceAdminPanel — manage the tenant's Amazon Connect setup. The primary view is
 * AGENT-CENTRIC: each Numa user that has a voice agent is listed by name + email
 * (resolved from Cognito server-side — the Connect username is a bare sub UUID), with
 * the phone number they own or a "Claim number" action. Spare numbers nobody owns live
 * in a separate "Unassigned numbers" card, alongside Approved Origins and inbound mode.
 * Reads render for any user; mutations are admin-only (enforced server-side too), except
 * self-service actions on a user's own line.
 *
 * This is the reusable body — it carries no page header chrome so it can be dropped into
 * the admin Settings panel (Settings supplies its own header). Lives under Settings →
 * Admin → Voice; the old /voice/admin route redirects here.
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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

  // Agents split: humans get the agent-centric table; the shared system bot is a footnote.
  const agents = status?.agents ?? [];
  const humanAgents = agents.filter((a) => !a.isBot);
  const botAgent = agents.find((a) => a.isBot);
  // The "Unassigned numbers" card shows every DID NOT rendered inline on a human agent's
  // row: truly-unowned numbers AND orphans — a DID whose owner tag points at a deleted
  // user or the shared bot. Without the orphan case those numbers would be invisible
  // (no agent row, and filtered out of here), leaving paid resources unmanageable.
  const renderedOwners = new Set(humanAgents.map((a) => a.username).filter(Boolean));
  const unassignedNumbers = (status?.phoneNumbers ?? []).filter((n) => !n.owner || !renderedOwners.has(n.owner));

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
              </div>
            </Card.Body>
          </Card>

          {/* ── Agents (name + email + their line) ───────────────────────── */}
          <Card className="mb-3">
            <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="fw-semibold">
                <i className="bi bi-people me-2" aria-hidden="true" />
                {t('admin.agents', { defaultValue: 'Agents' })}
              </span>
              {isAdmin && humanAgents.length > 0 && (
                <Button
                  size="sm"
                  variant="outline-secondary"
                  disabled={busy !== null}
                  title={t('admin.syncNamesHint', {
                    defaultValue: "Repair agents' name & email in the Connect console from Numa accounts.",
                  })}
                  onClick={() =>
                    void run(
                      'syncIdentities',
                      () => VoiceAdminService.syncIdentities(numaPost),
                      t('admin.namesSynced', { defaultValue: 'Agent names synced to Connect.' })
                    )
                  }
                >
                  {busy === 'syncIdentities' ? (
                    <Spinner size="sm" animation="border" className="me-1" />
                  ) : (
                    <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />
                  )}
                  {t('admin.syncNames', { defaultValue: 'Sync names' })}
                </Button>
              )}
            </Card.Header>
            <Card.Body className="p-0">
              {humanAgents.length === 0 ? (
                <div className="text-muted text-center py-4">
                  {t('admin.noAgents', {
                    defaultValue: 'No agents yet — a user appears here after they open the softphone.',
                  })}
                </div>
              ) : (
                <Table size="sm" hover responsive className="mb-0 align-middle">
                  <tbody>
                    {humanAgents.map((a) => {
                      const canManage = isAdmin || !!a.isSelf;
                      return (
                        <tr key={a.id ?? a.username}>
                          {/* Identity */}
                          <td>
                            <div className="fw-semibold">
                              {a.displayName || a.username}
                              {a.isSelf && (
                                <Badge bg="primary" className="ms-2">
                                  {t('admin.you', { defaultValue: 'You' })}
                                </Badge>
                              )}
                            </div>
                            {a.email && <div className="text-muted small">{a.email}</div>}
                          </td>
                          {/* Their line */}
                          <td>
                            {a.phoneNumber ? (
                              <>
                                <span className="font-monospace">{a.phoneNumber}</span>
                                {a.countryCode && (
                                  <Badge bg="light" text="dark" className="border ms-2">
                                    {a.countryCode} {a.type}
                                  </Badge>
                                )}
                                {a.isCallerId && (
                                  <Badge bg="success" className="ms-1">
                                    <i className="bi bi-telephone-outbound me-1" aria-hidden="true" />
                                    {t('admin.callerIdBadge', { defaultValue: 'Caller ID' })}
                                  </Badge>
                                )}
                              </>
                            ) : (
                              <span className="text-muted fst-italic">
                                {t('admin.noNumber', { defaultValue: 'No number' })}
                              </span>
                            )}
                          </td>
                          {/* Actions */}
                          <td className="text-end">
                            {canManage && !a.phoneNumber && a.username && (
                              <DropdownButton
                                size="sm"
                                variant="outline-primary"
                                align="end"
                                disabled={busy !== null}
                                title={
                                  busy === `claim-agent:${a.username}` ? (
                                    <Spinner size="sm" animation="border" />
                                  ) : (
                                    t('admin.claimNumber', { defaultValue: 'Claim number' })
                                  )
                                }
                              >
                                {CLAIM_COUNTRIES.map((c) => (
                                  <Dropdown.Item
                                    key={c}
                                    onClick={() =>
                                      void run(
                                        `claim-agent:${a.username}`,
                                        () => VoiceAdminService.claimNumberForAgent(numaPost, c, a.username!),
                                        t('admin.claimedForAgent', {
                                          defaultValue: 'Claimed a {{country}} number for {{name}}.',
                                          country: c,
                                          name: a.displayName || a.email || a.username,
                                        })
                                      )
                                    }
                                  >
                                    {t('admin.claim', { defaultValue: 'Claim' })} {c}
                                  </Dropdown.Item>
                                ))}
                              </DropdownButton>
                            )}
                            {canManage && a.phoneNumber && a.phoneNumberId && (
                              <>
                                {isAdmin && !a.isCallerId && (
                                  <Button
                                    variant="outline-secondary"
                                    size="sm"
                                    className="me-2"
                                    disabled={busy !== null}
                                    onClick={() =>
                                      void run(
                                        `callerid:${a.phoneNumberId}`,
                                        () => VoiceAdminService.setCallerId(numaPost, a.phoneNumberId!),
                                        t('admin.callerIdSet', {
                                          defaultValue: 'Outbound caller ID set to {{number}}.',
                                          number: a.phoneNumber,
                                        })
                                      )
                                    }
                                  >
                                    {busy === `callerid:${a.phoneNumberId}` ? (
                                      <Spinner size="sm" animation="border" className="me-1" />
                                    ) : null}
                                    {t('admin.setCallerId', { defaultValue: 'Set as caller-ID' })}
                                  </Button>
                                )}
                                <Button
                                  variant="outline-warning"
                                  size="sm"
                                  className="me-2"
                                  disabled={busy !== null}
                                  onClick={() =>
                                    void run(
                                      `unown:${a.phoneNumberId}`,
                                      () => VoiceAdminService.unsetOwner(numaDelete, a.phoneNumberId!),
                                      t('admin.lineReleased', { defaultValue: 'Line released to the shared pool.' })
                                    )
                                  }
                                >
                                  {busy === `unown:${a.phoneNumberId}` ? (
                                    <Spinner size="sm" animation="border" className="me-1" />
                                  ) : null}
                                  {t('admin.unassign', { defaultValue: 'Unassign' })}
                                </Button>
                                {isAdmin && (
                                  <Button
                                    variant="outline-danger"
                                    size="sm"
                                    disabled={busy !== null}
                                    onClick={() =>
                                      void run(`release:${a.phoneNumberId}`, () =>
                                        VoiceAdminService.releaseNumber(numaDelete, a.phoneNumberId!)
                                      )
                                    }
                                  >
                                    {busy === `release:${a.phoneNumberId}` ? (
                                      <Spinner size="sm" animation="border" />
                                    ) : (
                                      t('admin.release', { defaultValue: 'Release' })
                                    )}
                                  </Button>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
              {botAgent && (
                <div className="px-3 py-2 border-top small text-muted">
                  <i className="bi bi-robot me-2" aria-hidden="true" />
                  {t('admin.botAgentNote', {
                    defaultValue: 'A shared system agent handles calls when no user is signed in.',
                  })}
                </div>
              )}
            </Card.Body>
          </Card>

          {/* ── Unassigned numbers + inbound routing ─────────────────────── */}
          <Card className="mb-3">
            <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="fw-semibold">
                <i className="bi bi-telephone me-2" aria-hidden="true" />
                {t('admin.unassignedNumbers', { defaultValue: 'Unassigned numbers' })}
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
                            defaultValue: 'No outbound caller ID is set — outbound calls will fail until you set one.',
                          })
                        : t('admin.noCallerIdUser', {
                            defaultValue:
                              'No outbound caller ID is set — outbound calls will fail. Ask your workspace admin to set one.',
                          })}
                    </Alert>
                  )}
                  {unassignedNumbers.length === 0 ? (
                    <div className="text-muted text-center py-4">
                      {t('admin.allAssigned', { defaultValue: 'Every number is assigned to an agent.' })}
                    </div>
                  ) : (
                    <Table size="sm" hover responsive className="mb-0 align-middle">
                      <tbody>
                        {unassignedNumbers.map((n) => (
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
                              {/* Owner tag set but no current agent owns it → a deleted user or the bot. */}
                              {n.owner && (
                                <Badge bg="warning" text="dark" title={n.ownerEmail || n.owner}>
                                  <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
                                  {t('admin.orphaned', {
                                    defaultValue: 'Orphaned — was {{name}}',
                                    name: n.ownerDisplayName || n.ownerEmail || n.owner,
                                  })}
                                </Badge>
                              )}
                            </td>
                            <td className="text-end">
                              {/* Non-admins may grab a spare number for themselves. */}
                              {!isAdmin && (
                                <Button
                                  variant="outline-primary"
                                  size="sm"
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
                              {isAdmin && (
                                <>
                                  {humanAgents.length > 0 && n.id && (
                                    <DropdownButton
                                      size="sm"
                                      variant="outline-primary"
                                      align="end"
                                      className="d-inline-block me-2"
                                      disabled={busy !== null}
                                      title={
                                        busy === `assign:${n.id}` ? (
                                          <Spinner size="sm" animation="border" />
                                        ) : (
                                          t('admin.assignTo', { defaultValue: 'Assign to' })
                                        )
                                      }
                                    >
                                      {/* Only agents WITH a username — passing undefined would make
                                        the backend fall back to assigning the DID to the admin (callerUser). */}
                                      {humanAgents
                                        .filter((a) => a.username)
                                        .map((a) => (
                                          <Dropdown.Item
                                            key={a.id ?? a.username}
                                            onClick={() =>
                                              void run(
                                                `assign:${n.id}`,
                                                () => VoiceAdminService.setOwner(numaPost, n.id!, a.username!),
                                                t('admin.assignedTo', {
                                                  defaultValue: '{{number}} assigned to {{name}}.',
                                                  number: n.number,
                                                  name: a.displayName || a.email || a.username,
                                                })
                                              )
                                            }
                                          >
                                            {a.displayName || a.email || a.username}
                                          </Dropdown.Item>
                                        ))}
                                    </DropdownButton>
                                  )}
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
                                  <Button
                                    variant="outline-danger"
                                    size="sm"
                                    disabled={busy !== null || !n.id}
                                    onClick={() =>
                                      void run(`release:${n.id}`, () =>
                                        VoiceAdminService.releaseNumber(numaDelete, n.id!)
                                      )
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

import { useState } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { Check, AlertTriangle } from 'lucide-react';
import type { TFunction } from 'i18next';
import { MethodBadge } from './MethodBadge';
import type { IntegrationMethod } from '../../Services/AdminIntegrationsService';

type ManageMethodCardProps = {
  method: IntegrationMethod;
  /** This is the currently-active method for the service. */
  isActive: boolean;
  /** This method has been configured (Pipedream enabled, or native credentials set up). */
  isConfigured: boolean;
  /** Service is in "let users pick" mode — neither method is forced as the
   *  default. The card shows an "Available" indicator instead of "Active",
   *  and the action button label reflects that picking activates *and* turns
   *  off user-choice mode. */
  isUserChoiceMode?: boolean;
  /** Native-only: the per-slug `ext-api-doc/<slug>/` files aren't deployed
   *  for this client. Greys the card out and disables Activate / Reconfigure
   *  so the admin can't drive the LLM into a state where it has to use the
   *  native connector without bundled API docs. */
  docsUnavailable?: boolean;
  t: TFunction;
  /** Make this method the active one. For an unconfigured native method this
   *  should kick off the credential wizard; for Pipedream it's a one-PUT
   *  enable. The callback can be async — the card shows a spinner while it
   *  resolves. */
  onActivate: () => Promise<void> | void;
  /** Optional: open the credential wizard for an already-configured native
   *  method without changing the active selection. Pipedream doesn't have an
   *  equivalent (no per-workspace OAuth client to reconfigure). */
  onReconfigure?: () => void;
};

/**
 * One option inside the Manage modal's "Connection method" section.
 *
 * Three visual states:
 *   1. Active + configured  — green check, no action button (it's already in use)
 *   2. Configured but not active — "Use this method" button to switch
 *   3. Not configured — "Set up" button (with a setup-required notice)
 */
export const ManageMethodCard = ({
  method,
  isActive,
  isConfigured,
  isUserChoiceMode = false,
  docsUnavailable = false,
  t,
  onActivate,
  onReconfigure,
}: ManageMethodCardProps) => {
  const [busy, setBusy] = useState(false);

  const handleActivate = async () => {
    setBusy(true);
    try {
      await onActivate();
    } finally {
      setBusy(false);
    }
  };

  const isPipedream = method === 'pipedream';
  // docsUnavailable is native-only by design — Pipedream rides on the proxy
  // account's docs and doesn't need per-slug `ext-api-doc/`. Guard here so a
  // caller passing the flag for a Pipedream card doesn't accidentally lock
  // the Pipedream side too.
  const docsLocked = docsUnavailable && !isPipedream;
  const docsTooltip = docsLocked ? t('dataConnectors.oauth.docsUnavailable') : undefined;
  const heading = isPipedream
    ? t('manage.method.pipedreamHeading', { defaultValue: 'Pipedream' })
    : t('manage.method.nativeHeading', { defaultValue: 'Native connector' });
  const description = isPipedream
    ? t('manage.method.pipedreamBody', {
        defaultValue:
          "Pipedream-managed OAuth. Numa's shared OAuth app, broad pre-built action library users can call from chat.",
      })
    : t('manage.method.nativeBody', {
        defaultValue:
          'Direct OAuth with the service. Tighter scopes, surfaced in Files Remote, simpler permissions for users.',
      });

  // In user-choice mode (admin lets users pick), neither card is "Active"
  // — both are "Available" to the user. The activate button still works but
  // its semantic shifts: clicking it forces this method as the default and
  // turns off user-choice mode. Button label stays "Use this method"
  // everywhere for consistency.
  const showAvailable = isUserChoiceMode && isConfigured;
  const showActive = isActive && !isUserChoiceMode;
  const useThisLabel = t('manage.method.useThis', { defaultValue: 'Use this method' });

  return (
    <div
      className={`border rounded-3 p-3 ${showActive ? 'border-primary bg-primary bg-opacity-10' : 'bg-white'}`}
      title={docsTooltip}
      style={docsLocked ? { opacity: 0.45, filter: 'grayscale(100%)' } : undefined}
    >
      <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
        <div className="d-flex align-items-center gap-2">
          <MethodBadge method={method} size="xs" />
          <strong>{heading}</strong>
          {showActive && (
            <span className="text-primary small d-inline-flex align-items-center gap-1 ms-1">
              <Check size={14} />
              {t('manage.method.active', { defaultValue: 'Active' })}
            </span>
          )}
          {showAvailable && (
            <span className="text-muted small d-inline-flex align-items-center gap-1 ms-1">
              <Check size={14} />
              {t('manage.method.available', { defaultValue: 'Available' })}
            </span>
          )}
        </div>
      </div>
      <p className="small text-muted mb-2">{description}</p>

      {docsLocked && (
        <div className="small d-flex align-items-start gap-2 text-warning mb-2">
          <AlertTriangle size={14} className="flex-shrink-0 mt-1" />
          <span>{t('dataConnectors.oauth.docsUnavailable')}</span>
        </div>
      )}

      {!isConfigured && !isPipedream && !docsLocked && (
        <div className="small d-flex align-items-start gap-2 text-warning mb-2">
          <AlertTriangle size={14} className="flex-shrink-0 mt-1" />
          <span>
            {t('manage.method.nativeSetupNeeded', {
              defaultValue:
                'Setup required: register an OAuth app with this service and paste the client ID + secret. Takes a few minutes.',
            })}
          </span>
        </div>
      )}

      <div className="d-flex gap-2">
        {!showActive && (
          <Button variant="primary" size="sm" onClick={() => void handleActivate()} disabled={busy || docsLocked}>
            {busy ? (
              <Spinner size="sm" />
            ) : isConfigured ? (
              useThisLabel
            ) : (
              t('manage.method.setUp', { defaultValue: 'Set up' })
            )}
          </Button>
        )}
        {isConfigured && onReconfigure && (
          <Button variant="outline-secondary" size="sm" onClick={onReconfigure} disabled={busy || docsLocked}>
            <i className="bi bi-gear me-1" />
            {t('manage.method.reconfigure', { defaultValue: 'Reconfigure' })}
          </Button>
        )}
      </div>
    </div>
  );
};

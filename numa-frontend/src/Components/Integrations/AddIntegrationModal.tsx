import { useEffect, useMemo, useState } from 'react';
import { Modal, Form, InputGroup, Button } from 'react-bootstrap';
import { Search, ArrowLeft, AlertTriangle, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MethodBadge } from './MethodBadge';
import { AuthTypeBadge } from '../DataConnectors/AuthTypeBadge';
import { getFlag } from '../../utils/featureFlags';
import type { IntegrationMethod } from '../../Services/AdminIntegrationsService';
import {
  getAllConnections,
  getConnectionIcon,
  getConnectionFallbackIcon,
  type ConnectionConfigEntry,
} from '../../config/integrationsConfig';
import { CONNECTOR_REGISTRY, type ConnectorTemplate } from '../DataConnectors/connectorRegistry';
import type { IntegrationPickerEntry } from './integrationCatalogHelpers';

export type { IntegrationPickerEntry };

/**
 * Method selected from the add flow. `'user_choice'` is only possible for
 * dual-method services and means "enable Pipedream now AND launch the native
 * wizard, leave preferred_method=null so users pick at connect time."
 */
export type AddIntegrationMethod = IntegrationMethod | 'user_choice';

type AddIntegrationModalProps = {
  show: boolean;
  onHide: () => void;
  /** Set of already-added entry keys, to dim them in the picker. */
  addedKeys: Set<string>;
  /** Maps connector slug -> Pipedream slug for the same external service. */
  pipedreamForConnector: Record<string, string>;
  /**
   * Called once the admin has chosen a service AND (when applicable) the
   * connection method. For services with a single method available the modal
   * skips the method step and calls this immediately. For dual-method
   * services the admin picks one first; the chosen method is passed back so
   * the caller can either enable Pipedream (one PUT), launch the native
   * setup wizard, or kick off the dual setup for "let users pick" mode.
   */
  onSelect: (entry: IntegrationPickerEntry, method: AddIntegrationMethod) => void;
};

type Step = { kind: 'pick' } | { kind: 'method'; entry: IntegrationPickerEntry };

/**
 * Build the union of services available across both backends, deduplicated
 * so a service that exists as both methods (Gmail, Drive, Dropbox, ...) shows
 * up once with its Pipedream-side icon as the canonical representation.
 *
 * Native-only services (Synergy, Workbench, Fergus, ...) appear with their
 * registry icon class. Anything in the contact-required tier of the connector
 * registry is excluded — you can't actually connect those, so listing them
 * in the picker would set the admin up for a dead-end click.
 */
function buildPickerEntries(
  pipedreamApps: ConnectionConfigEntry[],
  connectors: ConnectorTemplate[],
  pipedreamForConnector: Record<string, string>,
  addedKeys: Set<string>,
  nativeIntegrationsEnabled: boolean
): IntegrationPickerEntry[] {
  const seenConnectors = new Set<string>();
  const out: IntegrationPickerEntry[] = [];

  // Index connectors by slug so the Pipedream loop can pull authType + category
  // for any paired native entry without a second pass.
  const connectorsBySlug = new Map(connectors.map((c) => [c.id, c]));

  for (const app of pipedreamApps) {
    // The connector slug for this Pipedream app, if there's a paired native one.
    // When native integrations are admin-disabled, the catalog returns no
    // pairings, so this is naturally `undefined` and dual-method services
    // collapse to Pipedream-only — which is the intended behaviour.
    const pairedConnector = Object.entries(pipedreamForConnector).find(([, pdSlug]) => pdSlug === app.id)?.[0];
    if (pairedConnector) seenConnectors.add(pairedConnector);
    const paired = pairedConnector ? connectorsBySlug.get(pairedConnector) : undefined;

    out.push({
      key: app.id,
      name: app.name,
      description: app.description,
      iconUrl: getConnectionIcon(app.id),
      iconClass: getConnectionFallbackIcon(app.id),
      pipedreamSlug: app.id,
      connectorSlug: pairedConnector,
      alreadyAdded: addedKeys.has(app.id),
      nativeAuthType: paired?.authType,
    });
  }

  // Native-only services (Synergy, SharePoint, Fergus, etc.) live entirely in
  // the connector registry — they have no Pipedream counterpart. Skip this
  // loop when the workspace has native integrations disabled, otherwise the
  // picker would surface services the user can't actually add.
  if (nativeIntegrationsEnabled) {
    for (const c of connectors) {
      if (seenConnectors.has(c.id)) continue;
      // Contact-required (tier 3) connectors have no self-service connect path —
      // surfacing them in the admin picker just leads to a dead click. Discovery
      // of these belongs in marketing/docs, not in the add-integration modal.
      if (c.authType === 'contact-required') continue;
      // Username/password connectors aren't viable for self-service: the
      // credentials we'd collect at this step are user-level, not admin-level,
      // and the supported auth methods are OAuth, API key, and PAT token.
      if (c.authType === 'username-password') continue;
      out.push({
        key: c.id,
        name: c.displayName,
        description: c.description,
        iconClass: c.icon,
        connectorSlug: c.id,
        alreadyAdded: addedKeys.has(c.id),
        nativeAuthType: c.authType,
      });
    }
  }

  return out.sort((a, b) => Number(a.alreadyAdded) - Number(b.alreadyAdded) || a.name.localeCompare(b.name));
}

export const AddIntegrationModal = ({
  show,
  onHide,
  addedKeys,
  pipedreamForConnector,
  onSelect,
}: AddIntegrationModalProps) => {
  const { t } = useTranslation('integrations');
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'pick' });

  // Reset to picker step whenever the modal closes — otherwise reopening
  // would land the admin back on the previous service's method screen.
  useEffect(() => {
    if (!show) {
      setStep({ kind: 'pick' });
      setQuery('');
    }
  }, [show]);

  const nativeIntegrationsEnabled = getFlag('DATA_CONNECTORS_ENABLED');
  const allEntries = useMemo(
    () =>
      buildPickerEntries(
        getAllConnections(),
        CONNECTOR_REGISTRY,
        pipedreamForConnector,
        addedKeys,
        nativeIntegrationsEnabled
      ),
    [pipedreamForConnector, addedKeys, nativeIntegrationsEnabled]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allEntries;
    return allEntries.filter(
      (e) => e.name.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q)
    );
  }, [query, allEntries]);

  const handleClick = (entry: IntegrationPickerEntry) => {
    if (entry.alreadyAdded) return;
    const hasPipedream = Boolean(entry.pipedreamSlug);
    const hasNative = Boolean(entry.connectorSlug);
    // Single-method services: skip the method screen — there's nothing to choose.
    if (hasPipedream && !hasNative) {
      onSelect(entry, 'pipedream');
      return;
    }
    if (!hasPipedream && hasNative) {
      onSelect(entry, 'native');
      return;
    }
    // Dual-method: ask the admin to pick + show setup tradeoffs.
    setStep({ kind: 'method', entry });
  };

  const handleMethodPick = (method: AddIntegrationMethod) => {
    if (step.kind !== 'method') return;
    onSelect(step.entry, method);
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center gap-2">
          {step.kind === 'method' && (
            <Button
              variant="link"
              size="sm"
              className="p-0 text-decoration-none"
              onClick={() => setStep({ kind: 'pick' })}
              aria-label={t('addModal.back', { defaultValue: 'Back' })}
            >
              <ArrowLeft size={18} />
            </Button>
          )}
          <span>
            {step.kind === 'pick'
              ? t('addModal.title', { defaultValue: 'Add integration' })
              : t('addModal.methodTitle', { defaultValue: 'Choose connection method' })}
          </span>
        </Modal.Title>
      </Modal.Header>
      {step.kind === 'pick' ? (
        <Modal.Body>
          <p className="text-muted small mb-3">
            {t('addModal.intro', {
              defaultValue:
                'Pick a service to add. Services with multiple connection options will ask you which to use next.',
            })}
          </p>
          <InputGroup className="mb-3">
            <InputGroup.Text>
              <Search size={14} />
            </InputGroup.Text>
            <Form.Control
              placeholder={t('addModal.searchPlaceholder', { defaultValue: 'Search integrations...' })}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </InputGroup>
          {/* Card grid: mirrors the old DataConnectors PlatformPickerModal —
              3-column on lg, 2-column on md, bordered cards with a hover
              border highlight. Click anywhere on the card to select. */}
          <div className="row g-3" style={{ maxHeight: 520, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div className="col-12 text-center text-muted py-4">
                {t('addModal.noResults', { defaultValue: 'No integrations match your search.' })}
              </div>
            )}
            {filtered.map((entry) => {
              const hasPipedream = Boolean(entry.pipedreamSlug);
              const hasNative = Boolean(entry.connectorSlug);
              const disabled = entry.alreadyAdded;
              return (
                <div key={entry.key} className="col-md-6 col-lg-4">
                  <div
                    className="border rounded p-3 h-100 d-flex flex-column"
                    style={{
                      cursor: disabled ? 'default' : 'pointer',
                      transition: 'border-color 0.15s',
                      opacity: disabled ? 0.6 : 1,
                    }}
                    onClick={() => handleClick(entry)}
                    onMouseEnter={(e) => {
                      if (!disabled) e.currentTarget.style.borderColor = '#0d6efd';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '';
                    }}
                    role={disabled ? undefined : 'button'}
                    tabIndex={disabled ? -1 : 0}
                    onKeyDown={(e) => {
                      if (!disabled && e.key === 'Enter') handleClick(entry);
                    }}
                  >
                    {/* Header: icon + name (wraps) + "Added" badge top-right. */}
                    <div className="d-flex align-items-start gap-2 mb-2">
                      {entry.iconUrl ? (
                        <img
                          src={entry.iconUrl}
                          alt=""
                          width={24}
                          height={24}
                          style={{ objectFit: 'contain', flexShrink: 0, marginTop: 2 }}
                        />
                      ) : entry.iconClass ? (
                        <i
                          className={entry.iconClass}
                          style={{ fontSize: '1.4rem', flexShrink: 0, lineHeight: 1, marginTop: 2 }}
                        />
                      ) : null}
                      <strong className="flex-grow-1" style={{ fontSize: '0.95rem', lineHeight: 1.25 }}>
                        {entry.name}
                      </strong>
                      {entry.alreadyAdded && (
                        <span
                          className="badge bg-success border border-success text-white flex-shrink-0"
                          style={{ fontSize: '0.65rem' }}
                        >
                          {t('addModal.alreadyAdded', { defaultValue: 'Added' })}
                        </span>
                      )}
                    </div>
                    {entry.description && (
                      <p className="text-muted small mb-2 flex-grow-1" style={{ fontSize: '0.8rem' }}>
                        {entry.description}
                      </p>
                    )}
                    {/* Method + auth-type pills. For dual-method services we
                        show a Pipedream pill alongside the native auth badge
                        so admins see both routes at a glance. */}
                    <div className="d-flex gap-1 flex-wrap align-items-center">
                      {hasPipedream && <MethodBadge method="pipedream" size="xs" />}
                      {hasNative && entry.nativeAuthType && <AuthTypeBadge authType={entry.nativeAuthType} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Modal.Body>
      ) : (
        <MethodChoiceStep entry={step.entry} onPick={handleMethodPick} />
      )}
    </Modal>
  );
};

/**
 * Step 2 of the add flow: dual-method service selected, admin picks which
 * backend to wire up. Each option carries the setup requirements clearly so
 * the admin doesn't accidentally pick "Native" expecting a one-click flow.
 */
const MethodChoiceStep = ({
  entry,
  onPick,
}: {
  entry: IntegrationPickerEntry;
  onPick: (method: AddIntegrationMethod) => void;
}) => {
  const { t } = useTranslation('integrations');
  return (
    <Modal.Body>
      <div className="d-flex align-items-center gap-3 mb-3 pb-3 border-bottom">
        <span
          className="rounded d-flex align-items-center justify-content-center flex-shrink-0"
          style={{ width: 44, height: 44, background: '#fff', border: '1px solid #dee2e6' }}
        >
          {entry.iconUrl ? (
            <img src={entry.iconUrl} alt="" width={28} height={28} style={{ objectFit: 'contain' }} />
          ) : entry.iconClass ? (
            <i className={entry.iconClass} style={{ fontSize: '1.4rem' }} />
          ) : null}
        </span>
        <div>
          <div className="fw-semibold">{entry.name}</div>
          {entry.description && <div className="small text-muted">{entry.description}</div>}
        </div>
      </div>
      <p className="small text-muted mb-3">
        {t('addModal.methodIntro', {
          defaultValue:
            "This service is available through both Numa's native connector and Pipedream. Pick the method that fits this workspace.",
        })}
      </p>
      <div className="d-grid gap-2">
        <button
          type="button"
          className="btn btn-light text-start border"
          style={{ padding: '0.85rem 1rem' }}
          onClick={() => onPick('user_choice')}
        >
          <div className="d-flex align-items-center gap-2 mb-1">
            <span
              className="badge bg-info-subtle text-info-emphasis border border-info-subtle d-inline-flex align-items-center"
              style={{
                fontSize: '0.7rem',
                padding: '0.15rem 0.5rem',
                gap: '0.3rem',
                fontWeight: 500,
                letterSpacing: '0.01em',
                lineHeight: 1.2,
                verticalAlign: 'middle',
              }}
            >
              <Users size={11} strokeWidth={2.25} aria-hidden style={{ flexShrink: 0 }} />
              {t('addModal.userChoiceBadge', { defaultValue: 'User choice' })}
            </span>
            <strong>{t('addModal.userChoiceHeading', { defaultValue: 'Let users pick' })}</strong>
          </div>
          <div className="small text-muted mb-2">
            {t('addModal.userChoiceBody', {
              defaultValue:
                'Enable both methods. Users see both options at connect time and pick the one that fits them — no default forced.',
            })}
          </div>
          <div className="small d-flex align-items-start gap-2 text-warning">
            <AlertTriangle size={14} className="flex-shrink-0 mt-1" />
            <span>
              {t('addModal.userChoiceSetup', {
                defaultValue:
                  'Enables Pipedream immediately, then opens the native setup wizard so both methods are available.',
              })}
            </span>
          </div>
        </button>
        <button
          type="button"
          className="btn btn-light text-start border"
          style={{ padding: '0.85rem 1rem' }}
          onClick={() => onPick('native')}
        >
          <div className="d-flex align-items-center gap-2 mb-1">
            <MethodBadge method="native" size="xs" />
            <strong>{t('addModal.nativeHeading', { defaultValue: 'Native connector' })}</strong>
          </div>
          <div className="small text-muted mb-2">
            {t('addModal.nativeBody', {
              defaultValue:
                'Direct OAuth with the service. Tighter scopes, surfaced in Files Remote, simpler permissions for your users.',
            })}
          </div>
          <div className="small d-flex align-items-start gap-2 text-warning">
            <AlertTriangle size={14} className="flex-shrink-0 mt-1" />
            <span>
              {t('addModal.nativeSetup', {
                defaultValue:
                  "Setup required: you'll register an OAuth app with this service and paste the client ID + secret. Takes a few minutes.",
              })}
            </span>
          </div>
        </button>
        <button
          type="button"
          className="btn btn-light text-start border"
          style={{ padding: '0.85rem 1rem' }}
          onClick={() => onPick('pipedream')}
        >
          <div className="d-flex align-items-center gap-2 mb-1">
            <MethodBadge method="pipedream" size="xs" />
            <strong>{t('addModal.pipedreamHeading', { defaultValue: 'Pipedream' })}</strong>
          </div>
          <div className="small text-muted mb-2">
            {t('addModal.pipedreamBody', {
              defaultValue:
                "Pipedream-managed OAuth. Numa's shared OAuth app, broad pre-built action library users can call from chat.",
            })}
          </div>
          <div className="small text-success">
            <i className="bi bi-check-circle me-1" />
            {t('addModal.pipedreamSetup', {
              defaultValue: 'No setup required — enables immediately on this workspace.',
            })}
          </div>
        </button>
      </div>
    </Modal.Body>
  );
};

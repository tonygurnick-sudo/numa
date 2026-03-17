import { useCallback, useEffect, useMemo, useState } from 'react';
import { getFlag } from '../../utils/featureFlags';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Grid3X3, Plus } from 'lucide-react';
import { DataConnectorsService } from '../../Services/DataConnectorsService';
import { OAuthProvidersService } from '../../Services/OAuthProvidersService';
import type { DataConnectorStatus } from '../../types/dataConnectors';
import type { OAuthProviderInfo } from '../../types/oauthProviders';
import type { VaultSecretMetadata } from '../../Services/VaultService';
import {
  listCompanySecrets,
  deleteCompanySecret,
  getCompanySecret,
  updateCompanySecret,
} from '../../Services/VaultService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useAuth } from '../../Providers/AuthProvider';
// SynergyConnectorCard removed — Synergy now uses standard connector flow
import { OAuthConnectorCard } from './OAuthConnectorCard';
// SynergyWizard removed — Synergy now uses ApiKeyWizard via standard flow
import { OAuthWizard } from './wizards/OAuthWizard';
import { PlatformPickerModal } from './wizards/PlatformPickerModal';
import { ApiKeyWizard } from './wizards/ApiKeyWizard';
// ACCEPT 3af3ef8e: GoogleCloudSetupWizard is a new feature added in the incoming commit.
// To revert: remove this import and the wizard state/JSX below.
import { GoogleCloudSetupWizard } from './wizards/GoogleCloudSetupWizard';
import EventConfigPanel from './EventConfigPanel';
import type { GlobalDataConnectorSettingsMap } from '../../Services/AdminDataConnectorsService';
import {
  getOAuthProviderTemplates,
  getOAuthConnectors,
  getNonOAuthConnectors,
  getContactRequired,
  getConnectorById,
  // CHOSE HEAD: getOAuthSecretId needed for platform-connector disconnect logic.
  getOAuthSecretId,
  // CHOSE HEAD: getConnectorsByPlatform needed for mergedOAuthProviders filtering.
  getConnectorsByPlatform,
} from './connectorRegistry';
import type { ConnectorTemplate } from './connectorRegistry';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type DataConnectorsTabProps = {
  adminSettings?: GlobalDataConnectorSettingsMap;
};

export const DataConnectorsTab = ({ adminSettings }: DataConnectorsTabProps) => {
  const { t } = useTranslation('integrations');
  const { numaGet } = useNumaRequest();
  const { user } = useAuth();
  const isAdmin = Boolean(user?.groups?.includes('admin'));

  const [_statusItems, setStatusItems] = useState<DataConnectorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const vaultEnabled = getFlag('SECRETS_VAULT_ENABLED');
  const oauthAvailable = getFlag('OAUTH_AVAILABLE');

  // ---------------------------------------------------------------------------
  // Dynamic OAuth provider state
  // ---------------------------------------------------------------------------

  const [oauthProviders, setOauthProviders] = useState<OAuthProviderInfo[]>([]);
  const [companySecrets, setCompanySecrets] = useState<VaultSecretMetadata[]>([]);

  // ---------------------------------------------------------------------------
  // Wizard state
  // ---------------------------------------------------------------------------

  // synergyWizardOpen removed — Synergy now uses standard connector flow
  const [oauthWizardOpen, setOauthWizardOpen] = useState(false);
  const [oauthWizardProviderId, setOauthWizardProviderId] = useState<string | undefined>(undefined);
  const [oauthWizardIsNew, setOauthWizardIsNew] = useState(false);

  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);
  const [apiKeyWizardOpen, setApiKeyWizardOpen] = useState(false);
  const [apiKeyWizardConnector, setApiKeyWizardConnector] = useState<ConnectorTemplate | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  // CHOSE HEAD: recentlySavedIds used in configuredIds to show newly-saved connectors before cache refresh.
  const [recentlySavedIds, setRecentlySavedIds] = useState<Set<string>>(new Set());
  // ACCEPT 3af3ef8e: googleSetupWizardOpen is a new feature from the incoming commit.
  const [googleSetupWizardOpen, setGoogleSetupWizardOpen] = useState(false);
  const [eventConfigConnectorId, setEventConfigConnectorId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Registry-derived templates (for backward compat with OAuthWizard)
  // ---------------------------------------------------------------------------

  const oauthTemplates = useMemo(() => getOAuthProviderTemplates(), []);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const items = await DataConnectorsService.listStatus(numaGet);
      setStatusItems(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('dataConnectors.errors.loadFailed');
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [numaGet]);

  const loadOAuthProviders = useCallback(
    async (refresh = false) => {
      if (!oauthAvailable) return;
      try {
        const providers = await OAuthProvidersService.listProviders(refresh);
        setOauthProviders(providers);
      } catch {
        setOauthProviders([]);
      }
    },
    [oauthAvailable]
  );

  const loadCompanySecrets = useCallback(async () => {
    if (!vaultEnabled) return;
    try {
      const secrets = await listCompanySecrets();
      setCompanySecrets(secrets);
    } catch {
      setCompanySecrets([]);
    }
  }, [vaultEnabled]);

  useEffect(() => {
    loadStatus();
    loadOAuthProviders();
    loadCompanySecrets();
  }, [loadStatus, loadOAuthProviders, loadCompanySecrets]);

  const getConnectorSecret = (connectorId: string): VaultSecretMetadata | undefined =>
    companySecrets.find((s) => s.name === `connector-${connectorId}`);

  // Set of all configured connector IDs (for platform picker badge)
  const configuredIds = useMemo(() => {
    const ids = new Set<string>();
    // Non-OAuth connectors: direct vault match
    for (const s of companySecrets) {
      if (s.name.startsWith('connector-')) ids.add(s.name.replace('connector-', ''));
    }
    // OAuth connectors: backend provider list (per-connector entries)
    for (const p of oauthProviders) {
      ids.add(p.id);
    }
    // Include recently saved connectors that may not be in backend cache yet
    for (const id of recentlySavedIds) {
      ids.add(id);
    }
    return ids;
  }, [companySecrets, oauthProviders, recentlySavedIds]);

  // Filter secrets by category for each wizard
  const oauthSecrets = useMemo(() => companySecrets.filter((s) => s.category === 'OAuth Clients'), [companySecrets]);
  const connectorSecrets = useMemo(
    () => companySecrets.filter((s) => s.category === 'Connector Credentials'),
    [companySecrets]
  );

  // ---------------------------------------------------------------------------
  // Merged provider list (registry OAuth always present + API data)
  // ---------------------------------------------------------------------------

  const oauthConnectorDefs = useMemo(() => getOAuthConnectors(), []);

  const mergedOAuthProviders = useMemo(() => {
    const registryIds = new Set(oauthConnectorDefs.map((c) => c.id));

    const merged: OAuthProviderInfo[] = oauthConnectorDefs.map((ct) => {
      const fromApi = oauthProviders.find((p) => p.id === ct.id);
      return {
        id: ct.id,
        display_name: fromApi?.display_name || ct.displayName,
        icon: fromApi?.icon || ct.icon,
        description: fromApi?.description || ct.description,
        configured: fromApi?.configured ?? false,
      };
    });

    for (const provider of oauthProviders) {
      // Skip platform-name entries (e.g. 'google') — only show individual connectors
      if (!registryIds.has(provider.id) && getConnectorsByPlatform(provider.id).length === 0) {
        merged.push(provider);
      }
    }

    return merged;
  }, [oauthProviders, oauthConnectorDefs]);

  // Non-OAuth connectors from registry
  const nonOAuthConnectors = useMemo(() => getNonOAuthConnectors(), []);
  const contactRequiredConnectors = useMemo(() => getContactRequired(), []);

  const totalConnectors =
    1 + mergedOAuthProviders.length + nonOAuthConnectors.length + contactRequiredConnectors.length;

  // ---------------------------------------------------------------------------
  // Wizard open helpers
  // ---------------------------------------------------------------------------

  const adminDisabled = adminSettings?.synergy?.status === 'disabled';

  const openOAuthWizardExisting = (providerId: string) => {
    setOauthWizardProviderId(providerId);
    setOauthWizardIsNew(false);
    setOauthWizardOpen(true);
  };

  const handlePlatformSelected = (connector: ConnectorTemplate) => {
    setPlatformPickerOpen(false);

    if (connector.authType === 'oauth2') {
      setOauthWizardProviderId(connector.id);
      setOauthWizardIsNew(false);
      setOauthWizardOpen(true);
    } else if (connector.authType === 'contact-required') {
      // No wizard for contact-required — they're just info cards
      return;
    } else {
      // api-key, token, username-password
      setApiKeyWizardConnector(connector);
      setApiKeyWizardOpen(true);
    }
  };

  const handleOAuthSaved = async (connectorId?: string) => {
    if (connectorId) {
      setRecentlySavedIds((prev) => new Set([...prev, connectorId]));
    }
    OAuthProvidersService.clearProvidersCache();
    await Promise.all([loadCompanySecrets(), loadOAuthProviders(true)]);
  };

  const handleApiKeySaved = async () => {
    await loadCompanySecrets();
  };

  const handleOAuthTest = async (providerId: string) => {
    await OAuthProvidersService.connect(providerId);
  };

  const handleOAuthDisconnect = async (providerId: string, displayName: string) => {
    const confirmed = window.confirm(t('dataConnectors.confirm.disconnect', { name: displayName }));
    if (!confirmed) return;
    setDisconnectingId(providerId);
    try {
      const connector = getConnectorById(providerId);
      const isOAuth = connector?.authType === 'oauth2';

      // Only try OAuth revoke for OAuth connectors
      if (isOAuth) {
        try {
          await OAuthProvidersService.disconnect(providerId);
        } catch {
          // May fail if no tokens exist — continue to delete vault secret
        }
      }

      if (connector?.oauthPlatform) {
        // Platform connector: remove from enabled_connectors, only delete secret if none remain
        const secretName = `oauth-client-${getOAuthSecretId(providerId)}`;
        const full = await getCompanySecret(secretName);
        const enabledStr = full?.fields?.enabled_connectors || '';
        const enabled = new Set(enabledStr.split(',').filter(Boolean));
        enabled.delete(providerId);
        if (enabled.size === 0) {
          await deleteCompanySecret(secretName);
        } else {
          await updateCompanySecret(secretName, {
            fields: { enabled_connectors: Array.from(enabled).join(',') },
          });
        }
      } else if (isOAuth) {
        await deleteCompanySecret(`oauth-client-${providerId}`);
      } else {
        // Token/API-key connector: secret is connector-{id}
        await deleteCompanySecret(`connector-${providerId}`);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t('dataConnectors.errors.disconnectFailed', { name: displayName });
      setLoadError(msg);
    } finally {
      OAuthProvidersService.clearProvidersCache();
      await Promise.all([loadCompanySecrets(), loadOAuthProviders()]);
      setDisconnectingId(null);
    }
  };

  const handleConnectorDelete = async (connectorId: string, displayName: string) => {
    const confirmed = window.confirm(t('dataConnectors.confirm.deleteCredentials', { name: displayName }));
    if (!confirmed) return;
    setDisconnectingId(connectorId);
    try {
      await deleteCompanySecret(`connector-${connectorId}`);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t('dataConnectors.errors.disconnectFailed', { name: displayName });
      setLoadError(msg);
    } finally {
      await loadCompanySecrets();
      setDisconnectingId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3 text-muted">{t('dataConnectors.loading')}</p>
      </div>
    );
  }

  return (
    <div>
      {loadError && (
        <Alert variant="danger" className="mb-3">
          {loadError}
        </Alert>
      )}
      {adminDisabled && (
        <Alert variant="info" className="mb-3">
          {t('dataConnectors.disabled')}
        </Alert>
      )}
      <div className="integrations-section-heading">
        <div className="integrations-available-heading">
          <Grid3X3 size={18} className="integrations-available-heading__icon" aria-hidden="true" />
          <h4 className="integrations-available-heading__text mb-0">
            {t('dataConnectors.available', { count: totalConnectors })}
          </h4>
        </div>
        {isAdmin && (
          <div className="d-flex gap-2 ms-auto">
            <Button variant="outline-secondary" size="sm" onClick={() => setGoogleSetupWizardOpen(true)}>
              <i className="bi bi-google me-1" />
              {t('dataConnectors.googleCloudSetup.setupButton')}
            </Button>
            <Button variant="outline-primary" size="sm" onClick={() => setPlatformPickerOpen(true)}>
              <Plus size={14} className="me-1" />
              {t('dataConnectors.picker.addConnector')}
            </Button>
          </div>
        )}
      </div>
      <div className="mt-3">
        {/* OAuth Provider Cards — only show configured ones */}
        {mergedOAuthProviders
          .filter((provider) => configuredIds.has(provider.id))
          .map((provider) => (
            <OAuthConnectorCard
              key={provider.id}
              providerId={provider.id}
              displayName={provider.display_name}
              icon={provider.icon}
              description={provider.description}
              credentialConfigured
              onConfigure={() => openOAuthWizardExisting(provider.id)}
              onTest={() => handleOAuthTest(provider.id)}
              isLoading={false}
              adminDisabled={false}
              onDisconnect={isAdmin ? () => handleOAuthDisconnect(provider.id, provider.display_name) : undefined}
              isDisconnecting={disconnectingId === provider.id}
            />
          ))}

        {/* Non-OAuth Connector Cards — only show configured ones, exclude those already in backend provider list */}
        {nonOAuthConnectors
          .filter(
            (connector) => !!getConnectorSecret(connector.id) && !oauthProviders.some((p) => p.id === connector.id)
          )
          .map((connector) => (
            <OAuthConnectorCard
              key={connector.id}
              providerId={connector.id}
              displayName={connector.displayName}
              icon={connector.icon}
              description={connector.description}
              credentialConfigured
              onConfigure={() => {
                setApiKeyWizardConnector(connector);
                setApiKeyWizardOpen(true);
              }}
              onTest={() => {
                setApiKeyWizardConnector(connector);
                setApiKeyWizardOpen(true);
              }}
              isLoading={false}
              adminDisabled={false}
              onDisconnect={isAdmin ? () => handleConnectorDelete(connector.id, connector.displayName) : undefined}
              isDisconnecting={disconnectingId === connector.id}
            />
          ))}
      </div>

      {/* Platform Picker Modal */}
      <PlatformPickerModal
        show={platformPickerOpen}
        onHide={() => setPlatformPickerOpen(false)}
        onSelect={handlePlatformSelected}
        configuredIds={configuredIds}
      />

      {/* OAuth Configuration Wizard */}
      <OAuthWizard
        show={oauthWizardOpen}
        onHide={() => setOauthWizardOpen(false)}
        onSaved={handleOAuthSaved}
        providerId={oauthWizardProviderId}
        isNew={oauthWizardIsNew}
        templates={oauthTemplates}
        existingSecrets={oauthSecrets}
        mergedProviders={mergedOAuthProviders}
      />

      {/* API Key / Token / Username-Password Wizard */}
      {apiKeyWizardConnector && (
        <ApiKeyWizard
          show={apiKeyWizardOpen}
          onHide={() => {
            setApiKeyWizardOpen(false);
            setApiKeyWizardConnector(null);
          }}
          onSaved={handleApiKeySaved}
          connector={apiKeyWizardConnector}
          existingSecrets={connectorSecrets}
        />
      )}

      {/* ACCEPT 3af3ef8e: Google Cloud Setup Wizard added in incoming commit.
          To revert: remove this JSX block. */}
      <GoogleCloudSetupWizard
        show={googleSetupWizardOpen}
        onHide={() => setGoogleSetupWizardOpen(false)}
        onComplete={() => {
          setGoogleSetupWizardOpen(false);
          loadCompanySecrets();
          loadOAuthProviders();
        }}
      />

      {/* Event Config Panel (shown when a connector with eventTypes is selected) */}
      {eventConfigConnectorId &&
        (() => {
          const connector = getConnectorById(eventConfigConnectorId);
          if (!connector?.eventTypes) return null;
          return (
            <div className="mt-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h5 className="mb-0">
                  {t('dataConnectors.events.title')} — {connector.displayName}
                </h5>
                <Button variant="link" size="sm" onClick={() => setEventConfigConnectorId(null)}>
                  {t('dataConnectors.events.close')}
                </Button>
              </div>
              <EventConfigPanel connectorId={connector.id} eventTypes={connector.eventTypes} />
            </div>
          );
        })()}
    </div>
  );
};

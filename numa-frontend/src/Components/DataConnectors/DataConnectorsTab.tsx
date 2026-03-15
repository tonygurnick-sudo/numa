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
import { listCompanySecrets, deleteCompanySecret } from '../../Services/VaultService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useAuth } from '../../Providers/AuthProvider';
import { SynergyConnectorCard } from './SynergyConnectorCard';
import { OAuthConnectorCard } from './OAuthConnectorCard';
import { ContactRequiredCard } from './ContactRequiredCard';
import { SynergyWizard } from './wizards/SynergyWizard';
import { OAuthWizard } from './wizards/OAuthWizard';
import { PlatformPickerModal } from './wizards/PlatformPickerModal';
import { ApiKeyWizard } from './wizards/ApiKeyWizard';
// MERGE: kept dev — GoogleCloudSetupWizard + EventConfigPanel added in dev after initial wizard commit
import { GoogleCloudSetupWizard } from './wizards/GoogleCloudSetupWizard';
import EventConfigPanel from './EventConfigPanel';
import type { GlobalDataConnectorSettingsMap } from '../../Services/AdminDataConnectorsService';
import {
  getOAuthProviderTemplates,
  getOAuthConnectors,
  getNonOAuthConnectors,
  getContactRequired,
  getConnectorById,
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
  const { numaGet, numaPost } = useNumaRequest();
  const { user } = useAuth();
  const isAdmin = Boolean(user?.groups?.includes('admin'));

  const [statusItems, setStatusItems] = useState<DataConnectorStatus[]>([]);
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

  const [synergyWizardOpen, setSynergyWizardOpen] = useState(false);
  const [oauthWizardOpen, setOauthWizardOpen] = useState(false);
  const [oauthWizardProviderId, setOauthWizardProviderId] = useState<string | undefined>(undefined);
  const [oauthWizardIsNew, setOauthWizardIsNew] = useState(false);

  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);
  const [apiKeyWizardOpen, setApiKeyWizardOpen] = useState(false);
  const [apiKeyWizardConnector, setApiKeyWizardConnector] = useState<ConnectorTemplate | null>(null);
  // MERGE: kept dev — disconnect, google setup, and event config state added in dev
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
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

  const loadOAuthProviders = useCallback(async () => {
    if (!oauthAvailable) return;
    try {
      const providers = await OAuthProvidersService.listProviders();
      setOauthProviders(providers);
    } catch {
      setOauthProviders([]);
    }
  }, [oauthAvailable]);

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

  // Helper: check if a provider has COMPANY credentials configured (OAuth or connector)
  const getProviderSecret = (providerId: string): VaultSecretMetadata | undefined =>
    companySecrets.find((s) => s.name === `oauth-client-${providerId}`);

  const getConnectorSecret = (connectorId: string): VaultSecretMetadata | undefined =>
    companySecrets.find((s) => s.name === `connector-${connectorId}`);

  // Set of all configured connector IDs (for platform picker badge)
  const configuredIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of companySecrets) {
      if (s.name.startsWith('oauth-client-')) ids.add(s.name.replace('oauth-client-', ''));
      if (s.name.startsWith('connector-')) ids.add(s.name.replace('connector-', ''));
    }
    return ids;
  }, [companySecrets]);

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
      if (!registryIds.has(provider.id)) {
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

  const synergyStatus = statusItems.find((item) => item.connector_id === 'synergy');
  const isConnected = synergyStatus?.status === 'connected';
  const adminDisabled = adminSettings?.synergy?.status === 'disabled';

  const openSynergyWizard = () => setSynergyWizardOpen(true);

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

  const handleOAuthSaved = async () => {
    OAuthProvidersService.clearProvidersCache();
    await Promise.all([loadCompanySecrets(), loadOAuthProviders()]);
  };

  const handleSynergySaved = async () => {
    await loadStatus();
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
      try {
        await OAuthProvidersService.disconnect(providerId);
      } catch {
        // May fail if no tokens exist — continue to delete vault secret
      }
      await deleteCompanySecret(`oauth-client-${providerId}`);
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
        {/* Synergy Card */}
        <SynergyConnectorCard
          status={synergyStatus}
          onConnect={openSynergyWizard}
          onTest={openSynergyWizard}
          onSettings={openSynergyWizard}
          isConnecting={false}
          adminDisabled={adminDisabled}
        />

        {/* OAuth Provider Cards */}
        {mergedOAuthProviders.map((provider) => {
          const credentialConfigured = !!getProviderSecret(provider.id);
          return (
            <OAuthConnectorCard
              key={provider.id}
              providerId={provider.id}
              displayName={provider.display_name}
              icon={provider.icon}
              description={provider.description}
              credentialConfigured={credentialConfigured}
              onConfigure={() => openOAuthWizardExisting(provider.id)}
              onTest={() => handleOAuthTest(provider.id)}
              isLoading={false}
              adminDisabled={!isAdmin && !credentialConfigured}
              onDisconnect={
                isAdmin && credentialConfigured
                  ? () => handleOAuthDisconnect(provider.id, provider.display_name)
                  : undefined
              }
              isDisconnecting={disconnectingId === provider.id}
            />
          );
        })}

        {/* Non-OAuth Connector Cards (API Key, Token, Username/Password) */}
        {nonOAuthConnectors.map((connector) => {
          const credentialConfigured = !!getConnectorSecret(connector.id);
          return (
            <OAuthConnectorCard
              key={connector.id}
              providerId={connector.id}
              displayName={connector.displayName}
              icon={connector.icon}
              description={connector.description}
              credentialConfigured={credentialConfigured}
              onConfigure={() => {
                setApiKeyWizardConnector(connector);
                setApiKeyWizardOpen(true);
              }}
              onTest={() => {
                setApiKeyWizardConnector(connector);
                setApiKeyWizardOpen(true);
              }}
              isLoading={false}
              adminDisabled={!isAdmin && !credentialConfigured}
              // MERGE: kept dev — disconnect support for non-OAuth connectors added in dev
              onDisconnect={
                isAdmin && credentialConfigured
                  ? () => handleConnectorDelete(connector.id, connector.displayName)
                  : undefined
              }
              isDisconnecting={disconnectingId === connector.id}
            />
          );
        })}

        {/* Contact Required Cards */}
        {contactRequiredConnectors.map((connector) => (
          <ContactRequiredCard key={connector.id} connector={connector} />
        ))}
      </div>

      {/* Platform Picker Modal */}
      <PlatformPickerModal
        show={platformPickerOpen}
        onHide={() => setPlatformPickerOpen(false)}
        onSelect={handlePlatformSelected}
        configuredIds={configuredIds}
      />

      {/* Synergy Configuration Wizard */}
      <SynergyWizard
        show={synergyWizardOpen}
        onHide={() => setSynergyWizardOpen(false)}
        onSaved={handleSynergySaved}
        existingServer={isConnected ? synergyStatus?.config?.server : undefined}
        numaPost={numaPost}
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

      {/* MERGE: kept dev — GoogleCloudSetupWizard and EventConfigPanel added in dev */}
      <GoogleCloudSetupWizard
        show={googleSetupWizardOpen}
        onHide={() => setGoogleSetupWizardOpen(false)}
        onComplete={() => {
          setGoogleSetupWizardOpen(false);
          loadCompanySecrets();
          loadOAuthProviders();
        }}
      />

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
                  {/* MERGE: kept dev — uses i18n key instead of raw ✕ character */}
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

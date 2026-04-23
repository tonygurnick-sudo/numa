import { useCallback, useEffect, useMemo, useState } from 'react';
import { getFlag } from '../../utils/featureFlags';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Grid3X3, Plus } from 'lucide-react';
import { DataConnectorsService } from '../../Services/DataConnectorsService';
import { ConnectorsService } from '../../Services/ConnectorsService';
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
import { SynergyPatBadge } from './SynergyPatBadge';
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
        if (refresh) ConnectorsService.clearListCache();
        // ConnectorsService.listConfigured returns classified {oauth, pat}.
        // This admin panel's "OAuth column" only wants OAuth entries; PAT
        // entries are sourced separately via getConnectorSecret below.
        const { oauth } = await ConnectorsService.listConfigured();
        setOauthProviders(
          oauth.map((c) => ({
            id: c.id,
            display_name: c.displayName,
            icon: c.icon ?? '',
            description: '',
            configured: true,
          }))
        );
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
    companySecrets.find((s) => s.name === `connector-config-${connectorId}` || s.name === `connector-${connectorId}`);

  const getConnectorStatus = (connectorId: string): DataConnectorStatus | undefined =>
    statusItems.find((s) => s.connector_id === connectorId);

  const configuredIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of companySecrets) {
      if (s.name.startsWith('connector-config-')) {
        ids.add(s.name.substring('connector-config-'.length));
      } else if (s.name.startsWith('connector-')) {
        ids.add(s.name.substring('connector-'.length));
      }
    }
    for (const p of oauthProviders) {
      ids.add(p.id);
    }
    for (const id of recentlySavedIds) {
      ids.add(id);
    }
    return ids;
  }, [companySecrets, oauthProviders, recentlySavedIds]);

  const oauthSecrets = useMemo(() => companySecrets.filter((s) => s.category === 'OAuth Clients'), [companySecrets]);
  const connectorSecrets = useMemo(
    () => companySecrets.filter((s) => s.category === 'Connector Config' || s.category === 'Connector Credentials'),
    [companySecrets]
  );

  const googleCloudConfigured = useMemo(() => {
    return companySecrets.some((s) => s.name === 'oauth-client-google' || s.id === 'oauth-client-google');
  }, [companySecrets]);

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
    ConnectorsService.clearListCache();
    await Promise.all([loadCompanySecrets(), loadOAuthProviders(true)]);
  };

  const handleApiKeySaved = async () => {
    await loadCompanySecrets();
  };

  const handleOAuthTest = async (providerId: string) => {
    // Test button on OAuth rows triggers the OAuth authorize flow.
    await ConnectorsService.connect(providerId);
  };

  const handleOAuthDisconnect = async (providerId: string, displayName: string) => {
    const confirmed = window.confirm(t('dataConnectors.confirm.disconnect', { name: displayName }));
    if (!confirmed) return;
    setDisconnectingId(providerId);
    try {
      const connector = getConnectorById(providerId);
      const isOAuth = connector?.authType === 'oauth2';

      // Revoke per-user credentials — ConnectorsService routes to the right
      // endpoint (OAuth revoke or PAT delete) based on the connector's
      // registered auth type. May fail if no per-user state exists yet;
      // continue to delete the vault config secret regardless.
      try {
        await ConnectorsService.disconnect(providerId);
      } catch {
        /* no credentials to revoke — continue */
      }

      if (connector?.oauthPlatform) {
        // Platform connector: remove from enabled_connectors, only delete secret if none remain
        const secretName = `oauth-client-${getOAuthSecretId(providerId)}`;
        try {
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
        } catch {
          // Secret already deleted — nothing to clean up
        }
      } else if (isOAuth) {
        await deleteCompanySecret(`oauth-client-${providerId}`).catch(() => {});
      } else {
        await deleteCompanySecret(`connector-config-${providerId}`).catch(() => {});
        await deleteCompanySecret(`connector-${providerId}`).catch(() => {});
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t('dataConnectors.errors.disconnectFailed', { name: displayName });
      setLoadError(msg);
    } finally {
      ConnectorsService.clearListCache();
      setRecentlySavedIds((prev) => {
        const next = new Set(prev);
        next.delete(providerId);
        return next;
      });
      await Promise.all([loadCompanySecrets(), loadOAuthProviders(true)]);
      setDisconnectingId(null);
    }
  };

  const handleConnectorDelete = async (connectorId: string, displayName: string) => {
    const confirmed = window.confirm(t('dataConnectors.confirm.deleteCredentials', { name: displayName }));
    if (!confirmed) return;
    setDisconnectingId(connectorId);
    try {
      await deleteCompanySecret(`connector-config-${connectorId}`).catch(() => {});
      await deleteCompanySecret(`connector-${connectorId}`).catch(() => {});
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t('dataConnectors.errors.disconnectFailed', { name: displayName });
      setLoadError(msg);
    } finally {
      ConnectorsService.clearListCache();
      setRecentlySavedIds((prev) => {
        const next = new Set(prev);
        next.delete(connectorId);
        return next;
      });
      await Promise.all([loadCompanySecrets(), loadOAuthProviders(true)]);
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
            <Button
              variant={googleCloudConfigured ? 'outline-success' : 'outline-secondary'}
              size="sm"
              onClick={() => setGoogleSetupWizardOpen(true)}
            >
              <i className={`bi ${googleCloudConfigured ? 'bi-check-circle' : 'bi-google'} me-1`} />
              {googleCloudConfigured
                ? t('dataConnectors.googleCloudSetup.configuredButton', 'Google Cloud Configured')
                : t('dataConnectors.googleCloudSetup.setupButton')}
            </Button>
            <Button variant="outline-primary" size="sm" onClick={() => setPlatformPickerOpen(true)}>
              <Plus size={14} className="me-1" />
              {t('dataConnectors.picker.addConnector')}
            </Button>
          </div>
        )}
      </div>
      <div className="mt-3">
        {/* OAuth Provider Cards — only show configured, genuinely OAuth entries.
            `/api/oauth/providers` returns a mixed list (OAuth + PAT) for
            backwards compat; filter here to OAuth-only so PAT connectors like
            Fergus aren't rendered with a hardcoded OAUTH2 badge. The second
            loop below handles PAT connectors with the correct authType. */}
        {mergedOAuthProviders
          .filter((provider) => configuredIds.has(provider.id))
          .filter((provider) => {
            const reg = getConnectorById(provider.id);
            return !reg || reg.authType === 'oauth2';
          })
          .map((provider) => (
            <OAuthConnectorCard
              key={provider.id}
              providerId={provider.id}
              displayName={provider.display_name}
              icon={provider.icon}
              description={provider.description}
              authType="oauth2"
              credentialConfigured
              onConfigure={() => openOAuthWizardExisting(provider.id)}
              onTest={() => handleOAuthTest(provider.id)}
              isLoading={false}
              adminDisabled={false}
              onDisconnect={isAdmin ? () => handleOAuthDisconnect(provider.id, provider.display_name) : undefined}
              isDisconnecting={disconnectingId === provider.id}
            />
          ))}

        {/* Non-OAuth (PAT) Connector Cards — include every admin-registered
            non-OAuth connector, regardless of whether the backend's mixed
            provider list also reported it. The OAuth loop above now excludes
            PAT connectors explicitly, so we can drop the old `oauthProviders
            .some(...)` exclusion without duplicating any row. */}
        {nonOAuthConnectors
          .filter((connector) => !!getConnectorSecret(connector.id))
          .map((connector) => (
            <OAuthConnectorCard
              key={connector.id}
              providerId={connector.id}
              displayName={connector.displayName}
              icon={connector.icon}
              description={connector.description}
              authType={connector.authType}
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
              hasError={getConnectorStatus(connector.id)?.status === 'auth_error'}
              extraStatus={connector.id === 'synergy' ? <SynergyPatBadge connectorConfigured /> : undefined}
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
        isConfigured={googleCloudConfigured}
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

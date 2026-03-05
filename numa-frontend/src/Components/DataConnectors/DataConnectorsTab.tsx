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
import { listCompanySecrets } from '../../Services/VaultService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useAuth } from '../../Providers/AuthProvider';
import { SynergyConnectorCard } from './SynergyConnectorCard';
import { OAuthConnectorCard } from './OAuthConnectorCard';
import { SynergyWizard } from './wizards/SynergyWizard';
import { OAuthWizard } from './wizards/OAuthWizard';
import type { ProviderTemplate } from './wizards/OAuthWizard';
import type { GlobalDataConnectorSettingsMap } from '../../Services/AdminDataConnectorsService';

// ---------------------------------------------------------------------------
// Well-known provider templates for the configure wizard
// ---------------------------------------------------------------------------

const WELL_KNOWN_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'googledrive',
    displayName: 'Google Drive',
    icon: 'bi-google',
    description: 'Access and browse Google Drive files',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: 'https://www.googleapis.com/auth/drive.readonly',
    extraAuthParams: '{"access_type":"offline","prompt":"consent"}',
    helpUrl: 'https://console.cloud.google.com/apis/credentials',
    discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
  },
  {
    id: 'onedrive',
    displayName: 'OneDrive',
    icon: 'bi-microsoft',
    description: 'Access and browse Microsoft OneDrive files',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: 'https://graph.microsoft.com/Files.Read.All offline_access',
    extraAuthParams: '{"response_mode":"query"}',
    helpUrl: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps',
    discoveryUrl: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
  },
  {
    id: 'dropbox',
    displayName: 'Dropbox',
    icon: 'bi-dropbox',
    description: 'Access and browse Dropbox files',
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: 'files.metadata.read files.content.read',
    extraAuthParams: '{"token_access_type":"offline"}',
    helpUrl: 'https://www.dropbox.com/developers/apps',
    discoveryUrl: 'https://www.dropbox.com/.well-known/openid-configuration',
  },
];

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
    if (!vaultEnabled || !oauthAvailable) return;
    try {
      const secrets = await listCompanySecrets();
      setCompanySecrets(secrets.filter((s) => s.category === 'OAuth Clients'));
    } catch {
      setCompanySecrets([]);
    }
  }, [vaultEnabled, oauthAvailable]);

  useEffect(() => {
    loadStatus();
    loadOAuthProviders();
    loadCompanySecrets();
  }, [loadStatus, loadOAuthProviders, loadCompanySecrets]);

  // Helper: check if a provider has COMPANY credentials configured
  const getProviderSecret = (providerId: string): VaultSecretMetadata | undefined =>
    companySecrets.find((s) => s.name === `oauth-client-${providerId}`);

  // ---------------------------------------------------------------------------
  // Merged provider list (well-known always present + API data)
  // ---------------------------------------------------------------------------

  const mergedOAuthProviders = useMemo(() => {
    const wellKnownIds = new Set(WELL_KNOWN_TEMPLATES.map((tpl) => tpl.id));

    const merged: OAuthProviderInfo[] = WELL_KNOWN_TEMPLATES.map((tpl) => {
      const fromApi = oauthProviders.find((p) => p.id === tpl.id);
      return {
        id: tpl.id,
        display_name: fromApi?.display_name || tpl.displayName,
        icon: fromApi?.icon || tpl.icon,
        description: fromApi?.description || tpl.description,
        configured: fromApi?.configured ?? false,
      };
    });

    for (const provider of oauthProviders) {
      if (!wellKnownIds.has(provider.id)) {
        merged.push(provider);
      }
    }

    return merged;
  }, [oauthProviders]);

  const totalConnectors = 1 + mergedOAuthProviders.length;

  // ---------------------------------------------------------------------------
  // Wizard open helpers
  // ---------------------------------------------------------------------------

  const synergyStatus = statusItems.find((item) => item.connector_id === 'synergy');
  const isConnected = synergyStatus?.status === 'connected';
  const adminDisabled = adminSettings?.synergy?.status === 'disabled';

  const openSynergyWizard = () => setSynergyWizardOpen(true);

  const openOAuthWizardNew = () => {
    setOauthWizardProviderId(undefined);
    setOauthWizardIsNew(true);
    setOauthWizardOpen(true);
  };

  const openOAuthWizardExisting = (providerId: string) => {
    setOauthWizardProviderId(providerId);
    setOauthWizardIsNew(false);
    setOauthWizardOpen(true);
  };

  const handleOAuthSaved = async () => {
    OAuthProvidersService.clearProvidersCache();
    await Promise.all([loadCompanySecrets(), loadOAuthProviders()]);
  };

  const handleSynergySaved = async () => {
    await loadStatus();
  };

  const handleOAuthTest = async (providerId: string) => {
    await OAuthProvidersService.connect(providerId);
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
        {isAdmin && oauthAvailable && (
          <Button variant="outline-primary" size="sm" onClick={openOAuthWizardNew} className="ms-auto">
            <Plus size={14} className="me-1" />
            {t('dataConnectors.oauth.addProvider')}
          </Button>
        )}
      </div>
      <div className="mt-3">
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
            />
          );
        })}
      </div>

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
        templates={WELL_KNOWN_TEMPLATES}
        existingSecrets={companySecrets}
        mergedProviders={mergedOAuthProviders}
      />
    </div>
  );
};

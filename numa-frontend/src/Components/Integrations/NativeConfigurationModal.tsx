/**
 * NativeConfigurationModal — admin-only modal that wraps the OAuth and PAT
 * wizards so they can be launched inline from the unified Integrations admin
 * tab.
 *
 * Loads the supporting data (vault company secrets, OAuth provider list)
 * when shown, then renders whichever wizard matches the connector's
 * authType. This is the surface admins use to configure native credentials
 * from inside the per-service Manage modal.
 */

import { useEffect, useMemo, useState } from 'react';
import { Spinner, Modal } from 'react-bootstrap';
import {
  getConnectorById,
  getOAuthProviderTemplates,
  getConnectorsByPlatform,
} from '../DataConnectors/connectorRegistry';
import { listCompanySecrets, type VaultSecretMetadata } from '../../Services/VaultService';
import { ConnectorsService, type ConfiguredConnectors } from '../../Services/ConnectorsService';
import type { OAuthProviderInfo } from '../../types/oauthProviders';
import { OAuthWizard } from '../DataConnectors/wizards/OAuthWizard';
import { ApiKeyWizard } from '../DataConnectors/wizards/ApiKeyWizard';

type NativeConfigurationModalProps = {
  show: boolean;
  connectorSlug: string | null;
  onHide: () => void;
  onSaved: () => void | Promise<void>;
};

export const NativeConfigurationModal = ({ show, connectorSlug, onHide, onSaved }: NativeConfigurationModalProps) => {
  const connector = connectorSlug ? getConnectorById(connectorSlug) : undefined;

  const [secrets, setSecrets] = useState<VaultSecretMetadata[]>([]);
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!show || !connectorSlug) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [vaultRes, classifiedRes] = await Promise.all([
          listCompanySecrets().catch(() => [] as VaultSecretMetadata[]),
          ConnectorsService.listConfigured().catch(() => ({ oauth: [], pat: [] }) as ConfiguredConnectors),
        ]);
        if (cancelled) return;
        setSecrets(vaultRes);
        // ConnectorsService.listConfigured returns a slim ConnectorSummary shape
        // (`displayName`, optional `icon`); OAuthWizard wants the fuller
        // OAuthProviderInfo shape. Map across — these entries came from the
        // configured-list endpoint, so `configured` is necessarily true.
        setOauthProviders(
          classifiedRes.oauth.map((s) => ({
            id: s.id,
            display_name: s.displayName,
            icon: s.icon ?? '',
            description: '',
            configured: true,
          }))
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [show, connectorSlug]);

  // OAuthWizard works in terms of `templates` + `mergedProviders`. Compute a
  // merged list of registry-defined and API-discovered providers so the
  // wizard sees a consistent view, no matter where it is launched from.
  const oauthTemplates = useMemo(() => getOAuthProviderTemplates(), []);
  const mergedProviders = useMemo<OAuthProviderInfo[]>(() => {
    const registryDefs = oauthTemplates.map((t) => ({
      id: t.id,
      display_name: t.displayName,
      icon: t.icon,
      description: t.description,
      configured: false,
    }));
    const registryIds = new Set(registryDefs.map((d) => d.id));
    const merged: OAuthProviderInfo[] = registryDefs.map((rd) => {
      const fromApi = oauthProviders.find((p) => p.id === rd.id);
      return {
        ...rd,
        display_name: fromApi?.display_name || rd.display_name,
        icon: fromApi?.icon || rd.icon,
        description: fromApi?.description || rd.description,
        configured: fromApi?.configured ?? false,
      };
    });
    for (const provider of oauthProviders) {
      if (!registryIds.has(provider.id) && getConnectorsByPlatform(provider.id).length === 0) {
        merged.push(provider);
      }
    }
    return merged;
  }, [oauthTemplates, oauthProviders]);

  if (!show || !connectorSlug || !connector) return null;

  if (loading) {
    return (
      <Modal show centered onHide={onHide}>
        <Modal.Body className="text-center py-5">
          <Spinner animation="border" variant="primary" />
        </Modal.Body>
      </Modal>
    );
  }

  if (connector.authType === 'oauth2') {
    return (
      <OAuthWizard
        show
        onHide={onHide}
        onSaved={() => void onSaved()}
        providerId={connector.id}
        isNew={false}
        templates={oauthTemplates}
        existingSecrets={secrets}
        mergedProviders={mergedProviders}
      />
    );
  }

  if (connector.authType === 'contact-required') {
    // Tier 3 (contact-required) connectors aren't connectable through the
    // self-serve flow. AddIntegrationModal already filters them out of the
    // admin picker, so this branch is defensive — render a plain notice
    // pointing the admin at sales/CS rather than crashing if they somehow
    // open it. (Tony's connector-tidy cleanup dropped the per-connector
    // contactInfo block; details live in the marketing site / docs now.)
    return (
      <Modal show centered onHide={onHide}>
        <Modal.Header closeButton>
          <Modal.Title>{connector.displayName}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small text-muted mb-0">
            This connector requires onboarding by Arcanum. Contact your account manager to get it enabled for this
            workspace.
          </p>
        </Modal.Body>
      </Modal>
    );
  }

  return (
    <ApiKeyWizard show onHide={onHide} onSaved={() => void onSaved()} connector={connector} existingSecrets={secrets} />
  );
};

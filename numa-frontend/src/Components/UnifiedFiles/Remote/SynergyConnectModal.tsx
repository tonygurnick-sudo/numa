import React, { useState, useCallback, useEffect } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { DataConnectorsService } from '../../../Services/DataConnectorsService';
import { listSecrets, getSecret, createSecret, listCategories } from '../../../Services/VaultService';
import type { VaultSecretMetadata, CreateSecretPayload } from '../../../Services/VaultService';
import { VaultSecretForm } from '../../Vault/VaultSecretForm';
import { getFlag } from '../../../utils/featureFlags';

interface SynergyConnectModalProps {
  show: boolean;
  onHide: () => void;
  onConnected: () => void;
}

export function SynergyConnectModal({ show, onHide, onConnected }: SynergyConnectModalProps): React.JSX.Element | null {
  const { t } = useTranslation('files');
  const { numaPost } = useNumaRequest();
  const vaultEnabled = getFlag('SECRETS_VAULT_ENABLED');

  const [connectServer, setConnectServer] = useState('');
  const [selectedSecretId, setSelectedSecretId] = useState('');
  const [vaultSecrets, setVaultSecrets] = useState<VaultSecretMetadata[]>([]);
  const [vaultCategories, setVaultCategories] = useState<string[]>([]);
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showVaultForm, setShowVaultForm] = useState(false);

  const loadVaultSecrets = useCallback(async () => {
    if (!vaultEnabled) return;
    setLoadingSecrets(true);
    try {
      const [secrets, cats] = await Promise.all([listSecrets(), listCategories()]);
      setVaultSecrets(secrets.filter((s) => s.type === 'bearer_token'));
      setVaultCategories(cats);
    } catch {
      setVaultSecrets([]);
    } finally {
      setLoadingSecrets(false);
    }
  }, [vaultEnabled]);

  useEffect(() => {
    if (show) {
      setConnectError(null);
      loadVaultSecrets();
    }
  }, [show, loadVaultSecrets]);

  // Auto-populate server from credential endpoint when selection changes
  useEffect(() => {
    if (!selectedSecretId) return;
    getSecret(selectedSecretId)
      .then((secret) => {
        if (secret.fields?.endpoint) {
          setConnectServer(secret.fields.endpoint);
        }
      })
      .catch(() => {});
  }, [selectedSecretId]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedSecretId) {
        setConnectError(t('remote.noCredential'));
        return;
      }
      setConnecting(true);
      setConnectError(null);
      try {
        const secretData = await getSecret(selectedSecretId);
        const token = secretData.fields?.token || '';
        if (!token) {
          setConnectError(t('remote.noCredential'));
          setConnecting(false);
          return;
        }
        const server = connectServer.trim() || secretData.fields?.endpoint?.trim() || '';
        if (!server) {
          setConnectError(t('remote.noServer'));
          setConnecting(false);
          return;
        }
        await DataConnectorsService.connect(numaPost, {
          connector_id: 'synergy',
          config: { server, access_token: token },
        });
        onHide();
        setSelectedSecretId('');
        onConnected();
      } catch (err) {
        setConnectError(err instanceof Error ? err.message : String(err));
      } finally {
        setConnecting(false);
      }
    },
    [selectedSecretId, connectServer, numaPost, t, onHide, onConnected]
  );

  const handleVaultSecretCreated = useCallback(
    async (payload: CreateSecretPayload) => {
      const created = await createSecret(payload);
      await loadVaultSecrets();
      setSelectedSecretId(created.name);
    },
    [loadVaultSecrets]
  );

  if (!show) return null;

  return (
    <>
      <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{t('remote.connectSynergy')}</h5>
              <button type="button" className="btn-close" onClick={onHide} />
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {connectError && <div className="alert alert-danger py-2">{connectError}</div>}
                <div className="mb-3">
                  <label className="form-label small fw-semibold">{t('remote.serverLabel')}</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="https://synergy.myserver.com:8080"
                    value={connectServer}
                    onChange={(e) => setConnectServer(e.target.value)}
                    required
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-semibold">
                    <i className="bi bi-shield-lock-fill me-1 text-primary" />
                    {t('remote.credentialLabel')}
                  </label>
                  {loadingSecrets ? (
                    <div className="text-muted small py-2">
                      <Spinner animation="border" size="sm" className="me-2" />
                      {t('remote.loadingCredentials')}
                    </div>
                  ) : (
                    <>
                      <div className="d-flex gap-2">
                        <select
                          className="form-select flex-grow-1"
                          value={selectedSecretId}
                          onChange={(e) => setSelectedSecretId(e.target.value)}
                          required
                        >
                          <option value="">{t('remote.credentialPlaceholder')}</option>
                          {vaultSecrets.map((secret) => (
                            <option key={secret.name} value={secret.name}>
                              {secret.name}
                              {secret.description ? ` \u2014 ${secret.description}` : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-outline-primary btn-sm text-nowrap"
                          onClick={() => setShowVaultForm(true)}
                        >
                          <i className="bi bi-shield-plus me-1" />
                          {t('remote.createCredential')}
                        </button>
                      </div>
                      <div className="form-text text-muted">{t('remote.credentialHint')}</div>
                    </>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onHide}>
                  {t('remote.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" disabled={connecting || !selectedSecretId}>
                  {connecting ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      {t('remote.connecting')}
                    </>
                  ) : (
                    <>
                      <i className="bi bi-plug me-2" />
                      {t('remote.connectSynergy')}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <VaultSecretForm
        show={showVaultForm}
        onHide={() => setShowVaultForm(false)}
        onSubmit={handleVaultSecretCreated}
        categories={vaultCategories}
        defaultType="bearer_token"
      />
    </>
  );
}

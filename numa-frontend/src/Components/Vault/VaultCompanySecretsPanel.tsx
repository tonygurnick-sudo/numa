/**
 * VaultCompanySecretsPanel — Admin-only company secrets rendered as a Settings tab.
 *
 * Step-up password verification is required every time the panel becomes active.
 * The elevation lives in this component's state and is wiped whenever `active`
 * flips to false (tab switched away). On re-entry the password prompt opens
 * again — see TASK-146 decision: re-prompt on every entry.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Spinner } from 'react-bootstrap';
import {
  createCompanySecret,
  deleteCompanySecret,
  getCompanySecret,
  isGeneratedSecret,
  listCompanySecrets,
  updateCompanySecret,
} from '../../Services/VaultService';
import type {
  CreateSecretPayload,
  UpdateSecretPayload,
  VaultSecretMetadata,
  VaultSecretWithFields,
} from '../../Services/VaultService';
import { VaultAuditLog } from './VaultAuditLog';
import { VaultElevationModal } from './VaultElevationModal';
import { VaultSecretDetail } from './VaultSecretDetail';
import { VaultSecretForm } from './VaultSecretForm';

interface Props {
  /** True when this settings tab is the active one. Controls elevation reset. */
  active: boolean;
}

export function VaultCompanySecretsPanel({ active }: Props) {
  const { t } = useTranslation('vault');
  const { t: tSettings } = useTranslation('settings');

  const [companySecrets, setCompanySecrets] = useState<VaultSecretMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [elevated, setElevated] = useState(false);
  const [showElevationModal, setShowElevationModal] = useState(false);

  const [viewing, setViewing] = useState<VaultSecretMetadata | null>(null);
  const [deleting, setDeleting] = useState<VaultSecretMetadata | null>(null);
  const [editing, setEditing] = useState<VaultSecretWithFields | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Re-prompt on every entry: wipe elevation when the tab loses focus, and
  // open the password modal whenever we become active without it.
  useEffect(() => {
    if (active) {
      if (!elevated) {
        setShowElevationModal(true);
      }
    } else {
      setElevated(false);
      setShowElevationModal(false);
      setViewing(null);
      setDeleting(null);
      setEditing(null);
      setShowForm(false);
      setShowCreateForm(false);
    }
  }, [active]);

  const loadData = useCallback(async () => {
    if (!elevated) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listCompanySecrets();
      setCompanySecrets(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t('vault.errors.loadFailed', { message: msg }));
    } finally {
      setLoading(false);
    }
  }, [elevated, t]);

  useEffect(() => {
    if (elevated) loadData();
  }, [elevated, loadData]);

  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [successMsg]);

  const handleElevationSuccess = () => {
    setElevated(true);
    setShowElevationModal(false);
  };

  const handleElevationCancel = () => {
    setShowElevationModal(false);
    // Without elevation we render the locked CTA — user can click "Unlock" again.
  };

  const handleCreate = async (payload: CreateSecretPayload | UpdateSecretPayload) => {
    const created = await createCompanySecret(payload as CreateSecretPayload);
    setSuccessMsg(t('vault.success.created', { name: created.name }));
    setShowCreateForm(false);
    await loadData();
  };

  const handleEdit = async (secret: VaultSecretMetadata) => {
    try {
      const full = await getCompanySecret(secret.name);
      setEditing(full);
      setViewing(null);
      setShowForm(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t('vault.errors.loadFailed', { message: msg }));
    }
  };

  const handleUpdate = async (payload: CreateSecretPayload | UpdateSecretPayload) => {
    if (!editing) return;
    await updateCompanySecret(editing.name, payload as UpdateSecretPayload);
    setSuccessMsg(t('vault.success.updated', { name: editing.name }));
    setEditing(null);
    setShowForm(false);
    await loadData();
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteCompanySecret(deleting.name);
      setSuccessMsg(t('vault.success.deleted'));
      setDeleting(null);
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t('vault.errors.deleteFailed', { message: msg }));
    }
  };

  return (
    <div className="mb-3">
      <Alert variant="warning" className="mb-3">
        <div className="d-flex align-items-start">
          <i className="bi bi-shield-lock-fill me-2 mt-1" />
          <div>
            <div className="settings-section-title">{tSettings('vault.company.title', 'Company Secrets')}</div>
            <div className="small text-muted">
              {tSettings(
                'vault.company.description',
                'Shared OAuth client configurations and API credentials used by all users. Every change is logged with the admin who made it.'
              )}
            </div>
          </div>
        </div>
      </Alert>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {successMsg && (
        <Alert variant="success" dismissible onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      {!elevated ? (
        <div className="text-center py-5 border rounded-3 bg-light">
          <i className="bi bi-shield-lock display-4 text-muted d-block mb-3" />
          <h5>{tSettings('vault.company.lockedTitle', 'Verification required')}</h5>
          <p className="text-muted mb-3">
            {tSettings(
              'vault.company.lockedDescription',
              'Re-enter your password to view or change company secrets. Verification is required every time you open this tab.'
            )}
          </p>
          <Button variant="primary" onClick={() => setShowElevationModal(true)}>
            <i className="bi bi-unlock me-1" />
            {tSettings('vault.company.unlockButton', 'Unlock company secrets')}
          </Button>
        </div>
      ) : (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <span className="badge bg-success-subtle text-success">
              <i className="bi bi-unlock-fill me-1" />
              {tSettings('vault.company.unlockedBadge', 'Unlocked for this session')}
            </span>
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setShowCreateForm(true);
              }}
            >
              <i className="bi bi-plus-lg me-1" />
              {tSettings('vault.company.createButton', 'Add company secret')}
            </Button>
          </div>

          {loading ? (
            <div className="text-center py-5">
              <Spinner animation="border" />
            </div>
          ) : companySecrets.length === 0 ? (
            <p className="text-muted">{t('vault.companySecrets.empty')}</p>
          ) : (
            <div className="list-group">
              {companySecrets.map((s) => (
                <div key={s.name} className="list-group-item d-flex justify-content-between align-items-center">
                  <div>
                    <h6 className="mb-0">{s.name}</h6>
                    <small className="text-muted">{s.description}</small>
                    <div className="d-flex gap-2 mt-1">
                      <span className="badge bg-secondary-subtle text-secondary">{s.category}</span>
                      <span className="badge bg-primary-subtle text-primary">
                        {t(`vault.types.${s.type ?? 'custom'}`)}
                      </span>
                    </div>
                    {s.last_modified_by_email && (
                      <div className="small text-muted mt-1">
                        <i className="bi bi-person-badge me-1" />
                        {tSettings('vault.company.lastModifiedBy', 'Last modified by {{actor}}', {
                          actor: s.last_modified_by_email,
                        })}
                      </div>
                    )}
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={() => setViewing(s)}
                      title={t('vault.detail.reveal')}
                    >
                      <i className="bi bi-eye" />
                    </Button>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => handleEdit(s)}
                      title={t('vault.editSecret')}
                    >
                      <i className="bi bi-pencil" />
                    </Button>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => setDeleting(s)}
                      title={t('vault.deleteSecret')}
                    >
                      <i className="bi bi-trash" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            <div className="settings-section-title mb-2">{tSettings('vault.company.activityTitle', 'Audit log')}</div>
            <div className="text-muted small mb-2">
              {tSettings(
                'vault.company.activityDescription',
                'Every read and write against a company secret, with the responsible admin.'
              )}
            </div>
            <VaultAuditLog scope="company" />
          </div>
        </>
      )}

      <VaultElevationModal
        show={showElevationModal}
        onCancel={handleElevationCancel}
        onSuccess={handleElevationSuccess}
      />

      <VaultSecretDetail
        show={!!viewing}
        onHide={() => setViewing(null)}
        secret={viewing}
        onEdit={handleEdit}
        fetchSecret={getCompanySecret}
      />

      <VaultSecretForm
        show={showForm || showCreateForm}
        onHide={() => {
          setShowForm(false);
          setShowCreateForm(false);
          setEditing(null);
        }}
        onSubmit={editing ? handleUpdate : handleCreate}
        existingSecret={editing}
        categories={[]}
        readOnlyMetadata={editing ? isGeneratedSecret(editing) : false}
      />

      {deleting && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{t('vault.deleteSecret')}</h5>
                <button type="button" className="btn-close" onClick={() => setDeleting(null)} />
              </div>
              <div className="modal-body">
                <p>{t('vault.deleteConfirm', { name: deleting.name })}</p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setDeleting(null)}>
                  {t('common:common.cancel', 'Cancel')}
                </button>
                <button className="btn btn-danger" onClick={handleDelete}>
                  <i className="bi bi-trash me-1" />
                  {t('vault.deleteSecret')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VaultCompanySecretsPanel;

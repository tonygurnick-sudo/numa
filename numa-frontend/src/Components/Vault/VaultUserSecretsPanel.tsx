/**
 * VaultUserSecretsPanel — User-scoped secrets vault rendered as a Settings tab.
 *
 * Mirrors the surface of the legacy /vault-secrets page (user secrets + audit
 * log) but is shaped to match the rest of the Settings UI: an Alert intro,
 * stacked sections, no outer container, no nested tabs.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Form, InputGroup, Spinner } from 'react-bootstrap';
import {
  createSecret,
  deleteSecret,
  getSecret,
  isGeneratedSecret,
  listCategories,
  listSecrets,
  updateSecret,
} from '../../Services/VaultService';
import type {
  CreateSecretPayload,
  UpdateSecretPayload,
  VaultSecretMetadata,
  VaultSecretWithFields,
} from '../../Services/VaultService';
import { VaultAuditLog } from './VaultAuditLog';
import { VaultSecretDetail } from './VaultSecretDetail';
import { VaultSecretForm } from './VaultSecretForm';
import { VaultSecretsList } from './VaultSecretsList';

export function VaultUserSecretsPanel() {
  const { t } = useTranslation('vault');
  const { t: tSettings } = useTranslation('settings');

  const [secrets, setSecrets] = useState<VaultSecretMetadata[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  const [showForm, setShowForm] = useState(false);
  const [editingSecret, setEditingSecret] = useState<VaultSecretWithFields | null>(null);
  const [viewingSecret, setViewingSecret] = useState<VaultSecretMetadata | null>(null);
  const [deletingSecret, setDeletingSecret] = useState<VaultSecretMetadata | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [secretsList, catsList] = await Promise.all([listSecrets(), listCategories()]);
      setSecrets(secretsList);
      setCategories(catsList);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t('vault.errors.loadFailed', { message: msg }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [successMsg]);

  const handleCreate = async (payload: CreateSecretPayload | UpdateSecretPayload) => {
    const created = await createSecret(payload as CreateSecretPayload);
    setSuccessMsg(t('vault.success.created', { name: created.name }));
    await loadData();
  };

  const handleEdit = async (secret: VaultSecretMetadata) => {
    const full = await getSecret(secret.name);
    setEditingSecret(full);
    setViewingSecret(null);
    setShowForm(true);
  };

  const handleUpdate = async (payload: CreateSecretPayload | UpdateSecretPayload) => {
    if (!editingSecret) return;
    const updated = await updateSecret(editingSecret.name, payload as UpdateSecretPayload);
    setSuccessMsg(t('vault.success.updated', { name: updated.name }));
    setEditingSecret(null);
    await loadData();
  };

  const handleDelete = async () => {
    if (!deletingSecret) return;
    try {
      await deleteSecret(deletingSecret.name);
      setSuccessMsg(t('vault.success.deleted'));
      setDeletingSecret(null);
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t('vault.errors.deleteFailed', { message: msg }));
    }
  };

  const filtered = secrets.filter((s) => {
    const matchesSearch =
      !searchQuery ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || s.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="mb-3">
      <style>{`
        .vault-detail-modal { max-width: min(1400px, 95vw); margin: 1.75rem auto; }
        .vault-detail-modal .modal-content { max-height: calc(100vh - 3.5rem); }
      `}</style>

      <Alert variant="secondary" className="mb-3">
        <div className="d-flex align-items-start">
          <i className="bi bi-shield-lock-fill me-2 mt-1" />
          <div>
            <div className="settings-section-title">{tSettings('vault.user.title', 'My Secrets')}</div>
            <div className="small text-muted">
              {tSettings(
                'vault.user.description',
                'Personal secrets only visible to you. Used by connectors and Numa chat tools you authorise.'
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

      <div className="d-flex justify-content-between align-items-center mb-3 gap-2 flex-wrap">
        <div className="d-flex gap-2 flex-grow-1" style={{ minWidth: 0 }}>
          <InputGroup className="flex-grow-1" style={{ maxWidth: '480px' }}>
            <InputGroup.Text>
              <i className="bi bi-search" />
            </InputGroup.Text>
            <Form.Control
              placeholder={t('vault.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </InputGroup>
          <Form.Select
            style={{ maxWidth: '200px' }}
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="">{t('vault.allCategories')}</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </Form.Select>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setEditingSecret(null);
            setShowForm(true);
          }}
        >
          <i className="bi bi-plus-lg me-1" />
          {t('vault.createSecret')}
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : (
        <VaultSecretsList
          secrets={sorted}
          onSelect={(s) => setViewingSecret(s)}
          onEdit={handleEdit}
          onDelete={(s) => setDeletingSecret(s)}
        />
      )}

      <div className="mt-4">
        <div className="settings-section-title mb-2">{tSettings('vault.user.activityTitle', 'Activity')}</div>
        <div className="text-muted small mb-2">
          {tSettings('vault.user.activityDescription', 'Recent reads and writes against your personal secrets.')}
        </div>
        <VaultAuditLog scope="user" />
      </div>

      <VaultSecretForm
        show={showForm}
        onHide={() => {
          setShowForm(false);
          setEditingSecret(null);
        }}
        onSubmit={editingSecret ? handleUpdate : handleCreate}
        existingSecret={editingSecret}
        categories={categories}
        readOnlyMetadata={editingSecret ? isGeneratedSecret(editingSecret) : false}
      />

      <VaultSecretDetail
        show={!!viewingSecret}
        onHide={() => setViewingSecret(null)}
        secret={viewingSecret}
        onEdit={handleEdit}
      />

      {deletingSecret && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{t('vault.deleteSecret')}</h5>
                <button type="button" className="btn-close" onClick={() => setDeletingSecret(null)} />
              </div>
              <div className="modal-body">
                <p>{t('vault.deleteConfirm', { name: deletingSecret.name })}</p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setDeletingSecret(null)}>
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

export default VaultUserSecretsPanel;

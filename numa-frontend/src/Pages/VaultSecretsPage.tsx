/**
 * VaultSecretsPage — Main page for the Bitwarden-style secrets vault.
 *
 * Provides CRUD for secrets with typed entries, categories, and audit log.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Form, InputGroup, Tab, Tabs } from 'react-bootstrap';
import {
  listSecrets,
  listCategories,
  createSecret,
  updateSecret,
  deleteSecret,
  getSecret,
  listCompanySecrets,
  getCompanySecret,
  deleteCompanySecret,
} from '../Services/VaultService';
import type {
  VaultSecretMetadata,
  VaultSecretWithFields,
  CreateSecretPayload,
  UpdateSecretPayload,
} from '../Services/VaultService';
import { VaultSecretsList } from '../Components/Vault/VaultSecretsList';
import { VaultSecretForm } from '../Components/Vault/VaultSecretForm';
import { VaultSecretDetail } from '../Components/Vault/VaultSecretDetail';
import { VaultAuditLog } from '../Components/Vault/VaultAuditLog';
import { useAuth } from '../Providers/AuthProvider';

export function VaultSecretsPage() {
  const { t } = useTranslation('vault');
  const { user } = useAuth();
  const isAdmin = Boolean(user?.groups?.includes('admin'));
  const [secrets, setSecrets] = useState<VaultSecretMetadata[]>([]);
  const [companySecrets, setCompanySecrets] = useState<VaultSecretMetadata[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editingSecret, setEditingSecret] = useState<VaultSecretWithFields | null>(null);
  const [viewingSecret, setViewingSecret] = useState<VaultSecretMetadata | null>(null);
  const [deletingSecret, setDeletingSecret] = useState<VaultSecretMetadata | null>(null);

  // Company secret modals
  const [viewingCompanySecret, setViewingCompanySecret] = useState<VaultSecretMetadata | null>(null);
  const [companySecretDetail, setCompanySecretDetail] = useState<VaultSecretWithFields | null>(null);
  const [deletingCompanySecret, setDeletingCompanySecret] = useState<VaultSecretMetadata | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [secretsList, catsList, companyList] = await Promise.all([
        listSecrets(),
        listCategories(),
        listCompanySecrets().catch(() => [] as VaultSecretMetadata[]),
      ]);
      setSecrets(secretsList);
      setCategories(catsList);
      setCompanySecrets(companyList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-clear success messages
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
    const full = await getSecret(secret.secret_id);
    setEditingSecret(full);
    setViewingSecret(null);
    setShowForm(true);
  };

  const handleUpdate = async (payload: CreateSecretPayload | UpdateSecretPayload) => {
    if (!editingSecret) return;
    const updated = await updateSecret(editingSecret.secret_id, payload as UpdateSecretPayload);
    setSuccessMsg(t('vault.success.updated', { name: updated.name }));
    setEditingSecret(null);
    await loadData();
  };

  const handleDelete = async () => {
    if (!deletingSecret) return;
    try {
      await deleteSecret(deletingSecret.secret_id);
      setSuccessMsg(t('vault.success.deleted'));
      setDeletingSecret(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Company secret actions (admin only)
  const handleViewCompanySecret = async (secret: VaultSecretMetadata) => {
    try {
      const full = await getCompanySecret(secret.name);
      setCompanySecretDetail(full);
      setViewingCompanySecret(secret);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteCompanySecret = async () => {
    if (!deletingCompanySecret) return;
    try {
      await deleteCompanySecret(deletingCompanySecret.name);
      setSuccessMsg(t('vault.success.deleted'));
      setDeletingCompanySecret(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Filter secrets
  const filtered = secrets.filter((s) => {
    const matchesSearch =
      !searchQuery ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || s.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Sort: favorites first, then by name
  const sorted = [...filtered].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">
            <i className="bi bi-shield-lock-fill me-2" />
            {t('vault.title')}
          </h2>
          <p className="text-muted mb-0">{t('vault.description')}</p>
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

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {t('vault.errors.loadFailed', { message: error })}
        </Alert>
      )}
      {successMsg && (
        <Alert variant="success" dismissible onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      <Tabs defaultActiveKey="secrets" className="mb-3">
        <Tab eventKey="secrets" title={t('vault.tabs.secrets')}>
          {/* Search and category filter */}
          <div className="d-flex gap-3 mb-3">
            <InputGroup className="flex-grow-1">
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

          {loading ? (
            <div className="text-center py-5">
              <div className="spinner-border" role="status" />
            </div>
          ) : (
            <VaultSecretsList
              secrets={sorted}
              onSelect={(s) => setViewingSecret(s)}
              onEdit={handleEdit}
              onDelete={(s) => setDeletingSecret(s)}
            />
          )}
        </Tab>

        <Tab eventKey="company" title={t('vault.tabs.companySecrets')}>
          <p className="text-muted mb-3">{t('vault.companySecrets.description')}</p>
          {companySecrets.length === 0 ? (
            <p className="text-muted">{t('vault.companySecrets.empty')}</p>
          ) : (
            <div className="list-group">
              {companySecrets.map((s) => (
                <div key={s.secret_id} className="list-group-item d-flex justify-content-between align-items-center">
                  <div>
                    <h6 className="mb-0">{s.name}</h6>
                    <small className="text-muted">{s.description}</small>
                    <div className="d-flex gap-2 mt-1">
                      <span className="badge bg-secondary-subtle text-secondary">{s.category}</span>
                      <span className="badge bg-primary-subtle text-primary">{t(`vault.types.${s.type}`)}</span>
                    </div>
                    {s.help_url && (
                      <a href={s.help_url} target="_blank" rel="noopener noreferrer" className="small mt-1 d-block">
                        <i className="bi bi-box-arrow-up-right me-1" />
                        {t('vault.detail.helpLink')}
                      </a>
                    )}
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <span className="badge bg-success-subtle text-success">{t('vault.companySecrets.configured')}</span>
                    {isAdmin && (
                      <>
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={() => handleViewCompanySecret(s)}
                          title={t('vault.detail.reveal')}
                        >
                          <i className="bi bi-eye" />
                        </Button>
                        <Button
                          variant="outline-danger"
                          size="sm"
                          onClick={() => setDeletingCompanySecret(s)}
                          title={t('vault.deleteSecret')}
                        >
                          <i className="bi bi-trash" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Tab>

        <Tab eventKey="audit" title={t('vault.tabs.auditLog')}>
          <VaultAuditLog />
        </Tab>
      </Tabs>

      {/* Create / Edit Modal */}
      <VaultSecretForm
        show={showForm}
        onHide={() => {
          setShowForm(false);
          setEditingSecret(null);
        }}
        onSubmit={editingSecret ? handleUpdate : handleCreate}
        existingSecret={editingSecret}
        categories={categories}
      />

      {/* Detail View Modal */}
      <VaultSecretDetail
        show={!!viewingSecret}
        onHide={() => setViewingSecret(null)}
        secret={viewingSecret}
        onEdit={handleEdit}
      />

      {/* Delete Confirmation */}
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

      {/* Company Secret Detail Modal */}
      {viewingCompanySecret && companySecretDetail && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{viewingCompanySecret.name}</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setViewingCompanySecret(null);
                    setCompanySecretDetail(null);
                  }}
                />
              </div>
              <div className="modal-body">
                {companySecretDetail.description && <p className="text-muted">{companySecretDetail.description}</p>}
                <div className="d-flex gap-2 mb-3">
                  <span className="badge bg-secondary-subtle text-secondary">{companySecretDetail.category}</span>
                  <span className="badge bg-primary-subtle text-primary">
                    {t(`vault.types.${companySecretDetail.type}`)}
                  </span>
                </div>
                {companySecretDetail.fields && Object.entries(companySecretDetail.fields).length > 0 && (
                  <div className="table-responsive">
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>{t('vault.form.fieldKey')}</th>
                          <th>{t('vault.form.fieldValue')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(companySecretDetail.fields).map(([key, value]) => (
                          <tr key={key}>
                            <td className="fw-semibold">{key}</td>
                            <td>
                              <code className="text-break" style={{ fontSize: '0.85em' }}>
                                {key.toLowerCase().includes('secret') || key.toLowerCase().includes('password')
                                  ? '••••••••'
                                  : String(value)}
                              </code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setViewingCompanySecret(null);
                    setCompanySecretDetail(null);
                  }}
                >
                  {t('common:common.close', 'Close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Company Secret Delete Confirmation */}
      {deletingCompanySecret && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{t('vault.deleteSecret')}</h5>
                <button type="button" className="btn-close" onClick={() => setDeletingCompanySecret(null)} />
              </div>
              <div className="modal-body">
                <p>{t('vault.deleteConfirm', { name: deletingCompanySecret.name })}</p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setDeletingCompanySecret(null)}>
                  {t('common:common.cancel', 'Cancel')}
                </button>
                <button className="btn btn-danger" onClick={handleDeleteCompanySecret}>
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

export default VaultSecretsPage;

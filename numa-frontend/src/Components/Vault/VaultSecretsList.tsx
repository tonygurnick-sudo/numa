/**
 * VaultSecretsList — Table display of vault secrets metadata.
 */
import { useTranslation } from 'react-i18next';
import type { VaultSecretMetadata } from '../../Services/VaultService';
import './VaultSecretsList.scss';

const TYPE_ICONS: Record<string, string> = {
  login: 'bi bi-key-fill',
  api_key: 'bi bi-braces',
  secure_note: 'bi bi-file-lock-fill',
  custom: 'bi bi-puzzle-fill',
};

interface Props {
  secrets: VaultSecretMetadata[];
  onSelect: (secret: VaultSecretMetadata) => void;
  onEdit: (secret: VaultSecretMetadata) => void;
  onDelete: (secret: VaultSecretMetadata) => void;
}

export function VaultSecretsList({ secrets, onSelect, onEdit, onDelete }: Props) {
  const { t } = useTranslation('vault');

  if (secrets.length === 0) {
    return (
      <div className="text-center text-muted py-5">
        <i className="bi bi-shield-lock display-4 d-block mb-3" />
        <p>{t('vault.empty')}</p>
      </div>
    );
  }

  return (
    <div className="table-responsive vault-secrets-list">
      <table className="table table-hover align-middle">
        <thead>
          <tr>
            <th>{t('vault.columns.name')}</th>
            <th>{t('vault.columns.type')}</th>
            <th>{t('vault.columns.category')}</th>
            <th>{t('vault.columns.lastAccessed')}</th>
            <th>{t('vault.columns.created')}</th>
            <th className="text-end">{t('vault.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {secrets.map((secret) => (
            <tr key={secret.name} style={{ cursor: 'pointer' }} onClick={() => onSelect(secret)}>
              <td>
                <div className="d-flex align-items-center gap-2">
                  {secret.favorite && <i className="bi bi-star-fill text-warning" />}
                  <span className="fw-semibold">{secret.name}</span>
                  {secret.danger_mode && (
                    <span className="badge bg-danger-subtle text-danger" title={t('vault.form.dangerMode')}>
                      <i className="bi bi-exclamation-triangle-fill" />
                    </span>
                  )}
                </div>
                {secret.description && <small className="text-muted d-block">{secret.description}</small>}
              </td>
              <td data-label={t('vault.columns.type')}>
                <span className="d-flex align-items-center gap-1">
                  <i className={TYPE_ICONS[secret.type] || TYPE_ICONS.custom} />
                  {t(`vault.types.${secret.type ?? 'custom'}`)}
                </span>
              </td>
              <td data-label={t('vault.columns.category')}>
                <span className="badge bg-secondary-subtle text-secondary">{secret.category}</span>
              </td>
              <td data-label={t('vault.columns.lastAccessed')}>
                <small className="text-muted">
                  {secret.last_accessed_at ? new Date(secret.last_accessed_at).toLocaleDateString() : '-'}
                </small>
              </td>
              <td data-label={t('vault.columns.created')}>
                <small className="text-muted">{new Date(secret.created_at).toLocaleDateString()}</small>
              </td>
              <td className="text-end vault-cell-actions">
                <button
                  className="btn btn-sm btn-outline-secondary me-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(secret);
                  }}
                  title={t('vault.editSecret')}
                >
                  <i className="bi bi-pencil" />
                </button>
                <button
                  className="btn btn-sm btn-outline-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(secret);
                  }}
                  title={t('vault.deleteSecret')}
                >
                  <i className="bi bi-trash" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

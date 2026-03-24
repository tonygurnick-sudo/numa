/**
 * VaultSecretForm — Modal for creating / editing a vault secret.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import type { VaultSecretWithFields, CreateSecretPayload, UpdateSecretPayload } from '../../Services/VaultService';

export type SecretType = 'login' | 'api_key' | 'bearer_token' | 'secure_note' | 'custom';

const DEFAULT_FIELDS: Record<SecretType, Record<string, string>> = {
  login: { username: '', password: '', url: '' },
  api_key: { key: '', secret: '', endpoint: '' },
  bearer_token: { token: '', endpoint: '', prefix: 'Bearer' },
  secure_note: { content: '' },
  custom: {},
};

interface Props {
  show: boolean;
  onHide: () => void;
  onSubmit: (payload: CreateSecretPayload | UpdateSecretPayload) => Promise<void>;
  existingSecret?: VaultSecretWithFields | null;
  categories: string[];
  defaultType?: SecretType;
}

export function VaultSecretForm({ show, onHide, onSubmit, existingSecret, categories, defaultType }: Props) {
  const { t } = useTranslation('vault');
  const isEdit = !!existingSecret;

  const [name, setName] = useState('');
  const [type, setType] = useState<SecretType>('login');
  const [category, setCategory] = useState('General');
  const [newCategory, setNewCategory] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [description, setDescription] = useState('');
  const [dangerMode, setDangerMode] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<Array<{ key: string; value: string }>>([]);
  const [helpUrl, setHelpUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existingSecret) {
      setName(existingSecret.name);
      setType(existingSecret.type);
      setCategory(existingSecret.category);
      setDescription(existingSecret.description || '');
      setDangerMode(existingSecret.danger_mode);
      setFavorite(existingSecret.favorite);
      setHelpUrl(existingSecret.help_url || '');
      if (existingSecret.type === 'custom') {
        setCustomFields(Object.entries(existingSecret.fields || {}).map(([key, value]) => ({ key, value })));
      } else {
        setFields(existingSecret.fields || {});
      }
    } else {
      const initialType = defaultType ?? 'login';
      setName('');
      setType(initialType);
      setCategory('General');
      setDescription('');
      setDangerMode(false);
      setFavorite(false);
      setHelpUrl('');
      setFields({ ...DEFAULT_FIELDS[initialType] });
      setCustomFields([{ key: '', value: '' }]);
      setShowNewCategory(false);
      setNewCategory('');
    }
    setError(null);
  }, [existingSecret, show]);

  const handleTypeChange = useCallback(
    (newType: SecretType) => {
      setType(newType);
      if (!isEdit) {
        if (newType === 'custom') {
          setCustomFields([{ key: '', value: '' }]);
        } else {
          setFields({ ...DEFAULT_FIELDS[newType] });
        }
      }
    },
    [isEdit]
  );

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const effectiveCategory = showNewCategory && newCategory.trim() ? newCategory.trim() : category;
      const effectiveFields =
        type === 'custom'
          ? Object.fromEntries(customFields.filter((f) => f.key.trim()).map((f) => [f.key.trim(), f.value]))
          : fields;

      if (isEdit) {
        const payload: UpdateSecretPayload = {
          name,
          type,
          category: effectiveCategory,
          description,
          danger_mode: dangerMode,
          favorite,
          help_url: helpUrl || undefined,
          fields: effectiveFields,
        };
        await onSubmit(payload);
      } else {
        const payload: CreateSecretPayload = {
          name,
          type,
          category: effectiveCategory,
          description,
          danger_mode: dangerMode,
          favorite,
          help_url: helpUrl || undefined,
          fields: effectiveFields,
        };
        await onSubmit(payload);
      }
      onHide();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const renderTypedFields = () => {
    if (type === 'custom') {
      return (
        <>
          <Form.Label className="fw-semibold">{t('vault.form.fields')}</Form.Label>
          {customFields.map((field, idx) => (
            <div key={idx} className="d-flex gap-2 mb-2">
              <Form.Control
                size="sm"
                placeholder={t('vault.form.fieldKeyPlaceholder')}
                value={field.key}
                onChange={(e) => {
                  const updated = [...customFields];
                  updated[idx] = { ...updated[idx], key: e.target.value };
                  setCustomFields(updated);
                }}
              />
              <Form.Control
                size="sm"
                placeholder={t('vault.form.fieldValuePlaceholder')}
                type="password"
                value={field.value}
                onChange={(e) => {
                  const updated = [...customFields];
                  updated[idx] = { ...updated[idx], value: e.target.value };
                  setCustomFields(updated);
                }}
              />
              <Button
                variant="outline-danger"
                size="sm"
                onClick={() => setCustomFields(customFields.filter((_, i) => i !== idx))}
                disabled={customFields.length <= 1}
              >
                <i className="bi bi-x" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => setCustomFields([...customFields, { key: '', value: '' }])}
          >
            <i className="bi bi-plus me-1" />
            {t('vault.form.addField')}
          </Button>
        </>
      );
    }

    const fieldNamespace =
      type === 'login'
        ? 'loginFields'
        : type === 'api_key'
          ? 'apiKeyFields'
          : type === 'bearer_token'
            ? 'bearerTokenFields'
            : 'secureNoteFields';
    const fieldKeys = Object.keys(DEFAULT_FIELDS[type] || {});

    return (
      <>
        {fieldKeys.map((key) => (
          <Form.Group key={key} className="mb-2">
            <Form.Label>{t(`vault.${fieldNamespace}.${key}`)}</Form.Label>
            <Form.Control
              type={['password', 'secret', 'key', 'token', 'totp_seed', 'content'].includes(key) ? 'password' : 'text'}
              value={fields[key] || ''}
              onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
              placeholder={t(`vault.${fieldNamespace}.${key}`)}
            />
          </Form.Group>
        ))}
      </>
    );
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>{isEdit ? t('vault.editSecret') : t('vault.createSecret')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}

        <Form.Group className="mb-3">
          <Form.Label>{t('vault.form.name')}</Form.Label>
          <Form.Control
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('vault.form.namePlaceholder')}
          />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('vault.form.type')}</Form.Label>
          <Form.Select value={type} onChange={(e) => handleTypeChange(e.target.value as SecretType)} disabled={isEdit}>
            {(['login', 'api_key', 'bearer_token', 'secure_note', 'custom'] as SecretType[]).map((t_type) => (
              <option key={t_type} value={t_type}>
                {t(`vault.types.${t_type}`)} — {t(`vault.typeDescriptions.${t_type}`)}
              </option>
            ))}
          </Form.Select>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('vault.form.category')}</Form.Label>
          {!showNewCategory ? (
            <div className="d-flex gap-2">
              <Form.Select value={category} onChange={(e) => setCategory(e.target.value)} className="flex-grow-1">
                {[...new Set(['General', ...categories])].map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Form.Select>
              <Button variant="outline-secondary" size="sm" onClick={() => setShowNewCategory(true)}>
                <i className="bi bi-plus" />
              </Button>
            </div>
          ) : (
            <div className="d-flex gap-2">
              <Form.Control
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder={t('vault.form.categoryPlaceholder')}
              />
              <Button variant="outline-secondary" size="sm" onClick={() => setShowNewCategory(false)}>
                <i className="bi bi-x" />
              </Button>
            </div>
          )}
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('vault.form.description')}</Form.Label>
          <Form.Control
            as="textarea"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('vault.form.descriptionPlaceholder')}
          />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('vault.form.helpUrl')}</Form.Label>
          <Form.Control
            type="url"
            value={helpUrl}
            onChange={(e) => setHelpUrl(e.target.value)}
            placeholder={t('vault.form.helpUrlPlaceholder')}
          />
          {helpUrl && (
            <Form.Text>
              <a href={helpUrl} target="_blank" rel="noopener noreferrer">
                <i className="bi bi-box-arrow-up-right me-1" />
                {t('vault.form.openHelpLink')}
              </a>
            </Form.Text>
          )}
        </Form.Group>

        <hr />
        <h6 className="mb-3">{t('vault.form.fields')}</h6>
        {renderTypedFields()}

        <hr />
        <div className="d-flex gap-4">
          <Form.Check
            type="switch"
            label={t('vault.form.favorite')}
            checked={favorite}
            onChange={(e) => setFavorite(e.target.checked)}
          />
          <div>
            <Form.Check
              type="switch"
              label={
                <span>
                  {t('vault.form.dangerMode')} <i className="bi bi-exclamation-triangle-fill text-danger" />
                </span>
              }
              checked={dangerMode}
              onChange={(e) => setDangerMode(e.target.checked)}
            />
            {dangerMode && (
              <Alert variant="warning" className="mt-2 mb-0 py-2 small">
                <i className="bi bi-exclamation-triangle me-1" />
                {t('vault.form.dangerModeWarning')}
              </Alert>
            )}
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={submitting}>
          {t('common:common.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={submitting || !name.trim()}>
          {submitting && <span className="spinner-border spinner-border-sm me-1" />}
          {isEdit ? t('common:common.save', 'Save') : t('vault.createSecret')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

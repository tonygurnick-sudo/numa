/**
 * VaultSecretForm — Modal for creating / editing a vault secret.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Form, Alert, InputGroup } from 'react-bootstrap';
import type { VaultSecretWithFields, CreateSecretPayload, UpdateSecretPayload } from '../../Services/VaultService';
import { STANDARD_SECRET_TYPES } from '../../Services/VaultService';
import type { StandardSecretType } from '../../Services/VaultService';

export type SecretType = StandardSecretType;

const DEFAULT_FIELDS: Record<SecretType, Record<string, string>> = {
  login: { username: '', password: '', url: '' },
  api_key: { key: '', secret: '', endpoint: '' },
  bearer_token: { token: '', endpoint: '', prefix: 'Bearer' },
  secure_note: { content: '' },
  custom: {},
};

const SENSITIVE_KEYWORDS = ['password', 'secret', 'key', 'access_token', 'token', 'totp_seed', 'content'];

function isSensitive(fieldKey: string): boolean {
  return SENSITIVE_KEYWORDS.some((s) => fieldKey.toLowerCase().includes(s));
}

interface Props {
  show: boolean;
  onHide: () => void;
  onSubmit: (payload: CreateSecretPayload | UpdateSecretPayload) => Promise<void>;
  existingSecret?: VaultSecretWithFields | null;
  categories: string[];
  defaultType?: SecretType;
  readOnlyMetadata?: boolean;
}

export function VaultSecretForm({
  show,
  onHide,
  onSubmit,
  existingSecret,
  categories,
  defaultType,
  readOnlyMetadata,
}: Props) {
  const { t } = useTranslation('vault');
  const isEdit = !!existingSecret;
  const isSystemType =
    existingSecret &&
    (!existingSecret.type || !(STANDARD_SECRET_TYPES as readonly string[]).includes(existingSecret.type));

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
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    []
  );

  const toggleReveal = (fieldKey: string) => {
    setRevealedFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  const copyFieldValue = async (fieldKey: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldKey);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        setCopiedField(null);
        copyTimerRef.current = null;
      }, 2000);
    } catch (err) {
      console.warn('Clipboard write failed', err);
    }
  };

  useEffect(() => {
    if (existingSecret) {
      setName(existingSecret.name);
      // For system-generated secrets (null type), default to 'custom' for form state
      setType(
        existingSecret.type && (STANDARD_SECRET_TYPES as readonly string[]).includes(existingSecret.type)
          ? (existingSecret.type as SecretType)
          : 'custom'
      );
      setCategory(existingSecret.category);
      setDescription(existingSecret.description || '');
      setDangerMode(existingSecret.danger_mode);
      setFavorite(existingSecret.favorite);
      setHelpUrl(existingSecret.help_url || '');
      // For system-generated secrets, always render as custom fields
      if (existingSecret.type === 'custom' || isSystemType) {
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
    setRevealedFields(new Set());
    setCopiedField(null);
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
      const effectiveType = isSystemType ? (existingSecret?.type ?? 'custom') : type;
      const effectiveFields =
        type === 'custom' || isSystemType
          ? Object.fromEntries(customFields.filter((f) => f.key.trim()).map((f) => [f.key.trim(), f.value]))
          : fields;

      if (isEdit) {
        const payload: UpdateSecretPayload = {
          name,
          type: effectiveType,
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
          type: type,
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
    // System-generated secrets or custom: render as key-value pairs
    if (type === 'custom' || isSystemType) {
      return (
        <>
          <Form.Label className="fw-semibold">{t('vault.form.fields')}</Form.Label>
          {customFields.map((field, idx) => {
            const fieldRevealKey = `custom-${idx}`;
            const sensitive = isSensitive(field.key);
            const revealed = revealedFields.has(fieldRevealKey);
            return (
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
                  disabled={readOnlyMetadata && isSystemType}
                />
                <InputGroup size="sm" className="flex-grow-1">
                  <Form.Control
                    placeholder={t('vault.form.fieldValuePlaceholder')}
                    type={sensitive && !revealed ? 'password' : 'text'}
                    value={field.value}
                    onChange={(e) => {
                      const updated = [...customFields];
                      updated[idx] = { ...updated[idx], value: e.target.value };
                      setCustomFields(updated);
                    }}
                    disabled={readOnlyMetadata && isSystemType}
                  />
                  {sensitive && (
                    <Button
                      variant="outline-secondary"
                      onClick={() => toggleReveal(fieldRevealKey)}
                      title={revealed ? t('vault.detail.hide') : t('vault.detail.reveal')}
                      aria-label={revealed ? t('vault.detail.hide') : t('vault.detail.reveal')}
                      aria-pressed={revealed}
                    >
                      <i className={`bi ${revealed ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" />
                    </Button>
                  )}
                  {field.value && (
                    <Button
                      variant={copiedField === fieldRevealKey ? 'success' : 'outline-secondary'}
                      onClick={() => copyFieldValue(fieldRevealKey, field.value)}
                      title={copiedField === fieldRevealKey ? t('vault.detail.copied') : t('vault.detail.copy')}
                      aria-label={copiedField === fieldRevealKey ? t('vault.detail.copied') : t('vault.detail.copy')}
                    >
                      <i
                        className={`bi ${copiedField === fieldRevealKey ? 'bi-check' : 'bi-clipboard'}`}
                        aria-hidden="true"
                      />
                    </Button>
                  )}
                </InputGroup>
                {!isSystemType && (
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => setCustomFields(customFields.filter((_, i) => i !== idx))}
                    disabled={customFields.length <= 1}
                  >
                    <i className="bi bi-x" />
                  </Button>
                )}
              </div>
            );
          })}
          {!isSystemType && (
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => setCustomFields([...customFields, { key: '', value: '' }])}
            >
              <i className="bi bi-plus me-1" />
              {t('vault.form.addField')}
            </Button>
          )}
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
        {fieldKeys.map((key) => {
          const sensitive = isSensitive(key);
          const revealed = revealedFields.has(key);
          return (
            <Form.Group key={key} className="mb-2">
              <Form.Label>{t(`vault.${fieldNamespace}.${key}`)}</Form.Label>
              <InputGroup>
                <Form.Control
                  type={sensitive && !revealed ? 'password' : 'text'}
                  value={fields[key] || ''}
                  onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                  placeholder={t(`vault.${fieldNamespace}.${key}`)}
                />
                {sensitive && (
                  <Button
                    variant="outline-secondary"
                    onClick={() => toggleReveal(key)}
                    title={revealed ? t('vault.detail.hide') : t('vault.detail.reveal')}
                    aria-label={revealed ? t('vault.detail.hide') : t('vault.detail.reveal')}
                    aria-pressed={revealed}
                  >
                    <i className={`bi ${revealed ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" />
                  </Button>
                )}
                {fields[key] && (
                  <Button
                    variant={copiedField === key ? 'success' : 'outline-secondary'}
                    onClick={() => copyFieldValue(key, fields[key] || '')}
                    title={copiedField === key ? t('vault.detail.copied') : t('vault.detail.copy')}
                    aria-label={copiedField === key ? t('vault.detail.copied') : t('vault.detail.copy')}
                  >
                    <i className={`bi ${copiedField === key ? 'bi-check' : 'bi-clipboard'}`} aria-hidden="true" />
                  </Button>
                )}
              </InputGroup>
            </Form.Group>
          );
        })}
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

        {readOnlyMetadata && (
          <Alert variant="info" className="py-2 small">
            <i className="bi bi-info-circle me-1" />
            {t('vault.form.generatedSecretInfo')}
          </Alert>
        )}

        <Form.Group className="mb-3">
          <Form.Label>{t('vault.form.name')}</Form.Label>
          <Form.Control
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('vault.form.namePlaceholder')}
            disabled={readOnlyMetadata}
          />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('vault.form.type')}</Form.Label>
          {isSystemType ? (
            <Form.Control value={t('vault.types.system')} disabled />
          ) : (
            <Form.Select
              value={type}
              onChange={(e) => handleTypeChange(e.target.value as SecretType)}
              disabled={isEdit}
            >
              {(['login', 'api_key', 'bearer_token', 'secure_note', 'custom'] as SecretType[]).map((t_type) => (
                <option key={t_type} value={t_type}>
                  {t(`vault.types.${t_type}`)} — {t(`vault.typeDescriptions.${t_type}`)}
                </option>
              ))}
            </Form.Select>
          )}
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('vault.form.category')}</Form.Label>
          {!showNewCategory ? (
            <div className="d-flex gap-2">
              <Form.Select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="flex-grow-1"
                disabled={readOnlyMetadata}
              >
                {[...new Set(['General', ...categories])].map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Form.Select>
              {!readOnlyMetadata && (
                <Button variant="outline-secondary" size="sm" onClick={() => setShowNewCategory(true)}>
                  <i className="bi bi-plus" />
                </Button>
              )}
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
            disabled={readOnlyMetadata}
          />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('vault.form.helpUrl')}</Form.Label>
          <Form.Control
            type="url"
            value={helpUrl}
            onChange={(e) => setHelpUrl(e.target.value)}
            placeholder={t('vault.form.helpUrlPlaceholder')}
            disabled={readOnlyMetadata}
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
            disabled={readOnlyMetadata}
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
              disabled={readOnlyMetadata}
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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';

import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import type { Contact, CreateCustomerPayload, CrmConfig, Customer, FieldDefinition } from '../../../types/ops';
import { ContactSection } from '../Shared/ContactSection';
import { isBuiltinField, resolveCustomerRecord, resolveCustomerRecordLayout } from '../Shared/customerRecordFields';
import { isEmptyValue, renderEditControl } from './CustomerRecordSectionBlock';

interface CreateCustomerModalProps {
  show: boolean;
  onHide: () => void;
  onCreated: (customer: Customer) => void;
  /** Pre-fill the lifecycle stage (e.g. the first pipeline column) */
  defaultLifecycleStage?: string;
}

/** Placeholder customer used to satisfy renderEditControl's ctx.customer contract. */
const buildPlaceholderCustomer = (): Customer => ({
  id: '',
  companyName: '',
  lifecycleStage: '',
  flags: [],
  notes: '',
  contacts: [],
  openTicketCount: 0,
  createdBy: '',
  createdAt: '',
  updatedAt: '',
});

export function CreateCustomerModal({
  show,
  onHide,
  onCreated,
  defaultLifecycleStage,
}: CreateCustomerModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaGet, numaPost, numaPut } = useNumaRequest();
  const { config } = useOps();

  const crmConfig: CrmConfig | null = config?.crmConfig ?? null;
  const staff = config?.staff ?? [];
  const allFields = config?.fields ?? [];

  const customerRecord = useMemo(() => resolveCustomerRecord(crmConfig), [crmConfig]);
  const layout = useMemo(() => resolveCustomerRecordLayout(crmConfig), [crmConfig]);

  const activeStaff = useMemo(() => staff.filter((s) => s.isActive), [staff]);

  const fieldDefById = useMemo(() => {
    const map = new Map<string, FieldDefinition>();
    for (const f of allFields) map.set(f.id, f);
    return map;
  }, [allFields]);

  // companyName is always required by the backend, regardless of admin config.
  const alwaysRequiredFieldIds = useMemo(() => new Set<string>(['companyName']), []);

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [notes, setNotes] = useState('');
  const [missingRequired, setMissingRequired] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = React.useRef<HTMLInputElement>(null);

  // Reset state when the modal opens.
  useEffect(() => {
    if (!show) return;
    const initial: Record<string, unknown> = {};
    if (defaultLifecycleStage) initial.lifecycleStage = defaultLifecycleStage;
    setDraft(initial);
    setContacts([]);
    setNotes('');
    setMissingRequired(new Set());
    setError(null);
    setLogoFile(null);
    setLogoPreview(null);
  }, [show, defaultLifecycleStage]);

  const setDraftField = useCallback((fieldId: string, value: unknown) => {
    setDraft((prev) => ({ ...prev, [fieldId]: value }));
    setMissingRequired((prev) => {
      if (!prev.has(fieldId)) return prev;
      if (isEmptyValue(value)) return prev;
      const next = new Set(prev);
      next.delete(fieldId);
      return next;
    });
  }, []);

  const handleLogoPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoFile(file);
    const url = URL.createObjectURL(file);
    setLogoPreview(url);
  }, []);

  const placeholderCustomer = useMemo(buildPlaceholderCustomer, []);

  const editColClass = `col-md-6 col-lg-${12 / layout.columnsPerSection}`;

  const handleSubmit = useCallback(async () => {
    if (!crmConfig) return;

    // Gather required field ids from every section's requiredFieldIds + companyName.
    const requiredIds = new Set<string>(alwaysRequiredFieldIds);
    for (const section of customerRecord.sections) {
      for (const id of section.requiredFieldIds ?? []) requiredIds.add(id);
    }

    // Validate.
    const missing = new Set<string>();
    for (const id of requiredIds) {
      if (isEmptyValue(draft[id])) missing.add(id);
    }
    if (missing.size > 0) {
      setMissingRequired(missing);
      return;
    }

    // Build payload: built-in fields go at the top level, others into customFields.
    const payload: Record<string, unknown> = {};
    const customFields: Record<string, unknown> = {};
    for (const section of customerRecord.sections) {
      for (const fieldId of section.fieldIds) {
        const value = draft[fieldId];
        if (value === undefined) continue;
        if (isBuiltinField(fieldId)) {
          payload[fieldId] = value;
        } else {
          customFields[fieldId] = value;
        }
      }
    }
    if (Object.keys(customFields).length > 0) {
      payload.customFields = customFields;
    }
    if (contacts.length > 0) payload.contacts = contacts;
    const trimmedNotes = notes.trim();
    if (trimmedNotes) payload.notes = trimmedNotes;

    // Ensure companyName is a string (validation already confirmed non-empty).
    payload.companyName = String(draft.companyName ?? '').trim();

    setSaving(true);
    setError(null);
    try {
      let customer = await OpsService.createCustomer(numaPost, payload as CreateCustomerPayload);

      // Upload logo if one was picked (two-step: create customer, then upload logo)
      if (logoFile && customer.id) {
        try {
          const { uploadUrl, s3Key } = await OpsService.getPresignedUrl(numaPost, {
            context: 'customer',
            contextId: customer.id,
            fileName: logoFile.name,
            contentType: logoFile.type,
          });
          await fetch(uploadUrl, {
            method: 'PUT',
            body: logoFile,
            headers: { 'Content-Type': logoFile.type },
          });
          await OpsService.updateCustomer(numaPut, customer.id, { logoS3Key: s3Key });

          // Re-fetch the customer so downstream views receive the persisted logo
          // metadata plus the backend-resolved presigned URL.
          const refreshed = await OpsService.getCustomer(numaGet, customer.id);
          customer = refreshed.customer;
        } catch (logoErr) {
          console.error('[CreateCustomerModal] Logo upload failed (customer created)', logoErr);
        }
      }

      onCreated(customer);
    } catch (err) {
      console.error('[CreateCustomerModal] Create failed', err);
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [
    crmConfig,
    customerRecord,
    draft,
    contacts,
    notes,
    numaGet,
    numaPost,
    numaPut,
    onCreated,
    alwaysRequiredFieldIds,
    logoFile,
  ]);

  if (!show) return <></>;

  if (!crmConfig) {
    return (
      <Modal show={show} onHide={onHide} centered>
        <Modal.Body>
          <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 160 }}>
            <Spinner animation="border" />
          </div>
        </Modal.Body>
      </Modal>
    );
  }

  const hasValidationErrors = missingRequired.size > 0;

  return (
    <Modal
      show={show}
      onHide={saving ? undefined : onHide}
      size="xl"
      fullscreen="lg-down"
      scrollable
      dialogClassName="crm-detail-modal"
      contentClassName="d-flex flex-column"
    >
      <Modal.Header closeButton={!saving}>
        <div className="d-flex align-items-center gap-3">
          {/* Hidden file input */}
          <input ref={logoInputRef} type="file" accept="image/*" className="d-none" onChange={handleLogoPick} />
          {/* Logo picker */}
          <div
            className="flex-shrink-0 d-flex align-items-center justify-content-center"
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              border: logoPreview ? '1px solid #e5e7eb' : '2px dashed #d1d5db',
              backgroundColor: logoPreview ? '#fff' : '#f9fafb',
              cursor: 'pointer',
              overflow: 'hidden',
              transition: 'border-color 0.15s, background-color 0.15s',
            }}
            role="button"
            tabIndex={0}
            title={t('crm.uploadLogo')}
            onClick={() => logoInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') logoInputRef.current?.click();
            }}
            onMouseEnter={(e) => {
              if (!logoPreview) {
                (e.currentTarget as HTMLElement).style.borderColor = '#8b5cf6';
                (e.currentTarget as HTMLElement).style.backgroundColor = '#faf5ff';
              }
            }}
            onMouseLeave={(e) => {
              if (!logoPreview) {
                (e.currentTarget as HTMLElement).style.borderColor = '#d1d5db';
                (e.currentTarget as HTMLElement).style.backgroundColor = '#f9fafb';
              }
            }}
          >
            {logoPreview ? (
              <img src={logoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div className="d-flex flex-column align-items-center">
                <i className="bi bi-image" style={{ fontSize: '1rem', color: '#9ca3af' }} />
                <span style={{ fontSize: '0.55rem', color: '#9ca3af', marginTop: 1 }}>{t('crm.logo')}</span>
              </div>
            )}
          </div>
          <Modal.Title as="h5" className="fw-bold">
            {t('crm.createCustomerTitle', 'New customer')}
          </Modal.Title>
        </div>
      </Modal.Header>

      <Modal.Body style={{ overflowY: 'auto' }}>
        {(hasValidationErrors || error) && (
          <div style={{ padding: '12px 20px 0' }}>
            {hasValidationErrors && (
              <div className="alert alert-danger py-2 px-3 small mb-2">
                {t('crm.requiredFieldsMissing', 'Please fill out all required fields before saving.')}
              </div>
            )}
            {error && (
              <div className="alert alert-danger py-2 px-3 small mb-2">
                {t('errors.loadFailed', { message: error })}
              </div>
            )}
          </div>
        )}

        {/* Customer record sections — always expanded, always in edit mode */}
        {customerRecord.sections.map((section) => {
          const sectionRequired = new Set<string>(section.requiredFieldIds ?? []);
          // companyName is always required regardless of admin config.
          if (section.fieldIds.includes('companyName')) sectionRequired.add('companyName');

          return (
            <div key={section.id}>
              <div className="crm-section-header" style={{ cursor: 'default' }}>
                <span className="crm-section-header-title">{section.name}</span>
              </div>
              <div className="crm-section-body">
                <div className="row g-3">
                  {section.fieldIds.map((fieldId) => (
                    <div key={fieldId} className={editColClass}>
                      {renderEditControl(fieldId, draft[fieldId], (next) => setDraftField(fieldId, next), {
                        customer: placeholderCustomer,
                        crmConfig,
                        staff: activeStaff,
                        fieldDefById,
                        saving,
                        t,
                        requiredFieldIds: sectionRequired,
                        missingRequired,
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}

        {/* If companyName isn't part of the configurable record (admin removed it),
            render it as a fallback — backend requires it. */}
        {!customerRecord.sections.some((s) => s.fieldIds.includes('companyName')) && (
          <>
            <div className="crm-section-header" style={{ cursor: 'default' }}>
              <span className="crm-section-header-title">{t('common.name')}</span>
            </div>
            <div className="crm-section-body">
              <Form.Label className="small text-muted mb-1">
                {t('common.name')}
                <span className="text-danger ms-1">*</span>
              </Form.Label>
              <Form.Control
                size="sm"
                isInvalid={missingRequired.has('companyName')}
                value={String(draft.companyName ?? '')}
                onChange={(e) => setDraftField('companyName', e.target.value)}
              />
              {missingRequired.has('companyName') && (
                <div className="text-danger small mt-1">{t('crm.requiredFieldMessage', 'This field is required.')}</div>
              )}
            </div>
          </>
        )}

        {/* Contacts */}
        <div className="crm-section-header" style={{ cursor: 'default' }}>
          <span className="crm-section-header-title">{t('crm.contacts')}</span>
        </div>
        <div className="crm-section-body">
          <ContactSection contacts={contacts} onChange={setContacts} />
        </div>

        {/* Notes */}
        <div className="crm-section-header" style={{ cursor: 'default' }}>
          <span className="crm-section-header-title">{t('crm.accountNotes')}</span>
        </div>
        <div className="crm-section-body">
          <Form.Control
            as="textarea"
            rows={5}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={saving}
            style={{ fontSize: '0.9rem', resize: 'vertical' }}
          />
        </div>
      </Modal.Body>

      <Modal.Footer className="d-flex justify-content-end gap-2">
        <Button variant="outline-secondary" size="sm" onClick={onHide} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size="sm" onClick={handleSubmit} disabled={saving}>
          {saving ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" />
              {t('crm.creatingCustomer')}
            </>
          ) : (
            t('crm.createCustomer')
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

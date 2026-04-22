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
  const { numaPost } = useNumaRequest();
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
      const customer = await OpsService.createCustomer(numaPost, payload as CreateCustomerPayload);
      onCreated(customer);
    } catch (err) {
      console.error('[CreateCustomerModal] Create failed', err);
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [crmConfig, customerRecord, draft, contacts, notes, numaPost, onCreated, alwaysRequiredFieldIds]);

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
        <Modal.Title as="h5" className="fw-bold">
          {t('crm.createCustomerTitle', 'New customer')}
        </Modal.Title>
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

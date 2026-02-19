import React, { useState, useEffect, useCallback } from 'react';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Badge from 'react-bootstrap/Badge';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import Accordion from 'react-bootstrap/Accordion';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import type {
  Customer,
  Activity,
  Document as OpsDocument,
  CrmConfig,
  CrmLifecycleStage,
  Contact,
  UpdateCustomerPayload,
  Ticket,
} from '../../../types/ops';
import { ContactSection } from '../Shared/ContactSection';
import { ActivitySection } from '../Shared/ActivitySection';
import { DocumentSection } from '../Shared/DocumentSection';
import { getColorForPosition, getContrastTextColor } from '../Shared/colorUtils';
import { PriorityIndicator } from '../Shared/PriorityIndicator';
import { CreateTicketModal } from './CreateTicketModal';
import { TicketDetailModal } from './TicketDetailModal';

// ─── Props ──────────────────────────────────────────────────────────────────

interface CustomerDetailModalProps {
  show: boolean;
  customerId: string | null;
  onHide: () => void;
  onUpdated?: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function toDateInputValue(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * CustomerDetailModal is a large detail view for viewing and inline-editing
 * a customer record.
 *
 * Sections (collapsible):
 * 1. Company Details - inline-editable fields
 * 2. Contract - inline-editable contract fields
 * 3. Contacts - uses shared ContactSection
 * 4. Activities - uses shared ActivitySection
 * 5. Documents - uses shared DocumentSection
 * 6. Linked Work - ticket count display
 * 7. Notes - inline-editable textarea
 */
export function CustomerDetailModal({
  show,
  customerId,
  onHide,
  onUpdated,
}: CustomerDetailModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaGet, numaPut } = useNumaRequest();
  const { config } = useOps();

  // ── Core state ──────────────────────────────────────────────────────────

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [documents, setDocuments] = useState<OpsDocument[]>([]);
  const [linkedTickets, setLinkedTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [showCreateTicket, setShowCreateTicket] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Inline editing state ──────────────────────────────────────────────

  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState<string>('');

  const crmConfig: CrmConfig | null = config?.crmConfig ?? null;
  const staff = config?.staff ?? [];
  const stages = crmConfig?.lifecycleStages ?? [];
  const industries = crmConfig?.industries ?? [];
  const territories = crmConfig?.territories ?? [];
  const documentTypes = crmConfig?.documentTypes ?? [];
  const customerFlags = crmConfig?.customerFlags ?? [];

  // ── Load customer data ────────────────────────────────────────────────

  const loadCustomer = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await OpsService.getCustomer(numaGet, customerId);
      setCustomer(response.customer);
      setActivities(response.activities ?? []);
      setDocuments(response.documents ?? []);
    } catch (err) {
      console.error('[CustomerDetailModal] Failed to load customer', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [numaGet, customerId]);

  useEffect(() => {
    if (show && customerId) {
      void loadCustomer();
      setEditingField(null);
      // Load linked tickets
      setLoadingTickets(true);
      void OpsService.listTickets(numaGet, { customerId })
        .then((res) => setLinkedTickets(res.tickets))
        .catch((err) => console.error('[CustomerDetailModal] Failed to load linked tickets', err))
        .finally(() => setLoadingTickets(false));
    }
    if (!show) {
      setCustomer(null);
      setActivities([]);
      setDocuments([]);
      setLinkedTickets([]);
      setSelectedTicket(null);
      setShowCreateTicket(false);
      setError(null);
    }
  }, [show, customerId, loadCustomer, numaGet]);

  // ── Generic update handler ────────────────────────────────────────────

  const handleUpdate = useCallback(
    async (payload: UpdateCustomerPayload) => {
      if (!customer || !customerId) return;
      setSaving(true);
      try {
        const updated = await OpsService.updateCustomer(numaPut, customerId, payload);
        setCustomer(updated);
        onUpdated?.();
      } catch (err) {
        console.error('[CustomerDetailModal] Update failed', err);
      } finally {
        setSaving(false);
      }
    },
    [customer, customerId, numaPut, onUpdated],
  );

  // ── Inline edit helpers ───────────────────────────────────────────────

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setFieldDraft(currentValue);
  };

  const saveField = async (field: string, rawValue?: string) => {
    const value = (rawValue ?? fieldDraft).trim();
    setEditingField(null);

    // Determine whether the value actually changed
    const currentValue = String((customer as Record<string, unknown>)?.[field] ?? '');
    if (value === currentValue) return;

    await handleUpdate({ [field]: value || null } as UpdateCustomerPayload);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setFieldDraft('');
  };

  // ── Select field handler (immediate save, no inline editing state) ────

  const handleSelectChange = async (field: string, value: string) => {
    await handleUpdate({ [field]: value || null } as UpdateCustomerPayload);
  };

  // ── Number field handler ──────────────────────────────────────────────

  const saveNumberField = async (field: string) => {
    setEditingField(null);
    const numericValue = fieldDraft ? parseFloat(fieldDraft) : null;
    await handleUpdate({ [field]: numericValue } as UpdateCustomerPayload);
  };

  // ── Contacts change handler ───────────────────────────────────────────

  const handleContactsChange = useCallback(
    (newContacts: Contact[]) => {
      if (!customer) return;
      // Optimistic local update
      setCustomer({ ...customer, contacts: newContacts });
      void handleUpdate({ contacts: newContacts });
    },
    [customer, handleUpdate],
  );

  // ── Flag toggle ───────────────────────────────────────────────────────

  const toggleFlag = useCallback(
    (flagId: string) => {
      if (!customer) return;
      const newFlags = customer.flags.includes(flagId)
        ? customer.flags.filter((f) => f !== flagId)
        : [...customer.flags, flagId];
      setCustomer({ ...customer, flags: newFlags });
      void handleUpdate({ flags: newFlags });
    },
    [customer, handleUpdate],
  );

  // ── Render helpers ────────────────────────────────────────────────────

  /**
   * Renders an inline-editable text field row.
   */
  const renderEditableRow = (
    label: string,
    field: string,
    currentValue: string | null | undefined,
    type: 'text' | 'url' | 'date' = 'text',
  ) => {
    const displayValue =
      type === 'date' && currentValue ? new Date(currentValue).toLocaleDateString() : (currentValue ?? '');

    return (
      <div className="d-flex align-items-start py-2 border-bottom" style={{ fontSize: '0.875rem' }}>
        <span className="text-muted fw-semibold me-2" style={{ minWidth: 120, flexShrink: 0 }}>
          {label}
        </span>
        {editingField === field ? (
          <div className="d-flex align-items-center gap-1 flex-grow-1">
            <Form.Control
              type={type}
              size="sm"
              value={type === 'date' ? toDateInputValue(fieldDraft) : fieldDraft}
              onChange={(e) => setFieldDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveField(field);
                if (e.key === 'Escape') cancelEdit();
              }}
              onBlur={() => void saveField(field)}
              style={{ fontSize: '0.85rem' }}
              autoFocus
              disabled={saving}
            />
          </div>
        ) : (
          <span
            className="flex-grow-1"
            style={{ cursor: 'pointer', minWidth: 0 }}
            onClick={() => startEdit(field, type === 'date' ? toDateInputValue(currentValue) : (currentValue ?? ''))}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                startEdit(field, type === 'date' ? toDateInputValue(currentValue) : (currentValue ?? ''));
              }
            }}
          >
            {displayValue || <span className="text-muted">{t('common.none')}</span>}
          </span>
        )}
      </div>
    );
  };

  /**
   * Renders a select field row (immediate save on change).
   */
  const renderSelectRow = (
    label: string,
    field: string,
    currentValue: string | null | undefined,
    options: { value: string; label: string; color?: string }[],
  ) => (
    <div className="d-flex align-items-start py-2 border-bottom" style={{ fontSize: '0.875rem' }}>
      <span className="text-muted fw-semibold me-2" style={{ minWidth: 120, flexShrink: 0 }}>
        {label}
      </span>
      <Form.Select
        size="sm"
        value={currentValue ?? ''}
        onChange={(e) => void handleSelectChange(field, e.target.value)}
        style={{ fontSize: '0.85rem' }}
        disabled={saving}
      >
        <option value="">{t('common.selectOption')}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Form.Select>
    </div>
  );

  /**
   * Renders an inline-editable currency field row.
   */
  const renderCurrencyRow = (label: string, field: string, currentValue: number | null | undefined) => (
    <div className="d-flex align-items-start py-2 border-bottom" style={{ fontSize: '0.875rem' }}>
      <span className="text-muted fw-semibold me-2" style={{ minWidth: 120, flexShrink: 0 }}>
        {label}
      </span>
      {editingField === field ? (
        <div className="d-flex align-items-center gap-1 flex-grow-1">
          <Form.Control
            type="number"
            size="sm"
            value={fieldDraft}
            onChange={(e) => setFieldDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveNumberField(field);
              if (e.key === 'Escape') cancelEdit();
            }}
            onBlur={() => void saveNumberField(field)}
            style={{ fontSize: '0.85rem' }}
            autoFocus
            disabled={saving}
          />
        </div>
      ) : (
        <span
          className="flex-grow-1"
          style={{ cursor: 'pointer', minWidth: 0 }}
          onClick={() => startEdit(field, currentValue != null ? String(currentValue) : '')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              startEdit(field, currentValue != null ? String(currentValue) : '');
            }
          }}
        >
          {currentValue != null ? formatCurrency(currentValue) : <span className="text-muted">{t('common.none')}</span>}
        </span>
      )}
    </div>
  );

  // ── Render: loading / error states ────────────────────────────────────

  if (!show) return <></>;

  const renderLoading = () => (
    <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 300 }}>
      <Spinner animation="border" />
    </div>
  );

  const renderError = () => (
    <div className="text-center py-5">
      <p className="text-danger">{t('errors.loadFailed', { message: error ?? '' })}</p>
      <Button variant="outline-primary" size="sm" onClick={() => void loadCustomer()}>
        {t('common.loading')}
      </Button>
    </div>
  );

  // ── Render: header ────────────────────────────────────────────────────

  const renderHeader = () => {
    if (!customer) return null;

    const stage: CrmLifecycleStage | undefined = stages.find((s) => s.id === customer.lifecycleStage);
    const stageColor = stage ? getColorForPosition(stage.colorPosition) : '#6c757d';
    const stageTextColor = getContrastTextColor(stageColor);

    return (
      <Modal.Header closeButton className="align-items-start">
        <div className="d-flex flex-column flex-grow-1 me-2" style={{ minWidth: 0 }}>
          {/* Company name + stage badge */}
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <h5 className="mb-0 fw-bold">{customer.companyName}</h5>
            {stage && (
              <Badge
                pill
                style={{
                  backgroundColor: stageColor,
                  color: stageTextColor,
                  fontSize: '0.8rem',
                }}
              >
                {stage.name}
              </Badge>
            )}
            {saving && <Spinner animation="border" size="sm" className="ms-1" />}
          </div>

          {/* Flag toggles */}
          <div className="d-flex flex-wrap gap-1 mt-2">
            {customerFlags.map((flag) => {
              const isActive = customer.flags.includes(flag.id);
              return (
                <Badge
                  key={flag.id}
                  pill
                  role="button"
                  tabIndex={0}
                  style={{
                    backgroundColor: isActive ? flag.color : '#e9ecef',
                    color: isActive ? getContrastTextColor(flag.color) : '#6c757d',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    opacity: isActive ? 1 : 0.6,
                    transition: 'opacity 0.15s ease',
                  }}
                  onClick={() => toggleFlag(flag.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') toggleFlag(flag.id);
                  }}
                  title={flag.name}
                >
                  {flag.icon && <i className={`bi bi-${flag.icon} me-1`} />}
                  {flag.name}
                </Badge>
              );
            })}
          </div>
        </div>
      </Modal.Header>
    );
  };

  // ── Render: body ──────────────────────────────────────────────────────

  const renderBody = () => {
    if (!customer || !crmConfig) return null;

    // Staff options for owner select
    const staffOptions = staff.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }));

    // Lifecycle stage options with colors
    const stageOptions = stages.map((s) => ({
      value: s.id,
      label: s.name,
      color: getColorForPosition(s.colorPosition),
    }));

    // Industry options
    const industryOptions = industries.map((i) => ({ value: i, label: i }));

    // Territory options
    const territoryOptions = territories.map((ter) => ({ value: ter, label: ter }));

    return (
      <Accordion defaultActiveKey={['0']} alwaysOpen flush>
        {/* ── Section 1: Company Details ───────────────────────────────── */}
        <Accordion.Item eventKey="0">
          <Accordion.Header>{t('crm.companyDetails')}</Accordion.Header>
          <Accordion.Body className="p-3">
            {renderEditableRow(t('common.name'), 'companyName', customer.companyName)}
            {renderSelectRow(t('crm.industry'), 'industry', customer.industry, industryOptions)}
            {renderEditableRow(t('crm.companySize'), 'companySize', customer.companySize)}
            {renderEditableRow(t('crm.website'), 'website', customer.website, 'url')}
            {renderSelectRow(t('crm.territory'), 'territory', customer.territory, territoryOptions)}
            {renderEditableRow(t('crm.source'), 'source', customer.source)}
            {renderSelectRow(t('crm.owner'), 'ownerId', customer.ownerId, staffOptions)}
            {renderSelectRow(t('crm.lifecycleStage'), 'lifecycleStage', customer.lifecycleStage, stageOptions)}
          </Accordion.Body>
        </Accordion.Item>

        {/* ── Section 2: Contract ──────────────────────────────────────── */}
        <Accordion.Item eventKey="1">
          <Accordion.Header>{t('crm.contract')}</Accordion.Header>
          <Accordion.Body className="p-3">
            {renderCurrencyRow(t('crm.contractValue'), 'contractValue', customer.contractValue)}
            {renderEditableRow(t('crm.contractTerm'), 'contractTerm', customer.contractTerm)}
            {renderEditableRow(t('crm.contractStart'), 'contractStartDate', customer.contractStartDate, 'date')}
            {renderEditableRow(t('crm.renewalDate'), 'renewalDate', customer.renewalDate, 'date')}
            {/* Products: comma-separated text */}
            {editingField === 'products' ? (
              <div className="d-flex align-items-start py-2 border-bottom" style={{ fontSize: '0.875rem' }}>
                <span className="text-muted fw-semibold me-2" style={{ minWidth: 120, flexShrink: 0 }}>
                  {t('crm.products')}
                </span>
                <div className="flex-grow-1">
                  <Form.Control
                    type="text"
                    size="sm"
                    value={fieldDraft}
                    onChange={(e) => setFieldDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setEditingField(null);
                        const products = fieldDraft
                          .split(',')
                          .map((p) => p.trim())
                          .filter((p) => p.length > 0);
                        void handleUpdate({ products: products.length > 0 ? products : null });
                      }
                      if (e.key === 'Escape') cancelEdit();
                    }}
                    onBlur={() => {
                      setEditingField(null);
                      const products = fieldDraft
                        .split(',')
                        .map((p) => p.trim())
                        .filter((p) => p.length > 0);
                      void handleUpdate({ products: products.length > 0 ? products : null });
                    }}
                    style={{ fontSize: '0.85rem' }}
                    autoFocus
                    disabled={saving}
                  />
                </div>
              </div>
            ) : (
              <div className="d-flex align-items-start py-2 border-bottom" style={{ fontSize: '0.875rem' }}>
                <span className="text-muted fw-semibold me-2" style={{ minWidth: 120, flexShrink: 0 }}>
                  {t('crm.products')}
                </span>
                <span
                  className="flex-grow-1"
                  style={{ cursor: 'pointer', minWidth: 0 }}
                  onClick={() => startEdit('products', (customer.products ?? []).join(', '))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      startEdit('products', (customer.products ?? []).join(', '));
                    }
                  }}
                >
                  {customer.products && customer.products.length > 0 ? (
                    <div className="d-flex flex-wrap gap-1">
                      {customer.products.map((p) => (
                        <Badge key={p} bg="light" text="dark" className="border" style={{ fontSize: '0.75rem' }}>
                          {p}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted">{t('common.none')}</span>
                  )}
                </span>
              </div>
            )}
            {/* Product notes (textarea) */}
            {editingField === 'productNotes' ? (
              <div className="d-flex align-items-start py-2 border-bottom" style={{ fontSize: '0.875rem' }}>
                <span className="text-muted fw-semibold me-2" style={{ minWidth: 120, flexShrink: 0 }}>
                  {t('crm.productNotes')}
                </span>
                <div className="flex-grow-1">
                  <Form.Control
                    as="textarea"
                    size="sm"
                    rows={3}
                    value={fieldDraft}
                    onChange={(e) => setFieldDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void saveField('productNotes');
                      if (e.key === 'Escape') cancelEdit();
                    }}
                    onBlur={() => void saveField('productNotes')}
                    style={{ fontSize: '0.85rem' }}
                    autoFocus
                    disabled={saving}
                  />
                </div>
              </div>
            ) : (
              <div className="d-flex align-items-start py-2 border-bottom" style={{ fontSize: '0.875rem' }}>
                <span className="text-muted fw-semibold me-2" style={{ minWidth: 120, flexShrink: 0 }}>
                  {t('crm.productNotes')}
                </span>
                <span
                  className="flex-grow-1"
                  style={{ cursor: 'pointer', minWidth: 0, whiteSpace: 'pre-wrap' }}
                  onClick={() => startEdit('productNotes', customer.productNotes ?? '')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      startEdit('productNotes', customer.productNotes ?? '');
                    }
                  }}
                >
                  {customer.productNotes || <span className="text-muted">{t('common.none')}</span>}
                </span>
              </div>
            )}
          </Accordion.Body>
        </Accordion.Item>

        {/* ── Section 3: Contacts ──────────────────────────────────────── */}
        <Accordion.Item eventKey="2">
          <Accordion.Header>
            {t('crm.contacts')}
            {customer.contacts.length > 0 && (
              <Badge bg="secondary" className="ms-2" style={{ fontSize: '0.7rem' }}>
                {customer.contacts.length}
              </Badge>
            )}
          </Accordion.Header>
          <Accordion.Body className="p-3">
            <ContactSection contacts={customer.contacts} onChange={handleContactsChange} />
          </Accordion.Body>
        </Accordion.Item>

        {/* ── Section 4: Activities ────────────────────────────────────── */}
        <Accordion.Item eventKey="3">
          <Accordion.Header>
            {t('crm.activities')}
            {activities.length > 0 && (
              <Badge bg="secondary" className="ms-2" style={{ fontSize: '0.7rem' }}>
                {activities.length}
              </Badge>
            )}
          </Accordion.Header>
          <Accordion.Body className="p-3">
            <ActivitySection entityType="customer" entityId={customer.id} activities={activities} />
          </Accordion.Body>
        </Accordion.Item>

        {/* ── Section 5: Documents ─────────────────────────────────────── */}
        <Accordion.Item eventKey="4">
          <Accordion.Header>
            {t('crm.documents')}
            {documents.length > 0 && (
              <Badge bg="secondary" className="ms-2" style={{ fontSize: '0.7rem' }}>
                {documents.length}
              </Badge>
            )}
          </Accordion.Header>
          <Accordion.Body className="p-3">
            <DocumentSection
              entityType="customer"
              entityId={customer.id}
              documents={documents}
              documentTypes={documentTypes}
            />
          </Accordion.Body>
        </Accordion.Item>

        {/* ── Section 6: Linked Work ───────────────────────────────────── */}
        <Accordion.Item eventKey="5">
          <Accordion.Header>
            <div className="d-flex align-items-center gap-2 w-100 pe-2">
              {t('crm.linkedWork')}
              {linkedTickets.length > 0 && (
                <Badge bg="secondary" className="ms-1" style={{ fontSize: '0.7rem' }}>
                  {linkedTickets.length}
                </Badge>
              )}
              <Button
                variant="outline-primary"
                size="sm"
                className="ms-auto"
                style={{ fontSize: '0.72rem', padding: '1px 8px', flexShrink: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCreateTicket(true);
                }}
              >
                <i className="bi bi-plus me-1" />
                {t('tickets.newTicket')}
              </Button>
            </div>
          </Accordion.Header>
          <Accordion.Body className="p-3">
            {loadingTickets ? (
              <div className="d-flex justify-content-center py-3">
                <Spinner animation="border" size="sm" />
              </div>
            ) : linkedTickets.length === 0 ? (
              <div className="text-muted small">{t('empty.noTickets')}</div>
            ) : (
              <div>
                {linkedTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="d-flex align-items-center gap-2 py-2 border-bottom"
                    style={{ cursor: 'pointer', fontSize: '0.85rem' }}
                    onClick={() => setSelectedTicket(ticket)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelectedTicket(ticket);
                    }}
                  >
                    <Badge
                      bg="light"
                      text="dark"
                      className="border"
                      style={{ fontFamily: 'monospace', flexShrink: 0, fontSize: '0.72rem' }}
                    >
                      {ticket.displayId}
                    </Badge>
                    <span className="text-truncate flex-grow-1" title={ticket.title}>
                      {ticket.title}
                    </span>
                    <PriorityIndicator priority={ticket.priority} />
                    {ticket.assigneeName && (
                      <span className="text-muted small flex-shrink-0" style={{ fontSize: '0.75rem' }}>
                        {ticket.assigneeName}
                      </span>
                    )}
                    <i className="bi bi-chevron-right text-muted" style={{ fontSize: '0.65rem', flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            )}
          </Accordion.Body>
        </Accordion.Item>

        {/* ── Section 7: Notes ─────────────────────────────────────────── */}
        <Accordion.Item eventKey="6">
          <Accordion.Header>{t('crm.accountNotes')}</Accordion.Header>
          <Accordion.Body className="p-3">
            {editingField === 'notes' ? (
              <div>
                <Form.Control
                  as="textarea"
                  rows={6}
                  value={fieldDraft}
                  onChange={(e) => setFieldDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void saveField('notes');
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  style={{ fontSize: '0.9rem', resize: 'vertical' }}
                  autoFocus
                  disabled={saving}
                />
                <div className="d-flex gap-2 mt-2">
                  <Button size="sm" variant="primary" onClick={() => void saveField('notes')} disabled={saving}>
                    {t('common.save')}
                  </Button>
                  <Button size="sm" variant="outline-secondary" onClick={cancelEdit}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="p-2 rounded"
                style={{
                  cursor: 'pointer',
                  minHeight: 80,
                  whiteSpace: 'pre-wrap',
                  fontSize: '0.9rem',
                  backgroundColor: '#f8f9fa',
                }}
                onClick={() => startEdit('notes', customer.notes ?? '')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    startEdit('notes', customer.notes ?? '');
                  }
                }}
              >
                {customer.notes || <span className="text-muted">{t('common.description')}</span>}
              </div>
            )}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    );
  };

  // ── Render: modal ─────────────────────────────────────────────────────

  return (
    <>
      <Modal
        show={show}
        onHide={onHide}
        size="xl"
        scrollable
        dialogClassName="customer-detail-modal"
        contentClassName="d-flex flex-column"
      >
        {loading && renderLoading()}
        {!loading && error && renderError()}
        {!loading && !error && customer && (
          <>
            {renderHeader()}
            <Modal.Body style={{ overflowY: 'auto' }}>{renderBody()}</Modal.Body>
          </>
        )}

        {/* Inline style for modal height */}
        <style>{`
        .customer-detail-modal {
          max-height: 90vh;
        }
        .customer-detail-modal .modal-content {
          max-height: 90vh;
        }
      `}</style>
      </Modal>

      {/* Create ticket pre-linked to this customer */}
      <CreateTicketModal
        show={showCreateTicket}
        onHide={() => setShowCreateTicket(false)}
        onSuccess={(ticket) => {
          setShowCreateTicket(false);
          setLinkedTickets((prev) => [ticket, ...prev]);
        }}
        prefilledCustomerId={customerId}
        prefilledCustomerName={customer?.companyName}
      />

      {/* Open a linked ticket's detail modal */}
      {selectedTicket && (
        <TicketDetailModal
          show={!!selectedTicket}
          ticketId={selectedTicket.id}
          onHide={() => setSelectedTicket(null)}
          onDeleted={() => {
            setLinkedTickets((prev) => prev.filter((t) => t.id !== selectedTicket.id));
            setSelectedTicket(null);
          }}
        />
      )}
    </>
  );
}

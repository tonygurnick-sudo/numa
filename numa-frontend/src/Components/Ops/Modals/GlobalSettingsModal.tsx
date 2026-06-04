/* eslint-disable i18next/no-literal-string */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Modal, Button, Form, Nav, Tab, Table, Badge, Accordion, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useAlert, useConfirm } from '../../../Providers/ConfirmContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import {
  getColorForPosition,
  getContrastTextColor,
  getStatusTypeColor,
  BOARD_COLORS,
  calculateAutoColorPositions,
} from '../Shared/colorUtils';
import { STATUS_TYPE_TO_ZONES, getTicketTypeIconClass } from '../../../constants/opsConstants';
import TicketTypeIconPicker from '../Shared/TicketTypeIconPicker';
import { TicketTypeFieldsEditor } from './TicketTypeFieldsEditor';
import { ConfirmModal } from './ConfirmModal';
import { CustomerDetailModal } from './CustomerDetailModal';
import { CustomerRecordConfigBlock } from './CustomerRecordConfigBlock';
import { SupplierDetailModal } from './SupplierDetailModal';
import { DEFAULT_CUSTOMER_RECORD } from '../Shared/customerRecordFields';
import { StaffAvatar } from '../Shared/StaffAvatar';
import { extractApiError } from '../../../utils/apiErrors';
import type {
  TicketType,
  StatusType,
  FieldDefinition,
  FieldCategory,
  FieldType,
  StaffProfile,
  CrmConfig,
  CrmLifecycleStage,
  SupplierConfig,
  LinkConfig,
  Customer,
  Supplier,
  CrmFlag,
  SupplierFlag,
  DocTypeEntry,
} from '../../../types/ops';

// ─── Props ───────────────────────────────────────────────────────────────────

interface GlobalSettingsModalProps {
  show: boolean;
  onHide: () => void;
  onSaved: () => void;
  defaultTab?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const generateId = () => `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const STATUS_TYPES: StatusType[] = ['backlog', 'scoped', 'queued', 'active', 'completed', 'ended'];
const FIELD_CATEGORIES: string[] = ['common', 'mining', 'vehicle', 'crm', 'support', 'development', 'operations'];
const FIELD_TYPES: FieldType[] = [
  'text',
  'textarea',
  'richtext',
  'number',
  'select',
  'multi_select',
  'date',
  'user',
  'url',
  'email',
  'phone',
  'currency',
  'boolean',
];

// ─── Tag List Sub-Component ──────────────────────────────────────────────────

function TagList({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}): React.JSX.Element {
  const [newItem, setNewItem] = useState('');

  const handleAdd = () => {
    const trimmed = newItem.trim();
    if (trimmed && !items.includes(trimmed)) {
      onChange([...items, trimmed]);
      setNewItem('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div>
      <div className="d-flex flex-wrap gap-1 mb-2">
        {items.map((item) => (
          <Badge
            key={item}
            bg="secondary"
            className="d-flex align-items-center gap-1 py-1 px-2"
            style={{ cursor: 'pointer' }}
            onClick={() => onChange(items.filter((i) => i !== item))}
          >
            {item}
            <i className="bi bi-x" />
          </Badge>
        ))}
      </div>
      <div className="d-flex gap-2">
        <Form.Control
          type="text"
          size="sm"
          placeholder={placeholder}
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ maxWidth: 200 }}
        />
        <Button variant="outline-secondary" size="sm" onClick={handleAdd} disabled={!newItem.trim()}>
          <i className="bi bi-plus" />
        </Button>
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function GlobalSettingsModal({
  show,
  onHide,
  onSaved,
  defaultTab,
}: GlobalSettingsModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaGet, numaPost, numaPut, numaDelete } = useNumaRequest();
  const showAlert = useAlert();
  const showConfirm = useConfirm();
  const { config, boards, refreshBoards, refreshStaff, refreshConfig } = useOps();

  // ── Local state (edited copies of config) ──────────────────────────────────
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  // statuses are read-only (fixed StatusType categories) — no longer editable
  const getInitialFields = (): FieldDefinition[] => [
    { id: 'asset_id', name: 'Asset ID', fieldType: 'text', category: 'mining', isSystem: true, order: 100 },
    { id: 'service_hours', name: 'Service Hours', fieldType: 'number', category: 'mining', isSystem: true, order: 110 },
    { id: 'tractor_model', name: 'Tractor Model', fieldType: 'text', category: 'mining', isSystem: true, order: 120 },
    { id: 'tractor_id', name: 'Tractor ID', fieldType: 'text', category: 'mining', isSystem: true, order: 125 },
    {
      id: 'registration',
      name: 'Registration Number',
      fieldType: 'text',
      category: 'vehicle',
      isSystem: true,
      order: 200,
    },
    { id: 'vin', name: 'VIN', fieldType: 'text', category: 'vehicle', isSystem: true, order: 210 },
    {
      id: 'fuel_type',
      name: 'Fuel Type',
      fieldType: 'select',
      category: 'vehicle',
      isSystem: true,
      options: ['Diesel', 'Petrol', 'Electric', 'Hybrid'],
      order: 220,
    },
    {
      id: 'consignment',
      name: 'Consignment Note',
      fieldType: 'text',
      category: 'logistics',
      isSystem: true,
      order: 300,
    },
    {
      id: 'shipping_method',
      name: 'Shipping Method',
      fieldType: 'select',
      category: 'logistics',
      isSystem: true,
      options: ['Sea', 'Air', 'Road', 'Rail'],
      order: 310,
    },
    { id: 'budget_code', name: 'Budget Code', fieldType: 'text', category: 'general', isSystem: true, order: 400 },
    {
      id: 'estimated_effort',
      name: 'Estimated Effort (hrs)',
      fieldType: 'number',
      category: 'general',
      isSystem: true,
      order: 410,
    },
    {
      id: 'complexity',
      name: 'Complexity',
      fieldType: 'select',
      category: 'general',
      isSystem: true,
      options: ['Low', 'Medium', 'High', 'Critical'],
      order: 420,
    },
  ];

  const [fields, setFields] = useState<FieldDefinition[]>(() => {
    const initial = config?.fields ?? [];
    if (initial.length === 0) return getInitialFields();
    return initial;
  });
  const [crmConfig, setCrmConfig] = useState<CrmConfig>({
    lifecycleStages: [],
    customerFlags: [],
    documentTypes: [],
    territories: [],
    industries: [],
    customerRecord: structuredClone(DEFAULT_CUSTOMER_RECORD),
  });
  const [supplierConfig, setSupplierConfig] = useState<SupplierConfig>({
    lifecycleStages: [],
    supplierFlags: [],
    documentTypes: [],
  });
  const [linkConfig, setLinkConfig] = useState<LinkConfig>({ linkTypes: [] });

  // ── Customers & Suppliers lists ────────────────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [suppliersLoading, setSuppliersLoading] = useState(false);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldSearch, setFieldSearch] = useState('');
  const [showingNewField, setShowingNewField] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  const [newFieldCategory, setNewFieldCategory] = useState<string>('common');
  const [newFieldOptions, setNewFieldOptions] = useState('');

  // ── Ticket Types Config state ──────────────────────────────────────────────
  const [editingTicketType, setEditingTicketType] = useState<TicketType | null>(null);
  const [ticketTypeForm, setTicketTypeForm] = useState<TicketType>({
    id: '',
    name: '',
    prefix: '',
    icon: '',
    color: '',
    defaultFields: [],
    order: 0,
  });
  const [showTicketTypeModal, setShowTicketTypeModal] = useState(false);
  const [savingTicketType, setSavingTicketType] = useState(false);
  const [ticketTypeModalError, setTicketTypeModalError] = useState<string | null>(null);
  const [showTicketTypeFieldModal, setShowTicketTypeFieldModal] = useState(false);
  const [fieldSelectionSearch, setFieldSelectionSearch] = useState('');
  const [showCustomerDetail, setShowCustomerDetail] = useState(false);

  // ── CRM Config state ───────────────────────────────────────────────────────
  const [editingLifecycleStage, setEditingLifecycleStage] = useState<CrmLifecycleStage | null>(null);
  const [lifecycleStageForm, setLifecycleStageForm] = useState<{ name: string; colorPosition: number; color?: string }>(
    { name: '', colorPosition: 6 }
  );
  const [showLifecycleStageModal, setShowLifecycleStageModal] = useState(false);

  const [editingFlag, setEditingFlag] = useState<CrmFlag | null>(null);
  const [flagForm, setFlagForm] = useState({ name: '', icon: '⭐', color: '#F59E0B' });
  const [showFlagModal, setShowFlagModal] = useState(false);

  const [editingDocType, setEditingDocType] = useState<DocTypeEntry | null>(null);
  const [docTypeForm, setDocTypeForm] = useState({ name: '' });
  const [showDocTypeModal, setShowDocTypeModal] = useState(false);

  // ── Supplier Config state ──────────────────────────────────────────────────
  const [editingSupplierLifecycleStage, setEditingSupplierLifecycleStage] = useState<CrmLifecycleStage | null>(null);
  const [supplierLifecycleStageForm, setSupplierLifecycleStageForm] = useState<{
    name: string;
    colorPosition: number;
    color?: string;
  }>({ name: '', colorPosition: 6 });
  const [showSupplierLifecycleStageModal, setShowSupplierLifecycleStageModal] = useState(false);

  const [editingSupplierFlag, setEditingSupplierFlag] = useState<SupplierFlag | null>(null);
  const [supplierFlagForm, setSupplierFlagForm] = useState({ name: '', icon: '⭐', color: '#14B8A6' });
  const [showSupplierFlagModal, setShowSupplierFlagModal] = useState(false);

  const [editingSupplierDocType, setEditingSupplierDocType] = useState<DocTypeEntry | null>(null);
  const [supplierDocTypeForm, setSupplierDocTypeForm] = useState({ name: '' });
  const [showSupplierDocTypeModal, setShowSupplierDocTypeModal] = useState(false);

  // ── Detail modal state ─────────────────────────────────────────────────────
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null);
  const [detailSupplierId, setDetailSupplierId] = useState<string | null>(null);

  const allFieldCategories = useMemo(() => {
    return Array.from(new Set([...FIELD_CATEGORIES, ...fields.map((f) => f.category)]))
      .filter(Boolean)
      .sort();
  }, [fields]);
  const [showSupplierDetail, setShowSupplierDetail] = useState(false);

  // ── Confirm modal state ────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ show: false, title: '', message: '', onConfirm: () => {} });

  // ── Sync local state from config when modal opens ─────────────────────────
  // Only sync on show=false->true transition. config is an object from context
  // whose reference changes frequently — without the guard, every context update
  // would reset all local edits while the modal is open.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!show) {
      initializedRef.current = false;
      return;
    }
    if (show && !initializedRef.current && config) {
      setStaff(config.staff ? structuredClone(config.staff) : []);
      setTicketTypes(config.ticketTypes ? structuredClone(config.ticketTypes) : []);
      // statuses no longer editable — status categories are fixed
      setFields(config.fields ? structuredClone(config.fields) : []);
      setCrmConfig(() => {
        const base = config.crmConfig
          ? structuredClone(config.crmConfig)
          : {
              lifecycleStages: [],
              customerFlags: [],
              documentTypes: [],
              territories: [],
              industries: [],
            };
        if (!base.customerRecord || !base.customerRecord.sections?.length) {
          base.customerRecord = structuredClone(DEFAULT_CUSTOMER_RECORD);
        }
        return base;
      });
      setSupplierConfig(
        config.supplierConfig
          ? structuredClone(config.supplierConfig)
          : {
              lifecycleStages: [
                { id: 'sup-stage-potential', name: 'Potential', colorPosition: 6, color: '#6c757d' }, // Grey
                { id: 'sup-stage-approved', name: 'Approved', colorPosition: 4, color: '#0dcaf0' }, // Light Blue
                { id: 'sup-stage-preferred', name: 'Preferred', colorPosition: 2, color: '#22c55e' }, // Green
                { id: 'sup-stage-inactive', name: 'Inactive', colorPosition: 9, color: '#ef4444' }, // Red
              ],
              supplierFlags: [],
              documentTypes: [],
            }
      );
      setLinkConfig(config.linkConfig ? structuredClone(config.linkConfig) : { linkTypes: [] });
      setError(null);
      setFieldSearch('');
      setShowingNewField(false);

      initializedRef.current = true;
    }
  }, [show, config]);

  // ── Sync staff from Cognito when the modal opens ──────────────────────────
  useEffect(() => {
    if (show) {
      refreshStaff();
    }
  }, [show, refreshStaff]);

  // ── Load customers & suppliers when their tabs are shown ──────────────────
  const loadCustomers = useCallback(async () => {
    try {
      setCustomersLoading(true);
      const data = await OpsService.listCustomers(numaGet);
      setCustomers(data);
    } catch (err) {
      console.error('[GlobalSettingsModal] Failed to load customers:', err);
    } finally {
      setCustomersLoading(false);
    }
  }, [numaGet]);

  const loadSuppliers = useCallback(async () => {
    try {
      setSuppliersLoading(true);
      const data = await OpsService.listSuppliers(numaGet);
      setSuppliers(data);
    } catch (err) {
      console.error('[GlobalSettingsModal] Failed to load suppliers:', err);
    } finally {
      setSuppliersLoading(false);
    }
  }, [numaGet]);

  useEffect(() => {
    if (show) {
      loadCustomers();
      loadSuppliers();
    }
  }, [show, loadCustomers, loadSuppliers]);

  // ── Save handler ───────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      setError(null);

      const promises: Promise<unknown>[] = [];

      // 1. CRM Config
      promises.push(OpsService.updateCrmConfig(numaPut, crmConfig));

      // 2. Ticket Types Diff
      const originalTicketTypes = config?.ticketTypes ?? [];
      const newTcIds = new Set(ticketTypes.map((t) => t.id));

      // Deleted
      for (const orig of originalTicketTypes) {
        if (!newTcIds.has(orig.id)) {
          promises.push(OpsService.deleteTicketType(numaDelete, orig.id));
        }
      }

      // Added / Updated
      for (const tt of ticketTypes) {
        if (tt.id.startsWith('custom-')) {
          // New
          promises.push(
            OpsService.createTicketType(numaPost, {
              name: tt.name,
              prefix: tt.prefix,
              icon: tt.icon,
              color: tt.color,
              defaultFields: tt.defaultFields,
            })
          );
        } else {
          // Existing - Check if changed (simple JSON compare)
          const orig = originalTicketTypes.find((o) => o.id === tt.id);
          if (orig && JSON.stringify(orig) !== JSON.stringify(tt)) {
            promises.push(
              OpsService.updateTicketType(numaPut, tt.id, {
                name: tt.name,
                icon: tt.icon,
                color: tt.color,
                defaultFields: tt.defaultFields,
              })
            );
          }
        }
      }

      // 3. Fields Diff
      const originalFields = config?.fields ?? [];
      const newFieldIds = new Set(fields.map((f) => f.id));

      // Deleted
      for (const orig of originalFields) {
        if (!newFieldIds.has(orig.id)) {
          promises.push(OpsService.deleteField(numaDelete, orig.id));
        }
      }

      // Updated (creates are persisted inline by handleAddCustomField / CRM onCreateField,
      // so any `custom-`/`crm-` temp ids should have already been replaced with server ids)
      for (const field of fields) {
        const orig = originalFields.find((f) => f.id === field.id);
        if (orig && JSON.stringify(orig) !== JSON.stringify(field)) {
          promises.push(OpsService.updateField(numaPut, field.id, field));
        }
      }

      // Await all mutations
      const results = await Promise.allSettled(promises);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (rejected.length > 0) {
        console.error('[GlobalSettingsModal] Some saves failed:', rejected);
        const messages = rejected.map((r) => {
          const reason = r.reason;
          return reason?.response?.data?.message || reason?.message || String(reason);
        });
        setError(
          t('errors.saveFailed', {
            message: `${rejected.length} operation(s) failed: ${messages.join('; ')}`,
          })
        );
        // Sync state with what actually persisted, but keep modal open for retry
        await refreshConfig();
        return;
      }

      // Force UI to pick up new ticket types and fields from the backend
      await refreshConfig();
      onSaved();
    } catch (err) {
      setError(t('errors.saveFailed', { message: String(err) }));
    } finally {
      setSaving(false);
    }
  }, [
    ticketTypes,
    fields,
    crmConfig,
    config?.ticketTypes,
    config?.fields,
    numaPut,
    numaDelete,
    numaPost,
    onSaved,
    t,
    refreshConfig,
  ]);

  // ── Customer delete handler ────────────────────────────────────────────────
  const handleDeleteCustomer = useCallback(
    async (customerId: string) => {
      try {
        await OpsService.deleteCustomer(numaDelete, customerId);
        setCustomers((prev) => prev.filter((c) => c.id !== customerId));
      } catch (err) {
        setError(t('errors.saveFailed', { message: extractApiError(err) }));
      }
    },
    [numaDelete, t]
  );

  // ── Supplier delete handler ────────────────────────────────────────────────
  const handleDeleteSupplier = useCallback(
    async (supplierId: string) => {
      try {
        await OpsService.deleteSupplier(numaDelete, supplierId);
        setSuppliers((prev) => prev.filter((s) => s.id !== supplierId));
      } catch (err) {
        setError(t('errors.saveFailed', { message: extractApiError(err) }));
      }
    },
    [numaDelete, t]
  );

  // ── Board delete handler ──────────────────────────────────────────────────
  const handleDeleteBoard = useCallback(
    async (boardId: string) => {
      try {
        await OpsService.deleteBoard(numaDelete, boardId);
        await refreshBoards();
      } catch (err) {
        const msg = String(err);
        if (msg.includes('409')) {
          setError(t('globalSettings.boardDeleteHasTickets'));
        } else {
          setError(t('errors.saveFailed', { message: msg }));
        }
      }
    },
    [numaDelete, refreshBoards, t]
  );

  // ── New customer handler ───────────────────────────────────────────────────
  const handleNewCustomer = useCallback(async () => {
    try {
      const customer = await OpsService.createCustomer(numaPost, {
        companyName: 'New Customer',
      });
      setCustomers((prev) => [...prev, customer]);
      setDetailCustomerId(customer.id);
      setShowCustomerDetail(true);
    } catch (err) {
      setError(t('errors.saveFailed', { message: String(err) }));
    }
  }, [numaPost, t]);

  // ── New supplier handler ───────────────────────────────────────────────────
  const handleNewSupplier = useCallback(async () => {
    try {
      const supplier = await OpsService.createSupplier(numaPost, {
        companyName: 'New Supplier',
      });
      setSuppliers((prev) => [...prev, supplier]);
      setDetailSupplierId(supplier.id);
      setShowSupplierDetail(true);
    } catch (err) {
      setError(t('errors.saveFailed', { message: String(err) }));
    }
  }, [numaPost, t]);

  // ── Add custom field handler ───────────────────────────────────────────────
  // New fields are persisted immediately so their server-assigned id can be
  // referenced from ticket types and CRM layouts in the same session. If we
  // kept the temp `custom-…` id locally and only persisted on main Save, the
  // backend would rewrite the id (see numa-ops-config-api POST /fields) while
  // the ticket type's defaultFields kept pointing at the dead temp id — which
  // then got filtered out on reload, making the new field silently disappear
  // from the ticket-type picker. Edits stay local-then-save.
  const handleAddCustomField = async () => {
    if (!newFieldName.trim()) return;
    const parsedOptions = ['select', 'multi_select'].includes(newFieldType)
      ? newFieldOptions
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : undefined;

    if (editingFieldId) {
      setFields((prev) =>
        prev.map((f) =>
          f.id === editingFieldId
            ? {
                ...f,
                name: newFieldName.trim(),
                category: newFieldCategory as FieldCategory,
                fieldType: newFieldType,
                options: parsedOptions,
              }
            : f
        )
      );
    } else {
      const payload: FieldDefinition = {
        id: generateId(),
        name: newFieldName.trim(),
        category: newFieldCategory as FieldCategory,
        fieldType: newFieldType,
        options: parsedOptions,
        isSystem: false,
        order: fields.length,
      };
      // Try to create. If the server reports a duplicate-name conflict, surface
      // the existing field so the user can choose to reuse it or force-create
      // a parallel duplicate (FEAT-171). Tickets routinely end up with two
      // "Priority" fields today; this prevents that silently happening again.
      const persist = async (force: boolean) => {
        const created = await OpsService.createField(numaPost, payload, { force });
        const newField: FieldDefinition = { ...payload, ...created, id: created?.id ?? payload.id };
        setFields((prev) => [...prev, newField]);
      };
      try {
        await persist(false);
      } catch (err) {
        const e = err as {
          response?: {
            status?: number;
            data?: { error?: string; existing?: { id: string; name: string; isSystem?: boolean; fieldType?: string } };
          };
        };
        if (e.response?.status === 409 && e.response.data?.error === 'duplicate-name' && e.response.data.existing) {
          const existing = e.response.data.existing;
          const shouldForce = await showConfirm({
            title: t('globalSettings.duplicateFieldTitle', 'Field already exists'),
            message: t('globalSettings.duplicateFieldPrompt', {
              name: existing.name,
              defaultValue: 'A field called "{{name}}" already exists. Use existing, or create a parallel duplicate?',
            }),
            confirmLabel: t('globalSettings.duplicateCreateAnyway', 'Create anyway'),
            cancelLabel: t('globalSettings.duplicateUseExisting', 'Use existing'),
            variant: 'warning',
          });
          if (!shouldForce) {
            // User chose "Use existing" — close the form without persisting.
            setNewFieldName('');
            setNewFieldType('text');
            setNewFieldCategory('common');
            setNewFieldOptions('');
            setEditingFieldId(null);
            setShowingNewField(false);
            return;
          }
          try {
            await persist(true);
          } catch (innerErr) {
            setError(t('errors.saveFailed', { message: String(innerErr) }));
            return;
          }
        } else {
          setError(t('errors.saveFailed', { message: String(err) }));
          return;
        }
      }
    }
    setNewFieldName('');
    setNewFieldType('text');
    setNewFieldCategory('common');
    setNewFieldOptions('');
    setEditingFieldId(null);
    setShowingNewField(false);
  };

  /**
   * Persist a brand-new field directly from inside the ticket-type template
   * editor (Create new custom field button). Mirrors handleAddCustomField but
   * is shaped to fit the TicketTypeFieldsEditor's onCreateField contract.
   */
  const handleCreateFieldInline = useCallback(
    async (payload: {
      name: string;
      fieldType: FieldType;
      category: FieldCategory;
      options?: string[];
    }): Promise<string> => {
      const fullPayload: FieldDefinition = {
        id: generateId(),
        name: payload.name,
        category: payload.category,
        fieldType: payload.fieldType,
        options: payload.options,
        isSystem: false,
        order: fields.length,
      };
      const persist = async (force: boolean): Promise<FieldDefinition> => {
        const created = await OpsService.createField(numaPost, fullPayload, { force });
        const newField: FieldDefinition = { ...fullPayload, ...created, id: created?.id ?? fullPayload.id };
        setFields((prev) => [...prev, newField]);
        return newField;
      };
      try {
        const newField = await persist(false);
        return newField.id;
      } catch (err) {
        const e = err as {
          response?: {
            status?: number;
            data?: { error?: string; existing?: { id: string; name: string; isSystem?: boolean } };
          };
        };
        if (e.response?.status === 409 && e.response.data?.error === 'duplicate-name' && e.response.data.existing) {
          const existing = e.response.data.existing;
          const shouldForce = await showConfirm({
            title: t('globalSettings.duplicateFieldTitle', 'Field already exists'),
            message: t('globalSettings.duplicateFieldPrompt', {
              name: existing.name,
              defaultValue: 'A field called "{{name}}" already exists. Use existing, or create a parallel duplicate?',
            }),
            confirmLabel: t('globalSettings.duplicateCreateAnyway', 'Create anyway'),
            cancelLabel: t('globalSettings.duplicateUseExisting', 'Use existing'),
            variant: 'warning',
          });
          if (!shouldForce) {
            // Use existing — return its id so the editor attaches it instead.
            return existing.id;
          }
          const newField = await persist(true);
          return newField.id;
        }
        throw err;
      }
    },
    [fields.length, numaPost, showConfirm, t]
  );

  // ── Helper to get primary contact name for customer/supplier ───────────────
  const getPrimaryContactName = (contacts: { name: string; isPrimary: boolean }[]): string => {
    const primary = contacts.find((c) => c.isPrimary);
    return primary?.name ?? contacts[0]?.name ?? '-';
  };

  // ── Get lifecycle stage color from config ──────────────────────────────────
  const getStageColor = (stageName: string, stages: CrmLifecycleStage[]): string => {
    const stage = stages.find((s) => s.name === stageName);
    return stage ? getColorForPosition(stage.colorPosition) : '#6c757d';
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB RENDERERS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Tab: Staff ─────────────────────────────────────────────────────────────
  const renderStaffTab = () => (
    <div>
      <div className="alert alert-info mb-3">
        <i className="bi bi-info-circle me-2" />
        {t('globalSettings.staffManagedNote')}
      </div>
      <Table size="sm" hover className="ops-settings-table">
        <thead>
          <tr>
            <th style={{ width: 48 }} />
            <th>{t('common.name')}</th>
            <th>{t('contacts.email')}</th>
            <th>{t('globalSettings.role')}</th>
            <th>{t('globalSettings.active')}</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((person) => (
            <tr key={person.id}>
              <td>
                <StaffAvatar staff={person} size={32} />
              </td>
              <td>{person.name || person.email}</td>
              <td>{person.email}</td>
              <td>{person.role || <span className="text-muted">-</span>}</td>
              <td>
                <Badge bg={person.isActive ? 'success' : 'secondary'}>
                  {person.isActive ? t('common.yes') : t('common.no')}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );

  // ── Tab 3: Ticket Type Templates ───────────────────────────────────────────
  const renderTicketTypesTab = () => (
    <div>
      <div className="alert alert-info small mb-3">
        <i className="bi bi-info-circle me-1" />
        <strong>{t('globalSettings.ticketTypeTemplatesLead', 'Ticket type templates set the defaults.')}</strong>{' '}
        {t(
          'globalSettings.ticketTypeTemplatesBody',
          'Each board picks which templates to use and can override fields, labels, and options in Board Settings → Tickets & Fields without affecting other boards.'
        )}
      </div>
      <Table size="sm" hover className="mb-0 ops-settings-table">
        <thead>
          <tr>
            <th>{t('globalSettings.icon')}</th>
            <th>{t('common.color')}</th>
            <th>{t('globalSettings.prefix')}</th>
            <th>{t('common.name')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {ticketTypes.map((tt, idx) => {
            const textColor = getContrastTextColor(tt.color || '#6c757d');
            return (
              <tr key={tt.id}>
                <td>
                  <div
                    className="d-flex align-items-center justify-content-center bg-light rounded"
                    style={{ width: 32, height: 32 }}
                  >
                    {tt.icon && <i className={getTicketTypeIconClass(tt.icon)} />}
                  </div>
                </td>
                <td>
                  <div
                    className="rounded-circle d-flex align-items-center justify-content-center fw-bold"
                    style={{ width: 32, height: 32, backgroundColor: tt.color, color: textColor, fontSize: 12 }}
                  />
                </td>
                <td className="align-middle fw-medium">{tt.prefix}</td>
                <td className="align-middle">{tt.name}</td>
                <td className="text-end">
                  <div className="d-flex gap-1 justify-content-end">
                    <Button
                      variant="light"
                      size="sm"
                      className="text-muted border-0 hover-primary"
                      onClick={() => {
                        setEditingTicketType(tt);
                        const validFieldIds = new Set(fields.map((f) => f.id));
                        setTicketTypeForm({
                          ...structuredClone(tt),
                          defaultFields: (tt.defaultFields || []).filter((id) => validFieldIds.has(id)),
                        });
                        setShowTicketTypeModal(true);
                      }}
                    >
                      <i className="bi bi-pencil" />
                    </Button>
                    <Button
                      variant="light"
                      size="sm"
                      className="text-danger border-0"
                      onClick={() => setTicketTypes((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <i className="bi bi-trash" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
          {ticketTypes.length === 0 && (
            <tr>
              <td colSpan={5} className="text-center py-4 text-muted">
                No ticket types defined.
              </td>
            </tr>
          )}
        </tbody>
      </Table>
      <div className="mt-3">
        <Button
          variant="outline-primary"
          size="sm"
          onClick={() => {
            setEditingTicketType(null);
            setTicketTypeForm({
              id: generateId(),
              name: '',
              prefix: '',
              icon: 'ticket',
              color: BOARD_COLORS[ticketTypes.length % BOARD_COLORS.length],
              defaultFields: [],
              order: ticketTypes.length,
            });
            setShowTicketTypeModal(true);
          }}
        >
          <i className="bi bi-plus me-1" />
          {t('globalSettings.addType')}
        </Button>
      </div>
    </div>
  );

  // ── Tab 4: Status Categories (read-only reference) ─────────────────────────
  const renderStatusesTab = () => (
    <div>
      <div className="alert alert-info small mb-3">
        <i className="bi bi-info-circle me-1" />
        {t('globalSettings.statusCategoriesInfo')}
      </div>
      <h6 className="fw-bold mb-2">{t('globalSettings.statusCategoriesRefTitle')}</h6>
      <Table size="sm" className="mb-0 ops-settings-table">
        <thead>
          <tr>
            <th style={{ width: 40 }} />
            <th>{t('common.name')}</th>
            <th>{t('common.description')}</th>
            <th>{t('globalSettings.statusCategoryZones')}</th>
          </tr>
        </thead>
        <tbody>
          {STATUS_TYPES.map((st) => (
            <tr key={st}>
              <td>
                <span
                  className="d-inline-block rounded-circle"
                  style={{ width: 12, height: 12, backgroundColor: getStatusTypeColor(st) }}
                />
              </td>
              <td className="fw-semibold">{t(`globalSettings.statusTypes.${st}`)}</td>
              <td className="text-muted small">{t(`globalSettings.statusTypeDescriptions.${st}`)}</td>
              <td>
                <div className="d-flex gap-1">
                  {(STATUS_TYPE_TO_ZONES[st] ?? []).map((zt) => (
                    <Badge key={zt} bg={zt === 'board' ? 'primary' : 'secondary'} style={{ fontSize: '0.65rem' }}>
                      {t(`zones.type_${zt}`)}
                    </Badge>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );

  // ── Tab 5: Field Library ───────────────────────────────────────────────────
  const renderFieldsTab = () => {
    // Dynamically get all unique categories currently in use across all fields,
    // combined with the default FIELD_CATEGORIES.
    const allFieldCategories = Array.from(new Set([...FIELD_CATEGORIES, ...fields.map((f) => f.category)])).sort();

    return (
      <div className="d-flex flex-column h-100">
        <div className="bg-light border rounded p-3 mb-3 flex-shrink-0">
          <div className="d-flex flex-column flex-md-row gap-3 align-items-md-center justify-content-between">
            <div className="d-flex flex-column">
              <span className="fw-bold d-flex align-items-center gap-2">
                <i className="bi bi-collection text-primary"></i> Field Library
              </span>
              <span className="text-muted small">
                Manage available data fields. Newly created fields must be added to a Ticket Type before they appear on
                tickets.
              </span>
            </div>
            <div className="d-flex gap-2">
              <div className="input-group input-group-sm" style={{ width: '240px' }}>
                <span className="input-group-text bg-white border-end-0">
                  <i className="bi bi-search text-muted"></i>
                </span>
                <input
                  type="text"
                  className="form-control border-start-0 ps-0 shadow-none"
                  placeholder="Search fields..."
                  value={fieldSearch}
                  onChange={(e) => setFieldSearch(e.target.value)}
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                className="d-flex align-items-center gap-2 px-3"
                onClick={() => {
                  setEditingFieldId(null);
                  setNewFieldName('');
                  setNewFieldType('text');
                  setNewFieldCategory('common');
                  setNewFieldOptions('');
                  setShowingNewField(true);
                }}
              >
                <i className="bi bi-plus-lg"></i>
                {t('globalSettings.addField')}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-grow-1 overflow-auto pe-2">
          {fields.length === 0 ? (
            <div className="text-center py-5 bg-light rounded border border-dashed text-muted">
              <i className="bi bi-search d-block fs-3 mb-2 opacity-25"></i>
              No fields defined.
            </div>
          ) : (
            <Accordion defaultActiveKey={allFieldCategories[0]}>
              {allFieldCategories.map((cat) => {
                const catFields = fields.filter(
                  (f) =>
                    f.category === cat && (!fieldSearch || f.name.toLowerCase().includes(fieldSearch.toLowerCase()))
                );
                if (catFields.length === 0) return null;
                return (
                  <Accordion.Item key={cat} eventKey={cat} className="mb-2 border rounded shadow-sm">
                    <Accordion.Header>
                      <div className="d-flex align-items-center gap-2 w-100">
                        <span className="fw-bold text-dark">{cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
                        <Badge bg="secondary" className="rounded-pill opacity-75">
                          {catFields.length}
                        </Badge>
                      </div>
                    </Accordion.Header>
                    <Accordion.Body className="bg-light bg-opacity-50 p-3 p-xl-4 border-top">
                      <div className="row g-2">
                        {catFields.map((field) => (
                          <div key={field.id} className="col-12 col-lg-6">
                            <div
                              className={`p-2 border rounded bg-white shadow-sm d-flex align-items-center gap-2 h-100 ${!field.isSystem ? 'border-info-subtle border-opacity-50' : ''}`}
                            >
                              <div className="flex-grow-1 overflow-hidden">
                                <div className="d-flex align-items-center gap-2">
                                  <span className="fw-bold small text-dark text-truncate" title={field.name}>
                                    {field.name}
                                  </span>
                                  {field.isSystem ? (
                                    <Badge bg="secondary" text="white" style={{ fontSize: '0.6rem' }} className="py-1">
                                      CORE
                                    </Badge>
                                  ) : (
                                    <Badge
                                      bg="info"
                                      text="dark"
                                      style={{ fontSize: '0.6rem' }}
                                      className="py-1 bg-opacity-25 text-info"
                                    >
                                      CUSTOM
                                    </Badge>
                                  )}
                                </div>
                                <div
                                  className="text-muted d-flex align-items-center gap-1"
                                  style={{ fontSize: '0.7rem' }}
                                >
                                  <i className="bi bi-tag small"></i> {field.fieldType}
                                </div>
                              </div>
                              {!field.isSystem && (
                                <div className="d-flex ms-2">
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="text-primary p-0 border-0 me-2"
                                    onClick={() => {
                                      setEditingFieldId(field.id);
                                      setNewFieldName(field.name);
                                      setNewFieldType(field.fieldType);
                                      setNewFieldCategory(field.category);
                                      setNewFieldOptions(field.options?.join(', ') || '');
                                      setShowingNewField(true);
                                    }}
                                  >
                                    <i className="bi bi-pencil"></i>
                                  </Button>
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="text-danger p-0 border-0"
                                    onClick={() => setFields((prev) => prev.filter((f) => f.id !== field.id))}
                                  >
                                    <i className="bi bi-trash"></i>
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Accordion.Body>
                  </Accordion.Item>
                );
              })}
            </Accordion>
          )}
        </div>
      </div>
    );
  };

  // ── Tab 6: CRM Config ─────────────────────────────────────────────────────
  const renderCrmConfigTab = () => (
    <div className="d-flex flex-column h-100 mx-n3 mt-n3 mb-n3">
      {/* Sticky Header */}
      <div className="bg-white px-4 pt-4 pb-3 border-bottom flex-shrink-0">
        <h5 className="fw-bold mb-1">{t('settings.crmConfig', 'CRM Configuration')}</h5>
        <div className="text-muted small">Configure customer lifecycle stages, flags, and document types.</div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-grow-1 overflow-auto p-4 pe-4">
        {/* Layout Settings */}
        <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
          <div className="mb-3">
            <h6 className="fw-bold text-dark mb-1">
              {t('globalSettings.crmLayout', 'Customer Record Layout Settings')}
            </h6>
            <div className="text-muted small">
              {t('globalSettings.crmLayoutHint', 'Controls how the customer detail view renders sections and fields.')}
            </div>
          </div>

          <div className="row g-3">
            <div className="col-12 col-md-6 col-lg-3">
              <Form.Label className="small fw-medium mb-1">
                {t('globalSettings.crmLayout.columns', 'Columns per section')}
              </Form.Label>
              <Form.Select
                size="sm"
                value={String(crmConfig.layout?.columnsPerSection ?? 3)}
                onChange={(e) => {
                  const updated = structuredClone(crmConfig);
                  const cols = Number(e.target.value) as 2 | 3 | 4;
                  updated.layout = { ...(updated.layout ?? {}), columnsPerSection: cols };
                  setCrmConfig(updated);
                }}
              >
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </Form.Select>
            </div>

            <div className="col-12 col-md-6 col-lg-3">
              <Form.Label className="small fw-medium mb-1">
                {t('globalSettings.crmLayout.density', 'Density')}
              </Form.Label>
              <Form.Select
                size="sm"
                value={crmConfig.layout?.density ?? 'compact'}
                onChange={(e) => {
                  const updated = structuredClone(crmConfig);
                  updated.layout = {
                    ...(updated.layout ?? {}),
                    density: e.target.value as 'compact' | 'comfortable',
                  };
                  setCrmConfig(updated);
                }}
              >
                <option value="compact">{t('globalSettings.crmLayout.compact', 'Compact')}</option>
                <option value="comfortable">{t('globalSettings.crmLayout.comfortable', 'Comfortable')}</option>
              </Form.Select>
            </div>

            <div className="col-12 col-md-6 col-lg-3">
              <Form.Label className="small fw-medium mb-1">
                {t('globalSettings.crmLayout.labelPosition', 'Label position')}
              </Form.Label>
              <Form.Select
                size="sm"
                value={crmConfig.layout?.labelPosition ?? 'above'}
                onChange={(e) => {
                  const updated = structuredClone(crmConfig);
                  updated.layout = {
                    ...(updated.layout ?? {}),
                    labelPosition: e.target.value as 'above' | 'inline',
                  };
                  setCrmConfig(updated);
                }}
              >
                <option value="above">{t('globalSettings.crmLayout.labelAbove', 'Above field')}</option>
                <option value="inline">{t('globalSettings.crmLayout.labelInline', 'Inline')}</option>
              </Form.Select>
            </div>

            <div className="col-12 col-md-6 col-lg-3 d-flex align-items-end">
              <Form.Check
                type="switch"
                id="crmLayoutDefaultExpanded"
                className="mb-1"
                checked={crmConfig.layout?.defaultSectionsExpanded === true}
                onChange={(e) => {
                  const updated = structuredClone(crmConfig);
                  updated.layout = {
                    ...(updated.layout ?? {}),
                    defaultSectionsExpanded: e.target.checked,
                  };
                  setCrmConfig(updated);
                }}
                label={
                  <span className="small">
                    {t('globalSettings.crmLayout.expandAll', 'Expand all sections by default')}
                  </span>
                }
              />
            </div>
          </div>
        </div>

        {/* Customer Record Layout */}
        <CustomerRecordConfigBlock
          value={crmConfig.customerRecord ?? structuredClone(DEFAULT_CUSTOMER_RECORD)}
          onChange={(next) => {
            const updated = structuredClone(crmConfig);
            updated.customerRecord = next;
            setCrmConfig(updated);
          }}
          allFields={fields}
          t={t}
          builtinFieldLabels={crmConfig.builtinFieldLabels}
          onBuiltinLabelChange={(fieldId, newLabel) => {
            const updated = structuredClone(crmConfig);
            const next = { ...(updated.builtinFieldLabels ?? {}) };
            if (newLabel === null) {
              delete next[fieldId];
            } else {
              next[fieldId] = newLabel;
            }
            updated.builtinFieldLabels = next;
            setCrmConfig(updated);
          }}
          onCreateField={async ({ name, fieldType, options }) => {
            // Persist immediately — using a `crm-` prefix avoids the modal's
            // own Save flow re-creating it (that branch triggers on `custom-`
            // prefixed ids). Layout change (adding id to section) is saved
            // with the rest of the modal.
            const fieldId = `crm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const payload: FieldDefinition = {
              id: fieldId,
              name,
              category: 'crm',
              fieldType,
              options,
              isSystem: false,
              order: fields.length,
            };
            try {
              const created = await OpsService.createField(numaPost, payload);
              const newField: FieldDefinition = { ...payload, ...created, id: created?.id ?? fieldId };
              setFields((prev) => [...prev, newField]);
              return newField.id;
            } catch (err) {
              console.error('[GlobalSettingsModal] Failed to create CRM custom field', err);
              return null;
            }
          }}
          onUpdateField={async (fieldId, { name, fieldType, options }) => {
            try {
              const existing = fields.find((f) => f.id === fieldId);
              const payload: Partial<FieldDefinition> = existing
                ? { ...existing, name, fieldType, options }
                : { name, fieldType, options };
              await OpsService.updateField(numaPut, fieldId, payload);
              setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, name, fieldType, options } : f)));
              // Refresh the ops context so the parent's cached `config.fields`
              // reflects the persisted change — otherwise closing the modal
              // without hitting main Save (and then reopening) would reset the
              // form to the stale context value and make it look like the
              // inline save didn't persist.
              await refreshConfig();
              return true;
            } catch (err) {
              console.error('[GlobalSettingsModal] Failed to update CRM custom field', err);
              return false;
            }
          }}
        />

        {/* Lifecycle Stages Section */}
        <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
            <div>
              <h6 className="fw-bold text-dark mb-1">Customer Lifecycle Stages</h6>
              <div className="text-muted small">
                Stages represent where a customer is in their relationship with you.
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              className="d-flex align-items-center gap-2"
              onClick={() => {
                setEditingLifecycleStage(null);
                setLifecycleStageForm({ name: '', colorPosition: 6 });
                setShowLifecycleStageModal(true);
              }}
            >
              <i className="bi bi-plus" /> Add Stage
            </Button>
          </div>

          <div className="mb-3 d-flex align-items-center gap-2">
            <Form.Check
              type="checkbox"
              id="crmUseAutoColors"
              checked={crmConfig.useAutoColors !== false}
              onChange={(e) => {
                const updated = structuredClone(crmConfig);
                updated.useAutoColors = e.target.checked;
                if (e.target.checked && updated.lifecycleStages) {
                  const positions = calculateAutoColorPositions(updated.lifecycleStages.length).reverse();
                  updated.lifecycleStages = updated.lifecycleStages.map((stage, idx) => ({
                    ...stage,
                    colorPosition: positions[idx],
                  }));
                }
                setCrmConfig(updated);
              }}
              label={<span className="text-muted small">Auto-assign colors based on stage order</span>}
            />
          </div>

          <div className="d-flex flex-column gap-2">
            {(crmConfig.lifecycleStages || []).map((stage, index, arr) => {
              const colorHex = stage.color || getColorForPosition(stage.colorPosition);
              const textColor = getContrastTextColor(colorHex);

              return (
                <div key={stage.id} className="d-flex align-items-center flex-wrap gap-3 p-2 bg-light rounded border">
                  <div
                    className="rounded-circle d-flex align-items-center justify-content-center fw-bold flex-shrink-0"
                    style={{ width: 32, height: 32, backgroundColor: colorHex, color: textColor, fontSize: 12 }}
                  >
                    {stage.colorPosition}
                  </div>

                  <div className="flex-grow-1 fw-medium">{stage.name}</div>

                  <div className="d-flex align-items-center gap-1">
                    <Button
                      variant="link"
                      className="text-muted p-1"
                      disabled={index === 0}
                      onClick={() => {
                        const updated = structuredClone(crmConfig);
                        const stages = updated.lifecycleStages;
                        [stages[index - 1], stages[index]] = [stages[index], stages[index - 1]];
                        setCrmConfig(updated);
                      }}
                    >
                      <i className="bi bi-arrow-up" />
                    </Button>
                    <Button
                      variant="link"
                      className="text-muted p-1"
                      disabled={index === arr.length - 1}
                      onClick={() => {
                        const updated = structuredClone(crmConfig);
                        const stages = updated.lifecycleStages;
                        [stages[index], stages[index + 1]] = [stages[index + 1], stages[index]];
                        setCrmConfig(updated);
                      }}
                    >
                      <i className="bi bi-arrow-down" />
                    </Button>
                  </div>

                  <div className="d-flex align-items-center gap-1">
                    <Button
                      variant="light"
                      size="sm"
                      className="text-muted border-0 hover-primary"
                      onClick={() => {
                        setEditingLifecycleStage(stage);
                        setLifecycleStageForm({
                          name: stage.name,
                          colorPosition: stage.colorPosition,
                          color: stage.color,
                        });
                        setShowLifecycleStageModal(true);
                      }}
                    >
                      <i className="bi bi-pencil" />
                    </Button>
                    <Button
                      variant="light"
                      size="sm"
                      className="text-danger border-0"
                      onClick={() => {
                        if ((crmConfig.lifecycleStages || []).length <= 1) {
                          void showAlert({ message: 'Cannot delete the last lifecycle stage.', variant: 'warning' });
                          return;
                        }
                        const updated = structuredClone(crmConfig);
                        updated.lifecycleStages = updated.lifecycleStages.filter((s) => s.id !== stage.id);
                        setCrmConfig(updated);
                      }}
                    >
                      <i className="bi bi-trash" />
                    </Button>
                  </div>
                </div>
              );
            })}

            {(!crmConfig.lifecycleStages || crmConfig.lifecycleStages.length === 0) && (
              <div className="text-center py-4 text-muted">No lifecycle stages defined.</div>
            )}
          </div>
        </div>

        {/* Customer Flags Section */}
        <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
            <div>
              <h6 className="fw-bold text-dark mb-1">Customer Flags</h6>
              <div className="text-muted small">
                Flags highlight important customers (e.g., VIP, Strategic Account).
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              className="d-flex align-items-center gap-2"
              onClick={() => {
                setEditingFlag(null);
                setFlagForm({ name: '', icon: '⭐', color: '#F59E0B' });
                setShowFlagModal(true);
              }}
            >
              <i className="bi bi-plus" /> Add Flag
            </Button>
          </div>

          <div className="d-flex flex-column gap-2">
            {(crmConfig.customerFlags || []).map((flag) => (
              <div key={flag.id} className="d-flex align-items-center flex-wrap gap-3 p-2 bg-light rounded border">
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center fs-5 flex-shrink-0"
                  style={{ width: 32, height: 32, backgroundColor: flag.color + '20' }}
                >
                  {flag.icon}
                </div>

                <div className="flex-grow-1 fw-medium">{flag.name}</div>

                <div
                  className="rounded border shadow-sm"
                  style={{ width: 24, height: 24, backgroundColor: flag.color }}
                  title={flag.color}
                />

                <div className="d-flex align-items-center gap-1 ms-2">
                  <Button
                    variant="light"
                    size="sm"
                    className="text-muted border-0"
                    onClick={() => {
                      setEditingFlag(flag);
                      setFlagForm({ name: flag.name, icon: flag.icon, color: flag.color });
                      setShowFlagModal(true);
                    }}
                  >
                    <i className="bi bi-pencil" />
                  </Button>
                  <Button
                    variant="light"
                    size="sm"
                    className="text-danger border-0"
                    onClick={() => {
                      const updated = structuredClone(crmConfig);
                      updated.customerFlags = updated.customerFlags.filter((f) => f.id !== flag.id);
                      setCrmConfig(updated);
                    }}
                  >
                    <i className="bi bi-trash" />
                  </Button>
                </div>
              </div>
            ))}

            {(!crmConfig.customerFlags || crmConfig.customerFlags.length === 0) && (
              <div className="text-center py-4 text-muted">No customer flags defined.</div>
            )}
          </div>
        </div>

        {/* Document Types Section */}
        <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
            <div>
              <h6 className="fw-bold text-dark mb-1">Document Types</h6>
              <div className="text-muted small">
                Categorize documents linked to customers (contracts, proposals, etc.).
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              className="d-flex align-items-center gap-2"
              onClick={() => {
                setEditingDocType(null);
                setDocTypeForm({ name: '' });
                setShowDocTypeModal(true);
              }}
            >
              <i className="bi bi-plus" /> Add Type
            </Button>
          </div>

          <div className="d-flex flex-wrap gap-2">
            {(crmConfig.documentTypes || []).map((docType) => (
              <div key={docType.id} className="d-flex align-items-center gap-2 px-3 py-2 bg-light border rounded">
                <span className="small fw-medium">{docType.name}</span>
                <Button
                  variant="link"
                  size="sm"
                  className="p-0 text-muted ms-2"
                  onClick={() => {
                    setEditingDocType(docType);
                    setDocTypeForm({ name: docType.name });
                    setShowDocTypeModal(true);
                  }}
                >
                  <i className="bi bi-pencil small" />
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  className="p-0 text-danger ms-1"
                  onClick={() => {
                    const updated = structuredClone(crmConfig);
                    updated.documentTypes = updated.documentTypes.filter((d) => d.id !== docType.id);
                    setCrmConfig(updated);
                  }}
                >
                  <i className="bi bi-trash small" />
                </Button>
              </div>
            ))}

            {(!crmConfig.documentTypes || crmConfig.documentTypes.length === 0) && (
              <div className="text-center py-3 text-muted w-100">No document types defined.</div>
            )}
          </div>
        </div>

        {/* Territories */}
        <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
          <h6 className="fw-bold text-dark mb-3">{t('globalSettings.territories', 'Territories')}</h6>
          <TagList
            items={crmConfig.territories}
            onChange={(items) => {
              const updated = structuredClone(crmConfig);
              updated.territories = items;
              setCrmConfig(updated);
            }}
            placeholder={t('globalSettings.addItem', 'Add Item')}
          />
        </div>

        {/* Industries */}
        <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
          <h6 className="fw-bold text-dark mb-3">{t('globalSettings.industries', 'Industries')}</h6>
          <TagList
            items={crmConfig.industries}
            onChange={(items) => {
              const updated = structuredClone(crmConfig);
              updated.industries = items;
              setCrmConfig(updated);
            }}
            placeholder={t('globalSettings.addItem', 'Add Item')}
          />
        </div>
      </div>
    </div>
  );

  // ── Tab 7: Supplier Config ─────────────────────────────────────────────────
  const renderSupplierConfigTab = () => (
    <div className="d-flex flex-column h-100 mx-n3 mt-n3 mb-n3">
      {/* Sticky Header */}
      <div className="bg-white px-4 pt-4 pb-3 border-bottom flex-shrink-0">
        <h5 className="fw-bold mb-1">Supplier Configuration</h5>
        <div className="text-muted small">Configure supplier lifecycle stages, flags, and document types.</div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-grow-1 overflow-auto p-4 pe-4">
        {/* Supplier Lifecycle Stages Section */}
        <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm" style={{ borderColor: '#14b8a6' }}>
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
            <div>
              <h6 className="fw-bold mb-1" style={{ color: '#14b8a6' }}>
                Supplier Lifecycle Stages
              </h6>
              <div className="text-muted small">
                Stages represent where a supplier is in their relationship with you.
              </div>
            </div>
            <Button
              size="sm"
              className="d-flex align-items-center gap-2 border-0 text-white"
              style={{ backgroundColor: '#14b8a6' }}
              onClick={() => {
                setEditingSupplierLifecycleStage(null);
                setSupplierLifecycleStageForm({ name: '', colorPosition: 6 });
                setShowSupplierLifecycleStageModal(true);
              }}
            >
              <i className="bi bi-plus" /> Add Stage
            </Button>
          </div>

          <div className="mb-3 d-flex align-items-center gap-2">
            <Form.Check
              type="checkbox"
              id="supplierUseAutoColors"
              checked={supplierConfig.useAutoColors !== false}
              onChange={(e) => {
                const updated = structuredClone(supplierConfig);
                updated.useAutoColors = e.target.checked;
                if (e.target.checked && updated.lifecycleStages) {
                  const positions = calculateAutoColorPositions(updated.lifecycleStages.length);
                  updated.lifecycleStages = updated.lifecycleStages.map((stage, idx) => ({
                    ...stage,
                    colorPosition: positions[idx],
                  }));
                }
                setSupplierConfig(updated);
              }}
              label={<span className="text-muted small">Auto-assign colors based on stage order (Legacy)</span>}
            />
          </div>

          <div className="d-flex flex-column gap-2">
            {(supplierConfig.lifecycleStages || []).map((stage, index, arr) => {
              const colorHex = stage.color || getColorForPosition(stage.colorPosition);
              const textColor = getContrastTextColor(colorHex);

              return (
                <div key={stage.id} className="d-flex align-items-center flex-wrap gap-3 p-2 bg-light rounded border">
                  <div
                    className="rounded-circle d-flex align-items-center justify-content-center fw-bold flex-shrink-0"
                    style={{ width: 32, height: 32, backgroundColor: colorHex, color: textColor, fontSize: 12 }}
                  >
                    {stage.colorPosition}
                  </div>

                  <div className="flex-grow-1 fw-medium">{stage.name}</div>

                  <div className="d-flex align-items-center gap-1">
                    <Button
                      variant="link"
                      className="text-muted p-1"
                      disabled={index === 0}
                      onClick={() => {
                        const updated = structuredClone(supplierConfig);
                        const stages = updated.lifecycleStages;
                        [stages[index - 1], stages[index]] = [stages[index], stages[index - 1]];
                        setSupplierConfig(updated);
                      }}
                    >
                      <i className="bi bi-arrow-up" />
                    </Button>
                    <Button
                      variant="link"
                      className="text-muted p-1"
                      disabled={index === arr.length - 1}
                      onClick={() => {
                        const updated = structuredClone(supplierConfig);
                        const stages = updated.lifecycleStages;
                        [stages[index], stages[index + 1]] = [stages[index + 1], stages[index]];
                        setSupplierConfig(updated);
                      }}
                    >
                      <i className="bi bi-arrow-down" />
                    </Button>
                  </div>

                  <div className="d-flex align-items-center gap-1">
                    <Button
                      variant="light"
                      size="sm"
                      className="text-muted border-0"
                      onClick={() => {
                        setEditingSupplierLifecycleStage(stage);
                        setSupplierLifecycleStageForm({
                          name: stage.name,
                          colorPosition: stage.colorPosition,
                          color: stage.color,
                        });
                        setShowSupplierLifecycleStageModal(true);
                      }}
                    >
                      <i className="bi bi-pencil" />
                    </Button>
                    <Button
                      variant="light"
                      size="sm"
                      className="text-danger border-0"
                      onClick={() => {
                        if ((supplierConfig.lifecycleStages || []).length <= 1) {
                          void showAlert({ message: 'Cannot delete the last lifecycle stage.', variant: 'warning' });
                          return;
                        }
                        const updated = structuredClone(supplierConfig);
                        updated.lifecycleStages = updated.lifecycleStages.filter((s) => s.id !== stage.id);
                        setSupplierConfig(updated);
                      }}
                    >
                      <i className="bi bi-trash" />
                    </Button>
                  </div>
                </div>
              );
            })}

            {(!supplierConfig.lifecycleStages || supplierConfig.lifecycleStages.length === 0) && (
              <div className="text-center py-4 text-muted">No lifecycle stages defined.</div>
            )}
          </div>
        </div>

        {/* Supplier Flags Section */}
        <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm" style={{ borderColor: '#14b8a6' }}>
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
            <div>
              <h6 className="fw-bold mb-1" style={{ color: '#14b8a6' }}>
                Supplier Flags
              </h6>
              <div className="text-muted small">
                Flags highlight important suppliers (e.g., ISO Certified, Priority).
              </div>
            </div>
            <Button
              size="sm"
              className="d-flex align-items-center gap-2 border-0 text-white"
              style={{ backgroundColor: '#14b8a6' }}
              onClick={() => {
                setEditingSupplierFlag(null);
                setSupplierFlagForm({ name: '', icon: '⭐', color: '#14B8A6' });
                setShowSupplierFlagModal(true);
              }}
            >
              <i className="bi bi-plus" /> Add Flag
            </Button>
          </div>

          <div className="d-flex flex-column gap-2">
            {(supplierConfig.supplierFlags || []).map((flag) => (
              <div key={flag.id} className="d-flex align-items-center flex-wrap gap-3 p-2 bg-light rounded border">
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center fs-5 flex-shrink-0"
                  style={{ width: 32, height: 32, backgroundColor: flag.color + '20' }}
                >
                  {flag.icon}
                </div>

                <div className="flex-grow-1 fw-medium">{flag.name}</div>

                <div
                  className="rounded border shadow-sm"
                  style={{ width: 24, height: 24, backgroundColor: flag.color }}
                  title={flag.color}
                />

                <div className="d-flex align-items-center gap-1 ms-2">
                  <Button
                    variant="light"
                    size="sm"
                    className="text-muted border-0"
                    onClick={() => {
                      setEditingSupplierFlag(flag);
                      setSupplierFlagForm({ name: flag.name, icon: flag.icon, color: flag.color });
                      setShowSupplierFlagModal(true);
                    }}
                  >
                    <i className="bi bi-pencil" />
                  </Button>
                  <Button
                    variant="light"
                    size="sm"
                    className="text-danger border-0"
                    onClick={() => {
                      const updated = structuredClone(supplierConfig);
                      updated.supplierFlags = updated.supplierFlags.filter((f) => f.id !== flag.id);
                      setSupplierConfig(updated);
                    }}
                  >
                    <i className="bi bi-trash" />
                  </Button>
                </div>
              </div>
            ))}

            {(!supplierConfig.supplierFlags || supplierConfig.supplierFlags.length === 0) && (
              <div className="text-center py-4 text-muted">No supplier flags defined.</div>
            )}
          </div>
        </div>

        {/* Supplier Document Types Section */}
        <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm" style={{ borderColor: '#14b8a6' }}>
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
            <div>
              <h6 className="fw-bold mb-1" style={{ color: '#14b8a6' }}>
                Supplier Document Types
              </h6>
              <div className="text-muted small">
                Categorize documents linked to suppliers (contracts, quotes, etc.).
              </div>
            </div>
            <Button
              size="sm"
              className="d-flex align-items-center gap-2 border-0 text-white"
              style={{ backgroundColor: '#14b8a6' }}
              onClick={() => {
                setEditingSupplierDocType(null);
                setSupplierDocTypeForm({ name: '' });
                setShowSupplierDocTypeModal(true);
              }}
            >
              <i className="bi bi-plus" /> Add Type
            </Button>
          </div>

          <div className="d-flex flex-wrap gap-2">
            {(supplierConfig.documentTypes || []).map((docType) => (
              <div key={docType.id} className="d-flex align-items-center gap-2 px-3 py-2 bg-light border rounded">
                <span className="small fw-medium">{docType.name}</span>
                <Button
                  variant="link"
                  size="sm"
                  className="p-0 text-muted ms-2"
                  onClick={() => {
                    setEditingSupplierDocType(docType);
                    setSupplierDocTypeForm({ name: docType.name });
                    setShowSupplierDocTypeModal(true);
                  }}
                >
                  <i className="bi bi-pencil small" />
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  className="p-0 text-danger ms-1"
                  onClick={() => {
                    const updated = structuredClone(supplierConfig);
                    updated.documentTypes = updated.documentTypes.filter((d) => d.id !== docType.id);
                    setSupplierConfig(updated);
                  }}
                >
                  <i className="bi bi-trash small" />
                </Button>
              </div>
            ))}

            {(!supplierConfig.documentTypes || supplierConfig.documentTypes.length === 0) && (
              <div className="text-center py-3 text-muted w-100">No document types defined.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Tab 8: Customer List ───────────────────────────────────────────────────
  const renderCustomersTab = () => (
    <div>
      <div className="d-flex justify-content-end mb-3">
        <Button variant="outline-primary" size="sm" onClick={handleNewCustomer}>
          <i className="bi bi-plus me-1" />
          {t('globalSettings.newCustomer')}
        </Button>
      </div>
      {customersLoading ? (
        <div className="text-center py-4 text-muted">{t('common.loading')}</div>
      ) : customers.length === 0 ? (
        <div className="text-center py-4 text-muted">{t('empty.noCustomers')}</div>
      ) : (
        <Table size="sm" hover className="ops-settings-table">
          <thead>
            <tr>
              <th>{t('globalSettings.companyName')}</th>
              <th>{t('globalSettings.stage')}</th>
              <th>{t('globalSettings.primaryContact')}</th>
              <th>{t('crm.industry')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => {
              const stageColor = getStageColor(customer.lifecycleStage, crmConfig.lifecycleStages);
              return (
                <tr key={customer.id}>
                  <td className="fw-medium">{customer.companyName}</td>
                  <td>
                    <Badge
                      style={{
                        backgroundColor: stageColor,
                        color: getContrastTextColor(stageColor),
                      }}
                    >
                      {customer.lifecycleStage}
                    </Badge>
                  </td>
                  <td>{getPrimaryContactName(customer.contacts)}</td>
                  <td>{customer.industry ?? '-'}</td>
                  <td>
                    <div className="d-flex gap-1">
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={() => {
                          setDetailCustomerId(customer.id);
                          setShowCustomerDetail(true);
                        }}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() =>
                          setConfirmDelete({
                            show: true,
                            title: t('common.delete'),
                            message: t('globalSettings.deleteCustomerConfirm'),
                            onConfirm: () => {
                              handleDeleteCustomer(customer.id);
                              setConfirmDelete((prev) => ({ ...prev, show: false }));
                            },
                          })
                        }
                      >
                        <i className="bi bi-trash" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );

  // ── Tab 9: Supplier List ───────────────────────────────────────────────────
  const renderSuppliersTab = () => (
    <div>
      <div className="d-flex justify-content-end mb-3">
        <Button
          variant="outline-primary"
          size="sm"
          onClick={handleNewSupplier}
          style={{ borderColor: '#14b8a6', color: '#14b8a6' }}
        >
          <i className="bi bi-plus me-1" />
          {t('globalSettings.newSupplier')}
        </Button>
      </div>
      {suppliersLoading ? (
        <div className="text-center py-4 text-muted">{t('common.loading')}</div>
      ) : suppliers.length === 0 ? (
        <div className="text-center py-4 text-muted">{t('empty.noSuppliers')}</div>
      ) : (
        <Table size="sm" hover className="ops-settings-table">
          <thead>
            <tr>
              <th>{t('globalSettings.companyName')}</th>
              <th>{t('globalSettings.stage')}</th>
              <th>{t('globalSettings.primaryContact')}</th>
              <th>{t('crm.industry')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => {
              const stageColor = getStageColor(supplier.lifecycleStage, supplierConfig.lifecycleStages);
              return (
                <tr key={supplier.id}>
                  <td className="fw-medium">{supplier.companyName}</td>
                  <td>
                    <Badge
                      style={{
                        backgroundColor: stageColor,
                        color: getContrastTextColor(stageColor),
                      }}
                    >
                      {supplier.lifecycleStage}
                    </Badge>
                  </td>
                  <td>{getPrimaryContactName(supplier.contacts)}</td>
                  <td>{supplier.industry ?? '-'}</td>
                  <td>
                    <div className="d-flex gap-1">
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={() => {
                          setDetailSupplierId(supplier.id);
                          setShowSupplierDetail(true);
                        }}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() =>
                          setConfirmDelete({
                            show: true,
                            title: t('common.delete'),
                            message: t('globalSettings.deleteSupplierConfirm'),
                            onConfirm: () => {
                              handleDeleteSupplier(supplier.id);
                              setConfirmDelete((prev) => ({ ...prev, show: false }));
                            },
                          })
                        }
                      >
                        <i className="bi bi-trash" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );

  // ── Tab 10: Boards ───────────────────────────────────────────────────────
  const renderBoardsTab = () => (
    <div>
      <div className="alert alert-info mb-3">
        <i className="bi bi-info-circle me-2" />
        {t('globalSettings.boardsInfo')}
      </div>
      {boards.length === 0 ? (
        <div className="text-center py-4 text-muted">{t('boards.noBoards')}</div>
      ) : (
        <Table size="sm" hover className="ops-settings-table">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('common.color')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {boards.map((team) => (
              <tr key={team.id}>
                <td className="fw-medium">
                  <div className="d-flex align-items-center gap-2">
                    <span
                      className="d-inline-block rounded-circle flex-shrink-0"
                      style={{ width: 10, height: 10, backgroundColor: team.color || '#6c757d' }}
                    />
                    {team.name}
                  </div>
                </td>
                <td>
                  <span
                    className="d-inline-block rounded"
                    style={{ width: 20, height: 20, backgroundColor: team.color || '#6c757d' }}
                  />
                </td>
                <td className="text-end">
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => {
                      setConfirmDelete({
                        show: true,
                        title: t('globalSettings.deleteBoardTitle'),
                        message: t('globalSettings.deleteBoardMessage', { name: team.name }),
                        onConfirm: () => {
                          handleDeleteBoard(team.id);
                          setConfirmDelete((prev) => ({ ...prev, show: false }));
                        },
                      });
                    }}
                  >
                    <i className="bi bi-trash me-1" />
                    {t('common.delete')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );

  // ── Tab 11: Link Config ────────────────────────────────────────────────────
  const renderLinkConfigTab = () => (
    <div>
      <div className="alert alert-info mb-3">
        <i className="bi bi-info-circle me-2" />
        {t('globalSettings.linkConfigInfo')}
      </div>
      <Table size="sm" hover className="ops-settings-table">
        <thead>
          <tr>
            <th>{t('globalSettings.linkType')}</th>
            <th>{t('globalSettings.label')}</th>
            <th>{t('globalSettings.inverseLabel')}</th>
            <th>{t('globalSettings.causesBlocked')}</th>
          </tr>
        </thead>
        <tbody>
          {linkConfig.linkTypes.map((lt) => (
            <tr key={lt.id}>
              <td className="fw-medium">{lt.id}</td>
              <td>{lt.name}</td>
              <td>{lt.inverse}</td>
              <td>
                {lt.causesBlocked ? (
                  <i className="bi bi-check-circle-fill text-danger" />
                ) : (
                  <i className="bi bi-x-circle text-muted" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );

  const renderPrefixesTab = () => {
    // Group ticket types by unique prefix
    const prefixMap = new Map<string, TicketType[]>();
    ticketTypes.forEach((tt) => {
      const prefix = (tt.prefix || '').toUpperCase();
      if (!prefix) return;
      const existing = prefixMap.get(prefix) || [];
      existing.push(tt);
      prefixMap.set(prefix, existing);
    });

    const sortedPrefixes = Array.from(prefixMap.entries()).sort(([a], [b]) => a.localeCompare(b));

    return (
      <div>
        <h6 className="fw-bold mb-1">{t('globalSettings.prefixRegistryTitle')}</h6>
        <p className="text-muted small mb-3">{t('globalSettings.prefixRegistryDescription')}</p>

        <Table size="sm" hover className="mb-3 ops-settings-table">
          <thead>
            <tr>
              <th>{t('globalSettings.prefixColumn')}</th>
              <th>{t('globalSettings.nextNumberColumn')}</th>
              <th>{t('globalSettings.usedByColumn')}</th>
              <th>{t('globalSettings.statusColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedPrefixes.map(([prefix, types]) => (
              <tr key={prefix}>
                <td>
                  <code className="fw-bold text-uppercase" style={{ fontSize: '0.9rem' }}>
                    {prefix}
                  </code>
                </td>
                <td className="text-muted">{prefix}-001</td>
                <td>
                  <div className="d-flex flex-wrap gap-1">
                    {types.map((tt) => {
                      const textColor = getContrastTextColor(tt.color || '#6c757d');
                      return (
                        <Badge
                          key={tt.id}
                          pill
                          style={{ backgroundColor: tt.color || '#6c757d', color: textColor, fontSize: '0.75rem' }}
                        >
                          {tt.icon && <span className="me-1">{tt.icon}</span>}
                          {tt.name}
                        </Badge>
                      );
                    })}
                  </div>
                </td>
                <td>
                  {types.length > 0 ? (
                    <Badge bg="success" pill>
                      {t('globalSettings.prefixActive')}
                    </Badge>
                  ) : (
                    <Badge bg="secondary" pill>
                      {t('globalSettings.prefixUnused')}
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
            {sortedPrefixes.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center py-4 text-muted">
                  {t('globalSettings.noPrefixes')}
                </td>
              </tr>
            )}
          </tbody>
        </Table>

        <div className="alert alert-info small mb-0">
          <i className="bi bi-info-circle me-2" />
          {t('globalSettings.prefixInfoBox')}
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <>
      <Modal show={show} onHide={onHide} size="xl" fullscreen="lg-down" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title>{t('settings.title')}</Modal.Title>
        </Modal.Header>

        <Modal.Body style={{ minHeight: 500, maxHeight: '85vh', overflowX: 'hidden', overflowY: 'auto' }}>
          {error && (
            <div className="alert alert-danger mb-3" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
              {error}
            </div>
          )}

          <Tab.Container defaultActiveKey={defaultTab ?? 'staff'}>
            {/* Horizontal tab bar */}
            <Nav variant="pills" className="d-flex flex-row flex-wrap gap-2 pb-3 mb-3 border-bottom ops-settings-nav">
              <Nav.Item>
                <Nav.Link eventKey="staff">
                  {t('settings.staff')} ({staff.length})
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="ticketTypes">
                  {t('settings.ticketTypes')} ({ticketTypes.length})
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="prefixes">
                  <i className="bi bi-hash me-1" />
                  {t('settings.prefixes')}
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="statuses">{t('settings.statuses')}</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="fields">
                  {t('settings.fields')} ({fields.length})
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="crmConfig">{t('settings.crmConfig')}</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="supplierConfig">{t('settings.supplierConfig')}</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="customers">
                  {t('settings.customers')} ({customers.length})
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="suppliersList">
                  {t('settings.suppliersList')} ({suppliers.length})
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="boards">
                  {t('settings.boards')} ({boards.length})
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="linkConfig">{t('settings.linkConfig')}</Nav.Link>
              </Nav.Item>
            </Nav>

            {/* Tab Content */}
            <Tab.Content className="overflow-auto" style={{ maxHeight: 'calc(85vh - 220px)' }}>
              <Tab.Pane eventKey="staff">{renderStaffTab()}</Tab.Pane>
              <Tab.Pane eventKey="ticketTypes">{renderTicketTypesTab()}</Tab.Pane>
              <Tab.Pane eventKey="prefixes">{renderPrefixesTab()}</Tab.Pane>
              <Tab.Pane eventKey="statuses">{renderStatusesTab()}</Tab.Pane>
              <Tab.Pane eventKey="fields">{renderFieldsTab()}</Tab.Pane>
              <Tab.Pane eventKey="crmConfig">{renderCrmConfigTab()}</Tab.Pane>
              <Tab.Pane eventKey="supplierConfig">{renderSupplierConfigTab()}</Tab.Pane>
              <Tab.Pane eventKey="customers">{renderCustomersTab()}</Tab.Pane>
              <Tab.Pane eventKey="suppliersList">{renderSuppliersTab()}</Tab.Pane>
              <Tab.Pane eventKey="boards">{renderBoardsTab()}</Tab.Pane>
              <Tab.Pane eventKey="linkConfig">{renderLinkConfigTab()}</Tab.Pane>
            </Tab.Content>
          </Tab.Container>
        </Modal.Body>

        <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
          <Button variant="secondary" onClick={onHide}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={saving} onClick={handleSave}>
            {saving && <Spinner as="span" animation="border" size="sm" className="me-2" />}
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ── Delete Confirmation ──────────────────────────────────────────── */}
      <ConfirmModal
        show={confirmDelete.show}
        onHide={() => setConfirmDelete((prev) => ({ ...prev, show: false }))}
        onConfirm={confirmDelete.onConfirm}
        title={confirmDelete.title}
        message={confirmDelete.message}
        confirmLabel={t('common.delete')}
        variant="danger"
      />

      {/* ── CRM Config Modals ──────────────────────────────────────────── */}
      <Modal show={showLifecycleStageModal} onHide={() => setShowLifecycleStageModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{editingLifecycleStage ? 'Edit Lifecycle Stage' : 'Add Lifecycle Stage'}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <Form.Group>
            <Form.Label className="fw-medium small">Stage Name *</Form.Label>
            <Form.Control
              type="text"
              autoFocus
              placeholder="e.g., Active, At Risk, Churned"
              value={lifecycleStageForm.name}
              onChange={(e) => setLifecycleStageForm({ ...lifecycleStageForm, name: e.target.value })}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label className="fw-medium small">Color Position (1-10)</Form.Label>
            <div className="d-flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((pos) => {
                const colorHex = getColorForPosition(pos);
                const textColor = getContrastTextColor(colorHex);
                const isSelected = lifecycleStageForm.colorPosition === pos && !lifecycleStageForm.color;
                return (
                  <button
                    key={pos}
                    type="button"
                    onClick={() =>
                      setLifecycleStageForm({ ...lifecycleStageForm, colorPosition: pos, color: undefined })
                    }
                    className={`rounded-circle border-0 fw-bold d-flex align-items-center justify-content-center ${isSelected ? 'shadow ring-2 ring-primary' : ''}`}
                    style={{
                      width: 40,
                      height: 40,
                      backgroundColor: colorHex,
                      color: textColor,
                      outline: isSelected ? '2px solid #0d6efd' : 'none',
                      outlineOffset: 2,
                    }}
                  >
                    {pos}
                  </button>
                );
              })}
            </div>
            <div className="text-muted small mt-2">Legacy Auto-Color mapped by severity (1=Critical, 10=Minimal)</div>
          </Form.Group>
          <Form.Group>
            <Form.Label className="fw-medium small">Override Explicit Color</Form.Label>
            <div className="d-flex gap-2 align-items-center">
              <Form.Control
                type="color"
                value={lifecycleStageForm.color ?? '#6c757d'}
                onChange={(e) => setLifecycleStageForm({ ...lifecycleStageForm, color: e.target.value })}
                title={t('common.chooseColor', 'Choose your color')}
                className="p-1"
                style={{ width: '48px', height: '36px', flexShrink: 0, cursor: 'pointer', borderRadius: '4px' }}
              />
              <Form.Control
                type="text"
                value={lifecycleStageForm.color ?? ''}
                onChange={(e) => setLifecycleStageForm({ ...lifecycleStageForm, color: e.target.value })}
                placeholder="#000000"
                style={{ maxWidth: '120px' }}
              />
              <div
                className="d-flex flex-column justify-content-center ms-2"
                style={{ cursor: 'pointer' }}
                onClick={() => setLifecycleStageForm({ ...lifecycleStageForm, color: undefined })}
              >
                {lifecycleStageForm.color && <span className="small text-danger hover-underline">Clear Override</span>}
              </div>
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
          <Button variant="secondary" onClick={() => setShowLifecycleStageModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!lifecycleStageForm.name.trim()) {
                void showAlert({ message: 'Please enter a stage name', variant: 'warning' });
                return;
              }
              const updated = structuredClone(crmConfig);
              if (editingLifecycleStage) {
                const stage = updated.lifecycleStages.find((s) => s.id === editingLifecycleStage.id);
                if (stage) {
                  stage.name = lifecycleStageForm.name.trim();
                  // Always use the selected colorPosition or explicit color
                  stage.colorPosition = lifecycleStageForm.colorPosition;
                  stage.color = lifecycleStageForm.color;
                }
              } else {
                updated.lifecycleStages.push({
                  id: generateId(),
                  name: lifecycleStageForm.name.trim(),
                  colorPosition: lifecycleStageForm.colorPosition,
                  color: lifecycleStageForm.color,
                });
              }
              setCrmConfig(updated);
              setShowLifecycleStageModal(false);
            }}
          >
            {editingLifecycleStage ? 'Save' : 'Add Stage'}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showFlagModal} onHide={() => setShowFlagModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{editingFlag ? 'Edit Customer Flag' : 'Add Customer Flag'}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <Form.Group>
            <Form.Label className="fw-medium small">Flag Name *</Form.Label>
            <Form.Control
              type="text"
              autoFocus
              placeholder="e.g., VIP, Strategic, At Risk"
              value={flagForm.name}
              onChange={(e) => setFlagForm({ ...flagForm, name: e.target.value })}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label className="fw-medium small">Icon</Form.Label>
            <div className="d-flex flex-wrap gap-2">
              {['⭐', '🎯', '🔥', '💎', '🏆', '⚡', '❤️', '🚀', '⚠️', '🛡️', '👑', '💼'].map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setFlagForm({ ...flagForm, icon })}
                  className={`border rounded fs-5 d-flex align-items-center justify-content-center bg-white ${flagForm.icon === icon ? 'border-primary bg-primary bg-opacity-10' : ''}`}
                  style={{ width: 44, height: 44 }}
                >
                  {icon}
                </button>
              ))}
            </div>
          </Form.Group>
          <Form.Group>
            <Form.Label className="fw-medium small">Color</Form.Label>
            <div className="d-flex gap-3 align-items-center">
              <Form.Control
                type="color"
                value={flagForm.color}
                onChange={(e) => setFlagForm({ ...flagForm, color: e.target.value })}
                title={t('common.chooseColor', 'Choose your color')}
                className="p-1"
                style={{ width: '48px', height: '36px', cursor: 'pointer', borderRadius: '4px' }}
              />
              <Form.Control
                type="text"
                value={flagForm.color}
                onChange={(e) => setFlagForm({ ...flagForm, color: e.target.value })}
                placeholder="#000000"
                style={{ maxWidth: '120px' }}
              />
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
          <Button variant="secondary" onClick={() => setShowFlagModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!flagForm.name.trim()) {
                void showAlert({ message: 'Please enter a flag name', variant: 'warning' });
                return;
              }
              const updated = structuredClone(crmConfig);
              if (editingFlag) {
                const flag = updated.customerFlags.find((f) => f.id === editingFlag.id);
                if (flag) {
                  flag.name = flagForm.name.trim();
                  flag.icon = flagForm.icon;
                  flag.color = flagForm.color;
                }
              } else {
                updated.customerFlags.push({
                  id: generateId(),
                  name: flagForm.name.trim(),
                  icon: flagForm.icon,
                  color: flagForm.color,
                });
              }
              setCrmConfig(updated);
              setShowFlagModal(false);
            }}
          >
            {editingFlag ? 'Save' : 'Add Flag'}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showDocTypeModal} onHide={() => setShowDocTypeModal(false)} centered size="sm">
        <Modal.Header closeButton>
          <Modal.Title className="fs-6">{editingDocType ? 'Edit Document Type' : 'Add Document Type'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group>
            <Form.Label className="fw-medium small">Type Name *</Form.Label>
            <Form.Control
              type="text"
              autoFocus
              placeholder="e.g., Contract, Proposal"
              value={docTypeForm.name}
              onChange={(e) => setDocTypeForm({ ...docTypeForm, name: e.target.value })}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
          <Button variant="secondary" size="sm" onClick={() => setShowDocTypeModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!docTypeForm.name.trim()) {
                void showAlert({ message: 'Please enter a document type name', variant: 'warning' });
                return;
              }
              const updated = structuredClone(crmConfig);
              if (editingDocType) {
                const dt = updated.documentTypes.find((d) => d.id === editingDocType.id);
                if (dt) dt.name = docTypeForm.name.trim();
              } else {
                updated.documentTypes.push({ id: generateId(), name: docTypeForm.name.trim() });
              }
              setCrmConfig(updated);
              setShowDocTypeModal(false);
            }}
          >
            {editingDocType ? 'Save' : 'Add'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ── Supplier Config Modals ───────────────────────────────────────── */}
      <Modal show={showSupplierLifecycleStageModal} onHide={() => setShowSupplierLifecycleStageModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ color: '#14b8a6' }}>
            {editingSupplierLifecycleStage ? 'Edit Supplier Stage' : 'Add Supplier Stage'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <Form.Group>
            <Form.Label className="fw-medium small">Stage Name *</Form.Label>
            <Form.Control
              type="text"
              autoFocus
              placeholder="e.g., Approved, Preferred, Inactive"
              value={supplierLifecycleStageForm.name}
              onChange={(e) => setSupplierLifecycleStageForm({ ...supplierLifecycleStageForm, name: e.target.value })}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label className="fw-medium small">Color Position (1-10)</Form.Label>
            <div className="d-flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((pos) => {
                const colorHex = getColorForPosition(pos);
                const textColor = getContrastTextColor(colorHex);
                const isSelected =
                  supplierLifecycleStageForm.colorPosition === pos && !supplierLifecycleStageForm.color;
                return (
                  <button
                    key={pos}
                    type="button"
                    onClick={() =>
                      setSupplierLifecycleStageForm({
                        ...supplierLifecycleStageForm,
                        colorPosition: pos,
                        color: undefined,
                      })
                    }
                    className="rounded-circle border-0 fw-bold d-flex align-items-center justify-content-center"
                    style={{
                      width: 40,
                      height: 40,
                      backgroundColor: colorHex,
                      color: textColor,
                      outline: isSelected ? '2px solid #14b8a6' : 'none',
                      outlineOffset: 2,
                    }}
                  >
                    {pos}
                  </button>
                );
              })}
            </div>
            <div className="text-muted small mt-2">Legacy Auto-Color mapped by severity (1=Critical, 10=Minimal)</div>
          </Form.Group>
          <Form.Group>
            <Form.Label className="fw-medium small">Override Explicit Color</Form.Label>
            <div className="d-flex gap-2 align-items-center">
              <Form.Control
                type="color"
                value={supplierLifecycleStageForm.color ?? '#6c757d'}
                onChange={(e) =>
                  setSupplierLifecycleStageForm({ ...supplierLifecycleStageForm, color: e.target.value })
                }
                title={t('common.chooseColor', 'Choose your color')}
                className="p-1"
                style={{ width: '48px', height: '36px', flexShrink: 0, cursor: 'pointer', borderRadius: '4px' }}
              />
              <Form.Control
                type="text"
                value={supplierLifecycleStageForm.color ?? ''}
                onChange={(e) =>
                  setSupplierLifecycleStageForm({ ...supplierLifecycleStageForm, color: e.target.value })
                }
                placeholder="#000000"
                style={{ maxWidth: '120px' }}
              />
              <div
                className="d-flex flex-column justify-content-center ms-2"
                style={{ cursor: 'pointer' }}
                onClick={() => setSupplierLifecycleStageForm({ ...supplierLifecycleStageForm, color: undefined })}
              >
                {supplierLifecycleStageForm.color && (
                  <span className="small text-danger hover-underline">Clear Override</span>
                )}
              </div>
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
          <Button variant="secondary" onClick={() => setShowSupplierLifecycleStageModal(false)}>
            Cancel
          </Button>
          <Button
            className="border-0 text-white"
            style={{ backgroundColor: '#14b8a6' }}
            onClick={() => {
              if (!supplierLifecycleStageForm.name.trim()) {
                void showAlert({ message: 'Please enter a stage name', variant: 'warning' });
                return;
              }
              const updated = structuredClone(supplierConfig);
              if (editingSupplierLifecycleStage) {
                const stage = updated.lifecycleStages.find((s) => s.id === editingSupplierLifecycleStage.id);
                if (stage) {
                  stage.name = supplierLifecycleStageForm.name.trim();
                  // only manually set colorPosition if we aren't using auto colors
                  if (updated.useAutoColors === false) {
                    stage.colorPosition = supplierLifecycleStageForm.colorPosition;
                  }
                  stage.color = supplierLifecycleStageForm.color;
                }
              } else {
                updated.lifecycleStages.push({
                  id: generateId(),
                  name: supplierLifecycleStageForm.name.trim(),
                  colorPosition: supplierLifecycleStageForm.colorPosition,
                  color: supplierLifecycleStageForm.color,
                });
              }
              setSupplierConfig(updated);
              setShowSupplierLifecycleStageModal(false);
            }}
          >
            {editingSupplierLifecycleStage ? 'Save' : 'Add Stage'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ── Ticket Type Template Config Modal ──────────────────────────────── */}
      <Modal show={showTicketTypeModal} onHide={() => setShowTicketTypeModal(false)} size="lg" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title>
            {editingTicketType
              ? t('globalSettings.editTicketTypeTemplate', 'Edit Ticket Type Template')
              : t('globalSettings.addTicketTypeTemplate', 'Add Ticket Type Template')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <div className="row g-3">
            <div className="col-12 col-md-6">
              <Form.Group>
                <Form.Label className="fw-medium small">{t('common.name')} *</Form.Label>
                <Form.Control
                  type="text"
                  autoFocus
                  placeholder="e.g., Bug, Feature, Task"
                  value={ticketTypeForm.name}
                  onChange={(e) => setTicketTypeForm({ ...ticketTypeForm, name: e.target.value })}
                />
              </Form.Group>
            </div>
            <div className="col-6 col-md-3">
              <Form.Group>
                <Form.Label className="fw-medium small">{t('globalSettings.prefix')} *</Form.Label>
                <Form.Control
                  type="text"
                  maxLength={8}
                  placeholder="e.g., BUG, FEAT"
                  value={ticketTypeForm.prefix}
                  onChange={(e) => setTicketTypeForm({ ...ticketTypeForm, prefix: e.target.value.toUpperCase() })}
                />
              </Form.Group>
            </div>
          </div>

          <Form.Group>
            <Form.Label className="fw-medium small">{t('globalSettings.icon')}</Form.Label>
            <TicketTypeIconPicker
              value={ticketTypeForm.icon}
              onChange={(icon) => setTicketTypeForm({ ...ticketTypeForm, icon })}
            />
          </Form.Group>

          <Form.Group>
            <Form.Label className="fw-medium small">{t('common.color')}</Form.Label>
            <div className="d-flex align-items-center gap-3">
              <Form.Control
                type="color"
                value={ticketTypeForm.color || '#6c757d'}
                onChange={(e) => setTicketTypeForm({ ...ticketTypeForm, color: e.target.value })}
                title={t('common.chooseColor', 'Choose your color')}
                className="p-1"
                style={{ width: '48px', height: '36px', cursor: 'pointer', borderRadius: '4px' }}
              />
              <Form.Control
                type="text"
                value={ticketTypeForm.color || ''}
                onChange={(e) => setTicketTypeForm({ ...ticketTypeForm, color: e.target.value })}
                placeholder="#000000"
                style={{ maxWidth: '120px' }}
              />
            </div>
          </Form.Group>

          <hr className="my-2" />

          <Form.Group>
            <Form.Label className="fw-medium d-block">{t('globalSettings.defaultFields')}</Form.Label>
            <div className="text-muted small mb-2">
              {t(
                'globalSettings.defaultFieldsHelp',
                'These are the default fields for this ticket type template. Boards can layer on extra fields or override labels and options in Board Settings → Tickets & Fields.'
              )}
            </div>
            <TicketTypeFieldsEditor
              mode="global"
              ticketType={ticketTypeForm}
              fields={fields}
              onMoveField={(_ttId, fromIdx, toIdx) => {
                const ids = [...(ticketTypeForm.defaultFields ?? [])];
                if (fromIdx < 0 || fromIdx >= ids.length) return;
                const [moved] = ids.splice(fromIdx, 1);
                ids.splice(Math.min(toIdx, ids.length), 0, moved);
                setTicketTypeForm({ ...ticketTypeForm, defaultFields: ids });
              }}
              onDefaultFieldsChange={(_ttId, defaultFields) => setTicketTypeForm({ ...ticketTypeForm, defaultFields })}
              onCreateField={handleCreateFieldInline}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
          <Button variant="secondary" onClick={() => setShowTicketTypeModal(false)}>
            Cancel
          </Button>
          {ticketTypeModalError && (
            <div className="alert alert-danger w-100 mb-0 me-2 py-1 px-2 small">{ticketTypeModalError}</div>
          )}
          <Button
            variant="primary"
            disabled={savingTicketType}
            onClick={() => {
              void (async () => {
                if (!ticketTypeForm.name.trim() || !ticketTypeForm.prefix.trim() || !ticketTypeForm.icon.trim()) {
                  void showAlert({ message: 'Name, Prefix, and Icon are required.', variant: 'warning' });
                  return;
                }
                // Duplicate-name guard (FEAT-171). Today multiple "Priority"-style
                // ticket types can be created in parallel; warn the user before
                // they accidentally fork a template.
                const trimmedName = ticketTypeForm.name.trim().toLowerCase();
                const dupe = ticketTypes.find(
                  (tt) => tt.name.toLowerCase() === trimmedName && tt.id !== ticketTypeForm.id
                );
                if (dupe && !editingTicketType) {
                  const proceed = await showConfirm({
                    title: t('globalSettings.duplicateTicketTypeTitle', 'Ticket type already exists'),
                    message: t('globalSettings.duplicateTicketTypePrompt', {
                      name: dupe.name,
                      prefix: dupe.prefix,
                      defaultValue:
                        'A ticket type called "{{name}}" ({{prefix}}) already exists. Create another one anyway?',
                    }),
                    confirmLabel: t('globalSettings.duplicateCreateAnyway', 'Create anyway'),
                    cancelLabel: t('globalSettings.duplicateUseExisting', 'Use existing'),
                    variant: 'warning',
                  });
                  if (!proceed) return;
                }

                // Persist immediately so the user doesn't have to hit the
                // outer Save afterwards. New types come from a temp `custom-…`
                // id — we POST and swap in the server-assigned real id so the
                // outer save's diff loop won't try to re-create.
                setSavingTicketType(true);
                setTicketTypeModalError(null);
                try {
                  const isNew = !editingTicketType || ticketTypeForm.id.startsWith('custom-');
                  if (isNew) {
                    const created = await OpsService.createTicketType(numaPost, {
                      name: ticketTypeForm.name,
                      prefix: ticketTypeForm.prefix,
                      icon: ticketTypeForm.icon,
                      color: ticketTypeForm.color,
                      defaultFields: ticketTypeForm.defaultFields,
                    });
                    const persisted: TicketType = {
                      ...ticketTypeForm,
                      ...created,
                      id: created?.id ?? ticketTypeForm.id,
                    };
                    setTicketTypes((prev) => {
                      const existed = prev.some((tt) => tt.id === ticketTypeForm.id);
                      return existed
                        ? prev.map((tt) => (tt.id === ticketTypeForm.id ? persisted : tt))
                        : [...prev, persisted];
                    });
                  } else {
                    const updated = await OpsService.updateTicketType(numaPut, ticketTypeForm.id, {
                      name: ticketTypeForm.name,
                      icon: ticketTypeForm.icon,
                      color: ticketTypeForm.color,
                      defaultFields: ticketTypeForm.defaultFields,
                    });
                    const persisted: TicketType = { ...ticketTypeForm, ...updated };
                    setTicketTypes((prev) => prev.map((tt) => (tt.id === ticketTypeForm.id ? persisted : tt)));
                  }
                  await refreshConfig();
                  setShowTicketTypeModal(false);
                } catch (err) {
                  setTicketTypeModalError(t('errors.saveFailed', { message: String(err) }));
                } finally {
                  setSavingTicketType(false);
                }
              })();
            }}
          >
            {savingTicketType
              ? t('common.saving', 'Saving…')
              : editingTicketType
                ? t('common.save', 'Save Changes')
                : t('globalSettings.addTicketTypeTemplate', 'Add Ticket Type Template')}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Ticket Type Field Selection Modal */}
      <Modal
        show={showTicketTypeFieldModal}
        onHide={() => setShowTicketTypeFieldModal(false)}
        size="lg"
        centered
        scrollable
      >
        <Modal.Header closeButton className="bg-light border-bottom">
          <Modal.Title className="fs-6 fw-bold">Select Fields for {ticketTypeForm.name || 'Ticket Type'}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-0">
          <div className="p-3 bg-white border-bottom sticky-top" style={{ zIndex: 10 }}>
            <div className="d-flex align-items-center gap-2">
              <div className="input-group input-group-sm shadow-sm border rounded">
                <span className="input-group-text bg-white border-0">
                  <i className="bi bi-search text-muted"></i>
                </span>
                <input
                  type="text"
                  className="form-control border-0 ps-0 shadow-none bg-white"
                  placeholder="Search all fields..."
                  value={fieldSelectionSearch}
                  onChange={(e) => setFieldSelectionSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="p-3" style={{ maxHeight: '60vh' }}>
            {allFieldCategories.map((cat) => {
              const catFields = fields.filter(
                (f) =>
                  f.category === cat &&
                  (!fieldSelectionSearch || f.name.toLowerCase().includes(fieldSelectionSearch.toLowerCase()))
              );
              if (catFields.length === 0) return null;

              return (
                <div key={cat} className="mb-4">
                  <h6 className="fw-bold text-muted small text-uppercase mb-2 px-1">{cat}</h6>
                  <div className="row g-2">
                    {catFields.map((field) => (
                      <div key={field.id} className="col-12 col-md-6 col-lg-4">
                        <label
                          htmlFor={`select-field-${field.id}`}
                          className={`p-2 border rounded d-flex align-items-center gap-2 h-100 cursor-pointer transition-all ${ticketTypeForm.defaultFields.includes(field.id) ? 'border-primary bg-primary bg-opacity-10' : 'bg-white hover-bg-light border-light shadow-sm'}`}
                          style={{ cursor: 'pointer' }}
                        >
                          <Form.Check
                            type="checkbox"
                            id={`select-field-${field.id}`}
                            checked={ticketTypeForm.defaultFields.includes(field.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setTicketTypeForm({
                                  ...ticketTypeForm,
                                  defaultFields: [...ticketTypeForm.defaultFields, field.id],
                                });
                              } else {
                                setTicketTypeForm({
                                  ...ticketTypeForm,
                                  defaultFields: ticketTypeForm.defaultFields.filter((id) => id !== field.id),
                                });
                              }
                            }}
                          />
                          <div className="flex-grow-1 overflow-hidden">
                            <div className="text-truncate fw-medium small" title={field.name}>
                              {field.name}
                            </div>
                            <div className="text-muted" style={{ fontSize: '0.65rem' }}>
                              {field.fieldType}
                            </div>
                          </div>
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Modal.Body>
        <Modal.Footer className="border-top" style={{ backgroundColor: '#f9fafb' }}>
          <div className="me-auto small text-muted">{ticketTypeForm.defaultFields.length} field(s) selected</div>
          <Button variant="primary" size="sm" onClick={() => setShowTicketTypeFieldModal(false)}>
            Done
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showSupplierLifecycleStageModal} onHide={() => setShowSupplierLifecycleStageModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ color: '#14b8a6' }}>
            {editingSupplierLifecycleStage ? 'Edit Supplier Stage' : 'Add Supplier Stage'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <Form.Group>
            <Form.Label className="fw-medium small">Stage Name *</Form.Label>
            <Form.Control
              type="text"
              autoFocus
              placeholder="e.g., Potential, Approved, Preferred"
              value={supplierLifecycleStageForm.name}
              onChange={(e) => setSupplierLifecycleStageForm({ ...supplierLifecycleStageForm, name: e.target.value })}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label className="fw-medium small">Color Position (1-10)</Form.Label>
            <div className="d-flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((pos) => {
                const colorHex = getColorForPosition(pos);
                const textColor = getContrastTextColor(colorHex);
                const isSelected =
                  supplierLifecycleStageForm.colorPosition === pos && !supplierLifecycleStageForm.color;
                return (
                  <button
                    key={pos}
                    type="button"
                    onClick={() =>
                      setSupplierLifecycleStageForm({
                        ...supplierLifecycleStageForm,
                        colorPosition: pos,
                        color: undefined,
                      })
                    }
                    className={`rounded-circle border-0 fw-bold d-flex align-items-center justify-content-center ${isSelected ? 'shadow ring-2 ring-primary' : ''}`}
                    style={{
                      width: 40,
                      height: 40,
                      backgroundColor: colorHex,
                      color: textColor,
                      outline: isSelected ? '2px solid #0d6efd' : 'none',
                      outlineOffset: 2,
                    }}
                  >
                    {pos}
                  </button>
                );
              })}
            </div>
          </Form.Group>
          <Form.Group>
            <Form.Label className="fw-medium small">
              {t('settings.explicitColorOverride', 'Explicit Color Override')}
            </Form.Label>
            <div className="d-flex gap-2 align-items-center">
              <Form.Control
                type="color"
                value={supplierLifecycleStageForm.color ?? '#6c757d'}
                onChange={(e) =>
                  setSupplierLifecycleStageForm({ ...supplierLifecycleStageForm, color: e.target.value })
                }
                title={t('common.chooseColor', 'Choose your color')}
                className="p-1"
                style={{ width: '48px', height: '36px', flexShrink: 0, cursor: 'pointer', borderRadius: '4px' }}
              />
              <Form.Control
                type="text"
                value={supplierLifecycleStageForm.color ?? ''}
                onChange={(e) =>
                  setSupplierLifecycleStageForm({ ...supplierLifecycleStageForm, color: e.target.value })
                }
                placeholder="#000000"
                style={{ maxWidth: '120px' }}
              />
              <div
                className="d-flex flex-column justify-content-center ms-2"
                style={{ cursor: 'pointer' }}
                onClick={() => setSupplierLifecycleStageForm({ ...supplierLifecycleStageForm, color: undefined })}
              >
                {supplierLifecycleStageForm.color && (
                  <span className="small text-danger hover-underline">
                    {t('common.clearOverride', 'Clear Override')}
                  </span>
                )}
              </div>
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
          <Button variant="secondary" onClick={() => setShowSupplierLifecycleStageModal(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            style={{ backgroundColor: '#14b8a6', borderColor: '#14b8a6' }}
            className="text-white"
            onClick={() => {
              if (!supplierLifecycleStageForm.name.trim()) {
                void showAlert({ message: 'Please enter a stage name', variant: 'warning' });
                return;
              }
              const updated = structuredClone(supplierConfig);
              if (editingSupplierLifecycleStage) {
                const stage = updated.lifecycleStages.find((s) => s.id === editingSupplierLifecycleStage.id);
                if (stage) {
                  stage.name = supplierLifecycleStageForm.name.trim();
                  stage.colorPosition = supplierLifecycleStageForm.colorPosition;
                  stage.color = supplierLifecycleStageForm.color;
                }
              } else {
                updated.lifecycleStages.push({
                  id: generateId(),
                  name: supplierLifecycleStageForm.name.trim(),
                  colorPosition: supplierLifecycleStageForm.colorPosition,
                  color: supplierLifecycleStageForm.color,
                });
              }
              setSupplierConfig(updated);
              setShowSupplierLifecycleStageModal(false);
            }}
          >
            {editingSupplierLifecycleStage ? t('common.save') : t('common.addStage', 'Add Stage')}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showSupplierFlagModal} onHide={() => setShowSupplierFlagModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ color: '#14b8a6' }}>
            {editingSupplierFlag
              ? t('settings.editSupplierFlag', 'Edit Supplier Flag')
              : t('settings.addSupplierFlag', 'Add Supplier Flag')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <Form.Group>
            <Form.Label className="fw-medium small">Flag Name *</Form.Label>
            <Form.Control
              type="text"
              autoFocus
              placeholder="e.g., Preferred, ISO Certified"
              value={supplierFlagForm.name}
              onChange={(e) => setSupplierFlagForm({ ...supplierFlagForm, name: e.target.value })}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label className="fw-medium small">Icon</Form.Label>
            <div className="d-flex flex-wrap gap-2">
              {['⭐', '✓', '🔒', '🏆', '📍', '⚡', '🛡️', '✈️', '🏭', '📦', '🔧', '💼'].map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setSupplierFlagForm({ ...supplierFlagForm, icon })}
                  className={`border rounded fs-5 d-flex align-items-center justify-content-center bg-white ${supplierFlagForm.icon === icon ? 'border-primary bg-primary bg-opacity-10' : ''}`}
                  style={{
                    width: 44,
                    height: 44,
                    borderColor: supplierFlagForm.icon === icon ? '#14b8a6 !important' : '',
                  }}
                >
                  {icon}
                </button>
              ))}
            </div>
          </Form.Group>
          <Form.Group>
            <Form.Label className="fw-medium small">Color</Form.Label>
            <div className="d-flex align-items-center gap-3">
              <Form.Control
                type="color"
                value={supplierFlagForm.color}
                onChange={(e) => setSupplierFlagForm({ ...supplierFlagForm, color: e.target.value })}
                title={t('common.chooseColor', 'Choose your color')}
                className="p-1"
                style={{ width: '48px', height: '36px', cursor: 'pointer', borderRadius: '4px' }}
              />
              <Form.Control
                type="text"
                value={supplierFlagForm.color}
                onChange={(e) => setSupplierFlagForm({ ...supplierFlagForm, color: e.target.value })}
                placeholder="#000000"
                style={{ maxWidth: '120px' }}
              />
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
          <Button variant="secondary" onClick={() => setShowSupplierFlagModal(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            className="border-0 text-white"
            style={{ backgroundColor: '#14b8a6' }}
            onClick={() => {
              if (!supplierFlagForm.name.trim()) {
                void showAlert({ message: 'Please enter a flag name', variant: 'warning' });
                return;
              }
              const updated = structuredClone(supplierConfig);
              if (editingSupplierFlag) {
                const flag = updated.supplierFlags.find((f) => f.id === editingSupplierFlag.id);
                if (flag) {
                  flag.name = supplierFlagForm.name.trim();
                  flag.icon = supplierFlagForm.icon;
                  flag.color = supplierFlagForm.color;
                }
              } else {
                updated.supplierFlags.push({
                  id: generateId(),
                  name: supplierFlagForm.name.trim(),
                  icon: supplierFlagForm.icon,
                  color: supplierFlagForm.color,
                });
              }
              setSupplierConfig(updated);
              setShowSupplierFlagModal(false);
            }}
          >
            {editingSupplierFlag ? t('common.save') : t('settings.addFlag', 'Add Flag')}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showSupplierDocTypeModal} onHide={() => setShowSupplierDocTypeModal(false)} centered size="sm">
        <Modal.Header closeButton>
          <Modal.Title className="fs-6" style={{ color: '#14b8a6' }}>
            {editingSupplierDocType
              ? t('settings.editDocType', 'Edit Document Type')
              : t('settings.addDocType', 'Add Document Type')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group>
            <Form.Label className="fw-medium small">Type Name *</Form.Label>
            <Form.Control
              type="text"
              autoFocus
              placeholder="e.g., Certificate, Invoice"
              value={supplierDocTypeForm.name}
              onChange={(e) => setSupplierDocTypeForm({ ...supplierDocTypeForm, name: e.target.value })}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
          <Button variant="secondary" size="sm" onClick={() => setShowSupplierDocTypeModal(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="border-0 text-white"
            style={{ backgroundColor: '#14b8a6' }}
            onClick={() => {
              if (!supplierDocTypeForm.name.trim()) {
                void showAlert({ message: 'Please enter a document type name', variant: 'warning' });
                return;
              }
              const updated = structuredClone(supplierConfig);
              if (editingSupplierDocType) {
                const dt = updated.documentTypes.find((d) => d.id === editingSupplierDocType.id);
                if (dt) dt.name = supplierDocTypeForm.name.trim();
              } else {
                updated.documentTypes.push({ id: generateId(), name: supplierDocTypeForm.name.trim() });
              }
              setSupplierConfig(updated);
              setShowSupplierDocTypeModal(false);
            }}
          >
            {editingSupplierDocType ? 'Save' : 'Add'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ── Field Config Modal ──────────────────────────────────────────── */}
      <Modal show={showingNewField} onHide={() => setShowingNewField(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{editingFieldId ? t('globalSettings.editField') : t('globalSettings.addField')}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <Form.Group>
            <Form.Label className="fw-medium small">{t('common.name')} *</Form.Label>
            <Form.Control
              type="text"
              autoFocus
              placeholder="e.g., Asset Number"
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
            />
          </Form.Group>
          <div className="row g-3">
            <div className="col-12 col-md-6">
              <Form.Group>
                <Form.Label className="fw-medium small">{t('globalSettings.fieldType')}</Form.Label>
                <Form.Select value={newFieldType} onChange={(e) => setNewFieldType(e.target.value as FieldType)}>
                  {FIELD_TYPES.map((ft) => (
                    <option key={ft} value={ft}>
                      {ft}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </div>
            <div className="col-12 col-md-6">
              <Form.Group>
                <Form.Label className="fw-medium small">{t('globalSettings.category')}</Form.Label>
                <Form.Control
                  as="input"
                  list="field-category-list-modal"
                  placeholder="Select or type..."
                  value={newFieldCategory}
                  onChange={(e) => setNewFieldCategory(e.target.value as FieldCategory)}
                />
                <datalist id="field-category-list-modal">
                  {Array.from(new Set([...FIELD_CATEGORIES, ...fields.map((f) => f.category)]))
                    .sort()
                    .map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                </datalist>
              </Form.Group>
            </div>
          </div>
          {['select', 'multi_select'].includes(newFieldType) && (
            <Form.Group>
              <Form.Label className="fw-medium small">{t('globalSettings.options')} (comma separated)</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g. Red, Blue, Green"
                value={newFieldOptions}
                onChange={(e) => setNewFieldOptions(e.target.value)}
              />
            </Form.Group>
          )}
        </Modal.Body>
        <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
          <Button variant="secondary" onClick={() => setShowingNewField(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleAddCustomField} disabled={!newFieldName.trim()}>
            {editingFieldId ? t('common.save') : t('common.add')}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ── Detail Modals ──────────────────────────────────────────────── */}
      <CustomerDetailModal
        show={showCustomerDetail}
        customerId={detailCustomerId}
        onHide={() => {
          setShowCustomerDetail(false);
          setDetailCustomerId(null);
        }}
        onUpdated={() => loadCustomers()}
      />
      <SupplierDetailModal
        show={showSupplierDetail}
        supplierId={detailSupplierId}
        onHide={() => {
          setShowSupplierDetail(false);
          setDetailSupplierId(null);
        }}
        onUpdated={() => loadSuppliers()}
      />
    </>
  );
}

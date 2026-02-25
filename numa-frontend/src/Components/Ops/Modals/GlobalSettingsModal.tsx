/* eslint-disable i18next/no-literal-string */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal, Button, Form, Nav, Tab, Table, Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import {
  getColorForPosition,
  getContrastTextColor,
  getStatusTypeColor,
  BOARD_COLORS,
  calculateAutoColorPositions,
} from '../Shared/colorUtils';
import { STATUS_TYPE_TO_ZONES } from '../../../constants/opsConstants';
import { ConfirmModal } from './ConfirmModal';
import { CustomerDetailModal } from './CustomerDetailModal';
import { SupplierDetailModal } from './SupplierDetailModal';
import { StaffAvatar } from '../Shared/StaffAvatar';
import type {
  OpsConfigResponse,
  TicketType,
  StatusType,
  FieldDefinition,
  FieldCategory,
  FieldType,
  StaffProfile,
  Project,
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
const FIELD_CATEGORIES: FieldCategory[] = ['common', 'development', 'support', 'crm', 'operations'];
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

// ─── Color Swatch Sub-Component ──────────────────────────────────────────────

function ColorSwatch({
  color,
  selected,
  onSelect,
}: {
  color: string;
  selected: boolean;
  onSelect: (c: string) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(color)}
      className="border-0 p-0 d-flex align-items-center justify-content-center"
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        backgroundColor: color,
        cursor: 'pointer',
        outline: selected ? '3px solid #333' : 'none',
        outlineOffset: 2,
      }}
    >
      {selected && <i className="bi bi-check-lg" style={{ color: '#fff', fontSize: 14 }} />}
    </button>
  );
}

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
  const { config, teams, refreshTeams, refreshStaff } = useOps();

  // ── Local state (edited copies of config) ──────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  // statuses are read-only (fixed StatusType categories) — no longer editable
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [crmConfig, setCrmConfig] = useState<CrmConfig>({
    lifecycleStages: [],
    customerFlags: [],
    documentTypes: [],
    territories: [],
    industries: [],
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
  const [expandedTypeId, setExpandedTypeId] = useState<string | null>(null);
  const [fieldCategoryFilter, setFieldCategoryFilter] = useState<FieldCategory>('common');
  const [fieldSearch, setFieldSearch] = useState('');
  const [showingNewField, setShowingNewField] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  const [newFieldCategory, setNewFieldCategory] = useState<FieldCategory>('common');
  const [newFieldOptions, setNewFieldOptions] = useState('');

  // ── CRM Config state ───────────────────────────────────────────────────────
  const [editingLifecycleStage, setEditingLifecycleStage] = useState<CrmLifecycleStage | null>(null);
  const [lifecycleStageForm, setLifecycleStageForm] = useState({ name: '', colorPosition: 6 });
  const [showLifecycleStageModal, setShowLifecycleStageModal] = useState(false);

  const [editingFlag, setEditingFlag] = useState<CrmFlag | null>(null);
  const [flagForm, setFlagForm] = useState({ name: '', icon: '⭐', color: '#F59E0B' });
  const [showFlagModal, setShowFlagModal] = useState(false);

  const [editingDocType, setEditingDocType] = useState<DocTypeEntry | null>(null);
  const [docTypeForm, setDocTypeForm] = useState({ name: '' });
  const [showDocTypeModal, setShowDocTypeModal] = useState(false);

  // ── Supplier Config state ──────────────────────────────────────────────────
  const [editingSupplierLifecycleStage, setEditingSupplierLifecycleStage] = useState<CrmLifecycleStage | null>(null);
  const [supplierLifecycleStageForm, setSupplierLifecycleStageForm] = useState({ name: '', colorPosition: 6 });
  const [showSupplierLifecycleStageModal, setShowSupplierLifecycleStageModal] = useState(false);

  const [editingSupplierFlag, setEditingSupplierFlag] = useState<SupplierFlag | null>(null);
  const [supplierFlagForm, setSupplierFlagForm] = useState({ name: '', icon: '⭐', color: '#14B8A6' });
  const [showSupplierFlagModal, setShowSupplierFlagModal] = useState(false);

  const [editingSupplierDocType, setEditingSupplierDocType] = useState<DocTypeEntry | null>(null);
  const [supplierDocTypeForm, setSupplierDocTypeForm] = useState({ name: '' });
  const [showSupplierDocTypeModal, setShowSupplierDocTypeModal] = useState(false);

  // ── Detail modal state ─────────────────────────────────────────────────────
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null);
  const [showCustomerDetail, setShowCustomerDetail] = useState(false);
  const [detailSupplierId, setDetailSupplierId] = useState<string | null>(null);
  const [showSupplierDetail, setShowSupplierDetail] = useState(false);

  // ── Confirm modal state ────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ show: false, title: '', message: '', onConfirm: () => {} });

  // ── Sync local state from config when modal opens ─────────────────────────
  useEffect(() => {
    if (show && config) {
      setProjects(config.projects ? structuredClone(config.projects) : []);
      setStaff(config.staff ? structuredClone(config.staff) : []);
      setTicketTypes(config.ticketTypes ? structuredClone(config.ticketTypes) : []);
      // statuses no longer editable — status categories are fixed
      setFields(config.fields ? structuredClone(config.fields) : []);
      setCrmConfig(
        config.crmConfig
          ? structuredClone(config.crmConfig)
          : {
              lifecycleStages: [],
              customerFlags: [],
              documentTypes: [],
              territories: [],
              industries: [],
            },
      );
      setSupplierConfig(
        config.supplierConfig
          ? structuredClone(config.supplierConfig)
          : {
              lifecycleStages: [],
              supplierFlags: [],
              documentTypes: [],
            },
      );
      setLinkConfig(config.linkConfig ? structuredClone(config.linkConfig) : { linkTypes: [] });
      setError(null);
      setExpandedTypeId(null);
      setFieldSearch('');
      setShowingNewField(false);
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

  // ── Filtered fields ────────────────────────────────────────────────────────
  const filteredFields = useMemo(() => {
    return fields
      .filter((f) => f.category === fieldCategoryFilter)
      .filter((f) => !fieldSearch || f.name.toLowerCase().includes(fieldSearch.toLowerCase()));
  }, [fields, fieldCategoryFilter, fieldSearch]);

  // ── Save handler ───────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      setError(null);
      // For now, log the updated config. The backend config update endpoint
      // would be called here once available.
      const updatedConfig: Omit<OpsConfigResponse, 'statuses'> = {
        ticketTypes,
        fields,
        staff,
        projects,
        crmConfig,
        supplierConfig,
        linkConfig,
      };
      await OpsService.updateCrmConfig(numaPut, crmConfig);
      console.info('[GlobalSettingsModal] Saving config:', updatedConfig);
      onSaved();
    } catch (err) {
      setError(t('errors.saveFailed', { message: String(err) }));
    } finally {
      setSaving(false);
    }
  }, [ticketTypes, fields, staff, projects, crmConfig, supplierConfig, linkConfig, onSaved, t]);

  // ── Customer delete handler ────────────────────────────────────────────────
  const handleDeleteCustomer = useCallback(
    async (customerId: string) => {
      try {
        await OpsService.deleteCustomer(numaDelete, customerId);
        setCustomers((prev) => prev.filter((c) => c.id !== customerId));
      } catch (err) {
        setError(t('errors.saveFailed', { message: String(err) }));
      }
    },
    [numaDelete, t],
  );

  // ── Supplier delete handler ────────────────────────────────────────────────
  const handleDeleteSupplier = useCallback(
    async (supplierId: string) => {
      try {
        await OpsService.deleteSupplier(numaDelete, supplierId);
        setSuppliers((prev) => prev.filter((s) => s.id !== supplierId));
      } catch (err) {
        setError(t('errors.saveFailed', { message: String(err) }));
      }
    },
    [numaDelete, t],
  );

  // ── Team delete handler ──────────────────────────────────────────────────
  const handleDeleteTeam = useCallback(
    async (teamId: string) => {
      try {
        await OpsService.deleteTeam(numaDelete, teamId);
        await refreshTeams();
      } catch (err) {
        const msg = String(err);
        if (msg.includes('409')) {
          setError(t('globalSettings.teamDeleteHasTickets'));
        } else {
          setError(t('errors.saveFailed', { message: msg }));
        }
      }
    },
    [numaDelete, refreshTeams, t],
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
  const handleAddCustomField = () => {
    if (!newFieldName.trim()) return;
    const newField: FieldDefinition = {
      id: generateId(),
      name: newFieldName.trim(),
      category: newFieldCategory,
      fieldType: newFieldType,
      options: ['select', 'multi_select'].includes(newFieldType)
        ? newFieldOptions
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined,
      isSystem: false,
      order: fields.length,
    };
    setFields((prev) => [...prev, newField]);
    setNewFieldName('');
    setNewFieldType('text');
    setNewFieldOptions('');
    setShowingNewField(false);
  };

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

  // ── Tab 1: Projects ────────────────────────────────────────────────────────
  const renderProjectsTab = () => (
    <div>
      <Table size="sm" hover className="mb-0">
        <thead>
          <tr>
            <th>{t('common.name')}</th>
            <th>{t('common.description')}</th>
            <th>{t('common.color')}</th>
            <th>{t('globalSettings.active')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {projects.map((project, idx) => (
            <tr key={project.id}>
              <td>
                <Form.Control
                  type="text"
                  size="sm"
                  value={project.name}
                  onChange={(e) => {
                    const updated = [...projects];
                    updated[idx] = { ...updated[idx], name: e.target.value };
                    setProjects(updated);
                  }}
                />
              </td>
              <td>
                <Form.Control
                  type="text"
                  size="sm"
                  value={project.description ?? ''}
                  onChange={(e) => {
                    const updated = [...projects];
                    updated[idx] = { ...updated[idx], description: e.target.value };
                    setProjects(updated);
                  }}
                />
              </td>
              <td>
                <div className="d-flex gap-1">
                  {BOARD_COLORS.slice(0, 6).map((c) => (
                    <ColorSwatch
                      key={c}
                      color={c}
                      selected={project.color === c}
                      onSelect={(color) => {
                        const updated = [...projects];
                        updated[idx] = { ...updated[idx], color };
                        setProjects(updated);
                      }}
                    />
                  ))}
                </div>
              </td>
              <td>
                <Form.Check
                  type="switch"
                  checked={project.isActive}
                  onChange={(e) => {
                    const updated = [...projects];
                    updated[idx] = { ...updated[idx], isActive: e.target.checked };
                    setProjects(updated);
                  }}
                />
              </td>
              <td>
                <Button
                  variant="outline-danger"
                  size="sm"
                  onClick={() => setProjects((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <i className="bi bi-trash" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Button
        variant="outline-primary"
        size="sm"
        className="mt-2"
        onClick={() =>
          setProjects((prev) => [
            ...prev,
            {
              id: generateId(),
              name: '',
              description: '',
              color: BOARD_COLORS[prev.length % BOARD_COLORS.length],
              isActive: true,
            },
          ])
        }
      >
        <i className="bi bi-plus me-1" />
        {t('globalSettings.addProject')}
      </Button>
    </div>
  );

  // ── Tab 2: Staff ───────────────────────────────────────────────────────────
  const renderStaffTab = () => (
    <div>
      <div className="alert alert-info mb-3">
        <i className="bi bi-info-circle me-2" />
        {t('globalSettings.staffManagedNote')}
      </div>
      <Table size="sm" hover>
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

  // ── Tab 3: Ticket Types ────────────────────────────────────────────────────
  const renderTicketTypesTab = () => (
    <div>
      <Table size="sm" hover className="mb-0">
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
          {ticketTypes.map((tt, idx) => (
            <React.Fragment key={tt.id}>
              <tr
                style={{ cursor: 'pointer' }}
                onClick={() => setExpandedTypeId(expandedTypeId === tt.id ? null : tt.id)}
              >
                <td>
                  <Form.Control
                    type="text"
                    size="sm"
                    style={{ width: 50 }}
                    value={tt.icon}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const updated = [...ticketTypes];
                      updated[idx] = { ...updated[idx], icon: e.target.value };
                      setTicketTypes(updated);
                    }}
                  />
                </td>
                <td>
                  <div className="d-flex gap-1">
                    {BOARD_COLORS.slice(0, 6).map((c) => (
                      <ColorSwatch
                        key={c}
                        color={c}
                        selected={tt.color === c}
                        onSelect={(color) => {
                          const updated = [...ticketTypes];
                          updated[idx] = { ...updated[idx], color };
                          setTicketTypes(updated);
                        }}
                      />
                    ))}
                  </div>
                </td>
                <td>
                  <Form.Control
                    type="text"
                    size="sm"
                    maxLength={8}
                    style={{ width: 80 }}
                    value={tt.prefix}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const updated = [...ticketTypes];
                      updated[idx] = { ...updated[idx], prefix: e.target.value };
                      setTicketTypes(updated);
                    }}
                  />
                </td>
                <td>
                  <Form.Control
                    type="text"
                    size="sm"
                    value={tt.name}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const updated = [...ticketTypes];
                      updated[idx] = { ...updated[idx], name: e.target.value };
                      setTicketTypes(updated);
                    }}
                  />
                </td>
                <td>
                  <div className="d-flex gap-1">
                    <Button
                      variant="link"
                      size="sm"
                      className="text-muted p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedTypeId(expandedTypeId === tt.id ? null : tt.id);
                      }}
                    >
                      <i className={`bi bi-chevron-${expandedTypeId === tt.id ? 'up' : 'down'}`} />
                    </Button>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTicketTypes((prev) => prev.filter((_, i) => i !== idx));
                      }}
                    >
                      <i className="bi bi-trash" />
                    </Button>
                  </div>
                </td>
              </tr>
              {expandedTypeId === tt.id && (
                <tr>
                  <td colSpan={5} className="bg-light">
                    <div className="p-2">
                      <strong className="d-block mb-2">{t('globalSettings.defaultFields')}</strong>
                      <div className="d-flex flex-wrap gap-2">
                        {fields.map((field) => (
                          <Form.Check
                            key={field.id}
                            type="checkbox"
                            id={`type-field-${tt.id}-${field.id}`}
                            label={field.name}
                            checked={tt.defaultFields.includes(field.id)}
                            onChange={(e) => {
                              const updated = [...ticketTypes];
                              const current = updated[idx];
                              if (e.target.checked) {
                                updated[idx] = { ...current, defaultFields: [...current.defaultFields, field.id] };
                              } else {
                                updated[idx] = {
                                  ...current,
                                  defaultFields: current.defaultFields.filter((id) => id !== field.id),
                                };
                              }
                              setTicketTypes(updated);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </Table>
      <Button
        variant="outline-primary"
        size="sm"
        className="mt-2"
        onClick={() =>
          setTicketTypes((prev) => [
            ...prev,
            {
              id: generateId(),
              name: '',
              prefix: '',
              icon: '',
              color: BOARD_COLORS[prev.length % BOARD_COLORS.length],
              defaultFields: [],
              order: prev.length,
            },
          ])
        }
      >
        <i className="bi bi-plus me-1" />
        {t('globalSettings.addType')}
      </Button>
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
      <Table size="sm" className="mb-0">
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
  const renderFieldsTab = () => (
    <div>
      {/* Category sub-tabs */}
      <Nav variant="pills" className="mb-3">
        {FIELD_CATEGORIES.map((cat) => (
          <Nav.Item key={cat}>
            <Nav.Link active={fieldCategoryFilter === cat} onClick={() => setFieldCategoryFilter(cat)}>
              {t(`globalSettings.fieldCategories.${cat}`)}
            </Nav.Link>
          </Nav.Item>
        ))}
      </Nav>

      {/* Search */}
      <Form.Control
        type="text"
        size="sm"
        className="mb-3"
        placeholder={t('globalSettings.searchFields')}
        value={fieldSearch}
        onChange={(e) => setFieldSearch(e.target.value)}
      />

      {/* Field list */}
      <div className="d-flex flex-column gap-2 mb-3">
        {filteredFields.map((field) => (
          <div key={field.id} className="d-flex align-items-center gap-2 p-2 border rounded">
            <span className="flex-grow-1 fw-medium">{field.name}</span>
            <Badge bg="outline-secondary" className="border text-dark">
              {field.fieldType}
            </Badge>
            {field.isSystem && (
              <Badge bg="warning" text="dark">
                {t('globalSettings.system')}
              </Badge>
            )}
            {!field.isSystem && (
              <Button
                variant="outline-danger"
                size="sm"
                onClick={() => setFields((prev) => prev.filter((f) => f.id !== field.id))}
              >
                <i className="bi bi-trash" />
              </Button>
            )}
          </div>
        ))}
        {filteredFields.length === 0 && <div className="text-muted text-center py-3">{t('common.noResults')}</div>}
      </div>

      {/* Add Custom Field */}
      {!showingNewField ? (
        <Button variant="outline-primary" size="sm" onClick={() => setShowingNewField(true)}>
          <i className="bi bi-plus me-1" />
          {t('globalSettings.addCustomField')}
        </Button>
      ) : (
        <div className="border rounded p-3 bg-light">
          <div className="d-flex gap-2 flex-wrap mb-2">
            <Form.Group>
              <Form.Label className="small mb-1">{t('common.name')}</Form.Label>
              <Form.Control
                type="text"
                size="sm"
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                style={{ width: 160 }}
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small mb-1">{t('globalSettings.fieldType')}</Form.Label>
              <Form.Select
                size="sm"
                value={newFieldType}
                onChange={(e) => setNewFieldType(e.target.value as FieldType)}
                style={{ width: 140 }}
              >
                {FIELD_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {ft}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label className="small mb-1">{t('globalSettings.category')}</Form.Label>
              <Form.Select
                size="sm"
                value={newFieldCategory}
                onChange={(e) => setNewFieldCategory(e.target.value as FieldCategory)}
                style={{ width: 140 }}
              >
                {FIELD_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {t(`globalSettings.fieldCategories.${cat}`)}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </div>
          {['select', 'multi_select'].includes(newFieldType) && (
            <Form.Group className="mb-2">
              <Form.Label className="small mb-1">{t('globalSettings.options')}</Form.Label>
              <Form.Control
                type="text"
                size="sm"
                placeholder={t('globalSettings.optionsHelp')}
                value={newFieldOptions}
                onChange={(e) => setNewFieldOptions(e.target.value)}
              />
            </Form.Group>
          )}
          <div className="d-flex gap-2">
            <Button variant="primary" size="sm" onClick={handleAddCustomField} disabled={!newFieldName.trim()}>
              {t('common.add')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowingNewField(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

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
        {/* Lifecycle Stages Section */}
        <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
          <div className="d-flex align-items-center justify-content-between mb-3">
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
              const colorHex = getColorForPosition(stage.colorPosition);
              const textColor = getContrastTextColor(colorHex);

              return (
                <div key={stage.id} className="d-flex align-items-center gap-3 p-2 bg-light rounded border">
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
                        if (updated.useAutoColors !== false) {
                          const positions = calculateAutoColorPositions(stages.length).reverse();
                          stages.forEach((s, idx) => (s.colorPosition = positions[idx]));
                        }
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
                        if (updated.useAutoColors !== false) {
                          const positions = calculateAutoColorPositions(stages.length).reverse();
                          stages.forEach((s, idx) => (s.colorPosition = positions[idx]));
                        }
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
                        setLifecycleStageForm({ name: stage.name, colorPosition: stage.colorPosition });
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
                          alert('Cannot delete the last lifecycle stage.');
                          return;
                        }
                        const updated = structuredClone(crmConfig);
                        updated.lifecycleStages = updated.lifecycleStages.filter((s) => s.id !== stage.id);
                        if (updated.useAutoColors !== false) {
                          const positions = calculateAutoColorPositions(updated.lifecycleStages.length).reverse();
                          updated.lifecycleStages.forEach((s, idx) => (s.colorPosition = positions[idx]));
                        }
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
          <div className="d-flex align-items-center justify-content-between mb-3">
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
              <div key={flag.id} className="d-flex align-items-center gap-3 p-2 bg-light rounded border">
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
          <div className="d-flex align-items-center justify-content-between mb-3">
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
          <div className="d-flex align-items-center justify-content-between mb-3">
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
              label={<span className="text-muted small">Auto-assign colors based on stage order</span>}
            />
          </div>

          <div className="d-flex flex-column gap-2">
            {(supplierConfig.lifecycleStages || []).map((stage, index, arr) => {
              const colorHex = getColorForPosition(stage.colorPosition);
              const textColor = getContrastTextColor(colorHex);

              return (
                <div key={stage.id} className="d-flex align-items-center gap-3 p-2 bg-light rounded border">
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
                        if (updated.useAutoColors !== false) {
                          const positions = calculateAutoColorPositions(stages.length);
                          stages.forEach((s, idx) => (s.colorPosition = positions[idx]));
                        }
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
                        if (updated.useAutoColors !== false) {
                          const positions = calculateAutoColorPositions(stages.length);
                          stages.forEach((s, idx) => (s.colorPosition = positions[idx]));
                        }
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
                        setSupplierLifecycleStageForm({ name: stage.name, colorPosition: stage.colorPosition });
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
                          alert('Cannot delete the last lifecycle stage.');
                          return;
                        }
                        const updated = structuredClone(supplierConfig);
                        updated.lifecycleStages = updated.lifecycleStages.filter((s) => s.id !== stage.id);
                        if (updated.useAutoColors !== false) {
                          const positions = calculateAutoColorPositions(updated.lifecycleStages.length);
                          updated.lifecycleStages.forEach((s, idx) => (s.colorPosition = positions[idx]));
                        }
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
          <div className="d-flex align-items-center justify-content-between mb-3">
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
              <div key={flag.id} className="d-flex align-items-center gap-3 p-2 bg-light rounded border">
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
          <div className="d-flex align-items-center justify-content-between mb-3">
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
        <Table size="sm" hover>
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
        <Table size="sm" hover>
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

  // ── Tab 10: Teams ────────────────────────────────────────────────────────
  const renderTeamsTab = () => (
    <div>
      <div className="alert alert-info mb-3">
        <i className="bi bi-info-circle me-2" />
        {t('globalSettings.teamsInfo')}
      </div>
      {teams.length === 0 ? (
        <div className="text-center py-4 text-muted">{t('teams.noTeams')}</div>
      ) : (
        <Table size="sm" hover>
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('common.color')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
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
                        title: t('globalSettings.deleteTeamTitle'),
                        message: t('globalSettings.deleteTeamMessage', { name: team.name }),
                        onConfirm: () => {
                          handleDeleteTeam(team.id);
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
      <Table size="sm" hover>
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

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <>
      <Modal show={show} onHide={onHide} size="xl" centered>
        <Modal.Header closeButton>
          <Modal.Title>{t('settings.title')}</Modal.Title>
        </Modal.Header>

        <Modal.Body style={{ minHeight: 500 }}>
          {error && <div className="alert alert-danger mb-3">{error}</div>}

          <Tab.Container defaultActiveKey={defaultTab ?? 'projects'}>
            <div className="d-flex" style={{ minHeight: 460 }}>
              {/* Vertical Nav */}
              <Nav variant="pills" className="flex-column flex-shrink-0 me-3 border-end pe-3" style={{ minWidth: 160 }}>
                <Nav.Item>
                  <Nav.Link eventKey="projects">{t('settings.projects')}</Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="staff">{t('settings.staff')}</Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="ticketTypes">{t('settings.ticketTypes')}</Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="statuses">{t('settings.statuses')}</Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="fields">{t('settings.fields')}</Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="crmConfig">{t('settings.crmConfig')}</Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="supplierConfig">{t('settings.supplierConfig')}</Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="customers">{t('settings.customers')}</Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="suppliersList">{t('settings.suppliersList')}</Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="teams">{t('settings.teams')}</Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="linkConfig">{t('settings.linkConfig')}</Nav.Link>
                </Nav.Item>
              </Nav>

              {/* Tab Content */}
              <Tab.Content className="flex-grow-1 overflow-auto" style={{ maxHeight: 460 }}>
                <Tab.Pane eventKey="projects">{renderProjectsTab()}</Tab.Pane>
                <Tab.Pane eventKey="staff">{renderStaffTab()}</Tab.Pane>
                <Tab.Pane eventKey="ticketTypes">{renderTicketTypesTab()}</Tab.Pane>
                <Tab.Pane eventKey="statuses">{renderStatusesTab()}</Tab.Pane>
                <Tab.Pane eventKey="fields">{renderFieldsTab()}</Tab.Pane>
                <Tab.Pane eventKey="crmConfig">{renderCrmConfigTab()}</Tab.Pane>
                <Tab.Pane eventKey="supplierConfig">{renderSupplierConfigTab()}</Tab.Pane>
                <Tab.Pane eventKey="customers">{renderCustomersTab()}</Tab.Pane>
                <Tab.Pane eventKey="suppliersList">{renderSuppliersTab()}</Tab.Pane>
                <Tab.Pane eventKey="teams">{renderTeamsTab()}</Tab.Pane>
                <Tab.Pane eventKey="linkConfig">{renderLinkConfigTab()}</Tab.Pane>
              </Tab.Content>
            </div>
          </Tab.Container>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={onHide}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={saving} onClick={handleSave}>
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
                const isSelected = lifecycleStageForm.colorPosition === pos;
                return (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => setLifecycleStageForm({ ...lifecycleStageForm, colorPosition: pos })}
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
            <div className="text-muted small mt-2">1 = Critical (red) → 10 = Minimal (green)</div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowLifecycleStageModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!lifecycleStageForm.name.trim()) return alert('Please enter a stage name');
              const updated = structuredClone(crmConfig);
              if (editingLifecycleStage) {
                const stage = updated.lifecycleStages.find((s) => s.id === editingLifecycleStage.id);
                if (stage) {
                  stage.name = lifecycleStageForm.name.trim();
                  // only manually set colorPosition if we aren't using auto colors
                  if (updated.useAutoColors === false) {
                    stage.colorPosition = lifecycleStageForm.colorPosition;
                  }
                }
              } else {
                updated.lifecycleStages.push({
                  id: generateId(),
                  name: lifecycleStageForm.name.trim(),
                  colorPosition: lifecycleStageForm.colorPosition,
                });
              }
              if (updated.useAutoColors !== false) {
                const positions = calculateAutoColorPositions(updated.lifecycleStages.length).reverse();
                updated.lifecycleStages.forEach((s, idx) => (s.colorPosition = positions[idx]));
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
            <div className="d-flex flex-wrap gap-2">
              {[
                { hex: '#F59E0B', name: 'Amber' },
                { hex: '#8B5CF6', name: 'Purple' },
                { hex: '#EF4444', name: 'Red' },
                { hex: '#10B981', name: 'Green' },
                { hex: '#3B82F6', name: 'Blue' },
                { hex: '#EC4899', name: 'Pink' },
                { hex: '#6366F1', name: 'Indigo' },
                { hex: '#14B8A6', name: 'Teal' },
              ].map((color) => (
                <button
                  key={color.hex}
                  type="button"
                  onClick={() => setFlagForm({ ...flagForm, color: color.hex })}
                  className="rounded border"
                  title={color.name}
                  style={{
                    width: 44,
                    height: 44,
                    backgroundColor: color.hex,
                    outline: flagForm.color === color.hex ? '3px solid #333' : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowFlagModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!flagForm.name.trim()) return alert('Please enter a flag name');
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
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowDocTypeModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!docTypeForm.name.trim()) return alert('Please enter a document type name');
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
                const isSelected = supplierLifecycleStageForm.colorPosition === pos;
                return (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => setSupplierLifecycleStageForm({ ...supplierLifecycleStageForm, colorPosition: pos })}
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
            <div className="text-muted small mt-2">1 = Critical (red) → 10 = Minimal (green)</div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowSupplierLifecycleStageModal(false)}>
            Cancel
          </Button>
          <Button
            className="border-0 text-white"
            style={{ backgroundColor: '#14b8a6' }}
            onClick={() => {
              if (!supplierLifecycleStageForm.name.trim()) return alert('Please enter a stage name');
              const updated = structuredClone(supplierConfig);
              if (editingSupplierLifecycleStage) {
                const stage = updated.lifecycleStages.find((s) => s.id === editingSupplierLifecycleStage.id);
                if (stage) {
                  stage.name = supplierLifecycleStageForm.name.trim();
                  // only manually set colorPosition if we aren't using auto colors
                  if (updated.useAutoColors === false) {
                    stage.colorPosition = supplierLifecycleStageForm.colorPosition;
                  }
                }
              } else {
                updated.lifecycleStages.push({
                  id: generateId(),
                  name: supplierLifecycleStageForm.name.trim(),
                  colorPosition: supplierLifecycleStageForm.colorPosition,
                });
              }
              if (updated.useAutoColors !== false) {
                const positions = calculateAutoColorPositions(updated.lifecycleStages.length);
                updated.lifecycleStages.forEach((s, idx) => (s.colorPosition = positions[idx]));
              }
              setSupplierConfig(updated);
              setShowSupplierLifecycleStageModal(false);
            }}
          >
            {editingSupplierLifecycleStage ? 'Save' : 'Add Stage'}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showSupplierFlagModal} onHide={() => setShowSupplierFlagModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ color: '#14b8a6' }}>
            {editingSupplierFlag ? 'Edit Supplier Flag' : 'Add Supplier Flag'}
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
            <div className="d-flex flex-wrap gap-2">
              {[
                { hex: '#14B8A6', name: 'Teal' },
                { hex: '#F59E0B', name: 'Amber' },
                { hex: '#10B981', name: 'Green' },
                { hex: '#8B5CF6', name: 'Purple' },
                { hex: '#3B82F6', name: 'Blue' },
                { hex: '#EF4444', name: 'Red' },
                { hex: '#EC4899', name: 'Pink' },
                { hex: '#6366F1', name: 'Indigo' },
              ].map((color) => (
                <button
                  key={color.hex}
                  type="button"
                  onClick={() => setSupplierFlagForm({ ...supplierFlagForm, color: color.hex })}
                  className="rounded border"
                  title={color.name}
                  style={{
                    width: 44,
                    height: 44,
                    backgroundColor: color.hex,
                    outline: supplierFlagForm.color === color.hex ? '3px solid #333' : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowSupplierFlagModal(false)}>
            Cancel
          </Button>
          <Button
            className="border-0 text-white"
            style={{ backgroundColor: '#14b8a6' }}
            onClick={() => {
              if (!supplierFlagForm.name.trim()) return alert('Please enter a flag name');
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
            {editingSupplierFlag ? 'Save' : 'Add Flag'}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showSupplierDocTypeModal} onHide={() => setShowSupplierDocTypeModal(false)} centered size="sm">
        <Modal.Header closeButton>
          <Modal.Title className="fs-6" style={{ color: '#14b8a6' }}>
            {editingSupplierDocType ? 'Edit Document Type' : 'Add Document Type'}
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
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowSupplierDocTypeModal(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="border-0 text-white"
            style={{ backgroundColor: '#14b8a6' }}
            onClick={() => {
              if (!supplierDocTypeForm.name.trim()) return alert('Please enter a document type name');
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

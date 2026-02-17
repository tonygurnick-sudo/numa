import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal, Button, Form, Nav, Tab, Table, Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { getColorForPosition, getContrastTextColor, getStatusTypeColor, BOARD_COLORS } from '../Shared/colorUtils';
import { STATUS_TYPE_TO_ZONES } from '../../../constants/opsConstants';
import { ConfirmModal } from './ConfirmModal';
import { CustomerDetailModal } from './CustomerDetailModal';
import { SupplierDetailModal } from './SupplierDetailModal';
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

// ─── Doc Type Adder Sub-Component ───────────────────────────────────────────

function DocTypeAdder({
  onAdd,
  placeholder,
}: {
  onAdd: (name: string) => void;
  placeholder: string;
}): React.JSX.Element {
  const [newItem, setNewItem] = useState('');

  const handleAdd = () => {
    const trimmed = newItem.trim();
    if (trimmed) {
      onAdd(trimmed);
      setNewItem('');
    }
  };

  return (
    <div className="d-flex gap-2">
      <Form.Control
        type="text"
        size="sm"
        placeholder={placeholder}
        value={newItem}
        onChange={(e) => setNewItem(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
          }
        }}
        style={{ maxWidth: 200 }}
      />
      <Button variant="outline-secondary" size="sm" onClick={handleAdd} disabled={!newItem.trim()}>
        <i className="bi bi-plus" />
      </Button>
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
  const { numaGet, numaPost, numaDelete } = useNumaRequest();
  const { config, teams, refreshTeams } = useOps();

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
            <th>{t('common.name')}</th>
            <th>{t('contacts.email')}</th>
            <th>{t('globalSettings.role')}</th>
            <th>{t('globalSettings.active')}</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((person) => (
            <tr key={person.id}>
              <td>{person.name}</td>
              <td>{person.email}</td>
              <td>{person.role}</td>
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
    <div>
      {/* Lifecycle Stages */}
      <h6 className="mb-2">{t('globalSettings.lifecycleStages')}</h6>
      <div className="mb-4">
        {crmConfig.lifecycleStages.map((stage, idx) => {
          const stageColor = getColorForPosition(stage.colorPosition);
          return (
            <div key={stage.id} className="d-flex align-items-center gap-2 mb-2">
              <span
                className="d-inline-block rounded flex-shrink-0"
                style={{ width: 16, height: 16, backgroundColor: stageColor }}
              />
              <Form.Control
                type="text"
                size="sm"
                value={stage.name}
                onChange={(e) => {
                  const updated = structuredClone(crmConfig);
                  updated.lifecycleStages[idx].name = e.target.value;
                  setCrmConfig(updated);
                }}
                style={{ maxWidth: 200 }}
              />
              <Button
                variant="link"
                size="sm"
                className="text-muted p-0"
                disabled={idx === 0}
                onClick={() => {
                  const updated = structuredClone(crmConfig);
                  const stages = updated.lifecycleStages;
                  [stages[idx - 1], stages[idx]] = [stages[idx], stages[idx - 1]];
                  // Recompute color positions
                  stages.forEach((s, i) => {
                    s.colorPosition = stages.length <= 1 ? 1 : Math.round(1 + (i / (stages.length - 1)) * 9);
                  });
                  setCrmConfig(updated);
                }}
              >
                <i className="bi bi-arrow-up" />
              </Button>
              <Button
                variant="link"
                size="sm"
                className="text-muted p-0"
                disabled={idx === crmConfig.lifecycleStages.length - 1}
                onClick={() => {
                  const updated = structuredClone(crmConfig);
                  const stages = updated.lifecycleStages;
                  [stages[idx], stages[idx + 1]] = [stages[idx + 1], stages[idx]];
                  stages.forEach((s, i) => {
                    s.colorPosition = stages.length <= 1 ? 1 : Math.round(1 + (i / (stages.length - 1)) * 9);
                  });
                  setCrmConfig(updated);
                }}
              >
                <i className="bi bi-arrow-down" />
              </Button>
              <Button
                variant="outline-danger"
                size="sm"
                onClick={() => {
                  const updated = structuredClone(crmConfig);
                  updated.lifecycleStages = updated.lifecycleStages.filter((_, i) => i !== idx);
                  updated.lifecycleStages.forEach((s, i) => {
                    s.colorPosition =
                      updated.lifecycleStages.length <= 1
                        ? 1
                        : Math.round(1 + (i / (updated.lifecycleStages.length - 1)) * 9);
                  });
                  setCrmConfig(updated);
                }}
              >
                <i className="bi bi-trash" />
              </Button>
            </div>
          );
        })}
        <Button
          variant="outline-primary"
          size="sm"
          onClick={() => {
            const updated = structuredClone(crmConfig);
            const len = updated.lifecycleStages.length;
            updated.lifecycleStages.push({
              id: generateId(),
              name: '',
              colorPosition: len === 0 ? 1 : Math.round(1 + (len / len) * 9),
            });
            // Recompute
            updated.lifecycleStages.forEach((s, i) => {
              s.colorPosition =
                updated.lifecycleStages.length <= 1
                  ? 1
                  : Math.round(1 + (i / (updated.lifecycleStages.length - 1)) * 9);
            });
            setCrmConfig(updated);
          }}
        >
          <i className="bi bi-plus me-1" />
          {t('common.add')}
        </Button>
      </div>

      {/* Customer Flags */}
      <h6 className="mb-2">{t('globalSettings.customerFlags')}</h6>
      <div className="mb-4">
        <Table size="sm" className="mb-2">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('globalSettings.icon')}</th>
              <th>{t('common.color')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {crmConfig.customerFlags.map((flag, idx) => (
              <tr key={flag.id}>
                <td>
                  <Form.Control
                    type="text"
                    size="sm"
                    value={flag.name}
                    onChange={(e) => {
                      const updated = structuredClone(crmConfig);
                      updated.customerFlags[idx].name = e.target.value;
                      setCrmConfig(updated);
                    }}
                  />
                </td>
                <td>
                  <Form.Control
                    type="text"
                    size="sm"
                    style={{ width: 50 }}
                    value={flag.icon ?? ''}
                    onChange={(e) => {
                      const updated = structuredClone(crmConfig);
                      updated.customerFlags[idx].icon = e.target.value;
                      setCrmConfig(updated);
                    }}
                  />
                </td>
                <td>
                  <div className="d-flex gap-1">
                    {BOARD_COLORS.slice(0, 6).map((c) => (
                      <ColorSwatch
                        key={c}
                        color={c}
                        selected={flag.color === c}
                        onSelect={(color) => {
                          const updated = structuredClone(crmConfig);
                          updated.customerFlags[idx].color = color;
                          setCrmConfig(updated);
                        }}
                      />
                    ))}
                  </div>
                </td>
                <td>
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => {
                      const updated = structuredClone(crmConfig);
                      updated.customerFlags = updated.customerFlags.filter((_, i) => i !== idx);
                      setCrmConfig(updated);
                    }}
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
          onClick={() => {
            const updated = structuredClone(crmConfig);
            updated.customerFlags.push({
              id: generateId(),
              name: '',
              icon: '',
              color: BOARD_COLORS[updated.customerFlags.length % BOARD_COLORS.length],
            });
            setCrmConfig(updated);
          }}
        >
          <i className="bi bi-plus me-1" />
          {t('common.add')}
        </Button>
      </div>

      {/* Document Types */}
      <h6 className="mb-2">{t('globalSettings.documentTypes')}</h6>
      <div className="mb-4">
        <div className="d-flex flex-wrap gap-1 mb-2">
          {crmConfig.documentTypes.map((dt) => (
            <Badge
              key={dt.id}
              bg="secondary"
              className="d-flex align-items-center gap-1 py-1 px-2"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                const updated = structuredClone(crmConfig);
                updated.documentTypes = updated.documentTypes.filter((d) => d.id !== dt.id);
                setCrmConfig(updated);
              }}
            >
              {dt.name}
              <i className="bi bi-x" />
            </Badge>
          ))}
        </div>
        <DocTypeAdder
          onAdd={(name) => {
            const updated = structuredClone(crmConfig);
            updated.documentTypes = [...updated.documentTypes, { id: `doctype-${generateId()}`, name }];
            setCrmConfig(updated);
          }}
          placeholder={t('globalSettings.addItem')}
        />
      </div>

      {/* Territories */}
      <h6 className="mb-2">{t('globalSettings.territories')}</h6>
      <div className="mb-4">
        <TagList
          items={crmConfig.territories}
          onChange={(items) => {
            const updated = structuredClone(crmConfig);
            updated.territories = items;
            setCrmConfig(updated);
          }}
          placeholder={t('globalSettings.addItem')}
        />
      </div>

      {/* Industries */}
      <h6 className="mb-2">{t('globalSettings.industries')}</h6>
      <div className="mb-4">
        <TagList
          items={crmConfig.industries}
          onChange={(items) => {
            const updated = structuredClone(crmConfig);
            updated.industries = items;
            setCrmConfig(updated);
          }}
          placeholder={t('globalSettings.addItem')}
        />
      </div>
    </div>
  );

  // ── Tab 7: Supplier Config ─────────────────────────────────────────────────
  const renderSupplierConfigTab = () => (
    <div>
      {/* Supplier Lifecycle Stages */}
      <h6 className="mb-2" style={{ color: '#14b8a6' }}>
        {t('globalSettings.supplierLifecycleStages')}
      </h6>
      <div className="mb-4">
        {supplierConfig.lifecycleStages.map((stage, idx) => {
          const stageColor = getColorForPosition(stage.colorPosition);
          return (
            <div key={stage.id} className="d-flex align-items-center gap-2 mb-2">
              <span
                className="d-inline-block rounded flex-shrink-0"
                style={{ width: 16, height: 16, backgroundColor: stageColor }}
              />
              <Form.Control
                type="text"
                size="sm"
                value={stage.name}
                onChange={(e) => {
                  const updated = structuredClone(supplierConfig);
                  updated.lifecycleStages[idx].name = e.target.value;
                  setSupplierConfig(updated);
                }}
                style={{ maxWidth: 200 }}
              />
              <Button
                variant="link"
                size="sm"
                className="text-muted p-0"
                disabled={idx === 0}
                onClick={() => {
                  const updated = structuredClone(supplierConfig);
                  const stages = updated.lifecycleStages;
                  [stages[idx - 1], stages[idx]] = [stages[idx], stages[idx - 1]];
                  stages.forEach((s, i) => {
                    s.colorPosition = stages.length <= 1 ? 1 : Math.round(1 + (i / (stages.length - 1)) * 9);
                  });
                  setSupplierConfig(updated);
                }}
              >
                <i className="bi bi-arrow-up" />
              </Button>
              <Button
                variant="link"
                size="sm"
                className="text-muted p-0"
                disabled={idx === supplierConfig.lifecycleStages.length - 1}
                onClick={() => {
                  const updated = structuredClone(supplierConfig);
                  const stages = updated.lifecycleStages;
                  [stages[idx], stages[idx + 1]] = [stages[idx + 1], stages[idx]];
                  stages.forEach((s, i) => {
                    s.colorPosition = stages.length <= 1 ? 1 : Math.round(1 + (i / (stages.length - 1)) * 9);
                  });
                  setSupplierConfig(updated);
                }}
              >
                <i className="bi bi-arrow-down" />
              </Button>
              <Button
                variant="outline-danger"
                size="sm"
                onClick={() => {
                  const updated = structuredClone(supplierConfig);
                  updated.lifecycleStages = updated.lifecycleStages.filter((_, i) => i !== idx);
                  updated.lifecycleStages.forEach((s, i) => {
                    s.colorPosition =
                      updated.lifecycleStages.length <= 1
                        ? 1
                        : Math.round(1 + (i / (updated.lifecycleStages.length - 1)) * 9);
                  });
                  setSupplierConfig(updated);
                }}
              >
                <i className="bi bi-trash" />
              </Button>
            </div>
          );
        })}
        <Button
          variant="outline-primary"
          size="sm"
          onClick={() => {
            const updated = structuredClone(supplierConfig);
            const len = updated.lifecycleStages.length;
            updated.lifecycleStages.push({
              id: generateId(),
              name: '',
              colorPosition: len === 0 ? 1 : Math.round(1 + (len / len) * 9),
            });
            updated.lifecycleStages.forEach((s, i) => {
              s.colorPosition =
                updated.lifecycleStages.length <= 1
                  ? 1
                  : Math.round(1 + (i / (updated.lifecycleStages.length - 1)) * 9);
            });
            setSupplierConfig(updated);
          }}
        >
          <i className="bi bi-plus me-1" />
          {t('common.add')}
        </Button>
      </div>

      {/* Supplier Flags */}
      <h6 className="mb-2" style={{ color: '#14b8a6' }}>
        {t('globalSettings.supplierFlags')}
      </h6>
      <div className="mb-4">
        <Table size="sm" className="mb-2">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('globalSettings.icon')}</th>
              <th>{t('common.color')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {supplierConfig.supplierFlags.map((flag, idx) => (
              <tr key={flag.id}>
                <td>
                  <Form.Control
                    type="text"
                    size="sm"
                    value={flag.name}
                    onChange={(e) => {
                      const updated = structuredClone(supplierConfig);
                      updated.supplierFlags[idx].name = e.target.value;
                      setSupplierConfig(updated);
                    }}
                  />
                </td>
                <td>
                  <Form.Control
                    type="text"
                    size="sm"
                    style={{ width: 50 }}
                    value={flag.icon ?? ''}
                    onChange={(e) => {
                      const updated = structuredClone(supplierConfig);
                      updated.supplierFlags[idx].icon = e.target.value;
                      setSupplierConfig(updated);
                    }}
                  />
                </td>
                <td>
                  <div className="d-flex gap-1">
                    {BOARD_COLORS.slice(0, 6).map((c) => (
                      <ColorSwatch
                        key={c}
                        color={c}
                        selected={flag.color === c}
                        onSelect={(color) => {
                          const updated = structuredClone(supplierConfig);
                          updated.supplierFlags[idx].color = color;
                          setSupplierConfig(updated);
                        }}
                      />
                    ))}
                  </div>
                </td>
                <td>
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => {
                      const updated = structuredClone(supplierConfig);
                      updated.supplierFlags = updated.supplierFlags.filter((_, i) => i !== idx);
                      setSupplierConfig(updated);
                    }}
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
          onClick={() => {
            const updated = structuredClone(supplierConfig);
            updated.supplierFlags.push({
              id: generateId(),
              name: '',
              icon: '',
              color: BOARD_COLORS[updated.supplierFlags.length % BOARD_COLORS.length],
            });
            setSupplierConfig(updated);
          }}
        >
          <i className="bi bi-plus me-1" />
          {t('common.add')}
        </Button>
      </div>

      {/* Supplier Document Types */}
      <h6 className="mb-2" style={{ color: '#14b8a6' }}>
        {t('globalSettings.supplierDocumentTypes')}
      </h6>
      <div className="mb-4">
        <div className="d-flex flex-wrap gap-1 mb-2">
          {supplierConfig.documentTypes.map((dt) => (
            <Badge
              key={dt.id}
              bg="secondary"
              className="d-flex align-items-center gap-1 py-1 px-2"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                const updated = structuredClone(supplierConfig);
                updated.documentTypes = updated.documentTypes.filter((d) => d.id !== dt.id);
                setSupplierConfig(updated);
              }}
            >
              {dt.name}
              <i className="bi bi-x" />
            </Badge>
          ))}
        </div>
        <DocTypeAdder
          onAdd={(name) => {
            const updated = structuredClone(supplierConfig);
            updated.documentTypes = [...updated.documentTypes, { id: `sup-doc-${generateId()}`, name }];
            setSupplierConfig(updated);
          }}
          placeholder={t('globalSettings.addItem')}
        />
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

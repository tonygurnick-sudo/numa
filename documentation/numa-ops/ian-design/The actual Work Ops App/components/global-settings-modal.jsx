/**
 * Global Settings Modal Component
 * Extracted from app.jsx in v089
 *
 * Manages global company settings across 10 tabs:
 * - Projects, Staff, CRM, CRM Config, Suppliers, Supplier Config, Ticket Types, Prefixes, Fields, Statuses
 *
 * Version: v187a
 *
 * v187a Changes:
 * - UNIFIED ENTITY EDITING: Detail Modals used everywhere
 *   - REMOVED: CustomerModal, SupplierModal props and renders
 *   - REMOVED: showCustomerModal, showSupplierModal state
 *   - REMOVED: editingCustomer, editingSupplier state
 *   - REMOVED: customerFormData, supplierFormData state
 *   - REMOVED: handleSaveCustomer, handleSaveSupplier functions
 *   - NEW: onOpenCustomerDetail prop for opening Detail Modal
 *   - NEW: onCreateCustomer, onCreateSupplier props for creating new entities
 *   - Customer row click → opens Detail Modal via onOpenCustomerDetail
 *   - Supplier row click → opens Detail Modal (already worked via onOpenSupplierDetail)
 *   - Edit button → opens Detail Modal
 *   - "New" button → calls onCreate* which creates entity and opens Detail Modal
 *
 * v183b Changes:
 * - REFACTOR: Supplier Add/Edit now uses proper modal (SupplierModal) matching CustomerModal pattern
 *   - Removed inline form from Suppliers tab header
 *   - Added SupplierModal prop (passed from app.jsx)
 *   - Renamed showSupplierForm to showSupplierModal for consistency
 *   - Added handleSaveSupplier function parallel to handleSaveCustomer
 *   - SupplierModal rendered at bottom of component (same pattern as CustomerModal)
 *
 * v182c Changes:
 * - BUG FIX: Expanded Supplier Add/Edit form to include all fields
 *   - Added: Website, Company Size, Supplier Type, Territory
 *   - Added: Relationship Owner, Annual Spend, Payment Terms
 *   - Added: Contract Start/End dates, Products/Services, Service Notes, Flags
 *   - Form now displays in sections for better organisation
 *
 * v181a Changes:
 * - SUPPLIER MANAGEMENT Session 2: Added Supplier Config tab
 * - NEW tab: Supplier Config (parallel to CRM Config)
 *   - Supplier lifecycle stages with color picker and reorder
 *   - Supplier flags management (icon + color)
 *   - Supplier document types management
 * - NEW state: showSupplierLifecycleStageModal, supplierLifecycleStageForm
 * - NEW state: showSupplierFlagModal, supplierFlagForm
 * - NEW state: showSupplierDocTypeModal, supplierDocTypeForm
 * - NEW state: editingSupplierLifecycleStage, editingSupplierFlag, editingSupplierDocType
 * - NEW prop: onOpenSupplierDetail for opening Supplier Detail Modal
 * - Suppliers tab: Click supplier row to open detail modal
 * - Teal colour scheme for all supplier-related UI
 *
 * v180a Changes:
 * - SUPPLIER MANAGEMENT Session 1: Added Suppliers tab (list view with CRUD)
 * - NEW prop: onDeleteSupplier for supplier deletion with confirmation
 * - State: editingSupplier, supplierForm, showSupplierForm
 * - Suppliers tab mirrors CRM tab structure with teal colour scheme
 *
 * v172c Changes:
 * - BUG-171-004 FIX: Lifecycle stage reorder arrows now work correctly
 *   - Stages without order property get assigned sequential orders before swap
 *   - Previously swapping undefined values resulted in no change
 *
 * v171b Changes:
 * - CRM lifecycle stages now use REVERSED color scale (grey→red not red→grey)
 *   First stage = grey (10), last stage = red (1) - matches CRM semantics
 * - Customer list now displays stage NAME with color (not raw stage ID)
 *
 * v171a Changes:
 * - Pass company prop to CustomerModal for crmConfig/globalStaff access
 * - Update customerFormData initial state to include new CRM fields
 * - BUG-170-002 FIX: Position circles now correctly show colors (fixed fallback logic)
 *
 * v168a Changes:
 * - CRM PHASE 1: Added CRM Config tab for lifecycle stages, flags, document types
 *   - LifecycleStageEditor with 10-point color scale preview
 *   - CustomerFlagsEditor with icon and color picker
 *   - DocumentTypesEditor for simple list management
 *   - Auto-color toggle for lifecycle stages
 *   - Drag/arrow reorder for stages
 *
 * v153 Changes:
 * - Added component version registry support
 *
 * v145 Changes:
 * - Updated Status Management to 6-type model (backlog, scoped, queued, active, completed, ended)
 *
 * v094 Changes:
 * - BUG-090-003: Fixed button-in-button warning in custom category headers
 *   Changed outer <button> to <div> with cursor-pointer
 */

(function () {
  'use strict';

  // v187a: Component version for registry
  const COMPONENT_VERSION = 'v187a';

  const { useState } = React;

  const GlobalSettingsModal = ({
    company,
    setCompany,
    tickets,
    activeTab,
    setActiveTab,
    onClose,
    TicketTypeModal,
    // v187a: Removed CustomerModal, SupplierModal - using Detail Modals everywhere
    CategoryModal,
    CustomFieldModal,
    onDeleteSupplier, // v180a: Supplier Management
    onOpenSupplierDetail, // v181a: Opens Supplier Detail Modal
    onOpenCustomerDetail, // v187a: Opens Customer Detail Modal
    onCreateCustomer, // v187a: Creates new customer and opens Detail Modal
    onCreateSupplier, // v187a: Creates new supplier and opens Detail Modal
  }) => {
    // Get dependencies at render time (Babel async loading)
    const { Plus, Edit2, Trash2 } = window.Icons || {};
    const ConfirmationModal = window.Components?.ConfirmModals?.ConfirmationModal;
    const PREDEFINED_STATUS_LABELS = window.Domain?.Statuses?.PREDEFINED_STATUS_LABELS || {};

    const [editingProject, setEditingProject] = useState(null);
    const [editingStaff, setEditingStaff] = useState(null);
    // v187a: Removed editingCustomer, customerFormData, showCustomerModal - using Detail Modal
    const [editingTicketType, setEditingTicketType] = useState(null);
    const [showNewTicketTypeModal, setShowNewTicketTypeModal] = useState(false);
    const [projectForm, setProjectForm] = useState({
      name: '',
      description: '',
      status: 'Active',
      clients: [],
      owner: '',
    });
    const [staffForm, setStaffForm] = useState({ name: '', role: '', email: '', active: true });

    // v187a: Removed supplier modal state - using Detail Modal everywhere

    // v181a: Supplier Config Management state (separate from CRM Config state)
    const [editingSupplierLifecycleStage, setEditingSupplierLifecycleStage] = useState(null);
    const [supplierLifecycleStageForm, setSupplierLifecycleStageForm] = useState({ name: '', colorPosition: 6 });
    const [showSupplierLifecycleStageModal, setShowSupplierLifecycleStageModal] = useState(false);
    const [editingSupplierFlag, setEditingSupplierFlag] = useState(null);
    const [supplierFlagForm, setSupplierFlagForm] = useState({ name: '', icon: '⭐', color: '#14B8A6' });
    const [showSupplierFlagModal, setShowSupplierFlagModal] = useState(false);
    const [editingSupplierDocType, setEditingSupplierDocType] = useState(null);
    const [supplierDocTypeForm, setSupplierDocTypeForm] = useState({ name: '' });
    const [showSupplierDocTypeModal, setShowSupplierDocTypeModal] = useState(false);

    const [showConfirmation, setShowConfirmation] = useState(false);
    const [confirmationConfig, setConfirmationConfig] = useState(null);
    const [expandedCategories, setExpandedCategories] = useState({
      common: false,
      development: false,
      callCentre: false,
      crm: false,
      operations: false,
    });
    const [editingField, setEditingField] = useState(null);
    const [showFieldModal, setShowFieldModal] = useState(false);
    // Use pre-normalized FIELD_LIBRARY from window (loaded at render time)
    const [fieldLibrary, setFieldLibrary] = useState(() => ({ ...(window.FIELD_LIBRARY_NORMALIZED || {}) }));

    // Custom Category Management
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [editingCategory, setEditingCategory] = useState(null);
    const [categoryForm, setCategoryForm] = useState({ name: '', description: '', icon: '' });

    // Custom Field Management
    const [showCustomFieldModal, setShowCustomFieldModal] = useState(false);
    const [editingCustomField, setEditingCustomField] = useState(null);
    const [customFieldForm, setCustomFieldForm] = useState({
      label: '',
      category: '',
      type: 'text',
      required: false,
      defaultValue: '',
      placeholder: '',
      icon: '',
      helpText: '',
      options: [],
      min: '',
      max: '',
      rows: 3,
    });

    // Form visibility toggles
    const [showProjectForm, setShowProjectForm] = useState(false);
    const [showStaffForm, setShowStaffForm] = useState(false);

    // Status Management (Phase 2)
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [editingStatus, setEditingStatus] = useState(null);
    const [statusForm, setStatusForm] = useState({ label: '', type: 'active' });

    // v168a: CRM Config Management (Phase 1)
    const [editingLifecycleStage, setEditingLifecycleStage] = useState(null);
    const [lifecycleStageForm, setLifecycleStageForm] = useState({ name: '', colorPosition: 6 });
    const [showLifecycleStageModal, setShowLifecycleStageModal] = useState(false);
    const [editingFlag, setEditingFlag] = useState(null);
    const [flagForm, setFlagForm] = useState({ name: '', icon: '⭐', color: '#F59E0B' });
    const [showFlagModal, setShowFlagModal] = useState(false);
    const [editingDocType, setEditingDocType] = useState(null);
    const [docTypeForm, setDocTypeForm] = useState({ name: '' });
    const [showDocTypeModal, setShowDocTypeModal] = useState(false);

    const toggleCategory = (categoryKey) => {
      setExpandedCategories({
        ...expandedCategories,
        [categoryKey]: !expandedCategories[categoryKey],
      });
    };

    // Custom Category Handlers
    const handleCreateCategory = () => {
      if (!categoryForm.name) return;

      const newCategory = {
        id: `cat-${Date.now()}`,
        name: categoryForm.name,
        description: categoryForm.description,
        icon: categoryForm.icon || '📁',
        createdAt: new Date(),
        createdBy: 'current-user',
      };

      setCompany({
        ...company,
        customFieldCategories: [...(company.customFieldCategories || []), newCategory],
        updatedAt: new Date(),
      });

      setCategoryForm({ name: '', description: '', icon: '' });
      setShowCategoryModal(false);
    };

    const handleDeleteCategory = (categoryId) => {
      // Check if any custom fields use this category
      const fieldsUsingCategory = (company.customFields || []).filter((f) => f.category === categoryId);

      if (fieldsUsingCategory.length > 0) {
        alert(`Cannot delete category. ${fieldsUsingCategory.length} custom field(s) are using it.`);
        return;
      }

      setConfirmationConfig({
        title: 'Delete Category',
        message: `Delete the "${company.customFieldCategories.find((c) => c.id === categoryId)?.name}" category?`,
        confirmText: 'Delete',
        type: 'delete',
        onConfirm: () => {
          setCompany({
            ...company,
            customFieldCategories: company.customFieldCategories.filter((c) => c.id !== categoryId),
            updatedAt: new Date(),
          });
        },
      });
      setShowConfirmation(true);
    };

    // Custom Field Handlers
    const handleOpenCustomFieldModal = (field = null) => {
      if (field) {
        // Edit mode - populate form with existing field data
        setEditingCustomField(field);
        setCustomFieldForm({
          label: field.label || '',
          category: field.category || '',
          type: field.type || 'text',
          required: field.required || false,
          defaultValue: field.defaultValue || '',
          placeholder: field.placeholder || '',
          icon: field.icon || '',
          helpText: field.helpText || '',
          options: field.options || [],
          min: field.min || '',
          max: field.max || '',
          rows: field.rows || 3,
        });
      } else {
        // Create mode - reset form
        setEditingCustomField(null);
        setCustomFieldForm({
          label: '',
          category: '',
          type: 'text',
          required: false,
          defaultValue: '',
          placeholder: '',
          icon: '',
          helpText: '',
          options: [],
          min: '',
          max: '',
          rows: 3,
        });
      }
      setShowCustomFieldModal(true);
    };

    const handleCreateCustomField = () => {
      if (!customFieldForm.label || !customFieldForm.category) return;

      if (editingCustomField) {
        // Update existing custom field
        const updatedField = {
          ...editingCustomField,
          label: customFieldForm.label,
          category: customFieldForm.category,
          type: customFieldForm.type,
          required: customFieldForm.required,
          defaultValue: customFieldForm.defaultValue,
          placeholder: customFieldForm.placeholder,
          icon: customFieldForm.icon,
          helpText: customFieldForm.helpText,
          updatedAt: new Date(),
          updatedBy: 'current-user',
        };

        // Add type-specific properties
        if (customFieldForm.type === 'select' || customFieldForm.type === 'multiselect') {
          updatedField.options = customFieldForm.options;
        }
        if (customFieldForm.type === 'number') {
          if (customFieldForm.min !== '') updatedField.min = customFieldForm.min;
          if (customFieldForm.max !== '') updatedField.max = customFieldForm.max;
        }
        if (customFieldForm.type === 'textarea') {
          updatedField.rows = customFieldForm.rows;
        }

        setCompany({
          ...company,
          customFields: company.customFields.map((f) => (f.id === editingCustomField.id ? updatedField : f)),
          updatedAt: new Date(),
        });
      } else {
        // Create new custom field
        const newField = {
          id: `custom-field-${Date.now()}`,
          label: customFieldForm.label,
          category: customFieldForm.category,
          type: customFieldForm.type,
          required: customFieldForm.required,
          defaultValue: customFieldForm.defaultValue,
          placeholder: customFieldForm.placeholder,
          icon: customFieldForm.icon,
          helpText: customFieldForm.helpText,
          isCustom: true,
          createdAt: new Date(),
          createdBy: 'current-user',
        };

        // Add type-specific properties
        if (customFieldForm.type === 'select' || customFieldForm.type === 'multiselect') {
          newField.options = customFieldForm.options;
        }
        if (customFieldForm.type === 'number') {
          if (customFieldForm.min !== '') newField.min = customFieldForm.min;
          if (customFieldForm.max !== '') newField.max = customFieldForm.max;
        }
        if (customFieldForm.type === 'textarea') {
          newField.rows = customFieldForm.rows;
        }

        setCompany({
          ...company,
          customFields: [...(company.customFields || []), newField],
          updatedAt: new Date(),
        });
      }

      // Reset form
      setCustomFieldForm({
        label: '',
        category: '',
        type: 'text',
        required: false,
        defaultValue: '',
        placeholder: '',
        icon: '',
        helpText: '',
        options: [],
        min: '',
        max: '',
        rows: 3,
      });
      setEditingCustomField(null);
      setShowCustomFieldModal(false);
    };

    const handleDeleteCustomField = (fieldId) => {
      // Check if any ticket types use this field
      const field = company.customFields.find((f) => f.id === fieldId);
      const typesUsingField = company.globalTicketTypes.filter((type) => type.fields && type.fields.includes(fieldId));

      if (typesUsingField.length > 0) {
        const typeNames = typesUsingField.map((t) => t.name).join(', ');
        alert(
          `Cannot delete "${field?.label}". It is used in ${typesUsingField.length} ticket type(s): ${typeNames}\n\nRemove it from those ticket types first.`
        );
        return;
      }

      setConfirmationConfig({
        title: 'Delete Custom Field',
        message: `Delete the custom field "${field?.label}"? This action cannot be undone.`,
        confirmText: 'Delete',
        type: 'delete',
        onConfirm: () => {
          setCompany({
            ...company,
            customFields: company.customFields.filter((f) => f.id !== fieldId),
            updatedAt: new Date(),
          });
        },
      });
      setShowConfirmation(true);
    };

    const handleAddProject = () => {
      if (!projectForm.name) return;
      const newProject = {
        id: `PROJ-${String(company.globalProjects.length + 1).padStart(3, '0')}`,
        ...projectForm,
        startDate: new Date(),
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'current-user',
      };
      setCompany({
        ...company,
        globalProjects: [...company.globalProjects, newProject],
        updatedAt: new Date(),
      });
      setProjectForm({ name: '', description: '', status: 'Active', clients: [], owner: '' });
    };

    const handleDeleteProject = (projectId) => {
      const project = company.globalProjects.find((p) => p.id === projectId);
      setConfirmationConfig({
        title: 'Delete Project',
        message: `You are about to delete the project "${project?.name || projectId}" (Project). This will not delete tickets linked to it.`,
        confirmText: 'Delete',
        type: 'delete',
        onConfirm: () => {
          setCompany({
            ...company,
            globalProjects: company.globalProjects.filter((p) => p.id !== projectId),
            updatedAt: new Date(),
          });
        },
      });
      setShowConfirmation(true);
    };

    const handleAddStaff = () => {
      if (!staffForm.name) return;
      const newStaff = {
        id: `staff-${company.globalStaff.length + 1}`,
        ...staffForm,
        active: true,
      };
      setCompany({
        ...company,
        globalStaff: [...company.globalStaff, newStaff],
        updatedAt: new Date(),
      });
      setStaffForm({ name: '', role: '', email: '', active: true });
    };

    const handleDeleteStaff = (staffId) => {
      const staff = company.globalStaff.find((s) => s.id === staffId);
      setConfirmationConfig({
        title: 'Delete Staff Member',
        message: `You are about to delete the staff member "${staff?.name || staffId}" (Staff Member).`,
        confirmText: 'Delete',
        type: 'delete',
        onConfirm: () => {
          setCompany({
            ...company,
            globalStaff: company.globalStaff.filter((s) => s.id !== staffId),
            updatedAt: new Date(),
          });
        },
      });
      setShowConfirmation(true);
    };

    // v187a: Removed handleSaveCustomer and handleSaveSupplier
    // Customer/Supplier editing now uses Detail Modals with inline editing

    const handleSaveTicketType = (typeData) => {
      // Handle prefix registry
      let updatedPrefixRegistry = [...(company.prefixRegistry || [])];

      // If this is a new prefix, add it to registry
      if (typeData._isNewPrefix) {
        updatedPrefixRegistry.push({
          prefix: typeData.prefix,
          nextNumber: 1,
          createdAt: new Date(),
          createdBy: 'current-user',
        });
      }

      // Remove the flag before saving
      const { _isNewPrefix, ...cleanTypeData } = typeData;

      setCompany({
        ...company,
        prefixRegistry: updatedPrefixRegistry,
        globalTicketTypes: editingTicketType
          ? company.globalTicketTypes.map((t) =>
              t.id === editingTicketType.id ? { ...cleanTypeData, id: editingTicketType.id } : t
            )
          : [...(company.globalTicketTypes || []), { ...cleanTypeData, id: `type-${Date.now()}` }],
        updatedAt: new Date(),
      });
      setShowNewTicketTypeModal(false);
      setEditingTicketType(null);
    };

    const handleDeleteTicketType = (typeId) => {
      setCompany({
        ...company,
        globalTicketTypes: company.globalTicketTypes.filter((t) => t.id !== typeId),
        updatedAt: new Date(),
      });
    };

    const onDeleteCustomer = (customerId) => {
      const customer = company.globalCRM.find((c) => c.id === customerId);
      setConfirmationConfig({
        title: 'Delete Customer',
        message: `You are about to delete the customer "${customer?.companyName || customerId}" (Customer).`,
        confirmText: 'Delete',
        type: 'delete',
        onConfirm: () => {
          setCompany({
            ...company,
            globalCRM: company.globalCRM.filter((c) => c.id !== customerId),
            updatedAt: new Date(),
          });
        },
      });
      setShowConfirmation(true);
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-6xl w-full h-[85vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-semibold text-gray-900">Global Settings</h2>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-4 mt-4">
              <button
                onClick={() => setActiveTab('projects')}
                className={`px-4 py-2 font-medium ${activeTab === 'projects' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600'}`}
              >
                Projects ({company.globalProjects.length})
              </button>
              <button
                onClick={() => setActiveTab('staff')}
                className={`px-4 py-2 font-medium ${activeTab === 'staff' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600'}`}
              >
                Staff ({company.globalStaff.length})
              </button>
              <button
                onClick={() => setActiveTab('crm')}
                className={`px-4 py-2 font-medium ${activeTab === 'crm' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600'}`}
              >
                Global CRM ({company.globalCRM.length})
              </button>
              <button
                onClick={() => setActiveTab('crmConfig')}
                className={`px-4 py-2 font-medium ${activeTab === 'crmConfig' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600'}`}
              >
                CRM Config
              </button>
              <button
                onClick={() => setActiveTab('suppliers')}
                className={`px-4 py-2 font-medium ${activeTab === 'suppliers' ? 'text-teal-600 border-b-2 border-teal-600' : 'text-gray-600'}`}
              >
                Suppliers ({(company.globalSuppliers || []).length})
              </button>
              <button
                onClick={() => setActiveTab('supplierConfig')}
                className={`px-4 py-2 font-medium ${activeTab === 'supplierConfig' ? 'text-teal-600 border-b-2 border-teal-600' : 'text-gray-600'}`}
              >
                Supplier Config
              </button>
              <button
                onClick={() => setActiveTab('ticketTypes')}
                className={`px-4 py-2 font-medium ${activeTab === 'ticketTypes' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600'}`}
              >
                Ticket Types ({company.globalTicketTypes?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('prefixes')}
                className={`px-4 py-2 font-medium ${activeTab === 'prefixes' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600'}`}
              >
                Prefixes ({company.prefixRegistry?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('fields')}
                className={`px-4 py-2 font-medium ${activeTab === 'fields' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600'}`}
              >
                Fields ({Object.keys(fieldLibrary).length})
              </button>
              <button
                onClick={() => setActiveTab('statuses')}
                className={`px-4 py-2 font-medium ${activeTab === 'statuses' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600'}`}
              >
                Statuses ({company.statuses?.length || 0})
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Projects Tab */}
            {activeTab === 'projects' && (
              <div className="h-full flex flex-col" style={{ margin: '-1.5rem' }}>
                {/* Sticky Header */}
                <div className="flex-shrink-0 bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">Global Projects</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Projects are organisational containers. Tickets from any Work Centre can belong to a project.
                      </p>
                    </div>
                    <button
                      onClick={() => setShowProjectForm(!showProjectForm)}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                    >
                      <Plus size={16} />
                      New Project
                    </button>
                  </div>

                  {/* Collapsible Add Project Form */}
                  {showProjectForm && (
                    <div className="mt-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="font-medium">Create New Project</h4>
                        <button onClick={() => setShowProjectForm(false)} className="text-gray-400 hover:text-gray-600">
                          ✕
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          type="text"
                          placeholder="Project name *"
                          value={projectForm.name}
                          onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
                          className="px-3 py-2 border rounded focus:ring-2 focus:ring-indigo-500"
                        />
                        <select
                          value={projectForm.status}
                          onChange={(e) => setProjectForm({ ...projectForm, status: e.target.value })}
                          className="px-3 py-2 border rounded focus:ring-2 focus:ring-indigo-500"
                        >
                          <option>Active</option>
                          <option>Planned</option>
                          <option>On Hold</option>
                          <option>Complete</option>
                        </select>
                        <input
                          type="text"
                          placeholder="Owner"
                          value={projectForm.owner}
                          onChange={(e) => setProjectForm({ ...projectForm, owner: e.target.value })}
                          className="px-3 py-2 border rounded focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>

                      {/* Multi-select Clients */}
                      <div className="mt-3">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Clients (Optional)</label>
                        <div className="flex gap-2 mb-2">
                          <button
                            type="button"
                            onClick={() =>
                              setProjectForm({ ...projectForm, clients: company.globalCRM.map((c) => c.id) })
                            }
                            className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200"
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            onClick={() => setProjectForm({ ...projectForm, clients: [] })}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                          >
                            Deselect All
                          </button>
                          <span className="text-xs text-gray-500 self-center">
                            {projectForm.clients.length} selected
                          </span>
                        </div>
                        <div className="max-h-24 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-white">
                          {company.globalCRM.length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-2">No customers yet</p>
                          ) : (
                            company.globalCRM.map((client) => (
                              <label
                                key={client.id}
                                className="flex items-center gap-2 p-1 hover:bg-gray-50 rounded cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={projectForm.clients.includes(client.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setProjectForm({ ...projectForm, clients: [...projectForm.clients, client.id] });
                                    } else {
                                      setProjectForm({
                                        ...projectForm,
                                        clients: projectForm.clients.filter((id) => id !== client.id),
                                      });
                                    }
                                  }}
                                  className="rounded"
                                />
                                <span className="text-sm">{client.companyName}</span>
                              </label>
                            ))
                          )}
                        </div>
                      </div>

                      <textarea
                        placeholder="Description"
                        value={projectForm.description}
                        onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
                        className="w-full mt-3 px-3 py-2 border rounded focus:ring-2 focus:ring-indigo-500"
                        rows={2}
                      />
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => {
                            handleAddProject();
                            setShowProjectForm(false);
                          }}
                          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                        >
                          + Add Project
                        </button>
                        <button
                          onClick={() => setShowProjectForm(false)}
                          className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Scrollable Projects List */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-3">
                    {company.globalProjects.map((project) => (
                      <div key={project.id} className="border rounded-lg p-4 hover:bg-gray-50">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm text-gray-500">{project.id}</span>
                              <span className="font-semibold">{project.name}</span>
                              <span
                                className={`text-xs px-2 py-1 rounded ${
                                  project.status === 'Active'
                                    ? 'bg-green-100 text-green-700'
                                    : project.status === 'Complete'
                                      ? 'bg-gray-100 text-gray-700'
                                      : 'bg-yellow-100 text-yellow-700'
                                }`}
                              >
                                {project.status}
                              </span>
                            </div>
                            {project.description && <p className="text-sm text-gray-600 mt-1">{project.description}</p>}
                            <div className="text-xs text-gray-500 mt-2">
                              Owner: {project.owner || 'None'} • Clients:{' '}
                              {project.clients && project.clients.length > 0
                                ? project.clients
                                    .map((cid) => company.globalCRM.find((c) => c.id === cid)?.companyName)
                                    .filter(Boolean)
                                    .join(', ')
                                : 'None'}
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteProject(project.id)}
                            className="text-red-600 hover:text-red-700 text-sm"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}

                    {company.globalProjects.length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        <p className="text-lg mb-2">No projects yet</p>
                        <p className="text-sm">Click "New Project" to add your first project</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Staff Tab */}
            {activeTab === 'staff' && (
              <div className="h-full flex flex-col" style={{ margin: '-1.5rem' }}>
                {/* Sticky Header */}
                <div className="flex-shrink-0 bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">Global Staff Directory</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Staff members available company-wide. Work Centres can use all or subset.
                      </p>
                    </div>
                    <button
                      onClick={() => setShowStaffForm(!showStaffForm)}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                    >
                      <Plus size={16} />
                      New Staff
                    </button>
                  </div>

                  {/* Collapsible Add Staff Form */}
                  {showStaffForm && (
                    <div className="mt-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="font-medium">Add Staff Member</h4>
                        <button onClick={() => setShowStaffForm(false)} className="text-gray-400 hover:text-gray-600">
                          ✕
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <input
                          type="text"
                          placeholder="Name *"
                          value={staffForm.name}
                          onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                          className="px-3 py-2 border rounded focus:ring-2 focus:ring-indigo-500"
                        />
                        <input
                          type="text"
                          placeholder="Role"
                          value={staffForm.role}
                          onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}
                          className="px-3 py-2 border rounded focus:ring-2 focus:ring-indigo-500"
                        />
                        <input
                          type="email"
                          placeholder="Email"
                          value={staffForm.email}
                          onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                          className="px-3 py-2 border rounded focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => {
                            handleAddStaff();
                            setShowStaffForm(false);
                          }}
                          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                        >
                          + Add Staff
                        </button>
                        <button
                          onClick={() => setShowStaffForm(false)}
                          className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Scrollable Staff List */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-2">
                    {company.globalStaff.map((staff) => (
                      <div
                        key={staff.id}
                        className="border rounded-lg p-3 hover:bg-gray-50 flex justify-between items-center"
                      >
                        <div>
                          <div className="font-medium">{staff.name}</div>
                          <div className="text-sm text-gray-600">
                            {staff.role} • {staff.email}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteStaff(staff.id)}
                          className="text-red-600 hover:text-red-700 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    ))}

                    {company.globalStaff.length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        <p className="text-lg mb-2">No staff members yet</p>
                        <p className="text-sm">Click "New Staff" to add your first team member</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Global CRM Tab */}
            {activeTab === 'crm' && (
              <div className="h-full flex flex-col" style={{ margin: '-1.5rem' }}>
                {/* Sticky Header */}
                <div className="flex-shrink-0 bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">Global CRM</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        All customers company-wide. Manage customer records here.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        // v187a: Create new customer and open Detail Modal
                        if (onCreateCustomer) {
                          onCreateCustomer();
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                    >
                      <Plus size={16} />
                      New Customer
                    </button>
                  </div>
                </div>

                {/* Scrollable Customer List */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-3">
                    {company.globalCRM.map((customer) => {
                      // v171b: Look up stage name and color from crmConfig
                      const stageConfig = (company.crmConfig?.lifecycleStages || []).find(
                        (s) => s.id === customer.stage || s.name === customer.stage
                      );
                      const stageName = stageConfig?.name || customer.stage || 'Unknown';
                      const ColorUtils = window.ColorUtils;
                      const stageColor =
                        stageConfig && ColorUtils ? ColorUtils.getColorForPosition(stageConfig.colorPosition) : null;
                      const textColor = stageColor && ColorUtils ? ColorUtils.getContrastTextColor(stageColor) : null;

                      return (
                        <div
                          key={customer.id}
                          className="border-2 border-gray-200 rounded-lg p-4 hover:border-indigo-300 transition cursor-pointer"
                          onClick={() => onOpenCustomerDetail && onOpenCustomerDetail(customer.id)}
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                                  {customer.id}
                                </span>
                                <span className="font-semibold text-gray-900">
                                  {customer.companyName || '(Untitled)'}
                                </span>
                                <span
                                  className="text-xs px-2 py-1 rounded font-medium"
                                  style={
                                    stageColor
                                      ? { backgroundColor: stageColor, color: textColor }
                                      : { backgroundColor: '#DBEAFE', color: '#1D4ED8' }
                                  }
                                >
                                  {stageName}
                                </span>
                                {customer.tags && customer.tags.length > 0 && (
                                  <div className="flex gap-1">
                                    {customer.tags.map((tag) => (
                                      <span key={tag} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="text-sm text-gray-600">
                                <div className="mb-1">
                                  <span className="font-medium">Contact:</span> {customer.mainContact || '—'}
                                </div>
                                <div className="mb-1">
                                  <span className="font-medium">Industry:</span> {customer.industry || '—'}
                                </div>
                                {customer.email && (
                                  <div className="mb-1">
                                    <span className="font-medium">Email:</span> {customer.email}
                                  </div>
                                )}
                                {customer.mainNumber && (
                                  <div className="mb-1">
                                    <span className="font-medium">Phone:</span> {customer.mainNumber}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // v187a: Open Detail Modal for editing
                                  if (onOpenCustomerDetail) {
                                    onOpenCustomerDetail(customer.id);
                                  }
                                }}
                                className="p-2 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                                title="Edit customer"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteCustomer(customer.id);
                                }}
                                className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition"
                                title="Delete customer"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {company.globalCRM.length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        <p className="text-lg mb-2">No customers yet</p>
                        <p className="text-sm">Click "New Customer" to add your first customer</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* CRM Config Tab - v168a */}
            {activeTab === 'crmConfig' && (
              <div className="h-full flex flex-col" style={{ margin: '-1.5rem' }}>
                {/* Sticky Header */}
                <div className="flex-shrink-0 bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                  <div>
                    <h3 className="text-lg font-semibold">CRM Configuration</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Configure customer lifecycle stages, flags, and document types.
                    </p>
                  </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-8">
                  {/* Lifecycle Stages Section */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="font-semibold text-gray-900">Customer Lifecycle Stages</h4>
                        <p className="text-sm text-gray-500 mt-1">
                          Stages represent where a customer is in their relationship with you.
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setEditingLifecycleStage(null);
                          setLifecycleStageForm({ name: '', colorPosition: 6 });
                          setShowLifecycleStageModal(true);
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition"
                      >
                        <Plus size={14} />
                        Add Stage
                      </button>
                    </div>

                    {/* Auto-color toggle */}
                    <div className="mb-4 flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="useAutoColors"
                        checked={company.crmConfig?.useAutoColors !== false}
                        onChange={(e) => {
                          const newCrmConfig = {
                            ...(company.crmConfig || {}),
                            useAutoColors: e.target.checked,
                          };
                          // If turning on auto-colors, recalculate positions
                          if (e.target.checked && newCrmConfig.lifecycleStages) {
                            const ColorUtils = window.ColorUtils;
                            if (ColorUtils) {
                              // v171b: Reverse for CRM (first=grey, last=red)
                              const positions = ColorUtils.calculateAutoColorPositions(
                                newCrmConfig.lifecycleStages.length
                              ).reverse();
                              newCrmConfig.lifecycleStages = newCrmConfig.lifecycleStages.map((stage, idx) => ({
                                ...stage,
                                colorPosition: positions[idx],
                              }));
                            }
                          }
                          setCompany({
                            ...company,
                            crmConfig: newCrmConfig,
                            updatedAt: new Date(),
                          });
                        }}
                        className="rounded text-indigo-600"
                      />
                      <label htmlFor="useAutoColors" className="text-sm text-gray-700">
                        Auto-assign colors based on stage order
                      </label>
                    </div>

                    {/* Stages list */}
                    <div className="space-y-2">
                      {(company.crmConfig?.lifecycleStages || [])
                        .sort((a, b) => (a.order || 0) - (b.order || 0))
                        .map((stage, index, arr) => {
                          // v171c: BUG-170-002 FIX - Use || fallback to ensure color is always set
                          // Previous ternary would return undefined if getColorForPosition returned undefined
                          const ColorUtils = window.ColorUtils;
                          const colorHex = ColorUtils?.getColorForPosition(stage.colorPosition) || '#616161';
                          const textColor = ColorUtils?.getContrastTextColor(colorHex) || '#FFFFFF';

                          return (
                            <div key={stage.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                              {/* Color preview */}
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                                style={{ backgroundColor: colorHex, color: textColor }}
                              >
                                {stage.colorPosition}
                              </div>

                              {/* Stage name */}
                              <div className="flex-1 font-medium">{stage.name}</div>

                              {/* Reorder buttons */}
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => {
                                    if (index === 0) return;
                                    // v172c: BUG-171-004 FIX - Ensure order values exist before swapping
                                    let stages = [...(company.crmConfig?.lifecycleStages || [])].sort(
                                      (a, b) => (a.order || 0) - (b.order || 0)
                                    );

                                    // Assign sequential order values if any are missing
                                    const needsOrderAssignment = stages.some(
                                      (s) => s.order === undefined || s.order === null
                                    );
                                    if (needsOrderAssignment) {
                                      stages = stages.map((s, idx) => ({ ...s, order: (idx + 1) * 1000 }));
                                    }

                                    // Now swap orders
                                    const prevOrder = stages[index - 1].order;
                                    const currOrder = stages[index].order;
                                    stages[index - 1] = { ...stages[index - 1], order: currOrder };
                                    stages[index] = { ...stages[index], order: prevOrder };

                                    // Recalculate colors if auto
                                    let updatedStages = stages;
                                    if (company.crmConfig?.useAutoColors !== false) {
                                      const ColorUtils = window.ColorUtils;
                                      if (ColorUtils) {
                                        // v171b: Reverse for CRM (first=grey, last=red)
                                        const positions = ColorUtils.calculateAutoColorPositions(
                                          stages.length
                                        ).reverse();
                                        const sorted = [...stages].sort((a, b) => (a.order || 0) - (b.order || 0));
                                        updatedStages = sorted.map((s, idx) => ({
                                          ...s,
                                          colorPosition: positions[idx],
                                        }));
                                      }
                                    }

                                    setCompany({
                                      ...company,
                                      crmConfig: { ...company.crmConfig, lifecycleStages: updatedStages },
                                      updatedAt: new Date(),
                                    });
                                  }}
                                  disabled={index === 0}
                                  className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                  title="Move up"
                                >
                                  ↑
                                </button>
                                <button
                                  onClick={() => {
                                    if (index === arr.length - 1) return;
                                    // v172c: BUG-171-004 FIX - Ensure order values exist before swapping
                                    let stages = [...(company.crmConfig?.lifecycleStages || [])].sort(
                                      (a, b) => (a.order || 0) - (b.order || 0)
                                    );

                                    // Assign sequential order values if any are missing
                                    const needsOrderAssignment = stages.some(
                                      (s) => s.order === undefined || s.order === null
                                    );
                                    if (needsOrderAssignment) {
                                      stages = stages.map((s, idx) => ({ ...s, order: (idx + 1) * 1000 }));
                                    }

                                    // Now swap orders
                                    const nextOrder = stages[index + 1].order;
                                    const currOrder = stages[index].order;
                                    stages[index + 1] = { ...stages[index + 1], order: currOrder };
                                    stages[index] = { ...stages[index], order: nextOrder };

                                    // Recalculate colors if auto
                                    let updatedStages = stages;
                                    if (company.crmConfig?.useAutoColors !== false) {
                                      const ColorUtils = window.ColorUtils;
                                      if (ColorUtils) {
                                        // v171b: Reverse for CRM (first=grey, last=red)
                                        const positions = ColorUtils.calculateAutoColorPositions(
                                          stages.length
                                        ).reverse();
                                        const sorted = [...stages].sort((a, b) => (a.order || 0) - (b.order || 0));
                                        updatedStages = sorted.map((s, idx) => ({
                                          ...s,
                                          colorPosition: positions[idx],
                                        }));
                                      }
                                    }

                                    setCompany({
                                      ...company,
                                      crmConfig: { ...company.crmConfig, lifecycleStages: updatedStages },
                                      updatedAt: new Date(),
                                    });
                                  }}
                                  disabled={index === arr.length - 1}
                                  className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                  title="Move down"
                                >
                                  ↓
                                </button>
                              </div>

                              {/* Edit/Delete */}
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => {
                                    setEditingLifecycleStage(stage);
                                    setLifecycleStageForm({ name: stage.name, colorPosition: stage.colorPosition });
                                    setShowLifecycleStageModal(true);
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                                  title="Edit stage"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => {
                                    if ((company.crmConfig?.lifecycleStages || []).length <= 1) {
                                      alert('Cannot delete the last lifecycle stage.');
                                      return;
                                    }
                                    setConfirmationConfig({
                                      title: 'Delete Lifecycle Stage',
                                      message: `Delete the "${stage.name}" stage? Customers using this stage will need to be reassigned.`,
                                      confirmText: 'Delete',
                                      type: 'delete',
                                      onConfirm: () => {
                                        let updatedStages = (company.crmConfig?.lifecycleStages || []).filter(
                                          (s) => s.id !== stage.id
                                        );

                                        // Recalculate colors if auto
                                        if (company.crmConfig?.useAutoColors !== false) {
                                          const ColorUtils = window.ColorUtils;
                                          if (ColorUtils) {
                                            // v171b: Reverse for CRM (first=grey, last=red)
                                            const positions = ColorUtils.calculateAutoColorPositions(
                                              updatedStages.length
                                            ).reverse();
                                            const sorted = [...updatedStages].sort(
                                              (a, b) => (a.order || 0) - (b.order || 0)
                                            );
                                            updatedStages = sorted.map((s, idx) => ({
                                              ...s,
                                              colorPosition: positions[idx],
                                            }));
                                          }
                                        }

                                        setCompany({
                                          ...company,
                                          crmConfig: { ...company.crmConfig, lifecycleStages: updatedStages },
                                          updatedAt: new Date(),
                                        });
                                      },
                                    });
                                    setShowConfirmation(true);
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                  title="Delete stage"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })}

                      {(!company.crmConfig?.lifecycleStages || company.crmConfig.lifecycleStages.length === 0) && (
                        <div className="text-center py-6 text-gray-500">
                          <p>No lifecycle stages defined. Click "Add Stage" to create one.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Customer Flags Section */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="font-semibold text-gray-900">Customer Flags</h4>
                        <p className="text-sm text-gray-500 mt-1">
                          Flags highlight important customers (e.g., VIP, Strategic Account).
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setEditingFlag(null);
                          setFlagForm({ name: '', icon: '⭐', color: '#F59E0B' });
                          setShowFlagModal(true);
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition"
                      >
                        <Plus size={14} />
                        Add Flag
                      </button>
                    </div>

                    <div className="space-y-2">
                      {(company.crmConfig?.customerFlags || []).map((flag) => (
                        <div key={flag.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                          {/* Icon and color preview */}
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                            style={{ backgroundColor: flag.color + '20' }}
                          >
                            {flag.icon}
                          </div>

                          {/* Flag name */}
                          <div className="flex-1 font-medium">{flag.name}</div>

                          {/* Color swatch */}
                          <div
                            className="w-6 h-6 rounded border border-gray-300"
                            style={{ backgroundColor: flag.color }}
                            title={flag.color}
                          />

                          {/* Edit/Delete */}
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                setEditingFlag(flag);
                                setFlagForm({ name: flag.name, icon: flag.icon, color: flag.color });
                                setShowFlagModal(true);
                              }}
                              className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                              title="Edit flag"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => {
                                setConfirmationConfig({
                                  title: 'Delete Customer Flag',
                                  message: `Delete the "${flag.name}" flag? It will be removed from all customers.`,
                                  confirmText: 'Delete',
                                  type: 'delete',
                                  onConfirm: () => {
                                    setCompany({
                                      ...company,
                                      crmConfig: {
                                        ...company.crmConfig,
                                        customerFlags: (company.crmConfig?.customerFlags || []).filter(
                                          (f) => f.id !== flag.id
                                        ),
                                      },
                                      updatedAt: new Date(),
                                    });
                                  },
                                });
                                setShowConfirmation(true);
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Delete flag"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}

                      {(!company.crmConfig?.customerFlags || company.crmConfig.customerFlags.length === 0) && (
                        <div className="text-center py-6 text-gray-500">
                          <p>No customer flags defined. Click "Add Flag" to create one.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Document Types Section */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="font-semibold text-gray-900">Document Types</h4>
                        <p className="text-sm text-gray-500 mt-1">
                          Categorize documents linked to customers (contracts, proposals, etc.).
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setEditingDocType(null);
                          setDocTypeForm({ name: '' });
                          setShowDocTypeModal(true);
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition"
                      >
                        <Plus size={14} />
                        Add Type
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {(company.crmConfig?.documentTypes || []).map((docType) => (
                        <div
                          key={docType.id}
                          className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg group"
                        >
                          <span className="text-sm font-medium">{docType.name}</span>
                          <button
                            onClick={() => {
                              setEditingDocType(docType);
                              setDocTypeForm({ name: docType.name });
                              setShowDocTypeModal(true);
                            }}
                            className="p-0.5 text-gray-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition"
                            title="Edit"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            onClick={() => {
                              setConfirmationConfig({
                                title: 'Delete Document Type',
                                message: `Delete the "${docType.name}" document type?`,
                                confirmText: 'Delete',
                                type: 'delete',
                                onConfirm: () => {
                                  setCompany({
                                    ...company,
                                    crmConfig: {
                                      ...company.crmConfig,
                                      documentTypes: (company.crmConfig?.documentTypes || []).filter(
                                        (d) => d.id !== docType.id
                                      ),
                                    },
                                    updatedAt: new Date(),
                                  });
                                },
                              });
                              setShowConfirmation(true);
                            }}
                            className="p-0.5 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}

                      {(!company.crmConfig?.documentTypes || company.crmConfig.documentTypes.length === 0) && (
                        <div className="text-center py-6 text-gray-500 w-full">
                          <p>No document types defined. Click "Add Type" to create one.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* v180a: Suppliers Tab */}
            {activeTab === 'suppliers' && (
              <div className="h-full flex flex-col" style={{ margin: '-1.5rem' }}>
                {/* Sticky Header */}
                <div className="flex-shrink-0 bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">Global Suppliers</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        All suppliers company-wide. Manage supplier records here.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        // v187a: Create new supplier and open Detail Modal
                        if (onCreateSupplier) {
                          onCreateSupplier();
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition"
                    >
                      <Plus size={16} />
                      New Supplier
                    </button>
                  </div>
                </div>

                {/* Scrollable Supplier List */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-3">
                    {(company.globalSuppliers || []).map((supplier) => {
                      // Look up stage name and color from supplierConfig
                      const stageConfig = (company.supplierConfig?.lifecycleStages || []).find(
                        (s) => s.id === supplier.stage || s.name === supplier.stage
                      );
                      const stageName = stageConfig?.name || supplier.stage || 'Unknown';
                      const ColorUtils = window.ColorUtils;
                      const stageColor =
                        stageConfig && ColorUtils ? ColorUtils.getColorForPosition(stageConfig.colorPosition) : null;
                      const textColor = stageColor && ColorUtils ? ColorUtils.getContrastTextColor(stageColor) : null;

                      return (
                        <div
                          key={supplier.id}
                          className="border-2 border-gray-200 rounded-lg p-4 hover:border-teal-300 transition cursor-pointer"
                          onClick={() => onOpenSupplierDetail && onOpenSupplierDetail(supplier)}
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                                  {supplier.id}
                                </span>
                                <span className="font-semibold text-gray-900">{supplier.companyName}</span>
                                <span
                                  className="text-xs px-2 py-1 rounded font-medium"
                                  style={
                                    stageColor
                                      ? { backgroundColor: stageColor, color: textColor }
                                      : { backgroundColor: '#99F6E4', color: '#0F766E' }
                                  }
                                >
                                  {stageName}
                                </span>
                                {supplier.tags && supplier.tags.length > 0 && (
                                  <div className="flex gap-1">
                                    {supplier.tags.map((tag) => (
                                      <span key={tag} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="text-sm text-gray-600">
                                <div className="mb-1">
                                  <span className="font-medium">Contact:</span> {supplier.mainContact || '—'}
                                </div>
                                <div className="mb-1">
                                  <span className="font-medium">Industry:</span> {supplier.industry || '—'}
                                </div>
                                {supplier.email && (
                                  <div className="mb-1">
                                    <span className="font-medium">Email:</span> {supplier.email}
                                  </div>
                                )}
                                {supplier.mainNumber && (
                                  <div className="mb-1">
                                    <span className="font-medium">Phone:</span> {supplier.mainNumber}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // v187a: Open Detail Modal for editing
                                  if (onOpenSupplierDetail) {
                                    onOpenSupplierDetail(supplier);
                                  }
                                }}
                                className="p-2 text-gray-600 hover:text-teal-600 hover:bg-teal-50 rounded transition"
                                title="Edit supplier"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteSupplier && onDeleteSupplier(supplier.id);
                                }}
                                className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition"
                                title="Delete supplier"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {(company.globalSuppliers || []).length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        <p className="text-lg mb-2">No suppliers yet</p>
                        <p className="text-sm">Click "New Supplier" to add your first supplier</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* v181a: Supplier Config Tab */}
            {activeTab === 'supplierConfig' && (
              <div className="h-full flex flex-col" style={{ margin: '-1.5rem' }}>
                {/* Sticky Header */}
                <div className="flex-shrink-0 bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                  <div>
                    <h3 className="text-lg font-semibold">Supplier Configuration</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Configure supplier lifecycle stages, flags, and document types.
                    </p>
                  </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-8">
                  {/* Supplier Lifecycle Stages Section */}
                  <div className="border border-teal-200 rounded-lg p-4 bg-teal-50/30">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="font-semibold text-gray-900">Supplier Lifecycle Stages</h4>
                        <p className="text-sm text-gray-500 mt-1">
                          Stages represent where a supplier is in their relationship with you.
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setEditingSupplierLifecycleStage(null);
                          setSupplierLifecycleStageForm({ name: '', colorPosition: 6 });
                          setShowSupplierLifecycleStageModal(true);
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 transition"
                      >
                        <Plus size={14} />
                        Add Stage
                      </button>
                    </div>

                    {/* Auto-color toggle */}
                    <div className="mb-4 flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="useSupplierAutoColors"
                        checked={company.supplierConfig?.useAutoColors !== false}
                        onChange={(e) => {
                          const newSupplierConfig = {
                            ...(company.supplierConfig || {}),
                            useAutoColors: e.target.checked,
                          };
                          // If turning on auto-colors, recalculate positions
                          if (e.target.checked && newSupplierConfig.lifecycleStages) {
                            const ColorUtils = window.ColorUtils;
                            if (ColorUtils) {
                              // Same as CRM: first=grey, last=red
                              const positions = ColorUtils.calculateAutoColorPositions(
                                newSupplierConfig.lifecycleStages.length
                              ).reverse();
                              newSupplierConfig.lifecycleStages = newSupplierConfig.lifecycleStages.map(
                                (stage, idx) => ({
                                  ...stage,
                                  colorPosition: positions[idx],
                                })
                              );
                            }
                          }
                          setCompany({
                            ...company,
                            supplierConfig: newSupplierConfig,
                            updatedAt: new Date(),
                          });
                        }}
                        className="rounded text-teal-600"
                      />
                      <label htmlFor="useSupplierAutoColors" className="text-sm text-gray-700">
                        Auto-assign colors based on stage order
                      </label>
                    </div>

                    {/* Stages list */}
                    <div className="space-y-2">
                      {(company.supplierConfig?.lifecycleStages || [])
                        .sort((a, b) => (a.order || 0) - (b.order || 0))
                        .map((stage, index, arr) => {
                          const ColorUtils = window.ColorUtils;
                          const colorHex = ColorUtils?.getColorForPosition(stage.colorPosition) || '#616161';
                          const textColor = ColorUtils?.getContrastTextColor(colorHex) || '#FFFFFF';

                          return (
                            <div
                              key={stage.id}
                              className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200"
                            >
                              {/* Color preview */}
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                                style={{ backgroundColor: colorHex, color: textColor }}
                              >
                                {stage.colorPosition}
                              </div>

                              {/* Stage name */}
                              <div className="flex-1 font-medium">{stage.name}</div>

                              {/* Reorder buttons */}
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => {
                                    if (index === 0) return;
                                    let stages = [...(company.supplierConfig?.lifecycleStages || [])].sort(
                                      (a, b) => (a.order || 0) - (b.order || 0)
                                    );

                                    // Assign sequential order values if any are missing
                                    const needsOrderAssignment = stages.some(
                                      (s) => s.order === undefined || s.order === null
                                    );
                                    if (needsOrderAssignment) {
                                      stages = stages.map((s, idx) => ({ ...s, order: (idx + 1) * 1000 }));
                                    }

                                    // Swap orders
                                    const prevOrder = stages[index - 1].order;
                                    const currOrder = stages[index].order;
                                    stages[index - 1] = { ...stages[index - 1], order: currOrder };
                                    stages[index] = { ...stages[index], order: prevOrder };

                                    // Recalculate colors if auto
                                    let updatedStages = stages;
                                    if (company.supplierConfig?.useAutoColors !== false) {
                                      const ColorUtils = window.ColorUtils;
                                      if (ColorUtils) {
                                        const positions = ColorUtils.calculateAutoColorPositions(
                                          stages.length
                                        ).reverse();
                                        const sorted = [...stages].sort((a, b) => (a.order || 0) - (b.order || 0));
                                        updatedStages = sorted.map((s, idx) => ({
                                          ...s,
                                          colorPosition: positions[idx],
                                        }));
                                      }
                                    }

                                    setCompany({
                                      ...company,
                                      supplierConfig: { ...company.supplierConfig, lifecycleStages: updatedStages },
                                      updatedAt: new Date(),
                                    });
                                  }}
                                  disabled={index === 0}
                                  className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                  title="Move up"
                                >
                                  ↑
                                </button>
                                <button
                                  onClick={() => {
                                    if (index === arr.length - 1) return;
                                    let stages = [...(company.supplierConfig?.lifecycleStages || [])].sort(
                                      (a, b) => (a.order || 0) - (b.order || 0)
                                    );

                                    // Assign sequential order values if any are missing
                                    const needsOrderAssignment = stages.some(
                                      (s) => s.order === undefined || s.order === null
                                    );
                                    if (needsOrderAssignment) {
                                      stages = stages.map((s, idx) => ({ ...s, order: (idx + 1) * 1000 }));
                                    }

                                    // Swap orders
                                    const nextOrder = stages[index + 1].order;
                                    const currOrder = stages[index].order;
                                    stages[index + 1] = { ...stages[index + 1], order: currOrder };
                                    stages[index] = { ...stages[index], order: nextOrder };

                                    // Recalculate colors if auto
                                    let updatedStages = stages;
                                    if (company.supplierConfig?.useAutoColors !== false) {
                                      const ColorUtils = window.ColorUtils;
                                      if (ColorUtils) {
                                        const positions = ColorUtils.calculateAutoColorPositions(
                                          stages.length
                                        ).reverse();
                                        const sorted = [...stages].sort((a, b) => (a.order || 0) - (b.order || 0));
                                        updatedStages = sorted.map((s, idx) => ({
                                          ...s,
                                          colorPosition: positions[idx],
                                        }));
                                      }
                                    }

                                    setCompany({
                                      ...company,
                                      supplierConfig: { ...company.supplierConfig, lifecycleStages: updatedStages },
                                      updatedAt: new Date(),
                                    });
                                  }}
                                  disabled={index === arr.length - 1}
                                  className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                  title="Move down"
                                >
                                  ↓
                                </button>
                              </div>

                              {/* Edit/Delete */}
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => {
                                    setEditingSupplierLifecycleStage(stage);
                                    setSupplierLifecycleStageForm({
                                      name: stage.name,
                                      colorPosition: stage.colorPosition,
                                    });
                                    setShowSupplierLifecycleStageModal(true);
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded"
                                  title="Edit stage"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => {
                                    if ((company.supplierConfig?.lifecycleStages || []).length <= 1) {
                                      alert('Cannot delete the last lifecycle stage.');
                                      return;
                                    }
                                    setConfirmationConfig({
                                      title: 'Delete Supplier Stage',
                                      message: `Delete the "${stage.name}" stage? Suppliers using this stage will need to be reassigned.`,
                                      confirmText: 'Delete',
                                      type: 'delete',
                                      onConfirm: () => {
                                        let updatedStages = (company.supplierConfig?.lifecycleStages || []).filter(
                                          (s) => s.id !== stage.id
                                        );

                                        // Recalculate colors if auto
                                        if (company.supplierConfig?.useAutoColors !== false) {
                                          const ColorUtils = window.ColorUtils;
                                          if (ColorUtils) {
                                            const positions = ColorUtils.calculateAutoColorPositions(
                                              updatedStages.length
                                            ).reverse();
                                            const sorted = [...updatedStages].sort(
                                              (a, b) => (a.order || 0) - (b.order || 0)
                                            );
                                            updatedStages = sorted.map((s, idx) => ({
                                              ...s,
                                              colorPosition: positions[idx],
                                            }));
                                          }
                                        }

                                        setCompany({
                                          ...company,
                                          supplierConfig: { ...company.supplierConfig, lifecycleStages: updatedStages },
                                          updatedAt: new Date(),
                                        });
                                      },
                                    });
                                    setShowConfirmation(true);
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                  title="Delete stage"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })}

                      {(!company.supplierConfig?.lifecycleStages ||
                        company.supplierConfig.lifecycleStages.length === 0) && (
                        <div className="text-center py-6 text-gray-500">
                          <p>No lifecycle stages defined. Click "Add Stage" to create one.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Supplier Flags Section */}
                  <div className="border border-teal-200 rounded-lg p-4 bg-teal-50/30">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="font-semibold text-gray-900">Supplier Flags</h4>
                        <p className="text-sm text-gray-500 mt-1">
                          Flags highlight important suppliers (e.g., Preferred, ISO Certified).
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setEditingSupplierFlag(null);
                          setSupplierFlagForm({ name: '', icon: '⭐', color: '#14B8A6' });
                          setShowSupplierFlagModal(true);
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 transition"
                      >
                        <Plus size={14} />
                        Add Flag
                      </button>
                    </div>

                    <div className="space-y-2">
                      {(company.supplierConfig?.supplierFlags || []).map((flag) => (
                        <div
                          key={flag.id}
                          className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200"
                        >
                          {/* Icon and color preview */}
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                            style={{ backgroundColor: flag.color + '20' }}
                          >
                            {flag.icon}
                          </div>

                          {/* Flag name */}
                          <div className="flex-1 font-medium">{flag.name}</div>

                          {/* Color swatch */}
                          <div
                            className="w-6 h-6 rounded border border-gray-300"
                            style={{ backgroundColor: flag.color }}
                            title={flag.color}
                          />

                          {/* Edit/Delete */}
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                setEditingSupplierFlag(flag);
                                setSupplierFlagForm({ name: flag.name, icon: flag.icon, color: flag.color });
                                setShowSupplierFlagModal(true);
                              }}
                              className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded"
                              title="Edit flag"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => {
                                setConfirmationConfig({
                                  title: 'Delete Supplier Flag',
                                  message: `Delete the "${flag.name}" flag? It will be removed from all suppliers.`,
                                  confirmText: 'Delete',
                                  type: 'delete',
                                  onConfirm: () => {
                                    setCompany({
                                      ...company,
                                      supplierConfig: {
                                        ...company.supplierConfig,
                                        supplierFlags: (company.supplierConfig?.supplierFlags || []).filter(
                                          (f) => f.id !== flag.id
                                        ),
                                      },
                                      updatedAt: new Date(),
                                    });
                                  },
                                });
                                setShowConfirmation(true);
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Delete flag"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}

                      {(!company.supplierConfig?.supplierFlags ||
                        company.supplierConfig.supplierFlags.length === 0) && (
                        <div className="text-center py-6 text-gray-500">
                          <p>No supplier flags defined. Click "Add Flag" to create one.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Supplier Document Types Section */}
                  <div className="border border-teal-200 rounded-lg p-4 bg-teal-50/30">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="font-semibold text-gray-900">Document Types</h4>
                        <p className="text-sm text-gray-500 mt-1">
                          Categorize documents linked to suppliers (contracts, quotes, etc.).
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setEditingSupplierDocType(null);
                          setSupplierDocTypeForm({ name: '' });
                          setShowSupplierDocTypeModal(true);
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 transition"
                      >
                        <Plus size={14} />
                        Add Type
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {(company.supplierConfig?.documentTypes || []).map((docType) => (
                        <div
                          key={docType.id}
                          className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg group"
                        >
                          <span className="text-sm font-medium">{docType.name}</span>
                          <button
                            onClick={() => {
                              setEditingSupplierDocType(docType);
                              setSupplierDocTypeForm({ name: docType.name });
                              setShowSupplierDocTypeModal(true);
                            }}
                            className="p-0.5 text-gray-400 hover:text-teal-600 opacity-0 group-hover:opacity-100 transition"
                            title="Edit"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            onClick={() => {
                              setConfirmationConfig({
                                title: 'Delete Document Type',
                                message: `Delete the "${docType.name}" document type?`,
                                confirmText: 'Delete',
                                type: 'delete',
                                onConfirm: () => {
                                  setCompany({
                                    ...company,
                                    supplierConfig: {
                                      ...company.supplierConfig,
                                      documentTypes: (company.supplierConfig?.documentTypes || []).filter(
                                        (d) => d.id !== docType.id
                                      ),
                                    },
                                    updatedAt: new Date(),
                                  });
                                },
                              });
                              setShowConfirmation(true);
                            }}
                            className="p-0.5 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}

                      {(!company.supplierConfig?.documentTypes ||
                        company.supplierConfig.documentTypes.length === 0) && (
                        <div className="text-center py-6 text-gray-500 w-full">
                          <p>No document types defined. Click "Add Type" to create one.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Ticket Types Tab */}
            {activeTab === 'ticketTypes' && (
              <div className="h-full flex flex-col" style={{ margin: '-1.5rem' }}>
                {/* Sticky Header */}
                <div className="flex-shrink-0 bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">Global Ticket Types</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Ticket types are used across all Work Centres. Create and manage field templates here.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setEditingTicketType(null);
                        setShowNewTicketTypeModal(true);
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                    >
                      <Plus size={16} />
                      New Ticket Type
                    </button>
                  </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-3">
                    {company.globalTicketTypes?.map((type) => (
                      <div
                        key={type.id}
                        className="flex items-start gap-4 p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition"
                      >
                        <div className="text-2xl flex-shrink-0">{type.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold text-gray-900">{type.name}</h4>
                            <span
                              className="px-2 py-0.5 text-xs font-medium rounded-full"
                              style={{
                                backgroundColor: COLOR_OPTIONS.find((c) => c.name === type.color)?.bg,
                                color: COLOR_OPTIONS.find((c) => c.name === type.color)?.text,
                              }}
                            >
                              {type.color}
                            </span>
                            {type.prefix && (
                              <span className="px-2 py-0.5 text-xs font-mono font-medium bg-gray-200 text-gray-700 rounded">
                                {type.prefix}-
                                {String(
                                  company.prefixRegistry?.find((p) => p.prefix === type.prefix)?.nextNumber || 1
                                ).padStart(3, '0')}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600">
                            {type.fields.length} fields:{' '}
                            {type.fields.map((f) => fieldLibrary[f]?.label || f).join(', ')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setEditingTicketType(type);
                              setShowNewTicketTypeModal(true);
                            }}
                            className="p-2 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                            title="Edit ticket type"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => {
                              setConfirmationConfig({
                                title: 'Delete Ticket Type',
                                message: `You are about to delete the ticket type "${type.name}".\n\nThis will remove it from all Work Centres. Existing tickets of this type will remain but won't be categorized.`,
                                confirmText: 'Delete Type',
                                type: 'delete',
                                onConfirm: () => handleDeleteTicketType(type.id),
                              });
                              setShowConfirmation(true);
                            }}
                            className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition"
                            title="Delete ticket type"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}

                    {(!company.globalTicketTypes || company.globalTicketTypes.length === 0) && (
                      <div className="text-center py-12 text-gray-500">
                        <p className="text-lg mb-2">No ticket types defined</p>
                        <p className="text-sm">Click "New Ticket Type" to create your first type</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Prefixes Tab */}
            {activeTab === 'prefixes' && (
              <div className="h-full flex flex-col" style={{ margin: '-1.5rem' }}>
                {/* Sticky Header */}
                <div className="flex-shrink-0 bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">Prefix Registry</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        All ticket prefixes and their counters. Multiple ticket types can share a prefix.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Prefix
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Next #
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Used By
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Created
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {(company.prefixRegistry || []).map((entry) => {
                          const typesUsingThisPrefix = (company.globalTicketTypes || []).filter(
                            (t) => t.prefix === entry.prefix
                          );
                          const ticketsUsingThisPrefix = tickets.filter(
                            (t) => t.id && t.id.startsWith(entry.prefix + '-')
                          ).length;
                          const canDelete =
                            ticketsUsingThisPrefix === 0 &&
                            typesUsingThisPrefix.length === 0 &&
                            new Date() - new Date(entry.createdAt) < 24 * 60 * 60 * 1000; // 24 hrs

                          return (
                            <tr key={entry.prefix} className="hover:bg-gray-50">
                              <td className="px-4 py-4 text-sm text-gray-900 font-medium">{entry.prefix}</td>
                              <td className="px-4 py-4 text-sm text-gray-700">
                                {entry.prefix}-{String(entry.nextNumber).padStart(3, '0')}
                              </td>
                              <td className="px-4 py-4">
                                {typesUsingThisPrefix.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {typesUsingThisPrefix.map((t) => (
                                      <span
                                        key={t.id}
                                        className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-sm"
                                      >
                                        {t.icon} {t.name}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-gray-400 text-sm">No ticket types</span>
                                )}
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-500">
                                {new Date(entry.createdAt).toLocaleDateString()}
                              </td>
                              <td className="px-4 py-4">
                                {ticketsUsingThisPrefix > 0 ? (
                                  <span className="inline-flex items-center px-2 py-1 bg-green-50 text-green-700 rounded text-sm">
                                    🔒 {ticketsUsingThisPrefix} ticket{ticketsUsingThisPrefix !== 1 ? 's' : ''}
                                  </span>
                                ) : canDelete ? (
                                  <span className="inline-flex items-center px-2 py-1 bg-amber-50 text-amber-700 rounded text-sm">
                                    ⏳ Can delete (24hr grace)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-1 bg-gray-50 text-gray-500 rounded text-sm">
                                    Unused
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {(!company.prefixRegistry || company.prefixRegistry.length === 0) && (
                      <div className="text-center py-12 text-gray-500">
                        <p className="text-lg mb-2">No prefixes registered</p>
                        <p className="text-sm">Create a ticket type to register a prefix</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800">
                      💡 <strong>How prefixes work:</strong> Each prefix has a single counter shared by all ticket types
                      using that prefix. Once a ticket is created with a prefix, that prefix becomes permanent
                      (immutable).
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Fields Tab */}
            {activeTab === 'fields' && (
              <div className="h-full flex flex-col" style={{ margin: '-1.5rem' }}>
                {/* Sticky Header */}
                <div className="flex-shrink-0 bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-lg font-semibold">Field Library</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        All available fields that can be used in ticket types. Fields are organised by category.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowCategoryModal(true)}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition text-sm"
                      >
                        + New Category
                      </button>
                      <button
                        onClick={() => handleOpenCustomFieldModal()}
                        className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition text-sm"
                      >
                        + New Custom Field
                      </button>
                    </div>
                  </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-3">
                    {/* Predefined Categories */}
                    {Object.entries(window.FIELD_LIBRARY_CATEGORIES || {}).map(([categoryKey, categoryName]) => {
                      const fieldsInCategory = Object.entries(fieldLibrary).filter(
                        ([_, field]) => field.category === categoryKey
                      );

                      // Also get custom fields in this category
                      const customFieldsInCategory = (company.customFields || []).filter(
                        (f) => f.category === categoryKey
                      );

                      const totalFields = fieldsInCategory.length + customFieldsInCategory.length;
                      if (totalFields === 0) return null;

                      const isExpanded = expandedCategories[categoryKey];

                      return (
                        <div key={categoryKey} className="border border-gray-200 rounded-lg overflow-hidden">
                          {/* Category Header - Collapsible */}
                          <button
                            onClick={() => toggleCategory(categoryKey)}
                            className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                              <h4 className="font-semibold text-gray-900">{categoryName}</h4>
                              <span className="text-sm text-gray-500">
                                ({totalFields} field{totalFields !== 1 ? 's' : ''})
                              </span>
                            </div>
                          </button>

                          {/* Category Content - Collapsible */}
                          {isExpanded && (
                            <div className="p-4 bg-white">
                              <div className="space-y-2">
                                {/* Predefined fields */}
                                {fieldsInCategory.map(([fieldKey, field]) => (
                                  <div
                                    key={fieldKey}
                                    className="flex items-start gap-3 p-3 bg-gray-50 rounded hover:bg-gray-100 transition group"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <div className="font-medium text-sm text-gray-900">{field.label}</div>
                                        {field.icon && <div className="text-base">{field.icon}</div>}
                                        {field.required && (
                                          <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">
                                            required
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        Type: {field.type}
                                        {field.options && ` • ${field.options.length} options`}
                                        {field.defaultValue && ` • Default: ${field.defaultValue}`}
                                      </div>
                                      {field.options && (
                                        <div className="mt-1 text-xs text-gray-400">
                                          Options: {field.options.join(', ')}
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => {
                                        setEditingField({ key: fieldKey, ...field });
                                        setShowFieldModal(true);
                                      }}
                                      className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                                      title="Edit field"
                                    >
                                      <Edit2 size={14} />
                                    </button>
                                  </div>
                                ))}

                                {/* Custom fields in this category */}
                                {customFieldsInCategory.map((field) => (
                                  <div
                                    key={field.id}
                                    className="flex items-start gap-3 p-3 bg-indigo-50 rounded hover:bg-indigo-100 transition group border border-indigo-200"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <div className="font-medium text-sm text-gray-900">{field.label}</div>
                                        {field.icon && <div className="text-base">{field.icon}</div>}
                                        <span className="text-xs px-1.5 py-0.5 bg-indigo-600 text-white rounded">
                                          Custom
                                        </span>
                                        {field.required && (
                                          <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">
                                            required
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-xs text-gray-600">
                                        Type: {field.type}
                                        {field.options && ` • ${field.options.length} options`}
                                        {field.defaultValue && ` • Default: ${field.defaultValue}`}
                                      </div>
                                      {field.options && (
                                        <div className="mt-1 text-xs text-gray-500">
                                          Options: {field.options.join(', ')}
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => handleOpenCustomFieldModal(field)}
                                        className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                                        title="Edit custom field"
                                      >
                                        <Edit2 size={14} />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteCustomField(field.id)}
                                        className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition"
                                        title="Delete custom field"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Custom Categories */}
                    {(company.customFieldCategories || []).map((category) => {
                      const customFieldsInCategory = (company.customFields || []).filter(
                        (f) => f.category === category.id
                      );

                      // Show custom categories even if empty
                      const isExpanded = expandedCategories[category.id] || false;

                      return (
                        <div
                          key={category.id}
                          className="border border-indigo-300 rounded-lg overflow-hidden bg-indigo-50"
                        >
                          {/* Custom Category Header */}
                          <div
                            onClick={() => {
                              setExpandedCategories({
                                ...expandedCategories,
                                [category.id]: !isExpanded,
                              });
                            }}
                            className="w-full flex items-center justify-between p-4 bg-indigo-100 hover:bg-indigo-200 transition cursor-pointer"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-gray-600">{isExpanded ? '▼' : '▶'}</span>
                              <div className="flex items-center gap-2">
                                {category.icon && <span>{category.icon}</span>}
                                <h4 className="font-semibold text-gray-900">{category.name}</h4>
                                <span className="text-xs px-2 py-0.5 bg-indigo-600 text-white rounded">
                                  Custom Category
                                </span>
                              </div>
                              <span className="text-sm text-gray-600">
                                ({customFieldsInCategory.length} field{customFieldsInCategory.length !== 1 ? 's' : ''})
                              </span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCategory(category.id);
                              }}
                              className="p-1.5 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition"
                              title="Delete category"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          {/* Custom Category Content */}
                          {isExpanded && (
                            <div className="p-4 bg-white">
                              {category.description && (
                                <p className="text-sm text-gray-600 mb-3 italic">{category.description}</p>
                              )}
                              {customFieldsInCategory.length === 0 ? (
                                <p className="text-sm text-gray-500 italic text-center py-4">
                                  No fields in this category yet. Click "+ New Custom Field" to add one.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  {customFieldsInCategory.map((field) => (
                                    <div
                                      key={field.id}
                                      className="flex items-start gap-3 p-3 bg-indigo-50 rounded hover:bg-indigo-100 transition group border border-indigo-200"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                          <div className="font-medium text-sm text-gray-900">{field.label}</div>
                                          {field.icon && <div className="text-base">{field.icon}</div>}
                                          <span className="text-xs px-1.5 py-0.5 bg-indigo-600 text-white rounded">
                                            Custom
                                          </span>
                                          {field.required && (
                                            <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">
                                              required
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-xs text-gray-600">
                                          Type: {field.type}
                                          {field.options && ` • ${field.options.length} options`}
                                          {field.defaultValue && ` • Default: ${field.defaultValue}`}
                                        </div>
                                        {field.options && (
                                          <div className="mt-1 text-xs text-gray-500">
                                            Options: {field.options.join(', ')}
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <button
                                          onClick={() => handleOpenCustomFieldModal(field)}
                                          className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                                          title="Edit custom field"
                                        >
                                          <Edit2 size={14} />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteCustomField(field.id)}
                                          className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition"
                                          title="Delete custom field"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800">
                      <strong>ℹ️ Note:</strong> These fields are available globally. When creating or editing ticket
                      types, you select which fields to include from this library.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Statuses Tab - Phase 2 */}
            {activeTab === 'statuses' && (
              <div className="h-full flex flex-col" style={{ margin: '-1.5rem' }}>
                {/* Sticky Header */}
                <div className="flex-shrink-0 bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">Status Library</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Statuses define canonical workflow states for filtering and reporting across all Work Centres.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setEditingStatus(null);
                        setStatusForm({ label: '', type: 'active' });
                        setShowStatusModal(true);
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                    >
                      <Plus size={16} />
                      Add Status
                    </button>
                  </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {/* StatusGroup - reusable component for each status type */}
                  {(() => {
                    const StatusGroup = ({ type, icon, title, description, bgColor, titleColor, descColor }) => {
                      const statuses = (company.statuses || []).filter((s) => s.type === type);

                      return (
                        <div className="mb-6">
                          <div className={`flex items-center gap-2 mb-3 px-3 py-2 ${bgColor} rounded-lg`}>
                            <span className="text-lg">{icon}</span>
                            <h4 className={`font-semibold ${titleColor}`}>{title}</h4>
                            <span className={`text-sm ${descColor}`}>- {description}</span>
                          </div>
                          <div className="space-y-2">
                            {statuses.map((status) => {
                              const isRenamed =
                                status.predefined && status.label !== PREDEFINED_STATUS_LABELS[status.id];
                              return (
                                <div
                                  key={status.id}
                                  className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:border-gray-300"
                                >
                                  <div className="flex items-center gap-3">
                                    <span className="font-medium text-gray-900">{status.label}</span>
                                    {status.predefined ? (
                                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                                        predefined
                                      </span>
                                    ) : (
                                      <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded">
                                        custom
                                      </span>
                                    )}
                                    {isRenamed && (
                                      <span className="text-xs text-gray-400">
                                        (was: {PREDEFINED_STATUS_LABELS[status.id]})
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {isRenamed && (
                                      <button
                                        onClick={() => {
                                          setCompany({
                                            ...company,
                                            statuses: company.statuses.map((s) =>
                                              s.id === status.id
                                                ? { ...s, label: PREDEFINED_STATUS_LABELS[status.id] }
                                                : s
                                            ),
                                            updatedAt: new Date(),
                                          });
                                        }}
                                        className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded"
                                      >
                                        Reset
                                      </button>
                                    )}
                                    <button
                                      onClick={() => {
                                        setEditingStatus(status);
                                        setStatusForm({ label: status.label, type: status.type });
                                        setShowStatusModal(true);
                                      }}
                                      className="px-3 py-1 text-sm text-indigo-600 hover:bg-indigo-50 rounded"
                                    >
                                      Rename
                                    </button>
                                    {!status.predefined && (
                                      <button
                                        onClick={() => {
                                          setConfirmationConfig({
                                            title: 'Delete Status',
                                            message: `Delete the "${status.label}" status? This cannot be undone.`,
                                            confirmText: 'Delete',
                                            type: 'delete',
                                            onConfirm: () => {
                                              setCompany({
                                                ...company,
                                                statuses: company.statuses.filter((s) => s.id !== status.id),
                                                updatedAt: new Date(),
                                              });
                                            },
                                          });
                                          setShowConfirmation(true);
                                        }}
                                        className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded"
                                      >
                                        Delete
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                            {statuses.length === 0 && (
                              <p className="text-sm text-gray-500 italic p-3">No statuses in this category</p>
                            )}
                          </div>
                        </div>
                      );
                    };

                    return (
                      <>
                        {/* v145: 6-type status model */}
                        <StatusGroup
                          type="backlog"
                          icon="📥"
                          title="BACKLOG"
                          description="Not committed, future maybe"
                          bgColor="bg-gray-100"
                          titleColor="text-gray-700"
                          descColor="text-gray-500"
                        />
                        <StatusGroup
                          type="scoped"
                          icon="🎯"
                          title="SCOPED"
                          description="Committed to work unit"
                          bgColor="bg-purple-50"
                          titleColor="text-purple-700"
                          descColor="text-purple-500"
                        />
                        <StatusGroup
                          type="queued"
                          icon="📋"
                          title="QUEUED"
                          description="Ready to pick up"
                          bgColor="bg-amber-50"
                          titleColor="text-amber-700"
                          descColor="text-amber-500"
                        />
                        <StatusGroup
                          type="active"
                          icon="🔄"
                          title="ACTIVE"
                          description="Work in progress"
                          bgColor="bg-blue-50"
                          titleColor="text-blue-700"
                          descColor="text-blue-500"
                        />
                        <StatusGroup
                          type="completed"
                          icon="✅"
                          title="COMPLETED"
                          description="Finished successfully"
                          bgColor="bg-green-50"
                          titleColor="text-green-700"
                          descColor="text-green-500"
                        />
                        <StatusGroup
                          type="ended"
                          icon="⛔"
                          title="ENDED"
                          description="Stopped without completion"
                          bgColor="bg-red-50"
                          titleColor="text-red-700"
                          descColor="text-red-500"
                        />
                      </>
                    );
                  })()}

                  {/* Info Box */}
                  <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800">
                      <strong>ℹ️ How Statuses Work:</strong> Each Work Stage in a Work Zone maps to a canonical status.
                      When tickets move between stages, their status updates automatically. This enables consistent
                      filtering and reporting across different Work Centres even when stage names differ.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-gray-200">
            <button onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
              Close
            </button>
          </div>
        </div>

        {/* v187a: Removed CustomerModal and SupplierModal renders
          All customer/supplier editing now uses Detail Modals */}

        {/* Category Modal */}
        {showCategoryModal && (
          <CategoryModal
            formData={categoryForm}
            setFormData={setCategoryForm}
            onSubmit={handleCreateCategory}
            onCancel={() => {
              setShowCategoryModal(false);
              setCategoryForm({ name: '', description: '', icon: '' });
            }}
          />
        )}

        {/* Custom Field Modal */}
        {showCustomFieldModal && (
          <CustomFieldModal
            formData={customFieldForm}
            setFormData={setCustomFieldForm}
            company={company}
            isEditing={!!editingCustomField}
            onSubmit={handleCreateCustomField}
            onCancel={() => {
              setShowCustomFieldModal(false);
              setEditingCustomField(null);
              setCustomFieldForm({
                label: '',
                category: '',
                type: 'text',
                required: false,
                defaultValue: '',
                placeholder: '',
                icon: '',
                helpText: '',
                options: [],
                min: '',
                max: '',
                rows: 3,
              });
            }}
          />
        )}

        {/* Field Editor Modal */}
        {showFieldModal && editingField && (
          <FieldEditorModal
            field={editingField}
            onSave={(updatedField) => {
              const { key, ...fieldData } = updatedField;
              setFieldLibrary({
                ...fieldLibrary,
                [key]: fieldData,
              });
              setShowFieldModal(false);
              setEditingField(null);
            }}
            onClose={() => {
              setShowFieldModal(false);
              setEditingField(null);
            }}
          />
        )}

        {/* Ticket Type Modal */}
        {showNewTicketTypeModal && (
          <TicketTypeModal
            type={editingTicketType}
            company={company}
            onSave={handleSaveTicketType}
            onClose={() => {
              setShowNewTicketTypeModal(false);
              setEditingTicketType(null);
            }}
          />
        )}

        {/* Status Modal (Phase 2) */}
        {showStatusModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
              <h3 className="text-lg font-semibold mb-4">{editingStatus ? 'Rename Status' : 'Add Status'}</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Label *</label>
                  <input
                    type="text"
                    value={statusForm.label}
                    onChange={(e) => setStatusForm({ ...statusForm, label: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g., Awaiting Materials"
                    autoFocus
                  />
                </div>

                {!editingStatus && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Type *</label>
                    {/* v145: 6-type status model */}
                    <div className="space-y-2">
                      <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="statusType"
                          value="backlog"
                          checked={statusForm.type === 'backlog'}
                          onChange={(e) => setStatusForm({ ...statusForm, type: e.target.value })}
                          className="text-indigo-600"
                        />
                        <div>
                          <span className="font-medium">Backlog</span>
                          <span className="text-sm text-gray-500 ml-2">- Not committed, future maybe</span>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="statusType"
                          value="scoped"
                          checked={statusForm.type === 'scoped'}
                          onChange={(e) => setStatusForm({ ...statusForm, type: e.target.value })}
                          className="text-indigo-600"
                        />
                        <div>
                          <span className="font-medium">Scoped</span>
                          <span className="text-sm text-gray-500 ml-2">- Committed to work unit</span>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="statusType"
                          value="queued"
                          checked={statusForm.type === 'queued'}
                          onChange={(e) => setStatusForm({ ...statusForm, type: e.target.value })}
                          className="text-indigo-600"
                        />
                        <div>
                          <span className="font-medium">Queued</span>
                          <span className="text-sm text-gray-500 ml-2">- Ready to pick up</span>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="statusType"
                          value="active"
                          checked={statusForm.type === 'active'}
                          onChange={(e) => setStatusForm({ ...statusForm, type: e.target.value })}
                          className="text-indigo-600"
                        />
                        <div>
                          <span className="font-medium">Active</span>
                          <span className="text-sm text-gray-500 ml-2">- Work in progress</span>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="statusType"
                          value="completed"
                          checked={statusForm.type === 'completed'}
                          onChange={(e) => setStatusForm({ ...statusForm, type: e.target.value })}
                          className="text-indigo-600"
                        />
                        <div>
                          <span className="font-medium">Completed</span>
                          <span className="text-sm text-gray-500 ml-2">- Finished successfully</span>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="statusType"
                          value="ended"
                          checked={statusForm.type === 'ended'}
                          onChange={(e) => setStatusForm({ ...statusForm, type: e.target.value })}
                          className="text-indigo-600"
                        />
                        <div>
                          <span className="font-medium">Ended</span>
                          <span className="text-sm text-gray-500 ml-2">- Stopped without completion</span>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {editingStatus && (
                  <p className="text-sm text-gray-500">
                    Type cannot be changed after creation. Current type: <strong>{editingStatus.type}</strong>
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowStatusModal(false);
                    setEditingStatus(null);
                    setStatusForm({ label: '', type: 'active' });
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!statusForm.label.trim()) {
                      alert('Please enter a status label');
                      return;
                    }

                    if (editingStatus) {
                      // Rename existing status
                      setCompany({
                        ...company,
                        statuses: company.statuses.map((s) =>
                          s.id === editingStatus.id ? { ...s, label: statusForm.label.trim() } : s
                        ),
                        updatedAt: new Date(),
                      });
                    } else {
                      // Create new status
                      const newStatus = {
                        id: `status-${Date.now()}`,
                        label: statusForm.label.trim(),
                        type: statusForm.type,
                        predefined: false,
                      };
                      setCompany({
                        ...company,
                        statuses: [...(company.statuses || []), newStatus],
                        updatedAt: new Date(),
                      });
                    }

                    setShowStatusModal(false);
                    setEditingStatus(null);
                    setStatusForm({ label: '', type: 'active' });
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  {editingStatus ? 'Save' : 'Add Status'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* v168a: Lifecycle Stage Modal */}
        {showLifecycleStageModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
              <h3 className="text-lg font-semibold mb-4">
                {editingLifecycleStage ? 'Edit Lifecycle Stage' : 'Add Lifecycle Stage'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stage Name *</label>
                  <input
                    type="text"
                    value={lifecycleStageForm.name}
                    onChange={(e) => setLifecycleStageForm({ ...lifecycleStageForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g., Active, At Risk, Churned"
                    autoFocus
                  />
                </div>

                {/* Color position selector (only if not using auto-colors) */}
                {company.crmConfig?.useAutoColors === false && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Color Position (1-10)</label>
                    <div className="flex flex-wrap gap-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((pos) => {
                        const ColorUtils = window.ColorUtils;
                        const colorHex = ColorUtils ? ColorUtils.getColorForPosition(pos) : '#616161';
                        const textColor = ColorUtils ? ColorUtils.getContrastTextColor(colorHex) : '#FFFFFF';
                        const isSelected = lifecycleStageForm.colorPosition === pos;

                        return (
                          <button
                            key={pos}
                            onClick={() => setLifecycleStageForm({ ...lifecycleStageForm, colorPosition: pos })}
                            className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition ${isSelected ? 'ring-2 ring-offset-2 ring-indigo-500' : ''}`}
                            style={{ backgroundColor: colorHex, color: textColor }}
                          >
                            {pos}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">1 = Critical (red) → 10 = Minimal (grey)</p>
                  </div>
                )}

                {company.crmConfig?.useAutoColors !== false && (
                  <p className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
                    Color will be auto-assigned based on stage order. Disable "Auto-assign colors" to choose manually.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowLifecycleStageModal(false);
                    setEditingLifecycleStage(null);
                    setLifecycleStageForm({ name: '', colorPosition: 6 });
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!lifecycleStageForm.name.trim()) {
                      alert('Please enter a stage name');
                      return;
                    }

                    const crmConfig = company.crmConfig || {};
                    let stages = [...(crmConfig.lifecycleStages || [])];

                    if (editingLifecycleStage) {
                      // Update existing stage
                      stages = stages.map((s) =>
                        s.id === editingLifecycleStage.id
                          ? {
                              ...s,
                              name: lifecycleStageForm.name.trim(),
                              colorPosition: lifecycleStageForm.colorPosition,
                            }
                          : s
                      );
                    } else {
                      // Create new stage
                      const maxOrder = stages.reduce((max, s) => Math.max(max, s.order || 0), 0);
                      const newStage = {
                        id: `stage-${Date.now()}`,
                        name: lifecycleStageForm.name.trim(),
                        colorPosition: lifecycleStageForm.colorPosition,
                        order: maxOrder + 1,
                      };
                      stages.push(newStage);
                    }

                    // Recalculate colors if auto
                    if (crmConfig.useAutoColors !== false) {
                      const ColorUtils = window.ColorUtils;
                      if (ColorUtils) {
                        // v171b: Reverse for CRM (first=grey, last=red)
                        const positions = ColorUtils.calculateAutoColorPositions(stages.length).reverse();
                        const sorted = [...stages].sort((a, b) => (a.order || 0) - (b.order || 0));
                        stages = sorted.map((s, idx) => ({ ...s, colorPosition: positions[idx] }));
                      }
                    }

                    setCompany({
                      ...company,
                      crmConfig: { ...crmConfig, lifecycleStages: stages },
                      updatedAt: new Date(),
                    });

                    setShowLifecycleStageModal(false);
                    setEditingLifecycleStage(null);
                    setLifecycleStageForm({ name: '', colorPosition: 6 });
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  {editingLifecycleStage ? 'Save' : 'Add Stage'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* v168a: Customer Flag Modal */}
        {showFlagModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
              <h3 className="text-lg font-semibold mb-4">{editingFlag ? 'Edit Customer Flag' : 'Add Customer Flag'}</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Flag Name *</label>
                  <input
                    type="text"
                    value={flagForm.name}
                    onChange={(e) => setFlagForm({ ...flagForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g., VIP, Strategic, At Risk"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Icon</label>
                  <div className="flex flex-wrap gap-2">
                    {['⭐', '🎯', '🔥', '💎', '🏆', '⚡', '❤️', '🚀', '⚠️', '🛡️', '👑', '💼'].map((icon) => (
                      <button
                        key={icon}
                        onClick={() => setFlagForm({ ...flagForm, icon })}
                        className={`w-10 h-10 text-xl rounded-lg border-2 transition ${flagForm.icon === icon ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
                  <div className="flex flex-wrap gap-2">
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
                        onClick={() => setFlagForm({ ...flagForm, color: color.hex })}
                        className={`w-10 h-10 rounded-lg border-2 transition ${flagForm.color === color.hex ? 'border-gray-800 ring-2 ring-offset-2 ring-gray-400' : 'border-transparent'}`}
                        style={{ backgroundColor: color.hex }}
                        title={color.name}
                      />
                    ))}
                  </div>
                </div>

                {/* Preview */}
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 mb-2">Preview:</p>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-lg"
                      style={{ backgroundColor: flagForm.color + '20' }}
                    >
                      {flagForm.icon}
                    </div>
                    <span className="font-medium">{flagForm.name || 'Flag Name'}</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowFlagModal(false);
                    setEditingFlag(null);
                    setFlagForm({ name: '', icon: '⭐', color: '#F59E0B' });
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!flagForm.name.trim()) {
                      alert('Please enter a flag name');
                      return;
                    }

                    const crmConfig = company.crmConfig || {};
                    let flags = [...(crmConfig.customerFlags || [])];

                    if (editingFlag) {
                      // Update existing flag
                      flags = flags.map((f) =>
                        f.id === editingFlag.id
                          ? { ...f, name: flagForm.name.trim(), icon: flagForm.icon, color: flagForm.color }
                          : f
                      );
                    } else {
                      // Create new flag
                      const newFlag = {
                        id: `flag-${Date.now()}`,
                        name: flagForm.name.trim(),
                        icon: flagForm.icon,
                        color: flagForm.color,
                      };
                      flags.push(newFlag);
                    }

                    setCompany({
                      ...company,
                      crmConfig: { ...crmConfig, customerFlags: flags },
                      updatedAt: new Date(),
                    });

                    setShowFlagModal(false);
                    setEditingFlag(null);
                    setFlagForm({ name: '', icon: '⭐', color: '#F59E0B' });
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  {editingFlag ? 'Save' : 'Add Flag'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* v168a: Document Type Modal */}
        {showDocTypeModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-lg max-w-sm w-full p-6">
              <h3 className="text-lg font-semibold mb-4">
                {editingDocType ? 'Edit Document Type' : 'Add Document Type'}
              </h3>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type Name *</label>
                <input
                  type="text"
                  value={docTypeForm.name}
                  onChange={(e) => setDocTypeForm({ ...docTypeForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g., Contract, Proposal, NDA"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowDocTypeModal(false);
                    setEditingDocType(null);
                    setDocTypeForm({ name: '' });
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!docTypeForm.name.trim()) {
                      alert('Please enter a document type name');
                      return;
                    }

                    const crmConfig = company.crmConfig || {};
                    let docTypes = [...(crmConfig.documentTypes || [])];

                    if (editingDocType) {
                      // Update existing
                      docTypes = docTypes.map((d) =>
                        d.id === editingDocType.id ? { ...d, name: docTypeForm.name.trim() } : d
                      );
                    } else {
                      // Create new
                      const newDocType = {
                        id: `doctype-${Date.now()}`,
                        name: docTypeForm.name.trim(),
                      };
                      docTypes.push(newDocType);
                    }

                    setCompany({
                      ...company,
                      crmConfig: { ...crmConfig, documentTypes: docTypes },
                      updatedAt: new Date(),
                    });

                    setShowDocTypeModal(false);
                    setEditingDocType(null);
                    setDocTypeForm({ name: '' });
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  {editingDocType ? 'Save' : 'Add Type'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* v181a: Supplier Lifecycle Stage Modal */}
        {showSupplierLifecycleStageModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
              <h3 className="text-lg font-semibold mb-4">
                {editingSupplierLifecycleStage ? 'Edit Supplier Stage' : 'Add Supplier Stage'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stage Name *</label>
                  <input
                    type="text"
                    value={supplierLifecycleStageForm.name}
                    onChange={(e) =>
                      setSupplierLifecycleStageForm({ ...supplierLifecycleStageForm, name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="e.g., Approved, Preferred, Inactive"
                    autoFocus
                  />
                </div>

                {/* Color position selector (only if not using auto-colors) */}
                {company.supplierConfig?.useAutoColors === false && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Color Position (1-10)</label>
                    <div className="flex flex-wrap gap-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((pos) => {
                        const ColorUtils = window.ColorUtils;
                        const colorHex = ColorUtils ? ColorUtils.getColorForPosition(pos) : '#616161';
                        const textColor = ColorUtils ? ColorUtils.getContrastTextColor(colorHex) : '#FFFFFF';
                        const isSelected = supplierLifecycleStageForm.colorPosition === pos;

                        return (
                          <button
                            key={pos}
                            onClick={() =>
                              setSupplierLifecycleStageForm({ ...supplierLifecycleStageForm, colorPosition: pos })
                            }
                            className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition ${isSelected ? 'ring-2 ring-offset-2 ring-teal-500' : ''}`}
                            style={{ backgroundColor: colorHex, color: textColor }}
                          >
                            {pos}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">1 = Critical (red) → 10 = Minimal (grey)</p>
                  </div>
                )}

                {company.supplierConfig?.useAutoColors !== false && (
                  <p className="text-sm text-gray-500 bg-teal-50 p-3 rounded-lg">
                    Color will be auto-assigned based on stage order. Disable "Auto-assign colors" to choose manually.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowSupplierLifecycleStageModal(false);
                    setEditingSupplierLifecycleStage(null);
                    setSupplierLifecycleStageForm({ name: '', colorPosition: 6 });
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!supplierLifecycleStageForm.name.trim()) {
                      alert('Please enter a stage name');
                      return;
                    }

                    const supplierConfig = company.supplierConfig || {};
                    let stages = [...(supplierConfig.lifecycleStages || [])];

                    if (editingSupplierLifecycleStage) {
                      // Update existing stage
                      stages = stages.map((s) =>
                        s.id === editingSupplierLifecycleStage.id
                          ? {
                              ...s,
                              name: supplierLifecycleStageForm.name.trim(),
                              colorPosition: supplierLifecycleStageForm.colorPosition,
                            }
                          : s
                      );
                    } else {
                      // Create new stage
                      const maxOrder = stages.reduce((max, s) => Math.max(max, s.order || 0), 0);
                      const newStage = {
                        id: `sup-stage-${Date.now()}`,
                        name: supplierLifecycleStageForm.name.trim(),
                        colorPosition: supplierLifecycleStageForm.colorPosition,
                        order: maxOrder + 1,
                      };
                      stages.push(newStage);
                    }

                    // Recalculate colors if auto
                    if (supplierConfig.useAutoColors !== false) {
                      const ColorUtils = window.ColorUtils;
                      if (ColorUtils) {
                        const positions = ColorUtils.calculateAutoColorPositions(stages.length).reverse();
                        const sorted = [...stages].sort((a, b) => (a.order || 0) - (b.order || 0));
                        stages = sorted.map((s, idx) => ({ ...s, colorPosition: positions[idx] }));
                      }
                    }

                    setCompany({
                      ...company,
                      supplierConfig: { ...supplierConfig, lifecycleStages: stages },
                      updatedAt: new Date(),
                    });

                    setShowSupplierLifecycleStageModal(false);
                    setEditingSupplierLifecycleStage(null);
                    setSupplierLifecycleStageForm({ name: '', colorPosition: 6 });
                  }}
                  className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                >
                  {editingSupplierLifecycleStage ? 'Save' : 'Add Stage'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* v181a: Supplier Flag Modal */}
        {showSupplierFlagModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
              <h3 className="text-lg font-semibold mb-4">
                {editingSupplierFlag ? 'Edit Supplier Flag' : 'Add Supplier Flag'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Flag Name *</label>
                  <input
                    type="text"
                    value={supplierFlagForm.name}
                    onChange={(e) => setSupplierFlagForm({ ...supplierFlagForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="e.g., Preferred, ISO Certified"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Icon</label>
                  <div className="flex flex-wrap gap-2">
                    {['⭐', '✓', '🔒', '🏆', '📍', '⚡', '🛡️', '✈️', '🏭', '📦', '🔧', '💼'].map((icon) => (
                      <button
                        key={icon}
                        onClick={() => setSupplierFlagForm({ ...supplierFlagForm, icon })}
                        className={`w-10 h-10 text-xl rounded-lg border-2 transition ${supplierFlagForm.icon === icon ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
                  <div className="flex flex-wrap gap-2">
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
                        onClick={() => setSupplierFlagForm({ ...supplierFlagForm, color: color.hex })}
                        className={`w-10 h-10 rounded-lg border-2 transition ${supplierFlagForm.color === color.hex ? 'border-gray-800 ring-2 ring-offset-2 ring-gray-400' : 'border-transparent'}`}
                        style={{ backgroundColor: color.hex }}
                        title={color.name}
                      />
                    ))}
                  </div>
                </div>

                {/* Preview */}
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 mb-2">Preview:</p>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-lg"
                      style={{ backgroundColor: supplierFlagForm.color + '20' }}
                    >
                      {supplierFlagForm.icon}
                    </div>
                    <span className="font-medium">{supplierFlagForm.name || 'Flag Name'}</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowSupplierFlagModal(false);
                    setEditingSupplierFlag(null);
                    setSupplierFlagForm({ name: '', icon: '⭐', color: '#14B8A6' });
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!supplierFlagForm.name.trim()) {
                      alert('Please enter a flag name');
                      return;
                    }

                    const supplierConfig = company.supplierConfig || {};
                    let flags = [...(supplierConfig.supplierFlags || [])];

                    if (editingSupplierFlag) {
                      // Update existing flag
                      flags = flags.map((f) =>
                        f.id === editingSupplierFlag.id
                          ? {
                              ...f,
                              name: supplierFlagForm.name.trim(),
                              icon: supplierFlagForm.icon,
                              color: supplierFlagForm.color,
                            }
                          : f
                      );
                    } else {
                      // Create new flag
                      const newFlag = {
                        id: `sup-flag-${Date.now()}`,
                        name: supplierFlagForm.name.trim(),
                        icon: supplierFlagForm.icon,
                        color: supplierFlagForm.color,
                      };
                      flags.push(newFlag);
                    }

                    setCompany({
                      ...company,
                      supplierConfig: { ...supplierConfig, supplierFlags: flags },
                      updatedAt: new Date(),
                    });

                    setShowSupplierFlagModal(false);
                    setEditingSupplierFlag(null);
                    setSupplierFlagForm({ name: '', icon: '⭐', color: '#14B8A6' });
                  }}
                  className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                >
                  {editingSupplierFlag ? 'Save' : 'Add Flag'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* v181a: Supplier Document Type Modal */}
        {showSupplierDocTypeModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-lg max-w-sm w-full p-6">
              <h3 className="text-lg font-semibold mb-4">
                {editingSupplierDocType ? 'Edit Document Type' : 'Add Document Type'}
              </h3>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type Name *</label>
                <input
                  type="text"
                  value={supplierDocTypeForm.name}
                  onChange={(e) => setSupplierDocTypeForm({ ...supplierDocTypeForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="e.g., Contract, Quote, Certificate"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowSupplierDocTypeModal(false);
                    setEditingSupplierDocType(null);
                    setSupplierDocTypeForm({ name: '' });
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!supplierDocTypeForm.name.trim()) {
                      alert('Please enter a document type name');
                      return;
                    }

                    const supplierConfig = company.supplierConfig || {};
                    let docTypes = [...(supplierConfig.documentTypes || [])];

                    if (editingSupplierDocType) {
                      // Update existing
                      docTypes = docTypes.map((d) =>
                        d.id === editingSupplierDocType.id ? { ...d, name: supplierDocTypeForm.name.trim() } : d
                      );
                    } else {
                      // Create new
                      const newDocType = {
                        id: `sup-doctype-${Date.now()}`,
                        name: supplierDocTypeForm.name.trim(),
                      };
                      docTypes.push(newDocType);
                    }

                    setCompany({
                      ...company,
                      supplierConfig: { ...supplierConfig, documentTypes: docTypes },
                      updatedAt: new Date(),
                    });

                    setShowSupplierDocTypeModal(false);
                    setEditingSupplierDocType(null);
                    setSupplierDocTypeForm({ name: '' });
                  }}
                  className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                >
                  {editingSupplierDocType ? 'Save' : 'Add Type'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation Modal */}
        {showConfirmation && confirmationConfig && (
          <ConfirmationModal
            isOpen={showConfirmation}
            onClose={() => setShowConfirmation(false)}
            onConfirm={confirmationConfig.onConfirm}
            title={confirmationConfig.title}
            message={confirmationConfig.message}
            confirmText={confirmationConfig.confirmText}
            type={confirmationConfig.type}
          />
        )}
      </div>
    );
  };

  // Export to window namespace
  window.Components = window.Components || {};
  window.Components.GlobalSettingsModal = GlobalSettingsModal;

  // v171b: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['global-settings-modal'] = COMPONENT_VERSION;

  console.log(`[global-settings-modal.jsx] GlobalSettingsModal loaded (${COMPONENT_VERSION})`);
})();

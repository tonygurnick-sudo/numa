/**
 * Customer Detail Modal - v188a
 * Date: 2026-01-27
 *
 * v188a Changes:
 * - BUG-188-001 FIX: Added Company Name field to CompanyDetailsForm
 *   - Was missing after v187 removed basic CustomerModal
 *   - Now first field in the form, required, with prominent styling
 *
 * v187a Changes:
 * - UNIFIED ENTITY EDITING: This modal IS the full editor
 *   - REMOVED: onEdit prop and "Full Edit" button
 *   - All editing is done inline within this modal
 *   - Modal opens from Global Settings and CRM Mirror (same behaviour)
 *   - New customers (empty companyName) auto-start Company Details in edit mode
 *
 * v175a Changes:
 * - BUG-174-001 FIX: Delete actions now use Trash2 icon (consistency)
 * - NEW: DocumentForm component (Add/Edit documents inline)
 * - NEW: DocumentCard component with hover actions
 * - DocumentsSection: Now manages Add/Edit/Delete state
 * - NEW: CompanyDetailsForm (inline edit mode)
 * - NEW: ContractForm (inline edit mode)
 * - NEW: AccountNotesForm (inline edit mode)
 * - CompanyDetailsSection: Added Edit toggle
 * - ContractSection: Added Edit toggle
 * - NotesSection: Renamed to AccountNotesSection, added Edit toggle
 * - LinkedWorkSection: Click ticket to open, sort/filter controls
 * - NEW prop: onTicketClick callback for opening TicketModal
 *
 * v174b Changes:
 * - NEW: ContactForm component (Add/Edit contacts inline)
 * - NEW: ActivityForm component (Add/Edit activities inline)
 * - ContactCard: Added hover action buttons (Primary, VIP, Edit, Delete)
 * - ActivityItem: Added hover action buttons (Edit, Delete)
 * - ContactsListSection: Now manages Add/Edit state, calls onUpdateContacts
 * - ActivityTimelineSection: Now manages Add/Edit state, calls onUpdateActivities
 * - NEW prop: onUpdateCustomer callback for persisting changes to app.jsx
 *
 * v171b Changes:
 * - BUG-170-005 FIX: getStageName now searches by both id AND name
 *
 * Triggered by:
 * - Clicking customer card in CRM Mirror
 * - Clicking customer name in ticket modal
 * - Clicking customer row in Global Settings (NEW in v187a)
 *
 * Exported via: window.Components.CustomerDetailModal
 */

const { useState, useEffect, useMemo } = React;

// Register component version
window.ComponentVersions = window.ComponentVersions || {};
window.ComponentVersions['CustomerDetailModal'] = 'v188a';

// Icons - v175a: Import Trash2 for BUG-174-001 fix
const { X, ExternalLink, Phone, Mail, User, Calendar, FileText, MessageSquare, Trash2, Edit2 } = window.Icons || {};

/**
 * Activity type icons mapping
 */
const ACTIVITY_ICONS = {
  call: '📞',
  email: '📧',
  meeting: '📅',
  demo: '🎯',
  note: '📝',
  ticket: '🎫',
  slack: '💬',
  default: '📋',
};

/**
 * v175a: Document type icons mapping
 */
const DOCUMENT_ICONS = {
  contract: '📜',
  proposal: '📋',
  invoice: '🧾',
  sla: '⚖️',
  specification: '📐',
  nda: '🔒',
  sow: '📑',
  other: '📄',
  default: '📄',
};

/**
 * Get icon for activity type
 */
function getActivityIcon(type) {
  return ACTIVITY_ICONS[type] || ACTIVITY_ICONS.default;
}

/**
 * v175a: Get icon for document type
 */
function getDocumentIcon(type) {
  return DOCUMENT_ICONS[type?.toLowerCase()] || DOCUMENT_ICONS.default;
}

/**
 * Format relative date (e.g., "2 days ago", "3 weeks ago")
 */
function formatRelativeDate(dateString) {
  if (!dateString) return 'Never';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return '1 week ago';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return '1 month ago';
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} year${Math.floor(diffDays / 365) > 1 ? 's' : ''} ago`;
}

/**
 * Format date for display (e.g., "Jan 15, 2026")
 */
function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-NZ', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format currency
 */
function formatCurrency(value) {
  if (!value && value !== 0) return '—';
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: 'NZD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Calculate days until a date
 */
function daysUntil(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date - now;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculate last contact date from activities
 */
function calculateLastContactDate(activities) {
  if (!activities || activities.length === 0) return null;

  const contactTypes = ['call', 'email', 'meeting', 'demo'];
  const contactActivities = activities.filter((a) => contactTypes.includes(a.type));

  if (contactActivities.length === 0) return null;

  const sorted = contactActivities.sort((a, b) => new Date(b.date) - new Date(a.date));
  return sorted[0].date;
}

/**
 * Get all tickets linked to a customer
 */
function getLinkedTickets(customerId, tickets) {
  if (!tickets || !customerId) return [];
  return tickets
    .filter((t) => t.client === customerId && t.status !== 'deleted')
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

/**
 * Get stage color from crmConfig
 */
function getStageColor(stageId, crmConfig) {
  if (!crmConfig?.lifecycleStages) return null;

  const stage = crmConfig.lifecycleStages.find((s) => s.id === stageId || s.name === stageId);
  if (!stage) return null;

  // Use ColorUtils if available
  if (window.ColorUtils) {
    return window.ColorUtils.getColorForPosition(stage.colorPosition);
  }

  return null;
}

/**
 * Get stage name from crmConfig
 * v171b: Now searches by both id AND name to match getStageColor behavior
 */
function getStageName(stageId, crmConfig) {
  if (!crmConfig?.lifecycleStages) return stageId;
  // v171b: Search by both id and name (BUG-170-005 fix)
  const stage = crmConfig.lifecycleStages.find((s) => s.id === stageId || s.name === stageId);
  return stage?.name || stageId;
}

// ============================================
// v175a: DELETE ICON COMPONENT (BUG-174-001 FIX)
// ============================================

/**
 * v175a: Consistent delete button using Trash2 icon
 */
function DeleteButton({ onClick, title = 'Delete', className = '' }) {
  // Use Trash2 from icons.js if available, fallback to emoji
  if (Trash2) {
    return (
      <button
        onClick={onClick}
        className={`p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-red-600 transition-colors ${className}`}
        title={title}
      >
        <Trash2 size={14} />
      </button>
    );
  }
  // Fallback if Trash2 not available
  return (
    <button
      onClick={onClick}
      className={`p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-red-600 transition-colors ${className}`}
      title={title}
    >
      🗑️
    </button>
  );
}

/**
 * v175a: Consistent edit button using Edit2 icon
 */
function EditButton({ onClick, title = 'Edit', className = '' }) {
  if (Edit2) {
    return (
      <button
        onClick={onClick}
        className={`p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-blue-600 transition-colors ${className}`}
        title={title}
      >
        <Edit2 size={14} />
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className={`p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-blue-600 transition-colors ${className}`}
      title={title}
    >
      ✎
    </button>
  );
}

// ============================================
// v175a: COMPANY DETAILS EDIT MODE
// ============================================

/**
 * v175a: Company Details Form (inline edit mode)
 */
function CompanyDetailsForm({ customer, crmConfig, globalStaff, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    companyName: customer.companyName || '',
    industry: customer.industry || '',
    companySize: customer.companySize || '',
    source: customer.source || '',
    territory: customer.territory || '',
    accountOwnerId: customer.accountOwnerId || '',
    stage: customer.stage || '',
    website: customer.website || '',
  });

  const industries = [
    'Technology',
    'Healthcare',
    'Finance',
    'Retail',
    'Manufacturing',
    'Professional Services',
    'Education',
    'Government',
    'Non-profit',
    'Other',
  ];
  const companySizes = ['1-10', '11-50', '51-200', '201-1000', '1001-5000', '5000+'];
  const sources = ['Website', 'Referral', 'Event', 'Cold Outreach', 'Partner', 'Inbound', 'Other'];
  const territories = crmConfig?.territories || ['Auckland', 'Wellington', 'Canterbury', 'Other'];

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      {/* v188a: Company Name field - first and prominent */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Company Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.companyName}
          onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
          placeholder="Enter company name"
          required
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Industry</label>
          <select
            value={formData.industry}
            onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select...</option>
            {industries.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Company Size</label>
          <select
            value={formData.companySize}
            onChange={(e) => setFormData({ ...formData, companySize: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select...</option>
            {companySizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
          <select
            value={formData.source}
            onChange={(e) => setFormData({ ...formData, source: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select...</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Territory</label>
          <select
            value={formData.territory}
            onChange={(e) => setFormData({ ...formData, territory: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select...</option>
            {territories.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Account Owner</label>
          <select
            value={formData.accountOwnerId}
            onChange={(e) => setFormData({ ...formData, accountOwnerId: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select...</option>
            {(globalStaff || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Stage</label>
          <select
            value={formData.stage}
            onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select...</option>
            {(crmConfig?.lifecycleStages || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 md:col-span-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">Website</label>
          <input
            type="url"
            value={formData.website}
            onChange={(e) => setFormData({ ...formData, website: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="https://example.com"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Save Changes
        </button>
      </div>
    </form>
  );
}

/**
 * Company Details Section - v175a: Added edit mode
 */
function CompanyDetailsSection({ customer, crmConfig, globalStaff, onUpdateCustomer }) {
  const [isEditing, setIsEditing] = useState(false);

  const accountOwner = globalStaff?.find((s) => s.id === customer.accountOwnerId);
  const stageColor = getStageColor(customer.stage, crmConfig);
  const stageName = getStageName(customer.stage, crmConfig);

  const handleSave = (updates) => {
    if (onUpdateCustomer) {
      onUpdateCustomer(customer.id, updates);
    }
    setIsEditing(false);
  };

  const isReadOnly = !onUpdateCustomer;

  if (isEditing) {
    return (
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Company Details</h3>
        <CompanyDetailsForm
          customer={customer}
          crmConfig={crmConfig}
          globalStaff={globalStaff}
          onSave={handleSave}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Company Details</h3>
        {!isReadOnly && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            Edit
          </button>
        )}
      </div>
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Industry:</span>
            <span className="ml-2 text-gray-900">{customer.industry || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Size:</span>
            <span className="ml-2 text-gray-900">{customer.companySize || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Source:</span>
            <span className="ml-2 text-gray-900">{customer.source || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Territory:</span>
            <span className="ml-2 text-gray-900">{customer.territory || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Account Owner:</span>
            <span className="ml-2 text-gray-900">{accountOwner?.name || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Stage:</span>
            <span className="ml-2 inline-flex items-center gap-1.5">
              {stageColor && (
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: stageColor }} />
              )}
              <span className="text-gray-900">{stageName}</span>
            </span>
          </div>
          {customer.website && (
            <div className="col-span-2 md:col-span-3">
              <span className="text-gray-500">Website:</span>
              <a
                href={customer.website.startsWith('http') ? customer.website : `https://${customer.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1"
              >
                {customer.website}
                <span className="text-xs">↗</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// v175a: CONTRACT EDIT MODE
// ============================================

/**
 * v175a: Contract Form (inline edit mode)
 */
function ContractForm({ customer, onSave, onCancel }) {
  const formatDateForInput = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toISOString().split('T')[0];
  };

  const [formData, setFormData] = useState({
    contractValue: customer.contractValue || '',
    contractTerm: customer.contractTerm || '',
    contractStartDate: formatDateForInput(customer.contractStartDate),
    renewalDate: formatDateForInput(customer.renewalDate),
    products: (customer.products || []).join(', '),
    productNotes: customer.productNotes || '',
  });

  const contractTerms = ['Monthly', 'Quarterly', 'Annual', '2 Year', '3 Year', 'Custom'];

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      contractValue: formData.contractValue ? parseInt(formData.contractValue) : null,
      contractTerm: formData.contractTerm,
      contractStartDate: formData.contractStartDate || null,
      renewalDate: formData.renewalDate || null,
      products: formData.products
        ? formData.products
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
        : [],
      productNotes: formData.productNotes,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Contract Value ($/yr)</label>
          <input
            type="number"
            value={formData.contractValue}
            onChange={(e) => setFormData({ ...formData, contractValue: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., 50000"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Term</label>
          <select
            value={formData.contractTerm}
            onChange={(e) => setFormData({ ...formData, contractTerm: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select...</option>
            {contractTerms.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
          <input
            type="date"
            value={formData.contractStartDate}
            onChange={(e) => setFormData({ ...formData, contractStartDate: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Renewal Date</label>
          <input
            type="date"
            value={formData.renewalDate}
            onChange={(e) => setFormData({ ...formData, renewalDate: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Products (comma-separated)</label>
          <input
            type="text"
            value={formData.products}
            onChange={(e) => setFormData({ ...formData, products: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Platform, Support, Training"
          />
        </div>
        <div className="col-span-2 md:col-span-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">Product Notes</label>
          <textarea
            value={formData.productNotes}
            onChange={(e) => setFormData({ ...formData, productNotes: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            placeholder="Additional notes about products/services"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Save Changes
        </button>
      </div>
    </form>
  );
}

/**
 * Contract Section - v175a: Added edit mode
 */
function ContractSection({ customer, onUpdateCustomer }) {
  const [isEditing, setIsEditing] = useState(false);

  const daysToRenewal = daysUntil(customer.renewalDate);
  let renewalStatus = '';
  let renewalColor = 'text-gray-600';

  if (daysToRenewal !== null) {
    if (daysToRenewal < 0) {
      renewalStatus = `(${Math.abs(daysToRenewal)} days overdue)`;
      renewalColor = 'text-red-600 font-medium';
    } else if (daysToRenewal <= 30) {
      renewalStatus = `(in ${daysToRenewal} days)`;
      renewalColor = 'text-orange-600 font-medium';
    } else if (daysToRenewal <= 90) {
      renewalStatus = `(in ${daysToRenewal} days)`;
      renewalColor = 'text-yellow-600';
    } else {
      renewalStatus = `(in ${daysToRenewal} days)`;
    }
  }

  const handleSave = (updates) => {
    if (onUpdateCustomer) {
      onUpdateCustomer(customer.id, updates);
    }
    setIsEditing(false);
  };

  const isReadOnly = !onUpdateCustomer;

  if (isEditing) {
    return (
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Contract</h3>
        <ContractForm customer={customer} onSave={handleSave} onCancel={() => setIsEditing(false)} />
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Contract</h3>
        {!isReadOnly && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            Edit
          </button>
        )}
      </div>
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Contract Value:</span>
            <span className="ml-2 text-gray-900 font-medium">{formatCurrency(customer.contractValue)}/yr</span>
          </div>
          <div>
            <span className="text-gray-500">Term:</span>
            <span className="ml-2 text-gray-900">{customer.contractTerm || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Start:</span>
            <span className="ml-2 text-gray-900">{formatDate(customer.contractStartDate)}</span>
          </div>
          <div className="col-span-2 md:col-span-3">
            <span className="text-gray-500">Renewal:</span>
            <span className="ml-2 text-gray-900">{formatDate(customer.renewalDate)}</span>
            {renewalStatus && <span className={`ml-2 ${renewalColor}`}>{renewalStatus}</span>}
          </div>
          {customer.products && customer.products.length > 0 && (
            <div className="col-span-2 md:col-span-3">
              <span className="text-gray-500">Products:</span>
              <span className="ml-2 text-gray-900">{customer.products.join(', ')}</span>
            </div>
          )}
          {customer.productNotes && (
            <div className="col-span-2 md:col-span-3">
              <span className="text-gray-500">Notes:</span>
              <span className="ml-2 text-gray-900">{customer.productNotes}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// v174b: CONTACT MANAGEMENT COMPONENTS
// (v175a: Updated to use DeleteButton/EditButton)
// ============================================

/**
 * v174b: Contact Form (used for Add and Edit)
 */
function ContactForm({ contact, onSave, onCancel }) {
  // contact is null for Add, populated for Edit
  const [formData, setFormData] = useState({
    name: contact?.name || '',
    role: contact?.role || '',
    email: contact?.email || '',
    phone: contact?.phone || '',
    isPrimary: contact?.isPrimary || false,
    isVip: contact?.isVip || false,
    notes: contact?.notes || '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) return; // Name required

    onSave({
      id: contact?.id || `contact-${Date.now()}`,
      ...formData,
      name: formData.name.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Contact name"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
          <input
            type="text"
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., CTO, Buyer"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="email@example.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="021 555 1234"
          />
        </div>
      </div>

      {/* Flags row */}
      <div className="flex items-center gap-6 mb-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={formData.isPrimary}
            onChange={(e) => setFormData({ ...formData, isPrimary: e.target.checked })}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span>★ Primary Contact</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={formData.isVip}
            onChange={(e) => setFormData({ ...formData, isVip: e.target.checked })}
            className="rounded border-gray-300 text-amber-500 focus:ring-amber-500"
          />
          <span>⭐ VIP</span>
        </label>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
        <textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={2}
          placeholder="Optional notes about this contact"
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {contact ? 'Save Changes' : 'Add Contact'}
        </button>
      </div>
    </form>
  );
}

/**
 * v174b: Single Contact Card with action buttons
 * v175a: Updated to use DeleteButton/EditButton components
 */
function ContactCard({ contact, onEdit, onDelete, onTogglePrimary, onToggleVip }) {
  return (
    <div className="border-b border-gray-100 last:border-0 py-3 first:pt-0 last:pb-0 group">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {contact.isPrimary && (
              <span title="Primary Contact" className="text-yellow-500">
                ★
              </span>
            )}
            {contact.isVip && (
              <span title="VIP Contact" className="text-amber-500">
                ⭐
              </span>
            )}
            <span className="font-medium text-gray-900">{contact.name}</span>
            {contact.role && <span className="text-gray-500">({contact.role})</span>}
          </div>
          <div className="mt-1 text-sm text-gray-600 flex flex-wrap items-center gap-x-4 gap-y-1">
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="hover:text-blue-600 inline-flex items-center gap-1">
                {contact.email}
              </a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className="hover:text-blue-600 inline-flex items-center gap-1">
                {contact.phone}
              </a>
            )}
          </div>
          {contact.notes && <p className="mt-1 text-sm text-gray-500 italic">{contact.notes}</p>}
        </div>

        {/* v175a: Action buttons - appear on hover, now using consistent icons */}
        {(onEdit || onDelete) && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
            {onTogglePrimary && (
              <button
                onClick={() => onTogglePrimary(contact.id)}
                className={`p-1.5 rounded hover:bg-gray-200 transition-colors ${contact.isPrimary ? 'text-yellow-500' : 'text-gray-400'}`}
                title={contact.isPrimary ? 'Remove Primary' : 'Set as Primary'}
              >
                ★
              </button>
            )}
            {onToggleVip && (
              <button
                onClick={() => onToggleVip(contact.id)}
                className={`p-1.5 rounded hover:bg-gray-200 transition-colors ${contact.isVip ? 'text-amber-500' : 'text-gray-400'}`}
                title={contact.isVip ? 'Remove VIP' : 'Set as VIP'}
              >
                ⭐
              </button>
            )}
            {onEdit && <EditButton onClick={() => onEdit(contact)} title="Edit contact" />}
            {onDelete && <DeleteButton onClick={() => onDelete(contact.id)} title="Delete contact" />}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * v174b: Contacts List Section with Add/Edit/Delete
 */
function ContactsListSection({ contacts, onUpdateContacts }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingContactId, setEditingContactId] = useState(null);

  // Sort: Primary first, then VIP, then alphabetical
  const sortedContacts = [...(contacts || [])].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    if (a.isVip && !b.isVip) return -1;
    if (!a.isVip && b.isVip) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  const handleAddContact = (newContact) => {
    onUpdateContacts([...(contacts || []), newContact]);
    setShowAddForm(false);
  };

  const handleUpdateContact = (updatedContact) => {
    onUpdateContacts(contacts.map((c) => (c.id === updatedContact.id ? updatedContact : c)));
    setEditingContactId(null);
  };

  const handleDeleteContact = (contactId) => {
    if (confirm('Delete this contact?')) {
      onUpdateContacts(contacts.filter((c) => c.id !== contactId));
    }
  };

  const handleTogglePrimary = (contactId) => {
    // Toggle - multiple primaries allowed
    onUpdateContacts(contacts.map((c) => (c.id === contactId ? { ...c, isPrimary: !c.isPrimary } : c)));
  };

  const handleToggleVip = (contactId) => {
    // Toggle - multiple VIPs allowed
    onUpdateContacts(contacts.map((c) => (c.id === contactId ? { ...c, isVip: !c.isVip } : c)));
  };

  // Read-only mode if no onUpdateContacts provided
  const isReadOnly = !onUpdateContacts;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Contacts {contacts?.length > 0 && `(${contacts.length})`}
        </h3>
        {!isReadOnly && (
          <button
            onClick={() => setShowAddForm(true)}
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            + Add Contact
          </button>
        )}
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        {showAddForm && <ContactForm contact={null} onSave={handleAddContact} onCancel={() => setShowAddForm(false)} />}

        {sortedContacts.length === 0 && !showAddForm ? (
          <div className="text-sm text-gray-500 italic">No contacts added yet.</div>
        ) : (
          sortedContacts.map((contact) =>
            editingContactId === contact.id ? (
              <ContactForm
                key={contact.id}
                contact={contact}
                onSave={handleUpdateContact}
                onCancel={() => setEditingContactId(null)}
              />
            ) : (
              <ContactCard
                key={contact.id}
                contact={contact}
                onEdit={isReadOnly ? undefined : (c) => setEditingContactId(c.id)}
                onDelete={isReadOnly ? undefined : handleDeleteContact}
                onTogglePrimary={isReadOnly ? undefined : handleTogglePrimary}
                onToggleVip={isReadOnly ? undefined : handleToggleVip}
              />
            )
          )
        )}

        {contacts?.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-400">
            ★ = Primary &nbsp;&nbsp; ⭐ = VIP
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// v175a: LINKED WORK SECTION WITH CLICK-THROUGH
// ============================================

/**
 * Linked Work Section - v175a: Added click-through and sort/filter
 */
function LinkedWorkSection({ customerId, tickets, opCentres, onTicketClick }) {
  const [sortBy, setSortBy] = useState('updatedAt');
  const [filterStatus, setFilterStatus] = useState('all');

  const linkedTickets = useMemo(() => getLinkedTickets(customerId, tickets), [customerId, tickets]);

  // Get board and work centre info for each ticket
  const enrichedTickets = useMemo(() => {
    return linkedTickets.map((ticket) => {
      const opCentre = opCentres?.find((oc) => oc.id === ticket.opCentreId);
      const board = opCentre?.processBoards?.find((b) => b.id === ticket.boardId);
      return {
        ...ticket,
        opCentreName: opCentre?.name || 'Unknown',
        boardName: board?.name || 'Unknown',
      };
    });
  }, [linkedTickets, opCentres]);

  // Apply filter
  const filteredTickets = useMemo(() => {
    if (filterStatus === 'all') return enrichedTickets;
    // Filter by status type (using window.Domain.Statuses if available)
    const Statuses = window.Domain?.Statuses;
    if (!Statuses) return enrichedTickets;

    return enrichedTickets.filter((t) => {
      const statusType = Statuses.getStatusType(t.status);
      return statusType === filterStatus;
    });
  }, [enrichedTickets, filterStatus]);

  // Apply sort
  const sortedTickets = useMemo(() => {
    const sorted = [...filteredTickets];
    switch (sortBy) {
      case 'createdAt':
        return sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      case 'updatedAt':
        return sorted.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
      case 'priority':
        return sorted.sort((a, b) => (a.priority || 999) - (b.priority || 999));
      case 'status':
        return sorted.sort((a, b) => (a.status || '').localeCompare(b.status || ''));
      default:
        return sorted;
    }
  }, [filteredTickets, sortBy]);

  if (enrichedTickets.length === 0) {
    return (
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Linked Work</h3>
        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500 italic">No linked tickets.</div>
      </div>
    );
  }

  // Group by work centre
  const groupedByOc = sortedTickets.reduce((acc, ticket) => {
    const key = ticket.opCentreName;
    if (!acc[key]) acc[key] = [];
    acc[key].push(ticket);
    return acc;
  }, {});

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Linked Work ({enrichedTickets.length})
        </h3>

        {/* v175a: Sort and filter controls */}
        <div className="flex items-center gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-xs px-2 py-1 border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="backlog">Backlog</option>
            <option value="scoped">Scoped</option>
            <option value="queued">Queued</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="ended">Ended</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="text-xs px-2 py-1 border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="updatedAt">Updated</option>
            <option value="createdAt">Created</option>
            <option value="priority">Priority</option>
            <option value="status">Status</option>
          </select>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        {sortedTickets.length === 0 ? (
          <div className="text-sm text-gray-500 italic">No tickets match the current filter.</div>
        ) : (
          <div className="space-y-2 text-sm">
            {Object.entries(groupedByOc).map(([ocName, ocTickets]) => (
              <div key={ocName}>
                {ocTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className={`flex items-center gap-3 py-1.5 hover:bg-gray-100 rounded px-2 -mx-2 ${onTicketClick ? 'cursor-pointer' : ''}`}
                    title={`${ticket.summary}\n\nClick to view ticket`}
                    onClick={() => onTicketClick?.(ticket)}
                  >
                    <span className="text-gray-400 text-xs w-20 flex-shrink-0 truncate">{ticket.boardName}</span>
                    <span className="font-mono text-blue-600 flex-shrink-0">{ticket.id}</span>
                    <span className="text-gray-900 truncate flex-1">{ticket.summary}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-600 flex-shrink-0">
                      {ticket.column || ticket.status}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// v174b: ACTIVITY MANAGEMENT COMPONENTS
// (v175a: Updated to use DeleteButton/EditButton)
// ============================================

/**
 * v174b: Activity Form (used for Add and Edit)
 */
function ActivityForm({ activity, globalStaff, onSave, onCancel }) {
  // Format date for datetime-local input
  const formatDateForInput = (dateStr) => {
    if (!dateStr) {
      const now = new Date();
      return now.toISOString().slice(0, 16);
    }
    const d = new Date(dateStr);
    return d.toISOString().slice(0, 16);
  };

  const [formData, setFormData] = useState({
    type: activity?.type || 'call',
    direction: activity?.direction || 'outbound',
    date: formatDateForInput(activity?.date),
    duration: activity?.duration || 15,
    summary: activity?.summary || '',
    outcome: activity?.outcome || 'neutral',
    staffId: activity?.staffId || '',
    source: 'manual',
  });

  const activityTypes = [
    { id: 'call', icon: '📞', label: 'Call' },
    { id: 'email', icon: '📧', label: 'Email' },
    { id: 'meeting', icon: '📅', label: 'Meeting' },
    { id: 'demo', icon: '🎯', label: 'Demo' },
    { id: 'note', icon: '📝', label: 'Note' },
  ];

  const outcomes = [
    { id: 'positive', label: 'Positive' },
    { id: 'neutral', label: 'Neutral' },
    { id: 'negative', label: 'Negative' },
    { id: 'info', label: 'Info Only' },
  ];

  const showDuration = ['call', 'meeting', 'demo'].includes(formData.type);
  const showDirection = ['call', 'email'].includes(formData.type);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.summary.trim()) return;

    onSave({
      id: activity?.id || `act-${Date.now()}`,
      ...formData,
      date: new Date(formData.date).toISOString(),
      summary: formData.summary.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-green-50 border border-green-200 rounded-lg p-4 mb-3">
      {/* Type selector - icon buttons */}
      <div className="flex flex-wrap gap-2 mb-3">
        {activityTypes.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFormData({ ...formData, type: t.id })}
            className={`px-3 py-2 rounded-lg text-sm flex items-center gap-1 transition-colors ${
              formData.type === t.id ? 'bg-green-600 text-white' : 'bg-white border border-gray-300 hover:bg-gray-50'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date/Time</label>
          <input
            type="datetime-local"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {showDirection && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Direction</label>
            <select
              value={formData.direction}
              onChange={(e) => setFormData({ ...formData, direction: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="outbound">Outbound</option>
              <option value="inbound">Inbound</option>
            </select>
          </div>
        )}

        {showDuration && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Duration (min)</label>
            <input
              type="number"
              value={formData.duration}
              onChange={(e) => setFormData({ ...formData, duration: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              min="1"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Outcome</label>
          <select
            value={formData.outcome}
            onChange={(e) => setFormData({ ...formData, outcome: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {outcomes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Logged By</label>
          <select
            value={formData.staffId}
            onChange={(e) => setFormData({ ...formData, staffId: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="">Select staff...</option>
            {(globalStaff || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Summary *</label>
        <textarea
          value={formData.summary}
          onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          rows={2}
          placeholder="What happened?"
          autoFocus
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          {activity ? 'Save Changes' : 'Log Activity'}
        </button>
      </div>
    </form>
  );
}

/**
 * v174b: Single Activity Item with action buttons
 * v175a: Updated to use DeleteButton/EditButton components
 */
function ActivityItem({ activity, globalStaff, onEdit, onDelete }) {
  const staff = globalStaff?.find((s) => s.id === activity.staffId);
  const icon = getActivityIcon(activity.type);

  // Outcome indicator colors
  const outcomeColors = {
    positive: 'bg-green-500',
    neutral: 'bg-gray-400',
    negative: 'bg-red-500',
    info: 'bg-blue-500',
  };

  const isEditable = activity.source !== 'system' && onEdit && onDelete;

  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0 group">
      <span className="text-lg flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">{formatDate(activity.date)}</span>
          {activity.outcome && (
            <span
              className={`w-2 h-2 rounded-full ${outcomeColors[activity.outcome] || 'bg-gray-400'}`}
              title={activity.outcome}
            />
          )}
          <span className="text-gray-900">{activity.summary}</span>
        </div>
        {activity.duration && <span className="text-xs text-gray-400">({activity.duration} min)</span>}
      </div>
      <div className="text-xs text-gray-400 flex-shrink-0">
        {activity.source === 'system' ? '[System]' : `[${staff?.name || 'Unknown'}]`}
      </div>

      {/* v175a: Action buttons - hover (only for manual activities), using consistent icons */}
      {isEditable && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <EditButton onClick={() => onEdit(activity)} title="Edit activity" />
          <DeleteButton onClick={() => onDelete(activity.id)} title="Delete activity" />
        </div>
      )}
    </div>
  );
}

/**
 * v174b: Activity Timeline Section with Add/Edit/Delete
 */
function ActivityTimelineSection({ activities, globalStaff, onUpdateActivities }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingActivityId, setEditingActivityId] = useState(null);
  const [showAll, setShowAll] = useState(false);

  // Sort by date descending (most recent first)
  const sortedActivities = [...(activities || [])].sort((a, b) => new Date(b.date) - new Date(a.date));

  const displayActivities = showAll ? sortedActivities : sortedActivities.slice(0, 10);
  const hasMore = sortedActivities.length > 10;

  const handleAddActivity = (newActivity) => {
    const updated = [...(activities || []), newActivity].sort((a, b) => new Date(b.date) - new Date(a.date));
    onUpdateActivities(updated);
    setShowAddForm(false);
  };

  const handleUpdateActivity = (updatedActivity) => {
    const updated = activities
      .map((a) => (a.id === updatedActivity.id ? updatedActivity : a))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    onUpdateActivities(updated);
    setEditingActivityId(null);
  };

  const handleDeleteActivity = (activityId) => {
    if (confirm('Delete this activity?')) {
      onUpdateActivities(activities.filter((a) => a.id !== activityId));
    }
  };

  // Read-only mode if no onUpdateActivities provided
  const isReadOnly = !onUpdateActivities;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Activity Timeline {activities?.length > 0 && `(${activities.length})`}
        </h3>
        {!isReadOnly && (
          <button
            onClick={() => setShowAddForm(true)}
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            + Log Activity
          </button>
        )}
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        {showAddForm && (
          <ActivityForm
            activity={null}
            globalStaff={globalStaff}
            onSave={handleAddActivity}
            onCancel={() => setShowAddForm(false)}
          />
        )}

        {sortedActivities.length === 0 && !showAddForm ? (
          <div className="text-sm text-gray-500 italic">No activities recorded yet.</div>
        ) : (
          displayActivities.map((activity) =>
            editingActivityId === activity.id ? (
              <ActivityForm
                key={activity.id}
                activity={activity}
                globalStaff={globalStaff}
                onSave={handleUpdateActivity}
                onCancel={() => setEditingActivityId(null)}
              />
            ) : (
              <ActivityItem
                key={activity.id}
                activity={activity}
                globalStaff={globalStaff}
                onEdit={isReadOnly ? undefined : (a) => setEditingActivityId(a.id)}
                onDelete={isReadOnly ? undefined : handleDeleteActivity}
              />
            )
          )
        )}

        {hasMore && !showAll && (
          <div className="text-center pt-3 mt-2 border-t border-gray-200">
            <button
              onClick={() => setShowAll(true)}
              className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
            >
              Show all {sortedActivities.length} activities
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// v175a: DOCUMENTS MANAGEMENT COMPONENTS
// ============================================

/**
 * v175a: Document Form (Add/Edit)
 */
function DocumentForm({ document, documentTypes, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    name: document?.name || '',
    url: document?.url || '',
    type: document?.type || 'other',
    notes: document?.notes || '',
  });

  // Default document types if not provided via crmConfig
  const defaultDocTypes = [
    { id: 'contract', name: 'Contract' },
    { id: 'proposal', name: 'Proposal' },
    { id: 'invoice', name: 'Invoice' },
    { id: 'sla', name: 'SLA' },
    { id: 'sow', name: 'SOW' },
    { id: 'specification', name: 'Specification' },
    { id: 'nda', name: 'NDA' },
    { id: 'other', name: 'Other' },
  ];

  const types = documentTypes?.length > 0 ? documentTypes : defaultDocTypes;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.url.trim()) return;

    onSave({
      id: document?.id || `doc-${Date.now()}`,
      ...formData,
      name: formData.name.trim(),
      url: formData.url.trim(),
      addedAt: document?.addedAt || new Date().toISOString(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-3">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            placeholder="e.g., Master Agreement 2026"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
          <select
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">URL *</label>
        <input
          type="url"
          value={formData.url}
          onChange={(e) => setFormData({ ...formData, url: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          placeholder="https://docs.google.com/..."
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
        <textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          rows={2}
          placeholder="Optional notes about this document"
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-1.5 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
        >
          {document ? 'Save Changes' : 'Add Document'}
        </button>
      </div>
    </form>
  );
}

/**
 * v175a: Document Card with hover actions
 */
function DocumentCard({ doc, documentTypes, onEdit, onDelete }) {
  const getTypeName = (typeId) => {
    const docType = documentTypes?.find((dt) => dt.id === typeId);
    return docType?.name || typeId;
  };

  const icon = getDocumentIcon(doc.type);

  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0 group">
      <span className="text-lg flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">{getTypeName(doc.type)}</span>
          <span className="font-medium text-gray-900 truncate">{doc.name}</span>
          {doc.url && (
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 text-sm flex-shrink-0"
              title="Open document"
              onClick={(e) => e.stopPropagation()}
            >
              ↗
            </a>
          )}
        </div>
        {doc.notes && <p className="text-sm text-gray-500 mt-1">{doc.notes}</p>}
        {doc.addedAt && <p className="text-xs text-gray-400 mt-1">Added {formatRelativeDate(doc.addedAt)}</p>}
      </div>

      {/* Hover actions */}
      {(onEdit || onDelete) && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && <EditButton onClick={() => onEdit(doc)} title="Edit document" />}
          {onDelete && <DeleteButton onClick={() => onDelete(doc.id)} title="Delete document" />}
        </div>
      )}
    </div>
  );
}

/**
 * v175a: Documents Section with Add/Edit/Delete
 */
function DocumentsSection({ documents, documentTypes, onUpdateDocuments }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingDocId, setEditingDocId] = useState(null);

  const handleAddDocument = (newDoc) => {
    onUpdateDocuments([...(documents || []), newDoc]);
    setShowAddForm(false);
  };

  const handleUpdateDocument = (updatedDoc) => {
    onUpdateDocuments(documents.map((d) => (d.id === updatedDoc.id ? updatedDoc : d)));
    setEditingDocId(null);
  };

  const handleDeleteDocument = (docId) => {
    if (confirm('Delete this document?')) {
      onUpdateDocuments(documents.filter((d) => d.id !== docId));
    }
  };

  const isReadOnly = !onUpdateDocuments;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Documents {documents?.length > 0 && `(${documents.length})`}
        </h3>
        {!isReadOnly && (
          <button
            onClick={() => setShowAddForm(true)}
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            + Add Document
          </button>
        )}
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        {showAddForm && (
          <DocumentForm
            document={null}
            documentTypes={documentTypes}
            onSave={handleAddDocument}
            onCancel={() => setShowAddForm(false)}
          />
        )}

        {(!documents || documents.length === 0) && !showAddForm ? (
          <div className="text-sm text-gray-500 italic">No documents linked yet.</div>
        ) : (
          (documents || []).map((doc) =>
            editingDocId === doc.id ? (
              <DocumentForm
                key={doc.id}
                document={doc}
                documentTypes={documentTypes}
                onSave={handleUpdateDocument}
                onCancel={() => setEditingDocId(null)}
              />
            ) : (
              <DocumentCard
                key={doc.id}
                doc={doc}
                documentTypes={documentTypes}
                onEdit={isReadOnly ? undefined : (d) => setEditingDocId(d.id)}
                onDelete={isReadOnly ? undefined : handleDeleteDocument}
              />
            )
          )
        )}
      </div>
    </div>
  );
}

// ============================================
// v175a: ACCOUNT NOTES SECTION (renamed from Notes)
// ============================================

/**
 * v175a: Account Notes Form (inline edit)
 */
function AccountNotesForm({ notes, onSave, onCancel }) {
  const [formData, setFormData] = useState(notes || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Account Notes</label>
        <textarea
          value={formData}
          onChange={(e) => setFormData(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={5}
          placeholder="General notes about this customer..."
          autoFocus
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Save Notes
        </button>
      </div>
    </form>
  );
}

/**
 * v175a: Account Notes Section (renamed from NotesSection)
 */
function AccountNotesSection({ notes, onUpdateNotes }) {
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = (newNotes) => {
    if (onUpdateNotes) {
      onUpdateNotes(newNotes);
    }
    setIsEditing(false);
  };

  const isReadOnly = !onUpdateNotes;

  if (isEditing) {
    return (
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Account Notes</h3>
        <AccountNotesForm notes={notes} onSave={handleSave} onCancel={() => setIsEditing(false)} />
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Account Notes</h3>
        {!isReadOnly && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            Edit
          </button>
        )}
      </div>
      {!notes ? (
        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500 italic">No account notes.</div>
      ) : (
        <div
          className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: notes }}
        />
      )}
    </div>
  );
}

/**
 * Customer Flags Display - shows flag icons in header
 */
function CustomerFlagsDisplay({ customerFlags, crmConfig }) {
  if (!customerFlags || customerFlags.length === 0 || !crmConfig?.customerFlags) {
    return null;
  }

  const flagsToShow = crmConfig.customerFlags.filter((f) => customerFlags.includes(f.id));

  if (flagsToShow.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {flagsToShow.map((flag) => (
        <span key={flag.id} title={flag.name} className="text-lg" style={{ color: flag.color }}>
          {flag.icon}
        </span>
      ))}
    </div>
  );
}

/**
 * Modal Footer - last contact and created date
 */
function CustomerModalFooter({ customer, activities }) {
  const lastContactDate = calculateLastContactDate(activities);

  return (
    <div className="flex items-center justify-between text-xs text-gray-400 pt-4 border-t border-gray-200">
      <span>Last Contact: {formatRelativeDate(lastContactDate)}</span>
      <span>Created: {formatDate(customer.createdAt)}</span>
    </div>
  );
}

// ============================================
// MAIN MODAL COMPONENT
// ============================================

/**
 * Customer Detail Modal
 * Main component - displays complete customer information
 * v175a: Added Documents CRUD, Edit modes, Linked Work click-through
 * v174b: Added inline editing of contacts and activities
 */
function CustomerDetailModal({
  customer,
  isOpen,
  onClose,
  // v187a: Removed onEdit prop - this modal IS the full editor
  onUpdateCustomer, // v174b: Callback for inline updates (contacts, activities, etc.)
  onTicketClick, // v175a: Callback for opening TicketModal from Linked Work
  tickets, // All tickets for linked work lookup
  opCentres, // For linked work display
  globalStaff, // For displaying account owner name
  crmConfig, // For stage colors, flags config
}) {
  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  // v174b: Handlers for updating contacts and activities
  const handleUpdateContacts = (newContacts) => {
    if (onUpdateCustomer) {
      onUpdateCustomer(customer.id, { contacts: newContacts });
    }
  };

  const handleUpdateActivities = (newActivities) => {
    if (onUpdateCustomer) {
      onUpdateCustomer(customer.id, { activities: newActivities });
    }
  };

  // v175a: Handler for updating documents
  const handleUpdateDocuments = (newDocuments) => {
    if (onUpdateCustomer) {
      onUpdateCustomer(customer.id, { documents: newDocuments });
    }
  };

  // v175a: Handler for updating account notes
  const handleUpdateNotes = (newNotes) => {
    if (onUpdateCustomer) {
      onUpdateCustomer(customer.id, { notes: newNotes });
    }
  };

  if (!isOpen || !customer) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center z-[9999] p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-gray-900">{customer.companyName || '(New Customer)'}</h2>
            <CustomerFlagsDisplay customerFlags={customer.flags} crmConfig={crmConfig} />
          </div>
          <div className="flex items-center gap-2">
            {/* v187a: Removed "Full Edit" button - all editing is inline */}
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <span className="text-xl">×</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[calc(100vh-200px)] overflow-y-auto">
          {/* v175a: CompanyDetailsSection now has inline edit */}
          <CompanyDetailsSection
            customer={customer}
            crmConfig={crmConfig}
            globalStaff={globalStaff}
            onUpdateCustomer={onUpdateCustomer}
          />

          {/* v175a: ContractSection now has inline edit */}
          <ContractSection customer={customer} onUpdateCustomer={onUpdateCustomer} />

          {/* v174b: ContactsListSection with inline editing */}
          <ContactsListSection
            contacts={customer.contacts}
            onUpdateContacts={onUpdateCustomer ? handleUpdateContacts : undefined}
          />

          {/* v175a: LinkedWorkSection with click-through */}
          <LinkedWorkSection
            customerId={customer.id}
            tickets={tickets}
            opCentres={opCentres}
            onTicketClick={onTicketClick}
          />

          {/* v174b: ActivityTimelineSection with inline editing */}
          <ActivityTimelineSection
            activities={customer.activities}
            globalStaff={globalStaff}
            onUpdateActivities={onUpdateCustomer ? handleUpdateActivities : undefined}
          />

          {/* v175a: DocumentsSection with inline editing */}
          <DocumentsSection
            documents={customer.documents}
            documentTypes={crmConfig?.documentTypes}
            onUpdateDocuments={onUpdateCustomer ? handleUpdateDocuments : undefined}
          />

          {/* v175a: AccountNotesSection (renamed from NotesSection) with inline edit */}
          <AccountNotesSection
            notes={customer.notes}
            onUpdateNotes={onUpdateCustomer ? handleUpdateNotes : undefined}
          />

          <CustomerModalFooter customer={customer} activities={customer.activities} />
        </div>
      </div>
    </div>
  );
}

// Export for use in app.jsx
window.Components = window.Components || {};
window.Components.CustomerDetailModal = CustomerDetailModal;

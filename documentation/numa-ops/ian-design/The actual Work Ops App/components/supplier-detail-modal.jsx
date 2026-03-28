/**
 * Supplier Detail Modal - v188a
 * Date: 2026-01-27
 *
 * v188a Changes:
 * - BUG-188-001 FIX: Added Company Name field to SupplierDetailsForm
 *   - Was missing after v187 removed basic SupplierModal
 *   - Now first field in the form, required, with prominent styling
 *
 * v187a Changes:
 * - UNIFIED ENTITY EDITING: This modal IS the full editor
 *   - REMOVED: onEdit prop and "Full Edit" button
 *   - All editing is done inline within this modal
 *   - Modal opens from Global Settings and Supplier Mirror (same behaviour)
 *   - New suppliers (empty companyName) auto-start Supplier Details in edit mode
 *
 * v186a Changes (BUG-185-001 FIX):
 * - CRITICAL: Renamed ALL shared component names to avoid collision with customer-detail-modal.jsx
 * - When both files load via Babel in browser, identical function names collide
 * - The supplier file's functions were overwriting customer file's functions
 * - Result: CustomerDetailModal sections received `supplier` prop instead of `customer`
 *
 * Renamed components (to avoid global scope collision):
 * - CompanyDetailsForm → SupplierDetailsForm
 * - CompanyDetailsSection → SupplierDetailsSection
 * - CommercialForm → SupplierCommercialForm
 * - CommercialSection → SupplierCommercialSection
 * - ContactForm → SupplierContactForm
 * - ContactCard → SupplierContactCard
 * - ContactsListSection → SupplierContactsSection
 * - LinkedWorkSection → SupplierLinkedWorkSection
 * - ActivityForm → SupplierActivityForm
 * - ActivityItem → SupplierActivityItem
 * - ActivityTimelineSection → SupplierActivitySection
 * - DocumentForm → SupplierDocumentForm
 * - DocumentCard → SupplierDocumentCard
 * - DocumentsSection → SupplierDocumentsSection
 *
 * v182b Changes (retained):
 * - DocumentForm, DocumentCard, DocumentsSection: Full CRUD with onUpdateSupplier callback
 * - SupplierNotesForm, SupplierNotesSection: inline edit mode
 *
 * v182a Changes (retained):
 * - Inline editing for all sections
 * - DeleteButton/EditButton helper components (teal theme)
 *
 * Features:
 * - Teal colour scheme (bg-teal-*, text-teal-*, border-teal-*)
 * - Terminology: Customer → Supplier, Account Owner → Relationship Owner
 * - Commercial section: annualSpend, paymentTerms instead of contractValue
 * - Uses supplierConfig instead of crmConfig
 *
 * Exported via: window.Components.SupplierDetailModal
 */

const { useState, useEffect, useMemo } = React;

// Register component version
window.ComponentVersions = window.ComponentVersions || {};
window.ComponentVersions['SupplierDetailModal'] = 'v188a';

// Icons
const { X, ExternalLink, Phone, Mail, User, Calendar, FileText, MessageSquare, Trash2, Edit2 } = window.Icons || {};

/**
 * Activity type icons mapping
 */
const ACTIVITY_ICONS = {
  call: '📞',
  email: '📧',
  meeting: '📅',
  review: '📋',
  audit: '🔍',
  delivery: '📦',
  note: '📝',
  default: '📋',
};

/**
 * Document type icons mapping
 */
const DOCUMENT_ICONS = {
  contract: '📜',
  quote: '💰',
  invoice: '🧾',
  certificate: '🏆',
  sla: '⚖️',
  specification: '📐',
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
 * Get icon for document type
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

  const contactTypes = ['call', 'email', 'meeting', 'review', 'audit'];
  const contactActivities = activities.filter((a) => contactTypes.includes(a.type));

  if (contactActivities.length === 0) return null;

  const sorted = [...contactActivities].sort((a, b) => new Date(b.date) - new Date(a.date));
  return sorted[0].date;
}

/**
 * Get tickets linked to this supplier
 */
function getLinkedTickets(supplierId, tickets) {
  if (!tickets || !supplierId) return [];
  return tickets
    .filter((t) => t.supplier === supplierId && t.status !== 'deleted')
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

/**
 * Get stage color from supplierConfig
 */
function getStageColor(stageId, supplierConfig) {
  if (!supplierConfig?.lifecycleStages) return null;

  const stage = supplierConfig.lifecycleStages.find((s) => s.id === stageId || s.name === stageId);
  if (!stage) return null;

  // Use ColorUtils if available
  if (window.ColorUtils) {
    return window.ColorUtils.getColorForPosition(stage.colorPosition);
  }

  return null;
}

/**
 * Get stage name from supplierConfig
 */
function getStageName(stageId, supplierConfig) {
  if (!supplierConfig?.lifecycleStages) return stageId;
  const stage = supplierConfig.lifecycleStages.find((s) => s.id === stageId || s.name === stageId);
  return stage?.name || stageId;
}

// ============================================
// v182a: DELETE/EDIT BUTTON COMPONENTS (Teal theme)
// ============================================

/**
 * v182a: Consistent delete button using Trash2 icon
 */
function DeleteButton({ onClick, title = 'Delete', className = '' }) {
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
 * v182a: Consistent edit button using Edit2 icon
 */
function EditButton({ onClick, title = 'Edit', className = '' }) {
  if (Edit2) {
    return (
      <button
        onClick={onClick}
        className={`p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-teal-600 transition-colors ${className}`}
        title={title}
      >
        <Edit2 size={14} />
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className={`p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-teal-600 transition-colors ${className}`}
      title={title}
    >
      ✎
    </button>
  );
}

// ============================================
// v182a: COMPANY DETAILS EDIT MODE
// ============================================

/**
 * v186a: Supplier Details Form (inline edit mode)
 * Renamed from CompanyDetailsForm to avoid collision with customer-detail-modal.jsx
 * v188a: Added companyName field
 */
function SupplierDetailsForm({ supplier, supplierConfig, globalStaff, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    companyName: supplier.companyName || '',
    industry: supplier.industry || '',
    companySize: supplier.companySize || '',
    supplierType: supplier.supplierType || '',
    territory: supplier.territory || '',
    accountOwnerId: supplier.accountOwnerId || supplier.relationshipOwnerId || '',
    stage: supplier.stage || '',
    website: supplier.website || '',
  });

  const industries = [
    'Technology',
    'Manufacturing',
    'Professional Services',
    'Construction',
    'Logistics',
    'Retail',
    'Finance',
    'Healthcare',
    'Other',
  ];
  const companySizes = ['1-10', '11-50', '51-200', '201-1000', '1001-5000', '5000+'];
  const supplierTypes = ['Vendor', 'Contractor', 'Consultant', 'Partner', 'Reseller', 'Other'];
  const territories = ['Auckland', 'Wellington', 'Canterbury', 'Waikato', 'Bay of Plenty', 'International', 'Other'];

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-teal-50 border border-teal-200 rounded-lg p-4">
      {/* v188a: Company Name field - first and prominent */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Company Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.companyName}
          onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium"
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
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
          <label className="block text-xs font-medium text-gray-600 mb-1">Supplier Type</label>
          <select
            value={formData.supplierType}
            onChange={(e) => setFormData({ ...formData, supplierType: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="">Select...</option>
            {supplierTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Territory</label>
          <select
            value={formData.territory}
            onChange={(e) => setFormData({ ...formData, territory: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
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
          <label className="block text-xs font-medium text-gray-600 mb-1">Relationship Owner</label>
          <select
            value={formData.accountOwnerId}
            onChange={(e) => setFormData({ ...formData, accountOwnerId: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="">Select...</option>
            {(supplierConfig?.lifecycleStages || []).map((s) => (
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
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
          className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
        >
          Save Changes
        </button>
      </div>
    </form>
  );
}

/**
 * v186a: Supplier Details Section - with edit mode
 * Renamed from CompanyDetailsSection to avoid collision with customer-detail-modal.jsx
 */
function SupplierDetailsSection({ supplier, supplierConfig, globalStaff, onUpdateSupplier }) {
  const [isEditing, setIsEditing] = useState(false);

  const relationshipOwner = globalStaff?.find(
    (s) => s.id === supplier.accountOwnerId || s.id === supplier.relationshipOwnerId
  );
  const stageColor = getStageColor(supplier.stage, supplierConfig);
  const stageName = getStageName(supplier.stage, supplierConfig);

  const handleSave = (formData) => {
    if (onUpdateSupplier) {
      onUpdateSupplier({
        industry: formData.industry,
        companySize: formData.companySize,
        supplierType: formData.supplierType,
        territory: formData.territory,
        accountOwnerId: formData.accountOwnerId,
        stage: formData.stage,
        website: formData.website,
      });
    }
    setIsEditing(false);
  };

  // v182a: Edit mode
  if (isEditing) {
    return (
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Company Details</h3>
        </div>
        <SupplierDetailsForm
          supplier={supplier}
          supplierConfig={supplierConfig}
          globalStaff={globalStaff}
          onSave={handleSave}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  // View mode
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Company Details</h3>
        {onUpdateSupplier && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-xs text-teal-600 hover:text-teal-800 hover:underline"
          >
            Edit
          </button>
        )}
      </div>
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Industry:</span>
            <span className="ml-2 text-gray-900">{supplier.industry || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Size:</span>
            <span className="ml-2 text-gray-900">{supplier.companySize || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Type:</span>
            <span className="ml-2 text-gray-900">{supplier.supplierType || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Territory:</span>
            <span className="ml-2 text-gray-900">{supplier.territory || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Relationship Owner:</span>
            <span className="ml-2 text-gray-900">{relationshipOwner?.name || '—'}</span>
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
          {supplier.website && (
            <div className="col-span-2 md:col-span-3">
              <span className="text-gray-500">Website:</span>
              <a
                href={supplier.website.startsWith('http') ? supplier.website : `https://${supplier.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-teal-600 hover:text-teal-800 hover:underline inline-flex items-center gap-1"
              >
                {supplier.website}
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
// v182a: COMMERCIAL SECTION EDIT MODE
// ============================================

/**
 * v186a: Supplier Commercial Form (inline edit mode)
 * Renamed to avoid collision
 */
function SupplierCommercialForm({ supplier, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    annualSpend: supplier.annualSpend || '',
    paymentTerms: supplier.paymentTerms || '',
    contractStartDate: supplier.contractStartDate ? supplier.contractStartDate.split('T')[0] : '',
    contractEndDate: supplier.contractEndDate
      ? supplier.contractEndDate.split('T')[0]
      : supplier.renewalDate
        ? supplier.renewalDate.split('T')[0]
        : '',
    productsServices: (supplier.productsServices || []).join(', '),
    serviceNotes: supplier.serviceNotes || '',
  });

  const paymentTermsOptions = ['Net 7', 'Net 14', 'Net 20', 'Net 30', 'Net 45', 'Net 60', 'COD', 'Prepaid', 'Other'];

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      annualSpend: formData.annualSpend ? Number(formData.annualSpend) : null,
      paymentTerms: formData.paymentTerms,
      contractStartDate: formData.contractStartDate || null,
      contractEndDate: formData.contractEndDate || null,
      renewalDate: formData.contractEndDate || null, // Keep in sync
      productsServices: formData.productsServices
        ? formData.productsServices
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      serviceNotes: formData.serviceNotes,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-teal-50 border border-teal-200 rounded-lg p-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Annual Spend ($)</label>
          <input
            type="number"
            value={formData.annualSpend}
            onChange={(e) => setFormData({ ...formData, annualSpend: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="0"
            min="0"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Payment Terms</label>
          <select
            value={formData.paymentTerms}
            onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="">Select...</option>
            {paymentTermsOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Contract Start</label>
          <input
            type="date"
            value={formData.contractStartDate}
            onChange={(e) => setFormData({ ...formData, contractStartDate: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Contract End</label>
          <input
            type="date"
            value={formData.contractEndDate}
            onChange={(e) => setFormData({ ...formData, contractEndDate: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Products/Services (comma-separated)</label>
          <input
            type="text"
            value={formData.productsServices}
            onChange={(e) => setFormData({ ...formData, productsServices: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="e.g., Consulting, Development, Support"
          />
        </div>
        <div className="col-span-2 md:col-span-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">Service Notes</label>
          <textarea
            value={formData.serviceNotes}
            onChange={(e) => setFormData({ ...formData, serviceNotes: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            rows={2}
            placeholder="Any notes about the commercial relationship..."
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
          className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
        >
          Save Changes
        </button>
      </div>
    </form>
  );
}

/**
 * v186a: Supplier Commercial Section - with edit mode
 * Shows: Annual Spend, Payment Terms, Contract Dates, Services/Products
 * Renamed to avoid collision
 */
function SupplierCommercialSection({ supplier, onUpdateSupplier }) {
  const [isEditing, setIsEditing] = useState(false);

  const daysToExpiry = daysUntil(supplier.contractEndDate || supplier.renewalDate);
  let expiryStatus = '';
  let expiryColor = 'text-gray-600';

  if (daysToExpiry !== null) {
    if (daysToExpiry < 0) {
      expiryStatus = `(${Math.abs(daysToExpiry)} days overdue)`;
      expiryColor = 'text-red-600 font-medium';
    } else if (daysToExpiry <= 30) {
      expiryStatus = `(in ${daysToExpiry} days)`;
      expiryColor = 'text-orange-600 font-medium';
    } else if (daysToExpiry <= 90) {
      expiryStatus = `(in ${daysToExpiry} days)`;
      expiryColor = 'text-yellow-600';
    } else {
      expiryStatus = `(in ${daysToExpiry} days)`;
    }
  }

  const handleSave = (formData) => {
    if (onUpdateSupplier) {
      onUpdateSupplier(formData);
    }
    setIsEditing(false);
  };

  // v182a: Edit mode
  if (isEditing) {
    return (
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Commercial</h3>
        </div>
        <SupplierCommercialForm supplier={supplier} onSave={handleSave} onCancel={() => setIsEditing(false)} />
      </div>
    );
  }

  // View mode
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Commercial</h3>
        {onUpdateSupplier && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-xs text-teal-600 hover:text-teal-800 hover:underline"
          >
            Edit
          </button>
        )}
      </div>
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Annual Spend:</span>
            <span className="ml-2 text-gray-900 font-medium">{formatCurrency(supplier.annualSpend)}/yr</span>
          </div>
          <div>
            <span className="text-gray-500">Payment Terms:</span>
            <span className="ml-2 text-gray-900">{supplier.paymentTerms || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Contract Start:</span>
            <span className="ml-2 text-gray-900">{formatDate(supplier.contractStartDate)}</span>
          </div>
          <div className="col-span-2 md:col-span-3">
            <span className="text-gray-500">Contract End:</span>
            <span className="ml-2 text-gray-900">{formatDate(supplier.contractEndDate || supplier.renewalDate)}</span>
            {expiryStatus && <span className={`ml-2 ${expiryColor}`}>{expiryStatus}</span>}
          </div>
          {supplier.productsServices && supplier.productsServices.length > 0 && (
            <div className="col-span-2 md:col-span-3">
              <span className="text-gray-500">Products/Services:</span>
              <span className="ml-2 text-gray-900">{supplier.productsServices.join(', ')}</span>
            </div>
          )}
          {supplier.serviceNotes && (
            <div className="col-span-2 md:col-span-3">
              <span className="text-gray-500">Notes:</span>
              <span className="ml-2 text-gray-900">{supplier.serviceNotes}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// v182a: CONTACT MANAGEMENT COMPONENTS
// ============================================

/**
 * v186a: Supplier Contact Form (used for Add and Edit)
 * Renamed to avoid collision with customer-detail-modal.jsx
 */
function SupplierContactForm({ contact, onSave, onCancel }) {
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
    <form onSubmit={handleSubmit} className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-3">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="e.g., Account Manager, Sales Rep"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="email@example.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
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
            className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
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
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
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
          className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
        >
          {contact ? 'Save Changes' : 'Add Contact'}
        </button>
      </div>
    </form>
  );
}

/**
 * v186a: Supplier Contact Card with action buttons
 * Renamed to avoid collision with customer-detail-modal.jsx
 */
function SupplierContactCard({ contact, onEdit, onDelete, onTogglePrimary, onToggleVip }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 hover:border-teal-200 transition-colors group">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-gray-900 truncate">{contact.name}</span>
            {contact.isPrimary && (
              <span className="text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded font-medium">Primary</span>
            )}
            {contact.isVip && (
              <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">VIP</span>
            )}
          </div>
          {contact.role && <div className="text-sm text-gray-600 mb-1">{contact.role}</div>}
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="hover:text-teal-600 flex items-center gap-1">
                <span>✉️</span> {contact.email}
              </a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className="hover:text-teal-600 flex items-center gap-1">
                <span>📞</span> {contact.phone}
              </a>
            )}
          </div>
          {contact.notes && <div className="mt-2 text-xs text-gray-500 italic">{contact.notes}</div>}
        </div>

        {/* v182a: Action buttons - appear on hover */}
        {(onEdit || onDelete) && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
            {onTogglePrimary && (
              <button
                onClick={() => onTogglePrimary(contact.id)}
                className={`p-1.5 rounded hover:bg-gray-200 transition-colors ${contact.isPrimary ? 'text-teal-500' : 'text-gray-400'}`}
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
 * v186a: Supplier Contacts Section - Full CRUD
 * Renamed to avoid collision with customer-detail-modal.jsx
 */
function SupplierContactsSection({ contacts, onUpdateSupplier }) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingContact, setEditingContact] = useState(null);

  const sortedContacts = useMemo(() => {
    if (!contacts || contacts.length === 0) return [];
    return [...contacts].sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      if (a.isVip && !b.isVip) return -1;
      if (!a.isVip && b.isVip) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [contacts]);

  // v182a: Add contact
  const handleAddContact = (newContact) => {
    if (onUpdateSupplier) {
      onUpdateSupplier({
        contacts: [...(contacts || []), newContact],
      });
    }
    setIsAdding(false);
  };

  // v182a: Edit contact
  const handleEditContact = (updatedContact) => {
    if (onUpdateSupplier) {
      onUpdateSupplier({
        contacts: (contacts || []).map((c) => (c.id === updatedContact.id ? updatedContact : c)),
      });
    }
    setEditingContact(null);
  };

  // v182a: Delete contact
  const handleDeleteContact = (contactId) => {
    if (onUpdateSupplier && window.confirm('Delete this contact?')) {
      onUpdateSupplier({
        contacts: (contacts || []).filter((c) => c.id !== contactId),
      });
    }
  };

  // v182a: Toggle primary
  const handleTogglePrimary = (contactId) => {
    if (onUpdateSupplier) {
      onUpdateSupplier({
        contacts: (contacts || []).map((c) => ({
          ...c,
          isPrimary: c.id === contactId ? !c.isPrimary : c.isPrimary,
        })),
      });
    }
  };

  // v182a: Toggle VIP
  const handleToggleVip = (contactId) => {
    if (onUpdateSupplier) {
      onUpdateSupplier({
        contacts: (contacts || []).map((c) => ({
          ...c,
          isVip: c.id === contactId ? !c.isVip : c.isVip,
        })),
      });
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Contacts ({contacts?.length || 0})
        </h3>
        {onUpdateSupplier && !isAdding && !editingContact && (
          <button
            onClick={() => setIsAdding(true)}
            className="text-xs text-teal-600 hover:text-teal-800 hover:underline"
          >
            + Add Contact
          </button>
        )}
      </div>

      {/* v186a: Add form */}
      {isAdding && <SupplierContactForm contact={null} onSave={handleAddContact} onCancel={() => setIsAdding(false)} />}

      {/* v186a: Edit form */}
      {editingContact && (
        <SupplierContactForm
          contact={editingContact}
          onSave={handleEditContact}
          onCancel={() => setEditingContact(null)}
        />
      )}

      {sortedContacts.length === 0 && !isAdding ? (
        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500 italic">No contacts recorded.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sortedContacts.map((contact) => (
            <SupplierContactCard
              key={contact.id}
              contact={contact}
              onEdit={onUpdateSupplier && !editingContact && !isAdding ? setEditingContact : null}
              onDelete={onUpdateSupplier && !editingContact && !isAdding ? handleDeleteContact : null}
              onTogglePrimary={onUpdateSupplier && !editingContact && !isAdding ? handleTogglePrimary : null}
              onToggleVip={onUpdateSupplier && !editingContact && !isAdding ? handleToggleVip : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// LINKED WORK SECTION (View Only - unchanged)
// ============================================

/**
 * v186a: Supplier Linked Work Section - Shows tickets linked to this supplier
 * Renamed to avoid collision with customer-detail-modal.jsx
 */
function SupplierLinkedWorkSection({ supplierId, tickets, opCentres, onTicketClick }) {
  const linkedTickets = useMemo(() => getLinkedTickets(supplierId, tickets), [supplierId, tickets]);

  const getTicketTypeInfo = (ticket) => {
    const globalTypes = window.INITIAL_DATA?.company?.globalTicketTypes || [];
    const type = globalTypes.find((t) => t.id === ticket.typeId);
    return type || { icon: '📋', name: 'Unknown' };
  };

  const getWorkCentreName = (ticket) => {
    if (!opCentres) return '—';
    for (const wc of opCentres) {
      for (const board of wc.boards || []) {
        for (const zone of board.workZones || []) {
          for (const stage of zone.stages || []) {
            if (stage.tickets?.includes(ticket.id)) {
              return wc.name;
            }
          }
        }
      }
    }
    return '—';
  };

  const getStatusDisplay = (status) => {
    const statusMap = {
      new: { label: 'New', color: 'bg-gray-100 text-gray-700' },
      backlog: { label: 'Backlog', color: 'bg-gray-100 text-gray-700' },
      ready: { label: 'Ready', color: 'bg-blue-100 text-blue-700' },
      todo: { label: 'To Do', color: 'bg-blue-100 text-blue-700' },
      'in-progress': { label: 'In Progress', color: 'bg-yellow-100 text-yellow-700' },
      blocked: { label: 'Blocked', color: 'bg-red-100 text-red-700' },
      review: { label: 'Review', color: 'bg-purple-100 text-purple-700' },
      completed: { label: 'Completed', color: 'bg-green-100 text-green-700' },
      cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-500' },
    };
    return statusMap[status] || { label: status, color: 'bg-gray-100 text-gray-700' };
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Linked Work ({linkedTickets.length})
        </h3>
      </div>

      {linkedTickets.length === 0 ? (
        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500 italic">
          No tickets linked to this supplier.
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Summary</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Work Centre</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {linkedTickets.slice(0, 10).map((ticket) => {
                const typeInfo = getTicketTypeInfo(ticket);
                const statusInfo = getStatusDisplay(ticket.status);

                return (
                  <tr
                    key={ticket.id}
                    className={`hover:bg-teal-50 ${onTicketClick ? 'cursor-pointer' : ''}`}
                    onClick={() => onTicketClick && onTicketClick(ticket)}
                  >
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <span>{typeInfo.icon}</span>
                        <span className="font-mono text-xs text-gray-600">{ticket.key || ticket.id}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-900 truncate max-w-xs">{ticket.name}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${statusInfo.color}`}>{statusInfo.label}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{getWorkCentreName(ticket)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {linkedTickets.length > 10 && (
            <div className="px-3 py-2 bg-gray-50 text-xs text-gray-500 text-center border-t border-gray-200">
              Showing 10 of {linkedTickets.length} linked tickets
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// v182a: ACTIVITY MANAGEMENT COMPONENTS
// ============================================

/**
 * v186a: Supplier Activity Form (used for Add and Edit)
 * Renamed to avoid collision with customer-detail-modal.jsx
 */
function SupplierActivityForm({ activity, globalStaff, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    type: activity?.type || 'call',
    direction: activity?.direction || 'outbound',
    date: activity?.date ? new Date(activity.date).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
    duration: activity?.duration || '',
    summary: activity?.summary || '',
    outcome: activity?.outcome || 'neutral',
    staffId: activity?.staffId || '',
  });

  const activityTypes = [
    { id: 'call', label: 'Phone Call', icon: '📞' },
    { id: 'email', label: 'Email', icon: '📧' },
    { id: 'meeting', label: 'Meeting', icon: '📅' },
    { id: 'review', label: 'Review', icon: '📋' },
    { id: 'audit', label: 'Audit', icon: '🔍' },
    { id: 'delivery', label: 'Delivery', icon: '📦' },
    { id: 'note', label: 'Note', icon: '📝' },
  ];

  const directions = ['inbound', 'outbound'];
  const outcomes = ['positive', 'neutral', 'negative'];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.summary.trim()) return;

    onSave({
      id: activity?.id || `act-${Date.now()}`,
      ...formData,
      summary: formData.summary.trim(),
      duration: formData.duration ? Number(formData.duration) : null,
      source: 'manual',
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Type *</label>
          <select
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {activityTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon} {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Direction</label>
          <select
            value={formData.direction}
            onChange={(e) => setFormData({ ...formData, direction: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {directions.map((d) => (
              <option key={d} value={d}>
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date/Time</label>
          <input
            type="datetime-local"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Duration (mins)</label>
          <input
            type="number"
            value={formData.duration}
            onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="30"
            min="0"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Outcome</label>
          <select
            value={formData.outcome}
            onChange={(e) => setFormData({ ...formData, outcome: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {outcomes.map((o) => (
              <option key={o} value={o}>
                {o.charAt(0).toUpperCase() + o.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Staff Member</label>
          <select
            value={formData.staffId}
            onChange={(e) => setFormData({ ...formData, staffId: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="">Select...</option>
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
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          rows={2}
          placeholder="Brief summary of the activity..."
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
          className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
        >
          {activity ? 'Save Changes' : 'Add Activity'}
        </button>
      </div>
    </form>
  );
}

/**
 * v186a: Supplier Activity Item with action buttons
 * Renamed to avoid collision with customer-detail-modal.jsx
 */
function SupplierActivityItem({ activity, globalStaff, onEdit, onDelete }) {
  const staffMember = globalStaff?.find((s) => s.id === activity.staffId);

  const getOutcomeColor = (outcome) => {
    const colors = {
      positive: 'text-green-600',
      negative: 'text-red-600',
      neutral: 'text-gray-600',
    };
    return colors[outcome] || 'text-gray-600';
  };

  return (
    <div className="flex gap-3 py-3 border-b border-gray-100 last:border-0 group">
      <div className="text-xl flex-shrink-0">{getActivityIcon(activity.type)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-gray-900 text-sm capitalize">{activity.type}</span>
          {activity.direction && <span className="text-xs text-gray-500">({activity.direction})</span>}
          {activity.outcome && (
            <span className={`text-xs ${getOutcomeColor(activity.outcome)} capitalize`}>• {activity.outcome}</span>
          )}
        </div>
        <div className="text-sm text-gray-700">{activity.summary}</div>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span>{formatRelativeDate(activity.date)}</span>
          {staffMember && <span>by {staffMember.name}</span>}
          {activity.duration && <span>{activity.duration} mins</span>}
        </div>
      </div>

      {/* v182a: Action buttons */}
      {(onEdit || onDelete) && (
        <div className="flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && <EditButton onClick={() => onEdit(activity)} title="Edit activity" />}
          {onDelete && <DeleteButton onClick={() => onDelete(activity.id)} title="Delete activity" />}
        </div>
      )}
    </div>
  );
}

/**
 * v186a: Supplier Activity Section - Full CRUD
 * Renamed to avoid collision with customer-detail-modal.jsx
 */
function SupplierActivitySection({ activities, globalStaff, onUpdateSupplier }) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingActivity, setEditingActivity] = useState(null);

  const sortedActivities = useMemo(() => {
    if (!activities || activities.length === 0) return [];
    return [...activities].sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [activities]);

  // v182a: Add activity
  const handleAddActivity = (newActivity) => {
    if (onUpdateSupplier) {
      onUpdateSupplier({
        activities: [...(activities || []), newActivity],
      });
    }
    setIsAdding(false);
  };

  // v182a: Edit activity
  const handleEditActivity = (updatedActivity) => {
    if (onUpdateSupplier) {
      onUpdateSupplier({
        activities: (activities || []).map((a) => (a.id === updatedActivity.id ? updatedActivity : a)),
      });
    }
    setEditingActivity(null);
  };

  // v182a: Delete activity
  const handleDeleteActivity = (activityId) => {
    if (onUpdateSupplier && window.confirm('Delete this activity?')) {
      onUpdateSupplier({
        activities: (activities || []).filter((a) => a.id !== activityId),
      });
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Activity ({activities?.length || 0})
        </h3>
        {onUpdateSupplier && !isAdding && !editingActivity && (
          <button
            onClick={() => setIsAdding(true)}
            className="text-xs text-teal-600 hover:text-teal-800 hover:underline"
          >
            + Add Activity
          </button>
        )}
      </div>

      {/* v186a: Add form */}
      {isAdding && (
        <SupplierActivityForm
          activity={null}
          globalStaff={globalStaff}
          onSave={handleAddActivity}
          onCancel={() => setIsAdding(false)}
        />
      )}

      {/* v186a: Edit form */}
      {editingActivity && (
        <SupplierActivityForm
          activity={editingActivity}
          globalStaff={globalStaff}
          onSave={handleEditActivity}
          onCancel={() => setEditingActivity(null)}
        />
      )}

      {sortedActivities.length === 0 && !isAdding ? (
        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500 italic">No activity recorded.</div>
      ) : (
        <div className="bg-gray-50 rounded-lg p-4 max-h-64 overflow-y-auto">
          {sortedActivities.map((activity) => (
            <SupplierActivityItem
              key={activity.id}
              activity={activity}
              globalStaff={globalStaff}
              onEdit={onUpdateSupplier && !editingActivity && !isAdding ? setEditingActivity : null}
              onDelete={onUpdateSupplier && !editingActivity && !isAdding ? handleDeleteActivity : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// v182b: DOCUMENTS SECTION WITH CRUD
// ============================================

/**
 * v186a: Supplier Document Form (used for Add and Edit)
 * Renamed to avoid collision with customer-detail-modal.jsx
 */
function SupplierDocumentForm({ document, documentTypes, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    name: document?.name || '',
    url: document?.url || '',
    type: document?.type || 'other',
    notes: document?.notes || '',
  });

  // Default document types for suppliers if not provided via supplierConfig
  const defaultDocTypes = [
    { id: 'contract', name: 'Contract' },
    { id: 'quote', name: 'Quote' },
    { id: 'invoice', name: 'Invoice' },
    { id: 'certificate', name: 'Certificate' },
    { id: 'sla', name: 'SLA' },
    { id: 'specification', name: 'Specification' },
    { id: 'insurance', name: 'Insurance' },
    { id: 'compliance', name: 'Compliance' },
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
    <form onSubmit={handleSubmit} className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-3">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="e.g., Service Agreement 2026"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
          <select
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
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
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          placeholder="https://docs.google.com/..."
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
        <textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
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
          className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
        >
          {document ? 'Save Changes' : 'Add Document'}
        </button>
      </div>
    </form>
  );
}

/**
 * v186a: Supplier Document Card with hover action buttons
 * Renamed to avoid collision with customer-detail-modal.jsx
 */
function SupplierDocumentCard({ document, documentTypes, onEdit, onDelete }) {
  const docTypeName = documentTypes?.find((t) => t.id === document.type)?.name || document.type || 'Document';

  return (
    <div className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-teal-200 transition-colors group">
      <span className="text-xl">{getDocumentIcon(document.type)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">{docTypeName}</span>
          <span className="font-medium text-gray-900 truncate">{document.name}</span>
          {document.url && (
            <a
              href={document.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-600 hover:text-teal-800 text-sm flex-shrink-0"
              title="Open document"
              onClick={(e) => e.stopPropagation()}
            >
              ↗
            </a>
          )}
        </div>
        {document.notes && <p className="text-sm text-gray-500 mt-1">{document.notes}</p>}
        {document.addedAt && <p className="text-xs text-gray-400 mt-1">Added {formatRelativeDate(document.addedAt)}</p>}
      </div>

      {/* v182b: Hover actions */}
      {(onEdit || onDelete) && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && <EditButton onClick={() => onEdit(document)} title="Edit document" />}
          {onDelete && <DeleteButton onClick={() => onDelete(document.id)} title="Delete document" />}
        </div>
      )}
    </div>
  );
}

/**
 * v186a: Supplier Documents Section with full CRUD
 * Renamed to avoid collision with customer-detail-modal.jsx
 */
function SupplierDocumentsSection({ documents, documentTypes, onUpdateSupplier }) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingDocument, setEditingDocument] = useState(null);

  // v182b: Add document
  const handleAddDocument = (newDoc) => {
    if (onUpdateSupplier) {
      onUpdateSupplier({
        documents: [...(documents || []), newDoc],
      });
    }
    setIsAdding(false);
  };

  // v182b: Edit document
  const handleEditDocument = (updatedDoc) => {
    if (onUpdateSupplier) {
      onUpdateSupplier({
        documents: (documents || []).map((d) => (d.id === updatedDoc.id ? updatedDoc : d)),
      });
    }
    setEditingDocument(null);
  };

  // v182b: Delete document
  const handleDeleteDocument = (docId) => {
    if (onUpdateSupplier && window.confirm('Delete this document?')) {
      onUpdateSupplier({
        documents: (documents || []).filter((d) => d.id !== docId),
      });
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Documents ({documents?.length || 0})
        </h3>
        {onUpdateSupplier && !isAdding && !editingDocument && (
          <button
            onClick={() => setIsAdding(true)}
            className="text-xs text-teal-600 hover:text-teal-800 hover:underline"
          >
            + Add Document
          </button>
        )}
      </div>

      {/* v186a: Add form */}
      {isAdding && (
        <SupplierDocumentForm
          document={null}
          documentTypes={documentTypes}
          onSave={handleAddDocument}
          onCancel={() => setIsAdding(false)}
        />
      )}

      {(!documents || documents.length === 0) && !isAdding ? (
        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500 italic">No documents attached.</div>
      ) : (
        <div className="space-y-2">
          {(documents || []).map((doc) =>
            editingDocument?.id === doc.id ? (
              <SupplierDocumentForm
                key={doc.id}
                document={doc}
                documentTypes={documentTypes}
                onSave={handleEditDocument}
                onCancel={() => setEditingDocument(null)}
              />
            ) : (
              <SupplierDocumentCard
                key={doc.id}
                document={doc}
                documentTypes={documentTypes}
                onEdit={onUpdateSupplier && !editingDocument && !isAdding ? setEditingDocument : null}
                onDelete={onUpdateSupplier && !editingDocument && !isAdding ? handleDeleteDocument : null}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// v182b: NOTES SECTION WITH EDIT
// ============================================

/**
 * v182b: Supplier Notes Form (inline edit mode)
 */
function SupplierNotesForm({ notes, onSave, onCancel }) {
  const [formData, setFormData] = useState(notes || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-teal-50 border border-teal-200 rounded-lg p-4">
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Supplier Notes</label>
        <textarea
          value={formData}
          onChange={(e) => setFormData(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          rows={5}
          placeholder="General notes about this supplier..."
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
          className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
        >
          Save Notes
        </button>
      </div>
    </form>
  );
}

/**
 * v182b: Supplier Notes Section with inline edit
 */
function SupplierNotesSection({ notes, onUpdateSupplier }) {
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = (newNotes) => {
    if (onUpdateSupplier) {
      onUpdateSupplier({ notes: newNotes });
    }
    setIsEditing(false);
  };

  // v182b: Edit mode
  if (isEditing) {
    return (
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Supplier Notes</h3>
        <SupplierNotesForm notes={notes} onSave={handleSave} onCancel={() => setIsEditing(false)} />
      </div>
    );
  }

  // View mode
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Supplier Notes</h3>
        {onUpdateSupplier && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-xs text-teal-600 hover:text-teal-800 hover:underline"
          >
            Edit
          </button>
        )}
      </div>
      {!notes ? (
        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500 italic">No supplier notes.</div>
      ) : (
        <div
          className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: notes }}
        />
      )}
    </div>
  );
}

// ============================================
// SUPPLIER FLAGS DISPLAY
// ============================================

/**
 * Supplier Flags Display - shows flag icons in header
 */
function SupplierFlagsDisplay({ supplierFlags, supplierConfig }) {
  if (!supplierFlags || supplierFlags.length === 0) return null;

  const flagConfigs = supplierFlags
    .map((flagId) => (supplierConfig?.supplierFlags || []).find((f) => f.id === flagId))
    .filter(Boolean);

  if (flagConfigs.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {flagConfigs.map((flag) => (
        <span key={flag.id} title={flag.name} className="text-lg" style={{ color: flag.color }}>
          {flag.icon}
        </span>
      ))}
    </div>
  );
}

// ============================================
// FOOTER SECTION
// ============================================

/**
 * Supplier Modal Footer - created/updated dates, last contact
 */
function SupplierModalFooter({ supplier, activities }) {
  const lastContactDate = calculateLastContactDate(activities);

  return (
    <div className="pt-4 border-t border-gray-200 text-xs text-gray-500">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {supplier.createdAt && <span>Created: {formatDate(supplier.createdAt)}</span>}
        {supplier.updatedAt && <span>Updated: {formatRelativeDate(supplier.updatedAt)}</span>}
        {lastContactDate && <span>Last contact: {formatRelativeDate(lastContactDate)}</span>}
      </div>
    </div>
  );
}

// ============================================
// MAIN MODAL COMPONENT
// ============================================

/**
 * Supplier Detail Modal
 * Main component - displays complete supplier information
 * v187a: This modal IS the full editor (removed onEdit and Full Edit button)
 * v182a: Inline editing for Company Details, Commercial, Contacts, Activities
 */
function SupplierDetailModal({
  supplier,
  isOpen,
  onClose,
  // v187a: Removed onEdit prop - this modal IS the full editor
  onUpdateSupplier, // v182a: Callback for inline edits
  onTicketClick, // Callback for opening TicketModal from Linked Work (future)
  tickets, // All tickets for linked work lookup
  opCentres, // For linked work display
  globalStaff, // For displaying relationship owner name
  supplierConfig, // For stage colors, flags config
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

  // v182a: Wrapper for inline updates
  const handleInlineUpdate = (updates) => {
    if (onUpdateSupplier && supplier) {
      onUpdateSupplier(supplier.id, updates);
    }
  };

  if (!isOpen || !supplier) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center z-[9999] p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        {/* Header - Teal theme */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-teal-50">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-gray-900">{supplier.companyName || '(New Supplier)'}</h2>
            <SupplierFlagsDisplay supplierFlags={supplier.flags} supplierConfig={supplierConfig} />
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
          {/* v186a: Supplier Details with edit mode */}
          <SupplierDetailsSection
            supplier={supplier}
            supplierConfig={supplierConfig}
            globalStaff={globalStaff}
            onUpdateSupplier={onUpdateSupplier ? handleInlineUpdate : null}
          />

          {/* v186a: Commercial with edit mode */}
          <SupplierCommercialSection
            supplier={supplier}
            onUpdateSupplier={onUpdateSupplier ? handleInlineUpdate : null}
          />

          {/* v186a: Contacts full CRUD */}
          <SupplierContactsSection
            contacts={supplier.contacts}
            onUpdateSupplier={onUpdateSupplier ? handleInlineUpdate : null}
          />

          {/* v186a: Linked Work */}
          <SupplierLinkedWorkSection
            supplierId={supplier.id}
            tickets={tickets}
            opCentres={opCentres}
            onTicketClick={onTicketClick}
          />

          {/* v186a: Activity Timeline full CRUD */}
          <SupplierActivitySection
            activities={supplier.activities}
            globalStaff={globalStaff}
            onUpdateSupplier={onUpdateSupplier ? handleInlineUpdate : null}
          />

          {/* v186a: Documents full CRUD */}
          <SupplierDocumentsSection
            documents={supplier.documents}
            documentTypes={supplierConfig?.documentTypes}
            onUpdateSupplier={onUpdateSupplier ? handleInlineUpdate : null}
          />

          {/* Supplier Notes - v182b: with edit mode */}
          <SupplierNotesSection
            notes={supplier.notes}
            onUpdateSupplier={onUpdateSupplier ? handleInlineUpdate : null}
          />

          {/* Footer */}
          <SupplierModalFooter supplier={supplier} activities={supplier.activities} />
        </div>
      </div>
    </div>
  );
}

// Export for use in app.jsx
window.Components = window.Components || {};
window.Components.SupplierDetailModal = SupplierDetailModal;

console.log('[supplier-detail-modal.jsx] SupplierDetailModal loaded (v182b)');

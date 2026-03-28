/**
 * Ticket Type Modal - v153
 * Extracted from app.jsx
 *
 * Dependencies:
 * - window.Components.EntityModals.CustomFieldModal
 * - window.FIELD_LIBRARY_NORMALIZED
 *
 * v153 Changes:
 * - Added component version registry support
 */

(function () {
  'use strict';

  // v153: Component version for registry
  const COMPONENT_VERSION = 'v153';

  const { useState } = React;

  // TicketTypeModal - extracted verbatim from v089App.jsx lines 3968-4568
  const TicketTypeModal = ({ type, company, onSave, onClose }) => {
    // Lookup CustomFieldModal at render time (IIFE scope fix)
    const CustomFieldModal = window.Components?.EntityModals?.CustomFieldModal;

    const [name, setName] = useState(type?.name || '');
    const [icon, setIcon] = useState(type?.icon || '✨');
    const [color, setColor] = useState(type?.color || 'blue');
    const [prefix, setPrefix] = useState(type?.prefix || '');
    const [selectedFields, setSelectedFields] = useState(type?.fields || ['name', 'description']);
    const [fieldConfigs, setFieldConfigs] = useState(type?.fieldConfigs || {});
    const [expandedField, setExpandedField] = useState(null);
    const [showCustomFieldModal, setShowCustomFieldModal] = useState(false);
    const [customFields, setCustomFields] = useState(type?.customFields || []);
    const [customFieldForm, setCustomFieldForm] = useState({
      label: '',
      type: 'text',
      required: false,
      placeholder: '',
      helpText: '',
      options: [],
      category: 'custom',
    });

    // Track if changes have been made
    const isEditing = !!type;
    const hasChanges = isEditing
      ? name !== type.name ||
        icon !== type.icon ||
        color !== type.color ||
        prefix !== type.prefix ||
        JSON.stringify(selectedFields.sort()) !== JSON.stringify((type.fields || []).sort()) ||
        JSON.stringify(fieldConfigs) !== JSON.stringify(type.fieldConfigs || {}) ||
        JSON.stringify(customFields) !== JSON.stringify(type.customFields || [])
      : name.trim() !== '' && prefix.trim() !== ''; // For new type, enable when required fields filled

    // Get prefix registry for validation and info
    const prefixRegistry = company?.prefixRegistry || [];

    // Check if prefix exists in registry
    const existingRegistryEntry = prefixRegistry.find((p) => p.prefix === prefix.toUpperCase());

    // Get ticket types using this prefix (for info display)
    const typesUsingPrefix = (company?.globalTicketTypes || [])
      .filter((t) => t.prefix?.toUpperCase() === prefix.toUpperCase())
      .filter((t) => !type || t.id !== type.id); // Exclude current type when editing

    // Find similar prefixes for typeahead warning (e.g., typing "SER" shows "SERV exists")
    const similarPrefixes =
      prefix.length > 0
        ? prefixRegistry
            .filter((p) => p.prefix.startsWith(prefix.toUpperCase()) && p.prefix !== prefix.toUpperCase())
            .map((p) => p.prefix)
        : [];

    // Prefix is valid if: has content, max 8 chars
    // Note: sharing an existing prefix is allowed!
    const isPrefixValid = prefix.length > 0 && prefix.length <= 8;

    const handleToggleField = (fieldId) => {
      if (selectedFields.includes(fieldId)) {
        // Don't allow removing 'name' - it's always required
        if (fieldId === 'name') return;

        const newSelected = selectedFields.filter((f) => f !== fieldId);
        setSelectedFields(newSelected);

        // Remove config for this field
        const newConfigs = { ...fieldConfigs };
        delete newConfigs[fieldId];
        setFieldConfigs(newConfigs);
      } else {
        setSelectedFields([...selectedFields, fieldId]);
        // Set default config
        setFieldConfigs({
          ...fieldConfigs,
          [fieldId]: { required: false },
        });
      }
    };

    const handleToggleRequired = (fieldId) => {
      setFieldConfigs({
        ...fieldConfigs,
        [fieldId]: {
          ...(fieldConfigs[fieldId] || {}),
          required: !(fieldConfigs[fieldId]?.required || false),
        },
      });
    };

    const handleAddCustomField = () => {
      const customField = {
        id: `custom-${Date.now()}`,
        ...customFieldForm,
      };
      const newCustomFields = [...customFields, customField];
      setCustomFields(newCustomFields);
      // Auto-add to selected fields
      setSelectedFields([...selectedFields, customField.id]);
      setFieldConfigs({
        ...fieldConfigs,
        [customField.id]: { required: customField.required || false },
      });
      setShowCustomFieldModal(false);
      setCustomFieldForm({
        label: '',
        type: 'text',
        required: false,
        placeholder: '',
        helpText: '',
        options: [],
        category: 'custom',
      });
    };

    const handleDeleteCustomField = (fieldId) => {
      setCustomFields(customFields.filter((f) => f.id !== fieldId));
      setSelectedFields(selectedFields.filter((f) => f !== fieldId));
      const newConfigs = { ...fieldConfigs };
      delete newConfigs[fieldId];
      setFieldConfigs(newConfigs);
    };

    const handleSave = () => {
      if (!name.trim()) {
        alert('Please enter a ticket type name');
        return;
      }

      if (!prefix.trim()) {
        alert('Please enter a ticket prefix (e.g., TASK, BUG, FEAT)');
        return;
      }

      if (prefix.length > 8) {
        alert('Prefix must be 8 characters or less');
        return;
      }

      if (selectedFields.length < 1) {
        alert('Please select at least one field');
        return;
      }

      // Check if this is a new prefix that needs to be added to registry
      const isNewPrefix = !existingRegistryEntry;

      onSave({
        name: name.trim(),
        icon,
        color,
        prefix: prefix.toUpperCase(),
        createdAt: type?.createdAt || new Date(),
        fields: selectedFields,
        fieldConfigs: fieldConfigs,
        customFields: customFields,
        _isNewPrefix: isNewPrefix, // Flag for parent to add to registry
      });
    };

    // Get all fields from library and categorize them
    const allLibraryFields = Object.values(window.FIELD_LIBRARY_NORMALIZED || {});

    // Combine library fields with custom fields
    const allFields = [...allLibraryFields, ...customFields];

    const fieldCategories = {
      'Core Fields': allFields.filter((f) =>
        ['name', 'description', 'priority', 'assignee', 'reporter'].includes(f.id)
      ),
      Categorization: allFields.filter((f) =>
        ['workCategory', 'issueType', 'engagementType', 'severity'].includes(f.id)
      ),
      'Planning & Tracking': allFields.filter((f) =>
        ['effortPoints', 'sprint', 'project', 'dueDate', 'estimatedHours'].includes(f.id)
      ),
      'Customer/Client': allFields.filter((f) => ['client', 'companyName', 'mainContact', 'industry'].includes(f.id)),
      'Contact Information': allFields.filter((f) => ['email', 'mainNumber', 'website'].includes(f.id)),
      Additional: allFields.filter((f) => ['notes'].includes(f.id)),
      'Custom Fields': customFields, // NEW: Custom fields section
    };

    const renderFieldDetail = (field) => {
      const isExpanded = expandedField === field.id;
      const isNameField = field.id === 'name';
      const isSelected = selectedFields.includes(field.id);
      const isRequired = isNameField || fieldConfigs[field.id]?.required || false;
      const isCustomField = customFields.some((cf) => cf.id === field.id);

      return (
        <div key={field.id} className="border-b border-gray-200 last:border-b-0">
          <div className={`flex items-start gap-3 p-3 hover:bg-gray-50 transition ${isNameField ? 'bg-gray-50' : ''}`}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => handleToggleField(field.id)}
              disabled={isNameField}
              className="mt-1 rounded"
            />
            <div className="flex-1 min-w-0">
              <div className="cursor-pointer" onClick={() => setExpandedField(isExpanded ? null : field.id)}>
                <div className="flex items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{field.label}</span>
                    {isNameField && <span className="text-xs text-red-600 font-medium">Always Required</span>}
                    {isCustomField && (
                      <span className="text-xs text-purple-600 font-medium bg-purple-50 px-2 py-0.5 rounded">
                        Custom
                      </span>
                    )}
                  </div>
                  <button className="text-gray-400 hover:text-gray-600">{isExpanded ? '▼' : '▶'}</button>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {field.type}
                  {field.optionsFrom && ` • from ${field.optionsFrom}`}
                  {field.options && ` • ${field.options.length} options`}
                </div>
              </div>

              {/* Required Toggle - only if field is selected and not 'name' */}
              {isSelected && !isNameField && (
                <div className="mt-2 flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isRequired}
                      onChange={() => handleToggleRequired(field.id)}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">Required field</span>
                  </label>
                  {isCustomField && (
                    <button
                      onClick={() => handleDeleteCustomField(field.id)}
                      className="ml-auto text-xs text-red-600 hover:text-red-700"
                    >
                      Delete Custom Field
                    </button>
                  )}
                </div>
              )}

              {/* Expanded Details */}
              {isExpanded && (
                <div className="mt-3 p-3 bg-white border border-gray-200 rounded text-xs space-y-2">
                  <div>
                    <span className="font-medium text-gray-700">Type:</span>{' '}
                    <span className="text-gray-600">{field.type}</span>
                  </div>

                  {field.required && (
                    <div>
                      <span className="font-medium text-gray-700">Required:</span>{' '}
                      <span className="text-red-600">Yes</span>
                    </div>
                  )}

                  {field.placeholder && (
                    <div>
                      <span className="font-medium text-gray-700">Placeholder:</span>{' '}
                      <span className="text-gray-600">{field.placeholder}</span>
                    </div>
                  )}

                  {field.optionsFrom && (
                    <div>
                      <span className="font-medium text-gray-700">Data Source:</span>{' '}
                      <span className="text-indigo-600">{field.optionsFrom}</span>
                      <div className="text-gray-500 mt-1">
                        {field.optionsFrom === 'staffList' && '→ Work Centre staff members'}
                        {field.optionsFrom === 'globalProjects' && '→ Company-wide projects'}
                        {field.optionsFrom === 'customers' && '→ Global CRM customers'}
                      </div>
                    </div>
                  )}

                  {field.options && (
                    <div>
                      <span className="font-medium text-gray-700">Options:</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {field.options.map((opt, idx) => (
                          <span key={idx} className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded">
                            {opt}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {field.min !== undefined && (
                    <div>
                      <span className="font-medium text-gray-700">Min:</span>{' '}
                      <span className="text-gray-600">{field.min}</span>
                      {field.max !== undefined && (
                        <>
                          {' '}
                          <span className="font-medium text-gray-700">Max:</span>{' '}
                          <span className="text-gray-600">{field.max}</span>
                        </>
                      )}
                    </div>
                  )}

                  {field.rows && (
                    <div>
                      <span className="font-medium text-gray-700">Rows:</span>{' '}
                      <span className="text-gray-600">{field.rows}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
        <div className="bg-white rounded-lg w-full max-w-7xl h-[90vh] flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-gray-200 flex-shrink-0">
            <h2 className="text-xl font-semibold text-gray-900">{type ? 'Edit Ticket Type' : 'Create Ticket Type'}</h2>
            <p className="text-sm text-gray-500 mt-1">
              Configure the type, appearance, and fields for this ticket type. Click any field on the right to see what
              options it contains.
            </p>
          </div>

          {/* Two-Panel Layout */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left Panel - Configuration */}
            <div className="w-1/2 border-r border-gray-200 overflow-y-auto">
              <div className="p-6 space-y-6">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ticket Type Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Development Work, Customer Support, etc."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>

                {/* Prefix */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Ticket Prefix * <span className="text-gray-400 font-normal">(max 8 chars)</span>
                  </label>
                  <input
                    type="text"
                    value={prefix}
                    onChange={(e) =>
                      setPrefix(
                        e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, '')
                          .slice(0, 8)
                      )
                    }
                    placeholder="e.g., TASK, BUG, INC, REQ"
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 uppercase ${
                      prefix && !isPrefixValid ? 'border-red-300 bg-red-50' : 'border-gray-300'
                    }`}
                  />
                  {/* Similar prefixes warning */}
                  {similarPrefixes.length > 0 && (
                    <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-sm text-amber-800">⚠️ Similar prefixes exist: {similarPrefixes.join(', ')}</p>
                    </div>
                  )}
                  {/* Shared prefix info - this is OK now! */}
                  {prefix && existingRegistryEntry && typesUsingPrefix.length > 0 && (
                    <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-sm text-blue-800">
                        ℹ️ This prefix is used by: {typesUsingPrefix.map((t) => t.name).join(', ')}
                      </p>
                      <p className="text-sm text-blue-700 mt-1">
                        You can share it! Next ticket will be:{' '}
                        <span className="font-mono font-bold">
                          {prefix}-{String(existingRegistryEntry.nextNumber).padStart(3, '0')}
                        </span>
                      </p>
                    </div>
                  )}
                  {/* New prefix - will be created */}
                  {prefix && isPrefixValid && !existingRegistryEntry && (
                    <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm text-green-800">
                        ✓ New prefix. Tickets will be numbered: {prefix}-001, {prefix}-002, etc.
                      </p>
                    </div>
                  )}
                  {/* Existing prefix with no other types using it (editing same type) */}
                  {prefix && isPrefixValid && existingRegistryEntry && typesUsingPrefix.length === 0 && (
                    <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm text-green-800">
                        ✓ Next ticket:{' '}
                        <span className="font-mono font-bold">
                          {prefix}-{String(existingRegistryEntry.nextNumber).padStart(3, '0')}
                        </span>
                      </p>
                    </div>
                  )}
                </div>

                {/* Icon Picker */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Icon</label>
                  <div className="flex flex-wrap gap-2">
                    {window.EMOJI_OPTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => setIcon(emoji)}
                        className={`text-2xl p-2 rounded-lg border-2 transition ${
                          icon === emoji ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Colour Picker */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Colour</label>
                  <div className="grid grid-cols-2 gap-2">
                    {window.COLOR_OPTIONS.map((colorOption) => (
                      <button
                        key={colorOption.name}
                        onClick={() => setColor(colorOption.name)}
                        className={`px-4 py-2 rounded-lg border-2 transition flex items-center gap-2 ${
                          color === colorOption.name ? 'border-indigo-500' : 'border-gray-200 hover:border-gray-300'
                        }`}
                        style={{
                          backgroundColor: color === colorOption.name ? colorOption.bg : 'white',
                          color: color === colorOption.name ? colorOption.text : '#374151',
                        }}
                      >
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: colorOption.hex }}></div>
                        <span className="text-sm font-medium capitalize">{colorOption.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Preview */}
                <div className="bg-gradient-to-br from-gray-50 to-gray-100 border-2 border-gray-300 rounded-lg p-6">
                  <div className="text-xs font-medium text-gray-500 mb-3">PREVIEW</div>
                  <div className="flex items-center gap-3">
                    <div className="text-4xl">{icon}</div>
                    <div>
                      <div className="text-lg font-bold text-gray-900">{name || 'Ticket Type Name'}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className="inline-block px-3 py-1 text-sm font-medium rounded-full"
                          style={{
                            backgroundColor: window.COLOR_OPTIONS.find((c) => c.name === color)?.bg,
                            color: window.COLOR_OPTIONS.find((c) => c.name === color)?.text,
                          }}
                        >
                          {color}
                        </span>
                        {prefix && (
                          <span className="inline-block px-3 py-1 text-sm font-mono font-medium bg-gray-200 text-gray-700 rounded-full">
                            {prefix}-001
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-300">
                    <div className="text-xs font-medium text-gray-600 mb-2">
                      {selectedFields.length} field{selectedFields.length !== 1 ? 's' : ''} selected
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {selectedFields.slice(0, 8).map((fieldId) => {
                        const field =
                          (window.FIELD_LIBRARY_NORMALIZED || {})[fieldId] ||
                          customFields.find((cf) => cf.id === fieldId);
                        return (
                          <span key={fieldId} className="px-2 py-0.5 text-xs bg-white border border-gray-300 rounded">
                            {field?.label || fieldId}
                            {fieldConfigs[fieldId]?.required && <span className="text-red-600 ml-1">*</span>}
                          </span>
                        );
                      })}
                      {selectedFields.length > 8 && (
                        <span className="px-2 py-0.5 text-xs text-gray-500">+{selectedFields.length - 8} more</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    💡 <strong>Tip:</strong> Click any field on the right to see detailed information about what it does
                    and what options it contains.
                  </p>
                </div>
              </div>
            </div>

            {/* Right Panel - Field Library */}
            <div className="w-1/2 overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Field Library</h3>
                    <p className="text-sm text-gray-500 mt-1">Select fields to include in this ticket type</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowCustomFieldModal(true)}
                      className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition font-medium"
                    >
                      + Custom Field
                    </button>
                    <div className="text-sm font-medium text-indigo-600">{selectedFields.length} selected</div>
                  </div>
                </div>

                {Object.entries(fieldCategories).map(([category, fields]) => {
                  if (fields.length === 0) return null;

                  return (
                    <div key={category} className="mb-6">
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 px-3">{category}</h4>
                      <div className="border border-gray-300 rounded-lg overflow-hidden">
                        {fields.map((field) => renderFieldDetail(field))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-6 border-t border-gray-200 flex gap-3 flex-shrink-0">
            <button
              onClick={handleSave}
              disabled={!hasChanges || !isPrefixValid}
              className={`flex-1 px-6 py-3 rounded-lg transition font-medium ${
                hasChanges && isPrefixValid
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {isEditing ? (hasChanges ? 'Save Changes' : 'No Changes') : 'Create Ticket Type'}
            </button>
            <button
              onClick={onClose}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium"
            >
              {isEditing && hasChanges ? 'Cancel' : 'Close'}
            </button>
          </div>
        </div>

        {/* Custom Field Creation Modal */}
        {showCustomFieldModal && (
          <CustomFieldModal
            formData={customFieldForm}
            setFormData={setCustomFieldForm}
            company={company}
            isEditing={false}
            onSubmit={handleAddCustomField}
            onCancel={() => {
              setShowCustomFieldModal(false);
              setCustomFieldForm({
                label: '',
                type: 'text',
                required: false,
                placeholder: '',
                helpText: '',
                options: [],
                category: 'custom',
              });
            }}
          />
        )}
      </div>
    );
  };

  // Export to window namespace
  window.Components = window.Components || {};
  window.Components.TicketTypeModal = TicketTypeModal;

  // v153: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['ticket-type-modal'] = COMPONENT_VERSION;

  console.log(`[ticket-type-modal.jsx] TicketTypeModal loaded (${COMPONENT_VERSION})`);
})();

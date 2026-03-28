/**
 * Entity Modals - v187a
 * Extracted from app.jsx
 *
 * Contains:
 * - CategoryModal
 * - CustomFieldModal
 *
 * v187a Changes:
 * - REMOVED: CustomerModal - replaced by CustomerDetailModal with inline editing
 * - REMOVED: SupplierModal - replaced by SupplierDetailModal with inline editing
 * - These modals are no longer needed - Detail Modals provide full CRUD capability
 *
 * v183a Changes (legacy - CustomerModal and SupplierModal now removed):
 * - Had SupplierModal component for Add/Edit suppliers
 * - Had CustomerModal component for Add/Edit customers
 *
 * v153 Changes:
 * - Added component version registry support
 */

(function () {
  'use strict';

  // v187a: Component version for registry
  const COMPONENT_VERSION = 'v187a';

  const { useState } = React;

  // CategoryModal - extracted verbatim from v089App.jsx lines 6242-6315
  const CategoryModal = ({ formData, setFormData, onSubmit, onCancel }) => {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
        <div className="bg-white rounded-lg max-w-md w-full">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Create Field Category</h2>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
            className="p-6 space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category Name *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Legal & Compliance"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of this category"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Icon (emoji) - Optional</label>
              <input
                type="text"
                value={formData.icon}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                placeholder="Type emoji: 👥 📁 ⚖️ 💰"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 text-2xl"
              />
              <p className="text-xs text-gray-500 mt-1">Paste an emoji or leave blank for default 📁</p>
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition"
              >
                Create Category
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // CustomFieldModal - extracted verbatim from v089App.jsx lines 6317-6657
  const CustomFieldModal = ({ formData, setFormData, onSubmit, onCancel, company, isEditing = false }) => {
    const [newOption, setNewOption] = useState('');
    const [editingOptionIndex, setEditingOptionIndex] = useState(null);
    const [editingOptionValue, setEditingOptionValue] = useState('');

    const handleAddOption = () => {
      if (newOption.trim() && !formData.options.includes(newOption.trim())) {
        setFormData({
          ...formData,
          options: [...formData.options, newOption.trim()],
        });
        setNewOption('');
      }
    };

    const handleStartEditOption = (index) => {
      setEditingOptionIndex(index);
      setEditingOptionValue(formData.options[index]);
    };

    const handleSaveOptionEdit = () => {
      if (editingOptionValue.trim() && editingOptionIndex !== null) {
        const newOptions = [...formData.options];
        newOptions[editingOptionIndex] = editingOptionValue.trim();
        setFormData({ ...formData, options: newOptions });
        setEditingOptionIndex(null);
        setEditingOptionValue('');
      }
    };

    const handleCancelOptionEdit = () => {
      setEditingOptionIndex(null);
      setEditingOptionValue('');
    };

    const handleRemoveOption = (index) => {
      setFormData({
        ...formData,
        options: formData.options.filter((_, i) => i !== index),
      });
    };

    const handleMoveOption = (index, direction) => {
      const newOptions = [...formData.options];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex >= 0 && targetIndex < newOptions.length) {
        [newOptions[index], newOptions[targetIndex]] = [newOptions[targetIndex], newOptions[index]];
        setFormData({ ...formData, options: newOptions });
      }
    };

    // Get all categories (predefined + custom)
    const allCategories = {
      ...(window.FIELD_LIBRARY_CATEGORIES || {}),
      ...(company.customFieldCategories || []).reduce((acc, cat) => {
        acc[cat.id] = cat.name;
        return acc;
      }, {}),
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
        <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">
              {isEditing ? 'Edit Custom Field' : 'Create Custom Field'}
            </h2>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
            className="flex-1 overflow-y-auto"
          >
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Field Name *</label>
                <input
                  type="text"
                  required
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  placeholder="e.g., Compliance Status"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                <select
                  required
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select a category</option>
                  {Object.entries(allCategories).map(([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Field Type *</label>
                <select
                  required
                  value={formData.type}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      type: e.target.value,
                      options: e.target.value === 'select' || e.target.value === 'multiselect' ? formData.options : [],
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="text">Text (single line)</option>
                  <option value="textarea">Text Area (multi-line)</option>
                  <option value="number">Number</option>
                  <option value="select">Dropdown (single select)</option>
                  <option value="multiselect">Multi-select</option>
                  <option value="date">Date</option>
                  <option value="checkbox">Checkbox</option>
                  <option value="url">URL/Link</option>
                </select>
              </div>

              {/* Options editor for select/multiselect */}
              {(formData.type === 'select' || formData.type === 'multiselect') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Options *</label>
                  <div className="border border-gray-300 rounded p-3 space-y-2 max-h-48 overflow-y-auto">
                    {formData.options.map((option, index) => (
                      <div key={index} className="flex items-center gap-2">
                        {editingOptionIndex === index ? (
                          <>
                            <input
                              type="text"
                              value={editingOptionValue}
                              onChange={(e) => setEditingOptionValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveOptionEdit();
                                }
                                if (e.key === 'Escape') handleCancelOptionEdit();
                              }}
                              className="flex-1 px-2 py-1 border border-indigo-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={handleSaveOptionEdit}
                              className="text-green-600 hover:text-green-700 text-sm"
                            >
                              ✓
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelOptionEdit}
                              className="text-gray-400 hover:text-gray-600 text-sm"
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-sm">{option}</span>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => handleMoveOption(index, 'up')}
                                disabled={index === 0}
                                className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-xs"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveOption(index, 'down')}
                                disabled={index === formData.options.length - 1}
                                className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-xs"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStartEditOption(index)}
                                className="text-blue-600 hover:text-blue-700 text-xs ml-1"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveOption(index)}
                                className="text-red-600 hover:text-red-700 text-xs"
                              >
                                ✕
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                    {formData.options.length === 0 && (
                      <p className="text-sm text-gray-500 text-center py-2">No options added yet</p>
                    )}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <input
                      type="text"
                      value={newOption}
                      onChange={(e) => setNewOption(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddOption();
                        }
                      }}
                      placeholder="Add option..."
                      className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                    />
                    <button
                      type="button"
                      onClick={handleAddOption}
                      className="px-3 py-2 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition text-sm"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              )}

              {/* Number-specific settings */}
              {formData.type === 'number' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Minimum Value</label>
                    <input
                      type="number"
                      value={formData.min || ''}
                      onChange={(e) => setFormData({ ...formData, min: e.target.value })}
                      placeholder="No minimum"
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Maximum Value</label>
                    <input
                      type="number"
                      value={formData.max || ''}
                      onChange={(e) => setFormData({ ...formData, max: e.target.value })}
                      placeholder="No maximum"
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* Textarea-specific settings */}
              {formData.type === 'textarea' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Number of Rows</label>
                  <input
                    type="number"
                    min="2"
                    max="20"
                    value={formData.rows || 3}
                    onChange={(e) => setFormData({ ...formData, rows: parseInt(e.target.value) || 3 })}
                    className="w-24 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Value</label>
                {formData.type === 'checkbox' ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.defaultValue === true || formData.defaultValue === 'true'}
                      onChange={(e) => setFormData({ ...formData, defaultValue: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-600">Checked by default</span>
                  </label>
                ) : formData.type === 'select' ? (
                  <select
                    value={formData.defaultValue || ''}
                    onChange={(e) => setFormData({ ...formData, defaultValue: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">No default</option>
                    {formData.options.map((option, index) => (
                      <option key={index} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={formData.type === 'number' ? 'number' : formData.type === 'date' ? 'date' : 'text'}
                    value={formData.defaultValue || ''}
                    onChange={(e) => setFormData({ ...formData, defaultValue: e.target.value })}
                    placeholder="Optional default value"
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Placeholder Text</label>
                <input
                  type="text"
                  value={formData.placeholder || ''}
                  onChange={(e) => setFormData({ ...formData, placeholder: e.target.value })}
                  placeholder="Hint text shown in empty field"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Help Text</label>
                <input
                  type="text"
                  value={formData.helpText || ''}
                  onChange={(e) => setFormData({ ...formData, helpText: e.target.value })}
                  placeholder="Additional guidance shown below the field"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Icon (emoji)</label>
                <input
                  type="text"
                  value={formData.icon || ''}
                  onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                  placeholder="Type emoji: 📋 ✓ 🔗"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 text-2xl"
                />
              </div>

              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.required || false}
                    onChange={(e) => setFormData({ ...formData, required: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">Required field</span>
                </label>
              </div>
            </div>

            <div className="flex gap-3 p-6 border-t border-gray-200 bg-white">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition"
              >
                {isEditing ? 'Save Changes' : 'Create Field'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // CustomerModal - v172d with sticky header
  // BUG-170-006: Added Size, Source, Territory, Account Owner, Contract fields
  const CustomerModal = ({ formData, setFormData, editingCustomer, onSubmit, onCancel, company }) => {
    // v171a: Get lifecycle stages from crmConfig, fallback to defaults if not configured
    const lifecycleStages = company?.crmConfig?.lifecycleStages || [];
    const globalStaff = company?.globalStaff || [];

    // v171a: Fallback stages if none configured
    const defaultStages = [
      { id: 'stage-lead', name: 'Lead' },
      { id: 'stage-prospect', name: 'Prospect' },
      { id: 'stage-active', name: 'Active' },
      { id: 'stage-churned', name: 'Churned' },
    ];

    const stages = lifecycleStages.length > 0 ? lifecycleStages : defaultStages;

    // v171a: Company size options
    const companySizeOptions = ['1-10', '11-50', '51-200', '201-1000', '1000+'];

    // v171a: Source options
    const sourceOptions = ['Website', 'Referral', 'Event', 'Cold Outreach', 'Partner', 'Other'];

    // v171a: Territory options (could be made configurable in future)
    const territoryOptions = company?.crmConfig?.territories || ['Wellington', 'Auckland', 'Christchurch', 'Other'];

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        {/* v172d: BUG-171-006 FIX - Restructured with sticky header + buttons top-right */}
        <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] flex flex-col">
          {/* Sticky header with title and buttons */}
          <div className="p-6 border-b border-gray-200 flex-shrink-0 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              {editingCustomer ? `Edit ${editingCustomer.id}` : 'Add Customer'}
            </h2>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="bg-white text-gray-700 px-4 py-2 rounded border border-gray-300 hover:bg-gray-50 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSubmit}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition text-sm font-medium"
              >
                {editingCustomer ? 'Update' : 'Add Customer'}
              </button>
            </div>
          </div>

          {/* Scrollable content area */}
          <form onSubmit={onSubmit} className="p-6 space-y-6 flex-1 overflow-y-auto">
            {/* Company Information Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Company Information</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.companyName || ''}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
                    <select
                      value={formData.industry || ''}
                      onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select industry</option>
                      {(window.INDUSTRIES || []).map((industry) => (
                        <option key={industry} value={industry}>
                          {industry}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* v171a: Company Size - BUG-170-006 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company Size</label>
                    <select
                      value={formData.companySize || ''}
                      onChange={(e) => setFormData({ ...formData, companySize: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select size</option>
                      {companySizeOptions.map((size) => (
                        <option key={size} value={size}>
                          {size} employees
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* v171a: Source - BUG-170-006 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
                    <select
                      value={formData.source || ''}
                      onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select source</option>
                      {sourceOptions.map((source) => (
                        <option key={source} value={source}>
                          {source}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* v171a: Territory - BUG-170-006 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Territory</label>
                    <select
                      value={formData.territory || ''}
                      onChange={(e) => setFormData({ ...formData, territory: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select territory</option>
                      {territoryOptions.map((territory) => (
                        <option key={territory} value={territory}>
                          {territory}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* v171a: Website - BUG-170-004 - Changed to type="text" */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                  <input
                    type="text"
                    value={formData.website || ''}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    placeholder="e.g., www.example.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Protocol (https://) will be added automatically if not provided
                  </p>
                </div>
              </div>
            </div>

            {/* CRM Status Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">CRM Status</h3>
              <div className="grid grid-cols-2 gap-4">
                {/* v171a: Stage dropdown - BUG-170-003 - Now uses crmConfig.lifecycleStages */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lifecycle Stage *</label>
                  <select
                    value={formData.stage || ''}
                    onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select stage</option>
                    {stages
                      .sort((a, b) => (a.order || 0) - (b.order || 0))
                      .map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.name}
                        </option>
                      ))}
                  </select>
                </div>

                {/* v171a: Account Owner - BUG-170-006 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Owner</label>
                  <select
                    value={formData.accountOwnerId || ''}
                    onChange={(e) => setFormData({ ...formData, accountOwnerId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select owner</option>
                    {globalStaff.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Contact Information Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Primary Contact</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.mainContact || ''}
                    onChange={(e) => setFormData({ ...formData, mainContact: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={formData.email || ''}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={formData.mainNumber || ''}
                      onChange={(e) => setFormData({ ...formData, mainNumber: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* v171a: Contract Information Section - BUG-170-006 */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Contract Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contract Value</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-500">$</span>
                    <input
                      type="number"
                      value={formData.contractValue || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, contractValue: e.target.value ? parseFloat(e.target.value) : '' })
                      }
                      placeholder="0.00"
                      className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contract Term</label>
                  <select
                    value={formData.contractTerm || ''}
                    onChange={(e) => setFormData({ ...formData, contractTerm: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select term</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Annual">Annual</option>
                    <option value="2 Years">2 Years</option>
                    <option value="3 Years">3 Years</option>
                    <option value="Custom">Custom</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contract Start Date</label>
                  <input
                    type="date"
                    value={formData.contractStart || ''}
                    onChange={(e) => setFormData({ ...formData, contractStart: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Renewal Date</label>
                  <input
                    type="date"
                    value={formData.renewalDate || ''}
                    onChange={(e) => setFormData({ ...formData, renewalDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Notes Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Notes</h3>
              <textarea
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={4}
                placeholder="Additional notes about this customer..."
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {/* v172d: Buttons moved to sticky header */}
          </form>
        </div>
      </div>
    );
  };

  // v183a: SupplierModal - NEW
  // Matches CustomerModal pattern with teal colour scheme
  const SupplierModal = ({ formData, setFormData, editingSupplier, onSubmit, onCancel, company }) => {
    // Get lifecycle stages from supplierConfig
    const lifecycleStages = company?.supplierConfig?.lifecycleStages || [];
    const supplierFlags = company?.supplierConfig?.supplierFlags || [];
    const globalStaff = company?.globalStaff || [];

    // Fallback stages if none configured
    const defaultStages = [
      { id: 'stage-potential', name: 'Potential' },
      { id: 'stage-approved', name: 'Approved' },
      { id: 'stage-preferred', name: 'Preferred' },
      { id: 'stage-inactive', name: 'Inactive' },
    ];

    const stages = lifecycleStages.length > 0 ? lifecycleStages : defaultStages;

    // Options
    const companySizeOptions = ['1-10', '11-50', '51-200', '201-1000', '1000+'];
    const supplierTypeOptions = ['Vendor', 'Contractor', 'Consultant', 'Partner', 'Reseller', 'Other'];
    const territoryOptions = [
      'Auckland',
      'Wellington',
      'Canterbury',
      'Waikato',
      'Bay of Plenty',
      'International',
      'Other',
    ];
    const paymentTermsOptions = ['Net 7', 'Net 14', 'Net 20', 'Net 30', 'Net 45', 'Net 60', 'COD', 'Prepaid'];
    const industryOptions = [
      'Technology',
      'Manufacturing',
      'Logistics',
      'Professional Services',
      'Construction',
      'Agriculture',
      'Retail',
      'Finance',
      'Healthcare',
      'Other',
    ];

    // Handle flag toggle
    const handleFlagToggle = (flagId) => {
      const currentFlags = formData.flags || [];
      const newFlags = currentFlags.includes(flagId)
        ? currentFlags.filter((f) => f !== flagId)
        : [...currentFlags, flagId];
      setFormData({ ...formData, flags: newFlags });
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
        <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] flex flex-col">
          {/* Sticky header with title and buttons - teal theme */}
          <div className="p-6 border-b border-gray-200 flex-shrink-0 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              {editingSupplier ? `Edit ${editingSupplier.id}` : 'Add Supplier'}
            </h2>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="bg-white text-gray-700 px-4 py-2 rounded border border-gray-300 hover:bg-gray-50 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSubmit}
                className="bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700 transition text-sm font-medium"
              >
                {editingSupplier ? 'Update' : 'Add Supplier'}
              </button>
            </div>
          </div>

          {/* Scrollable content area */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
            className="p-6 space-y-6 flex-1 overflow-y-auto"
          >
            {/* Company Information Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Company Information</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.companyName || ''}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
                    <select
                      value={formData.industry || ''}
                      onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="">Select industry</option>
                      {industryOptions.map((industry) => (
                        <option key={industry} value={industry}>
                          {industry}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company Size</label>
                    <select
                      value={formData.companySize || ''}
                      onChange={(e) => setFormData({ ...formData, companySize: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="">Select size</option>
                      {companySizeOptions.map((size) => (
                        <option key={size} value={size}>
                          {size} employees
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Main Contact</label>
                    <input
                      type="text"
                      value={formData.mainContact || ''}
                      onChange={(e) => setFormData({ ...formData, mainContact: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={formData.email || ''}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={formData.mainNumber || ''}
                      onChange={(e) => setFormData({ ...formData, mainNumber: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                    <input
                      type="text"
                      value={formData.website || ''}
                      onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                      placeholder="e.g., www.example.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Classification Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Classification</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Lifecycle Stage</label>
                    <select
                      value={formData.stage || ''}
                      onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="">Select stage</option>
                      {stages
                        .sort((a, b) => (a.order || 0) - (b.order || 0))
                        .map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Type</label>
                    <select
                      value={formData.supplierType || ''}
                      onChange={(e) => setFormData({ ...formData, supplierType: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="">Select type</option>
                      {supplierTypeOptions.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Territory</label>
                    <select
                      value={formData.territory || ''}
                      onChange={(e) => setFormData({ ...formData, territory: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="">Select territory</option>
                      {territoryOptions.map((territory) => (
                        <option key={territory} value={territory}>
                          {territory}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Relationship Owner</label>
                    <select
                      value={formData.accountOwnerId || ''}
                      onChange={(e) => setFormData({ ...formData, accountOwnerId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="">Select owner</option>
                      {globalStaff.map((staff) => (
                        <option key={staff.id} value={staff.id}>
                          {staff.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Flags */}
                {supplierFlags.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Flags</label>
                    <div className="flex flex-wrap gap-2">
                      {supplierFlags.map((flag) => (
                        <button
                          key={flag.id}
                          type="button"
                          onClick={() => handleFlagToggle(flag.id)}
                          className={`text-sm px-3 py-1.5 rounded-full transition ${
                            (formData.flags || []).includes(flag.id)
                              ? 'bg-teal-600 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          {flag.icon} {flag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Commercial Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Commercial</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Annual Spend</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-500">$</span>
                    <input
                      type="number"
                      value={formData.annualSpend || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, annualSpend: e.target.value ? parseFloat(e.target.value) : '' })
                      }
                      placeholder="0.00"
                      min="0"
                      className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
                  <select
                    value={formData.paymentTerms || ''}
                    onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">Select terms</option>
                    {paymentTermsOptions.map((terms) => (
                      <option key={terms} value={terms}>
                        {terms}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contract Start Date</label>
                  <input
                    type="date"
                    value={formData.contractStartDate || ''}
                    onChange={(e) => setFormData({ ...formData, contractStartDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contract End Date</label>
                  <input
                    type="date"
                    value={formData.contractEndDate || ''}
                    onChange={(e) => setFormData({ ...formData, contractEndDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>
            </div>

            {/* Products & Services Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Products & Services</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Products/Services</label>
                  <input
                    type="text"
                    value={formData.productsServices || ''}
                    onChange={(e) => setFormData({ ...formData, productsServices: e.target.value })}
                    placeholder="e.g., Components, Assembly, Consulting (comma-separated)"
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Separate multiple items with commas</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Service Notes</label>
                  <textarea
                    value={formData.serviceNotes || ''}
                    onChange={(e) => setFormData({ ...formData, serviceNotes: e.target.value })}
                    rows={2}
                    placeholder="Details about products/services provided..."
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>
            </div>

            {/* Notes Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Notes</h3>
              <textarea
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={4}
                placeholder="Additional notes about this supplier..."
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            {/* Buttons in sticky header */}
          </form>
        </div>
      </div>
    );
  };

  // Export to window namespace
  // v187a: Removed CustomerModal and SupplierModal - now using Detail Modals everywhere
  window.Components = window.Components || {};
  window.Components.EntityModals = {
    CategoryModal,
    CustomFieldModal,
    // CustomerModal - REMOVED v187a (use CustomerDetailModal)
    // SupplierModal - REMOVED v187a (use SupplierDetailModal)
  };

  // v187a: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['entity-modals'] = COMPONENT_VERSION;

  console.log(
    `[entity-modals.jsx] EntityModals loaded (${COMPONENT_VERSION}) - CustomerModal/SupplierModal removed, use Detail Modals`
  );
})();

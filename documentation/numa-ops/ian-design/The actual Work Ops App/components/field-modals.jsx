/**
 * Field Modals - Extracted from app.jsx v090
 * Contains: FieldManagerModal, FieldEditorModal
 *
 * Extraction Date: 2025-01-07
 * Version: v153
 *
 * v153 Changes:
 * - Added component version registry support
 */

(function () {
  'use strict';

  // v153: Component version for registry
  const COMPONENT_VERSION = 'v153';

  const { useState } = React;
  const { Search, X, Plus, ChevronUp, ChevronDown, Edit2, Trash2 } = window.Icons;

  const FieldManagerModal = ({ selectedFields = [], onFieldsChange, onClose }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedCategories, setExpandedCategories] = useState({
      common: true,
      development: false,
      callCentre: false,
      crm: false,
      operations: false,
    });

    const toggleCategory = (category) => {
      setExpandedCategories((prev) => ({
        ...prev,
        [category]: !prev[category],
      }));
    };

    const toggleField = (fieldId) => {
      if (selectedFields.includes(fieldId)) {
        onFieldsChange(selectedFields.filter((id) => id !== fieldId));
      } else {
        onFieldsChange([...selectedFields, fieldId]);
      }
    };

    // Get fields by category
    const getFieldsByCategory = (category) => {
      return Object.values(window.FIELD_LIBRARY_NORMALIZED || {}).filter((f) => f.category === category);
    };

    // Filter fields by search term
    const filterFields = (fields) => {
      if (!searchTerm) return fields;
      const search = searchTerm.toLowerCase();
      return fields.filter(
        (f) =>
          f.label.toLowerCase().includes(search) ||
          f.id.toLowerCase().includes(search) ||
          f.type.toLowerCase().includes(search) ||
          (f.helpText && f.helpText.toLowerCase().includes(search))
      );
    };

    const categories = [
      { id: 'common', label: 'Common Fields', description: 'Fields included in every ticket type' },
      { id: 'development', label: 'Development Fields', description: 'Software development and engineering' },
      { id: 'callCentre', label: 'Call Centre Fields', description: 'Customer support and service desk' },
      { id: 'crm', label: 'CRM Fields', description: 'Sales and customer relationship' },
      { id: 'operations', label: 'Operations Fields', description: 'Service delivery and general business' },
    ];

    const getFieldTypeIcon = (type) => {
      const icons = {
        text: '📝',
        textarea: '📄',
        select: '📋',
        number: '🔢',
        date: '📅',
        email: '📧',
        tel: '📞',
        url: '🔗',
        checkbox: '☑️',
      };
      return icons[type] || '📌';
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Field Library</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Select fields to include in this ticket type • {selectedFields.length} selected
                </p>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
                <span className="text-2xl">×</span>
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search fields by name, type, or description..."
                className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
            </div>
          </div>

          {/* Field Categories */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-4">
              {categories.map((category) => {
                const fields = filterFields(getFieldsByCategory(category.id));
                if (searchTerm && fields.length === 0) return null;

                return (
                  <div key={category.id} className="border border-gray-200 rounded-lg overflow-hidden">
                    {/* Category Header */}
                    <button
                      onClick={() => toggleCategory(category.id)}
                      className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{expandedCategories[category.id] ? '▼' : '▶'}</span>
                        <div className="text-left">
                          <h3 className="font-semibold text-gray-900">{category.label}</h3>
                          <p className="text-xs text-gray-600">{category.description}</p>
                        </div>
                      </div>
                      <span className="text-sm text-gray-500">
                        {fields.filter((f) => selectedFields.includes(f.id)).length} / {fields.length}
                      </span>
                    </button>

                    {/* Category Fields */}
                    {expandedCategories[category.id] && (
                      <div className="p-4 space-y-2">
                        {fields.map((field) => (
                          <label
                            key={field.id}
                            className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition"
                          >
                            <input
                              type="checkbox"
                              checked={selectedFields.includes(field.id)}
                              onChange={() => toggleField(field.id)}
                              className="mt-1"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span>{getFieldTypeIcon(field.type)}</span>
                                <span className="font-medium text-gray-900">{field.label}</span>
                                {field.required && (
                                  <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded font-medium">
                                    Required
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-gray-600 mt-1">
                                <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                                  {field.type}
                                </span>
                                {field.options && <span className="ml-2">• {field.options.length} options</span>}
                                {field.optionsFrom && <span className="ml-2">• from {field.optionsFrom}</span>}
                              </div>
                              {field.helpText && <p className="text-xs text-gray-500 mt-1">{field.helpText}</p>}
                            </div>
                          </label>
                        ))}

                        {fields.length === 0 && (
                          <p className="text-sm text-gray-500 text-center py-4">No fields match your search</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              💡 <strong>Smart Search:</strong> Search by field name, type, or keywords in descriptions
            </div>
            <div className="flex gap-3">
              <button onClick={onClose} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const FieldEditorModal = ({ field, onSave, onClose }) => {
    const [formData, setFormData] = useState({
      label: field.label || '',
      type: field.type || 'text',
      required: field.required || false,
      defaultValue: field.defaultValue || '',
      placeholder: field.placeholder || '',
      icon: field.icon || '',
      helpText: field.helpText || '',
      options: field.options ? [...field.options] : [],
      min: field.min || '',
      max: field.max || '',
      rows: field.rows || 3,
    });
    const [newOption, setNewOption] = useState('');
    const [editingOptionIndex, setEditingOptionIndex] = useState(null);
    const [editingOptionValue, setEditingOptionValue] = useState('');

    // Track if changes have been made
    const hasChanges =
      formData.label !== (field.label || '') ||
      formData.required !== (field.required || false) ||
      formData.defaultValue !== (field.defaultValue || '') ||
      formData.placeholder !== (field.placeholder || '') ||
      formData.icon !== (field.icon || '') ||
      formData.helpText !== (field.helpText || '') ||
      JSON.stringify(formData.options) !== JSON.stringify(field.options || []) ||
      formData.min !== (field.min || '') ||
      formData.max !== (field.max || '') ||
      formData.rows !== (field.rows || 3);

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

    const handleSubmit = (e) => {
      e.preventDefault();
      onSave({
        key: field.key,
        ...field,
        ...formData,
        // Clean up based on field type
        options: ['select', 'multiselect'].includes(formData.type) ? formData.options : undefined,
        min: ['number'].includes(formData.type) ? formData.min : undefined,
        max: ['number'].includes(formData.type) ? formData.max : undefined,
        rows: ['textarea'].includes(formData.type) ? formData.rows : undefined,
      });
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
        <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Edit Field: {field.label}</h2>
            <p className="text-sm text-gray-500 mt-1">Field ID: {field.key}</p>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
            <div className="p-6 space-y-4">
              {/* Label */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Field Label *</label>
                <input
                  type="text"
                  required
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Type (read-only for now) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Field Type</label>
                <input
                  type="text"
                  disabled
                  value={formData.type}
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-gray-100 text-gray-600"
                />
                <p className="text-xs text-gray-500 mt-1">Field type cannot be changed</p>
              </div>

              {/* Required */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="required"
                  checked={formData.required}
                  onChange={(e) => setFormData({ ...formData, required: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="required" className="text-sm font-medium text-gray-700">
                  Required field
                </label>
              </div>

              {/* Default Value */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Value</label>
                <input
                  type="text"
                  value={formData.defaultValue}
                  onChange={(e) => setFormData({ ...formData, defaultValue: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Placeholder */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Placeholder Text</label>
                <input
                  type="text"
                  value={formData.placeholder}
                  onChange={(e) => setFormData({ ...formData, placeholder: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Icon */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Icon (emoji)</label>
                <input
                  type="text"
                  value={formData.icon}
                  onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                  placeholder="📝"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Help Text */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Help Text</label>
                <textarea
                  value={formData.helpText}
                  onChange={(e) => setFormData({ ...formData, helpText: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Number field specific */}
              {formData.type === 'number' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Minimum Value</label>
                    <input
                      type="number"
                      value={formData.min}
                      onChange={(e) => setFormData({ ...formData, min: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Maximum Value</label>
                    <input
                      type="number"
                      value={formData.max}
                      onChange={(e) => setFormData({ ...formData, max: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* Textarea specific */}
              {formData.type === 'textarea' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rows</label>
                  <input
                    type="number"
                    min="2"
                    max="20"
                    value={formData.rows}
                    onChange={(e) => setFormData({ ...formData, rows: parseInt(e.target.value) || 3 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              {/* Select/Multiselect Options */}
              {(formData.type === 'select' || formData.type === 'multiselect') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Options</label>

                  {/* Add Option */}
                  <div className="flex gap-2 mb-3">
                    <input
                      type="text"
                      value={newOption}
                      onChange={(e) => setNewOption(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddOption();
                        }
                      }}
                      placeholder="Type option and press Enter"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddOption}
                      className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition"
                    >
                      Add
                    </button>
                  </div>

                  {/* Options List */}
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
                    {formData.options.length === 0 ? (
                      <div className="p-4 text-center text-sm text-gray-500">No options yet. Add options above.</div>
                    ) : (
                      formData.options.map((option, index) => (
                        <div key={index} className="flex items-center gap-2 p-3 bg-white hover:bg-gray-50">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMoveOption(index, 'up')}
                              disabled={index === 0 || editingOptionIndex !== null}
                              className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveOption(index, 'down')}
                              disabled={index === formData.options.length - 1 || editingOptionIndex !== null}
                              className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Move down"
                            >
                              ↓
                            </button>
                          </div>

                          {/* Editable option text */}
                          {editingOptionIndex === index ? (
                            <div className="flex-1 flex items-center gap-2">
                              <input
                                type="text"
                                value={editingOptionValue}
                                onChange={(e) => setEditingOptionValue(e.target.value)}
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleSaveOptionEdit();
                                  } else if (e.key === 'Escape') {
                                    handleCancelOptionEdit();
                                  }
                                }}
                                autoFocus
                                className="flex-1 px-2 py-1 text-sm border border-indigo-500 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                              <button
                                type="button"
                                onClick={handleSaveOptionEdit}
                                className="p-1.5 text-green-600 hover:bg-green-50 rounded transition"
                                title="Save"
                              >
                                ✓
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelOptionEdit}
                                className="p-1.5 text-gray-600 hover:bg-gray-100 rounded transition"
                                title="Cancel"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div className="flex-1 text-sm text-gray-900">{option}</div>
                          )}

                          {/* Edit and Delete buttons */}
                          {editingOptionIndex !== index && (
                            <button
                              type="button"
                              onClick={() => handleStartEditOption(index)}
                              disabled={editingOptionIndex !== null}
                              className="p-1.5 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition disabled:opacity-30"
                              title="Edit option"
                            >
                              <Edit2 size={14} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveOption(index)}
                            disabled={editingOptionIndex !== null}
                            className="p-1.5 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition disabled:opacity-30"
                            title="Remove option"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-6 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
              >
                {hasChanges ? 'Cancel' : 'Close'}
              </button>
              <button
                type="submit"
                disabled={!hasChanges}
                className={`px-6 py-2 rounded transition ${
                  hasChanges
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {hasChanges ? 'Save Changes' : 'No Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // Export to window
  window.Components = window.Components || {};
  window.Components.FieldModals = {
    FieldManagerModal,
    FieldEditorModal,
  };

  // v153: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['field-modals'] = COMPONENT_VERSION;

  console.log(`[field-modals.jsx] FieldModals loaded (${COMPONENT_VERSION})`);
})();

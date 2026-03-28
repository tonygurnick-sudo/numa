/**
 * DynamicField Component
 *
 * Renders form fields dynamically based on field definitions from FIELD_LIBRARY.
 * Supports 13 field types: text, textarea, number, select, email, tel, url,
 * date, user, customer, project, workunit, currency, richtext, multiuser, multiselect
 *
 * Dependencies:
 * - window.FIELD_LIBRARY_NORMALIZED
 * - window.globalCompany
 * - React (useState)
 *
 * Exported via: window.Components.DynamicField
 * Version: v153
 */
(function () {
  'use strict';

  // v153: Component version for registry
  const COMPONENT_VERSION = 'v153';

  const { useState } = React;

  // Get normalized field library
  const FIELD_LIBRARY_NORMALIZED = window.FIELD_LIBRARY_NORMALIZED || {};

  const DynamicField = ({
    fieldId,
    formData,
    setFormData,
    opCentre,
    company,
    activeBoard,
    getFieldForBoard,
    ticketTypeId,
    compact = false,
  }) => {
    // Get field definition with board-specific and ticket-type-specific overrides applied
    const fieldDef = getFieldForBoard
      ? getFieldForBoard(fieldId, activeBoard, ticketTypeId)
      : FIELD_LIBRARY_NORMALIZED[fieldId];
    if (!fieldDef) return null;

    // BUG-004 FIX: Don't render hidden fields
    if (fieldDef.hidden) return null;

    const value = formData[fieldId] || '';
    const handleChange = (newValue) => {
      setFormData({ ...formData, [fieldId]: newValue });
    };

    // Get options based on field configuration
    const getOptions = () => {
      if (fieldDef.options) return fieldDef.options;
      if (fieldDef.optionsFrom === 'staffList') {
        return opCentre?.staffList || company.globalStaff.map((s) => s.name);
      }
      if (fieldDef.optionsFrom === 'customers') {
        return company.globalCRM || [];
      }
      if (fieldDef.optionsFrom === 'globalProjects') {
        return company.globalProjects || [];
      }
      // SPRINT EXPANSION: Handle boardContainers for sprint/iteration selection
      if (fieldDef.optionsFrom === 'boardContainers') {
        // Get containers for the current Work Centre that are planning or active
        const containers = (company.containers || [])
          .filter((c) => c.opCentreId === opCentre?.id && (c.status === 'planning' || c.status === 'active'))
          .sort((a, b) => (b.sequence || 0) - (a.sequence || 0)); // Newest first
        return containers;
      }
      return [];
    };

    const labelClass = compact
      ? 'block text-xs font-medium text-gray-600 mb-1'
      : 'block text-sm font-medium text-gray-700 mb-1';
    const inputClass = compact
      ? 'w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500'
      : 'w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500';

    // Render based on field type
    switch (fieldDef.type) {
      case 'text':
        return (
          <div>
            <label className={labelClass}>
              {fieldDef.label} {fieldDef.required && '*'}
            </label>
            <input
              type="text"
              required={fieldDef.required}
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={fieldDef.placeholder}
              className={inputClass}
            />
          </div>
        );

      case 'textarea':
        return (
          <div>
            <label className={labelClass}>
              {fieldDef.label} {fieldDef.required && '*'}
            </label>
            <textarea
              required={fieldDef.required}
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              rows={compact ? 2 : fieldDef.rows || 4}
              className={inputClass}
            />
          </div>
        );

      case 'number':
        return (
          <div>
            <label className={labelClass}>
              {fieldDef.label} {fieldDef.required && '*'}
            </label>
            <input
              type="number"
              required={fieldDef.required}
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              min={fieldDef.min}
              max={fieldDef.max}
              className={inputClass}
            />
          </div>
        );

      case 'select':
        const options = getOptions();

        // Handle customer dropdown specially
        if (fieldDef.optionsFrom === 'customers') {
          return (
            <div>
              <label className={labelClass}>
                {fieldDef.label} {fieldDef.required && '*'}
              </label>
              <select
                required={fieldDef.required}
                value={value || ''}
                onChange={(e) => handleChange(e.target.value || null)}
                className={inputClass}
              >
                <option value="">-- Select --</option>
                {options.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.companyName}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        // Handle global project dropdown
        if (fieldDef.optionsFrom === 'globalProjects') {
          return (
            <div>
              <label className={labelClass}>
                {fieldDef.label} {fieldDef.required && '*'}
              </label>
              <select
                required={fieldDef.required}
                value={value || ''}
                onChange={(e) => handleChange(e.target.value || null)}
                className={inputClass}
              >
                <option value="">None</option>
                {options.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.id} - {project.name}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        // v060: Handle work unit dropdown (sprints, phases, etc.)
        if (fieldDef.optionsFrom === 'boardContainers') {
          // Check if the board has work unit series configured
          const currentBoard = opCentre?.processBoards?.find((b) => b.id === activeBoard);
          if (!currentBoard?.workUnitSeries) {
            // Board doesn't use work units, show nothing or a disabled field
            return null;
          }

          return (
            <div>
              <label className={labelClass}>
                {currentBoard.workUnitSeries.label || fieldDef.label} {fieldDef.required && '*'}
              </label>
              <select
                required={fieldDef.required}
                value={value || ''}
                onChange={(e) => handleChange(e.target.value || null)}
                className={inputClass}
              >
                <option value="">-- Select --</option>
                {options.map((container) => (
                  <option key={container.id} value={container.id}>
                    {container.name}
                    {container.status === 'active' ? ' (Active)' : ''}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        // Regular select
        return (
          <div>
            <label className={labelClass}>
              {fieldDef.label} {fieldDef.required && '*'}
            </label>
            <select
              required={fieldDef.required}
              value={value || fieldDef.defaultValue || ''}
              onChange={(e) => handleChange(e.target.value)}
              className={inputClass}
            >
              {!fieldDef.required && !fieldDef.defaultValue && <option value="">-- Select --</option>}
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        );

      case 'email':
      case 'tel':
      case 'url':
        return (
          <div>
            <label className={labelClass}>
              {fieldDef.label} {fieldDef.required && '*'}
            </label>
            <input
              type={fieldDef.type}
              required={fieldDef.required}
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={fieldDef.placeholder}
              className={inputClass}
            />
          </div>
        );

      // v073: Date field type
      case 'date':
        return (
          <div>
            <label className={labelClass}>
              {fieldDef.label} {fieldDef.required && '*'}
            </label>
            <input
              type="date"
              required={fieldDef.required}
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              className={inputClass}
            />
          </div>
        );

      // v073: User field type - dropdown of staff members
      case 'user':
        const staffList = company?.globalStaff || [];
        return (
          <div>
            <label className={labelClass}>
              {fieldDef.label} {fieldDef.required && '*'}
            </label>
            <select
              required={fieldDef.required}
              value={value || ''}
              onChange={(e) => handleChange(e.target.value || null)}
              className={inputClass}
            >
              <option value="">-- Select --</option>
              {staffList.map((staff) => (
                <option key={staff.id} value={staff.name}>
                  {staff.name}
                </option>
              ))}
            </select>
          </div>
        );

      // v073: Customer field type - dropdown of CRM clients
      case 'customer':
        const customers = company?.globalCRM || [];
        return (
          <div>
            <label className={labelClass}>
              {fieldDef.label} {fieldDef.required && '*'}
            </label>
            <select
              required={fieldDef.required}
              value={value || ''}
              onChange={(e) => handleChange(e.target.value || null)}
              className={inputClass}
            >
              <option value="">-- Select --</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.companyName}
                </option>
              ))}
            </select>
          </div>
        );

      // v073: Project field type - dropdown of global projects
      case 'project':
        const projects = company?.globalProjects || [];
        return (
          <div>
            <label className={labelClass}>
              {fieldDef.label} {fieldDef.required && '*'}
            </label>
            <select
              required={fieldDef.required}
              value={value || ''}
              onChange={(e) => handleChange(e.target.value || null)}
              className={inputClass}
            >
              <option value="">-- Select --</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        );

      // v073: Work Unit field type - dropdown of sprints/phases/etc
      case 'workunit':
        const currentBoard = opCentre?.processBoards?.find((b) => b.id === activeBoard);
        const workUnits = (company?.workUnits || [])
          .filter((wu) => wu.workCentreId === opCentre?.id && (wu.status === 'planning' || wu.status === 'active'))
          .sort((a, b) => (b.sequence || 0) - (a.sequence || 0));

        // If board doesn't have work unit series, still show field but with available work units
        const seriesLabel = currentBoard?.workUnitSeries?.label || 'Work Unit';

        return (
          <div>
            <label className={labelClass}>
              {seriesLabel} {fieldDef.required && '*'}
            </label>
            <select
              required={fieldDef.required}
              value={value || ''}
              onChange={(e) => handleChange(e.target.value || null)}
              className={inputClass}
            >
              <option value="">-- Select --</option>
              {workUnits.map((wu) => (
                <option key={wu.id} value={wu.id}>
                  {wu.name}
                  {wu.status === 'active' ? ' (Active)' : ''}
                </option>
              ))}
            </select>
          </div>
        );

      // v073: Currency field type - number input with currency formatting
      case 'currency':
        return (
          <div>
            <label className={labelClass}>
              {fieldDef.label} {fieldDef.required && '*'}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                required={fieldDef.required}
                value={value}
                onChange={(e) => handleChange(e.target.value)}
                min={fieldDef.min || 0}
                step="0.01"
                className={`${inputClass} pl-7`}
              />
            </div>
          </div>
        );

      // v073: Rich text field type - falls back to textarea in right panel
      case 'richtext':
        return (
          <div>
            <label className={labelClass}>
              {fieldDef.label} {fieldDef.required && '*'}
            </label>
            <textarea
              required={fieldDef.required}
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              rows={compact ? 3 : fieldDef.rows || 4}
              className={inputClass}
              placeholder={fieldDef.placeholder || 'Enter text...'}
            />
          </div>
        );

      // v073: Multi-user field type - multi-select for staff
      case 'multiuser':
        const allStaff = company?.globalStaff || [];
        const selectedUsers = Array.isArray(value) ? value : value ? [value] : [];
        return (
          <div>
            <label className={labelClass}>
              {fieldDef.label} {fieldDef.required && '*'}
            </label>
            <select
              multiple
              required={fieldDef.required}
              value={selectedUsers}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions, (option) => option.value);
                handleChange(selected);
              }}
              className={`${inputClass} min-h-[80px]`}
            >
              {allStaff.map((staff) => (
                <option key={staff.id} value={staff.name}>
                  {staff.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">Hold Ctrl/Cmd to select multiple</p>
          </div>
        );

      // v073: Multi-select field type - multi-select for options
      case 'multiselect':
        const multiOptions = fieldDef.options || [];
        const selectedOptions = Array.isArray(value) ? value : value ? [value] : [];
        return (
          <div>
            <label className={labelClass}>
              {fieldDef.label} {fieldDef.required && '*'}
            </label>
            <select
              multiple
              required={fieldDef.required}
              value={selectedOptions}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions, (option) => option.value);
                handleChange(selected);
              }}
              className={`${inputClass} min-h-[80px]`}
            >
              {multiOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">Hold Ctrl/Cmd to select multiple</p>
          </div>
        );

      default:
        // v073: Log unknown field types for debugging
        console.warn(`DynamicField: Unknown field type '${fieldDef.type}' for field '${fieldId}'`);
        return null;
    }
  };

  // Export to window namespace
  window.Components = window.Components || {};
  window.Components.DynamicField = DynamicField;

  // v153: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['dynamic-field'] = COMPONENT_VERSION;

  console.log(`[dynamic-field.jsx] DynamicField loaded (${COMPONENT_VERSION})`);
})();

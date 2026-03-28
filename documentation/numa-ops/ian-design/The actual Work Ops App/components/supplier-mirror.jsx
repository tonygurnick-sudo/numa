/**
 * Supplier Mirror Component
 * Numa Ops Management
 *
 * Component Version: v188a (aligned with v188 App release)
 *
 * v188a Changes:
 * - NEW: onCreateSupplier prop - callback to create new supplier
 * - NEW: "+ New Supplier" button in SupplierMirrorHeader
 * - Button appears next to supplier count, uses teal styling (consistent with supplier theme)
 *
 * v184a: Initial implementation
 * - Parallel to CRM Mirror (crm-mirror.jsx v174a)
 * - Displays filtered global suppliers on boards
 * - Reads from company.globalSuppliers (single source of truth)
 * - Filters by stage/territory/owner based on board.supplierMirror config
 * - Groups suppliers into kanban columns by lifecycle stage
 * - Drag-drop updates supplier stage globally
 * - Click opens Supplier Detail Modal
 * - Teal colour scheme (consistent with supplier UI theme)
 *
 * Dependencies:
 * - window.Icons (Users, Building2, Phone, Mail, Truck)
 * - window.Shared.ColorUtils (getColorForPosition, getContrastTextColor)
 * - company.supplierConfig (lifecycle stages, flags)
 * - company.globalSuppliers (supplier data)
 *
 * Exported via: window.Components.SupplierMirror
 */
(function () {
  'use strict';

  const COMPONENT_VERSION = 'v188a';

  const { useState, useMemo } = React;

  // Icons from shared/icons.js
  const { Users, Building2, Phone, Mail, Star, ChevronRight, Truck } = window.Icons || {};

  // Color utilities from shared/color-utils.js
  const ColorUtils = window.Shared?.ColorUtils || window.ColorUtils || {};
  const { getColorForPosition, getContrastTextColor } = ColorUtils;

  /**
   * Apply Supplier filter conditions to suppliers
   * @param {array} suppliers - All globalSuppliers
   * @param {object} filter - Filter config with conditions array
   * @returns {array} Filtered suppliers
   */
  function applySupplierFilter(suppliers, filter) {
    if (!filter?.conditions || filter.conditions.length === 0) {
      return suppliers;
    }

    return suppliers.filter((supplier) => {
      // All conditions must match (AND logic)
      return filter.conditions.every((condition) => {
        const { field, operator, value } = condition;
        const supplierValue = supplier[field];

        switch (operator) {
          case 'in':
            // value is an array, check if supplierValue is in it
            return Array.isArray(value) && value.includes(supplierValue);
          case 'equals':
            return supplierValue === value;
          case 'notEquals':
            return supplierValue !== value;
          default:
            return true;
        }
      });
    });
  }

  /**
   * Extract stage filter values from conditions array
   * @param {object} filter - Filter config with conditions array
   * @returns {array} Array of stage IDs to show, or empty array if no stage filter
   */
  function extractStageFilterValues(filter) {
    if (!filter?.conditions || filter.conditions.length === 0) {
      return [];
    }

    // Find stage condition
    const stageCondition = filter.conditions.find((c) => c.field === 'stage');
    if (!stageCondition) {
      return [];
    }

    // Extract values based on operator
    if (stageCondition.operator === 'in' && Array.isArray(stageCondition.value)) {
      return stageCondition.value;
    }
    if (stageCondition.operator === 'equals' && stageCondition.value) {
      return [stageCondition.value];
    }

    return [];
  }

  /**
   * Group suppliers by field value
   * @param {array} suppliers - Filtered suppliers
   * @param {string} groupBy - Field to group by ('stage', 'territory', 'accountOwnerId', or null)
   * @param {object} supplierConfig - For stage ordering
   * @param {array} globalStaff - For owner names
   * @param {object} filter - Filter config to determine which columns to show
   * @returns {array} Array of { key, label, color, suppliers }
   */
  function groupSuppliers(suppliers, groupBy, supplierConfig, globalStaff, filter) {
    if (!groupBy) {
      // No grouping - single column
      return [
        {
          key: 'all',
          label: 'All Suppliers',
          color: null,
          suppliers: suppliers,
        },
      ];
    }

    if (groupBy === 'stage') {
      // Group by lifecycle stage - use configured order
      let stages = supplierConfig?.lifecycleStages || [];

      // Extract stage filter from conditions array
      const stageFilterValues = extractStageFilterValues(filter);
      if (stageFilterValues.length > 0) {
        stages = stages.filter((s) => stageFilterValues.includes(s.id));
      }

      const groups = stages.map((stage) => {
        const stageSuppliers = suppliers.filter((s) => s.stage === stage.id);
        const color = getColorForPosition ? getColorForPosition(stage.colorPosition) : '#6B7280';
        return {
          key: stage.id,
          label: stage.name,
          color: color,
          colorPosition: stage.colorPosition,
          suppliers: stageSuppliers,
        };
      });

      // Add "Unassigned" group for suppliers with no stage (only if no stage filter active)
      if (stageFilterValues.length === 0) {
        const unassigned = suppliers.filter(
          (s) => !s.stage || !(supplierConfig?.lifecycleStages || []).find((st) => st.id === s.stage)
        );
        if (unassigned.length > 0) {
          groups.push({
            key: 'unassigned',
            label: 'Unassigned',
            color: '#9CA3AF',
            suppliers: unassigned,
          });
        }
      }

      return groups;
    }

    if (groupBy === 'territory') {
      // Group by territory
      const territories = new Map();
      suppliers.forEach((supplier) => {
        const territory = supplier.territory || 'Unassigned';
        if (!territories.has(territory)) {
          territories.set(territory, []);
        }
        territories.get(territory).push(supplier);
      });

      return Array.from(territories.entries()).map(([territory, supps]) => ({
        key: territory,
        label: territory,
        color: null,
        suppliers: supps,
      }));
    }

    if (groupBy === 'accountOwnerId') {
      // Group by relationship owner
      const owners = new Map();
      suppliers.forEach((supplier) => {
        const ownerId = supplier.accountOwnerId || 'unassigned';
        if (!owners.has(ownerId)) {
          owners.set(ownerId, []);
        }
        owners.get(ownerId).push(supplier);
      });

      return Array.from(owners.entries()).map(([ownerId, supps]) => {
        const owner = (globalStaff || []).find((s) => s.id === ownerId);
        return {
          key: ownerId,
          label: owner?.name || (ownerId === 'unassigned' ? 'Unassigned' : ownerId),
          color: null,
          suppliers: supps,
        };
      });
    }

    // Unknown groupBy - return all in one column
    return [
      {
        key: 'all',
        label: 'All Suppliers',
        color: null,
        suppliers: suppliers,
      },
    ];
  }

  /**
   * Sort suppliers within groups
   * @param {array} suppliers - Suppliers to sort
   * @param {string} sortBy - Field to sort by
   * @param {string} sortOrder - 'asc' or 'desc'
   * @returns {array} Sorted suppliers
   */
  function sortSuppliers(suppliers, sortBy, sortOrder) {
    if (!sortBy) return suppliers;

    const sorted = [...suppliers].sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];

      // Handle nulls
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      // String comparison
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal || '').toLowerCase();
        return aVal.localeCompare(bVal);
      }

      // Number/date comparison
      return aVal - bVal;
    });

    return sortOrder === 'desc' ? sorted.reverse() : sorted;
  }

  /**
   * Get primary contact from contacts array
   * @param {array} contacts
   * @returns {object|null}
   */
  function getPrimaryContact(contacts) {
    if (!contacts || contacts.length === 0) return null;
    return contacts.find((c) => c.isPrimary) || contacts[0];
  }

  /**
   * Format last contact date
   * @param {array} activities
   * @returns {string}
   */
  function formatLastContact(activities) {
    if (!activities || activities.length === 0) return 'No contact';

    // Find most recent activity
    const sorted = [...activities].sort((a, b) => new Date(b.date) - new Date(a.date));
    const lastDate = new Date(sorted[0].date);
    const now = new Date();
    const diffDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  }

  /**
   * Count open tickets for supplier
   * @param {array} tickets
   * @param {string} supplierId
   * @returns {number}
   */
  function countOpenTickets(tickets, supplierId) {
    if (!tickets || !supplierId) return 0;
    return tickets.filter(
      (t) => t.supplier === supplierId && t.status !== 'completed' && t.status !== 'done' && t.status !== 'deleted'
    ).length;
  }

  /**
   * Simple Supplier Card for Supplier Mirror
   * Teal colour scheme
   */
  const SupplierCardSimple = ({
    supplier,
    supplierConfig,
    tickets,
    onClick,
    onDragStart,
    onDragOver,
    isHighlighted,
    dropTarget,
  }) => {
    const primaryContact = getPrimaryContact(supplier.contacts);
    const lastContact = formatLastContact(supplier.activities);
    const openTickets = countOpenTickets(tickets, supplier.id);

    // Get supplier flags
    const supplierFlags = (supplier.flags || [])
      .map((flagId) => (supplierConfig?.supplierFlags || []).find((f) => f.id === flagId))
      .filter(Boolean);

    const isDropTarget = dropTarget?.type === 'supplier' && dropTarget?.supplierId === supplier.id;

    return (
      <div
        draggable
        onDragStart={(e) => onDragStart(e, supplier)}
        onDragOver={(e) => onDragOver(e, supplier.id)}
        onClick={() => onClick(supplier)}
        className={`bg-white rounded-lg border p-3 cursor-pointer transition-all
          ${isHighlighted ? 'ring-2 ring-teal-500 bg-teal-50' : 'hover:shadow-md'}
          ${isDropTarget ? 'border-teal-500 border-2' : 'border-gray-200'}
        `}
      >
        {/* Header: Company name + flags */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h4 className="font-medium text-gray-900 text-sm leading-tight">{supplier.companyName}</h4>
          {supplierFlags.length > 0 && (
            <div className="flex gap-1 flex-shrink-0">
              {supplierFlags.map((flag) => (
                <span key={flag.id} title={flag.name} className="text-sm">
                  {flag.icon}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Primary contact */}
        {primaryContact && (
          <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-1.5">
            {primaryContact.isPrimary && <Star size={12} className="text-yellow-500" />}
            <span className="truncate">{primaryContact.name}</span>
            {primaryContact.role && <span className="text-gray-400">({primaryContact.role})</span>}
          </div>
        )}

        {/* Industry + size */}
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
          {supplier.industry && <span className="truncate">{supplier.industry}</span>}
          {supplier.industry && supplier.companySize && <span>•</span>}
          {supplier.companySize && <span>{supplier.companySize}</span>}
        </div>

        {/* Footer: Last contact + open tickets */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">{lastContact}</span>
          {openTickets > 0 && (
            <span className="bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded">{openTickets} open</span>
          )}
        </div>
      </div>
    );
  };

  /**
   * Supplier Kanban Column
   * Single column in grouped view
   */
  const SupplierKanbanColumn = ({
    group,
    supplierConfig,
    tickets,
    onSupplierClick,
    onDragStart,
    onDrop,
    onSupplierDragOver,
    highlightedSupplierId,
    dropTarget,
  }) => {
    const { key, label, color, suppliers } = group;

    // Calculate header style
    const headerStyle = color
      ? {
          backgroundColor: color,
          color: getContrastTextColor ? getContrastTextColor(color) : '#FFFFFF',
        }
      : {};

    const handleDragOver = (e) => {
      e.preventDefault();
    };

    const handleDrop = (e) => {
      e.preventDefault();
      onDrop(e, key);
    };

    // Show drop indicator at bottom of column
    const showColumnDropIndicator = dropTarget?.type === 'column' && dropTarget?.columnKey === key;

    return (
      <div className="flex-shrink-0 w-72 bg-gray-50 rounded-lg" onDragOver={handleDragOver} onDrop={handleDrop}>
        {/* Column header */}
        <div
          className="px-3 py-2 rounded-t-lg font-medium text-sm flex items-center justify-between"
          style={color ? headerStyle : {}}
        >
          <span className={!color ? 'text-gray-700' : ''}>{label}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${color ? 'bg-white/20' : 'bg-gray-200 text-gray-600'}`}>
            {suppliers.length}
          </span>
        </div>

        {/* Supplier cards */}
        <div className="p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-300px)] overflow-y-auto">
          {suppliers.map((supplier) => (
            <SupplierCardSimple
              key={supplier.id}
              supplier={supplier}
              supplierConfig={supplierConfig}
              tickets={tickets}
              onClick={onSupplierClick}
              onDragStart={onDragStart}
              onDragOver={onSupplierDragOver}
              isHighlighted={highlightedSupplierId === supplier.id}
              dropTarget={dropTarget}
            />
          ))}

          {/* Empty state */}
          {suppliers.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">No suppliers</div>}

          {/* Column drop indicator */}
          {showColumnDropIndicator && <div className="h-1 bg-teal-500 rounded-full mx-2" />}
        </div>
      </div>
    );
  };

  /**
   * Supplier Mirror Header
   * Shows supplier count with filtered vs total when filter is active
   * v188a: Added "+ New Supplier" button
   */
  const SupplierMirrorHeader = ({ filteredCount, totalCount, onCreateSupplier }) => {
    const isFiltered = filteredCount !== totalCount;

    return (
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {isFiltered ? `${filteredCount} of ${totalCount} suppliers` : `${totalCount} suppliers`}
        </div>
        {onCreateSupplier && (
          <button
            onClick={onCreateSupplier}
            className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition flex items-center gap-1"
          >
            <span>+</span> New Supplier
          </button>
        )}
      </div>
    );
  };

  /**
   * Main Supplier Mirror Component
   * Displays filtered suppliers in kanban columns
   */
  const SupplierMirror = ({
    suppliers, // company.globalSuppliers
    totalSupplierCount, // Total count before filtering
    supplierMirror, // board.supplierMirror config
    supplierConfig, // company.supplierConfig
    globalStaff, // company.globalStaff
    tickets, // All tickets (for linked work count)
    onSupplierClick, // Open detail modal
    onCreateSupplier, // v188a: Create new supplier
    onSupplierDrag, // Update supplier field (stage/territory/owner)
    highlightedSupplierId,
    dropTarget,
    onSupplierDragOver,
  }) => {
    // Apply filter
    const filteredSuppliers = useMemo(() => {
      return applySupplierFilter(suppliers || [], supplierMirror?.filter);
    }, [suppliers, supplierMirror?.filter]);

    // Group suppliers
    const groups = useMemo(() => {
      const grouped = groupSuppliers(
        filteredSuppliers,
        supplierMirror?.groupBy || 'stage',
        supplierConfig,
        globalStaff,
        supplierMirror?.filter
      );

      // Sort suppliers within each group
      return grouped.map((group) => ({
        ...group,
        suppliers: sortSuppliers(
          group.suppliers,
          supplierMirror?.sortBy || 'companyName',
          supplierMirror?.sortOrder || 'asc'
        ),
      }));
    }, [
      filteredSuppliers,
      supplierMirror?.groupBy,
      supplierMirror?.sortBy,
      supplierMirror?.sortOrder,
      supplierMirror?.filter,
      supplierConfig,
      globalStaff,
    ]);

    // Drag handlers
    const handleDragStart = (e, supplier) => {
      e.dataTransfer.setData(
        'text/plain',
        JSON.stringify({
          type: 'supplier',
          id: supplier.id,
          currentStage: supplier.stage,
          currentTerritory: supplier.territory,
          currentOwner: supplier.accountOwnerId,
        })
      );
      e.dataTransfer.effectAllowed = 'move';
    };

    const handleDrop = (e, targetKey) => {
      e.preventDefault();
      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (data.type === 'supplier' && onSupplierDrag) {
          // Determine which field to update based on groupBy
          const groupBy = supplierMirror?.groupBy || 'stage';
          onSupplierDrag(data.id, groupBy, targetKey);
        }
      } catch (err) {
        console.error('Drop error:', err);
      }
    };

    // Calculate total for header (use prop if provided, otherwise use suppliers array length)
    const total = totalSupplierCount ?? (suppliers || []).length;

    // Empty state - no suppliers at all
    if (!suppliers || suppliers.length === 0) {
      return (
        <div className="bg-gray-50 rounded-lg p-8 text-center">
          {Truck ? <Truck size={48} className="mx-auto text-gray-300 mb-4" /> : <span className="text-4xl">🏭</span>}
          <h3 className="text-lg font-medium text-gray-600 mb-2">No Suppliers</h3>
          <p className="text-gray-500 text-sm mb-4">Add suppliers to see them here.</p>
          {onCreateSupplier && (
            <button
              onClick={onCreateSupplier}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition"
            >
              + New Supplier
            </button>
          )}
        </div>
      );
    }

    // Empty state - no matching suppliers after filter
    if (filteredSuppliers.length === 0) {
      return (
        <div className="bg-gray-50 rounded-lg p-8 text-center">
          {Truck ? <Truck size={48} className="mx-auto text-gray-300 mb-4" /> : <span className="text-4xl">🏭</span>}
          <h3 className="text-lg font-medium text-gray-600 mb-2">No Matching Suppliers</h3>
          <p className="text-gray-500 text-sm">Adjust the Supplier Mirror filter in Board Settings to see suppliers.</p>
          <p className="text-gray-400 text-xs mt-2">0 of {total} suppliers match filter</p>
        </div>
      );
    }

    return (
      <div>
        {/* Show filtered count header */}
        {/* v188a: Added onCreateSupplier for "+ New Supplier" button */}
        <SupplierMirrorHeader
          filteredCount={filteredSuppliers.length}
          totalCount={total}
          onCreateSupplier={onCreateSupplier}
        />

        <div className="flex gap-4 overflow-x-auto pb-4 items-stretch">
          {groups.map((group) => (
            <SupplierKanbanColumn
              key={group.key}
              group={group}
              supplierConfig={supplierConfig}
              tickets={tickets}
              onSupplierClick={onSupplierClick}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
              onSupplierDragOver={onSupplierDragOver}
              highlightedSupplierId={highlightedSupplierId}
              dropTarget={dropTarget}
            />
          ))}
        </div>
      </div>
    );
  };

  // Export to window namespace
  window.Components = window.Components || {};
  window.Components.SupplierMirror = SupplierMirror;

  // Also export utilities for testing
  window.Components.SupplierMirrorUtils = {
    applySupplierFilter,
    extractStageFilterValues,
    groupSuppliers,
    sortSuppliers,
    getPrimaryContact,
    formatLastContact,
    countOpenTickets,
  };

  // Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['supplier-mirror'] = COMPONENT_VERSION;

  console.log(`[supplier-mirror.jsx] SupplierMirror loaded (${COMPONENT_VERSION})`);
})();

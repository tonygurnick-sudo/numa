/**
 * CRM Mirror Component
 * Numa Ops Management
 *
 * Component Version: v188a (aligned with v188 App release)
 *
 * v188a Changes:
 * - NEW: onCreateCustomer prop - callback to create new customer
 * - NEW: "+ New Customer" button in CrmMirrorHeader
 * - Button appears next to customer count, uses indigo styling
 *
 * v174a Changes:
 * - BUG-173-001 FIX: Header now shows filtered count when filter is active
 *   - New prop: totalCustomerCount (passed from app.jsx)
 *   - Header displays "X of Y customers" when filtered, "Y customers" when not
 *   - Added CrmMirrorHeader component for header display
 *
 * v173a Changes:
 * - BUG-171-003 FIX (ACTUAL): Stage filter now correctly extracts from conditions array
 *   - Previous v172b attempted to check filter.stages which doesn't exist
 *   - Filter structure uses conditions: [{ field: 'stage', operator: 'in', value: [...] }]
 *   - New helper function extractStageFilterValues() extracts stage IDs from conditions
 *   - groupCustomers() now uses extracted values for column filtering
 *
 * v172b Changes (BROKEN):
 * - Attempted BUG-171-003 FIX but checked wrong property (filter.stages)
 *
 * CRM Phase 3: Displays filtered global customers on boards
 * - Reads from company.globalCRM (single source of truth)
 * - Filters by stage/territory/owner based on board.crmMirror config
 * - Groups customers into kanban columns by lifecycle stage
 * - Drag-drop updates customer stage globally
 * - Click opens Customer Detail Modal (Phase 2)
 *
 * Dependencies:
 * - window.Icons (Users, Building2, Phone, Mail)
 * - window.Shared.ColorUtils (getColorForPosition, getContrastTextColor)
 * - company.crmConfig (lifecycle stages, flags)
 * - company.globalCRM (customer data)
 *
 * Exported via: window.Components.CrmMirror
 */
(function () {
  'use strict';

  const COMPONENT_VERSION = 'v188a';

  const { useState, useMemo } = React;

  // Icons from shared/icons.js
  const { Users, Building2, Phone, Mail, Star, ChevronRight } = window.Icons || {};

  // Color utilities from shared/color-utils.js
  // Check both window.Shared.ColorUtils and window.ColorUtils for compatibility
  const ColorUtils = window.Shared?.ColorUtils || window.ColorUtils || {};
  const { getColorForPosition, getContrastTextColor } = ColorUtils;

  /**
   * Apply CRM filter conditions to customers
   * @param {array} customers - All globalCRM customers
   * @param {object} filter - Filter config with conditions array
   * @returns {array} Filtered customers
   */
  function applyCrmFilter(customers, filter) {
    if (!filter?.conditions || filter.conditions.length === 0) {
      return customers;
    }

    return customers.filter((customer) => {
      // All conditions must match (AND logic)
      return filter.conditions.every((condition) => {
        const { field, operator, value } = condition;
        const customerValue = customer[field];

        switch (operator) {
          case 'in':
            // value is an array, check if customerValue is in it
            return Array.isArray(value) && value.includes(customerValue);
          case 'equals':
            return customerValue === value;
          case 'notEquals':
            return customerValue !== value;
          default:
            return true;
        }
      });
    });
  }

  /**
   * v173a: Extract stage filter values from conditions array
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
   * Group customers by field value
   * @param {array} customers - Filtered customers
   * @param {string} groupBy - Field to group by ('stage', 'territory', 'accountOwnerId', or null)
   * @param {object} crmConfig - For stage ordering
   * @param {array} globalStaff - For owner names
   * @param {object} filter - v173a: Filter config to determine which columns to show
   * @returns {array} Array of { key, label, color, customers }
   */
  function groupCustomers(customers, groupBy, crmConfig, globalStaff, filter) {
    if (!groupBy) {
      // No grouping - single column
      return [
        {
          key: 'all',
          label: 'All Customers',
          color: null,
          customers: customers,
        },
      ];
    }

    if (groupBy === 'stage') {
      // Group by lifecycle stage - use configured order
      let stages = crmConfig?.lifecycleStages || [];

      // v173a: BUG-171-003 FIX - Extract stage filter from conditions array
      const stageFilterValues = extractStageFilterValues(filter);
      if (stageFilterValues.length > 0) {
        stages = stages.filter((s) => stageFilterValues.includes(s.id));
      }

      const groups = stages.map((stage) => {
        const stageCustomers = customers.filter((c) => c.stage === stage.id);
        const color = getColorForPosition ? getColorForPosition(stage.colorPosition) : '#6B7280';
        return {
          key: stage.id,
          label: stage.name,
          color: color,
          colorPosition: stage.colorPosition,
          customers: stageCustomers,
        };
      });

      // Add "Unassigned" group for customers with no stage (only if no stage filter active)
      // v173a: Use stageFilterValues instead of filter?.stages
      if (stageFilterValues.length === 0) {
        const unassigned = customers.filter(
          (c) => !c.stage || !(crmConfig?.lifecycleStages || []).find((s) => s.id === c.stage)
        );
        if (unassigned.length > 0) {
          groups.push({
            key: 'unassigned',
            label: 'Unassigned',
            color: '#9CA3AF',
            customers: unassigned,
          });
        }
      }

      return groups;
    }

    if (groupBy === 'territory') {
      // Group by territory
      const territories = new Map();
      customers.forEach((customer) => {
        const territory = customer.territory || 'Unassigned';
        if (!territories.has(territory)) {
          territories.set(territory, []);
        }
        territories.get(territory).push(customer);
      });

      return Array.from(territories.entries()).map(([territory, custs]) => ({
        key: territory,
        label: territory,
        color: null,
        customers: custs,
      }));
    }

    if (groupBy === 'accountOwnerId') {
      // Group by account owner
      const owners = new Map();
      customers.forEach((customer) => {
        const ownerId = customer.accountOwnerId || 'unassigned';
        if (!owners.has(ownerId)) {
          owners.set(ownerId, []);
        }
        owners.get(ownerId).push(customer);
      });

      return Array.from(owners.entries()).map(([ownerId, custs]) => {
        const owner = (globalStaff || []).find((s) => s.id === ownerId);
        return {
          key: ownerId,
          label: owner?.name || (ownerId === 'unassigned' ? 'Unassigned' : ownerId),
          color: null,
          customers: custs,
        };
      });
    }

    // Unknown groupBy - return all in one column
    return [
      {
        key: 'all',
        label: 'All Customers',
        color: null,
        customers: customers,
      },
    ];
  }

  /**
   * Sort customers within groups
   * @param {array} customers - Customers to sort
   * @param {string} sortBy - Field to sort by
   * @param {string} sortOrder - 'asc' or 'desc'
   * @returns {array} Sorted customers
   */
  function sortCustomers(customers, sortBy, sortOrder) {
    if (!sortBy) return customers;

    const sorted = [...customers].sort((a, b) => {
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
   * Count open tickets for customer
   * @param {array} tickets
   * @param {string} customerId
   * @returns {number}
   */
  function countOpenTickets(tickets, customerId) {
    if (!tickets || !customerId) return 0;
    return tickets.filter(
      (t) => t.client === customerId && t.status !== 'completed' && t.status !== 'done' && t.status !== 'deleted'
    ).length;
  }

  /**
   * Simple Customer Card for CRM Mirror
   * Basic card - enhanced version in Phase 7
   */
  const CustomerCardSimple = ({
    customer,
    crmConfig,
    tickets,
    onClick,
    onDragStart,
    onDragOver,
    isHighlighted,
    dropTarget,
  }) => {
    const primaryContact = getPrimaryContact(customer.contacts);
    const lastContact = formatLastContact(customer.activities);
    const openTickets = countOpenTickets(tickets, customer.id);

    // Get customer flags
    const customerFlags = (customer.flags || [])
      .map((flagId) => (crmConfig?.customerFlags || []).find((f) => f.id === flagId))
      .filter(Boolean);

    const isDropTarget = dropTarget?.type === 'customer' && dropTarget?.customerId === customer.id;

    return (
      <div
        draggable
        onDragStart={(e) => onDragStart(e, customer)}
        onDragOver={(e) => onDragOver(e, customer.id)}
        onClick={() => onClick(customer)}
        className={`bg-white rounded-lg border p-3 cursor-pointer transition-all
          ${isHighlighted ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:shadow-md'}
          ${isDropTarget ? 'border-blue-500 border-2' : 'border-gray-200'}
        `}
      >
        {/* Header: Company name + flags */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h4 className="font-medium text-gray-900 text-sm leading-tight">{customer.companyName}</h4>
          {customerFlags.length > 0 && (
            <div className="flex gap-1 flex-shrink-0">
              {customerFlags.map((flag) => (
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
          {customer.industry && <span className="truncate">{customer.industry}</span>}
          {customer.industry && customer.companySize && <span>•</span>}
          {customer.companySize && <span>{customer.companySize}</span>}
        </div>

        {/* Footer: Last contact + open tickets */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">{lastContact}</span>
          {openTickets > 0 && (
            <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{openTickets} open</span>
          )}
        </div>
      </div>
    );
  };

  /**
   * CRM Kanban Column
   * Single column in grouped view
   */
  const CrmKanbanColumn = ({
    group,
    crmConfig,
    tickets,
    onCustomerClick,
    onDragStart,
    onDrop,
    onCustomerDragOver,
    highlightedCustomerId,
    dropTarget,
  }) => {
    const { key, label, color, customers } = group;

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
            {customers.length}
          </span>
        </div>

        {/* Customer cards */}
        <div className="p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-300px)] overflow-y-auto">
          {customers.map((customer) => (
            <CustomerCardSimple
              key={customer.id}
              customer={customer}
              crmConfig={crmConfig}
              tickets={tickets}
              onClick={onCustomerClick}
              onDragStart={onDragStart}
              onDragOver={onCustomerDragOver}
              isHighlighted={highlightedCustomerId === customer.id}
              dropTarget={dropTarget}
            />
          ))}

          {/* Empty state */}
          {customers.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">No customers</div>}

          {/* Column drop indicator */}
          {showColumnDropIndicator && <div className="h-1 bg-blue-500 rounded-full mx-2" />}
        </div>
      </div>
    );
  };

  /**
   * v174a: CRM Mirror Header
   * Shows customer count with filtered vs total when filter is active
   * v188a: Added "+ New Customer" button
   */
  const CrmMirrorHeader = ({ filteredCount, totalCount, onCreateCustomer }) => {
    const isFiltered = filteredCount !== totalCount;

    return (
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {isFiltered ? `${filteredCount} of ${totalCount} customers` : `${totalCount} customers`}
        </div>
        {onCreateCustomer && (
          <button
            onClick={onCreateCustomer}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center gap-1"
          >
            <span>+</span> New Customer
          </button>
        )}
      </div>
    );
  };

  /**
   * Main CRM Mirror Component
   * Displays filtered customers in kanban columns
   */
  const CrmMirror = ({
    customers, // company.globalCRM
    totalCustomerCount, // v174a: Total count before filtering (for BUG-173-001)
    crmMirror, // board.crmMirror config
    crmConfig, // company.crmConfig
    globalStaff, // company.globalStaff
    tickets, // All tickets (for linked work count)
    onCustomerClick, // Open detail modal
    onCreateCustomer, // v188a: Create new customer
    onCustomerDrag, // Update customer field (stage/territory/owner)
    highlightedCustomerId,
    dropTarget,
    onCustomerDragOver,
  }) => {
    // Apply filter
    const filteredCustomers = useMemo(() => {
      return applyCrmFilter(customers || [], crmMirror?.filter);
    }, [customers, crmMirror?.filter]);

    // Group customers
    // v172b: BUG-171-003 FIX - Pass filter to groupCustomers for column filtering
    const groups = useMemo(() => {
      const grouped = groupCustomers(
        filteredCustomers,
        crmMirror?.groupBy || 'stage',
        crmConfig,
        globalStaff,
        crmMirror?.filter // v172b: Pass filter for stage column filtering
      );

      // Sort customers within each group
      return grouped.map((group) => ({
        ...group,
        customers: sortCustomers(group.customers, crmMirror?.sortBy || 'companyName', crmMirror?.sortOrder || 'asc'),
      }));
    }, [
      filteredCustomers,
      crmMirror?.groupBy,
      crmMirror?.sortBy,
      crmMirror?.sortOrder,
      crmMirror?.filter,
      crmConfig,
      globalStaff,
    ]);

    // Drag handlers
    const handleDragStart = (e, customer) => {
      e.dataTransfer.setData(
        'text/plain',
        JSON.stringify({
          type: 'customer',
          id: customer.id,
          currentStage: customer.stage,
          currentTerritory: customer.territory,
          currentOwner: customer.accountOwnerId,
        })
      );
      e.dataTransfer.effectAllowed = 'move';
    };

    const handleDrop = (e, targetKey) => {
      e.preventDefault();
      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (data.type === 'customer' && onCustomerDrag) {
          // Determine which field to update based on groupBy
          const groupBy = crmMirror?.groupBy || 'stage';
          onCustomerDrag(data.id, groupBy, targetKey);
        }
      } catch (err) {
        console.error('Drop error:', err);
      }
    };

    // v174a: Calculate total for header (use prop if provided, otherwise use customers array length)
    const total = totalCustomerCount ?? (customers || []).length;

    // Empty state
    if (!customers || customers.length === 0) {
      return (
        <div className="bg-gray-50 rounded-lg p-8 text-center">
          <Users size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">No Customers</h3>
          <p className="text-gray-500 text-sm mb-4">Add customers to see them here.</p>
          {onCreateCustomer && (
            <button
              onClick={onCreateCustomer}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
            >
              + New Customer
            </button>
          )}
        </div>
      );
    }

    if (filteredCustomers.length === 0) {
      return (
        <div className="bg-gray-50 rounded-lg p-8 text-center">
          <Users size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">No Matching Customers</h3>
          <p className="text-gray-500 text-sm">Adjust the CRM Mirror filter in Board Settings to see customers.</p>
          {/* v174a: Show total even when no matches */}
          <p className="text-gray-400 text-xs mt-2">0 of {total} customers match filter</p>
        </div>
      );
    }

    return (
      <div>
        {/* v174a: BUG-173-001 FIX - Show filtered count header */}
        {/* v188a: Added onCreateCustomer for "+ New Customer" button */}
        <CrmMirrorHeader
          filteredCount={filteredCustomers.length}
          totalCount={total}
          onCreateCustomer={onCreateCustomer}
        />

        <div className="flex gap-4 overflow-x-auto pb-4 items-stretch">
          {groups.map((group) => (
            <CrmKanbanColumn
              key={group.key}
              group={group}
              crmConfig={crmConfig}
              tickets={tickets}
              onCustomerClick={onCustomerClick}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
              onCustomerDragOver={onCustomerDragOver}
              highlightedCustomerId={highlightedCustomerId}
              dropTarget={dropTarget}
            />
          ))}
        </div>
      </div>
    );
  };

  // Export to window namespace
  window.Components = window.Components || {};
  window.Components.CrmMirror = CrmMirror;

  // Also export utilities for testing
  window.Components.CrmMirrorUtils = {
    applyCrmFilter,
    extractStageFilterValues, // v173a: New helper for column filtering
    groupCustomers,
    sortCustomers,
    getPrimaryContact,
    formatLastContact,
    countOpenTickets,
  };

  // Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['crm-mirror'] = COMPONENT_VERSION;

  console.log(`[crm-mirror.jsx] CrmMirror loaded (${COMPONENT_VERSION})`);
})();

/**
 * AllTicketsView Component - Full Screen View
 * Numa Ops Management
 *
 * Component Version: v179d
 *
 * Phase 6.5a: Core All Tickets functionality
 * Phase 6.5b: Resizable columns + persistence + return navigation
 * Phase 6.5c: Bulk Edit Panel with "Keep as is" dropdowns
 * Phase 6.5e: Column Management
 * Phase 6.5f: Filtering
 *
 * v179d Changes (L4 - Links column):
 *   - NEW: _links system column shows link status indicators
 *   - ⏳ = Has unresolved dependencies
 *   - 🚫 = Blocking other open tickets
 *   - 🔗 = Has links but no active deps/blocks
 *   - Add via Column Picker to enable
 *
 * v176f Changes (BUG-176-003 FIX RETRY - scroll preservation):
 *   - Fixed: v176e approach failed because scroll positions stored on DOM elements
 *     were lost when React recreated the elements during re-render
 *   - New: Separate customerFilterScrollPositions ref stores scroll values
 *   - New: Double requestAnimationFrame ensures restore happens AFTER ref callbacks
 *   - Scroll positions now survive DOM element recreation
 *
 * v176e Changes (BUG-176-003 FIX - BROKEN):
 *   - Attempted scroll preservation using _savedScrollTop on DOM elements
 *   - Failed because DOM elements are recreated during re-render
 *
 * v176d Changes (BUG-176-003 FIX + UX Enhancement):
 *   - BUG-176-003: Fixed scroll position reset when selecting items in Customer Filters dropdown
 *   - UX: Redesigned Customer Filters dropdown to 4-column layout
 *     Column 1: Customer (full height, scrollable)
 *     Column 2: Customer Stage
 *     Column 3: Territory
 *     Column 4: Account Owner, Industry, Company Size (stacked)
 *   - Each section has independent scroll to preserve position on selection
 *   - Columns separated by pale dividers for visual clarity
 *
 * v176c Changes (BUG-176-002 FIX):
 *   - Customer Filters dropdown now stays open when selecting multiple values
 *   - Root cause: dropdown used local useState which reset when parent re-rendered on filter change
 *   - Fix: lifted isOpen state to parent level (showCustomerFilters, customerFiltersRef)
 *
 * v176b Changes (BUG-176-001 FIX):
 *   - Added 'customer' to multiselect types array in getFilterTypeForField()
 *   - Root cause: field library 'client' field has type 'customer' (no hyphen)
 *   - getColumnDefinition found field library before CUSTOMER_FILTER_FIELDS
 *   - getFilterTypeForField checked startsWith('customer-') which failed for 'customer'
 *   - Filter fell through to 'text' type, causing array filter to not match
 *
 * v176a Changes (CRM Phase 6 - Mixed Filtering):
 *   - NEW: Customer field filtering (client.* fields)
 *   - Added CUSTOMER_FILTER_FIELDS constant for virtual customer columns
 *   - Added NO_CUSTOMER constant for "(No Customer)" filter option
 *   - Added isCustomerField() helper to detect client.* field paths
 *   - Added getCustomerFieldValue() to resolve ticket → customer → field
 *   - Modified getFilterValue() to handle client.* fields via lookup
 *   - Modified getFilterOptionsForColumn() to return customer field options
 *   - Modified getFilterDisplayValue() to show customer field labels
 *   - Modified getFilterTypeForField() to handle customer field types
 *   - Added "Customer Fields" section to column filter header
 *   - Tickets without client assigned: excluded from client.* filters (except NO_CUSTOMER)
 *   - Filter options derived from globalCRM data and crmConfig
 *
 * v167a Changes:
 *   - BUG-166-002 FIX: Deleted tickets now correctly filtered
 *   - UX CHANGE: "Include Deleted" → "Show Only Deleted Tickets"
 *   - New behavior: When checked, shows ONLY deleted (exclusive filter)
 *   - When unchecked, hides deleted (default, same as before)
 *   - Renamed state: includeDeleted → showOnlyDeleted
 *
 * v160a Changes:
 *   - BUG 163-001 FIX: Right-click context menu now works on table rows
 *   - Added onContextMenu prop - receives handler from app.jsx
 *   - Table rows trigger context menu with context: 'table'
 *   - Enables Assign, Move to Zone, Change Status, Copy Link, Delete actions
 *
 * v159a Changes:
 *   - DELETED TICKETS: Exclude deleted status by default
 *   - "Include Deleted" checkbox in Global All Tickets (admin only)
 *   - Checkbox only visible when scope is 'all' (global admin view)
 *   - Uses isDeletedStatus() from domain/statuses.js
 *
 * v157a Changes:
 *   - BUG-158-001 FIX: Row clicks blocked after filter dropdown closed
 *     (dropdownJustClosedRef was stuck true due to click listener removal race)
 *     Fixed by clearing ref in useEffect cleanup instead of click handler
 *   - PROGRESSIVE PRESENTATION: Zone/WorkUnit columns scope-aware
 *
 * Previous (pre-v157a):
 *      - Added hasWorkUnitBoardsInScope computed property
 *      - Added isTicketOnSimpleBoard helper
 *      - Zone column shows "—" for tickets on simple boards
 *      - Zone/WorkUnit columns marked unavailable when only simple boards in scope
 *      - Column Picker shows "(not in scope)" hint for unavailable columns
 * v099 - Converted from modal to full-screen view
 * v100 - Added resizable columns, board-level persistence, return navigation
 * v101 - Fixed horizontal scroll, added last-opened row highlighting
 * v102 - BUG-101-001: Scrollbars now at viewport edges (h-screen flex layout)
 *      - BUG-101-002: Sticky table headers (column names visible while scrolling)
 * v103 - PHASE-6.5c: Bulk Edit Panel
 * v104 - BUG-103-001 FIX: Selection persists across modal opens
 * v109 - BUG-108-001 FIX: Bulk delete with type-to-confirm
 * v110 - UX-110-001: Close button in footer
 * v111 - UX-111-001: Board column tooltip
 * v112 - BUG-111-001: Default scope fix
 * v118 - PHASE-6.5e: Column Management
 * v119 - BUG FIXES: Checkbox toggle, search X button, search focus
 * v120 - Added _workCentre system column
 * v121 - Added _createdBy system column (placeholder)
 * v122 - UX Enhancements:
 *      - Fixed modal dimensions (no resize on content change)
 *      - Drag-and-drop column reorder in Column Picker modal
 *      - Drag-and-drop column reorder in table headers
 *      - Smart default columns based on board's ticket types
 *      - _board only shown when scope > 'board'
 *      - _workUnit only shown when workUnitSeries enabled
 *      - Reset to Defaults uses smart defaults
 * v123 - Column Management Polish:
 *      - Hide duplicate field library fields (workUnit, title/name/summary)
 *      - Larger modal (h-[80vh]) to match other modals
 *      - Improved drag handle in modal (dedicated grip zone)
 *      - Drag indicator on table headers (grip icon on hover)
 *      - Scope-based locked columns (_board, _workCentre)
 *      - Reordered defaults: location after status, _updated at end
 * v124 - Bug Fixes:
 *      - BUG-123-001: Hide invalid scope options when context unavailable
 *      - BUG-123-002: Added workUnitId to FIELD_DUPLICATES + filter persisted columns
 *      - BUG-123-003: Larger modal (max-w-5xl) to better match settings modals
 *      - BUG-123-004: Cross-browser drag fix (Firefox compatibility)
 *      - BUG-123-005: Scope locking now dynamic (updates when scope changes)
 * v125 - Bug Fixes:
 *      - BUG-124-002: Auto-add mandatory columns when scope changes
 *      - BUG-124-003: Modal now max-w-6xl h-[85vh] (matches Global Settings)
 *      - BUG-124-004: Improved drag ghost in modal (row draggable, not just grip)
 * v126 - Bug Fixes:
 *      - BUG-125-001: Auto-remove location columns when scope narrows
 *      - BUG-125-002: Reset to Defaults keeps modal open
 * v127 - PHASE-6.5f-1 + 6.5f-2: Filter Infrastructure + Column Dropdowns
 *      - activeFilters state with persistence
 *      - getFilterValue() for raw filter matching
 *      - getFilterTypeForField() derives filter type from field definition
 *      - matchesFilterValue() handles all filter types
 *      - filteredByActiveFilters pipeline stage
 *      - Filter handlers: handleFilterChange, handleClearAllFilters, handleRemoveFilter
 *      - hasActiveFilter() helper for UI indicators
 *      - EMPTY_VALUE constant for null/empty filtering
 *      - Column header click → filter dropdown
 *      - ColumnFilterDropdown component with sort + filter UI
 *      - Multi-select checkboxes for applicable fields
 *      - Text contains filter for text fields
 *      - Date preset filter for date fields
 *      - Number range filter for number fields
 *      - Asterisk (*) indicator on filtered columns
 * v128 - UX Polish + Bug Fixes:
 *      - BUG-127-001 FIX: Clear filter now closes dropdown (resets local state)
 *      - UX: Dropdown background tinted indigo-50 to stand out
 *      - UX: Dropdown fonts consistent (text-xs matches header)
 *      - UX: Separated drag zone (grip icon on right of header)
 *      - UX: Larger asterisk indicator (font-bold)
 *      - UX: "* = filtered" legend on far right of toolbar
 * v129 - Bug Fixes:
 *      - BUG-128-001 FIX: Asterisk now text-sm (same height as header text)
 *      - BUG-128-002 FIX: Drag grip visible (bg-gray-100, size-16, text-gray-600)
 *      - BUG-128-003 FIX: Legend more prominent (text-sm, bg-indigo-50 pill)
 *      - BUG-128-004 FIX: Clear filter uses onMouseDown (avoids onBlur race)
 * v130 - Bug Fixes:
 *      - BUG-129-001 FIX: Asterisk now text-base (matches uppercase header height)
 *      - BUG-129-002 FIX: Inline SVG grip icon (GripVertical wasn't rendering)
 *      - BUG-129-003 FIX: setDragImage shows full column header as ghost
 *      - UX-129-001: Dropdown max-h increased to 60vh (less scrolling)
 * v131 - UX Polish:
 *      - Grip icon only visible on column hover (group/group-hover pattern)
 * v132 - Bug Fix:
 *      - BUG-131-001 FIX: Board/Work Centre columns now draggable
 *        (Scope-locking only prevents removal, not reordering)
 * v133 - PHASE-6.5f-3: Active Filters Bar
 *      - ActiveFiltersBar component shows active filters as chips
 *      - Chips display column name + readable value (IDs converted to labels)
 *      - Click × on chip to remove individual filter
 *      - "Clear all" button when multiple filters active
 *      - getFilterDisplayValue() helper converts filter values to display strings
 *      - Handles multiselect, date presets, number ranges, and text filters
 * v134 - PHASE-6.5f-4: Saved Filter Sets + Text Filter Operators
 *      - TEXT_FILTER_OPERATORS: contains, not-contains, equals, not-equals
 *      - Text filter data model: { op: 'contains', value: 'text' }
 *      - Backward compatible: bare strings treated as { op: 'contains', value: string }
 *      - Operator dropdown in text filter UI
 *      - SaveFilterModal: Save current filters with name
 *      - ManageFiltersModal: Rename/delete saved filter sets
 *      - LoadFiltersDropdown: Quick-apply saved filter sets
 *      - Save button (visible when filters active)
 *      - Load dropdown (visible when saved filters exist)
 *      - Storage: board.savedFilterSets / company.globalSavedFilterSets
 * v135 - Bug Fixes + UX Polish:
 *      - BUG-134-001 FIX: Prevent duplicate filter names (validation in save modal)
 *      - BUG-134-002 FIX: Can update existing filter (dropdown to select existing)
 *      - UX-134-001: Button labels "Save Filter" / "Load Filter"
 *      - UX-134-002: Title shows scope context (All Tickets – WC / Board)
 * v136 - Saved Filter Enhancements:
 *      - BUG-135-001 FIX: Save modal input focus loss (inline JSX instead of component)
 *      - BUG-135-002 FIX: Scope stored with filter, loading switches to saved scope
 *      - UX-135-001: "Assigned to Me" option at top of Assignee filter dropdown
 *      - UX-135-002: Save modal redesigned with radio buttons (Create new / Update existing)
 *      - Added currentUser prop for "Assigned to Me" filter
 *      - Added ASSIGNED_TO_ME constant for special filter value
 * v137 - Saved Filter Scope Fix:
 *      - BUG-136-001 FIX: Props changed from savedFilterSets to boardSavedFilterSets + globalSavedFilterSets
 *      - currentSavedFilterSets computed via useMemo based on scope selection
 * v138 - Test Tools Fix:
 *      - BUG-136-002 FIX: Test Tools "Current User" dropdown uses staff.id (admin-components.jsx)
 * v139 - Entry Point Based Storage:
 *      - BUG-138-002 FIX: Saved filter storage based on entry point (activeBoardId), not scope
 *        - If entered from board: show/save to boardSavedFilterSets
 *        - If entered from admin: show/save to globalSavedFilterSets
 *      - UX-138-001: Load Filter dropdown styling improvements (wider, divider, colored manage)
 * v140 - Text Filter Dropdown Fix:
 *      - Sort buttons use onMouseDown + preventDefault (fires before input blur)
 * v141 - Operator Dropdown Fix:
 *      - BUG-138-001 FINAL: Removed onBlur from text input entirely
 *        - Filter now applies on Enter only (more intuitive UX)
 *        - Operator dropdown now opens properly
 *        - Placeholder updated to "Search... (press Enter)"
 * v142 - PHASE-6.5f-5: Custom Date Range Picker
 *      - Added "This Quarter" preset to date filter
 *      - Custom date options: Before, After, Between (with Apply button)
 *      - Before: exclusive (< date), After: inclusive (≥ date)
 *      - Between: inclusive both ends (from ≤ x ≤ to)
 *      - Radio button UI - switching modes clears previous values
 *      - Updated matchesFilterValue() for { before } and { after } formats
 *      - Updated getFilterDisplayValue() with < and ≥ notation
 * v143 - Added _completed System Column
 *      - New system column to show ticket completion date (completedAt)
 *      - Available in Column Picker alongside Created and Updated
 *      - Supports date filtering (presets, before/after/between)
 *      - Sortable by completion date
 * v144 - Added _started and _ended System Columns
 *      - _started: Shows when work began (first queued/active status)
 *      - _ended: Shows when ticket was cancelled/ended
 *      - Both support date filtering and sorting
 *      - Part of 6-type status model lifecycle dates
 * v145 - 6-Type Status Model Support
 *      - Updated getStatusInfo fallback to use new types (backlog, scoped, queued, active, completed, ended)
 *      - Updated getStatusColor with colors for all 6 types
 * v148 - BUG-147-001 FIX: Filter dropdown clicks no longer trigger underlying row selection
 *      - Uses ref to track "dropdown just closed" across mousedown/click event boundary
 *      - handleRowClick checks ref and returns early if dropdown was just dismissed
 * v149 - SAVED VIEWS (replaces Saved Filters)
 *      - Renamed savedFilterSets → savedViews throughout
 *      - Views now save complete configuration: filters, scope, columns, columnWidths, sort
 *      - Save modal shows summary: scope, column count, filter count with "Save View" button
 *      - Load restores full view configuration (columns, widths, sort, filters, scope)
 *      - Missing columns warning if saved view references deleted fields
 *      - Backward compatible: old filter-only saves still work (columns default to current)
 *      - All UI labels updated: "Filter" → "View"
 *      - BUG FIX: Column width now enforced with maxWidth - long content truncates properly
 *      - BUG FIX: Hover tooltip shows full text for truncated content
 * v152 - ACTIVE VIEW TRACKING + COLUMN PICKER IMPROVEMENTS
 *      - Track currently loaded view (activeViewId, activeViewName, activeViewConfig)
 *      - Toolbar shows active view indicator with "(modified)" badge when changed
 *      - Save modal redesigned with three options when view is active:
 *        1. Update "[Active View Name]" (default)
 *        2. Update a different view (dropdown of other views)
 *        3. Create new view
 *      - When no view active: Update existing | Create new (default)
 *      - After save/create, that view becomes active
 *      - Clear button to unload active view
 *      - Modification detection compares current config vs loaded snapshot
 *      - BUG-152-001 FIX: Load view captures effective config (including inherited widths)
 *        Previously showed "(modified)" immediately after load due to width comparison mismatch
 *      - UX-152-001: Work Unit column label is now context-sensitive
 *        At board scope: uses board's workUnitSeries.label (e.g., "Phase", "Sprint")
 *        At WC scope: uses WC's label if all boards use same label, else "Work Unit"
 *        At all scope: generic "Work Unit"
 *      - UX-152-002: Available Fields filtered to only show fields configured in current scope
 *        Collects allowed ticket types from boards in scope, shows only their fields
 *        Empty categories are hidden automatically
 *      - UX-152-003: Available Fields highlights unchecked columns that have data
 *        Pale amber background for fields with data in current filtered view
 *        Helps users discover useful columns to enable
 * v153 - BUG FIXES + AUTO-SWITCH VIEW
 *      - BUG-152-002 FIX: Column Picker now shows context-sensitive Work Unit label
 *        Was pulling directly from SYSTEM_COLUMNS, now uses getWorkUnitLabel()
 *      - BUG-152-002b FIX: Bulk Edit panel Work Unit label now context-sensitive
 *      - BUG-152-003 FIX: Cursor no longer jumps when editing view name in Manage Views
 *        Changed from controlled input to defaultValue with ref and onBlur
 *      - OPTION-B: Auto-switch active view when scope changes
 *        When scope changes, checks if current config matches a saved view at new scope
 *        If match found, auto-switches to that view (minus location columns)
 * v153a - VIEW IDENTITY VS PRESENTATION + BUG FIXES
 *      - BUG-153-001 FIX: Column Picker hierarchy order corrected
 *        Work Centre now appears before Board (parent before child)
 *      - BUG-153-002 FIX: Selection clears on scope change
 *        Previously retained selection count from wider scope when narrowing
 *      - BUG-153-003 FIX: Auto-switch view no longer shows "(modified)" incorrectly
 *        View IDENTITY (for matching): filters, sort, column SET (ignores order)
 *        View PRESENTATION (preserved): column widths, column order
 *        Auto-match on scope change preserves current presentation
 *        Explicit Load View resets to saved presentation
 *        Save View captures current presentation state
 * v153b - PHASE-6.5f-6: GROUPED FILTER DROPDOWNS
 *      - Board filter dropdown now groups boards by Work Centre
 *      - Work Unit filter dropdown groups by Work Centre → Board hierarchy
 *      - Collapsible group headers with expand/collapse toggle
 *      - Group-level checkboxes to select/deselect all children
 *      - Indeterminate state when some children selected
 *      - Scope-aware: hierarchy simplifies when scope is narrowed
 *      - getGroupedFilterOptions() builds hierarchical option structures
 *      - GroupedCheckboxSection sub-component for rendering
 * v154 - SCOPED AT LIFECYCLE DATE COLUMN
 *      - Added _scopedAt system column for ticket scoping date
 *      - Shows when ticket was first committed to a work unit
 *      - Supports date filtering and sorting
 *      - Part of lifecycle date set: scopedAt → startedAt → completedAt/endedAt
 * v154b - AND/OR MULTI-CONDITION TEXT FILTERS
 *      - Text filters now support multiple conditions with AND/OR logic
 *      - New operators: starts-with, ends-with, is-empty, is-not-empty
 *      - Filter data model: { mode: 'and'|'or', conditions: [{op, value}, ...] }
 *      - UI: Add/remove conditions, AND/OR toggle, Apply button
 *      - Chip display: "3 conditions (AND)" for multi-condition filters
 *      - Backward compatible with legacy formats
 * v154c - UX: Filter dropdown offset left-2 to avoid obscuring column header
 * v154d - UX: Filter dropdown now left-full (right edge of column) + column header highlight
 *       - Active column gets bg-indigo-100 + ring-2 ring-indigo-400 when dropdown open
 *       - Dropdown positioned at right edge of column to keep data visible
 *
 * Features:
 * - Full-screen view (not modal)
 * - Scope selector (This Board / This Work Centre / All)
 * - Sortable columns with click-to-sort
 * - Resizable columns with drag handles
 * - Drag-and-drop column reordering
 * - Column width persistence per board
 * - Configurable columns (add/remove/reorder)
 * - Smart default columns based on ticket types
 * - Search filter
 * - Column filters (v127+)
 * - Checkbox selection with bulk actions
 * - Shift+click range selection
 * - Bulk edit panel with cascade location pickers
 * - Row click to edit ticket
 * - Horizontal scrolling for wide tables
 * - Highlight last-opened ticket row
 */

(function () {
  'use strict';

  // v160a: Component version for registry
  const COMPONENT_VERSION = 'v179d';

  const { useState, useMemo, useRef, useCallback, useEffect } = React;

  // Get icons from window
  const {
    Search,
    ChevronUp,
    ChevronDown,
    Trash2,
    ArrowLeft,
    Edit2,
    Copy,
    X,
    Settings,
    GripVertical,
    RotateCcw,
    Save,
    FolderOpen,
    AlertCircle,
  } = window.Icons || {};
  const { ConfirmationModal } = window.Components?.ConfirmModals || {};

  // v118: System columns definition - how to get and render system fields
  const SYSTEM_COLUMNS = {
    _type: {
      id: '_type',
      label: 'Type',
      type: 'system-type',
      defaultWidth: 100,
      minWidth: 80,
      locked: false,
    },
    _key: {
      id: '_key',
      label: 'Key',
      type: 'system-key',
      defaultWidth: 120,
      minWidth: 80,
      locked: true, // Cannot be removed - primary identifier
    },
    _summary: {
      id: '_summary',
      label: 'Summary',
      type: 'system-text',
      defaultWidth: 300,
      minWidth: 150,
      locked: false,
    },
    _status: {
      id: '_status',
      label: 'Status',
      type: 'system-status',
      defaultWidth: 120,
      minWidth: 80,
      locked: false,
    },
    _workCentre: {
      id: '_workCentre',
      label: 'Work Centre',
      type: 'system-workcentre',
      defaultWidth: 140,
      minWidth: 100,
      locked: false,
    },
    _board: {
      id: '_board',
      label: 'Board',
      type: 'system-board',
      defaultWidth: 140,
      minWidth: 100,
      locked: false,
    },
    _zone: {
      id: '_zone',
      label: 'Zone',
      type: 'system-zone',
      defaultWidth: 140,
      minWidth: 100,
      locked: false,
    },
    _stage: {
      id: '_stage',
      label: 'Stage',
      type: 'system-stage',
      defaultWidth: 120,
      minWidth: 80,
      locked: false,
    },
    _workUnit: {
      id: '_workUnit',
      label: 'Work Unit',
      type: 'system-workunit',
      defaultWidth: 120,
      minWidth: 80,
      locked: false,
    },
    _created: {
      id: '_created',
      label: 'Created',
      type: 'system-date',
      defaultWidth: 110,
      minWidth: 80,
      locked: false,
    },
    _updated: {
      id: '_updated',
      label: 'Updated',
      type: 'system-date',
      defaultWidth: 110,
      minWidth: 80,
      locked: false,
    },
    _completed: {
      id: '_completed',
      label: 'Completed',
      type: 'system-date',
      defaultWidth: 110,
      minWidth: 80,
      locked: false,
    },
    _scopedAt: {
      id: '_scopedAt',
      label: 'Scoped',
      type: 'system-date',
      defaultWidth: 110,
      minWidth: 80,
      locked: false,
    },
    _started: {
      id: '_started',
      label: 'Started',
      type: 'system-date',
      defaultWidth: 110,
      minWidth: 80,
      locked: false,
    },
    _ended: {
      id: '_ended',
      label: 'Ended',
      type: 'system-date',
      defaultWidth: 110,
      minWidth: 80,
      locked: false,
    },
    _createdBy: {
      id: '_createdBy',
      label: 'Created By',
      type: 'system-user',
      defaultWidth: 130,
      minWidth: 80,
      locked: false,
    },
    _links: {
      id: '_links',
      label: 'Links',
      type: 'system-links',
      defaultWidth: 80,
      minWidth: 60,
      locked: false,
    },
  };

  // v123: Essential system columns (always included in smart defaults)
  // Note: _updated is added at the END separately
  const ESSENTIAL_COLUMNS = ['_type', '_key', '_summary', '_status'];

  // v124: Field library fields that duplicate system columns - hide from picker
  // Added workUnitId (the actual field library ID)
  const FIELD_DUPLICATES = ['workUnit', 'workUnitId', 'title', 'name', 'summary', 'description'];

  // Priority options (matching field-library.js)
  const PRIORITY_OPTIONS = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

  // Special value for "Keep as is"
  const KEEP_AS_IS = '__KEEP_AS_IS__';

  // v127: Special value for filtering empty/null values
  const EMPTY_VALUE = '__EMPTY__';

  // v136: Special value for "Assigned to Me" filter
  const ASSIGNED_TO_ME = '__ASSIGNED_TO_ME__';

  // v176a: Special value for "No Customer" filter (tickets without client assigned)
  const NO_CUSTOMER = '__NO_CUSTOMER__';

  // v176a: Customer field definitions for mixed filtering (CRM Phase 6)
  // These are "virtual" columns - not stored on tickets, resolved via customer lookup
  const CUSTOMER_FILTER_FIELDS = {
    client: {
      id: 'client',
      label: 'Customer',
      type: 'customer-select',
      filterType: 'multiselect',
    },
    'client.stage': {
      id: 'client.stage',
      label: 'Customer Stage',
      type: 'customer-stage',
      filterType: 'multiselect',
    },
    'client.territory': {
      id: 'client.territory',
      label: 'Customer Territory',
      type: 'customer-territory',
      filterType: 'multiselect',
    },
    'client.accountOwnerId': {
      id: 'client.accountOwnerId',
      label: 'Account Owner',
      type: 'customer-owner',
      filterType: 'multiselect',
    },
    'client.industry': {
      id: 'client.industry',
      label: 'Customer Industry',
      type: 'customer-industry',
      filterType: 'multiselect',
    },
    'client.companySize': {
      id: 'client.companySize',
      label: 'Customer Size',
      type: 'customer-size',
      filterType: 'multiselect',
    },
  };

  // v134: Text filter operators
  // v154b: Added starts-with, ends-with, is-empty, is-not-empty
  const TEXT_FILTER_OPERATORS = [
    { value: 'contains', label: 'Contains', needsValue: true },
    { value: 'not-contains', label: 'Does not contain', needsValue: true },
    { value: 'equals', label: 'Equals', needsValue: true },
    { value: 'not-equals', label: 'Does not equal', needsValue: true },
    { value: 'starts-with', label: 'Starts with', needsValue: true },
    { value: 'ends-with', label: 'Ends with', needsValue: true },
    { value: 'is-empty', label: 'Is empty', needsValue: false },
    { value: 'is-not-empty', label: 'Is not empty', needsValue: false },
  ];

  const AllTicketsView = ({
    tickets,
    company,
    opCentres,
    activeOpCentreId,
    activeBoardId,
    currentUser, // v136: Current user for "Assigned to Me" filter
    viewConfig, // Board's saved view configuration
    onViewConfigChange, // Callback to save config changes
    boardSavedViews, // v149: Board-level saved views (renamed from savedFilterSets)
    globalSavedViews, // v149: Global saved views (for WC/All scope)
    onSavedViewsChange, // v149: Callback to update saved views
    lastOpenedTicketId, // v101: Ticket ID to highlight after return from edit
    selectedTickets, // v104: Selection state from parent
    onSelectedTicketsChange, // v104: Callback to update selection
    onContextMenu, // v160: Right-click context menu handler
    onClose,
    onEditTicket,
    onDeleteTicket,
    onBulkUpdateTickets, // v103: Callback for bulk updates
    onBulkDeleteTickets, // v109: Callback for bulk delete (no individual confirmations)
  }) => {
    // State
    // v112: Default to 'all' scope when no board context (e.g., opened from Global Settings)
    // v124: Also default to 'workcentre' if we have WC but no board
    const [scope, setScope] = useState(() => {
      if (activeBoardId) return 'board';
      if (activeOpCentreId) return 'workcentre';
      return 'all';
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [sortColumn, setSortColumn] = useState(viewConfig?.sortColumn || '_updated');
    const [sortDirection, setSortDirection] = useState(viewConfig?.sortDirection || 'desc');
    const [lastClickedIndex, setLastClickedIndex] = useState(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');

    // v103: Bulk edit panel state
    const [showBulkEditPanel, setShowBulkEditPanel] = useState(false);
    const [bulkEditValues, setBulkEditValues] = useState({
      status: KEEP_AS_IS,
      boardId: KEEP_AS_IS,
      zoneId: KEEP_AS_IS,
      column: KEEP_AS_IS,
      workUnitId: KEEP_AS_IS,
      assignee: KEEP_AS_IS,
      priority: KEEP_AS_IS,
    });

    // v118: Column configuration state
    const [showColumnPicker, setShowColumnPicker] = useState(false);
    const [columnSearchTerm, setColumnSearchTerm] = useState('');
    const columnSearchRef = useRef(null);

    // v122: Drag state for column reordering
    const [draggedColumn, setDraggedColumn] = useState(null);
    const [dragOverColumn, setDragOverColumn] = useState(null);
    const [dragSource, setDragSource] = useState(null); // 'modal' or 'table'

    // v127: Active filters state (Phase 6.5f)
    const [activeFilters, setActiveFilters] = useState(() => {
      return viewConfig?.activeFilters || {};
    });

    // v159a: Include deleted tickets toggle (admin only)
    const [showOnlyDeleted, setShowOnlyDeleted] = useState(false);

    // v127: Filter dropdown state
    const [filterDropdownColumn, setFilterDropdownColumn] = useState(null);
    const filterDropdownRef = useRef(null);
    const dropdownJustClosedRef = useRef(false); // v148: BUG-147-001 - Track if dropdown was just dismissed

    // v176c: Customer filters dropdown state (lifted from component to prevent reset on filter change)
    const [showCustomerFilters, setShowCustomerFilters] = useState(false);
    const customerFiltersRef = useRef(null);
    // v176f: Refs for customer filter scroll elements and separate storage for scroll positions
    const customerFilterScrollRefs = useRef({});
    const customerFilterScrollPositions = useRef({});

    // v149: Saved views state (renamed from saved filter sets)
    const [showSaveViewModal, setShowSaveViewModal] = useState(false);
    const [showManageViewsModal, setShowManageViewsModal] = useState(false);
    const [showLoadDropdown, setShowLoadDropdown] = useState(false);
    const [saveViewName, setSaveViewName] = useState('');
    const [editingViewId, setEditingViewId] = useState(null);
    const [editingViewName, setEditingViewName] = useState('');
    const loadDropdownRef = useRef(null);
    // v149: State for updating existing view and validation
    const [updateExistingViewId, setUpdateExistingViewId] = useState('');
    const [saveViewError, setSaveViewError] = useState('');
    // v152: Radio button mode for save modal: 'updateActive', 'updateOther', or 'create'
    const [saveMode, setSaveMode] = useState('create');
    // v149: Missing columns warning modal
    const [showMissingColumnsModal, setShowMissingColumnsModal] = useState(false);
    const [missingColumnNames, setMissingColumnNames] = useState([]);

    // v152: Active view tracking
    const [activeViewId, setActiveViewId] = useState(null);
    const [activeViewName, setActiveViewName] = useState('');
    const [activeViewConfig, setActiveViewConfig] = useState(null); // Snapshot for modification detection

    // Get current context
    const currentOpCentre = opCentres?.find((oc) => oc.id === activeOpCentreId);
    const currentBoard = currentOpCentre?.processBoards?.find((b) => b.id === activeBoardId);

    // v123: Compute smart default columns based on board's ticket types
    // Order: Essential → Location (scope-based) → Work Unit (if enabled) → Type Fields → _updated
    const getSmartDefaultColumns = useCallback(
      (forScope = scope) => {
        const columns = [...ESSENTIAL_COLUMNS];
        const addedFields = new Set(ESSENTIAL_COLUMNS);

        // v123: Add location columns after _status (scope-based)
        if (forScope === 'all') {
          columns.push('_workCentre');
          addedFields.add('_workCentre');
          columns.push('_board');
          addedFields.add('_board');
        } else if (forScope === 'workcentre') {
          columns.push('_board');
          addedFields.add('_board');
        }

        // Add _workUnit only if work unit series is enabled on current board
        if (currentBoard?.workUnitSeries?.enabled) {
          columns.push('_workUnit');
          addedFields.add('_workUnit');
        }

        // Get fields from allowed ticket types on this board
        if (currentBoard?.allowedTicketTypes && company?.globalTicketTypes) {
          const allowedTypeIds = currentBoard.allowedTicketTypes;
          const ticketTypes = company.globalTicketTypes.filter((tt) => allowedTypeIds.includes(tt.id));

          // Collect all fields from all allowed types
          const typeFields = new Set();
          ticketTypes.forEach((tt) => {
            (tt.fields || []).forEach((fieldId) => {
              // Skip system-handled fields and duplicates
              if (
                !fieldId.startsWith('_') &&
                !FIELD_DUPLICATES.includes(fieldId) &&
                fieldId !== 'name' &&
                fieldId !== 'description'
              ) {
                typeFields.add(fieldId);
              }
            });
          });

          // Add common fields in a sensible order
          const orderedCommonFields = [
            'assignee',
            'priority',
            'dueDate',
            'labels',
            'severity',
            'effortPoints',
            'storyPoints',
          ];
          orderedCommonFields.forEach((fieldId) => {
            if (typeFields.has(fieldId) && !addedFields.has(fieldId)) {
              columns.push(fieldId);
              addedFields.add(fieldId);
            }
          });

          // Add remaining fields
          typeFields.forEach((fieldId) => {
            if (!addedFields.has(fieldId)) {
              columns.push(fieldId);
              addedFields.add(fieldId);
            }
          });
        } else {
          // Fallback: add common fields
          if (!addedFields.has('assignee')) columns.push('assignee');
          if (!addedFields.has('priority')) columns.push('priority');
        }

        // v123: _updated always at the end
        columns.push('_updated');

        return columns;
      },
      [scope, currentBoard, company?.globalTicketTypes]
    );

    // v119: Local state for columns - initialized from viewConfig or smart defaults
    // v124: Filter out duplicate field IDs that may have been persisted
    const [localColumns, setLocalColumns] = useState(() => {
      if (viewConfig?.columns && Array.isArray(viewConfig.columns)) {
        return viewConfig.columns.filter((colId) => !FIELD_DUPLICATES.includes(colId) || colId.startsWith('_'));
      }
      return getSmartDefaultColumns();
    });

    // Use localColumns as the source of truth
    const visibleColumns = localColumns;

    // Column widths state
    const [columnWidths, setColumnWidths] = useState(() => {
      const saved = viewConfig?.columnWidths || {};
      const widths = {};

      visibleColumns.forEach((colId) => {
        if (saved[colId]) {
          widths[colId] = saved[colId];
        } else {
          const sysCol = SYSTEM_COLUMNS[colId];
          widths[colId] = sysCol?.defaultWidth || 120;
        }
      });

      return widths;
    });

    // Resizing state
    const [resizingColumn, setResizingColumn] = useState(null);
    const [resizeStartX, setResizeStartX] = useState(0);
    const [resizeStartWidth, setResizeStartWidth] = useState(0);
    const tableRef = useRef(null);

    // Helper functions
    const getTicketType = (typeId) => {
      return company?.globalTicketTypes?.find((t) => t.id === typeId);
    };

    const getBoardName = (boardId) => {
      for (const oc of opCentres || []) {
        const board = oc.processBoards?.find((b) => b.id === boardId);
        if (board) return board.name;
      }
      return '-';
    };

    const getWorkCentreNameForBoard = (boardId) => {
      for (const oc of opCentres || []) {
        const board = oc.processBoards?.find((b) => b.id === boardId);
        if (board) return oc.name;
      }
      return null;
    };

    const getWorkCentreName = (wcId) => {
      const wc = opCentres?.find((oc) => oc.id === wcId);
      return wc?.name || '-';
    };

    const getWorkUnitName = (workUnitId) => {
      const wu = company?.workUnits?.find((w) => w.id === workUnitId);
      return wu?.name || '-';
    };

    const getAssigneeName = (assigneeId) => {
      const staff = company?.globalStaff?.find((s) => s.id === assigneeId);
      return staff?.name || '-';
    };

    // v176a: Check if a field ID is a customer field (client.* path)
    const isCustomerField = (fieldId) => {
      return fieldId === 'client' || fieldId?.startsWith('client.');
    };

    // v176a: Get customer record for a ticket
    const getCustomerForTicket = (ticket) => {
      if (!ticket?.client) return null;
      return company?.globalCRM?.find((c) => c.id === ticket.client) || null;
    };

    // v176a: Get customer field value from a ticket (resolves through customer lookup)
    const getCustomerFieldValue = (ticket, fieldId) => {
      // For 'client' field itself, return the customer ID
      if (fieldId === 'client') {
        return ticket?.client || null;
      }

      // For 'client.*' fields, look up the customer and get the nested field
      if (fieldId?.startsWith('client.')) {
        const customer = getCustomerForTicket(ticket);
        if (!customer) return null;

        const customerField = fieldId.replace('client.', '');
        return customer[customerField] ?? null;
      }

      return null;
    };

    // v176a: Get customer name by ID
    const getCustomerName = (customerId) => {
      const customer = company?.globalCRM?.find((c) => c.id === customerId);
      return customer?.companyName || '-';
    };

    // v176a: Get lifecycle stage label from crmConfig
    const getLifecycleStageName = (stageId) => {
      const stage = company?.crmConfig?.lifecycleStages?.find((s) => s.id === stageId);
      return stage?.name || stageId || '-';
    };

    const getZoneName = (zoneId) => {
      for (const oc of opCentres || []) {
        for (const board of oc.processBoards || []) {
          const zone = board.workZones?.find((z) => z.id === zoneId);
          if (zone) return zone.name;
        }
      }
      return '-';
    };

    const getStatusInfo = (statusId) => {
      const status = company?.statuses?.find((s) => s.id === statusId);
      if (status) return status;
      // v145: Updated to 6-type model fallback
      const standardStatuses = {
        new: { id: 'new', label: 'New', type: 'backlog' },
        backlog: { id: 'backlog', label: 'Backlog', type: 'backlog' },
        ready: { id: 'ready', label: 'Ready', type: 'scoped' },
        todo: { id: 'todo', label: 'To Do', type: 'queued' },
        'in-progress': { id: 'in-progress', label: 'In Progress', type: 'active' },
        blocked: { id: 'blocked', label: 'Blocked', type: 'active' },
        review: { id: 'review', label: 'Review', type: 'active' },
        completed: { id: 'completed', label: 'Completed', type: 'completed' },
        cancelled: { id: 'cancelled', label: 'Cancelled', type: 'ended' },
      };
      return standardStatuses[statusId] || { id: statusId, label: statusId, type: 'backlog' };
    };

    // v145: Updated color mapping for 6-type model
    const getStatusColor = (type) => {
      switch (type) {
        case 'backlog':
          return 'bg-gray-100 text-gray-700';
        case 'scoped':
          return 'bg-purple-100 text-purple-700';
        case 'queued':
          return 'bg-amber-100 text-amber-700';
        case 'active':
          return 'bg-blue-100 text-blue-700';
        case 'completed':
          return 'bg-green-100 text-green-700';
        case 'ended':
          return 'bg-red-100 text-red-700';
        default:
          return 'bg-gray-100 text-gray-700';
      }
    };

    const formatDate = (dateStr) => {
      if (!dateStr) return '-';
      const date = new Date(dateStr);
      const now = new Date();
      const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString('en-NZ', { month: 'short', day: 'numeric' });
    };

    // Get column definition (system, field library, or custom)
    // v152 UX-152-001: Get dynamic Work Unit label based on scope
    const getWorkUnitLabel = () => {
      if (scope === 'board' && currentBoard?.workUnitSeries?.label) {
        return currentBoard.workUnitSeries.label;
      }
      if (scope === 'workcentre' && currentOpCentre?.processBoards) {
        const labels = currentOpCentre.processBoards
          .filter((b) => b.workUnitSeries?.enabled && b.workUnitSeries?.label)
          .map((b) => b.workUnitSeries.label);
        const uniqueLabels = [...new Set(labels)];
        if (uniqueLabels.length === 1) {
          return uniqueLabels[0];
        }
      }
      return 'Work Unit';
    };

    const getColumnDefinition = (columnId) => {
      if (SYSTEM_COLUMNS[columnId]) {
        // v152 UX-152-001: Override Work Unit label dynamically
        if (columnId === '_workUnit') {
          return {
            ...SYSTEM_COLUMNS[columnId],
            label: getWorkUnitLabel(),
          };
        }
        return SYSTEM_COLUMNS[columnId];
      }

      const FIELD_LIBRARY_NORMALIZED = window.FIELD_LIBRARY_NORMALIZED || {};
      const libraryField = FIELD_LIBRARY_NORMALIZED[columnId];
      if (libraryField) {
        return {
          id: columnId,
          label: libraryField.label || libraryField.name,
          type: libraryField.type,
          defaultWidth: 120,
          minWidth: 80,
          locked: false,
          options: libraryField.options,
        };
      }

      const customField = company?.customFields?.find((f) => f.id === columnId);
      if (customField) {
        return {
          id: columnId,
          label: customField.label || customField.name,
          type: customField.type,
          defaultWidth: 120,
          minWidth: 80,
          locked: false,
          options: customField.options,
        };
      }

      // v176a: Customer filter fields (virtual columns)
      if (CUSTOMER_FILTER_FIELDS[columnId]) {
        return {
          ...CUSTOMER_FILTER_FIELDS[columnId],
          defaultWidth: 140,
          minWidth: 100,
          locked: false,
        };
      }

      return null;
    };

    // Get value from ticket for a column
    const getColumnValue = (ticket, columnId) => {
      switch (columnId) {
        case '_type':
          return getTicketType(ticket.typeId)?.name || ticket.typeId;
        case '_key':
          return ticket.id;
        case '_summary':
          return ticket.name || ticket.title || '';
        case '_status':
          return getStatusInfo(ticket.status)?.label || ticket.status;
        case '_board':
          return getBoardName(ticket.boardId);
        case '_workCentre':
          return getWorkCentreName(ticket.opCentreId);
        case '_zone':
          return getZoneName(ticket.zoneId || ticket.sectionId);
        case '_stage':
          return ticket.column || '-';
        case '_workUnit':
          return getWorkUnitName(ticket.workUnitId);
        case '_created':
          return ticket.createdAt;
        case '_updated':
          return ticket.updatedAt || ticket.createdAt;
        case '_completed':
          return ticket.completedAt;
        case '_scopedAt':
          return ticket.scopedAt;
        case '_started':
          return ticket.startedAt;
        case '_ended':
          return ticket.endedAt;
        case '_createdBy':
          return ticket.createdBy || 'current-user';
        case '_links':
          // v179d: Return link status indicators
          return ticket.links?.length > 0 ? 'has-links' : '';
        default:
          return ticket[columnId];
      }
    };

    // v127: Get raw value from ticket for filtering (returns IDs, not display names)
    const getFilterValue = (ticket, columnId) => {
      switch (columnId) {
        case '_type':
          return ticket.typeId;
        case '_key':
          return ticket.id;
        case '_summary':
          return ticket.name || ticket.title || '';
        case '_status':
          return ticket.status;
        case '_board':
          return ticket.boardId;
        case '_workCentre':
          return ticket.opCentreId;
        case '_zone':
          return ticket.zoneId || ticket.sectionId;
        case '_stage':
          return ticket.column;
        case '_workUnit':
          return ticket.workUnitId;
        case '_created':
          return ticket.createdAt;
        case '_updated':
          return ticket.updatedAt || ticket.createdAt;
        case '_completed':
          return ticket.completedAt;
        case '_scopedAt':
          return ticket.scopedAt;
        case '_started':
          return ticket.startedAt;
        case '_ended':
          return ticket.endedAt;
        case '_createdBy':
          return ticket.createdBy;
        case '_links':
          return ticket.links?.length > 0 ? 'has-links' : '';
        default:
          // v176a: Handle customer fields (client.* paths)
          if (isCustomerField(columnId)) {
            return getCustomerFieldValue(ticket, columnId);
          }
          return ticket[columnId];
      }
    };

    // v127: Determine filter type from field/column definition
    // Returns: 'multiselect' | 'grouped-board' | 'grouped-workunit' | 'date' | 'number' | 'text'
    const getFilterTypeForField = (colDef) => {
      if (!colDef) return null;

      const type = colDef.type;

      // v176a: Customer field types - all are multiselect
      if (type?.startsWith('customer-')) {
        return 'multiselect';
      }

      // System columns with special handling
      if (type === 'system-board') return 'grouped-board';
      if (type === 'system-zone') return 'grouped-board'; // Grouped by WC → Board
      if (type === 'system-workunit') return 'grouped-workunit';

      // Multi-select types
      // v176b: Added 'customer' - field library client field uses type 'customer' (not 'customer-select')
      if (
        [
          'system-type',
          'system-status',
          'system-stage',
          'system-user',
          'select',
          'radio',
          'multiselect',
          'checkbox',
          'user',
          'multiuser',
          'customer',
        ].includes(type)
      ) {
        return 'multiselect';
      }

      // Date types
      if (['system-date', 'date', 'datetime'].includes(type)) {
        return 'date';
      }

      // Number types
      if (['number', 'currency'].includes(type)) {
        return 'number';
      }

      // Text types - all get contains search
      if (['system-key', 'system-text', 'text', 'textarea', 'richtext', 'url', 'email'].includes(type)) {
        return 'text';
      }

      // Default to text for unknown types
      return 'text';
    };

    // v127: Check if a ticket value matches a filter value
    const matchesFilterValue = (ticketValue, filterValue, filterType) => {
      // No filter value means no filtering
      if (filterValue === undefined || filterValue === null) return true;

      // Multi-select filter (array of values)
      if (filterType === 'multiselect' || filterType === 'grouped-board' || filterType === 'grouped-workunit') {
        if (!Array.isArray(filterValue) || filterValue.length === 0) return true;

        // v176a: Check for NO_CUSTOMER filter (tickets without client assigned)
        if (filterValue.includes(NO_CUSTOMER)) {
          const hasNoCustomer = ticketValue === null || ticketValue === undefined || ticketValue === '';
          if (hasNoCustomer) return true;
        }

        // Check for empty value filter
        if (filterValue.includes(EMPTY_VALUE)) {
          const isEmpty =
            ticketValue === null ||
            ticketValue === undefined ||
            ticketValue === '' ||
            (Array.isArray(ticketValue) && ticketValue.length === 0);
          if (isEmpty) return true;
        }

        // Check other values
        const nonEmptyFilters = filterValue.filter((v) => v !== EMPTY_VALUE && v !== NO_CUSTOMER);
        if (nonEmptyFilters.length === 0) return false;

        // Handle array ticket values (multiselect fields)
        if (Array.isArray(ticketValue)) {
          return nonEmptyFilters.some((v) => ticketValue.includes(v));
        }

        return nonEmptyFilters.includes(ticketValue);
      }

      // Date filter
      if (filterType === 'date') {
        // Empty value check
        if (filterValue.empty) {
          return !ticketValue;
        }

        if (!ticketValue) return false;
        const ticketDate = new Date(ticketValue);
        const now = new Date();

        // Preset filters
        if (filterValue.preset) {
          const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
          const today = startOfDay(now);

          switch (filterValue.preset) {
            case 'today':
              return ticketDate >= today && ticketDate < new Date(today.getTime() + 86400000);
            case 'yesterday': {
              const yesterday = new Date(today.getTime() - 86400000);
              return ticketDate >= yesterday && ticketDate < today;
            }
            case 'this-week': {
              const dayOfWeek = now.getDay();
              const startOfWeek = new Date(today.getTime() - dayOfWeek * 86400000);
              return ticketDate >= startOfWeek;
            }
            case 'last-7-days': {
              const sevenDaysAgo = new Date(today.getTime() - 7 * 86400000);
              return ticketDate >= sevenDaysAgo;
            }
            case 'this-month': {
              const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
              return ticketDate >= startOfMonth;
            }
            case 'last-30-days': {
              const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000);
              return ticketDate >= thirtyDaysAgo;
            }
            case 'this-quarter': {
              const quarter = Math.floor(now.getMonth() / 3);
              const startOfQuarter = new Date(now.getFullYear(), quarter * 3, 1);
              return ticketDate >= startOfQuarter;
            }
            default:
              return true;
          }
        }

        // v142: Before filter (exclusive - ticketDate < before)
        if (filterValue.before) {
          const beforeDate = new Date(filterValue.before);
          // Start of the "before" day - ticket must be strictly before this day
          const startOfBeforeDay = new Date(beforeDate.getFullYear(), beforeDate.getMonth(), beforeDate.getDate());
          return ticketDate < startOfBeforeDay;
        }

        // v142: After filter (inclusive - ticketDate >= after)
        if (filterValue.after) {
          const afterDate = new Date(filterValue.after);
          // Start of the "after" day - ticket must be on or after this day
          const startOfAfterDay = new Date(afterDate.getFullYear(), afterDate.getMonth(), afterDate.getDate());
          return ticketDate >= startOfAfterDay;
        }

        // Custom date range (between - inclusive both ends)
        if (filterValue.from || filterValue.to) {
          if (filterValue.from) {
            const fromDate = new Date(filterValue.from);
            const startOfFromDay = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
            if (ticketDate < startOfFromDay) return false;
          }
          if (filterValue.to) {
            const toDate = new Date(filterValue.to);
            toDate.setHours(23, 59, 59, 999); // Include entire day
            if (ticketDate > toDate) return false;
          }
          return true;
        }

        return true;
      }

      // Number range filter
      if (filterType === 'number') {
        // Empty value check
        if (filterValue.empty) {
          return ticketValue === null || ticketValue === undefined || ticketValue === '';
        }

        if (filterValue.min === undefined && filterValue.max === undefined) return true;

        const num = parseFloat(ticketValue);
        if (isNaN(num)) return filterValue.min === undefined && filterValue.max === undefined;

        if (filterValue.min !== undefined && num < filterValue.min) return false;
        if (filterValue.max !== undefined && num > filterValue.max) return false;
        return true;
      }

      // Text filter
      // v154b: Multi-condition AND/OR support
      if (filterType === 'text') {
        // Helper to match a single condition
        const matchesSingleCondition = (ticketStr, cond) => {
          const { op, value } = cond;

          // Handle empty/not-empty operators (no value needed)
          if (op === 'is-empty') {
            return !ticketStr || ticketStr.trim() === '';
          }
          if (op === 'is-not-empty') {
            return ticketStr && ticketStr.trim() !== '';
          }

          // For value-based operators, empty value means no filtering
          if (!value || value.trim() === '') return true;

          const filterStr = value.toLowerCase();
          const ticketLower = ticketStr ? ticketStr.toLowerCase() : '';

          // Handle empty ticket values for value-based operators
          if (!ticketStr || ticketStr.trim() === '') {
            return op === 'not-contains' || op === 'not-equals';
          }

          switch (op) {
            case 'contains':
              return ticketLower.includes(filterStr);
            case 'not-contains':
              return !ticketLower.includes(filterStr);
            case 'equals':
              return ticketLower === filterStr;
            case 'not-equals':
              return ticketLower !== filterStr;
            case 'starts-with':
              return ticketLower.startsWith(filterStr);
            case 'ends-with':
              return ticketLower.endsWith(filterStr);
            default:
              return ticketLower.includes(filterStr);
          }
        };

        // Multi-condition format: { mode: 'and'|'or', conditions: [...] }
        if (
          typeof filterValue === 'object' &&
          filterValue !== null &&
          !Array.isArray(filterValue) &&
          filterValue.conditions
        ) {
          const { mode, conditions } = filterValue;
          if (!conditions || conditions.length === 0) return true;

          const ticketStr = ticketValue ? String(ticketValue) : '';
          const results = conditions.map((cond) => matchesSingleCondition(ticketStr, cond));

          return mode === 'or' ? results.some((r) => r) : results.every((r) => r); // Default to AND
        }

        // Legacy: single condition format { op, value }
        if (typeof filterValue === 'object' && filterValue !== null && !Array.isArray(filterValue) && filterValue.op) {
          const ticketStr = ticketValue ? String(ticketValue) : '';
          return matchesSingleCondition(ticketStr, filterValue);
        }

        // Legacy: bare string treated as contains
        if (!filterValue || typeof filterValue !== 'string' || filterValue.trim() === '') return true;
        if (!ticketValue) return false;
        return String(ticketValue).toLowerCase().includes(filterValue.toLowerCase());
      }

      return true;
    };

    // Render cell content based on column type
    const renderCellContent = (ticket, columnId) => {
      const colDef = getColumnDefinition(columnId);
      const value = getColumnValue(ticket, columnId);

      switch (columnId) {
        case '_type': {
          const ticketType = getTicketType(ticket.typeId);
          return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100">
              {ticketType?.icon && <span>{ticketType.icon}</span>}
              {ticketType?.name || ticket.typeId}
            </span>
          );
        }
        case '_key':
          return <span className="font-medium text-indigo-600">{ticket.id}</span>;
        case '_summary':
          return <span className="text-gray-900">{ticket.name}</span>;
        case '_status': {
          const status = getStatusInfo(ticket.status);
          return (
            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(status?.type)}`}>
              {status?.label || ticket.status}
            </span>
          );
        }
        case '_board':
          return (
            <span
              className="text-gray-500"
              title={
                scope === 'all'
                  ? `${getWorkCentreNameForBoard(ticket.boardId)} / ${getBoardName(ticket.boardId)}`
                  : undefined
              }
            >
              {getBoardName(ticket.boardId)}
            </span>
          );
        case '_workCentre':
          return <span className="text-gray-500">{getWorkCentreName(ticket.opCentreId)}</span>;
        case '_zone':
          // v155: Show "—" for tickets on simple boards (no work units)
          if (isTicketOnSimpleBoard(ticket)) {
            return <span className="text-gray-400">—</span>;
          }
          return <span className="text-gray-500">{getZoneName(ticket.zoneId || ticket.sectionId)}</span>;
        case '_stage':
          return <span className="text-gray-500">{ticket.column || '-'}</span>;
        case '_workUnit':
          return <span className="text-gray-500">{getWorkUnitName(ticket.workUnitId)}</span>;
        case '_created':
        case '_updated':
        case '_completed':
        case '_scopedAt':
        case '_started':
        case '_ended':
          return <span className="text-gray-500">{formatDate(value)}</span>;
        case '_createdBy':
          const creatorName = ticket.createdBy ? getAssigneeName(ticket.createdBy) : 'Current User';
          return <span className="text-gray-500">{creatorName}</span>;
        case '_links': {
          // v179d: Render link status indicators
          const links = ticket.links || [];
          if (links.length === 0) return <span className="text-gray-400">-</span>;

          // Check for unresolved dependencies
          const hasDeps = links.some((link) => {
            if (link.type !== 'depends-on') return false;
            const target = allTickets.find((t) => t.id === link.targetTicketId);
            if (!target) return false;
            const statusDef = globalCompany?.statuses?.find((s) => s.id === target.status);
            return !['completed', 'ended'].includes(statusDef?.type);
          });

          // Check if blocking others
          const isBlocking = links.some((link) => {
            if (link.type !== 'blocks') return false;
            const target = allTickets.find((t) => t.id === link.targetTicketId);
            if (!target) return false;
            const statusDef = globalCompany?.statuses?.find((s) => s.id === target.status);
            return !['completed', 'ended'].includes(statusDef?.type);
          });

          return (
            <span className="inline-flex gap-1">
              {hasDeps && (
                <span className="text-amber-600" title="Has dependencies">
                  ⏳
                </span>
              )}
              {isBlocking && (
                <span className="text-red-600" title="Blocking others">
                  🚫
                </span>
              )}
              {!hasDeps && !isBlocking && (
                <span className="text-gray-400" title={`${links.length} link(s)`}>
                  🔗
                </span>
              )}
            </span>
          );
        }
        default:
          if (colDef?.type === 'user') {
            return <span className="text-gray-500">{getAssigneeName(value)}</span>;
          }
          if (colDef?.type === 'select' || colDef?.type === 'radio') {
            if (columnId === 'priority') {
              return (
                <span
                  className={
                    value === 'Highest'
                      ? 'text-red-600 font-medium'
                      : value === 'High'
                        ? 'text-orange-600'
                        : value === 'Medium'
                          ? 'text-yellow-600'
                          : value === 'Low'
                            ? 'text-green-600'
                            : 'text-gray-500'
                  }
                >
                  {value || '-'}
                </span>
              );
            }
            return <span className="text-gray-700">{value || '-'}</span>;
          }
          if (colDef?.type === 'date') {
            return <span className="text-gray-500">{formatDate(value)}</span>;
          }
          if (colDef?.type === 'multiselect' || colDef?.type === 'checkbox') {
            if (Array.isArray(value) && value.length > 0) {
              return <span className="text-gray-700">{value.join(', ')}</span>;
            }
            return <span className="text-gray-400">-</span>;
          }
          if (colDef?.type === 'number' || colDef?.type === 'currency') {
            return <span className="text-gray-700">{value != null ? value : '-'}</span>;
          }
          if (colDef?.type === 'url') {
            return value ? (
              <a
                href={value}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:underline truncate"
              >
                {value}
              </a>
            ) : (
              <span className="text-gray-400">-</span>
            );
          }
          if (colDef?.type === 'email') {
            return value ? (
              <a href={`mailto:${value}`} className="text-indigo-600 hover:underline">
                {value}
              </a>
            ) : (
              <span className="text-gray-400">-</span>
            );
          }
          return <span className="text-gray-700">{value || '-'}</span>;
      }
    };

    // Get sortable value for column
    const getSortValue = (ticket, columnId) => {
      switch (columnId) {
        case '_type':
          return getTicketType(ticket.typeId)?.name || '';
        case '_key':
          return ticket.id || '';
        case '_summary':
          return ticket.name || '';
        case '_status':
          return getStatusInfo(ticket.status)?.label || '';
        case '_board':
          return getBoardName(ticket.boardId);
        case '_workCentre':
          return getWorkCentreName(ticket.opCentreId);
        case '_zone':
          // v155: Simple board tickets sort with empty value
          if (isTicketOnSimpleBoard(ticket)) return '';
          return getZoneName(ticket.zoneId || ticket.sectionId);
        case '_stage':
          return ticket.column || '';
        case '_workUnit':
          return getWorkUnitName(ticket.workUnitId);
        case '_created':
          return new Date(ticket.createdAt || 0).getTime();
        case '_updated':
          return new Date(ticket.updatedAt || ticket.createdAt || 0).getTime();
        case '_completed':
          return new Date(ticket.completedAt || 0).getTime();
        case '_scopedAt':
          return new Date(ticket.scopedAt || 0).getTime();
        case '_started':
          return new Date(ticket.startedAt || 0).getTime();
        case '_ended':
          return new Date(ticket.endedAt || 0).getTime();
        case '_createdBy':
          return ticket.createdBy ? getAssigneeName(ticket.createdBy) : 'Current User';
        case 'priority': {
          const priorityOrder = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 };
          return priorityOrder[ticket.priority] ?? 5;
        }
        case 'assignee':
          return getAssigneeName(ticket.assignee);
        default:
          return ticket[columnId] || '';
      }
    };

    // Filter tickets based on scope
    // v167a: Changed from "include deleted" to "show only deleted" (exclusive filter)
    const filteredByScope = useMemo(() => {
      if (!tickets) return [];

      // v159a: Get isDeletedStatus helper
      const isDeletedStatus = window.Domain?.Statuses?.isDeletedStatus;

      // Filter by scope first
      let scopedTickets;
      switch (scope) {
        case 'board':
          scopedTickets = tickets.filter((t) => t.boardId === activeBoardId);
          break;
        case 'workcentre':
          const boardIds = currentOpCentre?.processBoards?.map((b) => b.id) || [];
          scopedTickets = tickets.filter((t) => boardIds.includes(t.boardId));
          break;
        case 'all':
        default:
          scopedTickets = tickets;
      }

      // v167a: Exclusive deleted filter (only available at 'all' scope)
      // When showOnlyDeleted is true: show ONLY deleted tickets
      // When showOnlyDeleted is false: hide deleted tickets (default)
      if (isDeletedStatus) {
        if (showOnlyDeleted) {
          scopedTickets = scopedTickets.filter((t) => isDeletedStatus(t.status, company?.statuses));
        } else {
          scopedTickets = scopedTickets.filter((t) => !isDeletedStatus(t.status, company?.statuses));
        }
      }

      return scopedTickets;
    }, [tickets, scope, activeBoardId, currentOpCentre, showOnlyDeleted, company?.statuses]);

    // v127: Apply active column filters
    // v136: Added ASSIGNED_TO_ME handling for assignee field
    const filteredByActiveFilters = useMemo(() => {
      const filterEntries = Object.entries(activeFilters);
      if (filterEntries.length === 0) return filteredByScope;

      return filteredByScope.filter((ticket) => {
        // All filters must match (AND logic)
        for (const [columnId, filterValue] of filterEntries) {
          const colDef = getColumnDefinition(columnId);
          const filterType = getFilterTypeForField(colDef);
          const ticketValue = getFilterValue(ticket, columnId);

          // v136: Special handling for ASSIGNED_TO_ME
          if (columnId === 'assignee' && Array.isArray(filterValue) && filterValue.includes(ASSIGNED_TO_ME)) {
            // Check if ticket is assigned to current user
            const isAssignedToMe = ticketValue === currentUser;
            // Also check other selected values
            const otherValues = filterValue.filter((v) => v !== ASSIGNED_TO_ME && v !== EMPTY_VALUE);
            const matchesEmpty = filterValue.includes(EMPTY_VALUE) && (!ticketValue || ticketValue === '');
            const matchesOther = otherValues.length > 0 && otherValues.includes(ticketValue);

            if (!isAssignedToMe && !matchesEmpty && !matchesOther) {
              return false;
            }
            continue; // Skip normal matching for this filter
          }

          if (!matchesFilterValue(ticketValue, filterValue, filterType)) {
            return false;
          }
        }
        return true;
      });
    }, [filteredByScope, activeFilters, currentUser]);

    // Search filter
    const searchFiltered = useMemo(() => {
      if (!searchTerm.trim()) return filteredByActiveFilters;

      const term = searchTerm.toLowerCase();
      return filteredByActiveFilters.filter((ticket) => {
        const ticketType = getTicketType(ticket.typeId);
        return (
          ticket.id?.toLowerCase().includes(term) ||
          ticket.name?.toLowerCase().includes(term) ||
          ticketType?.name?.toLowerCase().includes(term) ||
          ticket.status?.toLowerCase().includes(term) ||
          getAssigneeName(ticket.assignee)?.toLowerCase().includes(term)
        );
      });
    }, [filteredByActiveFilters, searchTerm]);

    // Sort tickets
    const sortedTickets = useMemo(() => {
      const sorted = [...searchFiltered];

      sorted.sort((a, b) => {
        const aVal = getSortValue(a, sortColumn);
        const bVal = getSortValue(b, sortColumn);

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          const comparison = aVal.localeCompare(bVal);
          return sortDirection === 'asc' ? comparison : -comparison;
        }

        if (sortDirection === 'asc') {
          return (aVal || 0) - (bVal || 0);
        }
        return (bVal || 0) - (aVal || 0);
      });

      return sorted;
    }, [searchFiltered, sortColumn, sortDirection]);

    // Sort handler
    const handleSort = (column) => {
      if (sortColumn === column) {
        const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        setSortDirection(newDirection);
        if (scope === 'board' && onViewConfigChange) {
          onViewConfigChange({
            ...viewConfig,
            sortColumn: column,
            sortDirection: newDirection,
          });
        }
      } else {
        setSortColumn(column);
        setSortDirection('asc');
        if (scope === 'board' && onViewConfigChange) {
          onViewConfigChange({
            ...viewConfig,
            sortColumn: column,
            sortDirection: 'asc',
          });
        }
      }
    };

    // v127: Explicit sort (for dropdown buttons)
    const handleSortExplicit = (column, direction) => {
      setSortColumn(column);
      setSortDirection(direction);
      setFilterDropdownColumn(null); // Close dropdown
      if (scope === 'board' && onViewConfigChange) {
        onViewConfigChange({
          ...viewConfig,
          sortColumn: column,
          sortDirection: direction,
        });
      }
    };

    // v127: Filter handlers
    const handleFilterChange = (columnId, filterValue) => {
      const newFilters = { ...activeFilters };

      // Remove filter if value is empty/null/undefined or empty array
      const isEmpty =
        filterValue === null ||
        filterValue === undefined ||
        (Array.isArray(filterValue) && filterValue.length === 0) ||
        (typeof filterValue === 'string' && filterValue.trim() === '') ||
        (typeof filterValue === 'object' && !Array.isArray(filterValue) && Object.keys(filterValue).length === 0);

      if (isEmpty) {
        delete newFilters[columnId];
      } else {
        newFilters[columnId] = filterValue;
      }

      setActiveFilters(newFilters);

      // Persist to viewConfig if at board scope
      if (scope === 'board' && onViewConfigChange) {
        onViewConfigChange({
          ...viewConfig,
          activeFilters: newFilters,
        });
      }
    };

    const handleClearAllFilters = () => {
      setActiveFilters({});

      if (scope === 'board' && onViewConfigChange) {
        onViewConfigChange({
          ...viewConfig,
          activeFilters: {},
        });
      }
    };

    const handleRemoveFilter = (columnId) => {
      handleFilterChange(columnId, null);
    };

    // v127: Check if a column has an active filter
    // v134: Updated to handle text filter objects
    const hasActiveFilter = (columnId) => {
      const filter = activeFilters[columnId];
      if (!filter) return false;
      if (Array.isArray(filter)) return filter.length > 0;
      if (typeof filter === 'string') return filter.trim() !== '';
      if (typeof filter === 'object') {
        // Text filter object { op, value }
        if (filter.op && filter.value !== undefined) {
          return filter.value.trim() !== '';
        }
        return Object.keys(filter).length > 0;
      }
      return true;
    };

    // v133: Get display-friendly value for a filter (for Active Filters Bar)
    const getFilterDisplayValue = (columnId, filterValue) => {
      const colDef = getColumnDefinition(columnId);

      // Multiselect array
      if (Array.isArray(filterValue)) {
        const labels = filterValue.map((val) => {
          if (val === EMPTY_VALUE) return '(Empty)';
          // v136: Handle "Assigned to Me"
          if (val === ASSIGNED_TO_ME) return 'Assigned to Me';
          // v176a: Handle "No Customer"
          if (val === NO_CUSTOMER) return '(No Customer)';

          // v176a: Customer field display values
          if (columnId === 'client') {
            return getCustomerName(val);
          }
          if (columnId === 'client.stage') {
            return getLifecycleStageName(val);
          }
          if (columnId === 'client.accountOwnerId') {
            return getAssigneeName(val);
          }
          // For client.territory, client.industry, client.companySize - value IS the label
          if (columnId?.startsWith('client.')) {
            return val;
          }

          // Look up label based on column type
          if (columnId === '_status') {
            return getStatusInfo(val)?.label || val;
          }
          if (columnId === '_type') {
            return getTicketType(val)?.name || val;
          }
          if (columnId === '_board') {
            return getBoardName(val);
          }
          if (columnId === '_workCentre') {
            return getWorkCentreName(val);
          }
          if (columnId === '_workUnit') {
            return getWorkUnitName(val);
          }
          if (columnId === '_zone') {
            return getZoneName(val);
          }
          if (colDef?.type === 'user' || columnId === 'assignee') {
            return getAssigneeName(val);
          }

          return val;
        });

        return labels.join(', ');
      }

      // Date preset
      if (filterValue?.preset) {
        const presetLabels = {
          today: 'Today',
          yesterday: 'Yesterday',
          'this-week': 'This Week',
          'last-7-days': 'Last 7 Days',
          'this-month': 'This Month',
          'last-30-days': 'Last 30 Days',
          'this-quarter': 'This Quarter',
        };
        return presetLabels[filterValue.preset] || filterValue.preset;
      }

      // v142: Format date for display (e.g., "Jan 15, 2025")
      const formatDateForDisplay = (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      };

      // v142: Before date (exclusive)
      if (filterValue?.before) {
        return `< ${formatDateForDisplay(filterValue.before)}`;
      }

      // v142: After date (inclusive)
      if (filterValue?.after) {
        return `≥ ${formatDateForDisplay(filterValue.after)}`;
      }

      // Date range (between)
      if (filterValue?.from || filterValue?.to) {
        if (filterValue.from && filterValue.to) {
          return `${formatDateForDisplay(filterValue.from)} – ${formatDateForDisplay(filterValue.to)}`;
        }
        if (filterValue.from) return `≥ ${formatDateForDisplay(filterValue.from)}`;
        if (filterValue.to) return `≤ ${formatDateForDisplay(filterValue.to)}`;
      }

      // Number range
      if (filterValue?.min !== undefined || filterValue?.max !== undefined) {
        if (filterValue.min !== undefined && filterValue.max !== undefined) {
          return `${filterValue.min} – ${filterValue.max}`;
        }
        if (filterValue.min !== undefined) return `≥ ${filterValue.min}`;
        if (filterValue.max !== undefined) return `≤ ${filterValue.max}`;
      }

      // Empty value filter for date/number
      if (filterValue?.empty) {
        return '(Empty)';
      }

      // v154b: Operator labels for display
      const opLabels = {
        contains: 'contains',
        'not-contains': 'not contains',
        equals: 'equals',
        'not-equals': 'not equals',
        'starts-with': 'starts with',
        'ends-with': 'ends with',
        'is-empty': 'is empty',
        'is-not-empty': 'is not empty',
      };

      // v154b: Format a single condition for display
      const formatCondition = (cond) => {
        const label = opLabels[cond.op] || cond.op;
        if (cond.op === 'is-empty' || cond.op === 'is-not-empty') {
          return label;
        }
        return `${label} "${cond.value}"`;
      };

      // v154b: Multi-condition text filter
      if (
        typeof filterValue === 'object' &&
        filterValue !== null &&
        !Array.isArray(filterValue) &&
        filterValue.conditions
      ) {
        const { mode, conditions } = filterValue;
        if (conditions.length === 1) {
          return formatCondition(conditions[0]);
        }
        return `${conditions.length} conditions (${mode?.toUpperCase() || 'AND'})`;
      }

      // v134: Legacy single condition format { op, value }
      if (typeof filterValue === 'object' && filterValue !== null && !Array.isArray(filterValue) && filterValue.op) {
        return formatCondition(filterValue);
      }

      // Text filter (legacy bare string format)
      if (typeof filterValue === 'string') {
        return `contains "${filterValue}"`;
      }

      return String(filterValue);
    };

    // v149: Saved Views handlers (renamed from Saved Filter Sets)
    const hasFiltersActive = Object.keys(activeFilters).length > 0;
    // v149: Check if there's anything to save (filters OR non-default columns)
    const hasViewConfigToSave = hasFiltersActive || visibleColumns.length > 0;

    // v149: Choose saved views based on entry point (activeBoardId), not scope
    // If entered from a board: always show boardSavedViews (regardless of scope view)
    // If entered from admin: always show globalSavedViews
    const currentSavedViews = useMemo(() => {
      if (activeBoardId) {
        return boardSavedViews || [];
      }
      return globalSavedViews || [];
    }, [activeBoardId, boardSavedViews, globalSavedViews]);

    // v152: Detect if active view has been modified
    // v153a: Compare identity only (filters, sort, column set) - ignore presentation (widths, order)
    const isViewModified = useMemo(() => {
      if (!activeViewConfig) return false;

      // Compare scope
      if (scope !== activeViewConfig.scope) return true;

      // v153a: Location columns that are auto-inserted based on scope (ignore in comparison)
      const locationColumns = ['_board', '_workCentre'];

      // v153a: Compare columns as SETS (ignore order and location columns)
      const currentColumnsSet = [...visibleColumns].filter((c) => !locationColumns.includes(c)).sort();
      const savedColumnsSet = [...(activeViewConfig.columns || [])].filter((c) => !locationColumns.includes(c)).sort();
      if (JSON.stringify(currentColumnsSet) !== JSON.stringify(savedColumnsSet)) return true;

      // Compare sort
      if (sortColumn !== activeViewConfig.sortColumn) return true;
      if (sortDirection !== activeViewConfig.sortDirection) return true;

      // Compare filters
      if (JSON.stringify(activeFilters) !== JSON.stringify(activeViewConfig.filters || {})) return true;

      // v153a: Column widths and order are PRESENTATION - not compared for modification detection

      return false;
    }, [activeViewConfig, scope, visibleColumns, sortColumn, sortDirection, activeFilters]);

    // v152: Clear active view
    const handleClearActiveView = useCallback(() => {
      setActiveViewId(null);
      setActiveViewName('');
      setActiveViewConfig(null);
    }, []);

    // v153 OPTION-B: Auto-switch active view when scope changes
    // v153a: Compare identity only (column sets, sort, filters) - preserve current presentation
    const prevScopeRef = useRef(scope);
    useEffect(() => {
      // Skip on initial mount or if scope hasn't changed
      if (prevScopeRef.current === scope) return;
      prevScopeRef.current = scope;

      // v153a BUG-153-002: Clear selection when scope changes
      onSelectedTicketsChange?.(new Set());

      // Get saved views for the new scope
      const viewsAtNewScope = currentSavedViews.filter((v) => v.scope === scope);
      if (viewsAtNewScope.length === 0) {
        // No views at this scope - clear active view
        setActiveViewId(null);
        setActiveViewName('');
        setActiveViewConfig(null);
        return;
      }

      // Location columns that are auto-inserted based on scope (ignore these in comparison)
      const locationColumns = ['_board', '_workCentre'];

      // v153a: Get current columns as a SORTED SET (ignore order and location columns)
      const currentColumnsSet = [...visibleColumns].filter((c) => !locationColumns.includes(c)).sort();

      // Try to find a matching view
      let matchFound = false;
      for (const view of viewsAtNewScope) {
        // v153a: Compare columns as SORTED SETS (ignoring location columns and order)
        const viewColumnsSet = [...(view.columns || [])].filter((c) => !locationColumns.includes(c)).sort();

        if (JSON.stringify(currentColumnsSet) !== JSON.stringify(viewColumnsSet)) continue;

        // Compare sort
        if (view.sortColumn !== sortColumn) continue;
        if (view.sortDirection !== sortDirection) continue;

        // Compare filters
        if (JSON.stringify(view.filters || {}) !== JSON.stringify(activeFilters)) continue;

        // Found a match! Auto-switch to this view
        setActiveViewId(view.id);
        setActiveViewName(view.name);

        // v153a: Set activeViewConfig to match CURRENT state so isViewModified returns false
        // This preserves the user's current presentation (widths, order) across scope changes
        setActiveViewConfig({
          filters: activeFilters,
          scope: scope,
          columns: visibleColumns, // Current columns (with any location cols)
          columnWidths: columnWidths, // Current widths preserved
          sortColumn: sortColumn,
          sortDirection: sortDirection,
        });

        matchFound = true;
        break; // Found a match, stop looking
      }

      // v153a: If no match found, clear active view
      if (!matchFound) {
        setActiveViewId(null);
        setActiveViewName('');
        setActiveViewConfig(null);
      }
    }, [
      scope,
      currentSavedViews,
      visibleColumns,
      sortColumn,
      sortDirection,
      activeFilters,
      columnWidths,
      onSelectedTicketsChange,
    ]);

    // v149: Helper to check if a column still exists in the system
    // Checks system columns, field library (window global), and custom fields
    const columnExists = useCallback(
      (columnId) => {
        // System columns always exist
        if (SYSTEM_COLUMNS[columnId]) return true;
        // Field library (standard fields like assignee, priority, etc.)
        if (window.FIELD_LIBRARY_NORMALIZED?.[columnId]) return true;
        // Company custom fields
        if (company?.customFields?.some((f) => f.id === columnId)) return true;
        return false;
      },
      [company?.customFields]
    );

    // v149: Get readable column name for display
    const getColumnDisplayName = useCallback(
      (columnId) => {
        const sysCols = SYSTEM_COLUMNS[columnId];
        if (sysCols) return sysCols.label;
        const field = company?.fieldLibrary?.find((f) => f.id === columnId);
        return field?.label || columnId;
      },
      [company?.fieldLibrary]
    );

    // v152: Build current view config snapshot
    const getCurrentViewConfig = useCallback(
      () => ({
        filters: { ...activeFilters },
        scope,
        columns: [...visibleColumns],
        columnWidths: { ...columnWidths },
        sortColumn,
        sortDirection,
      }),
      [activeFilters, scope, visibleColumns, columnWidths, sortColumn, sortDirection]
    );

    // v152: Save view - includes filters, scope, columns, widths, sort
    // Supports three modes: 'updateActive', 'updateOther', 'create'
    const handleSaveView = () => {
      const currentConfig = getCurrentViewConfig();

      // v152: If updating the currently active view
      if (saveMode === 'updateActive' && activeViewId) {
        const updatedViews = currentSavedViews.map((v) =>
          v.id === activeViewId
            ? {
                ...v,
                ...currentConfig,
                updatedAt: new Date().toISOString(),
              }
            : v
        );

        if (onSavedViewsChange) {
          onSavedViewsChange(updatedViews, activeBoardId);
        }

        // Update active view config snapshot (no longer modified)
        setActiveViewConfig(currentConfig);

        setSaveViewName('');
        setUpdateExistingViewId('');
        setSaveViewError('');
        setSaveMode(activeViewId ? 'updateActive' : 'create');
        setShowSaveViewModal(false);
        return;
      }

      // v152: If updating a different existing view
      if (saveMode === 'updateOther' && updateExistingViewId) {
        const targetView = currentSavedViews.find((v) => v.id === updateExistingViewId);
        const updatedViews = currentSavedViews.map((v) =>
          v.id === updateExistingViewId
            ? {
                ...v,
                ...currentConfig,
                updatedAt: new Date().toISOString(),
              }
            : v
        );

        if (onSavedViewsChange) {
          onSavedViewsChange(updatedViews, activeBoardId);
        }

        // v152: Switch active view to the one we just saved to
        if (targetView) {
          setActiveViewId(updateExistingViewId);
          setActiveViewName(targetView.name);
          setActiveViewConfig(currentConfig);
        }

        setSaveViewName('');
        setUpdateExistingViewId('');
        setSaveViewError('');
        setSaveMode(activeViewId ? 'updateActive' : 'create');
        setShowSaveViewModal(false);
        return;
      }

      // Creating new view - validate name
      if (!saveViewName.trim()) return;

      // Check for duplicate name
      const nameExists = currentSavedViews.some((v) => v.name.toLowerCase() === saveViewName.trim().toLowerCase());

      if (nameExists) {
        setSaveViewError('A view with this name already exists');
        return;
      }

      // v149: Create new view with full configuration
      const newViewId = `view-${Date.now()}`;
      const newViewName = saveViewName.trim();
      const newView = {
        id: newViewId,
        name: newViewName,
        ...currentConfig,
        createdAt: new Date().toISOString(),
      };

      const updatedViews = [...currentSavedViews, newView];

      if (onSavedViewsChange) {
        onSavedViewsChange(updatedViews, activeBoardId);
      }

      // v152: Set the new view as active
      setActiveViewId(newViewId);
      setActiveViewName(newViewName);
      setActiveViewConfig(currentConfig);

      setSaveViewName('');
      setUpdateExistingViewId('');
      setSaveViewError('');
      setSaveMode('updateActive'); // Next time, default to updating the now-active view
      setShowSaveViewModal(false);
    };

    // v152: Load view - restores full configuration including columns
    const handleLoadView = (view) => {
      // Check for missing columns first
      const missingCols = [];
      if (view.columns && Array.isArray(view.columns)) {
        view.columns.forEach((colId) => {
          if (!columnExists(colId)) {
            missingCols.push(getColumnDisplayName(colId));
          }
        });
      }

      // v152 BUG-152-001 FIX: Compute effective values BEFORE applying
      // This ensures activeViewConfig matches what we actually apply
      const effectiveScope = view.scope || scope;
      const effectiveColumns = view.columns ? view.columns.filter((colId) => columnExists(colId)) : visibleColumns;
      const effectiveSortColumn = view.sortColumn || sortColumn;
      const effectiveSortDirection = view.sortDirection || sortDirection;
      const effectiveFilters = view.filters || {};

      // For widths: merge saved widths with current widths for effective columns
      const effectiveWidths = {};
      effectiveColumns.forEach((colId) => {
        effectiveWidths[colId] = view.columnWidths?.[colId] ?? columnWidths[colId];
      });

      // Switch to saved scope if available
      if (view.scope) {
        setScope(view.scope);
      }

      // Apply filters (backward compatible - old saves only had filters)
      setActiveFilters(effectiveFilters);

      // v149: Apply columns if present (filter out missing ones)
      if (view.columns && Array.isArray(view.columns)) {
        if (effectiveColumns.length > 0) {
          setLocalColumns(effectiveColumns);
        }
      }

      // v149: Apply column widths if present
      if (view.columnWidths && typeof view.columnWidths === 'object') {
        setColumnWidths((prev) => ({
          ...prev,
          ...view.columnWidths,
        }));
      }

      // v149: Apply sort if present
      if (view.sortColumn) {
        setSortColumn(view.sortColumn);
      }
      if (view.sortDirection) {
        setSortDirection(view.sortDirection);
      }

      setShowLoadDropdown(false);

      // v152: Set active view state with EFFECTIVE config (not just saved values)
      setActiveViewId(view.id);
      setActiveViewName(view.name);
      setActiveViewConfig({
        filters: effectiveFilters,
        scope: effectiveScope,
        columns: effectiveColumns,
        columnWidths: effectiveWidths,
        sortColumn: effectiveSortColumn,
        sortDirection: effectiveSortDirection,
      });

      // Persist to viewConfig if at board scope
      if (effectiveScope === 'board' && onViewConfigChange) {
        onViewConfigChange({
          ...viewConfig,
          activeFilters: effectiveFilters,
          columns: effectiveColumns.length > 0 ? effectiveColumns : viewConfig?.columns,
          columnWidths: view.columnWidths
            ? { ...viewConfig?.columnWidths, ...view.columnWidths }
            : viewConfig?.columnWidths,
          sortColumn: effectiveSortColumn,
          sortDirection: effectiveSortDirection,
        });
      }

      // Show warning if columns were missing
      if (missingCols.length > 0) {
        setMissingColumnNames(missingCols);
        setShowMissingColumnsModal(true);
      }
    };

    const handleDeleteView = (viewId) => {
      const updatedViews = currentSavedViews.filter((v) => v.id !== viewId);

      if (onSavedViewsChange) {
        onSavedViewsChange(updatedViews, activeBoardId);
      }

      // v152: Clear active view if deleted
      if (viewId === activeViewId) {
        setActiveViewId(null);
        setActiveViewName('');
        setActiveViewConfig(null);
      }
    };

    const handleRenameView = (viewId, newName) => {
      if (!newName.trim()) return;

      const updatedViews = currentSavedViews.map((v) => (v.id === viewId ? { ...v, name: newName.trim() } : v));

      if (onSavedViewsChange) {
        onSavedViewsChange(updatedViews, activeBoardId);
      }

      // v152: Update active view name if renamed
      if (viewId === activeViewId) {
        setActiveViewName(newName.trim());
      }

      setEditingViewId(null);
      setEditingViewName('');
    };

    // v149: Helper to count filters for display
    const countFilters = (filters) => {
      if (!filters) return 0;
      return Object.keys(filters).length;
    };

    // v134: Close Load dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = (e) => {
        if (loadDropdownRef.current && !loadDropdownRef.current.contains(e.target)) {
          setShowLoadDropdown(false);
        }
      };

      if (showLoadDropdown) {
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }
    }, [showLoadDropdown]);

    // v127: Get available filter options for a column from tickets in scope
    const getFilterOptionsForColumn = useCallback(
      (columnId) => {
        const colDef = getColumnDefinition(columnId);
        const filterType = getFilterTypeForField(colDef);

        // v176a: Customer field options from globalCRM and crmConfig
        if (columnId === 'client') {
          // Return list of customers from globalCRM
          return (company?.globalCRM || [])
            .map((c) => ({ value: c.id, label: c.companyName }))
            .sort((a, b) => a.label.localeCompare(b.label));
        }

        if (columnId === 'client.stage') {
          // Return lifecycle stages from crmConfig
          return (company?.crmConfig?.lifecycleStages || [])
            .map((s) => ({ value: s.id, label: s.name }))
            .sort((a, b) => (a.order || 0) - (b.order || 0)); // Keep original order
        }

        if (columnId === 'client.accountOwnerId') {
          // Return staff (same as assignee)
          return (company?.globalStaff || [])
            .map((s) => ({ value: s.id, label: s.name }))
            .sort((a, b) => a.label.localeCompare(b.label));
        }

        if (columnId === 'client.territory' || columnId === 'client.industry' || columnId === 'client.companySize') {
          // Derive unique values from globalCRM
          const field = columnId.replace('client.', '');
          const uniqueValues = new Set();
          (company?.globalCRM || []).forEach((customer) => {
            const value = customer[field];
            if (value !== null && value !== undefined && value !== '') {
              uniqueValues.add(value);
            }
          });
          return Array.from(uniqueValues)
            .map((v) => ({ value: v, label: v }))
            .sort((a, b) => a.label.localeCompare(b.label));
        }

        // For select fields with predefined options, use those
        if (colDef?.options && Array.isArray(colDef.options)) {
          return colDef.options
            .map((opt) => ({ value: opt, label: opt }))
            .sort((a, b) => a.label.localeCompare(b.label));
        }

        // For status, get from company statuses
        if (columnId === '_status') {
          return (company?.statuses || [])
            .map((s) => ({ value: s.id, label: s.label }))
            .sort((a, b) => a.label.localeCompare(b.label));
        }

        // For type, get from ticket types
        if (columnId === '_type') {
          return (company?.globalTicketTypes || [])
            .map((t) => ({ value: t.id, label: t.name }))
            .sort((a, b) => a.label.localeCompare(b.label));
        }

        // For user fields, get from staff
        // v136: Add "Assigned to Me" at the top for assignee field
        if (
          filterType === 'multiselect' &&
          (colDef?.type === 'user' || colDef?.type === 'system-user' || columnId === 'assignee')
        ) {
          const staffOptions = (company?.globalStaff || [])
            .map((s) => ({ value: s.id, label: s.name }))
            .sort((a, b) => a.label.localeCompare(b.label));

          // Add "Assigned to Me" at top for assignee column
          if (columnId === 'assignee' && currentUser) {
            return [{ value: ASSIGNED_TO_ME, label: '★ Assigned to Me' }, ...staffOptions];
          }
          return staffOptions;
        }

        // For priority field
        if (columnId === 'priority') {
          return PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }));
        }

        // For other fields, derive unique values from tickets in scope
        const uniqueValues = new Set();
        filteredByScope.forEach((ticket) => {
          const value = getFilterValue(ticket, columnId);
          if (value !== null && value !== undefined && value !== '') {
            if (Array.isArray(value)) {
              value.forEach((v) => uniqueValues.add(v));
            } else {
              uniqueValues.add(value);
            }
          }
        });

        // Convert to options and sort alphabetically
        return Array.from(uniqueValues)
          .map((v) => {
            // Get display label for the value
            let label = v;
            if (columnId === '_board') label = getBoardName(v);
            else if (columnId === '_workCentre') label = getWorkCentreName(v);
            else if (columnId === '_workUnit') label = getWorkUnitName(v);
            else if (columnId === '_zone') label = getZoneName(v);
            return { value: v, label: String(label) };
          })
          .sort((a, b) => a.label.localeCompare(b.label));
      },
      [filteredByScope, company, currentUser, getColumnDefinition, getFilterTypeForField, getFilterValue]
    );

    // v153b: Get grouped filter options for hierarchical dropdowns (Board, Work Unit)
    const getGroupedFilterOptions = useCallback(
      (columnId) => {
        const colDef = getColumnDefinition(columnId);
        const filterType = getFilterTypeForField(colDef);

        // Collect unique values from tickets in scope
        const uniqueValues = new Set();
        filteredByScope.forEach((ticket) => {
          const value = getFilterValue(ticket, columnId);
          if (value !== null && value !== undefined && value !== '') {
            uniqueValues.add(value);
          }
        });

        if (filterType === 'grouped-board') {
          // Group boards by Work Centre
          const groups = [];

          // Scope-based simplification
          if (scope === 'board') {
            // Single board scope - show flat list (shouldn't really happen, but handle it)
            return {
              type: 'flat',
              options: Array.from(uniqueValues)
                .map((v) => ({
                  value: v,
                  label: getBoardName(v),
                }))
                .sort((a, b) => a.label.localeCompare(b.label)),
            };
          }

          if (scope === 'opCentre' && activeOpCentreId) {
            // Single Work Centre scope - show flat list of boards
            const wc = opCentres?.find((oc) => oc.id === activeOpCentreId);
            if (wc) {
              const boardsInScope = (wc.processBoards || [])
                .filter((b) => uniqueValues.has(b.id))
                .map((b) => ({ value: b.id, label: b.name }))
                .sort((a, b) => a.label.localeCompare(b.label));
              return {
                type: 'flat',
                options: boardsInScope,
              };
            }
          }

          // All Work Centres scope - group by WC
          (opCentres || []).forEach((wc) => {
            const boardsInWc = (wc.processBoards || [])
              .filter((b) => uniqueValues.has(b.id))
              .map((b) => ({ value: b.id, label: b.name }))
              .sort((a, b) => a.label.localeCompare(b.label));

            if (boardsInWc.length > 0) {
              groups.push({
                id: wc.id,
                label: wc.name,
                items: boardsInWc,
              });
            }
          });

          return {
            type: 'grouped',
            groups: groups.sort((a, b) => a.label.localeCompare(b.label)),
          };
        }

        if (filterType === 'grouped-workunit') {
          // Group work units by Work Centre → Board

          // Build a map of workUnitId → { wcId, wcName, boardId, boardName }
          const workUnitInfo = {};
          (company?.workUnits || []).forEach((wu) => {
            if (!uniqueValues.has(wu.id)) return;

            // Find the board and WC for this work unit
            for (const wc of opCentres || []) {
              const board = wc.processBoards?.find((b) => b.id === wu.boardId);
              if (board) {
                workUnitInfo[wu.id] = {
                  wcId: wc.id,
                  wcName: wc.name,
                  boardId: board.id,
                  boardName: board.name,
                  wuId: wu.id,
                  wuName: wu.name,
                };
                break;
              }
            }
          });

          // Scope-based simplification
          if (scope === 'board' && activeBoardId) {
            // Single board scope - show flat list of work units
            const workUnitsInScope = Object.values(workUnitInfo)
              .filter((info) => info.boardId === activeBoardId)
              .map((info) => ({ value: info.wuId, label: info.wuName }))
              .sort((a, b) => a.label.localeCompare(b.label));
            return {
              type: 'flat',
              options: workUnitsInScope,
            };
          }

          if (scope === 'opCentre' && activeOpCentreId) {
            // Single Work Centre scope - group by Board only
            const boardGroups = {};
            Object.values(workUnitInfo)
              .filter((info) => info.wcId === activeOpCentreId)
              .forEach((info) => {
                if (!boardGroups[info.boardId]) {
                  boardGroups[info.boardId] = {
                    id: info.boardId,
                    label: info.boardName,
                    items: [],
                  };
                }
                boardGroups[info.boardId].items.push({
                  value: info.wuId,
                  label: info.wuName,
                });
              });

            // Sort items within each group
            Object.values(boardGroups).forEach((group) => {
              group.items.sort((a, b) => a.label.localeCompare(b.label));
            });

            return {
              type: 'grouped',
              groups: Object.values(boardGroups).sort((a, b) => a.label.localeCompare(b.label)),
            };
          }

          // All Work Centres scope - nested grouping (WC → Board → Work Units)
          // For simplicity, we'll use a two-level display: WC header, then Board subheaders
          const wcGroups = {};
          Object.values(workUnitInfo).forEach((info) => {
            if (!wcGroups[info.wcId]) {
              wcGroups[info.wcId] = {
                id: info.wcId,
                label: info.wcName,
                boards: {},
              };
            }
            if (!wcGroups[info.wcId].boards[info.boardId]) {
              wcGroups[info.wcId].boards[info.boardId] = {
                id: info.boardId,
                label: info.boardName,
                items: [],
              };
            }
            wcGroups[info.wcId].boards[info.boardId].items.push({
              value: info.wuId,
              label: info.wuName,
            });
          });

          // Convert to array structure and sort
          const nestedGroups = Object.values(wcGroups)
            .map((wc) => ({
              id: wc.id,
              label: wc.label,
              subgroups: Object.values(wc.boards)
                .map((board) => {
                  board.items.sort((a, b) => a.label.localeCompare(b.label));
                  return board;
                })
                .sort((a, b) => a.label.localeCompare(b.label)),
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

          return {
            type: 'nested',
            groups: nestedGroups,
          };
        }

        // Fallback to flat options
        return {
          type: 'flat',
          options: Array.from(uniqueValues)
            .map((v) => ({ value: v, label: String(v) }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        };
      },
      [
        filteredByScope,
        company,
        opCentres,
        scope,
        activeOpCentreId,
        activeBoardId,
        getColumnDefinition,
        getFilterTypeForField,
        getFilterValue,
        getBoardName,
      ]
    );

    // v127: Close filter dropdown when clicking outside
    // v148: BUG-147-001 - Set ref flag so row click knows to ignore
    // v158: BUG-158-001 FIX - Clear ref in cleanup, not click handler (listener was being removed before click fired)
    useEffect(() => {
      const handleClickOutside = (event) => {
        if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target)) {
          dropdownJustClosedRef.current = true;
          setFilterDropdownColumn(null);
        }
      };

      if (filterDropdownColumn) {
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
          document.removeEventListener('mousedown', handleClickOutside);
          // v158: Clear flag in cleanup after current event cycle completes
          // This ensures the flag blocks the current click but is cleared for future clicks
          setTimeout(() => {
            dropdownJustClosedRef.current = false;
          }, 0);
        };
      }
    }, [filterDropdownColumn]);

    // v127: Toggle multi-select filter value
    const handleToggleFilterValue = (columnId, value) => {
      const currentFilter = activeFilters[columnId] || [];
      const currentArray = Array.isArray(currentFilter) ? currentFilter : [];

      let newFilter;
      if (currentArray.includes(value)) {
        newFilter = currentArray.filter((v) => v !== value);
      } else {
        newFilter = [...currentArray, value];
      }

      handleFilterChange(columnId, newFilter);
    };

    // v153b: Toggle all values in a group (for grouped filter dropdowns)
    const handleToggleGroupFilter = (columnId, groupValues, isCurrentlyAllSelected) => {
      const currentFilter = activeFilters[columnId] || [];
      const currentArray = Array.isArray(currentFilter) ? currentFilter : [];

      let newFilter;
      if (isCurrentlyAllSelected) {
        // Remove all group values
        newFilter = currentArray.filter((v) => !groupValues.includes(v));
      } else {
        // Add all group values that aren't already selected
        const newValues = groupValues.filter((v) => !currentArray.includes(v));
        newFilter = [...currentArray, ...newValues];
      }

      handleFilterChange(columnId, newFilter);
    };

    // v154b: Handle multi-condition text filter change
    // Always outputs multi-condition format: { mode, conditions }
    const handleTextFilterApply = (columnId, mode, conditions) => {
      // Filter out empty/invalid conditions
      const validConditions = conditions.filter((cond) => {
        // is-empty and is-not-empty don't need values
        if (cond.op === 'is-empty' || cond.op === 'is-not-empty') return true;
        // Other operators need non-empty values
        return cond.value && cond.value.trim() !== '';
      });

      if (validConditions.length === 0) {
        handleFilterChange(columnId, null);
      } else {
        handleFilterChange(columnId, { mode, conditions: validConditions });
      }
    };

    // Selection handlers
    const handleSelectAll = () => {
      if (selectedTickets.size === sortedTickets.length) {
        onSelectedTicketsChange(new Set());
      } else {
        onSelectedTicketsChange(new Set(sortedTickets.map((t) => t.id)));
      }
    };

    const handleSelectTicket = (ticketId, index, shiftKey) => {
      const newSelected = new Set(selectedTickets);

      if (shiftKey && lastClickedIndex !== null && lastClickedIndex !== index) {
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);

        for (let i = start; i <= end; i++) {
          if (sortedTickets[i]) {
            newSelected.add(sortedTickets[i].id);
          }
        }
      } else {
        if (newSelected.has(ticketId)) {
          newSelected.delete(ticketId);
        } else {
          newSelected.add(ticketId);
        }
      }

      setLastClickedIndex(index);
      onSelectedTicketsChange(newSelected);
    };

    // Bulk actions
    const handleBulkDelete = () => {
      const ticketIds = Array.from(selectedTickets);
      onBulkDeleteTickets?.(ticketIds);
      onSelectedTicketsChange(new Set());
      setShowDeleteConfirm(false);
      setDeleteConfirmText('');
    };

    const handleCopyIds = () => {
      const ids = Array.from(selectedTickets).join(', ');
      navigator.clipboard?.writeText(ids);
    };

    const handleOpenBulkEdit = () => {
      setBulkEditValues({
        status: KEEP_AS_IS,
        boardId: KEEP_AS_IS,
        zoneId: KEEP_AS_IS,
        column: KEEP_AS_IS,
        workUnitId: KEEP_AS_IS,
        assignee: KEEP_AS_IS,
        priority: KEEP_AS_IS,
      });
      setShowBulkEditPanel(true);
    };

    const handleApplyBulkEdit = () => {
      const changes = {};

      if (bulkEditValues.status !== KEEP_AS_IS) {
        changes.status = bulkEditValues.status;
      }
      if (bulkEditValues.boardId !== KEEP_AS_IS) {
        changes.boardId = bulkEditValues.boardId;
        changes.opCentreId = bulkEditValues.opCentreId;
      }
      if (bulkEditValues.zoneId !== KEEP_AS_IS) {
        changes.zoneId = bulkEditValues.zoneId;
        changes.sectionId = bulkEditValues.zoneId;
      }
      if (bulkEditValues.column !== KEEP_AS_IS) {
        changes.column = bulkEditValues.column;
      }
      if (bulkEditValues.workUnitId !== KEEP_AS_IS) {
        changes.workUnitId = bulkEditValues.workUnitId === '' ? null : bulkEditValues.workUnitId;
      }
      if (bulkEditValues.assignee !== KEEP_AS_IS) {
        changes.assignee = bulkEditValues.assignee === '' ? null : bulkEditValues.assignee;
      }
      if (bulkEditValues.priority !== KEEP_AS_IS) {
        changes.priority = bulkEditValues.priority;
      }

      if (Object.keys(changes).length > 0) {
        onBulkUpdateTickets?.(Array.from(selectedTickets), changes);
      }

      setShowBulkEditPanel(false);
      onSelectedTicketsChange(new Set());
    };

    const handleBulkEditBoardChange = (boardId) => {
      if (boardId === KEEP_AS_IS) {
        setBulkEditValues((prev) => ({
          ...prev,
          boardId: KEEP_AS_IS,
          opCentreId: undefined,
          zoneId: KEEP_AS_IS,
          column: KEEP_AS_IS,
        }));
        return;
      }

      let targetOpCentre = null;
      let targetBoard = null;
      for (const oc of opCentres || []) {
        const board = oc.processBoards?.find((b) => b.id === boardId);
        if (board) {
          targetOpCentre = oc;
          targetBoard = board;
          break;
        }
      }

      const defaultZone = targetBoard?.defaultZone;
      const defaultStage = targetBoard?.defaultStage;

      setBulkEditValues((prev) => ({
        ...prev,
        boardId: boardId,
        opCentreId: targetOpCentre?.id,
        zoneId: defaultZone || KEEP_AS_IS,
        column: defaultStage || KEEP_AS_IS,
      }));
    };

    const handleBulkEditZoneChange = (zoneId) => {
      if (zoneId === KEEP_AS_IS) {
        setBulkEditValues((prev) => ({
          ...prev,
          zoneId: KEEP_AS_IS,
          column: KEEP_AS_IS,
        }));
        return;
      }

      const board = getBoardForBulkEdit();
      const zone = board?.workZones?.find((z) => z.id === zoneId);
      const firstStage = zone?.workStages?.[0];
      const stageName = typeof firstStage === 'string' ? firstStage : firstStage?.name;

      setBulkEditValues((prev) => ({
        ...prev,
        zoneId: zoneId,
        column: stageName || KEEP_AS_IS,
      }));
    };

    const getBoardForBulkEdit = () => {
      if (bulkEditValues.boardId === KEEP_AS_IS) return null;
      for (const oc of opCentres || []) {
        const board = oc.processBoards?.find((b) => b.id === bulkEditValues.boardId);
        if (board) return board;
      }
      return null;
    };

    const getAllBoards = useMemo(() => {
      const boards = [];
      for (const oc of opCentres || []) {
        for (const board of oc.processBoards || []) {
          boards.push({
            ...board,
            opCentreId: oc.id,
            opCentreName: oc.name,
          });
        }
      }
      return boards;
    }, [opCentres]);

    const getWorkUnitsForBulkEdit = useMemo(() => {
      const boardId = bulkEditValues.boardId === KEEP_AS_IS ? null : bulkEditValues.boardId;
      if (!boardId) {
        return company?.workUnits || [];
      }
      return (company?.workUnits || []).filter((wu) => wu.boardId === boardId);
    }, [bulkEditValues.boardId, company?.workUnits]);

    // Row click handler
    const handleRowClick = (ticket, e) => {
      // v148: BUG-147-001 FIX - Don't open ticket if dropdown was just dismissed
      if (dropdownJustClosedRef.current) return;
      if (e.target.type === 'checkbox' || e.target.classList.contains('resize-handle')) return;
      onEditTicket?.(ticket);
    };

    // Column resize handlers
    const handleResizeStart = useCallback(
      (e, column) => {
        e.preventDefault();
        e.stopPropagation();
        setResizingColumn(column);
        setResizeStartX(e.clientX);
        setResizeStartWidth(columnWidths[column] || 120);
      },
      [columnWidths]
    );

    const handleResizeMove = useCallback(
      (e) => {
        if (!resizingColumn) return;

        const colDef = getColumnDefinition(resizingColumn);
        const minWidth = colDef?.minWidth || 80;

        const diff = e.clientX - resizeStartX;
        const newWidth = Math.max(minWidth, resizeStartWidth + diff);

        setColumnWidths((prev) => ({
          ...prev,
          [resizingColumn]: newWidth,
        }));
      },
      [resizingColumn, resizeStartX, resizeStartWidth]
    );

    const handleResizeEnd = useCallback(() => {
      if (resizingColumn && scope === 'board' && onViewConfigChange) {
        onViewConfigChange({
          ...viewConfig,
          columnWidths: { ...columnWidths },
        });
      }
      setResizingColumn(null);
    }, [resizingColumn, columnWidths, scope, viewConfig, onViewConfigChange]);

    // Resize event listeners
    useEffect(() => {
      if (resizingColumn) {
        document.addEventListener('mousemove', handleResizeMove);
        document.addEventListener('mouseup', handleResizeEnd);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }

      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }, [resizingColumn, handleResizeMove, handleResizeEnd]);

    // Maintain focus on column search
    useEffect(() => {
      if (showColumnPicker && columnSearchTerm && columnSearchRef.current) {
        columnSearchRef.current.focus();
      }
    }, [columnSearchTerm, showColumnPicker]);

    // v125 BUG-124-002: Auto-add mandatory columns when scope changes
    // v126 BUG-125-001: Also auto-remove when scope narrows
    useEffect(() => {
      let columnsToAdd = [];
      let columnsToRemove = [];

      if (scope === 'all') {
        // Need both _workCentre and _board
        if (!visibleColumns.includes('_workCentre')) columnsToAdd.push('_workCentre');
        if (!visibleColumns.includes('_board')) columnsToAdd.push('_board');
      } else if (scope === 'workcentre') {
        // Need _board, remove _workCentre
        if (!visibleColumns.includes('_board')) columnsToAdd.push('_board');
        if (visibleColumns.includes('_workCentre')) columnsToRemove.push('_workCentre');
      } else if (scope === 'board') {
        // Remove both location columns
        if (visibleColumns.includes('_workCentre')) columnsToRemove.push('_workCentre');
        if (visibleColumns.includes('_board')) columnsToRemove.push('_board');
      }

      if (columnsToAdd.length > 0 || columnsToRemove.length > 0) {
        let newColumns = [...visibleColumns];

        // Remove columns first
        if (columnsToRemove.length > 0) {
          newColumns = newColumns.filter((col) => !columnsToRemove.includes(col));
        }

        // Then add columns (insert after _status)
        if (columnsToAdd.length > 0) {
          const statusIndex = newColumns.indexOf('_status');
          const insertAt = statusIndex !== -1 ? statusIndex + 1 : 4;
          newColumns.splice(insertAt, 0, ...columnsToAdd);
        }

        setLocalColumns(newColumns);
      }
    }, [scope]); // Only run when scope changes

    // v122: Column drag-and-drop handlers
    // v124: Cross-browser fix - set dataTransfer FIRST, defer state updates (Firefox compatibility)
    const handleColumnDragStart = (e, columnId, source) => {
      // Set dataTransfer FIRST (required for Firefox)
      e.dataTransfer.setData('text/plain', columnId);
      e.dataTransfer.effectAllowed = 'move';

      // Defer state updates (helps Firefox)
      setTimeout(() => {
        setDraggedColumn(columnId);
        setDragSource(source);
      }, 0);
    };

    const handleColumnDragOver = (e, columnId) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move'; // v124: Explicit dropEffect for Firefox
      if (draggedColumn && draggedColumn !== columnId) {
        setDragOverColumn(columnId);
      }
    };

    const handleColumnDragLeave = () => {
      setDragOverColumn(null);
    };

    const handleColumnDrop = (e, targetColumnId) => {
      e.preventDefault();

      // v124: Get columnId from dataTransfer as fallback (cross-browser)
      const sourceColumnId = draggedColumn || e.dataTransfer.getData('text/plain');

      if (!sourceColumnId || sourceColumnId === targetColumnId) {
        setDraggedColumn(null);
        setDragOverColumn(null);
        setDragSource(null);
        return;
      }

      const fromIndex = visibleColumns.indexOf(sourceColumnId);
      const toIndex = visibleColumns.indexOf(targetColumnId);

      if (fromIndex === -1 || toIndex === -1) {
        setDraggedColumn(null);
        setDragOverColumn(null);
        setDragSource(null);
        return;
      }

      const newColumns = [...visibleColumns];
      newColumns.splice(fromIndex, 1);
      newColumns.splice(toIndex, 0, sourceColumnId);

      setLocalColumns(newColumns);

      if (scope === 'board' && onViewConfigChange) {
        onViewConfigChange({
          ...viewConfig,
          columns: newColumns,
        });
      }

      setDraggedColumn(null);
      setDragOverColumn(null);
      setDragSource(null);
    };

    const handleColumnDragEnd = () => {
      setDraggedColumn(null);
      setDragOverColumn(null);
      setDragSource(null);
    };

    // Column toggle
    // v123: Check if column is locked (scope-based + system)
    const checkColumnLocked = (columnId) => {
      const colDef = getColumnDefinition(columnId);
      if (colDef?.locked) return true;

      // Scope-based locking
      if (scope === 'all') {
        if (columnId === '_board' || columnId === '_workCentre') return true;
      } else if (scope === 'workcentre') {
        if (columnId === '_board') return true;
      }

      return false;
    };

    const handleToggleColumn = (columnId) => {
      if (checkColumnLocked(columnId)) return;

      let newColumns;
      if (visibleColumns.includes(columnId)) {
        newColumns = visibleColumns.filter((id) => id !== columnId);
      } else {
        newColumns = [...visibleColumns, columnId];
      }

      setLocalColumns(newColumns);

      if (scope === 'board' && onViewConfigChange) {
        onViewConfigChange({
          ...viewConfig,
          columns: newColumns,
        });
      }
    };

    // v122: Reset to smart defaults
    // v126: No longer closes modal (BUG-125-002)
    const handleResetView = () => {
      const smartDefaults = getSmartDefaultColumns();

      const defaultWidths = {};
      smartDefaults.forEach((colId) => {
        const sysCol = SYSTEM_COLUMNS[colId];
        defaultWidths[colId] = sysCol?.defaultWidth || 120;
      });

      setLocalColumns(smartDefaults);
      setColumnWidths(defaultWidths);
      setSortColumn('_updated');
      setSortDirection('desc');

      if (scope === 'board' && onViewConfigChange) {
        onViewConfigChange({
          columns: smartDefaults,
          columnWidths: defaultWidths,
          sortColumn: '_updated',
          sortDirection: 'desc',
        });
      }
      // v126: Modal stays open so user can make further adjustments
    };

    // v152 UX-152-002: Compute fields configured on ticket types in current scope
    // This filters Available Fields to only show relevant fields
    const fieldsInScope = useMemo(() => {
      const fieldIds = new Set();

      // Get boards in scope
      let boardsInScope = [];
      if (scope === 'board' && currentBoard) {
        boardsInScope = [currentBoard];
      } else if (scope === 'workcentre' && currentOpCentre?.processBoards) {
        boardsInScope = currentOpCentre.processBoards;
      } else if (scope === 'all') {
        boardsInScope = opCentres?.flatMap((oc) => oc.processBoards || []) || [];
      }

      // Get all allowed ticket types from those boards
      const allowedTypeIds = new Set();
      boardsInScope.forEach((board) => {
        (board.allowedTicketTypes || []).forEach((typeId) => allowedTypeIds.add(typeId));
      });

      // Get fields from those ticket types
      const globalTicketTypes = company?.globalTicketTypes || [];
      globalTicketTypes
        .filter((tt) => allowedTypeIds.has(tt.id))
        .forEach((tt) => {
          (tt.fields || []).forEach((fieldId) => fieldIds.add(fieldId));
        });

      // Also add any board-level additional fields
      boardsInScope.forEach((board) => {
        if (board.fieldOverrides) {
          Object.values(board.fieldOverrides).forEach((overrides) => {
            (overrides._additionalFields || []).forEach((fieldId) => fieldIds.add(fieldId));
          });
        }
      });

      return fieldIds;
    }, [scope, currentBoard, currentOpCentre, opCentres, company?.globalTicketTypes]);

    // v155 Progressive Disclosure: Check if any boards in scope have work units enabled
    // Used to hide zone-related columns and filters when only simple boards in scope
    const hasWorkUnitBoardsInScope = useMemo(() => {
      let boardsInScope = [];
      if (scope === 'board' && currentBoard) {
        boardsInScope = [currentBoard];
      } else if (scope === 'workcentre' && currentOpCentre?.processBoards) {
        boardsInScope = currentOpCentre.processBoards;
      } else if (scope === 'all') {
        boardsInScope = opCentres?.flatMap((oc) => oc.processBoards || []) || [];
      }

      return boardsInScope.some((board) => board.workUnitSeries?.enabled);
    }, [scope, currentBoard, currentOpCentre, opCentres]);

    // v155 Progressive Disclosure: Helper to check if a ticket's board is a simple board
    const isTicketOnSimpleBoard = (ticket) => {
      if (!ticket?.boardId) return true;

      // Find the board
      for (const oc of opCentres || []) {
        const board = oc.processBoards?.find((b) => b.id === ticket.boardId);
        if (board) {
          return !board.workUnitSeries?.enabled;
        }
      }
      return true; // Default to simple if board not found
    };

    // v152 UX-152-003: Compute fields that have data in current filtered tickets
    // Used to highlight available columns that would show data if selected
    const fieldsWithData = useMemo(() => {
      const fieldIds = new Set();
      const FIELD_LIBRARY_NORMALIZED = window.FIELD_LIBRARY_NORMALIZED || {};

      // Check all non-system fields across filtered tickets
      filteredByActiveFilters.forEach((ticket) => {
        Object.keys(ticket).forEach((key) => {
          // Skip system/internal fields
          if (
            key.startsWith('_') ||
            [
              'id',
              'createdAt',
              'updatedAt',
              'boardId',
              'opCentreId',
              'typeId',
              'sectionId',
              'zoneId',
              'column',
              'workUnitId',
            ].includes(key)
          ) {
            return;
          }
          // Only count if field has a value
          const value = ticket[key];
          if (value !== null && value !== undefined && value !== '') {
            fieldIds.add(key);
          }
        });
      });

      return fieldIds;
    }, [filteredByActiveFilters]);

    // Available fields for column picker
    // v152 UX-152-002: Available fields filtered by scope
    // Only shows fields configured on ticket types in current scope
    const getAvailableFields = useMemo(() => {
      const FIELD_LIBRARY_NORMALIZED = window.FIELD_LIBRARY_NORMALIZED || {};
      const FIELD_LIBRARY_CATEGORIES = window.FIELD_LIBRARY_CATEGORIES || {};

      // v153 BUG-152-002 FIX: System fields with dynamic label for _workUnit
      // v155: Add availability flags for zone/workUnit columns
      const systemFields = Object.values(SYSTEM_COLUMNS)
        .filter((col) => {
          if (columnSearchTerm) {
            // For _workUnit, check against dynamic label too
            const label = col.id === '_workUnit' ? getWorkUnitLabel() : col.label;
            return label.toLowerCase().includes(columnSearchTerm.toLowerCase());
          }
          return true;
        })
        .map((col) => {
          // v153: Apply dynamic label for _workUnit
          // v155: Add availability flag for zone/workUnit columns
          const result = { ...col };

          if (col.id === '_workUnit') {
            result.label = getWorkUnitLabel();
            // v155: Mark as unavailable when no work unit boards in scope
            if (!hasWorkUnitBoardsInScope) {
              result.unavailable = true;
              result.unavailableHint = 'No work unit boards in current scope';
            }
          }

          if (col.id === '_zone') {
            // v155: Mark as unavailable when no work unit boards in scope
            if (!hasWorkUnitBoardsInScope) {
              result.unavailable = true;
              result.unavailableHint = 'No work unit boards in current scope';
            }
          }

          return result;
        });

      const fieldsByCategory = {};
      Object.entries(FIELD_LIBRARY_CATEGORIES).forEach(([catId, catName]) => {
        fieldsByCategory[catId] = {
          name: catName,
          fields: [],
        };
      });

      Object.entries(FIELD_LIBRARY_NORMALIZED).forEach(([fieldId, field]) => {
        // v123: Skip fields that have system column equivalents
        if (SYSTEM_COLUMNS['_' + fieldId]) return;

        // v123: Skip duplicate fields
        if (FIELD_DUPLICATES.includes(fieldId)) return;

        // v152 UX-152-002: Skip fields not configured in current scope
        if (!fieldsInScope.has(fieldId)) return;

        if (columnSearchTerm) {
          const label = field.label || field.name || fieldId;
          if (!label.toLowerCase().includes(columnSearchTerm.toLowerCase())) {
            return;
          }
        }

        const category = field.category || 'Common';
        if (fieldsByCategory[category]) {
          fieldsByCategory[category].fields.push({
            id: fieldId,
            label: field.label || field.name,
            type: field.type,
            hasData: fieldsWithData.has(fieldId), // v152 UX-152-003
          });
        }
      });

      // v152 UX-152-002: Also filter custom fields by scope
      const customFields = (company?.customFields || [])
        .filter((field) => {
          // Only show if configured in scope
          if (!fieldsInScope.has(field.id)) return false;

          if (columnSearchTerm) {
            const label = field.label || field.name || field.id;
            return label.toLowerCase().includes(columnSearchTerm.toLowerCase());
          }
          return true;
        })
        .map((field) => ({
          id: field.id,
          label: field.label || field.name,
          type: field.type,
          hasData: fieldsWithData.has(field.id), // v152 UX-152-003
        }));

      return {
        system: systemFields,
        byCategory: fieldsByCategory,
        custom: customFields,
      };
    }, [
      company?.customFields,
      columnSearchTerm,
      fieldsInScope,
      fieldsWithData,
      scope,
      currentBoard,
      currentOpCentre,
      hasWorkUnitBoardsInScope,
    ]);

    // v123: Sortable + Resizable + Draggable column header with grip indicator
    // v127: Added asterisk indicator for filtered columns + dropdown trigger
    // v128: Separated drag zone, larger asterisk
    // v129: Fixed asterisk size (text-sm) and grip visibility (bg-gray-100)
    // v130: Asterisk text-base, visible grip icon, setDragImage for ghost
    // v131: Grip only visible on column hover
    // v132: Drag uses colDef.locked (not checkColumnLocked) - board/WC now draggable
    const SortHeader = ({ columnId, index }) => {
      const colDef = getColumnDefinition(columnId);
      if (!colDef) return null;

      const width = columnWidths[columnId] || colDef.defaultWidth || 120;
      const minWidth = colDef.minWidth || 80;
      const isDragOver = dragOverColumn === columnId && dragSource === 'table';
      const isFiltered = hasActiveFilter(columnId);
      const isDropdownOpen = filterDropdownColumn === columnId;
      const thRef = useRef(null);

      // v127: Toggle dropdown instead of direct sort
      const handleHeaderClick = (e) => {
        e.stopPropagation();
        if (isDropdownOpen) {
          setFilterDropdownColumn(null);
        } else {
          setFilterDropdownColumn(columnId);
        }
      };

      // v130: Custom drag start with full th as ghost image
      const handleDragStart = (e) => {
        if (thRef.current) {
          e.dataTransfer.setDragImage(thRef.current, 20, 20);
        }
        handleColumnDragStart(e, columnId, 'table');
      };

      return (
        <th
          ref={thRef}
          className={`text-left text-xs font-medium text-gray-500 uppercase tracking-wider select-none relative group ${isDragOver ? 'bg-indigo-100' : ''} ${isDropdownOpen ? 'bg-indigo-100 ring-2 ring-indigo-400 ring-inset' : ''}`}
          style={{ width, minWidth, maxWidth: width }}
          onDragOver={(e) => handleColumnDragOver(e, columnId)}
          onDragLeave={handleColumnDragLeave}
          onDrop={(e) => handleColumnDrop(e, columnId)}
        >
          <div className="flex items-center">
            {/* v128: Main clickable area for dropdown */}
            <div
              className={`flex-1 px-3 py-3 cursor-pointer hover:bg-gray-100 flex items-center gap-1 ${isDropdownOpen ? 'bg-gray-100' : ''}`}
              onClick={handleHeaderClick}
            >
              {colDef.label}
              {/* v130: Asterisk text-base to match uppercase header visual height */}
              {isFiltered && <span className="text-indigo-600 text-base font-bold leading-none">*</span>}
              {/* v127: Always show chevron to indicate clickable */}
              {sortColumn === columnId
                ? sortDirection === 'asc'
                  ? ChevronUp && <ChevronUp size={14} />
                  : ChevronDown && <ChevronDown size={14} />
                : ChevronDown && <ChevronDown size={14} className="opacity-50" />}
            </div>
            {/* v132: Drag zone - only truly locked columns (like _key) can't be dragged
                Scope-based locking (board/workcentre at global scope) only prevents removal, not reordering */}
            {!colDef?.locked && (
              <div
                className="px-2 py-3 cursor-grab hover:bg-gray-200 border-l border-gray-300 flex items-center opacity-0 group-hover:opacity-100 transition-opacity"
                draggable
                onDragStart={handleDragStart}
                onDragEnd={handleColumnDragEnd}
                title="Drag to reorder"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-gray-500"
                >
                  <circle cx="9" cy="5" r="1.5" fill="currentColor" />
                  <circle cx="15" cy="5" r="1.5" fill="currentColor" />
                  <circle cx="9" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="15" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="9" cy="19" r="1.5" fill="currentColor" />
                  <circle cx="15" cy="19" r="1.5" fill="currentColor" />
                </svg>
              </div>
            )}
          </div>
          {/* Resize handle */}
          <div
            className="resize-handle absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-indigo-400 active:bg-indigo-600"
            onMouseDown={(e) => handleResizeStart(e, columnId)}
          />
          {/* v127: Filter dropdown */}
          {isDropdownOpen && <ColumnFilterDropdown columnId={columnId} colDef={colDef} />}
        </th>
      );
    };

    // v153b: Grouped filter section for Board and Work Unit dropdowns
    const GroupedFilterSection = ({ columnId, filterType, selectedValues, onToggle, onToggleGroup }) => {
      const groupedOptions = getGroupedFilterOptions(columnId);
      const [collapsedGroups, setCollapsedGroups] = useState({});

      const toggleCollapse = (groupId) => {
        setCollapsedGroups((prev) => ({
          ...prev,
          [groupId]: !prev[groupId],
        }));
      };

      // Helper to check if all items in a group are selected
      const getGroupSelectionState = (items) => {
        const selectedCount = items.filter((item) => selectedValues.includes(item.value)).length;
        if (selectedCount === 0) return 'none';
        if (selectedCount === items.length) return 'all';
        return 'some';
      };

      // Render a group header with checkbox
      const GroupHeader = ({ group, level = 0, items }) => {
        const isCollapsed = collapsedGroups[group.id];
        const selectionState = getGroupSelectionState(items);
        const allValues = items.map((i) => i.value);

        return (
          <div
            className={`flex items-center gap-1 px-2 py-1.5 bg-gray-100 border-b border-indigo-100 cursor-pointer hover:bg-gray-200 ${level > 0 ? 'ml-4 bg-gray-50' : ''}`}
            onClick={() => toggleCollapse(group.id)}
          >
            {/* Expand/collapse icon */}
            <span className="text-gray-500 w-4 flex-shrink-0">
              {isCollapsed ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </span>
            {/* Group checkbox */}
            <input
              type="checkbox"
              checked={selectionState === 'all'}
              ref={(el) => {
                if (el) el.indeterminate = selectionState === 'some';
              }}
              onChange={(e) => {
                e.stopPropagation();
                onToggleGroup(columnId, allValues, selectionState === 'all');
              }}
              onClick={(e) => e.stopPropagation()}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-xs font-medium text-gray-700 truncate flex-1">{group.label}</span>
            <span className="text-xs text-gray-400">({items.length})</span>
          </div>
        );
      };

      // Render flat options (when scope is narrow)
      if (groupedOptions.type === 'flat') {
        return (
          <div className="max-h-[60vh] overflow-y-auto">
            {/* Empty option */}
            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-indigo-100 cursor-pointer border-b border-indigo-100">
              <input
                type="checkbox"
                checked={selectedValues.includes(EMPTY_VALUE)}
                onChange={() => onToggle(columnId, EMPTY_VALUE)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-gray-500 italic">(Empty)</span>
            </label>

            {groupedOptions.options.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-indigo-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedValues.includes(opt.value)}
                  onChange={() => onToggle(columnId, opt.value)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-xs text-gray-700 truncate">{opt.label}</span>
              </label>
            ))}

            {groupedOptions.options.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400 italic">No values available</div>
            )}
          </div>
        );
      }

      // Render grouped options (one level of grouping)
      if (groupedOptions.type === 'grouped') {
        return (
          <div className="max-h-[60vh] overflow-y-auto">
            {/* Empty option */}
            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-indigo-100 cursor-pointer border-b border-indigo-100">
              <input
                type="checkbox"
                checked={selectedValues.includes(EMPTY_VALUE)}
                onChange={() => onToggle(columnId, EMPTY_VALUE)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-gray-500 italic">(Empty)</span>
            </label>

            {groupedOptions.groups.map((group) => (
              <div key={group.id}>
                <GroupHeader group={group} items={group.items} />

                {!collapsedGroups[group.id] &&
                  group.items.map((item) => (
                    <label
                      key={item.value}
                      className="flex items-center gap-2 px-3 py-1.5 pl-8 hover:bg-indigo-100 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedValues.includes(item.value)}
                        onChange={() => onToggle(columnId, item.value)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs text-gray-700 truncate">{item.label}</span>
                    </label>
                  ))}
              </div>
            ))}

            {groupedOptions.groups.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400 italic">No values available</div>
            )}
          </div>
        );
      }

      // Render nested options (two levels: WC → Board → Work Units)
      if (groupedOptions.type === 'nested') {
        return (
          <div className="max-h-[60vh] overflow-y-auto">
            {/* Empty option */}
            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-indigo-100 cursor-pointer border-b border-indigo-100">
              <input
                type="checkbox"
                checked={selectedValues.includes(EMPTY_VALUE)}
                onChange={() => onToggle(columnId, EMPTY_VALUE)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-gray-500 italic">(Empty)</span>
            </label>

            {groupedOptions.groups.map((wcGroup) => {
              // Collect all work unit values for this WC
              const allWcItems = wcGroup.subgroups.flatMap((board) => board.items);

              return (
                <div key={wcGroup.id}>
                  {/* Work Centre header */}
                  <GroupHeader group={wcGroup} items={allWcItems} />

                  {!collapsedGroups[wcGroup.id] &&
                    wcGroup.subgroups.map((boardGroup) => {
                      const boardGroupId = `${wcGroup.id}-${boardGroup.id}`;
                      const isBoardCollapsed = collapsedGroups[boardGroupId];
                      const boardSelectionState = getGroupSelectionState(boardGroup.items);
                      const boardValues = boardGroup.items.map((i) => i.value);

                      return (
                        <div key={boardGroup.id}>
                          {/* Board subheader */}
                          <div
                            className="flex items-center gap-1 px-2 py-1.5 ml-4 bg-gray-50 border-b border-indigo-100 cursor-pointer hover:bg-gray-100"
                            onClick={() => toggleCollapse(boardGroupId)}
                          >
                            <span className="text-gray-400 w-4 flex-shrink-0">
                              {isBoardCollapsed ? (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              ) : (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M19 9l-7 7-7-7"
                                  />
                                </svg>
                              )}
                            </span>
                            <input
                              type="checkbox"
                              checked={boardSelectionState === 'all'}
                              ref={(el) => {
                                if (el) el.indeterminate = boardSelectionState === 'some';
                              }}
                              onChange={(e) => {
                                e.stopPropagation();
                                onToggleGroup(columnId, boardValues, boardSelectionState === 'all');
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-xs font-medium text-gray-600 truncate flex-1">
                              {boardGroup.label}
                            </span>
                            <span className="text-xs text-gray-400">({boardGroup.items.length})</span>
                          </div>

                          {/* Work Units */}
                          {!isBoardCollapsed &&
                            boardGroup.items.map((item) => (
                              <label
                                key={item.value}
                                className="flex items-center gap-2 px-3 py-1.5 pl-12 hover:bg-indigo-100 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedValues.includes(item.value)}
                                  onChange={() => onToggle(columnId, item.value)}
                                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="text-xs text-gray-700 truncate">{item.label}</span>
                              </label>
                            ))}
                        </div>
                      );
                    })}
                </div>
              );
            })}

            {groupedOptions.groups.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400 italic">No values available</div>
            )}
          </div>
        );
      }

      // Fallback
      return <div className="px-3 py-2 text-xs text-gray-400 italic">No filter options available</div>;
    };

    // v127: Column filter dropdown component
    // v128: Improved styling - tinted background, consistent fonts
    // v134: Added operator dropdown for text filters
    // v142: Added custom date range options (Before/After/Between)
    // v154b: Multi-condition AND/OR text filtering
    const ColumnFilterDropdown = ({ columnId, colDef }) => {
      const filterType = getFilterTypeForField(colDef);
      const options = getFilterOptionsForColumn(columnId);
      const currentFilter = activeFilters[columnId];

      // v154b: Parse current text filter into conditions array
      const parseTextFilter = () => {
        if (!currentFilter) {
          return { mode: 'and', conditions: [{ op: 'contains', value: '' }] };
        }
        // New multi-condition format
        if (currentFilter.conditions) {
          return {
            mode: currentFilter.mode || 'and',
            conditions:
              currentFilter.conditions.length > 0 ? currentFilter.conditions : [{ op: 'contains', value: '' }],
          };
        }
        // Legacy single condition { op, value }
        if (currentFilter.op) {
          return { mode: 'and', conditions: [currentFilter] };
        }
        // Legacy bare string
        if (typeof currentFilter === 'string') {
          return { mode: 'and', conditions: [{ op: 'contains', value: currentFilter }] };
        }
        return { mode: 'and', conditions: [{ op: 'contains', value: '' }] };
      };

      const initialTextFilter = parseTextFilter();
      const [textMode, setTextMode] = useState(initialTextFilter.mode);
      const [textConditions, setTextConditions] = useState(initialTextFilter.conditions);

      // v142: Parse current date filter to determine mode
      const getCurrentDateMode = () => {
        if (!currentFilter) return 'preset';
        if (currentFilter.preset) return 'preset';
        if (currentFilter.before) return 'before';
        if (currentFilter.after) return 'after';
        if (currentFilter.from || currentFilter.to) return 'between';
        return 'preset';
      };

      const [dateMode, setDateMode] = useState(getCurrentDateMode());
      const [dateBefore, setDateBefore] = useState(currentFilter?.before || '');
      const [dateAfter, setDateAfter] = useState(currentFilter?.after || '');
      const [dateFrom, setDateFrom] = useState(currentFilter?.from || '');
      const [dateTo, setDateTo] = useState(currentFilter?.to || '');

      // Get current selected values for multiselect
      const selectedValues = Array.isArray(currentFilter) ? currentFilter : [];

      return (
        <div
          ref={filterDropdownRef}
          className="absolute top-full left-full mt-1 bg-indigo-50 border border-indigo-200 rounded-lg shadow-lg z-50 min-w-[200px] max-w-[280px]"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Sort options */}
          {/* v140: Use onMouseDown + preventDefault so sort fires before any input blur */}
          <div className="p-1 border-b border-indigo-100">
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                handleSortExplicit(columnId, 'asc');
              }}
              className={`w-full text-left px-3 py-1.5 text-xs rounded hover:bg-indigo-100 flex items-center gap-2 ${sortColumn === columnId && sortDirection === 'asc' ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-700'}`}
            >
              {ChevronUp && <ChevronUp size={14} />}
              Sort A → Z
            </button>
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                handleSortExplicit(columnId, 'desc');
              }}
              className={`w-full text-left px-3 py-1.5 text-xs rounded hover:bg-indigo-100 flex items-center gap-2 ${sortColumn === columnId && sortDirection === 'desc' ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-700'}`}
            >
              {ChevronDown && <ChevronDown size={14} />}
              Sort Z → A
            </button>
          </div>

          {/* Filter section */}
          {filterType === 'text' ? (
            // v154b: Multi-condition text filter with AND/OR logic
            <div className="p-2 border-b border-indigo-100 min-w-[280px]">
              {/* AND/OR toggle - only show when 2+ conditions */}
              {textConditions.length > 1 && (
                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-indigo-100">
                  <span className="text-xs text-gray-600">Match:</span>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name={`text-mode-${columnId}`}
                      checked={textMode === 'and'}
                      onChange={() => setTextMode('and')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-gray-700">All (AND)</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name={`text-mode-${columnId}`}
                      checked={textMode === 'or'}
                      onChange={() => setTextMode('or')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-gray-700">Any (OR)</span>
                  </label>
                </div>
              )}

              {/* Conditions list */}
              <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                {textConditions.map((cond, idx) => {
                  const opConfig = TEXT_FILTER_OPERATORS.find((o) => o.value === cond.op);
                  const needsValue = opConfig?.needsValue !== false;

                  return (
                    <div key={idx} className="flex items-center gap-1">
                      <select
                        value={cond.op}
                        onChange={(e) => {
                          const newConditions = [...textConditions];
                          newConditions[idx] = { ...newConditions[idx], op: e.target.value };
                          // Clear value if switching to no-value operator
                          const newOpConfig = TEXT_FILTER_OPERATORS.find((o) => o.value === e.target.value);
                          if (!newOpConfig?.needsValue) {
                            newConditions[idx].value = '';
                          }
                          setTextConditions(newConditions);
                        }}
                        className="flex-shrink-0 w-[120px] px-1 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      >
                        {TEXT_FILTER_OPERATORS.map((op) => (
                          <option key={op.value} value={op.value}>
                            {op.label}
                          </option>
                        ))}
                      </select>

                      {needsValue && (
                        <input
                          type="text"
                          value={cond.value || ''}
                          onChange={(e) => {
                            const newConditions = [...textConditions];
                            newConditions[idx] = { ...newConditions[idx], value: e.target.value };
                            setTextConditions(newConditions);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleTextFilterApply(columnId, textMode, textConditions);
                            }
                          }}
                          placeholder="Value..."
                          className="flex-1 min-w-0 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      )}

                      {/* Remove button - only show if more than one condition */}
                      {textConditions.length > 1 && (
                        <button
                          onClick={() => {
                            const newConditions = textConditions.filter((_, i) => i !== idx);
                            setTextConditions(newConditions);
                          }}
                          className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 rounded"
                          title="Remove condition"
                        >
                          {X && <X size={14} />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add condition button */}
              <button
                onClick={() => {
                  setTextConditions([...textConditions, { op: 'contains', value: '' }]);
                }}
                className="mt-2 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                + Add condition
              </button>

              {/* Apply / Clear buttons */}
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-indigo-100">
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleFilterChange(columnId, null);
                    setTextConditions([{ op: 'contains', value: '' }]);
                    setTextMode('and');
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Clear
                </button>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleTextFilterApply(columnId, textMode, textConditions);
                  }}
                  className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700"
                >
                  Apply
                </button>
              </div>
            </div>
          ) : filterType === 'grouped-board' || filterType === 'grouped-workunit' ? (
            // v153b: Grouped checkboxes for Board and Work Unit filters
            <GroupedFilterSection
              columnId={columnId}
              filterType={filterType}
              selectedValues={selectedValues}
              onToggle={handleToggleFilterValue}
              onToggleGroup={handleToggleGroupFilter}
            />
          ) : filterType === 'multiselect' ? (
            // Multi-select checkboxes - v130: taller max height
            <div className="max-h-[60vh] overflow-y-auto">
              {/* Empty option */}
              <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-indigo-100 cursor-pointer border-b border-indigo-100">
                <input
                  type="checkbox"
                  checked={selectedValues.includes(EMPTY_VALUE)}
                  onChange={() => handleToggleFilterValue(columnId, EMPTY_VALUE)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-xs text-gray-500 italic">(Empty)</span>
              </label>

              {options.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-indigo-100 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(opt.value)}
                    onChange={() => handleToggleFilterValue(columnId, opt.value)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-gray-700 truncate">{opt.label}</span>
                </label>
              ))}

              {options.length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-400 italic">No values available</div>
              )}
            </div>
          ) : filterType === 'date' ? (
            // v142: Date filter with presets and custom options
            <div className="max-h-[60vh] overflow-y-auto">
              {/* Presets section */}
              <div className="p-1 border-b border-indigo-100">
                <div className="px-2 py-1 text-xs font-medium text-gray-500 uppercase tracking-wider">Presets</div>
                {[
                  { value: 'today', label: 'Today' },
                  { value: 'yesterday', label: 'Yesterday' },
                  { value: 'this-week', label: 'This Week' },
                  { value: 'last-7-days', label: 'Last 7 Days' },
                  { value: 'this-month', label: 'This Month' },
                  { value: 'last-30-days', label: 'Last 30 Days' },
                  { value: 'this-quarter', label: 'This Quarter' },
                ].map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => {
                      setDateMode('preset');
                      handleFilterChange(columnId, { preset: preset.value });
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs rounded hover:bg-indigo-100 ${currentFilter?.preset === preset.value ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-700'}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Custom section */}
              <div className="p-2">
                <div className="px-1 py-1 text-xs font-medium text-gray-500 uppercase tracking-wider">Custom</div>

                {/* Before option */}
                <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-indigo-100 rounded">
                  <input
                    type="radio"
                    name={`dateMode-${columnId}`}
                    checked={dateMode === 'before'}
                    onChange={() => {
                      setDateMode('before');
                      setDateAfter('');
                      setDateFrom('');
                      setDateTo('');
                    }}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-gray-700">Before</span>
                </label>
                {dateMode === 'before' && (
                  <div className="ml-6 mb-2">
                    <input
                      type="date"
                      value={dateBefore}
                      onChange={(e) => setDateBefore(e.target.value)}
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                )}

                {/* After option */}
                <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-indigo-100 rounded">
                  <input
                    type="radio"
                    name={`dateMode-${columnId}`}
                    checked={dateMode === 'after'}
                    onChange={() => {
                      setDateMode('after');
                      setDateBefore('');
                      setDateFrom('');
                      setDateTo('');
                    }}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-gray-700">After</span>
                </label>
                {dateMode === 'after' && (
                  <div className="ml-6 mb-2">
                    <input
                      type="date"
                      value={dateAfter}
                      onChange={(e) => setDateAfter(e.target.value)}
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                )}

                {/* Between option */}
                <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-indigo-100 rounded">
                  <input
                    type="radio"
                    name={`dateMode-${columnId}`}
                    checked={dateMode === 'between'}
                    onChange={() => {
                      setDateMode('between');
                      setDateBefore('');
                      setDateAfter('');
                    }}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-gray-700">Between</span>
                </label>
                {dateMode === 'between' && (
                  <div className="ml-6 mb-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-10">From</span>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-10">To</span>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                )}

                {/* Apply button - only show when custom mode is selected and has values */}
                {(dateMode === 'before' || dateMode === 'after' || dateMode === 'between') && (
                  <button
                    onClick={() => {
                      if (dateMode === 'before' && dateBefore) {
                        handleFilterChange(columnId, { before: dateBefore });
                      } else if (dateMode === 'after' && dateAfter) {
                        handleFilterChange(columnId, { after: dateAfter });
                      } else if (dateMode === 'between' && (dateFrom || dateTo)) {
                        const filter = {};
                        if (dateFrom) filter.from = dateFrom;
                        if (dateTo) filter.to = dateTo;
                        handleFilterChange(columnId, filter);
                      }
                    }}
                    disabled={
                      (dateMode === 'before' && !dateBefore) ||
                      (dateMode === 'after' && !dateAfter) ||
                      (dateMode === 'between' && !dateFrom && !dateTo)
                    }
                    className="w-full mt-2 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Apply
                  </button>
                )}
              </div>
            </div>
          ) : filterType === 'number' ? (
            // Number range
            <div className="p-2">
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  placeholder="Min"
                  value={currentFilter?.min ?? ''}
                  onChange={(e) =>
                    handleFilterChange(columnId, {
                      ...currentFilter,
                      min: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-gray-400 text-xs">—</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={currentFilter?.max ?? ''}
                  onChange={(e) =>
                    handleFilterChange(columnId, {
                      ...currentFilter,
                      max: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          ) : null}

          {/* Clear filter - v129: Use onMouseDown to fire before onBlur */}
          {hasActiveFilter(columnId) && (
            <div className="p-1 border-t border-gray-100">
              <button
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent focus change
                  handleRemoveFilter(columnId);
                  setFilterDropdownColumn(null);
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded"
              >
                Clear filter
              </button>
            </div>
          )}
        </div>
      );
    };

    // v176a: Customer Filters Dropdown - allows filtering by customer fields (CRM Phase 6)
    // v176c: Refactored to use parent state (showCustomerFilters) to prevent dropdown closing on filter change
    // v176d: Redesigned to 4-column layout
    // v176f: Fixed scroll position reset using separate positions ref + double RAF (BUG-176-003)
    const CustomerFiltersDropdown = () => {
      // Close dropdown when clicking outside
      useEffect(() => {
        const handleClickOutside = (event) => {
          if (customerFiltersRef.current && !customerFiltersRef.current.contains(event.target)) {
            setShowCustomerFilters(false);
          }
        };

        if (showCustomerFilters) {
          document.addEventListener('mousedown', handleClickOutside);
          return () => document.removeEventListener('mousedown', handleClickOutside);
        }
      }, [showCustomerFilters]);

      // Check if any customer filters are active
      const hasCustomerFilters = Object.keys(activeFilters).some((k) => isCustomerField(k));

      // v176d: Column definitions for 4-column layout
      const columns = [
        { fields: [{ id: 'client', label: 'Customer', hasNoOption: true }] },
        { fields: [{ id: 'client.stage', label: 'Customer Stage', hasNoOption: false }] },
        { fields: [{ id: 'client.territory', label: 'Territory', hasNoOption: false }] },
        {
          fields: [
            { id: 'client.accountOwnerId', label: 'Account Owner', hasNoOption: false },
            { id: 'client.industry', label: 'Industry', hasNoOption: false },
            { id: 'client.companySize', label: 'Company Size', hasNoOption: false },
          ],
        },
      ];

      // v176f: Save scroll position before state change, restore after render
      const handleCheckboxChange = (fieldId, value) => {
        // Save all current scroll positions to separate ref (survives DOM recreation)
        Object.keys(customerFilterScrollRefs.current).forEach((key) => {
          const el = customerFilterScrollRefs.current[key];
          if (el) {
            customerFilterScrollPositions.current[key] = el.scrollTop;
          }
        });

        // Toggle the filter value
        handleToggleFilterValue(fieldId, value);

        // Restore scroll positions after React re-renders AND ref callbacks have run
        // Double RAF ensures we're after the commit phase
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            Object.keys(customerFilterScrollPositions.current).forEach((key) => {
              const el = customerFilterScrollRefs.current[key];
              if (el && customerFilterScrollPositions.current[key] !== undefined) {
                el.scrollTop = customerFilterScrollPositions.current[key];
              }
            });
          });
        });
      };

      // v176f: Render a single filter section with scroll ref
      const renderFilterSection = (field) => {
        const currentFilter = activeFilters[field.id];
        const selectedValues = Array.isArray(currentFilter) ? currentFilter : [];
        const options = getFilterOptionsForColumn(field.id);
        const hasFilter = selectedValues.length > 0;

        return (
          <div key={field.id} className="flex flex-col min-h-0">
            <div
              className={`px-3 py-2 font-medium text-sm flex-shrink-0 ${hasFilter ? 'text-indigo-700 bg-indigo-50' : 'text-gray-700'}`}
            >
              {field.label}
              {hasFilter && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFilterChange(field.id, null);
                  }}
                  className="ml-2 text-xs text-indigo-500 hover:text-indigo-700"
                >
                  (clear)
                </button>
              )}
            </div>

            {/* v176f: Scrollable area with ref for position preservation */}
            <div
              ref={(el) => {
                customerFilterScrollRefs.current[field.id] = el;
              }}
              className="px-3 pb-2 overflow-y-auto flex-1 min-h-0"
            >
              {/* No Customer option - only for 'client' field */}
              {field.id === 'client' && (
                <label className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-50 rounded">
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(NO_CUSTOMER)}
                    onChange={() => handleCheckboxChange(field.id, NO_CUSTOMER)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-gray-500 italic">(No Customer)</span>
                </label>
              )}

              {options.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-50 rounded"
                >
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(opt.value)}
                    onChange={() => handleCheckboxChange(field.id, opt.value)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-gray-700 truncate">{opt.label}</span>
                </label>
              ))}

              {options.length === 0 && <div className="py-2 text-sm text-gray-400 italic">No values available</div>}
            </div>
          </div>
        );
      };

      return (
        <div className="relative" ref={customerFiltersRef}>
          <button
            onClick={() => setShowCustomerFilters(!showCustomerFilters)}
            className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg border ${
              hasCustomerFilters
                ? 'text-indigo-700 bg-indigo-50 border-indigo-300 hover:bg-indigo-100'
                : 'text-gray-700 hover:bg-gray-100 border-gray-300'
            }`}
            title="Filter by customer attributes"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            Customer Filters
            {hasCustomerFilters && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-indigo-200 text-indigo-800 rounded-full">
                {Object.keys(activeFilters).filter((k) => isCustomerField(k)).length}
              </span>
            )}
            {ChevronDown && <ChevronDown size={14} className="ml-1" />}
          </button>

          {showCustomerFilters && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
              {/* v176d: Header */}
              <div className="p-3 border-b border-gray-100">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Filter by Customer Attributes
                </div>
              </div>

              {/* v176d: 4-column layout */}
              <div className="flex divide-x divide-gray-200" style={{ maxHeight: '50vh' }}>
                {columns.map((column, colIndex) => (
                  <div
                    key={colIndex}
                    className="flex flex-col min-w-[200px] max-w-[240px]"
                    style={{ maxHeight: '50vh' }}
                  >
                    {column.fields.length === 1
                      ? // Single field takes full column height
                        renderFilterSection(column.fields[0])
                      : // Multiple fields share column, each with own scroll
                        column.fields.map((field, fieldIndex) => (
                          <div
                            key={field.id}
                            className={`flex flex-col flex-1 min-h-0 ${fieldIndex > 0 ? 'border-t border-gray-200' : ''}`}
                          >
                            {renderFilterSection(field)}
                          </div>
                        ))}
                  </div>
                ))}
              </div>

              {/* v176d: Footer with clear all */}
              {hasCustomerFilters && (
                <div className="p-2 border-t border-gray-100 bg-gray-50">
                  <button
                    onClick={() => {
                      // Clear all customer filters
                      const newFilters = { ...activeFilters };
                      Object.keys(newFilters).forEach((k) => {
                        if (isCustomerField(k)) {
                          delete newFilters[k];
                        }
                      });
                      setActiveFilters(newFilters);
                      if (scope === 'board' && onViewConfigChange) {
                        onViewConfigChange({ ...viewConfig, activeFilters: newFilters });
                      }
                    }}
                    className="w-full text-sm text-gray-500 hover:text-gray-700 py-1"
                  >
                    Clear all customer filters
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      );
    };

    // v133: Active Filters Bar - shows active filters as chips with removal
    const ActiveFiltersBar = () => {
      const filterEntries = Object.entries(activeFilters).filter(([_, value]) => {
        // Only include non-empty filters
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'string') return value.trim() !== '';
        if (typeof value === 'object') return Object.keys(value).length > 0;
        return true;
      });

      if (filterEntries.length === 0) return null;

      return (
        <div className="flex-shrink-0 bg-gray-50 border-b border-gray-200 px-6 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-500">Filters:</span>

            {filterEntries.map(([columnId, filterValue]) => {
              const colDef = getColumnDefinition(columnId);
              const columnLabel = colDef?.label || columnId;
              const displayValue = getFilterDisplayValue(columnId, filterValue);

              return (
                <div
                  key={columnId}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-100 text-indigo-800 rounded-lg text-sm"
                >
                  <span className="font-medium">{columnLabel}:</span>
                  <span className="max-w-48 truncate" title={displayValue}>
                    {displayValue}
                  </span>
                  <button
                    onClick={() => handleRemoveFilter(columnId)}
                    className="ml-1 p-0.5 hover:bg-indigo-200 rounded"
                    title={`Remove ${columnLabel} filter`}
                  >
                    {X && <X size={14} />}
                  </button>
                </div>
              );
            })}

            {filterEntries.length > 1 && (
              <button
                onClick={handleClearAllFilters}
                className="text-sm text-gray-500 hover:text-gray-700 hover:underline ml-2"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      );
    };

    // v149: SaveViewModal is now rendered inline below (originally BUG-135-001 FIX)
    // Defining it as a component inside render causes re-mounting on state change, losing input focus

    // v149: Manage Views Modal (renamed from Manage Filters)
    const ManageViewsModal = () => {
      if (!showManageViewsModal) return null;

      return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Manage Saved Views</h2>
              <button
                onClick={() => {
                  setShowManageViewsModal(false);
                  setEditingViewId(null);
                  setEditingViewName('');
                }}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                {X && <X size={20} />}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {currentSavedViews.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <p>No saved views yet.</p>
                  <p className="text-sm mt-1">Configure your view and click Save to create one.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {currentSavedViews.map((view) => (
                    <div key={view.id} className="border border-gray-200 rounded-lg p-4">
                      {editingViewId === view.id ? (
                        <div className="flex items-center gap-2">
                          {/* v153 BUG-152-003 FIX: Use defaultValue with ref to prevent cursor jump */}
                          <input
                            type="text"
                            defaultValue={view.name}
                            ref={(input) => {
                              if (input && editingViewId === view.id) {
                                // Store ref for getting value on save
                                input.dataset.viewId = view.id;
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleRenameView(view.id, e.target.value);
                              }
                              if (e.key === 'Escape') {
                                setEditingViewId(null);
                                setEditingViewName('');
                              }
                            }}
                            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            autoFocus
                            id={`rename-input-${view.id}`}
                          />
                          <button
                            onClick={() => {
                              const input = document.getElementById(`rename-input-${view.id}`);
                              if (input) handleRenameView(view.id, input.value);
                            }}
                            className="px-2 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingViewId(null);
                              setEditingViewName('');
                            }}
                            className="px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="font-medium text-gray-900">{view.name}</h3>
                            {/* v149: Show view summary - scope, columns, filters */}
                            <div className="flex flex-wrap gap-2 mt-1">
                              {view.scope && (
                                <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                                  {view.scope === 'all'
                                    ? 'All WC'
                                    : view.scope === 'workcentre'
                                      ? 'Work Centre'
                                      : 'Board'}
                                </span>
                              )}
                              {view.columns && (
                                <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
                                  {view.columns.length} columns
                                </span>
                              )}
                              {view.filters && countFilters(view.filters) > 0 && (
                                <span className="text-xs px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded">
                                  {countFilters(view.filters)} filter{countFilters(view.filters) !== 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                            {/* Show filter details if any */}
                            {view.filters && countFilters(view.filters) > 0 && (
                              <p className="text-xs text-gray-500 mt-1 truncate">
                                {Object.entries(view.filters)
                                  .map(([columnId, filterValue]) => {
                                    const colDef = getColumnDefinition(columnId);
                                    const columnLabel = colDef?.label || columnId;
                                    const displayValue = getFilterDisplayValue(columnId, filterValue);
                                    return `${columnLabel}: ${displayValue}`;
                                  })
                                  .join(' · ')}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 ml-4">
                            <button
                              onClick={() => {
                                setEditingViewId(view.id);
                                setEditingViewName(view.name);
                              }}
                              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                              title="Rename"
                            >
                              {Edit2 && <Edit2 size={16} />}
                            </button>
                            <button
                              onClick={() => handleDeleteView(view.id)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Delete"
                            >
                              {Trash2 && <Trash2 size={16} />}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                onClick={() => {
                  setShowManageViewsModal(false);
                  setEditingViewId(null);
                  setEditingViewName('');
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      );
    };

    // v149: Missing Columns Warning Modal
    const MissingColumnsModal = () => {
      if (!showMissingColumnsModal) return null;

      return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 bg-amber-50">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                {AlertCircle && <AlertCircle size={20} className="text-amber-600" />}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-amber-900">Some Columns Unavailable</h2>
              </div>
            </div>

            <div className="p-6">
              <p className="text-sm text-gray-600 mb-3">
                The following columns from this saved view no longer exist and have been omitted:
              </p>
              <ul className="bg-gray-50 rounded-lg p-3 space-y-1">
                {missingColumnNames.map((name, idx) => (
                  <li key={idx} className="text-sm text-gray-700 flex items-center gap-2">
                    <span className="text-gray-400">•</span>
                    {name}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex justify-end px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                onClick={() => {
                  setShowMissingColumnsModal(false);
                  setMissingColumnNames([]);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      );
    };

    // v135: Get scope context for title display
    const getTitleContext = () => {
      switch (scope) {
        case 'board':
          return `${currentOpCentre?.name || 'Work Centre'} / ${currentBoard?.name || 'Board'}`;
        case 'workcentre':
          return `${currentOpCentre?.name || 'Work Centre'} / All Boards`;
        case 'all':
          return 'All Work Centres';
        default:
          return '';
      }
    };

    // Legacy - still used for ticket count subtitle
    const getScopeLabel = () => {
      switch (scope) {
        case 'board':
          return currentBoard?.name || 'This Board';
        case 'workcentre':
          return currentOpCentre?.name || 'This Work Centre';
        case 'all':
          return 'All Work Centres';
        default:
          return 'All Tickets';
      }
    };

    // Bulk Edit Panel Component
    const BulkEditPanel = () => {
      const selectedBoard = getBoardForBulkEdit();
      const zones = selectedBoard?.workZones || [];
      const selectedZone = zones.find((z) => z.id === bulkEditValues.zoneId);
      const stages = selectedZone?.workStages || [];

      return (
        <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-xl border-l border-gray-200 z-50 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Bulk Edit</h2>
              <p className="text-sm text-gray-500">
                {selectedTickets.size} ticket{selectedTickets.size !== 1 ? 's' : ''} selected
              </p>
            </div>
            <button
              onClick={() => setShowBulkEditPanel(false)}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              {X && <X size={20} />}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <p className="text-sm text-gray-600 mb-6">
              Fields set to "Keep as is" won't be changed. Only modify fields you want to update.
            </p>

            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
              <select
                value={bulkEditValues.status}
                onChange={(e) => setBulkEditValues((prev) => ({ ...prev, status: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value={KEEP_AS_IS}>Keep as is</option>
                <optgroup label="Available Statuses">
                  {(company?.statuses || []).map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Assignee</label>
              <select
                value={bulkEditValues.assignee}
                onChange={(e) => setBulkEditValues((prev) => ({ ...prev, assignee: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value={KEEP_AS_IS}>Keep as is</option>
                <option value="">Unassigned</option>
                <optgroup label="Staff Members">
                  {(company?.globalStaff || []).map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Priority</label>
              <select
                value={bulkEditValues.priority}
                onChange={(e) => setBulkEditValues((prev) => ({ ...prev, priority: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value={KEEP_AS_IS}>Keep as is</option>
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-5">
              {/* v153 BUG-152-002b FIX: Use dynamic Work Unit label */}
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{getWorkUnitLabel()}</label>
              <select
                value={bulkEditValues.workUnitId}
                onChange={(e) => setBulkEditValues((prev) => ({ ...prev, workUnitId: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value={KEEP_AS_IS}>Keep as is</option>
                <option value="">No Work Unit</option>
                <optgroup label="Work Units">
                  {getWorkUnitsForBulkEdit.map((wu) => (
                    <option key={wu.id} value={wu.id}>
                      {wu.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="border-t border-gray-200 pt-5 mt-5">
              <h3 className="text-sm font-medium text-gray-900 mb-4">Move to Location</h3>
              <p className="text-xs text-gray-500 mb-4">Changing the board will reset zone and stage to defaults.</p>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Board</label>
                <select
                  value={bulkEditValues.boardId}
                  onChange={(e) => handleBulkEditBoardChange(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value={KEEP_AS_IS}>Keep as is</option>
                  {getAllBoards.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.opCentreName} → {board.name}
                    </option>
                  ))}
                </select>
              </div>

              {bulkEditValues.boardId !== KEEP_AS_IS && (
                <div className="mb-4 ml-4 pl-4 border-l-2 border-gray-200">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Zone</label>
                  <select
                    value={bulkEditValues.zoneId}
                    onChange={(e) => handleBulkEditZoneChange(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value={KEEP_AS_IS}>Keep as is</option>
                    {zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {bulkEditValues.boardId !== KEEP_AS_IS && bulkEditValues.zoneId !== KEEP_AS_IS && (
                <div className="mb-4 ml-8 pl-4 border-l-2 border-gray-200">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Stage</label>
                  <select
                    value={bulkEditValues.column}
                    onChange={(e) => setBulkEditValues((prev) => ({ ...prev, column: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value={KEEP_AS_IS}>Keep as is</option>
                    {stages.map((stage) => {
                      const stageName = typeof stage === 'string' ? stage : stage.name;
                      return (
                        <option key={stageName} value={stageName}>
                          {stageName}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 flex justify-end gap-3">
            <button
              onClick={() => setShowBulkEditPanel(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleApplyBulkEdit}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              Apply Changes
            </button>
          </div>
        </div>
      );
    };

    // v122: Column Picker Modal with fixed dimensions and drag-drop
    const ColumnPickerModal = () => {
      const availableFields = getAvailableFields;

      // v123: Handle drag start only from the grip handle
      const handleGripDragStart = (e, colId) => {
        e.stopPropagation();
        handleColumnDragStart(e, colId, 'modal');
      };

      return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          {/* v123: Larger modal - h-[80vh] to match other modals */}
          {/* v125: Modal size now matches Global Settings - max-w-6xl h-[85vh] */}
          <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-4 h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Configure Columns</h2>
              <button
                onClick={() => setShowColumnPicker(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                {X && <X size={20} />}
              </button>
            </div>

            {/* Content - fixed height with internal scroll */}
            <div className="flex-1 min-h-0 flex">
              {/* Left: Visible Columns */}
              <div className="w-1/2 border-r border-gray-200 p-4 flex flex-col">
                <h3 className="flex-shrink-0 text-sm font-medium text-gray-700 uppercase tracking-wider mb-3">
                  Visible Columns
                </h3>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
                  {visibleColumns.map((colId, index) => {
                    const colDef = getColumnDefinition(colId);
                    if (!colDef) return null;

                    const isDragOver = dragOverColumn === colId && dragSource === 'modal';
                    const locked = checkColumnLocked(colId);

                    return (
                      <div
                        key={colId}
                        // v125: Make entire row draggable for better ghost image
                        draggable={!locked}
                        onDragStart={(e) => handleGripDragStart(e, colId)}
                        onDragEnd={handleColumnDragEnd}
                        className={`flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border ${isDragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'} ${!locked ? 'cursor-grab' : ''}`}
                        onDragOver={(e) => handleColumnDragOver(e, colId)}
                        onDragLeave={handleColumnDragLeave}
                        onDrop={(e) => handleColumnDrop(e, colId)}
                      >
                        {/* v125: Grip icon is visual indicator only, row is draggable */}
                        <div className={`p-1 -m-1 ${locked ? 'opacity-30' : ''}`}>
                          {GripVertical && <GripVertical size={16} className="text-gray-400" />}
                        </div>
                        <input
                          type="checkbox"
                          checked={true}
                          disabled={locked}
                          onChange={() => handleToggleColumn(colId)}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                        />
                        <span className="flex-1 text-sm text-gray-900">
                          {colDef.label}
                          {locked && <span className="text-xs text-gray-400 ml-1">(required)</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="flex-shrink-0 text-xs text-gray-500 mt-3">Drag rows to reorder columns</p>
              </div>

              {/* Right: Available Fields */}
              <div className="w-1/2 p-4 flex flex-col">
                <h3 className="flex-shrink-0 text-sm font-medium text-gray-700 uppercase tracking-wider mb-3">
                  Available Fields
                </h3>

                {/* Search */}
                <div className="flex-shrink-0 relative mb-3">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    {Search && <Search size={14} className="text-gray-400" />}
                  </div>
                  <input
                    ref={columnSearchRef}
                    type="text"
                    placeholder="Search fields..."
                    value={columnSearchTerm}
                    onChange={(e) => setColumnSearchTerm(e.target.value)}
                    className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm w-full focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                  {columnSearchTerm && (
                    <button
                      type="button"
                      onClick={() => {
                        setColumnSearchTerm('');
                        columnSearchRef.current?.focus();
                      }}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                    >
                      {X && <X size={14} />}
                    </button>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
                  {/* System Fields */}
                  {availableFields.system.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">System Fields</h4>
                      <div className="space-y-1">
                        {availableFields.system.map((field) => {
                          const isVisible = visibleColumns.includes(field.id);
                          const locked = checkColumnLocked(field.id);
                          // v155: Check if column is unavailable (e.g., zone/workUnit when only simple boards)
                          const unavailable = field.unavailable && !isVisible;
                          return (
                            <label
                              key={field.id}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg ${locked || unavailable ? 'cursor-default' : 'cursor-pointer'} ${isVisible ? 'bg-indigo-50' : unavailable ? 'bg-gray-100 opacity-60' : 'hover:bg-gray-50'}`}
                              title={unavailable ? field.unavailableHint : undefined}
                            >
                              <input
                                type="checkbox"
                                checked={isVisible}
                                disabled={locked || unavailable}
                                onChange={() => handleToggleColumn(field.id)}
                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                              />
                              <span
                                className={`text-sm ${isVisible ? 'text-indigo-700' : unavailable ? 'text-gray-400' : 'text-gray-700'}`}
                              >
                                {field.label}
                                {locked && <span className="text-xs text-gray-400 ml-1">(required)</span>}
                                {unavailable && (
                                  <span className="text-xs text-gray-400 ml-1 italic">(not in scope)</span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Field Library by Category */}
                  {/* v152 UX-152-002/003: Field Library by Category (filtered by scope, with data highlight) */}
                  {Object.entries(availableFields.byCategory).map(([catId, category]) => {
                    if (category.fields.length === 0) return null;
                    return (
                      <div key={catId}>
                        <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">{category.name}</h4>
                        <div className="space-y-1">
                          {category.fields.map((field) => {
                            const isVisible = visibleColumns.includes(field.id);
                            // v152 UX-152-003: Pale yellow for unchecked fields that have data
                            const hasDataHighlight = !isVisible && field.hasData;
                            return (
                              <label
                                key={field.id}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer ${
                                  isVisible
                                    ? 'bg-indigo-50'
                                    : hasDataHighlight
                                      ? 'bg-amber-50 hover:bg-amber-100'
                                      : 'hover:bg-gray-50'
                                }`}
                                title={hasDataHighlight ? 'This field has data in current view' : undefined}
                              >
                                <input
                                  type="checkbox"
                                  checked={isVisible}
                                  onChange={() => handleToggleColumn(field.id)}
                                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span
                                  className={`text-sm ${
                                    isVisible
                                      ? 'text-indigo-700'
                                      : hasDataHighlight
                                        ? 'text-amber-800'
                                        : 'text-gray-700'
                                  }`}
                                >
                                  {field.label}
                                </span>
                                <span className="text-xs text-gray-400">({field.type})</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {/* v152 UX-152-002/003: Custom Fields (filtered by scope, with data highlight) */}
                  {availableFields.custom.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Custom Fields</h4>
                      <div className="space-y-1">
                        {availableFields.custom.map((field) => {
                          const isVisible = visibleColumns.includes(field.id);
                          // v152 UX-152-003: Pale yellow for unchecked fields that have data
                          const hasDataHighlight = !isVisible && field.hasData;
                          return (
                            <label
                              key={field.id}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer ${
                                isVisible
                                  ? 'bg-indigo-50'
                                  : hasDataHighlight
                                    ? 'bg-amber-50 hover:bg-amber-100'
                                    : 'hover:bg-gray-50'
                              }`}
                              title={hasDataHighlight ? 'This field has data in current view' : undefined}
                            >
                              <input
                                type="checkbox"
                                checked={isVisible}
                                onChange={() => handleToggleColumn(field.id)}
                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              <span
                                className={`text-sm ${
                                  isVisible ? 'text-indigo-700' : hasDataHighlight ? 'text-amber-800' : 'text-gray-700'
                                }`}
                              >
                                {field.label}
                              </span>
                              <span className="text-xs text-gray-400">({field.type})</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 px-6 py-4 border-t border-gray-200 flex justify-between">
              <button
                onClick={handleResetView}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                {RotateCcw && <RotateCcw size={16} />}
                Reset to Defaults
              </button>
              <button
                onClick={() => setShowColumnPicker(false)}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              {/* v135: Title shows scope context */}
              <h1 className="text-xl font-semibold text-gray-900">
                All Tickets{getTitleContext() && ` – ${getTitleContext()}`}
              </h1>
              <p className="text-sm text-gray-500">{sortedTickets.length} tickets</p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Show:</span>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {/* v124: Only show scope options that have valid context */}
                {activeBoardId && <option value="board">This Board</option>}
                {activeOpCentreId && <option value="workcentre">This Work Centre</option>}
                <option value="all">All Work Centres</option>
              </select>

              {/* v167a: Show Only Deleted checkbox - only show at 'all' scope (admin) */}
              {scope === 'all' && (
                <label className="flex items-center gap-2 ml-4 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showOnlyDeleted}
                    onChange={(e) => setShowOnlyDeleted(e.target.checked)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Show Only Deleted Tickets
                </label>
              )}
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  {Search && <Search size={16} className="text-gray-400" />}
                </div>
                <input
                  type="text"
                  placeholder="Search tickets..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* v176a: Customer Filters dropdown - only show when CRM is configured */}
              {(company?.globalCRM?.length > 0 || company?.crmConfig) && <CustomerFiltersDropdown />}

              <button
                onClick={() => setShowColumnPicker(true)}
                className="flex items-center gap-1 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-300"
              >
                {Settings && <Settings size={16} />}
                Columns
              </button>

              {/* v152: Active view indicator */}
              {activeViewId && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg">
                  {FolderOpen && <FolderOpen size={14} className="text-indigo-500" />}
                  <span className="text-sm font-medium text-indigo-700">"{activeViewName}"</span>
                  {isViewModified && <span className="text-xs text-indigo-400 italic">(modified)</span>}
                  <button
                    onClick={handleClearActiveView}
                    className="p-0.5 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 rounded"
                    title="Clear active view"
                  >
                    {X && <X size={14} />}
                  </button>
                </div>
              )}

              {/* v152: Save View button */}
              <button
                onClick={() => {
                  // v152: Set default saveMode based on whether a view is active
                  setSaveMode(activeViewId ? 'updateActive' : 'create');
                  setShowSaveViewModal(true);
                }}
                className="flex items-center gap-1 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-300"
                title="Save current view configuration"
              >
                {Save && <Save size={16} />}
                Save View
              </button>

              {/* v149: Load View dropdown - only show when saved views exist */}
              {currentSavedViews.length > 0 && (
                <div className="relative" ref={loadDropdownRef}>
                  <button
                    onClick={() => setShowLoadDropdown(!showLoadDropdown)}
                    className="flex items-center gap-1 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-300"
                  >
                    {FolderOpen && <FolderOpen size={16} />}
                    Load View
                    {ChevronDown && <ChevronDown size={14} className="ml-1" />}
                  </button>

                  {showLoadDropdown && (
                    <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[280px]">
                      <div className="py-1 max-h-64 overflow-y-auto">
                        {currentSavedViews.map((view) => (
                          <button
                            key={view.id}
                            onClick={() => handleLoadView(view)}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                          >
                            <span className="text-gray-400">•</span>
                            <span className="truncate flex-1">{view.name}</span>
                            <span className="flex gap-1 ml-2">
                              {view.scope && view.scope !== 'board' && (
                                <span className="text-xs text-gray-400">{view.scope === 'all' ? 'All WC' : 'WC'}</span>
                              )}
                              {view.columns && <span className="text-xs text-blue-400">{view.columns.length}c</span>}
                              {view.filters && countFilters(view.filters) > 0 && (
                                <span className="text-xs text-indigo-400">{countFilters(view.filters)}f</span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="border-t border-gray-200 bg-gray-50 p-1 rounded-b-lg">
                        <button
                          onClick={() => {
                            setShowLoadDropdown(false);
                            setShowManageViewsModal(true);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 rounded font-medium"
                        >
                          Manage saved views...
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-4">
              {/* v128: Selection actions */}
              {selectedTickets.size > 0 && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600">{selectedTickets.size} selected</span>
                  <button
                    onClick={handleOpenBulkEdit}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg font-medium"
                  >
                    {Edit2 && <Edit2 size={14} />}
                    Edit
                  </button>
                  <button
                    onClick={handleCopyIds}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
                  >
                    {Copy && <Copy size={14} />}
                    Copy IDs
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    {Trash2 && <Trash2 size={14} />}
                    Delete
                  </button>
                </div>
              )}

              {/* v129: Filter legend - more prominent */}
              {Object.keys(activeFilters).length > 0 && (
                <span className="text-sm text-gray-600 bg-indigo-50 px-2 py-1 rounded">
                  <span className="text-indigo-600 font-bold">*</span> = filtered
                </span>
              )}
            </div>
          </div>
        </div>

        {/* v133: Active Filters Bar */}
        <ActiveFiltersBar />

        {/* Table */}
        <div className="flex-1 p-6 min-h-0">
          <div className="h-full bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="h-full overflow-auto">
              <table ref={tableRef} className="min-w-full divide-y divide-gray-200" style={{ minWidth: 'max-content' }}>
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={sortedTickets.length > 0 && selectedTickets.size === sortedTickets.length}
                        onChange={handleSelectAll}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                    {visibleColumns.map((colId, index) => (
                      <SortHeader key={colId} columnId={colId} index={index} />
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedTickets.map((ticket, index) => {
                    const isLastOpened = ticket.id === lastOpenedTicketId;

                    return (
                      <tr
                        key={ticket.id}
                        className={`hover:bg-gray-50 cursor-pointer ${isLastOpened ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200' : ''}`}
                        onClick={(e) => handleRowClick(ticket, e)}
                        onContextMenu={(e) => {
                          // v160: Right-click context menu
                          if (onContextMenu) {
                            onContextMenu(ticket, e, { context: 'table' });
                          }
                        }}
                      >
                        <td className="px-4 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedTickets.has(ticket.id)}
                            onChange={(e) => handleSelectTicket(ticket.id, index, e.nativeEvent.shiftKey)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        {visibleColumns.map((colId) => {
                          const width = columnWidths[colId] || getColumnDefinition(colId)?.defaultWidth || 120;
                          const cellContent = renderCellContent(ticket, colId);
                          // v149 BUG FIX: Get raw text for title tooltip on potentially truncated content
                          const rawValue = getColumnValue(ticket, colId);
                          // Show tooltip for text content that might be truncated
                          // Key columns that commonly have long text: _summary, description, urls, emails
                          const isTextColumn =
                            ['_summary', 'description'].includes(colId) ||
                            getColumnDefinition(colId)?.type === 'text' ||
                            getColumnDefinition(colId)?.type === 'url' ||
                            getColumnDefinition(colId)?.type === 'textarea';
                          const titleText =
                            isTextColumn && typeof rawValue === 'string' && rawValue ? rawValue : undefined;

                          return (
                            <td key={colId} className="px-4 py-3 text-sm" style={{ width, maxWidth: width }}>
                              <div className="truncate" title={titleText}>
                                {cellContent}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {sortedTickets.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-gray-500">{searchTerm ? 'No tickets match your search.' : 'No tickets found.'}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 bg-white border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Close
          </button>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  Delete {selectedTickets.size} Ticket{selectedTickets.size !== 1 ? 's' : ''}
                </h3>
              </div>
              <div className="px-6 py-4">
                <div className="flex items-start gap-3 mb-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                    <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 mb-2">
                      This will permanently delete{' '}
                      <strong>
                        {selectedTickets.size} ticket{selectedTickets.size !== 1 ? 's' : ''}
                      </strong>
                      . This action cannot be undone.
                    </p>
                    <p className="text-sm text-gray-600">
                      Type <strong className="text-red-600">delete them all</strong> to confirm:
                    </p>
                  </div>
                </div>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="Type here to confirm..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  autoFocus
                />
              </div>
              <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmText('');
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={deleteConfirmText.toLowerCase() !== 'delete them all'}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${
                    deleteConfirmText.toLowerCase() === 'delete them all'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-gray-300 cursor-not-allowed'
                  }`}
                >
                  Delete Tickets
                </button>
              </div>
            </div>
          </div>
        )}

        {showBulkEditPanel && <BulkEditPanel />}
        {showColumnPicker && <ColumnPickerModal />}

        {/* v152: Save View Modal - Redesigned with three options */}
        {/* When active view: Update Active | Update Other | Create New */}
        {/* When no active view: Update Existing | Create New */}
        {showSaveViewModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Save View</h2>
                <button
                  onClick={() => {
                    setShowSaveViewModal(false);
                    setSaveViewName('');
                    setUpdateExistingViewId('');
                    setSaveViewError('');
                    setSaveMode(activeViewId ? 'updateActive' : 'create');
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  {X && <X size={20} />}
                </button>
              </div>

              <div className="p-6">
                {/* v152: Option 1 - Update active view (only when a view is loaded) */}
                {activeViewId && (
                  <label className="flex items-start gap-3 mb-3 cursor-pointer">
                    <input
                      type="radio"
                      name="saveMode"
                      checked={saveMode === 'updateActive'}
                      onChange={() => {
                        setSaveMode('updateActive');
                        setUpdateExistingViewId('');
                        setSaveViewName('');
                        setSaveViewError('');
                      }}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-900">Update "{activeViewName}"</span>
                      {isViewModified && <span className="ml-2 text-xs text-amber-600">(has changes)</span>}
                    </div>
                  </label>
                )}

                {/* v152: Option 2 - Update a different view (only when saved views exist) */}
                {currentSavedViews.length > 0 && (
                  <label className="flex items-start gap-3 mb-3 cursor-pointer">
                    <input
                      type="radio"
                      name="saveMode"
                      checked={saveMode === 'updateOther'}
                      onChange={() => {
                        setSaveMode('updateOther');
                        setSaveViewName('');
                        setSaveViewError('');
                      }}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-900">
                        {activeViewId ? 'Update a different view' : 'Update existing view'}
                      </span>
                      {saveMode === 'updateOther' && (
                        <div className="mt-2">
                          <select
                            value={updateExistingViewId}
                            onChange={(e) => setUpdateExistingViewId(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            <option value="">Select a view...</option>
                            {currentSavedViews
                              .filter((v) => !activeViewId || v.id !== activeViewId) // Exclude active view when one is loaded
                              .map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name}
                                </option>
                              ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </label>
                )}

                {/* v152: Option 3 - Create new view */}
                <label className="flex items-start gap-3 mb-4 cursor-pointer">
                  <input
                    type="radio"
                    name="saveMode"
                    checked={saveMode === 'create'}
                    onChange={() => {
                      setSaveMode('create');
                      setUpdateExistingViewId('');
                      setSaveViewError('');
                    }}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-900">Create new view</span>
                    {saveMode === 'create' && (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={saveViewName}
                          onChange={(e) => {
                            setSaveViewName(e.target.value);
                            setSaveViewError('');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && saveViewName.trim()) handleSaveView();
                          }}
                          placeholder="e.g., My Active Work"
                          className={`w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${
                            saveViewError ? 'border-red-300' : 'border-gray-300'
                          }`}
                          autoFocus={saveMode === 'create'}
                        />
                        {saveViewError && <p className="mt-1 text-sm text-red-600">{saveViewError}</p>}
                      </div>
                    )}
                  </div>
                </label>

                {/* v149: View configuration summary */}
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                    <span className="text-sm font-medium text-gray-700">View configuration to save</span>
                  </div>
                  <div className="p-3 space-y-2">
                    {/* Scope */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Scope</span>
                      <span className="text-sm font-medium text-gray-900">
                        {scope === 'all'
                          ? 'All Work Centres'
                          : scope === 'workcentre'
                            ? 'This Work Centre'
                            : 'This Board'}
                      </span>
                    </div>

                    {/* Columns */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Columns</span>
                      <span className="text-sm font-medium text-blue-600">{visibleColumns.length} columns</span>
                    </div>

                    {/* Sort */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Sort</span>
                      <span className="text-sm font-medium text-gray-900">
                        {getColumnDefinition(sortColumn)?.label || sortColumn} ({sortDirection === 'asc' ? '↑' : '↓'})
                      </span>
                    </div>

                    {/* Filters */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Filters</span>
                      <span className={`text-sm font-medium ${hasFiltersActive ? 'text-indigo-600' : 'text-gray-400'}`}>
                        {hasFiltersActive
                          ? `${Object.keys(activeFilters).length} filter${Object.keys(activeFilters).length !== 1 ? 's' : ''}`
                          : 'None'}
                      </span>
                    </div>

                    {/* Filter details if any */}
                    {hasFiltersActive && (
                      <div className="pt-2 mt-2 border-t border-gray-100">
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {Object.entries(activeFilters).map(([columnId, filterValue]) => {
                            const colDef = getColumnDefinition(columnId);
                            const columnLabel = colDef?.label || columnId;
                            const displayValue = getFilterDisplayValue(columnId, filterValue);

                            return (
                              <div key={columnId} className="text-xs text-gray-500">
                                <span className="font-medium">{columnLabel}:</span> {displayValue}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
                <button
                  onClick={() => {
                    setShowSaveViewModal(false);
                    setSaveViewName('');
                    setUpdateExistingViewId('');
                    setSaveViewError('');
                    setSaveMode(activeViewId ? 'updateActive' : 'create');
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveView}
                  disabled={
                    (saveMode === 'create' && !saveViewName.trim()) ||
                    (saveMode === 'updateOther' && !updateExistingViewId)
                  }
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saveMode === 'updateActive'
                    ? `Update "${activeViewName}"`
                    : saveMode === 'updateOther'
                      ? 'Update View'
                      : 'Save View'}
                </button>
              </div>
            </div>
          </div>
        )}

        <ManageViewsModal />
        <MissingColumnsModal />
      </div>
    );
  };

  // Export to window
  window.Components = window.Components || {};
  window.Components.AllTicketsView = AllTicketsView;

  // v153: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['all-tickets-view'] = COMPONENT_VERSION;

  console.log(`[all-tickets-view.jsx] AllTicketsView loaded (${COMPONENT_VERSION})`);
})();

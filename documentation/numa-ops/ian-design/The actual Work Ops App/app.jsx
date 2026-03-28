/**
 * Numa Ops Management - v188
 * Date: 2026-01-27
 *
 * v188 Changes:
 * - BUG-187-001 FIX: "New Customer/Supplier" in Global Settings now works
 *   - Root cause: Detail Modals were rendered inside Work Centre view branch
 *   - When in admin view, Detail Modals had no mount point
 *   - Fix: Moved Detail Modal renders to global modals section (after ternary)
 *
 * - BUG-187-002 FIX: Removed duplicate GlobalSettingsModal render
 *   - Was rendered twice: once inside opcentre view, once in global section
 *   - Removed the one inside opcentre view
 *
 * - BUG-187-003 FIX: Detail Modal now appears ON TOP of Global Settings
 *   - Detail Modals now render AFTER GlobalSettingsModal in DOM
 *   - Proper z-index stacking when opening from Global Settings
 *
 * - ENHANCEMENT: Added "+ New Customer" button to CRM Mirror
 *   - New prop: onCreateCustomer passed to CrmMirror
 *
 * - ENHANCEMENT: Added "+ New Supplier" button to Supplier Mirror
 *   - New prop: onCreateSupplier passed to SupplierMirror
 *
 * v187 Changes:
 * - UNIFIED ENTITY EDITING: Rich Detail Modal used everywhere
 *
 *   REMOVED:
 *   - showCustomerModal, showSupplierModal state (basic modals no longer used)
 *   - customerFormData, supplierFormData state (Detail Modal has inline editing)
 *   - editingCustomer, editingSupplier state (not needed)
 *   - handleEditCustomer(), handleEditSupplier() (were opening basic modals)
 *   - handleSubmitCustomer(), handleSubmitSupplier() (basic modal submits)
 *   - CustomerModal, SupplierModal renders
 *   - CustomerModal, SupplierModal imports from EntityModals
 *   - onEdit prop from CustomerDetailModal/SupplierDetailModal (no "Full Edit" button)
 *
 *   ADDED:
 *   - handleCreateCustomer() - creates new customer record and opens Detail Modal
 *   - handleCreateSupplier() - creates new supplier record and opens Detail Modal
 *   - onCreateCustomer, onCreateSupplier props to GlobalSettingsModal
 *   - onOpenCustomerDetail prop to GlobalSettingsModal
 *
 *   BEHAVIOUR:
 *   - Global Settings "New Customer/Supplier" → creates record, opens Detail Modal
 *   - Global Settings edit button → opens Detail Modal
 *   - Mirror card click → opens Detail Modal (unchanged)
 *   - Detail Modal is THE editor (no "Full Edit" escape hatch)
 *
 * v186 Changes:
 * - BUG-185-001 FIX: Customer Detail Modal showing "supplier is undefined"
 *   - Root cause: Function name collision between customer-detail-modal.jsx and supplier-detail-modal.jsx
 *   - Fix: Renamed all shared components in supplier-detail-modal.jsx with Supplier prefix
 *
 * v185 Changes:
 * - BUG-184-001 FIX: Supplier Mirror not rendering
 *   - Removed {SupplierMirror && ...} guard that caused silent failure
 *   - Now matches CrmMirror pattern (direct render without guard)
 *   - Issue: SupplierMirror captured at module load was undefined due to script order
 *
 * v184 Changes:
 * - SUPPLIER MANAGEMENT: Supplier Mirror integration
 *   - NEW: Load SupplierMirror from window.Components.SupplierMirror
 *   - NEW state: highlightedSupplierId, supplierDropTarget
 *   - NEW handler: handleSupplierDragOver() for drag indicators
 *   - NEW handler: openSupplierDetailModal() for card clicks
 *   - Board tabs show "Suppliers" tab when supplierMirror.enabled
 *   - Migration: Add supplierMirror: null to existing boards
 *   - SupplierMirror component renders on activeSection === 'supplier-mirror'
 *   - Drag-drop updates supplier stage/territory/owner globally
 *
 * v183 Changes:
 * - SUPPLIER MANAGEMENT: SupplierModal added to match CustomerModal pattern
 *   - Destructure SupplierModal from window.Components.EntityModals
 *   - Pass SupplierModal prop to GlobalSettingsModal
 *   - See entity-modals.jsx v183a for SupplierModal component
 *   - See global-settings-modal.jsx v183b for modal integration
 *
 * v182 Changes:
 * - SUPPLIER MANAGEMENT Session 3 (Delivery 1+2): Inline Editing
 *   - SupplierDetailModal now receives onUpdateSupplier prop for inline edits
 *   - Enables inline editing of: Company Details, Commercial, Contacts, Activities
 *   - See supplier-detail-modal.jsx v182a for full implementation
 *
 * v181 Changes:
 * - SUPPLIER MANAGEMENT Session 2: Supplier Config + Detail Modal
 *   - NEW state: supplierDetailModal { isOpen, supplierId }
 *   - NEW handler: openSupplierDetailModal(supplier) - opens detail view
 *   - NEW handler: closeSupplierDetailModal() - closes detail view
 *   - NEW handler: handleUpdateSupplier(supplierId, updates) - inline updates
 *   - SupplierDetailModal component rendered with proper props
 *   - GlobalSettingsModal receives onOpenSupplierDetail prop
 *
 * v180 Changes:
 * - SUPPLIER MANAGEMENT Session 1: Foundation
 *   - Migration: Add supplierConfig if missing (parallel to crmConfig)
 *   - Migration: Add globalSuppliers array if missing
 *   - NEW: getGlobalSuppliers() helper function
 *   - NEW: updateGlobalSupplier() for inline updates
 *   - NEW: addGlobalSupplier() for creating new suppliers
 *   - NEW: deleteGlobalSupplier() for removing suppliers
 *   - window.allSuppliers exposed for global access
 *   - Global Settings Modal receives supplier handlers
 *
 * v179 Changes:
 * - BUG-178-001 FIX: Deduplicate inverse links (ticket-modals.jsx v179a)
 *   When reciprocal link exists directly, skip the inverse lookup to avoid duplicates
 *
 * v178 Changes:
 * - RECIPROCAL LINKS: When adding depends-on, auto-creates blocks on target (and vice versa)
 * - NEW: handleLinkAdded() - creates reciprocal link on target ticket
 * - NEW: handleLinkRemoved() - removes reciprocal link from target ticket
 * - NEW: handleOpenLinkedTicket() - opens linked ticket in modal
 * - NEW: getReciprocalLinkType() - looks up reciprocal from linkConfig
 * - Passed onLinkAdded, onLinkRemoved, onOpenLinkedTicket to TicketModal
 *
 * v177 Changes:
 * - LINKED TICKETS FEATURE (Phases L1-L3):
 *   - ticket-modals.jsx: New LinkedTicketsSection component
 *   - ticket-modals.jsx: New AddLinkModal for cross-board ticket linking
 *   - initial-data-core.js: Added linkConfig with 3 link types (blocks, depends-on, related-to)
 *   - Tickets can now have links[] array with typed relationships
 *   - Inverse links displayed automatically (blocked-by, required-for)
 *   - Blocked indicator shown when dependencies unresolved
 *   - Sample links added to test data (FEAT-001, TASK-001, SRQ-004)
 *
 * v176 Changes:
 * - CRM PHASE 6: Mixed Filtering (client.* fields)
 *   - AllTicketsView: New "Customer Filters" dropdown in toolbar
 *   - Filter tickets by customer attributes: stage, territory, owner, industry, size
 *   - Added CUSTOMER_FILTER_FIELDS for virtual customer columns
 *   - Added NO_CUSTOMER filter option for tickets without client assigned
 *   - Filter options derived from globalCRM data and crmConfig
 *   - Customer filters appear in Active Filters Bar with labels
 *   - Tickets without client: excluded from client.* filters (except NO_CUSTOMER)
 *
 * v175 Changes:
 * - CRM PHASE 5: Documents, Edit Mode, Linked Work Enhancement
 *   - CustomerDetailModal: Inline edit for Company Details, Contract, Account Notes
 *   - CustomerDetailModal: Documents Add/Edit/Delete (CRUD)
 *   - CustomerDetailModal: "Notes" renamed to "Account Notes"
 *   - Linked Work: Click ticket row opens TicketModal with modal stacking
 *   - Modal stacking: CustomerDetailModal stays open while viewing ticket
 *   - NEW prop: onTicketClick for Linked Work click-through
 *   - NEW state: ticketOpenedFromCustomer for modal stacking z-index
 *   - BUG-174-001 FIX: Delete icons now use Trash2 for consistency
 *
 * v174 Changes:
 * - CRM PHASE 4: Contact & Activity Management
 *   - CustomerDetailModal now receives onUpdateCustomer prop for inline editing
 *   - Contacts: Add/Edit/Delete inline, toggle Primary/VIP (multiple allowed)
 *   - Activities: Add/Edit/Delete inline with type, outcome, duration
 *   - CRM Mirror receives totalCustomerCount for filtered header display
 *   - BUG-173-001 FIX: CRM Mirror header shows "X of Y customers" when filtered
 *
 * v173 Changes:
 * - BUG-171-001b FIX: Primary Contact fields now pre-populated in Edit mode
 *   - handleEditCustomer extracts primary contact from contacts[] array
 *   - Falls back to first contact if no primary, then to flat customer fields
 *   - Populates mainContact, mainNumber, email correctly
 *
 * v172 Changes:
 * - BUG-171-001 FIX: handleEditCustomer now populates ALL CRM fields for Edit mode
 *   - Added: companySize, source, territory, accountOwnerId, stage
 *   - Added: contractValue, contractTerm, contractStart, renewalDate
 *   - Added: products, flags, contacts
 *   - customerFormData initial state updated to match
 *
 * v171 Changes:
 * - BUG FIXES for CRM Phase 1-3:
 *   - Pass company prop to CustomerModal for crmConfig/globalStaff access
 *   - See v171a-entity-modals.jsx for CustomerModal field fixes
 *   - See v171b-customer-detail-modal.jsx for stage display fix
 *   - See v171c-global-settings-modal.jsx for color and form fixes
 *
 * v170 Changes:
 * - CRM PHASE 3: CRM Mirror on Boards
 *   - New component: crm-mirror.jsx (v170a)
 *   - Board Settings: "CRM Mirror" tab with filter/display config
 *   - CRM tab in board view when enabled
 *   - Drag-drop customer between columns updates stage/territory/owner
 *   - Click customer card opens Customer Detail Modal (Phase 2)
 *   - board.crmMirror data structure: { enabled, filter, groupBy, sortBy, sortOrder }
 *   - Migration adds crmMirror: null to existing boards
 *
 * v169 Changes:
 * - CRM PHASE 2: Customer Detail Modal (View Mode)
 *   - New component: customer-detail-modal.jsx (v169a)
 *   - Sections: Company Details, Contract, Contacts, Linked Work, Activities, Documents, Notes
 *   - Clicking customer card now opens detail modal (view only)
 *   - Customer flags display in modal header
 *   - Linked Work shows tickets across all Work Centres
 *   - Edit mode deferred to Phase 5
 *   - State: customerDetailModal { isOpen, customerId }
 *   - Handlers: openCustomerDetailModal, closeCustomerDetailModal
 *
 * v168 Changes:
 * - CRM PHASE 1: Configuration data model and Global Admin UI
 *   - Added company.crmConfig with lifecycleStages, customerFlags, documentTypes
 *   - Migration adds default crmConfig if missing
 *   - Lifecycle stages use 10-point color scale (via color-utils.js)
 *   - Default stages: Prospect, Active, At Risk, Churned
 *   - Default flags: VIP, Strategic
 *   - Default document types: Contract, SOW, Proposal, NDA, Other
 *
 * v167 Changes:
 * - DEV TOOL: Targeted JSON Extractor - extract specific subsets of data for debugging
 *   - Single ticket by ID (e.g., "TASK-067")
 *   - Single board + its tickets
 *   - Single Work Centre + boards + tickets
 *   - All tickets matching status filter (e.g., "deleted")
 *   - Reduces chat context consumption vs full data export (~283 tickets)
 *   - Modal interface with dropdowns and copy-to-clipboard
 *   - Accessible from Admin Panel test tools
 *
 * v166 Changes:
 * - BUG-163-002 FIX: Context menu in All Tickets view now works
 *   - Root cause: The document-level 'contextmenu' listener added when menu opened
 *     was catching the same right-click event that opened the menu, immediately closing it
 *   - Fix: Removed 'contextmenu' listener from click-outside effect; mousedown is sufficient
 *
 * v165 Changes:
 * - BUG FIX: Off-by-one error in positional drag-drop when dragging DOWNWARD
 *   - When dragging item from index N to position M (where N < M), result was one position too late
 *   - Root cause: handleDrop filtered out dragged item BEFORE calling calculateDropOrder,
 *     so calculateDropOrder couldn't find the original index to calculate the adjustment
 *   - Fix: Calculate adjustment in handleDrop BEFORE calling calculateDropOrder
 *   - Applied to BOTH ticket drag-drop AND CRM customer drag-drop
 *   - Example: Dragging from position 1 to between positions 4 and 5 now works correctly
 *
 * v164 Changes:
 * - BROKEN: Attempted fix for off-by-one that didn't work (fix was in wrong place)
 *
 * v163 Changes:
 * - POSITIONAL DRAG-DROP: Tickets and Customers can be dropped at specific positions
 *   - Visual drop indicator (blue line) shows insertion point during drag
 *   - Drag within same column: respects drop position
 *   - Drag to different column: goes to bottom (per design decision)
 *   - All move operations set highlight on moved item (clears on click)
 *   - Works for both ticket boards (Kanban/Backlog) AND CRM zones
 * - ORDER SYSTEM: Uses 1000-increment integers for order field
 *   - Allows ~10+ insertions between any two items
 *   - Auto-rebalances when gap < 10 (reassigns 1000, 2000, 3000...)
 * - CONTEXT MENU MOVE: Up/Down now swap orders with adjacent ticket
 *   - To Top/Bottom use order calculation
 *   - All context menu moves set highlight
 * - New state: dropTarget, highlightedTicketId, highlightedCustomerId
 * - New handlers: handleTicketDragOver, handleCustomerDragOver
 * - Updated: handleDrop, handleContextMenuMove, handleContextMenuMoveToZone, handleContextMenuChangeStatus
 * - Updated: getFilteredItems now sorts CRM customers by order field
 *
 * v162 Changes:
 * - BUG 166-001 FIX: Submenu hover gap - removed ml-1, added invisible bridge (-ml-2 pl-2)
 *   - Assign to, Move, and Change Status submenus now stay visible during diagonal mouse movement
 * - BUG 165-001 FIX: "Assign to Me" now looks up staff name from currentUser ID
 *   - No longer uses literal 'current-user' string
 * - BUG 164-001 FIX: Ticket ordering within columns now works
 *   - getFilteredItems() now sorts by order field (unordered tickets go to end, then by ID)
 *   - New tickets created at bottom of column (order = maxOrder + 1)
 *   - Drag-drop places tickets at bottom of target column
 *   - Move to Zone places tickets at bottom of target column
 *   - Change Status places tickets at bottom of target column
 *   - handleContextMenuChangeStatus also uses currentUser instead of 'current-user'
 *
 * v161 Changes:
 * - BUG 167-001 FIX: handleContextMenuMoveToZone now updates ALL location fields
 *   - Previously only updated: sectionId, column
 *   - Now also updates: zoneId, status, workUnitId, updatedAt
 *   - Uses structured history format (matching sprint-start pattern)
 *   - workUnitId cleared when moving to backlog, set when moving to sprint zone
 *
 * v160 Changes:
 * - BUG 163-001 FIX: Right-click context menu now works in All Tickets view
 *   - Added onContextMenu prop to AllTicketsView
 *   - Context menu tracks 'context' field ('board' | 'table')
 *   - "Move within column" options (To top, Up, Down, To bottom) greyed out in table context
 *   - All other actions work: Assign, Move to Zone, Change Status, Copy Link, Delete
 *
 * v159 Changes:
 * - RIGHT-CLICK CONTEXT MENU: Added context menu for tickets on boards
 *   - Assign to Me / Assign to [user]
 *   - Move: To top, Up, Down, To bottom, To other zone first stage
 *   - Change Status: Board stages with canonical disambiguation
 *   - Copy Ticket Link
 *   - Delete: Soft-delete using 'deleted' status type
 * - SOFT DELETE: handleDeleteTicket now sets status to 'deleted' instead of removing
 * - TicketContextMenu component added
 *
 * v158 Changes:
 * - BUG 161-001 FIX: Pass currentBoardId and currentZoneId to TicketSuccessModal
 *   - Modal now knows if user is already viewing the ticket's location
 *   - Shows context-aware buttons (Done vs View on Board / Stay Here)
 *
 * v157 Changes:
 * - ARCHITECTURE: Start Sprint adds zone to SAME board (not create/select different board)
 *   - Mental model: One board with multiple zones (backlog + active sprint)
 *   - Simpler UX: No board selection dropdown, no "create new board" option
 *   - Removed handleCreateBoardAndStart function entirely (no longer needed)
 *   - Simplified handleStartWorkUnit: removed destinationBoardId parameter
 *   - Simplified handleOpenStartWorkUnitModal: removed board matching logic
 *   - Updated StartWorkUnitModal props: removed matchingBoards, allOtherBoards, onCreateBoard
 *   - Zone is always added to the board that owns the workUnitSeries
 *
 * v156 Changes:
 * - BUG-155-001 FIX: Board tabs not clickable for simple boards
 *   - Root cause: Board tab container had no onClick handler
 *   - Simple boards hid zone buttons, leaving nothing to click
 *   - Fix: Added onClick to board tab div that selects board + default zone
 *   - Added cursor-pointer class for visual feedback
 *   - Added e.stopPropagation() to zone buttons to prevent bubbling
 * - BUG-155-002 FIX: NUMA board (and similar) incorrectly detected as simple board
 *   - Root cause: isSimpleBoardCheck only checked workUnitSeries.enabled
 *   - NUMA board has no workUnitSeries but DOES have zones with workUnitId
 *   - Fix: isSimpleBoardCheck now also checks for zones with workUnitId
 *   - Boards with work unit zones are NOT simple boards
 * - BUG-155-003 FIX: "Go to [WorkUnit]" button not navigating
 *   - Root cause: Button only called setActiveBoard, not setActiveSection
 *   - Fix: Now also sets activeSection to the active work unit's zone
 *
 * v155 Changes:
 * - PROGRESSIVE PRESENTATION: Hide zones for simple boards
 *   - Phase 1: Added isSimpleBoardCheck() helper function
 *   - Phase 3: Zone tabs hidden for boards without work units
 *   - Simple boards auto-select their single zone
 *   - Work unit boards continue to show full zone tabs
 *
 * v154 Changes:
 * - LIFECYCLE DATE: Added scopedAt - tracks when ticket first committed to work unit
 *   - Trigger 1: Status changes to 'scoped', 'queued', or 'active' type
 *   - Trigger 2: workUnitId assigned (from null to a value)
 *   - scopedAt is permanent once set (never cleared, like startedAt)
 *   - Enables "Queue Time" metric: startedAt - scopedAt
 * - Updated handleTicketSubmit, handleBulkUpdateTickets, handleDrop for workUnitId trigger
 * - Uses updated getLifecycleDateUpdates from domain/statuses.js v154
 *
 * v153 Changes:
 * - VERSION SYNC: Aligning app.jsx version with all-tickets-view.jsx and ticket-modals.jsx (all now v153)
 * - No functional changes from v151
 *
 * v151 Changes:
 * - SAVED VIEWS: Renamed savedFilterSets → savedViews throughout
 *   - Views now save complete configuration: filters, scope, columns, columnWidths, sort
 *   - handleSavedViewsChange replaces handleSavedFilterSetsChange
 *   - Storage keys: board.savedViews, company.globalSavedViews
 *   - Props: boardSavedViews, globalSavedViews, onSavedViewsChange
 *   - Backward compatible with old filter-only saved sets
 *
 * v150 Changes:
 * - BUG-149-001 FIX: Bulk Edit now properly clears/sets workUnitId when changing stages
 *   - Previously only handled cross-board moves, missed within-board stage changes
 *   - Now determines correct workUnitId from target zone/stage (same logic as drag-drop)
 *   - Checks zone.workUnitId first (active zones), then stage.workUnitId (backlog stages)
 *   - Records history entry when workUnitId changes
 *
 * v149 Changes:
 * - BUG-148-001 FIX: Start Sprint causes blank screen (regression)
 *   - Root cause: WorkUnitSuccessModal expected direct props but received `info` wrapper
 *   - Fix 1: Include `series` in workUnitSuccessInfo (handleStartWorkUnit)
 *   - Fix 2: Include `series` in workUnitSuccessInfo (handleCreateBoardAndStart)
 *   - Fix 3: Pass props directly to WorkUnitSuccessModal instead of info wrapper
 *
 * v146 Changes:
 * - BUG-145-001 FIX: Firefox drag not working on kanban/backlog boards
 *   - Applied same fix as all-tickets-view.jsx (v124)
 *   - setData() called FIRST before state updates
 *   - State update deferred with setTimeout
 *   - This enables drag-and-drop in Firefox for ticket cards
 *
 * v144 Changes:
 * - LIFECYCLE DATES: Auto-populate startedAt, completedAt, endedAt on status changes
 *   - startedAt: Set on first entry to 'queued' or 'active' type (permanent)
 *   - completedAt: Set on 'completed' type, cleared if reopened
 *   - endedAt: Set on 'ended' type, cleared if reopened
 * - Updated to use 6-type status model from domain/statuses.js
 * - Added getLifecycleDateUpdates import from Domain.Statuses
 * - Updated handleTicketSubmit, handleBulkUpdateTickets, and drag-drop handlers
 *
 * v143 Changes:
 * - Added _completed system column for ticket completion date
 *   (Changes in all-tickets-view.jsx only)
 *
 * v142 Changes:
 * - PHASE-6.5f-5: Custom Date Range Picker
 *   - Added "This Quarter" preset to date filter
 *   - Custom date options: Before, After, Between (with Apply button)
 *   - Before: exclusive (< date), After: inclusive (≥ date)
 *   - Between: inclusive both ends (from ≤ x ≤ to)
 *   - Radio button UI - switching modes clears previous values
 *   (Changes in all-tickets-view.jsx only)
 *
 * v141 Changes:
 * - BUG-138-001 FINAL: Operator dropdown in text filter now works
 *   - Removed onBlur from text input (was preventing select dropdown from opening)
 *   - Filter applies on Enter only (more intuitive)
 *   (Changes in all-tickets-view.jsx only)
 *
 * v140 Changes:
 * - BUG-138-001 PARTIAL: Text filter sort buttons now work
 *   (Changes in all-tickets-view.jsx only)
 *
 * v139 Changes:
 * - BUG-138-002 FIX: Saved filter storage now based on entry point (board vs admin), not scope
 *   - If entered from board: ALL filters saved to board.savedFilterSets (regardless of scope view)
 *   - If entered from admin: ALL filters saved to company.globalSavedFilterSets
 *   - handleSavedFilterSetsChange now takes entryPoint parameter instead of scope
 *   (Changes in app.jsx + all-tickets-view.jsx)
 *
 * v138 Changes:
 * - BUG-136-002 FIX: Test Tools "Current User" dropdown uses staff ID not name
 *   (Changes in admin-components.jsx)
 *
 * v137 Changes:
 * - BUG-136-001 FIX: Save at All Work Centres scope now works from board context
 *   - Pass both boardSavedFilterSets and globalSavedFilterSets to AllTicketsView
 *   - Component chooses which to use based on current scope selection
 * - Changed currentUser default to staff ID ('staff-blue')
 *   (Changes in app.jsx + all-tickets-view.jsx)
 *
 * v136 Changes:
 * - BUG-135-001 FIX: Save modal input focus loss (inline JSX instead of nested component)
 * - BUG-135-002 FIX: Scope stored with saved filter, loading switches to saved scope
 * - UX-135-001: "Assigned to Me" option at top of Assignee filter dropdown
 * - UX-135-002: Save modal redesigned with radio buttons (Create new / Update existing)
 * - Added currentUser prop to AllTicketsView for "Assigned to Me" filter
 *   (Changes in all-tickets-view.jsx + app.jsx)
 *
 * v135 Changes:
 * - BUG-134-001 FIX: Prevent duplicate filter names (validation in save modal)
 * - BUG-134-002 FIX: Can update existing filter (dropdown to select existing)
 * - UX-134-001: Button labels "Save Filter" / "Load Filter"
 * - UX-134-002: Title shows scope context (All Tickets – WC / Board)
 *   (Changes in all-tickets-view.jsx)
 *
 * v134 Changes:
 * - PHASE-6.5f-4: Saved Filter Sets + Text Filter Operators
 *   - Text filter operators: contains, not contains, equals, not equals
 *   - Text filter data model: { op: 'contains', value: 'text' }
 *   - Backward compatible with bare strings
 *   - Save Filter modal to persist current filters with a name
 *   - Load dropdown to quick-apply saved filter sets
 *   - Manage Filters modal to rename/delete saved filters
 *   - Save button visible when filters active
 *   - Load dropdown visible when saved filters exist
 *   - Storage: board.savedFilterSets / company.globalSavedFilterSets
 *   - Added handleSavedFilterSetsChange handler
 *   - Added savedFilterSets and onSavedFilterSetsChange props to AllTicketsView
 *   (Main changes in all-tickets-view.jsx)
 *
 * v132 Changes:
 * - BUG-131-001 FIX: Board/Work Centre columns now draggable at global scope
 *   (Scope-locking only prevents column removal, not reordering)
 *   (Changes in all-tickets-view.jsx)
 *
 * v131 Changes:
 * - UX: Drag grip only visible on column hover
 *   (Changes in all-tickets-view.jsx)
 *
 * v130 Changes:
 * - BUG-129-001 FIX: Asterisk now text-base (matches header height)
 * - BUG-129-002 FIX: Inline SVG grip icon (Lucide icon wasn't rendering)
 * - BUG-129-003 FIX: Drag ghost shows full column header
 * - UX-129-001: Filter dropdown taller (60vh max)
 *   (Changes in all-tickets-view.jsx)
 *
 * v129 Changes:
 * - BUG-128-001 FIX: Asterisk now properly sized (text-sm)
 * - BUG-128-002 FIX: Drag grip now visible in column headers
 * - BUG-128-003 FIX: "* = filtered" legend more prominent
 * - BUG-128-004 FIX: Clear filter works on text "contains" fields
 *   (Changes in all-tickets-view.jsx)
 *
 * v128 Changes:
 * - BUG-127-001 FIX: Clear filter now works on text "contains" filters
 * - UX: Filter dropdown tinted background (indigo-50)
 * - UX: Filter dropdown font consistency (text-xs)
 * - UX: Header drag zone separated (grip icon on right)
 * - UX: Larger asterisk indicator on filtered columns
 * - UX: "* = filtered" legend in toolbar (when filters active)
 *   (Changes in all-tickets-view.jsx)
 *
 * v127 Changes:
 * - PHASE-6.5f: Column Filtering (see all-tickets-view.jsx for details)
 *   - Click column header → filter dropdown with sort + filter options
 *   - Multi-select checkbox filters for applicable fields
 *   - Text "contains" filter for text fields
 *   - Date preset filters (Today, This Week, etc.)
 *   - Number range filters (min/max)
 *   - Asterisk (*) indicator on filtered column headers
 *   - Filter persistence in viewConfig.activeFilters
 *   - Support for empty/null value filtering
 *
 * v126 Changes:
 * - BUG-125-001 FIX: Auto-remove location columns when scope narrows
 *   - Scope → Board: removes _board and _workCentre
 *   - Scope → Work Centre: removes _workCentre
 * - BUG-125-002 FIX: Reset to Defaults keeps modal open
 *   (Changes in all-tickets-view.jsx)
 *
 * v125 Changes:
 * - BUG-124-001 FIX: activeOpCentreId now nulled for admin view
 *   - Matches activeBoardId pattern from v114
 *   - Prevents "This Work Centre" showing when opened from Global Admin
 *
 * v124 Changes:
 * - BUG-123-001 FIX: Hide invalid scope options when context unavailable
 *   - "This Board" only shown when activeBoardId exists
 *   - "This Work Centre" only shown when activeOpCentreId exists
 * - BUG-123-002 FIX: Added workUnitId to FIELD_DUPLICATES + filter persisted columns
 *   - Prevents duplicate "Work Unit" columns
 * - BUG-123-003 FIX: Column Picker modal now max-w-5xl (wider)
 * - BUG-123-004 FIX: Cross-browser drag compatibility (Firefox)
 *   - setTimeout for state updates in drag handlers
 *   - Explicit dropEffect in dragOver
 *   - Fallback to dataTransfer in drop handler
 * - BUG-123-005 FIX: Scope locking now uses useCallback for dynamic updates
 *   (Changes in all-tickets-view.jsx)
 *
 * v123 Changes:
 * - Column Management Polish:
 *   - Hide duplicate field library fields (workUnit, title/name/summary)
 *   - Larger modal (h-[80vh]) to match other modals
 *   - Improved drag handle in modal (dedicated grip zone)
 *   - Drag indicator on table headers (grip icon on hover)
 *   - Scope-based locked columns (_board for WC, +_workCentre for All)
 *   - Reordered defaults: location after status, _updated at end
 *   (Changes in all-tickets-view.jsx)
 *
 * v122 Changes:
 * - Column Picker modal now has fixed dimensions (no resize on content change)
 * - Drag-and-drop column reorder in Column Picker modal
 * - Drag-and-drop column reorder in table headers
 * - Smart default columns based on board's ticket types
 * - _board only shown when scope > 'board'
 * - _workUnit only shown when workUnitSeries enabled
 * - Reset to Defaults uses smart defaults
 *   (Changes in all-tickets-view.jsx)
 *
 * v121 Changes:
 * - Added _createdBy system column to All Tickets View (placeholder)
 *   - Shows 'Current User' until auth system implemented
 *   (Changes in all-tickets-view.jsx)
 *
 * v120 Changes:
 * - Added missing _workCentre system column to All Tickets View column picker
 *   (Changes in all-tickets-view.jsx)
 *
 * v119 Changes:
 * - BUG-118-001 FIX: Column picker checkboxes now toggle correctly (local state)
 * - BUG-118-002 FIX: Added X button to clear column search field
 * - BUG-118-003 FIX: Column search field maintains focus while typing
 *   (Changes in all-tickets-view.jsx)
 *
 * v118 Changes:
 * - BUG-117-001 FIX: Cross-board moves via Bulk Edit now clear workUnitId
 *   - Work Units belong to specific boards; moving to different board invalidates the work unit
 *   - If workUnitId not explicitly set in changes and boardId changes, workUnitId is cleared
 *   - History records the work unit removal with reason 'bulk-edit'
 *
 * v117 Changes:
 * - BUG-116-001 FIX: Bulk Edit location history now captures opCentreId/opCentreName
 *   - Cross-Work Centre moves via Bulk Edit now show Work Centre name in history
 *   - Was missing from handleBulkUpdateTickets, causing history to show only Board→Zone→Stage
 *
 * v116 Changes:
 * - FEAT-116-001: Auto-create next work unit rollover option
 *   - When completing a sprint with no next planning sprint, offers "Create Next Sprint and Roll Over"
 *   - Automatically creates the next work unit, starts it, and moves incomplete tickets
 * - UX-116-001: History display shows board/work centre only when they change
 *   - Reduces clutter for same-board moves
 *   - Shows full path when crossing board or work centre boundaries
 * - handleDrop now captures boardId/boardName and opCentreId/opCentreName in history
 *
 * v115 Changes:
 * - BUG-095-002 FIX: Removed "Complete Sprint" button from active Work Unit zones
 *   - Work Unit completion should ONLY be triggered via "End Sprint X" button on the backlog board
 * - BUG-114-001 FIX: handleDrop now tracks history for drag-drop moves
 *   - Status changes, location changes, and work unit changes are now recorded
 * - BUG-114-002 FIX: handleDrop now checks zone.workUnitId before stage.workUnitId
 *   - Active Work Unit zones have workUnitId at zone level, not on individual stages
 *   - Tickets no longer lose their workUnitId when dragged between stages in active zones
 *
 * Changes in v114:
 * - BUG-112-001 FIX: All Tickets from Global Settings now correctly defaults to "All Work Centres"
 *   - Root cause: activeBoardId prop was always populated from last visited board
 *   - Fix: Pass null for activeBoardId when currentView === 'admin'
 *   - AllTicketsView's scope initialization now works correctly
 *
 * Changes in v113:
 * - PHASE-6.5d: Added ticket history tracking system
 *   - Tracks: created, status, assignee, location, workUnit changes
 *   - Records who made each change (userId, userName)
 *   - Records reason: manual, bulk-edit, rollover, sprint-start, sprint-complete
 *   - History viewable via "History" button in ticket modal footer
 * - Added createHistoryEntry helper function
 * - handleSubmitTicket: Records create and field change events
 * - handleBulkUpdateTickets: Records bulk edits with reason
 * - handleStartWorkUnit: Records sprint-start location changes
 * - handleCompleteWorkUnit: Records rollover events
 *
 * Changes in v112:
 * - BUG-111-001: All Tickets View from Global Settings defaults to "All Work Centres" scope
 *   - Change is in all-tickets-view.jsx
 *
 * Changes in v111:
 * - UX-111-001: Board column tooltip shows "Work Centre / Board" in All Work Centres view
 *   - Change is in all-tickets-view.jsx
 *
 * Changes in v110:
 * - UX-110-001: Moved navigation from "Back" button in header to "Close" button in footer
 *   - Consistent with Global Settings and other modal/view patterns
 *   - Header now cleaner with just title and scope selector
 *   - Change is in all-tickets-view.jsx
 *
 * Changes in v109:
 * - BUG-108-001: Fixed bulk delete - was calling individual delete with confirmation per ticket
 *   - Added handleBulkDeleteTickets(ticketIds) that deletes directly without individual confirmations
 *   - AllTicketsView handles the confirmation (type-to-confirm modal)
 *   - Added onBulkDeleteTickets prop to AllTicketsView
 *
 * Changes in v108:
 * - BUG-104-001 FINAL: Moved TicketModal render INSIDE AllTicketsView branch
 *   - When showAllTicketsView is true, modal renders as sibling in same fragment
 *   - This ensures proper stacking context regardless of browser rendering
 *   - Main modal render now excludes when showAllTicketsView is active
 *   - Modal now correctly appears over All Tickets View
 *
 * Changes in v107:
 * - Added APP_VERSION constant - version now displayed in UI
 * - Version shown in Admin Panel header (no more index-dev.html edits needed)
 *
 * Changes in v106:
 * - BUG-104-001 COMPLETE FIX: All Tickets View from Admin Panel
 *   - v105 removed view switching but modal still didn't appear
 *   - Part 1: ticket-modals.jsx now finds opCentre from editingTicket.opCentreId first
 *   - Part 2: Increased modal z-index from z-50 to z-[9999] to overlay All Tickets View
 *   - Modal now renders visually on top regardless of entry point
 *
 * Changes in v105:
 * - BUG-104-001 PARTIAL: Don't close All Tickets View when editing ticket
 *   - Modal opens on top, close returns to All Tickets View
 *   - Removed unnecessary view switching - modal just layers on top
 *
 * Changes in v104:
 * - BUG-103-001 FIX: Selection now persists when opening/closing ticket modal
 *   - Lifted selectedTickets state from AllTicketsView to app.jsx
 *   - Expanded checkbox "safe zone" to entire first cell (prevents accidental row click)
 * - UX-103-001: Shift+click range selection for checkboxes
 *   - Click first checkbox, then shift+click last to select range
 *   - Works with sorted/filtered lists
 *
 * Changes in v103:
 * - PHASE-6.5c: Bulk Edit Panel (all-tickets-view.jsx)
 *   - "Edit" button in toolbar when tickets are selected
 *   - Slide-out panel with "Keep as is" dropdowns
 *   - Editable fields: Status, Assignee, Priority, Work Unit
 *   - Cascade pickers for location moves (Board → Zone → Stage)
 *   - Changing board resets zone/stage to defaults
 * - Added handleBulkUpdateTickets function for batch ticket updates
 * - Updated AllTicketsView props to include onBulkUpdateTickets
 *
 * Changes in v102:
 * - BUG-101-001 FIX: Scrollbars now at viewport edges (all-tickets-view.jsx)
 *   - Changed outer container to h-screen flex flex-col
 *   - Table section uses flex-1 with min-h-0 for proper overflow
 * - BUG-101-002 FIX: Sticky table headers (all-tickets-view.jsx)
 *   - Added sticky top-0 z-10 to thead
 *   - Column names remain visible while scrolling
 *
 * Changes in v101:
 * - BUG-100-001 FIX: Horizontal scroll now works (changed tableLayout to minWidth: max-content)
 * - UX-100-001: Last-opened ticket row is highlighted after returning from edit
 * - Added "All Tickets" button to Admin Panel Global Resources grid
 * - Added lastOpenedTicketId state to track which ticket was just edited
 * - Added onOpenAllTickets prop to AdminPanel
 *
 * Changes in v100:
 * - Resizable columns in All Tickets View (drag column borders)
 * - Column width persistence at board level (board.allTicketsViewConfig)
 * - Sort order persistence at board level
 * - BUG-099-001 FIX: Ticket modal close now returns to All Tickets if opened from there
 * - Added returnToAllTickets state tracking
 * - Added handleAllTicketsViewConfigChange for persistence
 *
 * Changes in v099:
 * - Converted AllTicketsView from modal to full-screen view
 * - Changed conditional render hierarchy: AllTicketsView > Admin > OpCentre
 * - AllTicketsView now at same level as AdminPanel and Board View
 * - Back button returns to Work Centre view
 * - Removed modal wrapper from AllTicketsView component
 *
 * Changes in v098:
 * - PHASE-6.5a: Created AllTicketsView component (components/all-tickets-view.jsx)
 *   - Scope selector: This Board / This Work Centre / All Work Centres
 *   - Sortable columns (click header to toggle asc/desc)
 *   - Default column set: Type, Key, Summary, Status, Board, Sprint, Assignee, Priority, Updated
 *   - Row click to edit ticket
 *   - Checkbox selection with bulk delete
 *   - Search filter
 * - Added "All Tickets" button to board action bar
 *
 * Changes in v097:
 * - REFACTOR-001: Renamed AllTicketsView to CustomerTicketsView (ui-cards.jsx)
 *   - The old name was misleading - it's a CRM customer ticket filter, not a general query view
 *   - Updated import, comment, and usage in app.jsx
 *   - True All Tickets view will be implemented as separate component
 *
 * Changes in v096:
 * - BUG-095-004: Fixed bullet/numbered lists not continuing on Enter (ticket-modals.jsx)
 * - CLEANUP-001: Removed debug console.log statements from components
 *   - ticket-modals.jsx: removed load message
 *   - board-settings-modals.jsx: removed field customisation debug logs
 *   - global-settings-modal.jsx: removed load message
 *
 * Changes in v095:
 * - BUG-095-001: Added INITIAL_TICKETS to shim in index-dev.html
 *   "Clear All" now correctly reloads 70 sample tickets
 *
 * Changes in v094:
 * - BUG-093-001: Improved "no ticket types" error message with board name
 * - UX-BUG-001: Fixed bullet/numbered lists in rich text (ticket-modals.jsx)
 * - UX-BUG-002: Images in descriptions now clickable to enlarge (ticket-modals.jsx)
 * - BUG-090-003: Fixed button-in-button warning (global-settings-modal.jsx)
 * - BUG-075-005: Reset sequence when year changes (board-settings-modals.jsx)
 *
 * Changes in v093:
 * - Fixed syntax error: duplicate 'series' variable declaration (line 2639)
 *
 * Changes in v092:
 * - BUG-090-001: Fixed misleading "Create Ticket" error message
 * - BUG-079-002: Fixed duplicate Complete Sprint button
 *
 * Previous (v091):
 * - Extracted FieldModals, AdminComponents, UICards
 * - 77% reduction from original monolith
 *
 * Current: 3,068 lines
 */

const { useState, useEffect } = React;

// v107: Version constant - displayed in Admin Panel header
const APP_VERSION = 'v188';

// v153: Register App version
window.ComponentVersions = window.ComponentVersions || {};
window.ComponentVersions['App'] = APP_VERSION;

// Icons imported from shared/icons.js
const {
  Plus,
  Edit2,
  Trash2,
  Search,
  BarChart3,
  Settings,
  Play,
  Check,
  AlertCircle,
  ChevronUp,
  ChevronDown,
  ArrowRight,
  Square,
  X,
} = window.Icons;

// Confirm Modals imported from components/confirm-modals.jsx
const { ConfirmationModal, StagePickerModal } = window.Components.ConfirmModals;

// Work Unit Modals imported from components/workunit-modals.jsx
const { StartWorkUnitModal, WorkUnitSuccessModal, CompleteWorkUnitModal } = window.Components.WorkUnitModals;

// DynamicField imported from components/dynamic-field.jsx
const DynamicField = window.Components.DynamicField;

// Ticket Modals imported from components/ticket-modals.jsx
const { TicketModal, TicketSuccessModal } = window.Components.TicketModals;

// Board Settings Modals imported from components/board-settings-modals.jsx
const { ProcessBoardSettingsModal, WorkZoneModal, FieldOverrideModal } = window.Components.BoardSettingsModals;

// Global Settings Modal imported from components/global-settings-modal.jsx
const GlobalSettingsModal = window.Components.GlobalSettingsModal;

// Entity Modals imported from components/entity-modals.jsx
// v187: Removed CustomerModal, SupplierModal - now using Detail Modals everywhere
const { CategoryModal, CustomFieldModal } = window.Components.EntityModals;

// Ticket Type Modal imported from components/ticket-type-modal.jsx
const TicketTypeModal = window.Components.TicketTypeModal;

// Op Centre Modals imported from components/opcentre-modals.jsx
const { CreateOpCentreModal, BoardSelectionModal, OpCentreSettingsModal } = window.Components.OpCentreModals;

// Field Modals imported from components/field-modals.jsx
const { FieldManagerModal, FieldEditorModal } = window.Components.FieldModals;

// Admin Components imported from components/admin-components.jsx
const { ProcessBoardAccessModal, AdminPanel } = window.Components.AdminComponents;

// UI Cards imported from components/ui-cards.jsx
const {
  CustomerTicketsView,
  KanbanColumn,
  BacklogColumn,
  CRMColumn,
  TicketCard,
  CustomerCard,
  RichTextToolbar,
  AttachmentThumbnail,
  CommentItem,
} = window.Components.UICards;

// All Tickets View imported from components/all-tickets-view.jsx
const AllTicketsView = window.Components.AllTicketsView;

// Customer Detail Modal imported from components/customer-detail-modal.jsx
const CustomerDetailModal = window.Components.CustomerDetailModal;

// CRM Mirror imported from components/crm-mirror.jsx
const CrmMirror = window.Components.CrmMirror;

// v184: Supplier Mirror imported from components/supplier-mirror.jsx
const SupplierMirror = window.Components.SupplierMirror;

// Field Library - Comprehensive categorized field definitions

// FIELD_LIBRARY and INITIAL_DATA loaded from separate files

// Domain logic from window.Domain (loaded from domain/*.js files)
const {
  PREDEFINED_STATUSES,
  PREDEFINED_STATUS_LABELS,
  inferStatusFromStageName,
  migrateWorkStages,
  getStageName,
  getStageDefaultStatus,
  findStagesForStatus,
  getStatusChangeMoveAction,
  getLifecycleDateUpdates, // v144: Lifecycle dates
} = window.Domain.Statuses;

// CustomerTicketsView Component - Shows filtered tickets for a specific CRM customer (renamed from AllTicketsView in v097)

// Field Manager Modal - For selecting fields when creating ticket types

// Status constants now loaded from domain/statuses.js via window.Domain.Statuses

// v071: Board colors for visual distinction between boards
const BOARD_COLORS = {
  indigo: { bg: 'bg-indigo-50', border: 'border-indigo-500', text: 'text-indigo-700', accent: 'bg-indigo-500' },
  blue: { bg: 'bg-blue-50', border: 'border-blue-500', text: 'text-blue-700', accent: 'bg-blue-500' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-500', text: 'text-emerald-700', accent: 'bg-emerald-500' },
  green: { bg: 'bg-green-50', border: 'border-green-500', text: 'text-green-700', accent: 'bg-green-500' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-500', text: 'text-purple-700', accent: 'bg-purple-500' },
  pink: { bg: 'bg-pink-50', border: 'border-pink-500', text: 'text-pink-700', accent: 'bg-pink-500' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-500', text: 'text-orange-700', accent: 'bg-orange-500' },
  red: { bg: 'bg-red-50', border: 'border-red-500', text: 'text-red-700', accent: 'bg-red-500' },
  teal: { bg: 'bg-teal-50', border: 'border-teal-500', text: 'text-teal-700', accent: 'bg-teal-500' },
  cyan: { bg: 'bg-cyan-50', border: 'border-cyan-500', text: 'text-cyan-700', accent: 'bg-cyan-500' },
  amber: { bg: 'bg-amber-50', border: 'border-amber-500', text: 'text-amber-700', accent: 'bg-amber-500' },
  gray: { bg: 'bg-gray-50', border: 'border-gray-500', text: 'text-gray-700', accent: 'bg-gray-500' },
};

// Ticket type colors for display
const TYPE_COLORS = {
  Feature: 'bg-blue-50 border-blue-300 text-blue-700',
  Bug: 'bg-red-50 border-red-300 text-red-700',
  Task: 'bg-gray-50 border-gray-300 text-gray-700',
  'Service Request': 'bg-purple-50 border-purple-300 text-purple-700',
  default: 'bg-gray-50 border-gray-300 text-gray-700',
};

// Ticket type icons for display
const TYPE_ICONS = {
  Feature: '✨',
  Bug: '🐛',
  Task: '📋',
  'Service Request': '🎫',
  default: '📄',
};

// v086: FIELD_LIBRARY_NORMALIZED is now loaded from field-library.js via window
// Due to Babel async loading, we look up window.FIELD_LIBRARY_NORMALIZED at render time
// (not at module load time when it may not be populated yet)

// Status helper functions now loaded from domain/statuses.js via window.Domain.Statuses

const ArcanumWorkManagement = () => {
  // Check for factory reset mode
  const isFactoryReset = localStorage.getItem('arcanum_factory_reset') === 'true';

  // State management - Company Level (GLOBAL)
  const [company, setCompany] = useState(() => {
    if (isFactoryReset) {
      return {
        ...(window.INITIAL_COMPANY || {}),
        globalCRM: [],
        globalStaff: [],
        globalProjects: [],
        statuses: PREDEFINED_STATUSES, // Include predefined statuses on factory reset
        workUnits: [], // v069: Include empty workUnits on factory reset
      };
    }
    const saved = localStorage.getItem('arcanum_company');
    let companyData = saved ? JSON.parse(saved) : window.INITIAL_COMPANY || {};

    // Migration: Add statuses if missing (Phase 2)
    if (!companyData.statuses) {
      companyData = {
        ...companyData,
        statuses: PREDEFINED_STATUSES,
      };
    }

    // v069 Phase 6.1: Migration - Add workUnits array if missing
    if (!companyData.workUnits) {
      companyData = {
        ...companyData,
        workUnits: [],
      };
    }

    // v168 CRM Phase 1: Migration - Add crmConfig if missing
    if (!companyData.crmConfig) {
      companyData = {
        ...companyData,
        crmConfig: {
          lifecycleStages: [
            { id: 'stage-prospect', name: 'Prospect', colorPosition: 10, order: 1 },
            { id: 'stage-active', name: 'Active', colorPosition: 6, order: 2 },
            { id: 'stage-at-risk', name: 'At Risk', colorPosition: 3, order: 3 },
            { id: 'stage-churned', name: 'Churned', colorPosition: 1, order: 4 },
          ],
          useAutoColors: true,
          customerFlags: [
            { id: 'flag-vip', name: 'VIP', icon: '⭐', color: '#F59E0B' },
            { id: 'flag-strategic', name: 'Strategic', icon: '🎯', color: '#8B5CF6' },
          ],
          documentTypes: [
            { id: 'doctype-contract', name: 'Contract' },
            { id: 'doctype-sow', name: 'SOW' },
            { id: 'doctype-proposal', name: 'Proposal' },
            { id: 'doctype-nda', name: 'NDA' },
            { id: 'doctype-other', name: 'Other' },
          ],
        },
      };
    }

    // v180 Supplier Management: Migration - Add supplierConfig if missing
    if (!companyData.supplierConfig) {
      companyData = {
        ...companyData,
        supplierConfig: {
          enabled: true,
          lifecycleStages: [
            { id: 'sup-stage-potential', name: 'Potential', colorPosition: 10, order: 1 },
            { id: 'sup-stage-approved', name: 'Approved', colorPosition: 7, order: 2 },
            { id: 'sup-stage-preferred', name: 'Preferred', colorPosition: 6, order: 3 },
            { id: 'sup-stage-inactive', name: 'Inactive', colorPosition: 1, order: 4 },
          ],
          useAutoColors: true,
          supplierFlags: [
            { id: 'sup-flag-preferred', name: 'Preferred', icon: '⭐', color: '#F59E0B' },
            { id: 'sup-flag-iso', name: 'ISO Certified', icon: '✓', color: '#10B981' },
            { id: 'sup-flag-sole-source', name: 'Sole Source', icon: '🔒', color: '#8B5CF6' },
          ],
          documentTypes: [
            { id: 'sup-doc-contract', name: 'Contract' },
            { id: 'sup-doc-quote', name: 'Quote' },
            { id: 'sup-doc-invoice', name: 'Invoice' },
            { id: 'sup-doc-certificate', name: 'Certificate' },
            { id: 'sup-doc-sla', name: 'SLA' },
          ],
        },
      };
    }

    // v180 Supplier Management: Migration - Add globalSuppliers if missing
    if (!companyData.globalSuppliers) {
      companyData = {
        ...companyData,
        globalSuppliers: [],
      };
    }

    return companyData;
  });

  // State management - Work Centre Layer
  const [opCentres, setOpCentres] = useState(() => {
    if (isFactoryReset) {
      // Factory reset: completely empty - no Work Centres at all
      return [];
    }
    const saved = localStorage.getItem('arcanum_opcentres');
    let opCentresData = saved ? JSON.parse(saved) : window.INITIAL_OP_CENTRES || [];

    // v170 CRM Phase 3: Migration - Add crmMirror to boards that don't have it
    // v184: Migration - Add supplierMirror to boards that don't have it
    opCentresData = opCentresData.map((oc) => ({
      ...oc,
      processBoards: (oc.processBoards || []).map((board) => ({
        ...board,
        crmMirror: board.crmMirror !== undefined ? board.crmMirror : null,
        supplierMirror: board.supplierMirror !== undefined ? board.supplierMirror : null,
      })),
    }));

    return opCentresData;
  });

  const [activeOpCentreId, setActiveOpCentreId] = useState(() => {
    if (isFactoryReset) return null;
    const saved = localStorage.getItem('arcanum_active_opcentre');
    return saved || (window.INITIAL_OP_CENTRES || [])[0]?.id || 'opcentre-arcanum';
  });

  // Mock current user (in production, this comes from auth)
  const [currentUser, setCurrentUser] = useState('staff-blue'); // v137: Store staff ID, not name

  // State management - Tickets (still local for now)
  const [tickets, setTickets] = useState(() => {
    if (isFactoryReset) return [];
    const saved = localStorage.getItem('arcanum_tickets');
    return saved ? JSON.parse(saved) : window.INITIAL_TICKETS || [];
  });

  // Customers are now in company.globalCRM (no separate state needed)

  const [activeBoard, setActiveBoard] = useState('board-dev');
  const [activeSection, setActiveSection] = useState('section-active-sprints');
  const [showBoardSelectionModal, setShowBoardSelectionModal] = useState(false);
  const [showProcessBoardSettings, setShowProcessBoardSettings] = useState(false);
  const [showCreateOpCentre, setShowCreateOpCentre] = useState(false);
  const [editingProcessBoard, setEditingProcessBoard] = useState(null);
  const [showOpCentreSettings, setShowOpCentreSettings] = useState(false);
  const [showBoardAccessSettings, setShowBoardAccessSettings] = useState(false);
  const [editingOpCentre, setEditingOpCentre] = useState(null);
  const [editingBoardAccess, setEditingBoardAccess] = useState(null);
  const [currentView, setCurrentView] = useState('admin'); // 'admin' or 'opcentre'
  const [isAdmin, setIsAdmin] = useState(true); // Mock: current user is admin
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [showTicketSuccessModal, setShowTicketSuccessModal] = useState(false);
  const [createdTicketInfo, setCreatedTicketInfo] = useState(null);

  // Phase 4: Stage picker modal for status change with multiple matches
  const [showStagePickerModal, setShowStagePickerModal] = useState(false);
  const [stagePickerConfig, setStagePickerConfig] = useState(null);

  // v070 Phase 6.2: Start Work Unit modal
  const [showStartWorkUnitModal, setShowStartWorkUnitModal] = useState(false);
  const [startWorkUnitConfig, setStartWorkUnitConfig] = useState(null);
  const [showWorkUnitSuccessModal, setShowWorkUnitSuccessModal] = useState(false);
  const [workUnitSuccessInfo, setWorkUnitSuccessInfo] = useState(null);

  // v077 Phase 6.4: Complete Work Unit modal
  const [showCompleteWorkUnitModal, setShowCompleteWorkUnitModal] = useState(false);
  const [completeWorkUnitConfig, setCompleteWorkUnitConfig] = useState(null);

  // v098 Phase 6.5a: All Tickets View
  const [showAllTicketsView, setShowAllTicketsView] = useState(false);
  const [returnToAllTickets, setReturnToAllTickets] = useState(false); // v100: Track if we should return to All Tickets after modal close
  const [lastOpenedTicketId, setLastOpenedTicketId] = useState(null); // v101: Track last opened ticket for row highlighting
  const [allTicketsSelectedIds, setAllTicketsSelectedIds] = useState(new Set()); // v104: Persist selection across modal opens

  // v169 CRM Phase 2: Customer Detail Modal
  const [customerDetailModal, setCustomerDetailModal] = useState({
    isOpen: false,
    customerId: null,
  });

  // v175 CRM Phase 5: Track if ticket was opened from CustomerDetailModal for modal stacking
  const [ticketOpenedFromCustomer, setTicketOpenedFromCustomer] = useState(false);

  // v181 Supplier Management Session 2: Supplier Detail Modal
  const [supplierDetailModal, setSupplierDetailModal] = useState({
    isOpen: false,
    supplierId: null,
  });

  // ========================================
  // HELPER FUNCTIONS
  // ========================================

  /**
   * v155 Progressive Disclosure: Detect if board is a simple board (no work units)
   * Simple boards have zones hidden - they just show stages directly
   * @param {Object} board - The board to check
   * @returns {boolean} True if board does not use work units
   */
  const isSimpleBoardCheck = (board) => {
    // Has work unit series enabled - not simple
    if (board?.workUnitSeries?.enabled) return false;

    // Has zones with work unit IDs (like NUMA board showing active sprint) - not simple
    if (board?.workZones?.some((zone) => zone.workUnitId)) return false;

    // Otherwise it's a simple board (no work units)
    return true;
  };

  /**
   * Merges predefined fields with custom fields to create complete field library
   * This ensures custom fields are available everywhere fields are used
   */
  const getFullFieldLibrary = () => {
    // Start with normalized predefined fields
    const merged = { ...(window.FIELD_LIBRARY_NORMALIZED || {}) };

    // Add custom fields
    (company.customFields || []).forEach((field) => {
      merged[field.id] = {
        id: field.id,
        category: field.category,
        label: field.label,
        type: field.type,
        required: field.required || false,
        defaultValue: field.defaultValue || '',
        placeholder: field.placeholder || '',
        icon: field.icon || '',
        helpText: field.helpText || '',
        isCustom: true,
        customCategoryId: field.categoryId,
        // Type-specific properties
        options: field.options,
        min: field.min,
        max: field.max,
        rows: field.rows,
        showInCard: false, // Custom fields don't show in card by default
        showInList: false,
      };
    });

    return merged;
  };

  // Get field definition with board-specific overrides applied
  const getFieldForBoard = (fieldId, boardId, ticketTypeId) => {
    const fullFieldLibrary = getFullFieldLibrary();
    const baseField = fullFieldLibrary[fieldId];
    if (!baseField) return null;

    // Find the board - opCentres is a state variable, not in company
    const board = opCentres.flatMap((oc) => oc.processBoards).find((b) => b.id === boardId);

    // Check for per-ticket-type override first (new structure)
    if (board?.fieldOverrides?.[ticketTypeId]?.[fieldId]) {
      return {
        ...baseField,
        ...board.fieldOverrides[ticketTypeId][fieldId],
      };
    }

    // Fallback: check for old-style direct field override (backwards compatibility)
    if (
      board?.fieldOverrides?.[fieldId] &&
      typeof board.fieldOverrides[fieldId] === 'object' &&
      !board.fieldOverrides[fieldId].prefix
    ) {
      return {
        ...baseField,
        ...board.fieldOverrides[fieldId],
      };
    }

    return baseField;
  };

  // Get full field library including custom fields
  const fieldLibrary = getFullFieldLibrary();
  // v187: Removed showCustomerModal - using Detail Modal everywhere
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [globalSettingsTab, setGlobalSettingsTab] = useState('projects'); // projects, staff, crm
  const [editingTicket, setEditingTicket] = useState(null);
  // v187: Removed editingCustomer - using Detail Modal everywhere
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProject, setFilterProject] = useState(null);
  const [filterClient, setFilterClient] = useState(null);
  const [filterClientScope, setFilterClientScope] = useState('all-opcentres'); // 'board-{id}' | 'this-opcentre' | 'all-opcentres'
  const [draggedItem, setDraggedItem] = useState(null);

  // v163: Positional drag-drop state
  const [dropTarget, setDropTarget] = useState(null); // { sectionId, column, index }
  const [highlightedTicketId, setHighlightedTicketId] = useState(null);
  const [highlightedCustomerId, setHighlightedCustomerId] = useState(null); // v163: For CRM zones
  const [highlightedSupplierId, setHighlightedSupplierId] = useState(null); // v184: For Supplier Mirror
  const [supplierDropTarget, setSupplierDropTarget] = useState(null); // v184: For Supplier Mirror drag

  // v159: Ticket context menu state
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    ticket: null,
    ticketIndex: 0,
    totalTickets: 0,
    context: 'board', // v160: 'board' | 'table' - determines which actions are available
  });
  const contextMenuRef = React.useRef(null);

  const [ticketFormData, setTicketFormData] = useState({
    name: '',
    type: 'Feature',
    parentProject: null,
    client: 'All',
    priority: 'Medium',
    sprint: '',
    effortPoints: '',
    reporter: '',
    assignee: '',
    description: '',
    attachments: [],
  });

  // v187: Removed customerFormData - Detail Modal has inline editing for all fields

  // v187: Removed showSupplierModal, editingSupplier, supplierFormData
  // All supplier editing now uses SupplierDetailModal with inline editing

  // Confirmation modal state
  const [confirmationModal, setConfirmationModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'delete',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
  });

  const showConfirmation = (config) => {
    setConfirmationModal({
      isOpen: true,
      ...config,
    });
  };

  const closeConfirmation = () => {
    setConfirmationModal({
      ...confirmationModal,
      isOpen: false,
    });
  };

  // Persistence - Company (GLOBAL)
  useEffect(() => {
    localStorage.setItem('arcanum_company', JSON.stringify(company));
    window.globalCompany = company; // Make available globally
    window.allCustomers = company.globalCRM; // For backwards compatibility
    window.allSuppliers = company.globalSuppliers || []; // v180: Supplier Management
  }, [company]);

  // Persistence - Work Centres
  useEffect(() => {
    localStorage.setItem('arcanum_opcentres', JSON.stringify(opCentres));
    window.allOpCentres = opCentres; // Make available globally
    // Clear factory reset flag after first save
    localStorage.removeItem('arcanum_factory_reset');
  }, [opCentres]);

  useEffect(() => {
    localStorage.setItem('arcanum_active_opcentre', activeOpCentreId);
  }, [activeOpCentreId]);

  // Persistence - Tickets
  useEffect(() => {
    localStorage.setItem('arcanum_tickets', JSON.stringify(tickets));
    window.allTickets = tickets;
  }, [tickets]);

  // Customers now persisted via company (no separate persistence needed)

  // MIGRATION: Fix tickets with missing hierarchy IDs (opCentreId, boardId, zoneId)
  useEffect(() => {
    // Only run once on mount
    const migrationKey = 'arcanum_migration_hierarchy_ids_v1';
    const migrationCompleted = localStorage.getItem(migrationKey);

    if (!migrationCompleted && tickets.length > 0) {
      console.log('🔧 Running ticket migration: Adding missing hierarchy IDs...');

      let migrationCount = 0;
      const migratedTickets = tickets.map((ticket) => {
        // Check if ticket is missing hierarchy IDs
        if (!ticket.opCentreId || !ticket.boardId || !ticket.zoneId) {
          migrationCount++;

          // Try to infer hierarchy from sectionId
          let inferredOpCentreId = activeOpCentreId;
          let inferredBoardId = activeBoard;
          let inferredZoneId = ticket.sectionId || 'section-active-sprints';

          // Search through all Work Centres to find the board/zone this ticket belongs to
          for (const oc of opCentres) {
            for (const board of oc.processBoards) {
              for (const zone of board.workZones) {
                if (zone.id === ticket.sectionId) {
                  inferredOpCentreId = oc.id;
                  inferredBoardId = board.id;
                  inferredZoneId = zone.id;
                  break;
                }
              }
            }
          }

          console.log(
            `  ✓ Migrating ${ticket.id}: opCentre=${inferredOpCentreId}, board=${inferredBoardId}, zone=${inferredZoneId}`
          );

          return {
            ...ticket,
            opCentreId: ticket.opCentreId || inferredOpCentreId,
            boardId: ticket.boardId || inferredBoardId,
            zoneId: ticket.zoneId || inferredZoneId,
            sectionId: ticket.sectionId || inferredZoneId, // Ensure sectionId also set
          };
        }
        return ticket;
      });

      if (migrationCount > 0) {
        console.log(`✅ Migration complete: Fixed ${migrationCount} ticket(s)`);
        setTickets(migratedTickets);
        localStorage.setItem(migrationKey, 'true');
      } else {
        console.log('✅ No migration needed: All tickets have hierarchy IDs');
        localStorage.setItem(migrationKey, 'true');
      }
    }
  }, []); // Run only once on mount

  // Work Centre switching - auto-select first board when Work Centre changes
  useEffect(() => {
    const opCentre = opCentres.find((oc) => oc.id === activeOpCentreId) || opCentres[0];
    const firstBoard = opCentre?.processBoards?.[0];

    if (firstBoard) {
      // Switch to first board of new Work Centre if current board doesn't exist in it
      const boardExists = opCentre.processBoards.some((pb) => pb.id === activeBoard);
      if (!boardExists) {
        setActiveBoard(firstBoard.id);
        const firstZone = firstBoard.workZones?.[0];
        if (firstZone) {
          setActiveSection(firstZone.id);
        }
      }
    }
  }, [activeOpCentreId, opCentres]);

  // Event listener for client filtering
  useEffect(() => {
    const handleClientFilter = (e) => {
      setFilterClient(e.detail.customerId);
      // Set default scope to current op centre (most common use case)
      setFilterClientScope('this-opcentre');
      setActiveBoard('board-dev');
      setActiveSection('section-active-sprints');
    };
    window.addEventListener('filterByClient', handleClientFilter);
    return () => window.removeEventListener('filterByClient', handleClientFilter);
  }, []);

  // SPRINT EXPANSION: Event listeners for container (sprint/campaign) management
  useEffect(() => {
    // Handle container save (create or update)
    const handleContainerSave = (e) => {
      const { container, isNew } = e.detail;
      setCompany((prev) => {
        const containers = prev.containers || [];
        if (isNew) {
          // Add new container
          return {
            ...prev,
            containers: [...containers, container],
            updatedAt: new Date(),
          };
        } else {
          // Update existing container
          return {
            ...prev,
            containers: containers.map((c) => (c.id === container.id ? container : c)),
            updatedAt: new Date(),
          };
        }
      });
    };

    // Handle container status change (start, complete, cancel)
    const handleContainerStatusChange = (e) => {
      const { containerId, newStatus } = e.detail;
      setCompany((prev) => ({
        ...prev,
        containers: (prev.containers || []).map((c) =>
          c.id === containerId ? { ...c, status: newStatus, updatedAt: new Date() } : c
        ),
        updatedAt: new Date(),
      }));
    };

    // Handle container delete
    const handleContainerDelete = (e) => {
      const { containerId } = e.detail;
      setCompany((prev) => ({
        ...prev,
        containers: (prev.containers || []).filter((c) => c.id !== containerId),
        updatedAt: new Date(),
      }));

      // Also clear sprint field from any tickets that had this container assigned
      setTickets((prevTickets) =>
        prevTickets.map((t) => (t.sprint === containerId ? { ...t, sprint: null, updatedAt: new Date() } : t))
      );
    };

    // GAP-002 FIX: Handle container complete with rollover
    const handleContainerComplete = (e) => {
      const { containerId, moveIncompleteToBacklog, incompleteTicketIds } = e.detail;

      // Mark container as completed
      setCompany((prev) => ({
        ...prev,
        containers: (prev.containers || []).map((c) =>
          c.id === containerId ? { ...c, status: 'completed', updatedAt: new Date() } : c
        ),
        updatedAt: new Date(),
      }));

      // Move incomplete tickets to backlog (unassign sprint)
      if (moveIncompleteToBacklog && incompleteTicketIds?.length > 0) {
        setTickets((prevTickets) =>
          prevTickets.map((t) =>
            incompleteTicketIds.includes(t.id) ? { ...t, sprint: null, updatedAt: new Date() } : t
          )
        );
      }
    };

    window.addEventListener('containerSave', handleContainerSave);
    window.addEventListener('containerStatusChange', handleContainerStatusChange);
    window.addEventListener('containerDelete', handleContainerDelete);
    window.addEventListener('containerComplete', handleContainerComplete);

    return () => {
      window.removeEventListener('containerSave', handleContainerSave);
      window.removeEventListener('containerStatusChange', handleContainerStatusChange);
      window.removeEventListener('containerDelete', handleContainerDelete);
      window.removeEventListener('containerComplete', handleContainerComplete);
    };
  }, []);

  // Helper functions - Company/Global Layer
  const getGlobalCRM = () => company.globalCRM;

  const getGlobalStaff = () => company.globalStaff;

  const updateGlobalCustomer = (customerId, updates) => {
    setCompany((prev) => ({
      ...prev,
      globalCRM: prev.globalCRM.map((customer) =>
        customer.id === customerId ? { ...customer, ...updates, updatedAt: new Date() } : customer
      ),
      updatedAt: new Date(),
    }));
  };

  const addGlobalCustomer = (customerData) => {
    const newCustomer = {
      ...customerData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setCompany((prev) => ({
      ...prev,
      globalCRM: [...prev.globalCRM, newCustomer],
      updatedAt: new Date(),
    }));
  };

  const deleteGlobalCustomer = (customerId) => {
    setCompany((prev) => ({
      ...prev,
      globalCRM: prev.globalCRM.filter((c) => c.id !== customerId),
      updatedAt: new Date(),
    }));
  };

  // ========================================
  // v180: Supplier Management Helper Functions
  // ========================================

  const getGlobalSuppliers = () => company.globalSuppliers || [];

  const updateGlobalSupplier = (supplierId, updates) => {
    setCompany((prev) => ({
      ...prev,
      globalSuppliers: (prev.globalSuppliers || []).map((supplier) =>
        supplier.id === supplierId ? { ...supplier, ...updates, updatedAt: new Date() } : supplier
      ),
      updatedAt: new Date(),
    }));
  };

  const addGlobalSupplier = (supplierData) => {
    const newSupplier = {
      ...supplierData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setCompany((prev) => ({
      ...prev,
      globalSuppliers: [...(prev.globalSuppliers || []), newSupplier],
      updatedAt: new Date(),
    }));
  };

  const deleteGlobalSupplier = (supplierId) => {
    setCompany((prev) => ({
      ...prev,
      globalSuppliers: (prev.globalSuppliers || []).filter((s) => s.id !== supplierId),
      updatedAt: new Date(),
    }));
  };

  // ========================================
  // v069 Phase 6.1: Work Unit Helper Functions
  // ========================================

  /**
   * Generate the next Work Unit name based on series configuration
   * @param {Object} series - The workUnitSeries configuration
   * @returns {string} The generated name (e.g., "Sprint 5", "January 2025", "Q1 2025")
   */
  const getNextWorkUnitName = (series) => {
    if (!series) return 'New Work Unit';

    const { label, patternType, patternStart, patternStartYear, currentSequence } = series;
    const seq = currentSequence || 1;
    const currentYear = new Date().getFullYear();

    switch (patternType) {
      case 'sequential': {
        const startNum = typeof patternStart === 'number' ? patternStart : 1;
        return `${label || 'Sprint'} ${startNum + seq - 1}`;
      }

      case 'months': {
        const monthNames = [
          'January',
          'February',
          'March',
          'April',
          'May',
          'June',
          'July',
          'August',
          'September',
          'October',
          'November',
          'December',
        ];
        const monthMap = {
          january: 0,
          february: 1,
          march: 2,
          april: 3,
          may: 4,
          june: 5,
          july: 6,
          august: 7,
          september: 8,
          october: 9,
          november: 10,
          december: 11,
        };
        const startMonth = monthMap[String(patternStart).toLowerCase()] ?? 0;
        const totalMonths = startMonth + seq - 1;
        const monthIndex = totalMonths % 12;
        const yearOffset = Math.floor(totalMonths / 12);
        const year = (patternStartYear || currentYear) + yearOffset;
        return `${monthNames[monthIndex]} ${year}`;
      }

      case 'quarters': {
        const quarterMap = { Q1: 0, Q2: 1, Q3: 2, Q4: 3 };
        const startQuarter = quarterMap[patternStart] ?? 0;
        const totalQuarters = startQuarter + seq - 1;
        const quarterIndex = totalQuarters % 4;
        const yearOffset = Math.floor(totalQuarters / 4);
        const year = (patternStartYear || currentYear) + yearOffset;
        return `Q${quarterIndex + 1} ${year}`;
      }

      case 'years': {
        const startYear = typeof patternStart === 'number' ? patternStart : currentYear;
        return `${startYear + seq - 1}`;
      }

      default:
        return `${label || 'Sprint'} ${seq}`;
    }
  };

  /**
   * Create a new Work Unit and add it as a stage in the backlog zone
   * @param {string} boardId - The board ID
   * @param {Object} series - The workUnitSeries configuration
   */
  const handleCreateWorkUnit = (boardId, series) => {
    if (!series || !series.enabled || !series.backlogZoneId) {
      console.error('Cannot create Work Unit: series not configured');
      return;
    }

    const opCentre = getActiveOpCentre();
    if (!opCentre) return;

    const board = opCentre.processBoards?.find((b) => b.id === boardId);
    if (!board) return;

    // Generate the Work Unit name
    const workUnitName = getNextWorkUnitName(series);
    const workUnitId = `workunit-${Date.now()}`;

    // Create the Work Unit record
    const newWorkUnit = {
      id: workUnitId,
      workCentreId: opCentre.id,
      boardId: boardId,
      name: workUnitName,
      status: 'planning',
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };

    // Add Work Unit to company.workUnits
    setCompany((prev) => ({
      ...prev,
      workUnits: [...(prev.workUnits || []), newWorkUnit],
    }));

    // Add stage to the backlog zone - insert after "New" stage, before "Backlog" stage
    const newStage = {
      name: workUnitName,
      defaultStatus: 'backlog',
      workUnitId: workUnitId, // Link stage to Work Unit record
    };

    // Update the board's backlog zone and increment sequence
    setOpCentres((prev) =>
      prev.map((oc) => {
        if (oc.id !== opCentre.id) return oc;
        return {
          ...oc,
          processBoards: oc.processBoards.map((pb) => {
            if (pb.id !== boardId) return pb;
            return {
              ...pb,
              workUnitSeries: {
                ...pb.workUnitSeries,
                currentSequence: (pb.workUnitSeries.currentSequence || 1) + 1,
              },
              workZones: pb.workZones.map((zone) => {
                if (zone.id !== series.backlogZoneId) return zone;

                // v070 BUG-069-001 Fix: Improved insertion logic
                // Insert Work Unit stage after "New" and after existing Work Unit stages,
                // but BEFORE the "Backlog" stage (or last stage if no Backlog)
                const stages = zone.workStages || [];

                // Find the Backlog stage index (usually last)
                let backlogIndex = stages.findIndex((s) => {
                  const name = (typeof s === 'string' ? s : s.name || '').toLowerCase();
                  return name === 'backlog' || name === 'parked';
                });

                // If no Backlog stage found, treat last stage as the boundary
                if (backlogIndex === -1) {
                  backlogIndex = stages.length;
                }

                // Find insertion point: after last Work Unit stage, but before Backlog
                let insertIndex = 1; // Default: after first stage (usually "New")

                // Look for existing Work Unit stages between position 1 and backlogIndex
                for (let i = 1; i < backlogIndex; i++) {
                  if (stages[i]?.workUnitId) {
                    insertIndex = i + 1; // Insert after this Work Unit stage
                  }
                }

                // Ensure we insert before Backlog
                if (insertIndex > backlogIndex) {
                  insertIndex = backlogIndex;
                }

                // Handle edge case: if backlogIndex is 1 (no room), insert at 1 and push Backlog
                if (insertIndex < 1) {
                  insertIndex = 1;
                }

                // Insert the new stage at the calculated position
                const updatedStages = [...stages.slice(0, insertIndex), newStage, ...stages.slice(insertIndex)];

                return {
                  ...zone,
                  workStages: updatedStages,
                };
              }),
            };
          }),
        };
      })
    );
  };

  // ========================================
  // v070 Phase 6.2: Start Work Unit Functions
  // ========================================

  /**
   * Check if a board has a zone with stages matching the activeStages config
   */
  const boardMatchesActiveStages = (board, activeStages) => {
    if (!board?.workZones || !activeStages) return false;

    const activeStageNames = activeStages.map((s) => s.name.toLowerCase());

    return board.workZones.some((zone) => {
      if (!zone.workStages) return false;
      const zoneStageNames = zone.workStages.map((s) => (typeof s === 'string' ? s : s.name).toLowerCase());
      // Check if zone has all the active stages (in any order)
      return activeStageNames.every((name) => zoneStageNames.includes(name));
    });
  };

  /**
   * Get list of planning Work Units for the current board
   */
  const getPlanningWorkUnits = (boardId) => {
    return (company.workUnits || []).filter((wu) => wu.boardId === boardId && wu.status === 'planning');
  };

  /**
   * Get the currently active Work Unit for a board (if any)
   */
  const getActiveWorkUnit = (boardId) => {
    return (company.workUnits || []).find((wu) => wu.boardId === boardId && wu.status === 'active');
  };

  /**
   * v079: Find the board and zone where an active work unit lives
   * Returns { board, zone } or null
   */
  const findActiveWorkUnitZone = (workUnitId) => {
    const opCentre = getActiveOpCentre();
    if (!opCentre || !workUnitId) return null;

    for (const board of opCentre.processBoards || []) {
      const zone = board.workZones?.find((z) => z.workUnitId === workUnitId);
      if (zone) {
        return { board, zone };
      }
    }
    return null;
  };

  /**
   * Open the Start Work Unit modal
   */
  const handleOpenStartWorkUnitModal = (boardId, series) => {
    const opCentre = getActiveOpCentre();
    if (!opCentre) return;

    const planningUnits = getPlanningWorkUnits(boardId);
    if (planningUnits.length === 0) {
      alert('No planning Work Units to start.');
      return;
    }

    // v157: Simplified - no board selection needed, zone added to same board
    const activeWorkUnit = series.allowOverlap ? null : getActiveWorkUnit(boardId);

    setStartWorkUnitConfig({
      boardId,
      series,
      planningUnits,
      activeWorkUnit,
      selectedWorkUnitId: planningUnits[0]?.id || '',
    });
    setShowStartWorkUnitModal(true);
  };

  /**
   * Execute the Start Work Unit action
   * v157: Simplified - zone always added to source board (no destinationBoardId parameter)
   */
  const handleStartWorkUnit = (workUnitId, completeCurrentFirst = false) => {
    const opCentre = getActiveOpCentre();
    if (!opCentre) return;

    const workUnit = company.workUnits?.find((wu) => wu.id === workUnitId);
    if (!workUnit) return;

    const sourceBoard = opCentre.processBoards?.find((b) => b.id === workUnit.boardId);
    if (!sourceBoard) return;

    const series = sourceBoard.workUnitSeries;
    if (!series) return;

    // If completing current first
    if (completeCurrentFirst) {
      const activeWU = getActiveWorkUnit(workUnit.boardId);
      if (activeWU) {
        // Mark current as completed
        setCompany((prev) => ({
          ...prev,
          workUnits: prev.workUnits.map((wu) =>
            wu.id === activeWU.id ? { ...wu, status: 'completed', completedAt: new Date().toISOString() } : wu
          ),
        }));

        // TODO: Handle incomplete tickets from the completed Work Unit
        // For now, they stay in their zone
      }
    }

    // Find the stage to remove from backlog zone
    const backlogZone = sourceBoard.workZones?.find((z) => z.id === series.backlogZoneId);
    if (!backlogZone) return;

    const stageIndex = backlogZone.workStages?.findIndex((s) => s.workUnitId === workUnitId);
    if (stageIndex === -1) return;

    const stageName = backlogZone.workStages[stageIndex].name;

    // Create new zone with activeStages
    const newZoneId = `zone-${Date.now()}`;
    const newZone = {
      id: newZoneId,
      name: workUnit.name,
      type: 'kanban',
      workUnitId: workUnitId,
      workStages: series.activeStages.map((s) => ({ ...s })),
    };

    // Find tickets in the planning stage and update them
    const ticketsToMove = tickets.filter((t) => t.sectionId === series.backlogZoneId && t.column === stageName);

    const firstActiveStageName = series.activeStages[0]?.name || 'To Do';
    const firstActiveStatus = series.activeStages[0]?.defaultStatus || 'todo';

    // Update tickets - v157: boardId stays same (sourceBoard.id)
    // v113 PHASE-6.5d: Add history tracking for sprint-start
    if (ticketsToMove.length > 0) {
      setTickets((prev) =>
        prev.map((t) => {
          if (t.sectionId === series.backlogZoneId && t.column === stageName) {
            // Create history entry for sprint start
            const historyEntry = createHistoryEntry(
              'location',
              'location',
              {
                boardId: t.boardId,
                boardName: getDisplayName('board', t.boardId),
                zoneId: t.zoneId || t.sectionId,
                zoneName: getDisplayName('zone', t.zoneId || t.sectionId),
                stage: t.column,
                workUnitId: t.workUnitId,
                workUnitName: getDisplayName('workUnit', t.workUnitId),
              },
              {
                boardId: sourceBoard.id,
                boardName: sourceBoard.name,
                zoneId: newZoneId,
                zoneName: workUnit.name,
                stage: firstActiveStageName,
                workUnitId: workUnitId,
                workUnitName: workUnit.name,
              },
              'sprint-start'
            );

            return {
              ...t,
              boardId: sourceBoard.id, // v157: stays on same board
              sectionId: newZoneId,
              zoneId: newZoneId,
              column: firstActiveStageName,
              status: firstActiveStatus,
              updatedAt: new Date(),
              history: [...(t.history || []), historyEntry],
            };
          }
          return t;
        })
      );
    }

    // Update Work Unit status
    setCompany((prev) => ({
      ...prev,
      workUnits: prev.workUnits.map((wu) =>
        wu.id === workUnitId ? { ...wu, status: 'active', startedAt: new Date().toISOString() } : wu
      ),
    }));

    // v157: Update board - remove stage from backlog AND add new zone to SAME board
    setOpCentres((prev) =>
      prev.map((oc) => {
        if (oc.id !== opCentre.id) return oc;
        return {
          ...oc,
          processBoards: oc.processBoards.map((pb) => {
            if (pb.id !== sourceBoard.id) return pb;
            // Same board: remove planning stage from backlog AND add new zone
            return {
              ...pb,
              workZones: [
                // Keep existing zones, but remove planning stage from backlog zone
                ...pb.workZones.map((zone) => {
                  if (zone.id !== series.backlogZoneId) return zone;
                  return {
                    ...zone,
                    workStages: zone.workStages.filter((s) => s.workUnitId !== workUnitId),
                  };
                }),
                // Add new active zone
                newZone,
              ],
            };
          }),
        };
      })
    );

    // Close start modal and show success
    setShowStartWorkUnitModal(false);
    setStartWorkUnitConfig(null);
    setWorkUnitSuccessInfo({
      workUnit,
      series, // v149: Include series for WorkUnitSuccessModal
      destinationBoard: sourceBoard, // v157: same board
      newZoneId,
      ticketCount: ticketsToMove.length,
    });
    setShowWorkUnitSuccessModal(true);
  };

  // v157: handleCreateBoardAndStart removed - no longer needed
  // Zone is now always added to the source board (the one that owns workUnitSeries)

  // ========================================
  // v077 Phase 6.4: Complete Work Unit Functions
  // ========================================

  /**
   * Get tickets in a zone that are not completed (incomplete work)
   */
  const getIncompleteTicketsInZone = (zoneId) => {
    return tickets.filter((t) => t.sectionId === zoneId && t.status !== 'completed' && t.status !== 'cancelled');
  };

  /**
   * Get completed tickets in a zone
   */
  const getCompletedTicketsInZone = (zoneId) => {
    return tickets.filter((t) => t.sectionId === zoneId && (t.status === 'completed' || t.status === 'cancelled'));
  };

  /**
   * Get the Work Unit associated with a zone (if any)
   */
  const getZoneWorkUnit = (zoneId) => {
    const opCentre = getActiveOpCentre();
    if (!opCentre) return null;

    // Find the zone across all boards
    for (const board of opCentre.processBoards || []) {
      const zone = board.workZones?.find((z) => z.id === zoneId);
      if (zone?.workUnitId) {
        return company.workUnits?.find((wu) => wu.id === zone.workUnitId);
      }
    }
    return null;
  };

  /**
   * Open the Complete Work Unit modal
   */
  const handleOpenCompleteWorkUnitModal = (zoneId) => {
    const opCentre = getActiveOpCentre();
    if (!opCentre) return;

    // Find the zone and its work unit
    let sourceBoard = null;
    let zone = null;
    for (const board of opCentre.processBoards || []) {
      const foundZone = board.workZones?.find((z) => z.id === zoneId);
      if (foundZone) {
        sourceBoard = board;
        zone = foundZone;
        break;
      }
    }

    if (!zone?.workUnitId) return;

    const workUnit = company.workUnits?.find((wu) => wu.id === zone.workUnitId);
    if (!workUnit || workUnit.status !== 'active') return;

    // Find the backlog board for this work unit series
    const backlogBoard = opCentre.processBoards?.find((b) => b.id === workUnit.boardId);
    const series = backlogBoard?.workUnitSeries;

    const incompleteTickets = getIncompleteTicketsInZone(zoneId);
    const completedTickets = getCompletedTicketsInZone(zoneId);

    // Find available rollover targets
    const planningUnits = (company.workUnits || []).filter(
      (wu) => wu.boardId === workUnit.boardId && wu.status === 'planning'
    );

    // Find next active work unit (if overlap is allowed)
    const otherActiveUnits = (company.workUnits || []).filter(
      (wu) => wu.boardId === workUnit.boardId && wu.status === 'active' && wu.id !== workUnit.id
    );

    setCompleteWorkUnitConfig({
      workUnit,
      zone,
      zoneId,
      sourceBoard,
      backlogBoard,
      series,
      incompleteTickets,
      completedTickets,
      planningUnits,
      otherActiveUnits,
      rolloverTargets: [...otherActiveUnits, ...planningUnits],
    });
    setShowCompleteWorkUnitModal(true);
  };

  /**
   * Complete a Work Unit (sprint/phase)
   * @param {string} workUnitId - The work unit to complete
   * @param {string} rolloverOption - 'backlog' | 'next' | 'keep'
   * @param {string|null} targetWorkUnitId - Target for 'next' option
   */
  const handleCompleteWorkUnit = (workUnitId, rolloverOption, targetWorkUnitId = null) => {
    const config = completeWorkUnitConfig;
    if (!config) return;

    const opCentre = getActiveOpCentre();
    if (!opCentre) return;

    const { workUnit, zoneId, sourceBoard, backlogBoard, series, incompleteTickets } = config;

    // 1. Handle incomplete tickets based on rolloverOption
    if (incompleteTickets.length > 0) {
      if (rolloverOption === 'backlog' && series?.backlogZoneId) {
        // Move incomplete tickets back to backlog
        const backlogZone = backlogBoard?.workZones?.find((z) => z.id === series.backlogZoneId);
        // Find the "Backlog" stage or first stage
        const backlogStage =
          backlogZone?.workStages?.find((s) => {
            const name = (typeof s === 'string' ? s : s.name || '').toLowerCase();
            return name === 'backlog' || name === 'parked';
          }) || backlogZone?.workStages?.[0];
        const backlogStageName = typeof backlogStage === 'string' ? backlogStage : backlogStage?.name || 'Backlog';

        // v113 PHASE-6.5d: Add history tracking for backlog rollover
        setTickets((prev) =>
          prev.map((t) => {
            if (incompleteTickets.some((it) => it.id === t.id)) {
              const historyEntry = createHistoryEntry(
                'location',
                'location',
                {
                  boardId: t.boardId,
                  boardName: getDisplayName('board', t.boardId),
                  zoneId: t.zoneId || t.sectionId,
                  zoneName: getDisplayName('zone', t.zoneId || t.sectionId),
                  stage: t.column,
                  workUnitId: t.workUnitId,
                  workUnitName: workUnit?.name,
                },
                {
                  boardId: backlogBoard.id,
                  boardName: backlogBoard.name,
                  zoneId: series.backlogZoneId,
                  zoneName: backlogZone?.name,
                  stage: backlogStageName,
                  workUnitId: null,
                  workUnitName: null,
                },
                'rollover'
              );

              return {
                ...t,
                boardId: backlogBoard.id,
                sectionId: series.backlogZoneId,
                zoneId: series.backlogZoneId,
                column: backlogStageName,
                status: 'backlog',
                workUnitId: null, // Clear work unit assignment
                updatedAt: new Date(),
                history: [...(t.history || []), historyEntry],
              };
            }
            return t;
          })
        );
      } else if (rolloverOption === 'next' && targetWorkUnitId) {
        // Find the target work unit
        const targetWorkUnit = company.workUnits?.find((wu) => wu.id === targetWorkUnitId);

        if (targetWorkUnit?.status === 'active') {
          // Target is active - find its zone
          let targetZone = null;
          for (const board of opCentre.processBoards || []) {
            const foundZone = board.workZones?.find((z) => z.workUnitId === targetWorkUnitId);
            if (foundZone) {
              targetZone = foundZone;
              break;
            }
          }

          if (targetZone) {
            // v082 BUG-081-001: Preserve stage by matching name
            // v113 PHASE-6.5d: Add history tracking for rollover to active work unit
            setTickets((prev) =>
              prev.map((t) => {
                if (incompleteTickets.some((it) => it.id === t.id)) {
                  // Get stage from incompleteTickets (captured when modal opened)
                  const originalTicket = incompleteTickets.find((it) => it.id === t.id);
                  const currentStageName = originalTicket?.column || t.column;
                  const matchingStage = targetZone.workStages?.find((s) => {
                    const sName = typeof s === 'string' ? s : s.name;
                    return sName === currentStageName;
                  });

                  let newStageName, newStageStatus;
                  if (matchingStage) {
                    // Preserve stage
                    newStageName = typeof matchingStage === 'string' ? matchingStage : matchingStage.name;
                    newStageStatus = matchingStage?.defaultStatus || 'todo';
                  } else {
                    // Fall back to first stage
                    const firstStage = targetZone.workStages?.[0];
                    newStageName = typeof firstStage === 'string' ? firstStage : firstStage?.name || 'To Do';
                    newStageStatus = firstStage?.defaultStatus || 'todo';
                  }

                  const historyEntry = createHistoryEntry(
                    'location',
                    'location',
                    {
                      boardId: t.boardId,
                      boardName: getDisplayName('board', t.boardId),
                      zoneId: t.zoneId || t.sectionId,
                      zoneName: getDisplayName('zone', t.zoneId || t.sectionId),
                      stage: t.column,
                      workUnitId: t.workUnitId,
                      workUnitName: workUnit?.name,
                    },
                    {
                      boardId: t.boardId,
                      boardName: getDisplayName('board', t.boardId),
                      zoneId: targetZone.id,
                      zoneName: targetZone.name,
                      stage: newStageName,
                      workUnitId: targetWorkUnitId,
                      workUnitName: targetWorkUnit?.name,
                    },
                    'rollover'
                  );

                  return {
                    ...t,
                    sectionId: targetZone.id,
                    zoneId: targetZone.id,
                    column: newStageName,
                    status: newStageStatus,
                    workUnitId: targetWorkUnitId,
                    updatedAt: new Date(),
                    history: [...(t.history || []), historyEntry],
                  };
                }
                return t;
              })
            );
          }
        } else if (targetWorkUnit?.status === 'planning') {
          // v082: Target is planning - START it first, then move tickets
          // Correct order:
          // 1. Create Sprint 2 zone
          // 2. Move Sprint 2 planning tickets → To Do
          // 3. Move Sprint 1 incomplete tickets → SAME STAGE they were in
          // 4. Remove Sprint 2 planning stage from backlog
          // 5. (Later) Remove Sprint 1 zone and mark completed

          const backlogZone = backlogBoard?.workZones?.find((z) => z.id === series.backlogZoneId);
          const targetStage = backlogZone?.workStages?.find((s) => s.workUnitId === targetWorkUnitId);
          const targetStageName = typeof targetStage === 'string' ? targetStage : targetStage?.name;

          if (targetStage && series?.activeStages) {
            // 1. Create new zone for the target work unit on the source board
            const newZoneId = `zone-${targetWorkUnitId}`;
            const newZone = {
              id: newZoneId,
              name: targetWorkUnit.name,
              type: 'kanban',
              workUnitId: targetWorkUnitId,
              workStages: series.activeStages.map((stage) => ({
                name: stage.name,
                defaultStatus: stage.defaultStatus,
              })),
            };

            const firstStage = newZone.workStages?.[0];
            const firstStageName = firstStage?.name || 'To Do';
            const firstStageStatus = firstStage?.defaultStatus || 'todo';

            // 2 & 3. Update ALL tickets in one pass
            setTickets((prev) =>
              prev.map((t) => {
                // Check if this is a Sprint 2 PLANNING ticket (already in backlog "Sprint 2" stage)
                const isSprint2PlanningTicket = t.sectionId === series.backlogZoneId && t.column === targetStageName;

                // Check if this is a Sprint 1 INCOMPLETE ticket (being rolled over)
                const isSprint1IncompleteTicket = incompleteTickets.some((it) => it.id === t.id);

                if (isSprint2PlanningTicket) {
                  // Sprint 2 planning tickets → To Do (first stage)
                  // v113 PHASE-6.5d: Add history for sprint-start
                  const historyEntry = createHistoryEntry(
                    'location',
                    'location',
                    {
                      boardId: t.boardId,
                      boardName: getDisplayName('board', t.boardId),
                      zoneId: t.zoneId || t.sectionId,
                      zoneName: getDisplayName('zone', t.zoneId || t.sectionId),
                      stage: t.column,
                      workUnitId: t.workUnitId,
                      workUnitName: getDisplayName('workUnit', t.workUnitId),
                    },
                    {
                      boardId: sourceBoard.id,
                      boardName: sourceBoard.name,
                      zoneId: newZoneId,
                      zoneName: targetWorkUnit.name,
                      stage: firstStageName,
                      workUnitId: targetWorkUnitId,
                      workUnitName: targetWorkUnit.name,
                    },
                    'sprint-start'
                  );

                  return {
                    ...t,
                    boardId: sourceBoard.id,
                    sectionId: newZoneId,
                    zoneId: newZoneId,
                    column: firstStageName,
                    status: firstStageStatus,
                    workUnitId: targetWorkUnitId,
                    updatedAt: new Date(),
                    history: [...(t.history || []), historyEntry],
                  };
                } else if (isSprint1IncompleteTicket) {
                  // Sprint 1 incomplete tickets → PRESERVE their stage
                  // v082 BUG-081-001: Get stage from incompleteTickets (captured when modal opened)
                  const originalTicket = incompleteTickets.find((it) => it.id === t.id);
                  const currentStageName = originalTicket?.column || t.column;
                  const matchingStage = newZone.workStages?.find((s) => s.name === currentStageName);

                  let newStageName, newStageStatus;
                  if (matchingStage) {
                    // Stage exists in Sprint 2 - preserve it!
                    newStageName = matchingStage.name;
                    newStageStatus = matchingStage.defaultStatus || 'todo';
                  } else {
                    // Stage doesn't exist - fall back to To Do
                    newStageName = firstStageName;
                    newStageStatus = firstStageStatus;
                  }

                  // v113 PHASE-6.5d: Add history for rollover
                  const historyEntry = createHistoryEntry(
                    'location',
                    'location',
                    {
                      boardId: t.boardId,
                      boardName: getDisplayName('board', t.boardId),
                      zoneId: t.zoneId || t.sectionId,
                      zoneName: getDisplayName('zone', t.zoneId || t.sectionId),
                      stage: t.column,
                      workUnitId: t.workUnitId,
                      workUnitName: workUnit?.name,
                    },
                    {
                      boardId: sourceBoard.id,
                      boardName: sourceBoard.name,
                      zoneId: newZoneId,
                      zoneName: targetWorkUnit.name,
                      stage: newStageName,
                      workUnitId: targetWorkUnitId,
                      workUnitName: targetWorkUnit.name,
                    },
                    'rollover'
                  );

                  return {
                    ...t,
                    boardId: sourceBoard.id,
                    sectionId: newZoneId,
                    zoneId: newZoneId,
                    column: newStageName,
                    status: newStageStatus,
                    workUnitId: targetWorkUnitId,
                    updatedAt: new Date(),
                    history: [...(t.history || []), historyEntry],
                  };
                }
                return t;
              })
            );

            // 4. Add the new zone to the source board and remove stage from backlog
            setOpCentres((prev) =>
              prev.map((oc) => {
                if (oc.id !== opCentre.id) return oc;
                return {
                  ...oc,
                  processBoards: oc.processBoards.map((pb) => {
                    // Add zone to source board
                    if (pb.id === sourceBoard.id) {
                      return {
                        ...pb,
                        workZones: [...(pb.workZones || []), newZone],
                      };
                    }
                    // Remove planning stage from backlog board
                    if (pb.id === backlogBoard.id) {
                      return {
                        ...pb,
                        workZones: pb.workZones.map((z) => {
                          if (z.id !== series.backlogZoneId) return z;
                          return {
                            ...z,
                            workStages: z.workStages.filter((s) => s.workUnitId !== targetWorkUnitId),
                          };
                        }),
                      };
                    }
                    return pb;
                  }),
                };
              })
            );

            // Mark target work unit as active
            setCompany((prev) => ({
              ...prev,
              workUnits: prev.workUnits.map((wu) =>
                wu.id === targetWorkUnitId ? { ...wu, status: 'active', startedAt: new Date().toISOString() } : wu
              ),
            }));
          }
        }
      }
      // v116 FEAT-116-001: Auto-create next work unit and roll tickets to it
      else if (rolloverOption === 'auto-create' && series) {
        // 1. Generate the next work unit
        const workUnitName = getNextWorkUnitName(series);
        const newWorkUnitId = `workunit-${Date.now()}`;

        // 2. Create the Work Unit record
        const newWorkUnit = {
          id: newWorkUnitId,
          workCentreId: opCentre.id,
          boardId: backlogBoard.id,
          name: workUnitName,
          status: 'active', // Start immediately since we're rolling over to it
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          completedAt: null,
        };

        // Add Work Unit to company.workUnits
        setCompany((prev) => ({
          ...prev,
          workUnits: [...(prev.workUnits || []), newWorkUnit],
        }));

        // 3. Create new zone for the new work unit
        const newZoneId = `zone-${newWorkUnitId}`;
        const newZone = {
          id: newZoneId,
          name: workUnitName,
          type: 'kanban',
          workUnitId: newWorkUnitId,
          workStages: series.activeStages.map((stage) => ({
            name: stage.name,
            defaultStatus: stage.defaultStatus,
          })),
        };

        const firstStage = newZone.workStages?.[0];
        const firstStageName = firstStage?.name || 'To Do';
        const firstStageStatus = firstStage?.defaultStatus || 'todo';

        // 4. Move incomplete tickets to the new work unit, preserving their stage
        setTickets((prev) =>
          prev.map((t) => {
            if (incompleteTickets.some((it) => it.id === t.id)) {
              const originalTicket = incompleteTickets.find((it) => it.id === t.id);
              const currentStageName = originalTicket?.column || t.column;
              const matchingStage = newZone.workStages?.find((s) => s.name === currentStageName);

              let newStageName, newStageStatus;
              if (matchingStage) {
                newStageName = matchingStage.name;
                newStageStatus = matchingStage.defaultStatus || 'todo';
              } else {
                newStageName = firstStageName;
                newStageStatus = firstStageStatus;
              }

              const historyEntry = createHistoryEntry(
                'location',
                'location',
                {
                  boardId: t.boardId,
                  boardName: getDisplayName('board', t.boardId),
                  zoneId: t.zoneId || t.sectionId,
                  zoneName: getDisplayName('zone', t.zoneId || t.sectionId),
                  stage: t.column,
                  workUnitId: t.workUnitId,
                  workUnitName: workUnit?.name,
                },
                {
                  boardId: sourceBoard.id,
                  boardName: sourceBoard.name,
                  zoneId: newZoneId,
                  zoneName: workUnitName,
                  stage: newStageName,
                  workUnitId: newWorkUnitId,
                  workUnitName: workUnitName,
                },
                'rollover'
              );

              return {
                ...t,
                boardId: sourceBoard.id,
                sectionId: newZoneId,
                zoneId: newZoneId,
                column: newStageName,
                status: newStageStatus,
                workUnitId: newWorkUnitId,
                updatedAt: new Date(),
                history: [...(t.history || []), historyEntry],
              };
            }
            return t;
          })
        );

        // 5. Add the new zone to the source board and increment sequence
        setOpCentres((prev) =>
          prev.map((oc) => {
            if (oc.id !== opCentre.id) return oc;
            return {
              ...oc,
              processBoards: oc.processBoards.map((pb) => {
                if (pb.id === sourceBoard.id) {
                  return {
                    ...pb,
                    workZones: [...(pb.workZones || []), newZone],
                  };
                }
                // Increment sequence on backlog board
                if (pb.id === backlogBoard.id && pb.workUnitSeries) {
                  return {
                    ...pb,
                    workUnitSeries: {
                      ...pb.workUnitSeries,
                      currentSequence: (pb.workUnitSeries.currentSequence || 1) + 1,
                    },
                  };
                }
                return pb;
              }),
            };
          })
        );
      }
      // If rolloverOption === 'keep', tickets stay where they are
      // They will be removed with the zone but retain workUnitId for historical tracking
    }

    // 2. For 'keep' option, update tickets to clear their location but retain workUnitId
    if (rolloverOption === 'keep' && incompleteTickets.length > 0) {
      setTickets((prev) =>
        prev.map((t) => {
          if (incompleteTickets.some((it) => it.id === t.id)) {
            return {
              ...t,
              sectionId: null,
              zoneId: null,
              column: null,
              // Keep boardId, status, and workUnitId for historical tracking
              updatedAt: new Date(),
            };
          }
          return t;
        })
      );
    }

    // 3. Also handle completed tickets - clear their zone location but keep workUnitId
    // v082 BUG-081-002: Use config.workUnit.id (reliable) instead of function parameter
    const completedTickets = config.completedTickets || [];
    const sourceWorkUnitId = config.workUnit?.id || workUnitId; // Prefer config over parameter
    if (completedTickets.length > 0) {
      setTickets((prev) =>
        prev.map((t) => {
          if (completedTickets.some((ct) => ct.id === t.id)) {
            return {
              ...t,
              sectionId: null,
              zoneId: null,
              column: null,
              // v082 BUG-081-002: Explicitly SET workUnitId using config.workUnit.id
              workUnitId: sourceWorkUnitId,
              updatedAt: new Date(),
            };
          }
          return t;
        })
      );
    }

    // 4. Mark work unit as completed
    setCompany((prev) => ({
      ...prev,
      workUnits: prev.workUnits.map((wu) =>
        wu.id === workUnitId ? { ...wu, status: 'completed', completedAt: new Date().toISOString() } : wu
      ),
    }));

    // 5. Remove the zone from the board
    setOpCentres((prev) =>
      prev.map((oc) => {
        if (oc.id !== opCentre.id) return oc;
        return {
          ...oc,
          processBoards: oc.processBoards.map((pb) => {
            if (pb.id !== sourceBoard.id) return pb;
            return {
              ...pb,
              workZones: pb.workZones.filter((z) => z.id !== zoneId),
            };
          }),
        };
      })
    );

    // 6. If the completed zone was active, switch to another zone
    if (activeSection === zoneId) {
      // Try to switch to backlog board/zone first
      if (series?.backlogZoneId && backlogBoard) {
        setActiveBoard(backlogBoard.id);
        setActiveSection(series.backlogZoneId);
      } else {
        // Find first available zone in the work centre
        const firstBoard = opCentre.processBoards?.[0];
        const firstZone = firstBoard?.workZones?.[0];
        if (firstBoard && firstZone) {
          setActiveBoard(firstBoard.id);
          setActiveSection(firstZone.id);
        }
      }
    }

    // 7. Close modal
    setShowCompleteWorkUnitModal(false);
    setCompleteWorkUnitConfig(null);
  };

  // Access Control Helper Functions
  const canAccessOpCentre = (opCentre) => {
    if (isAdmin) return true; // Admins can access everything
    if (!opCentre.access) return true; // If no access control, allow all
    if (opCentre.access.type === 'all') return true;
    if (opCentre.access.type === 'specific') {
      return opCentre.access.users.includes(currentUser);
    }
    return true;
  };

  const canAccessBoard = (opCentre, board) => {
    if (isAdmin) return true; // Admins can access everything
    if (!board.access) return true; // If no access control, allow all

    // Check board-level access
    if (board.access.type === 'inherit') {
      // Inherit from Work Centre
      return canAccessOpCentre(opCentre);
    }
    if (board.access.type === 'all') return true;
    if (board.access.type === 'specific') {
      return board.access.users.includes(currentUser);
    }
    return true;
  };

  const getAccessibleOpCentres = () => {
    return opCentres.filter((oc) => canAccessOpCentre(oc));
  };

  const getAccessibleBoards = (opCentre) => {
    return opCentre.processBoards.filter((board) => canAccessBoard(opCentre, board));
  };

  // Helper functions - Work Centre Layer
  const getActiveOpCentre = () => {
    return opCentres.find((oc) => oc.id === activeOpCentreId) || opCentres[0];
  };

  const getCurrentProcessBoard = () => {
    const opCentre = getActiveOpCentre();
    return opCentre?.processBoards.find((pb) => pb.id === activeBoard);
  };

  const getCurrentWorkZone = () => {
    const processBoard = getCurrentProcessBoard();
    return processBoard?.workZones.find((wz) => wz.id === activeSection);
  };

  const getTicketType = (typeId) => {
    return company?.globalTicketTypes?.find((tt) => tt.id === typeId);
  };

  const getFieldDefinition = (fieldId) => {
    return (window.FIELD_LIBRARY_NORMALIZED || {})[fieldId];
  };

  // Helper functions - Existing (KEEP - but update to use Work Centre where possible)
  const getCurrentBoard = () => {
    const opCentre = getActiveOpCentre();
    return opCentre?.processBoards.find((pb) => pb.id === activeBoard);
  };

  const getCurrentSection = () => {
    const board = getCurrentBoard();
    return board?.workZones.find((wz) => wz.id === activeSection);
  };

  // Track the next number locally to avoid async state issues
  const prefixCounterRef = React.useRef({});

  const generateTicketId = (ticketTypeId) => {
    // Find the ticket type to get its prefix
    const ticketType = company?.globalTicketTypes?.find((t) => t.id === ticketTypeId);

    if (!ticketType) return `ITEM-${Date.now()}`; // Fallback with timestamp to ensure uniqueness

    const prefix = ticketType.prefix || 'ITEM';

    // Get the counter - first check local ref, then registry, then default to 1
    const registryEntry = company?.prefixRegistry?.find((p) => p.prefix === prefix);
    const registryNumber = registryEntry?.nextNumber || 1;

    // Use the higher of local ref or registry (to handle rapid creates)
    const localNumber = prefixCounterRef.current[prefix] || 0;
    const nextNumber = Math.max(registryNumber, localNumber);

    // Immediately update local ref for next call
    prefixCounterRef.current[prefix] = nextNumber + 1;

    // Format number: minimum 3 digits, grows naturally after 999
    const formattedNumber = nextNumber < 1000 ? String(nextNumber).padStart(3, '0') : String(nextNumber);

    // Update the prefix registry counter (async, but local ref handles rapid creates)
    setCompany((prevCompany) => ({
      ...prevCompany,
      prefixRegistry: (prevCompany.prefixRegistry || []).map((p) =>
        p.prefix === prefix ? { ...p, nextNumber: Math.max(p.nextNumber || 1, nextNumber + 1) } : p
      ),
    }));

    return `${prefix}-${formattedNumber}`;
  };

  // Legacy function for backwards compatibility - redirects to generateTicketId
  const generateTicketIdFromZone = (zoneId, ticketTypeId) => {
    return generateTicketId(ticketTypeId);
  };

  const generateCustomerId = () => {
    // For CRM records, we use a company-level counter
    // Check if there's a CRM-type prefix, otherwise use default
    const crmType = company?.globalTicketTypes?.find(
      (t) => t.prefix === 'CRM' || t.prefix === 'CUST' || t.prefix === 'CLIENT'
    );

    if (crmType) {
      return generateTicketId(crmType.id);
    }

    // Fallback: use a simple company-level CRM counter
    const nextCrmNumber = company?.nextCrmNumber || 1;
    const formattedNumber = nextCrmNumber < 1000 ? String(nextCrmNumber).padStart(3, '0') : String(nextCrmNumber);

    setCompany((prevCompany) => ({
      ...prevCompany,
      nextCrmNumber: nextCrmNumber + 1,
    }));

    return `CRM-${formattedNumber}`;
  };

  // v113 PHASE-6.5d: Create history entry for ticket tracking
  // Types: 'created' | 'status' | 'assignee' | 'location' | 'workUnit' | 'field'
  // Reasons: 'manual' | 'bulk-edit' | 'rollover' | 'sprint-start' | 'sprint-complete' | 'created'
  const createHistoryEntry = (type, field, from, to, reason = 'manual') => {
    return {
      timestamp: new Date().toISOString(),
      type,
      field,
      from,
      to,
      reason,
      userId: 'current-user', // TODO: Replace with actual user ID when auth is implemented
      userName: 'Current User', // TODO: Replace with actual user name
    };
  };

  // v113: Helper to get display name for a value (status, staff, board, zone, etc.)
  const getDisplayName = (type, id) => {
    if (!id) return null;
    switch (type) {
      case 'status':
        return company?.statuses?.find((s) => s.id === id)?.label || id;
      case 'staff':
        return company?.globalStaff?.find((s) => s.id === id)?.name || id;
      case 'board':
        for (const oc of opCentres || []) {
          const board = oc.processBoards?.find((b) => b.id === id);
          if (board) return board.name;
        }
        return id;
      case 'zone':
        for (const oc of opCentres || []) {
          for (const board of oc.processBoards || []) {
            const zone = board.workZones?.find((z) => z.id === id);
            if (zone) return zone.name;
          }
        }
        return id;
      case 'workUnit':
        return company?.workUnits?.find((wu) => wu.id === id)?.name || id;
      case 'opCentre':
        return opCentres?.find((oc) => oc.id === id)?.name || id;
      default:
        return id;
    }
  };

  const getInitialsColor = (name) => {
    const colors = [
      'bg-red-500',
      'bg-orange-500',
      'bg-yellow-500',
      'bg-green-500',
      'bg-blue-500',
      'bg-indigo-500',
      'bg-purple-500',
      'bg-pink-500',
    ];
    const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    return colors[index];
  };

  const getClientTicketCount = (clientId) => {
    // Count ONLY OPEN tickets for this client respecting the current scope
    return tickets.filter((t) => {
      // Must match client
      if (t.client !== clientId) return false;

      // Must be OPEN (not Done, Closed, or Won't Do)
      if (['Done', 'Closed', "Won't Do"].includes(t.column || t.stage)) return false;

      // Apply scope filtering
      if (filterClientScope.startsWith('board-')) {
        const boardId = filterClientScope.replace('board-', '');
        return t.boardId === boardId;
      } else if (filterClientScope === 'this-opcentre') {
        return t.opCentreId === activeOpCentreId;
      } else {
        return true; // all-opcentres
      }
    }).length;
  };

  const getCurrentClientName = () => {
    if (!filterClient) return null;
    const customer = company.globalCRM.find((c) => c.id === filterClient);
    return customer ? customer.companyName : null;
  };

  const getClientScopeLabel = () => {
    if (filterClientScope.startsWith('board-')) {
      const boardId = filterClientScope.replace('board-', '');
      const opCentre = opCentres.find((oc) => oc.id === activeOpCentreId);
      const board = opCentre?.processBoards?.find((b) => b.id === boardId);
      return board ? `in ${board.name}` : 'in Board';
    } else if (filterClientScope === 'this-opcentre') {
      const opCentre = opCentres.find((oc) => oc.id === activeOpCentreId);
      return opCentre ? `in ${opCentre.name}` : 'in Work Centre';
    } else {
      return 'across all Work Centres';
    }
  };

  // CRUD operations for tickets
  const handleCreateTicket = () => {
    const board = getCurrentBoard();
    const section = getCurrentSection();

    if (section?.type === 'crm') {
      // Initialize customer form with default stage
      setCustomerFormData({
        companyName: '',
        mainContact: '',
        industry: '',
        email: '',
        mainNumber: '',
        website: '',
        notes: '',
        column: board?.defaultStage || 'Lead', // Will be mapped to 'stage' on save
      });
      setEditingCustomer(null);
      setShowCustomerModal(true);
      return;
    }

    // v070 BUG-058-006 Fix: Check if ticket types are configured for this board
    const allowedTypes = board?.allowedTicketTypes || [];
    const availableTypes = allowedTypes
      .map((typeId) => company.globalTicketTypes?.find((t) => t.id === typeId))
      .filter(Boolean);

    if (availableTypes.length === 0) {
      alert(
        `No ticket types enabled for the "${board.name}" Board.\n\nA Board Admin is required to go to Settings and edit the "${board.name}" Board using the Set Ticket Types tab to select which ticket types can be created on this board.`
      );
      return;
    }

    // Initialize with minimal data - user will select type in modal
    setTicketFormData({
      type: '', // User selects this
      name: '', // All other fields are dynamic based on type
    });
    setEditingTicket(null);
    setShowTicketModal(true);
  };

  const handleSubmitTicket = (e) => {
    e.preventDefault();
    const board = getCurrentProcessBoard();
    const opCentre = getActiveOpCentre();

    if (editingTicket) {
      // v113 PHASE-6.5d: Track field changes for history
      const historyEntries = [];

      // Check for status change
      if (ticketFormData.status !== editingTicket.status) {
        historyEntries.push(
          createHistoryEntry(
            'status',
            'status',
            { id: editingTicket.status, name: getDisplayName('status', editingTicket.status) },
            { id: ticketFormData.status, name: getDisplayName('status', ticketFormData.status) },
            'manual'
          )
        );
      }

      // Check for assignee change
      if (ticketFormData.assignee !== editingTicket.assignee) {
        historyEntries.push(
          createHistoryEntry(
            'assignee',
            'assignee',
            { id: editingTicket.assignee, name: getDisplayName('staff', editingTicket.assignee) },
            { id: ticketFormData.assignee, name: getDisplayName('staff', ticketFormData.assignee) },
            'manual'
          )
        );
      }

      // Check for location changes (board, zone, stage)
      const locationChanged =
        ticketFormData.boardId !== editingTicket.boardId ||
        ticketFormData.zoneId !== editingTicket.zoneId ||
        ticketFormData.sectionId !== editingTicket.sectionId ||
        ticketFormData.column !== editingTicket.column;
      if (locationChanged) {
        historyEntries.push(
          createHistoryEntry(
            'location',
            'location',
            {
              boardId: editingTicket.boardId,
              boardName: getDisplayName('board', editingTicket.boardId),
              zoneId: editingTicket.zoneId || editingTicket.sectionId,
              zoneName: getDisplayName('zone', editingTicket.zoneId || editingTicket.sectionId),
              stage: editingTicket.column,
            },
            {
              boardId: ticketFormData.boardId || editingTicket.boardId,
              boardName: getDisplayName('board', ticketFormData.boardId || editingTicket.boardId),
              zoneId: ticketFormData.zoneId || ticketFormData.sectionId,
              zoneName: getDisplayName('zone', ticketFormData.zoneId || ticketFormData.sectionId),
              stage: ticketFormData.column,
            },
            'manual'
          )
        );
      }

      // Check for work unit change
      if (ticketFormData.workUnitId !== editingTicket.workUnitId) {
        historyEntries.push(
          createHistoryEntry(
            'workUnit',
            'workUnitId',
            { id: editingTicket.workUnitId, name: getDisplayName('workUnit', editingTicket.workUnitId) },
            { id: ticketFormData.workUnitId, name: getDisplayName('workUnit', ticketFormData.workUnitId) },
            'manual'
          )
        );
      }

      // Check for priority change
      if (ticketFormData.priority !== editingTicket.priority) {
        historyEntries.push(
          createHistoryEntry(
            'field',
            'priority',
            { value: editingTicket.priority },
            { value: ticketFormData.priority },
            'manual'
          )
        );
      }

      // v144: Calculate lifecycle date updates if status changed
      const lifecycleDateUpdates =
        ticketFormData.status !== editingTicket.status
          ? getLifecycleDateUpdates(editingTicket, editingTicket.status, ticketFormData.status, company.statuses)
          : {};

      // v154: scopedAt trigger - workUnitId assignment (null → value)
      // This is separate from status-based trigger (handled in getLifecycleDateUpdates)
      const isWorkUnitAssignment = !editingTicket.workUnitId && ticketFormData.workUnitId;
      if (isWorkUnitAssignment && !editingTicket.scopedAt && !lifecycleDateUpdates.scopedAt) {
        lifecycleDateUpdates.scopedAt = new Date().toISOString();
      }

      setTickets(
        tickets.map((t) =>
          t.id === editingTicket.id
            ? {
                ...t,
                ...ticketFormData,
                ...lifecycleDateUpdates, // v144: Apply lifecycle dates
                updatedAt: new Date(),
                history: [...(t.history || []), ...historyEntries],
              }
            : t
        )
      );
      setShowTicketModal(false);
      setEditingTicket(null);
      setTicketOpenedFromCustomer(false); // v175: Reset modal stacking flag
      // v105: All Tickets View stays open, no need to re-open it
    } else {
      // v072: Get the ticket type from formData.typeId
      const ticketTypeId = ticketFormData.typeId;
      let newTicketId = generateTicketId(ticketTypeId);

      // Safety check: ensure ID is unique (shouldn't happen, but just in case)
      let attempts = 0;
      while (tickets.some((t) => t.id === newTicketId) && attempts < 100) {
        newTicketId = generateTicketId(ticketTypeId);
        attempts++;
      }

      // Get the default zone and stage, then look up the correct status
      const defaultZone = board.workZones?.find((z) => z.id === board.defaultZone);

      // v078 BUG-077-001 Fix: Validate that defaultStage exists in the zone
      // If it doesn't exist (e.g., Work Unit stage was moved), fall back to first stage
      let actualDefaultStage = board.defaultStage;
      if (defaultZone?.workStages) {
        const stageExists = defaultZone.workStages.some((s) => {
          const stageName = typeof s === 'string' ? s : s.name;
          return stageName === board.defaultStage;
        });
        if (!stageExists && defaultZone.workStages.length > 0) {
          // Fall back to first stage in the zone
          const firstStage = defaultZone.workStages[0];
          actualDefaultStage = typeof firstStage === 'string' ? firstStage : firstStage.name;
          console.warn(
            `BUG-077-001 Fix: defaultStage "${board.defaultStage}" not found in zone, using "${actualDefaultStage}"`
          );
        }
      }

      const defaultStatus = getStageDefaultStatus(defaultZone?.workStages, actualDefaultStage);

      // v078 BUG-077-001 Fix: Also get workUnitId from default stage if it's a Work Unit stage
      const defaultStageObj = defaultZone?.workStages?.find((s) => {
        const stageName = typeof s === 'string' ? s : s.name;
        return stageName === actualDefaultStage;
      });
      const defaultWorkUnitId =
        defaultStageObj && typeof defaultStageObj === 'object' ? defaultStageObj.workUnitId || null : null;

      // v163: Calculate order for new ticket (bottom of column, 1000 increments)
      const columnTickets = tickets.filter((t) => t.sectionId === board.defaultZone && t.column === actualDefaultStage);
      const maxOrder = columnTickets.reduce((max, t) => Math.max(max, t.order ?? 0), 0);
      const newTicketOrder = maxOrder + 1000;

      const newTicket = {
        id: newTicketId,
        ...ticketFormData,
        opCentreId: activeOpCentreId, // CRITICAL: Always set opCentreId
        boardId: board.id,
        sectionId: board.defaultZone,
        zoneId: board.defaultZone, // CRITICAL: Always set zoneId (alias for sectionId)
        column: actualDefaultStage, // v078: Use validated stage
        status: defaultStatus, // Set status from stage's defaultStatus
        workUnitId: defaultWorkUnitId, // v078: Set workUnitId if creating into Work Unit stage
        order: newTicketOrder, // v162: Order for column position
        createdAt: new Date(),
        updatedAt: new Date(),
        comments: [],
        attachments: [],
        // v113 PHASE-6.5d: Initialize history with created entry
        history: [
          createHistoryEntry(
            'created',
            null,
            null,
            {
              boardId: board.id,
              boardName: board.name,
              zoneId: board.defaultZone,
              zoneName: defaultZone?.name,
              stage: actualDefaultStage,
              status: defaultStatus,
            },
            'created'
          ),
        ],
      };
      setTickets([...tickets, newTicket]);

      // Close creation modal
      setShowTicketModal(false);
      setEditingTicket(null);
      setTicketOpenedFromCustomer(false); // v175: Reset modal stacking flag

      // Show success modal with ticket info
      const zone = board.workZones.find((z) => z.id === board.defaultZone);
      setCreatedTicketInfo({
        ticket: newTicket,
        board: board,
        zone: zone,
        opCentre: opCentre,
      });
      setShowTicketSuccessModal(true);
    }
  };

  const handleSaveOpCentre = (updatedOpCentre, keepOpen = false) => {
    // Check if there's a company update (for ticket types)
    if (updatedOpCentre._companyUpdate) {
      setCompany(updatedOpCentre._companyUpdate);
      delete updatedOpCentre._companyUpdate;
    }

    setOpCentres(opCentres.map((oc) => (oc.id === updatedOpCentre.id ? updatedOpCentre : oc)));

    // Only close the modal if not keeping it open
    if (!keepOpen) {
      setShowOpCentreSettings(false);
      setEditingOpCentre(null);
    } else {
      // BUG-P3-001 FIX: Keep modal open but update the editing state with new data
      setEditingOpCentre(updatedOpCentre);
    }
  };

  const handleCreateOpCentre = (newOpCentre) => {
    setOpCentres([...opCentres, newOpCentre]);
    setShowCreateOpCentre(false);
    // Optionally switch to the new Work Centre
    setActiveOpCentreId(newOpCentre.id);
    setCurrentView('opcentre');
  };

  const handleSaveBoardAccess = (updatedBoard) => {
    setOpCentres(
      opCentres.map((oc) => {
        if (oc.id === activeOpCentreId) {
          return {
            ...oc,
            processBoards: oc.processBoards.map((pb) => (pb.id === updatedBoard.id ? updatedBoard : pb)),
          };
        }
        return oc;
      })
    );
    setShowBoardAccessSettings(false);
    setEditingBoardAccess(null);
  };

  // ========================================
  // v178: RECIPROCAL LINK HANDLERS
  // ========================================

  // Get reciprocal link type from linkConfig
  const getReciprocalLinkType = (linkType) => {
    const linkTypeDef = company?.linkConfig?.linkTypes?.find((lt) => lt.id === linkType);
    if (!linkTypeDef) return linkType;
    return linkTypeDef.inverse;
  };

  // Handle reciprocal link creation when user adds a link
  const handleLinkAdded = (sourceTicketId, targetTicketId, linkType, notes) => {
    const reciprocalType = getReciprocalLinkType(linkType);

    setTickets((prev) =>
      prev.map((ticket) => {
        if (ticket.id === targetTicketId) {
          // Check if reciprocal already exists
          const existingReciprocal = (ticket.links || []).find(
            (l) => l.targetTicketId === sourceTicketId && l.type === reciprocalType
          );
          if (existingReciprocal) return ticket;

          const reciprocalLink = {
            id: `link-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            targetTicketId: sourceTicketId,
            type: reciprocalType,
            notes: notes,
            createdAt: new Date().toISOString(),
            createdBy: 'current-user',
          };
          return {
            ...ticket,
            links: [...(ticket.links || []), reciprocalLink],
          };
        }
        return ticket;
      })
    );
  };

  // Handle reciprocal link removal when user removes a link
  const handleLinkRemoved = (sourceTicketId, targetTicketId, linkId) => {
    // Find the link being removed to get its type
    const sourceTicket = tickets.find((t) => t.id === sourceTicketId);
    const removedLink = sourceTicket?.links?.find((l) => l.id === linkId);

    if (removedLink) {
      const reciprocalType = getReciprocalLinkType(removedLink.type);

      // Remove reciprocal from target ticket
      setTickets((prev) =>
        prev.map((ticket) => {
          if (ticket.id === targetTicketId) {
            return {
              ...ticket,
              links: (ticket.links || []).filter(
                (l) => !(l.targetTicketId === sourceTicketId && l.type === reciprocalType)
              ),
            };
          }
          return ticket;
        })
      );
    }
  };

  // Handle opening a linked ticket from within the ticket modal
  const handleOpenLinkedTicket = (linkedTicket) => {
    // Save current ticket if it has changes, then open the linked ticket
    setEditingTicket(linkedTicket);
    setTicketFormData({
      ...linkedTicket,
      sectionId: linkedTicket.sectionId,
      column: linkedTicket.column,
    });
    // Modal stays open, just switches to the new ticket
  };

  const handleEditTicket = (ticket) => {
    setEditingTicket(ticket);
    // Load all fields from the ticket (dynamic based on what was saved)
    setTicketFormData({
      ...ticket, // Copy all fields
      sectionId: ticket.sectionId,
      column: ticket.column,
    });
    setShowTicketModal(true);
  };

  const handleDeleteTicket = (id) => {
    const ticket = tickets.find((t) => t.id === id);
    showConfirmation({
      title: 'Delete Ticket',
      message: `You are about to delete the ticket "${ticket?.name || ticket?.id}" (${ticket?.type || 'Ticket'}).`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      type: 'delete',
      onConfirm: () => {
        // v159: Soft delete - set status to 'deleted' instead of removing
        const now = new Date();
        setTickets((prevTickets) =>
          prevTickets.map((t) => {
            if (t.id !== id) return t;

            // Add history entry
            const historyEntry = {
              timestamp: now.toISOString(),
              field: 'status',
              oldValue: t.status,
              newValue: 'deleted',
              changedBy: 'current-user',
            };

            return {
              ...t,
              status: 'deleted',
              deletedAt: now.toISOString(),
              history: [...(t.history || []), historyEntry],
            };
          })
        );
      },
    });
  };

  // v159: Context menu handlers
  const handleShowContextMenu = (ticket, event, positionInfo) => {
    event.preventDefault();

    // Position menu near click, but keep it on screen
    const x = Math.min(event.clientX, window.innerWidth - 220);
    const y = Math.min(event.clientY, window.innerHeight - 400);

    setContextMenu({
      visible: true,
      x,
      y,
      ticket,
      ticketIndex: positionInfo?.ticketIndex || 0,
      totalTickets: positionInfo?.totalTickets || 0,
      context: positionInfo?.context || 'board', // v160: Track context for action availability
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenu((prev) => ({ ...prev, visible: false, ticket: null }));
  };

  // Close context menu when clicking outside
  // v166: BUG-163-002 FIX - Removed 'contextmenu' listener that was causing race condition
  //       where the same right-click event that opened the menu would immediately close it
  //       in All Tickets view. mousedown is sufficient for click-outside detection.
  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (contextMenu.visible && contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        handleCloseContextMenu();
      }
    };

    if (contextMenu.visible) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [contextMenu.visible]);

  const handleContextMenuAssign = (userId) => {
    if (!contextMenu.ticket) return;

    const now = new Date();
    setTickets((prevTickets) =>
      prevTickets.map((t) => {
        if (t.id !== contextMenu.ticket.id) return t;

        const historyEntry = {
          timestamp: now.toISOString(),
          field: 'assignee',
          oldValue: t.assignee,
          newValue: userId,
          changedBy: 'current-user',
        };

        return {
          ...t,
          assignee: userId,
          history: [...(t.history || []), historyEntry],
        };
      })
    );

    handleCloseContextMenu();
  };

  // v163: Updated to use order swapping for Up/Down, 1000 increments for Top/Bottom
  const handleContextMenuMove = (position) => {
    if (!contextMenu.ticket) return;

    const ticket = contextMenu.ticket;
    const currentBoard = opCentres
      .find((oc) => oc.id === ticket.opCentreId)
      ?.processBoards?.find((b) => b.id === ticket.boardId);
    const currentZone = currentBoard?.workZones?.find((z) => z.id === ticket.sectionId);

    if (!currentZone) return;

    // Get all tickets in same zone and stage, sorted by their order
    const zoneTickets = tickets
      .filter((t) => t.sectionId === ticket.sectionId && t.column === ticket.column && t.status !== 'deleted')
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

    const currentIndex = zoneTickets.findIndex((t) => t.id === ticket.id);

    switch (position) {
      case 'top': {
        if (currentIndex === 0) return; // Already at top
        const firstOrder = zoneTickets[0]?.order ?? 1000;
        const newOrder = firstOrder - 1000;
        setTickets((prevTickets) => prevTickets.map((t) => (t.id === ticket.id ? { ...t, order: newOrder } : t)));
        break;
      }
      case 'up': {
        if (currentIndex <= 0) return; // Can't move up
        const prevTicket = zoneTickets[currentIndex - 1];
        // Swap orders
        const currentOrder = ticket.order ?? 0;
        const prevOrder = prevTicket.order ?? 0;
        setTickets((prevTickets) =>
          prevTickets.map((t) => {
            if (t.id === ticket.id) return { ...t, order: prevOrder };
            if (t.id === prevTicket.id) return { ...t, order: currentOrder };
            return t;
          })
        );
        break;
      }
      case 'down': {
        if (currentIndex >= zoneTickets.length - 1) return; // Can't move down
        const nextTicket = zoneTickets[currentIndex + 1];
        // Swap orders
        const currentOrder = ticket.order ?? 0;
        const nextOrder = nextTicket.order ?? 0;
        setTickets((prevTickets) =>
          prevTickets.map((t) => {
            if (t.id === ticket.id) return { ...t, order: nextOrder };
            if (t.id === nextTicket.id) return { ...t, order: currentOrder };
            return t;
          })
        );
        break;
      }
      case 'bottom': {
        if (currentIndex === zoneTickets.length - 1) return; // Already at bottom
        const lastOrder = zoneTickets[zoneTickets.length - 1]?.order ?? 0;
        const newOrder = lastOrder + 1000;
        setTickets((prevTickets) => prevTickets.map((t) => (t.id === ticket.id ? { ...t, order: newOrder } : t)));
        break;
      }
      default:
        return;
    }

    // v163: Highlight the moved ticket
    setHighlightedTicketId(ticket.id);

    handleCloseContextMenu();
  };

  // v161: Fixed to update zoneId, status, workUnitId + use structured history format
  const handleContextMenuMoveToZone = (targetZoneId) => {
    if (!contextMenu.ticket) return;

    const ticket = contextMenu.ticket;
    const currentBoard = opCentres
      .find((oc) => oc.id === ticket.opCentreId)
      ?.processBoards?.find((b) => b.id === ticket.boardId);
    const targetZone = currentBoard?.workZones?.find((z) => z.id === targetZoneId);

    if (!targetZone || !targetZone.workStages?.length) return;

    // v161: Get stage object to access defaultStatus
    const firstStageObj = targetZone.workStages[0];
    const firstStageName = getStageName(firstStageObj);
    const firstStageStatus = firstStageObj.defaultStatus || getStageDefaultStatus(firstStageObj) || 'new';

    // v161: Determine workUnitId - backlog zones have null, sprint zones have workUnitId
    const targetWorkUnitId = targetZone.type === 'backlog' ? null : targetZone.workUnitId || null;

    // v163: Calculate order for moved ticket (bottom of target column, 1000 increments)
    const targetColumnTickets = tickets.filter(
      (t) => t.sectionId === targetZoneId && t.column === firstStageName && t.id !== ticket.id
    );
    const maxOrder = targetColumnTickets.reduce((max, t) => Math.max(max, t.order ?? 0), 0);
    const newOrder = maxOrder + 1000;

    setTickets((prevTickets) =>
      prevTickets.map((t) => {
        if (t.id !== ticket.id) return t;

        // v161: Use structured history format (matching sprint-start pattern)
        const historyEntry = createHistoryEntry(
          'location',
          'location',
          {
            boardId: t.boardId,
            boardName: getDisplayName('board', t.boardId),
            zoneId: t.zoneId || t.sectionId,
            zoneName: getDisplayName('zone', t.zoneId || t.sectionId),
            stage: t.column,
            workUnitId: t.workUnitId,
            workUnitName: getDisplayName('workUnit', t.workUnitId),
          },
          {
            boardId: t.boardId,
            boardName: getDisplayName('board', t.boardId),
            zoneId: targetZoneId,
            zoneName: targetZone.name || getDisplayName('zone', targetZoneId),
            stage: firstStageName,
            workUnitId: targetWorkUnitId,
            workUnitName: getDisplayName('workUnit', targetWorkUnitId),
          },
          'manual'
        );

        // v161: Update ALL location fields, not just sectionId and column
        return {
          ...t,
          sectionId: targetZoneId,
          zoneId: targetZoneId,
          column: firstStageName,
          status: firstStageStatus,
          workUnitId: targetWorkUnitId,
          order: newOrder, // v163: 1000 increments
          updatedAt: new Date(),
          history: [...(t.history || []), historyEntry],
        };
      })
    );

    // v163: Highlight the moved ticket
    setHighlightedTicketId(ticket.id);

    handleCloseContextMenu();
  };

  const handleContextMenuChangeStatus = (stageName) => {
    if (!contextMenu.ticket) return;

    const ticket = contextMenu.ticket;
    const now = new Date();

    // Get the status from the stage
    const currentBoard = opCentres
      .find((oc) => oc.id === ticket.opCentreId)
      ?.processBoards?.find((b) => b.id === ticket.boardId);
    const currentZone = currentBoard?.workZones?.find((z) => z.id === ticket.sectionId);
    const targetStage = currentZone?.workStages?.find((s) => getStageName(s) === stageName);
    const newStatus = targetStage?.defaultStatus || getStageDefaultStatus(targetStage) || ticket.status;

    // v163: Calculate order for moved ticket (bottom of target column, 1000 increments)
    const targetColumnTickets = tickets.filter(
      (t) => t.sectionId === ticket.sectionId && t.column === stageName && t.id !== ticket.id
    );
    const maxOrder = targetColumnTickets.reduce((max, t) => Math.max(max, t.order ?? 0), 0);
    const newOrder = maxOrder + 1000;

    setTickets((prevTickets) =>
      prevTickets.map((t) => {
        if (t.id !== ticket.id) return t;

        const historyEntry = {
          timestamp: now.toISOString(),
          field: 'status',
          oldValue: `${t.column} (${t.status})`,
          newValue: `${stageName} (${newStatus})`,
          changedBy: currentUser, // v162: Use actual currentUser instead of 'current-user'
        };

        // Get lifecycle date updates
        const lifecycleUpdates = getLifecycleDateUpdates
          ? getLifecycleDateUpdates(t, t.status, newStatus, company?.statuses)
          : {};

        return {
          ...t,
          column: stageName,
          status: newStatus,
          order: newOrder, // v163: 1000 increments
          ...lifecycleUpdates,
          history: [...(t.history || []), historyEntry],
        };
      })
    );

    // v163: Highlight the moved ticket
    setHighlightedTicketId(ticket.id);

    handleCloseContextMenu();
  };

  const handleContextMenuCopyLink = () => {
    if (!contextMenu.ticket) return;

    const link = `numa://ticket/${company?.id || 'company'}/${contextMenu.ticket.id}`;
    navigator.clipboard.writeText(link);

    // Brief feedback
    handleCloseContextMenu();
  };

  // v103: Bulk update tickets from All Tickets View
  // v113: Added history tracking for bulk edits
  const handleBulkUpdateTickets = (ticketIds, changes) => {
    if (!ticketIds || ticketIds.length === 0 || !changes) return;

    const now = new Date();
    setTickets((prevTickets) =>
      prevTickets.map((ticket) => {
        if (ticketIds.includes(ticket.id)) {
          // v113 PHASE-6.5d: Build history entries for changed fields
          const historyEntries = [];

          // v118 BUG-117-001: Check if boardId is changing
          // Work Units belong to specific boards, so moving cross-board should clear workUnitId
          const isCrossBoardMove = changes.boardId !== undefined && changes.boardId !== ticket.boardId;
          const workUnitExplicitlySet = changes.workUnitId !== undefined;

          // If cross-board move and workUnitId not explicitly set, we need to clear it
          let effectiveWorkUnitId = ticket.workUnitId;
          if (isCrossBoardMove && !workUnitExplicitlySet && ticket.workUnitId) {
            effectiveWorkUnitId = null;
            // Record the work unit removal in history
            historyEntries.push(
              createHistoryEntry(
                'workUnit',
                'workUnitId',
                { id: ticket.workUnitId, name: getDisplayName('workUnit', ticket.workUnitId) },
                { id: null, name: 'None' },
                'bulk-edit'
              )
            );
          }

          // v150 BUG-149-001 FIX: When changing stage/zone (without explicit workUnitId set),
          // determine the correct workUnitId from the target zone/stage
          const isStageOrZoneChange =
            !isCrossBoardMove &&
            !workUnitExplicitlySet &&
            ((changes.column !== undefined && changes.column !== ticket.column) ||
              (changes.zoneId !== undefined && changes.zoneId !== ticket.zoneId) ||
              (changes.sectionId !== undefined && changes.sectionId !== ticket.sectionId));

          if (isStageOrZoneChange) {
            // Find the target zone
            const targetZoneId = changes.zoneId || changes.sectionId || ticket.zoneId || ticket.sectionId;
            const targetBoardId = changes.boardId || ticket.boardId;
            const targetColumn = changes.column || ticket.column;

            // Look up the zone in opCentres data
            let targetZone = null;
            for (const oc of opCentres) {
              for (const pb of oc.processBoards || []) {
                if (pb.id === targetBoardId) {
                  targetZone = pb.workZones?.find((z) => z.id === targetZoneId);
                  break;
                }
              }
              if (targetZone) break;
            }

            // v150: Check zone.workUnitId first (active Work Unit zones have this at zone level)
            let newWorkUnitId = targetZone?.workUnitId || null;

            // Only check stage-level workUnitId if zone doesn't have one (backlog planning stages)
            if (!newWorkUnitId && targetColumn) {
              const targetStage = targetZone?.workStages?.find(
                (s) => (typeof s === 'string' ? s : s.name) === targetColumn
              );
              newWorkUnitId = targetStage && typeof targetStage === 'object' ? targetStage.workUnitId || null : null;
            }

            // Update effectiveWorkUnitId and record history if changed
            if (newWorkUnitId !== ticket.workUnitId) {
              effectiveWorkUnitId = newWorkUnitId;
              historyEntries.push(
                createHistoryEntry(
                  'workUnit',
                  'workUnitId',
                  { id: ticket.workUnitId, name: getDisplayName('workUnit', ticket.workUnitId) },
                  { id: newWorkUnitId, name: getDisplayName('workUnit', newWorkUnitId) },
                  'bulk-edit'
                )
              );
            }
          }

          if (changes.status !== undefined && changes.status !== ticket.status) {
            historyEntries.push(
              createHistoryEntry(
                'status',
                'status',
                { id: ticket.status, name: getDisplayName('status', ticket.status) },
                { id: changes.status, name: getDisplayName('status', changes.status) },
                'bulk-edit'
              )
            );
          }

          if (changes.assignee !== undefined && changes.assignee !== ticket.assignee) {
            historyEntries.push(
              createHistoryEntry(
                'assignee',
                'assignee',
                { id: ticket.assignee, name: getDisplayName('staff', ticket.assignee) },
                { id: changes.assignee, name: getDisplayName('staff', changes.assignee) },
                'bulk-edit'
              )
            );
          }

          if (changes.priority !== undefined && changes.priority !== ticket.priority) {
            historyEntries.push(
              createHistoryEntry(
                'field',
                'priority',
                { value: ticket.priority },
                { value: changes.priority },
                'bulk-edit'
              )
            );
          }

          // Only record explicit workUnitId changes here (cross-board auto-clear is recorded above)
          if (workUnitExplicitlySet && changes.workUnitId !== ticket.workUnitId) {
            historyEntries.push(
              createHistoryEntry(
                'workUnit',
                'workUnitId',
                { id: ticket.workUnitId, name: getDisplayName('workUnit', ticket.workUnitId) },
                { id: changes.workUnitId, name: getDisplayName('workUnit', changes.workUnitId) },
                'bulk-edit'
              )
            );
          }

          // Location changes (boardId, zoneId/sectionId, column)
          const locationChanged =
            (changes.boardId !== undefined && changes.boardId !== ticket.boardId) ||
            (changes.zoneId !== undefined && changes.zoneId !== ticket.zoneId) ||
            (changes.sectionId !== undefined && changes.sectionId !== ticket.sectionId) ||
            (changes.column !== undefined && changes.column !== ticket.column);

          if (locationChanged) {
            historyEntries.push(
              createHistoryEntry(
                'location',
                'location',
                {
                  opCentreId: ticket.opCentreId,
                  opCentreName: getDisplayName('opCentre', ticket.opCentreId),
                  boardId: ticket.boardId,
                  boardName: getDisplayName('board', ticket.boardId),
                  zoneId: ticket.zoneId || ticket.sectionId,
                  zoneName: getDisplayName('zone', ticket.zoneId || ticket.sectionId),
                  stage: ticket.column,
                },
                {
                  opCentreId: changes.opCentreId || ticket.opCentreId,
                  opCentreName: getDisplayName('opCentre', changes.opCentreId || ticket.opCentreId),
                  boardId: changes.boardId || ticket.boardId,
                  boardName: getDisplayName('board', changes.boardId || ticket.boardId),
                  zoneId: changes.zoneId || changes.sectionId || ticket.zoneId || ticket.sectionId,
                  zoneName: getDisplayName(
                    'zone',
                    changes.zoneId || changes.sectionId || ticket.zoneId || ticket.sectionId
                  ),
                  stage: changes.column || ticket.column,
                },
                'bulk-edit'
              )
            );
          }

          // v150 BUG-149-001: Build final changes, including workUnitId updates
          // effectiveWorkUnitId is calculated for cross-board moves AND stage/zone changes
          const finalChanges = { ...changes };
          if (!workUnitExplicitlySet && effectiveWorkUnitId !== ticket.workUnitId) {
            finalChanges.workUnitId = effectiveWorkUnitId;
          }

          // v144: Calculate lifecycle date updates if status changed
          const lifecycleDateUpdates =
            changes.status !== undefined && changes.status !== ticket.status
              ? getLifecycleDateUpdates(ticket, ticket.status, changes.status, company.statuses)
              : {};

          // v154: scopedAt trigger - workUnitId assignment (null → value)
          // Determine the actual final workUnitId being applied
          const finalWorkUnitId =
            finalChanges.workUnitId !== undefined
              ? finalChanges.workUnitId
              : workUnitExplicitlySet
                ? changes.workUnitId
                : ticket.workUnitId;
          const isWorkUnitAssignment = !ticket.workUnitId && finalWorkUnitId;
          if (isWorkUnitAssignment && !ticket.scopedAt && !lifecycleDateUpdates.scopedAt) {
            lifecycleDateUpdates.scopedAt = now.toISOString();
          }

          return {
            ...ticket,
            ...finalChanges,
            ...lifecycleDateUpdates, // v144: Apply lifecycle dates
            updatedAt: now,
            history: [...(ticket.history || []), ...historyEntries],
          };
        }
        return ticket;
      })
    );
  };

  // v109: Bulk delete tickets - no individual confirmations (AllTicketsView handles confirmation)
  const handleBulkDeleteTickets = (ticketIds) => {
    if (!ticketIds || ticketIds.length === 0) return;
    setTickets((prevTickets) => prevTickets.filter((ticket) => !ticketIds.includes(ticket.id)));
  };

  // v100: Handle All Tickets View configuration changes (column widths, sort order)
  const handleAllTicketsViewConfigChange = (newConfig) => {
    const board = getCurrentProcessBoard();
    if (!board) return;

    setOpCentres(
      opCentres.map((oc) => ({
        ...oc,
        processBoards: oc.processBoards.map((pb) =>
          pb.id === board.id ? { ...pb, allTicketsViewConfig: newConfig } : pb
        ),
      }))
    );
  };

  // v149: Handle saved views changes (renamed from saved filter sets)
  // Storage based on entry point (activeBoardId), not scope
  // If entered from a board, ALL views save to that board regardless of scope view
  // If entered from admin (no activeBoardId), views save to company.globalSavedViews
  const handleSavedViewsChange = (newSavedViews, entryBoardId) => {
    if (!entryBoardId) {
      // Admin entry (no board) - save to company global
      setCompany((prev) => ({
        ...prev,
        globalSavedViews: newSavedViews,
        updatedAt: new Date(),
      }));
    } else {
      // Board entry - save to that board
      setOpCentres(
        opCentres.map((oc) => ({
          ...oc,
          processBoards: oc.processBoards.map((pb) =>
            pb.id === entryBoardId ? { ...pb, savedViews: newSavedViews } : pb
          ),
        }))
      );
    }
  };

  // v187: Create new customer and open Detail Modal for editing
  // Replaces old handleSubmitCustomer (basic modal) flow
  const handleCreateCustomer = () => {
    const newCustomer = {
      id: generateCustomerId(),
      companyName: '', // User will fill this in via Detail Modal
      industry: '',
      companySize: '',
      website: '',
      territory: '',
      accountOwnerId: '',
      stage: company.crmConfig?.lifecycleStages?.[0]?.id || '', // Default to first stage
      source: '',
      contractValue: null,
      contractTerm: '',
      contractStartDate: null,
      renewalDate: null,
      products: [],
      productNotes: '',
      notes: '',
      flags: [],
      contacts: [],
      activities: [],
      documents: [],
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: currentUser,
    };

    // Add to globalCRM
    setCompany({
      ...company,
      globalCRM: [...company.globalCRM, newCustomer],
      updatedAt: new Date(),
    });

    // Open Detail Modal for the new customer
    setCustomerDetailModal({
      isOpen: true,
      customerId: newCustomer.id,
    });
  };

  // v169 CRM Phase 2: Open customer detail modal
  const openCustomerDetailModal = (customerId) => {
    setCustomerDetailModal({
      isOpen: true,
      customerId,
    });
  };

  // v169 CRM Phase 2: Close customer detail modal
  const closeCustomerDetailModal = () => {
    setCustomerDetailModal({
      isOpen: false,
      customerId: null,
    });
  };

  // v169 CRM Phase 2: Get customer by ID helper
  const getCustomerById = (customerId) => {
    return company.globalCRM?.find((c) => c.id === customerId) || null;
  };

  // v187: Removed handleEditCustomer - Detail Modal now used everywhere
  // Editing is done via inline editing in CustomerDetailModal

  const handleDeleteCustomer = (id) => {
    const customer = company.globalCRM.find((c) => c.id === id);
    showConfirmation({
      title: 'Delete Customer',
      message: `You are about to delete the customer "${customer?.companyName || customer?.id}" (Customer).`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      type: 'delete',
      onConfirm: () => {
        setCompany({
          ...company,
          globalCRM: company.globalCRM.filter((c) => c.id !== id),
          updatedAt: new Date(),
        });
      },
    });
  };

  // v180: Supplier Management - Delete handler
  const handleDeleteSupplier = (id) => {
    const supplier = (company.globalSuppliers || []).find((s) => s.id === id);
    showConfirmation({
      title: 'Delete Supplier',
      message: `You are about to delete the supplier "${supplier?.companyName || supplier?.id}" (Supplier).`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      type: 'delete',
      onConfirm: () => {
        setCompany({
          ...company,
          globalSuppliers: (company.globalSuppliers || []).filter((s) => s.id !== id),
          updatedAt: new Date(),
        });
      },
    });
  };

  // v181 Supplier Management Session 2: Open supplier detail modal
  const openSupplierDetailModal = (supplier) => {
    setSupplierDetailModal({
      isOpen: true,
      supplierId: supplier?.id || supplier,
    });
  };

  // v181 Supplier Management Session 2: Close supplier detail modal
  const closeSupplierDetailModal = () => {
    setSupplierDetailModal({
      isOpen: false,
      supplierId: null,
    });
  };

  // v181 Supplier Management Session 2: Get supplier by ID helper
  const getSupplierById = (supplierId) => {
    return (company.globalSuppliers || []).find((s) => s.id === supplierId) || null;
  };

  // v181 Supplier Management Session 2: Update supplier inline (for future use in detail modal)
  const handleUpdateSupplier = (supplierId, updates) => {
    setCompany((prev) => ({
      ...prev,
      globalSuppliers: (prev.globalSuppliers || []).map((supplier) =>
        supplier.id === supplierId ? { ...supplier, ...updates, updatedAt: new Date() } : supplier
      ),
      updatedAt: new Date(),
    }));
  };

  // v187: Create new supplier and open Detail Modal for editing
  // Replaces old handleSubmitSupplier (basic modal) flow
  const handleCreateSupplier = () => {
    const newSupplier = {
      id: `supplier-${Date.now()}`,
      companyName: '', // User will fill this in via Detail Modal
      industry: '',
      companySize: '',
      website: '',
      territory: '',
      relationshipOwnerId: '',
      stage: company.supplierConfig?.lifecycleStages?.[0]?.id || '', // Default to first stage
      supplierType: '',
      annualSpend: null,
      paymentTerms: '',
      contractStartDate: null,
      contractEndDate: null,
      productsServices: [],
      serviceNotes: '',
      notes: '',
      flags: [],
      contacts: [],
      activities: [],
      documents: [],
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Add to globalSuppliers
    setCompany({
      ...company,
      globalSuppliers: [...(company.globalSuppliers || []), newSupplier],
      updatedAt: new Date(),
    });

    // Open Detail Modal for the new supplier
    setSupplierDetailModal({
      isOpen: true,
      supplierId: newSupplier.id,
    });
  };

  // v187: Removed handleEditSupplier and handleSubmitSupplier
  // All supplier editing now uses SupplierDetailModal with inline editing

  // Drag and drop handlers
  // v146: Firefox fix - setData FIRST, defer state updates (same pattern as all-tickets-view.jsx)
  const handleDragStart = (e, item) => {
    // Set dataTransfer FIRST (required for Firefox)
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.effectAllowed = 'move';

    // Defer state update (helps Firefox)
    setTimeout(() => {
      setDraggedItem(item);
    }, 0);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  // v163: Handle drag over individual tickets for positional drop
  const handleTicketDragOver = (e, sectionId, column, index) => {
    e.preventDefault();
    setDropTarget({ sectionId, column, index });
  };

  // v163: Handle drag over individual customers for positional drop (CRM zones)
  const handleCustomerDragOver = (e, sectionId, column, index) => {
    e.preventDefault();
    setDropTarget({ sectionId, column, index });
  };

  // v184: Handle drag over individual suppliers for positional drop (Supplier Mirror)
  const handleSupplierDragOver = (e, supplierId) => {
    e.preventDefault();
    setSupplierDropTarget({ type: 'supplier', supplierId });
  };

  // v163: Rebalance orders in a column when gaps get too small
  const rebalanceColumnOrders = (ticketsInColumn) => {
    if (ticketsInColumn.length === 0) return {};

    const updates = {};
    const sorted = [...ticketsInColumn].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    sorted.forEach((ticket, idx) => {
      updates[ticket.id] = (idx + 1) * 1000;
    });
    return updates;
  };

  // v164: Calculate order for positional drop (adjustment done in handleDrop)
  const calculateDropOrder = (sortedTicketsWithoutDragged, adjustedDropIndex, draggedTicketId) => {
    const otherTickets = sortedTicketsWithoutDragged;

    if (otherTickets.length === 0) {
      return { order: 1000, needsRebalance: false };
    }

    if (adjustedDropIndex === 0) {
      // Drop at top
      const firstOrder = otherTickets[0]?.order ?? 1000;
      return { order: firstOrder - 1000, needsRebalance: false };
    }

    if (adjustedDropIndex >= otherTickets.length) {
      // Drop at bottom
      const lastOrder = otherTickets[otherTickets.length - 1]?.order ?? 0;
      return { order: lastOrder + 1000, needsRebalance: false };
    }

    // Drop between two tickets
    const prevOrder = otherTickets[adjustedDropIndex - 1]?.order ?? 0;
    const nextOrder = otherTickets[adjustedDropIndex]?.order ?? prevOrder + 2000;
    const gap = nextOrder - prevOrder;

    if (gap < 10) {
      // Gap too small, need to rebalance
      return { order: null, needsRebalance: true };
    }

    return { order: Math.floor((prevOrder + nextOrder) / 2), needsRebalance: false };
  };

  const handleDrop = (e, targetColumn, sectionId) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedItem) return;

    if (draggedItem.companyName) {
      // It's a customer - update global CRM (stage instead of column)
      const customer = (company?.globalCRM || []).find((c) => c.id === draggedItem.id);
      const isSameStage = customer && customer.stage === targetColumn;

      // v164 FIX: Get sorted list WITH dragged item to find its original index
      const allStageCustomersSorted = (company?.globalCRM || [])
        .filter((c) => c.stage === targetColumn)
        .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
      const draggedOriginalIndex = allStageCustomersSorted.findIndex((c) => c.id === draggedItem.id);

      // v164 FIX: List WITHOUT dragged item for order calculation
      const targetStageCustomers = allStageCustomersSorted.filter((c) => c.id !== draggedItem.id);

      let newOrder;
      let rebalanceUpdates = {};

      if (isSameStage && dropTarget && dropTarget.column === targetColumn) {
        // v164 FIX: Adjust dropIndex if dragging from BEFORE the drop position
        let adjustedDropIndex = dropTarget.index;
        if (draggedOriginalIndex !== -1 && draggedOriginalIndex < dropTarget.index) {
          adjustedDropIndex = dropTarget.index - 1;
        }

        // v164: Same stage - use positional drop with adjusted index
        const { order, needsRebalance } = calculateDropOrder(targetStageCustomers, adjustedDropIndex, draggedItem.id);

        if (needsRebalance) {
          // Need to rebalance the entire stage
          const allInStage = (company?.globalCRM || [])
            .filter((c) => c.stage === targetColumn)
            .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

          // Remove dragged customer and reinsert at adjusted position
          const withoutDragged = allInStage.filter((c) => c.id !== draggedItem.id);
          withoutDragged.splice(adjustedDropIndex, 0, customer);

          // Reassign orders
          withoutDragged.forEach((c, idx) => {
            rebalanceUpdates[c.id] = (idx + 1) * 1000;
          });
          newOrder = rebalanceUpdates[draggedItem.id];
        } else {
          newOrder = order;
        }
      } else {
        // v163: Different stage - always go to bottom
        const maxOrder = targetStageCustomers.reduce((max, c) => Math.max(max, c.order ?? 0), 0);
        newOrder = maxOrder + 1000;
      }

      // Update all customers that need rebalancing
      if (Object.keys(rebalanceUpdates).length > 0) {
        setCompany((prev) => ({
          ...prev,
          globalCRM: prev.globalCRM.map((c) => {
            if (c.id === draggedItem.id) {
              return { ...c, stage: targetColumn, order: newOrder, updatedAt: new Date() };
            }
            if (rebalanceUpdates[c.id] !== undefined) {
              return { ...c, order: rebalanceUpdates[c.id] };
            }
            return c;
          }),
          updatedAt: new Date(),
        }));
      } else {
        updateGlobalCustomer(draggedItem.id, {
          stage: targetColumn,
          order: newOrder,
        });
      }

      // v163: Highlight the moved customer
      setHighlightedCustomerId(draggedItem.id);
    } else {
      // Phase 3: Get the default status from the target stage
      const opCentre = getActiveOpCentre();
      const zone = opCentre?.processBoards.flatMap((pb) => pb.workZones).find((wz) => wz.id === sectionId);

      const newStatus = getStageDefaultStatus(zone?.workStages, targetColumn);

      // v115 BUG-114-002 Fix: Check zone.workUnitId FIRST, then fall back to stage.workUnitId
      // Active Work Unit zones have workUnitId at zone level, not on individual stages
      let newWorkUnitId = zone?.workUnitId || null;

      // Only check stage-level workUnitId if zone doesn't have one (backlog zones)
      if (!newWorkUnitId) {
        const targetStage = zone?.workStages?.find((s) => (typeof s === 'string' ? s : s.name) === targetColumn);
        newWorkUnitId = targetStage && typeof targetStage === 'object' ? targetStage.workUnitId || null : null;
      }

      // v115 BUG-114-001 Fix: Track history for drag-drop moves
      const ticket = tickets.find((t) => t.id === draggedItem.id);
      const historyEntries = [];

      // v116 UX-116-001: Get board info for history tracking
      const targetBoard = opCentre?.processBoards?.find((pb) => pb.workZones?.some((z) => z.id === sectionId));
      const sourceBoard = opCentre?.processBoards?.find((pb) => pb.workZones?.some((z) => z.id === ticket?.sectionId));

      // Track status change if different
      if (ticket && newStatus !== ticket.status) {
        historyEntries.push(
          createHistoryEntry(
            'status',
            'status',
            { id: ticket.status, name: getDisplayName('status', ticket.status) },
            { id: newStatus, name: getDisplayName('status', newStatus) },
            'manual'
          )
        );
      }

      // Track location change (includes board info for v116)
      if (ticket && (sectionId !== ticket.sectionId || targetColumn !== ticket.column)) {
        historyEntries.push(
          createHistoryEntry(
            'location',
            'location',
            {
              opCentreId: opCentre?.id,
              opCentreName: opCentre?.name,
              boardId: sourceBoard?.id || ticket.boardId,
              boardName: sourceBoard?.name || getDisplayName('board', ticket.boardId),
              zoneId: ticket.sectionId,
              zoneName: getDisplayName('zone', ticket.sectionId),
              stage: ticket.column,
            },
            {
              opCentreId: opCentre?.id,
              opCentreName: opCentre?.name,
              boardId: targetBoard?.id,
              boardName: targetBoard?.name,
              zoneId: sectionId,
              zoneName: getDisplayName('zone', sectionId),
              stage: targetColumn,
            },
            'manual'
          )
        );
      }

      // Track work unit change if different
      if (ticket && newWorkUnitId !== ticket.workUnitId) {
        historyEntries.push(
          createHistoryEntry(
            'workUnit',
            'workUnitId',
            { id: ticket.workUnitId, name: getDisplayName('workUnit', ticket.workUnitId) },
            { id: newWorkUnitId, name: getDisplayName('workUnit', newWorkUnitId) },
            'manual'
          )
        );
      }

      // v144: Calculate lifecycle date updates if status changed
      const lifecycleDateUpdates =
        ticket && newStatus !== ticket.status
          ? getLifecycleDateUpdates(ticket, ticket.status, newStatus, company.statuses)
          : {};

      // v154: scopedAt trigger - workUnitId assignment (null → value)
      const isWorkUnitAssignment = ticket && !ticket.workUnitId && newWorkUnitId;
      if (isWorkUnitAssignment && !ticket.scopedAt && !lifecycleDateUpdates.scopedAt) {
        lifecycleDateUpdates.scopedAt = new Date().toISOString();
      }

      // v164: Calculate order based on drop position
      const isSameColumn = ticket && ticket.sectionId === sectionId && ticket.column === targetColumn;

      // v164 FIX: Get sorted list WITH dragged item to find its original index
      const allColumnTicketsSorted = tickets
        .filter((t) => t.sectionId === sectionId && t.column === targetColumn)
        .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
      const draggedOriginalIndex = allColumnTicketsSorted.findIndex((t) => t.id === draggedItem.id);

      // v164 FIX: List WITHOUT dragged item for order calculation
      const targetColumnTickets = allColumnTicketsSorted.filter((t) => t.id !== draggedItem.id);

      let newOrder;
      let rebalanceUpdates = {};

      if (isSameColumn && dropTarget && dropTarget.sectionId === sectionId && dropTarget.column === targetColumn) {
        // v164 FIX: Adjust dropIndex if dragging from BEFORE the drop position
        let adjustedDropIndex = dropTarget.index;
        if (draggedOriginalIndex !== -1 && draggedOriginalIndex < dropTarget.index) {
          adjustedDropIndex = dropTarget.index - 1;
        }

        // v164: Same column - use positional drop with adjusted index
        const { order, needsRebalance } = calculateDropOrder(targetColumnTickets, adjustedDropIndex, draggedItem.id);

        if (needsRebalance) {
          // Need to rebalance the entire column
          const allInColumn = tickets
            .filter((t) => t.sectionId === sectionId && t.column === targetColumn)
            .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

          // Remove dragged ticket and reinsert at adjusted position
          const withoutDragged = allInColumn.filter((t) => t.id !== draggedItem.id);
          withoutDragged.splice(adjustedDropIndex, 0, ticket);

          // Reassign orders
          withoutDragged.forEach((t, idx) => {
            rebalanceUpdates[t.id] = (idx + 1) * 1000;
          });
          newOrder = rebalanceUpdates[draggedItem.id];
        } else {
          newOrder = order;
        }
      } else {
        // v163: Different column - always go to bottom
        const maxOrder = targetColumnTickets.reduce((max, t) => Math.max(max, t.order ?? 0), 0);
        newOrder = maxOrder + 1000;
      }

      setTickets(
        tickets.map((t) => {
          if (t.id === draggedItem.id) {
            return {
              ...t,
              column: targetColumn,
              status: newStatus,
              sectionId,
              workUnitId: newWorkUnitId,
              order: newOrder,
              ...lifecycleDateUpdates,
              updatedAt: new Date(),
              history: [...(t.history || []), ...historyEntries],
            };
          }
          // v163: Apply rebalance updates if needed
          if (rebalanceUpdates[t.id] !== undefined) {
            return { ...t, order: rebalanceUpdates[t.id] };
          }
          return t;
        })
      );

      // v163: Highlight the moved ticket
      setHighlightedTicketId(draggedItem.id);
    }

    // v163: Clear drag state
    setDraggedItem(null);
    setDropTarget(null);
  };

  // Filtering
  const getFilteredItems = (sectionId, column) => {
    const opCentre = getActiveOpCentre();
    const board = getCurrentProcessBoard();
    const zone = opCentre?.processBoards.flatMap((pb) => pb.workZones).find((wz) => wz.id === sectionId);

    if (zone?.type === 'crm') {
      // Check if this board uses global CRM
      if (board?.dataSource?.type === 'global-crm') {
        // Read from company.globalCRM and filter by stage (column)
        const customers = company?.globalCRM || [];
        return customers
          .filter((c) => {
            const matchesSearch =
              c.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
              c.mainContact.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStage = c.stage === column; // Global customers use 'stage' not 'column'
            return matchesSearch && matchesStage;
          })
          .sort((a, b) => {
            // v163: Sort by order field (customers without order go to end, then by ID)
            const aOrder = a.order ?? Infinity;
            const bOrder = b.order ?? Infinity;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return a.id.localeCompare(b.id);
          });
      } else {
        // Legacy: still has local customers (shouldn't happen anymore)
        return [];
      }
    } else {
      return tickets
        .filter((t) => {
          // v159: Exclude deleted tickets from board views
          const isDeletedStatus = window.Domain?.Statuses?.isDeletedStatus;
          const matchesNotDeleted = !isDeletedStatus || !isDeletedStatus(t.status, company?.statuses);

          const matchesSearch =
            t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.id.toLowerCase().includes(searchTerm.toLowerCase());
          const matchesSection = t.sectionId === sectionId && t.column === column;

          // v060: Container filtering removed - will be reimplemented in Phase 6
          // In the new model, work units ARE zones, not filters on zones
          let matchesContainer = true;

          let matchesProject = true;
          if (filterProject) {
            matchesProject = t.id === filterProject || t.parentProject === filterProject;
          }

          let matchesClient = true;
          if (filterClient) {
            // Check if ticket belongs to the filtered client
            const isClientTicket = t.client === filterClient;

            // Apply scope filtering
            let matchesScope = true;
            if (filterClientScope.startsWith('board-')) {
              // Specific board: ticket must be in that board
              const boardId = filterClientScope.replace('board-', '');
              matchesScope = t.boardId === boardId;
            } else if (filterClientScope === 'this-opcentre') {
              // Current op centre: ticket must be in current op centre
              matchesScope = t.opCentreId === activeOpCentreId;
            } else {
              // 'all-opcentres': no additional scope filtering
              matchesScope = true;
            }

            matchesClient = isClientTicket && matchesScope;
          }

          return (
            matchesNotDeleted && matchesSearch && matchesSection && matchesProject && matchesClient && matchesContainer
          );
        })
        .sort((a, b) => {
          // v162: Sort by order field (tickets without order go to end, then by ID)
          const aOrder = a.order ?? Infinity;
          const bOrder = b.order ?? Infinity;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.id.localeCompare(b.id);
        });
    }
  };

  const projects = tickets.filter((t) => t.type === 'Project');

  const clearLocalStorage = (key) => {
    if (confirm(`Clear ${key}? This will reload the page with default data for this item.`)) {
      localStorage.removeItem(key);
      window.location.reload();
    }
  };

  const clearAllLocalStorage = () => {
    if (confirm('Clear ALL localStorage? This will reset everything to defaults.')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  const factoryReset = () => {
    if (
      confirm(
        'FACTORY RESET: Clear all data AND start with empty system?\n\nThis will:\n- Remove all tickets, customers, boards\n- Keep only basic Work Centre structure\n- Perfect for testing "start from scratch" experience'
      )
    ) {
      // Set flag for empty start
      localStorage.setItem('arcanum_factory_reset', 'true');
      localStorage.clear();
      localStorage.setItem('arcanum_factory_reset', 'true');
      window.location.reload();
    }
  };

  // Export data as downloadable JSON file
  const exportData = () => {
    const snapshot = {
      _version: 'v077',
      _exportedAt: new Date().toISOString(),
      company: company,
      opCentres: opCentres,
      tickets: tickets,
      activeOpCentreId: activeOpCentreId,
    };

    const jsonString = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `numa-ops-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Import data from JSON file
  const importData = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);

          // Validate structure
          if (!data.company || !data.opCentres) {
            alert('Invalid data file. Missing company or opCentres.');
            return;
          }

          // Confirm import
          if (
            confirm(
              `Import data from ${file.name}?\n\nThis will replace all current data.\n\n• ${data.opCentres?.length || 0} Work Centres\n• ${data.tickets?.length || 0} Tickets\n• ${data.company?.globalCRM?.length || 0} Customers`
            )
          ) {
            setCompany(data.company);
            setOpCentres(data.opCentres);
            setTickets(data.tickets || []);
            if (data.activeOpCentreId && data.opCentres.find((oc) => oc.id === data.activeOpCentreId)) {
              setActiveOpCentreId(data.activeOpCentreId);
            }
            alert('Data imported successfully!');
          }
        } catch (err) {
          alert('Error parsing JSON file: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // Legacy export for copying to clipboard (keep for backwards compatibility)
  const exportDataSnapshot = () => {
    const snapshot = {
      company: company,
      opCentres: opCentres,
      tickets: tickets,
      activeOpCentreId: activeOpCentreId,
    };

    const jsonString = JSON.stringify(snapshot, null, 2);

    // Create a modal to display the JSON
    const modal = document.createElement('div');
    modal.style.cssText =
      'position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 20px;';

    const content = document.createElement('div');
    content.style.cssText =
      'background: white; border-radius: 8px; max-width: 800px; width: 100%; max-height: 90vh; display: flex; flex-direction: column;';

    const header = document.createElement('div');
    header.style.cssText = 'padding: 20px; border-bottom: 1px solid #e5e7eb;';
    header.innerHTML =
      '<h2 style="font-size: 20px; font-weight: 600; color: #111827;">Export Data Snapshot</h2><p style="font-size: 14px; color: #6b7280; margin-top: 4px;">Copy this JSON and paste it into Claude to update INITIAL_DATA</p>';

    const textarea = document.createElement('textarea');
    textarea.style.cssText =
      'flex: 1; padding: 20px; font-family: monospace; font-size: 12px; border: none; outline: none; resize: none;';
    textarea.value = jsonString;
    textarea.readOnly = true;

    const footer = document.createElement('div');
    footer.style.cssText =
      'padding: 20px; border-top: 1px solid #e5e7eb; display: flex; gap: 12px; justify-content: flex-end;';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy to Clipboard';
    copyBtn.style.cssText =
      'px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 padding: 8px 16px; border-radius: 6px; background: #4f46e5; color: white; font-weight: 500; cursor: pointer;';
    copyBtn.onclick = () => {
      textarea.select();
      document.execCommand('copy');
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy to Clipboard'), 2000);
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText =
      'padding: 8px 16px; border-radius: 6px; border: 1px solid #d1d5db; background: white; color: #374151; cursor: pointer;';
    closeBtn.onclick = () => document.body.removeChild(modal);

    footer.appendChild(copyBtn);
    footer.appendChild(closeBtn);
    content.appendChild(header);
    content.appendChild(textarea);
    content.appendChild(footer);
    modal.appendChild(content);
    document.body.appendChild(modal);

    // Auto-select text
    textarea.select();
  };

  // v167: Targeted JSON Extractor - extract specific subsets for debugging
  const openTargetedJsonExtractor = () => {
    // Create modal container
    const modal = document.createElement('div');
    modal.style.cssText =
      'position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 20px;';

    const content = document.createElement('div');
    content.style.cssText =
      'background: white; border-radius: 8px; max-width: 900px; width: 100%; max-height: 90vh; display: flex; flex-direction: column;';

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'padding: 20px; border-bottom: 1px solid #e5e7eb;';
    header.innerHTML =
      '<h2 style="font-size: 20px; font-weight: 600; color: #111827;">🎯 Targeted JSON Extractor</h2><p style="font-size: 14px; color: #6b7280; margin-top: 4px;">Extract specific data subsets for debugging (reduces chat context consumption)</p>';

    // Controls container
    const controls = document.createElement('div');
    controls.style.cssText =
      'padding: 20px; border-bottom: 1px solid #e5e7eb; display: flex; flex-direction: column; gap: 16px;';

    // Type selector row
    const typeRow = document.createElement('div');
    typeRow.style.cssText = 'display: flex; align-items: center; gap: 12px;';

    const typeLabel = document.createElement('label');
    typeLabel.textContent = 'Extract:';
    typeLabel.style.cssText = 'font-weight: 500; width: 80px;';

    const typeSelect = document.createElement('select');
    typeSelect.style.cssText =
      'flex: 1; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;';
    typeSelect.innerHTML = `
      <option value="ticket">Single Ticket (by ID)</option>
      <option value="board">Board + Tickets</option>
      <option value="workcentre">Work Centre + Boards + Tickets</option>
      <option value="filtered">Filtered Tickets (by status)</option>
    `;

    typeRow.appendChild(typeLabel);
    typeRow.appendChild(typeSelect);
    controls.appendChild(typeRow);

    // Selector row (changes based on type)
    const selectorRow = document.createElement('div');
    selectorRow.style.cssText = 'display: flex; align-items: center; gap: 12px;';

    const selectorLabel = document.createElement('label');
    selectorLabel.textContent = 'Target:';
    selectorLabel.style.cssText = 'font-weight: 500; width: 80px;';

    const selectorContainer = document.createElement('div');
    selectorContainer.style.cssText = 'flex: 1;';

    selectorRow.appendChild(selectorLabel);
    selectorRow.appendChild(selectorContainer);
    controls.appendChild(selectorRow);

    // Stats row
    const statsRow = document.createElement('div');
    statsRow.style.cssText = 'display: flex; align-items: center; gap: 12px; color: #6b7280; font-size: 13px;';
    statsRow.innerHTML = '<span>Select an extraction target to see preview stats</span>';
    controls.appendChild(statsRow);

    // Build selector options
    const allBoards = [];
    opCentres.forEach((oc) => {
      oc.processBoards?.forEach((board) => {
        allBoards.push({ id: board.id, name: board.name, wcId: oc.id, wcName: oc.name });
      });
    });

    // Get unique statuses from tickets
    const allStatuses = [...new Set(tickets.map((t) => t.status).filter(Boolean))].sort();

    // Function to update selector based on type
    const updateSelector = () => {
      const type = typeSelect.value;
      selectorContainer.innerHTML = '';

      if (type === 'ticket') {
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Enter ticket ID (e.g., TASK-067 or task-067)';
        input.style.cssText =
          'width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;';
        input.id = 'extractor-input';
        input.oninput = updateStats;
        selectorContainer.appendChild(input);
      } else if (type === 'board') {
        const select = document.createElement('select');
        select.style.cssText =
          'width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;';
        select.id = 'extractor-input';
        select.innerHTML =
          '<option value="">-- Select a board --</option>' +
          allBoards.map((b) => `<option value="${b.id}">${b.wcName} → ${b.name}</option>`).join('');
        select.onchange = updateStats;
        selectorContainer.appendChild(select);
      } else if (type === 'workcentre') {
        const select = document.createElement('select');
        select.style.cssText =
          'width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;';
        select.id = 'extractor-input';
        select.innerHTML =
          '<option value="">-- Select a Work Centre --</option>' +
          opCentres
            .map((oc) => `<option value="${oc.id}">${oc.name} (${oc.processBoards?.length || 0} boards)</option>`)
            .join('');
        select.onchange = updateStats;
        selectorContainer.appendChild(select);
      } else if (type === 'filtered') {
        const select = document.createElement('select');
        select.style.cssText =
          'width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;';
        select.id = 'extractor-input';
        select.innerHTML =
          '<option value="">-- Select a status --</option>' +
          allStatuses.map((s) => `<option value="${s}">${s}</option>`).join('');
        select.onchange = updateStats;
        selectorContainer.appendChild(select);
      }

      updateStats();
    };

    // Function to update stats
    const updateStats = () => {
      const type = typeSelect.value;
      const input = document.getElementById('extractor-input');
      const value = input?.value?.trim() || '';

      if (!value) {
        statsRow.innerHTML = '<span>Select an extraction target to see preview stats</span>';
        return;
      }

      let count = 0;
      let details = '';

      if (type === 'ticket') {
        const normalizedId = value.toUpperCase();
        const ticket = tickets.find(
          (t) => t.id?.toUpperCase() === normalizedId || t.ticketNumber?.toUpperCase() === normalizedId
        );
        if (ticket) {
          count = 1;
          details = `Found: ${ticket.id} - ${ticket.title?.slice(0, 40) || 'No title'}...`;
        } else {
          details = '⚠️ Ticket not found';
        }
      } else if (type === 'board') {
        const boardInfo = allBoards.find((b) => b.id === value);
        const boardTickets = tickets.filter((t) => t.boardId === value);
        count = boardTickets.length;
        details = `${boardInfo?.name}: ${count} ticket(s)`;
      } else if (type === 'workcentre') {
        const wc = opCentres.find((oc) => oc.id === value);
        const wcTickets = tickets.filter((t) => t.opCentreId === value);
        count = wcTickets.length;
        details = `${wc?.name}: ${wc?.processBoards?.length || 0} board(s), ${count} ticket(s)`;
      } else if (type === 'filtered') {
        const filtered = tickets.filter((t) => t.status === value);
        count = filtered.length;
        details = `Status "${value}": ${count} ticket(s)`;
      }

      statsRow.innerHTML = `<span style="color: ${count > 0 ? '#059669' : '#dc2626'};">📊 ${details}</span>`;
    };

    // Function to extract data
    const extractData = () => {
      const type = typeSelect.value;
      const input = document.getElementById('extractor-input');
      const value = input?.value?.trim() || '';

      if (!value) {
        alert('Please select a target to extract');
        return null;
      }

      let result = { _extractedAt: new Date().toISOString(), _extractType: type };

      if (type === 'ticket') {
        const normalizedId = value.toUpperCase();
        const ticket = tickets.find(
          (t) => t.id?.toUpperCase() === normalizedId || t.ticketNumber?.toUpperCase() === normalizedId
        );
        if (!ticket) {
          alert('Ticket not found: ' + value);
          return null;
        }
        // Include context: board stages, ticket type def
        const board = opCentres
          .find((oc) => oc.id === ticket.opCentreId)
          ?.processBoards?.find((b) => b.id === ticket.boardId);
        const zone = board?.workZones?.find((z) => z.id === ticket.sectionId);
        result.ticket = ticket;
        result._context = {
          boardName: board?.name,
          zoneName: zone?.name,
          stages: zone?.workStages?.map((s) => (typeof s === 'string' ? s : s.name)) || [],
        };
      } else if (type === 'board') {
        const wc = opCentres.find((oc) => oc.processBoards?.some((b) => b.id === value));
        const board = wc?.processBoards?.find((b) => b.id === value);
        if (!board) {
          alert('Board not found');
          return null;
        }
        const boardTickets = tickets.filter((t) => t.boardId === value);
        result.workCentre = { id: wc.id, name: wc.name };
        result.board = board;
        result.tickets = boardTickets;
      } else if (type === 'workcentre') {
        const wc = opCentres.find((oc) => oc.id === value);
        if (!wc) {
          alert('Work Centre not found');
          return null;
        }
        const wcTickets = tickets.filter((t) => t.opCentreId === value);
        result.workCentre = wc;
        result.tickets = wcTickets;
      } else if (type === 'filtered') {
        const filtered = tickets.filter((t) => t.status === value);
        result.filterCriteria = { status: value };
        result.tickets = filtered;
        result._summary = `${filtered.length} tickets with status "${value}"`;
      }

      return result;
    };

    typeSelect.onchange = updateSelector;

    // Textarea for result
    const textarea = document.createElement('textarea');
    textarea.style.cssText =
      'flex: 1; padding: 20px; font-family: monospace; font-size: 12px; border: none; outline: none; resize: none; min-height: 200px;';
    textarea.placeholder = 'Click "Extract" to generate JSON...';
    textarea.readOnly = true;

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText =
      'padding: 20px; border-top: 1px solid #e5e7eb; display: flex; gap: 12px; justify-content: flex-end;';

    const extractBtn = document.createElement('button');
    extractBtn.textContent = '🎯 Extract';
    extractBtn.style.cssText =
      'padding: 8px 16px; border-radius: 6px; background: #059669; color: white; font-weight: 500; cursor: pointer; border: none;';
    extractBtn.onclick = () => {
      const data = extractData();
      if (data) {
        textarea.value = JSON.stringify(data, null, 2);
        textarea.select();
      }
    };

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copy to Clipboard';
    copyBtn.style.cssText =
      'padding: 8px 16px; border-radius: 6px; background: #4f46e5; color: white; font-weight: 500; cursor: pointer; border: none;';
    copyBtn.onclick = () => {
      if (!textarea.value) {
        alert('Nothing to copy. Click Extract first.');
        return;
      }
      textarea.select();
      document.execCommand('copy');
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => (copyBtn.textContent = '📋 Copy to Clipboard'), 2000);
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText =
      'padding: 8px 16px; border-radius: 6px; border: 1px solid #d1d5db; background: white; color: #374151; cursor: pointer;';
    closeBtn.onclick = () => document.body.removeChild(modal);

    footer.appendChild(extractBtn);
    footer.appendChild(copyBtn);
    footer.appendChild(closeBtn);

    content.appendChild(header);
    content.appendChild(controls);
    content.appendChild(textarea);
    content.appendChild(footer);
    modal.appendChild(content);
    document.body.appendChild(modal);

    // Initialize selector
    updateSelector();
  };

  const fixTicketHierarchy = () => {
    if (
      confirm(
        'Fix Ticket Hierarchy IDs?\n\nThis will scan all tickets and add missing opCentreId, boardId, and zoneId fields.\n\nThis is safe to run and will help ensure tickets appear correctly when filtering.'
      )
    ) {
      console.log('🔧 Manually fixing ticket hierarchy IDs...');

      let fixCount = 0;
      const fixedTickets = tickets.map((ticket) => {
        if (!ticket.opCentreId || !ticket.boardId || !ticket.zoneId) {
          fixCount++;

          // Try to infer hierarchy from sectionId
          let inferredOpCentreId = activeOpCentreId;
          let inferredBoardId = activeBoard;
          let inferredZoneId = ticket.sectionId || 'section-active-sprints';

          // Search through all Work Centres to find the board/zone this ticket belongs to
          for (const oc of opCentres) {
            for (const board of oc.processBoards) {
              for (const zone of board.workZones) {
                if (zone.id === ticket.sectionId) {
                  inferredOpCentreId = oc.id;
                  inferredBoardId = board.id;
                  inferredZoneId = zone.id;
                  break;
                }
              }
            }
          }

          console.log(
            `  ✓ Fixed ${ticket.id}: opCentre=${inferredOpCentreId}, board=${inferredBoardId}, zone=${inferredZoneId}`
          );

          return {
            ...ticket,
            opCentreId: ticket.opCentreId || inferredOpCentreId,
            boardId: ticket.boardId || inferredBoardId,
            zoneId: ticket.zoneId || inferredZoneId,
            sectionId: ticket.sectionId || inferredZoneId,
          };
        }
        return ticket;
      });

      if (fixCount > 0) {
        setTickets(fixedTickets);
        // Clear migration flag so it doesn't run again
        localStorage.removeItem('arcanum_migration_hierarchy_ids_v1');
        alert(`✅ Fixed ${fixCount} ticket(s)!\n\nTickets should now display correctly when filtering by customer.`);
      } else {
        alert('✅ All tickets already have hierarchy IDs!\n\nNo fixes needed.');
      }
    }
  };

  return (
    <div
      className="min-h-screen bg-gray-100"
      onClick={() => {
        // v163: Clear highlights when user clicks anywhere
        if (highlightedTicketId) {
          setHighlightedTicketId(null);
        }
        if (highlightedCustomerId) {
          setHighlightedCustomerId(null);
        }
        // v184: Clear supplier highlight
        if (highlightedSupplierId) {
          setHighlightedSupplierId(null);
        }
      }}
    >
      {/* Conditional Rendering: All Tickets View vs Admin Panel vs Work Centre View */}
      {showAllTicketsView ? (
        <>
          <AllTicketsView
            tickets={tickets}
            company={company}
            opCentres={opCentres}
            activeOpCentreId={currentView === 'admin' ? null : activeOpCentreId} /* v125 BUG-124-001 FIX */
            activeBoardId={currentView === 'admin' ? null : activeBoard} /* v114 BUG-112-001 FIX */
            currentUser={currentUser} /* v136: For "Assigned to Me" filter */
            viewConfig={getCurrentProcessBoard()?.allTicketsViewConfig}
            onViewConfigChange={handleAllTicketsViewConfigChange}
            boardSavedViews={
              getCurrentProcessBoard()?.savedViews || getCurrentProcessBoard()?.savedFilterSets
            } /* v149: Board-level saved views (with backward compat) */
            globalSavedViews={
              company?.globalSavedViews || company?.globalSavedFilterSets
            } /* v149: Global saved views (with backward compat) */
            onSavedViewsChange={handleSavedViewsChange}
            lastOpenedTicketId={lastOpenedTicketId}
            selectedTickets={allTicketsSelectedIds}
            onSelectedTicketsChange={setAllTicketsSelectedIds}
            onContextMenu={handleShowContextMenu} /* v160: Right-click context menu */
            onClose={() => {
              setShowAllTicketsView(false);
              setLastOpenedTicketId(null); // Clear highlight when closing view
              // v104: Don't clear selection - preserve for when user returns
            }}
            onEditTicket={(ticket) => {
              // v105 BUG-104-001 FIX: Don't close All Tickets View
              // The ticket modal will render on top, and closing it returns here
              setLastOpenedTicketId(ticket.id); // v101: Track which ticket we're editing
              handleEditTicket(ticket);
            }}
            onDeleteTicket={handleDeleteTicket}
            onBulkUpdateTickets={handleBulkUpdateTickets}
            onBulkDeleteTickets={handleBulkDeleteTickets}
          />
          {/* v108 BUG-104-001 FINAL: Render TicketModal inside AllTicketsView branch for proper stacking */}
          {showTicketModal && (
            <TicketModal
              formData={ticketFormData}
              setFormData={setTicketFormData}
              editingTicket={editingTicket}
              activeBoard={activeBoard}
              getFieldForBoard={getFieldForBoard}
              onSubmit={handleSubmitTicket}
              onCancel={() => {
                setShowTicketModal(false);
                setEditingTicket(null);
                // v105: All Tickets View stays open, no need to re-open it
              }}
              onStatusChange={(newStatusId) => {
                // Phase 4: Handle status change with auto-move logic
                const board = getCurrentProcessBoard();
                const currentZoneId = ticketFormData.sectionId || editingTicket?.sectionId;
                const currentStageName = ticketFormData.column || editingTicket?.column;

                const moveAction = getStatusChangeMoveAction(board, currentZoneId, currentStageName, newStatusId);

                if (moveAction.action === 'stay') {
                  // Just update status, stay in current location
                  setTicketFormData({ ...ticketFormData, status: newStatusId });
                } else if (moveAction.action === 'move') {
                  // Auto-move to the single matching stage
                  setTicketFormData({
                    ...ticketFormData,
                    status: newStatusId,
                    sectionId: moveAction.target.zoneId,
                    column: moveAction.target.stageName,
                  });
                } else if (moveAction.action === 'clear') {
                  // No matching stage - clear location (ticket disappears from board)
                  setTicketFormData({
                    ...ticketFormData,
                    status: newStatusId,
                    sectionId: null,
                    zoneId: null,
                    column: null,
                  });
                } else if (moveAction.action === 'prompt') {
                  // Multiple matches - show picker modal
                  setStagePickerConfig({
                    newStatusId: newStatusId,
                    matches: moveAction.matches,
                    ticketId: editingTicket?.id,
                  });
                  setShowStagePickerModal(true);
                }
              }}
              onOpenLinkedTicket={handleOpenLinkedTicket}
              onLinkAdded={handleLinkAdded}
              onLinkRemoved={handleLinkRemoved}
            />
          )}
        </>
      ) : currentView === 'admin' ? (
        <>
          {/* Admin Panel View */}
          <AdminPanel
            company={company}
            opCentres={opCentres}
            currentUser={currentUser}
            setCurrentUser={setCurrentUser}
            clearLocalStorage={clearLocalStorage}
            clearAllLocalStorage={clearAllLocalStorage}
            factoryReset={factoryReset}
            exportData={exportData}
            importData={importData}
            exportDataSnapshot={exportDataSnapshot}
            openTargetedJsonExtractor={openTargetedJsonExtractor}
            fixTicketHierarchy={fixTicketHierarchy}
            tickets={tickets}
            onEnterOpCentre={(opCentreId) => {
              setActiveOpCentreId(opCentreId);
              setCurrentView('opcentre');
            }}
            onOpenGlobalSettings={() => setShowGlobalSettings(true)}
            onOpenGlobalSettingsTab={(tab) => {
              setGlobalSettingsTab(tab);
              setShowGlobalSettings(true);
            }}
            onOpenOpCentreSettings={(opCentre) => {
              setEditingOpCentre(opCentre);
              setShowOpCentreSettings(true);
            }}
            onOpenBoardSettings={(opCentre) => {
              setEditingOpCentre(opCentre);
              setShowBoardSelectionModal(true);
            }}
            onCreateOpCentre={() => setShowCreateOpCentre(true)}
            onOpenAllTickets={() => setShowAllTicketsView(true)}
          />
        </>
      ) : (
        <>
          {/* Work Centre View */}
          {/* v074: Redesigned header - compact layout (BUG-074-006) */}
          <div className="bg-white border-b border-gray-200 shadow-sm">
            <div className="px-6 py-3">
              {/* Single row header: Title • Stats | Search | Work Centre Switcher */}
              <div className="flex items-center gap-4 mb-3">
                {/* Title and Stats */}
                <div className="flex items-center gap-3 min-w-0">
                  <h1 className="text-2xl font-bold text-gray-900 truncate">
                    {getActiveOpCentre()?.name || 'Work Management'}
                  </h1>
                  <span className="text-sm text-gray-500 whitespace-nowrap">
                    {getActiveOpCentre()?.processBoards.length || 0} Boards •{' '}
                    {tickets.filter((t) => t.opCentreId === activeOpCentreId).length} Tickets
                  </span>
                </div>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Search */}
                <div className="relative w-48">
                  <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search board..."
                    className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>

                {/* Work Centre Switcher - compact */}
                <div className="relative">
                  <select
                    value={activeOpCentreId}
                    onChange={(e) => setActiveOpCentreId(e.target.value)}
                    className="appearance-none px-3 py-1.5 pr-8 text-sm font-medium border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-indigo-50 cursor-pointer text-indigo-900"
                  >
                    {getAccessibleOpCentres().map((oc) => (
                      <option key={oc.id} value={oc.id}>
                        {oc.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-indigo-600 pointer-events-none"
                  />
                </div>
              </div>

              {/* Work Board Tabs */}
              <div className="flex gap-3">
                {getAccessibleBoards(getActiveOpCentre()).map((board) => {
                  const colors = BOARD_COLORS[board.color] || BOARD_COLORS.blue;
                  const isActive = board.id === activeBoard;

                  return (
                    <div
                      key={board.id}
                      onClick={() => {
                        setActiveBoard(board.id);
                        // Select default zone when clicking board tab
                        const defaultZone = board.defaultZone || board.workZones?.[0]?.id;
                        if (defaultZone) {
                          setActiveSection(defaultZone);
                        }
                      }}
                      className={`border-2 rounded-lg px-4 py-3 transition cursor-pointer ${
                        isActive ? `${colors.border} ${colors.bg}` : 'border-gray-300 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <h2 className={`font-semibold text-base mb-2 ${isActive ? colors.text : 'text-gray-700'}`}>
                        {board.name}
                      </h2>
                      {/* Work Zone tabs within this Work Board */}
                      {/* v155: Hide zone tabs for simple boards (no work units) */}
                      {(() => {
                        const isSimpleBoard = isSimpleBoardCheck(board);
                        const zones = board.workZones || [];

                        // Simple boards: hide zone tabs, auto-select the only zone
                        if (isSimpleBoard && zones.length <= 1) {
                          // Ensure the zone is selected when board becomes active (unless CRM/Supplier Mirror selected)
                          if (
                            isActive &&
                            zones[0] &&
                            activeSection !== zones[0].id &&
                            activeSection !== 'crm-mirror' &&
                            activeSection !== 'supplier-mirror'
                          ) {
                            // Use setTimeout to avoid state update during render
                            setTimeout(() => setActiveSection(zones[0].id), 0);
                          }

                          // v170: Still show CRM tab for simple boards with CRM Mirror enabled
                          // v184: Also show Supplier Mirror tab when enabled
                          if (board.crmMirror?.enabled || board.supplierMirror?.enabled) {
                            return (
                              <div className="flex gap-4">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveBoard(board.id);
                                    setActiveSection(zones[0]?.id);
                                  }}
                                  className={`text-sm pb-1 border-b-2 transition ${
                                    activeSection !== 'crm-mirror' && activeSection !== 'supplier-mirror' && isActive
                                      ? 'border-blue-600 text-blue-600 font-medium'
                                      : 'border-transparent text-gray-600 hover:text-gray-900'
                                  }`}
                                >
                                  Board
                                </button>
                                {board.crmMirror?.enabled && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveBoard(board.id);
                                      setActiveSection('crm-mirror');
                                    }}
                                    className={`text-sm pb-1 border-b-2 transition ${
                                      activeSection === 'crm-mirror' && isActive
                                        ? 'border-purple-600 text-purple-600 font-medium'
                                        : 'border-transparent text-gray-600 hover:text-gray-900'
                                    }`}
                                  >
                                    👥 CRM
                                  </button>
                                )}
                                {board.supplierMirror?.enabled && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveBoard(board.id);
                                      setActiveSection('supplier-mirror');
                                    }}
                                    className={`text-sm pb-1 border-b-2 transition ${
                                      activeSection === 'supplier-mirror' && isActive
                                        ? 'border-teal-600 text-teal-600 font-medium'
                                        : 'border-transparent text-gray-600 hover:text-gray-900'
                                    }`}
                                  >
                                    🏭 Suppliers
                                  </button>
                                )}
                              </div>
                            );
                          }

                          return null; // Don't render zone tabs
                        }

                        // Work unit boards or multiple zones: show zone tabs
                        return (
                          <div className="flex gap-4">
                            {zones.map((zone) => {
                              const isZoneActive = zone.id === activeSection && isActive;
                              return (
                                <button
                                  key={zone.id}
                                  onClick={(e) => {
                                    e.stopPropagation(); // Prevent board tab click
                                    setActiveBoard(board.id);
                                    setActiveSection(zone.id);
                                  }}
                                  className={`text-sm pb-1 border-b-2 transition ${
                                    isZoneActive
                                      ? 'border-blue-600 text-blue-600 font-medium'
                                      : 'border-transparent text-gray-600 hover:text-gray-900'
                                  }`}
                                >
                                  {zone.name}
                                </button>
                              );
                            })}
                            {/* v170: CRM Mirror tab when enabled */}
                            {board.crmMirror?.enabled && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveBoard(board.id);
                                  setActiveSection('crm-mirror');
                                }}
                                className={`text-sm pb-1 border-b-2 transition ${
                                  activeSection === 'crm-mirror' && isActive
                                    ? 'border-purple-600 text-purple-600 font-medium'
                                    : 'border-transparent text-gray-600 hover:text-gray-900'
                                }`}
                              >
                                👥 CRM
                              </button>
                            )}
                            {/* v184: Supplier Mirror tab when enabled */}
                            {board.supplierMirror?.enabled && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveBoard(board.id);
                                  setActiveSection('supplier-mirror');
                                }}
                                className={`text-sm pb-1 border-b-2 transition ${
                                  activeSection === 'supplier-mirror' && isActive
                                    ? 'border-teal-600 text-teal-600 font-medium'
                                    : 'border-transparent text-gray-600 hover:text-gray-900'
                                }`}
                              >
                                🏭 Suppliers
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>

              {/* Filter Badges */}
              {(filterProject || filterClient) && (
                <div className="mt-3 flex gap-3 flex-wrap">
                  {filterProject && (
                    <div className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded">
                      <span className="text-sm">Project: {tickets.find((t) => t.id === filterProject)?.name}</span>
                      <button onClick={() => setFilterProject(null)} className="text-gray-600 hover:text-gray-900">
                        ✕
                      </button>
                    </div>
                  )}
                  {filterClient && (
                    <div className="bg-blue-50 border border-blue-200 px-3 py-2 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-blue-900">Client: {getCurrentClientName()}</span>
                            <span className="text-xs text-blue-600">({getClientTicketCount(filterClient)} open)</span>
                          </div>
                          <div className="text-xs text-blue-600 mt-1">Showing tickets {getClientScopeLabel()}</div>
                        </div>
                        <select
                          value={filterClientScope}
                          onChange={(e) => setFilterClientScope(e.target.value)}
                          className="text-xs border border-blue-300 rounded px-2 py-1 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="all-opcentres">All Work Centres</option>
                          <option value="this-opcentre">
                            {opCentres.find((oc) => oc.id === activeOpCentreId)?.name || 'This Work Centre'}
                          </option>
                          <optgroup label="Specific Board">
                            {opCentres
                              .find((oc) => oc.id === activeOpCentreId)
                              ?.processBoards?.map((board) => (
                                <option key={board.id} value={`board-${board.id}`}>
                                  {board.name}
                                </option>
                              ))}
                          </optgroup>
                        </select>
                        <button
                          onClick={() => {
                            setFilterClient(null);
                            setFilterClientScope('all-opcentres');
                          }}
                          className="text-blue-700 hover:text-blue-900 font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Main Content - Show CustomerTicketsView when filtering by CRM client, otherwise show active section */}
          <div className="p-6">
            {filterClient ? (
              <CustomerTicketsView
                tickets={tickets}
                filterClient={filterClient}
                filterClientScope={filterClientScope}
                activeOpCentreId={activeOpCentreId}
                opCentres={opCentres}
                company={company}
                onEditTicket={handleEditTicket}
                onDeleteTicket={handleDeleteTicket}
                getInitialsColor={getInitialsColor}
              />
            ) : (
              <>
                {/* v170: CRM Mirror View */}
                {activeSection === 'crm-mirror' && (
                  <div>
                    <div className="mb-4 flex gap-2 items-center">
                      <span className="text-lg font-medium text-gray-700">👥 Global CRM</span>
                      <span className="text-sm text-gray-500">({(company.globalCRM || []).length} customers)</span>
                    </div>
                    <CrmMirror
                      customers={company.globalCRM || []}
                      totalCustomerCount={(company.globalCRM || []).length}
                      crmMirror={getCurrentProcessBoard()?.crmMirror}
                      crmConfig={company.crmConfig}
                      globalStaff={company.globalStaff}
                      tickets={tickets}
                      onCustomerClick={(customer) => openCustomerDetailModal(customer.id)}
                      onCreateCustomer={handleCreateCustomer}
                      onCustomerDrag={(customerId, field, newValue) => {
                        // v170: Update customer field when dragged to new column
                        setCompany((prev) => ({
                          ...prev,
                          globalCRM: prev.globalCRM.map((c) =>
                            c.id === customerId ? { ...c, [field]: newValue, updatedAt: new Date().toISOString() } : c
                          ),
                        }));
                        setHighlightedCustomerId(customerId);
                      }}
                      highlightedCustomerId={highlightedCustomerId}
                      dropTarget={dropTarget}
                      onCustomerDragOver={handleCustomerDragOver}
                    />
                  </div>
                )}

                {/* v184: Supplier Mirror View */}
                {activeSection === 'supplier-mirror' && (
                  <div>
                    <div className="mb-4 flex gap-2 items-center">
                      <span className="text-lg font-medium text-gray-700">🏭 Global Suppliers</span>
                      <span className="text-sm text-gray-500">
                        ({(company.globalSuppliers || []).length} suppliers)
                      </span>
                    </div>
                    <SupplierMirror
                      suppliers={company.globalSuppliers || []}
                      totalSupplierCount={(company.globalSuppliers || []).length}
                      supplierMirror={getCurrentProcessBoard()?.supplierMirror}
                      supplierConfig={company.supplierConfig}
                      globalStaff={company.globalStaff}
                      tickets={tickets}
                      onSupplierClick={(supplier) => openSupplierDetailModal(supplier)}
                      onCreateSupplier={handleCreateSupplier}
                      onSupplierDrag={(supplierId, field, newValue) => {
                        // v184: Update supplier field when dragged to new column
                        setCompany((prev) => ({
                          ...prev,
                          globalSuppliers: (prev.globalSuppliers || []).map((s) =>
                            s.id === supplierId ? { ...s, [field]: newValue, updatedAt: new Date().toISOString() } : s
                          ),
                        }));
                        setHighlightedSupplierId(supplierId);
                      }}
                      highlightedSupplierId={highlightedSupplierId}
                      dropTarget={supplierDropTarget}
                      onSupplierDragOver={handleSupplierDragOver}
                    />
                  </div>
                )}

                {/* Regular zone content */}
                {activeSection !== 'crm-mirror' &&
                  activeSection !== 'supplier-mirror' &&
                  (() => {
                    const section = getCurrentSection();
                    if (!section) return null;

                    return (
                      <>
                        {/* Action Buttons - v069: Added Create Work Unit button */}
                        <div className="mb-4 flex gap-2">
                          <button
                            onClick={handleCreateTicket}
                            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition text-sm font-medium"
                          >
                            <Plus size={18} />
                            {section.type === 'crm' ? 'Add Customer' : 'Create Issue'}
                          </button>

                          {/* v070 Phase 6.1/6.2: Work Unit buttons - only show on backlog zone when Work Units enabled */}
                          {(() => {
                            const board = getCurrentProcessBoard();
                            const series = board?.workUnitSeries;
                            const isBacklogZone = series?.enabled && series?.backlogZoneId === section.id;

                            if (!isBacklogZone) return null;

                            const planningUnits = getPlanningWorkUnits(board.id);

                            return (
                              <>
                                {/* Create Next Planning Work Unit button */}
                                <button
                                  onClick={() => handleCreateWorkUnit(board.id, series)}
                                  className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 transition text-sm font-medium"
                                  title={`Create the next ${series.label || 'Work Unit'} as a planning stage`}
                                >
                                  <Plus size={18} />
                                  Create Next Planning {series.label || 'Work Unit'}
                                </button>

                                {/* v079: Work Unit action buttons based on state */}
                                {(() => {
                                  const activeWorkUnit = getActiveWorkUnit(board.id);
                                  const label = series.label || 'Work Unit';

                                  // Case 1: No active work unit - show Start button if planning units exist
                                  if (!activeWorkUnit || series.allowOverlap) {
                                    if (planningUnits.length > 0 && (series.allowOverlap || !activeWorkUnit)) {
                                      return (
                                        <button
                                          onClick={() => handleOpenStartWorkUnitModal(board.id, series)}
                                          className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition text-sm font-medium ml-4"
                                          title={`Start a ${label}`}
                                        >
                                          <Play size={18} />
                                          Start {label}
                                        </button>
                                      );
                                    }
                                    return null;
                                  }

                                  // Case 2: Active work unit exists - show navigation + end buttons
                                  const activeZoneInfo = findActiveWorkUnitZone(activeWorkUnit.id);

                                  return (
                                    <>
                                      {/* Orange navigation button */}
                                      <button
                                        onClick={() => {
                                          if (activeZoneInfo) {
                                            setActiveBoard(activeZoneInfo.board.id);
                                            setActiveSection(activeZoneInfo.zone.id);
                                          }
                                        }}
                                        className="flex items-center gap-2 bg-amber-500 text-white px-4 py-2 rounded hover:bg-amber-600 transition text-sm font-medium ml-4"
                                        title={`Go to ${activeWorkUnit.name}`}
                                      >
                                        <ArrowRight size={18} />
                                        {label} already Active - Go to {activeWorkUnit.name}
                                      </button>

                                      {/* Red end button */}
                                      {activeZoneInfo && (
                                        <button
                                          onClick={() => handleOpenCompleteWorkUnitModal(activeZoneInfo.zone.id)}
                                          className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition text-sm font-medium ml-2"
                                          title={`End ${activeWorkUnit.name}`}
                                        >
                                          <Square size={18} />
                                          End {activeWorkUnit.name}
                                        </button>
                                      )}
                                    </>
                                  );
                                })()}
                              </>
                            );
                          })()}

                          {/* v115 BUG-095-002: Removed Complete Sprint button from active zones
                        Work Unit completion should ONLY be triggered via "End Sprint X" button on the backlog board */}

                          {/* v098 Phase 6.5a: All Tickets button - always visible */}
                          <button
                            onClick={() => setShowAllTicketsView(true)}
                            className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition text-sm font-medium ml-auto"
                            title="View all tickets"
                          >
                            <Search size={18} />
                            All Tickets
                          </button>
                        </div>

                        {/* Section Columns */}
                        {section.type === 'backlog' ? (
                          <div className="space-y-4 max-w-6xl">
                            {section.workStages.map((stage, stageIdx) => {
                              const column = getStageName(stage);
                              const items = getFilteredItems(section.id, column);
                              return (
                                <BacklogColumn
                                  key={column || stageIdx}
                                  column={column}
                                  items={items}
                                  sectionId={section.id}
                                  onDragStart={handleDragStart}
                                  onDragOver={handleDragOver}
                                  onDrop={handleDrop}
                                  onEdit={handleEditTicket}
                                  onDelete={handleDeleteTicket}
                                  getInitialsColor={getInitialsColor}
                                  onContextMenu={handleShowContextMenu}
                                  dropTarget={dropTarget}
                                  onTicketDragOver={handleTicketDragOver}
                                  highlightedTicketId={highlightedTicketId}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex gap-4 overflow-x-auto pb-4 items-stretch">
                            {section.workStages.map((stage, stageIdx) => {
                              const column = getStageName(stage);
                              const items = getFilteredItems(section.id, column);
                              return section.type === 'crm' ? (
                                <CRMColumn
                                  key={column || stageIdx}
                                  column={column}
                                  items={items}
                                  sectionId={section.id}
                                  onDragStart={handleDragStart}
                                  onDragOver={handleDragOver}
                                  onDrop={handleDrop}
                                  onEdit={(customer) => openCustomerDetailModal(customer.id)}
                                  onDelete={handleDeleteCustomer}
                                  dropTarget={dropTarget}
                                  onCustomerDragOver={handleCustomerDragOver}
                                  highlightedCustomerId={highlightedCustomerId}
                                />
                              ) : (
                                <KanbanColumn
                                  key={column || stageIdx}
                                  column={column}
                                  items={items}
                                  sectionId={section.id}
                                  onDragStart={handleDragStart}
                                  onDragOver={handleDragOver}
                                  onDrop={handleDrop}
                                  onEdit={handleEditTicket}
                                  onDelete={handleDeleteTicket}
                                  getInitialsColor={getInitialsColor}
                                  onContextMenu={handleShowContextMenu}
                                  dropTarget={dropTarget}
                                  onTicketDragOver={handleTicketDragOver}
                                  highlightedTicketId={highlightedTicketId}
                                />
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  })()}
              </>
            )}
          </div>

          {/* Modals */}
          {/* v108: TicketModal now renders inside AllTicketsView branch when that view is active */}
          {/* v175: Wrapped in div for modal stacking z-index when opened from CustomerDetailModal */}
          {showTicketModal && !showAllTicketsView && (
            <div className={ticketOpenedFromCustomer ? 'relative z-[10000]' : ''}>
              <TicketModal
                formData={ticketFormData}
                setFormData={setTicketFormData}
                editingTicket={editingTicket}
                activeBoard={activeBoard}
                getFieldForBoard={getFieldForBoard}
                onSubmit={handleSubmitTicket}
                onCancel={() => {
                  setShowTicketModal(false);
                  setEditingTicket(null);
                  // v175: Reset modal stacking flag
                  setTicketOpenedFromCustomer(false);
                  // v105: All Tickets View stays open, no need to re-open it
                }}
                onStatusChange={(newStatusId) => {
                  // Phase 4: Handle status change with auto-move logic
                  const board = getCurrentProcessBoard();
                  const currentZoneId = ticketFormData.sectionId || editingTicket?.sectionId;
                  const currentStageName = ticketFormData.column || editingTicket?.column;

                  const moveAction = getStatusChangeMoveAction(board, currentZoneId, currentStageName, newStatusId);

                  if (moveAction.action === 'stay') {
                    // Just update status, stay in current location
                    setTicketFormData({ ...ticketFormData, status: newStatusId });
                  } else if (moveAction.action === 'move') {
                    // Auto-move to the single matching stage
                    setTicketFormData({
                      ...ticketFormData,
                      status: newStatusId,
                      sectionId: moveAction.target.zoneId,
                      column: moveAction.target.stageName,
                    });
                  } else if (moveAction.action === 'clear') {
                    // No matching stage - clear location (ticket disappears from board)
                    setTicketFormData({
                      ...ticketFormData,
                      status: newStatusId,
                      sectionId: null,
                      zoneId: null,
                      column: null,
                    });
                  } else if (moveAction.action === 'prompt') {
                    // Multiple matches - show picker modal
                    setStagePickerConfig({
                      newStatusId: newStatusId,
                      matches: moveAction.matches,
                      ticketId: editingTicket?.id,
                    });
                    setShowStagePickerModal(true);
                  }
                }}
                onOpenLinkedTicket={handleOpenLinkedTicket}
                onLinkAdded={handleLinkAdded}
                onLinkRemoved={handleLinkRemoved}
              />
            </div>
          )}

          {showTicketSuccessModal && createdTicketInfo && (
            <TicketSuccessModal
              ticketInfo={createdTicketInfo}
              currentBoardId={activeBoard}
              currentZoneId={activeSection}
              onClose={() => {
                setShowTicketSuccessModal(false);
                setCreatedTicketInfo(null);
              }}
              onGoToTicket={() => {
                // Switch to the board where ticket was created
                setActiveBoard(createdTicketInfo.board.id);
                setActiveSection(createdTicketInfo.zone.id);
                setShowTicketSuccessModal(false);
                setCreatedTicketInfo(null);
              }}
            />
          )}

          {/* Phase 4: Stage Picker Modal - shown when status change has multiple matching stages */}
          {showStagePickerModal && stagePickerConfig && (
            <StagePickerModal
              config={stagePickerConfig}
              onSelect={(match) => {
                // User selected a stage - update formData
                setTicketFormData({
                  ...ticketFormData,
                  status: stagePickerConfig.newStatusId,
                  sectionId: match.zoneId,
                  column: match.stageName,
                });
                setShowStagePickerModal(false);
                setStagePickerConfig(null);
              }}
              onCancel={() => {
                // User cancelled - don't change status
                setShowStagePickerModal(false);
                setStagePickerConfig(null);
              }}
            />
          )}

          {/* v070 Phase 6.2: Start Work Unit Modal */}
          {/* v157: Simplified - zone added to same board, no onCreateBoard needed */}
          {showStartWorkUnitModal && startWorkUnitConfig && (
            <StartWorkUnitModal
              config={startWorkUnitConfig}
              setConfig={setStartWorkUnitConfig}
              onStart={handleStartWorkUnit}
              onCancel={() => {
                setShowStartWorkUnitModal(false);
                setStartWorkUnitConfig(null);
              }}
            />
          )}

          {/* v070 Phase 6.2: Work Unit Success Modal */}
          {/* v149 FIX: Pass props directly instead of info wrapper */}
          {showWorkUnitSuccessModal && workUnitSuccessInfo && (
            <WorkUnitSuccessModal
              workUnit={workUnitSuccessInfo.workUnit}
              series={workUnitSuccessInfo.series}
              destinationBoard={workUnitSuccessInfo.destinationBoard}
              onViewOnBoard={() => {
                // Switch to destination board and zone
                setActiveBoard(workUnitSuccessInfo.destinationBoard.id);
                setActiveSection(workUnitSuccessInfo.newZoneId);
                setShowWorkUnitSuccessModal(false);
                setWorkUnitSuccessInfo(null);
              }}
              onClose={() => {
                setShowWorkUnitSuccessModal(false);
                setWorkUnitSuccessInfo(null);
              }}
            />
          )}

          {/* v077 Phase 6.4: Complete Work Unit Modal */}
          {showCompleteWorkUnitModal && completeWorkUnitConfig && (
            <CompleteWorkUnitModal
              config={completeWorkUnitConfig}
              onComplete={handleCompleteWorkUnit}
              onCancel={() => {
                setShowCompleteWorkUnitModal(false);
                setCompleteWorkUnitConfig(null);
              }}
            />
          )}

          {/* v188: Removed CustomerModal and SupplierModal renders
          All customer/supplier editing now uses Detail Modals with inline editing */}

          {/* v188: Detail Modals moved to global modals section (after GlobalSettingsModal)
          This fixes BUG-187-001 where modals didn't appear when created from Global Settings
          because they were inside the Work Centre view branch */}

          {/* v188: Removed duplicate GlobalSettingsModal that was here (BUG-187-002)
          Single GlobalSettingsModal render is in global modals section below */}

          {isAdmin && (
            <button
              onClick={() => setCurrentView('admin')}
              className="fixed bottom-6 left-6 px-4 py-2 bg-white border-2 border-gray-300 text-gray-700 rounded-lg shadow-lg hover:bg-gray-50 hover:border-gray-400 transition flex items-center gap-2"
            >
              ← Back to Admin Panel
            </button>
          )}
        </>
      )}

      {/* Global Settings Modal (works in both views) */}
      {showGlobalSettings && (
        <GlobalSettingsModal
          company={company}
          setCompany={setCompany}
          tickets={tickets}
          activeTab={globalSettingsTab}
          setActiveTab={setGlobalSettingsTab}
          onClose={() => setShowGlobalSettings(false)}
          TicketTypeModal={TicketTypeModal}
          CategoryModal={CategoryModal}
          CustomFieldModal={CustomFieldModal}
          onDeleteSupplier={handleDeleteSupplier}
          onOpenSupplierDetail={openSupplierDetailModal}
          onOpenCustomerDetail={openCustomerDetailModal}
          onCreateCustomer={handleCreateCustomer}
          onCreateSupplier={handleCreateSupplier}
        />
      )}

      {/* v188: Detail Modals moved here from Work Centre view branch
          Now render in global section so they work from both Admin and Work Centre views
          Render AFTER GlobalSettingsModal so they stack on top (BUG-187-003) */}

      {/* Customer Detail Modal */}
      {customerDetailModal.isOpen && (
        <CustomerDetailModal
          customer={getCustomerById(customerDetailModal.customerId)}
          isOpen={customerDetailModal.isOpen}
          onClose={closeCustomerDetailModal}
          onUpdateCustomer={(customerId, updates) => {
            setCompany((prev) => ({
              ...prev,
              globalCRM: prev.globalCRM.map((c) =>
                c.id === customerId ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c
              ),
            }));
          }}
          onTicketClick={(ticket) => {
            // Open TicketModal from Linked Work - modal stacking
            setTicketOpenedFromCustomer(true);
            handleEditTicket(ticket);
          }}
          tickets={tickets}
          opCentres={opCentres}
          globalStaff={company.globalStaff}
          crmConfig={company.crmConfig}
        />
      )}

      {/* Supplier Detail Modal */}
      {supplierDetailModal.isOpen && window.Components.SupplierDetailModal && (
        <window.Components.SupplierDetailModal
          supplier={getSupplierById(supplierDetailModal.supplierId)}
          isOpen={supplierDetailModal.isOpen}
          onClose={closeSupplierDetailModal}
          onUpdateSupplier={handleUpdateSupplier}
          tickets={tickets}
          opCentres={opCentres}
          globalStaff={company.globalStaff}
          supplierConfig={company.supplierConfig}
        />
      )}

      {/* Create Work Centre Modal */}
      {showCreateOpCentre && (
        <CreateOpCentreModal
          company={company}
          onSave={handleCreateOpCentre}
          onClose={() => setShowCreateOpCentre(false)}
        />
      )}

      {/* Work Centre Settings Modal */}
      {showOpCentreSettings && editingOpCentre && (
        <OpCentreSettingsModal
          opCentre={editingOpCentre}
          company={company}
          onSave={handleSaveOpCentre}
          onDelete={() => {
            // Delete Work Centre
            setOpCentres(opCentres.filter((oc) => oc.id !== editingOpCentre.id));
            setShowOpCentreSettings(false);
            setEditingOpCentre(null);
            // If we were viewing this Work Centre, go back to admin panel
            if (activeOpCentreId === editingOpCentre.id) {
              setCurrentView('admin');
              setActiveOpCentreId(opCentres.find((oc) => oc.id !== editingOpCentre.id)?.id || '');
            }
          }}
          onConfigureBoard={(board) => {
            setEditingProcessBoard(board);
            setShowProcessBoardSettings(true);
          }}
          onClose={() => {
            setShowOpCentreSettings(false);
            setEditingOpCentre(null);
          }}
        />
      )}

      {/* Board Selection Modal */}
      {showBoardSelectionModal && editingOpCentre && (
        <BoardSelectionModal
          opCentre={editingOpCentre}
          onSelectBoard={(board) => {
            setEditingProcessBoard(board);
            setShowBoardSelectionModal(false);
            setShowProcessBoardSettings(true);
          }}
          onClose={() => {
            setShowBoardSelectionModal(false);
            setEditingOpCentre(null);
          }}
        />
      )}

      {/* Work Board Settings Modal */}
      {showProcessBoardSettings && editingProcessBoard && editingOpCentre && (
        <ProcessBoardSettingsModal
          board={editingProcessBoard}
          opCentre={editingOpCentre}
          company={{ ...company, getFullFieldLibrary }}
          tickets={tickets}
          onSave={(updatedBoard) => {
            const updatedOpCentre = {
              ...editingOpCentre,
              processBoards: editingOpCentre.processBoards.map((b) => (b.id === updatedBoard.id ? updatedBoard : b)),
            };
            // Save the Work Centre with updated board, keeping everything open
            handleSaveOpCentre(updatedOpCentre, true);
            // Update editingOpCentre and editingProcessBoard with saved data
            setEditingOpCentre(updatedOpCentre);
            setEditingProcessBoard(updatedBoard);
            // Stay in Work Board Settings modal (don't close anything)
          }}
          onClose={() => {
            setShowProcessBoardSettings(false);
            setEditingProcessBoard(null);
          }}
        />
      )}

      {/* Work Board Access Settings Modal */}
      {showBoardAccessSettings && editingBoardAccess && (
        <ProcessBoardAccessModal
          board={editingBoardAccess}
          opCentre={getActiveOpCentre()}
          company={company}
          onSave={handleSaveBoardAccess}
          onClose={() => {
            setShowBoardAccessSettings(false);
            setEditingBoardAccess(null);
          }}
        />
      )}

      {/* v159: Ticket Context Menu */}
      {contextMenu.visible && contextMenu.ticket && (
        <div
          ref={contextMenuRef}
          className="fixed bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-[9999] min-w-[200px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {/* Assign Section */}
          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 uppercase">Assign</div>
          <button
            onClick={() => {
              const staffName = company?.globalStaff?.find((s) => s.id === currentUser)?.name;
              if (staffName) handleContextMenuAssign(staffName);
            }}
            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
          >
            Assign to Me
          </button>
          {(() => {
            const ticket = contextMenu.ticket;
            const currentOpCentre = opCentres.find((oc) => oc.id === ticket.opCentreId);
            const boardUsers = currentOpCentre?.assignedStaff || company?.globalStaff || [];
            return (
              boardUsers.length > 0 && (
                <div className="relative group/assign">
                  <button className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center justify-between">
                    Assign to
                    <span className="text-gray-400">›</span>
                  </button>
                  <div className="absolute left-full top-0 -ml-2 pl-2 hidden group-hover/assign:block">
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px] max-h-[200px] overflow-y-auto">
                      {boardUsers.map((user) => (
                        <button
                          key={user.name}
                          onClick={() => handleContextMenuAssign(user.name)}
                          className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                        >
                          {user.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )
            );
          })()}

          <div className="border-t border-gray-200 my-1" />

          {/* Move Section */}
          <div className="relative group/move">
            <button className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center justify-between">
              Move
              <span className="text-gray-400">›</span>
            </button>
            <div className="absolute left-full top-0 -ml-2 pl-2 hidden group-hover/move:block">
              <div className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                {/* v160: Move within column only available on boards, greyed out in table context */}
                <button
                  onClick={() => handleContextMenuMove('top')}
                  disabled={contextMenu.context === 'table' || contextMenu.ticketIndex === 0}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  title={contextMenu.context === 'table' ? 'Reordering not available in table view' : undefined}
                >
                  To the top
                </button>
                <button
                  onClick={() => handleContextMenuMove('up')}
                  disabled={contextMenu.context === 'table' || contextMenu.ticketIndex === 0}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  title={contextMenu.context === 'table' ? 'Reordering not available in table view' : undefined}
                >
                  Up
                </button>
                <button
                  onClick={() => handleContextMenuMove('down')}
                  disabled={contextMenu.context === 'table' || contextMenu.ticketIndex >= contextMenu.totalTickets - 1}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  title={contextMenu.context === 'table' ? 'Reordering not available in table view' : undefined}
                >
                  Down
                </button>
                <button
                  onClick={() => handleContextMenuMove('bottom')}
                  disabled={contextMenu.context === 'table' || contextMenu.ticketIndex >= contextMenu.totalTickets - 1}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  title={contextMenu.context === 'table' ? 'Reordering not available in table view' : undefined}
                >
                  To the bottom
                </button>

                {/* Other zones in board */}
                {(() => {
                  const ticket = contextMenu.ticket;
                  const currentBoard = opCentres
                    .find((oc) => oc.id === ticket.opCentreId)
                    ?.processBoards?.find((b) => b.id === ticket.boardId);
                  const otherZones = currentBoard?.workZones?.filter((z) => z.id !== ticket.sectionId) || [];

                  return (
                    otherZones.length > 0 && (
                      <>
                        <div className="border-t border-gray-200 my-1" />
                        {otherZones.map((zone) => (
                          <button
                            key={zone.id}
                            onClick={() => handleContextMenuMoveToZone(zone.id)}
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                          >
                            {zone.name} → {getStageName(zone.workStages?.[0]) || 'First stage'}
                          </button>
                        ))}
                      </>
                    )
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Change Status Section */}
          <div className="relative group/status">
            <button className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center justify-between">
              Change status
              <span className="text-gray-400">›</span>
            </button>
            <div className="absolute left-full top-0 -ml-2 pl-2 hidden group-hover/status:block">
              <div className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px] max-h-[300px] overflow-y-auto">
                {(() => {
                  const ticket = contextMenu.ticket;
                  const currentBoard = opCentres
                    .find((oc) => oc.id === ticket.opCentreId)
                    ?.processBoards?.find((b) => b.id === ticket.boardId);
                  const currentZone = currentBoard?.workZones?.find((z) => z.id === ticket.sectionId);
                  const stages = currentZone?.workStages || [];

                  return stages.map((stage, idx) => {
                    const stageName = getStageName(stage);
                    const isCurrentStage = stageName === ticket.column;
                    return (
                      <button
                        key={idx}
                        onClick={() => handleContextMenuChangeStatus(stageName)}
                        disabled={isCurrentStage}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 ${
                          isCurrentStage ? 'text-gray-400 bg-gray-50 cursor-not-allowed' : 'text-gray-700'
                        }`}
                      >
                        {stageName} {isCurrentStage && '✓'}
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 my-1" />

          {/* Copy Link */}
          <button
            onClick={handleContextMenuCopyLink}
            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
          >
            Copy ticket link
          </button>

          <div className="border-t border-gray-200 my-1" />

          {/* Delete */}
          <button
            onClick={() => {
              handleCloseContextMenu();
              handleDeleteTicket(contextMenu.ticket.id);
            }}
            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmationModal.isOpen}
        onClose={closeConfirmation}
        onConfirm={confirmationModal.onConfirm}
        title={confirmationModal.title}
        message={confirmationModal.message}
        confirmText={confirmationModal.confirmText}
        cancelText={confirmationModal.cancelText}
        type={confirmationModal.type}
      />

      {/* v107: Version indicator - always visible in bottom-right corner */}
      <div className="fixed bottom-2 right-2 text-xs text-gray-400 bg-white/80 px-2 py-0.5 rounded shadow-sm pointer-events-none">
        {APP_VERSION}
      </div>
    </div>
  );
};

// Confirmation Modal Component
// ConfirmationModal imported from components/confirm-modals.jsx

// Component definitions

// Ticket modals imported from components/ticket-modals.jsx:
// - TicketModal
// - TicketSuccessModal

// Work Unit modals imported from components/workunit-modals.jsx:
// - StartWorkUnitModal
// - WorkUnitSuccessModal
// - CompleteWorkUnitModal

// Common emoji options for ticket types
const EMOJI_OPTIONS = [
  '✨',
  '🐛',
  '📋',
  '🎧',
  '👤',
  '🏢',
  '🤝',
  '📊',
  '💼',
  '🎯',
  '🚀',
  '⚡',
  '🔧',
  '🔬',
  '💡',
  '📈',
  '🎨',
  '⚙️',
  '🌟',
  '🔥',
];

const COLOR_OPTIONS = [
  { name: 'blue', hex: '#3b82f6', bg: '#dbeafe', text: '#1e40af' },
  { name: 'red', hex: '#ef4444', bg: '#fee2e2', text: '#991b1b' },
  { name: 'green', hex: '#10b981', bg: '#d1fae5', text: '#065f46' },
  { name: 'teal', hex: '#14b8a6', bg: '#ccfbf1', text: '#115e59' },
  { name: 'purple', hex: '#8b5cf6', bg: '#ede9fe', text: '#5b21b6' },
  { name: 'orange', hex: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
  { name: 'pink', hex: '#ec4899', bg: '#fce7f3', text: '#9f1239' },
  { name: 'gray', hex: '#6b7280', bg: '#f3f4f6', text: '#374151' },
];

// Expose to window for extracted components
window.EMOJI_OPTIONS = EMOJI_OPTIONS;
window.COLOR_OPTIONS = COLOR_OPTIONS;

// Custom Field Builder Modal

// Create Work Centre Modal - Multi-step wizard

// Board Selection Modal for Configuration

// Board Settings Modals imported from components/board-settings-modals.jsx:
// - ProcessBoardSettingsModal
// - WorkZoneModal
// - FieldOverrideModal

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<ArcanumWorkManagement />);

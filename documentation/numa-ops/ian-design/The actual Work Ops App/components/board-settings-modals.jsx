/**
 * Board Settings Modal Components
 * Numa Ops Management
 *
 * Component Version: v184b (aligned with v184 App release)
 *
 * v184b Changes:
 * - SUPPLIER MANAGEMENT: Added Supplier Mirror settings tab
 *   - New tab: "Supplier Mirror" with enable toggle (teal colour scheme)
 *   - Filter config: stages, territories, relationship owners multi-select
 *   - Display options: group by, sort by, sort order
 *   - State: supplierMirror { enabled, filter, groupBy, sortBy, sortOrder }
 *   - Added to hasChanges calculation
 *   - Added to performSave()
 *   - Added to footer save tabs condition
 *
 * v171a Changes:
 * - BUG FIX: Stage changes in Workflow Stages tab now trigger Save Changes button
 *   - Added workZones to hasChanges calculation
 *
 * v170a Changes:
 * - CRM PHASE 3: CRM Mirror settings tab
 *   - New tab: "CRM Mirror" with enable toggle
 *   - Filter config: stages, territories, account owners multi-select
 *   - Display options: group by, sort by, sort order
 *   - State: crmMirror { enabled, filter, groupBy, sortBy, sortOrder }
 *
 * Contains:
 * - ProcessBoardSettingsModal: Main board configuration modal with tabs
 * - WorkZoneModal: Create/edit work zones
 * - FieldOverrideModal: Customize fields per ticket type
 * - AmbiguousKeywordModal: Warning for ambiguous stage names
 *
 * Dependencies:
 * - window.Icons (Plus, Edit2, Trash2, ChevronUp, ChevronDown)
 * - window.Domain.Statuses (PREDEFINED_STATUSES, migrateWorkStages, getStageName, getAmbiguousKeywordWarning)
 * - window.FIELD_LIBRARY_NORMALIZED
 * - window.FIELD_LIBRARY_CATEGORIES
 * - window.globalCompany
 *
 * v157c Changes:
 *   - UX: Enable Work Units button now shows confirmation modal + auto-saves
 *     - Modal: "Enable Work Units?" / "This will add a Planning zone to [Board Name]..."
 *     - On confirm: creates zones/series and saves immediately
 *   - UX: Reordered Work Units tab sections for better flow:
 *     - Labels → Work Unit Stages → Default Location → Backlog Zone → Concurrency
 *   - UX: Labels section now compact single row with Starting From inline
 *
 * v157b Changes:
 *   - BUG FIX: Enable Work Units on existing simple board
 *     - Previously tried to use existing kanban zone as backlog (validation failed)
 *     - Now creates NEW "Planning" zone (type: backlog) for work unit management
 *     - Renames existing zone to board name (preserves user's workflow stages)
 *     - User ends up with proper backlog zone + their original kanban workflow
 *
 * v157a Changes:
 *   - UI REDESIGN: Work Units toggle moved from Set Ticket Types tab to tab bar
 *     - Simple boards show "Enable Work Units" button on right side of tab bar
 *     - Work Units tab shows labelPlural if configured, else "Work Units"
 *   - BUG-156-001 FIX: Simple board stage management UI
 *     - Grid layout: Stage Name | Default Status (with optgroups) | Actions (↑ ↓ 🗑)
 *   - TERMINOLOGY: "Product Backlog" → "Planning" when enabling work units
 *
 * Previous (pre-v157a):
 * - PROGRESSIVE PRESENTATION: Conditional tabs based on isSimpleBoard
 *   - Simple boards show "Workflow Stages" tab instead of "Work Zones"
 *   - Simple boards hide "Work Units" tab entirely
 *   - New Stages tab content for direct stage editing
 *   - Work Units enable/disable toggle in Set Ticket Types tab
 *   - Enabling work units converts simple board to work unit board
 *   - Disabling work units (single zone) converts to simple board
 *
 * v154a Changes:
 * - BUG-095-003 FIX: Work Units tab now shows read-only view on non-owner boards
 * - Non-owner boards = boards that don't have backlogZoneId set in workUnitSeries
 * - Read-only view shows: labels, linked zone, default location, concurrency, stages
 * - Info banner with link to "Open [Backlog] Settings" button
 * - Footer Save/Cancel hidden for read-only Work Units tab
 *
 * v154 Changes:
 * - AMBIGUOUS KEYWORD WARNINGS: Shows warning when creating/renaming stages with ambiguous names
 *   - "Closed", "Hold", "Deferred", "Archived", "Pending", "Scheduled", "Shelved"
 *   - AmbiguousKeywordModal offers alternatives or proceed anyway
 *   - Integrated into WorkZoneModal (zone stages) and Work Unit Series (active stages)
 *
 * v153 Changes:
 * - Added component version registry support
 *
 * v145 Changes:
 * - Updated status dropdowns to 6-type model (backlog, scoped, queued, active, completed, ended)
 *
 * v094 Changes:
 * - BUG-075-005: Completed fix - now resets currentSequence when patternStartYear changes
 *   (was only resetting for patternStart changes, not year)
 *
 * Exported via: window.Components.BoardSettingsModals
 */
(function () {
  'use strict';

  // v184b: Component version for registry
  const COMPONENT_VERSION = 'v184b';

  const { useState, useEffect } = React;

  // Import from window namespace
  const { Plus, Edit2, Trash2, ChevronUp, ChevronDown } = window.Icons || {};
  const {
    PREDEFINED_STATUSES,
    migrateWorkStages,
    getStageName,
    getStageDefaultStatus,
    getAmbiguousKeywordWarning,
    inferStatusFromStageName,
  } = window.Domain?.Statuses || {};
  // Note: FIELD_LIBRARY_NORMALIZED and FIELD_LIBRARY_CATEGORIES are looked up at render time
  // because Babel scripts load async and these might not be on window yet at module load time
  const BOARD_COLORS = window.BOARD_COLORS || [];

  const ProcessBoardSettingsModal = ({ board, opCentre, company, tickets, onSave, onClose }) => {
    const [activeTab, setActiveTab] = useState('general');
    const [boardName, setBoardName] = useState(board.name);
    const [boardColor, setBoardColor] = useState(board.color);
    const [allowedTypes, setAllowedTypes] = useState([...board.allowedTicketTypes]);
    const [workZones, setWorkZones] = useState([...board.workZones]);
    const [defaultZone, setDefaultZone] = useState(board.defaultZone);
    const [defaultStage, setDefaultStage] = useState(board.defaultStage);
    const [accessType, setAccessType] = useState(board.access?.type || 'inherit');
    const [selectedUsers, setSelectedUsers] = useState(board.access?.users || []);
    const [fieldOverrides, setFieldOverrides] = useState(board.fieldOverrides || {});
    const [editingZone, setEditingZone] = useState(null);
    const [showZoneModal, setShowZoneModal] = useState(false);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [confirmationConfig, setConfirmationConfig] = useState(null);
    const [showFieldOverrideModal, setShowFieldOverrideModal] = useState(false);
    const [editingField, setEditingField] = useState(null);
    const [showFieldPickerModal, setShowFieldPickerModal] = useState(false);
    const [fieldPickerTicketType, setFieldPickerTicketType] = useState(null);
    const [pickerExpandedCats, setPickerExpandedCats] = useState({});

    // v060: Work Unit Series state (replaces old useContainers/containerConfig)
    const [workUnitSeries, setWorkUnitSeries] = useState(board.workUnitSeries || null);
    const [showWorkUnitSeriesModal, setShowWorkUnitSeriesModal] = useState(false);

    // v170: CRM Mirror state
    const [crmMirror, setCrmMirror] = useState(board.crmMirror || null);

    // v184b: Supplier Mirror state
    const [supplierMirror, setSupplierMirror] = useState(board.supplierMirror || null);

    // v155 Progressive Disclosure: Detect if this is a simple board (no work units)
    const isSimpleBoard = !workUnitSeries?.enabled;

    // v062 BUG-062-004: Tab switching warning state
    const [pendingTabSwitch, setPendingTabSwitch] = useState(null);
    const [showTabSwitchWarning, setShowTabSwitchWarning] = useState(false);

    // v154: Ambiguous keyword warning state for Work Unit Series stages
    const [showAmbiguousWarning, setShowAmbiguousWarning] = useState(false);
    const [ambiguousWarningConfig, setAmbiguousWarningConfig] = useState(null);

    // Sync state when board prop changes (e.g., after we save to parent)
    React.useEffect(() => {
      setBoardName(board.name);
      setBoardColor(board.color);
      setAllowedTypes([...board.allowedTicketTypes]);
      setWorkZones([...board.workZones]);
      setDefaultZone(board.defaultZone);
      setDefaultStage(board.defaultStage);
      setAccessType(board.access?.type || 'inherit');
      setSelectedUsers(board.access?.users || []);
      setFieldOverrides(board.fieldOverrides || {});
      setWorkUnitSeries(board.workUnitSeries || null); // v060: Work Unit Series
      setCrmMirror(board.crmMirror || null); // v170: CRM Mirror
      setSupplierMirror(board.supplierMirror || null); // v184b: Supplier Mirror
    }, [board]);

    // v154a: Detect if this board owns the Work Unit Series configuration
    // Owner = has workUnitSeries.backlogZoneId set (and enabled)
    const isWorkUnitSeriesOwner = !!(board.workUnitSeries?.backlogZoneId && board.workUnitSeries?.enabled !== false);

    // v154a: Find the backlog board that owns Work Unit Series config in this Work Centre
    const getBacklogBoard = () => {
      if (!opCentre?.processBoards) return null;
      return opCentre.processBoards.find(
        (b) => b.workUnitSeries?.backlogZoneId && b.workUnitSeries?.enabled !== false && b.id !== board.id
      );
    };
    const backlogBoard = isWorkUnitSeriesOwner ? null : getBacklogBoard();

    // v154a: Get the effective work unit series config (from this board or backlog board)
    const effectiveWorkUnitSeries = isWorkUnitSeriesOwner ? workUnitSeries : backlogBoard?.workUnitSeries || null;

    // Track if any changes have been made
    // NOTE: Only tracks changes in Set Ticket Types and Access Control tabs
    // Work Zones and Field Customisation save directly via their own modals
    // v060: Track workUnitSeries changes
    // v171a: Track workZones changes (for simple board stage editing)
    // v184b: Track supplierMirror changes
    const hasChanges =
      boardName !== board.name ||
      boardColor !== board.color ||
      JSON.stringify(allowedTypes.sort()) !== JSON.stringify([...board.allowedTicketTypes].sort()) ||
      JSON.stringify(workZones) !== JSON.stringify(board.workZones) ||
      defaultZone !== board.defaultZone ||
      defaultStage !== board.defaultStage ||
      accessType !== (board.access?.type || 'inherit') ||
      JSON.stringify(selectedUsers.sort()) !== JSON.stringify((board.access?.users || []).sort()) ||
      JSON.stringify(workUnitSeries) !== JSON.stringify(board.workUnitSeries || null) ||
      JSON.stringify(crmMirror) !== JSON.stringify(board.crmMirror || null) ||
      JSON.stringify(supplierMirror) !== JSON.stringify(board.supplierMirror || null);

    const handleToggleUser = (userName) => {
      if (selectedUsers.includes(userName)) {
        setSelectedUsers(selectedUsers.filter((u) => u !== userName));
      } else {
        setSelectedUsers([...selectedUsers, userName]);
      }
    };

    // v062 BUG-062-004: Handle tab switching with unsaved changes warning
    const handleTabSwitch = (newTab) => {
      if (newTab === activeTab) return;

      if (hasChanges) {
        // Show warning dialog
        setPendingTabSwitch(newTab);
        setShowTabSwitchWarning(true);
      } else {
        // No changes, switch directly
        setActiveTab(newTab);
      }
    };

    const handleTabSwitchSave = () => {
      // Save changes and then switch tab
      handleSave();
      setActiveTab(pendingTabSwitch);
      setPendingTabSwitch(null);
      setShowTabSwitchWarning(false);
    };

    const handleTabSwitchDiscard = () => {
      // Discard changes by resetting state and switch tab
      setBoardName(board.name);
      setBoardColor(board.color);
      setAllowedTypes([...board.allowedTicketTypes]);
      setWorkZones([...board.workZones]);
      setDefaultZone(board.defaultZone);
      setDefaultStage(board.defaultStage);
      setAccessType(board.access?.type || 'inherit');
      setSelectedUsers(board.access?.users || []);
      setFieldOverrides(board.fieldOverrides || {});
      setWorkUnitSeries(board.workUnitSeries || null);

      setActiveTab(pendingTabSwitch);
      setPendingTabSwitch(null);
      setShowTabSwitchWarning(false);
    };

    const handleTabSwitchCancel = () => {
      // Stay on current tab
      setPendingTabSwitch(null);
      setShowTabSwitchWarning(false);
    };

    const handleToggleTicketType = (typeId) => {
      if (allowedTypes.includes(typeId)) {
        setAllowedTypes(allowedTypes.filter((t) => t !== typeId));
      } else {
        setAllowedTypes([...allowedTypes, typeId]);
      }
    };

    const handleSave = () => {
      // BUG-060-008 FIX: Validate Work Unit Series has at least one stage
      if (
        workUnitSeries &&
        workUnitSeries.enabled !== false &&
        (!workUnitSeries.activeStages || workUnitSeries.activeStages.length === 0)
      ) {
        setConfirmationConfig({
          title: 'No Stages Configured',
          message: 'Work Unit Series requires at least one stage. Please add a stage before saving.',
          confirmText: 'OK',
          type: 'warning',
          onConfirm: () => {}, // Just close the dialog
        });
        setShowConfirmation(true);
        return;
      }

      // v066 BUG-062-014: Validate no empty stage names
      if (workUnitSeries && workUnitSeries.enabled !== false && workUnitSeries.activeStages) {
        const emptyStages = workUnitSeries.activeStages.filter((s) => !s.name || s.name.trim() === '');
        if (emptyStages.length > 0) {
          setConfirmationConfig({
            title: 'Empty Stage Names',
            message: 'All stages must have a name. Please remove or name the empty stages before saving.',
            confirmText: 'OK',
            type: 'warning',
            onConfirm: () => {}, // Just close the dialog
          });
          setShowConfirmation(true);
          return;
        }
      }

      // v062 BUG-062-007: Validate backlogZoneId is set when Work Units are enabled
      if (workUnitSeries && workUnitSeries.enabled !== false && !workUnitSeries.backlogZoneId) {
        setConfirmationConfig({
          title: 'No Backlog Zone Selected',
          message: `Please select a backlog zone before saving. New ${(workUnitSeries.labelPlural || 'work units').toLowerCase()} will appear as stages in the selected zone.`,
          confirmText: 'OK',
          type: 'warning',
          onConfirm: () => {}, // Just close the dialog
        });
        setShowConfirmation(true);
        return;
      }

      // v065: Check if selected zone still exists AND is a backlog type
      if (workUnitSeries && workUnitSeries.enabled !== false && workUnitSeries.backlogZoneId) {
        const selectedZone = workZones.find((z) => z.id === workUnitSeries.backlogZoneId);
        if (!selectedZone) {
          setConfirmationConfig({
            title: 'Selected Zone No Longer Exists',
            message: `The previously selected backlog zone has been deleted. Please select a different zone.`,
            confirmText: 'OK',
            type: 'warning',
            onConfirm: () => {}, // Just close the dialog
          });
          setShowConfirmation(true);
          return;
        }
        if (selectedZone.type !== 'backlog') {
          setConfirmationConfig({
            title: 'Invalid Zone Type',
            message: `The selected zone "${selectedZone.name}" is not a backlog zone. Please select a zone with type "backlog".`,
            confirmText: 'OK',
            type: 'warning',
            onConfirm: () => {}, // Just close the dialog
          });
          setShowConfirmation(true);
          return;
        }
      }

      const nameChanged = boardName.trim() !== board.name && boardName.trim() !== '';

      if (nameChanged) {
        setConfirmationConfig({
          title: 'Rename Work Board',
          message: `You are about to rename the Work Board from "${board.name}" to "${boardName.trim()}" (Work Board).`,
          confirmText: 'Rename',
          type: 'rename',
          onConfirm: () => performSave(),
        });
        setShowConfirmation(true);
      } else {
        performSave();
      }
    };

    const performSave = () => {
      const updatedBoard = {
        ...board,
        name: boardName,
        color: boardColor,
        allowedTicketTypes: allowedTypes,
        workZones: workZones,
        defaultZone: defaultZone,
        defaultStage: defaultStage,
        workUnitSeries: workUnitSeries, // v060: Work Unit Series
        crmMirror: crmMirror, // v170: CRM Mirror
        supplierMirror: supplierMirror, // v184b: Supplier Mirror
        access: {
          type: accessType,
          users: accessType === 'specific' ? selectedUsers : [],
        },
        fieldOverrides: fieldOverrides,
      };
      onSave(updatedBoard);
    };

    const handleDeleteZone = (zoneId) => {
      const zone = workZones.find((z) => z.id === zoneId);
      setConfirmationConfig({
        title: 'Delete Work Zone',
        message: `You are about to delete the work zone "${zone?.name || zoneId}" (Work Zone). Existing tickets will remain in place.`,
        confirmText: 'Delete',
        type: 'delete',
        onConfirm: () => {
          const updatedZones = workZones.filter((z) => z.id !== zoneId);
          let newDefaultZone = defaultZone;
          if (defaultZone === zoneId && updatedZones.length > 0) {
            newDefaultZone = updatedZones[0].id;
          }

          // Save directly to parent
          const updatedBoard = {
            ...board,
            workZones: updatedZones,
            defaultZone: newDefaultZone,
          };
          onSave(updatedBoard);
        },
      });
      setShowConfirmation(true);
    };

    const handleSaveZone = (zoneData) => {
      let updatedZones;
      if (editingZone) {
        updatedZones = workZones.map((z) => (z.id === editingZone.id ? { ...editingZone, ...zoneData } : z));
      } else {
        const newZone = {
          id: `zone-${Date.now()}`,
          ...zoneData,
        };
        updatedZones = [...workZones, newZone];
      }

      // Save directly to parent (bypasses local hasChanges)
      const updatedBoard = {
        ...board,
        workZones: updatedZones,
      };
      onSave(updatedBoard);

      setShowZoneModal(false);
      setEditingZone(null);
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-6xl w-full h-[85vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Work Board Settings: {board.name}</h2>
            <p className="text-sm text-gray-600 mt-1">Work Centre: {opCentre.name}</p>
          </div>

          {/* Tabs - v062 BUG-062-004: Use handleTabSwitch to check for unsaved changes */}
          {/* v159: Redesigned tab bar with Enable Work Units button for simple boards */}
          <div className="border-b border-gray-200">
            <div className="flex items-center justify-between px-6">
              <div className="flex gap-1">
                <button
                  onClick={() => handleTabSwitch('general')}
                  className={`px-4 py-3 font-medium text-sm border-b-2 transition ${
                    activeTab === 'general'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Set Ticket Types
                </button>
                {/* v155: Show "Stages" for simple boards, "Work Zones" for work unit boards */}
                {isSimpleBoard ? (
                  <button
                    onClick={() => handleTabSwitch('stages')}
                    className={`px-4 py-3 font-medium text-sm border-b-2 transition ${
                      activeTab === 'stages'
                        ? 'border-indigo-600 text-indigo-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Workflow Stages
                  </button>
                ) : (
                  <button
                    onClick={() => handleTabSwitch('zones')}
                    className={`px-4 py-3 font-medium text-sm border-b-2 transition ${
                      activeTab === 'zones'
                        ? 'border-indigo-600 text-indigo-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Work Zones
                  </button>
                )}
                <button
                  onClick={() => handleTabSwitch('access')}
                  className={`px-4 py-3 font-medium text-sm border-b-2 transition ${
                    activeTab === 'access'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Access Control
                </button>
                <button
                  onClick={() => handleTabSwitch('fields')}
                  className={`px-4 py-3 font-medium text-sm border-b-2 transition ${
                    activeTab === 'fields'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Field Customisation
                </button>
                {/* v159: Work Units tab only shown for work unit boards */}
                {!isSimpleBoard && (
                  <button
                    onClick={() => handleTabSwitch('workunits')}
                    className={`px-4 py-3 font-medium text-sm border-b-2 transition ${
                      activeTab === 'workunits'
                        ? 'border-indigo-600 text-indigo-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    🏃 {workUnitSeries?.labelPlural || 'Work Units'}
                  </button>
                )}
                {/* v170: CRM Mirror tab */}
                <button
                  onClick={() => handleTabSwitch('crm')}
                  className={`px-4 py-3 font-medium text-sm border-b-2 transition ${
                    activeTab === 'crm'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  👥 CRM Mirror
                </button>
                {/* v184b: Supplier Mirror tab */}
                <button
                  onClick={() => handleTabSwitch('suppliers')}
                  className={`px-4 py-3 font-medium text-sm border-b-2 transition ${
                    activeTab === 'suppliers'
                      ? 'border-teal-600 text-teal-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  🏭 Supplier Mirror
                </button>
              </div>

              {/* v159: Enable Work Units button for simple boards - on the right side of tab bar */}
              {isSimpleBoard && (
                <button
                  onClick={() => {
                    // v161: Show confirmation modal before enabling
                    setConfirmationConfig({
                      title: 'Enable Work Units?',
                      message: `This will add a Planning zone to "${boardName || board.name}" and allow you to configure sprint management.`,
                      confirmText: 'Enable',
                      type: 'info',
                      onConfirm: () => {
                        // v160: Create NEW Planning zone for backlog (proper backlog type)
                        const planningZoneId = `zone-planning-${Date.now()}`;
                        const newPlanningZone = {
                          id: planningZoneId,
                          name: 'Planning',
                          type: 'backlog',
                          workStages: [
                            { name: 'New', defaultStatus: 'new' },
                            { name: 'Backlog', defaultStatus: 'backlog' },
                          ],
                        };

                        // Enable work units with default configuration
                        const newSeries = {
                          id: `series-${Date.now()}`,
                          enabled: true,
                          label: 'Sprint',
                          labelPlural: 'Sprints',
                          patternType: 'sequential',
                          patternStart: 1,
                          patternStartYear: new Date().getFullYear(),
                          allowOverlap: false,
                          backlogZoneId: planningZoneId,
                          currentSequence: 1,
                          activeStages: [
                            { name: 'To Do', defaultStatus: 'todo' },
                            { name: 'In Progress', defaultStatus: 'in-progress' },
                            { name: 'Done', defaultStatus: 'completed' },
                          ],
                        };

                        // v160: Build updated zones array
                        let updatedZones;
                        if (workZones.length === 1 && workZones[0].isSystemZone) {
                          updatedZones = [
                            newPlanningZone,
                            {
                              ...workZones[0],
                              name: boardName || board.name,
                            },
                          ];
                        } else {
                          updatedZones = [newPlanningZone, ...workZones];
                        }

                        // v161: Auto-save immediately
                        const updatedBoard = {
                          ...board,
                          workZones: updatedZones,
                          workUnitSeries: newSeries,
                          defaultZone: planningZoneId,
                          defaultStage: 'New',
                        };
                        onSave(updatedBoard);

                        // Update local state to match
                        setWorkZones(updatedZones);
                        setWorkUnitSeries(newSeries);
                        setDefaultZone(planningZoneId);
                        setDefaultStage('New');

                        // Switch to work units tab to configure labels
                        setActiveTab('workunits');
                      },
                    });
                    setShowConfirmation(true);
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition"
                >
                  <span>🏃</span>
                  Enable Work Units
                </button>
              )}
            </div>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'general' && (
              <div className="space-y-6">
                {/* Board Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Board Name</label>
                  <input
                    type="text"
                    value={boardName}
                    onChange={(e) => setBoardName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>

                {/* Allowed Ticket Types */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Allowed Ticket Types</label>
                  <p className="text-sm text-gray-600 mb-3">Select which ticket types can be created on this board</p>
                  <div className="space-y-2 border border-gray-200 rounded-lg p-3">
                    {company.globalTicketTypes.map((type) => (
                      <label
                        key={type.id}
                        className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={allowedTypes.includes(type.id)}
                          onChange={() => handleToggleTicketType(type.id)}
                          className="rounded"
                        />
                        <div className="text-xl">{type.icon}</div>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{type.name}</div>
                          <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                            <span>{type.fields.length} fields</span>
                            {(() => {
                              const overrides = fieldOverrides?.[type.id] || {};
                              const addedCount = (overrides._additionalFields || []).length;
                              const hiddenCount = Object.entries(overrides).filter(
                                ([k, v]) => k !== '_additionalFields' && v?.hidden
                              ).length;
                              const customisedCount = Object.entries(overrides).filter(
                                ([k, v]) => k !== '_additionalFields' && !v?.hidden && Object.keys(v).length > 0
                              ).length;
                              return (
                                <>
                                  {addedCount > 0 && (
                                    <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                                      +{addedCount} added
                                    </span>
                                  )}
                                  {hiddenCount > 0 && (
                                    <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-xs">
                                      {hiddenCount} hidden
                                    </span>
                                  )}
                                  {customisedCount > 0 && (
                                    <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs">
                                      Customised
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <span
                          className="px-2 py-0.5 text-xs font-medium rounded-full"
                          style={{
                            backgroundColor: COLOR_OPTIONS.find((c) => c.name === type.color)?.bg,
                            color: COLOR_OPTIONS.find((c) => c.name === type.color)?.text,
                          }}
                        >
                          {type.color}
                        </span>
                      </label>
                    ))}
                    {company.globalTicketTypes.length === 0 && (
                      <p className="text-sm text-gray-500 text-center py-4">
                        No ticket types defined. Create one in Global Settings → Ticket Types.
                      </p>
                    )}
                  </div>
                  {allowedTypes.length === 0 && company.globalTicketTypes.length > 0 && (
                    <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-sm text-yellow-800">
                        ⚠️ No ticket types selected. Users won't be able to create tickets on this board.
                      </p>
                    </div>
                  )}
                </div>

                {/* v067: Default Location moved to Work Zones tab - see ENH-001 */}

                {/* v159: Work Units toggle REMOVED from here - now in tab bar for simple boards */}
              </div>
            )}

            {/* v159: Stages tab for simple boards - grid layout matching WorkZoneModal (BUG-156-001 FIX) */}
            {activeTab === 'stages' && isSimpleBoard && (
              <div className="h-full flex flex-col" style={{ margin: '-1.5rem' }}>
                {/* Sticky Header */}
                <div className="flex-shrink-0 bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Workflow Stages</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Define the columns for your kanban board. Each stage maps to a status for filtering.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {(() => {
                    const zone = workZones[0];
                    if (!zone) return <p className="text-gray-500">No zone found</p>;

                    const stages = zone.workStages || [];
                    const statuses = company?.statuses || PREDEFINED_STATUSES || [];

                    // v159: Helper functions matching WorkZoneModal pattern
                    const handleStageNameChange = (idx, newName) => {
                      const newStages = [...stages];
                      const inferredStatus = inferStatusFromStageName
                        ? inferStatusFromStageName(newName)
                        : stages[idx]?.defaultStatus || 'backlog';
                      if (typeof newStages[idx] === 'string') {
                        newStages[idx] = { name: newName, defaultStatus: inferredStatus };
                      } else {
                        newStages[idx] = { ...newStages[idx], name: newName, defaultStatus: inferredStatus };
                      }
                      setWorkZones([{ ...zone, workStages: newStages }]);
                    };

                    const handleStageStatusChange = (idx, newStatus) => {
                      const newStages = [...stages];
                      if (typeof newStages[idx] === 'string') {
                        newStages[idx] = { name: newStages[idx], defaultStatus: newStatus };
                      } else {
                        newStages[idx] = { ...newStages[idx], defaultStatus: newStatus };
                      }
                      setWorkZones([{ ...zone, workStages: newStages }]);
                    };

                    const handleMoveStage = (idx, direction) => {
                      const newIndex = idx + direction;
                      if (newIndex < 0 || newIndex >= stages.length) return;
                      const newStages = [...stages];
                      [newStages[idx], newStages[newIndex]] = [newStages[newIndex], newStages[idx]];
                      setWorkZones([{ ...zone, workStages: newStages }]);
                    };

                    const handleRemoveStage = (idx) => {
                      if (stages.length <= 1) return;
                      const stageName = getStageName(stages[idx]);
                      const newStages = stages.filter((_, i) => i !== idx);
                      setWorkZones([{ ...zone, workStages: newStages }]);
                      // Update default stage if needed
                      if (defaultStage === stageName && newStages.length > 0) {
                        setDefaultStage(getStageName(newStages[0]));
                      }
                    };

                    const handleAddStage = (stageName) => {
                      if (!stageName.trim()) return;
                      if (stages.some((s) => getStageName(s) === stageName.trim())) return;
                      const inferredStatus = inferStatusFromStageName
                        ? inferStatusFromStageName(stageName.trim())
                        : 'backlog';
                      const newStage = { name: stageName.trim(), defaultStatus: inferredStatus };
                      setWorkZones([{ ...zone, workStages: [...stages, newStage] }]);
                    };

                    return (
                      <div>
                        {/* v159: Header row matching WorkZoneModal */}
                        <div className="grid grid-cols-[1fr_180px_100px] gap-2 mb-2 px-1 text-xs font-medium text-gray-500 uppercase">
                          <div>Stage Name</div>
                          <div>Default Status</div>
                          <div className="text-right">Actions</div>
                        </div>

                        {/* v159: Stage rows with grid layout */}
                        <div className="space-y-2">
                          {stages.map((stage, idx) => {
                            const stageName = getStageName(stage);
                            const stageStatus = typeof stage === 'object' ? stage.defaultStatus : 'backlog';
                            return (
                              <div key={idx} className="grid grid-cols-[1fr_180px_100px] gap-2 items-center">
                                <input
                                  type="text"
                                  value={stageName}
                                  onChange={(e) => handleStageNameChange(idx, e.target.value)}
                                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                  placeholder="Stage name"
                                />
                                <select
                                  value={stageStatus}
                                  onChange={(e) => handleStageStatusChange(idx, e.target.value)}
                                  className="px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                >
                                  {/* v159: Grouped optgroups like WorkZoneModal */}
                                  <optgroup label="Backlog">
                                    {statuses
                                      .filter((s) => s.type === 'backlog')
                                      .map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.label}
                                        </option>
                                      ))}
                                  </optgroup>
                                  <optgroup label="Scoped">
                                    {statuses
                                      .filter((s) => s.type === 'scoped')
                                      .map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.label}
                                        </option>
                                      ))}
                                  </optgroup>
                                  <optgroup label="Queued">
                                    {statuses
                                      .filter((s) => s.type === 'queued')
                                      .map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.label}
                                        </option>
                                      ))}
                                  </optgroup>
                                  <optgroup label="Active">
                                    {statuses
                                      .filter((s) => s.type === 'active')
                                      .map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.label}
                                        </option>
                                      ))}
                                  </optgroup>
                                  <optgroup label="Completed">
                                    {statuses
                                      .filter((s) => s.type === 'completed')
                                      .map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.label}
                                        </option>
                                      ))}
                                  </optgroup>
                                  <optgroup label="Ended">
                                    {statuses
                                      .filter((s) => s.type === 'ended')
                                      .map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.label}
                                        </option>
                                      ))}
                                  </optgroup>
                                </select>
                                {/* v159: Actions on right - ↑ ↓ 🗑 matching WorkZoneModal */}
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => handleMoveStage(idx, -1)}
                                    disabled={idx === 0}
                                    className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Move up"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    onClick={() => handleMoveStage(idx, 1)}
                                    disabled={idx === stages.length - 1}
                                    className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Move down"
                                  >
                                    ↓
                                  </button>
                                  <button
                                    onClick={() => handleRemoveStage(idx)}
                                    disabled={stages.length === 1}
                                    className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Delete"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}

                          {/* v159: Add new stage row */}
                          <div className="flex gap-2 mt-3">
                            <input
                              type="text"
                              id="newStageName"
                              placeholder="Add new stage..."
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                              onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                  handleAddStage(e.target.value);
                                  e.target.value = '';
                                }
                              }}
                            />
                            <button
                              onClick={() => {
                                const input = document.getElementById('newStageName');
                                if (input) {
                                  handleAddStage(input.value);
                                  input.value = '';
                                }
                              }}
                              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                            >
                              Add
                            </button>
                          </div>
                        </div>

                        <p className="text-xs text-gray-500 mt-3">
                          💡 When tickets are dragged to a stage, their status will be set to the stage's default
                          status.
                        </p>
                      </div>
                    );
                  })()}

                  {/* Default Stage selector */}
                  <div className="mt-6 pt-6 border-t border-gray-200">
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-1">Default Stage for New Tickets</h4>
                      <p className="text-sm text-gray-600 mb-4">Where should new tickets appear?</p>
                      <select
                        value={defaultStage}
                        onChange={(e) => setDefaultStage(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                      >
                        {(workZones[0]?.workStages || []).map((s, idx) => {
                          const name = getStageName(s);
                          return (
                            <option key={idx} value={name}>
                              {name}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'zones' && (
              <div className="h-full flex flex-col" style={{ margin: '-1.5rem' }}>
                {/* Sticky Header */}
                <div className="flex-shrink-0 bg-white px-6 pt-6 pb-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Work Zones</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Organise tickets into different workflow zones (e.g., Backlog, Active Sprints)
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setEditingZone(null);
                        setShowZoneModal(true);
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                    >
                      <Plus size={16} />
                      New Work Zone
                    </button>
                  </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-3">
                    {workZones.map((zone) => {
                      // v077 BUG-075-004: Count tickets in this zone
                      const zoneTicketCount = (tickets || []).filter((t) => t.sectionId === zone.id).length;

                      return (
                        <div
                          key={zone.id}
                          className="border-2 border-gray-200 rounded-lg p-4 hover:border-gray-300 transition"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h4 className="font-semibold text-gray-900">{zone.name}</h4>
                                <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                                  {zone.type}
                                </span>
                                {zone.id === defaultZone && (
                                  <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded font-medium">
                                    Default
                                  </span>
                                )}
                                {/* v077 BUG-075-004: Show ticket count */}
                                <span
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    zoneTicketCount > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-50 text-gray-400'
                                  }`}
                                >
                                  {zoneTicketCount} ticket{zoneTicketCount !== 1 ? 's' : ''}
                                </span>
                              </div>
                              <div className="text-sm text-gray-600">
                                <div>
                                  <span className="font-medium">Stages:</span>{' '}
                                  {zone.workStages.map((s) => getStageName(s)).join(' → ')}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setEditingZone(zone);
                                  setShowZoneModal(true);
                                }}
                                className="p-2 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteZone(zone.id)}
                                className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition"
                                disabled={workZones.length === 1}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* v067 ENH-001: Default Location - moved from Set Ticket Types tab */}
                  <div className="mt-6 pt-6 border-t border-gray-200">
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-1">Default Location for New Tickets</h4>
                      <p className="text-sm text-gray-600 mb-4">Where should new tickets be created?</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Default Zone</label>
                          <select
                            value={defaultZone}
                            onChange={(e) => {
                              setDefaultZone(e.target.value);
                              const zone = workZones.find((z) => z.id === e.target.value);
                              if (zone && zone.workStages?.length > 0) {
                                setDefaultStage(getStageName(zone.workStages[0]));
                              }
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                          >
                            {workZones.map((zone) => (
                              <option key={zone.id} value={zone.id}>
                                {zone.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Default Stage</label>
                          <select
                            value={defaultStage}
                            onChange={(e) => setDefaultStage(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                          >
                            {workZones
                              .find((z) => z.id === defaultZone)
                              ?.workStages.map((stage, idx) => {
                                const stageName = getStageName(stage);
                                return (
                                  <option key={stageName || idx} value={stageName}>
                                    {stageName}
                                  </option>
                                );
                              })}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'access' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-4">Access Control</h3>
                  <p className="text-sm text-gray-600 mb-4">Control who can access this specific Work Board</p>

                  <div className="space-y-3">
                    <label className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                      <input
                        type="radio"
                        name="accessType"
                        value="inherit"
                        checked={accessType === 'inherit'}
                        onChange={(e) => setAccessType(e.target.value)}
                        className="mt-1"
                      />
                      <div>
                        <div className="font-medium text-gray-900">Inherit from Work Centre</div>
                        <div className="text-sm text-gray-600">
                          Use the same access rules as "{opCentre.name}"
                          {opCentre.access?.type === 'all' && (
                            <span className="text-indigo-600"> (All NUMA Users)</span>
                          )}
                          {opCentre.access?.type === 'specific' && (
                            <span className="text-indigo-600"> ({opCentre.access.users.length} users)</span>
                          )}
                        </div>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                      <input
                        type="radio"
                        name="accessType"
                        value="all"
                        checked={accessType === 'all'}
                        onChange={(e) => setAccessType(e.target.value)}
                        className="mt-1"
                      />
                      <div>
                        <div className="font-medium text-gray-900">All NUMA Users</div>
                        <div className="text-sm text-gray-600">
                          Everyone in the company can access this board (overrides Work Centre restriction)
                        </div>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                      <input
                        type="radio"
                        name="accessType"
                        value="specific"
                        checked={accessType === 'specific'}
                        onChange={(e) => setAccessType(e.target.value)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">Specific Users Only</div>
                        <div className="text-sm text-gray-600 mb-3">Only selected users can access this board</div>

                        {accessType === 'specific' && (
                          <div className="mt-3 space-y-2 pl-4 border-l-2 border-indigo-200">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-gray-700">
                                Select Users ({selectedUsers.length} selected)
                              </span>
                              <button
                                onClick={() => setSelectedUsers(company.globalStaff.map((s) => s.name))}
                                className="text-xs text-indigo-600 hover:text-indigo-700"
                              >
                                Select All
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                              {company.globalStaff.map((staff) => (
                                <label
                                  key={staff.id}
                                  className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedUsers.includes(staff.name)}
                                    onChange={() => handleToggleUser(staff.name)}
                                    className="rounded"
                                  />
                                  <div className="text-sm">
                                    <div className="font-medium">{staff.name}</div>
                                    <div className="text-xs text-gray-500">{staff.role}</div>
                                  </div>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'fields' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Field Customisation</h3>
                  <p className="text-sm text-gray-600 mb-2">
                    Customise, hide, or add fields for each ticket type on this board. Changes here only affect this
                    board, not global settings or other boards.
                  </p>
                  <p className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-lg mb-4">
                    💡 <strong>Need a new field?</strong> New fields must be created by a Global Admin in Global
                    Settings → Fields. Once created, you can add them to ticket types here.
                  </p>

                  {(() => {
                    // Get allowed ticket types for this board
                    const allowedTicketTypeObjects = allowedTypes
                      .map((typeId) => company.globalTicketTypes.find((t) => t.id === typeId))
                      .filter(Boolean);

                    if (allowedTicketTypeObjects.length === 0) {
                      return (
                        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                          <p className="text-gray-500">
                            No ticket types selected. Go to the Set Ticket Types tab to add ticket types to this board.
                          </p>
                        </div>
                      );
                    }

                    const fullFieldLibrary = { ...(window.FIELD_LIBRARY_NORMALIZED || {}) };
                    // Merge custom fields
                    (company.customFields || []).forEach((cf) => {
                      fullFieldLibrary[cf.id] = { ...cf, label: cf.label || cf.name };
                    });

                    return (
                      <div className="space-y-4">
                        {allowedTicketTypeObjects.map((ticketType) => {
                          // Get base fields from ticket type
                          const baseFieldIds = ticketType.fields || [];

                          // Get additional fields added at board level
                          const additionalFieldIds = fieldOverrides[ticketType.id]?._additionalFields || [];

                          // Combine all field IDs, respecting custom order if set
                          const defaultFieldIds = [...baseFieldIds, ...additionalFieldIds];
                          const customOrder = fieldOverrides[ticketType.id]?._fieldOrder;
                          const allFieldIds = customOrder
                            ? customOrder
                                .filter((id) => defaultFieldIds.includes(id))
                                .concat(defaultFieldIds.filter((id) => !customOrder.includes(id)))
                            : defaultFieldIds;

                          const typeFields = allFieldIds
                            .map((fieldId) => {
                              const field = fullFieldLibrary[fieldId];
                              if (field) {
                                return { ...field, id: fieldId, _isAdditional: additionalFieldIds.includes(fieldId) };
                              }
                              return null;
                            })
                            .filter(Boolean);

                          // Get overrides for this specific ticket type
                          const typeOverrides = fieldOverrides[ticketType.id] || {};
                          const hasAnyOverrides =
                            Object.keys(typeOverrides).filter((k) => k !== '_additionalFields').length > 0 ||
                            additionalFieldIds.length > 0;

                          // BUG-004 FIX: Separate visible and hidden fields
                          const visibleFields = typeFields.filter((f) => !typeOverrides[f.id]?.hidden);
                          const hiddenFields = typeFields.filter((f) => typeOverrides[f.id]?.hidden);

                          // Get available fields that could be added (not already in type)
                          const existingFieldIds = allFieldIds;
                          const availableToAdd = Object.entries(fullFieldLibrary)
                            .filter(([id]) => !existingFieldIds.includes(id))
                            .map(([id, field]) => ({ ...field, id }));

                          return (
                            <div key={ticketType.id} className="border border-gray-200 rounded-lg">
                              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-xl">{ticketType.icon}</span>
                                  <h4 className="font-medium text-gray-900">{ticketType.name}</h4>
                                  <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-600 rounded">
                                    {visibleFields.length} fields
                                  </span>
                                  {hiddenFields.length > 0 && (
                                    <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded">
                                      {hiddenFields.length} hidden
                                    </span>
                                  )}
                                  {hasAnyOverrides && (
                                    <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded">
                                      Customised
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => {
                                      setFieldPickerTicketType(ticketType);
                                      setShowFieldPickerModal(true);
                                    }}
                                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded transition"
                                  >
                                    <Plus size={14} />
                                    Add Field
                                  </button>
                                  {hasAnyOverrides && (
                                    <button
                                      onClick={() => {
                                        const newOverrides = { ...fieldOverrides };
                                        delete newOverrides[ticketType.id];
                                        // Save directly to parent
                                        const updatedBoard = {
                                          ...board,
                                          fieldOverrides: newOverrides,
                                        };
                                        onSave(updatedBoard);
                                      }}
                                      className="text-xs text-gray-500 hover:text-red-600 transition"
                                    >
                                      Reset all
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Visible Fields - Table Layout */}
                              <div className="overflow-x-auto">
                                {/* Column Headers */}
                                <div className="grid grid-cols-[45%_1fr_60px_220px] gap-4 px-4 py-2 bg-gray-100 text-xs font-medium text-gray-600 uppercase tracking-wider border-b border-gray-200">
                                  <div>Field</div>
                                  <div>Tags</div>
                                  <div className="text-center">Order</div>
                                  <div className="text-center">Actions</div>
                                </div>

                                {/* Field Rows */}
                                <div>
                                  {visibleFields.map((field, fieldIndex) => {
                                    const fieldOverride = typeOverrides[field.id];
                                    const hasOverride = !!fieldOverride && !fieldOverride.hidden;
                                    const displayLabel =
                                      hasOverride && fieldOverride.label ? fieldOverride.label : field.label;
                                    const helpText =
                                      hasOverride && fieldOverride.helpText ? fieldOverride.helpText : field.helpText;
                                    const isRequired = hasOverride ? fieldOverride.required : field.required;

                                    // Move field up/down handler
                                    const handleMoveField = (direction) => {
                                      const newOrder = [...allFieldIds];
                                      const currentIndex = newOrder.indexOf(field.id);
                                      if (direction === 'up' && currentIndex > 0) {
                                        [newOrder[currentIndex], newOrder[currentIndex - 1]] = [
                                          newOrder[currentIndex - 1],
                                          newOrder[currentIndex],
                                        ];
                                      } else if (direction === 'down' && currentIndex < newOrder.length - 1) {
                                        [newOrder[currentIndex], newOrder[currentIndex + 1]] = [
                                          newOrder[currentIndex + 1],
                                          newOrder[currentIndex],
                                        ];
                                      }
                                      const newOverrides = { ...fieldOverrides };
                                      if (!newOverrides[ticketType.id]) newOverrides[ticketType.id] = {};
                                      newOverrides[ticketType.id]._fieldOrder = newOrder;
                                      const updatedBoard = { ...board, fieldOverrides: newOverrides };
                                      onSave(updatedBoard);
                                    };

                                    return (
                                      <div
                                        key={field.id}
                                        className="grid grid-cols-[45%_1fr_60px_220px] gap-4 px-4 py-2 hover:bg-gray-50 transition items-center border-b border-gray-100"
                                      >
                                        {/* Field Name + Help Text */}
                                        <div className="min-w-0">
                                          <span className="font-medium text-gray-900" title={displayLabel}>
                                            {displayLabel}
                                          </span>
                                          {helpText && (
                                            <span className="text-xs text-gray-400 ml-2" title={helpText}>
                                              — {helpText.length > 35 ? helpText.slice(0, 35) + '...' : helpText}
                                            </span>
                                          )}
                                        </div>

                                        {/* Tags */}
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {isRequired && (
                                            <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded">
                                              Required
                                            </span>
                                          )}
                                          <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                                            {field.type}
                                          </span>
                                          {field._isAdditional && (
                                            <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-600 rounded">
                                              + Added
                                            </span>
                                          )}
                                          {hasOverride && (
                                            <span className="text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded">
                                              Customised
                                            </span>
                                          )}
                                        </div>

                                        {/* Order Arrows */}
                                        <div className="flex items-center justify-center gap-0.5">
                                          <button
                                            onClick={() => handleMoveField('up')}
                                            disabled={fieldIndex === 0}
                                            className="px-1.5 py-1 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                            title="Move up"
                                          >
                                            ↑
                                          </button>
                                          <button
                                            onClick={() => handleMoveField('down')}
                                            disabled={fieldIndex === visibleFields.length - 1}
                                            className="px-1.5 py-1 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                            title="Move down"
                                          >
                                            ↓
                                          </button>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-2 justify-end">
                                          {field._isAdditional && (
                                            <button
                                              onClick={() => {
                                                const newOverrides = { ...fieldOverrides };
                                                if (newOverrides[ticketType.id]?._additionalFields) {
                                                  newOverrides[ticketType.id]._additionalFields = newOverrides[
                                                    ticketType.id
                                                  ]._additionalFields.filter((id) => id !== field.id);
                                                  if (newOverrides[ticketType.id]._additionalFields.length === 0) {
                                                    delete newOverrides[ticketType.id]._additionalFields;
                                                  }
                                                }
                                                if (newOverrides[ticketType.id]?.[field.id]) {
                                                  delete newOverrides[ticketType.id][field.id];
                                                }
                                                if (
                                                  newOverrides[ticketType.id] &&
                                                  Object.keys(newOverrides[ticketType.id]).length === 0
                                                ) {
                                                  delete newOverrides[ticketType.id];
                                                }
                                                const updatedBoard = { ...board, fieldOverrides: newOverrides };
                                                onSave(updatedBoard);
                                              }}
                                              className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition"
                                              title="Remove field from this board"
                                            >
                                              Remove
                                            </button>
                                          )}
                                          <button
                                            onClick={() => {
                                              const newOverrides = { ...fieldOverrides };
                                              if (!newOverrides[ticketType.id]) newOverrides[ticketType.id] = {};
                                              newOverrides[ticketType.id][field.id] = {
                                                ...(newOverrides[ticketType.id][field.id] || {}),
                                                hidden: true,
                                              };
                                              const updatedBoard = { ...board, fieldOverrides: newOverrides };
                                              onSave(updatedBoard);
                                            }}
                                            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition"
                                          >
                                            Hide
                                          </button>
                                          <button
                                            onClick={() => {
                                              setEditingField({
                                                ...field,
                                                _ticketTypeId: ticketType.id,
                                                _ticketTypeName: ticketType.name,
                                              });
                                              setShowFieldOverrideModal(true);
                                            }}
                                            className="px-3 py-1 text-sm bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded transition"
                                          >
                                            Customise
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* BUG-004 FIX: Hidden Fields Section */}
                              {hiddenFields.length > 0 && (
                                <div className="border-t border-gray-200 bg-orange-50/50">
                                  <div className="px-4 py-2 text-sm font-medium text-orange-700 flex items-center gap-2">
                                    <span>👁️‍🗨️ Hidden Fields ({hiddenFields.length})</span>
                                  </div>
                                  <div className="divide-y divide-orange-100">
                                    {hiddenFields.map((field) => (
                                      <div
                                        key={field.id}
                                        className="px-4 py-2 flex items-center justify-between text-gray-500"
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm">{field.label}</span>
                                          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded">
                                            {field.type}
                                          </span>
                                        </div>
                                        <button
                                          onClick={() => {
                                            const newOverrides = { ...fieldOverrides };
                                            if (newOverrides[ticketType.id]?.[field.id]) {
                                              delete newOverrides[ticketType.id][field.id].hidden;
                                              // If override is now empty, remove it
                                              if (Object.keys(newOverrides[ticketType.id][field.id]).length === 0) {
                                                delete newOverrides[ticketType.id][field.id];
                                              }
                                              if (Object.keys(newOverrides[ticketType.id]).length === 0) {
                                                delete newOverrides[ticketType.id];
                                              }
                                            }
                                            const updatedBoard = {
                                              ...board,
                                              fieldOverrides: newOverrides,
                                            };
                                            onSave(updatedBoard);
                                          }}
                                          className="px-3 py-1 text-sm text-orange-600 hover:text-orange-700 hover:bg-orange-100 rounded transition"
                                        >
                                          Show
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* v060: Work Units Tab */}
            {activeTab === 'workunits' && (
              <div className="space-y-6">
                <div className="h-full flex flex-col" style={{ margin: '-1.5rem', marginTop: '-1.5rem' }}>
                  {/* Sticky Header */}
                  <div className="flex-shrink-0 bg-white px-6 pt-6 pb-4 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">
                          {effectiveWorkUnitSeries
                            ? `${effectiveWorkUnitSeries.labelPlural} Configuration`
                            : 'Work Unit Series'}
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">
                          {!isWorkUnitSeriesOwner && backlogBoard
                            ? `View ${(effectiveWorkUnitSeries?.labelPlural || 'work units').toLowerCase()} configuration from the ${backlogBoard.name} board.`
                            : effectiveWorkUnitSeries
                              ? `Manage time-boxed ${(effectiveWorkUnitSeries.labelPlural || 'work units').toLowerCase()} for this board.`
                              : 'Set up sprints, phases, or campaigns for this board.'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* v154a: Read-only view for non-owner boards */}
                  {!isWorkUnitSeriesOwner ? (
                    <div className="flex-1 overflow-y-auto px-6 py-4">
                      {backlogBoard && effectiveWorkUnitSeries ? (
                        /* Show read-only view of backlog board's work unit config */
                        <div className="space-y-6">
                          {/* Info banner */}
                          <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                            <div className="text-2xl">ℹ️</div>
                            <div className="flex-1">
                              <p className="text-sm text-blue-800">
                                Work Units are configured in the <strong>{backlogBoard.name}</strong> board settings.
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                // Signal to open backlog board settings
                                // For now, just close this modal - user will need to navigate manually
                                onClose();
                              }}
                              className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-100 rounded hover:bg-blue-200 transition"
                            >
                              Open {backlogBoard.name} Settings
                            </button>
                          </div>

                          {/* Labels (read-only) */}
                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-4">Labels</h4>
                            <div className="grid grid-cols-3 gap-4">
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">Singular Label</label>
                                <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                                  {effectiveWorkUnitSeries.label || 'Work Unit'}
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">Plural Label</label>
                                <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                                  {effectiveWorkUnitSeries.labelPlural || 'Work Units'}
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">Naming Pattern</label>
                                <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                                  {effectiveWorkUnitSeries.patternType === 'sequential' && 'Sequential (1, 2, 3...)'}
                                  {effectiveWorkUnitSeries.patternType === 'months' && 'Months'}
                                  {effectiveWorkUnitSeries.patternType === 'quarters' && 'Quarters'}
                                  {effectiveWorkUnitSeries.patternType === 'years' && 'Years'}
                                  {effectiveWorkUnitSeries.patternType === 'alpha' && 'Alphabetic (A, B, C...)'}
                                  {!effectiveWorkUnitSeries.patternType && 'Sequential'}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Linked Backlog Zone (read-only) */}
                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-2">Linked Backlog Zone</h4>
                            <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                              {(() => {
                                const backlogZone = backlogBoard.workZones?.find(
                                  (z) => z.id === effectiveWorkUnitSeries.backlogZoneId
                                );
                                return backlogZone?.name || 'Not set';
                              })()}
                            </div>
                          </div>

                          {/* Default New Ticket Location (read-only) */}
                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-2">Default New Ticket Location</h4>
                            <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                              {(() => {
                                const zone = backlogBoard.workZones?.find((z) => z.id === backlogBoard.defaultZone);
                                return `${zone?.name || 'Not set'} → ${backlogBoard.defaultStage || 'Not set'}`;
                              })()}
                            </div>
                          </div>

                          {/* Concurrency (read-only) */}
                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-2">Concurrency</h4>
                            <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                              {effectiveWorkUnitSeries.allowOverlap
                                ? 'Multiple active at once allowed'
                                : 'Single active at a time'}
                            </div>
                          </div>

                          {/* Work Unit Stages (read-only) */}
                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-4">Work Unit Stages</h4>
                            <p className="text-xs text-gray-500 mb-3">
                              These stages are used when a{' '}
                              {(effectiveWorkUnitSeries.label || 'work unit').toLowerCase()} becomes active.
                            </p>
                            {(effectiveWorkUnitSeries.activeStages || []).length === 0 ? (
                              <div className="text-sm text-gray-500 italic">No stages configured</div>
                            ) : (
                              <div className="space-y-1">
                                {/* Column headers */}
                                <div className="grid grid-cols-[1fr_180px] gap-2 mb-2 px-1 text-xs font-medium text-gray-500 uppercase">
                                  <div>Stage Name</div>
                                  <div>Default Status</div>
                                </div>
                                {(effectiveWorkUnitSeries.activeStages || []).map((stage, idx) => (
                                  <div key={idx} className="grid grid-cols-[1fr_180px] gap-2 items-center">
                                    <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm text-gray-700">
                                      {stage.name || '(unnamed)'}
                                    </div>
                                    <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm text-gray-700">
                                      {(() => {
                                        const status = (company.statuses || []).find(
                                          (s) => s.id === stage.defaultStatus
                                        );
                                        return status?.label || stage.defaultStatus;
                                      })()}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* No backlog board with Work Unit Series found */
                        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                          <div className="text-4xl mb-3">ℹ️</div>
                          <h4 className="text-lg font-medium text-gray-900 mb-2">No Work Unit Series Configured</h4>
                          <p className="text-gray-600 mb-4 max-w-md mx-auto">
                            Work Units (like Sprints or Phases) are configured in a backlog board. No backlog board with
                            Work Units has been set up for this Work Centre yet.
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Owner board - show editable Work Unit Series Content */
                    <div className="flex-1 overflow-y-auto px-6 py-4">
                      {/* BUG-060-007 FIX: Check both existence AND enabled flag */}
                      {!workUnitSeries || workUnitSeries.enabled === false ? (
                        /* No Work Unit Series configured or disabled - show setup prompt */
                        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                          <div className="text-4xl mb-3">🏃</div>
                          <h4 className="text-lg font-medium text-gray-900 mb-2">
                            {workUnitSeries?.enabled === false ? 'Re-enable Work Units' : 'Enable Work Units'}
                          </h4>
                          <p className="text-gray-600 mb-4 max-w-md mx-auto">
                            {workUnitSeries?.enabled === false
                              ? `Your ${(workUnitSeries.labelPlural || 'Work Units').toLowerCase()} configuration has been preserved.`
                              : 'Group tickets into time-boxed iterations like Sprints, Phases, Months, or Campaigns.'}
                          </p>
                          {/* v062: Show info about what will happen */}
                          {!workUnitSeries?.enabled && workZones.length === 0 && (
                            <p className="text-sm text-amber-600 mb-4 max-w-md mx-auto">
                              ℹ️ This board has no zones. A Backlog zone will be created automatically.
                            </p>
                          )}
                          {!workUnitSeries?.enabled && workZones.length > 0 && (
                            <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto">
                              ℹ️ You'll need to select which zone to use for planning after enabling.
                            </p>
                          )}
                          <button
                            onClick={() => {
                              if (workUnitSeries?.enabled === false) {
                                // Re-enable existing series
                                // v065: Validate that stored backlogZoneId still exists AND is backlog type
                                let validatedBacklogZoneId = workUnitSeries.backlogZoneId;
                                if (validatedBacklogZoneId) {
                                  const zone = workZones.find((z) => z.id === validatedBacklogZoneId);
                                  if (!zone || zone.type !== 'backlog') {
                                    // Zone was deleted or changed type - clear the reference
                                    validatedBacklogZoneId = null;
                                  }
                                }
                                const enabledSeries = {
                                  ...workUnitSeries,
                                  enabled: true,
                                  backlogZoneId: validatedBacklogZoneId,
                                };
                                setWorkUnitSeries(enabledSeries);

                                // v066 BUG-062-013: Auto-save if backlogZoneId is still valid
                                if (validatedBacklogZoneId) {
                                  const updatedBoard = {
                                    ...board,
                                    workUnitSeries: enabledSeries,
                                  };
                                  onSave(updatedBoard);
                                }
                                // If no valid backlogZoneId, user must select one before saving
                              } else {
                                // Create default Work Unit Series
                                // v062 BUG-062-007: Find an existing zone to use, or create a backlog zone
                                let backlogZoneId = null;
                                let updatedZones = [...workZones];

                                // First, try to find a zone with type 'backlog'
                                const existingBacklogZone = workZones.find((z) => z.type === 'backlog');
                                if (existingBacklogZone) {
                                  backlogZoneId = existingBacklogZone.id;
                                } else if (workZones.length === 0) {
                                  // No zones at all - create a backlog zone
                                  const newZoneId = `zone-backlog-${Date.now()}`;
                                  const newBacklogZone = {
                                    id: newZoneId,
                                    name: 'Backlog',
                                    type: 'backlog',
                                    workStages: [
                                      { name: 'New', defaultStatus: 'new' },
                                      { name: 'Backlog', defaultStatus: 'backlog' },
                                    ],
                                  };
                                  updatedZones = [...workZones, newBacklogZone];
                                  setWorkZones(updatedZones);
                                  backlogZoneId = newZoneId;
                                }
                                // If zones exist but none are backlog type, user must select - leave backlogZoneId null

                                const newSeries = {
                                  id: `series-${Date.now()}`,
                                  enabled: true,
                                  label: 'Sprint',
                                  labelPlural: 'Sprints',
                                  patternType: 'sequential',
                                  allowOverlap: false,
                                  currentSequence: 1,
                                  backlogZoneId: backlogZoneId, // v062: User-nominated backlog zone
                                  activeStages: [
                                    { name: 'To Do', defaultStatus: 'todo' },
                                    { name: 'In Progress', defaultStatus: 'in-progress' },
                                    { name: 'Review', defaultStatus: 'review' },
                                    { name: 'Done', defaultStatus: 'completed' },
                                  ],
                                };
                                setWorkUnitSeries(newSeries);
                              }
                            }}
                            className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
                          >
                            {workUnitSeries?.enabled === false ? 'Re-enable' : 'Enable Work Units'}
                          </button>
                        </div>
                      ) : (
                        /* Work Unit Series is configured - show configuration UI */
                        <div className="space-y-6">
                          {/* v161: Labels Configuration - Compact single row */}
                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-3">Labels</h4>
                            <div className="flex items-end gap-3 flex-wrap">
                              {/* Singular Label */}
                              <div className="w-32">
                                <label className="block text-xs text-gray-600 mb-1">Singular</label>
                                <input
                                  type="text"
                                  value={workUnitSeries.label}
                                  onChange={(e) => setWorkUnitSeries({ ...workUnitSeries, label: e.target.value })}
                                  placeholder="Sprint"
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                />
                              </div>

                              {/* Plural Label */}
                              <div className="w-32">
                                <label className="block text-xs text-gray-600 mb-1">Plural</label>
                                <input
                                  type="text"
                                  value={workUnitSeries.labelPlural}
                                  onChange={(e) =>
                                    setWorkUnitSeries({ ...workUnitSeries, labelPlural: e.target.value })
                                  }
                                  placeholder="Sprints"
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                />
                              </div>

                              {/* Naming Pattern */}
                              <div className="w-48">
                                <label className="block text-xs text-gray-600 mb-1">Naming Pattern</label>
                                <select
                                  value={workUnitSeries.patternType || 'sequential'}
                                  onChange={(e) => {
                                    const newType = e.target.value;
                                    const currentYear = new Date().getFullYear();
                                    let newPatternStart;

                                    switch (newType) {
                                      case 'sequential':
                                        newPatternStart = 1;
                                        break;
                                      case 'months':
                                        newPatternStart = 'january';
                                        break;
                                      case 'quarters':
                                        newPatternStart = 'Q1';
                                        break;
                                      case 'years':
                                        newPatternStart = currentYear;
                                        break;
                                      default:
                                        newPatternStart = 1;
                                    }

                                    setWorkUnitSeries({
                                      ...workUnitSeries,
                                      patternType: newType,
                                      patternStart: newPatternStart,
                                      patternStartYear: currentYear,
                                      currentSequence: 1,
                                    });
                                  }}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                >
                                  <option value="sequential">Sequential (1, 2, 3...)</option>
                                  <option value="months">Months</option>
                                  <option value="quarters">Quarters</option>
                                  <option value="years">Years</option>
                                </select>
                              </div>

                              {/* Starting From - inline */}
                              <div>
                                <label className="block text-xs text-gray-600 mb-1">Starting From</label>
                                <div className="flex items-center gap-2">
                                  {/* Sequential: number input */}
                                  {(!workUnitSeries.patternType || workUnitSeries.patternType === 'sequential') && (
                                    <>
                                      <span className="text-sm text-gray-600">{workUnitSeries.label || 'Sprint'}</span>
                                      <input
                                        type="number"
                                        min="1"
                                        value={workUnitSeries.patternStart || 1}
                                        onChange={(e) =>
                                          setWorkUnitSeries({
                                            ...workUnitSeries,
                                            patternStart: parseInt(e.target.value) || 1,
                                            currentSequence: 1,
                                          })
                                        }
                                        className="w-16 px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                      />
                                    </>
                                  )}

                                  {/* Months: month dropdown + year input */}
                                  {workUnitSeries.patternType === 'months' && (
                                    <>
                                      <select
                                        value={workUnitSeries.patternStart || 'january'}
                                        onChange={(e) =>
                                          setWorkUnitSeries({
                                            ...workUnitSeries,
                                            patternStart: e.target.value,
                                            currentSequence: 1,
                                          })
                                        }
                                        className="px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                      >
                                        <option value="january">January</option>
                                        <option value="february">February</option>
                                        <option value="march">March</option>
                                        <option value="april">April</option>
                                        <option value="may">May</option>
                                        <option value="june">June</option>
                                        <option value="july">July</option>
                                        <option value="august">August</option>
                                        <option value="september">September</option>
                                        <option value="october">October</option>
                                        <option value="november">November</option>
                                        <option value="december">December</option>
                                      </select>
                                      <input
                                        type="number"
                                        min="2020"
                                        max="2099"
                                        value={workUnitSeries.patternStartYear || new Date().getFullYear()}
                                        onChange={(e) =>
                                          setWorkUnitSeries({
                                            ...workUnitSeries,
                                            patternStartYear: parseInt(e.target.value) || new Date().getFullYear(),
                                            currentSequence: 1,
                                          })
                                        }
                                        className="w-20 px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                      />
                                    </>
                                  )}

                                  {/* Quarters: Q dropdown + year input */}
                                  {workUnitSeries.patternType === 'quarters' && (
                                    <>
                                      <select
                                        value={workUnitSeries.patternStart || 'Q1'}
                                        onChange={(e) =>
                                          setWorkUnitSeries({
                                            ...workUnitSeries,
                                            patternStart: e.target.value,
                                            currentSequence: 1,
                                          })
                                        }
                                        className="px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                      >
                                        <option value="Q1">Q1</option>
                                        <option value="Q2">Q2</option>
                                        <option value="Q3">Q3</option>
                                        <option value="Q4">Q4</option>
                                      </select>
                                      <input
                                        type="number"
                                        min="2020"
                                        max="2099"
                                        value={workUnitSeries.patternStartYear || new Date().getFullYear()}
                                        onChange={(e) =>
                                          setWorkUnitSeries({
                                            ...workUnitSeries,
                                            patternStartYear: parseInt(e.target.value) || new Date().getFullYear(),
                                            currentSequence: 1,
                                          })
                                        }
                                        className="w-20 px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                      />
                                    </>
                                  )}

                                  {/* Years: year input only */}
                                  {workUnitSeries.patternType === 'years' && (
                                    <input
                                      type="number"
                                      min="2020"
                                      max="2099"
                                      value={workUnitSeries.patternStart || new Date().getFullYear()}
                                      onChange={(e) =>
                                        setWorkUnitSeries({
                                          ...workUnitSeries,
                                          patternStart: parseInt(e.target.value) || new Date().getFullYear(),
                                          currentSequence: 1,
                                        })
                                      }
                                      className="w-20 px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">e.g., Sprint, Phase, Month, Campaign</p>
                          </div>

                          {/* BUG-060-005 FIX: Rename "Active Stages" to "Work Unit Stages" */}
                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-4">
                              <div>
                                <h4 className="font-medium text-gray-900">Work Unit Stages</h4>
                                <p className="text-xs text-gray-500 mt-1">
                                  These stages will be used when a {(workUnitSeries.label || 'work unit').toLowerCase()}{' '}
                                  becomes active
                                </p>
                              </div>
                              <button
                                onClick={() => {
                                  const newStage = { name: '', defaultStatus: 'in-progress' };
                                  setWorkUnitSeries({
                                    ...workUnitSeries,
                                    activeStages: [...(workUnitSeries.activeStages || []), newStage],
                                  });
                                }}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100 transition"
                              >
                                <Plus size={14} />
                                Add Stage
                              </button>
                            </div>

                            {(workUnitSeries.activeStages || []).length === 0 ? (
                              <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                                <p className="text-gray-500">No stages configured</p>
                                <p className="text-sm text-gray-400 mt-1">
                                  Add stages that will be used when{' '}
                                  {(workUnitSeries.labelPlural || 'work units').toLowerCase()} are active
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {/* Column headers like WorkZoneModal */}
                                <div className="grid grid-cols-[1fr_180px_100px] gap-2 mb-2 px-1 text-xs font-medium text-gray-500 uppercase">
                                  <div>Stage Name</div>
                                  <div>Default Status</div>
                                  <div className="text-right">Actions</div>
                                </div>
                                {(workUnitSeries.activeStages || []).map((stage, idx) => (
                                  <div
                                    key={idx}
                                    className="grid grid-cols-[1fr_180px_100px] gap-2 items-center min-w-0"
                                  >
                                    {/* Stage Name - v066 BUG-062-015: Add min-w-0 for proper truncation */}
                                    <input
                                      type="text"
                                      value={stage.name}
                                      onChange={(e) => {
                                        const newStages = [...workUnitSeries.activeStages];
                                        const newName = e.target.value;
                                        // BUG-060-011 FIX: Re-infer status when stage name changes
                                        const inferredStatus = inferStatusFromStageName(newName);
                                        newStages[idx] = { ...stage, name: newName, defaultStatus: inferredStatus };
                                        setWorkUnitSeries({ ...workUnitSeries, activeStages: newStages });
                                      }}
                                      onBlur={(e) => {
                                        // v154: Check for ambiguous keywords
                                        const stageName = e.target.value.trim();
                                        if (!stageName) return;
                                        const ambiguousInfo = getAmbiguousKeywordWarning
                                          ? getAmbiguousKeywordWarning(stageName)
                                          : null;
                                        if (ambiguousInfo) {
                                          setAmbiguousWarningConfig({
                                            ...ambiguousInfo,
                                            onConfirm: (chosenName) => {
                                              const newStages = [...workUnitSeries.activeStages];
                                              const inferredStatus = inferStatusFromStageName(chosenName);
                                              newStages[idx] = {
                                                ...newStages[idx],
                                                name: chosenName,
                                                defaultStatus: inferredStatus,
                                              };
                                              setWorkUnitSeries({ ...workUnitSeries, activeStages: newStages });
                                              setShowAmbiguousWarning(false);
                                              setAmbiguousWarningConfig(null);
                                            },
                                            onCancel: () => {
                                              setShowAmbiguousWarning(false);
                                              setAmbiguousWarningConfig(null);
                                            },
                                          });
                                          setShowAmbiguousWarning(true);
                                        }
                                      }}
                                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 min-w-0 truncate"
                                      placeholder="Stage name"
                                    />

                                    {/* Default Status - BUG-060-004 FIX: Use grouped optgroups like WorkZoneModal */}
                                    {/* v145: Updated to 6-type model */}
                                    <select
                                      value={stage.defaultStatus}
                                      onChange={(e) => {
                                        const newStages = [...workUnitSeries.activeStages];
                                        newStages[idx] = { ...stage, defaultStatus: e.target.value };
                                        setWorkUnitSeries({ ...workUnitSeries, activeStages: newStages });
                                      }}
                                      className="px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                    >
                                      <optgroup label="Backlog">
                                        {(company.statuses || [])
                                          .filter((s) => s.type === 'backlog')
                                          .map((s) => (
                                            <option key={s.id} value={s.id}>
                                              {s.label}
                                            </option>
                                          ))}
                                      </optgroup>
                                      <optgroup label="Scoped">
                                        {(company.statuses || [])
                                          .filter((s) => s.type === 'scoped')
                                          .map((s) => (
                                            <option key={s.id} value={s.id}>
                                              {s.label}
                                            </option>
                                          ))}
                                      </optgroup>
                                      <optgroup label="Queued">
                                        {(company.statuses || [])
                                          .filter((s) => s.type === 'queued')
                                          .map((s) => (
                                            <option key={s.id} value={s.id}>
                                              {s.label}
                                            </option>
                                          ))}
                                      </optgroup>
                                      <optgroup label="Active">
                                        {(company.statuses || [])
                                          .filter((s) => s.type === 'active')
                                          .map((s) => (
                                            <option key={s.id} value={s.id}>
                                              {s.label}
                                            </option>
                                          ))}
                                      </optgroup>
                                      <optgroup label="Completed">
                                        {(company.statuses || [])
                                          .filter((s) => s.type === 'completed')
                                          .map((s) => (
                                            <option key={s.id} value={s.id}>
                                              {s.label}
                                            </option>
                                          ))}
                                      </optgroup>
                                      <optgroup label="Ended">
                                        {(company.statuses || [])
                                          .filter((s) => s.type === 'ended')
                                          .map((s) => (
                                            <option key={s.id} value={s.id}>
                                              {s.label}
                                            </option>
                                          ))}
                                      </optgroup>
                                    </select>

                                    {/* BUG-060-006 FIX: Actions on right - match WorkZoneModal style */}
                                    <div className="flex items-center justify-end gap-1">
                                      <button
                                        onClick={() => {
                                          if (idx === 0) return;
                                          const newStages = [...workUnitSeries.activeStages];
                                          [newStages[idx - 1], newStages[idx]] = [newStages[idx], newStages[idx - 1]];
                                          setWorkUnitSeries({ ...workUnitSeries, activeStages: newStages });
                                        }}
                                        disabled={idx === 0}
                                        className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                        title="Move up"
                                      >
                                        ↑
                                      </button>
                                      <button
                                        onClick={() => {
                                          if (idx === workUnitSeries.activeStages.length - 1) return;
                                          const newStages = [...workUnitSeries.activeStages];
                                          [newStages[idx], newStages[idx + 1]] = [newStages[idx + 1], newStages[idx]];
                                          setWorkUnitSeries({ ...workUnitSeries, activeStages: newStages });
                                        }}
                                        disabled={idx === workUnitSeries.activeStages.length - 1}
                                        className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                        title="Move down"
                                      >
                                        ↓
                                      </button>
                                      <button
                                        onClick={() => {
                                          // BUG-060-008: Prevent deleting last stage
                                          if (workUnitSeries.activeStages.length <= 1) return;
                                          const newStages = workUnitSeries.activeStages.filter((_, i) => i !== idx);
                                          setWorkUnitSeries({ ...workUnitSeries, activeStages: newStages });
                                        }}
                                        disabled={workUnitSeries.activeStages.length <= 1}
                                        className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                        title="Delete"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* v067 ENH-002: Default Location display with warning and quick-set */}
                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-2">Default Ticket Location</h4>
                            <p className="text-sm text-gray-600 mb-3">
                              New tickets will be created in this location. For{' '}
                              {(workUnitSeries.labelPlural || 'work units').toLowerCase()} planning, this should match
                              your backlog zone.
                            </p>

                            {/* Current default location (read-only display) */}
                            <div className="flex items-center gap-2 text-sm mb-3">
                              <span className="text-gray-600">Current:</span>
                              <span className="font-medium text-gray-900">
                                {workZones.find((z) => z.id === defaultZone)?.name || 'Not set'} →{' '}
                                {defaultStage || 'Not set'}
                              </span>
                            </div>

                            {/* Warning if default zone doesn't match backlog zone */}
                            {(() => {
                              const backlogZoneId = workUnitSeries.backlogZoneId;
                              const backlogZone = backlogZoneId ? workZones.find((z) => z.id === backlogZoneId) : null;

                              if (backlogZoneId && defaultZone !== backlogZoneId) {
                                return (
                                  <div className="space-y-2">
                                    <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded">
                                      <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                                      <span>
                                        Default location doesn't match backlog zone "{backlogZone?.name}". New tickets
                                        won't appear in your planning zone.
                                      </span>
                                    </div>
                                    <button
                                      onClick={() => {
                                        // Quick-set: change default to backlog zone's first stage
                                        if (backlogZone && backlogZone.workStages?.length > 0) {
                                          setDefaultZone(backlogZoneId);
                                          setDefaultStage(getStageName(backlogZone.workStages[0]));
                                        }
                                      }}
                                      className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                                    >
                                      Set default to "{backlogZone?.name} →{' '}
                                      {backlogZone?.workStages?.[0]
                                        ? getStageName(backlogZone.workStages[0])
                                        : 'first stage'}
                                      " (recommended)
                                    </button>
                                  </div>
                                );
                              } else if (backlogZoneId && defaultZone === backlogZoneId) {
                                return (
                                  <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 px-3 py-2 rounded">
                                    <Check size={16} />
                                    <span>Default location matches backlog zone</span>
                                  </div>
                                );
                              }
                              return null;
                            })()}

                            <p className="text-xs text-gray-500 mt-3">
                              To change the default location, go to the Work Zones tab.
                            </p>
                          </div>

                          {/* v062 BUG-062-007: Backlog Zone Selection - User nominates which zone to use */}
                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-2">Backlog Zone</h4>
                            <p className="text-sm text-gray-600 mb-3">
                              Select which zone will contain planning stages for new{' '}
                              {(workUnitSeries.labelPlural || 'work units').toLowerCase()}.
                            </p>

                            {/* v065: Only show backlog-type zones */}
                            {(() => {
                              const backlogZones = workZones.filter((z) => z.type === 'backlog');

                              if (workZones.length === 0) {
                                // No zones exist at all
                                return (
                                  <div className="flex items-center justify-between bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                    <div className="flex items-center gap-2 text-sm text-yellow-800">
                                      <AlertCircle size={16} />
                                      <span>No zones exist on this board. Create a backlog zone below.</span>
                                    </div>
                                  </div>
                                );
                              } else if (backlogZones.length === 0) {
                                // Zones exist but none are backlog type
                                return (
                                  <div className="flex items-center justify-between bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                    <div className="flex items-center gap-2 text-sm text-yellow-800">
                                      <AlertCircle size={16} />
                                      <span>
                                        No backlog-type zones found. Create one below to use{' '}
                                        {(workUnitSeries.labelPlural || 'work units').toLowerCase()}.
                                      </span>
                                    </div>
                                  </div>
                                );
                              } else {
                                // Has backlog zones - show dropdown
                                return (
                                  <div className="space-y-3">
                                    {/* Zone Selection Dropdown - only backlog zones */}
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-1">Select Backlog Zone *</label>
                                      <select
                                        value={workUnitSeries.backlogZoneId || ''}
                                        onChange={(e) =>
                                          setWorkUnitSeries({ ...workUnitSeries, backlogZoneId: e.target.value })
                                        }
                                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm ${
                                          !workUnitSeries.backlogZoneId
                                            ? 'border-yellow-400 bg-yellow-50'
                                            : 'border-gray-300'
                                        }`}
                                      >
                                        <option value="">-- Select a backlog zone --</option>
                                        {backlogZones.map((zone) => (
                                          <option key={zone.id} value={zone.id}>
                                            {zone.name}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    {/* Status message - v063 fix: Check if selected zone actually exists */}
                                    {(() => {
                                      const selectedZone = workUnitSeries.backlogZoneId
                                        ? backlogZones.find((z) => z.id === workUnitSeries.backlogZoneId)
                                        : null;

                                      if (workUnitSeries.backlogZoneId && selectedZone) {
                                        // Valid zone selected
                                        return (
                                          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 px-3 py-2 rounded">
                                            <Check size={16} />
                                            <span>
                                              Using zone "{selectedZone.name}" for{' '}
                                              {(workUnitSeries.label || 'work unit').toLowerCase()} planning
                                            </span>
                                          </div>
                                        );
                                      } else if (workUnitSeries.backlogZoneId && !selectedZone) {
                                        // Zone was selected but has been deleted or changed type - show warning
                                        return (
                                          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 px-3 py-2 rounded">
                                            <AlertCircle size={16} />
                                            <span>
                                              Selected zone no longer exists or is not a backlog zone. Please select a
                                              different zone.
                                            </span>
                                          </div>
                                        );
                                      } else {
                                        // No zone selected
                                        return (
                                          <div className="flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 px-3 py-2 rounded">
                                            <AlertCircle size={16} />
                                            <span>
                                              You must select a backlog zone to use{' '}
                                              {(workUnitSeries.labelPlural || 'work units').toLowerCase()}
                                            </span>
                                          </div>
                                        );
                                      }
                                    })()}
                                  </div>
                                );
                              }
                            })()}

                            {/* Create new backlog zone option - v065: Always show if no valid backlog zone selected */}
                            {(() => {
                              const backlogZones = workZones.filter((z) => z.type === 'backlog');
                              const hasValidBacklogSelected =
                                workUnitSeries.backlogZoneId &&
                                backlogZones.find((z) => z.id === workUnitSeries.backlogZoneId);

                              if (hasValidBacklogSelected) return null;

                              return (
                                <div className="pt-3 mt-3 border-t border-gray-100">
                                  <button
                                    onClick={() => {
                                      setConfirmationConfig({
                                        title: 'Create Backlog Zone?',
                                        message:
                                          'This will create a zone named "Backlog" with stages: New, Backlog. The zone will be saved immediately and selected as your backlog zone.',
                                        confirmText: 'Create',
                                        type: 'info',
                                        onConfirm: () => {
                                          const newZoneId = `zone-backlog-${Date.now()}`;
                                          const newBacklogZone = {
                                            id: newZoneId,
                                            name: 'Backlog',
                                            type: 'backlog',
                                            workStages: [
                                              { name: 'New', defaultStatus: 'new' },
                                              { name: 'Backlog', defaultStatus: 'backlog' },
                                            ],
                                          };
                                          const updatedZones = [...workZones, newBacklogZone];
                                          setWorkZones(updatedZones);

                                          // Auto-select the new zone
                                          const updatedSeries = { ...workUnitSeries, backlogZoneId: newZoneId };
                                          setWorkUnitSeries(updatedSeries);

                                          // Auto-save to parent immediately
                                          const updatedBoard = {
                                            ...board,
                                            workZones: updatedZones,
                                            workUnitSeries: updatedSeries,
                                          };
                                          onSave(updatedBoard);
                                        },
                                      });
                                      setShowConfirmation(true);
                                    }}
                                    className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                                  >
                                    <Plus size={14} />
                                    Create a new Backlog zone
                                  </button>
                                </div>
                              );
                            })()}
                          </div>

                          {/* BUG-060-002 FIX: Rename Settings to Concurrency with clearer text */}
                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-4">Concurrency</h4>
                            <label className="flex items-center gap-3 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={workUnitSeries.allowOverlap}
                                onChange={(e) =>
                                  setWorkUnitSeries({ ...workUnitSeries, allowOverlap: e.target.checked })
                                }
                                className="rounded"
                              />
                              <div>
                                <span className="text-sm text-gray-700">Allow multiple active Work Units at once</span>
                                <p className="text-xs text-gray-500 mt-0.5">
                                  Enable for overlapping work (e.g., multiple phases running concurrently)
                                </p>
                              </div>
                            </label>
                          </div>

                          {/* BUG-060-007 FIX: Disable Work Units - uses enabled flag, preserves settings, auto-saves */}
                          <div className="border-t border-gray-200 pt-4">
                            <button
                              onClick={() => {
                                setConfirmationConfig({
                                  title: `Disable ${workUnitSeries.labelPlural || 'Work Units'}?`,
                                  message: `This will hide ${(workUnitSeries.labelPlural || 'work units').toLowerCase()} features for this board. Your configuration will be preserved and can be re-enabled later.`,
                                  confirmText: 'Disable',
                                  type: 'warning',
                                  onConfirm: () => {
                                    // BUG-060-007 FIX: Set enabled:false instead of deleting, and auto-save
                                    const disabledSeries = { ...workUnitSeries, enabled: false };
                                    setWorkUnitSeries(disabledSeries);
                                    // Auto-save immediately
                                    const updatedBoard = {
                                      ...board,
                                      workUnitSeries: disabledSeries,
                                    };
                                    onSave(updatedBoard);
                                  },
                                });
                                setShowConfirmation(true);
                              }}
                              className="text-sm text-red-600 hover:text-red-700"
                            >
                              Disable {workUnitSeries.labelPlural || 'Work Units'} for this board
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* v170: CRM Mirror Tab */}
            {activeTab === 'crm' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">CRM Mirror</h3>
                  <p className="text-sm text-gray-600 mb-6">
                    Display filtered customers from Global CRM on this board. Customers can be grouped by lifecycle
                    stage, territory, or account owner.
                  </p>

                  {/* Enable toggle */}
                  <div className="bg-gray-50 rounded-lg p-4 mb-6">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={crmMirror?.enabled || false}
                        onChange={(e) => {
                          if (e.target.checked) {
                            // Enable with defaults
                            setCrmMirror({
                              enabled: true,
                              filter: { conditions: [] },
                              groupBy: 'stage',
                              sortBy: 'companyName',
                              sortOrder: 'asc',
                              watchedCustomers: [],
                            });
                          } else {
                            // Disable
                            setCrmMirror({ ...crmMirror, enabled: false });
                          }
                        }}
                        className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <span className="font-medium text-gray-900">Show CRM Mirror</span>
                        <p className="text-sm text-gray-500">Display a CRM tab on this board with filtered customers</p>
                      </div>
                    </label>
                  </div>

                  {/* CRM Mirror Configuration - only shown when enabled */}
                  {crmMirror?.enabled && (
                    <div className="space-y-6">
                      {/* Filter Section */}
                      <div className="border border-gray-200 rounded-lg p-4">
                        <h4 className="font-medium text-gray-800 mb-4">Filter Customers</h4>

                        {/* Stage filter */}
                        <div className="mb-4">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Show Stages</label>
                          <p className="text-xs text-gray-500 mb-2">Leave empty to show all stages</p>
                          <div className="flex flex-wrap gap-2">
                            {(company.crmConfig?.lifecycleStages || []).map((stage) => {
                              const isSelected = (
                                crmMirror.filter?.conditions?.find((c) => c.field === 'stage')?.value || []
                              ).includes(stage.id);
                              return (
                                <button
                                  key={stage.id}
                                  type="button"
                                  onClick={() => {
                                    const currentStageFilter = crmMirror.filter?.conditions?.find(
                                      (c) => c.field === 'stage'
                                    );
                                    const currentValues = currentStageFilter?.value || [];
                                    let newValues;
                                    if (isSelected) {
                                      newValues = currentValues.filter((v) => v !== stage.id);
                                    } else {
                                      newValues = [...currentValues, stage.id];
                                    }

                                    // Update filter conditions
                                    const otherConditions = (crmMirror.filter?.conditions || []).filter(
                                      (c) => c.field !== 'stage'
                                    );
                                    const newConditions =
                                      newValues.length > 0
                                        ? [...otherConditions, { field: 'stage', operator: 'in', value: newValues }]
                                        : otherConditions;

                                    setCrmMirror({
                                      ...crmMirror,
                                      filter: { conditions: newConditions },
                                    });
                                  }}
                                  className={`px-3 py-1.5 rounded-full text-sm transition ${
                                    isSelected
                                      ? 'bg-indigo-600 text-white'
                                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                  }`}
                                >
                                  {stage.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Territory filter */}
                        {(() => {
                          const territories = [
                            ...new Set((company.globalCRM || []).map((c) => c.territory).filter(Boolean)),
                          ];
                          if (territories.length === 0) return null;

                          return (
                            <div className="mb-4">
                              <label className="block text-sm font-medium text-gray-700 mb-2">Show Territories</label>
                              <p className="text-xs text-gray-500 mb-2">Leave empty to show all territories</p>
                              <div className="flex flex-wrap gap-2">
                                {territories.map((territory) => {
                                  const isSelected = (
                                    crmMirror.filter?.conditions?.find((c) => c.field === 'territory')?.value || []
                                  ).includes(territory);
                                  return (
                                    <button
                                      key={territory}
                                      type="button"
                                      onClick={() => {
                                        const currentFilter = crmMirror.filter?.conditions?.find(
                                          (c) => c.field === 'territory'
                                        );
                                        const currentValues = currentFilter?.value || [];
                                        let newValues;
                                        if (isSelected) {
                                          newValues = currentValues.filter((v) => v !== territory);
                                        } else {
                                          newValues = [...currentValues, territory];
                                        }

                                        const otherConditions = (crmMirror.filter?.conditions || []).filter(
                                          (c) => c.field !== 'territory'
                                        );
                                        const newConditions =
                                          newValues.length > 0
                                            ? [
                                                ...otherConditions,
                                                { field: 'territory', operator: 'in', value: newValues },
                                              ]
                                            : otherConditions;

                                        setCrmMirror({
                                          ...crmMirror,
                                          filter: { conditions: newConditions },
                                        });
                                      }}
                                      className={`px-3 py-1.5 rounded-full text-sm transition ${
                                        isSelected
                                          ? 'bg-indigo-600 text-white'
                                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                      }`}
                                    >
                                      {territory}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Account Owner filter */}
                        {(company.globalStaff || []).length > 0 && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Show Account Owners</label>
                            <p className="text-xs text-gray-500 mb-2">Leave empty to show all owners</p>
                            <div className="flex flex-wrap gap-2">
                              {(company.globalStaff || []).map((staff) => {
                                const isSelected = (
                                  crmMirror.filter?.conditions?.find((c) => c.field === 'accountOwnerId')?.value || []
                                ).includes(staff.id);
                                return (
                                  <button
                                    key={staff.id}
                                    type="button"
                                    onClick={() => {
                                      const currentFilter = crmMirror.filter?.conditions?.find(
                                        (c) => c.field === 'accountOwnerId'
                                      );
                                      const currentValues = currentFilter?.value || [];
                                      let newValues;
                                      if (isSelected) {
                                        newValues = currentValues.filter((v) => v !== staff.id);
                                      } else {
                                        newValues = [...currentValues, staff.id];
                                      }

                                      const otherConditions = (crmMirror.filter?.conditions || []).filter(
                                        (c) => c.field !== 'accountOwnerId'
                                      );
                                      const newConditions =
                                        newValues.length > 0
                                          ? [
                                              ...otherConditions,
                                              { field: 'accountOwnerId', operator: 'in', value: newValues },
                                            ]
                                          : otherConditions;

                                      setCrmMirror({
                                        ...crmMirror,
                                        filter: { conditions: newConditions },
                                      });
                                    }}
                                    className={`px-3 py-1.5 rounded-full text-sm transition ${
                                      isSelected
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                  >
                                    {staff.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Display Options */}
                      <div className="border border-gray-200 rounded-lg p-4">
                        <h4 className="font-medium text-gray-800 mb-4">Display Options</h4>

                        <div className="grid grid-cols-3 gap-4">
                          {/* Group By */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Group By</label>
                            <select
                              value={crmMirror.groupBy || 'stage'}
                              onChange={(e) => setCrmMirror({ ...crmMirror, groupBy: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            >
                              <option value="stage">Lifecycle Stage</option>
                              <option value="territory">Territory</option>
                              <option value="accountOwnerId">Account Owner</option>
                            </select>
                          </div>

                          {/* Sort By */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
                            <select
                              value={crmMirror.sortBy || 'companyName'}
                              onChange={(e) => setCrmMirror({ ...crmMirror, sortBy: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            >
                              <option value="companyName">Company Name</option>
                              <option value="updatedAt">Last Updated</option>
                              <option value="createdAt">Date Created</option>
                              <option value="contractValue">Contract Value</option>
                            </select>
                          </div>

                          {/* Sort Order */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Sort Order</label>
                            <select
                              value={crmMirror.sortOrder || 'asc'}
                              onChange={(e) => setCrmMirror({ ...crmMirror, sortOrder: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            >
                              <option value="asc">Ascending (A-Z)</option>
                              <option value="desc">Descending (Z-A)</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Preview info */}
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <div className="flex gap-3">
                          <span className="text-blue-600">ℹ️</span>
                          <div className="text-sm text-blue-800">
                            <p className="font-medium mb-1">CRM Mirror Behaviour</p>
                            <ul className="list-disc list-inside text-blue-700 space-y-1">
                              <li>Customers appear as a "CRM" tab on the board</li>
                              <li>
                                Drag customers between columns to change their{' '}
                                {crmMirror.groupBy === 'stage'
                                  ? 'lifecycle stage'
                                  : crmMirror.groupBy === 'territory'
                                    ? 'territory'
                                    : 'account owner'}
                              </li>
                              <li>Click a customer card to view full details</li>
                              <li>Changes affect the global customer record</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* v184b: Supplier Mirror Tab */}
            {activeTab === 'suppliers' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Supplier Mirror</h3>
                  <p className="text-sm text-gray-600 mb-6">
                    Display filtered suppliers from Global Suppliers on this board. Suppliers can be grouped by
                    lifecycle stage, territory, or relationship owner.
                  </p>

                  {/* Enable toggle */}
                  <div className="bg-gray-50 rounded-lg p-4 mb-6">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={supplierMirror?.enabled || false}
                        onChange={(e) => {
                          if (e.target.checked) {
                            // Enable with defaults
                            setSupplierMirror({
                              enabled: true,
                              filter: { conditions: [] },
                              groupBy: 'stage',
                              sortBy: 'companyName',
                              sortOrder: 'asc',
                            });
                          } else {
                            // Disable
                            setSupplierMirror({ ...supplierMirror, enabled: false });
                          }
                        }}
                        className="w-5 h-5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                      />
                      <div>
                        <span className="font-medium text-gray-900">Show Supplier Mirror</span>
                        <p className="text-sm text-gray-500">
                          Display a Suppliers tab on this board with filtered suppliers
                        </p>
                      </div>
                    </label>
                  </div>

                  {/* Supplier Mirror Configuration - only shown when enabled */}
                  {supplierMirror?.enabled && (
                    <div className="space-y-6">
                      {/* Filter Section */}
                      <div className="border border-teal-200 rounded-lg p-4 bg-teal-50/30">
                        <h4 className="font-medium text-gray-800 mb-4">Filter Suppliers</h4>

                        {/* Stage filter */}
                        <div className="mb-4">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Show Stages</label>
                          <p className="text-xs text-gray-500 mb-2">Leave empty to show all stages</p>
                          <div className="flex flex-wrap gap-2">
                            {(company.supplierConfig?.lifecycleStages || []).map((stage) => {
                              const isSelected = (
                                supplierMirror.filter?.conditions?.find((c) => c.field === 'stage')?.value || []
                              ).includes(stage.id);
                              return (
                                <button
                                  key={stage.id}
                                  type="button"
                                  onClick={() => {
                                    const currentStageFilter = supplierMirror.filter?.conditions?.find(
                                      (c) => c.field === 'stage'
                                    );
                                    const currentValues = currentStageFilter?.value || [];
                                    let newValues;
                                    if (isSelected) {
                                      newValues = currentValues.filter((v) => v !== stage.id);
                                    } else {
                                      newValues = [...currentValues, stage.id];
                                    }

                                    // Update filter conditions
                                    const otherConditions = (supplierMirror.filter?.conditions || []).filter(
                                      (c) => c.field !== 'stage'
                                    );
                                    const newConditions =
                                      newValues.length > 0
                                        ? [...otherConditions, { field: 'stage', operator: 'in', value: newValues }]
                                        : otherConditions;

                                    setSupplierMirror({
                                      ...supplierMirror,
                                      filter: { conditions: newConditions },
                                    });
                                  }}
                                  className={`px-3 py-1.5 rounded-full text-sm transition ${
                                    isSelected
                                      ? 'bg-teal-600 text-white'
                                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                  }`}
                                >
                                  {stage.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Territory filter */}
                        {(() => {
                          const territories = [
                            ...new Set((company.globalSuppliers || []).map((s) => s.territory).filter(Boolean)),
                          ];
                          if (territories.length === 0) return null;

                          return (
                            <div className="mb-4">
                              <label className="block text-sm font-medium text-gray-700 mb-2">Show Territories</label>
                              <p className="text-xs text-gray-500 mb-2">Leave empty to show all territories</p>
                              <div className="flex flex-wrap gap-2">
                                {territories.map((territory) => {
                                  const isSelected = (
                                    supplierMirror.filter?.conditions?.find((c) => c.field === 'territory')?.value || []
                                  ).includes(territory);
                                  return (
                                    <button
                                      key={territory}
                                      type="button"
                                      onClick={() => {
                                        const currentFilter = supplierMirror.filter?.conditions?.find(
                                          (c) => c.field === 'territory'
                                        );
                                        const currentValues = currentFilter?.value || [];
                                        let newValues;
                                        if (isSelected) {
                                          newValues = currentValues.filter((v) => v !== territory);
                                        } else {
                                          newValues = [...currentValues, territory];
                                        }

                                        const otherConditions = (supplierMirror.filter?.conditions || []).filter(
                                          (c) => c.field !== 'territory'
                                        );
                                        const newConditions =
                                          newValues.length > 0
                                            ? [
                                                ...otherConditions,
                                                { field: 'territory', operator: 'in', value: newValues },
                                              ]
                                            : otherConditions;

                                        setSupplierMirror({
                                          ...supplierMirror,
                                          filter: { conditions: newConditions },
                                        });
                                      }}
                                      className={`px-3 py-1.5 rounded-full text-sm transition ${
                                        isSelected
                                          ? 'bg-teal-600 text-white'
                                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                      }`}
                                    >
                                      {territory}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Relationship Owner filter */}
                        {(company.globalStaff || []).length > 0 && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Show Relationship Owners
                            </label>
                            <p className="text-xs text-gray-500 mb-2">Leave empty to show all owners</p>
                            <div className="flex flex-wrap gap-2">
                              {(company.globalStaff || []).map((staff) => {
                                const isSelected = (
                                  supplierMirror.filter?.conditions?.find((c) => c.field === 'accountOwnerId')?.value ||
                                  []
                                ).includes(staff.id);
                                return (
                                  <button
                                    key={staff.id}
                                    type="button"
                                    onClick={() => {
                                      const currentFilter = supplierMirror.filter?.conditions?.find(
                                        (c) => c.field === 'accountOwnerId'
                                      );
                                      const currentValues = currentFilter?.value || [];
                                      let newValues;
                                      if (isSelected) {
                                        newValues = currentValues.filter((v) => v !== staff.id);
                                      } else {
                                        newValues = [...currentValues, staff.id];
                                      }

                                      const otherConditions = (supplierMirror.filter?.conditions || []).filter(
                                        (c) => c.field !== 'accountOwnerId'
                                      );
                                      const newConditions =
                                        newValues.length > 0
                                          ? [
                                              ...otherConditions,
                                              { field: 'accountOwnerId', operator: 'in', value: newValues },
                                            ]
                                          : otherConditions;

                                      setSupplierMirror({
                                        ...supplierMirror,
                                        filter: { conditions: newConditions },
                                      });
                                    }}
                                    className={`px-3 py-1.5 rounded-full text-sm transition ${
                                      isSelected
                                        ? 'bg-teal-600 text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                  >
                                    {staff.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Display Options */}
                      <div className="border border-teal-200 rounded-lg p-4 bg-teal-50/30">
                        <h4 className="font-medium text-gray-800 mb-4">Display Options</h4>

                        <div className="grid grid-cols-3 gap-4">
                          {/* Group By */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Group By</label>
                            <select
                              value={supplierMirror.groupBy || 'stage'}
                              onChange={(e) => setSupplierMirror({ ...supplierMirror, groupBy: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                            >
                              <option value="stage">Lifecycle Stage</option>
                              <option value="territory">Territory</option>
                              <option value="accountOwnerId">Relationship Owner</option>
                            </select>
                          </div>

                          {/* Sort By */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
                            <select
                              value={supplierMirror.sortBy || 'companyName'}
                              onChange={(e) => setSupplierMirror({ ...supplierMirror, sortBy: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                            >
                              <option value="companyName">Company Name</option>
                              <option value="updatedAt">Last Updated</option>
                              <option value="createdAt">Date Created</option>
                              <option value="annualSpend">Annual Spend</option>
                            </select>
                          </div>

                          {/* Sort Order */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Sort Order</label>
                            <select
                              value={supplierMirror.sortOrder || 'asc'}
                              onChange={(e) => setSupplierMirror({ ...supplierMirror, sortOrder: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                            >
                              <option value="asc">Ascending (A-Z)</option>
                              <option value="desc">Descending (Z-A)</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Preview info */}
                      <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                        <div className="flex gap-3">
                          <span className="text-teal-600">ℹ️</span>
                          <div className="text-sm text-teal-800">
                            <p className="font-medium mb-1">Supplier Mirror Behaviour</p>
                            <ul className="list-disc list-inside text-teal-700 space-y-1">
                              <li>Suppliers appear as a "Suppliers" tab on the board</li>
                              <li>
                                Drag suppliers between columns to change their{' '}
                                {supplierMirror.groupBy === 'stage'
                                  ? 'lifecycle stage'
                                  : supplierMirror.groupBy === 'territory'
                                    ? 'territory'
                                    : 'relationship owner'}
                              </li>
                              <li>Click a supplier card to view full details</li>
                              <li>Changes affect the global supplier record</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Actions - Only show on tabs with direct edits */}
          {/* v154a: Don't show footer on Work Units tab for non-owner boards (read-only) */}
          {/* v170: Added 'crm' tab */}
          {/* v184b: Added 'suppliers' tab */}
          {(activeTab === 'general' ||
            activeTab === 'access' ||
            activeTab === 'crm' ||
            activeTab === 'suppliers' ||
            (activeTab === 'workunits' && isWorkUnitSeriesOwner)) && (
            <div className="p-6 border-t border-gray-200 flex gap-3">
              <button
                onClick={handleSave}
                disabled={!hasChanges}
                className={`flex-1 px-4 py-2 rounded-lg transition ${
                  hasChanges
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {hasChanges ? 'Save Changes' : 'No Changes'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                {hasChanges ? 'Cancel' : 'Close'}
              </button>
            </div>
          )}

          {/* v067: Zones tab now needs Save/Cancel for Default Location changes */}
          {activeTab === 'zones' && (
            <div className="p-6 border-t border-gray-200 flex gap-3">
              <button
                onClick={handleSave}
                disabled={!hasChanges}
                className={`flex-1 py-2 rounded-lg transition ${
                  hasChanges
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                {hasChanges ? 'Save Changes' : 'No Changes'}
              </button>
              <button
                onClick={
                  hasChanges
                    ? () => {
                        // Reset default zone/stage to board values
                        setDefaultZone(board.defaultZone);
                        setDefaultStage(board.defaultStage);
                      }
                    : onClose
                }
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                {hasChanges ? 'Cancel' : 'Close'}
              </button>
            </div>
          )}

          {/* v155: Stages tab footer for simple boards */}
          {activeTab === 'stages' && isSimpleBoard && (
            <div className="p-6 border-t border-gray-200 flex gap-3">
              <button
                onClick={handleSave}
                disabled={!hasChanges}
                className={`flex-1 py-2 rounded-lg transition ${
                  hasChanges
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                {hasChanges ? 'Save Changes' : 'No Changes'}
              </button>
              <button
                onClick={
                  hasChanges
                    ? () => {
                        // Reset to board values
                        setWorkZones([...board.workZones]);
                        setDefaultStage(board.defaultStage);
                      }
                    : onClose
                }
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                {hasChanges ? 'Cancel' : 'Close'}
              </button>
            </div>
          )}

          {/* Close button for fields tab (no direct edits) */}
          {activeTab === 'fields' && (
            <div className="p-6 border-t border-gray-200 flex justify-end">
              <button
                onClick={onClose}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                Close
              </button>
            </div>
          )}
        </div>

        {/* Work Zone Modal */}
        {showZoneModal && (
          <WorkZoneModal
            zone={editingZone}
            existingZones={workZones}
            company={company}
            onSave={handleSaveZone}
            onClose={() => {
              setShowZoneModal(false);
              setEditingZone(null);
            }}
          />
        )}

        {/* v060: ContainerModal removed - Work Units now managed via workUnitSeries. Phase 6 will add Work Unit creation UI. */}

        {/* Field Override Modal */}
        {showFieldOverrideModal && editingField && (
          <FieldOverrideModal
            field={editingField}
            currentOverride={(fieldOverrides[editingField._ticketTypeId] || {})[editingField.id] || {}}
            boardName={boardName}
            ticketTypeName={editingField._ticketTypeName}
            onSave={(override) => {
              const ticketTypeId = editingField._ticketTypeId;
              const updatedFieldOverrides = {
                ...fieldOverrides,
                [ticketTypeId]: {
                  ...(fieldOverrides[ticketTypeId] || {}),
                  [editingField.id]: override,
                },
              };

              // Save directly to parent
              const updatedBoard = {
                ...board,
                fieldOverrides: updatedFieldOverrides,
              };
              onSave(updatedBoard);

              setShowFieldOverrideModal(false);
              setEditingField(null);
            }}
            onCancel={() => {
              setShowFieldOverrideModal(false);
              setEditingField(null);
            }}
          />
        )}

        {/* Field Picker Modal - Add existing fields to ticket type on this board */}
        {showFieldPickerModal &&
          fieldPickerTicketType &&
          (() => {
            // Get fields already on this ticket type (including board additions)
            const baseFieldIds = fieldPickerTicketType.fields || [];
            const additionalFieldIds = fieldOverrides[fieldPickerTicketType.id]?._additionalFields || [];
            const existingFieldIds = [...baseFieldIds, ...additionalFieldIds];

            const togglePickerCategory = (catKey) => {
              setPickerExpandedCats((prev) => ({
                ...prev,
                [catKey]: !prev[catKey],
              }));
            };

            // Helper to add field
            const handleAddField = (fieldId) => {
              const newOverrides = { ...fieldOverrides };
              if (!newOverrides[fieldPickerTicketType.id]) {
                newOverrides[fieldPickerTicketType.id] = {};
              }
              if (!newOverrides[fieldPickerTicketType.id]._additionalFields) {
                newOverrides[fieldPickerTicketType.id]._additionalFields = [];
              }
              if (!newOverrides[fieldPickerTicketType.id]._additionalFields.includes(fieldId)) {
                newOverrides[fieldPickerTicketType.id]._additionalFields = [
                  ...newOverrides[fieldPickerTicketType.id]._additionalFields,
                  fieldId,
                ];
              }

              const updatedBoard = {
                ...board,
                fieldOverrides: newOverrides,
              };
              onSave(updatedBoard);
              setShowFieldPickerModal(false);
              setFieldPickerTicketType(null);
              setPickerExpandedCats({});
            };

            return (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col">
                  {/* Header */}
                  <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-gray-200">
                    <h2 className="text-xl font-semibold text-gray-900">
                      Add Field to {fieldPickerTicketType.icon} {fieldPickerTicketType.name}
                    </h2>
                    <p className="text-sm text-gray-600 mt-1">
                      Select a field from the global library to add to this ticket type on this board.
                    </p>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-6 py-4">
                    <div className="space-y-3">
                      {/* Predefined Categories */}
                      {Object.entries(window.FIELD_LIBRARY_CATEGORIES || {}).map(([categoryKey, categoryName]) => {
                        const fieldsInCategory = Object.entries(window.FIELD_LIBRARY_NORMALIZED || {})
                          .filter(([_, field]) => field.category === categoryKey)
                          .filter(([fieldId]) => !existingFieldIds.includes(fieldId));

                        // Also get custom fields in this category (not already added)
                        const customFieldsInCategory = (company.customFields || [])
                          .filter((f) => f.category === categoryKey)
                          .filter((f) => !existingFieldIds.includes(f.id));

                        const totalFields = fieldsInCategory.length + customFieldsInCategory.length;
                        if (totalFields === 0) return null;

                        const isExpanded = pickerExpandedCats[categoryKey];

                        return (
                          <div key={categoryKey} className="border border-gray-200 rounded-lg overflow-hidden">
                            {/* Category Header - Collapsible */}
                            <button
                              onClick={() => togglePickerCategory(categoryKey)}
                              className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                                <h4 className="font-semibold text-gray-900">{categoryName}</h4>
                                <span className="text-sm text-gray-500">
                                  ({totalFields} field{totalFields !== 1 ? 's' : ''})
                                </span>
                              </div>
                            </button>

                            {/* Category Content - Collapsible */}
                            {isExpanded && (
                              <div className="p-4 bg-white">
                                <div className="space-y-2">
                                  {/* Predefined fields */}
                                  {fieldsInCategory.map(([fieldKey, field]) => (
                                    <div
                                      key={fieldKey}
                                      className="flex items-start gap-3 p-3 bg-gray-50 rounded hover:bg-gray-100 transition group"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                          <div className="font-medium text-sm text-gray-900">{field.label}</div>
                                          {field.icon && <div className="text-base">{field.icon}</div>}
                                          <span className="text-xs px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">
                                            {field.type}
                                          </span>
                                          {field.required && (
                                            <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">
                                              required
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                          {field.helpText || `Type: ${field.type}`}
                                          {field.options && ` • ${field.options.length} options`}
                                        </div>
                                        {field.options && (
                                          <div className="mt-1 text-xs text-gray-400">
                                            Options: {field.options.slice(0, 5).join(', ')}
                                            {field.options.length > 5 ? '...' : ''}
                                          </div>
                                        )}
                                      </div>
                                      <button
                                        onClick={() => handleAddField(fieldKey)}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded transition opacity-0 group-hover:opacity-100"
                                        title="Add this field"
                                      >
                                        <Plus size={14} />
                                        Add
                                      </button>
                                    </div>
                                  ))}

                                  {/* Custom fields in this category */}
                                  {customFieldsInCategory.map((field) => (
                                    <div
                                      key={field.id}
                                      className="flex items-start gap-3 p-3 bg-indigo-50 rounded hover:bg-indigo-100 transition group border border-indigo-200"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                          <div className="font-medium text-sm text-gray-900">{field.label}</div>
                                          {field.icon && <div className="text-base">{field.icon}</div>}
                                          <span className="text-xs px-1.5 py-0.5 bg-indigo-600 text-white rounded">
                                            Custom
                                          </span>
                                          <span className="text-xs px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">
                                            {field.type}
                                          </span>
                                          {field.required && (
                                            <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">
                                              required
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-xs text-gray-600">
                                          {field.helpText || `Type: ${field.type}`}
                                          {field.options && ` • ${field.options.length} options`}
                                        </div>
                                        {field.options && (
                                          <div className="mt-1 text-xs text-gray-500">
                                            Options: {field.options.slice(0, 5).join(', ')}
                                            {field.options.length > 5 ? '...' : ''}
                                          </div>
                                        )}
                                      </div>
                                      <button
                                        onClick={() => handleAddField(field.id)}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded transition opacity-0 group-hover:opacity-100"
                                        title="Add this field"
                                      >
                                        <Plus size={14} />
                                        Add
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Custom Categories */}
                      {(company.customFieldCategories || []).map((category) => {
                        const customFieldsInCategory = (company.customFields || [])
                          .filter((f) => f.category === category.id)
                          .filter((f) => !existingFieldIds.includes(f.id));

                        if (customFieldsInCategory.length === 0) return null;

                        const isExpanded = pickerExpandedCats[category.id] || false;

                        return (
                          <div
                            key={category.id}
                            className="border border-indigo-300 rounded-lg overflow-hidden bg-indigo-50"
                          >
                            {/* Custom Category Header */}
                            <button
                              onClick={() => togglePickerCategory(category.id)}
                              className="w-full flex items-center justify-between p-4 bg-indigo-100 hover:bg-indigo-200 transition"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-gray-600">{isExpanded ? '▼' : '▶'}</span>
                                <div className="flex items-center gap-2">
                                  {category.icon && <span>{category.icon}</span>}
                                  <h4 className="font-semibold text-gray-900">{category.name}</h4>
                                  <span className="text-xs px-2 py-0.5 bg-indigo-600 text-white rounded">
                                    Custom Category
                                  </span>
                                </div>
                                <span className="text-sm text-gray-600">
                                  ({customFieldsInCategory.length} field{customFieldsInCategory.length !== 1 ? 's' : ''}
                                  )
                                </span>
                              </div>
                            </button>

                            {/* Custom Category Content */}
                            {isExpanded && (
                              <div className="p-4 bg-white">
                                {category.description && (
                                  <p className="text-sm text-gray-600 mb-3 italic">{category.description}</p>
                                )}
                                <div className="space-y-2">
                                  {customFieldsInCategory.map((field) => (
                                    <div
                                      key={field.id}
                                      className="flex items-start gap-3 p-3 bg-indigo-50 rounded hover:bg-indigo-100 transition group border border-indigo-200"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                          <div className="font-medium text-sm text-gray-900">{field.label}</div>
                                          {field.icon && <div className="text-base">{field.icon}</div>}
                                          <span className="text-xs px-1.5 py-0.5 bg-indigo-600 text-white rounded">
                                            Custom
                                          </span>
                                          <span className="text-xs px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">
                                            {field.type}
                                          </span>
                                          {field.required && (
                                            <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">
                                              required
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-xs text-gray-600">
                                          {field.helpText || `Type: ${field.type}`}
                                          {field.options && ` • ${field.options.length} options`}
                                        </div>
                                        {field.options && (
                                          <div className="mt-1 text-xs text-gray-500">
                                            Options: {field.options.slice(0, 5).join(', ')}
                                            {field.options.length > 5 ? '...' : ''}
                                          </div>
                                        )}
                                      </div>
                                      <button
                                        onClick={() => handleAddField(field.id)}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded transition opacity-0 group-hover:opacity-100"
                                        title="Add this field"
                                      >
                                        <Plus size={14} />
                                        Add
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Empty state */}
                      {(() => {
                        const hasAnyAvailable =
                          Object.entries(window.FIELD_LIBRARY_CATEGORIES || {}).some(([catKey]) => {
                            const predefined = Object.entries(window.FIELD_LIBRARY_NORMALIZED || {})
                              .filter(([_, f]) => f.category === catKey)
                              .filter(([id]) => !existingFieldIds.includes(id));
                            const custom = (company.customFields || [])
                              .filter((f) => f.category === catKey)
                              .filter((f) => !existingFieldIds.includes(f.id));
                            return predefined.length > 0 || custom.length > 0;
                          }) ||
                          (company.customFieldCategories || []).some((cat) => {
                            return (
                              (company.customFields || [])
                                .filter((f) => f.category === cat.id)
                                .filter((f) => !existingFieldIds.includes(f.id)).length > 0
                            );
                          });

                        if (!hasAnyAvailable) {
                          return (
                            <div className="text-center py-12 bg-gray-50 rounded-lg">
                              <div className="text-4xl mb-3">✅</div>
                              <p className="text-gray-600">
                                All available fields are already added to this ticket type.
                              </p>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex-shrink-0 p-6 border-t border-gray-200 bg-gray-50">
                    <button
                      onClick={() => {
                        setShowFieldPickerModal(false);
                        setFieldPickerTicketType(null);
                        setPickerExpandedCats({});
                      }}
                      className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

        {/* v062 BUG-062-004: Tab Switch Warning Modal */}
        {showTabSwitchWarning && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Unsaved Changes</h3>
              <p className="text-gray-600 mb-6">You have unsaved changes. What would you like to do?</p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleTabSwitchSave}
                  className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  Save Changes
                </button>
                <button
                  onClick={handleTabSwitchDiscard}
                  className="w-full px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition"
                >
                  Discard Changes
                </button>
                <button
                  onClick={handleTabSwitchCancel}
                  className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                >
                  Stay on This Tab
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation Modal */}
        {showConfirmation && confirmationConfig && (
          <ConfirmationModal
            isOpen={showConfirmation}
            onClose={() => setShowConfirmation(false)}
            onConfirm={confirmationConfig.onConfirm}
            title={confirmationConfig.title}
            message={confirmationConfig.message}
            confirmText={confirmationConfig.confirmText}
            type={confirmationConfig.type}
          />
        )}

        {/* v154: Ambiguous Keyword Warning Modal */}
        {showAmbiguousWarning && ambiguousWarningConfig && (
          <AmbiguousKeywordModal
            config={ambiguousWarningConfig}
            onConfirm={ambiguousWarningConfig.onConfirm}
            onCancel={ambiguousWarningConfig.onCancel}
          />
        )}
      </div>
    );
  };

  // v154: Ambiguous Keyword Warning Modal
  // Shows when user creates/renames a stage with an ambiguous name like "Closed", "Hold", etc.
  const AmbiguousKeywordModal = ({ config, onConfirm, onCancel }) => {
    const [selectedOption, setSelectedOption] = useState('original'); // 'original' | 'alt-0' | 'alt-1' | 'alt-2' | 'custom'
    const [customName, setCustomName] = useState('');

    const handleConfirm = () => {
      let chosenName = config.originalName;

      if (selectedOption === 'custom' && customName.trim()) {
        chosenName = customName.trim();
      } else if (selectedOption.startsWith('alt-')) {
        const altIndex = parseInt(selectedOption.split('-')[1]);
        chosenName = config.alternatives[altIndex];
      }
      // else 'original' - use config.originalName

      onConfirm(chosenName);
    };

    // Get the status type label for display
    const getTypeLabel = (type) => {
      const labels = {
        backlog: 'Backlog',
        scoped: 'Scoped',
        queued: 'Queued',
        active: 'Active',
        completed: 'Completed',
        ended: 'Ended',
      };
      return labels[type] || type;
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[70]">
        <div className="bg-white rounded-lg max-w-lg w-full overflow-hidden">
          <div className="p-6 border-b border-gray-200 bg-amber-50">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
                <span className="text-amber-600 text-lg">⚠️</span>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Ambiguous Stage Name</h2>
                <p className="text-sm text-gray-600 mt-1">{config.warning}</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg space-y-2 text-sm">
              <p className="font-medium text-gray-700">This means:</p>
              <ul className="list-disc list-inside text-gray-600 space-y-1">
                {config.defaultType === 'ended' && (
                  <>
                    <li>
                      Tickets will trigger the <span className="font-medium">endedAt</span> timestamp
                    </li>
                    <li>Metrics will count this as "cancelled" work, not "done" work</li>
                  </>
                )}
                {config.defaultType === 'completed' && (
                  <>
                    <li>
                      Tickets will trigger the <span className="font-medium">completedAt</span> timestamp
                    </li>
                    <li>Metrics will count this as successfully finished work</li>
                  </>
                )}
                {config.defaultType === 'active' && (
                  <>
                    <li>
                      Tickets will trigger the <span className="font-medium">startedAt</span> timestamp
                    </li>
                    <li>Metrics will count this as work in progress</li>
                  </>
                )}
                {config.defaultType === 'queued' && (
                  <>
                    <li>
                      Tickets will trigger the <span className="font-medium">startedAt</span> timestamp
                    </li>
                    <li>Metrics will count this as work ready to start</li>
                  </>
                )}
                {config.defaultType === 'scoped' && (
                  <>
                    <li>
                      Tickets will trigger the <span className="font-medium">scopedAt</span> timestamp
                    </li>
                    <li>Metrics will count this as planned/committed work</li>
                  </>
                )}
                {config.defaultType === 'backlog' && (
                  <>
                    <li>Tickets will remain uncommitted (no lifecycle timestamps)</li>
                    <li>Metrics will count this as unplanned/future work</li>
                  </>
                )}
              </ul>
            </div>

            <div className="space-y-3">
              <p className="font-medium text-gray-700 text-sm">Choose an option:</p>

              {/* Use original name anyway */}
              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="stageChoice"
                  value="original"
                  checked={selectedOption === 'original'}
                  onChange={(e) => setSelectedOption(e.target.value)}
                  className="text-indigo-600"
                />
                <div>
                  <span className="font-medium">Use "{config.originalName}" anyway</span>
                  <span className="text-gray-500 text-sm ml-2">(maps to {getTypeLabel(config.defaultType)})</span>
                </div>
              </label>

              {/* Alternative suggestions */}
              {config.alternatives?.map((alt, idx) => (
                <label
                  key={idx}
                  className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50"
                >
                  <input
                    type="radio"
                    name="stageChoice"
                    value={`alt-${idx}`}
                    checked={selectedOption === `alt-${idx}`}
                    onChange={(e) => setSelectedOption(e.target.value)}
                    className="text-indigo-600"
                  />
                  <span className="font-medium">Change to "{alt}"</span>
                </label>
              ))}

              {/* Custom name */}
              <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="stageChoice"
                  value="custom"
                  checked={selectedOption === 'custom'}
                  onChange={(e) => setSelectedOption(e.target.value)}
                  className="text-indigo-600 mt-1"
                />
                <div className="flex-1">
                  <span className="font-medium">Enter different name:</span>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => {
                      setCustomName(e.target.value);
                      setSelectedOption('custom');
                    }}
                    placeholder="Enter stage name..."
                    className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                  />
                </div>
              </label>
            </div>
          </div>

          <div className="p-6 border-t border-gray-200 flex gap-3 justify-end">
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedOption === 'custom' && !customName.trim()}
              className={`px-4 py-2 rounded-lg transition ${
                selectedOption === 'custom' && !customName.trim()
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Work Zone Configuration Modal
  const WorkZoneModal = ({ zone, existingZones, company, onSave, onClose }) => {
    const [name, setName] = useState(zone?.name || '');
    const [type, setType] = useState(zone?.type || 'kanban');

    // Phase 3: Stages are now objects with {name, defaultStatus}
    // Migrate existing string stages to objects if needed
    const getDefaultStagesForType = (zoneType) => {
      if (zoneType === 'backlog') {
        return [
          { name: 'New', defaultStatus: 'new' },
          { name: 'Backlog', defaultStatus: 'backlog' },
        ];
      }
      return [
        { name: 'To Do', defaultStatus: 'todo' },
        { name: 'In Progress', defaultStatus: 'in-progress' },
        { name: 'Done', defaultStatus: 'completed' },
      ];
    };

    const initialStages = zone?.workStages
      ? migrateWorkStages(zone.workStages)
      : getDefaultStagesForType(zone?.type || 'kanban');

    const [stages, setStages] = useState(initialStages);
    const [newStageName, setNewStageName] = useState('');
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [confirmationConfig, setConfirmationConfig] = useState(null);

    // v154: Ambiguous keyword warning state
    const [showAmbiguousWarning, setShowAmbiguousWarning] = useState(false);
    const [ambiguousWarningConfig, setAmbiguousWarningConfig] = useState(null);

    // v066 BUG-065-001: Update default stages when type changes (only for NEW zones)
    const [hasUserModifiedStages, setHasUserModifiedStages] = useState(!!zone);

    React.useEffect(() => {
      // Only auto-change stages for new zones that haven't been manually modified
      if (!zone && !hasUserModifiedStages) {
        setStages(getDefaultStagesForType(type));
      }
    }, [type]);

    // Get available statuses from company
    const statuses = company?.statuses || PREDEFINED_STATUSES;

    // Track if changes have been made (only relevant for editing existing zone)
    const isEditing = !!zone;
    const originalStages = zone?.workStages ? migrateWorkStages(zone.workStages) : [];
    const hasChanges = isEditing
      ? name !== zone.name || type !== zone.type || JSON.stringify(stages) !== JSON.stringify(originalStages)
      : name.trim() !== ''; // For new zone, enable when name is entered

    const handleAddStage = () => {
      if (newStageName.trim() && !stages.some((s) => s.name === newStageName.trim())) {
        const trimmedName = newStageName.trim();

        // v154: Check for ambiguous keywords
        const ambiguousInfo = getAmbiguousKeywordWarning ? getAmbiguousKeywordWarning(trimmedName) : null;

        if (ambiguousInfo) {
          // Show warning modal
          setAmbiguousWarningConfig({
            ...ambiguousInfo,
            onConfirm: (chosenName) => {
              const inferredStatus = inferStatusFromStageName(chosenName);
              setStages([...stages, { name: chosenName, defaultStatus: inferredStatus }]);
              setNewStageName('');
              setHasUserModifiedStages(true);
              setShowAmbiguousWarning(false);
              setAmbiguousWarningConfig(null);
            },
            onCancel: () => {
              setShowAmbiguousWarning(false);
              setAmbiguousWarningConfig(null);
            },
          });
          setShowAmbiguousWarning(true);
        } else {
          // No ambiguity - proceed normally
          const inferredStatus = inferStatusFromStageName(trimmedName);
          setStages([...stages, { name: trimmedName, defaultStatus: inferredStatus }]);
          setNewStageName('');
          setHasUserModifiedStages(true);
        }
      }
    };

    const handleRemoveStage = (index) => {
      if (stages.length > 1) {
        setStages(stages.filter((_, i) => i !== index));
        setHasUserModifiedStages(true); // v066: User has manually modified stages
      }
    };

    const handleStageNameChange = (index, newName) => {
      // v154: Check for ambiguous keywords on rename (only when leaving field would be cleaner, but inline is simpler)
      // We'll apply the change immediately but could add onBlur check if desired
      const newStages = [...stages];
      // BUG-P3-002 FIX: Re-infer status when stage name changes
      const inferredStatus = inferStatusFromStageName(newName);
      newStages[index] = { ...newStages[index], name: newName, defaultStatus: inferredStatus };
      setStages(newStages);
      setHasUserModifiedStages(true); // v066: User has manually modified stages
    };

    // v154: Check and warn on stage name blur (for rename scenarios)
    const handleStageNameBlur = (index, stageName) => {
      if (!stageName.trim()) return;

      const ambiguousInfo = getAmbiguousKeywordWarning ? getAmbiguousKeywordWarning(stageName) : null;

      if (ambiguousInfo) {
        setAmbiguousWarningConfig({
          ...ambiguousInfo,
          onConfirm: (chosenName) => {
            const newStages = [...stages];
            const inferredStatus = inferStatusFromStageName(chosenName);
            newStages[index] = { ...newStages[index], name: chosenName, defaultStatus: inferredStatus };
            setStages(newStages);
            setShowAmbiguousWarning(false);
            setAmbiguousWarningConfig(null);
          },
          onCancel: () => {
            setShowAmbiguousWarning(false);
            setAmbiguousWarningConfig(null);
          },
        });
        setShowAmbiguousWarning(true);
      }
    };

    const handleStageStatusChange = (index, newStatus) => {
      const newStages = [...stages];
      newStages[index] = { ...newStages[index], defaultStatus: newStatus };
      setStages(newStages);
      setHasUserModifiedStages(true); // v066: User has manually modified stages
    };

    const handleMoveStage = (index, direction) => {
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= stages.length) return;

      const newStages = [...stages];
      [newStages[index], newStages[newIndex]] = [newStages[newIndex], newStages[index]];
      setStages(newStages);
    };

    const handleSave = () => {
      if (!name.trim()) {
        alert('Please enter a zone name');
        return;
      }
      if (stages.length === 0) {
        alert('Please add at least one stage');
        return;
      }

      const nameChanged = zone && name.trim() !== zone.name;

      if (nameChanged) {
        setConfirmationConfig({
          title: 'Rename Work Zone',
          message: `You are about to rename the work zone from "${zone.name}" to "${name.trim()}" (Work Zone).`,
          confirmText: 'Rename',
          type: 'rename',
          onConfirm: () => performSave(),
        });
        setShowConfirmation(true);
      } else {
        performSave();
      }
    };

    const performSave = () => {
      onSave({
        name: name.trim(),
        type,
        workStages: stages, // Now an array of {name, defaultStatus} objects
      });
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
        <div className="bg-white rounded-lg max-w-3xl w-full h-[80vh] overflow-hidden flex flex-col">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">{zone ? 'Edit Work Zone' : 'Create Work Zone'}</h2>
          </div>

          <div className="p-6 space-y-6 flex-1 overflow-y-auto">
            {/* Zone Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Zone Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Active Sprints, Backlog, Archive"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Zone Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Zone Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              >
                <option value="kanban">Kanban (active workflow)</option>
                <option value="backlog">Backlog (planning)</option>
                <option value="crm">CRM (customer pipeline)</option>
                <option value="archive">Archive (completed items)</option>
              </select>
            </div>

            {/* Work Stages */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Work Stages</label>
              <p className="text-xs text-gray-500 mb-3">
                Each stage maps to a canonical status for filtering and reporting.
              </p>

              {/* Header row */}
              <div className="grid grid-cols-[1fr_180px_100px] gap-2 mb-2 px-1 text-xs font-medium text-gray-500 uppercase">
                <div>Stage Name</div>
                <div>Default Status</div>
                <div className="text-right">Actions</div>
              </div>

              <div className="space-y-2">
                {stages.map((stage, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_180px_100px] gap-2 items-center">
                    <input
                      type="text"
                      value={stage.name}
                      onChange={(e) => handleStageNameChange(idx, e.target.value)}
                      onBlur={(e) => handleStageNameBlur(idx, e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                      placeholder="Stage name"
                    />
                    <select
                      value={stage.defaultStatus}
                      onChange={(e) => handleStageStatusChange(idx, e.target.value)}
                      className="px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                    >
                      {/* v145: Updated to 6-type model */}
                      <optgroup label="Backlog">
                        {statuses
                          .filter((s) => s.type === 'backlog')
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Scoped">
                        {statuses
                          .filter((s) => s.type === 'scoped')
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Queued">
                        {statuses
                          .filter((s) => s.type === 'queued')
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Active">
                        {statuses
                          .filter((s) => s.type === 'active')
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Completed">
                        {statuses
                          .filter((s) => s.type === 'completed')
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Ended">
                        {statuses
                          .filter((s) => s.type === 'ended')
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                      </optgroup>
                    </select>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleMoveStage(idx, -1)}
                        disabled={idx === 0}
                        className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => handleMoveStage(idx, 1)}
                        disabled={idx === stages.length - 1}
                        className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => handleRemoveStage(idx)}
                        disabled={stages.length === 1}
                        className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Add new stage */}
                <div className="flex gap-2 mt-3">
                  <input
                    type="text"
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddStage()}
                    placeholder="Add new stage..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    onClick={handleAddStage}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                  >
                    Add
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                💡 When tickets are dragged to a stage, their status will be set to the stage's default status.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="p-6 border-t border-gray-200 flex gap-3">
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className={`flex-1 px-4 py-2 rounded-lg transition ${
                hasChanges
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {isEditing ? (hasChanges ? 'Save Changes' : 'No Changes') : 'Create Work Zone'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
            >
              {isEditing && hasChanges ? 'Cancel' : 'Close'}
            </button>
          </div>
        </div>

        {/* Confirmation Modal */}
        {showConfirmation && confirmationConfig && (
          <ConfirmationModal
            isOpen={showConfirmation}
            onClose={() => setShowConfirmation(false)}
            onConfirm={confirmationConfig.onConfirm}
            title={confirmationConfig.title}
            message={confirmationConfig.message}
            confirmText={confirmationConfig.confirmText}
            type={confirmationConfig.type}
          />
        )}

        {/* v154: Ambiguous Keyword Warning Modal */}
        {showAmbiguousWarning && ambiguousWarningConfig && (
          <AmbiguousKeywordModal
            config={ambiguousWarningConfig}
            onConfirm={ambiguousWarningConfig.onConfirm}
            onCancel={ambiguousWarningConfig.onCancel}
          />
        )}
      </div>
    );
  };

  // SPRINT EXPANSION: Container Modal Component
  // Used for creating and editing sprints, campaigns, phases, etc.
  // SPRINT EXPANSION: Modal for creating/editing containers (Sprints, Phases, etc.)
  const ContainerModal = ({
    container,
    opCentreId,
    opCentreName,
    existingContainers,
    containerLabel,
    onSave,
    onClose,
  }) => {
    const [name, setName] = useState(container?.name || '');
    const [goal, setGoal] = useState(container?.goal || '');
    const [startDate, setStartDate] = useState(container?.startDate || '');
    const [endDate, setEndDate] = useState(container?.endDate || '');
    const [status, setStatus] = useState(container?.status || 'planning');

    // Use provided label or default to "Sprint"
    const label = containerLabel || 'Sprint';

    const isEditing = !!container;

    // Calculate next sequence number for new containers
    const nextSequence =
      existingContainers.length > 0 ? Math.max(...existingContainers.map((c) => c.sequence || 0)) + 1 : 1;

    const hasChanges = isEditing
      ? name !== container.name ||
        goal !== (container.goal || '') ||
        startDate !== (container.startDate || '') ||
        endDate !== (container.endDate || '') ||
        status !== container.status
      : name.trim() !== '';

    const handleSave = () => {
      if (!name.trim()) {
        alert('Please enter a name');
        return;
      }

      const containerData = {
        id: container?.id || `container-${Date.now()}`,
        opCentreId: opCentreId,
        name: name.trim(),
        goal: goal.trim(),
        startDate: startDate || null,
        endDate: endDate || null,
        status: status,
        sequence: container?.sequence || nextSequence,
        createdAt: container?.createdAt || new Date(),
        updatedAt: new Date(),
      };

      onSave(containerData);
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
        <div className="bg-white rounded-lg max-w-lg w-full overflow-hidden flex flex-col">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">{isEditing ? `Edit ${label}` : `Create ${label}`}</h2>
            <p className="text-sm text-gray-600 mt-1">Work Centre: {opCentreName}</p>
          </div>

          <div className="p-6 space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Sprint 1, Q1 Campaign, Discovery Phase"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Goal */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Goal (optional)</label>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="What do you want to achieve?"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Status - only show for editing */}
            {isEditing && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="planning">📋 Planning</option>
                  <option value="active">▶️ Active</option>
                  <option value="completed">✓ Completed</option>
                  <option value="cancelled">✗ Cancelled</option>
                </select>
              </div>
            )}

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex gap-3">
                <div className="text-blue-600 flex-shrink-0">🏃</div>
                <div className="text-sm text-blue-700">
                  {isEditing ? (
                    <>Editing this sprint. Tickets already assigned will remain assigned.</>
                  ) : (
                    <>Creating sprint #{nextSequence}. After creation, assign tickets to this sprint.</>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-6 border-t border-gray-200 flex gap-3">
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className={`flex-1 px-4 py-2 rounded-lg transition ${
                hasChanges
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {isEditing ? (hasChanges ? 'Save Changes' : 'No Changes') : 'Create Sprint'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
            >
              {isEditing && hasChanges ? 'Cancel' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Field Override Modal Component
  const FieldOverrideModal = ({ field, currentOverride, boardName, ticketTypeName, onSave, onCancel }) => {
    const [label, setLabel] = useState(currentOverride.label || field.label);
    const [helpText, setHelpText] = useState(currentOverride.helpText || field.helpText || '');
    const [required, setRequired] = useState(
      currentOverride.required !== undefined ? currentOverride.required : field.required
    );
    const [placeholder, setPlaceholder] = useState(currentOverride.placeholder || field.placeholder || '');
    const [options, setOptions] = useState(currentOverride.options || field.options || []);
    const [min, setMin] = useState(currentOverride.min !== undefined ? currentOverride.min : field.min);
    const [max, setMax] = useState(currentOverride.max !== undefined ? currentOverride.max : field.max);
    const [rows, setRows] = useState(currentOverride.rows || field.rows || 4);
    const [newOption, setNewOption] = useState('');

    // Track if changes have been made (compare to base field, not current override)
    const hasChanges =
      label !== field.label ||
      helpText !== (field.helpText || '') ||
      required !== (field.required || false) ||
      placeholder !== (field.placeholder || '') ||
      JSON.stringify(options) !== JSON.stringify(field.options || []) ||
      min !== field.min ||
      max !== field.max ||
      rows !== (field.rows || 4);

    const handleAddOption = () => {
      if (newOption.trim() && !options.includes(newOption.trim())) {
        setOptions([...options, newOption.trim()]);
        setNewOption('');
      }
    };

    const handleRemoveOption = (index) => {
      setOptions(options.filter((_, i) => i !== index));
    };

    const handleSave = () => {
      const override = {};

      // Only include properties that differ from the base field
      if (label !== field.label) override.label = label;
      if (helpText !== (field.helpText || '')) override.helpText = helpText;
      if (required !== field.required) override.required = required;
      if (placeholder !== (field.placeholder || '')) override.placeholder = placeholder;

      // Type-specific properties
      if (
        (field.type === 'select' || field.type === 'multiselect') &&
        JSON.stringify(options) !== JSON.stringify(field.options || [])
      ) {
        override.options = options;
      }
      if (field.type === 'number') {
        if (min !== field.min) override.min = min;
        if (max !== field.max) override.max = max;
      }
      if (field.type === 'textarea' && rows !== (field.rows || 4)) {
        override.rows = rows;
      }

      onSave(override);
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[70]">
        <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Customise Field: {field.label}</h2>
            <p className="text-sm text-gray-600 mt-1">
              For <span className="font-medium">{ticketTypeName}</span> tickets on{' '}
              <span className="font-medium">{boardName}</span>
            </p>
          </div>

          <div className="p-6 space-y-6">
            {/* Field Label */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Field Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                placeholder={field.label}
              />
              {label !== field.label && (
                <p className="text-xs text-indigo-600 mt-1">
                  Global: "{field.label}" → Board: "{label}"
                </p>
              )}
            </div>

            {/* Help Text */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Help Text</label>
              <input
                type="text"
                value={helpText}
                onChange={(e) => setHelpText(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                placeholder="Optional help text for users"
              />
            </div>

            {/* Required Toggle */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={required}
                  onChange={(e) => setRequired(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm font-medium text-gray-700">Required field</span>
              </label>
              {required !== field.required && (
                <p className="text-xs text-indigo-600 mt-1">
                  Global: {field.required ? 'Required' : 'Optional'} → Board: {required ? 'Required' : 'Optional'}
                </p>
              )}
            </div>

            {/* Placeholder (for text fields) */}
            {(field.type === 'text' || field.type === 'email' || field.type === 'url' || field.type === 'tel') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Placeholder Text</label>
                <input
                  type="text"
                  value={placeholder}
                  onChange={(e) => setPlaceholder(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  placeholder={field.placeholder || 'Enter placeholder...'}
                />
              </div>
            )}

            {/* Options (for select/multiselect fields) */}
            {(field.type === 'select' || field.type === 'multiselect') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Options</label>
                <div className="space-y-2 mb-3">
                  {options.map((option, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={option}
                        onChange={(e) => {
                          const newOptions = [...options];
                          newOptions[idx] = e.target.value;
                          setOptions(newOptions);
                        }}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                        placeholder="Option value"
                      />
                      <button
                        onClick={() => handleRemoveOption(idx)}
                        className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition"
                        title="Remove option"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newOption}
                    onChange={(e) => setNewOption(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddOption())}
                    placeholder="Add new option"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    onClick={handleAddOption}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                  >
                    Add
                  </button>
                </div>
                {JSON.stringify(options) !== JSON.stringify(field.options || []) && (
                  <p className="text-xs text-indigo-600 mt-2">Options customized for this board</p>
                )}
              </div>
            )}

            {/* Min/Max (for number fields) */}
            {field.type === 'number' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Value</label>
                  <input
                    type="number"
                    value={min !== undefined ? min : ''}
                    onChange={(e) => setMin(e.target.value ? parseFloat(e.target.value) : undefined)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    placeholder="No minimum"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Maximum Value</label>
                  <input
                    type="number"
                    value={max !== undefined ? max : ''}
                    onChange={(e) => setMax(e.target.value ? parseFloat(e.target.value) : undefined)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    placeholder="No maximum"
                  />
                </div>
              </div>
            )}

            {/* Rows (for textarea fields) */}
            {field.type === 'textarea' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Text Area Rows</label>
                <input
                  type="number"
                  value={rows}
                  onChange={(e) => setRows(parseInt(e.target.value) || 4)}
                  min="2"
                  max="20"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            {/* Info Box */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
              <div className="flex gap-3">
                <div className="text-indigo-600 flex-shrink-0">
                  <Settings size={20} />
                </div>
                <div className="text-sm">
                  <div className="font-medium text-indigo-900 mb-1">Board-Specific Customisation</div>
                  <div className="text-indigo-700">
                    These changes only apply to "{boardName}" board. The global field definition remains unchanged for
                    other boards.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-6 border-t border-gray-200 flex gap-3">
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className={`flex-1 px-4 py-2 rounded-lg transition ${
                hasChanges
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {hasChanges ? 'Save Override' : 'No Changes'}
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
            >
              {hasChanges ? 'Cancel' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Export to window namespace
  window.Components = window.Components || {};
  window.Components.BoardSettingsModals = {
    ProcessBoardSettingsModal,
    WorkZoneModal,
    FieldOverrideModal,
  };

  // v153: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['board-settings-modals'] = COMPONENT_VERSION;

  console.log(`[board-settings-modals.jsx] BoardSettingsModals loaded (${COMPONENT_VERSION})`);
})();

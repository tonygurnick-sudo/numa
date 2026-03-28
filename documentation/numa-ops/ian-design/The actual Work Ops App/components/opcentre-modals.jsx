/**
 * Op Centre Modals
 * Numa Ops Management
 *
 * Component Version: v158a (aligned with v158 App release)
 *
 * Contains:
 * - CreateOpCentreModal
 * - BoardSelectionModal
 * - OpCentreSettingsModal
 *
 * Dependencies:
 * - window.Components.TicketTypeModal
 * - window.Components.ConfirmModals.ConfirmationModal
 * - window.Icons.Plus
 * - window.Icons.Trash2
 *
 * v158a Changes:
 *   - BUG 162-001 FIX: WC Wizard Step 4 stages now editable
 *     - Replaced static stage pills with full editable grid
 *     - Stage Name input + Default Status dropdown + sort arrows + delete
 *     - Matches Board Settings Work Unit Stages UI
 *     - Added Trash2 icon dependency
 *
 * v157c Changes:
 *   - BUG FIX: BOARD_COLORS.map error - removed window.BOARD_COLORS dependency
 *     (window.BOARD_COLORS in app.jsx is object not array; now uses local array)
 *
 * v157b Changes:
 *   - BUG 159-001 FIX: Changed prop name from openBoardSettings back to
 *     onConfigureBoard to match app.jsx prop passing
 *
 * v157a Changes:
 *   - WC WIZARD REDESIGN: Simplified board creation flow
 *     - Step 2 requires Board Name (mandatory)
 *     - Checkbox "Enable Work Units" (default OFF = simple board)
 *     - If Work Units enabled, Step 4 added for WU configuration
 *     - Auto-creates Task ticket type (no user choice)
 *     - Zone renamed from "Product Backlog" to "Planning"
 *     - Simple board stages: Planning → To Do → In Progress → Done
 *   - NEW BOARD MODAL: Updated to match wizard pattern
 *
 * Previous (pre-v157a):
 * - WC WIZARD REDESIGN: Simplified board creation flow
 *   - Step 2 now requires Board Name (mandatory)
 *   - Checkbox "Enable Work Units" (default OFF = simple board)
 *   - If Work Units enabled, Step 4 added for WU configuration
 *   - Auto-creates Task ticket type (no user choice)
 *   - Zone renamed from "Product Backlog" to "Planning"
 *   - Simple board stages: Planning → To Do → In Progress → Done
 * - NEW BOARD MODAL: Updated to match wizard pattern
 *   - Zone name "Planning" (not "Product Backlog")
 *   - Simple board gets Planning stage
 *   - Auto-enables Task ticket type
 *
 * v155 Changes:
 * - PROGRESSIVE PRESENTATION: Simple boards (no work units) support
 *   - Simple Kanban option creates board with workUnitSeries: null and isSystemZone: true
 *   - New Board Modal has "Enable Work Units" checkbox
 *   - Backlog boards include work unit series configuration
 *
 * v153 Changes:
 * - Added component version registry support
 */

(function () {
  'use strict';

  // Component version for registry
  const COMPONENT_VERSION = 'v158a';

  const { useState } = React;

  // Get dependencies from window at render time

  // CreateOpCentreModal - v159: Redesigned with simplified flow
  const CreateOpCentreModal = ({ company, onSave, onClose }) => {
    // v158a: Get icons for editable stages
    const Plus = window.Icons?.Plus;
    const Trash2 = window.Icons?.Trash2;

    const [step, setStep] = useState(1);
    const [opCentreName, setOpCentreName] = useState('');
    const [opCentreColor, setOpCentreColor] = useState('indigo');
    const [accessType, setAccessType] = useState('all');
    const [selectedUsers, setSelectedUsers] = useState([]);

    // v159: New state for board setup
    const [boardName, setBoardName] = useState('');
    const [enableWorkUnits, setEnableWorkUnits] = useState(false);

    // v159: Work Unit configuration state (for Step 4)
    const [wuLabel, setWuLabel] = useState('Sprint');
    const [wuLabelPlural, setWuLabelPlural] = useState('Sprints');
    const [wuPatternType, setWuPatternType] = useState('sequential');
    const [wuPatternStart, setWuPatternStart] = useState(1);
    const [wuActiveStages, setWuActiveStages] = useState([
      { name: 'To Do', defaultStatus: 'todo' },
      { name: 'In Progress', defaultStatus: 'in-progress' },
      { name: 'Done', defaultStatus: 'completed' },
    ]);

    const colorOptions = [
      { name: 'indigo', label: 'Indigo', hex: '#6366f1' },
      { name: 'blue', label: 'Blue', hex: '#3b82f6' },
      { name: 'emerald', label: 'Emerald', hex: '#10b981' },
      { name: 'purple', label: 'Purple', hex: '#8b5cf6' },
      { name: 'pink', label: 'Pink', hex: '#ec4899' },
      { name: 'orange', label: 'Orange', hex: '#f59e0b' },
      { name: 'teal', label: 'Teal', hex: '#14b8a6' },
      { name: 'red', label: 'Red', hex: '#ef4444' },
    ];

    // v159: Predefined work unit label options
    const wuLabelOptions = [
      { label: 'Sprint', labelPlural: 'Sprints' },
      { label: 'Phase', labelPlural: 'Phases' },
      { label: 'Month', labelPlural: 'Months' },
      { label: 'Week', labelPlural: 'Weeks' },
      { label: 'Cycle', labelPlural: 'Cycles' },
      { label: 'Release', labelPlural: 'Releases' },
    ];

    const handleToggleUser = (userName) => {
      if (selectedUsers.includes(userName)) {
        setSelectedUsers(selectedUsers.filter((u) => u !== userName));
      } else {
        setSelectedUsers([...selectedUsers, userName]);
      }
    };

    const handleCreate = () => {
      if (!opCentreName.trim()) {
        alert('Please enter a Work Centre name');
        return;
      }
      if (!boardName.trim()) {
        alert('Please enter a Board name');
        return;
      }

      const zoneId = `zone-${Date.now()}`;
      const boardId = `board-${Date.now()}-main`;

      // v159: Build board based on Work Units toggle
      let newBoard;

      if (enableWorkUnits) {
        // Work Unit board - Planning zone with backlog stages
        newBoard = {
          id: boardId,
          name: boardName.trim(),
          color: opCentreColor,
          access: {
            type: 'inherit',
            users: [],
          },
          allowedTicketTypes: ['type-task'], // v159: Always include Task
          workZones: [
            {
              id: zoneId,
              name: 'Planning', // v159: Use "Planning" instead of "Product Backlog"
              type: 'backlog',
              workStages: [
                { name: 'New', defaultStatus: 'new' },
                { name: 'Planning', defaultStatus: 'backlog' },
              ],
            },
          ],
          defaultZone: zoneId,
          defaultStage: 'New',
          workUnitSeries: {
            id: `series-${Date.now()}`,
            enabled: true,
            label: wuLabel,
            labelPlural: wuLabelPlural,
            patternType: wuPatternType,
            patternStart: wuPatternStart,
            patternStartYear: new Date().getFullYear(),
            allowOverlap: false,
            backlogZoneId: zoneId,
            currentSequence: wuPatternStart,
            activeStages: wuActiveStages,
          },
          fieldOverrides: {},
        };
      } else {
        // v159: Simple board - Planning as first stage
        newBoard = {
          id: boardId,
          name: boardName.trim(),
          color: opCentreColor,
          access: {
            type: 'inherit',
            users: [],
          },
          allowedTicketTypes: ['type-task'], // v159: Always include Task
          workZones: [
            {
              id: zoneId,
              name: 'Default',
              type: 'kanban',
              isSystemZone: true,
              workStages: [
                { name: 'Planning', defaultStatus: 'backlog' }, // v159: Added Planning stage
                { name: 'To Do', defaultStatus: 'todo' },
                { name: 'In Progress', defaultStatus: 'in-progress' },
                { name: 'Done', defaultStatus: 'completed' },
              ],
            },
          ],
          defaultZone: zoneId,
          defaultStage: 'Planning', // v159: Default to Planning
          workUnitSeries: null,
          fieldOverrides: {},
        };
      }

      const newOpCentre = {
        id: `opcentre-${Date.now()}`,
        name: opCentreName.trim(),
        color: opCentreColor,
        access: {
          type: accessType,
          users: accessType === 'specific' ? selectedUsers : [],
        },
        staffList: company.globalStaff.map((s) => s.name),
        ticketTypes: [],
        processBoards: [newBoard],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      onSave(newOpCentre);
    };

    // v159: Dynamic total steps based on Work Units toggle
    const totalSteps = enableWorkUnits ? 4 : 3;

    const canProceed = () => {
      if (step === 1) return opCentreName.trim().length > 0;
      if (step === 2) return boardName.trim().length > 0; // v159: Require board name
      if (step === 3) return accessType !== 'specific' || selectedUsers.length > 0;
      if (step === 4) return true; // WU config step
      return true;
    };

    // v159: Handle Work Unit label selection
    const handleWuLabelSelect = (option) => {
      setWuLabel(option.label);
      setWuLabelPlural(option.labelPlural);
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-2xl w-full h-[80vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Create New Work Centre</h2>
            <p className="text-sm text-gray-600 mt-1">
              Step {step} of {totalSteps}
            </p>
            {/* Progress Bar - v159: Dynamic based on totalSteps */}
            <div className="mt-4 flex gap-2">
              {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
                <div key={s} className={`flex-1 h-2 rounded ${s <= step ? 'bg-indigo-600' : 'bg-gray-200'}`} />
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Step 1: Basic Info */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h3>
                  <p className="text-sm text-gray-600 mb-6">Give your Work Centre a name and choose a color theme</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Work Centre Name *</label>
                  <input
                    type="text"
                    value={opCentreName}
                    onChange={(e) => setOpCentreName(e.target.value)}
                    placeholder="e.g., Product Development, Customer Success, HR Operations"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-lg"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">Color Theme</label>
                  <div className="grid grid-cols-4 gap-3">
                    {colorOptions.map((color) => (
                      <button
                        key={color.name}
                        onClick={() => setOpCentreColor(color.name)}
                        className={`flex items-center gap-2 p-3 rounded-lg border-2 transition ${
                          opCentreColor === color.name
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="w-6 h-6 rounded-full" style={{ backgroundColor: color.hex }} />
                        <span className="text-sm font-medium text-gray-700">{color.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Preview */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="text-xs font-medium text-gray-500 mb-3">Preview</div>
                  <div className={`bg-white p-4 rounded-lg border-2 border-gray-200`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-12 h-12 rounded-lg bg-${opCentreColor}-100 flex items-center justify-center`}>
                        <div className={`text-2xl text-${opCentreColor}-600`}>📊</div>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{opCentreName || 'Work Centre Name'}</h3>
                        <p className="text-sm text-gray-500">0 Work Boards • 0 Ticket Types</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Board Setup - v159: Redesigned */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Board Setup</h3>
                  <p className="text-sm text-gray-600 mb-6">
                    Configure your first board. You can create additional boards later.
                  </p>
                </div>

                {/* Board Name - v159: Required field */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Board Name *</label>
                  <input
                    type="text"
                    value={boardName}
                    onChange={(e) => setBoardName(e.target.value)}
                    placeholder="e.g., Development, Client Work, Service Jobs"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    autoFocus
                  />
                </div>

                {/* v159: Work Units checkbox - matches New Board Modal pattern */}
                <div className="pt-2">
                  <label className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                    <input
                      type="checkbox"
                      checked={enableWorkUnits}
                      onChange={(e) => setEnableWorkUnits(e.target.checked)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">Enable Work Units</div>
                      <div className="text-sm text-gray-600 mt-1">
                        Use sprints, phases, or monthly cycles to organise work
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {enableWorkUnits
                          ? "✓ You'll configure your work unit settings in the next step"
                          : 'Simple kanban board with stages only'}
                      </div>
                    </div>
                  </label>
                </div>

                {/* Info box */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    💡 A <strong>Task</strong> ticket type will be created automatically. You can add more ticket types
                    later from Work Centre Settings.
                  </p>
                </div>

                {/* Preview of what will be created */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="text-xs font-medium text-gray-500 mb-3">What will be created</div>
                  <div className="space-y-2 text-sm text-gray-700">
                    <div className="flex items-center gap-2">
                      <span className="text-green-600">✓</span>
                      <span>
                        Board: <strong>{boardName || '(enter name above)'}</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-600">✓</span>
                      <span>
                        Ticket Type: <strong>Task</strong>
                      </span>
                    </div>
                    {enableWorkUnits ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-green-600">✓</span>
                          <span>Planning zone for backlog management</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-green-600">✓</span>
                          <span>Work unit series (configured next)</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-green-600">✓</span>
                        <span>Stages: Planning → To Do → In Progress → Done</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Access Control */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Access Control</h3>
                  <p className="text-sm text-gray-600 mb-6">Choose who can access this Work Centre</p>
                </div>

                <div className="space-y-3">
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
                        Everyone in the company can access this Work Centre ({company.globalStaff.length} users)
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
                      <div className="text-sm text-gray-600 mb-3">Select which users can access this Work Centre</div>

                      {accessType === 'specific' && (
                        <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded p-2 bg-white">
                          {company.globalStaff.map((staff) => (
                            <label
                              key={staff.name}
                              className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={selectedUsers.includes(staff.name)}
                                onChange={() => handleToggleUser(staff.name)}
                              />
                              <span className="text-sm">{staff.name}</span>
                              <span className="text-xs text-gray-500">({staff.role})</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                </div>

                {accessType === 'specific' && selectedUsers.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm text-blue-800">
                      ✓ {selectedUsers.length} user{selectedUsers.length > 1 ? 's' : ''} will have access:{' '}
                      {selectedUsers.join(', ')}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Step 4: Work Unit Setup - v159: Only shown if enableWorkUnits is true */}
            {step === 4 && enableWorkUnits && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Work Unit Setup</h3>
                  <p className="text-sm text-gray-600 mb-6">Configure how you'll organise work into time periods</p>
                </div>

                {/* Work Unit Label */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    What do you call your work cycles?
                  </label>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {wuLabelOptions.map((option) => (
                      <button
                        key={option.label}
                        onClick={() => handleWuLabelSelect(option)}
                        className={`px-3 py-2 rounded-lg border-2 text-sm font-medium transition ${
                          wuLabel === option.label
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                            : 'border-gray-200 text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        {option.labelPlural}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">
                    Your work units will be named "{wuLabel} 1", "{wuLabel} 2", etc.
                  </p>
                </div>

                {/* Pattern Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Numbering Pattern</label>
                  <select
                    value={wuPatternType}
                    onChange={(e) => setWuPatternType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="sequential">
                      Sequential ({wuLabel} 1, {wuLabel} 2...)
                    </option>
                    <option value="yearly">
                      Yearly ({wuLabel} 1 2026, {wuLabel} 2 2026...)
                    </option>
                    <option value="months">Calendar Months (January, February...)</option>
                  </select>
                </div>

                {/* Starting Number */}
                {wuPatternType !== 'months' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Starting From</label>
                    <input
                      type="number"
                      min="1"
                      value={wuPatternStart}
                      onChange={(e) => setWuPatternStart(parseInt(e.target.value) || 1)}
                      className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}

                {/* v158a BUG 162-001 FIX: Editable Workflow Stages */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Workflow Stages (when {wuLabel.toLowerCase()} is active)
                    </label>
                    <button
                      onClick={() => {
                        setWuActiveStages([...wuActiveStages, { name: '', defaultStatus: 'in-progress' }]);
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100 transition"
                    >
                      {Plus && <Plus size={14} />}
                      Add Stage
                    </button>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    {wuActiveStages.length === 0 ? (
                      <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                        <p className="text-gray-500">No stages configured</p>
                        <p className="text-sm text-gray-400 mt-1">
                          Add at least one stage for your {wuLabelPlural.toLowerCase()}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {/* Column headers */}
                        <div className="grid grid-cols-[1fr_150px_80px] gap-2 mb-2 px-1 text-xs font-medium text-gray-500 uppercase">
                          <div>Stage Name</div>
                          <div>Default Status</div>
                          <div className="text-right">Actions</div>
                        </div>
                        {wuActiveStages.map((stage, idx) => (
                          <div key={idx} className="grid grid-cols-[1fr_150px_80px] gap-2 items-center">
                            {/* Stage Name */}
                            <input
                              type="text"
                              value={stage.name}
                              onChange={(e) => {
                                const newStages = [...wuActiveStages];
                                newStages[idx] = { ...stage, name: e.target.value };
                                setWuActiveStages(newStages);
                              }}
                              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                              placeholder="Stage name"
                            />

                            {/* Default Status */}
                            <select
                              value={stage.defaultStatus}
                              onChange={(e) => {
                                const newStages = [...wuActiveStages];
                                newStages[idx] = { ...stage, defaultStatus: e.target.value };
                                setWuActiveStages(newStages);
                              }}
                              className="px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                            >
                              <optgroup label="Backlog">
                                {(company?.statuses || [])
                                  .filter((s) => s.type === 'backlog')
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.label}
                                    </option>
                                  ))}
                              </optgroup>
                              <optgroup label="Scoped">
                                {(company?.statuses || [])
                                  .filter((s) => s.type === 'scoped')
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.label}
                                    </option>
                                  ))}
                              </optgroup>
                              <optgroup label="Queued">
                                {(company?.statuses || [])
                                  .filter((s) => s.type === 'queued')
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.label}
                                    </option>
                                  ))}
                              </optgroup>
                              <optgroup label="Active">
                                {(company?.statuses || [])
                                  .filter((s) => s.type === 'active')
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.label}
                                    </option>
                                  ))}
                              </optgroup>
                              <optgroup label="Completed">
                                {(company?.statuses || [])
                                  .filter((s) => s.type === 'completed')
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.label}
                                    </option>
                                  ))}
                              </optgroup>
                              <optgroup label="Ended">
                                {(company?.statuses || [])
                                  .filter((s) => s.type === 'ended')
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.label}
                                    </option>
                                  ))}
                              </optgroup>
                            </select>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => {
                                  if (idx === 0) return;
                                  const newStages = [...wuActiveStages];
                                  [newStages[idx - 1], newStages[idx]] = [newStages[idx], newStages[idx - 1]];
                                  setWuActiveStages(newStages);
                                }}
                                disabled={idx === 0}
                                className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Move up"
                              >
                                ↑
                              </button>
                              <button
                                onClick={() => {
                                  if (idx === wuActiveStages.length - 1) return;
                                  const newStages = [...wuActiveStages];
                                  [newStages[idx], newStages[idx + 1]] = [newStages[idx + 1], newStages[idx]];
                                  setWuActiveStages(newStages);
                                }}
                                disabled={idx === wuActiveStages.length - 1}
                                className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Move down"
                              >
                                ↓
                              </button>
                              <button
                                onClick={() => {
                                  if (wuActiveStages.length <= 1) return;
                                  setWuActiveStages(wuActiveStages.filter((_, i) => i !== idx));
                                }}
                                disabled={wuActiveStages.length <= 1}
                                className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Delete"
                              >
                                {Trash2 ? <Trash2 size={16} /> : '🗑'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm text-green-800">
                    ✓ Ready to create! Your first {wuLabel.toLowerCase()} can be started from the board view.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer - v159: Updated for dynamic step count */}
          <div className="p-6 border-t border-gray-200 flex items-center justify-between">
            <div>
              {step > 1 && (
                <button
                  onClick={() => setStep(step - 1)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                >
                  ← Back
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                Cancel
              </button>
              {step < totalSteps ? (
                <button
                  onClick={() => setStep(step + 1)}
                  disabled={!canProceed()}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={!canProceed()}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  Create Work Centre
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // BoardSelectionModal - unchanged from v155
  const BoardSelectionModal = ({ opCentres, currentOpCentreId, currentBoardId, onSelect, onClose }) => {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-2xl w-full max-h-[70vh] overflow-hidden flex flex-col">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Switch Board</h2>
          </div>
          <div className="p-6 overflow-y-auto">
            <div className="space-y-4">
              {opCentres.map((oc) => (
                <div key={oc.id}>
                  <h3 className="text-sm font-medium text-gray-500 mb-2">{oc.name}</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {oc.processBoards.map((board) => (
                      <button
                        key={board.id}
                        onClick={() => onSelect(oc.id, board.id)}
                        className={`p-3 text-left rounded-lg border-2 transition ${
                          board.id === currentBoardId
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="font-medium text-gray-900">{board.name}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {board.workZones?.length || 0} zones • {board.allowedTicketTypes?.length || 0} types
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="p-6 border-t border-gray-200">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  // OpCentreSettingsModal - v160: Fixed prop name
  const OpCentreSettingsModal = ({ opCentre, company, onSave, onClose, onConfigureBoard, onOpenTicketTypeModal }) => {
    const [activeTab, setActiveTab] = useState('general');
    const [name, setName] = useState(opCentre.name);
    const [color, setColor] = useState(opCentre.color);

    // For New Board modal
    const [showNewBoardModal, setShowNewBoardModal] = useState(false);
    const [newBoardEnableWorkUnits, setNewBoardEnableWorkUnits] = useState(false); // v159: Default OFF

    // For Work Unit Config modal (shown after creating work unit board)
    const [showWorkUnitConfigModal, setShowWorkUnitConfigModal] = useState(false);
    const [pendingNewBoard, setPendingNewBoard] = useState(null);

    // For Ticket Type modal
    const [showTicketTypeModal, setShowTicketTypeModal] = useState(false);
    const [editingTicketType, setEditingTicketType] = useState(null);

    // Import TicketTypeModal at render time
    const TicketTypeModal = window.Components?.TicketTypeModal;
    const ConfirmationModal = window.Components?.ConfirmModals?.ConfirmationModal;
    const Plus = window.Icons?.Plus;

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [boardToDelete, setBoardToDelete] = useState(null);

    // v161: Local color options for board color dropdown (don't use window.BOARD_COLORS which may be wrong type)
    const BOARD_COLORS = [
      { name: 'blue', label: 'Blue' },
      { name: 'indigo', label: 'Indigo' },
      { name: 'purple', label: 'Purple' },
      { name: 'pink', label: 'Pink' },
      { name: 'red', label: 'Red' },
      { name: 'orange', label: 'Orange' },
      { name: 'yellow', label: 'Yellow' },
      { name: 'green', label: 'Green' },
      { name: 'teal', label: 'Teal' },
      { name: 'cyan', label: 'Cyan' },
    ];

    const colorOptions = [
      { name: 'indigo', label: 'Indigo', hex: '#6366f1' },
      { name: 'blue', label: 'Blue', hex: '#3b82f6' },
      { name: 'emerald', label: 'Emerald', hex: '#10b981' },
      { name: 'purple', label: 'Purple', hex: '#8b5cf6' },
      { name: 'pink', label: 'Pink', hex: '#ec4899' },
      { name: 'orange', label: 'Orange', hex: '#f59e0b' },
      { name: 'teal', label: 'Teal', hex: '#14b8a6' },
      { name: 'red', label: 'Red', hex: '#ef4444' },
    ];

    const hasChanges = name !== opCentre.name || color !== opCentre.color;

    const handleSave = () => {
      onSave({ ...opCentre, name, color });
    };

    const handleDeleteBoard = (board) => {
      setBoardToDelete(board);
      setShowDeleteConfirm(true);
    };

    const confirmDeleteBoard = () => {
      if (boardToDelete) {
        const updatedBoards = opCentre.processBoards.filter((b) => b.id !== boardToDelete.id);
        onSave({ ...opCentre, processBoards: updatedBoards });
        setBoardToDelete(null);
        setShowDeleteConfirm(false);
      }
    };

    // v159: Handle new board creation with Work Unit config flow
    const handleCreateBoard = (formData, enableWorkUnits) => {
      const zoneId = `zone-${Date.now()}`;
      const boardId = `board-${Date.now()}`;

      let newBoard;
      if (enableWorkUnits) {
        // Work unit board with Planning zone
        newBoard = {
          id: boardId,
          name: formData.get('boardName'),
          color: formData.get('boardColor') || 'blue',
          access: { type: 'inherit', users: [] },
          allowedTicketTypes: ['type-task'], // v159: Auto-enable Task
          workZones: [
            {
              id: zoneId,
              name: 'Planning', // v159: Use "Planning"
              type: 'backlog',
              workStages: [
                { name: 'New', defaultStatus: 'new' },
                { name: 'Planning', defaultStatus: 'backlog' },
              ],
            },
          ],
          defaultZone: zoneId,
          defaultStage: 'New',
          workUnitSeries: {
            id: `series-${Date.now()}`,
            enabled: true,
            label: 'Sprint',
            labelPlural: 'Sprints',
            patternType: 'sequential',
            patternStart: 1,
            patternStartYear: new Date().getFullYear(),
            allowOverlap: false,
            backlogZoneId: zoneId,
            currentSequence: 1,
            activeStages: [
              { name: 'To Do', defaultStatus: 'todo' },
              { name: 'In Progress', defaultStatus: 'in-progress' },
              { name: 'Done', defaultStatus: 'completed' },
            ],
          },
          fieldOverrides: {},
        };
      } else {
        // v159: Simple board with Planning as first stage
        newBoard = {
          id: boardId,
          name: formData.get('boardName'),
          color: formData.get('boardColor') || 'blue',
          access: { type: 'inherit', users: [] },
          allowedTicketTypes: ['type-task'], // v159: Auto-enable Task
          workZones: [
            {
              id: zoneId,
              name: 'Default',
              type: 'kanban',
              isSystemZone: true,
              workStages: [
                { name: 'Planning', defaultStatus: 'backlog' }, // v159: Added Planning
                { name: 'To Do', defaultStatus: 'todo' },
                { name: 'In Progress', defaultStatus: 'in-progress' },
                { name: 'Done', defaultStatus: 'completed' },
              ],
            },
          ],
          defaultZone: zoneId,
          defaultStage: 'Planning', // v159: Default to Planning
          workUnitSeries: null,
          fieldOverrides: {},
        };
      }

      return newBoard;
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-4xl w-full h-[80vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Work Centre Settings: {opCentre.name}</h2>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-200">
            <div className="flex gap-1 px-6">
              <button
                onClick={() => setActiveTab('general')}
                className={`px-4 py-3 font-medium text-sm border-b-2 transition ${
                  activeTab === 'general'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                General
              </button>
              <button
                onClick={() => setActiveTab('boards')}
                className={`px-4 py-3 font-medium text-sm border-b-2 transition ${
                  activeTab === 'boards'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Boards
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'general' && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Work Centre Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">Color Theme</label>
                  <div className="grid grid-cols-4 gap-3">
                    {colorOptions.map((c) => (
                      <button
                        key={c.name}
                        onClick={() => setColor(c.name)}
                        className={`flex items-center gap-2 p-3 rounded-lg border-2 transition ${
                          color === c.name ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="w-6 h-6 rounded-full" style={{ backgroundColor: c.hex }} />
                        <span className="text-sm font-medium text-gray-700">{c.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'boards' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Work Boards</h3>
                    <p className="text-sm text-gray-600 mt-1">Manage the Work Boards in this Work Centre</p>
                  </div>
                  <button
                    onClick={() => setShowNewBoardModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                  >
                    {Plus && <Plus size={16} />}
                    New Board
                  </button>
                </div>

                <div className="space-y-3">
                  {(opCentre.processBoards || []).map((board) => (
                    <div
                      key={board.id}
                      className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-lg bg-${board.color || 'gray'}-100 flex items-center justify-center`}
                        >
                          <div className={`w-6 h-6 rounded bg-${board.color || 'gray'}-500`} />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{board.name}</div>
                          <div className="text-xs text-gray-500">
                            {board.workZones?.length || 0} Work Zone{(board.workZones?.length || 0) !== 1 ? 's' : ''}
                            {' • '}
                            Types:{' '}
                            {board.allowedTicketTypes?.length > 0
                              ? board.allowedTicketTypes
                                  .map((typeId) => {
                                    const type = company.globalTicketTypes?.find((t) => t.id === typeId);
                                    return type?.name || typeId;
                                  })
                                  .join(', ')
                              : 'None'}
                          </div>
                          <div className="text-xs text-gray-400 flex items-center gap-1">
                            <span>🔗</span>
                            <span>Inherits Work Centre access</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onConfigureBoard(board)}
                          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition"
                          title="Edit Board"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteBoard(board)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                          title="Delete Board"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-gray-200 flex justify-between">
            <button
              onClick={() => {
                if (
                  confirm(
                    'Are you sure you want to delete this Work Centre? This will delete all boards and tickets within it.'
                  )
                ) {
                  onSave(null); // Signal deletion
                }
              }}
              className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition"
            >
              Delete Work Centre
            </button>
            <div className="flex gap-3">
              {activeTab === 'general' && (
                <button
                  onClick={handleSave}
                  disabled={!hasChanges}
                  className={`px-6 py-2 rounded-lg transition ${
                    hasChanges
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {hasChanges ? 'Save Changes' : 'No Changes'}
                </button>
              )}
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>

        {/* New Board Modal - v159: Updated with Planning stage */}
        {showNewBoardModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-lg max-w-lg w-full">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Create New Work Board</h2>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.target);
                  const newBoard = handleCreateBoard(formData, newBoardEnableWorkUnits);

                  const updatedOpCentre = {
                    ...opCentre,
                    processBoards: [...(opCentre.processBoards || []), newBoard],
                  };
                  onSave(updatedOpCentre);
                  setNewBoardEnableWorkUnits(false);
                  setShowNewBoardModal(false);

                  // v159: If work units enabled, open board settings to configure
                  if (newBoardEnableWorkUnits) {
                    // Trigger opening board settings for the new board
                    setTimeout(() => {
                      onConfigureBoard(newBoard);
                    }, 100);
                  }
                }}
              >
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Board Name *</label>
                    <input
                      type="text"
                      name="boardName"
                      required
                      placeholder="e.g., Development Board, Support Queue"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Colour</label>
                    <select
                      name="boardColor"
                      defaultValue="blue"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    >
                      {BOARD_COLORS.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* v159: Work Units toggle */}
                  <div className="pt-2">
                    <label className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                      <input
                        type="checkbox"
                        checked={newBoardEnableWorkUnits}
                        onChange={(e) => setNewBoardEnableWorkUnits(e.target.checked)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">Enable Work Units</div>
                        <div className="text-sm text-gray-600 mt-1">
                          Use sprints, phases, or monthly cycles to organise work
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {newBoardEnableWorkUnits
                            ? '✓ Board will have a Planning zone and work unit management'
                            : 'Simple kanban board with stages only'}
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
                <div className="flex gap-3 px-6 py-4 border-t border-gray-200">
                  <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                    Create Board
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewBoardEnableWorkUnits(false);
                      setShowNewBoardModal(false);
                    }}
                    className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Ticket Type Modal - Sophisticated Version */}
        {showTicketTypeModal && TicketTypeModal && (
          <TicketTypeModal
            ticketType={editingTicketType}
            company={company}
            onSave={(ticketType) => {
              // Handle ticket type save
              setShowTicketTypeModal(false);
              setEditingTicketType(null);
            }}
            onClose={() => {
              setShowTicketTypeModal(false);
              setEditingTicketType(null);
            }}
          />
        )}

        {/* Delete Board Confirmation */}
        {showDeleteConfirm && ConfirmationModal && (
          <ConfirmationModal
            isOpen={showDeleteConfirm}
            onClose={() => setShowDeleteConfirm(false)}
            onConfirm={confirmDeleteBoard}
            title="Delete Work Board"
            message={`Are you sure you want to delete "${boardToDelete?.name}"? This will remove the board and all its configuration. Tickets will remain but will no longer be associated with this board.`}
            confirmText="Delete Board"
            type="danger"
          />
        )}
      </div>
    );
  };

  // Export components
  window.Components = window.Components || {};
  window.Components.OpCentreModals = {
    CreateOpCentreModal,
    BoardSelectionModal,
    OpCentreSettingsModal,
    version: COMPONENT_VERSION,
  };

  console.log(`[opcentre-modals.jsx] OpCentreModals loaded (${COMPONENT_VERSION})`);
})();

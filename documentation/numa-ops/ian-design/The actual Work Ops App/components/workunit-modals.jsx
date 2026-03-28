/**
 * Numa Ops Management - Work Unit Modals Component
 *
 * Components:
 * - StartWorkUnitModal: Modal to start a planning Work Unit
 * - WorkUnitSuccessModal: Success confirmation after starting
 * - CompleteWorkUnitModal: Modal to complete a Work Unit with rollover options
 *
 * Dependencies:
 * - React (useState)
 * - window.Icons (Play, Check, AlertCircle)
 *
 * Part of Stabilisation Sprint Phase 2
 * Version: v157
 *
 * v157 Changes:
 * - ARCHITECTURE: Start Sprint adds zone to SAME board (not create/select different board)
 * - Removed board selection UI entirely (matchingBoards, allOtherBoards, selectedDestinationBoardId)
 * - Removed "Create new board" option (showCreateBoard, newBoardName state)
 * - Removed onCreateBoard callback prop
 * - Simplified canStart logic (just workUnit selection + overlap check)
 * - Simplified handleStart (just calls onStart with workUnitId)
 * - Added informational panel showing what happens on start
 *
 * v153 Changes:
 * - Added component version registry support
 *
 * v150 Changes:
 * - IMP-001: Added null guards for work unit display
 *
 * v148 Changes:
 * - BUG-147-002 FIX: Always show "Create Next Sprint" option regardless of incomplete count
 */

(function () {
  'use strict';

  // v157: Component version for registry
  const COMPONENT_VERSION = 'v157';

  const { useState } = React;

  // Get icons from shared icons
  const { Play, Check, AlertCircle } = window.Icons;

  /**
   * StartWorkUnitModal
   * Modal for starting a planning Work Unit
   *
   * v157: Simplified - zone is added to the SAME board (no board selection needed)
   *
   * @param {object} config - Configuration with series, planningUnits, activeWorkUnit, selectedWorkUnitId
   * @param {function} setConfig - Function to update config state
   * @param {function} onStart - Called when Start button clicked (workUnitId, completeCurrentFirst)
   * @param {function} onCancel - Called when Cancel clicked
   */
  const StartWorkUnitModal = ({ config, setConfig, onStart, onCancel }) => {
    const { series, planningUnits, activeWorkUnit, selectedWorkUnitId } = config;

    const [completeCurrentFirst, setCompleteCurrentFirst] = useState(false);

    const selectedWorkUnit = planningUnits.find((wu) => wu.id === selectedWorkUnitId);

    // v157: Simplified - just need work unit selected and overlap handled
    const canStart = selectedWorkUnitId && (!activeWorkUnit || completeCurrentFirst || series.allowOverlap);

    // v157: Simplified - just pass workUnitId and completeCurrentFirst
    const handleStart = () => {
      if (!selectedWorkUnitId) return;
      onStart(selectedWorkUnitId, completeCurrentFirst);
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-md w-full">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Start {series.label || 'Work Unit'}</h2>
          </div>

          <div className="p-6 space-y-4">
            {/* Active Work Unit Warning */}
            {activeWorkUnit && !series.allowOverlap && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <span className="text-amber-600 text-xl">⚠️</span>
                  <div>
                    <div className="font-medium text-amber-900">{activeWorkUnit.name} is currently active</div>
                    <p className="text-sm text-amber-700 mt-1">
                      Only one {series.label || 'Work Unit'} can be active at a time.
                    </p>
                    <label className="flex items-center gap-2 mt-3">
                      <input
                        type="checkbox"
                        checked={completeCurrentFirst}
                        onChange={(e) => setCompleteCurrentFirst(e.target.checked)}
                        className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                      />
                      <span className="text-sm text-amber-800">Complete {activeWorkUnit.name} first</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Select Work Unit */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Which {series.label || 'Work Unit'} to start?
              </label>
              <select
                value={selectedWorkUnitId}
                onChange={(e) => setConfig({ ...config, selectedWorkUnitId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              >
                <option value="">Select...</option>
                {planningUnits.map((wu) => (
                  <option key={wu.id} value={wu.id}>
                    {wu.name}
                  </option>
                ))}
              </select>
            </div>

            {/* v157: Zone creation info (replaces board selection UI) */}
            {selectedWorkUnitId && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="text-sm text-blue-800">
                  <div className="font-medium mb-2">What happens when you start:</div>
                  <ul className="space-y-1.5 text-blue-700">
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5">→</span>
                      <span>
                        A new "<strong>{selectedWorkUnit?.name}</strong>" zone will be added to this board
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5">→</span>
                      <span>
                        Tickets assigned to this {series.label?.toLowerCase() || 'work unit'} will move to the new zone
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5">→</span>
                      <span>The planning stage will be removed from the backlog</span>
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-gray-200 flex gap-3 justify-end">
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleStart}
              disabled={!canStart}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Play size={18} />
              Start {series.label || 'Work Unit'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  /**
   * WorkUnitSuccessModal
   * Success confirmation shown after starting a Work Unit
   *
   * @param {object} workUnit - The started Work Unit
   * @param {object} series - The Work Unit Series config
   * @param {object} destinationBoard - The board the Work Unit was started on
   * @param {function} onViewOnBoard - Navigate to board
   * @param {function} onClose - Close modal
   */
  const WorkUnitSuccessModal = ({ workUnit, series, destinationBoard, onViewOnBoard, onClose }) => {
    const label = series?.label || 'Work Unit';

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-md w-full">
          <div className="p-6 border-b border-gray-200 bg-green-50">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <Check size={24} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-green-900">{label} Started!</h2>
                <p className="text-sm text-green-700">{workUnit.name} is now active</p>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-medium text-gray-900 mb-2">What happens now?</h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-1">✓</span>
                  <span>
                    A new zone "{workUnit.name}" has been created on {destinationBoard.name}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-1">✓</span>
                  <span>All tickets assigned to this {label.toLowerCase()} are now visible on the board</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-1">✓</span>
                  <span>The planning stage has been removed from the backlog</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="p-6 border-t border-gray-200 flex gap-3">
            <button
              onClick={onViewOnBoard}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
            >
              View on Board
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  /**
   * CompleteWorkUnitModal
   * Modal for completing a Work Unit with rollover options
   *
   * @param {object} config - Configuration with workUnit, series, tickets, rolloverTargets
   * @param {function} onComplete - Called when Complete button clicked
   * @param {function} onCancel - Called when Cancel clicked
   *
   * v148 - BUG-147-002 FIX: Always show "Create Next Sprint" option regardless of incomplete count
   */
  const CompleteWorkUnitModal = ({ config, onComplete, onCancel }) => {
    const { workUnit, series, incompleteTickets, completedTickets, rolloverTargets } = config;

    // v148: Default to 'complete-only' when no incomplete tickets, 'backlog' when there are
    const hasIncomplete = incompleteTickets?.length > 0;
    const [rolloverOption, setRolloverOption] = useState(hasIncomplete ? 'backlog' : 'complete-only');
    const [selectedTargetId, setSelectedTargetId] = useState(rolloverTargets?.[0]?.id || '');

    const label = series?.label || 'Work Unit';
    const totalTickets = (incompleteTickets?.length || 0) + (completedTickets?.length || 0);

    const handleComplete = () => {
      // v116: For auto-create, pass null as targetWorkUnitId - app.jsx will create it
      // v148: 'complete-only' is treated the same as 'keep' (no rollover action needed)
      const effectiveOption = rolloverOption === 'complete-only' ? 'keep' : rolloverOption;
      onComplete(workUnit.id, effectiveOption, effectiveOption === 'next' ? selectedTargetId : null);
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-lg w-full">
          <div className="p-6 border-b border-gray-200 bg-amber-50">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                <Check size={24} className="text-amber-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-amber-900">Complete {workUnit.name}?</h2>
                <p className="text-sm text-amber-700 mt-1">
                  This will mark the {label.toLowerCase()} as completed and remove its zone.
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4">
            {/* Ticket Summary */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="font-medium text-gray-900 mb-3">Ticket Summary</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                  <span className="text-gray-600">Completed:</span>
                  <span className="font-medium text-gray-900">{completedTickets?.length || 0}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 bg-amber-500 rounded-full"></span>
                  <span className="text-gray-600">Incomplete:</span>
                  <span className="font-medium text-gray-900">{incompleteTickets?.length || 0}</span>
                </div>
              </div>
              {totalTickets === 0 && (
                <p className="text-sm text-gray-500 mt-3 italic">No tickets in this {label.toLowerCase()}</p>
              )}
            </div>

            {/* v148: Restructured options section */}
            <div className="space-y-3">
              {/* v148: Section header changes based on whether there are incomplete tickets */}
              {hasIncomplete ? (
                <h3 className="font-medium text-gray-900">What should happen to incomplete tickets?</h3>
              ) : (
                <h3 className="font-medium text-gray-900">Completion Options</h3>
              )}

              {/* v148: Complete Only option - shown when NO incomplete tickets */}
              {!hasIncomplete && (
                <label
                  className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition ${
                    rolloverOption === 'complete-only'
                      ? 'border-amber-500 bg-amber-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="rolloverOption"
                    value="complete-only"
                    checked={rolloverOption === 'complete-only'}
                    onChange={(e) => setRolloverOption(e.target.value)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-gray-900">Complete {label}</div>
                    <div className="text-sm text-gray-600">Mark as completed. All tickets finished! 🎉</div>
                  </div>
                </label>
              )}

              {/* Move to Backlog - only show if there are incomplete tickets */}
              {hasIncomplete && (
                <label
                  className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition ${
                    rolloverOption === 'backlog' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="rolloverOption"
                    value="backlog"
                    checked={rolloverOption === 'backlog'}
                    onChange={(e) => setRolloverOption(e.target.value)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-gray-900">Move to Backlog</div>
                    <div className="text-sm text-gray-600">
                      Return incomplete tickets to the backlog for future planning
                    </div>
                  </div>
                </label>
              )}

              {/* Roll to Next - show when other work units exist AND there are incomplete tickets */}
              {hasIncomplete && rolloverTargets?.length > 0 && (
                <label
                  className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition ${
                    rolloverOption === 'next' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="rolloverOption"
                    value="next"
                    checked={rolloverOption === 'next'}
                    onChange={(e) => setRolloverOption(e.target.value)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">Roll to Next {label}</div>
                    <div className="text-sm text-gray-600 mb-2">
                      Move incomplete tickets to another {label.toLowerCase()}
                    </div>
                    {rolloverOption === 'next' && (
                      <select
                        value={selectedTargetId}
                        onChange={(e) => setSelectedTargetId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 text-sm"
                      >
                        {rolloverTargets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.name} ({target.status === 'active' ? 'Active' : 'Planning'})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </label>
              )}

              {/* v148: Create Next Sprint - ALWAYS show when NO other work units exist (regardless of incomplete count) */}
              {(!rolloverTargets || rolloverTargets.length === 0) && series && (
                <label
                  className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition ${
                    rolloverOption === 'auto-create'
                      ? 'border-amber-500 bg-amber-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="rolloverOption"
                    value="auto-create"
                    checked={rolloverOption === 'auto-create'}
                    onChange={(e) => setRolloverOption(e.target.value)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">
                      {hasIncomplete ? `Create Next ${label} and Roll Over` : `Create Next ${label}`}
                    </div>
                    <div className="text-sm text-gray-600">
                      {hasIncomplete
                        ? `Automatically create the next ${label.toLowerCase()} and move incomplete tickets to it`
                        : `Automatically create the next ${label.toLowerCase()} in the backlog`}
                    </div>
                  </div>
                </label>
              )}

              {/* Keep (Archive) - only show if there are incomplete tickets */}
              {hasIncomplete && (
                <label
                  className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition ${
                    rolloverOption === 'keep' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="rolloverOption"
                    value="keep"
                    checked={rolloverOption === 'keep'}
                    onChange={(e) => setRolloverOption(e.target.value)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-gray-900">Archive with {label}</div>
                    <div className="text-sm text-gray-600">
                      Tickets will be removed from the board but retain their {label.toLowerCase()} assignment for
                      historical tracking
                    </div>
                  </div>
                </label>
              )}
            </div>

            {/* Warning for incomplete tickets */}
            {hasIncomplete && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-amber-800">
                    <strong>
                      {incompleteTickets.length} ticket{incompleteTickets.length !== 1 ? 's' : ''}
                    </strong>{' '}
                    will be affected by this action.
                    {rolloverOption === 'keep' && ' They will no longer appear on any board.'}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-gray-200 flex gap-3 justify-end">
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleComplete}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition font-medium flex items-center gap-2"
            >
              <Check size={18} />
              Complete {label}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Export to window.Components namespace
  window.Components = window.Components || {};
  window.Components.WorkUnitModals = {
    StartWorkUnitModal,
    WorkUnitSuccessModal,
    CompleteWorkUnitModal,
  };

  // v157: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['workunit-modals'] = COMPONENT_VERSION;

  console.log(`[workunit-modals.jsx] WorkUnitModals loaded (${COMPONENT_VERSION})`);
})();

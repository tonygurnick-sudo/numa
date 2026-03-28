/**
 * Numa Ops Management - Confirm Modals Component
 *
 * Components:
 * - ConfirmationModal: Generic confirmation dialog for delete/confirm actions
 * - StagePickerModal: Modal for selecting stage when multiple match a status
 *
 * Dependencies:
 * - React (useState)
 * - window.Domain.Statuses.PREDEFINED_STATUSES
 * - window.globalCompany
 *
 * Part of Stabilisation Sprint Phase 2
 * Version: v153
 */

(function () {
  'use strict';

  // v153: Component version for registry
  const COMPONENT_VERSION = 'v153';

  const { useState } = React;

  // Get PREDEFINED_STATUSES from domain layer
  const { PREDEFINED_STATUSES } = window.Domain.Statuses;

  /**
   * ConfirmationModal
   * Generic confirmation dialog for delete/confirm actions
   *
   * @param {boolean} isOpen - Whether modal is visible
   * @param {function} onClose - Called when modal closes
   * @param {function} onConfirm - Called when confirm button clicked
   * @param {string} title - Modal title
   * @param {string} message - Modal message
   * @param {string} confirmText - Text for confirm button (default: 'Confirm')
   * @param {string} cancelText - Text for cancel button (default: 'Cancel')
   * @param {string} type - 'delete' for red button, otherwise indigo
   */
  const ConfirmationModal = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    type = 'delete',
  }) => {
    if (!isOpen) return null;

    const colorClasses = type === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700';

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-md w-full p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">{title}</h3>
          <p className="text-gray-600 mb-6">{message}</p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              {cancelText}
            </button>
            <button
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className={`px-4 py-2 text-white rounded-lg ${colorClasses}`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    );
  };

  /**
   * StagePickerModal
   * Modal for selecting which stage to move a ticket to
   * when multiple stages map to the same status
   *
   * @param {object} config - Configuration object with:
   *   - newStatusId: The status being changed to
   *   - matches: Array of { zoneId, zoneName, stageName } matches
   * @param {function} onSelect - Called with selected match when Move clicked
   * @param {function} onCancel - Called when Cancel clicked
   */
  const StagePickerModal = ({ config, onSelect, onCancel }) => {
    const [selectedMatch, setSelectedMatch] = useState(null);
    const company = window.globalCompany;
    const statuses = company?.statuses || PREDEFINED_STATUSES;

    if (!config) return null;

    const newStatus = statuses.find((s) => s.id === config.newStatusId);

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
        <div className="bg-white rounded-lg max-w-md w-full">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Move Ticket</h2>
          </div>

          <div className="p-6">
            <p className="text-sm text-gray-600 mb-4">
              Multiple stages match the status "<strong>{newStatus?.label || config.newStatusId}</strong>". Where should
              this ticket go?
            </p>

            <div className="space-y-2">
              {config.matches.map((match, idx) => (
                <label
                  key={`${match.zoneId}-${match.stageName}`}
                  className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedMatch === idx
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="stageChoice"
                    checked={selectedMatch === idx}
                    onChange={() => setSelectedMatch(idx)}
                    className="mr-3"
                  />
                  <div>
                    <div className="font-medium text-gray-900">{match.stageName}</div>
                    <div className="text-xs text-gray-500">{match.zoneName}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => selectedMatch !== null && onSelect(config.matches[selectedMatch])}
              disabled={selectedMatch === null}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Move
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Export to window.Components namespace
  window.Components = window.Components || {};
  window.Components.ConfirmModals = {
    ConfirmationModal,
    StagePickerModal,
  };

  // v153: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['confirm-modals'] = COMPONENT_VERSION;

  console.log(`[confirm-modals.jsx] ConfirmModals loaded (${COMPONENT_VERSION})`);
})();

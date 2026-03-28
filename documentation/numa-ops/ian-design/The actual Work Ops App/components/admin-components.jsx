/**
 * Admin Components - Extracted from app.jsx v090
 * Contains: ProcessBoardAccessModal, AdminPanel
 *
 * Extraction Date: 2025-01-07
 * Version: v167a
 *
 * v167a Changes:
 * - Added "Extract JSON" button to Test Tools for targeted data extraction
 * - Added openTargetedJsonExtractor prop to AdminPanel
 *
 * v153 Changes:
 * - Added "Copy Versions" button to Test Tools
 * - Collects all component versions from window.ComponentVersions registry
 * - Copies formatted version list to clipboard
 *
 * v138 Changes:
 * - BUG-136-002 FIX: Test Tools "Current User" dropdown now uses staff ID
 *   - Changed option value from staff.name to staff.id
 *   - Enables "Assigned to Me" filter to work correctly
 *
 * v101 Changes:
 * - Added "All Tickets" button to Global Resources grid
 * - Added onOpenAllTickets prop to AdminPanel
 */

(function () {
  'use strict';

  // v167a: Component version for registry
  const COMPONENT_VERSION = 'v167a';

  const { useState } = React;
  const { ChevronUp, ChevronDown, Settings, BarChart3, Edit2, Trash2 } = window.Icons;

  const ProcessBoardAccessModal = ({ board, opCentre, company, onSave, onClose }) => {
    const [accessType, setAccessType] = useState(board.access?.type || 'inherit');
    const [selectedUsers, setSelectedUsers] = useState(board.access?.users || []);

    const handleToggleUser = (userName) => {
      if (selectedUsers.includes(userName)) {
        setSelectedUsers(selectedUsers.filter((u) => u !== userName));
      } else {
        setSelectedUsers([...selectedUsers, userName]);
      }
    };

    const handleSave = () => {
      const updatedBoard = {
        ...board,
        access: {
          type: accessType,
          users: accessType === 'specific' ? selectedUsers : [],
        },
      };
      onSave(updatedBoard);
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Work Board Access: {board.name}</h2>
            <p className="text-sm text-gray-600 mt-1">Work Centre: {opCentre.name}</p>
          </div>

          <div className="p-6 space-y-6">
            {/* Access Control Section */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Access Control</h3>
              <p className="text-sm text-gray-600 mb-4">Control who can access this specific Work Board</p>

              {/* Access Type Selector */}
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
                      {opCentre.access?.type === 'all' && <span className="text-indigo-600"> (All NUMA Users)</span>}
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

                    {/* User Selector */}
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

              {/* Warning for specific access */}
              {accessType === 'specific' && selectedUsers.length === 0 && (
                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    ⚠️ No users selected. This board will be inaccessible to everyone except admins.
                  </p>
                </div>
              )}
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-blue-900 mb-2">💡 Board vs Work Centre Access</h4>
              <p className="text-sm text-blue-800">
                Users need access to BOTH the Work Centre AND the specific board to see it. Board-level access can be
                MORE restrictive but not less restrictive than Work Centre access.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="p-6 border-t border-gray-200 flex gap-3">
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
            >
              Save Changes
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  const AdminPanel = ({
    company,
    opCentres,
    onEnterOpCentre,
    onOpenGlobalSettings,
    onOpenGlobalSettingsTab,
    onOpenOpCentreSettings,
    onOpenBoardSettings,
    onCreateOpCentre,
    onOpenAllTickets,
    currentUser,
    setCurrentUser,
    clearLocalStorage,
    clearAllLocalStorage,
    factoryReset,
    exportData,
    importData,
    exportDataSnapshot,
    openTargetedJsonExtractor,
    fixTicketHierarchy,
    tickets,
  }) => {
    const [showAdminTools, setShowAdminTools] = useState(false);

    return (
      <div className="h-screen flex flex-col bg-gray-50">
        {/* Admin Tools - Fixed at top */}
        <div className="flex-shrink-0 bg-yellow-50 border-b border-yellow-200">
          <div className="max-w-7xl mx-auto px-6 py-2">
            <button
              onClick={() => setShowAdminTools(!showAdminTools)}
              className="text-xs text-yellow-700 hover:text-yellow-900 font-medium"
            >
              {showAdminTools ? '▼' : '▶'} TEST TOOLS
            </button>

            {showAdminTools && (
              <div className="mt-2 space-y-2">
                <div className="mb-2 flex items-center gap-2">
                  <label className="text-xs text-yellow-700 font-medium">Current User:</label>
                  <select
                    value={currentUser}
                    onChange={(e) => setCurrentUser(e.target.value)}
                    className="text-xs bg-white border border-gray-300 px-2 py-1 rounded"
                  >
                    {company.globalStaff.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <button
                    onClick={() => clearLocalStorage('arcanum_opcentres')}
                    className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 text-left"
                  >
                    🗑️ Clear Work Centres
                  </button>
                  <button
                    onClick={() => clearLocalStorage('arcanum_active_opcentre')}
                    className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 text-left"
                  >
                    🗑️ Clear Active Work Centre
                  </button>
                  <button
                    onClick={() => clearLocalStorage('arcanum_company')}
                    className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 text-left"
                  >
                    🗑️ Clear Company (Global)
                  </button>
                  <button
                    onClick={() => clearLocalStorage('arcanum_tickets')}
                    className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 text-left"
                  >
                    🗑️ Clear Tickets
                  </button>
                  <button
                    onClick={fixTicketHierarchy}
                    className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 text-left font-medium"
                  >
                    🔧 Fix Ticket Hierarchy
                  </button>

                  {/* Import/Export Section */}
                  <div className="border-t border-gray-300 pt-2 mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={importData}
                      className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 text-left font-medium"
                    >
                      📥 Import Data
                    </button>
                    <button
                      onClick={exportData}
                      className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 text-left font-medium"
                    >
                      📤 Export Data
                    </button>
                    <button
                      onClick={exportDataSnapshot}
                      className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 text-left font-medium"
                    >
                      📋 Copy JSON
                    </button>
                    <button
                      onClick={openTargetedJsonExtractor}
                      className="text-xs bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 text-left font-medium"
                    >
                      🎯 Extract JSON
                    </button>
                    <button
                      onClick={() => {
                        // v153: Collect all component versions from registry
                        const versions = window.ComponentVersions || {};
                        const lines = Object.entries(versions)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([name, version]) => `${name}: ${version}`);
                        const text = `Numa Ops Component Versions\n${'='.repeat(30)}\n${lines.join('\n')}`;
                        navigator.clipboard
                          .writeText(text)
                          .then(() => {
                            alert('Component versions copied to clipboard!');
                          })
                          .catch((err) => {
                            console.error('Failed to copy:', err);
                            alert('Failed to copy to clipboard. Check console for versions.');
                            console.log(text);
                          });
                      }}
                      className="text-xs bg-teal-600 text-white px-2 py-1 rounded hover:bg-teal-700 text-left font-medium"
                    >
                      🔢 Copy Versions
                    </button>
                  </div>

                  {/* Danger Zone */}
                  <div className="border-t border-gray-300 pt-2 mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={clearAllLocalStorage}
                      className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 text-left font-medium"
                    >
                      🗑️ Clear ALL (Reset)
                    </button>
                    <button
                      onClick={factoryReset}
                      className="text-xs bg-purple-700 text-white px-2 py-1 rounded hover:bg-purple-800 text-left font-bold"
                    >
                      ⚠️ FACTORY RESET
                    </button>
                  </div>

                  <div className="text-xs text-gray-600 px-2 py-1">
                    Items: {tickets?.length || 0} tickets, {company.globalCRM.length} customers
                  </div>
                </div>
                <div className="text-xs text-gray-500 italic bg-white px-3 py-2 rounded border border-gray-200">
                  <strong>Fix Ticket Hierarchy:</strong> Adds missing opCentreId/boardId/zoneId to tickets. Run this if
                  tickets don't show when filtering by customer. <strong>Factory Reset:</strong> Clears everything and
                  starts with empty Work Centre. Perfect for testing "new customer" experience.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Header - Fixed */}
        <div className="flex-shrink-0 bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{company.name}</h1>
                <p className="text-sm text-gray-500 mt-1">NUMA Admin Panel</p>
              </div>
              <button
                onClick={onOpenGlobalSettings}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
              >
                <Settings size={20} />
                Global Settings
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-6 py-8">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4 mb-8">
              <div className="bg-white p-6 rounded-lg border border-gray-200">
                <div className="text-2xl font-bold text-gray-900">{opCentres.length}</div>
                <div className="text-sm text-gray-500">Work Centres</div>
              </div>
              <div className="bg-white p-6 rounded-lg border border-gray-200">
                <div className="text-2xl font-bold text-gray-900">{company.globalProjects.length}</div>
                <div className="text-sm text-gray-500">Projects</div>
              </div>
              <div className="bg-white p-6 rounded-lg border border-gray-200">
                <div className="text-2xl font-bold text-gray-900">{company.globalStaff.length}</div>
                <div className="text-sm text-gray-500">Staff Members</div>
              </div>
              <div className="bg-white p-6 rounded-lg border border-gray-200">
                <div className="text-2xl font-bold text-gray-900">{company.globalCRM.length}</div>
                <div className="text-sm text-gray-500">Customers</div>
              </div>
            </div>

            {/* Global Resources - Above Work Centres */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Global Resources</h2>
              <div className="grid grid-cols-4 gap-4">
                <button
                  onClick={() => onOpenGlobalSettingsTab('projects')}
                  className="bg-white p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition text-left"
                >
                  <div className="text-base font-semibold text-gray-900 mb-1">📦 Manage Projects</div>
                  <div className="text-sm text-gray-500">Create and organise global projects</div>
                </button>
                <button
                  onClick={() => onOpenGlobalSettingsTab('staff')}
                  className="bg-white p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition text-left"
                >
                  <div className="text-base font-semibold text-gray-900 mb-1">👥 Manage Staff</div>
                  <div className="text-sm text-gray-500">Add and manage team members</div>
                </button>
                <button
                  onClick={() => onOpenGlobalSettingsTab('crm')}
                  className="bg-white p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition text-left"
                >
                  <div className="text-base font-semibold text-gray-900 mb-1">🏢 View Global CRM</div>
                  <div className="text-sm text-gray-500">See all customers company-wide</div>
                </button>
                <button
                  onClick={onOpenAllTickets}
                  className="bg-white p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition text-left"
                >
                  <div className="text-base font-semibold text-gray-900 mb-1">📋 All Tickets</div>
                  <div className="text-sm text-gray-500">View and manage all work items</div>
                </button>
              </div>
            </div>

            {/* Work Centres Header - Sticky within scroll */}
            <div className="sticky top-0 bg-gray-50 py-4 -mx-6 px-6 z-10">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">Work Centres</h2>
                <button
                  onClick={onCreateOpCentre}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  + New Work Centre
                </button>
              </div>
            </div>

            {/* Work Centres Grid */}
            {opCentres.length === 0 ? (
              <div className="bg-white p-12 rounded-lg border-2 border-dashed border-gray-300 text-center">
                <div className="text-gray-400 mb-4">
                  <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Work Centres Yet</h3>
                <p className="text-gray-500 mb-4">Create your first Work Centre to start organising work</p>
                <button
                  onClick={onCreateOpCentre}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  Create Your First Work Centre
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-4 pb-8">
                {opCentres.map((oc) => {
                  const boardCount = oc.processBoards?.length || 0;
                  return (
                    <div
                      key={oc.id}
                      className="bg-white p-4 rounded-lg border-2 border-gray-200 hover:border-indigo-500 hover:shadow-lg transition group"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className={`w-8 h-8 rounded-lg bg-${oc.color}-100 flex items-center justify-center`}>
                          <div className={`text-lg text-${oc.color}-600`}>📊</div>
                        </div>
                      </div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2 line-clamp-2">{oc.name}</h3>
                      <div className="space-y-1 text-xs text-gray-500 mb-3">
                        <div>
                          {boardCount} Board{boardCount !== 1 ? 's' : ''}
                        </div>
                        <div>{oc.staffList?.length || 0} Staff</div>
                        {oc.access?.type === 'specific' && (
                          <div className="text-xs text-indigo-600 font-medium">
                            🔒 {oc.access.users.length} user{oc.access.users.length !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="space-y-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenOpCentreSettings(oc);
                          }}
                          className="w-full text-left px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded transition border border-indigo-200"
                        >
                          ⚙️ Settings
                        </button>
                        <button
                          onClick={() => onEnterOpCentre(oc.id)}
                          className="w-full text-center px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded transition"
                        >
                          Open →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Export to window
  window.Components = window.Components || {};
  window.Components.AdminComponents = {
    ProcessBoardAccessModal,
    AdminPanel,
  };

  // v167a: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['admin-components'] = COMPONENT_VERSION;

  console.log(`[admin-components.jsx] AdminComponents loaded (${COMPONENT_VERSION})`);
})();

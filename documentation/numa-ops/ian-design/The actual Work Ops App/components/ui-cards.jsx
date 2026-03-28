/**
 * UI Card Components - Extracted from app.jsx v090
 * Contains: CustomerTicketsView (renamed from AllTicketsView in v097),
 *           KanbanColumn, BacklogColumn, CRMColumn,
 *           TicketCard, CustomerCard, RichTextToolbar, AttachmentThumbnail, CommentItem
 *
 * Extraction Date: 2025-01-07
 * Version: v179c
 *
 * v179c Changes (L4 - Link indicators on cards):
 * - TicketCard: Added ⏳ Depends indicator when ticket has unresolved dependencies
 * - TicketCard: Added 🚫 Blocking indicator when ticket blocks other open tickets
 * - Indicators appear as small badges on the card, visible without opening ticket
 *
 * v163d Changes (Session 83 - all flickering fixes):
 * - v163a: Initial positional drag-drop implementation
 * - v163b: Dead zone (middle 30%) on cards prevents midpoint flickering
 * - v163c: pointer-events-none on drop indicator
 * - v163d: Absolute positioning for drop indicator prevents layout shift
 *   - Indicator overlays cards instead of inserting between them
 *   - Eliminates the feedback loop that caused rapid flickering
 *   - Applied to KanbanColumn, BacklogColumn, and CRMColumn
 *
 * v163a Features:
 * - POSITIONAL DRAG-DROP: Items can be dropped at specific positions within columns
 *   - KanbanColumn/BacklogColumn: dropTarget, onTicketDragOver, highlightedTicketId props
 *   - CRMColumn: dropTarget, onCustomerDragOver, highlightedCustomerId props
 *   - Visual drop indicator (blue line) shows insertion point during drag
 *   - Moved items get highlight ring (clears on click)
 *   - TicketCard/CustomerCard detect top/bottom half for precise drop positioning
 *
 * v158a Changes:
 * - Added onContextMenu prop to TicketCard, KanbanColumn, BacklogColumn
 * - Right-click on ticket card triggers context menu callback
 * - Supports right-click context menu feature
 *
 * v153 Changes:
 * - Added component version registry support
 *
 * v147 Changes:
 * - Firefox drag fix (setData at drag origin)
 *
 * REFACTOR-001: AllTicketsView renamed to CustomerTicketsView
 * - This component shows tickets filtered by a specific CRM customer
 * - The name "AllTicketsView" was misleading
 * - True All Tickets view will be a separate component (Phase 6.5)
 */

(function () {
  'use strict';

  // v163a: Component version for registry
  const COMPONENT_VERSION = 'v179c';

  const { useState } = React;
  const { ChevronUp, ChevronDown, Edit2, Trash2, X } = window.Icons;

  const CustomerTicketsView = ({
    tickets,
    filterClient,
    filterClientScope,
    activeOpCentreId,
    opCentres,
    company,
    onEditTicket,
    onDeleteTicket,
    getInitialsColor,
  }) => {
    const [statusFilter, setStatusFilter] = useState('open'); // 'open', 'closed', 'all'

    // Get all tickets for the filtered client
    const getClientTickets = () => {
      return tickets.filter((t) => {
        // Client match
        if (t.client !== filterClient) return false;

        // Scope match
        if (filterClientScope.startsWith('board-')) {
          const boardId = filterClientScope.replace('board-', '');
          return t.boardId === boardId;
        } else if (filterClientScope === 'this-opcentre') {
          return t.opCentreId === activeOpCentreId;
        } else {
          return true; // all-opcentres
        }
      });
    };

    // Apply status filter
    const getStatusFilteredTickets = () => {
      const clientTickets = getClientTickets();

      if (statusFilter === 'open') {
        return clientTickets.filter((t) => !['Done', 'Closed', "Won't Do"].includes(t.column || t.stage));
      } else if (statusFilter === 'closed') {
        return clientTickets.filter((t) => ['Done', 'Closed', "Won't Do"].includes(t.column || t.stage));
      } else {
        return clientTickets; // 'all'
      }
    };

    const displayTickets = getStatusFilteredTickets();
    const allClientTickets = getClientTickets();

    // Get ticket location info
    const getTicketLocation = (ticket) => {
      const opCentre = opCentres.find((oc) => oc.id === ticket.opCentreId);
      const board = opCentre?.processBoards?.find((b) => b.id === ticket.boardId);
      const zone = board?.workZones?.find((z) => z.id === ticket.zoneId);

      return {
        opCentre: opCentre?.name || 'Unknown',
        board: board?.name || 'Unknown',
        zone: zone?.name || 'Unknown',
        stage: ticket.column || ticket.stage || 'Unknown',
      };
    };

    // v072: Get ticket type info from typeId
    const getTicketTypeInfo = (ticket) => {
      const ticketType = company?.globalTicketTypes?.find((tt) => tt.id === ticket.typeId);
      return ticketType || { name: 'Unknown', icon: '📄', color: 'gray' };
    };

    // Get customer name
    const customerName = company.globalCRM.find((c) => c.id === filterClient)?.companyName || filterClient;

    // Calculate counts
    const openCount = allClientTickets.filter(
      (t) => !['Done', 'Closed', "Won't Do"].includes(t.column || t.stage)
    ).length;
    const closedCount = allClientTickets.filter((t) =>
      ['Done', 'Closed', "Won't Do"].includes(t.column || t.stage)
    ).length;

    return (
      <div>
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">All Tickets for {customerName}</h2>
          <p className="text-sm text-gray-600">
            Showing tickets{' '}
            {filterClientScope.startsWith('board-')
              ? `in ${opCentres.find((oc) => oc.id === activeOpCentreId)?.processBoards?.find((b) => b.id === filterClientScope.replace('board-', ''))?.name || 'Board'}`
              : filterClientScope === 'this-opcentre'
                ? `in ${opCentres.find((oc) => oc.id === activeOpCentreId)?.name || 'Work Centre'}`
                : 'across all Work Centres'}
          </p>
        </div>

        {/* Filter Controls */}
        <div className="mb-6 bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex gap-4 items-center flex-wrap">
            {/* Status Filter */}
            <div className="flex gap-2">
              <button
                onClick={() => setStatusFilter('open')}
                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition ${
                  statusFilter === 'open'
                    ? 'bg-green-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Open ({openCount})
              </button>
              <button
                onClick={() => setStatusFilter('closed')}
                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition ${
                  statusFilter === 'closed'
                    ? 'bg-gray-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Closed ({closedCount})
              </button>
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition ${
                  statusFilter === 'all'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All ({allClientTickets.length})
              </button>
            </div>

            {/* Ticket Count */}
            <div className="ml-auto text-sm text-gray-600 font-medium">
              {displayTickets.length} ticket{displayTickets.length !== 1 ? 's' : ''} shown
            </div>
          </div>
        </div>

        {/* Tickets List */}
        {displayTickets.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
            <div className="text-gray-400 mb-4">
              <Search size={48} className="mx-auto opacity-50" />
            </div>
            <p className="text-lg text-gray-600 mb-2 font-medium">No tickets found</p>
            <p className="text-sm text-gray-500">Try adjusting your filters or scope</p>
          </div>
        ) : (
          <div className="space-y-2">
            {displayTickets.map((ticket) => {
              const location = getTicketLocation(ticket);
              const isDone = ['Done', 'Closed', "Won't Do"].includes(ticket.column || ticket.stage);

              return (
                <div
                  key={ticket.id}
                  onClick={() => onEditTicket(ticket)}
                  className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md hover:border-gray-300 cursor-pointer transition-all"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-xs font-mono text-gray-500 font-medium">{ticket.id}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-medium ${
                            isDone ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'
                          }`}
                        >
                          {ticket.column || ticket.stage}
                        </span>
                        {ticket.priority && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-medium ${
                              ticket.priority === 'Highest' || ticket.priority === 'High'
                                ? 'bg-red-100 text-red-700'
                                : ticket.priority === 'Medium'
                                  ? 'bg-orange-100 text-orange-700'
                                  : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {ticket.priority}
                          </span>
                        )}
                        {/* v072: Standardised on typeId field */}
                        {ticket.typeId &&
                          (() => {
                            const typeInfo = getTicketTypeInfo(ticket);
                            return (
                              <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
                                {typeInfo.icon} {typeInfo.name}
                              </span>
                            );
                          })()}
                      </div>

                      <h4 className="font-medium text-gray-900 mb-2 text-base">{ticket.name}</h4>

                      <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <span>📍</span>
                          <span className="truncate">
                            {location.opCentre} › {location.board} › {location.zone}
                          </span>
                        </span>
                        {ticket.assignee && ticket.assignee !== 'Unassigned' && (
                          <span className="flex items-center gap-1">
                            <span>👤</span>
                            <span>{ticket.assignee}</span>
                          </span>
                        )}
                        {ticket.effortPoints && (
                          <span className="flex items-center gap-1">
                            <span>📊</span>
                            <span>{ticket.effortPoints} pts</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTicket(ticket.id);
                      }}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition flex-shrink-0"
                      title="Delete ticket"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // v163a: Added dropTarget, onTicketDragOver, highlightedTicketId for positional drag-drop
  const KanbanColumn = ({
    column,
    items,
    sectionId,
    onDragStart,
    onDragOver,
    onDrop,
    onEdit,
    onDelete,
    getInitialsColor,
    onContextMenu,
    dropTarget,
    onTicketDragOver,
    highlightedTicketId,
  }) => {
    // v163a: Check if drop indicator should show at a specific index
    const isDropTargetAtIndex = (index) => {
      return (
        dropTarget && dropTarget.sectionId === sectionId && dropTarget.column === column && dropTarget.index === index
      );
    };

    // v163a: Handle drag over empty area (bottom of column)
    const handleColumnDragOver = (e) => {
      onDragOver(e);
      // If dragging over empty area at bottom, set drop target to end
      if (onTicketDragOver && e.target === e.currentTarget) {
        onTicketDragOver(e, sectionId, column, items.length);
      }
    };

    // v163a: Drop indicator component - absolute positioning prevents layout shift
    const DropIndicator = ({ position = 'top' }) => (
      <div
        className={`absolute left-1 right-1 h-1 bg-indigo-500 rounded-full shadow-sm pointer-events-none z-10 ${
          position === 'top' ? '-top-1' : '-bottom-1'
        }`}
      />
    );

    return (
      <div className="flex-shrink-0 flex flex-col" style={{ width: '280px' }}>
        <div className="bg-gray-50 rounded flex-1 flex flex-col">
          <div className="px-3 py-2 bg-gray-100 rounded-t sticky top-0 z-10">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{column}</h3>
              <span className="text-xs text-gray-500 font-medium">{items.length}</span>
            </div>
          </div>
          <div
            className="p-2 space-y-2 flex-1 min-h-[400px]"
            onDragOver={handleColumnDragOver}
            onDrop={(e) => onDrop(e, column, sectionId)}
            onDragLeave={(e) => {
              // Only clear if leaving the column entirely
              if (e.currentTarget === e.target && !e.currentTarget.contains(e.relatedTarget)) {
                // Parent will handle clearing dropTarget
              }
            }}
          >
            {items.map((item, index) => (
              <div key={item.id} className="relative">
                {/* v163a: Drop indicator at top of this card (before it) */}
                {isDropTargetAtIndex(index) && <DropIndicator position="top" />}

                <TicketCard
                  ticket={item}
                  ticketIndex={index}
                  totalTickets={items.length}
                  onDragStart={onDragStart}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  getInitialsColor={getInitialsColor}
                  onContextMenu={onContextMenu}
                  onTicketDragOver={onTicketDragOver}
                  sectionId={sectionId}
                  column={column}
                  isHighlighted={highlightedTicketId === item.id}
                />

                {/* v163a: Drop indicator at bottom of last card (after all) */}
                {index === items.length - 1 && isDropTargetAtIndex(items.length) && <DropIndicator position="bottom" />}
              </div>
            ))}

            {/* v163a: Show placeholder when column is empty */}
            {items.length === 0 && !isDropTargetAtIndex(0) && (
              <div className="p-6 text-center text-gray-400 text-sm">Drag tickets here</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // v074: Added collapse/expand functionality (UX-074-001)
  // v163a: Added dropTarget, onTicketDragOver, highlightedTicketId for positional drag-drop
  const BacklogColumn = ({
    column,
    items,
    sectionId,
    onDragStart,
    onDragOver,
    onDrop,
    onEdit,
    onDelete,
    getInitialsColor,
    onContextMenu,
    dropTarget,
    onTicketDragOver,
    highlightedTicketId,
  }) => {
    const [isCollapsed, setIsCollapsed] = useState(false);

    // v163a: Check if drop indicator should show at a specific index
    const isDropTargetAtIndex = (index) => {
      return (
        dropTarget && dropTarget.sectionId === sectionId && dropTarget.column === column && dropTarget.index === index
      );
    };

    // v163a: Handle drag over empty area (bottom of column)
    const handleColumnDragOver = (e) => {
      onDragOver(e);
      if (onTicketDragOver && e.target === e.currentTarget) {
        onTicketDragOver(e, sectionId, column, items.length);
      }
    };

    // v163a: Drop indicator component - absolute positioning prevents layout shift
    const DropIndicator = ({ position = 'top' }) => (
      <div
        className={`absolute left-1 right-1 h-1 bg-indigo-500 rounded-full shadow-sm pointer-events-none z-10 ${
          position === 'top' ? '-top-1' : '-bottom-1'
        }`}
      />
    );

    return (
      <div className="bg-white rounded-lg shadow-sm">
        <div
          className="px-3 py-2 bg-gray-100 rounded-t cursor-pointer hover:bg-gray-200 transition"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="text-gray-500 transition-transform"
                style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
              >
                <ChevronDown size={16} />
              </span>
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{column}</h3>
            </div>
            <span className="text-xs text-gray-500 font-medium">{items.length}</span>
          </div>
        </div>
        {!isCollapsed && (
          <div
            className="p-2 space-y-2 min-h-[100px]"
            onDragOver={handleColumnDragOver}
            onDrop={(e) => onDrop(e, column, sectionId)}
          >
            {items.length === 0 && !isDropTargetAtIndex(0) ? (
              <div className="p-6 text-center text-gray-400 text-sm">Drag tickets here</div>
            ) : (
              <>
                {items.map((item, index) => (
                  <div key={item.id} className="relative">
                    {/* v163a: Drop indicator at top of this card (before it) */}
                    {isDropTargetAtIndex(index) && <DropIndicator position="top" />}

                    <TicketCard
                      ticket={item}
                      ticketIndex={index}
                      totalTickets={items.length}
                      onDragStart={onDragStart}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      getInitialsColor={getInitialsColor}
                      onContextMenu={onContextMenu}
                      onTicketDragOver={onTicketDragOver}
                      sectionId={sectionId}
                      column={column}
                      isHighlighted={highlightedTicketId === item.id}
                    />

                    {/* v163a: Drop indicator at bottom of last card (after all) */}
                    {index === items.length - 1 && isDropTargetAtIndex(items.length) && (
                      <DropIndicator position="bottom" />
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
        {isCollapsed && (
          <div
            className="p-2 min-h-[40px] border-t border-gray-200"
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, column, sectionId)}
          >
            <div className="text-xs text-gray-400 text-center py-1">Drop here to add</div>
          </div>
        )}
      </div>
    );
  };

  // v163a: Added dropTarget, onCustomerDragOver, highlightedCustomerId for positional drag-drop
  const CRMColumn = ({
    column,
    items,
    sectionId,
    onDragStart,
    onDragOver,
    onDrop,
    onEdit,
    onDelete,
    dropTarget,
    onCustomerDragOver,
    highlightedCustomerId,
  }) => {
    // v163a: Check if drop indicator should show at a specific index
    const isDropTargetAtIndex = (index) => {
      return (
        dropTarget && dropTarget.sectionId === sectionId && dropTarget.column === column && dropTarget.index === index
      );
    };

    // v163a: Handle drag over empty area (bottom of column)
    const handleColumnDragOver = (e) => {
      onDragOver(e);
      if (onCustomerDragOver && e.target === e.currentTarget) {
        onCustomerDragOver(e, sectionId, column, items.length);
      }
    };

    // v163a: Drop indicator component - absolute positioning prevents layout shift
    const DropIndicator = ({ position = 'top' }) => (
      <div
        className={`absolute left-1 right-1 h-1 bg-indigo-500 rounded-full shadow-sm pointer-events-none z-10 ${
          position === 'top' ? '-top-1' : '-bottom-1'
        }`}
      />
    );

    return (
      <div className="flex-shrink-0" style={{ width: '280px' }}>
        <div className="bg-gray-50 rounded">
          <div className="px-3 py-2 bg-gray-100 rounded-t">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{column}</h3>
              <span className="text-xs text-gray-500 font-medium">{items.length}</span>
            </div>
          </div>
          <div
            className="p-2 space-y-2 min-h-[400px]"
            onDragOver={handleColumnDragOver}
            onDrop={(e) => onDrop(e, column, sectionId)}
          >
            {items.map((item, index) => (
              <div key={item.id} className="relative">
                {/* v163a: Drop indicator at top of this card (before it) */}
                {isDropTargetAtIndex(index) && <DropIndicator position="top" />}

                <CustomerCard
                  customer={item}
                  customerIndex={index}
                  onDragStart={onDragStart}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onCustomerDragOver={onCustomerDragOver}
                  sectionId={sectionId}
                  column={column}
                  isHighlighted={highlightedCustomerId === item.id}
                />

                {/* v163a: Drop indicator at bottom of last card (after all) */}
                {index === items.length - 1 && isDropTargetAtIndex(items.length) && <DropIndicator position="bottom" />}
              </div>
            ))}

            {/* v163a: Show placeholder when column is empty */}
            {items.length === 0 && !isDropTargetAtIndex(0) && (
              <div className="p-6 text-center text-gray-400 text-sm">Drag customers here</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // v163a: Added onTicketDragOver, sectionId, column, isHighlighted for positional drag-drop
  const TicketCard = ({
    ticket,
    ticketIndex,
    totalTickets,
    onDragStart,
    onEdit,
    onDelete,
    getInitialsColor,
    onContextMenu,
    onTicketDragOver,
    sectionId,
    column,
    isHighlighted,
  }) => {
    const getInitials = (name) => {
      if (!name) return '?';
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    };

    // Get customer name from ID
    const getCustomerName = (clientId) => {
      if (!clientId || clientId === 'All') return null;
      const customers = window.allCustomers || [];
      const customer = customers.find((c) => c.id === clientId);
      return customer ? customer.companyName : clientId;
    };

    // v179c: Check if ticket has unresolved dependencies
    const checkHasDependencies = () => {
      const links = ticket.links || [];
      const allTickets = window.allTickets || [];
      const company = window.globalCompany;
      for (const link of links) {
        if (link.type === 'depends-on') {
          const target = allTickets.find((t) => t.id === link.targetTicketId);
          if (target) {
            const statusDef = company?.statuses?.find((s) => s.id === target.status);
            if (!['completed', 'ended'].includes(statusDef?.type)) return true;
          }
        }
      }
      return false;
    };

    // v179c: Check if ticket is blocking other open tickets
    const checkIsBlocking = () => {
      const links = ticket.links || [];
      const allTickets = window.allTickets || [];
      const company = window.globalCompany;
      for (const link of links) {
        if (link.type === 'blocks') {
          const target = allTickets.find((t) => t.id === link.targetTicketId);
          if (target) {
            const statusDef = company?.statuses?.find((s) => s.id === target.status);
            if (!['completed', 'ended'].includes(statusDef?.type)) return true;
          }
        }
      }
      return false;
    };

    const hasDependencies = checkHasDependencies();
    const isBlocking = checkIsBlocking();

    // v158a: Handle right-click context menu
    const handleContextMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (onContextMenu) {
        onContextMenu(ticket, e, { ticketIndex, totalTickets });
      }
    };

    // v163a: Handle drag over to detect top/bottom half for drop position
    // Added dead zone (middle 30%) to prevent flickering at midpoint
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (onTicketDragOver) {
        const rect = e.currentTarget.getBoundingClientRect();
        const relativeY = (e.clientY - rect.top) / rect.height; // 0 to 1

        // Dead zone from 0.35 to 0.65 - don't change indicator in this range
        // This prevents flickering when cursor is near the midpoint
        if (relativeY >= 0.35 && relativeY <= 0.65) {
          return; // Keep current indicator position
        }

        const insertBefore = relativeY < 0.35;
        const dropIndex = insertBefore ? ticketIndex : ticketIndex + 1;
        onTicketDragOver(e, sectionId, column, dropIndex);
      }
    };

    return (
      <div
        className={`bg-white border rounded shadow-sm hover:shadow-md transition cursor-move group ${
          isHighlighted ? 'ring-2 ring-indigo-400 border-indigo-300 bg-indigo-50' : 'border-gray-200'
        }`}
        draggable
        onDragStart={(e) => {
          // v098: Firefox fix - setData must be called immediately at drag origin
          e.dataTransfer.setData('text/plain', ticket.id);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart(e, ticket);
        }}
        onDragOver={handleDragOver}
        onClick={() => onEdit(ticket)}
        onContextMenu={handleContextMenu}
      >
        <div className="p-3">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 pr-2">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                {/* v072: Standardised on typeId field */}
                {(() => {
                  const ticketType = window.globalCompany?.globalTicketTypes?.find((tt) => tt.id === ticket.typeId);
                  const typeName = ticketType?.name || 'Unknown';
                  const typeColor = TYPE_COLORS[typeName] || TYPE_COLORS[ticketType?.color] || TYPE_COLORS.default;
                  const typeIcon = ticketType?.icon || TYPE_ICONS.default;
                  return (
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${typeColor}`}>
                      {typeIcon} {typeName}
                    </span>
                  );
                })()}
                {ticket.parentProject && <span className="text-xs text-gray-500">→ {ticket.parentProject}</span>}
                {ticket.client && ticket.client !== 'All' && (
                  <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">
                    👤 {getCustomerName(ticket.client)}
                  </span>
                )}
                {/* v179c: Link status indicators */}
                {hasDependencies && (
                  <span
                    className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded"
                    title="Has unresolved dependencies"
                  >
                    ⏳
                  </span>
                )}
                {isBlocking && (
                  <span
                    className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded"
                    title="Blocking other tickets"
                  >
                    🚫
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-900 font-normal leading-tight">{ticket.name}</p>
            </div>
            <div className="opacity-0 group-hover:opacity-100 transition flex gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(ticket);
                }}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <Edit2 size={14} className="text-gray-600" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(ticket.id);
                }}
                className="p-1 hover:bg-red-50 rounded"
              >
                <Trash2 size={14} className="text-red-600" />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium">{ticket.id}</span>
              {ticket.effortPoints && (
                <span className="flex items-center gap-1 text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                  <BarChart3 size={12} />
                  {ticket.effortPoints}
                </span>
              )}
            </div>

            {ticket.assignee && (
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium ${getInitialsColor(ticket.assignee)}`}
                title={ticket.assignee}
              >
                {getInitials(ticket.assignee)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // v163a: Added onCustomerDragOver, customerIndex, sectionId, column, isHighlighted for positional drag-drop
  const CustomerCard = ({
    customer,
    customerIndex,
    onDragStart,
    onEdit,
    onDelete,
    onCustomerDragOver,
    sectionId,
    column,
    isHighlighted,
  }) => {
    const handleViewTickets = (e) => {
      e.stopPropagation();
      const event = new CustomEvent('filterByClient', {
        detail: { customerId: customer.id, customerName: customer.companyName },
      });
      window.dispatchEvent(event);
    };

    // v163a: Handle drag over to detect top/bottom half for drop position
    // v163a: Handle drag over to detect top/bottom half for drop position
    // Added dead zone (middle 30%) to prevent flickering at midpoint
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (onCustomerDragOver) {
        const rect = e.currentTarget.getBoundingClientRect();
        const relativeY = (e.clientY - rect.top) / rect.height; // 0 to 1

        // Dead zone from 0.35 to 0.65 - don't change indicator in this range
        // This prevents flickering when cursor is near the midpoint
        if (relativeY >= 0.35 && relativeY <= 0.65) {
          return; // Keep current indicator position
        }

        const insertBefore = relativeY < 0.35;
        const dropIndex = insertBefore ? customerIndex : customerIndex + 1;
        onCustomerDragOver(e, sectionId, column, dropIndex);
      }
    };

    return (
      <div
        className={`bg-white border rounded shadow-sm hover:shadow-md transition cursor-pointer group ${
          isHighlighted ? 'ring-2 ring-indigo-400 border-indigo-300 bg-indigo-50' : 'border-gray-200'
        }`}
        draggable
        onDragStart={(e) => {
          // v098: Firefox fix - setData must be called immediately at drag origin
          e.dataTransfer.setData('text/plain', customer.id);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart(e, customer);
        }}
        onDragOver={handleDragOver}
        onClick={() => onEdit(customer)}
      >
        <div className="p-3">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 pr-2">
              <h4 className="text-sm font-semibold text-gray-900 mb-1">{customer.companyName}</h4>
              <p className="text-xs text-gray-600 mb-1">{customer.mainContact}</p>
              {customer.industry && (
                <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{customer.industry}</span>
              )}
            </div>
            <div className="opacity-0 group-hover:opacity-100 transition flex gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(customer.id);
                }}
                className="p-1 hover:bg-red-50 rounded"
                title="Delete customer"
              >
                <Trash2 size={14} className="text-red-600" />
              </button>
            </div>
          </div>

          <div className="space-y-1 mt-3">
            {customer.email && <p className="text-xs text-gray-600 truncate">📧 {customer.email}</p>}
            {customer.mainNumber && <p className="text-xs text-gray-600">📞 {customer.mainNumber}</p>}
          </div>

          {/* View Tickets Button - Clear action separation */}
          <button
            onClick={handleViewTickets}
            className="mt-3 w-full py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded transition border border-indigo-200"
          >
            🔍 View Tickets
          </button>
        </div>
      </div>
    );
  };

  // DynamicField imported from components/dynamic-field.jsx

  const RichTextToolbar = ({
    onBold,
    onItalic,
    onLink,
    onImage,
    onFile,
    onBulletList,
    onNumberList,
    onTable,
    compact = false,
  }) => (
    <div
      className={`flex items-center gap-1 p-2 border-b border-gray-200 bg-gray-50 ${compact ? 'rounded-t' : 'rounded-t-lg'}`}
    >
      <button
        type="button"
        onClick={onBold}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition"
        title="Bold"
      >
        <span className="font-bold text-sm">B</span>
      </button>
      <button
        type="button"
        onClick={onItalic}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition"
        title="Italic"
      >
        <span className="italic text-sm">I</span>
      </button>
      <div className="w-px h-5 bg-gray-300 mx-1"></div>
      <button
        type="button"
        onClick={onBulletList}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition"
        title="Bullet List"
      >
        •≡
      </button>
      <button
        type="button"
        onClick={onNumberList}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition"
        title="Numbered List"
      >
        1.
      </button>
      <button
        type="button"
        onClick={onTable}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition"
        title="Insert Table"
      >
        ▦
      </button>
      <div className="w-px h-5 bg-gray-300 mx-1"></div>
      <button
        type="button"
        onClick={onLink}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition"
        title="Insert Link"
      >
        🔗
      </button>
      {onImage && (
        <button
          type="button"
          onClick={onImage}
          className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition"
          title="Insert Image"
        >
          🖼️
        </button>
      )}
      {onFile && (
        <button
          type="button"
          onClick={onFile}
          className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition"
          title="Attach File"
        >
          📎
        </button>
      )}
    </div>
  );

  // Attachment Thumbnail Component
  const AttachmentThumbnail = ({ attachment, onOpen, onDelete }) => {
    const isImage = attachment.mimeType?.startsWith('image/');
    const isPDF = attachment.mimeType === 'application/pdf';
    const isDoc = attachment.mimeType?.includes('document') || attachment.filename?.endsWith('.docx');
    const getIcon = () => {
      if (isImage) return '🖼️';
      if (isPDF) return '📄';
      if (isDoc) return '📝';
      return '📎';
    };
    const formatSize = (bytes) => {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    return (
      <div className="group relative flex-shrink-0 w-24 border border-gray-200 rounded-lg overflow-hidden bg-white hover:border-indigo-300 transition cursor-pointer">
        <div className="h-16 flex items-center justify-center bg-gray-50" onDoubleClick={() => onOpen(attachment)}>
          {isImage && attachment.data ? (
            <img src={attachment.data} alt={attachment.filename} className="h-full w-full object-cover" />
          ) : (
            <span className="text-2xl">{getIcon()}</span>
          )}
        </div>
        <div className="p-1.5">
          <p className="text-xs text-gray-700 truncate" title={attachment.filename}>
            {attachment.filename}
          </p>
          <p className="text-xs text-gray-400">{formatSize(attachment.size)}</p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(attachment.id);
          }}
          className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
          title="Delete"
        >
          ×
        </button>
      </div>
    );
  };

  // Comment Component
  const CommentItem = ({ comment, onEdit, onDelete, staff }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(comment.content);
    const author = staff?.find((s) => s.id === comment.authorId) || { name: comment.authorName || 'Unknown' };
    const timeAgo = (date) => {
      const now = new Date();
      const diff = now - new Date(date);
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins}m ago`;
      if (hours < 24) return `${hours}h ago`;
      return `${days}d ago`;
    };
    const handleSave = () => {
      onEdit(comment.id, editContent);
      setIsEditing(false);
    };

    return (
      <div className="border-b border-gray-100 pb-3 mb-3 last:border-0 last:pb-0 last:mb-0">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-medium text-indigo-700">
              {(author.name || 'U').charAt(0)}
            </div>
            <div>
              <span className="text-sm font-medium text-gray-900">{author.name}</span>
              <span className="text-xs text-gray-400 ml-2">{timeAgo(comment.createdAt)}</span>
              {comment.editedAt && <span className="text-xs text-gray-400 ml-1">(edited)</span>}
            </div>
          </div>
          {!isEditing && (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="text-xs text-gray-400 hover:text-indigo-600 transition"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onDelete(comment.id)}
                className="text-xs text-gray-400 hover:text-red-600 transition"
              >
                Delete
              </button>
            </div>
          )}
        </div>
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setEditContent(comment.content);
                }}
                className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            className="text-sm text-gray-700 prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: comment.content }}
          />
        )}
      </div>
    );
  };

  // Export to window
  window.Components = window.Components || {};
  window.Components.UICards = {
    CustomerTicketsView,
    KanbanColumn,
    BacklogColumn,
    CRMColumn,
    TicketCard,
    CustomerCard,
    RichTextToolbar,
    AttachmentThumbnail,
    CommentItem,
  };

  // v153: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['ui-cards'] = COMPONENT_VERSION;

  console.log(`[ui-cards.jsx] UICards loaded (${COMPONENT_VERSION})`);
})();

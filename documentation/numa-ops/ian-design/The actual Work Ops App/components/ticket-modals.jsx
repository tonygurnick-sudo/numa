/**
 * Ticket Modal Components
 *
 * Contains:
 * - TicketModal: Create/edit ticket form with rich text, attachments, comments
 * - TicketSuccessModal: Success confirmation after ticket creation
 * - AddLinkModal: Modal for creating links between tickets
 * - LinkedTicketsSection: Display and manage ticket links with reciprocal support
 *
 * Dependencies:
 * - window.Domain.Statuses.PREDEFINED_STATUSES
 * - window.Components.DynamicField
 * - window.globalCompany
 * - window.allOpCentres
 * - window.allTickets (for link search)
 * - React (useState)
 *
 * Version: v179b
 *
 * v179b Changes (Reciprocal Links - rebuilt from v177c):
 * - NEW PROPS: onLinkAdded, onLinkRemoved for reciprocal link handling
 * - BLOCKING INDICATOR: 🚫 "Blocking" badge when this ticket blocks other open tickets
 * - DEPENDS INDICATOR: ⏳ "Depends" (renamed from "Blocked")
 * - REMOVE INVERSE LINKS: Can now remove links shown in inverse (reciprocal removed from source)
 * - DEDUPLICATION FIX: Header count and section don't double-count reciprocal links
 * - REMOVED: "No comments yet" placeholder text
 *
 * v177c Changes (Layout):
 * - LAYOUT REORDER: Activity section now above Linked Tickets (more frequently used)
 * - HEADER INDICATOR: "Linked Tickets (n)" button in header when links exist
 * - COLLAPSE DEFAULT: Linked Tickets collapsed when no links, expanded when links exist
 * - LinkedTicketsSection now uses forwardRef for scroll-to functionality
 *
 * v177a Changes (Linked Tickets Feature):
 * - LINKED TICKETS FEATURE (Phases L1-L3):
 *   - Added Linked Tickets collapsible section in ticket modal
 *   - Shows links grouped by type (blocks, depends-on, related-to)
 *   - Shows inverse links from other tickets
 *   - Click linked ticket to open it
 *   - Remove link button
 *   - Add Link Modal with cross-board ticket search
 *   - Shows linked ticket's customer for cross-entity visibility
 *
 * Exported via: window.Components.TicketModals
 */
(function () {
  'use strict';

  const COMPONENT_VERSION = 'v179b';

  const { useState, useRef } = React;

  const { PREDEFINED_STATUSES } = window.Domain?.Statuses || {};
  const DynamicField = window.Components?.DynamicField;

  // ========================================
  // v177c: ADD LINK MODAL
  // ========================================
  const AddLinkModal = ({ currentTicketId, onClose, onAddLink }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTicketId, setSelectedTicketId] = useState(null);
    const [linkType, setLinkType] = useState('depends-on');
    const [notes, setNotes] = useState('');

    const company = window.globalCompany;
    const allTickets = window.allTickets || [];
    const linkConfig = company?.linkConfig;
    const linkTypes = linkConfig?.linkTypes || [];

    const searchResults =
      searchQuery.trim().length >= 2
        ? allTickets
            .filter((t) => t.id !== currentTicketId)
            .filter((t) => {
              const query = searchQuery.toLowerCase();
              return t.id.toLowerCase().includes(query) || (t.name || '').toLowerCase().includes(query);
            })
            .slice(0, 10)
        : [];

    const handleSubmit = () => {
      if (!selectedTicketId) return;
      onAddLink({
        id: `link-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        targetTicketId: selectedTicketId,
        type: linkType,
        notes: notes.trim() || null,
        createdAt: new Date().toISOString(),
        createdBy: 'current-user',
      });
      onClose();
    };

    const getTicketTypeInfo = (ticket) => {
      const ticketType = company?.globalTicketTypes?.find((tt) => tt.id === ticket.typeId);
      return ticketType || { icon: '📋', name: 'Ticket' };
    };

    const getCustomerName = (ticket) => {
      if (!ticket.client) return null;
      const customer = company?.globalCRM?.find((c) => c.id === ticket.client);
      return customer?.companyName;
    };

    const getStatusColor = (status) => {
      const statusDef = company?.statuses?.find((s) => s.id === status);
      switch (statusDef?.type) {
        case 'completed':
          return 'bg-green-100 text-green-700';
        case 'active':
          return 'bg-blue-100 text-blue-700';
        case 'ended':
          return 'bg-gray-100 text-gray-500';
        default:
          return 'bg-gray-100 text-gray-600';
      }
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000]">
        <div className="bg-white rounded-lg w-[500px] max-h-[80vh] flex flex-col">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-900">Link Ticket</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Relationship Type</label>
              <select
                value={linkType}
                onChange={(e) => setLinkType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              >
                {linkTypes.map((lt) => (
                  <option key={lt.id} value={lt.id}>
                    {lt.icon} {lt.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Search Tickets</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by ID or name..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                autoFocus
              />
            </div>

            {searchQuery.trim().length >= 2 && (
              <div className="border border-gray-200 rounded-lg max-h-[200px] overflow-y-auto">
                {searchResults.length > 0 ? (
                  searchResults.map((ticket) => {
                    const typeInfo = getTicketTypeInfo(ticket);
                    const customerName = getCustomerName(ticket);
                    const isSelected = selectedTicketId === ticket.id;
                    return (
                      <div
                        key={ticket.id}
                        onClick={() => setSelectedTicketId(ticket.id)}
                        className={`px-3 py-2 cursor-pointer border-b border-gray-100 last:border-b-0 ${
                          isSelected ? 'bg-indigo-50 border-l-4 border-l-indigo-500' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span>{typeInfo.icon}</span>
                          <span className="font-mono text-xs text-gray-500">{ticket.id}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusColor(ticket.status)}`}>
                            {ticket.column || ticket.status}
                          </span>
                        </div>
                        <div className="text-sm text-gray-900 mt-0.5 truncate">{ticket.name}</div>
                        {customerName && <div className="text-xs text-gray-500 mt-0.5">👤 {customerName}</div>}
                      </div>
                    );
                  })
                ) : (
                  <div className="px-3 py-4 text-center text-gray-400 text-sm">
                    No tickets found matching "{searchQuery}"
                  </div>
                )}
              </div>
            )}

            {searchQuery.trim().length < 2 && (
              <div className="text-xs text-gray-400">Type at least 2 characters to search</div>
            )}

            {selectedTicketId && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                <div className="text-xs font-medium text-indigo-700 mb-1">Selected Ticket</div>
                {(() => {
                  const ticket = allTickets.find((t) => t.id === selectedTicketId);
                  if (!ticket) return <div className="text-sm text-gray-500">Ticket not found</div>;
                  const typeInfo = getTicketTypeInfo(ticket);
                  return (
                    <div className="flex items-center gap-2">
                      <span>{typeInfo.icon}</span>
                      <span className="font-mono text-sm">{ticket.id}</span>
                      <span className="text-sm text-gray-700 truncate">{ticket.name}</span>
                    </div>
                  );
                })()}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Why are these tickets related?"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!selectedTicketId}
              className={`px-4 py-2 rounded-lg font-medium ${
                selectedTicketId
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              Create Link
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ========================================
  // LINKED TICKETS SECTION
  // v179b: Added onLinkAdded, onLinkRemoved props for reciprocal link handling
  // ========================================
  const LinkedTicketsSection = React.forwardRef(
    ({ ticket, formData, setFormData, onOpenTicket, initialExpanded, onLinkAdded, onLinkRemoved }, ref) => {
      const company = window.globalCompany;
      const allTickets = window.allTickets || [];
      const linkConfig = company?.linkConfig;
      const linkTypes = linkConfig?.linkTypes || [];

      const directLinks = formData.links || [];

      // Get inverse links (links TO this ticket from other tickets)
      // v179b: Skip inverse links where a matching direct reciprocal already exists
      const inverseLinks = [];
      if (ticket?.id) {
        allTickets.forEach((t) => {
          if (t.id === ticket.id) return;
          (t.links || []).forEach((link) => {
            if (link.targetTicketId === ticket.id) {
              const linkType = linkTypes.find((lt) => lt.id === link.type);
              if (linkType) {
                // v179b: Check if direct links already has the reciprocal
                const reciprocalType = linkType.inverse;
                const hasDirectReciprocal = directLinks.some(
                  (dl) => dl.type === reciprocalType && dl.targetTicketId === t.id
                );
                if (hasDirectReciprocal) return; // Skip - already shown as direct link

                inverseLinks.push({
                  ...link,
                  sourceTicketId: t.id,
                  displayType: linkType.inverse,
                  displayName: linkType.inverseName,
                  icon: linkType.icon,
                });
              }
            }
          });
        });
      }

      const totalLinks = directLinks.length + inverseLinks.length;

      // v177c: Default expanded based on whether links exist
      const [isExpanded, setIsExpanded] = useState(initialExpanded !== undefined ? initialExpanded : totalLinks > 0);
      const [showAddLinkModal, setShowAddLinkModal] = useState(false);

      // Check if ticket is blocked
      const checkIsBlocked = () => {
        for (const link of directLinks) {
          if (link.type === 'depends-on') {
            const target = allTickets.find((t) => t.id === link.targetTicketId);
            if (target) {
              const statusDef = company?.statuses?.find((s) => s.id === target.status);
              if (!['completed', 'ended'].includes(statusDef?.type)) return true;
            }
          }
        }
        for (const link of inverseLinks) {
          if (link.displayType === 'blocked-by') {
            const source = allTickets.find((t) => t.id === link.sourceTicketId);
            if (source) {
              const statusDef = company?.statuses?.find((s) => s.id === source.status);
              if (!['completed', 'ended'].includes(statusDef?.type)) return true;
            }
          }
        }
        return false;
      };

      // v179b: Check if this ticket is blocking other open tickets
      const checkIsBlocking = () => {
        for (const link of directLinks) {
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

      const hasDependencies = checkIsBlocked();
      const isBlocking = checkIsBlocking();

      const getTicketInfo = (ticketId) => {
        const t = allTickets.find((x) => x.id === ticketId);
        if (!t) return null;
        const ticketType = company?.globalTicketTypes?.find((tt) => tt.id === t.typeId);
        const statusDef = company?.statuses?.find((s) => s.id === t.status);
        const customer = t.client ? company?.globalCRM?.find((c) => c.id === t.client) : null;
        return { ticket: t, type: ticketType || { icon: '📋' }, status: statusDef, customer };
      };

      const getStatusColor = (statusDef) => {
        switch (statusDef?.type) {
          case 'completed':
            return 'bg-green-100 text-green-700';
          case 'active':
            return 'bg-blue-100 text-blue-700';
          case 'ended':
            return 'bg-gray-100 text-gray-500';
          default:
            return 'bg-gray-100 text-gray-600';
        }
      };

      // v179b: Handle remove with reciprocal deletion
      const handleRemoveLink = (link, isInverse = false) => {
        if (confirm('Remove this link? (This will also remove the reciprocal link on the other ticket)')) {
          if (isInverse) {
            // This is a link stored on another ticket - call onLinkRemoved for app.jsx to handle
            if (onLinkRemoved) {
              onLinkRemoved(link.sourceTicketId, ticket.id, link.id);
            }
          } else {
            // This is a direct link - remove from formData and notify for reciprocal removal
            setFormData({ ...formData, links: (formData.links || []).filter((l) => l.id !== link.id) });
            if (onLinkRemoved) {
              onLinkRemoved(ticket.id, link.targetTicketId, link.id);
            }
          }
        }
      };

      const handleAddLink = (newLink) => {
        setFormData({ ...formData, links: [...(formData.links || []), newLink] });
        // v179b: Notify app.jsx to create reciprocal
        if (onLinkAdded) {
          onLinkAdded(ticket.id, newLink.targetTicketId, newLink.type, newLink.notes);
        }
      };

      // Render a linked ticket row
      const renderLinkedTicket = (link, isInverse = false) => {
        const ticketId = isInverse ? link.sourceTicketId : link.targetTicketId;
        const info = getTicketInfo(ticketId);
        if (!info)
          return (
            <div key={link.id} className="px-3 py-2 text-sm text-gray-400 italic">
              {ticketId} (not found)
            </div>
          );

        const { ticket: linkedTicket, type, status, customer } = info;
        const linkType = isInverse
          ? { icon: link.icon, name: link.displayName }
          : linkTypes.find((lt) => lt.id === link.type);

        return (
          <div
            key={link.id + (isInverse ? '-inv' : '')}
            className="flex items-start gap-2 px-3 py-2 hover:bg-gray-50 rounded group"
          >
            <span className="text-sm flex-shrink-0" title={linkType?.name}>
              {linkType?.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm">{type.icon}</span>
                <button
                  type="button"
                  onClick={() => onOpenTicket && onOpenTicket(linkedTicket)}
                  className="font-mono text-xs text-indigo-600 hover:underline"
                >
                  {linkedTicket.id}
                </button>
                <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusColor(status)}`}>
                  {linkedTicket.column || status?.label || linkedTicket.status}
                </span>
              </div>
              <div className="text-sm text-gray-700 truncate">{linkedTicket.name}</div>
              {customer && <div className="text-xs text-gray-500">👤 {customer.companyName}</div>}
              {link.notes && <div className="text-xs text-gray-400 mt-0.5 italic">"{link.notes}"</div>}
            </div>
            {/* v179b: Can remove both direct and inverse links */}
            <button
              type="button"
              onClick={() => handleRemoveLink(link, isInverse)}
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1"
              title="Remove link"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      };

      return (
        <div ref={ref} className="border border-gray-200 rounded-lg overflow-hidden">
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-2 bg-gray-50 cursor-pointer"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="flex items-center gap-2">
              <svg
                className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-sm font-medium text-gray-700">Linked Tickets ({totalLinks})</span>
              {/* v179b: Depends indicator (renamed from Blocked) */}
              {hasDependencies && (
                <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded flex items-center gap-1">
                  ⏳ Depends
                </span>
              )}
              {/* v179b: Blocking indicator */}
              {isBlocking && (
                <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded flex items-center gap-1">
                  🚫 Blocking
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowAddLinkModal(true);
              }}
              className="text-xs px-2 py-1 bg-white border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
            >
              + Add Link
            </button>
          </div>

          {/* Content */}
          {isExpanded && (
            <div className="divide-y divide-gray-100">
              {totalLinks === 0 ? (
                <div className="px-4 py-6 text-center text-gray-400 text-sm">
                  <div className="text-2xl mb-2">🔗</div>
                  <p>No linked tickets</p>
                  <p className="text-xs mt-1">Link related tickets to track dependencies</p>
                </div>
              ) : (
                <>
                  {/* Direct links grouped by type */}
                  {linkTypes.map((lt) => {
                    const typeLinks = directLinks.filter((l) => l.type === lt.id);
                    if (typeLinks.length === 0) return null;
                    return (
                      <div key={lt.id}>
                        <div className="px-3 py-1.5 bg-gray-50 text-xs font-medium text-gray-500 uppercase">
                          {lt.icon} {lt.name}
                        </div>
                        {typeLinks.map((link) => renderLinkedTicket(link, false))}
                      </div>
                    );
                  })}

                  {/* Inverse links grouped by type */}
                  {(() => {
                    const inverseByType = {};
                    inverseLinks.forEach((link) => {
                      if (!inverseByType[link.displayType]) {
                        inverseByType[link.displayType] = { icon: link.icon, name: link.displayName, links: [] };
                      }
                      inverseByType[link.displayType].links.push(link);
                    });

                    return Object.entries(inverseByType).map(([type, data]) => (
                      <div key={type}>
                        <div className="px-3 py-1.5 bg-gray-50 text-xs font-medium text-gray-500 uppercase">
                          {data.icon} {data.name}
                        </div>
                        {data.links.map((link) => renderLinkedTicket(link, true))}
                      </div>
                    ));
                  })()}
                </>
              )}
            </div>
          )}

          {/* Add Link Modal */}
          {showAddLinkModal && (
            <AddLinkModal
              currentTicketId={ticket?.id}
              onClose={() => setShowAddLinkModal(false)}
              onAddLink={handleAddLink}
            />
          )}
        </div>
      );
    }
  );

  // ========================================
  // HELPER COMPONENTS (unchanged)
  // ========================================
  const RichTextToolbar = ({
    onBold,
    onItalic,
    onBulletList,
    onNumberList,
    onTable,
    onLink,
    onImage,
    onFile,
    compact,
  }) => (
    <div className={`flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 bg-gray-50 ${compact ? 'py-1' : ''}`}>
      <button
        type="button"
        onClick={onBold}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded"
        title="Bold (Ctrl+B)"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        onClick={onItalic}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded italic"
        title="Italic (Ctrl+I)"
      >
        <em>I</em>
      </button>
      <span className="w-px h-4 bg-gray-300 mx-1"></span>
      <button
        type="button"
        onClick={onBulletList}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded"
        title="Bullet List"
      >
        •
      </button>
      <button
        type="button"
        onClick={onNumberList}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded"
        title="Numbered List"
      >
        1.
      </button>
      <span className="w-px h-4 bg-gray-300 mx-1"></span>
      <button
        type="button"
        onClick={onTable}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded text-xs"
        title="Insert Table"
      >
        ⊞
      </button>
      <button
        type="button"
        onClick={onLink}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded text-xs"
        title="Insert Link"
      >
        🔗
      </button>
      <button
        type="button"
        onClick={onImage}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded text-xs"
        title="Insert Image"
      >
        🖼
      </button>
      <button
        type="button"
        onClick={onFile}
        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded text-xs"
        title="Attach File"
      >
        📎
      </button>
    </div>
  );

  const AttachmentThumbnail = ({ attachment, onOpen, onDelete }) => {
    const isImage = attachment.mimeType?.startsWith('image/');
    return (
      <div className="relative group flex-shrink-0 w-24">
        <div
          onClick={() => onOpen(attachment)}
          className="cursor-pointer border border-gray-200 rounded-lg overflow-hidden bg-gray-50 h-20 flex items-center justify-center hover:border-indigo-400 transition"
        >
          {isImage && attachment.data ? (
            <img src={attachment.data} alt={attachment.filename} className="w-full h-full object-cover" />
          ) : (
            <div className="text-center p-2">
              <div className="text-2xl mb-1">📄</div>
              <div className="text-xs text-gray-500 truncate w-full">
                {attachment.filename?.split('.').pop()?.toUpperCase()}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDelete(attachment.id)}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
        >
          ×
        </button>
        <div className="text-xs text-gray-500 mt-1 truncate text-center" title={attachment.filename}>
          {attachment.filename}
        </div>
      </div>
    );
  };

  const CommentItem = ({ comment, onEdit, onDelete, staff }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(comment.content);
    const author = staff?.find((s) => s.id === comment.authorId) || { name: comment.authorName || 'Unknown' };
    const handleSave = () => {
      onEdit(comment.id, editContent);
      setIsEditing(false);
    };
    return (
      <div className="border border-gray-200 rounded-lg p-3 bg-white">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-900">{author.name}</span>
            <span className="text-xs text-gray-400">
              {new Date(comment.createdAt).toLocaleDateString('en-NZ', {
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
            {comment.editedAt && <span className="text-xs text-gray-400">(edited)</span>}
          </div>
          <div className="flex gap-1">
            {!isEditing && (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="text-xs text-gray-400 hover:text-indigo-600"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(comment.id)}
                  className="text-xs text-gray-400 hover:text-red-600"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
        {isEditing ? (
          <div>
            <div
              contentEditable
              className="min-h-[60px] p-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:ml-6 [&_ol]:list-decimal [&_ol]:ml-6 [&_li]:ml-2"
              dangerouslySetInnerHTML={{ __html: editContent }}
              onBlur={(e) => setEditContent(e.currentTarget.innerHTML)}
            />
            <div className="flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setIsEditing(false)} className="text-xs px-2 py-1 text-gray-600">
                Cancel
              </button>
              <button type="button" onClick={handleSave} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded">
                Save
              </button>
            </div>
          </div>
        ) : (
          <div
            className="text-sm text-gray-700 prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:ml-6 [&_ol]:list-decimal [&_ol]:ml-6 [&_li]:ml-2 [&_img]:ml-4 [&_img]:w-2/3 [&_img]:rounded [&_img]:my-2"
            dangerouslySetInnerHTML={{ __html: comment.content }}
          />
        )}
      </div>
    );
  };

  const getStageName = (stage) => (typeof stage === 'string' ? stage : stage?.name);
  const getStageDefaultStatus = (stages, stageName) => {
    const stage = stages?.find((s) => getStageName(s) === stageName);
    return stage?.defaultStatus || 'backlog';
  };

  // ========================================
  // MAIN TICKET MODAL
  // ========================================
  const TicketModal = ({
    formData,
    setFormData,
    editingTicket,
    activeBoard,
    getFieldForBoard,
    onSubmit,
    onCancel,
    onStatusChange,
    onOpenLinkedTicket,
    onLinkAdded,
    onLinkRemoved,
  }) => {
    const opCentre = editingTicket?.opCentreId
      ? window.allOpCentres?.find((oc) => oc.id === editingTicket.opCentreId)
      : window.allOpCentres?.find((oc) => oc.id === window.localStorage.getItem('arcanum_active_opcentre'));
    const company = window.globalCompany;
    const statuses = company?.statuses || PREDEFINED_STATUSES;
    const fileInputRef = React.useRef(null);
    const descriptionRef = React.useRef(null);
    const commentRef = React.useRef(null);
    const commentFileInputRef = React.useRef(null);
    const linkedTicketsRef = useRef(null);
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [linkUrl, setLinkUrl] = useState('');
    const [linkText, setLinkText] = useState('');
    const [isEditingHeaderTitle, setIsEditingHeaderTitle] = useState(false);
    const [showHistoryPanel, setShowHistoryPanel] = useState(false);
    const [originalData] = useState(() => (editingTicket ? { ...editingTicket } : null));

    const hasChanges = !editingTicket
      ? true
      : (() => {
          if (!originalData) return true;
          const jsonCompareFields = ['attachments', 'comments', 'links'];
          for (const key of Object.keys(formData)) {
            if (jsonCompareFields.includes(key)) {
              if (JSON.stringify(formData[key] || []) !== JSON.stringify(originalData[key] || [])) return true;
            } else {
              if (formData[key] !== originalData[key]) return true;
            }
          }
          return false;
        })();

    const currentBoard = opCentre?.processBoards?.find(
      (pb) => pb.id === activeBoard || pb.id === editingTicket?.boardId
    );
    const currentZone = currentBoard?.workZones?.find(
      (wz) => wz.id === (formData.sectionId || editingTicket?.sectionId)
    );
    const ticketType = company?.globalTicketTypes?.find((tt) => tt.id === formData.typeId);
    const baseFields = ticketType?.fields || ['name', 'priority', 'assignee', 'description'];
    const boardOverrides = currentBoard?.fieldOverrides?.[ticketType?.id] || {};
    const additionalBoardFields = boardOverrides._additionalFields || [];
    const defaultFieldIds = [...baseFields, ...additionalBoardFields].filter((f) => f !== 'description');
    const customOrder = boardOverrides._fieldOrder;
    const allFields = customOrder
      ? customOrder
          .filter((id) => defaultFieldIds.includes(id))
          .concat(defaultFieldIds.filter((id) => !customOrder.includes(id)))
      : defaultFieldIds;
    const coreFieldIds = [
      'name',
      'priority',
      'assignee',
      'status',
      'client',
      'project',
      'reporter',
      'dueDate',
      'effortPoints',
      'workUnitId',
    ];
    const rightPanelFields = allFields.filter((f) => coreFieldIds.includes(f));
    const additionalFields = allFields.filter((f) => !coreFieldIds.includes(f));

    // v177c: Calculate linked tickets count for header indicator
    // v179b: Fixed to deduplicate inverse links when direct reciprocal exists
    const linkedTicketsCount = (() => {
      if (!editingTicket) return 0;
      const directLinks = formData.links || [];
      const allTickets = window.allTickets || [];
      const linkConfig = company?.linkConfig;
      const linkTypes = linkConfig?.linkTypes || [];
      let inverseCount = 0;
      if (editingTicket?.id) {
        allTickets.forEach((t) => {
          if (t.id === editingTicket.id) return;
          (t.links || []).forEach((link) => {
            if (link.targetTicketId === editingTicket.id) {
              const linkType = linkTypes.find((lt) => lt.id === link.type);
              if (linkType) {
                // v179b: Check if direct links already has the reciprocal
                const reciprocalType = linkType.inverse;
                const hasDirectReciprocal = directLinks.some(
                  (dl) => dl.type === reciprocalType && dl.targetTicketId === t.id
                );
                if (!hasDirectReciprocal) {
                  inverseCount++;
                }
              }
            }
          });
        });
      }
      return directLinks.length + inverseCount;
    })();

    // v177c: Scroll to linked tickets section
    const scrollToLinkedTickets = () => {
      if (linkedTicketsRef.current) {
        linkedTicketsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    const formatDate = (date) => {
      if (!date) return null;
      const d = new Date(date);
      return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    const formatDateTime = (date) => {
      if (!date) return null;
      const d = new Date(date);
      return d.toLocaleDateString('en-NZ', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    };
    const copyShareLink = () => {
      const link = `numa://ticket/${company?.id || 'company'}/${editingTicket?.id || 'NEW'}`;
      navigator.clipboard.writeText(link);
      alert('Link copied!');
    };
    const execCommand = (cmd, val = null) => {
      document.execCommand(cmd, false, val);
    };
    const handleBold = () => execCommand('bold');
    const handleItalic = () => execCommand('italic');
    const handleBulletList = () => execCommand('insertUnorderedList');
    const handleNumberList = () => execCommand('insertOrderedList');
    const handleTable = () => {
      const table = `<table class="border-collapse border border-gray-300 my-2 w-full"><tbody><tr><td class="border border-gray-300 p-2">Cell 1</td><td class="border border-gray-300 p-2">Cell 2</td></tr><tr><td class="border border-gray-300 p-2">Cell 3</td><td class="border border-gray-300 p-2">Cell 4</td></tr></tbody></table>`;
      execCommand('insertHTML', table);
    };
    const handleLink = () => {
      setLinkUrl('');
      setLinkText(window.getSelection()?.toString() || '');
      setShowLinkModal(true);
    };
    const insertLink = () => {
      if (linkUrl) {
        execCommand(
          'insertHTML',
          `<a href="${linkUrl}" target="_blank" class="text-indigo-600 hover:underline">${linkText || linkUrl}</a>`
        );
      }
      setShowLinkModal(false);
    };

    const handleFileSelect = (e) => {
      const files = Array.from(e.target.files);
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const att = {
            id: `att-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            filename: file.name,
            mimeType: file.type,
            size: file.size,
            data: ev.target.result,
            uploadedAt: new Date().toISOString(),
            uploadedBy: 'current-user',
            displayMode: 'attachment',
          };
          setFormData((prev) => ({ ...prev, attachments: [...(prev.attachments || []), att] }));
        };
        reader.readAsDataURL(file);
      });
      e.target.value = '';
    };

    const handleImageInsert = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            execCommand(
              'insertHTML',
              `<img src="${ev.target.result}" alt="${file.name}" class="ml-4 w-2/3 h-auto rounded my-2" />`
            );
            const att = {
              id: `att-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              filename: file.name,
              mimeType: file.type,
              size: file.size,
              data: ev.target.result,
              uploadedAt: new Date().toISOString(),
              uploadedBy: 'current-user',
              displayMode: 'inline',
            };
            setFormData({ ...formData, attachments: [...(formData.attachments || []), att] });
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
    };

    const handleDeleteAttachment = (id) =>
      setFormData({ ...formData, attachments: (formData.attachments || []).filter((a) => a.id !== id) });

    const handleOpenAttachment = (att) => {
      if (att.data) {
        const win = window.open();
        if (att.mimeType?.startsWith('image/'))
          win.document.write(
            `<html><head><title>${att.filename}</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111;"><img src="${att.data}" style="max-width:100%;max-height:100vh;" /></body></html>`
          );
        else if (att.mimeType === 'application/pdf')
          win.document.write(
            `<html><head><title>${att.filename}</title></head><body style="margin:0;"><embed src="${att.data}" type="application/pdf" width="100%" height="100%" style="position:absolute;inset:0;" /></body></html>`
          );
        else {
          const link = document.createElement('a');
          link.href = att.data;
          link.download = att.filename;
          link.click();
          win.close();
        }
      }
    };

    const handleAddComment = () => {
      const content = commentRef.current?.innerHTML || '';
      if (!content.trim() || content === '<br>') return;
      const c = {
        id: `comment-${Date.now()}`,
        content: content,
        authorId: 'current-user',
        authorName: 'Current User',
        createdAt: new Date().toISOString(),
        editedAt: null,
      };
      setFormData({ ...formData, comments: [c, ...(formData.comments || [])] });
      if (commentRef.current) commentRef.current.innerHTML = '';
    };
    const handleEditComment = (id, content) =>
      setFormData({
        ...formData,
        comments: (formData.comments || []).map((c) =>
          c.id === id ? { ...c, content, editedAt: new Date().toISOString() } : c
        ),
      });
    const handleDeleteComment = (id) =>
      setFormData({ ...formData, comments: (formData.comments || []).filter((c) => c.id !== id) });

    const handleCommentImageInsert = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            document.execCommand(
              'insertHTML',
              false,
              `<img src="${ev.target.result}" alt="${file.name}" class="ml-4 w-2/3 h-auto rounded my-2" />`
            );
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
    };
    const handleCommentFileSelect = (e) => {
      Array.from(e.target.files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const link = `<a href="${ev.target.result}" download="${file.name}" class="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-sm text-indigo-600 hover:bg-gray-200">📎 ${file.name}</a>`;
          document.execCommand('insertHTML', false, link);
        };
        reader.readAsDataURL(file);
      });
      e.target.value = '';
    };

    const handleDragOver = (e) => {
      e.preventDefault();
      e.currentTarget.classList.add('border-indigo-400', 'bg-indigo-50');
    };
    const handleDragLeave = (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50');
    };
    const handleDrop = (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50');
      const files = Array.from(e.dataTransfer.files);
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const att = {
            id: `att-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            filename: file.name,
            mimeType: file.type,
            size: file.size,
            data: ev.target.result,
            uploadedAt: new Date().toISOString(),
            uploadedBy: 'current-user',
            displayMode: 'attachment',
          };
          setFormData((prev) => ({ ...prev, attachments: [...(prev.attachments || []), att] }));
        };
        reader.readAsDataURL(file);
      });
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[9999]">
        <div className="bg-white rounded-lg max-w-6xl w-full h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3 flex-1">
                {!editingTicket && !ticketType && (
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-500 mb-2">What type of ticket?</label>
                    <div className="flex flex-wrap gap-2">
                      {company?.globalTicketTypes
                        ?.filter(
                          (tt) => !currentBoard?.allowedTicketTypes || currentBoard.allowedTicketTypes.includes(tt.id)
                        )
                        ?.map((tt) => (
                          <button
                            key={tt.id}
                            type="button"
                            onClick={() => setFormData({ ...formData, typeId: tt.id })}
                            className="flex items-center gap-2 px-4 py-2 border-2 border-gray-200 rounded-lg hover:border-indigo-400 hover:bg-indigo-50 transition"
                          >
                            <span className="text-xl">{tt.icon}</span>
                            <span className="font-medium text-gray-700">{tt.name}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {!editingTicket && ticketType && (
                  <>
                    <div className="text-2xl">{ticketType.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {isEditingHeaderTitle ? (
                          <input
                            type="text"
                            value={formData.name || ''}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            onBlur={() => setIsEditingHeaderTitle(false)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') setIsEditingHeaderTitle(false);
                            }}
                            autoFocus
                            placeholder={`New ${ticketType.name}`}
                            className="text-xl font-semibold text-gray-900 border-b-2 border-indigo-500 focus:outline-none bg-transparent flex-1"
                          />
                        ) : (
                          <>
                            <h2 className="text-xl font-semibold text-gray-900">
                              {formData.name || `New ${ticketType.name}`}
                            </h2>
                            <button
                              type="button"
                              onClick={() => setIsEditingHeaderTitle(true)}
                              className="text-gray-400 hover:text-indigo-600 transition"
                              title="Edit title"
                            >
                              ✏️
                            </button>
                          </>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 mt-0.5">
                        {opCentre?.name} → {currentBoard?.name || activeBoard?.name || 'Select Board'}
                        {currentZone && ` → ${currentZone.name}`}
                      </div>
                    </div>
                  </>
                )}

                {editingTicket && (
                  <>
                    {ticketType && <div className="text-2xl">{ticketType.icon}</div>}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                          {editingTicket.id}
                        </span>
                        {isEditingHeaderTitle ? (
                          <input
                            type="text"
                            value={formData.name || ''}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            onBlur={() => setIsEditingHeaderTitle(false)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') setIsEditingHeaderTitle(false);
                            }}
                            autoFocus
                            className="text-xl font-semibold text-gray-900 border-b-2 border-indigo-500 focus:outline-none bg-transparent flex-1"
                          />
                        ) : (
                          <>
                            <h2 className="text-xl font-semibold text-gray-900">
                              {formData.name || editingTicket.name}
                            </h2>
                            <button
                              type="button"
                              onClick={() => setIsEditingHeaderTitle(true)}
                              className="text-gray-400 hover:text-indigo-600 transition"
                              title="Edit title"
                            >
                              ✏️
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={copyShareLink}
                          className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                        >
                          🔗 Share
                        </button>
                      </div>
                      <div className="text-sm text-gray-500 mt-0.5">
                        {opCentre?.name} → {currentBoard?.name || activeBoard?.name || 'Select Board'}
                        {currentZone && ` → ${currentZone.name}`}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        Created {formatDate(editingTicket.createdAt)}
                        {editingTicket.updatedAt && editingTicket.updatedAt !== editingTicket.createdAt && (
                          <span> • Updated {formatDateTime(editingTicket.updatedAt)}</span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-col items-end">
                <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-2xl">
                  ×
                </button>
                {editingTicket && linkedTicketsCount > 0 && (
                  <button
                    type="button"
                    onClick={scrollToLinkedTickets}
                    className="text-sm text-gray-500 hover:text-indigo-600 hover:underline mt-2"
                  >
                    Linked Tickets ({linkedTicketsCount})
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Content */}
          <form
            id="ticketForm"
            onSubmit={onSubmit}
            onInvalid={(e) => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className="flex-1 flex overflow-hidden"
          >
            {/* Left Panel (2/3) */}
            <div className="w-2/3 border-r border-gray-200 overflow-y-auto">
              <div className="p-6 space-y-6">
                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                  <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
                    <RichTextToolbar
                      onBold={handleBold}
                      onItalic={handleItalic}
                      onBulletList={handleBulletList}
                      onNumberList={handleNumberList}
                      onTable={handleTable}
                      onLink={handleLink}
                      onImage={handleImageInsert}
                      onFile={() => fileInputRef.current?.click()}
                    />
                    <div
                      ref={descriptionRef}
                      contentEditable
                      className="min-h-[120px] p-3 focus:outline-none prose prose-sm max-w-none [&_img]:ml-4 [&_img]:w-2/3 [&_img]:rounded [&_img]:my-2 [&_img]:cursor-pointer [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:my-2 [&_li]:ml-2"
                      data-placeholder="Add a description..."
                      onBlur={(e) => setFormData({ ...formData, description: e.currentTarget.innerHTML })}
                      onClick={(e) => {
                        if (e.target.tagName === 'IMG') {
                          e.preventDefault();
                          const win = window.open('', '_blank');
                          win.document.write(
                            `<html><head><title>Image Preview</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111;"><img src="${e.target.src}" style="max-width:100%;max-height:100vh;" /></body></html>`
                          );
                        }
                      }}
                      onKeyDown={(e) => {
                        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
                        const modKey = isMac ? e.metaKey : e.ctrlKey;
                        if (modKey && e.key === 'z' && !e.shiftKey) {
                          document.execCommand('undo');
                          e.preventDefault();
                        } else if (modKey && e.key === 'z' && e.shiftKey) {
                          document.execCommand('redo');
                          e.preventDefault();
                        } else if (modKey && e.key === 'y') {
                          document.execCommand('redo');
                          e.preventDefault();
                        } else if (modKey && e.key === 'b') {
                          document.execCommand('bold');
                          e.preventDefault();
                        } else if (modKey && e.key === 'i') {
                          document.execCommand('italic');
                          e.preventDefault();
                        } else if (modKey && e.key === 'u') {
                          document.execCommand('underline');
                          e.preventDefault();
                        } else if (e.key === 'Enter' && !e.shiftKey) {
                          const selection = window.getSelection();
                          const node = selection?.anchorNode;
                          let inList = false;
                          let current = node;
                          while (current && current !== e.target) {
                            if (current.nodeName === 'UL' || current.nodeName === 'OL' || current.nodeName === 'LI') {
                              inList = true;
                              break;
                            }
                            current = current.parentNode;
                          }
                          if (!inList) {
                            e.preventDefault();
                            document.execCommand('insertLineBreak');
                          }
                        }
                      }}
                      dangerouslySetInnerHTML={{ __html: formData.description || '' }}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Drag & drop files or use toolbar</p>
                </div>

                {/* Attachments */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Attachments ({(formData.attachments || []).length})
                    </label>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                    >
                      + Add Files
                    </button>
                  </div>
                  <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
                  {(formData.attachments || []).length > 0 ? (
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {(formData.attachments || []).map((att) => (
                        <AttachmentThumbnail
                          key={att.id}
                          attachment={att}
                          onOpen={handleOpenAttachment}
                          onDelete={handleDeleteAttachment}
                        />
                      ))}
                    </div>
                  ) : (
                    <div
                      className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center text-gray-400 text-sm"
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      Drop files here or click "Add Files"
                    </div>
                  )}
                </div>

                {/* Activity/Comments - v177c: moved above Linked Tickets */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Activity ({(formData.comments || []).length} comments)
                  </label>
                  <div className="mb-4">
                    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
                      <RichTextToolbar
                        onBold={handleBold}
                        onItalic={handleItalic}
                        onBulletList={handleBulletList}
                        onNumberList={handleNumberList}
                        onTable={handleTable}
                        onLink={handleLink}
                        onImage={handleCommentImageInsert}
                        onFile={() => commentFileInputRef.current?.click()}
                        compact={true}
                      />
                      <input
                        ref={commentFileInputRef}
                        type="file"
                        multiple
                        onChange={handleCommentFileSelect}
                        className="hidden"
                      />
                      <div
                        ref={commentRef}
                        contentEditable
                        className="min-h-[60px] px-3 py-2 text-sm focus:outline-none prose prose-sm max-w-none [&_img]:ml-4 [&_img]:w-2/3 [&_img]:rounded [&_img]:my-2 [&_img]:cursor-pointer [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:my-2 [&_li]:ml-2"
                        onClick={(e) => {
                          if (e.target.tagName === 'IMG') {
                            e.preventDefault();
                            const win = window.open('', '_blank');
                            win.document.write(
                              `<html><head><title>Image Preview</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111;"><img src="${e.target.src}" style="max-width:100%;max-height:100vh;" /></body></html>`
                            );
                          }
                        }}
                        onKeyDown={(e) => {
                          const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
                          const modKey = isMac ? e.metaKey : e.ctrlKey;
                          if (modKey && e.key === 'z' && !e.shiftKey) {
                            document.execCommand('undo');
                            e.preventDefault();
                          } else if (modKey && e.key === 'z' && e.shiftKey) {
                            document.execCommand('redo');
                            e.preventDefault();
                          } else if (modKey && e.key === 'y') {
                            document.execCommand('redo');
                            e.preventDefault();
                          } else if (modKey && e.key === 'b') {
                            document.execCommand('bold');
                            e.preventDefault();
                          } else if (modKey && e.key === 'i') {
                            document.execCommand('italic');
                            e.preventDefault();
                          } else if (modKey && e.key === 'u') {
                            document.execCommand('underline');
                            e.preventDefault();
                          } else if (e.key === 'Enter' && !e.shiftKey) {
                            const selection = window.getSelection();
                            const node = selection?.anchorNode;
                            let inList = false;
                            let current = node;
                            while (current && current !== e.target) {
                              if (current.nodeName === 'UL' || current.nodeName === 'OL' || current.nodeName === 'LI') {
                                inList = true;
                                break;
                              }
                              current = current.parentNode;
                            }
                            if (!inList) {
                              e.preventDefault();
                              document.execCommand('insertLineBreak');
                            }
                          }
                        }}
                        data-placeholder="Add a comment..."
                        style={{ minHeight: '60px' }}
                      />
                      <div className="flex items-center justify-between p-2 bg-gray-50 border-t border-gray-200">
                        <span className="text-xs text-gray-400">Supports formatting, images & files</span>
                        <button
                          type="button"
                          onClick={handleAddComment}
                          className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700"
                        >
                          Comment
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {(formData.comments || []).map((c) => (
                      <CommentItem
                        key={c.id}
                        comment={c}
                        onEdit={handleEditComment}
                        onDelete={handleDeleteComment}
                        staff={company?.globalStaff}
                      />
                    ))}
                  </div>
                </div>

                {/* Linked Tickets Section - v179b: added onLinkAdded, onLinkRemoved */}
                {editingTicket && (
                  <LinkedTicketsSection
                    ref={linkedTicketsRef}
                    ticket={editingTicket}
                    formData={formData}
                    setFormData={setFormData}
                    onOpenTicket={onOpenLinkedTicket}
                    initialExpanded={linkedTicketsCount > 0}
                    onLinkAdded={onLinkAdded}
                    onLinkRemoved={onLinkRemoved}
                  />
                )}
              </div>
            </div>

            {/* Right Panel (1/3) */}
            <div className="w-1/3 overflow-y-auto bg-gray-50">
              <div className="p-5 space-y-4">
                {ticketType && (
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                      Type
                    </label>
                    <div className="px-2 py-1.5 bg-white border border-gray-200 rounded text-sm text-gray-700 flex items-center gap-2">
                      <span>{ticketType.icon}</span>
                      <span>{ticketType.name}</span>
                      {!editingTicket && (
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, type: '' })}
                          className="ml-auto text-xs text-gray-400 hover:text-gray-600"
                        >
                          Change
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {editingTicket && ticketType && (
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                      Status
                    </label>
                    <select
                      value={formData.status || editingTicket?.status || 'backlog'}
                      onChange={(e) => onStatusChange && onStatusChange(e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
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
                  </div>
                )}
                {ticketType && rightPanelFields.includes('name') && (
                  <div className="mb-3">
                    <DynamicField
                      fieldId="name"
                      formData={formData}
                      setFormData={setFormData}
                      opCentre={opCentre}
                      company={company}
                      activeBoard={activeBoard}
                      getFieldForBoard={getFieldForBoard}
                      ticketTypeId={ticketType.id}
                      compact={true}
                    />
                  </div>
                )}
                {ticketType && (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    {rightPanelFields
                      .filter((f) => f !== 'name')
                      .map((fieldId) => (
                        <DynamicField
                          key={fieldId}
                          fieldId={fieldId}
                          formData={formData}
                          setFormData={setFormData}
                          opCentre={opCentre}
                          company={company}
                          activeBoard={activeBoard}
                          getFieldForBoard={getFieldForBoard}
                          ticketTypeId={ticketType.id}
                          compact={true}
                        />
                      ))}
                    {additionalFields.map((fieldId) => (
                      <DynamicField
                        key={fieldId}
                        fieldId={fieldId}
                        formData={formData}
                        setFormData={setFormData}
                        opCentre={opCentre}
                        company={company}
                        activeBoard={activeBoard}
                        getFieldForBoard={getFieldForBoard}
                        ticketTypeId={ticketType.id}
                        compact={true}
                      />
                    ))}
                  </div>
                )}
                {(editingTicket || currentZone) && (
                  <div className="pt-3 mt-3 border-t border-gray-200">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                      Location
                    </label>
                    {(() => {
                      const isSimpleBoard = !currentBoard?.workUnitSeries?.enabled;
                      const zones = currentBoard?.workZones || [];
                      if (isSimpleBoard && zones.length <= 1) {
                        return (
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Stage</label>
                            <select
                              value={
                                formData.column || editingTicket?.column || getStageName(currentZone?.workStages?.[0])
                              }
                              onChange={(e) => {
                                const newStageName = e.target.value;
                                const selectedZone = zones[0] || currentZone;
                                const newStatus = getStageDefaultStatus(selectedZone?.workStages, newStageName);
                                setFormData({ ...formData, column: newStageName, status: newStatus });
                              }}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
                            >
                              {(zones[0]?.workStages || currentZone?.workStages || []).map((s, idx) => {
                                const stageName = getStageName(s);
                                return (
                                  <option key={stageName || idx} value={stageName}>
                                    {stageName}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        );
                      }
                      return (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Work Zone</label>
                            <select
                              value={formData.sectionId || editingTicket?.sectionId || currentZone?.id}
                              onChange={(e) => {
                                const z = currentBoard?.workZones?.find((wz) => wz.id === e.target.value);
                                const firstStage = z?.workStages?.[0];
                                const newStageName = getStageName(firstStage) || formData.column;
                                const newStatus = getStageDefaultStatus(z?.workStages, newStageName);
                                setFormData({
                                  ...formData,
                                  sectionId: e.target.value,
                                  column: newStageName,
                                  status: newStatus,
                                });
                              }}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
                            >
                              {currentBoard?.workZones?.map((z) => (
                                <option key={z.id} value={z.id}>
                                  {z.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Stage</label>
                            <select
                              value={
                                formData.column || editingTicket?.column || getStageName(currentZone?.workStages?.[0])
                              }
                              onChange={(e) => {
                                const newStageName = e.target.value;
                                const selectedZone = currentBoard?.workZones?.find(
                                  (wz) => wz.id === (formData.sectionId || editingTicket?.sectionId || currentZone?.id)
                                );
                                const newStatus = getStageDefaultStatus(selectedZone?.workStages, newStageName);
                                setFormData({ ...formData, column: newStageName, status: newStatus });
                              }}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
                            >
                              {(
                                currentBoard?.workZones?.find(
                                  (wz) => wz.id === (formData.sectionId || editingTicket?.sectionId || currentZone?.id)
                                )?.workStages || []
                              ).map((s, idx) => {
                                const stageName = getStageName(s);
                                return (
                                  <option key={stageName || idx} value={stageName}>
                                    {stageName}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {!ticketType && (
                  <div className="text-center py-12 text-gray-400">
                    <div className="text-4xl mb-3">👆</div>
                    <p className="text-sm">
                      Select a ticket type above
                      <br />
                      to continue
                    </p>
                  </div>
                )}
              </div>
            </div>
          </form>

          {/* Footer */}
          <div className="flex-shrink-0 px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex justify-between items-center">
              <div>
                {editingTicket && (
                  <button
                    type="button"
                    onClick={() => setShowHistoryPanel(true)}
                    className="px-4 py-2 text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-medium flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    History
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
                >
                  {editingTicket && hasChanges ? 'Cancel' : 'Close'}
                </button>
                <button
                  type="submit"
                  form="ticketForm"
                  disabled={!ticketType || (editingTicket && !hasChanges)}
                  className={`px-6 py-2 rounded-lg font-medium ${!ticketType || (editingTicket && !hasChanges) ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                >
                  {editingTicket ? (hasChanges ? 'Save Changes' : 'No Changes') : 'Create Ticket'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* History Panel */}
        {showHistoryPanel && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
            <div className="bg-white rounded-lg max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900">Ticket History</h3>
                <button onClick={() => setShowHistoryPanel(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {editingTicket?.history && editingTicket.history.length > 0 ? (
                  <div className="space-y-4">
                    {[...(editingTicket.history || [])].reverse().map((entry, idx) => {
                      const date = new Date(entry.timestamp);
                      const formattedDate = date.toLocaleDateString('en-NZ', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      });
                      let description = '';
                      let icon = '📝';
                      switch (entry.type) {
                        case 'created':
                          icon = '✨';
                          description = `Ticket created in ${entry.to?.zoneName || 'unknown zone'}`;
                          break;
                        case 'status':
                          icon = '🔄';
                          description = `Status changed from "${entry.from?.name || 'none'}" to "${entry.to?.name || 'none'}"`;
                          break;
                        case 'assignee':
                          icon = '👤';
                          description = entry.from?.name
                            ? `Assignee changed from ${entry.from.name} to ${entry.to?.name || 'unassigned'}`
                            : `Assigned to ${entry.to?.name || 'unknown'}`;
                          break;
                        case 'location':
                          icon = '📍';
                          if (entry.reason === 'sprint-start') {
                            description = `Moved to ${entry.to?.workUnitName || entry.to?.zoneName} (sprint started)`;
                          } else if (entry.reason === 'rollover') {
                            description = `Rolled over to ${entry.to?.workUnitName || entry.to?.zoneName}`;
                          } else {
                            let locationPrefix = '';
                            if (
                              entry.from?.opCentreId &&
                              entry.to?.opCentreId &&
                              entry.from.opCentreId !== entry.to.opCentreId
                            ) {
                              locationPrefix = `${entry.to.opCentreName} → `;
                            }
                            if (entry.from?.boardId && entry.to?.boardId && entry.from.boardId !== entry.to.boardId) {
                              locationPrefix += `${entry.to.boardName} → `;
                            }
                            description = `Moved to ${locationPrefix}${entry.to?.zoneName || 'unknown'} → ${entry.to?.stage || 'unknown'}`;
                          }
                          break;
                        case 'workUnit':
                          icon = '🏃';
                          description = entry.from?.name
                            ? `Work unit changed from ${entry.from.name} to ${entry.to?.name || 'none'}`
                            : `Assigned to ${entry.to?.name || 'none'}`;
                          break;
                        case 'field':
                          icon = '✏️';
                          description = `${entry.field} changed from "${entry.from?.value || 'none'}" to "${entry.to?.value || 'none'}"`;
                          break;
                        default:
                          description = `${entry.type} changed`;
                      }
                      let reasonBadge = null;
                      if (entry.reason && entry.reason !== 'manual' && entry.reason !== 'created') {
                        const reasonLabels = {
                          'bulk-edit': 'Bulk Edit',
                          rollover: 'Rollover',
                          'sprint-start': 'Sprint Start',
                          'sprint-complete': 'Sprint Complete',
                        };
                        reasonBadge = reasonLabels[entry.reason] || entry.reason;
                      }
                      return (
                        <div key={idx} className="flex gap-3">
                          <div className="flex-shrink-0 text-lg">{icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-gray-900">{description}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-gray-500">{formattedDate}</span>
                              {entry.userName && <span className="text-xs text-gray-500">by {entry.userName}</span>}
                              {reasonBadge && (
                                <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                                  {reasonBadge}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <svg
                      className="w-12 h-12 mx-auto text-gray-300 mb-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <p>No history recorded yet</p>
                    <p className="text-sm mt-1">Changes to this ticket will appear here</p>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-200">
                <button
                  onClick={() => setShowHistoryPanel(false)}
                  className="w-full px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Link Modal */}
        {showLinkModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
            <div className="bg-white rounded-lg p-6 w-96">
              <h3 className="text-lg font-semibold mb-4">Insert Link</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Display Text</label>
                  <input
                    type="text"
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                    placeholder="Link text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setShowLinkModal(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={insertLink}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  Insert
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Ticket Creation Success Modal
  const TicketSuccessModal = ({ ticketInfo, onClose, onGoToTicket, currentBoardId, currentZoneId }) => {
    if (!ticketInfo) return null;
    const { ticket, board, zone, opCentre } = ticketInfo;
    const ticketType = window.globalCompany?.globalTicketTypes?.find((tt) => tt.id === ticket.typeId);
    const isAlreadyThere = currentBoardId === board?.id && currentZoneId === zone?.id;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[9999]">
        <div className="bg-white rounded-lg max-w-lg w-full">
          <div className="p-6 border-b border-gray-200 bg-green-50">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-green-900">Ticket Created Successfully!</h2>
                <p className="text-sm text-green-700 mt-1">{ticket.id}</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <div className="text-sm font-medium text-gray-500 mb-1">Ticket Name</div>
              <div className="text-lg font-semibold text-gray-900">{ticket.name || 'Untitled'}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-gray-500 mb-1">Type</div>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{ticketType?.icon || '📋'}</span>
                  <span className="text-sm font-medium text-gray-900">{ticketType?.name || 'Ticket'}</span>
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-gray-500 mb-1">Status</div>
                <div className="text-sm font-medium text-gray-900">{ticket.column}</div>
              </div>
            </div>
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
              <div className="text-sm font-medium text-indigo-900 mb-2">📍 Ticket Location</div>
              <div className="space-y-1 text-sm text-indigo-700">
                <div>
                  <span className="font-medium">Work Centre:</span> {opCentre?.name}
                </div>
                <div>
                  <span className="font-medium">Board:</span> {board?.name}
                </div>
                <div>
                  <span className="font-medium">Zone:</span> {zone?.name}
                </div>
                <div>
                  <span className="font-medium">Stage:</span> {ticket.column}
                </div>
              </div>
            </div>
          </div>
          <div className="p-6 border-t border-gray-200 flex gap-3">
            {isAlreadyThere ? (
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
              >
                Done
              </button>
            ) : (
              <>
                <button
                  onClick={onGoToTicket}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
                >
                  View on Board
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                >
                  Stay Here
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Export to window namespace
  window.Components = window.Components || {};
  window.Components.TicketModals = {
    TicketModal,
    TicketSuccessModal,
    AddLinkModal,
    LinkedTicketsSection,
  };

  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['ticket-modals'] = COMPONENT_VERSION;

  console.log(`[ticket-modals.jsx] TicketModals loaded (${COMPONENT_VERSION})`);
})();

// domain/statuses.js
// -----------------------------------------------------------------------------
// STATUS DOMAIN LOGIC
// Pure functions only — no React, no state mutation
// Attaches to window.Domain.Statuses
//
// Version: v167a
//
// v167a Changes:
// - BUG-166-002 FIX: isDeletedStatus() now handles missing 'deleted' status in data
// - Shortcut: if statusId === 'deleted', returns true immediately
// - Fixes issue where company.statuses array missing 'deleted' entry caused filter to fail
//
// v158a Changes:
// - Added 'deleted' as 7th canonical status type
// - New predefined status: { id: 'deleted', label: 'Deleted', type: 'deleted' }
// - New helper: isDeletedStatus()
// - Added 'deleted' keywords for inference
// - Deleted tickets excluded from normal views, searchable by admin
//
// v154a Changes:
// - AMBIGUOUS_KEYWORDS now uses stem/base forms for matching
// - 'close' matches close/closed/closes, 'archive' matches archive/archived, etc.
// - Fixes bug where present tense terms (archive, shelve) weren't triggering warnings
//
// v154 Changes:
// - Added scopedAt lifecycle date support
// - New helper: shouldSetScopedAt()
// - Updated getLifecycleDateUpdates() to include scopedAt
// - scopedAt is permanent once set (never cleared)
// - Added alternatives array to AMBIGUOUS_KEYWORDS for warning modal
// - Updated getAmbiguousKeywordWarning() to return full config object
//
// v153 Changes:
// - Added component version registry support
//
// v144 Changes:
// - 6-type status model: backlog → scoped → queued → active → completed → ended
// - Expanded keyword mappings for better inference
// - Ambiguous keywords list with warning messages
// - New helpers: isQueuedStatus, isScopedStatus, isCompletedStatus, isEndedStatus
// - Lifecycle date helpers: getStatusType, shouldSetStartedAt, etc.
// -----------------------------------------------------------------------------

(function () {
  'use strict';

  // v167a: Component version for registry
  const COMPONENT_VERSION = 'v167a';

  // ---------------------------------------------------------------------------
  // CONSTANTS
  // ---------------------------------------------------------------------------

  /**
   * Status Types (v158a - 7-type model):
   * - backlog: Not committed, future maybe
   * - scoped: Committed to work unit, not yet queued
   * - queued: In active work queue, ready to pick up (triggers startedAt)
   * - active: Someone is working on it (triggers startedAt if not set)
   * - completed: Work finished successfully (triggers completedAt)
   * - ended: Work stopped without completion (triggers endedAt)
   * - deleted: Soft-deleted, excluded from normal views (v158a)
   */
  const STATUS_TYPES = ['backlog', 'scoped', 'queued', 'active', 'completed', 'ended', 'deleted'];

  const PREDEFINED_STATUSES = [
    // Backlog - not committed
    { id: 'new', label: 'New', type: 'backlog', predefined: true },
    { id: 'backlog', label: 'Backlog', type: 'backlog', predefined: true },

    // Scoped - committed to work unit, not yet queued
    { id: 'ready', label: 'Ready', type: 'scoped', predefined: true },

    // Queued - in active work queue
    { id: 'todo', label: 'To Do', type: 'queued', predefined: true },

    // Active - work happening
    { id: 'in-progress', label: 'In Progress', type: 'active', predefined: true },
    { id: 'blocked', label: 'Blocked', type: 'active', predefined: true },
    { id: 'review', label: 'Review', type: 'active', predefined: true },

    // Terminal states
    { id: 'completed', label: 'Completed', type: 'completed', predefined: true },
    { id: 'cancelled', label: 'Cancelled', type: 'ended', predefined: true },

    // v158a: Soft-delete status (excluded from normal views)
    { id: 'deleted', label: 'Deleted', type: 'deleted', predefined: true },
  ];

  // Original labels for Reset functionality
  const PREDEFINED_STATUS_LABELS = {
    new: 'New',
    backlog: 'Backlog',
    ready: 'Ready',
    todo: 'To Do',
    'in-progress': 'In Progress',
    blocked: 'Blocked',
    review: 'Review',
    completed: 'Completed',
    cancelled: 'Cancelled',
    deleted: 'Deleted', // v158a
  };

  // ---------------------------------------------------------------------------
  // KEYWORD MAPPINGS (v144)
  // ---------------------------------------------------------------------------

  /**
   * Keywords for inferring status from stage names.
   * Order matters within each type - more specific patterns first.
   */
  const STATUS_KEYWORDS = {
    backlog: [
      'new',
      'inbox',
      'incoming',
      'icebox',
      'someday',
      'later',
      'triage',
      'consider',
      'parked',
      'unassigned',
      'backlog',
      'future',
      'wishlist',
      'ideas',
      'proposed',
      'suggestions',
    ],
    scoped: [
      'ready',
      'next',
      'up-next',
      'upnext',
      'priority',
      'planned',
      'sprint-ready',
      'sprintready',
      'committed',
      'selected',
      'approved',
      'prepared',
      'allocated',
      'defined',
      'outlined',
      'confirmed',
    ],
    queued: [
      'todo',
      'to-do',
      'to do',
      'queued',
      'assigned',
      'on-deck',
      'ondeck',
      'lined-up',
      'linedup',
      'slated',
      'designated',
      'tasked',
      'rostered',
      'earmarked',
    ],
    active: [
      'progress',
      'doing',
      'underway',
      'working',
      'started',
      'current',
      'blocked',
      'block',
      'review',
      'qa',
      'test',
      'testing',
      'approval',
      'ongoing',
      'developing',
      'processing',
      'executing',
      'implementing',
      'building',
    ],
    completed: [
      'done',
      'complete',
      'completed',
      'finished',
      'finish',
      'successful',
      'success',
      'resolved',
      'delivered',
      'shipped',
      'ship',
      'released',
      'merged',
      'accomplished',
      'achieved',
      'fulfilled',
      'finalized',
      'concluded',
    ],
    ended: [
      'cancelled',
      'canceled',
      'abandoned',
      'dropped',
      'rejected',
      "won't",
      'wont',
      'wontfix',
      "won't fix",
      'obsolete',
      'duplicate',
      'terminated',
      'discontinued',
      'scrapped',
      'withdrawn',
      'ceased',
    ],
    // v158a: Deleted status keywords
    deleted: ['deleted', 'removed', 'trashed', 'purged'],
  };

  /**
   * Ambiguous keywords that map to a default type with a warning.
   * These terms are context-dependent and may need user clarification.
   * v154: Added alternatives array for warning modal suggestions
   */
  /**
   * Keys use stem/base forms to match both present and past tense:
   * 'close' matches: close, closed, closes
   * 'archive' matches: archive, archived, archives
   * etc.
   */
  const AMBIGUOUS_KEYWORDS = {
    close: {
      defaultType: 'ended',
      defaultStatus: 'cancelled',
      warning:
        '"Closed" maps to the system status type of Ended. If you intend a positive outcome (work finished successfully), consider using a clearer term.',
      alternatives: ['Done', 'Completed', 'Finished'],
    },
    hold: {
      defaultType: 'active',
      defaultStatus: 'blocked',
      warning:
        '"On Hold" maps to the system status type of Active (paused work). If you intend work that has been permanently stopped, consider using a clearer term.',
      alternatives: ['Blocked', 'Paused', 'Cancelled'],
    },
    'on hold': {
      defaultType: 'active',
      defaultStatus: 'blocked',
      warning:
        '"On Hold" maps to the system status type of Active (paused work). If you intend work that has been permanently stopped, consider using a clearer term.',
      alternatives: ['Blocked', 'Paused', 'Cancelled'],
    },
    defer: {
      defaultType: 'backlog',
      defaultStatus: 'backlog',
      warning:
        '"Deferred" maps to the system status type of Backlog (may be done later). If you intend work that will not be done, consider using a clearer term.',
      alternatives: ['Backlog', 'Later', 'Cancelled'],
    },
    archive: {
      defaultType: 'completed',
      defaultStatus: 'completed',
      warning:
        '"Archived" maps to the system status type of Completed (finished and filed). If you intend work that was stopped without completion, consider using a clearer term.',
      alternatives: ['Done', 'Completed', 'Cancelled'],
    },
    pending: {
      defaultType: 'queued',
      defaultStatus: 'todo',
      warning:
        '"Pending" maps to the system status type of Queued (waiting in line). If you intend work awaiting a decision or blocked, consider using a clearer term.',
      alternatives: ['To Do', 'Awaiting Approval', 'Blocked'],
    },
    schedule: {
      defaultType: 'scoped',
      defaultStatus: 'ready',
      warning:
        '"Scheduled" maps to the system status type of Scoped (planned for a future work unit). If you intend work ready to begin immediately, consider using a clearer term.',
      alternatives: ['Ready', 'To Do', 'Planned'],
    },
    shelve: {
      defaultType: 'ended',
      defaultStatus: 'cancelled',
      warning:
        '"Shelved" maps to the system status type of Ended (work stopped). If you intend to revisit this work later, consider using a clearer term.',
      alternatives: ['Deferred', 'Parked', 'Cancelled'],
    },
  };

  // ---------------------------------------------------------------------------
  // INFERENCE
  // ---------------------------------------------------------------------------

  /**
   * Infer a status ID from a stage name.
   * Uses comprehensive keyword matching with ambiguous term handling.
   *
   * @param {string} stageName - The name of the stage
   * @returns {string} - Status ID (defaults to 'backlog')
   */
  function inferStatusFromStageName(stageName) {
    if (!stageName) return 'backlog';

    const nameLower = stageName.toLowerCase().trim();

    // Check for exact type name matches first
    if (nameLower === 'not started' || nameLower === 'not-started') return 'new';
    if (nameLower === 'active') return 'in-progress';

    // Check ambiguous keywords first (before regular matching)
    for (const [keyword, config] of Object.entries(AMBIGUOUS_KEYWORDS)) {
      if (nameLower === keyword || nameLower.includes(keyword)) {
        return config.defaultStatus;
      }
    }

    // Check each type's keywords (order: more terminal states first to catch them)
    // Ended keywords
    for (const keyword of STATUS_KEYWORDS.ended) {
      if (nameLower.includes(keyword)) return 'cancelled';
    }

    // Completed keywords
    for (const keyword of STATUS_KEYWORDS.completed) {
      if (nameLower.includes(keyword)) return 'completed';
    }

    // Active keywords (includes blocked, review)
    for (const keyword of STATUS_KEYWORDS.active) {
      if (nameLower.includes(keyword)) {
        // Map to specific status based on keyword
        if (keyword === 'blocked' || keyword === 'block') return 'blocked';
        if (
          keyword === 'review' ||
          keyword === 'qa' ||
          keyword === 'test' ||
          keyword === 'testing' ||
          keyword === 'approval'
        )
          return 'review';
        return 'in-progress';
      }
    }

    // Queued keywords
    for (const keyword of STATUS_KEYWORDS.queued) {
      if (nameLower.includes(keyword)) return 'todo';
    }

    // Scoped keywords
    for (const keyword of STATUS_KEYWORDS.scoped) {
      if (nameLower.includes(keyword)) return 'ready';
    }

    // Backlog keywords
    for (const keyword of STATUS_KEYWORDS.backlog) {
      if (nameLower.includes(keyword)) return nameLower.includes('new') ? 'new' : 'backlog';
    }

    return 'backlog'; // Default fallback
  }

  /**
   * Get the warning message for an ambiguous keyword, if any.
   *
   * @param {string} stageName - The name of the stage
   * @returns {string|null} - Warning message or null if not ambiguous
   */
  /**
   * v154: Get ambiguous keyword info for a stage name.
   * Returns full config object if ambiguous keyword found, null otherwise.
   *
   * @param {string} stageName - The stage name to check
   * @returns {object|null} - { keyword, defaultType, defaultStatus, warning, alternatives } or null
   */
  function getAmbiguousKeywordWarning(stageName) {
    if (!stageName) return null;

    const nameLower = stageName.toLowerCase().trim();

    for (const [keyword, config] of Object.entries(AMBIGUOUS_KEYWORDS)) {
      if (nameLower === keyword || nameLower.includes(keyword)) {
        return {
          keyword,
          originalName: stageName,
          ...config,
        };
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // STAGE HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Get the name from a stage (handles both string and object stages).
   *
   * @param {string|object} stage - Stage as string or {name, defaultStatus}
   * @returns {string} - The stage name
   */
  function getStageName(stage) {
    if (typeof stage === 'string') return stage;
    return stage?.name || '';
  }

  /**
   * Get the default status for a stage.
   *
   * @param {string|object} stage - Stage as string or {name, defaultStatus}
   * @returns {string} - Status ID
   */
  function getStageStatus(stage) {
    if (typeof stage === 'string') {
      return inferStatusFromStageName(stage);
    }
    return stage?.defaultStatus || inferStatusFromStageName(stage?.name);
  }

  /**
   * Get the default status for a named stage within a stages array.
   *
   * @param {Array} stages - Array of stages
   * @param {string} stageName - Name to find
   * @returns {string} - Status ID (defaults to 'backlog')
   */
  function getStageDefaultStatus(stages, stageName) {
    if (!stages || stages.length === 0) return 'backlog';

    // Handle string array (legacy)
    if (typeof stages[0] === 'string') {
      return inferStatusFromStageName(stageName);
    }

    // Handle object array
    const stage = stages.find((s) => s.name === stageName);
    return stage?.defaultStatus || 'backlog';
  }

  // ---------------------------------------------------------------------------
  // MIGRATION
  // ---------------------------------------------------------------------------

  /**
   * Migrate workStages from string[] to object[].
   * Idempotent - safe to call on already-migrated data.
   *
   * @param {Array} stages - Array of stages (strings or objects)
   * @returns {Array} - Array of stage objects with {name, defaultStatus}
   */
  function migrateWorkStages(stages) {
    if (!stages || stages.length === 0) return [];

    // Check if already migrated (first element is object)
    if (typeof stages[0] === 'object' && stages[0].name) {
      return stages;
    }

    // Migrate from string array to object array
    return stages.map((stageName) => ({
      name: stageName,
      defaultStatus: inferStatusFromStageName(stageName),
    }));
  }

  // ---------------------------------------------------------------------------
  // STAGE LOOKUP
  // ---------------------------------------------------------------------------

  /**
   * Find all stages on a board that match a given status.
   *
   * @param {object} board - Board with workZones
   * @param {string} statusId - Status ID to match
   * @returns {Array} - Array of {zoneId, zoneName, stageName, stage}
   */
  function findStagesForStatus(board, statusId) {
    if (!board || !statusId) return [];

    const matches = [];

    (board.workZones || []).forEach((zone) => {
      (zone.workStages || []).forEach((stage) => {
        const stageStatus = getStageStatus(stage);

        if (stageStatus === statusId) {
          matches.push({
            zoneId: zone.id,
            zoneName: zone.name,
            stageName: getStageName(stage),
            stage: stage,
          });
        }
      });
    });

    return matches;
  }

  // ---------------------------------------------------------------------------
  // STATUS CHANGE ACTIONS
  // ---------------------------------------------------------------------------

  /**
   * Determine what should happen when a ticket's status changes.
   *
   * @param {object} board - The current board
   * @param {string} currentZoneId - Ticket's current zone ID
   * @param {string} currentStageName - Ticket's current stage name
   * @param {string} newStatusId - The new status being set
   * @returns {object} - {action, target?, matches?, reason}
   *   action: 'stay' | 'move' | 'prompt' | 'clear'
   */
  function getStatusChangeMoveAction(board, currentZoneId, currentStageName, newStatusId) {
    // Check if current stage already has this status
    const currentZone = board?.workZones?.find((z) => z.id === currentZoneId);
    if (currentZone) {
      const currentStage = currentZone.workStages?.find((s) => getStageName(s) === currentStageName);
      if (currentStage) {
        const currentStatus = getStageStatus(currentStage);

        if (currentStatus === newStatusId) {
          return { action: 'stay', reason: 'Current stage already has this status' };
        }
      }
    }

    // Find all stages that match the new status
    const matches = findStagesForStatus(board, newStatusId);

    if (matches.length === 0) {
      return { action: 'clear', reason: 'No stage on this board matches the selected status' };
    }

    if (matches.length === 1) {
      return { action: 'move', target: matches[0], reason: 'Auto-moving to matching stage' };
    }

    return { action: 'prompt', matches: matches, reason: 'Multiple stages match - user must choose' };
  }

  // ---------------------------------------------------------------------------
  // STATUS TYPE HELPERS (v144 - 6-type model)
  // ---------------------------------------------------------------------------

  /**
   * Get the type of a status.
   *
   * @param {string} statusId - Status ID
   * @param {Array} statuses - Array of status objects (optional)
   * @returns {string|undefined} - 'backlog' | 'scoped' | 'queued' | 'active' | 'completed' | 'ended'
   */
  function getStatusType(statusId, statuses) {
    const list = statuses || PREDEFINED_STATUSES;
    const status = list.find((s) => s.id === statusId);
    return status?.type;
  }

  /**
   * Get all statuses of a given type.
   *
   * @param {Array} statuses - Array of status objects (or uses PREDEFINED_STATUSES)
   * @param {string} type - 'backlog' | 'scoped' | 'queued' | 'active' | 'completed' | 'ended'
   * @returns {Array} - Filtered statuses
   */
  function getStatusesByType(statuses, type) {
    const list = statuses || PREDEFINED_STATUSES;
    return list.filter((s) => s.type === type);
  }

  /**
   * Get a status object by ID.
   *
   * @param {string} statusId - Status ID
   * @param {Array} statuses - Array of status objects (optional)
   * @returns {object|undefined}
   */
  function getStatusById(statusId, statuses) {
    const list = statuses || PREDEFINED_STATUSES;
    return list.find((s) => s.id === statusId);
  }

  // Individual type checkers

  function isBacklogStatus(statusId, statuses) {
    return getStatusType(statusId, statuses) === 'backlog';
  }

  function isScopedStatus(statusId, statuses) {
    return getStatusType(statusId, statuses) === 'scoped';
  }

  function isQueuedStatus(statusId, statuses) {
    return getStatusType(statusId, statuses) === 'queued';
  }

  function isActiveStatus(statusId, statuses) {
    return getStatusType(statusId, statuses) === 'active';
  }

  function isCompletedStatus(statusId, statuses) {
    return getStatusType(statusId, statuses) === 'completed';
  }

  function isEndedStatus(statusId, statuses) {
    return getStatusType(statusId, statuses) === 'ended';
  }

  /**
   * v167a: Check if a status is the deleted type.
   * Deleted tickets are soft-deleted and excluded from normal views.
   *
   * BUG-166-002 FIX: Added shortcut for literal 'deleted' statusId.
   * This handles cases where company.statuses array is missing the 'deleted' entry
   * (e.g., data created before v158a added the predefined deleted status).
   *
   * @param {string} statusId - Status ID
   * @param {Array} statuses - Array of status objects (optional)
   * @returns {boolean}
   */
  function isDeletedStatus(statusId, statuses) {
    // v167a: Shortcut - literal 'deleted' is always a deleted status
    // Handles outdated statuses arrays missing the 'deleted' entry
    if (statusId === 'deleted') return true;
    return getStatusType(statusId, statuses) === 'deleted';
  }

  /**
   * Check if a status is a terminal type (completed or ended).
   *
   * @param {string} statusId - Status ID
   * @param {Array} statuses - Array of status objects (optional)
   * @returns {boolean}
   */
  function isTerminalStatus(statusId, statuses) {
    const type = getStatusType(statusId, statuses);
    return type === 'completed' || type === 'ended';
  }

  /**
   * Legacy compatibility: Check if a status is "closed" (now means completed OR ended).
   * @deprecated Use isCompletedStatus or isEndedStatus instead
   */
  function isClosedStatus(statusId, statuses) {
    return isTerminalStatus(statusId, statuses);
  }

  // ---------------------------------------------------------------------------
  // LIFECYCLE DATE HELPERS (v144)
  // ---------------------------------------------------------------------------

  /**
   * Determine if a status transition should set startedAt.
   * startedAt is set when first entering 'queued' or 'active' type.
   *
   * @param {string} newStatusId - The new status ID
   * @param {boolean} hasStartedAt - Whether ticket already has startedAt
   * @param {Array} statuses - Array of status objects (optional)
   * @returns {boolean}
   */
  function shouldSetStartedAt(newStatusId, hasStartedAt, statuses) {
    if (hasStartedAt) return false; // Already set, never overwrite
    const type = getStatusType(newStatusId, statuses);
    return type === 'queued' || type === 'active';
  }

  /**
   * v154: Determine if a status transition should set scopedAt.
   * scopedAt is set when first entering 'scoped' type (or higher: queued/active).
   * Note: workUnitId assignment also triggers scopedAt - handled separately in app.jsx.
   *
   * @param {string} newStatusId - The new status ID
   * @param {boolean} hasScopedAt - Whether ticket already has scopedAt
   * @param {Array} statuses - Array of status objects (optional)
   * @returns {boolean}
   */
  function shouldSetScopedAt(newStatusId, hasScopedAt, statuses) {
    if (hasScopedAt) return false; // Already set, never overwrite (permanent like startedAt)
    const type = getStatusType(newStatusId, statuses);
    // Scoped, queued, or active all indicate commitment to work
    return type === 'scoped' || type === 'queued' || type === 'active';
  }

  /**
   * Determine if a status transition should set completedAt.
   *
   * @param {string} newStatusId - The new status ID
   * @param {Array} statuses - Array of status objects (optional)
   * @returns {boolean}
   */
  function shouldSetCompletedAt(newStatusId, statuses) {
    return isCompletedStatus(newStatusId, statuses);
  }

  /**
   * Determine if a status transition should set endedAt.
   *
   * @param {string} newStatusId - The new status ID
   * @param {Array} statuses - Array of status objects (optional)
   * @returns {boolean}
   */
  function shouldSetEndedAt(newStatusId, statuses) {
    return isEndedStatus(newStatusId, statuses);
  }

  /**
   * Determine if a status transition should clear completedAt (reopening).
   *
   * @param {string} oldStatusId - The old status ID
   * @param {string} newStatusId - The new status ID
   * @param {Array} statuses - Array of status objects (optional)
   * @returns {boolean}
   */
  function shouldClearCompletedAt(oldStatusId, newStatusId, statuses) {
    return isCompletedStatus(oldStatusId, statuses) && !isCompletedStatus(newStatusId, statuses);
  }

  /**
   * Determine if a status transition should clear endedAt (reopening).
   *
   * @param {string} oldStatusId - The old status ID
   * @param {string} newStatusId - The new status ID
   * @param {Array} statuses - Array of status objects (optional)
   * @returns {boolean}
   */
  function shouldClearEndedAt(oldStatusId, newStatusId, statuses) {
    return isEndedStatus(oldStatusId, statuses) && !isEndedStatus(newStatusId, statuses);
  }

  /**
   * Calculate lifecycle date updates for a status change.
   * Returns an object with date fields to update on the ticket.
   *
   * v154: Now includes scopedAt for 'scoped' type transitions.
   * Note: workUnitId assignment also triggers scopedAt - handled separately in app.jsx.
   *
   * @param {object} ticket - The ticket object (needs scopedAt, startedAt, completedAt, endedAt)
   * @param {string} oldStatusId - The old status ID
   * @param {string} newStatusId - The new status ID
   * @param {Array} statuses - Array of status objects (optional)
   * @returns {object} - Object with date fields to spread onto ticket: {scopedAt?, startedAt?, completedAt?, endedAt?}
   */
  function getLifecycleDateUpdates(ticket, oldStatusId, newStatusId, statuses) {
    const updates = {};
    const now = new Date().toISOString();

    // v154: Set scopedAt on first scoped/queued/active (permanent, never cleared)
    if (shouldSetScopedAt(newStatusId, !!ticket.scopedAt, statuses)) {
      updates.scopedAt = now;
    }

    // Set startedAt on first queued/active (permanent, never cleared)
    if (shouldSetStartedAt(newStatusId, !!ticket.startedAt, statuses)) {
      updates.startedAt = now;
    }

    // Handle completed status
    if (shouldSetCompletedAt(newStatusId, statuses)) {
      updates.completedAt = now;
      // Clear endedAt if it was set (mutually exclusive)
      if (ticket.endedAt) {
        updates.endedAt = null;
      }
    } else if (shouldClearCompletedAt(oldStatusId, newStatusId, statuses)) {
      updates.completedAt = null;
    }

    // Handle ended status
    if (shouldSetEndedAt(newStatusId, statuses)) {
      updates.endedAt = now;
      // Clear completedAt if it was set (mutually exclusive)
      if (ticket.completedAt) {
        updates.completedAt = null;
      }
    } else if (shouldClearEndedAt(oldStatusId, newStatusId, statuses)) {
      updates.endedAt = null;
    }

    return updates;
  }

  // ---------------------------------------------------------------------------
  // EXPORT TO WINDOW
  // ---------------------------------------------------------------------------

  window.Domain = window.Domain || {};
  window.Domain.Statuses = {
    // Constants
    STATUS_TYPES: STATUS_TYPES,
    PREDEFINED_STATUSES: PREDEFINED_STATUSES,
    PREDEFINED_STATUS_LABELS: PREDEFINED_STATUS_LABELS,
    STATUS_KEYWORDS: STATUS_KEYWORDS,
    AMBIGUOUS_KEYWORDS: AMBIGUOUS_KEYWORDS,

    // Inference
    inferStatusFromStageName: inferStatusFromStageName,
    getAmbiguousKeywordWarning: getAmbiguousKeywordWarning,

    // Stage helpers
    getStageName: getStageName,
    getStageStatus: getStageStatus,
    getStageDefaultStatus: getStageDefaultStatus,

    // Migration
    migrateWorkStages: migrateWorkStages,

    // Stage lookup
    findStagesForStatus: findStagesForStatus,

    // Status change actions
    getStatusChangeMoveAction: getStatusChangeMoveAction,

    // Type helpers (v144 - 6-type model)
    getStatusType: getStatusType,
    getStatusesByType: getStatusesByType,
    getStatusById: getStatusById,
    isBacklogStatus: isBacklogStatus,
    isScopedStatus: isScopedStatus,
    isQueuedStatus: isQueuedStatus,
    isActiveStatus: isActiveStatus,
    isCompletedStatus: isCompletedStatus,
    isEndedStatus: isEndedStatus,
    isDeletedStatus: isDeletedStatus, // v158a
    isTerminalStatus: isTerminalStatus,
    isClosedStatus: isClosedStatus, // Legacy compatibility

    // Lifecycle date helpers (v144, v154)
    shouldSetScopedAt: shouldSetScopedAt, // v154
    shouldSetStartedAt: shouldSetStartedAt,
    shouldSetCompletedAt: shouldSetCompletedAt,
    shouldSetEndedAt: shouldSetEndedAt,
    shouldClearCompletedAt: shouldClearCompletedAt,
    shouldClearEndedAt: shouldClearEndedAt,
    getLifecycleDateUpdates: getLifecycleDateUpdates,
  };

  // v153: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['domain/statuses'] = COMPONENT_VERSION;

  console.log(`[domain/statuses.js] Statuses loaded (${COMPONENT_VERSION})`);
})();

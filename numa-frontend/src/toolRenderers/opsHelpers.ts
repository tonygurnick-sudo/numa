/**
 * Helpers to parse and summarise Numa Ops tool results.
 *
 * The MCP tool returns text in this format:
 *   "Ops operation completed: <operation>\nDescription: <desc>\n\nResult:\n<json>"
 * or on error:
 *   "Ops operation failed (<operation>): <message>"
 */
import i18n from '../i18n';
import type { ToolResultLike } from './helpers';

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface OpsPayload {
  operation: string;
  description: string;
  result: unknown;
  isError: boolean;
  errorMessage?: string;
}

/** Minimal ticket shape returned by the ops API */
export interface OpsTicket {
  id?: string;
  displayId?: string;
  title?: string;
  description?: string;
  priority?: string;
  statusId?: string;
  status?: { id?: string; name?: string; type?: string };
  assigneeId?: string;
  assignee?: { name?: string; email?: string };
  dueDate?: string;
  ticketType?: { id?: string; name?: string; icon?: string; color?: string };
  customerId?: string;
  customer?: { companyName?: string };
  supplierId?: string;
  supplier?: { companyName?: string };
  projectId?: string;
  project?: { name?: string };
  createdAt?: string;
  updatedAt?: string;
}

export interface OpsTeam {
  id?: string;
  name?: string;
  description?: string;
  memberCount?: number;
  ticketCount?: number;
}

export interface OpsCustomer {
  id?: string;
  companyName?: string;
  contactName?: string;
  contactEmail?: string;
  phone?: string;
  openTicketCount?: number;
  industry?: string;
}

export interface OpsSupplier {
  id?: string;
  companyName?: string;
  contactName?: string;
  contactEmail?: string;
  phone?: string;
  openTicketCount?: number;
}

export interface OpsProject {
  id?: string;
  name?: string;
  description?: string;
  color?: string;
  ticketCount?: number;
}

export interface OpsConfig {
  ticketTypes?: Array<{ id?: string; name?: string; icon?: string; color?: string }>;
  statuses?: Array<{ id?: string; name?: string; type?: string; icon?: string }>;
  staff?: Array<{ sub?: string; name?: string; email?: string }>;
  projects?: Array<{ id?: string; name?: string }>;
  priorities?: Array<{ id?: string; name?: string }>;
}

export interface OpsComment {
  id?: string;
  content?: string;
  authorName?: string;
  authorEmail?: string;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const COMPLETED_RE = /^Ops operation completed:\s*(.+)$/m;
const DESCRIPTION_RE = /^Description:\s*(.+)$/m;
const RESULT_RE = /\nResult:\n([\s\S]+)$/;
const ERROR_RE = /^Ops operation failed \(([^)]+)\):\s*(.+)$/m;
const TRUNCATED_RE = /\n\.\.\. \(truncated,.*\)$/;

/**
 * Extract the raw text content from a ToolResult.
 * The ops tool always returns text blocks (never JSON blocks).
 */
function extractText(result: ToolResultLike): string {
  const blocks = Array.isArray(result?.content) ? (result.content as Array<{ text?: string }>) : undefined;
  if (Array.isArray(blocks)) {
    return blocks.map((b) => b?.text ?? '').join('');
  }
  if (typeof result?.content === 'string') return result.content;
  return '';
}

/** Parse the ops tool result text into a structured payload. */
export function getOpsPayload(result: ToolResultLike): OpsPayload | null {
  const text = extractText(result);
  if (!text) return null;

  // Check error format first
  const errMatch = text.match(ERROR_RE);
  if (errMatch) {
    return {
      operation: errMatch[1],
      description: '',
      result: null,
      isError: true,
      errorMessage: errMatch[2],
    };
  }

  const opMatch = text.match(COMPLETED_RE);
  if (!opMatch) return null;

  const operation = opMatch[1].trim();
  const descMatch = text.match(DESCRIPTION_RE);
  const description = descMatch ? descMatch[1].trim() : '';

  const resultMatch = text.match(RESULT_RE);
  let parsed: unknown = null;
  if (resultMatch) {
    let jsonStr = resultMatch[1].trim();
    // Strip truncation indicator so JSON.parse doesn't choke
    jsonStr = jsonStr.replace(TRUNCATED_RE, '');
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // If JSON parse fails, keep as raw text
      parsed = resultMatch[1].trim();
    }
  }

  return { operation, description, result: parsed, isError: false };
}

// ---------------------------------------------------------------------------
// Operation classification
// ---------------------------------------------------------------------------

type OpsCategory =
  | 'tickets'
  | 'teams'
  | 'customers'
  | 'suppliers'
  | 'projects'
  | 'config'
  | 'comments'
  | 'metrics'
  | 'upload'
  | 'unknown';

export function getOpsCategory(operation: string): OpsCategory {
  if (operation === 'get_config') return 'config';
  if (operation.includes('ticket')) return 'tickets';
  if (operation.includes('team')) return 'teams';
  if (operation.includes('customer')) return 'customers';
  if (operation.includes('supplier')) return 'suppliers';
  if (operation.includes('project')) return 'projects';
  if (operation.includes('comment')) return 'comments';
  if (operation.includes('metrics')) return 'metrics';
  if (operation.includes('upload')) return 'upload';
  return 'unknown';
}

export function isListOperation(operation: string): boolean {
  return operation.startsWith('list_') || operation === 'search_tickets';
}

export function isGetOperation(operation: string): boolean {
  return operation.startsWith('get_') && operation !== 'get_config';
}

export function isWriteOperation(operation: string): boolean {
  return (
    operation.startsWith('create_') ||
    operation.startsWith('update_') ||
    operation.startsWith('delete_') ||
    operation === 'add_comment' ||
    operation === 'upload_attachment'
  );
}

// ---------------------------------------------------------------------------
// Summary for UnifiedToolCard step line
// ---------------------------------------------------------------------------

export function getOpsSummary(result: ToolResultLike): string {
  const payload = getOpsPayload(result);
  if (!payload) return i18n.t('common:toolSummaries.numaOps.default');

  if (payload.isError) {
    return i18n.t('common:toolSummaries.numaOps.failed', { operation: payload.operation });
  }

  const { operation, result: data } = payload;

  // List operations — show count
  if (isListOperation(operation)) {
    const items = Array.isArray(data) ? data : [];
    const category = getOpsCategory(operation);
    return i18n.t('common:toolSummaries.numaOps.listResult', {
      count: items.length,
      category,
    });
  }

  // Get operations
  if (isGetOperation(operation)) {
    return i18n.t('common:toolSummaries.numaOps.getResult', {
      category: getOpsCategory(operation),
    });
  }

  // Config
  if (operation === 'get_config') {
    return i18n.t('common:toolSummaries.numaOps.configLoaded');
  }

  // Write operations — use the description
  if (isWriteOperation(operation)) {
    const verb = operation.startsWith('create_')
      ? 'created'
      : operation.startsWith('update_')
        ? 'updated'
        : operation.startsWith('delete_')
          ? 'deleted'
          : 'completed';
    return i18n.t(`common:toolSummaries.numaOps.${verb}`, {
      category: getOpsCategory(operation),
      defaultValue: `${verb.charAt(0).toUpperCase() + verb.slice(1)} successfully`,
    });
  }

  return i18n.t('common:toolSummaries.numaOps.success');
}

// ---------------------------------------------------------------------------
// Priority & status color helpers (duplicated from Ops shared to avoid
// importing full ops component tree into tool renderers)
// ---------------------------------------------------------------------------

export function getPriorityColor(priority: string): string {
  switch (priority?.toLowerCase()) {
    case 'highest':
    case 'high':
      return '#dc3545';
    case 'medium':
      return '#fd7e14';
    case 'low':
      return '#28a745';
    case 'lowest':
      return '#0d6efd';
    default:
      return '#6c757d';
  }
}

export function getStatusColor(statusType: string): string {
  switch (statusType?.toLowerCase()) {
    case 'backlog':
      return '#6c757d';
    case 'scoped':
      return '#0dcaf0';
    case 'queued':
      return '#ffc107';
    case 'active':
      return '#0d6efd';
    case 'completed':
      return '#198754';
    case 'ended':
      return '#6c757d';
    case 'deleted':
      return '#dc3545';
    default:
      return '#6c757d';
  }
}

export function getContrastText(bgColor: string): string {
  const hex = bgColor.replace('#', '');
  if (hex.length < 6) return '#fff';
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.179 ? '#000' : '#fff';
}

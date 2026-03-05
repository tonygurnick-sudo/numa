/**
 * Renderer for Numa Ops tool results in workspace chat.
 *
 * Displays tickets, teams, customers, suppliers, projects, config, and
 * write-operation confirmations using the same visual language as the
 * kanban board (priority dots, status pills, monospace IDs, glassmorphism
 * cards).
 */
import { useTranslation } from 'react-i18next';
import type { ToolResultLike } from './helpers';
import {
  getOpsPayload,
  getOpsCategory,
  isListOperation,
  isGetOperation,
  isWriteOperation,
  getPriorityColor,
  getStatusColor,
  getContrastText,
  type OpsPayload,
  type OpsTicket,
  type OpsTeam,
  type OpsCustomer,
  type OpsSupplier,
  type OpsProject,
  type OpsConfig,
  type OpsComment,
} from './opsHelpers';

// ── Shared micro-components ────────────────────────────────────────────

const PriorityDot = ({ priority }: { priority?: string }) => {
  if (!priority) return null;
  const color = getPriorityColor(priority);
  return (
    <span
      className="ops-renderer-priority-dot"
      style={{ backgroundColor: color }}
      title={priority}
    />
  );
};

const StatusPill = ({ status }: { status?: { name?: string; type?: string } }) => {
  if (!status?.name) return null;
  const bg = getStatusColor(status.type || '');
  const text = getContrastText(bg);
  return (
    <span className="ops-renderer-status-pill" style={{ backgroundColor: bg, color: text }}>
      {status.name}
    </span>
  );
};

const TypeBadge = ({ type }: { type?: { name?: string; icon?: string; color?: string } }) => {
  if (!type?.name) return null;
  const color = type.color || '#6c757d';
  return (
    <span
      className="ops-renderer-type-badge"
      style={{
        backgroundColor: `${color}18`,
        color,
        borderColor: `${color}35`,
      }}
    >
      {type.icon && <i className={`bi bi-${type.icon}`} />}
      {type.name}
    </span>
  );
};

const TicketId = ({ id }: { id?: string }) => {
  if (!id) return null;
  return <span className="ops-renderer-ticket-id">{id}</span>;
};

const EmptyState = ({ message }: { message: string }) => (
  <div className="ops-renderer-empty">{message}</div>
);

// ── Ticket views ───────────────────────────────────────────────────────

const TicketRow = ({ ticket }: { ticket: OpsTicket }) => (
  <div className="ops-renderer-ticket-row">
    <div className="ops-renderer-ticket-row-top">
      <PriorityDot priority={ticket.priority} />
      <TicketId id={ticket.displayId} />
      <span className="ops-renderer-ticket-title">{ticket.title}</span>
    </div>
    <div className="ops-renderer-ticket-row-meta">
      <StatusPill status={ticket.status} />
      <TypeBadge type={ticket.ticketType} />
      {ticket.assignee?.name && (
        <span className="ops-renderer-meta-chip">
          <i className="bi bi-person" />
          {ticket.assignee.name}
        </span>
      )}
      {ticket.dueDate && (
        <span className="ops-renderer-meta-chip">
          <i className="bi bi-calendar3" />
          {new Date(ticket.dueDate).toLocaleDateString()}
        </span>
      )}
      {ticket.customer?.companyName && (
        <span className="ops-renderer-context-badge ops-renderer-badge-customer">
          <i className="bi bi-building" />
          {ticket.customer.companyName}
        </span>
      )}
      {ticket.supplier?.companyName && (
        <span className="ops-renderer-context-badge ops-renderer-badge-supplier">
          <i className="bi bi-truck" />
          {ticket.supplier.companyName}
        </span>
      )}
    </div>
  </div>
);

const TicketList = ({ tickets }: { tickets: OpsTicket[] }) => {
  const { t } = useTranslation('common');
  if (!tickets.length) return <EmptyState message={t('toolRenderers.numaOps.noTickets')} />;
  return (
    <div className="ops-renderer-list">
      {tickets.map((ticket, idx) => (
        <TicketRow key={ticket.id || idx} ticket={ticket} />
      ))}
    </div>
  );
};

const TicketDetail = ({ ticket }: { ticket: OpsTicket }) => {
  const { t } = useTranslation('common');
  return (
    <div className="ops-renderer-detail-card">
      <div className="ops-renderer-detail-header">
        <PriorityDot priority={ticket.priority} />
        <TicketId id={ticket.displayId} />
        <StatusPill status={ticket.status} />
        <TypeBadge type={ticket.ticketType} />
      </div>
      <div className="ops-renderer-detail-title">{ticket.title}</div>
      {ticket.description && (
        <div className="ops-renderer-detail-desc">{ticket.description}</div>
      )}
      <div className="ops-renderer-detail-fields">
        {ticket.assignee?.name && (
          <div className="ops-renderer-field">
            <span className="ops-renderer-field-label">{t('toolRenderers.numaOps.fields.assignee')}</span>
            <span>{ticket.assignee.name}</span>
          </div>
        )}
        {ticket.dueDate && (
          <div className="ops-renderer-field">
            <span className="ops-renderer-field-label">{t('toolRenderers.numaOps.fields.dueDate')}</span>
            <span>{new Date(ticket.dueDate).toLocaleDateString()}</span>
          </div>
        )}
        {ticket.project?.name && (
          <div className="ops-renderer-field">
            <span className="ops-renderer-field-label">{t('toolRenderers.numaOps.fields.project')}</span>
            <span>{ticket.project.name}</span>
          </div>
        )}
        {ticket.customer?.companyName && (
          <div className="ops-renderer-field">
            <span className="ops-renderer-field-label">{t('toolRenderers.numaOps.fields.customer')}</span>
            <span>{ticket.customer.companyName}</span>
          </div>
        )}
        {ticket.supplier?.companyName && (
          <div className="ops-renderer-field">
            <span className="ops-renderer-field-label">{t('toolRenderers.numaOps.fields.supplier')}</span>
            <span>{ticket.supplier.companyName}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Team views ─────────────────────────────────────────────────────────

const TeamRow = ({ team }: { team: OpsTeam }) => (
  <div className="ops-renderer-entity-row">
    <div className="ops-renderer-entity-icon">
      <i className="bi bi-people" />
    </div>
    <div className="ops-renderer-entity-body">
      <span className="ops-renderer-entity-name">{team.name}</span>
      {team.description && (
        <span className="ops-renderer-entity-desc">{team.description}</span>
      )}
    </div>
    {(team.memberCount != null || team.ticketCount != null) && (
      <div className="ops-renderer-entity-stats">
        {team.memberCount != null && (
          <span className="ops-renderer-meta-chip">
            <i className="bi bi-person" /> {team.memberCount}
          </span>
        )}
        {team.ticketCount != null && (
          <span className="ops-renderer-meta-chip">
            <i className="bi bi-ticket-perforated" /> {team.ticketCount}
          </span>
        )}
      </div>
    )}
  </div>
);

const TeamList = ({ teams }: { teams: OpsTeam[] }) => {
  const { t } = useTranslation('common');
  if (!teams.length) return <EmptyState message={t('toolRenderers.numaOps.noTeams')} />;
  return (
    <div className="ops-renderer-list">
      {teams.map((team, idx) => (
        <TeamRow key={team.id || idx} team={team} />
      ))}
    </div>
  );
};

// ── Customer / Supplier views ──────────────────────────────────────────

const CrmRow = ({ entity, type }: { entity: OpsCustomer | OpsSupplier; type: 'customer' | 'supplier' }) => (
  <div className="ops-renderer-entity-row">
    <div className={`ops-renderer-entity-icon ops-renderer-icon-${type}`}>
      <i className={type === 'customer' ? 'bi bi-building' : 'bi bi-truck'} />
    </div>
    <div className="ops-renderer-entity-body">
      <span className="ops-renderer-entity-name">{entity.companyName}</span>
      {entity.contactName && (
        <span className="ops-renderer-entity-desc">{entity.contactName}</span>
      )}
    </div>
    {entity.openTicketCount != null && entity.openTicketCount > 0 && (
      <span className={`ops-renderer-ticket-count ops-renderer-count-${type}`}>
        {entity.openTicketCount} open
      </span>
    )}
  </div>
);

const CrmList = ({ entities, type }: { entities: (OpsCustomer | OpsSupplier)[]; type: 'customer' | 'supplier' }) => {
  const { t } = useTranslation('common');
  const emptyKey = type === 'customer' ? 'toolRenderers.numaOps.noCustomers' : 'toolRenderers.numaOps.noSuppliers';
  if (!entities.length) return <EmptyState message={t(emptyKey)} />;
  return (
    <div className="ops-renderer-list">
      {entities.map((entity, idx) => (
        <CrmRow key={entity.id || idx} entity={entity} type={type} />
      ))}
    </div>
  );
};

// ── Project view ───────────────────────────────────────────────────────

const ProjectList = ({ projects }: { projects: OpsProject[] }) => {
  const { t } = useTranslation('common');
  if (!projects.length) return <EmptyState message={t('toolRenderers.numaOps.noProjects')} />;
  return (
    <div className="ops-renderer-list">
      {projects.map((p, idx) => (
        <div key={p.id || idx} className="ops-renderer-entity-row">
          <div className="ops-renderer-entity-icon" style={p.color ? { backgroundColor: `${p.color}18`, color: p.color } : undefined}>
            <i className="bi bi-folder2" />
          </div>
          <div className="ops-renderer-entity-body">
            <span className="ops-renderer-entity-name">{p.name}</span>
            {p.description && <span className="ops-renderer-entity-desc">{p.description}</span>}
          </div>
          {p.ticketCount != null && (
            <span className="ops-renderer-meta-chip">
              <i className="bi bi-ticket-perforated" /> {p.ticketCount}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

// ── Comments view ──────────────────────────────────────────────────────

const CommentList = ({ comments }: { comments: OpsComment[] }) => {
  const { t } = useTranslation('common');
  if (!comments.length) return <EmptyState message={t('toolRenderers.numaOps.noComments')} />;
  return (
    <div className="ops-renderer-list">
      {comments.map((c, idx) => (
        <div key={c.id || idx} className="ops-renderer-comment">
          <div className="ops-renderer-comment-header">
            <span className="ops-renderer-comment-author">{c.authorName || c.authorEmail || 'Unknown'}</span>
            {c.createdAt && (
              <span className="ops-renderer-comment-date">{new Date(c.createdAt).toLocaleString()}</span>
            )}
          </div>
          <div className="ops-renderer-comment-body">{c.content}</div>
        </div>
      ))}
    </div>
  );
};

// ── Config view ────────────────────────────────────────────────────────

const ConfigView = ({ config }: { config: OpsConfig }) => {
  const { t } = useTranslation('common');
  return (
    <div className="ops-renderer-config">
      {config.ticketTypes && config.ticketTypes.length > 0 && (
        <div className="ops-renderer-config-section">
          <span className="ops-renderer-config-label">{t('toolRenderers.numaOps.config.ticketTypes')}</span>
          <div className="ops-renderer-config-items">
            {config.ticketTypes.map((tt, idx) => (
              <TypeBadge key={tt.id || idx} type={tt} />
            ))}
          </div>
        </div>
      )}
      {config.statuses && config.statuses.length > 0 && (
        <div className="ops-renderer-config-section">
          <span className="ops-renderer-config-label">{t('toolRenderers.numaOps.config.statuses')}</span>
          <div className="ops-renderer-config-items">
            {config.statuses.map((s, idx) => (
              <StatusPill key={s.id || idx} status={s} />
            ))}
          </div>
        </div>
      )}
      {config.staff && (
        <div className="ops-renderer-config-section">
          <span className="ops-renderer-config-label">{t('toolRenderers.numaOps.config.staff')}</span>
          <span className="ops-renderer-meta-chip">
            <i className="bi bi-people" /> {config.staff.length}
          </span>
        </div>
      )}
      {config.projects && config.projects.length > 0 && (
        <div className="ops-renderer-config-section">
          <span className="ops-renderer-config-label">{t('toolRenderers.numaOps.config.projects')}</span>
          <span className="ops-renderer-meta-chip">
            <i className="bi bi-folder2" /> {config.projects.length}
          </span>
        </div>
      )}
    </div>
  );
};

// ── Write confirmation ─────────────────────────────────────────────────

const WriteConfirmation = ({ payload }: { payload: OpsPayload }) => {
  const { t } = useTranslation('common');
  const verb = payload.operation.startsWith('create_')
    ? t('toolRenderers.numaOps.write.created')
    : payload.operation.startsWith('update_')
      ? t('toolRenderers.numaOps.write.updated')
      : payload.operation.startsWith('delete_')
        ? t('toolRenderers.numaOps.write.deleted')
        : t('toolRenderers.numaOps.write.completed');

  // Try to extract a useful identifier from the result
  const result = payload.result as Record<string, unknown> | null;
  const displayId = result?.displayId as string | undefined;
  const title = result?.title as string | undefined;
  const name = result?.name as string | undefined;
  const companyName = result?.companyName as string | undefined;
  const identifier = displayId || title || name || companyName;

  return (
    <div className="ops-renderer-write-confirm">
      <i className="bi bi-check-circle-fill ops-renderer-write-icon" />
      <div>
        <span className="ops-renderer-write-verb">{verb}</span>
        {identifier && <span className="ops-renderer-write-id">{identifier}</span>}
      </div>
    </div>
  );
};

// ── Error view ─────────────────────────────────────────────────────────

const ErrorView = ({ payload }: { payload: OpsPayload }) => (
  <div className="ops-renderer-error">
    <i className="bi bi-exclamation-triangle-fill" />
    <span>{payload.errorMessage || 'Operation failed'}</span>
  </div>
);

// ── Main body component (used by UnifiedToolCard) ──────────────────────

const OpsBody = ({ payload }: { payload: OpsPayload }) => {
  if (payload.isError) return <ErrorView payload={payload} />;

  const { operation, result } = payload;

  // Write confirmations
  if (isWriteOperation(operation)) {
    return <WriteConfirmation payload={payload} />;
  }

  // Config
  if (operation === 'get_config') {
    return <ConfigView config={(result as OpsConfig) || {}} />;
  }

  const category = getOpsCategory(operation);
  const items = Array.isArray(result) ? result : [];
  const single = !Array.isArray(result) && typeof result === 'object' && result !== null ? result : null;

  // List operations
  if (isListOperation(operation)) {
    switch (category) {
      case 'tickets':
        return <TicketList tickets={items as OpsTicket[]} />;
      case 'teams':
        return <TeamList teams={items as OpsTeam[]} />;
      case 'customers':
        return <CrmList entities={items as OpsCustomer[]} type="customer" />;
      case 'suppliers':
        return <CrmList entities={items as OpsSupplier[]} type="supplier" />;
      case 'projects':
        return <ProjectList projects={items as OpsProject[]} />;
      case 'comments':
        return <CommentList comments={items as OpsComment[]} />;
      default:
        break;
    }
  }

  // Get operations (single entity)
  if (isGetOperation(operation) && single) {
    switch (category) {
      case 'tickets':
        return <TicketDetail ticket={single as OpsTicket} />;
      case 'teams':
        return <TeamRow team={single as OpsTeam} />;
      case 'customers':
        return <CrmRow entity={single as OpsCustomer} type="customer" />;
      case 'suppliers':
        return <CrmRow entity={single as OpsSupplier} type="supplier" />;
      default:
        break;
    }
  }

  // Metrics / unknown — show as formatted JSON
  if (result) {
    return (
      <pre className="ops-renderer-raw">
        {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
      </pre>
    );
  }

  return null;
};

// ── Exported renderer ──────────────────────────────────────────────────

export const OpsToolRenderer = ({ result, bare: _bare = false }: { result: ToolResultLike; bare?: boolean }) => {
  const payload = getOpsPayload(result);
  if (!payload) return null;
  return (
    <div className="ops-renderer">
      <OpsBody payload={payload} />
    </div>
  );
};

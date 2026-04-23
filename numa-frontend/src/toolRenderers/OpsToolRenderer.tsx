/**
 * Renderer for Numa Ops tool results in workspace chat.
 *
 * Displays tickets, teams, customers, suppliers, projects, config, and
 * write-operation confirmations using the same visual language as the
 * kanban board (priority dots, status pills, monospace IDs, glassmorphism
 * cards).
 */
import { useTranslation } from 'react-i18next';
import { useS3FileResult, type ToolResultLike } from './helpers';
import { useAuth } from '../Providers/AuthProvider';
import {
  getOpsPayload,
  getOpsCategory,
  isListOperation,
  isGetOperation,
  isWriteOperation,
  unwrapOpsResult,
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
  type OpsTeamDetail,
  type OpsComment,
} from './opsHelpers';

// ── Shared micro-components ────────────────────────────────────────────

const PriorityDot = ({ priority }: { priority?: string }) => {
  if (!priority) return null;
  const color = getPriorityColor(priority);
  return <span className="ops-renderer-priority-dot" style={{ backgroundColor: color }} title={priority} />;
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

const EmptyState = ({ message }: { message: string }) => <div className="ops-renderer-empty">{message}</div>;

// ── Ticket views ───────────────────────────────────────────────────────

/** Resolve statusType from flat field or nested status object */
function resolveStatusType(ticket: OpsTicket): string {
  return ticket.statusType || ticket.status?.type || '';
}

/** Resolve customer name from flat or nested field */
function resolveCustomerName(ticket: OpsTicket): string | undefined {
  return ticket.customerName || ticket.customer?.companyName;
}

const StatusTypeBadge = ({ statusType }: { statusType: string }) => {
  if (!statusType) return null;
  const bg = getStatusColor(statusType);
  const text = getContrastText(bg);
  const label = statusType.charAt(0).toUpperCase() + statusType.slice(1);
  return (
    <span className="ops-renderer-status-pill" style={{ backgroundColor: bg, color: text }}>
      {label}
    </span>
  );
};

const TicketRow = ({ ticket }: { ticket: OpsTicket }) => {
  const statusType = resolveStatusType(ticket);
  const customerName = resolveCustomerName(ticket);
  const isOverdue = ticket.dueDate && !ticket.completedAt && new Date(ticket.dueDate) < new Date();
  const isCompleted = statusType === 'completed';

  return (
    <div className={`ops-renderer-ticket-row ${isCompleted ? 'completed' : ''}`}>
      <div className="ops-renderer-ticket-row-top">
        <PriorityDot priority={ticket.priority} />
        <TicketId id={ticket.displayId} />
        <span className="ops-renderer-ticket-title">{ticket.title}</span>
        <StatusTypeBadge statusType={statusType} />
      </div>
      <div className="ops-renderer-ticket-row-meta">
        {ticket.ticketType && <TypeBadge type={ticket.ticketType} />}
        {customerName && (
          <span className="ops-renderer-meta-chip">
            <i className="bi bi-building" />
            {customerName}
          </span>
        )}
        {ticket.dueDate && (
          <span className={`ops-renderer-meta-chip ${isOverdue ? 'overdue' : ''}`}>
            <i className={`bi ${isOverdue ? 'bi-exclamation-circle' : 'bi-calendar3'}`} />
            {new Date(ticket.dueDate).toLocaleDateString()}
          </span>
        )}
        {ticket.effortPoints != null && (
          <span className="ops-renderer-meta-chip">
            <i className="bi bi-lightning" />
            {ticket.effortPoints}
          </span>
        )}
        {ticket.commentCount != null && ticket.commentCount > 0 && (
          <span className="ops-renderer-meta-chip">
            <i className="bi bi-chat-dots" />
            {ticket.commentCount}
          </span>
        )}
        {ticket.supplier?.companyName && (
          <span className="ops-renderer-meta-chip">
            <i className="bi bi-truck" />
            {ticket.supplier.companyName}
          </span>
        )}
      </div>
    </div>
  );
};

const TicketList = ({ tickets }: { tickets: OpsTicket[] }) => {
  const { t } = useTranslation('common');
  if (!tickets.length) return <EmptyState message={t('toolRenderers.numaOps.noTickets')} />;
  return (
    <div className="ops-renderer-ticket-list">
      {tickets.map((ticket, idx) => (
        <TicketRow key={ticket.id || idx} ticket={ticket} />
      ))}
    </div>
  );
};

const TicketDetail = ({ ticket }: { ticket: OpsTicket }) => {
  const { t } = useTranslation('common');
  const statusType = resolveStatusType(ticket);
  const customerName = resolveCustomerName(ticket);
  return (
    <div className="ops-renderer-detail-card">
      <div className="ops-renderer-detail-header">
        <PriorityDot priority={ticket.priority} />
        <TicketId id={ticket.displayId} />
        <StatusTypeBadge statusType={statusType} />
        {ticket.ticketType && <TypeBadge type={ticket.ticketType} />}
      </div>
      <div className="ops-renderer-detail-title">{ticket.title}</div>
      {ticket.description && (
        <div className="ops-renderer-detail-desc" dangerouslySetInnerHTML={{ __html: ticket.description }} />
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
        {customerName && (
          <div className="ops-renderer-field">
            <span className="ops-renderer-field-label">{t('toolRenderers.numaOps.fields.customer')}</span>
            <span>{customerName}</span>
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

const TeamRow = ({ team }: { team: OpsTeam }) => {
  const { t } = useTranslation('common');
  const color = team.color || '#6c757d';
  const isRestricted = team.accessControl?.mode === 'specific';
  const sprintLabel = team.workUnitSeries?.enabled ? team.workUnitSeries.label : null;
  const typeCount = team.allowedTicketTypes?.length;

  return (
    <div className="ops-renderer-team-row" style={{ borderLeftColor: color }}>
      <div className="ops-renderer-team-header">
        <span className="ops-renderer-team-color-dot" style={{ backgroundColor: color }} />
        <span className="ops-renderer-team-name">{team.name}</span>
        {isRestricted && (
          <span className="ops-renderer-team-badge restricted">
            <i className="bi bi-lock" />
          </span>
        )}
      </div>
      {team.description && <div className="ops-renderer-team-desc">{team.description}</div>}
      <div className="ops-renderer-team-meta">
        {sprintLabel && (
          <span className="ops-renderer-team-chip">
            <i className="bi bi-arrow-repeat" /> {sprintLabel}
          </span>
        )}
        {typeCount != null && typeCount > 0 && (
          <span className="ops-renderer-team-chip">
            <i className="bi bi-tag" /> {t('toolRenderers.numaOps.ticketTypes', { count: typeCount })}
          </span>
        )}
        {team.ticketCount != null && (
          <span className="ops-renderer-team-chip">
            <i className="bi bi-ticket-perforated" /> {team.ticketCount}
          </span>
        )}
      </div>
    </div>
  );
};

const TeamList = ({ teams }: { teams: OpsTeam[] }) => {
  const { t } = useTranslation('common');
  if (!teams.length) return <EmptyState message={t('toolRenderers.numaOps.noTeams')} />;
  return (
    <div className="ops-renderer-team-list">
      {teams.map((team, idx) => (
        <TeamRow key={team.id || idx} team={team} />
      ))}
    </div>
  );
};

// ── Team detail view (get_team with zones + stages) ───────────────────

/** Check if a result object is a rich team detail (has team/zones/stages). */
function isTeamDetail(data: unknown): data is OpsTeamDetail {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.team != null && typeof d.team === 'object';
}

const TeamDetailView = ({ detail }: { detail: OpsTeamDetail }) => {
  const { t } = useTranslation('common');
  const { team, zones = [], stages = [] } = detail;
  const color = team.color || '#6c757d';
  const isRestricted = team.accessControl?.mode === 'specific';
  const sprintLabel = team.workUnitSeries?.enabled ? team.workUnitSeries.label : null;

  // Group stages by zone
  const stagesByZone = zones
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((zone) => ({
      zone,
      stages: stages.filter((s) => s.zoneId === zone.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }));

  return (
    <div className="ops-renderer-team-detail">
      <div className="ops-renderer-team-detail-header" style={{ borderLeftColor: color }}>
        <div className="ops-renderer-team-header">
          <span className="ops-renderer-team-color-dot" style={{ backgroundColor: color }} />
          <span className="ops-renderer-team-name">{team.name}</span>
          {isRestricted && (
            <span className="ops-renderer-team-badge restricted">
              <i className="bi bi-lock" />
            </span>
          )}
          {sprintLabel && (
            <span className="ops-renderer-team-chip">
              <i className="bi bi-arrow-repeat" /> {sprintLabel}
            </span>
          )}
        </div>
        {team.description && <div className="ops-renderer-team-desc">{team.description}</div>}
      </div>

      {stagesByZone.length > 0 && (
        <div className="ops-renderer-board-layout">
          {stagesByZone.map(({ zone, stages: zoneStages }) => (
            <div key={zone.id} className="ops-renderer-board-zone">
              <div className="ops-renderer-board-zone-label">
                <i className={`bi ${zone.zoneType === 'backlog' ? 'bi-inbox' : 'bi-kanban'}`} />
                {zone.name}
              </div>
              <div className="ops-renderer-board-stages">
                {zoneStages.map((stage, idx) => {
                  const bg = getStatusColor(stage.statusType || '');
                  const fg = getContrastText(bg);
                  return (
                    <span key={stage.id || idx}>
                      {idx > 0 && <span className="ops-renderer-board-arrow">{'\u2192'}</span>}
                      <span className="ops-renderer-board-stage" style={{ backgroundColor: bg, color: fg }}>
                        {stage.name}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {team.allowedTicketTypes && team.allowedTicketTypes.length > 0 && (
        <div className="ops-renderer-team-meta" style={{ paddingLeft: 0, marginTop: 6 }}>
          <span className="ops-renderer-team-chip">
            <i className="bi bi-tag" />{' '}
            {t('toolRenderers.numaOps.ticketTypes', { count: team.allowedTicketTypes.length })}
          </span>
        </div>
      )}
    </div>
  );
};

// ── Customer / Supplier views ──────────────────────────────────────────

const CrmRow = ({ entity, type }: { entity: OpsCustomer | OpsSupplier; type: 'customer' | 'supplier' }) => {
  const { t } = useTranslation('common');
  return (
    <div className="ops-renderer-entity-row">
      <div className={`ops-renderer-entity-icon ops-renderer-icon-${type}`}>
        <i className={type === 'customer' ? 'bi bi-building' : 'bi bi-truck'} />
      </div>
      <div className="ops-renderer-entity-body">
        <span className="ops-renderer-entity-name">{entity.companyName}</span>
        {entity.contactName && <span className="ops-renderer-entity-desc">{entity.contactName}</span>}
      </div>
      {entity.openTicketCount != null && entity.openTicketCount > 0 && (
        <span className={`ops-renderer-ticket-count ops-renderer-count-${type}`}>
          {t('toolRenderers.numaOps.openTickets', { count: entity.openTicketCount })}
        </span>
      )}
    </div>
  );
};

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
          <div
            className="ops-renderer-entity-icon"
            style={p.color ? { backgroundColor: `${p.color}18`, color: p.color } : undefined}
          >
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
            {c.createdAt && <span className="ops-renderer-comment-date">{new Date(c.createdAt).toLocaleString()}</span>}
          </div>
          <div className="ops-renderer-comment-body" dangerouslySetInnerHTML={{ __html: c.content }} />
        </div>
      ))}
    </div>
  );
};

// ── Config view ────────────────────────────────────────────────────────

const ConfigView = ({ config }: { config: OpsConfig }) => {
  const { t } = useTranslation('common');

  const ticketFields = (config.fields ?? []).filter((f) => f.category !== 'crm');
  const crmFields = (config.fields ?? []).filter((f) => f.category === 'crm');

  const crm = config.crmConfig;
  const supplier = config.supplierConfig;

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
      {ticketFields.length > 0 && (
        <div className="ops-renderer-config-section">
          <span className="ops-renderer-config-label">{t('toolRenderers.numaOps.config.ticketFields')}</span>
          <span className="ops-renderer-meta-chip">
            <i className="bi bi-list-columns-reverse" /> {ticketFields.length}
          </span>
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

      {/* CRM config */}
      {crm && (crm.lifecycleStages?.length || crmFields.length || crm.customerRecord?.sections?.length) ? (
        <>
          {crm.lifecycleStages && crm.lifecycleStages.length > 0 && (
            <div className="ops-renderer-config-section">
              <span className="ops-renderer-config-label">{t('toolRenderers.numaOps.config.crmLifecycleStages')}</span>
              <div className="ops-renderer-config-items">
                {crm.lifecycleStages.map((s, idx) => (
                  <span key={s.id || idx} className="ops-renderer-status-pill">
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {crmFields.length > 0 && (
            <div className="ops-renderer-config-section">
              <span className="ops-renderer-config-label">{t('toolRenderers.numaOps.config.crmCustomFields')}</span>
              <div className="ops-renderer-config-items">
                {crmFields.map((f, idx) => (
                  <span key={f.id || idx} className="ops-renderer-meta-chip">
                    {f.name}
                    {f.fieldType ? ` · ${f.fieldType}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
          {crm.customerRecord?.sections && crm.customerRecord.sections.length > 0 && (
            <div className="ops-renderer-config-section">
              <span className="ops-renderer-config-label">{t('toolRenderers.numaOps.config.crmRecordLayout')}</span>
              <div className="ops-renderer-config-items">
                {crm.customerRecord.sections.map((s, idx) => (
                  <span key={s.id || idx} className="ops-renderer-meta-chip">
                    {s.name} · {s.fieldIds?.length ?? 0}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* Supplier config */}
      {supplier?.lifecycleStages && supplier.lifecycleStages.length > 0 && (
        <div className="ops-renderer-config-section">
          <span className="ops-renderer-config-label">{t('toolRenderers.numaOps.config.supplierLifecycleStages')}</span>
          <div className="ops-renderer-config-items">
            {supplier.lifecycleStages.map((s, idx) => (
              <span key={s.id || idx} className="ops-renderer-status-pill">
                {s.name}
              </span>
            ))}
          </div>
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

// ── File-based result helpers ──────────────────────────────────────────

/** Fetch full ops result from S3 when the backend saved it to a file. */
function useOpsFileResult(payload: OpsPayload | null, conversationId?: string, sub?: string) {
  const { getCredentials } = useAuth();
  return useS3FileResult(payload?.filePath, conversationId, sub, getCredentials);
}

const LoadingView = () => (
  <div className="ops-renderer-loading">
    <div className="spinner-border spinner-border-sm" role="status" />
  </div>
);

const FileSavedView = ({ payload }: { payload: OpsPayload }) => {
  const { t } = useTranslation('common');
  const category = getOpsCategory(payload.operation);
  return (
    <div className="ops-renderer-file-saved">
      <i className="bi bi-file-earmark-text" />
      <span>
        {payload.itemCount != null
          ? t('toolRenderers.numaOps.fileSaved', { count: payload.itemCount, category })
          : t('toolRenderers.numaOps.fileSavedGeneric')}
      </span>
    </div>
  );
};

// ── Main body component (used by UnifiedToolCard) ──────────────────────

const OpsBody = ({ payload, conversationId, sub }: { payload: OpsPayload; conversationId?: string; sub?: string }) => {
  const { fileData, loading } = useOpsFileResult(payload, conversationId, sub);

  if (payload.isError) return <ErrorView payload={payload} />;

  const { operation, result } = payload;
  // Write confirmations
  if (isWriteOperation(operation)) {
    return <WriteConfirmation payload={payload} />;
  }

  // File-based result — fetch and render, or show loading/summary
  // Must come before operation-specific checks so that file-backed responses
  // (like get_config, which always exceeds the inline size limit) get fetched
  // from S3 first, then re-routed with real data on the recursive call.
  if (payload.filePath) {
    if (loading) return <LoadingView />;
    if (fileData) {
      const loaded = { ...payload, result: fileData, filePath: undefined };
      return <OpsBody payload={loaded} conversationId={conversationId} sub={sub} />;
    }
    return <FileSavedView payload={payload} />;
  }

  // Config
  if (operation === 'get_config') {
    return <ConfigView config={(result as OpsConfig) || {}} />;
  }

  const category = getOpsCategory(operation);
  const items = unwrapOpsResult(result);

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
  // APIs return wrapped objects: { ticket, links, comments }, { customer, activities, ... }, etc.
  // Extract the entity from the known wrapper pattern for each category.
  if (isGetOperation(operation) && result && typeof result === 'object' && !Array.isArray(result)) {
    const wrapper = result as Record<string, unknown>;
    switch (category) {
      case 'tickets':
        if (wrapper.ticket && typeof wrapper.ticket === 'object') {
          return (
            <>
              <TicketDetail ticket={wrapper.ticket as OpsTicket} />
              {Array.isArray(wrapper.comments) && wrapper.comments.length > 0 && (
                <CommentList comments={wrapper.comments as OpsComment[]} />
              )}
            </>
          );
        }
        break;
      case 'teams':
        if (isTeamDetail(result)) return <TeamDetailView detail={result} />;
        if (wrapper.team && typeof wrapper.team === 'object') return <TeamRow team={wrapper.team as OpsTeam} />;
        break;
      case 'customers':
        if (wrapper.customer && typeof wrapper.customer === 'object')
          return <CrmRow entity={wrapper.customer as OpsCustomer} type="customer" />;
        break;
      case 'suppliers':
        if (wrapper.supplier && typeof wrapper.supplier === 'object')
          return <CrmRow entity={wrapper.supplier as OpsSupplier} type="supplier" />;
        break;
      default:
        break;
    }
  }

  // No dedicated renderer — show nothing (tool call line is sufficient)
  return null;
};

// ── Exported renderer ──────────────────────────────────────────────────

export const OpsToolRenderer = ({
  result,
  bare: _bare = false,
  conversationId,
  sub,
}: {
  result: ToolResultLike;
  bare?: boolean;
  conversationId?: string;
  sub?: string;
}) => {
  const payload = getOpsPayload(result);
  if (!payload) return null;
  return (
    <div className="ops-renderer">
      <OpsBody payload={payload} conversationId={conversationId} sub={sub} />
    </div>
  );
};

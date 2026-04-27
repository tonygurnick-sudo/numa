import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Badge from 'react-bootstrap/Badge';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import Table from 'react-bootstrap/Table';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useToast } from '../../../Providers/ToastContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import type {
  Customer,
  Activity,
  Document as OpsDocument,
  CrmConfig,
  CrmLifecycleStage,
  Contact,
  Ticket,
  StatusType,
  TicketPriority,
  UpdateCustomerPayload,
} from '../../../types/ops';
import { ContactSection } from '../Shared/ContactSection';
import { ActivitySection } from '../Shared/ActivitySection';
import { DocumentSection } from '../Shared/DocumentSection';
import { getColorForPosition } from '../Shared/colorUtils';
import { PriorityIndicator } from '../Shared/PriorityIndicator';
import { resolveCustomerRecord, resolveCustomerRecordLayout } from '../Shared/customerRecordFields';
import { CreateTicketModal } from './CreateTicketModal';
import { CustomerRecordSectionBlock } from './CustomerRecordSectionBlock';
import { TicketDetailModal } from './TicketDetailModal';

// ─── Props ──────────────────────────────────────────────────────────────────

interface CustomerDetailModalProps {
  show: boolean;
  customerId: string | null;
  onHide: () => void;
  onUpdated?: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRelativeDateLabel(
  dateStr: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (!dateStr) return t('crm.noLastContact');

  const timestamp = new Date(dateStr).getTime();
  if (Number.isNaN(timestamp)) return t('crm.noLastContact');

  const diffMs = Date.now() - timestamp;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return t('crm.lastContactToday');
  if (diffDays === 1) return t('crm.lastContactYesterday');
  if (diffDays < 7) return t('crm.lastContactDaysAgo', { count: diffDays });
  if (diffDays < 30) return t('crm.lastContactWeeksAgo', { count: Math.floor(diffDays / 7) });
  if (diffDays < 365) return t('crm.lastContactMonthsAgo', { count: Math.floor(diffDays / 30) });
  return t('crm.lastContactYearsAgo', { count: Math.floor(diffDays / 365) });
}

type LinkedWorkSortBy = 'updatedAt' | 'createdAt' | 'priority' | 'statusType';
type LinkedWorkStatusFilter = 'all' | StatusType;

const LINKED_WORK_STATUS_OPTIONS: StatusType[] = ['backlog', 'scoped', 'queued', 'active', 'completed', 'ended'];

const PRIORITY_RANK: Record<TicketPriority, number> = {
  highest: 5,
  high: 4,
  medium: 3,
  low: 2,
  lowest: 1,
};

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Detail view for a customer record.
 *
 * The configurable Customer Record (sections + fields from CrmConfig.customerRecord)
 * renders first via CustomerRecordSectionBlock (display-first with Edit toggle).
 * Then fixed sections: Contacts, Activities, Documents, Linked Work, Notes.
 */
export function CustomerDetailModal({
  show,
  customerId,
  onHide,
  onUpdated,
}: CustomerDetailModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaGet, numaPut } = useNumaRequest();
  const { showToast } = useToast();
  const { config, selectedTeamId, teams, teamData } = useOps();

  // ── Core state ──────────────────────────────────────────────────────────

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [documents, setDocuments] = useState<OpsDocument[]>([]);
  const [linkedTickets, setLinkedTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [showCreateTicket, setShowCreateTicket] = useState(false);
  const [_selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [linkedTicketCount, setLinkedTicketCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Linked work view state
  const [linkedWorkStatusFilter, setLinkedWorkStatusFilter] = useState<LinkedWorkStatusFilter>('all');
  const [linkedWorkSortBy, setLinkedWorkSortBy] = useState<LinkedWorkSortBy>('updatedAt');
  const [showLinkedTicketDetail, setShowLinkedTicketDetail] = useState(false);
  const [linkedTicketDetailId, setLinkedTicketDetailId] = useState<string | null>(null);
  const [linkedTicketDetailTeamId, setLinkedTicketDetailTeamId] = useState<string | null>(null);

  // ── Inline editing state (for Notes textarea only) ────────────────────

  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState<string>('');

  // ── Collapsible section state ─────────────────────────────────────────
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = (sectionKey: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  };

  const crmConfig: CrmConfig | null = config?.crmConfig ?? null;
  const staff = config?.staff ?? [];
  const allFields = config?.fields ?? [];
  const stages = crmConfig?.lifecycleStages ?? [];
  const documentTypes = crmConfig?.documentTypes ?? [];
  const customerFlags = crmConfig?.customerFlags ?? [];
  const customerRecord = useMemo(() => resolveCustomerRecord(crmConfig), [crmConfig]);
  const recordLayout = useMemo(() => resolveCustomerRecordLayout(crmConfig), [crmConfig]);

  // Expand the first record section by default when modal opens; if the
  // CRM layout asks for sections-expanded-by-default, expand them all.
  useEffect(() => {
    if (!show) return;
    setExpandedSections((prev) => {
      if (prev.size > 0) return prev;
      const next = new Set<string>();
      if (recordLayout.defaultSectionsExpanded) {
        for (const s of customerRecord.sections) next.add(s.id);
      } else {
        const firstSectionId = customerRecord.sections[0]?.id;
        if (firstSectionId) next.add(firstSectionId);
      }
      return next;
    });
  }, [show, customerRecord, recordLayout.defaultSectionsExpanded]);

  // ── Load customer data ────────────────────────────────────────────────

  const loadCustomer = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await OpsService.getCustomer(numaGet, customerId);

      // Load linked work via tickets API (cross-team customer index).
      // Tickets endpoint requires teamId even for customerId index queries.
      const queryTeamId = selectedTeamId ?? teams[0]?.id;
      let resolvedLinkedTickets: Ticket[] = [];
      if (queryTeamId) {
        try {
          const linkedResponse = await OpsService.listTickets(numaGet, {
            teamId: queryTeamId,
            customerId,
            includeArchived: true,
          });
          const rawTickets = linkedResponse.tickets as Array<
            Ticket & { entityType?: string; ticketId?: string; teamId?: string }
          >;

          // Customer index queries can return lightweight TICKET_INDEX rows.
          // Hydrate those rows into full tickets so linked work has complete fields.
          const hydrated = await Promise.all(
            rawTickets.map(async (row) => {
              if (row.entityType === 'TICKET' || row.statusType) {
                return row as Ticket;
              }

              const ticketId = row.ticketId || row.id;
              const ticketTeamId = row.teamId || queryTeamId;
              if (!ticketId || !ticketTeamId) return null;

              try {
                const response = await OpsService.getTicket(numaGet, ticketId, ticketTeamId);
                return response.ticket;
              } catch (hydrateErr) {
                console.warn('[CustomerDetailModal] Failed to hydrate linked ticket', {
                  ticketId,
                  ticketTeamId,
                  error: String(hydrateErr),
                });
                return null;
              }
            })
          );

          // Deduplicate hydrated tickets and exclude deleted.
          const deduped = new Map<string, Ticket>();
          hydrated.forEach((ticket) => {
            if (!ticket || !ticket.id) return;
            if (ticket.statusType === 'deleted') return;
            deduped.set(ticket.id, ticket);
          });
          resolvedLinkedTickets = Array.from(deduped.values());
        } catch (linkedErr) {
          console.error('[CustomerDetailModal] Failed to load linked tickets', linkedErr);
        }
      }

      const fallbackCount = response.linkedTicketCount ?? response.ticketCount ?? 0;
      const hasTicketData = resolvedLinkedTickets.length > 0;
      const resolvedCount = hasTicketData || fallbackCount === 0 ? resolvedLinkedTickets.length : fallbackCount;

      setCustomer(response.customer);
      setActivities(response.activities ?? []);
      setDocuments(response.documents ?? []);
      setLinkedTickets(resolvedLinkedTickets);
      setLinkedTicketCount(resolvedCount);
    } catch (err) {
      console.error('[CustomerDetailModal] Failed to load customer', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [numaGet, customerId, selectedTeamId, teams]);

  useEffect(() => {
    if (show && customerId) {
      void loadCustomer();
      setEditingField(null);
      // Load linked tickets
      setLoadingTickets(true);
      void OpsService.listTickets(numaGet, { customerId })
        .then((res) => setLinkedTickets(res.tickets))
        .catch((err) => console.error('[CustomerDetailModal] Failed to load linked tickets', err))
        .finally(() => setLoadingTickets(false));
    }
    if (!show) {
      setCustomer(null);
      setActivities([]);
      setDocuments([]);
      setLinkedTickets([]);
      setSelectedTicket(null);
      setShowCreateTicket(false);
      setLinkedTicketCount(0);
      setLinkedWorkStatusFilter('all');
      setLinkedWorkSortBy('updatedAt');
      setLinkedWorkSortBy('updatedAt');

      setError(null);
    }
  }, [show, customerId, loadCustomer, numaGet]);

  // ── Generic update handler ────────────────────────────────────────────

  const handleUpdate = useCallback(
    async (payload: UpdateCustomerPayload) => {
      if (!customer || !customerId) return;
      const prev = customer;
      setSaving(true);
      try {
        const updated = await OpsService.updateCustomer(numaPut, customerId, payload);
        setCustomer(updated);
        onUpdated?.();
      } catch (err) {
        console.error('[CustomerDetailModal] Update failed', err);
        setCustomer(prev);
        showToast({ message: t('crm.updateFailed'), variant: 'error' });
      } finally {
        setSaving(false);
      }
    },
    [customer, customerId, numaPut, onUpdated, showToast, t]
  );

  // ── Notes inline edit helpers ─────────────────────────────────────────

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setFieldDraft(currentValue);
  };

  const saveField = async (field: string, rawValue?: string) => {
    const value = (rawValue ?? fieldDraft).trim();
    setEditingField(null);

    const currentValue = String((customer as Record<string, unknown>)?.[field] ?? '');
    if (value === currentValue) return;

    await handleUpdate({ [field]: value || null } as UpdateCustomerPayload);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setFieldDraft('');
  };

  // ── Contacts change handler ───────────────────────────────────────────

  const handleContactsChange = useCallback(
    (newContacts: Contact[]) => {
      if (!customer) return;
      // Optimistic local update
      setCustomer({ ...customer, contacts: newContacts });
      void handleUpdate({ contacts: newContacts });
    },
    [customer, handleUpdate]
  );

  // ── Flag toggle ───────────────────────────────────────────────────────

  const toggleFlag = useCallback(
    (flagId: string) => {
      if (!customer) return;
      const newFlags = customer.flags.includes(flagId)
        ? customer.flags.filter((f) => f !== flagId)
        : [...customer.flags, flagId];
      setCustomer({ ...customer, flags: newFlags });
      void handleUpdate({ flags: newFlags });
    },
    [customer, handleUpdate]
  );

  const teamNameById = useMemo(() => {
    const entries = teams.map((team) => [team.id, team.name] as const);
    return new Map(entries);
  }, [teams]);

  const selectedTeamZoneNameById = useMemo(() => {
    const entries = (teamData?.zones ?? []).map((zone) => [zone.id, zone.name] as const);
    return new Map(entries);
  }, [teamData?.zones]);

  const selectedTeamStageNameById = useMemo(() => {
    const entries = (teamData?.stages ?? []).map((stage) => [stage.id, stage.name] as const);
    return new Map(entries);
  }, [teamData?.stages]);

  const openLinkedTicket = useCallback((ticket: Ticket) => {
    setSelectedTicket(ticket);
  }, []);

  const visibleLinkedTickets = useMemo(() => {
    const filtered = linkedTickets.filter((ticket) => {
      if (linkedWorkStatusFilter === 'all') return true;
      return ticket.statusType === linkedWorkStatusFilter;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (linkedWorkSortBy === 'priority') {
        const aRank = PRIORITY_RANK[a.priority] ?? 0;
        const bRank = PRIORITY_RANK[b.priority] ?? 0;
        return bRank - aRank;
      }
      if (linkedWorkSortBy === 'statusType') {
        const aStatus = a.statusType ?? '';
        const bStatus = b.statusType ?? '';
        return aStatus.localeCompare(bStatus);
      }
      if (linkedWorkSortBy === 'createdAt') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return sorted;
  }, [linkedTickets, linkedWorkStatusFilter, linkedWorkSortBy]);

  const resolveLinkedTicketZoneName = useCallback(
    (ticket: Ticket) => {
      if (ticket.teamId !== selectedTeamId) return ticket.zoneId || t('common.none');
      return selectedTeamZoneNameById.get(ticket.zoneId) ?? t('common.none');
    },
    [selectedTeamId, selectedTeamZoneNameById, t]
  );

  const resolveLinkedTicketStageName = useCallback(
    (ticket: Ticket) => {
      if (ticket.teamId !== selectedTeamId) {
        if (!ticket.statusType) return t('common.none');
        return t(`globalSettings.statusTypes.${ticket.statusType}`);
      }
      const stageName = ticket.stageId ? selectedTeamStageNameById.get(ticket.stageId) : undefined;
      if (stageName) return stageName;
      if (!ticket.statusType) return t('common.none');
      return t(`globalSettings.statusTypes.${ticket.statusType}`);
    },
    [selectedTeamId, selectedTeamStageNameById, t]
  );

  const resolveLinkedTicketStatusLabel = useCallback(
    (ticket: Ticket) => {
      if (!ticket.statusType) return t('common.none');
      return t(`globalSettings.statusTypes.${ticket.statusType}`);
    },
    [t]
  );

  const resolveLinkedTicketStatusBadgeBg = useCallback((ticket: Ticket): string => {
    if (ticket.statusType === 'active') return 'primary';
    if (ticket.statusType === 'completed') return 'success';
    if (ticket.statusType === 'ended') return 'secondary';
    return 'light';
  }, []);

  const resolveLinkedTicketStatusBadgeText = useCallback((ticket: Ticket): string => {
    if (ticket.statusType === 'active' || ticket.statusType === 'completed' || ticket.statusType === 'ended') {
      return 'light';
    }
    return 'dark';
  }, []);

  const resolveLinkedTicketPriorityLabel = useCallback(
    (ticket: Ticket) => {
      if (!ticket.priority) return t('common.none');
      return t(`priority.${ticket.priority}`);
    },
    [t]
  );

  const groupedLinkedTickets = useMemo(() => {
    const byTeam = new Map<string, Ticket[]>();
    visibleLinkedTickets.forEach((ticket) => {
      const teamName = teamNameById.get(ticket.teamId) ?? ticket.teamId;
      if (!byTeam.has(teamName)) byTeam.set(teamName, []);
      byTeam.get(teamName)?.push(ticket);
    });
    return Array.from(byTeam.entries())
      .map(([teamName, tickets]) => ({ teamName, tickets }))
      .sort((a, b) => a.teamName.localeCompare(b.teamName));
  }, [visibleLinkedTickets, teamNameById]);

  const lastContactLabel = useMemo(
    () => formatRelativeDateLabel(customer?.lastContactDate, t),
    [customer?.lastContactDate, t]
  );

  // ── Collapsible section renderer ───────────────────────────────────

  const renderSection = (
    sectionKey: string,
    title: React.ReactNode,
    body: React.ReactNode,
    headerExtra?: React.ReactNode
  ) => {
    const isExpanded = expandedSections.has(sectionKey);
    return (
      <div>
        <div
          className="crm-section-header"
          onClick={() => toggleSection(sectionKey)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleSection(sectionKey);
            }
          }}
        >
          <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'}`} />
          <span className="crm-section-header-title">{title}</span>
          {headerExtra && (
            <span className="ms-auto" onClick={(e) => e.stopPropagation()}>
              {headerExtra}
            </span>
          )}
        </div>
        {isExpanded && <div className="crm-section-body">{body}</div>}
      </div>
    );
  };

  // ── Render: loading / error states ────────────────────────────────────

  if (!show) return <></>;

  const renderLoading = () => (
    <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 300 }}>
      <Spinner animation="border" />
    </div>
  );

  const renderError = () => (
    <div className="text-center py-5">
      <p className="text-danger">{t('errors.loadFailed', { message: error ?? '' })}</p>
      <Button variant="outline-primary" size="sm" onClick={() => void loadCustomer()}>
        {t('common.loading')}
      </Button>
    </div>
  );

  // ── Render: header ────────────────────────────────────────────────────

  const renderHeader = () => {
    if (!customer) return null;

    const stage: CrmLifecycleStage | undefined = stages.find((s) => s.id === customer.lifecycleStage);
    const stageColor = stage ? getColorForPosition(stage.colorPosition) : '#6c757d';

    return (
      <Modal.Header closeButton className="align-items-start">
        <div className="d-flex flex-column flex-grow-1 me-2" style={{ minWidth: 0 }}>
          {/* Company name + stage badge */}
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <h5
              className="mb-0 fw-bold text-truncate"
              style={{ maxWidth: '100%', minWidth: 0 }}
              title={customer.companyName}
            >
              {customer.companyName}
            </h5>
            {stage && (
              <span
                className="ticket-badge"
                style={{
                  maxWidth: 'none',
                  background: `${stageColor}18`,
                  color: stageColor,
                  border: `1px solid ${stageColor}40`,
                  fontWeight: 600,
                }}
              >
                {stage.name}
              </span>
            )}
            {saving && <Spinner animation="border" size="sm" className="ms-1" />}
          </div>

          {/* Flag toggles */}
          <div className="d-flex flex-wrap gap-1 mt-2">
            {customerFlags.map((flag) => {
              const isActive = customer.flags.includes(flag.id);
              return (
                <span
                  key={flag.id}
                  className={`ticket-badge ${isActive ? 'ticket-badge-customer' : 'ticket-badge-inactive'}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleFlag(flag.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') toggleFlag(flag.id);
                  }}
                  title={flag.name}
                  style={{ cursor: 'pointer', maxWidth: 'none' }}
                >
                  {flag.icon && <i className={`bi bi-${flag.icon} me-1`} />}
                  {flag.name}
                </span>
              );
            })}
          </div>
        </div>
      </Modal.Header>
    );
  };

  // ── Render: body ──────────────────────────────────────────────────────

  const renderBody = () => {
    if (!customer || !crmConfig) return null;

    return (
      <div>
        {/* ── Customer record sections (configurable) ──────────────────── */}
        {customerRecord.sections.map((section) => (
          <CustomerRecordSectionBlock
            key={section.id}
            section={section}
            customer={customer}
            crmConfig={crmConfig}
            allFields={allFields}
            staff={staff}
            saving={saving}
            onSave={handleUpdate}
            expanded={expandedSections.has(section.id)}
            onToggleExpanded={() => toggleSection(section.id)}
          />
        ))}

        {/* ── Contacts ─────────────────────────────────────────────────── */}
        {renderSection(
          'contacts',
          <>
            {t('crm.contacts')}
            {customer.contacts.length > 0 && (
              <Badge bg="secondary" className="ms-2" style={{ fontSize: '0.7rem' }}>
                {customer.contacts.length}
              </Badge>
            )}
          </>,
          <ContactSection contacts={customer.contacts} onChange={handleContactsChange} />
        )}

        {/* ── Section 4: Activities ────────────────────────────────────── */}
        {renderSection(
          'activities',
          <>
            {t('crm.activities')}
            {activities.length > 0 && (
              <Badge bg="secondary" className="ms-2" style={{ fontSize: '0.7rem' }}>
                {activities.length}
              </Badge>
            )}
          </>,
          <ActivitySection entityType="customer" entityId={customer.id} activities={activities} />
        )}

        {/* ── Section 5: Documents ─────────────────────────────────────── */}
        {renderSection(
          'documents',
          <>
            {t('crm.documents')}
            {documents.length > 0 && (
              <Badge bg="secondary" className="ms-2" style={{ fontSize: '0.7rem' }}>
                {documents.length}
              </Badge>
            )}
          </>,
          <DocumentSection
            entityType="customer"
            entityId={customer.id}
            documents={documents}
            documentTypes={documentTypes}
          />
        )}

        {/* ── Section 6: Linked Work ───────────────────────────────────── */}
        {renderSection(
          'linkedWork',
          <>
            {t('crm.linkedWork')}
            {linkedTickets.length > 0 && (
              <Badge bg="secondary" className="ms-1" style={{ fontSize: '0.7rem' }}>
                {linkedTickets.length}
              </Badge>
            )}
          </>,
          <>
            {loadingTickets ? (
              <div className="d-flex justify-content-center py-3">
                <Spinner animation="border" size="sm" />
              </div>
            ) : linkedTicketCount > 0 && linkedTickets.length > 0 ? (
              <div>
                <div className="d-flex flex-wrap align-items-end gap-2 mb-2">
                  <div style={{ minWidth: 180 }}>
                    <Form.Label className="small mb-1">{t('crm.filterStatus')}</Form.Label>
                    <Form.Select
                      size="sm"
                      value={linkedWorkStatusFilter}
                      onChange={(e) => setLinkedWorkStatusFilter(e.target.value as LinkedWorkStatusFilter)}
                    >
                      <option value="all">{t('crm.allStatuses')}</option>
                      {LINKED_WORK_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {t(`globalSettings.statusTypes.${status}`)}
                        </option>
                      ))}
                    </Form.Select>
                  </div>

                  <div style={{ minWidth: 180 }}>
                    <Form.Label className="small mb-1">{t('crm.sortBy')}</Form.Label>
                    <Form.Select
                      size="sm"
                      value={linkedWorkSortBy}
                      onChange={(e) => setLinkedWorkSortBy(e.target.value as LinkedWorkSortBy)}
                    >
                      <option value="updatedAt">{t('crm.sortUpdated')}</option>
                      <option value="createdAt">{t('crm.sortCreated')}</option>
                      <option value="priority">{t('crm.sortPriority')}</option>
                      <option value="statusType">{t('crm.sortStatus')}</option>
                    </Form.Select>
                  </div>

                  <span className="small text-muted ms-auto">
                    {t('tickets.count', { count: visibleLinkedTickets.length })}
                  </span>
                </div>

                {visibleLinkedTickets.length === 0 ? (
                  <div className="text-muted small">{t('crm.noLinkedWorkMatches')}</div>
                ) : (
                  <div className="d-flex flex-column gap-3">
                    {groupedLinkedTickets.map((group) => (
                      <div key={group.teamName}>
                        <div className="d-flex align-items-center justify-content-between mb-1">
                          <span className="small fw-semibold">{group.teamName}</span>
                          <Badge bg="light" text="dark" pill>
                            {group.tickets.length}
                          </Badge>
                        </div>
                        <Table size="sm" hover responsive className="small mb-0">
                          <thead>
                            <tr>
                              <th>{t('linkedTickets.ticketDisplayId')}</th>
                              <th>{t('tickets.title')}</th>
                              <th>{t('zones.zone')}</th>
                              <th>{t('zones.stage')}</th>
                              <th>{t('tickets.status')}</th>
                              <th>{t('tickets.priority')}</th>
                              <th>{t('tickets.updated')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.tickets.map((ticket) => (
                              <tr
                                key={ticket.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => openLinkedTicket(ticket)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    openLinkedTicket(ticket);
                                  }
                                }}
                                style={{ cursor: 'pointer' }}
                              >
                                {/*
                                  Guard against partially populated ticket rows.
                                  The hydration path should provide full fields, but this keeps UI stable.
                                */}
                                <td className="font-monospace">
                                  <span className="text-primary">{ticket.displayId || ticket.id}</span>
                                </td>
                                <td className="text-truncate" style={{ maxWidth: 320 }} title={ticket.title}>
                                  {ticket.title || t('common.none')}
                                </td>
                                <td>{resolveLinkedTicketZoneName(ticket)}</td>
                                <td>{resolveLinkedTicketStageName(ticket)}</td>
                                <td>
                                  <Badge
                                    bg={resolveLinkedTicketStatusBadgeBg(ticket)}
                                    text={resolveLinkedTicketStatusBadgeText(ticket)}
                                  >
                                    {resolveLinkedTicketStatusLabel(ticket)}
                                  </Badge>
                                </td>
                                <td>{resolveLinkedTicketPriorityLabel(ticket)}</td>
                                <td>
                                  {ticket.updatedAt
                                    ? new Date(ticket.updatedAt).toLocaleDateString()
                                    : ticket.createdAt
                                      ? new Date(ticket.createdAt).toLocaleDateString()
                                      : t('common.none')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : linkedTicketCount > 0 ? (
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-ticket-detailed text-muted" />
              </div>
            ) : linkedTickets.length === 0 ? (
              <div className="text-muted small">{t('empty.noTickets')}</div>
            ) : (
              <div>
                {linkedTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="d-flex align-items-center gap-2 py-2 border-bottom"
                    style={{ cursor: 'pointer', fontSize: '0.85rem' }}
                    onClick={() => setSelectedTicket(ticket)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelectedTicket(ticket);
                    }}
                  >
                    <Badge
                      bg="light"
                      text="dark"
                      className="border"
                      style={{ fontFamily: 'monospace', flexShrink: 0, fontSize: '0.72rem' }}
                    >
                      {ticket.displayId}
                    </Badge>
                    <span className="text-truncate flex-grow-1" title={ticket.title}>
                      {ticket.title}
                    </span>
                    <PriorityIndicator priority={ticket.priority} />
                    {ticket.assigneeName && (
                      <span className="text-muted small flex-shrink-0" style={{ fontSize: '0.75rem' }}>
                        {ticket.assigneeName}
                      </span>
                    )}
                    <i className="bi bi-chevron-right text-muted" style={{ fontSize: '0.65rem', flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            )}
          </>,
          <Button
            variant="outline-primary"
            size="sm"
            style={{ fontSize: '0.72rem', padding: '1px 8px', flexShrink: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              setShowCreateTicket(true);
            }}
          >
            <i className="bi bi-plus me-1" />
            {t('tickets.newTicket')}
          </Button>
        )}

        {/* ── Section 7: Notes ─────────────────────────────────────────── */}
        {renderSection(
          'notes',
          t('crm.accountNotes'),
          <>
            {editingField === 'notes' ? (
              <div>
                <Form.Control
                  as="textarea"
                  rows={6}
                  value={fieldDraft}
                  onChange={(e) => setFieldDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void saveField('notes');
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  style={{ fontSize: '0.9rem', resize: 'vertical' }}
                  autoFocus
                  disabled={saving}
                />
                <div className="d-flex gap-2 mt-2">
                  <Button size="sm" variant="primary" onClick={() => void saveField('notes')} disabled={saving}>
                    {t('common.save')}
                  </Button>
                  <Button size="sm" variant="outline-secondary" onClick={cancelEdit}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="p-2 rounded"
                style={{
                  cursor: 'pointer',
                  minHeight: 80,
                  whiteSpace: 'pre-wrap',
                  fontSize: '0.9rem',
                  backgroundColor: '#f8f9fa',
                }}
                onClick={() => startEdit('notes', customer.notes ?? '')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    startEdit('notes', customer.notes ?? '');
                  }
                }}
              >
                {customer.notes || <span className="text-muted">{t('common.description')}</span>}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // ── Render: modal ─────────────────────────────────────────────────────

  return (
    <>
      <Modal
        show={show}
        onHide={onHide}
        size="xl"
        fullscreen="lg-down"
        scrollable
        dialogClassName="crm-detail-modal"
        contentClassName="d-flex flex-column"
      >
        {loading && renderLoading()}
        {!loading && error && renderError()}
        {!loading && !error && customer && (
          <>
            {renderHeader()}
            <Modal.Body style={{ overflowY: 'auto' }}>{renderBody()}</Modal.Body>
            <Modal.Footer className="d-flex justify-content-between">
              <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
                {t('crm.lastContactFooter')}: {lastContactLabel}
              </span>
              <div className="d-flex align-items-center gap-2">
                <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
                  {t('tickets.created')}:{' '}
                  {customer.createdAt ? new Date(customer.createdAt).toLocaleDateString() : t('common.none')}
                </span>
                <button type="button" className="ticket-detail-footer-btn" onClick={onHide}>
                  {t('common.close')}
                </button>
              </div>
            </Modal.Footer>
          </>
        )}
      </Modal>

      {/* Create ticket pre-linked to this customer */}
      <CreateTicketModal
        show={showCreateTicket}
        onHide={() => setShowCreateTicket(false)}
        onSuccess={(ticket) => {
          setShowCreateTicket(false);
          setLinkedTickets((prev) => [ticket, ...prev]);
        }}
        prefilledCustomerId={customerId}
        prefilledCustomerName={customer?.companyName}
      />
      {/* Open a linked ticket's detail modal */}
      <TicketDetailModal
        show={showLinkedTicketDetail}
        ticketId={linkedTicketDetailId}
        teamIdOverride={linkedTicketDetailTeamId}
        onHide={() => {
          setShowLinkedTicketDetail(false);
          setLinkedTicketDetailId(null);
          setLinkedTicketDetailTeamId(null);
        }}
      />
    </>
  );
}

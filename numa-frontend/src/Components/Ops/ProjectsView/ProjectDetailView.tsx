import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useAuth } from '../../../Providers/AuthProvider';
import { useToast } from '../../../Providers/ToastContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { RichTextEditor } from '../Shared/RichTextEditor';
import type { RichTextEditorHandle } from '../Shared/RichTextEditor';
import { CreateTicketModal } from '../Modals/CreateTicketModal';
import type { Project, Ticket } from '../../../types/ops';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ProjectDetailViewProps {
  projectId: string | null; // null = create mode
  onBack: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toDateInputValue(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ProjectDetailView({ projectId, onBack }: ProjectDetailViewProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPost, numaPut, numaDelete } = useNumaRequest();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { config, teams, tickets, refreshConfig, selectTeam, refreshTickets } = useOps();
  const isAdmin = user?.decoded_tokens?.idToken?.['cognito:groups']?.includes('Admins') ?? false;
  const userSub = user?.decoded_tokens?.idToken?.sub ?? '';

  const goalsRef = useRef<RichTextEditorHandle>(null);

  const isCreate = projectId === null;
  const existingProject = config?.projects?.find((p) => p.id === projectId) ?? null;

  // Owner or unowned = can delete
  const canDelete = !isCreate && (!existingProject?.ownerId || existingProject.ownerId === userSub || isAdmin);

  // ── Form state ─────────────────────────────────────────────────────────

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [goals, setGoals] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [boardIds, setBoardIds] = useState<string[]>([]);
  const [allBoards, setAllBoards] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const [showBoardPicker, setShowBoardPicker] = useState(false);
  const [showCreateTicket, setShowCreateTicket] = useState(false);

  // ── Linked tickets ────────────────────────────────────────────────────

  const projectTickets = useMemo(() => {
    if (!projectId) return [];
    return tickets.filter((tk) => tk.projectId === projectId);
  }, [tickets, projectId]);

  // ── Board visibility description ──────────────────────────────────────

  const boardVisibilityText = useMemo(() => {
    if (allBoards || !boardIds.length) return t('projects.visibleAllBoards', 'Visible on all boards');
    const names = boardIds.map((id) => teams.find((tm) => tm.id === id)?.name).filter(Boolean);
    if (!names.length) return t('projects.visibleAllBoards', 'Visible on all boards');
    return t('projects.visibleOnBoards', { boards: names.join(', '), defaultValue: `Visible on: ${names.join(', ')}` });
  }, [allBoards, boardIds, teams, t]);

  // ── Dirty detection ───────────────────────────────────────────────────

  const isDirty = (() => {
    if (isCreate) {
      return name.trim() !== '' || description.trim() !== '' || goals.trim() !== '';
    }
    if (!existingProject) return false;
    const origAllBoards = !existingProject.boardIds?.length;
    return (
      name !== existingProject.name ||
      description !== (existingProject.description ?? '') ||
      goals !== (existingProject.goals ?? '') ||
      color !== (existingProject.color || '#6366f1') ||
      ownerId !== (existingProject.ownerId ?? null) ||
      startDate !== toDateInputValue(existingProject.startDate) ||
      endDate !== toDateInputValue(existingProject.endDate) ||
      allBoards !== origAllBoards ||
      (!allBoards && JSON.stringify(boardIds) !== JSON.stringify(existingProject.boardIds ?? [])) ||
      isActive !== existingProject.isActive
    );
  })();

  const handleBack = () => {
    if (isDirty) {
      setConfirmDiscard(true);
    } else {
      onBack();
    }
  };

  // ── Populate form ─────────────────────────────────────────────────────

  useEffect(() => {
    if (existingProject) {
      setName(existingProject.name);
      setDescription(existingProject.description ?? '');
      setGoals(existingProject.goals ?? '');
      setColor(existingProject.color || '#6366f1');
      setOwnerId(existingProject.ownerId ?? null);
      setStartDate(toDateInputValue(existingProject.startDate));
      setEndDate(toDateInputValue(existingProject.endDate));
      setBoardIds(existingProject.boardIds ?? []);
      setAllBoards(!existingProject.boardIds?.length);
      setIsActive(existingProject.isActive);
      setShowMeta(
        !!(
          existingProject.ownerId ||
          existingProject.startDate ||
          existingProject.endDate ||
          existingProject.boardIds?.length
        )
      );
    } else {
      // Create mode -- auto-populate owner to current user
      setName('');
      setDescription('');
      setGoals('');
      setColor('#6366f1');
      setOwnerId(userSub || null);
      setStartDate('');
      setEndDate('');
      setBoardIds([]);
      setAllBoards(true);
      setIsActive(true);
      setShowMeta(false);
    }
    setConfirmDelete(false);
    setConfirmDiscard(false);
  }, [existingProject, userSub]);

  // ── Save ──────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    goalsRef.current?.flush();

    const staff = config?.staff ?? [];
    const ownerStaff = staff.find((s) => s.id === ownerId);

    const payload: Partial<Project> = {
      name: name.trim(),
      description: description.trim() || undefined,
      goals: goals.trim() || undefined,
      color,
      status: isActive ? 'active' : 'complete',
      ownerId: ownerId || null,
      ownerName: ownerStaff?.name ?? ownerStaff?.email ?? null,
      startDate: startDate || null,
      endDate: endDate || null,
      boardIds: allBoards ? [] : boardIds,
      isActive,
    };

    try {
      if (isCreate) {
        await OpsService.createProject(numaPost, payload as Omit<Project, 'id'>);
        showToast({ message: t('projects.created'), variant: 'success' });
      } else {
        await OpsService.updateProject(numaPut, projectId!, payload);
        showToast({ message: t('projects.saved'), variant: 'success' });
      }
      await refreshConfig();
      onBack();
    } catch (err) {
      console.error('Failed to save project:', err);
      showToast({ message: String(err), variant: 'error' });
    } finally {
      setSaving(false);
    }
  }, [
    name,
    description,
    goals,
    color,
    ownerId,
    startDate,
    endDate,
    boardIds,
    allBoards,
    isActive,
    isCreate,
    projectId,
    config,
    numaPost,
    numaPut,
    refreshConfig,
    onBack,
    showToast,
    t,
  ]);

  // ── Delete ────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    if (!projectId) return;
    setSaving(true);
    try {
      await OpsService.deleteProject(numaDelete, projectId);
      showToast({ message: t('projects.deleted'), variant: 'success' });
      await refreshConfig();
      onBack();
    } catch (err) {
      console.error('Failed to delete project:', err);
      showToast({ message: String(err), variant: 'error' });
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  }, [projectId, numaDelete, refreshConfig, onBack, showToast, t]);

  // ── Board toggle ──────────────────────────────────────────────────────

  const toggleBoard = (teamId: string) => {
    setBoardIds((prev) => (prev.includes(teamId) ? prev.filter((id) => id !== teamId) : [...prev, teamId]));
  };

  const handleAllBoardsToggle = (checked: boolean) => {
    setAllBoards(checked);
    if (checked) setBoardIds([]);
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <>
      {/* Sub-header row */}
      <div className="d-flex align-items-center px-3 border-bottom bg-white" style={{ minHeight: 64 }}>
        <button
          onClick={handleBack}
          className="d-flex align-items-center gap-1"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: 'var(--ops-font-sm, 0.8rem)',
            color: '#6b7280',
          }}
        >
          <i className="bi bi-arrow-left" />
          {t('projects.allProjectsBack', 'All projects')}
        </button>
      </div>

      <div className="px-3 pb-5" style={{ position: 'relative', marginTop: 16 }}>
        {/* Folder tab bump - positioned relative to card edges */}
        <svg
          width="140"
          height="22"
          viewBox="0 0 140 22"
          style={{
            display: 'block',
            marginLeft: 12,
            marginBottom: -1,
          }}
        >
          <path d="M 8 22 L 8 10 Q 8 0, 18 0 L 90 0 Q 102 0, 108 10 L 116 22 Z" fill={color} opacity="0.9" />
        </svg>

        {/* Content area -- white card with colored top border */}
        <div
          style={{
            position: 'relative',
            backgroundColor: '#ffffff',
            border: '1px solid #e4e4e7',
            borderTop: `3px solid ${color}`,
            borderRadius: '2px 10px 10px 10px',
            padding: '28px 32px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          }}
        >
          {/* Header row: label + active toggle + visibility info */}
          <div className="d-flex align-items-center justify-content-between mb-2">
            <span
              style={{
                fontSize: 'var(--ops-font-xs, 0.7rem)',
                color: '#9ca3af',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {isCreate ? t('projects.createProject') : t('projects.editProject')}
            </span>

            <div className="d-flex align-items-center gap-3">
              {/* Visibility info */}
              {!isCreate && (
                <OverlayTrigger
                  placement="bottom"
                  overlay={<Tooltip id="project-visibility-tip">{boardVisibilityText}</Tooltip>}
                >
                  <span style={{ cursor: 'help', color: '#9ca3af', fontSize: 'var(--ops-font-xs, 0.7rem)' }}>
                    <i className="bi bi-info-circle" />
                  </span>
                </OverlayTrigger>
              )}

              {/* Active toggle */}
              {!isCreate && (
                <div className="d-flex align-items-center gap-2">
                  <span style={{ fontSize: 'var(--ops-font-xs, 0.7rem)', color: '#9ca3af' }}>
                    {isActive ? t('common.active', 'Active') : t('projects.archived', 'Archived')}
                  </span>
                  <Form.Check
                    type="switch"
                    id="project-active-toggle"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    style={{ marginBottom: 0 }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Name */}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('projects.namePlaceholder', 'Project name')}
            autoFocus
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              fontSize: '1.5rem',
              fontWeight: 700,
              color: '#111827',
              padding: 0,
              marginBottom: 4,
              background: 'transparent',
            }}
          />

          {/* Description */}
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('projects.descriptionPlaceholder', 'Add a brief description...')}
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              fontSize: 'var(--ops-font-base, 0.875rem)',
              color: '#6b7280',
              padding: 0,
              marginBottom: 24,
              background: 'transparent',
            }}
          />

          {/* Goals */}
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 'var(--ops-font-xs, 0.7rem)',
                fontWeight: 600,
                color: '#9ca3af',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 8,
              }}
            >
              {t('projects.goals')}
            </div>
            <RichTextEditor
              ref={goalsRef}
              value={goals}
              onSave={setGoals}
              onChange={setGoals}
              placeholder={t('projects.goalsPlaceholder')}
              minHeight={180}
            />
          </div>

          {/* Details -- collapsible */}
          <div style={{ borderTop: '1px solid var(--ops-border, #e4e4e7)', paddingTop: 16, marginBottom: 24 }}>
            <button
              onClick={() => setShowMeta(!showMeta)}
              className="d-flex align-items-center gap-1"
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontSize: 'var(--ops-font-xs, 0.7rem)',
                fontWeight: 600,
                color: '#9ca3af',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              <i className={`bi bi-chevron-${showMeta ? 'down' : 'right'}`} style={{ fontSize: '0.6rem' }} />
              {t('projects.details', 'Details')}
            </button>

            {showMeta && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px', marginTop: 16 }}>
                <MetaField label={t('common.color', 'Color')}>
                  <div className="d-flex align-items-center gap-2">
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      style={{
                        width: 24,
                        height: 24,
                        border: '1px solid var(--ops-border, #e4e4e7)',
                        borderRadius: 'var(--ops-radius-sm, 4px)',
                        padding: 0,
                        cursor: 'pointer',
                      }}
                    />
                    <span style={{ fontSize: 'var(--ops-font-sm, 0.8rem)', color: '#6b7280', fontFamily: 'monospace' }}>
                      {color}
                    </span>
                  </div>
                </MetaField>

                <MetaField label={t('projects.owner')}>
                  <Form.Select
                    size="sm"
                    value={ownerId ?? ''}
                    onChange={(e) => setOwnerId(e.target.value || null)}
                    style={{ fontSize: 'var(--ops-font-sm, 0.8rem)', borderRadius: 'var(--ops-radius-sm, 4px)' }}
                  >
                    <option value="">{t('common.none', 'None')}</option>
                    {(config?.staff ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name || s.email}
                      </option>
                    ))}
                  </Form.Select>
                </MetaField>

                <MetaField label={t('projects.startDate')}>
                  <Form.Control
                    size="sm"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    style={{ fontSize: 'var(--ops-font-sm, 0.8rem)', borderRadius: 'var(--ops-radius-sm, 4px)' }}
                  />
                </MetaField>

                <MetaField label={t('projects.endDate')}>
                  <Form.Control
                    size="sm"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    style={{ fontSize: 'var(--ops-font-sm, 0.8rem)', borderRadius: 'var(--ops-radius-sm, 4px)' }}
                  />
                </MetaField>

                <div style={{ gridColumn: '1 / -1' }}>
                  <MetaField label={t('projects.boards')}>
                    <div className="d-flex flex-wrap align-items-center gap-3">
                      <Form.Check
                        type="checkbox"
                        id="board-all"
                        label={t('projects.allBoards')}
                        checked={allBoards}
                        onChange={(e) => handleAllBoardsToggle(e.target.checked)}
                        style={{ fontSize: 'var(--ops-font-sm, 0.8rem)' }}
                      />
                      {!allBoards &&
                        teams.map((team) => (
                          <Form.Check
                            key={team.id}
                            type="checkbox"
                            id={`board-${team.id}`}
                            label={team.name}
                            checked={boardIds.includes(team.id)}
                            onChange={() => toggleBoard(team.id)}
                            style={{ fontSize: 'var(--ops-font-sm, 0.8rem)' }}
                          />
                        ))}
                    </div>
                  </MetaField>
                </div>
              </div>
            )}
          </div>

          {/* Linked tickets */}
          {!isCreate && (
            <div style={{ borderTop: '1px solid var(--ops-border, #e4e4e7)', paddingTop: 16, marginBottom: 24 }}>
              <div className="d-flex align-items-center justify-content-between" style={{ marginBottom: 12 }}>
                <div
                  style={{
                    fontSize: 'var(--ops-font-xs, 0.7rem)',
                    fontWeight: 600,
                    color: '#9ca3af',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {t('projects.linkedTickets', 'Tickets')} ({projectTickets.length})
                </div>

                {/* Create ticket -- board picker then modal */}
                <div className="d-flex align-items-center gap-2">
                  {showBoardPicker ? (
                    <>
                      <Form.Select
                        size="sm"
                        autoFocus
                        onChange={(e) => {
                          if (e.target.value) {
                            selectTeam(e.target.value);
                            setShowBoardPicker(false);
                            setShowCreateTicket(true);
                          }
                        }}
                        defaultValue=""
                        style={{
                          fontSize: 'var(--ops-font-sm, 0.8rem)',
                          width: 'auto',
                          borderRadius: 'var(--ops-radius-sm, 4px)',
                        }}
                      >
                        <option value="" disabled>
                          {t('projects.selectBoard', 'Select a board...')}
                        </option>
                        {(allBoards ? teams : teams.filter((tm) => boardIds.includes(tm.id))).map((tm) => (
                          <option key={tm.id} value={tm.id}>
                            {tm.name}
                          </option>
                        ))}
                      </Form.Select>
                      <button
                        onClick={() => setShowBoardPicker(false)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#9ca3af',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          padding: 0,
                        }}
                      >
                        <i className="bi bi-x-lg" />
                      </button>
                    </>
                  ) : (
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => {
                        // If only one board available, skip picker
                        const availableBoards = allBoards ? teams : teams.filter((tm) => boardIds.includes(tm.id));
                        if (availableBoards.length === 1) {
                          selectTeam(availableBoards[0].id);
                          setShowCreateTicket(true);
                        } else {
                          setShowBoardPicker(true);
                        }
                      }}
                    >
                      <i className="bi bi-plus me-1" />
                      {t('projects.createTicket', 'New Ticket')}
                    </Button>
                  )}
                </div>
              </div>

              {projectTickets.length === 0 ? (
                <div style={{ fontSize: 'var(--ops-font-sm, 0.8rem)', color: '#9ca3af' }}>
                  {t('projects.noLinkedTickets', 'No tickets linked to this project yet.')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {projectTickets.slice(0, 20).map((ticket) => (
                    <TicketRow key={ticket.id} ticket={ticket} config={config} teams={teams} />
                  ))}
                  {projectTickets.length > 20 && (
                    <div style={{ fontSize: 'var(--ops-font-xs, 0.7rem)', color: '#9ca3af', paddingTop: 4 }}>
                      {t('projects.moreTickets', { count: projectTickets.length - 20 })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Footer actions */}
          <div
            className="d-flex align-items-center justify-content-between"
            style={{ borderTop: '1px solid var(--ops-border, #e4e4e7)', paddingTop: 16 }}
          >
            <div>
              {canDelete &&
                (confirmDelete ? (
                  <div className="d-flex align-items-center gap-2">
                    <span style={{ fontSize: 'var(--ops-font-sm, 0.8rem)', color: '#dc2626' }}>
                      {t('projects.deleteConfirm')}
                    </span>
                    <Button size="sm" variant="danger" onClick={handleDelete} disabled={saving}>
                      {t('common.confirm', 'Confirm')}
                    </Button>
                    <Button size="sm" variant="outline-secondary" onClick={() => setConfirmDelete(false)}>
                      {t('common.cancel', 'Cancel')}
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#9ca3af',
                      fontSize: 'var(--ops-font-sm, 0.8rem)',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <i className="bi bi-trash3 me-1" />
                    {t('common.delete', 'Delete')}
                  </button>
                ))}
            </div>

            <div className="d-flex align-items-center gap-2">
              {confirmDiscard ? (
                <>
                  <span style={{ fontSize: 'var(--ops-font-sm, 0.8rem)', color: '#6b7280' }}>
                    {t('common.unsavedChanges', 'Unsaved changes will be lost.')}
                  </span>
                  <Button
                    size="sm"
                    variant="outline-danger"
                    onClick={() => {
                      setConfirmDiscard(false);
                      onBack();
                    }}
                  >
                    {t('common.discard', 'Discard')}
                  </Button>
                  <Button size="sm" variant="outline-secondary" onClick={() => setConfirmDiscard(false)}>
                    {t('common.keepEditing', 'Keep editing')}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline-secondary" size="sm" onClick={handleBack}>
                    {t('common.cancel', 'Cancel')}
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
                    {saving && <span className="spinner-border spinner-border-sm me-1" />}
                    {isCreate ? t('common.create', 'Create') : t('common.save', 'Save')}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Create ticket modal -- project pre-filled */}
      <CreateTicketModal
        show={showCreateTicket}
        onHide={() => setShowCreateTicket(false)}
        onSuccess={() => {
          setShowCreateTicket(false);
          void refreshTickets();
        }}
        prefilledProjectId={projectId}
      />
    </>
  );
}

// ─── TicketRow ──────────────────────────────────────────────────────────────

const STATUS_TYPE_COLORS: Record<string, string> = {
  backlog: '#9ca3af',
  scoped: '#60a5fa',
  queued: '#a78bfa',
  active: '#f59e0b',
  completed: '#22c55e',
  ended: '#6b7280',
};

function TicketRow({
  ticket,
  config,
  teams,
}: {
  ticket: Ticket;
  config: { statuses?: { id: string; name: string; statusType?: string }[] } | null;
  teams: { id: string; name: string }[];
}): React.JSX.Element {
  const status = config?.statuses?.find((s) => s.id === ticket.stageId);
  const statusColor = STATUS_TYPE_COLORS[status?.statusType ?? 'backlog'] ?? '#9ca3af';
  const boardName = teams.find((t) => t.id === ticket.teamId)?.name;

  return (
    <div
      className="d-flex align-items-center gap-2"
      style={{
        fontSize: 'var(--ops-font-sm, 0.8rem)',
        padding: '6px 8px',
        borderRadius: 'var(--ops-radius-sm, 4px)',
        backgroundColor: '#f9fafb',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: statusColor,
          flexShrink: 0,
        }}
      />
      {ticket.displayId && (
        <span style={{ color: '#9ca3af', fontWeight: 500, fontSize: 'var(--ops-font-xs, 0.7rem)' }}>
          {ticket.displayId}
        </span>
      )}
      <span className="text-truncate" style={{ color: '#374151', flex: 1 }}>
        {ticket.title}
      </span>
      {boardName && (
        <span style={{ color: '#9ca3af', fontSize: 'var(--ops-font-xs, 0.7rem)', flexShrink: 0 }}>{boardName}</span>
      )}
    </div>
  );
}

// ─── MetaField ──────────────────────────────────────────────────────────────

function MetaField({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div
        style={{
          fontSize: 'var(--ops-font-xs, 0.7rem)',
          fontWeight: 600,
          color: '#9ca3af',
          marginBottom: 6,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

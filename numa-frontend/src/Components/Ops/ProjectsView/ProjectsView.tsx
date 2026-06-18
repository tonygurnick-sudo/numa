import React, { useState, useMemo } from 'react';
import { Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useOps } from '../OpsContext';
import { ProjectDetailView } from './ProjectDetailView';
import ProjectProgressBar from './ProjectProgressBar';
import type { Project } from '../../../types/ops';

/** Completion stats for a project, derived from its tickets. */
type ProjectStats = { total: number; done: number };

// ─── Component ──────────────────────────────────────────────────────────────

interface ProjectsViewProps {
  initialProjectId?: string | null;
}

export function ProjectsView({ initialProjectId }: ProjectsViewProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { config, boards, selectedBoardId, boardViewMode, tickets } = useOps();

  const [boardFilter, setBoardFilter] = useState<string>('');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(initialProjectId ?? null);
  const [creatingNew, setCreatingNew] = useState(false);

  const projects = config?.projects ?? [];
  const accessibleTeamIds = useMemo(() => new Set(boards.map((t) => t.id)), [boards]);

  const filteredProjects = useMemo(() => {
    const activeFilter = boardFilter || (boardViewMode === 'singleBoard' ? selectedBoardId : null);
    return (
      projects
        .filter((p) => p.isActive)
        // Only show projects the user can access: unscoped (all boards) or linked to at least one of their boards
        .filter((p) => !p.boardIds?.length || p.boardIds.some((id) => accessibleTeamIds.has(id)))
        .filter((p) => {
          if (!activeFilter) return true;
          if (!p.boardIds?.length) return true;
          return p.boardIds.includes(activeFilter);
        })
    );
  }, [projects, boardFilter, boardViewMode, selectedBoardId, accessibleTeamIds]);

  // Ticket totals + completion per project (completed | ended = done)
  const projectStats = useMemo(() => {
    const stats = new Map<string, ProjectStats>();
    for (const ticket of tickets) {
      if (!ticket.projectId) continue;
      const s = stats.get(ticket.projectId) ?? { total: 0, done: 0 };
      s.total += 1;
      if (ticket.statusType === 'completed' || ticket.statusType === 'ended') s.done += 1;
      stats.set(ticket.projectId, s);
    }
    return stats;
  }, [tickets]);

  // ── Detail / Create view ──────────────────────────────────────────────

  if (activeProjectId !== null || creatingNew) {
    return (
      <ProjectDetailView
        projectId={activeProjectId}
        onBack={() => {
          setActiveProjectId(null);
          setCreatingNew(false);
        }}
      />
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────

  if (projects.length === 0) {
    return (
      <>
        {/* Toolbar row */}
        <div className="d-flex align-items-center px-3 border-bottom bg-white" style={{ minHeight: 64 }}>
          <div className="flex-grow-1" />
          <Button variant="primary" size="sm" className="rounded-pill" onClick={() => setCreatingNew(true)}>
            <i className="bi bi-plus me-1" />
            {t('projects.createProject')}
          </Button>
        </div>
        <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: 400 }}>
          <i className="bi bi-folder" style={{ fontSize: '2.5rem', color: '#d1d5db' }} />
          <div className="fw-semibold mt-3" style={{ fontSize: '1.05rem' }}>
            {t('projects.noProjects')}
          </div>
          <div
            className="text-muted mb-3"
            style={{ fontSize: 'var(--ops-font-sm, 0.8rem)', maxWidth: 320, textAlign: 'center' }}
          >
            {t('projects.noProjectsHelp')}
          </div>
          <Button variant="primary" size="sm" onClick={() => setCreatingNew(true)}>
            <i className="bi bi-plus me-1" />
            {t('projects.createProject')}
          </Button>
        </div>
      </>
    );
  }

  // ── Grid view ─────────────────────────────────────────────────────────

  return (
    <>
      {/* Toolbar row -- matches Board row 2 pattern */}
      <div className="d-flex align-items-center px-3 gap-2 border-bottom bg-white" style={{ minHeight: 64 }}>
        {boards.length > 1 && (
          <Form.Select
            size="sm"
            value={boardFilter}
            onChange={(e) => setBoardFilter(e.target.value)}
            style={{ width: 'auto', borderRadius: 8 }}
          >
            <option value="">{t('projects.allBoards')}</option>
            {boards.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Form.Select>
        )}

        <div className="flex-grow-1" />

        <Button variant="primary" size="sm" className="rounded-pill" onClick={() => setCreatingNew(true)}>
          <i className="bi bi-plus me-1" />
          {t('projects.createProject')}
        </Button>
      </div>

      {/* Visibility note */}
      <div className="px-3 pt-2" style={{ fontSize: 'var(--ops-font-xs, 0.7rem)', color: '#9ca3af' }}>
        <i className="bi bi-eye me-1" />
        {t('projects.visibilityNote')}
      </div>

      {/* Card grid */}
      <div
        className="px-3 pt-3"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '8px 16px',
        }}
      >
        {filteredProjects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            stats={projectStats.get(project.id) ?? { total: 0, done: 0 }}
            onClick={() => setActiveProjectId(project.id)}
          />
        ))}
      </div>
    </>
  );
}

// ─── ProjectCard ────────────────────────────────────────────────────────────

interface ProjectCardProps {
  project: Project;
  stats: ProjectStats;
  onClick: () => void;
}

function ProjectCard({ project, stats, onClick }: ProjectCardProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [hovered, setHovered] = useState(false);

  const { total: ticketCount, done: doneCount } = stats;

  const summary = project.description || (project.goals ? project.goals.replace(/<[^>]*>/g, '') : '');

  const projectColor = project.color || '#9ca3af';

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      style={{
        position: 'relative',
        marginTop: 20,
        cursor: 'pointer',
        transition: 'transform 0.15s ease, filter 0.15s ease',
        transform: hovered ? 'translateY(-2px)' : 'none',
        filter: hovered ? 'drop-shadow(0 6px 16px rgba(0,0,0,0.10))' : 'drop-shadow(0 1px 3px rgba(0,0,0,0.06))',
      }}
    >
      {/* Back panel with tab - the colored folder shape */}
      <svg
        viewBox="0 0 300 170"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          top: -16,
          left: 0,
          width: '100%',
          height: 'calc(100% + 16px)',
          display: 'block',
        }}
      >
        {/* Back panel: tab bump + full rectangle */}
        <path
          d={`
            M 10 18
            L 10 10 Q 10 0, 20 0
            L 85 0 Q 95 0, 100 10
            L 105 18
            L 290 18 Q 300 18, 300 28
            L 300 160 Q 300 170, 290 170
            L 10 170 Q 0 170, 0 160
            L 0 28 Q 0 18, 10 18
            Z
          `}
          fill={projectColor}
          opacity="0.9"
        />
      </svg>

      {/* Front panel - the white card */}
      <div
        style={{
          position: 'relative',
          backgroundColor: '#ffffff',
          borderRadius: 10,
          padding: '18px 20px',
          marginTop: 4,
          display: 'flex',
          flexDirection: 'column',
          height: 150,
          border: `1px solid color-mix(in srgb, ${projectColor} 25%, #e4e4e7)`,
        }}
      >
        <div
          style={{
            fontSize: 'var(--ops-font-base, 0.875rem)',
            fontWeight: 600,
            color: '#111827',
            marginBottom: summary ? 6 : 0,
            lineHeight: 1.35,
          }}
        >
          {project.name}
        </div>

        {summary && (
          <div
            style={{
              fontSize: 'var(--ops-font-sm, 0.8rem)',
              color: '#6b7280',
              lineHeight: 1.5,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              flex: 1,
            }}
          >
            {summary}
          </div>
        )}

        {ticketCount > 0 && (
          <div style={{ marginTop: 'auto', paddingTop: 10 }}>
            <ProjectProgressBar done={doneCount} total={ticketCount} variant="card" />
          </div>
        )}

        <div
          style={{
            fontSize: 'var(--ops-font-xs, 0.7rem)',
            color: '#9ca3af',
            marginTop: ticketCount > 0 ? 8 : 'auto',
            paddingTop: ticketCount > 0 ? 0 : 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {project.ownerName && (
            <>
              <i className="bi bi-person" style={{ fontSize: '0.65rem' }} />
              <span>{project.ownerName}</span>
            </>
          )}
          {ticketCount > 0 && (
            <>
              {project.ownerName && <span style={{ color: '#d1d5db' }}>&middot;</span>}
              <span>
                <i className="bi bi-ticket-perforated me-1" style={{ fontSize: '0.65rem' }} />
                {t('projects.ticketCount', { count: ticketCount })}
              </span>
              {doneCount > 0 && (
                <>
                  <span style={{ color: '#d1d5db' }}>&middot;</span>
                  <span>{t('projects.ticketsDone', { count: doneCount })}</span>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Card, Button, Badge, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { Search, Robot } from 'react-bootstrap-icons';
import type { AgentSummary } from '../../types/agents';
import { getConnectionConfig } from '../../config/integrationsConfig';
import { useKnowledgeBase } from '../../Providers/KnowledgeBaseProvider';
import AgentAvatar from './AgentAvatar';
import { downloadAgentExport, serializeAgentSummaryToExport } from '../../utils/agentExport';

type AgentCardProps = {
  agent: AgentSummary;
  onChat?: (agent: AgentSummary) => void;
  onEdit?: (agent: AgentSummary) => void;
  onDuplicate?: (agent: AgentSummary) => void;
  onDelete?: (agent: AgentSummary) => void;
  onToggleFavorite?: (agent: AgentSummary, next: boolean) => void;
  highlight?: boolean;
  disabled?: boolean;
  isInMyAgentsSection?: boolean;
};

const DESCRIPTION_CLAMP_STYLE: CSSProperties = {
  maxHeight: '4.2rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
};

const formatTimestamp = (timestamp: number): string => {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  } catch {
    return '';
  }
};

const renderIntegrations = (agent: AgentSummary) => {
  if (!agent.requiredIntegrations?.length) return null;
  return (
    <div className="d-flex align-items-center flex-wrap gap-2">
      {agent.requiredIntegrations.map((integration) => {
        const config = getConnectionConfig(integration);
        if (config?.img_src) {
          return (
            <OverlayTrigger
              key={integration}
              placement="top"
              overlay={<Tooltip id={`integration-${integration}`}>{config.name}</Tooltip>}
            >
              <img src={config.img_src} alt={config.name} style={{ width: 20, height: 20, borderRadius: '4px' }} />
            </OverlayTrigger>
          );
        }
        return (
          <Badge
            bg="secondary"
            key={integration}
            className="text-uppercase"
            style={{ letterSpacing: '0.08em', fontSize: '0.65rem' }}
          >
            {integration}
          </Badge>
        );
      })}
    </div>
  );
};

export const AgentCard = ({
  agent,
  onChat,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleFavorite,
  highlight = false,
  disabled = false,
  isInMyAgentsSection = false,
}: AgentCardProps) => {
  // Determine if this agent should be collapsed by default
  // Collapse if explicitly in "My Agents" section
  const [isExpanded, setIsExpanded] = useState(!isInMyAgentsSection);

  // Get available KBs for name lookup
  const { availableKBs } = useKnowledgeBase();

  // Helper to get KB display name
  const getKBDisplayName = (kbId: string): string => {
    if (kbId === 'company') return 'Company KB';
    const kb = availableKBs.find((k) => k.kb_id === kbId);
    return kb?.kb_name || kbId;
  };

  const autoMode = agent.toolsConfig?.autoToolsEnabled;
  const hasWeb = autoMode || agent.toolsConfig?.webSearchEnabled;
  // In auto mode, the agent creation tool is also available
  const hasAgentCreation = autoMode || agent.toolsConfig?.createAgentEnabled;
  const canFavorite = Boolean(onToggleFavorite);

  // Compute allowed KBs for display
  const getAllowedKBs = (): string[] | 'all' | 'none' => {
    const config = agent.toolsConfig;
    const allowed = config?.allowedKnowledgeBases;

    if (allowed === null || allowed === undefined) {
      // Backwards compat: check queryDataSources
      if (config?.queryDataSources === false) return 'none';
      return 'all';
    }
    if (allowed.length === 0) return 'none';
    return allowed;
  };

  const allowedKBs = getAllowedKBs();
  const hasKB = allowedKBs !== 'none';

  const formatTimeSaved = (mins?: number) => {
    if (!mins || mins <= 0) return null;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const parts = [] as string[];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    return parts.join(' ');
  };
  const timeSavedLabel = formatTimeSaved(agent.estimatedTimeSavedMinutes);

  const handleToggle = (e?: React.MouseEvent) => {
    if (isInMyAgentsSection && !disabled) {
      e?.stopPropagation();
      setIsExpanded(!isExpanded);
    }
  };

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite?.(agent, !agent.isFavorite);
  };

  const handleExportClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const exp = serializeAgentSummaryToExport(agent);
      downloadAgentExport(exp, agent.title);
    } catch (err) {
      console.error('Failed to export agent', err);
    }
  };

  // Collapsed view for agents in "My Agents" section
  if (isInMyAgentsSection && !isExpanded) {
    const hasMetadata =
      agent.requiredIntegrations?.length > 0 || agent.referenceFiles?.length > 0 || hasKB || hasWeb || hasAgentCreation;

    return (
      <Card
        className={`shadow-sm agent-card ${highlight ? 'border-primary border-2' : ''}`}
        style={{
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.65 : 1,
          transition: 'all 0.2s ease',
          borderRadius: '12px',
        }}
        onClick={handleToggle}
      >
        <Card.Body className="p-3">
          <div className="d-flex align-items-center gap-3">
            <AgentAvatar agent={agent} size={40} alt={`${agent.title} avatar`} />
            <div className="flex-grow-1" style={{ minWidth: 0, overflow: 'hidden' }}>
              {/* Title */}
              <h6 className="mb-1 fw-semibold text-truncate" style={{ fontSize: '1rem' }}>
                {agent.title}
              </h6>

              {/* First Row: Badge and Time Saved */}
              <div className="d-flex align-items-center gap-2 mb-1" style={{ flexWrap: 'nowrap' }}>
                {agent.visibility === 'public' ? (
                  <span className="text-muted small" style={{ fontSize: '0.7rem', flexShrink: 0 }}>
                    <i className="bi bi-shop me-1"></i>
                    Company
                  </span>
                ) : (
                  <span className="text-muted small" style={{ fontSize: '0.7rem', flexShrink: 0 }}>
                    <i className="bi bi-person-fill me-1"></i>
                    Personal
                  </span>
                )}

                {timeSavedLabel && (
                  <span className="text-muted small" style={{ fontSize: '0.75rem', flexShrink: 0 }}>
                    {timeSavedLabel} saved
                  </span>
                )}
              </div>

              {/* Second Row: Integrations, Files, Tools Icons */}
              {hasMetadata && (
                <div className="d-flex align-items-center gap-2" style={{ flexWrap: 'nowrap', overflow: 'hidden' }}>
                  {/* Integrations Icons */}
                  {agent.requiredIntegrations?.length > 0 && (
                    <div className="d-flex align-items-center gap-1" style={{ flexShrink: 0 }}>
                      {agent.requiredIntegrations.slice(0, 3).map((integration) => {
                        const config = getConnectionConfig(integration);
                        if (config?.img_src) {
                          return (
                            <img
                              key={integration}
                              src={config.img_src}
                              alt={config.name}
                              style={{ width: 16, height: 16, borderRadius: '3px' }}
                            />
                          );
                        }
                        return null;
                      })}
                      {agent.requiredIntegrations.length > 3 && (
                        <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                          +{agent.requiredIntegrations.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Files Icon */}
                  {agent.referenceFiles?.length > 0 && (
                    <div className="d-flex align-items-center gap-1" style={{ flexShrink: 0 }}>
                      <i
                        className="bi bi-file-earmark-text"
                        style={{ fontSize: '13px', color: 'var(--brand-primary, var(--color-primary))', lineHeight: 1 }}
                      ></i>
                      <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                        {agent.referenceFiles.length}
                      </span>
                    </div>
                  )}

                  {/* KB Icons */}
                  {hasKB && (
                    <div className="d-flex align-items-center gap-1" style={{ flexShrink: 0 }}>
                      {allowedKBs === 'all' ? (
                        <OverlayTrigger
                          placement="top"
                          overlay={<Tooltip id="kb-all-collapsed">All Knowledge Bases</Tooltip>}
                        >
                          <i
                            className="bi bi-folder-fill"
                            style={{ fontSize: '14px', color: 'var(--brand-primary, var(--color-primary))' }}
                          />
                        </OverlayTrigger>
                      ) : (
                        <>
                          {(allowedKBs as string[]).slice(0, 3).map((kbId) => (
                            <OverlayTrigger
                              key={kbId}
                              placement="top"
                              overlay={<Tooltip id={`kb-${kbId}-collapsed`}>{getKBDisplayName(kbId)}</Tooltip>}
                            >
                              <i
                                className={kbId === 'company' ? 'bi bi-folder-fill' : 'bi bi-folder'}
                                style={{ fontSize: '14px', color: 'var(--brand-primary, var(--color-primary))' }}
                              />
                            </OverlayTrigger>
                          ))}
                          {(allowedKBs as string[]).length > 3 && (
                            <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                              +{(allowedKBs as string[]).length - 3}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Tools Icons */}
                  {(hasWeb || hasAgentCreation) && (
                    <div className="d-flex align-items-center gap-1" style={{ flexShrink: 0 }}>
                      {hasAgentCreation && (
                        <Robot size={14} style={{ color: 'var(--brand-primary, var(--color-primary))' }} />
                      )}
                      {hasWeb && <Search size={14} style={{ color: 'var(--brand-primary, var(--color-primary))' }} />}
                    </div>
                  )}
                </div>
              )}
            </div>
            {canFavorite && (
              <Button
                variant="link"
                className="p-0 ms-2"
                style={{ flexShrink: 0 }}
                onClick={handleFavoriteClick}
                disabled={disabled}
                aria-label={agent.isFavorite ? 'Unfavorite agent' : 'Favorite agent'}
              >
                <i
                  className={agent.isFavorite ? 'bi bi-star-fill' : 'bi bi-star'}
                  style={{ color: agent.isFavorite ? '#f0ad4e' : '#6c757d', fontSize: '1.1rem' }}
                ></i>
              </Button>
            )}
            <i className="bi bi-chevron-down" style={{ fontSize: '1.2rem', color: '#6c757d', flexShrink: 0 }}></i>
          </div>
        </Card.Body>
      </Card>
    );
  }

  // Expanded view (default for public agents, toggleable for personal)
  return (
    <Card
      className={`h-100 shadow-sm agent-card ${highlight ? 'border-primary border-2' : ''}`}
      style={{
        cursor: disabled ? 'not-allowed' : 'default',
        opacity: disabled ? 0.65 : 1,
        transition: 'all 0.2s ease',
        borderRadius: '12px',
      }}
    >
      <Card.Body className="d-flex flex-column p-4">
        {/* Header: Icon, Title, Badge, Favorite, Collapse Toggle */}
        <div className="d-flex justify-content-between align-items-start mb-3">
          <div className="d-flex align-items-start gap-3 flex-grow-1">
            <AgentAvatar agent={agent} size={48} alt={`${agent.title} avatar`} />
            <div className="flex-grow-1" style={{ minWidth: 0 }}>
              <h5 className="mb-1 fw-semibold" style={{ fontSize: '1.1rem' }}>
                {agent.title}
              </h5>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                {agent.visibility === 'public' ? (
                  <span className="text-muted small" style={{ fontSize: '0.75rem' }}>
                    <i className="bi bi-shop me-1"></i>
                    Company
                  </span>
                ) : (
                  <span className="text-muted small" style={{ fontSize: '0.75rem' }}>
                    <i className="bi bi-person-fill me-1"></i>
                    Personal
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2">
            {canFavorite && (
              <OverlayTrigger
                placement="top"
                overlay={<Tooltip id={`fav-${agent.agentId}`}>{agent.isFavorite ? 'Unfavorite' : 'Favorite'}</Tooltip>}
              >
                <Button
                  variant="link"
                  className="p-0"
                  onClick={handleFavoriteClick}
                  disabled={disabled}
                  aria-label={agent.isFavorite ? 'Unfavorite agent' : 'Favorite agent'}
                >
                  <i
                    className={agent.isFavorite ? 'bi bi-star-fill' : 'bi bi-star'}
                    style={{ color: agent.isFavorite ? '#f0ad4e' : '#6c757d', fontSize: '1.25rem' }}
                  ></i>
                </Button>
              </OverlayTrigger>
            )}
            {isInMyAgentsSection && (
              <OverlayTrigger placement="top" overlay={<Tooltip id={`collapse-${agent.agentId}`}>Collapse</Tooltip>}>
                <Button
                  variant="link"
                  className="p-0"
                  onClick={handleToggle}
                  disabled={disabled}
                  aria-label="Collapse agent card"
                >
                  <i className="bi bi-chevron-up" style={{ fontSize: '1.25rem', color: '#6c757d' }}></i>
                </Button>
              </OverlayTrigger>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="flex-grow-1 mb-3">
          <p className="text-muted mb-0" style={{ ...DESCRIPTION_CLAMP_STYLE, fontSize: '0.9rem', lineHeight: '1.4' }}>
            {agent.description || 'No description provided.'}
          </p>
        </div>

        {/* Metadata section */}
        <div className="border-top pt-3 mb-3">
          <div className="d-flex flex-column gap-2">
            {/* Tools - only web search and agent creation */}
            {(hasWeb || hasAgentCreation) && (
              <div className="d-flex align-items-start gap-2">
                <span
                  className="text-muted small fw-semibold"
                  style={{ fontSize: '0.75rem', minWidth: 90, flexShrink: 0 }}
                >
                  TOOLS
                </span>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  {hasWeb && (
                    <OverlayTrigger
                      placement="top"
                      overlay={<Tooltip id={`agent-${agent.agentId}-web`}>Web Search</Tooltip>}
                    >
                      <div>
                        <Search size={18} style={{ color: 'var(--brand-primary, var(--color-primary))' }} />
                      </div>
                    </OverlayTrigger>
                  )}
                  {hasAgentCreation && (
                    <OverlayTrigger
                      placement="top"
                      overlay={<Tooltip id={`agent-${agent.agentId}-create`}>Agent Creation</Tooltip>}
                    >
                      <div>
                        <Robot size={18} style={{ color: 'var(--brand-primary, var(--color-primary))' }} />
                      </div>
                    </OverlayTrigger>
                  )}
                </div>
              </div>
            )}
            {/* Knowledge Bases - separate row */}
            {hasKB && (
              <div className="d-flex align-items-start gap-2">
                <span
                  className="text-muted small fw-semibold"
                  style={{ fontSize: '0.75rem', minWidth: 90, flexShrink: 0 }}
                >
                  KNOWLEDGE BASES
                </span>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  {allowedKBs === 'all' ? (
                    <OverlayTrigger
                      placement="top"
                      overlay={<Tooltip id={`agent-${agent.agentId}-kb-all`}>All Knowledge Bases</Tooltip>}
                    >
                      <i
                        className="bi bi-folder-fill"
                        style={{ fontSize: '18px', color: 'var(--brand-primary, var(--color-primary))' }}
                      />
                    </OverlayTrigger>
                  ) : (
                    (allowedKBs as string[]).map((kbId) => (
                      <OverlayTrigger
                        key={kbId}
                        placement="top"
                        overlay={<Tooltip id={`agent-${agent.agentId}-kb-${kbId}`}>{getKBDisplayName(kbId)}</Tooltip>}
                      >
                        <i
                          className={kbId === 'company' ? 'bi bi-folder-fill' : 'bi bi-folder'}
                          style={{ fontSize: '18px', color: 'var(--brand-primary, var(--color-primary))' }}
                        />
                      </OverlayTrigger>
                    ))
                  )}
                </div>
              </div>
            )}
            {/* Integrations */}
            {agent.requiredIntegrations?.length > 0 && (
              <div className="d-flex align-items-start gap-2">
                <span
                  className="text-muted small fw-semibold"
                  style={{ fontSize: '0.75rem', minWidth: 90, flexShrink: 0 }}
                >
                  INTEGRATIONS
                </span>
                <div className="d-flex align-items-center flex-wrap gap-2 flex-grow-1">{renderIntegrations(agent)}</div>
              </div>
            )}
            {/* Time Saved */}
            {timeSavedLabel && (
              <div className="d-flex align-items-start gap-2">
                <span
                  className="text-muted small fw-semibold"
                  style={{ fontSize: '0.75rem', minWidth: 90, flexShrink: 0 }}
                >
                  TIME SAVED
                </span>
                <span className="text-muted small">{timeSavedLabel}</span>
              </div>
            )}
            {/* Files */}
            {agent.referenceFiles?.length > 0 && (
              <div className="d-flex align-items-start gap-2">
                <span
                  className="text-muted small fw-semibold"
                  style={{ fontSize: '0.75rem', minWidth: 90, flexShrink: 0 }}
                >
                  FILES
                </span>
                <div className="d-flex align-items-center gap-1 flex-grow-1">
                  <OverlayTrigger
                    placement="top"
                    overlay={
                      <Tooltip id={`files-${agent.agentId}`}>
                        {agent.referenceFiles.map((f) => f.fileName).join(', ')}
                      </Tooltip>
                    }
                  >
                    <div className="d-flex align-items-center gap-1">
                      <i
                        className="bi bi-file-earmark-text"
                        style={{ fontSize: '16px', color: 'var(--brand-primary, var(--color-primary))' }}
                      ></i>
                      <span className="text-muted small">{agent.referenceFiles.length}</span>
                    </div>
                  </OverlayTrigger>
                </div>
              </div>
            )}
            {/* Creator (public agents only) */}
            {agent.visibility === 'public' && (
              <div className="d-flex align-items-start gap-2">
                <span
                  className="text-muted small fw-semibold"
                  style={{ fontSize: '0.75rem', minWidth: 90, flexShrink: 0 }}
                >
                  CREATED BY
                </span>
                <span className="text-muted small">{agent.createdBy?.name || 'Unknown'}</span>
              </div>
            )}
            {/* Last updated */}
            <div className="d-flex align-items-start gap-2">
              <span
                className="text-muted small fw-semibold"
                style={{ fontSize: '0.75rem', minWidth: 90, flexShrink: 0 }}
              >
                UPDATED
              </span>
              <span className="text-muted small">{formatTimestamp(agent.updatedAt)}</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="d-flex gap-2 flex-wrap">
          {onChat && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onChat(agent)}
              disabled={disabled}
              className="flex-grow-1"
              style={{ minWidth: 80 }}
            >
              <i className="bi bi-chat-dots me-1"></i> Chat
            </Button>
          )}
          <div className="d-flex gap-1">
            {onEdit && (
              <OverlayTrigger placement="top" overlay={<Tooltip id={`edit-${agent.agentId}`}>Edit</Tooltip>}>
                <Button variant="secondary" size="sm" onClick={() => onEdit(agent)} disabled={disabled}>
                  <i className="bi bi-pencil-square"></i>
                </Button>
              </OverlayTrigger>
            )}
            {onDuplicate && (
              <OverlayTrigger placement="top" overlay={<Tooltip id={`copy-${agent.agentId}`}>Duplicate</Tooltip>}>
                <Button variant="secondary" size="sm" onClick={() => onDuplicate(agent)} disabled={disabled}>
                  <i className="bi bi-files"></i>
                </Button>
              </OverlayTrigger>
            )}
            {/* Export JSON just to the left of Delete */}
            <OverlayTrigger placement="top" overlay={<Tooltip id={`export-${agent.agentId}`}>Export JSON</Tooltip>}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportClick}
                disabled={disabled}
                aria-label="Export agent as JSON"
              >
                <i className="bi bi-download"></i>
              </Button>
            </OverlayTrigger>
            {onDelete && (
              <OverlayTrigger placement="top" overlay={<Tooltip id={`delete-${agent.agentId}`}>Delete</Tooltip>}>
                <Button variant="outline-danger" size="sm" onClick={() => onDelete(agent)} disabled={disabled}>
                  <i className="bi bi-trash"></i>
                </Button>
              </OverlayTrigger>
            )}
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};

export default AgentCard;

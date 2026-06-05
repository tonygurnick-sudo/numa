import { useMemo, useState } from 'react';
import { Button, Dropdown, Form, Spinner, Tab } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { Memory } from '../../Services/ChatSettingsService';
import type { AgentSummary } from '../../types/agents';
import {
  getConnectionConfig,
  getConnectionDisplayName,
  getConnectionFallbackIcon,
  getConnectionIcon,
} from '../../config/integrationsConfig';
import { StyledTabs } from '../StyledTabs';
import { CharCount } from '../CharCount';
import { AgentAvatar } from '../Agents/AgentAvatar';

const LIMIT_MEMORY = 300;
const MAX_MEMORIES = 50;

type Connection = { id: string; isConnected: boolean; mcpServerUrl?: string };

type ScopeKind = 'general' | 'integration' | 'agent';

interface MemoriesPanelProps {
  memories: Memory[];
  /** Replace the full memories array (parent owns the userProfile state + dirty flag). */
  onChange: (next: Memory[]) => void;
  /** Pipedream + native integrations the user can scope a memory to. */
  availableConnections: Connection[];
  /** Agents used to resolve agent-scoped memory names + populate the agent picker. */
  agents: AgentSummary[];
  agentsLoading: boolean;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
}

const scopeKindOf = (scope: string): ScopeKind => {
  if (scope.startsWith('integration:')) return 'integration';
  if (scope.startsWith('agent:')) return 'agent';
  return 'general';
};

// Integration icon that degrades gracefully. `getConnectionIcon` defaults to the
// Gmail icon for any slug it doesn't know (e.g. `numa-ops`), which is wrong — so
// for unknown integrations we render a neutral Bootstrap icon instead.
const renderIntegrationIcon = (slug: string, imgClass: string, iconClass: string) =>
  getConnectionConfig(slug) ? (
    <img
      src={getConnectionIcon(slug)}
      alt=""
      className={imgClass}
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  ) : (
    <i className={`${getConnectionFallbackIcon(slug)} ${iconClass}`} />
  );

export function MemoriesPanel({
  memories,
  onChange,
  availableConnections,
  agents,
  agentsLoading,
  saving,
  dirty,
  onSave,
}: MemoriesPanelProps) {
  const { t } = useTranslation('settings');

  const [activeScope, setActiveScope] = useState<ScopeKind>('general');

  // Inline edit (content only — scope is fixed by the tab the memory lives in)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  // Add form — one open at a time, pre-scoped to the active sub-tab
  const [addingFor, setAddingFor] = useState<ScopeKind | null>(null);
  const [newContent, setNewContent] = useState('');
  const [newIntegration, setNewIntegration] = useState<string>('');
  const [newAgentId, setNewAgentId] = useState<string>('');

  // agentId -> agent, for name/icon resolution on agent-scoped badges + picker
  const agentById = useMemo(() => {
    const map = new Map<string, AgentSummary>();
    agents.forEach((a) => map.set(a.agentId, a));
    return map;
  }, [agents]);

  const grouped = useMemo(() => {
    const general: Memory[] = [];
    const integration: Memory[] = [];
    const agent: Memory[] = [];
    memories.forEach((m) => {
      const kind = scopeKindOf(m.scope);
      if (kind === 'integration') integration.push(m);
      else if (kind === 'agent') agent.push(m);
      else general.push(m);
    });
    return { general, integration, agent };
  }, [memories]);

  const sortedConnections = useMemo(
    () =>
      [...availableConnections].sort((a, b) =>
        getConnectionDisplayName(a.id).localeCompare(getConnectionDisplayName(b.id))
      ),
    [availableConnections]
  );

  const sortedAgents = useMemo(() => [...agents].sort((a, b) => a.title.localeCompare(b.title)), [agents]);

  const atLimit = memories.length >= MAX_MEMORIES;

  // ── mutations ───────────────────────────────────────────────────────────────
  const saveEdit = (id: string) => {
    const content = editingContent.trim();
    if (!content) return;
    onChange(memories.map((m) => (m.id === id ? { ...m, content } : m)));
    setEditingId(null);
    setEditingContent('');
  };

  const deleteMemory = (id: string) => {
    onChange(memories.filter((m) => m.id !== id));
  };

  const openAdd = (kind: ScopeKind) => {
    setAddingFor(kind);
    setNewContent('');
    setNewIntegration(kind === 'integration' ? (sortedConnections[0]?.id ?? '') : '');
    setNewAgentId(kind === 'agent' ? (sortedAgents[0]?.agentId ?? '') : '');
  };

  const cancelAdd = () => {
    setAddingFor(null);
    setNewContent('');
    setNewIntegration('');
    setNewAgentId('');
  };

  const commitAdd = (kind: ScopeKind) => {
    const content = newContent.trim();
    if (!content) return;
    let scope = 'general';
    if (kind === 'integration') {
      if (!newIntegration) return;
      scope = `integration:${newIntegration}`;
    } else if (kind === 'agent') {
      if (!newAgentId) return;
      scope = `agent:${newAgentId}`;
    }
    const memory: Memory = {
      id: crypto.randomUUID(),
      content,
      scope,
      createdAt: new Date().toISOString(),
      source: 'user',
    };
    onChange([...memories, memory]);
    cancelAdd();
  };

  // ── badge for a memory's scope ────────────────────────────────────────────────
  const renderScopeBadge = (scope: string) => {
    const kind = scopeKindOf(scope);
    if (kind === 'integration') {
      const slug = scope.replace('integration:', '');
      return (
        <span className="profile-memory-badge">
          {renderIntegrationIcon(slug, 'memory-scope-badge__img', 'memory-scope-badge__icon')}
          {getConnectionDisplayName(slug)}
        </span>
      );
    }
    if (kind === 'agent') {
      const agentId = scope.replace('agent:', '');
      const agent = agentById.get(agentId);
      const label = agent?.title ?? t('userProfile.profile.fields.memories.unknownAgent');
      return (
        <span className="profile-memory-badge">
          {agent ? (
            <AgentAvatar agent={agent} size={16} className="memory-scope-badge__avatar" />
          ) : (
            <i className="bi bi-robot memory-scope-badge__icon" />
          )}
          {label}
        </span>
      );
    }
    return (
      <span className="profile-memory-badge">
        <i className="bi bi-globe2 memory-scope-badge__icon" />
        {t('userProfile.profile.fields.memories.scope.general')}
      </span>
    );
  };

  // ── a single memory row (display + inline edit) ───────────────────────────────
  const renderMemory = (memory: Memory) => (
    <div key={memory.id} className="profile-memory-item">
      {editingId === memory.id ? (
        <div
          className="profile-memory-form"
          style={{ border: 'none', background: 'transparent', padding: 0, margin: 0 }}
        >
          <Form.Control
            as="textarea"
            rows={2}
            maxLength={LIMIT_MEMORY}
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            className="mb-2"
            placeholder={t('userProfile.profile.fields.memories.content.placeholder')}
          />
          <CharCount value={editingContent} max={LIMIT_MEMORY} />
          <div className="profile-memory-form__controls">
            <Button variant="primary" size="sm" onClick={() => saveEdit(memory.id)}>
              {t('userProfile.profile.fields.memories.saveMemory')}
            </Button>
            <Button variant="outline-secondary" size="sm" onClick={() => setEditingId(null)}>
              {t('userProfile.profile.fields.memories.cancelMemory')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="d-flex justify-content-between align-items-start">
          <div className="flex-grow-1">
            <div className="profile-memory-item__content">{memory.content}</div>
            <div className="profile-memory-item__meta">
              {renderScopeBadge(memory.scope)}
              <span className="profile-memory-source">
                {memory.source === 'ai'
                  ? t('userProfile.profile.fields.memories.source.ai')
                  : t('userProfile.profile.fields.memories.source.user')}
              </span>
            </div>
          </div>
          <div className="profile-memory-item__actions">
            <Button
              className="profile-memory-action-btn"
              variant="outline-secondary"
              size="sm"
              disabled={saving}
              onClick={() => {
                setEditingId(memory.id);
                setEditingContent(memory.content);
              }}
            >
              {t('userProfile.profile.fields.memories.editMemory')}
            </Button>
            <Button
              className="profile-memory-action-btn"
              variant="outline-danger"
              size="sm"
              disabled={saving}
              onClick={() => deleteMemory(memory.id)}
            >
              {t('userProfile.profile.fields.memories.deleteMemory')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  // ── add form for the active sub-tab ───────────────────────────────────────────
  const renderAddForm = (kind: ScopeKind) => (
    <div className="profile-memory-form">
      <Form.Control
        as="textarea"
        rows={2}
        maxLength={LIMIT_MEMORY}
        value={newContent}
        onChange={(e) => setNewContent(e.target.value)}
        className="mb-2"
        placeholder={t('userProfile.profile.fields.memories.content.placeholder')}
      />
      <CharCount value={newContent} max={LIMIT_MEMORY} />
      <div className="profile-memory-form__controls">
        {kind === 'integration' && (
          <Dropdown className="memory-scope-dropdown">
            <Dropdown.Toggle variant="outline-secondary" size="sm" className="memory-scope-dropdown__toggle">
              {newIntegration ? (
                <>
                  {renderIntegrationIcon(
                    newIntegration,
                    'memory-scope-dropdown__icon',
                    'memory-scope-dropdown__general-icon'
                  )}
                  {getConnectionDisplayName(newIntegration)}
                </>
              ) : (
                t('userProfile.profile.fields.memories.integrationPicker.placeholder')
              )}
            </Dropdown.Toggle>
            <Dropdown.Menu className="memory-scope-dropdown__menu">
              {sortedConnections.map((conn) => (
                <Dropdown.Item
                  key={conn.id}
                  active={newIntegration === conn.id}
                  onClick={() => setNewIntegration(conn.id)}
                  className="memory-scope-dropdown__item"
                >
                  {renderIntegrationIcon(conn.id, 'memory-scope-dropdown__icon', 'memory-scope-dropdown__general-icon')}
                  <span className="memory-scope-dropdown__item-name">{getConnectionDisplayName(conn.id)}</span>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
        )}
        {kind === 'agent' && (
          <Dropdown className="memory-scope-dropdown">
            <Dropdown.Toggle variant="outline-secondary" size="sm" className="memory-scope-dropdown__toggle">
              {newAgentId ? (
                <>
                  <AgentAvatar agent={agentById.get(newAgentId)} size={16} className="memory-scope-dropdown__avatar" />
                  {agentById.get(newAgentId)?.title ?? newAgentId}
                </>
              ) : (
                t('userProfile.profile.fields.memories.agentPicker.placeholder')
              )}
            </Dropdown.Toggle>
            <Dropdown.Menu className="memory-scope-dropdown__menu">
              {sortedAgents.map((agent) => (
                <Dropdown.Item
                  key={agent.agentId}
                  active={newAgentId === agent.agentId}
                  onClick={() => setNewAgentId(agent.agentId)}
                  className="memory-scope-dropdown__item"
                >
                  <AgentAvatar agent={agent} size={16} className="memory-scope-dropdown__avatar" />
                  <span className="memory-scope-dropdown__item-name">{agent.title}</span>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
        )}
        <Button variant="primary" size="sm" onClick={() => commitAdd(kind)}>
          {t('userProfile.profile.fields.memories.saveMemory')}
        </Button>
        <Button variant="outline-secondary" size="sm" onClick={cancelAdd}>
          {t('userProfile.profile.fields.memories.cancelMemory')}
        </Button>
      </div>
    </div>
  );

  // ── one sub-tab's body ────────────────────────────────────────────────────────
  const renderTabBody = (kind: ScopeKind, items: Memory[], emptyText: string, blurb: string) => {
    const addDisabled =
      saving ||
      atLimit ||
      (kind === 'integration' && sortedConnections.length === 0) ||
      (kind === 'agent' && (agentsLoading || sortedAgents.length === 0));
    return (
      <>
        <p className="profile-section__description">{blurb}</p>
        {/* Add control lives at the top so you never have to scroll past the list to add a memory. */}
        {addingFor === kind ? (
          renderAddForm(kind)
        ) : (
          <Button className="profile-add-memory-btn mb-3" disabled={addDisabled} onClick={() => openAdd(kind)}>
            <i className="bi bi-plus-lg"></i>
            {atLimit
              ? t('userProfile.profile.fields.memories.limitReached')
              : t('userProfile.profile.fields.memories.addMemory')}
          </Button>
        )}
        {kind === 'integration' && sortedConnections.length === 0 && (
          <div className="profile-memory-hint mb-2">
            {t('userProfile.profile.fields.memories.integrationPicker.empty')}
          </div>
        )}
        {kind === 'agent' && !agentsLoading && sortedAgents.length === 0 && (
          <div className="profile-memory-hint mb-2">{t('userProfile.profile.fields.memories.agentPicker.empty')}</div>
        )}
        {items.length === 0 && addingFor !== kind && <div className="profile-empty-state">{emptyText}</div>}
        {items.map(renderMemory)}
      </>
    );
  };

  return (
    <div className="profile-section">
      <p className="profile-page-intro">{t('userProfile.profile.fields.memories.description')}</p>

      <StyledTabs
        activeKey={activeScope}
        onSelect={(k) => {
          if (k) {
            setActiveScope(k as ScopeKind);
            setAddingFor(null);
            setEditingId(null);
          }
        }}
        className="mb-3"
      >
        <Tab
          eventKey="general"
          title={
            <span>
              <i className="bi bi-globe2 me-2" />
              {t('userProfile.profile.fields.memories.tabs.general')}
            </span>
          }
        >
          {renderTabBody(
            'general',
            grouped.general,
            t('userProfile.profile.fields.memories.emptyByScope.general'),
            t('userProfile.profile.fields.memories.categories.general')
          )}
        </Tab>
        <Tab
          eventKey="integration"
          title={
            <span>
              <i className="bi bi-plug me-2" />
              {t('userProfile.profile.fields.memories.tabs.integrations')}
            </span>
          }
        >
          {renderTabBody(
            'integration',
            grouped.integration,
            t('userProfile.profile.fields.memories.emptyByScope.integrations'),
            t('userProfile.profile.fields.memories.categories.integrations')
          )}
        </Tab>
        <Tab
          eventKey="agent"
          title={
            <span>
              <i className="bi bi-robot me-2" />
              {t('userProfile.profile.fields.memories.tabs.agents')}
            </span>
          }
        >
          {renderTabBody(
            'agent',
            grouped.agent,
            t('userProfile.profile.fields.memories.emptyByScope.agents'),
            t('userProfile.profile.fields.memories.categories.agents')
          )}
        </Tab>
      </StyledTabs>

      <div className="profile-actions">
        <Button variant="primary" disabled={!dirty || saving} onClick={onSave}>
          {saving ? (
            <>
              <Spinner as="span" animation="border" size="sm" className="me-2" />
              {t('userProfile.profile.actions.saving')}
            </>
          ) : (
            t('userProfile.profile.actions.save')
          )}
        </Button>
      </div>
    </div>
  );
}

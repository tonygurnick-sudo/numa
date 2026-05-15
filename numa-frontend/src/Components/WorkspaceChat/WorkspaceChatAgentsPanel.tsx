import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Form, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Search, Star, Users } from 'lucide-react';
import AgentAvatar from '../Agents/AgentAvatar';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { getAgentPrefs, setAgentPref, listTeams, listTeamAgents } from '../../Services/AgentsService';
import type { AgentSummary, AgentUserPref, Team } from '../../types/agents';

export interface WorkspaceChatAgentsPanelProps {
  isOpen: boolean;
  agents: AgentSummary[];
  agentsLoading: boolean;
  onSelectAgent: (agent: AgentSummary) => void;
}

const LS_COLLAPSED = 'workspaceChatAgentsPanel.collapsedSections';

type Section = {
  key: string;
  label: string;
  agents: AgentSummary[];
  icon?: 'star' | 'team';
};

export const WorkspaceChatAgentsPanel: React.FC<WorkspaceChatAgentsPanelProps> = ({
  isOpen,
  agents,
  agentsLoading,
  onSelectAgent,
}) => {
  const { t } = useTranslation('chat');
  const { numaGet, numaPut } = useNumaRequest();

  const [prefs, setPrefs] = useState<AgentUserPref[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamAgents, setTeamAgents] = useState<Map<string, AgentSummary[]>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_COLLAPSED) || '{}');
    } catch {
      return {};
    }
  });

  // Load prefs + teams when the panel opens. The agents list itself is owned
  // by the parent (so the cached + deduplicated list it already maintains
  // stays the source of truth).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const [prefsData, teamsData] = await Promise.all([
        getAgentPrefs(numaGet).catch(() => [] as AgentUserPref[]),
        listTeams(numaGet).catch(() => [] as Team[]),
      ]);
      if (cancelled) return;
      setPrefs(prefsData);
      setTeams(teamsData);
      if (teamsData.length > 0) {
        const results = await Promise.all(
          teamsData.map((team) => listTeamAgents(numaGet, team.teamId).catch(() => [] as AgentSummary[]))
        );
        if (cancelled) return;
        const map = new Map<string, AgentSummary[]>();
        teamsData.forEach((team, i) => map.set(team.teamId, results[i]));
        setTeamAgents(map);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, numaGet]);

  useEffect(() => {
    localStorage.setItem(LS_COLLAPSED, JSON.stringify(collapsed));
  }, [collapsed]);

  const prefsMap = useMemo(() => {
    const map = new Map<string, AgentUserPref>();
    prefs.forEach((p) => map.set(p.agentId, p));
    return map;
  }, [prefs]);

  const isAgentFavorite = useCallback(
    (agent: AgentSummary) => prefsMap.get(agent.agentId)?.isFavorite ?? agent.isFavorite ?? false,
    [prefsMap]
  );

  const isAgentHidden = useCallback(
    (agent: AgentSummary) => prefsMap.get(agent.agentId)?.isHidden ?? false,
    [prefsMap]
  );

  const matchesSearch = useCallback(
    (agent: AgentSummary) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        !!agent.title?.toLowerCase().includes(q) ||
        !!agent.description?.toLowerCase().includes(q) ||
        !!agent.tags?.some((tag) => tag.toLowerCase().includes(q)) ||
        !!agent.requiredIntegrations?.some((i) => i.toLowerCase().includes(q))
      );
    },
    [searchQuery]
  );

  const handleToggleFavorite = useCallback(
    async (agent: AgentSummary, e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      const next = !isAgentFavorite(agent);
      // Optimistic
      setPrefs((prev) => {
        const existing = prev.find((p) => p.agentId === agent.agentId);
        if (existing) return prev.map((p) => (p.agentId === agent.agentId ? { ...p, isFavorite: next } : p));
        return [...prev, { agentId: agent.agentId, isFavorite: next, isHidden: false }];
      });
      try {
        await setAgentPref(numaPut, agent.agentId, { isFavorite: next });
      } catch (err) {
        console.error('WorkspaceChatAgentsPanel: toggle favorite failed', err);
        setPrefs((prev) => prev.map((p) => (p.agentId === agent.agentId ? { ...p, isFavorite: !next } : p)));
      }
    },
    [isAgentFavorite, numaPut]
  );

  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Set of agent IDs that are assigned to at least one team — excluded from
  // personal/company sections to avoid duplication.
  const teamAgentIds = useMemo(() => {
    const ids = new Set<string>();
    teamAgents.forEach((list) => list.forEach((a) => ids.add(a.agentId)));
    return ids;
  }, [teamAgents]);

  const sections = useMemo<Section[]>(() => {
    const applyFilters = (list: AgentSummary[]) => {
      let result = list.filter((a) => !isAgentHidden(a));
      if (searchQuery) result = result.filter(matchesSearch);
      return result;
    };

    const result: Section[] = [];

    // Favourites — cross-cutting, shown only if populated
    const favSet = new Map<string, AgentSummary>();
    for (const a of agents) {
      if (isAgentFavorite(a)) favSet.set(a.agentId, a);
    }
    const favourites = applyFilters(Array.from(favSet.values()));
    if (favourites.length > 0) {
      result.push({
        key: 'favourites',
        label: t('agentsPanel.sections.favourites'),
        agents: favourites,
        icon: 'star',
      });
    }

    const personalAgents = agents.filter((a) => a.scope === 'user' && !teamAgentIds.has(a.agentId));
    const personal = applyFilters(personalAgents);
    if (personal.length > 0) {
      result.push({ key: 'personal', label: t('agentsPanel.sections.personal'), agents: personal });
    }

    for (const team of teams) {
      const members = teamAgents.get(team.teamId) ?? [];
      const filtered = applyFilters(members);
      if (filtered.length > 0) {
        result.push({
          key: `team-${team.teamId}`,
          label: team.teamName,
          agents: filtered,
          icon: 'team',
        });
      }
    }

    const personalIds = new Set(personalAgents.map((a) => a.agentId));
    const companyAgents = agents.filter(
      (a) => a.scope !== 'user' && !teamAgentIds.has(a.agentId) && !personalIds.has(a.agentId)
    );
    const company = applyFilters(companyAgents);
    if (company.length > 0) {
      result.push({ key: 'company', label: t('agentsPanel.sections.company'), agents: company });
    }

    return result;
  }, [agents, teams, teamAgents, teamAgentIds, isAgentFavorite, isAgentHidden, matchesSearch, searchQuery, t]);

  if (!isOpen) return null;

  const totalVisible = sections.reduce((acc, s) => acc + s.agents.length, 0);

  return (
    <div className="workspace-chat-agents-panel workspace-settings-modern-panel">
      <div className="workspace-chat-agents-panel-body workspace-settings-modern-body">
        <div className="workspace-agents-search">
          <Search size={14} className="workspace-agents-search-icon" />
          <Form.Control
            type="search"
            size="sm"
            placeholder={t('agentsPanel.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={t('agentsPanel.searchPlaceholder')}
          />
        </div>

        {agentsLoading && agents.length === 0 ? (
          <div className="text-muted small d-flex align-items-center gap-2 py-2">
            <Spinner animation="border" size="sm" />
            {t('agentsPanel.loading')}
          </div>
        ) : agents.length === 0 ? (
          <div className="text-muted small fst-italic py-2">{t('agentsPanel.empty')}</div>
        ) : totalVisible === 0 ? (
          <div className="text-muted small fst-italic py-2">{t('agentsPanel.noResults')}</div>
        ) : (
          <div className="workspace-agents-sections">
            {sections.map((section) => {
              const isCollapsed = !!collapsed[section.key] && !searchQuery;
              return (
                <div key={section.key} className="workspace-agents-section">
                  <button
                    type="button"
                    className="workspace-agents-section-header"
                    onClick={() => toggleSection(section.key)}
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    {section.icon === 'star' && <Star size={13} className="workspace-agents-section-icon" />}
                    {section.icon === 'team' && <Users size={13} className="workspace-agents-section-icon" />}
                    <span className="workspace-agents-section-label">{section.label}</span>
                    <span className="workspace-agents-section-count">{section.agents.length}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="workspace-agents-section-list">
                      {section.agents.map((agent) => {
                        const fav = isAgentFavorite(agent);
                        return (
                          <button
                            key={`${section.key}-${agent.agentId}`}
                            type="button"
                            className="workspace-agents-item"
                            onClick={() => onSelectAgent(agent)}
                          >
                            <AgentAvatar agent={agent} size={32} rounded alt={agent.title} />
                            <div className="workspace-agents-item-meta">
                              <div className="workspace-agents-item-title">{agent.title}</div>
                              {agent.agentType && <div className="workspace-agents-item-type">{agent.agentType}</div>}
                            </div>
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label={fav ? t('agentsPanel.unfavoriteAria') : t('agentsPanel.favoriteAria')}
                              aria-pressed={fav}
                              className={`workspace-agents-fav ${fav ? 'is-fav' : ''}`}
                              onClick={(e) => handleToggleFavorite(agent, e)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleToggleFavorite(agent, e);
                                }
                              }}
                            >
                              <Star size={14} fill={fav ? 'currentColor' : 'none'} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkspaceChatAgentsPanel;

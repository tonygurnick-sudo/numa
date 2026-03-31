import { useEffect, useState } from 'react';
import { Badge, Button, Form, Spinner, Table } from 'react-bootstrap';
import { ChevronDown, ChevronRight, Copy, Shield, Trash2, UserCog } from 'lucide-react';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { adminListAgents, deleteAgent, duplicateAgent } from '../../Services/AgentsService';
import type { AdminAgentEntry } from '../../types/agents';
import { useTranslation } from 'react-i18next';

type Props = {
  onAgentDeleted?: () => void;
};

const scopeStyle = (scope: string) => {
  switch (scope) {
    case 'user':
      return { backgroundColor: '#ede9fe', color: '#7c3aed' };
    case 'workspace':
      return { backgroundColor: '#fef3c7', color: '#d97706' };
    default:
      return { backgroundColor: '#f3f4f6', color: '#6b7280' };
  }
};

export const AgentAdminPanel = ({ onAgentDeleted }: Props) => {
  const { t } = useTranslation('agents');
  const { numaGet, numaDelete, numaPost } = useNumaRequest();
  const [expanded, setExpanded] = useState(false);
  const [agents, setAgents] = useState<AdminAgentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [scopeFilter, setScopeFilter] = useState<string>('all');

  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    adminListAgents(numaGet)
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, [expanded, numaGet]);

  const handleDelete = async (agentId: string, title: string) => {
    if (!window.confirm(t('adminPanel.confirmDelete', { title }))) return;
    try {
      await deleteAgent(numaDelete, agentId);
      setAgents((prev) => prev.filter((a) => a.agentId !== agentId));
      onAgentDeleted?.();
    } catch (err) {
      console.error('Admin delete failed', err);
    }
  };

  const handleDuplicate = async (agentId: string) => {
    try {
      await duplicateAgent(numaPost, agentId);
    } catch (err) {
      console.error('Admin duplicate failed', err);
    }
  };

  const filtered = agents.filter((a) => {
    if (scopeFilter !== 'all' && a.scope !== scopeFilter) return false;
    if (filterText) {
      const q = filterText.toLowerCase();
      return a.title.toLowerCase().includes(q) || (a.owner.name || '').toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="mb-4">
      <div
        className="d-flex align-items-center gap-3 p-3 rounded-3 text-white"
        role="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          background: 'linear-gradient(135deg, #1e1b4b, #312e81)',
          cursor: 'pointer',
        }}
      >
        <Shield size={18} />
        <div className="flex-grow-1">
          <div className="fw-bold" style={{ fontSize: '0.9rem' }}>
            {t('adminPanel.title')}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#a5b4fc' }}>{t('adminPanel.subtitle')}</div>
        </div>
        <span style={{ color: '#a5b4fc', fontSize: '0.8rem' }}>
          {expanded ? (
            <>
              <ChevronDown size={14} className="me-1" />
              {t('adminPanel.collapse')}
            </>
          ) : (
            <>
              <ChevronRight size={14} className="me-1" />
              {t('adminPanel.expand')}
            </>
          )}
        </span>
      </div>

      {expanded && (
        <div className="border rounded-3 mt-2 bg-white overflow-hidden shadow-sm">
          <div
            className="d-flex align-items-center gap-2 px-3 py-2 border-bottom"
            style={{ backgroundColor: '#f8fafc' }}
          >
            <Form.Control
              size="sm"
              placeholder={t('adminPanel.filterPlaceholder')}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={{ width: 220, fontSize: '0.8rem' }}
            />
            <Form.Select
              size="sm"
              style={{ width: 140, fontSize: '0.8rem' }}
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
            >
              <option value="all">{t('adminPanel.allScopes')}</option>
              <option value="user">{t('adminPanel.personal')}</option>
              <option value="workspace">{t('adminPanel.company')}</option>
            </Form.Select>
            <span className="ms-auto text-muted" style={{ fontSize: '0.78rem' }}>
              {filtered.length} {t('adminPanel.agentsCount')}
            </span>
          </div>

          {loading ? (
            <div className="text-center py-4">
              <Spinner animation="border" size="sm" />
            </div>
          ) : (
            <Table hover size="sm" className="mb-0" style={{ fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc' }}>
                  <th
                    className="text-muted text-uppercase fw-bold border-bottom"
                    style={{ letterSpacing: '0.6px', fontSize: '0.7rem', padding: '10px 14px' }}
                  >
                    {t('adminPanel.columns.agent')}
                  </th>
                  <th
                    className="text-muted text-uppercase fw-bold border-bottom"
                    style={{ letterSpacing: '0.6px', fontSize: '0.7rem', padding: '10px 14px' }}
                  >
                    {t('adminPanel.columns.owner')}
                  </th>
                  <th
                    className="text-muted text-uppercase fw-bold border-bottom"
                    style={{ letterSpacing: '0.6px', fontSize: '0.7rem', padding: '10px 14px' }}
                  >
                    {t('adminPanel.columns.scope')}
                  </th>
                  <th
                    className="text-muted text-uppercase fw-bold border-bottom"
                    style={{ letterSpacing: '0.6px', fontSize: '0.7rem', padding: '10px 14px' }}
                  >
                    {t('adminPanel.columns.updated')}
                  </th>
                  <th
                    className="text-muted text-uppercase fw-bold border-bottom"
                    style={{ letterSpacing: '0.6px', fontSize: '0.7rem', padding: '10px 14px' }}
                  >
                    {t('adminPanel.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((agent) => (
                  <tr key={agent.agentId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td className="fw-semibold" style={{ padding: '10px 14px' }}>
                      {agent.title}
                    </td>
                    <td style={{ padding: '10px 14px', color: '#374151' }}>
                      {agent.owner.name || agent.owner.userId.slice(0, 8)}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <Badge
                        bg=""
                        pill
                        style={{ ...scopeStyle(agent.scope), fontSize: '0.7rem', fontWeight: 700, padding: '3px 10px' }}
                      >
                        {agent.scope === 'user' ? 'Personal' : 'Company'}
                      </Badge>
                    </td>
                    <td className="text-muted" style={{ padding: '10px 14px' }}>
                      {agent.updatedAt ? new Date(agent.updatedAt).toLocaleDateString() : '-'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div className="d-flex gap-1">
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() => handleDuplicate(agent.agentId)}
                          title={t('adminPanel.copy')}
                          style={{ padding: '3px 10px', fontSize: '0.75rem', borderRadius: 6 }}
                        >
                          <Copy size={12} className="me-1" />
                          {t('adminPanel.copy')}
                        </Button>
                        <Button
                          variant="outline-danger"
                          size="sm"
                          onClick={() => handleDelete(agent.agentId, agent.title)}
                          title={t('adminPanel.delete')}
                          style={{ padding: '3px 10px', fontSize: '0.75rem', borderRadius: 6 }}
                        >
                          <Trash2 size={12} className="me-1" />
                          {t('adminPanel.delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-muted py-3">
                      {t('adminPanel.noAgents')}
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
};

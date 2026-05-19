import { useEffect, useState } from 'react';
import { Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { Share2, Trash2, UserPlus, Users } from 'lucide-react';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { getAgentSharing, shareAgent, updateAgentSharing, revokeAgentSharing } from '../../Services/AgentsService';
import type { AgentShare, AgentSummary, ShareRole, Team } from '../../types/agents';
import { useTranslation } from 'react-i18next';

type Props = {
  show: boolean;
  onHide: () => void;
  agent: AgentSummary | null;
  teams?: Team[];
};

const SHARE_ROLES: ShareRole[] = ['co-owner', 'editor', 'viewer'];

const ROLE_I18N_KEY: Record<ShareRole, string> = {
  'co-owner': 'coOwner',
  editor: 'editor',
  viewer: 'viewer',
};

const PERMISSIONS: { key: string; coOwner: boolean; editor: boolean; viewer: boolean }[] = [
  { key: 'chat', coOwner: true, editor: true, viewer: true },
  { key: 'edit', coOwner: true, editor: true, viewer: false },
  { key: 'duplicate', coOwner: true, editor: true, viewer: true },
  { key: 'manageSharing', coOwner: true, editor: false, viewer: false },
  { key: 'delete', coOwner: false, editor: false, viewer: false },
];

export const AgentShareModal = ({ show, onHide, agent, teams = [] }: Props) => {
  const { t } = useTranslation('agents');
  const { numaGet, numaPost, numaPut, numaDelete } = useNumaRequest();
  const [shares, setShares] = useState<AgentShare[]>([]);
  const [loading, setLoading] = useState(false);
  const [newPrincipalId, setNewPrincipalId] = useState('');
  const [newRole, setNewRole] = useState<ShareRole>('viewer');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!show || !agent) return;
    setLoading(true);
    getAgentSharing(numaGet, agent.agentId)
      .then(setShares)
      .catch(() => setShares([]))
      .finally(() => setLoading(false));
  }, [show, agent, numaGet]);

  const handleAdd = async () => {
    if (!agent || !newPrincipalId.trim()) return;
    setAdding(true);
    try {
      await shareAgent(numaPost, agent.agentId, {
        principalId: newPrincipalId.trim(),
        principalType: 'user',
        role: newRole,
      });
      const updated = await getAgentSharing(numaGet, agent.agentId);
      setShares(updated);
      setNewPrincipalId('');
    } catch (err) {
      console.error('Failed to share agent', err);
    } finally {
      setAdding(false);
    }
  };

  const handleRoleChange = async (principalId: string, role: ShareRole) => {
    if (!agent) return;
    try {
      await updateAgentSharing(numaPut, agent.agentId, principalId, { role });
      setShares((prev) => prev.map((s) => (s.principalId === principalId ? { ...s, role } : s)));
    } catch (err) {
      console.error('Failed to update share role', err);
    }
  };

  const handleRevoke = async (principalId: string) => {
    if (!agent) return;
    try {
      await revokeAgentSharing(numaDelete, agent.agentId, principalId);
      setShares((prev) => prev.filter((s) => s.principalId !== principalId));
    } catch (err) {
      console.error('Failed to revoke share', err);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center gap-2">
          <Share2 size={20} />
          {t('shareModal.title')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {agent && (
          <div className="p-2 px-3 bg-light border rounded-2 mb-3">
            <span className="fw-semibold">{agent.title}</span>
          </div>
        )}

        {/* Share with team */}
        {teams.length > 0 && (
          <>
            <h6 className="text-uppercase text-muted small fw-bold mb-2">{t('shareModal.shareWithTeam')}</h6>
            <div className="d-flex gap-2 mb-3 flex-wrap">
              {teams.map((team) => {
                const isShared = shares.some(
                  (s) => s.principalId === `team:${team.teamId}` && s.principalType === 'team'
                );
                return (
                  <Button
                    key={team.teamId}
                    size="sm"
                    variant={isShared ? 'primary' : 'outline-secondary'}
                    className="d-flex align-items-center gap-1"
                    style={{ fontSize: '0.8rem' }}
                    onClick={async () => {
                      if (!agent) return;
                      if (isShared) {
                        await revokeAgentSharing(numaDelete, agent.agentId, `team:${team.teamId}`);
                      } else {
                        await shareAgent(numaPost, agent.agentId, {
                          principalId: `team:${team.teamId}`,
                          principalType: 'team',
                          role: 'viewer',
                        });
                      }
                      const updated = await getAgentSharing(numaGet, agent.agentId);
                      setShares(updated);
                    }}
                  >
                    <Users size={13} />
                    {team.teamName}
                    {isShared && ' \u2713'}
                  </Button>
                );
              })}
            </div>
          </>
        )}

        <h6 className="text-uppercase text-muted small fw-bold mb-2">{t('shareModal.shareWith')}</h6>
        <div className="d-flex gap-2 mb-3">
          <Form.Control
            size="sm"
            placeholder={t('shareModal.searchPlaceholder')}
            value={newPrincipalId}
            onChange={(e) => setNewPrincipalId(e.target.value)}
          />
          <Form.Select
            size="sm"
            style={{ width: 130 }}
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as ShareRole)}
          >
            {SHARE_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`shareModal.roles.${ROLE_I18N_KEY[r]}`)}
              </option>
            ))}
          </Form.Select>
          <Button size="sm" variant="primary" onClick={handleAdd} disabled={adding || !newPrincipalId.trim()}>
            {adding ? <Spinner animation="border" size="sm" /> : <UserPlus size={14} />}
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-3">
            <Spinner animation="border" size="sm" />
          </div>
        ) : shares.length > 0 ? (
          <div className="d-flex flex-column gap-2 mb-3">
            {shares.map((share) => (
              <div
                key={share.principalId}
                className="d-flex align-items-center gap-3 p-2 px-3 border rounded-2 bg-light"
              >
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                  style={{
                    width: 30,
                    height: 30,
                    fontSize: 11,
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  }}
                >
                  {share.principalId.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-grow-1">
                  <div className="fw-medium small">{share.principalId}</div>
                  <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                    {t(`shareModal.principalTypes.${share.principalType}`)}
                  </div>
                </div>
                <Form.Select
                  size="sm"
                  style={{ width: 120 }}
                  value={share.role}
                  onChange={(e) => handleRoleChange(share.principalId, e.target.value as ShareRole)}
                >
                  {SHARE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`shareModal.roles.${ROLE_I18N_KEY[r]}`)}
                    </option>
                  ))}
                </Form.Select>
                <button className="btn btn-sm text-danger border-0" onClick={() => handleRevoke(share.principalId)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted small mb-3">{t('shareModal.noShares')}</p>
        )}

        <h6 className="text-uppercase text-muted small fw-bold mb-2">{t('shareModal.permissions')}</h6>
        <Table size="sm" bordered className="small mb-0">
          <thead className="table-light">
            <tr>
              <th>{t('shareModal.capability')}</th>
              <th className="text-center">{t('shareModal.roles.owner')}</th>
              <th className="text-center">{t('shareModal.roles.coOwner')}</th>
              <th className="text-center">{t('shareModal.roles.editor')}</th>
              <th className="text-center">{t('shareModal.roles.viewer')}</th>
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p.key}>
                <td>{t(`shareModal.capabilities.${p.key}`)}</td>
                <td className="text-center text-success">
                  <i className="bi bi-check" />
                </td>
                <td className={`text-center ${p.coOwner ? 'text-success' : 'text-muted'}`}>
                  {p.coOwner ? '\u2713' : '\u2014'}
                </td>
                <td className={`text-center ${p.editor ? 'text-success' : 'text-muted'}`}>
                  {p.editor ? '\u2713' : '\u2014'}
                </td>
                <td className={`text-center ${p.viewer ? 'text-success' : 'text-muted'}`}>
                  {p.viewer ? '\u2713' : '\u2014'}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide}>
          {t('shareModal.close')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

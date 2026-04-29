import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { Search, Trash2, UserPlus, Users } from 'lucide-react';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useConfirm } from '../../Providers/ConfirmContext';
import {
  createTeam,
  getTeam,
  addTeamMember,
  updateTeamMember,
  removeTeamMember,
  updateTeam,
  deleteTeam,
} from '../../Services/AgentsService';
import { UsersService, type WorkspaceUser } from '../../Services/UsersService';
import type { Team, TeamDetail, TeamRole } from '../../types/agents';
import { useAuth } from '../../Providers/AuthProvider';
import { useTranslation } from 'react-i18next';

type Props = {
  show: boolean;
  onHide: () => void;
  /** Pass a team to edit, or null to create a new team */
  team: Team | null;
  onTeamCreated?: () => void;
  onTeamDeleted?: () => void;
  onTeamUpdated?: () => void;
};

const TEAM_ROLES: TeamRole[] = ['owner', 'editor', 'viewer'];

const roleBadgeStyle = (role: TeamRole) => {
  switch (role) {
    case 'owner':
      return { backgroundColor: '#fef3c7', color: '#92400e' };
    case 'editor':
      return { backgroundColor: '#dbeafe', color: '#1d4ed8' };
    default:
      return { backgroundColor: '#f3f4f6', color: '#6b7280' };
  }
};

export const AgentManageTeamModal = ({ show, onHide, team, onTeamCreated, onTeamDeleted, onTeamUpdated }: Props) => {
  const { t } = useTranslation('agents');
  const { t: tCommon } = useTranslation('common');
  const { numaGet, numaPost, numaPut, numaDelete } = useNumaRequest();
  const { user } = useAuth();
  const confirm = useConfirm();
  const currentUserEmail = user?.decoded_tokens?.idToken?.email as string | undefined;
  const currentUserName = user?.decoded_tokens?.idToken?.name as string | undefined;
  const currentUserSub = user?.decoded_tokens?.idToken?.sub as string | undefined;
  // After creating, we switch to edit mode with the newly created team
  const [createdTeam, setCreatedTeam] = useState<Team | null>(null);
  const effectiveTeam = team || createdTeam;
  const isCreateMode = !effectiveTeam;

  // Team details
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [description, setDescription] = useState('');

  // Users
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userSearchFocused, setUserSearchFocused] = useState(false);
  const [addingUser, setAddingUser] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load workspace users + team details
  useEffect(() => {
    if (!show) {
      setCreatedTeam(null);
      return;
    }
    setTeamName(effectiveTeam?.teamName || '');
    setDescription(effectiveTeam?.description || '');
    setDetail(null);
    setUserSearch('');

    // Load workspace users
    UsersService.list(numaGet)
      .then(setWorkspaceUsers)
      .catch(() => setWorkspaceUsers([]));

    // Load team details if editing
    if (effectiveTeam) {
      setLoading(true);
      getTeam(numaGet, effectiveTeam.teamId)
        .then(setDetail)
        .catch(() => setDetail(null))
        .finally(() => setLoading(false));
    }
  }, [show, effectiveTeam, numaGet]);

  // Build a lookup from email/sub to user details for display
  const userLookup = useMemo(() => {
    const map = new Map<string, WorkspaceUser>();
    workspaceUsers.forEach((u) => {
      map.set(u.email, u);
      if (u.sub) map.set(u.sub, u);
    });
    // Ensure current user is resolvable by sub even if users API hasn't loaded yet
    if (currentUserSub && !map.has(currentUserSub)) {
      map.set(currentUserSub, {
        email: currentUserEmail || '',
        name: currentUserName || currentUserEmail || '',
        displayName: currentUserName,
        enabled: true,
        sub: currentUserSub,
      });
    }
    return map;
  }, [workspaceUsers, currentUserSub, currentUserEmail, currentUserName]);

  // Track both emails and subs of existing members so we never accidentally re-add
  // one via the "Add member" search. A creator row with no user_email (older
  // data) would previously slip through an email-only check and get overwritten
  // as a viewer via PutCommand.
  const memberKeys = useMemo(() => {
    const emails = new Set<string>();
    const subs = new Set<string>();
    if (detail?.members) {
      for (const m of detail.members) {
        if (m.userEmail) emails.add(m.userEmail);
        if (m.userId) subs.add(m.userId);
        const looked = userLookup.get(m.userId) || userLookup.get(m.userEmail || '');
        if (looked?.email) emails.add(looked.email);
        if (looked?.sub) subs.add(looked.sub);
      }
    }
    // Always exclude the current user from their own add-member search.
    if (currentUserEmail) emails.add(currentUserEmail);
    if (currentUserSub) subs.add(currentUserSub);
    return { emails, subs };
  }, [detail, userLookup, currentUserEmail, currentUserSub]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.toLowerCase().trim();
    return workspaceUsers
      .filter(
        (u) =>
          u.enabled &&
          !memberKeys.emails.has(u.email) &&
          !(u.sub && memberKeys.subs.has(u.sub)) &&
          !u.email.startsWith('numa-system') &&
          (!q ||
            u.displayName?.toLowerCase().includes(q) ||
            u.name?.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q))
      )
      .slice(0, 10);
  }, [userSearch, workspaceUsers, memberKeys]);

  const handleSave = async () => {
    if (!teamName.trim()) return;
    setSaving(true);
    try {
      if (isCreateMode) {
        const result = await createTeam(numaPost, {
          teamName: teamName.trim(),
          description: description.trim() || undefined,
          creatorName: currentUserName,
          creatorEmail: currentUserEmail,
        });
        onTeamCreated?.();
        // Switch to edit mode so the user can add members immediately
        setCreatedTeam({
          teamId: result.teamId,
          teamName: teamName.trim(),
          description: description.trim(),
          myRole: 'owner',
          createdBy: '',
          createdAt: Date.now(),
        });
      } else if (effectiveTeam) {
        await updateTeam(numaPut, effectiveTeam.teamId, {
          teamName: teamName.trim(),
          description: description.trim(),
        });
        onTeamUpdated?.();
      }
    } catch (err) {
      console.error('Failed to save team', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!effectiveTeam) return;
    const ok = await confirm({
      message: t('teamModal.confirmDelete', { name: effectiveTeam.teamName }),
      confirmLabel: tCommon('confirm.delete'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteTeam(numaDelete, effectiveTeam.teamId);
      onTeamDeleted?.();
      onHide();
    } catch (err) {
      console.error('Failed to delete team', err);
    }
  };

  const handleAddMember = async (user: WorkspaceUser, role: TeamRole = 'viewer') => {
    if (!effectiveTeam) return;
    setAddingUser(user.email);
    try {
      await addTeamMember(numaPost, effectiveTeam.teamId, {
        userId: user.sub || user.email,
        role,
        userName: user.name,
        userEmail: user.email,
      });
      const updated = await getTeam(numaGet, effectiveTeam.teamId);
      setDetail(updated);
      setUserSearch('');
    } catch (err) {
      console.error('Failed to add member', err);
    } finally {
      setAddingUser(null);
    }
  };

  const handleRoleChange = async (userId: string, role: TeamRole) => {
    if (!effectiveTeam) return;
    try {
      await updateTeamMember(numaPut, effectiveTeam.teamId, userId, { role });
      setDetail(
        (prev) =>
          prev && {
            ...prev,
            members: prev.members.map((m) => (m.userId === userId ? { ...m, role } : m)),
          }
      );
    } catch (err) {
      console.error('Failed to update role', err);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!effectiveTeam) return;
    try {
      await removeTeamMember(numaDelete, effectiveTeam.teamId, userId);
      setDetail(
        (prev) =>
          prev && {
            ...prev,
            members: prev.members.filter((m) => m.userId !== userId),
          }
      );
    } catch (err) {
      console.error('Failed to remove member', err);
    }
  };

  const isOwner = effectiveTeam?.myRole === 'owner' || isCreateMode;

  return (
    <Modal show={show} onHide={onHide} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center gap-2">
          <Users size={20} />
          {isCreateMode ? t('management.createTeam.title') : `${t('teamModal.title')}: ${effectiveTeam?.teamName}`}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading ? (
          <div className="text-center py-4">
            <Spinner animation="border" size="sm" />
          </div>
        ) : (
          <>
            {/* Team details */}
            <div className="mb-4">
              <Form.Group className="mb-3">
                <Form.Label className="small fw-semibold">{t('teamModal.name')}</Form.Label>
                <Form.Control
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder={t('management.createTeam.namePlaceholder')}
                  disabled={!isOwner}
                  autoFocus={isCreateMode}
                />
              </Form.Group>
              <Form.Group>
                <Form.Label className="small fw-semibold">{t('teamModal.description')}</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('management.createTeam.descPlaceholder')}
                  disabled={!isOwner}
                />
              </Form.Group>
            </div>

            {/* Members (only for existing teams) */}
            {!isCreateMode && (
              <>
                <h6 className="text-uppercase text-muted small fw-bold mb-2">{t('teamModal.members')}</h6>
                <div className="d-flex flex-column gap-2 mb-3">
                  {(detail?.members || []).map((member) => {
                    // Resolve display: stored > lookup by sub > lookup by email > fallback
                    const lookedUp = userLookup.get(member.userId) || userLookup.get(member.userEmail || '');
                    const displayName =
                      lookedUp?.displayName ||
                      member.userName ||
                      lookedUp?.name ||
                      member.userEmail ||
                      lookedUp?.email ||
                      member.userId;
                    const displayEmail = member.userEmail || lookedUp?.email;
                    const avatarUrl = lookedUp?.avatarUrl;
                    const initials = (displayName || '??').slice(0, 2).toUpperCase();

                    return (
                      <div
                        key={member.userId}
                        className="d-flex align-items-center gap-3 p-2 px-3 border rounded-2"
                        style={{ backgroundColor: '#fafbff' }}
                      >
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt={displayName}
                            className="rounded-circle flex-shrink-0"
                            style={{ width: 32, height: 32, objectFit: 'cover' }}
                          />
                        ) : (
                          <div
                            className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                            style={{
                              width: 32,
                              height: 32,
                              fontSize: 11,
                              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                            }}
                          >
                            {initials}
                          </div>
                        )}
                        <div className="flex-grow-1 min-w-0">
                          <div className="fw-medium small">{displayName}</div>
                          {displayEmail && displayName !== displayEmail && (
                            <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                              {displayEmail}
                            </div>
                          )}
                        </div>
                        {isOwner ? (
                          <>
                            <Form.Select
                              size="sm"
                              style={{ width: 110, fontSize: '0.8rem' }}
                              value={member.role}
                              onChange={(e) => handleRoleChange(member.userId, e.target.value as TeamRole)}
                            >
                              {TEAM_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {r.charAt(0).toUpperCase() + r.slice(1)}
                                </option>
                              ))}
                            </Form.Select>
                            <button
                              className="btn btn-sm text-danger border-0 p-1"
                              onClick={() => handleRemoveMember(member.userId)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        ) : (
                          <Badge bg="" style={{ ...roleBadgeStyle(member.role), fontSize: '0.7rem' }}>
                            {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Add member search */}
                {isOwner && (
                  <div className="mb-3">
                    <h6 className="text-uppercase text-muted small fw-bold mb-2">{t('teamModal.addMember')}</h6>
                    <div className="position-relative">
                      <Search
                        size={14}
                        className="position-absolute text-muted"
                        style={{ left: 10, top: '50%', transform: 'translateY(-50%)' }}
                      />
                      <Form.Control
                        size="sm"
                        placeholder={t('teamModal.searchUsers')}
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        onFocus={() => setUserSearchFocused(true)}
                        onBlur={() => setTimeout(() => setUserSearchFocused(false), 200)}
                        style={{ paddingLeft: 32 }}
                      />
                    </div>
                    {(userSearchFocused || userSearch) && filteredUsers.length > 0 && (
                      <div className="border rounded-2 mt-1" style={{ maxHeight: 250, overflowY: 'auto' }}>
                        {filteredUsers.map((user) => (
                          <div
                            key={user.email}
                            className="d-flex align-items-center gap-2 px-3 py-2 border-bottom"
                            style={{ cursor: 'pointer', fontSize: '0.85rem' }}
                            onClick={() => handleAddMember(user)}
                            role="button"
                          >
                            {user.avatarUrl ? (
                              <img
                                src={user.avatarUrl}
                                alt={user.displayName || user.name}
                                className="rounded-circle flex-shrink-0"
                                style={{ width: 28, height: 28, objectFit: 'cover' }}
                              />
                            ) : (
                              <div
                                className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                style={{
                                  width: 28,
                                  height: 28,
                                  fontSize: 10,
                                  background: 'linear-gradient(135deg, #10b981, #059669)',
                                }}
                              >
                                {(user.displayName || user.name || user.email).slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div className="flex-grow-1 min-w-0">
                              <div className="fw-medium">{user.displayName || user.name || user.email}</div>
                              {(user.displayName || user.name) && (
                                <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                  {user.email}
                                </div>
                              )}
                            </div>
                            {addingUser === user.email ? (
                              <Spinner animation="border" size="sm" />
                            ) : (
                              <UserPlus size={14} className="text-muted flex-shrink-0" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer className={isOwner && !isCreateMode ? 'd-flex justify-content-between' : ''}>
        {isOwner && !isCreateMode && (
          <Button variant="outline-danger" size="sm" onClick={handleDelete}>
            {t('teamModal.deleteTeam')}
          </Button>
        )}
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={onHide}>
            {isCreateMode ? t('management.createTeam.cancel') : t('teamModal.close')}
          </Button>
          {isOwner && (
            <Button variant="primary" onClick={handleSave} disabled={!teamName.trim() || saving}>
              {saving ? (
                <Spinner animation="border" size="sm" />
              ) : isCreateMode ? (
                t('management.createTeam.submit')
              ) : (
                t('teamModal.save')
              )}
            </Button>
          )}
        </div>
      </Modal.Footer>
    </Modal>
  );
};

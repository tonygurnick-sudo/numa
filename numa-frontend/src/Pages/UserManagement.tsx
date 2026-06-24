import { useState, useEffect, useMemo } from 'react';
import { Container, Button, Alert, Pagination } from 'react-bootstrap';
import { PersonPlus } from 'react-bootstrap-icons';
import { useTranslation } from 'react-i18next';
import { Preloader } from '../Components/Preloader';
import { useAuth } from '../Providers/AuthProvider';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { UserManagementUtils } from '../utils/userManagementUtils';
import { AdminMfaSettingsService } from '../Services/AdminMfaSettingsService';
import { AdminCreditsService, type BillingAdmin } from '../Services/AdminCreditsService';
import { getFlag } from '../utils/featureFlags';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { PageHeader } from '../Components/PageHeader';
import {
  UserActionsBar,
  CreateUserModal,
  UserDetailsModal,
  UserRoleSection,
  UserTableView,
  type User,
  type ViewMode,
  type SortField,
  type SortDirection,
  type Filters,
} from '../Components/UserManagement';

type UserManagementProps = {
  embedded?: boolean;
  mfaEnabled?: boolean;
};

const UserManagement = ({ embedded = false, mfaEnabled = false }: UserManagementProps) => {
  const { t } = useTranslation('userManagement');
  // Auth and API state
  const { getCredentials, user, qBusinessClient, forceTokenValidation, requestPasswordReset } = useAuth();
  const { numaPost, numaGet } = useNumaRequest();
  const currentUserSub = user?.decoded_tokens?.idToken?.sub;
  const currentUserEmail = user?.decoded_tokens?.idToken?.email as string | undefined;

  // Billing-admin roster (Numa Credit System) — only loaded when the credit view is enabled. Gates
  // who may see credit data; only an existing billing-admin can grant it (server-enforced).
  const showCredits = getFlag('SHOW_CREDITS');
  const [billingAccess, setBillingAccess] = useState<{ isBillingAdmin: boolean; admins: BillingAdmin[] }>({
    isBillingAdmin: false,
    admins: [],
  });
  const billingAdminSubs = useMemo(() => new Set(billingAccess.admins.map((a) => a.sub)), [billingAccess.admins]);

  // Users data state — all users fetched upfront for correct sorting/grouping
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  // Pagination state (client-side)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);

  // View and filter state
  const [viewMode, setViewMode] = useState<ViewMode>('row');
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<Filters>({
    roles: [],
  });
  const [sortField, setSortField] = useState<SortField>('created');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const selectedRole = filters.roles.length === 1 ? (filters.roles[0] as 'admin' | 'standard') : null;

  // Section collapse state
  const [sectionsExpanded, setSectionsExpanded] = useState({
    admin: true,
    standard: true,
  });

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Operation state (setters are used, values are tracked but not read directly in render)
  const [, setDeletingUser] = useState<string | null>(null);
  const [, setPromotingUser] = useState<string | null>(null);
  const [, setDemotingUser] = useState<string | null>(null);

  const fetchAllUsers = async () => {
    setLoadingUsers(true);
    setUsersError(null);
    try {
      const REGION = window.sessionStorage.getItem('REGION');
      const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');
      let ACCOUNT_ID = window.sessionStorage.getItem('ACCOUNT_ID');

      if (!ACCOUNT_ID) {
        const ROLE_ARN = window.sessionStorage.getItem('ROLE_ARN');
        const extractedAccountId = ROLE_ARN ? ROLE_ARN.split(':')[4] : null;

        if (extractedAccountId) {
          window.sessionStorage.setItem('ACCOUNT_ID', extractedAccountId);
          ACCOUNT_ID = extractedAccountId;
        } else {
          throw new Error(t('errors.accountId'));
        }
      }

      const credentials = await getCredentials();
      if (!credentials) {
        throw new Error(t('errors.credentials'));
      }

      const userManagementUtils = new UserManagementUtils(REGION, credentials);
      const users = await userManagementUtils.listAllUsers(USER_POOL_ID);

      setAllUsers(users);
      setCurrentPage(1);
    } catch (err) {
      console.error('Error fetching users:', err);
      setUsersError(err instanceof Error ? err.message : t('errors.fetchUsers'));
    } finally {
      setLoadingUsers(false);
    }
  };

  // Create user handler — returns whether the activation email was sent successfully
  const handleCreateUser = async (email: string, sendEmail: boolean): Promise<{ emailSent: boolean }> => {
    const isValid = await forceTokenValidation();
    if (!isValid) {
      throw new Error(t('errors.sessionExpired'));
    }

    const REGION = window.sessionStorage.getItem('REGION');
    const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');

    const credentials = await getCredentials();
    if (!credentials) {
      throw new Error(t('errors.credentials'));
    }

    const userManagementUtils = new UserManagementUtils(REGION, credentials);
    await userManagementUtils.createUser(email, USER_POOL_ID);

    // Best-effort audit log for user creation
    try {
      await numaPost('/api/audit-user-management', {
        action: 'user_create',
        adminEmail: currentUserEmail,
        createdUserEmail: email.toLowerCase(),
      });
    } catch (err) {
      console.error('Failed to write user creation audit log:', err);
    }

    // Send activation email (best-effort — user creation is the critical operation)
    let emailSent = false;
    if (sendEmail) {
      try {
        await requestPasswordReset(email, 'create');
        emailSent = true;
      } catch (err) {
        console.error('Failed to send activation email:', err);
      }
    }

    // Refresh user list after creation
    setTimeout(() => {
      fetchAllUsers();
    }, 1000);

    return { emailSent };
  };

  // Promote user to admin
  const handlePromoteToAdmin = async (userToPromote: User) => {
    setPromotingUser(userToPromote.username);
    setUsersError(null);

    try {
      const isValid = await forceTokenValidation();
      if (!isValid) {
        return;
      }

      const REGION = window.sessionStorage.getItem('REGION');
      const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');

      const credentials = await getCredentials();
      if (!credentials) {
        throw new Error(t('errors.credentials'));
      }

      const userManagementUtils = new UserManagementUtils(REGION, credentials);
      await userManagementUtils.addUserToGroup(userToPromote.username, 'admin', USER_POOL_ID);

      // Audit log: record who promoted this user (best-effort)
      try {
        await numaPost('/api/audit-user-management', {
          action: 'user_promote_admin',
          adminEmail: currentUserEmail,
          createdUserEmail: userToPromote.email,
          details: { targetUsername: userToPromote.username },
        });
      } catch (err) {
        console.error('Failed to write user promotion audit log:', err);
      }

      await fetchAllUsers();
    } catch (err) {
      console.error('Error promoting user to admin:', err);
      setUsersError(err instanceof Error ? err.message : t('errors.promote'));
    } finally {
      setPromotingUser(null);
    }
  };

  // Demote user from admin
  const handleDemoteFromAdmin = async (username: string) => {
    setDemotingUser(username);
    setUsersError(null);

    try {
      const isValid = await forceTokenValidation();
      if (!isValid) {
        return;
      }

      const REGION = window.sessionStorage.getItem('REGION');
      const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');

      const credentials = await getCredentials();
      if (!credentials) {
        throw new Error(t('errors.credentials'));
      }

      const userManagementUtils = new UserManagementUtils(REGION, credentials);
      const result = await userManagementUtils.removeUserFromGroup(username, 'admin', USER_POOL_ID);

      if (result && !result.signOutSuccess) {
        setUsersError(t('errors.demoteSession', { name: username }));
      }

      // Audit log: record who demoted this user (best-effort)
      try {
        const demotedUser = allUsers.find((u) => u.username === username);
        await numaPost('/api/audit-user-management', {
          action: 'user_demote_admin',
          adminEmail: currentUserEmail,
          createdUserEmail: demotedUser?.email ?? username,
          details: { targetUsername: username },
        });
      } catch (err) {
        console.error('Failed to write user demotion audit log:', err);
      }

      await fetchAllUsers();
    } catch (err) {
      console.error('Error demoting user from admin:', err);
      setUsersError(err instanceof Error ? err.message : t('errors.demote'));
    } finally {
      setDemotingUser(null);
    }
  };

  // Delete user
  const handleDeleteUser = async (userToDelete: User) => {
    setDeletingUser(userToDelete.username);
    setUsersError(null);

    try {
      if (!qBusinessClient) {
        throw new Error(t('errors.qBusinessClient'));
      }

      if (!getCredentials) {
        throw new Error(t('errors.webTokenCredentials'));
      }

      const REGION = window.sessionStorage.getItem('REGION');
      const userManagementUtils = new UserManagementUtils(REGION, await getCredentials());
      await userManagementUtils.deleteUser(
        userToDelete.email,
        fetchAllUsers,
        setUsersError,
        setDeletingUser,
        qBusinessClient
      );

      // Audit log: record who deleted this user (best-effort)
      try {
        await numaPost('/api/audit-user-management', {
          action: 'user_delete',
          adminEmail: currentUserEmail,
          createdUserEmail: userToDelete.email,
          details: { targetUsername: userToDelete.username },
        });
      } catch (err) {
        console.error('Failed to write user deletion audit log:', err);
      }
    } catch (err) {
      console.error('Error deleting user:', err);
      setUsersError(err instanceof Error ? err.message : t('errors.delete'));
      setDeletingUser(null);
    }
  };

  // View user handler
  const handleViewUser = (user: User) => {
    setSelectedUser(user);
    setShowDetailsModal(true);
  };

  // Reset MFA handler (admin only)
  const handleResetMfa = async (userToReset: User) => {
    await AdminMfaSettingsService.resetUserMfa(userToReset.username, numaPost);
  };

  // Filter and sort ALL users, then paginate client-side
  const filteredAndSortedUsers = useMemo(() => {
    let result = [...allUsers];

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      // Guard against users with no email (e.g. SSO/federated users whose IdP omitted the
      // email claim). `?.` short-circuits the whole chain to undefined (falsy) instead of
      // throwing, so one emailless user can't crash the search filter. (BUG-383)
      result = result.filter((user) => user.email?.toLowerCase().includes(term));
    }

    // Apply role filter
    if (filters.roles.length > 0) {
      result = result.filter((user) => {
        const isAdmin = user.groups?.includes('admin');
        if (filters.roles.includes('admin') && isAdmin) return true;
        if (filters.roles.includes('standard') && !isAdmin) return true;
        return false;
      });
    }

    // Sort within each role group, then place admins first
    const sortFn = (a: User, b: User) => {
      let comparison = 0;

      switch (sortField) {
        case 'created':
          comparison = new Date(a.created).getTime() - new Date(b.created).getTime();
          break;
        case 'email':
          // Nullish-coalesce so an emailless user doesn't throw during sort. (BUG-382/383)
          comparison = (a.email ?? '').localeCompare(b.email ?? '');
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    };

    const admins = result.filter((u) => u.groups?.includes('admin')).sort(sortFn);
    const standard = result.filter((u) => !u.groups?.includes('admin')).sort(sortFn);

    return [...admins, ...standard];
  }, [allUsers, searchTerm, filters, sortField, sortDirection]);

  // Client-side pagination
  const totalPages = Math.ceil(filteredAndSortedUsers.length / pageSize);
  const pagedUsers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedUsers.slice(start, start + pageSize);
  }, [filteredAndSortedUsers, currentPage, pageSize]);

  // Reset to page 1 when filters/search/sort change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filters, sortField, sortDirection]);

  // Split current page's users by role for section rendering
  const { adminUsers, standardUsers } = useMemo(() => {
    const admin: User[] = [];
    const standard: User[] = [];

    pagedUsers.forEach((user) => {
      if (user.groups?.includes('admin')) {
        admin.push(user);
      } else {
        standard.push(user);
      }
    });

    return { adminUsers: admin, standardUsers: standard };
  }, [pagedUsers]);

  useEffect(() => {
    fetchAllUsers();
  }, []);

  // Load the billing-admin roster once (only when the credit view is enabled for this client).
  useEffect(() => {
    if (!showCredits) return;
    AdminCreditsService.getBillingAdmins(numaGet)
      .then(setBillingAccess)
      .catch(() => undefined);
  }, [showCredits, numaGet]);

  // Grant/revoke billing-admin on a user. Server enforces caller-is-billing-admin + last-admin
  // lockout; surfaces the precise error code so the modal can message it.
  const handleSetBillingAdmin = async (target: User, grant: boolean): Promise<void> => {
    const res = await AdminCreditsService.setBillingAdmin(
      grant ? 'grant' : 'revoke',
      target.username,
      target.email ?? null,
      numaPost
    );
    setBillingAccess(res);
  };

  const headerActions = (
    <Button variant="primary" onClick={() => setShowCreateModal(true)} size={embedded ? 'sm' : undefined}>
      <PersonPlus size={16} className="me-2" />
      {t('actions.createUser')}
    </Button>
  );

  const content = (
    <>
      {usersError && (
        <Alert variant="danger" onClose={() => setUsersError(null)} dismissible className={embedded ? 'mb-3' : 'mt-3'}>
          {usersError}
        </Alert>
      )}

      <div className={embedded ? 'card shadow-sm' : 'card shadow-sm mt-4'}>
        <div className="card-body position-relative">
          {loadingUsers && <Preloader smallscreen overlayParent />}

          <div className="mb-3">
            <UserActionsBar
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              filters={filters}
              onFiltersChange={setFilters}
              sortField={sortField}
              onSortFieldChange={setSortField}
              sortDirection={sortDirection}
              onSortDirectionChange={setSortDirection}
              userCount={
                allUsers.length > 0 ? { filtered: filteredAndSortedUsers.length, total: allUsers.length } : undefined
              }
            />
          </div>

          {!loadingUsers && (
            <>
              {viewMode === 'row' ? (
                <UserTableView
                  adminUsers={adminUsers}
                  standardUsers={standardUsers}
                  currentUserSub={currentUserSub}
                  onViewUser={handleViewUser}
                  sectionsExpanded={sectionsExpanded}
                  visibleSections={selectedRole ? [selectedRole] : undefined}
                  onToggleSection={(section) => setSectionsExpanded((prev) => ({ ...prev, [section]: !prev[section] }))}
                  billingAdminSubs={billingAdminSubs}
                />
              ) : (
                <>
                  {(selectedRole === null || selectedRole === 'admin') && adminUsers.length > 0 && (
                    <UserRoleSection
                      title={t('sections.admins')}
                      users={adminUsers}
                      expanded={sectionsExpanded.admin}
                      onToggle={() => setSectionsExpanded((prev) => ({ ...prev, admin: !prev.admin }))}
                      viewMode={viewMode}
                      currentUserSub={currentUserSub}
                      onViewUser={handleViewUser}
                      variant="primary"
                    />
                  )}

                  {(selectedRole === null || selectedRole === 'standard') && standardUsers.length > 0 && (
                    <UserRoleSection
                      title={t('sections.standardUsers')}
                      users={standardUsers}
                      expanded={sectionsExpanded.standard}
                      onToggle={() => setSectionsExpanded((prev) => ({ ...prev, standard: !prev.standard }))}
                      viewMode={viewMode}
                      currentUserSub={currentUserSub}
                      onViewUser={handleViewUser}
                      variant="secondary"
                    />
                  )}
                </>
              )}

              {pagedUsers.length === 0 && (
                <p className="text-muted text-center py-4">
                  {allUsers.length === 0 ? t('empty.noUsers') : t('empty.noMatches')}
                </p>
              )}

              {totalPages > 1 && (
                <div className="d-flex justify-content-center mt-3">
                  <Pagination size="sm" className="mb-0">
                    <Pagination.Prev onClick={() => setCurrentPage((p) => p - 1)} disabled={currentPage === 1} />
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((page) => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1)
                      .reduce<(number | 'ellipsis')[]>((acc, page, idx, arr) => {
                        if (idx > 0 && page - (arr[idx - 1] as number) > 1) acc.push('ellipsis');
                        acc.push(page);
                        return acc;
                      }, [])
                      .map((item, idx) =>
                        item === 'ellipsis' ? (
                          <Pagination.Ellipsis key={`ellipsis-${idx}`} disabled />
                        ) : (
                          <Pagination.Item
                            key={item}
                            active={currentPage === item}
                            onClick={() => setCurrentPage(item)}
                          >
                            {item}
                          </Pagination.Item>
                        )
                      )}
                    <Pagination.Next
                      onClick={() => setCurrentPage((p) => p + 1)}
                      disabled={currentPage === totalPages}
                    />
                  </Pagination>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );

  return (
    <>
      {embedded ? (
        <div className="d-flex flex-column gap-2">
          <div className="d-flex justify-content-between align-items-center mb-3 pt-2">
            <div>
              <h5 className="mb-1 fw-semibold">{t('page.title')}</h5>
              <p className="text-muted mb-0 small">{t('page.subtitle')}</p>
            </div>
            {headerActions}
          </div>
          {content}
        </div>
      ) : (
        <LayoutDashboard>
          <Container fluid className="pt-2 pb-4 px-4">
            <PageHeader title={t('page.title')} subtitle={t('page.subtitle')} actions={headerActions} />
            {content}
          </Container>
        </LayoutDashboard>
      )}

      <CreateUserModal
        show={showCreateModal}
        onHide={() => setShowCreateModal(false)}
        onCreateUser={handleCreateUser}
      />

      <UserDetailsModal
        show={showDetailsModal}
        user={selectedUser}
        currentUserSub={currentUserSub}
        mfaEnabled={mfaEnabled}
        onHide={() => {
          setShowDetailsModal(false);
          setSelectedUser(null);
        }}
        onPromoteToAdmin={handlePromoteToAdmin}
        onDemoteFromAdmin={handleDemoteFromAdmin}
        onDeleteUser={handleDeleteUser}
        onResetMfa={handleResetMfa}
        showBillingAccess={showCredits}
        callerIsBillingAdmin={billingAccess.isBillingAdmin}
        isTargetBillingAdmin={selectedUser ? billingAdminSubs.has(selectedUser.username) : false}
        onSetBillingAdmin={handleSetBillingAdmin}
      />
    </>
  );
};

export default UserManagement;

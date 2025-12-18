import { useState, useEffect, useMemo } from 'react';
import { Container, Button, Alert, Pagination } from 'react-bootstrap';
import { PersonPlus } from 'react-bootstrap-icons';
import { Preloader } from '../Components/Preloader';
import { useAuth } from '../Providers/AuthProvider';
import { UserManagementUtils } from '../utils/userManagementUtils';
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
};

const UserManagement = ({ embedded = false }: UserManagementProps) => {
  // Auth and API state
  const { getCredentials, user, qBusinessClient, forceTokenValidation } = useAuth();
  const currentUserSub = user?.decoded_tokens?.idToken?.sub;

  // Users data state
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [paginationToken, setPaginationToken] = useState<string | null>(null);
  const [tokenHistory, setTokenHistory] = useState<string[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

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

  const fetchTotalUsers = async () => {
    try {
      const REGION = window.sessionStorage.getItem('REGION');
      const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');

      const credentials = await getCredentials();
      if (!credentials) {
        throw new Error('Failed to get AWS credentials');
      }

      const userManagementUtils = new UserManagementUtils(REGION, credentials);
      const poolInfo = await userManagementUtils.describeUserPool(USER_POOL_ID);

      setTotalUsers(poolInfo.estimatedNumberOfUsers);
      setTotalPages(Math.ceil(poolInfo.estimatedNumberOfUsers / pageSize));
    } catch (err) {
      console.error('Error fetching total user count:', err);
    }
  };

  const fetchUsers = async (page = 1, token: string | null = null) => {
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
          throw new Error('Could not determine AWS Account ID');
        }
      }

      const credentials = await getCredentials();
      if (!credentials) {
        throw new Error('Failed to get AWS credentials');
      }

      const userManagementUtils = new UserManagementUtils(REGION, credentials);
      const result = await userManagementUtils.listUsers(USER_POOL_ID, pageSize, token);

      setUsers(result.users);
      setHasNextPage(result.hasMore);
      setPaginationToken(result.nextToken);

      if (page > currentPage && result.nextToken) {
        setTokenHistory((prev) => [...prev, token as string]);
      } else if (page < currentPage) {
        setTokenHistory((prev) => prev.slice(0, -1));
      }

      setCurrentPage(page);

      if (page === 1 && totalUsers === 0) {
        fetchTotalUsers();
      }
    } catch (err) {
      console.error('Error fetching users:', err);
      setUsersError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleNextPage = () => {
    if (hasNextPage && paginationToken) {
      fetchUsers(currentPage + 1, paginationToken);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      const prevToken = tokenHistory[tokenHistory.length - 1] || null;
      fetchUsers(currentPage - 1, prevToken);
    }
  };

  const handleFirstPage = () => {
    setTokenHistory([]);
    fetchUsers(1, null);
  };

  const handleGoToPage = async (page: number) => {
    if (page === currentPage || page < 1 || page > totalPages) {
      return;
    }

    if (page === 1) {
      handleFirstPage();
    } else if (page === currentPage + 1 && hasNextPage) {
      handleNextPage();
    } else if (page === currentPage - 1 && currentPage > 1) {
      handlePrevPage();
    }
  };

  const renderPaginationItems = () => {
    const items = [];

    if (totalPages <= 1) {
      return [
        <Pagination.Item key={1} active={true} onClick={() => handleGoToPage(1)}>
          1
        </Pagination.Item>,
      ];
    }

    const startPage = Math.max(1, currentPage - 1);
    const endPage = Math.min(totalPages, currentPage + 1);

    for (let page = startPage; page <= endPage; page++) {
      const isClickable =
        page === currentPage ||
        page === 1 ||
        (page === currentPage + 1 && hasNextPage) ||
        (page === currentPage - 1 && currentPage > 1);

      items.push(
        <Pagination.Item
          key={page}
          active={currentPage === page}
          onClick={isClickable ? () => handleGoToPage(page) : undefined}
          disabled={!isClickable}
          style={!isClickable ? { cursor: 'not-allowed', opacity: 0.6 } : {}}
        >
          {page}
        </Pagination.Item>,
      );
    }

    return items;
  };

  // Create user handler
  const handleCreateUser = async (email: string) => {
    const isValid = await forceTokenValidation();
    if (!isValid) {
      throw new Error('Session expired');
    }

    const REGION = window.sessionStorage.getItem('REGION');
    const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');

    const credentials = await getCredentials();
    if (!credentials) {
      throw new Error('Failed to get AWS credentials');
    }

    const userManagementUtils = new UserManagementUtils(REGION, credentials);
    await userManagementUtils.createUser(email, USER_POOL_ID);

    // Refresh user list after creation
    setTimeout(() => {
      fetchUsers(1);
    }, 1000);
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
        throw new Error('Failed to get AWS credentials');
      }

      const userManagementUtils = new UserManagementUtils(REGION, credentials);
      await userManagementUtils.addUserToGroup(userToPromote.username, 'admin', USER_POOL_ID);

      await fetchUsers(1);
    } catch (err) {
      console.error('Error promoting user to admin:', err);
      setUsersError(err instanceof Error ? err.message : 'Failed to promote user to admin');
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
        throw new Error('Failed to get AWS credentials');
      }

      const userManagementUtils = new UserManagementUtils(REGION, credentials);
      const result = await userManagementUtils.removeUserFromGroup(username, 'admin', USER_POOL_ID);

      if (result && !result.signOutSuccess) {
        setUsersError(
          `User ${username} was demoted from admin but their session could not be terminated. They may still have admin privileges until they manually log out.`,
        );
      }

      await fetchUsers(1);
    } catch (err) {
      console.error('Error demoting user from admin:', err);
      setUsersError(err instanceof Error ? err.message : 'Failed to demote user from admin');
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
        throw new Error('Q Business client not found');
      }

      if (!getCredentials) {
        throw new Error('Get web token credentials not found');
      }

      const REGION = window.sessionStorage.getItem('REGION');
      const userManagementUtils = new UserManagementUtils(REGION, await getCredentials());
      await userManagementUtils.deleteUser(
        userToDelete.email,
        fetchUsers,
        setUsersError,
        setDeletingUser,
        qBusinessClient,
      );
    } catch (err) {
      console.error('Error deleting user:', err);
      setUsersError(err instanceof Error ? err.message : 'Failed to delete user');
      setDeletingUser(null);
    }
  };

  // View user handler
  const handleViewUser = (user: User) => {
    setSelectedUser(user);
    setShowDetailsModal(true);
  };

  // Filter and sort users
  const filteredAndSortedUsers = useMemo(() => {
    let result = [...users];

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((user) => user.email.toLowerCase().includes(term));
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

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'created':
          comparison = new Date(a.created).getTime() - new Date(b.created).getTime();
          break;
        case 'email':
          comparison = a.email.localeCompare(b.email);
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [users, searchTerm, filters, sortField, sortDirection]);

  // Split users by role
  const { adminUsers, standardUsers } = useMemo(() => {
    const admin: User[] = [];
    const standard: User[] = [];

    filteredAndSortedUsers.forEach((user) => {
      if (user.groups?.includes('admin')) {
        admin.push(user);
      } else {
        standard.push(user);
      }
    });

    return { adminUsers: admin, standardUsers: standard };
  }, [filteredAndSortedUsers]);

  useEffect(() => {
    fetchUsers(1);
  }, []);

  const headerActions = (
    <Button variant="primary" onClick={() => setShowCreateModal(true)} size={embedded ? 'sm' : undefined}>
      <PersonPlus size={16} className="me-2" />
      Create User
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
                users.length > 0
                  ? { filtered: filteredAndSortedUsers.length, total: totalUsers || users.length }
                  : undefined
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
                />
              ) : (
                <>
                  {(selectedRole === null || selectedRole === 'admin') && (
                    <UserRoleSection
                      title="Administrators"
                      users={adminUsers}
                      expanded={sectionsExpanded.admin}
                      onToggle={() => setSectionsExpanded((prev) => ({ ...prev, admin: !prev.admin }))}
                      viewMode={viewMode}
                      currentUserSub={currentUserSub}
                      onViewUser={handleViewUser}
                      variant="primary"
                    />
                  )}

                  {(selectedRole === null || selectedRole === 'standard') && (
                    <UserRoleSection
                      title="Standard Users"
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

              {filteredAndSortedUsers.length === 0 && (
                <p className="text-muted text-center py-4">
                  {users.length === 0 ? 'No users found' : 'No users match the current filters'}
                </p>
              )}

              {users.length > 0 && (currentPage > 1 || hasNextPage || totalPages > 1) && (
                <div className="d-flex justify-content-center mt-3">
                  <Pagination size="sm" className="mb-0">
                    <Pagination.Prev onClick={handlePrevPage} disabled={currentPage === 1} />
                    {renderPaginationItems()}
                    <Pagination.Next onClick={handleNextPage} disabled={!hasNextPage} />
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
              <h5 className="mb-1 fw-semibold">User Management</h5>
              <p className="text-muted mb-0 small">Manage user accounts and permissions.</p>
            </div>
            {headerActions}
          </div>
          {content}
        </div>
      ) : (
        <LayoutDashboard>
          <Container fluid className="pt-2 pb-4 px-4">
            <PageHeader
              title="User Management"
              subtitle="Manage user accounts and permissions"
              actions={headerActions}
            />
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
        onHide={() => {
          setShowDetailsModal(false);
          setSelectedUser(null);
        }}
        onPromoteToAdmin={handlePromoteToAdmin}
        onDemoteFromAdmin={handleDemoteFromAdmin}
        onDeleteUser={handleDeleteUser}
      />
    </>
  );
};

export default UserManagement;

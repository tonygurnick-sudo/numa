import { useState, useEffect } from 'react';
import { Container, Form, Button, Alert, Table, Modal, Pagination } from 'react-bootstrap';
import { Preloader } from '../Components/Preloader';
import { useAuth } from '../Providers/AuthProvider';
import { UserManagementUtils } from '../utils/userManagementUtils';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { Nav } from '../Components/Nav';

const UserManagement = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [createdEmail, setCreatedEmail] = useState('');
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState(null);
  const { getCredentials, user, qBusinessClient } = useAuth();
  const [deletingUser, setDeletingUser] = useState(null);
  const [promotingUser, setPromotingUser] = useState(null);
  const [demotingUser, setDemotingUser] = useState(null);
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [userToPromote, setUserToPromote] = useState(null);
  const [showAdminDeleteWarning, setShowAdminDeleteWarning] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);
  const currentUserSub = user?.decoded_tokens?.idToken?.sub;

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [paginationToken, setPaginationToken] = useState(null);
  const [tokenHistory, setTokenHistory] = useState([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

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
      // Don't set error state for this, as it's not critical
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

    // Show current page and 1 page on either side (3 pages max)
    const startPage = Math.max(1, currentPage - 1);
    const endPage = Math.min(totalPages, currentPage + 1);

    // Add the visible page range
    for (let page = startPage; page <= endPage; page++) {
      const isClickable =
        page === currentPage || // Current page (for consistency)
        page === 1 || // First page (always navigable)
        (page === currentPage + 1 && hasNextPage) || // Next page (only if hasNextPage)
        (page === currentPage - 1 && currentPage > 1); // Previous page (only if not on first page)

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

  const handleGoToPage = async (page) => {
    if (page === currentPage || page < 1 || page > totalPages) {
      return;
    }

    // Token-based pagination only supports sequential navigation
    if (page === 1) {
      handleFirstPage();
    } else if (page === currentPage + 1 && hasNextPage) {
      handleNextPage();
    } else if (page === currentPage - 1 && currentPage > 1) {
      handlePrevPage();
    }
  };

  const fetchUsers = async (page = 1, token = null) => {
    setLoadingUsers(true);
    setUsersError(null);
    try {
      const REGION = window.sessionStorage.getItem('REGION');
      const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');
      const ACCOUNT_ID = window.sessionStorage.getItem('ACCOUNT_ID');

      if (!ACCOUNT_ID) {
        const ROLE_ARN = window.sessionStorage.getItem('ROLE_ARN');
        const extractedAccountId = ROLE_ARN ? ROLE_ARN.split(':')[4] : null;

        if (extractedAccountId) {
          window.sessionStorage.setItem('ACCOUNT_ID', extractedAccountId);
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
        setTokenHistory((prev) => [...prev, token]);
      } else if (page < currentPage) {
        setTokenHistory((prev) => prev.slice(0, -1));
      }

      setCurrentPage(page);

      // Fetch total users on first load or when page 1 is loaded
      if (page === 1 && totalUsers === 0) {
        fetchTotalUsers();
      }
    } catch (err) {
      console.error('Error fetching users:', err);
      setUsersError(err.message || 'Failed to fetch users');
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

  const handleDeleteUser = async (user) => {
    setShowDeleteModal(true);
    setUserToDelete(user);
  };

  const confirmDeleteUser = async () => {
    setShowDeleteModal(false);
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
      setUsersError(err.message || 'Failed to delete user');
      setDeletingUser(null);
    } finally {
      setUserToDelete(null);
    }
  };

  const cancelDeleteUser = () => {
    setShowDeleteModal(false);
    setUserToDelete(null);
  };

  const handlePromoteToAdmin = async (user) => {
    setShowPromoteModal(true);
    setUserToPromote(user);
  };

  const confirmPromoteToAdmin = async () => {
    setShowPromoteModal(false);
    setPromotingUser(userToPromote.username);
    setUsersError(null);

    try {
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
      setUsersError(err.message || 'Failed to promote user to admin');
    } finally {
      setPromotingUser(null);
      setUserToPromote(null);
    }
  };

  const cancelPromoteToAdmin = () => {
    setShowPromoteModal(false);
    setUserToPromote(null);
  };

  const handleAttemptDeleteAdmin = () => {
    setShowAdminDeleteWarning(true);
  };

  const closeAdminDeleteWarning = () => {
    setShowAdminDeleteWarning(false);
  };

  const handleDemoteFromAdmin = async (username) => {
    setDemotingUser(username);
    setUsersError(null);

    try {
      const REGION = window.sessionStorage.getItem('REGION');
      const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');

      const credentials = await getCredentials();
      if (!credentials) {
        throw new Error('Failed to get AWS credentials');
      }

      const userManagementUtils = new UserManagementUtils(REGION, credentials);
      await userManagementUtils.removeUserFromGroup(username, 'admin', USER_POOL_ID);

      await fetchUsers(1);
    } catch (err) {
      console.error('Error demoting user from admin:', err);
      setUsersError(err.message || 'Failed to demote user from admin');
    } finally {
      setDemotingUser(null);
    }
  };

  useEffect(() => {
    fetchUsers(1);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);
    setCreatedEmail('');

    try {
      const REGION = window.sessionStorage.getItem('REGION');
      const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');
      const ACCOUNT_ID = window.sessionStorage.getItem('ACCOUNT_ID');

      if (!ACCOUNT_ID) {
        const ROLE_ARN = window.sessionStorage.getItem('ROLE_ARN');
        const extractedAccountId = ROLE_ARN ? ROLE_ARN.split(':')[4] : null;

        if (extractedAccountId) {
          window.sessionStorage.setItem('ACCOUNT_ID', extractedAccountId);
        } else {
          throw new Error('Could not determine AWS Account ID');
        }
      }

      const credentials = await getCredentials();
      if (!credentials) {
        throw new Error('Failed to get AWS credentials');
      }

      const userManagementUtils = new UserManagementUtils(REGION, credentials);
      const result = await userManagementUtils.createUser(email, USER_POOL_ID);
      console.log('User creation result:', result);
      setCreatedEmail(email);
      setSuccess(true);
      setLoading(false);
      setTimeout(() => {
        setLoadingUsers(true);
        fetchUsers(1)
          .then(() => {
            setLoadingUsers(false);
            setEmail('');
          })
          .catch((err) => {
            console.error('Error refreshing users:', err);
            setLoadingUsers(false);
          });
      }, 1000);
    } catch (err) {
      setLoading(false);
      setError(err.message || 'Failed to create user');
    }
  };

  return (
    <>
      <Nav />
      <LayoutDashboard>
        <Container className="py-4">
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2 className="mb-0">User Management</h2>
          </div>

          {error && (
            <Alert variant="danger" onClose={() => setError(null)} dismissible>
              {error}
            </Alert>
          )}

          <div className="card mb-4 position-relative shadow-sm">
            {loading && <Preloader smallscreen overlayParent />}
            <div className="card-body">
              <h3 className="card-title h5">Create New User</h3>
              <div className="card-text text-muted mb-4">
                <p className="mb-2">Create a new user account by entering their email address:</p>
                <ul className="mt-2 mb-0">
                  <li>The user will need to visit {window.location.origin}/create-password to set their password</li>
                  <li>You&apos;ll receive instructions to share with the user after creation</li>
                  <li>Access to Numa will be based on their assigned permissions</li>
                </ul>
              </div>

              <Form onSubmit={handleSubmit}>
                <Form.Group className="mb-3">
                  <Form.Label>Email address</Form.Label>
                  <Form.Control
                    type="email"
                    placeholder="Enter email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                  />
                  <Form.Text className="text-muted">This email will be their username for logging in.</Form.Text>
                </Form.Group>

                <Button variant="primary" type="submit" disabled={loading}>
                  Create User
                </Button>
              </Form>

              {success && (
                <Alert variant="success" className="mt-4 mb-0">
                  <h4 className="alert-heading h5">User created successfully!</h4>
                  <hr />
                  <div className="mb-3">
                    <strong className="d-block mb-2">User Instructions</strong>
                    <div className="bg-light p-3 rounded position-relative">
                      <div className="user-select-all">
                        <p className="mb-2">Welcome to Numa!</p>
                        <p className="mb-2">
                          Your account has been created with the following email address:{' '}
                          <strong>{createdEmail}</strong>
                        </p>
                        <p className="mb-2">To set up your password and access the system, please:</p>
                        <ol className="ps-4 mb-2">
                          <li>Go to {window.location.origin}/create-password</li>
                          <li>Enter your email address: {createdEmail}</li>
                          <li>Follow the instructions to create your password</li>
                        </ol>
                        <p className="mb-0">If you have any questions, please contact your administrator.</p>
                      </div>
                      <div className="d-flex justify-content-end mt-3">
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          className="me-2"
                          onClick={() => {
                            navigator.clipboard.writeText(createdEmail);
                            alert('Email copied to clipboard!');
                          }}
                        >
                          Copy Email
                        </Button>
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={() => {
                            const instructions = `Welcome to Numa!\n\nYour account has been created with the following email address: ${createdEmail}\n\nTo set up your password and access the system, please:\n1. Go to ${window.location.origin}/create-password\n2. Enter your email address: ${createdEmail}\n3. Follow the instructions to create your password\n\nIf you have any questions, please contact your administrator.`;
                            navigator.clipboard.writeText(instructions);
                            alert('Instructions copied to clipboard!');
                          }}
                        >
                          Copy All Instructions
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <strong className="d-block mb-2">Next Steps</strong>
                    <ol className="mb-0 ps-3">
                      <li className="mb-1">Share these instructions with the user securely</li>
                      <li className="mb-1">They will need to visit {window.location.origin}/create-password</li>
                      <li>They will be able to set their password there for the first time</li>
                    </ol>
                  </div>
                </Alert>
              )}
            </div>
          </div>

          <div className="card shadow-sm">
            <div className="card-body position-relative">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h3 className="h5 mb-0">Current Users</h3>
                {users.length > 0 && (
                  <div className="d-flex align-items-center gap-3">
                    <small className="text-muted">
                      {currentPage * pageSize - pageSize + 1}-
                      {Math.min(
                        currentPage * pageSize,
                        Math.min(users.length + (currentPage - 1) * pageSize, totalUsers || users.length),
                      )}{' '}
                      of {totalUsers || users.length} users
                    </small>
                    {(currentPage > 1 || hasNextPage || totalPages > 1) && (
                      <Pagination size="sm" className="mb-0">
                        <Pagination.Prev onClick={handlePrevPage} disabled={currentPage === 1} />
                        {renderPaginationItems()}
                        <Pagination.Next onClick={handleNextPage} disabled={!hasNextPage} />
                      </Pagination>
                    )}
                  </div>
                )}
              </div>

              {loadingUsers && <Preloader smallscreen overlayParent />}
              {usersError && (
                <Alert variant="danger" onClose={() => setUsersError(null)} dismissible>
                  {usersError}
                </Alert>
              )}
              {!loadingUsers && !usersError && (
                <>
                  <div className="table-responsive">
                    <Table hover className="align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Status</th>
                          <th>Role</th>
                          <th>Created</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => {
                          const isSystemUser = user.email?.includes('numa-system-user');
                          const isAdmin = user.groups?.includes('admin');
                          const isCurrentUser = user.username === currentUserSub;

                          return (
                            <tr
                              key={user.username}
                              className={isSystemUser ? 'text-muted opacity-50' : ''}
                              title={isSystemUser ? 'System user - not editable' : ''}
                            >
                              <td>
                                {user.email}
                                {isSystemUser && <small className="ms-2 fst-italic">(System)</small>}
                              </td>
                              <td>
                                <span
                                  className={`badge bg-${user.enabled ? (user.status === 'CONFIRMED' ? 'success' : 'warning') : 'danger'} ${isSystemUser ? 'opacity-50' : ''}`}
                                >
                                  {user.status}
                                </span>
                              </td>
                              <td>
                                <span className={`badge ${isAdmin ? 'bg-primary' : 'bg-secondary'}`}>
                                  {isAdmin ? 'Admin' : 'Standard'}
                                </span>
                              </td>
                              <td>
                                {new Date(user.created).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </td>
                              <td>
                                <div className="d-flex gap-2">
                                  {!isSystemUser && !isCurrentUser && (
                                    <>
                                      {isAdmin ? (
                                        <Button
                                          variant="outline-warning"
                                          size="sm"
                                          disabled={demotingUser === user.username}
                                          onClick={() => handleDemoteFromAdmin(user.username)}
                                          title="Remove admin privileges"
                                        >
                                          {demotingUser === user.username ? 'Demoting...' : 'Demote'}
                                        </Button>
                                      ) : (
                                        <Button
                                          variant="outline-primary"
                                          size="sm"
                                          disabled={promotingUser === user.username}
                                          onClick={() => handlePromoteToAdmin(user)}
                                          title="Grant admin privileges"
                                        >
                                          {promotingUser === user.username ? 'Promoting...' : 'Make Admin'}
                                        </Button>
                                      )}
                                      {isAdmin ? (
                                        <Button
                                          variant="outline-secondary"
                                          size="sm"
                                          onClick={handleAttemptDeleteAdmin}
                                          title="Admin users must be demoted to standard users before they can be deleted"
                                        >
                                          Delete
                                        </Button>
                                      ) : (
                                        <Button
                                          variant="danger"
                                          size="sm"
                                          disabled={deletingUser === user.username}
                                          onClick={() => handleDeleteUser(user)}
                                          title="Delete user account"
                                        >
                                          {deletingUser === user.username ? 'Deleting...' : 'Delete'}
                                        </Button>
                                      )}
                                    </>
                                  )}
                                  {isCurrentUser && <small className="text-muted">Current User</small>}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {users.length === 0 && (
                          <tr>
                            <td colSpan="5" className="text-center">
                              No users found
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </Table>
                  </div>
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
        </Container>
      </LayoutDashboard>

      {/* Admin Promotion Confirmation Modal */}
      <Modal show={showPromoteModal} onHide={cancelPromoteToAdmin} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Grant Administrator Privileges</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning" className="mb-4">
            <Alert.Heading className="h6">⚠️ Important: Administrator Access</Alert.Heading>
            You are about to grant administrator privileges to <strong>{userToPromote?.email}</strong>. Please review
            the permissions this will provide before proceeding.
          </Alert>

          <h6 className="mb-3">Administrator privileges include:</h6>
          <div className="row">
            <div className="col-md-6">
              <h6 className="text-primary mb-2">👥 User Management</h6>
              <ul className="small mb-3">
                <li>Create new user accounts</li>
                <li>Delete existing users</li>
                <li>Promote/demote other users to admin</li>
                <li>View all user information</li>
              </ul>

              <h6 className="text-primary mb-2">📂 Data Management</h6>
              <ul className="small mb-3">
                <li>Upload company documents</li>
                <li>Delete company files</li>
                <li>Manage data sources</li>
                <li>Configure document indexing</li>
              </ul>
            </div>
            <div className="col-md-6">
              <h6 className="text-primary mb-2">⚙️ System Configuration</h6>
              <ul className="small mb-3">
                <li>Modify system settings</li>
                <li>Configure integrations</li>
                <li>Access administrative tools</li>
                <li>View system logs and metrics</li>
              </ul>
            </div>
          </div>

          <Alert variant="info" className="mt-3">
            <strong>Note:</strong> Administrators have significant control over the system and can access all company
            data. Only grant these privileges to trusted team members who need administrative access to perform their
            responsibilities.
          </Alert>

          <p className="mb-0">
            <strong>Are you sure you want to grant administrator privileges to {userToPromote?.email}?</strong>
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={cancelPromoteToAdmin}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={confirmPromoteToAdmin}
            disabled={promotingUser === userToPromote?.username}
          >
            {promotingUser === userToPromote?.username ? 'Granting Access...' : 'Yes, Grant Admin Access'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Admin Deletion Warning Modal */}
      <Modal show={showAdminDeleteWarning} onHide={closeAdminDeleteWarning}>
        <Modal.Header closeButton>
          <Modal.Title>Cannot Delete Administrator</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning" className="mb-3">
            <Alert.Heading className="h6">🚫 Administrator Protection</Alert.Heading>
            Administrator accounts cannot be deleted directly for security reasons.
          </Alert>

          <p className="mb-3">To delete an administrator account, you must first:</p>

          <ol className="mb-3">
            <li className="mb-2">
              <strong>Demote the user</strong> from administrator to standard user using the &quot;Demote&quot; button
            </li>
            <li className="mb-2">
              <strong>Wait for the change to take effect</strong> (the page will refresh automatically)
            </li>
            <li>
              <strong>Then delete the user</strong> using the &quot;Delete&quot; button (which will now be available)
            </li>
          </ol>

          <Alert variant="info" className="mb-0">
            <strong>Why this protection exists:</strong> This prevents accidental deletion of administrator accounts and
            ensures that admin privilege removal is a deliberate, two-step process.
          </Alert>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={closeAdminDeleteWarning}>
            I Understand
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Delete User Confirmation Modal */}
      <Modal show={showDeleteModal} onHide={cancelDeleteUser} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Delete User Account</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="danger" className="mb-4">
            <Alert.Heading className="h6">⚠️ Warning: Permanent Account Deletion</Alert.Heading>
            You are about to permanently delete the user account for <strong>{userToDelete?.email}</strong>. This action
            cannot be undone.
          </Alert>

          <h6 className="mb-3">What will happen when you delete this user:</h6>
          <div className="row">
            <div className="col-md-6">
              <h6 className="text-danger mb-2">🚫 Account Access</h6>
              <ul className="small mb-3">
                <li>User will immediately lose access to Numa</li>
                <li>All login credentials will be revoked</li>
                <li>User cannot log in or recover their account</li>
              </ul>

              <h6 className="text-danger mb-2">📊 Data Impact</h6>
              <ul className="small mb-3">
                <li>Chat history will be preserved, but inaccessible to the user</li>
                <li>User activity logs will remain</li>
                <li>Uploaded documents will not be affected, but will be inaccessible to the user</li>
              </ul>
            </div>
            <div className="col-md-6">
              <h6 className="text-warning mb-2">⚡ Immediate Effects</h6>
              <ul className="small mb-3">
                <li>User removed from all groups</li>
                <li>All active sessions terminated</li>
                <li>Account appears as &quot;deleted&quot; in audit logs</li>
              </ul>

              <h6 className="text-info mb-2">♻️ Recovery Options</h6>
              <ul className="small mb-3">
                <li>Account cannot be restored</li>
                <li>Must create a new account with same email</li>
                <li>Previous permissions will not be restored</li>
              </ul>
            </div>
          </div>

          <Alert variant="warning" className="mt-3">
            <strong>Before deleting:</strong> Account deletion is permanent and irreversible.
          </Alert>

          <p className="mb-0">
            <strong>Are you sure you want to permanently delete the account for {userToDelete?.email}?</strong>
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={cancelDeleteUser}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDeleteUser} disabled={deletingUser === userToDelete?.username}>
            {deletingUser === userToDelete?.username ? 'Deleting Account...' : 'Yes, Delete Account'}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default UserManagement;

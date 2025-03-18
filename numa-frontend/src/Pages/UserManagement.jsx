import { useState, useEffect } from 'react';
import { Container, Form, Button, Alert, Table } from 'react-bootstrap';
import { Preloader } from '../Components/Preloader';
import { useAuth } from '../Providers/AuthProvider';
import { UserManagementUtils } from '../utils/userManagementUtils';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { Nav } from '../Components/Nav';

const UserManagement = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [tempPassword, setTempPassword] = useState(null);
  // These states will be used once ListUsers permission is added
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState(null);
  const { getIdentityPoolCredentials } = useAuth();

  const fetchUsers = async () => {
    setLoadingUsers(true);
    setUsersError(null);
    try {
      const REGION = window.sessionStorage.getItem('REGION');
      const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');
      const credentials = await getIdentityPoolCredentials();
      if (!credentials) {
        throw new Error('Failed to get AWS credentials');
      }

      const userManagementUtils = new UserManagementUtils(REGION, credentials);
      const userList = await userManagementUtils.listUsers(USER_POOL_ID);
      setUsers(userList);
      // For now, just set loading to false without fetching users
      setLoadingUsers(false);
    } catch (err) {
      setUsersError(err.message || 'Failed to fetch users');
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    setTempPassword(null);

    try {
      const REGION = window.sessionStorage.getItem('REGION');
      const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');
      const credentials = await getIdentityPoolCredentials();

      if (!credentials) {
        throw new Error('Failed to get AWS credentials');
      }

      const userManagementUtils = new UserManagementUtils(REGION, credentials);
      const result = await userManagementUtils.createUser(email, USER_POOL_ID);
      console.log('User creation result:', result);
      // Show the temporary password first
      setSuccess({ message: 'User created successfully!', user: result.user, email: email });
      setTempPassword(result.temporaryPassword);
      console.log('Setting temp password:', result.temporaryPassword);
      setLoading(false);
      // Wait a bit before refreshing the list to ensure password is seen
      setTimeout(() => {
        setLoadingUsers(true);
        fetchUsers().finally(() => {
          setLoadingUsers(false);
          setEmail('');
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
                <p className="mb-2">Create a new user account by entering their email address. You will receive:</p>
                <ul className="mt-2 mb-0">
                  <li>A temporary password to log in</li>
                  <li>Instructions to change their password on first login</li>
                  <li>Access to Numa based on their assigned permissions</li>
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

              {success?.message && tempPassword && (
                <Alert variant="success" className="mt-4 mb-0">
                  <h4 className="alert-heading h5">{success.message}</h4>
                  <hr />
                  <div className="mb-3">
                    <strong className="d-block mb-2">Login Credentials</strong>
                    <div className="bg-light p-3 rounded">
                      <div className="mb-2">
                        <strong className="d-block mb-1">Username (Email):</strong>
                        <div className="d-flex align-items-center">
                          <code className="user-select-all d-block flex-grow-1">{success.email}</code>
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            className="ms-2"
                            onClick={() => {
                              navigator.clipboard.writeText(success.email);
                              alert('Email copied to clipboard!');
                            }}
                          >
                            Copy
                          </Button>
                        </div>
                      </div>
                      <div>
                        <strong className="d-block mb-1">Temporary Password:</strong>
                        <div className="d-flex align-items-center">
                          <code className="user-select-all d-block flex-grow-1">{tempPassword}</code>
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            className="ms-2"
                            onClick={() => {
                              navigator.clipboard.writeText(tempPassword);
                              alert('Password copied to clipboard!');
                            }}
                          >
                            Copy
                          </Button>
                        </div>
                      </div>
                      <small className="text-muted d-block mt-2">
                        Important: Use your email address as your username to log in. The temporary password will only
                        be shown once.
                      </small>
                    </div>
                  </div>
                  <div>
                    <strong className="d-block mb-2">Next Steps</strong>
                    <ol className="mb-0 ps-3">
                      <li className="mb-1">Share these credentials with the user securely</li>
                      <li className="mb-1">Ask them to log in at {window.location.origin}</li>
                      <li>They will be required to change their password on first login</li>
                    </ol>
                  </div>
                </Alert>
              )}
            </div>
          </div>

          <div className="card shadow-sm">
            <div className="card-body position-relative">
              <h3 className="h5 card-title">Current Users</h3>
              {loadingUsers && <Preloader smallscreen overlayParent />}
              {usersError && (
                <Alert variant="danger" onClose={() => setUsersError(null)} dismissible>
                  {usersError}
                </Alert>
              )}
              {!loadingUsers && !usersError && (
                <div className="table-responsive">
                  <Table hover className="align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => {
                        const isSystemUser = user.email?.includes('numa-system-user');
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
                              {new Date(user.created).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </td>
                          </tr>
                        );
                      })}
                      {users.length === 0 && (
                        <tr>
                          <td colSpan="3" className="text-center">
                            No users found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        </Container>
      </LayoutDashboard>
    </>
  );
};

export default UserManagement;

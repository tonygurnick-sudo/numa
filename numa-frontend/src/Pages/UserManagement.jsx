import { useState, useEffect } from 'react';
import { Container, Form, Button, Alert, Table } from 'react-bootstrap';
import { Preloader } from '../Components/Preloader';
import { useAuth } from '../Providers/AuthProvider';
import { UserManagementUtils } from '../utils/userManagementUtils';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { Nav } from '../Components/Nav';
import { generateCognitoIdpPolicy } from '../Modules/CognitoIdpPolicyGenerator';
import { useNavigate } from 'react-router-dom';
function useNoChatGroup() {
  const { user } = useAuth();
  const groups = user?.decoded_tokens?.idToken?.['cognito:groups'] || [];
  return Array.isArray(groups) ? groups.includes('no-chat') : false;
}

const UserManagement = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [createdEmail, setCreatedEmail] = useState('');
  // These states will be used once ListUsers permission is added
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState(null);
  const { getWebTokenCredentials } = useAuth();

  // --- No Chat Group logic ---
  const navigate = useNavigate();

  const noChat = useNoChatGroup();

  const fetchUsers = async () => {
    setLoadingUsers(true);
    setUsersError(null);
    try {
      const REGION = window.sessionStorage.getItem('REGION');
      const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');
      const ACCOUNT_ID = window.sessionStorage.getItem('ACCOUNT_ID');

      // Make sure we have the ACCOUNT_ID in session storage
      if (!ACCOUNT_ID) {
        // Extract account ID from the role ARN if not directly available
        const ROLE_ARN = window.sessionStorage.getItem('ROLE_ARN');
        const extractedAccountId = ROLE_ARN ? ROLE_ARN.split(':')[4] : null;

        if (extractedAccountId) {
          window.sessionStorage.setItem('ACCOUNT_ID', extractedAccountId);
        } else {
          throw new Error('Could not determine AWS Account ID');
        }
      }

      const policy = generateCognitoIdpPolicy({
        Region: REGION,
        AccountId: ACCOUNT_ID || window.sessionStorage.getItem('ACCOUNT_ID'),
        UserPoolId: USER_POOL_ID,
      });

      const credentials = await getWebTokenCredentials(policy);
      if (!credentials) {
        throw new Error('Failed to get AWS credentials');
      }

      const userManagementUtils = new UserManagementUtils(REGION, credentials);
      const userList = await userManagementUtils.listUsers(USER_POOL_ID);
      setUsers(userList);
      setLoadingUsers(false);
    } catch (err) {
      console.error('Error fetching users:', err);
      setUsersError(err.message || 'Failed to fetch users');
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    if (noChat && navigate) {
      navigate('/dash', { replace: true });
    }
  }, [noChat, navigate]);

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

      // Make sure we have the ACCOUNT_ID in session storage
      if (!ACCOUNT_ID) {
        // Extract account ID from the role ARN if not directly available
        const ROLE_ARN = window.sessionStorage.getItem('ROLE_ARN');
        const extractedAccountId = ROLE_ARN ? ROLE_ARN.split(':')[4] : null;

        if (extractedAccountId) {
          window.sessionStorage.setItem('ACCOUNT_ID', extractedAccountId);
        } else {
          throw new Error('Could not determine AWS Account ID');
        }
      }

      const policy = generateCognitoIdpPolicy({
        Region: REGION,
        AccountId: ACCOUNT_ID || window.sessionStorage.getItem('ACCOUNT_ID'),
        UserPoolId: USER_POOL_ID,
      });

      const credentials = await getWebTokenCredentials(policy);

      if (!credentials) {
        throw new Error('Failed to get AWS credentials');
      }

      const userManagementUtils = new UserManagementUtils(REGION, credentials);
      const result = await userManagementUtils.createUser(email, USER_POOL_ID);
      console.log('User creation result:', result);
      // Store the email for display and set success to true
      setCreatedEmail(email);
      setSuccess(true);
      setLoading(false);
      // Wait a bit before refreshing the list
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

  if (noChat) return null;

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

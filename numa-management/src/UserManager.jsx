import { useState, useEffect } from 'react';
import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  ListUsersCommand,
  AdminListUserAuthEventsCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { Card, Table, Alert, Spinner, Button, Modal } from 'react-bootstrap';

function UserManagement({ temporaryCredentials }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userPool, setUserPool] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [authEvents, setAuthEvents] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logError, setLogError] = useState(null);
  const [cognitoClient, setCognitoClient] = useState(null);

  // Create the client once when credentials change
  useEffect(() => {
    const client = new CognitoIdentityProviderClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: temporaryCredentials.accessKeyId,
        secretAccessKey: temporaryCredentials.secretAccessKey,
        sessionToken: temporaryCredentials.sessionToken,
      },
    });
    setCognitoClient(client);
  }, [temporaryCredentials]);

  // Update fetchUserPool to use the client
  useEffect(() => {
    const fetchUserPool = async () => {
      if (!cognitoClient) return;

      try {
        const command = new ListUserPoolsCommand({
          MaxResults: 1,
        });

        const response = await cognitoClient.send(command);
        if (response.UserPools && response.UserPools.length > 0) {
          setUserPool(response.UserPools[0]);
          // console.log('Found User Pool:', response.UserPools[0]);
        } else {
          throw new Error('No User Pools found');
        }
      } catch (err) {
        console.error('Error fetching user pool:', err);
        setError(err.message);
      }
    };

    fetchUserPool();
  }, [cognitoClient]);

  // Update fetchUsers to use the client
  useEffect(() => {
    const fetchUsers = async () => {
      if (!userPool?.Id || !cognitoClient) return;

      try {
        const command = new ListUsersCommand({
          UserPoolId: userPool.Id,
          Limit: 60,
        });

        const response = await cognitoClient.send(command);
        setUsers(response.Users || []);
        // console.log('Users:', response.Users);
        setError(null);
      } catch (err) {
        console.error('Error fetching users:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [userPool, cognitoClient]);

  // Update fetchUserAuthEvents to use the client
  const fetchUserAuthEvents = async (username) => {
    if (!cognitoClient) return;
    setLoadingLogs(true);
    setLogError(null);

    try {
      const command = new AdminListUserAuthEventsCommand({
        UserPoolId: userPool.Id,
        Username: username,
        MaxResults: 25,
      });

      const response = await cognitoClient.send(command);
      setAuthEvents(response.AuthEvents || []);
      console.log('Auth Events:', response.AuthEvents);
    } catch (err) {
      console.error('Error fetching auth events:', err);
      setLogError(err.message);
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleViewLogs = (user) => {
    setSelectedUser(user);
    setShowLogsModal(true);
    fetchUserAuthEvents(user.Username);
  };

  const getEmailFromAttributes = (attributes) => {
    const emailAttr = attributes?.find((attr) => attr.Name === 'email');
    return emailAttr ? emailAttr.Value : '-';
  };

  const getEventStatusStyle = (eventResponse) => {
    if (eventResponse.includes('Success')) return 'text-success';
    if (eventResponse.includes('Fail')) return 'text-danger';
    return 'text-muted';
  };

  if (loading) {
    return (
      <div className="text-center p-4">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading users...</span>
        </Spinner>
      </div>
    );
  }

  if (error) {
    return <Alert variant="danger">Error: {error}</Alert>;
  }

  return (
    <div className="container-fluid p-0">
      <Card>
        <Card.Header>
          <h3 className="h5 mb-0">
            User Management
            {userPool && <small className="text-muted ms-2">Pool: {userPool.Name}</small>}
          </h3>
        </Card.Header>
        <Card.Body>
          {users.length === 0 ? (
            <Alert variant="info">No users found in this user pool.</Alert>
          ) : (
            <Table responsive hover>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Created</th>
                  <th>Last Modified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.Username}>
                    <td>{user.Username}</td>
                    <td>{getEmailFromAttributes(user.Attributes)}</td>
                    <td>{new Date(user.UserCreateDate).toLocaleString()}</td>
                    <td>{new Date(user.UserLastModifiedDate).toLocaleString()}</td>
                    <td>
                      <Button size="sm" variant="outline-secondary" onClick={() => handleViewLogs(user)}>
                        View Logs
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {/* Auth Events Modal */}
      <Modal show={showLogsModal} onHide={() => setShowLogsModal(false)} size="lg" scrollable>
        <Modal.Header closeButton>
          <Modal.Title>
            Authentication Logs
            {selectedUser && (
              <small className="text-muted ms-2">{getEmailFromAttributes(selectedUser.Attributes)}</small>
            )}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {loadingLogs ? (
            <div className="text-center p-4">
              <Spinner animation="border" size="sm" />
            </div>
          ) : logError ? (
            <Alert variant="danger">{logError}</Alert>
          ) : authEvents.length === 0 ? (
            <Alert variant="info">No authentication events found</Alert>
          ) : (
            <Table responsive hover>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Event Type</th>
                  <th>Response</th>
                  <th>Device</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {authEvents.map((event, index) => (
                  <tr key={index}>
                    <td>{new Date(event.CreationDate).toLocaleString()}</td>
                    <td>{event.EventType}</td>
                    <td className={getEventStatusStyle(event.EventResponse)}>{event.EventResponse}</td>
                    <td>{event.DeviceName || '-'}</td>
                    <td>
                      {event.EventContextData?.City && event.EventContextData?.Country
                        ? `${event.EventContextData.City}, ${event.EventContextData.Country}`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowLogsModal(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

export default UserManagement;

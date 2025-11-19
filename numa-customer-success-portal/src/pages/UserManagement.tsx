import { useState, useEffect, useCallback } from 'react'
import { Container, Form, Button, Alert, Table, Modal, Card } from 'react-bootstrap'
import { PersonPlus, Trash } from 'react-bootstrap-icons'
import { UserManagementService, User } from '@/services/userManagementService'
import { useAuth } from '@/contexts/AuthContext'

export default function UserManagement() {
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [createdEmail, setCreatedEmail] = useState('')
  const [users, setUsers] = useState<User[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [deletingUser, setDeletingUser] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [userToDelete, setUserToDelete] = useState<User | null>(null)
  const [userManagementService, setUserManagementService] = useState<UserManagementService | null>(null)

  // Define fetchUsers before using it in useEffect dependency array
  const fetchUsers = useCallback(async (service?: UserManagementService) => {
    if (!service && !userManagementService) return

    const serviceToUse = service || userManagementService!
    setLoadingUsers(true)
    setUsersError(null)

    try {
      const result = await serviceToUse.listUsers(50)
      setUsers(result.users)
    } catch (err: unknown) {
      console.error('Error fetching users:', err)
      setUsersError(err instanceof Error ? err.message : 'Failed to fetch users')
    } finally {
      setLoadingUsers(false)
    }
  }, [userManagementService])

  useEffect(() => {
    const initializeService = async () => {
      if (!session?.idToken) {
        setUsersError('Not authenticated')
        setLoadingUsers(false)
        return
      }

      try {
        const config = await fetch('/config.json').then(res => res.json())
        // Avoid recreating the service if already initialized
        const service =
          userManagementService ||
          new UserManagementService(
            config.AWS_REGION,
            config.IDENTITY_POOL_ID,
            config.USER_POOL_ID,
          )
        if (!userManagementService) setUserManagementService(service)
        await fetchUsers(service)
      } catch (err) {
        console.error('Error initializing user management service:', err)
        setUsersError('Failed to initialize user management service')
        setLoadingUsers(false)
      }
    }

    initializeService()
  }, [session?.idToken])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userManagementService) return

    setLoading(true)
    setError(null)
    setSuccess(false)
    setCreatedEmail('')

    try {
      await userManagementService.createUser(email)
      setCreatedEmail(email)
      setSuccess(true)
      setEmail('')

      setTimeout(() => {
        fetchUsers()
      }, 1000)
    } catch (err: unknown) {
      setError(err.message || 'Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteUser = (user: User) => {
    setUserToDelete(user)
    setShowDeleteModal(true)
  }

  const confirmDeleteUser = async () => {
    if (!userToDelete || !userManagementService) return

    setShowDeleteModal(false)
    setDeletingUser(userToDelete.username)
    setUsersError(null)

    try {
      await userManagementService.deleteUser(userToDelete.username)
      await fetchUsers()
    } catch (err: unknown) {
      console.error('Error deleting user:', err)
      setUsersError(err instanceof Error ? err.message : 'Failed to delete user')
    } finally {
      setDeletingUser(null)
      setUserToDelete(null)
    }
  }

  const cancelDeleteUser = () => {
    setShowDeleteModal(false)
    setUserToDelete(null)
  }

  const getUserInstructions = (email: string) => {
    const baseUrl = window.location.origin
    return `Welcome to Numa Customer Success Portal!

Your account has been created with the email address: ${email}

To set up your access:
1. Go to ${baseUrl}/create-password
2. Enter your email address: ${email}
3. Click "Send Activation Code" - you'll receive a code via email
4. Enter the activation code and create your password
5. Return to ${baseUrl} to sign in with your new password

If you have any questions, please contact your administrator.`
  }

  const handleCopyInstructions = async () => {
    if (!createdEmail) return

    try {
      const instructions = getUserInstructions(createdEmail)
      await navigator.clipboard.writeText(instructions)
    } catch (err) {
      console.error('Failed to copy instructions:', err)
    }
  }

  return (
    <Container className="py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0 d-flex align-items-center">
          <PersonPlus size={32} className="me-2 text-primary" />
          User Management
        </h2>
      </div>

      {error && (
        <Alert variant="danger" onClose={() => setError(null)} dismissible>
          {error}
        </Alert>
      )}

      <Card className="mb-4 shadow-sm">
        <Card.Body>
          <h5 className="card-title">Create New User</h5>
          <p className="text-muted mb-4">
            Create a new user account by entering their email address. The user will receive login credentials to access the system.
          </p>

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
              <Form.Text className="text-muted">
                This email will be their username for logging in.
              </Form.Text>
            </Form.Group>

            <Button variant="primary" type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create User'}
            </Button>
          </Form>

          {success && (
            <Alert variant="success" className="mt-4 mb-0">
              <h6 className="alert-heading">User created successfully!</h6>
              <hr />
              <div className="mb-3">
                <strong>Instructions for {createdEmail}:</strong>
                <div className="mt-2 p-3 bg-light rounded border">
                  <pre className="mb-0 text-wrap" style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>
                    {getUserInstructions(createdEmail)}
                  </pre>
                </div>
              </div>
              <div className="d-flex gap-2">
                <Button variant="outline-primary" size="sm" onClick={handleCopyInstructions}>
                  Copy Instructions
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => window.open(`${window.location.origin}/create-password?email=${encodeURIComponent(createdEmail)}`, '_blank')}
                >
                  Open Setup Link
                </Button>
              </div>
            </Alert>
          )}
        </Card.Body>
      </Card>

      <Card className="shadow-sm">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="mb-0">Current Users</h5>
            {users.length > 0 && (
              <small className="text-muted">
                {users.length} user{users.length !== 1 ? 's' : ''}
              </small>
            )}
          </div>

          {loadingUsers && (
            <div className="text-center py-4">
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
            </div>
          )}

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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.username}>
                      <td>{user.email}</td>
                      <td>
                        <span
                          className={`badge bg-${user.enabled
                              ? user.status === 'CONFIRMED'
                                ? 'success'
                                : 'warning'
                              : 'danger'
                            }`}
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
                      <td>
                        <Button
                          variant="outline-danger"
                          size="sm"
                          disabled={deletingUser === user.username}
                          onClick={() => handleDeleteUser(user)}
                          title="Delete user account"
                        >
                          {deletingUser === user.username ? (
                            'Deleting...'
                          ) : (
                            <>
                              <Trash size={14} className="me-1" />
                              Delete
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center py-4 text-muted">
                        No users found
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Delete User Confirmation Modal */}
      <Modal show={showDeleteModal} onHide={cancelDeleteUser}>
        <Modal.Header closeButton>
          <Modal.Title>Delete User Account</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning" className="mb-3">
            <strong>Warning:</strong> This action cannot be undone.
          </Alert>
          <p>
            Are you sure you want to permanently delete the account for{' '}
            <strong>{userToDelete?.email}</strong>?
          </p>
          <p className="mb-0 text-muted small">
            The user will immediately lose access to the system and cannot be recovered.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={cancelDeleteUser}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDeleteUser}>
            Delete Account
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  )
}

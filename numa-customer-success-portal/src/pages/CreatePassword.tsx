import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Container, Form, Button, Alert, Card, OverlayTrigger, Popover } from 'react-bootstrap'
import { Key, CheckCircle } from 'react-bootstrap-icons'
import { useAuth } from '@/contexts/AuthContext'

export default function CreatePassword() {
  const [email, setEmail] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isCodeSent, setIsCodeSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [passwordErrors, setPasswordErrors] = useState<React.ReactNode[] | null>(null)

  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { requestPasswordReset, confirmPasswordReset } = useAuth()

  // Check for email, code, and mode in URL parameters
  useEffect(() => {
    const emailFromUrl = searchParams.get('email')
    const codeFromUrl = searchParams.get('code')

    if (emailFromUrl) {
      setEmail(emailFromUrl)
    }
    if (codeFromUrl) {
      setResetCode(codeFromUrl)
      setIsCodeSent(true)
    }
  }, [searchParams])

  // Determine if this is reset mode or create mode
  const isResetMode = searchParams.get('mode') === 'reset'
  const pageTitle = isResetMode ? 'Reset Your Password' : 'Create Your Password'
  const codePrompt = isResetMode
    ? 'Enter your email to receive a password reset code.'
    : 'Enter your email to receive an activation code.'
  const codeInstructions = isResetMode
    ? 'Enter the reset code and create your new password.'
    : 'Enter the activation code and create your password.'
  const buttonText = isResetMode ? 'Send Reset Code' : 'Send Activation Code'
  const submitText = isResetMode ? 'Reset Password' : 'Create Password'
  const loadingText = isResetMode ? 'Resetting Password...' : 'Creating Password...'
  const successMessage = isResetMode
    ? 'Password reset successfully! Redirecting to login...'
    : 'Password created successfully! Redirecting to login...'

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      await requestPasswordReset(email.toLowerCase())
      setIsCodeSent(true)
      const successMsg = isResetMode
        ? 'Reset code sent! Please check your email and enter the code below.'
        : 'Activation code sent! Please check your email and enter the code below.'
      setSuccess(successMsg)
    } catch (err: unknown) {
      const errorMsg = isResetMode
        ? (err instanceof Error ? err.message : 'Failed to send reset code')
        : (err instanceof Error ? err.message : 'Failed to send activation code')
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  const handleCreatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      setLoading(false)
      return
    }

    if (passwordErrors && passwordErrors.length > 0) {
      setError('Please fix the password requirements above.')
      setLoading(false)
      return
    }

    try {
      await confirmPasswordReset(email.toLowerCase(), resetCode, newPassword)
      setSuccess(successMessage)
      setTimeout(() => navigate('/'), 3000)
    } catch (err: unknown) {
      const errorMsg = isResetMode
        ? (err instanceof Error ? err.message : 'Failed to reset password')
        : (err instanceof Error ? err.message : 'Failed to create password')
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  const validatePassword = (password: string) => {
    const requirements = [
      { message: 'at least 8 characters', pattern: /.{8,}/ },
      { message: 'at least one lowercase letter', pattern: /[a-z]/ },
      { message: 'at least one uppercase letter', pattern: /[A-Z]/ },
      { message: 'at least one number', pattern: /[0-9]/ },
      { message: 'at least one symbol (!@#$%^&*)', pattern: /[!@#$%^&*(),.?":{}|<>]/ },
    ]

    const errors = requirements
      .filter(req => !password.match(req.pattern))
      .map(req => (
        <div key={req.message}>
          Password must contain {req.message}
        </div>
      ))

    setPasswordErrors(errors.length > 0 ? errors : null)
  }

  const handleNewPasswordChange = (password: string) => {
    setNewPassword(password)
    validatePassword(password)
  }

  return (
    <Container className="d-flex justify-content-center align-items-center min-vh-100">
      <Card className="shadow-lg" style={{ width: '100%', maxWidth: '500px' }}>
        <Card.Body className="p-5">
          <div className="text-center mb-4">
            <Key size={48} className="text-primary mb-3" />
            <h2 className="mb-2">{pageTitle}</h2>
            <p className="text-muted">
              {!isCodeSent ? codePrompt : codeInstructions}
            </p>
          </div>

          {error && (
            <Alert variant="danger" onClose={() => setError(null)} dismissible>
              {error}
            </Alert>
          )}

          {success && (
            <Alert variant="success" className="d-flex align-items-center">
              <CheckCircle className="me-2" />
              {success}
            </Alert>
          )}

          {!isCodeSent ? (
            <Form onSubmit={handleRequestCode}>
              <Form.Group className="mb-4">
                <Form.Label>Email address</Form.Label>
                <Form.Control
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  size="lg"
                />
                <Form.Text className="text-muted">
                  {isResetMode
                    ? 'Enter the email address associated with your account.'
                    : 'This should be the email address your administrator used when creating your account.'
                  }
                </Form.Text>
              </Form.Group>

              <div className="d-grid gap-2">
                <Button variant="primary" type="submit" disabled={loading} size="lg">
                  {loading ? 'Sending...' : buttonText}
                </Button>
              </div>

              <div className="text-center mt-3">
                <Button variant="link" onClick={() => navigate('/')}>
                  Back to Login
                </Button>
              </div>
            </Form>
          ) : (
            <Form onSubmit={handleCreatePassword}>
              <Form.Group className="mb-3">
                <Form.Label>Email address</Form.Label>
                <Form.Control
                  type="email"
                  value={email}
                  readOnly
                  disabled
                  autoComplete="email"
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>{isResetMode ? 'Reset Code' : 'Activation Code'}</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter the code from your email"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  required
                  autoComplete="off"
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>New Password</Form.Label>
                <OverlayTrigger
                  placement="right"
                  overlay={
                    <Popover>
                      <Popover.Header>Password Requirements</Popover.Header>
                      <Popover.Body>
                        <ul className="mb-0">
                          <li>At least 8 characters</li>
                          <li>At least one uppercase letter</li>
                          <li>At least one lowercase letter</li>
                          <li>At least one number</li>
                          <li>At least one symbol</li>
                        </ul>
                      </Popover.Body>
                    </Popover>
                  }
                >
                  <Form.Control
                    type="password"
                    placeholder="Enter your new password"
                    value={newPassword}
                    onChange={(e) => handleNewPasswordChange(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </OverlayTrigger>
                {passwordErrors && (
                  <div className="text-danger small mt-1">
                    {passwordErrors}
                  </div>
                )}
              </Form.Group>

              <Form.Group className="mb-4">
                <Form.Label>Confirm New Password</Form.Label>
                <Form.Control
                  type="password"
                  placeholder="Confirm your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </Form.Group>

              <div className="d-grid gap-2">
                <Button
                  variant="primary"
                  type="submit"
                  disabled={loading || (passwordErrors && passwordErrors.length > 0)}
                  size="lg"
                >
                  {loading ? loadingText : submitText}
                </Button>
              </div>

              <div className="text-center mt-3">
                <Button variant="link" onClick={() => setIsCodeSent(false)}>
                  Use Different Email
                </Button>
              </div>
            </Form>
          )}
        </Card.Body>
      </Card>
    </Container>
  )
}

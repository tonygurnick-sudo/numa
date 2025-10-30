import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Container,
  Card,
  Form,
  Button,
  Alert,
  Spinner,
  Row,
  Col,
  Badge
} from 'react-bootstrap'
import { Lock, Person } from 'react-bootstrap-icons'
import { useAuth } from '@/contexts/AuthContext'
import ArcanumLogo from '@/assets/arc_logo_black.svg?react'

export default function LoginForm() {
  const navigate = useNavigate()
  const {
    signIn,
    completePasswordChange,
    completeMfaSetup,
    submitMfaCode,
    loading,
    error,
    passwordChangeRequired,
    mfaSetupRequired,
    mfaCodeRequired,
    clearError
  } = useAuth()

  const [formData, setFormData] = useState({
    username: '',
    password: '',
    newPassword: '',
    confirmPassword: '',
    fullName: '',
    mfaCode: '',
    mfaSetupCode: '',
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))

    // Clear error when user starts typing
    if (error) clearError()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (passwordChangeRequired) {
      // Handle password change submission
      if (!formData.newPassword || formData.newPassword !== formData.confirmPassword || !formData.fullName) {
        return
      }

      try {
        await completePasswordChange(formData.newPassword, formData.fullName)
      } catch {
        // Error is handled by the AuthContext
      }
    } else if (mfaSetupRequired) {
      // Handle MFA setup verify submission
      if (!formData.mfaSetupCode) {
        return
      }

      try {
        await completeMfaSetup(formData.mfaSetupCode)
      } catch {
        // Error handled by context
      }
    } else if (mfaCodeRequired) {
      // Handle MFA code submission
      if (!formData.mfaCode) {
        return
      }

      try {
        await submitMfaCode(formData.mfaCode)
      } catch {
        // Error handled by context
      }
    } else {
      // Handle initial sign in
      if (!formData.username || !formData.password) {
        return
      }

      try {
        await signIn(formData.username, formData.password)
      } catch {
        // Error is handled by the AuthContext
      }
    }
  }


  return (
    <div className="min-vh-100 d-flex align-items-center bg-light">
      <Container>
        <Row className="justify-content-center">
          <Col md={6} lg={5} xl={4}>
            <Card className="shadow">
              <Card.Header className="bg-white text-center py-4 border-bottom">
                <div className="mb-3 d-flex justify-content-center">
                  <ArcanumLogo style={{ height: '48px', width: 'auto' }} className="login-logo" />
                </div>
                <h3 className="mb-1 text-dark">
                  Customer Success Portal
                </h3>
                <small className="text-muted">
                  {passwordChangeRequired
                    ? 'Password Change Required'
                    : mfaSetupRequired
                      ? 'Set Up Your Authenticator'
                      : mfaCodeRequired
                        ? 'Multi‑Factor Authentication'
                        : 'Authentication Required'}
                </small>
              </Card.Header>

              <Card.Body className="p-4">
                {error && (
                  <Alert variant="danger" dismissible onClose={clearError}>
                    {error}
                  </Alert>
                )}


                <Form onSubmit={handleSubmit}>
                  {passwordChangeRequired ? (
                    // Password change form
                    <>
                      <Alert variant="info" className="mb-3">
                        <strong>Welcome, {passwordChangeRequired.username}!</strong>
                        <br />
                        You need to set a new password and provide your full name to continue.
                      </Alert>

                      <Form.Group className="mb-3">
                        <Form.Label>Full Name</Form.Label>
                        <div className="input-group">
                          <span className="input-group-text">
                            <Person />
                          </span>
                          <Form.Control
                            type="text"
                            name="fullName"
                            value={formData.fullName}
                            onChange={handleInputChange}
                            placeholder="Enter your full name"
                            required
                            disabled={loading}
                          />
                        </div>
                      </Form.Group>

                      <Form.Group className="mb-3">
                        <Form.Label>New Password</Form.Label>
                        <div className="input-group">
                          <span className="input-group-text">
                            <Lock />
                          </span>
                          <Form.Control
                            type="password"
                            name="newPassword"
                            value={formData.newPassword}
                            onChange={handleInputChange}
                            placeholder="Enter your new password"
                            required
                            disabled={loading}
                            minLength={8}
                          />
                        </div>
                        <Form.Text className="text-muted">
                          Must be at least 8 characters with uppercase, lowercase, and numbers.
                        </Form.Text>
                      </Form.Group>

                      <Form.Group className="mb-4">
                        <Form.Label>Confirm New Password</Form.Label>
                        <div className="input-group">
                          <span className="input-group-text">
                            <Lock />
                          </span>
                          <Form.Control
                            type="password"
                            name="confirmPassword"
                            value={formData.confirmPassword}
                            onChange={handleInputChange}
                            placeholder="Confirm your new password"
                            required
                            disabled={loading}
                            isInvalid={formData.confirmPassword !== '' && formData.newPassword !== formData.confirmPassword}
                          />
                          <Form.Control.Feedback type="invalid">
                            Passwords do not match.
                          </Form.Control.Feedback>
                        </div>
                      </Form.Group>

                      <div className="d-grid gap-2">
                        <Button
                          type="submit"
                          className="btn-login"
                          size="lg"
                          disabled={loading || !formData.fullName || !formData.newPassword || formData.newPassword !== formData.confirmPassword}
                        >
                          {loading ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-2" />
                              Updating Password...
                            </>
                          ) : (
                            'Set New Password'
                          )}
                        </Button>
                      </div>
                    </>
                  ) : mfaSetupRequired ? (
                    // MFA setup form
                    <>
                      <Alert variant="info" className="mb-3">
                        <strong>MFA is required for your account.</strong>
                        <br />
                        Add the account to your authenticator app using the code below, then enter a 6‑digit code to verify.
                      </Alert>

                      <Form.Group className="mb-3">
                        <Form.Label>Secret Key</Form.Label>
                        <div className="input-group">
                          <Form.Control
                            type="text"
                            value={mfaSetupRequired.secretCode}
                            readOnly
                          />
                        </div>
                        <Form.Text className="text-muted">
                          Add this key to Google Authenticator, 1Password, or Authy. If preferred, you can use this link: <a href={mfaSetupRequired.otpauthUrl}>otpauth://</a>
                        </Form.Text>
                      </Form.Group>

                      <Form.Group className="mb-4">
                        <Form.Label>Authentication Code</Form.Label>
                        <div className="input-group">
                          <span className="input-group-text">
                            <Lock />
                          </span>
                          <Form.Control
                            type="text"
                            name="mfaSetupCode"
                            value={formData.mfaSetupCode}
                            onChange={handleInputChange}
                            placeholder="Enter the 6‑digit code"
                            pattern="[0-9]*"
                            inputMode="numeric"
                            required
                            disabled={loading}
                          />
                        </div>
                      </Form.Group>

                      <div className="d-grid gap-2">
                        <Button
                          type="submit"
                          className="btn-login"
                          size="lg"
                          disabled={loading || !formData.mfaSetupCode}
                        >
                          {loading ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-2" />
                              Verifying...
                            </>
                          ) : (
                            'Verify and Continue'
                          )}
                        </Button>
                      </div>
                    </>
                  ) : mfaCodeRequired ? (
                    // MFA code prompt
                    <>
                      <Form.Group className="mb-4">
                        <Form.Label>Authentication Code</Form.Label>
                        <div className="input-group">
                          <span className="input-group-text">
                            <Lock />
                          </span>
                          <Form.Control
                            type="text"
                            name="mfaCode"
                            value={formData.mfaCode}
                            onChange={handleInputChange}
                            placeholder="Enter the 6‑digit code"
                            pattern="[0-9]*"
                            inputMode="numeric"
                            required
                            disabled={loading}
                          />
                        </div>
                      </Form.Group>

                      <div className="d-grid gap-2">
                        <Button
                          type="submit"
                          className="btn-login"
                          size="lg"
                          disabled={loading || !formData.mfaCode}
                        >
                          {loading ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-2" />
                              Verifying...
                            </>
                          ) : (
                            'Verify and Sign In'
                          )}
                        </Button>
                      </div>
                    </>
                  ) : (
                    // Regular login form
                    <>
                      <Form.Group className="mb-3">
                        <Form.Label>Email Address</Form.Label>
                        <div className="input-group">
                          <span className="input-group-text">
                            <Person />
                          </span>
                          <Form.Control
                            type="email"
                            name="username"
                            value={formData.username}
                            onChange={handleInputChange}
                            placeholder="Enter your email address"
                            required
                            disabled={loading}
                          />
                        </div>
                      </Form.Group>

                      <Form.Group className="mb-4">
                        <Form.Label>Password</Form.Label>
                        <div className="input-group">
                          <span className="input-group-text">
                            <Lock />
                          </span>
                          <Form.Control
                            type="password"
                            name="password"
                            value={formData.password}
                            onChange={handleInputChange}
                            placeholder="Enter your password"
                            required
                            disabled={loading}
                          />
                        </div>
                      </Form.Group>

                      <div className="d-grid gap-2">
                        <Button
                          type="submit"
                          className="btn-login"
                          size="lg"
                          disabled={loading || !formData.username || !formData.password}
                        >
                          {loading ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-2" />
                              Signing In...
                            </>
                          ) : (
                            'Sign In'
                          )}
                        </Button>
                      </div>

                      <div className="text-center mt-3">
                        <Button
                          variant="link"
                          onClick={() => navigate('/create-password?mode=reset')}
                          className="text-decoration-none p-0"
                          disabled={loading}
                        >
                          Forgot your password?
                        </Button>
                      </div>
                    </>
                  )}
                </Form>
              </Card.Body>

              <Card.Footer className="text-center text-muted">
                <small>
                  <Badge bg="info" className="me-1">POC</Badge>
                  Arcanum AI Customer Success Portal
                </small>
              </Card.Footer>
            </Card>
          </Col>
        </Row>
      </Container>
    </div>
  )
}

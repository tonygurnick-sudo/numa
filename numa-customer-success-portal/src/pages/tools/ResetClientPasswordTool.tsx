import { useState } from 'react';
import { Card, Form, Button, Alert, Row, Col } from 'react-bootstrap';
import { z } from 'zod';
import {
  CognitoIdentityProviderClient,
  AdminSetUserPasswordCommand,
  ListUserPoolsCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { Key } from 'react-bootstrap-icons';

import { useAssumeRole } from '@/hooks/useAssumeRole';
import { clientService } from '@/services/clientService';

const passwordResetSchema = z.object({
  clientName: z.string().min(1, 'Client is required'),
  username: z.string().email('Must be a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(256),
  isTemporary: z.boolean().default(true),
});

export default function ResetClientPasswordTool() {
  const [clientName, setClientName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isTemporary, setIsTemporary] = useState(true);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const { assumeRole } = useAssumeRole();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    setValidationErrors({});

    const formData = {
      clientName,
      username,
      password,
      isTemporary,
    };

    const parsed = passwordResetSchema.safeParse(formData);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const err of parsed.error.errors) {
        errs[String(err.path[0])] = err.message;
      }
      setValidationErrors(errs);
      setIsSubmitting(false);
      return;
    }

    try {
      // 1. Get client config to verify region and account ID
      const client = await clientService.getClient(parsed.data.clientName.trim());
      if (!client || !client.config) {
        throw new Error(`Could not find config for ${parsed.data.clientName}`);
      }

      const clientAccountId = client.config.clientAccountId;
      if (!clientAccountId || clientAccountId === 'unknown') {
        throw new Error(`Client ${parsed.data.clientName} does not have a valid linked AWS account ID.`);
      }

      const region = client.config.region || 'us-east-1';

      // 2. Assume role into the target client account
      const awsConfig = await assumeRole(clientAccountId, region);

      // 3. Find User Pool ID
      const cognito = new CognitoIdentityProviderClient(awsConfig);

      const listCmd = new ListUserPoolsCommand({ MaxResults: 60 });
      const poolsRes = await cognito.send(listCmd);
      const userPool = poolsRes.UserPools?.find(
        (p) => p.Name === `numa-${parsed.data.clientName}` || p.Name === parsed.data.clientName
      );

      if (!userPool?.Id) {
        throw new Error(`Could not locate Cognito User Pool for client ${parsed.data.clientName}`);
      }

      // 4. Reset password
      const setPasswordCmd = new AdminSetUserPasswordCommand({
        UserPoolId: userPool.Id,
        Username: parsed.data.username,
        Password: parsed.data.password,
        Permanent: !parsed.data.isTemporary,
      });

      await cognito.send(setPasswordCmd);
      setSuccess(`Successfully reset password for ${parsed.data.username} in ${parsed.data.clientName}!`);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Row className="justify-content-center">
      <Col xs={12} md={10} lg={8} xl={6}>
        <Card className="border-0 shadow-sm">
          <Card.Body className="p-4">
            <div className="d-flex align-items-center mb-4">
              <Key size={24} className="text-primary me-2" />
              <h2 className="h4 mb-0">Reset Client Password</h2>
            </div>

            <p className="text-muted mb-4">
              Administratively forcibly set a user's password within a client environment without requiring email
              verification.
            </p>

            {error && <Alert variant="danger">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <Form onSubmit={onSubmit}>
              <Form.Group className="mb-3">
                <Form.Label>Client Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g. arcanum-demo"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  isInvalid={!!validationErrors.clientName}
                />
                <Form.Control.Feedback type="invalid">{validationErrors.clientName}</Form.Control.Feedback>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Username / Email</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g. user@client.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  isInvalid={!!validationErrors.username}
                />
                <Form.Control.Feedback type="invalid">{validationErrors.username}</Form.Control.Feedback>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>New Password</Form.Label>
                <Form.Control
                  type="password"
                  placeholder="Ensure standard Cognito complexity"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  isInvalid={!!validationErrors.password}
                />
                <Form.Control.Feedback type="invalid">{validationErrors.password}</Form.Control.Feedback>
              </Form.Group>

              <Form.Group className="mb-4">
                <Form.Check
                  type="checkbox"
                  id="isTemporaryCheckbox"
                  label="Set as Temporary Password (Forces user to change password on next login)"
                  checked={isTemporary}
                  onChange={(e) => setIsTemporary(e.target.checked)}
                />
              </Form.Group>

              <div className="d-flex justify-content-end">
                <Button type="submit" variant="primary" disabled={isSubmitting || !clientName}>
                  {isSubmitting ? 'Resetting...' : 'Reset Password'}
                </Button>
              </div>
            </Form>
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
}

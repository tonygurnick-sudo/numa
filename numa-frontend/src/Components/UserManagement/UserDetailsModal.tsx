import React, { useState } from 'react';
import { Modal, Button, Alert, Badge, Row, Col, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { getUserStatusBadgeVariant, getUserStatusLabel } from './userStatusUtils';
import { useAlert } from '../../Providers/ConfirmContext';

export interface User {
  username: string;
  // Optional: SSO/federated users can have no email attribute when the IdP omits the email
  // claim. Callers must guard accesses (e.g. `user.email?.toLowerCase()`). (BUG-382/383)
  email?: string;
  enabled: boolean;
  status: string;
  created: Date;
  groups: string[];
}

interface UserDetailsModalProps {
  show: boolean;
  user: User | null;
  currentUserSub: string | undefined;
  mfaEnabled?: boolean;
  onHide: () => void;
  onPromoteToAdmin: (user: User) => Promise<void>;
  onDemoteFromAdmin: (username: string) => Promise<void>;
  onDeleteUser: (user: User) => Promise<void>;
  onResetMfa?: (user: User) => Promise<void>;
  // Billing access (Numa Credit System) — only shown when the credit view is enabled. Lets a billing
  // admin grant/revoke the credit-visibility role on another admin (server-enforced).
  showBillingAccess?: boolean;
  callerIsBillingAdmin?: boolean;
  isTargetBillingAdmin?: boolean;
  onSetBillingAdmin?: (user: User, grant: boolean) => Promise<void>;
}

type ModalView = 'details' | 'promote' | 'delete' | 'mfa-reset';

export function UserDetailsModal({
  show,
  user,
  currentUserSub,
  mfaEnabled = false,
  onHide,
  onPromoteToAdmin,
  onDemoteFromAdmin,
  onDeleteUser,
  onResetMfa,
  showBillingAccess = false,
  callerIsBillingAdmin = false,
  isTargetBillingAdmin = false,
  onSetBillingAdmin,
}: UserDetailsModalProps): React.JSX.Element {
  const { t } = useTranslation('userManagement');
  const showAlert = useAlert();
  const [view, setView] = useState<ModalView>('details');
  const [isProcessing, setIsProcessing] = useState(false);
  const [mfaResetSuccess, setMfaResetSuccess] = useState(false);
  const [mfaResetError, setMfaResetError] = useState<string | null>(null);

  if (!user) return <></>;

  const isAdmin = user.groups?.includes('admin');
  const isCurrentUser = user.username === currentUserSub;
  const isSystemUser = user.email?.includes('numa-system-user');
  const statusLabel = getUserStatusLabel(t, user.status);

  const handleClose = () => {
    if (isProcessing) return;
    setView('details');
    setMfaResetSuccess(false);
    setMfaResetError(null);
    onHide();
  };

  const handleRoleChange = async (newRole: string) => {
    if (isProcessing) return;

    if (newRole === 'admin' && !isAdmin) {
      setView('promote');
    } else if (newRole === 'standard' && isAdmin) {
      setIsProcessing(true);
      try {
        await onDemoteFromAdmin(user.username);
        handleClose();
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const confirmPromotion = async () => {
    setIsProcessing(true);
    try {
      await onPromoteToAdmin(user);
      handleClose();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBillingToggle = async (grant: boolean) => {
    if (isProcessing || !onSetBillingAdmin) return;
    setIsProcessing(true);
    try {
      await onSetBillingAdmin(user, grant);
    } catch {
      // Server enforces caller-is-billing-admin + last-admin lockout; surface a single clear note.
      void showAlert({
        message: t('details.billing.error', {
          defaultValue:
            "Couldn't update billing access. Only a billing admin can change this, and the last billing admin can't be removed.",
        }),
        variant: 'warning',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmDelete = async () => {
    setIsProcessing(true);
    try {
      await onDeleteUser(user);
      handleClose();
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmMfaReset = async () => {
    if (!onResetMfa) return;
    setIsProcessing(true);
    setMfaResetError(null);
    try {
      await onResetMfa(user);
      setMfaResetSuccess(true);
      setView('details');
    } catch (err) {
      setMfaResetError(err instanceof Error ? err.message : t('details.mfa.resetError'));
    } finally {
      setIsProcessing(false);
    }
  };

  const renderDetailsView = () => (
    <>
      <Modal.Header closeButton={!isProcessing}>
        <Modal.Title>{t('details.title')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {mfaResetSuccess && (
          <Alert variant="success" dismissible onClose={() => setMfaResetSuccess(false)}>
            {t('details.mfa.resetSuccess')}
          </Alert>
        )}

        {mfaResetError && (
          <Alert variant="danger" dismissible onClose={() => setMfaResetError(null)}>
            {mfaResetError}
          </Alert>
        )}

        <div className="mb-4">
          <Row className="mb-3">
            <Col sm={4} className="text-muted">
              {t('details.fields.email')}
            </Col>
            <Col sm={8}>
              <strong>{user.email}</strong>
              {isSystemUser && <small className="ms-2 text-muted fst-italic">{t('details.systemBadge')}</small>}
            </Col>
          </Row>
          <Row className="mb-3">
            <Col sm={4} className="text-muted">
              {t('details.fields.status')}
            </Col>
            <Col sm={8}>
              <Badge bg={getUserStatusBadgeVariant(user.enabled, user.status)}>{statusLabel}</Badge>
            </Col>
          </Row>
          <Row className="mb-3">
            <Col sm={4} className="text-muted">
              {t('details.fields.account')}
            </Col>
            <Col sm={8}>
              <Badge bg={user.enabled ? 'success' : 'danger'}>
                {user.enabled ? t('details.account.enabled') : t('details.account.disabled')}
              </Badge>
            </Col>
          </Row>
          <Row className="mb-3">
            <Col sm={4} className="text-muted">
              {t('details.fields.created')}
            </Col>
            <Col sm={8}>
              {new Date(user.created).toLocaleDateString(i18n.language, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Col>
          </Row>
        </div>

        {!isSystemUser && !isCurrentUser && (
          <>
            <hr />
            <h6 className="mb-3">{t('details.permissions.title')}</h6>
            <Form.Group className="mb-3">
              <Form.Label>{t('details.permissions.roleLabel')}</Form.Label>
              <Form.Select
                value={isAdmin ? 'admin' : 'standard'}
                onChange={(e) => handleRoleChange(e.target.value)}
                disabled={isProcessing}
              >
                <option value="standard">{t('roles.standard')}</option>
                <option value="admin">{t('roles.admin')}</option>
              </Form.Select>
              <Form.Text className="text-muted">
                {isAdmin ? t('details.permissions.descriptions.admin') : t('details.permissions.descriptions.standard')}
              </Form.Text>
            </Form.Group>

            {showBillingAccess && isAdmin && (
              <Form.Group className="mb-3">
                <div
                  className="p-3"
                  style={{ border: '1px solid #e4e4e7', borderRadius: '10px', background: '#fafafa' }}
                >
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <i
                      className="bi bi-coin"
                      style={{ color: 'var(--brand-primary, var(--color-primary))' }}
                      aria-hidden="true"
                    />
                    <span className="fw-semibold">
                      {t('details.billing.title', { defaultValue: 'Billing access' })}
                    </span>
                    {isTargetBillingAdmin && (
                      <Badge bg="info-subtle" text="info-emphasis" className="border ms-auto">
                        {t('details.billing.badge', { defaultValue: 'Billing admin' })}
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant={isTargetBillingAdmin ? 'outline-danger' : 'outline-primary'}
                    size="sm"
                    onClick={() => handleBillingToggle(!isTargetBillingAdmin)}
                    disabled={isProcessing || !callerIsBillingAdmin}
                  >
                    {isTargetBillingAdmin
                      ? t('details.billing.revoke', { defaultValue: 'Revoke billing access' })
                      : t('details.billing.grant', { defaultValue: 'Grant billing access' })}
                  </Button>
                  <Form.Text className="text-muted d-block mt-2">
                    {callerIsBillingAdmin
                      ? t('details.billing.help', {
                          defaultValue:
                            'Billing admins can see credit & cost information. Only a billing admin can grant this.',
                        })
                      : t('details.billing.onlyBillingAdmin', {
                          defaultValue: 'Only a billing admin can change billing access.',
                        })}
                  </Form.Text>
                </div>
              </Form.Group>
            )}

            {mfaEnabled && onResetMfa && (
              <>
                <hr />
                <h6 className="mb-3">{t('details.mfa.title')}</h6>
                <Button
                  variant="outline-warning"
                  size="sm"
                  onClick={() => setView('mfa-reset')}
                  disabled={isProcessing}
                >
                  {t('details.mfa.resetButton')}
                </Button>
              </>
            )}
          </>
        )}

        {isCurrentUser && (
          <Alert variant="info" className="mb-0">
            {t('details.currentUserNotice')}
          </Alert>
        )}

        {isSystemUser && (
          <Alert variant="secondary" className="mb-0">
            {t('details.systemUserNotice')}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        {!isSystemUser && !isCurrentUser && (
          <>
            {isAdmin ? (
              <Button
                variant="secondary"
                onClick={() => {
                  // Show admin deletion warning
                  void showAlert({ message: t('details.adminDeleteBlocked'), variant: 'warning' });
                }}
              >
                {t('actions.deleteUser')}
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setView('delete')} disabled={isProcessing}>
                {t('actions.deleteUser')}
              </Button>
            )}
          </>
        )}
        <Button variant="primary" onClick={handleClose} disabled={isProcessing}>
          {t('actions.close')}
        </Button>
      </Modal.Footer>
    </>
  );

  const renderPromoteView = () => (
    <>
      <Modal.Header closeButton={!isProcessing}>
        <Modal.Title>{t('promote.title')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="warning" className="mb-4">
          <Alert.Heading className="h6">{t('promote.warningTitle')}</Alert.Heading>
          {t('promote.warningBodyPrefix')} <strong>{user.email}</strong> {t('promote.warningBodySuffix')}
        </Alert>

        <h6 className="mb-3">{t('promote.privilegesTitle')}</h6>
        <Row>
          <Col md={6}>
            <h6 className="text-primary mb-2">{t('promote.sections.userManagement')}</h6>
            <ul className="small mb-3">
              <li>{t('promote.bullets.userManagement.create')}</li>
              <li>{t('promote.bullets.userManagement.delete')}</li>
              <li>{t('promote.bullets.userManagement.roleChanges')}</li>
              <li>{t('promote.bullets.userManagement.view')}</li>
            </ul>

            <h6 className="text-primary mb-2">{t('promote.sections.dataManagement')}</h6>
            <ul className="small mb-3">
              <li>{t('promote.bullets.dataManagement.upload')}</li>
              <li>{t('promote.bullets.dataManagement.delete')}</li>
              <li>{t('promote.bullets.dataManagement.sources')}</li>
              <li>{t('promote.bullets.dataManagement.indexing')}</li>
            </ul>
          </Col>
          <Col md={6}>
            <h6 className="text-primary mb-2">{t('promote.sections.systemConfiguration')}</h6>
            <ul className="small mb-3">
              <li>{t('promote.bullets.systemConfiguration.settings')}</li>
              <li>{t('promote.bullets.systemConfiguration.integrations')}</li>
              <li>{t('promote.bullets.systemConfiguration.tools')}</li>
              <li>{t('promote.bullets.systemConfiguration.logs')}</li>
            </ul>
          </Col>
        </Row>

        <Alert variant="info" className="mt-3">
          <strong>{t('promote.noteLabel')}</strong> {t('promote.noteBody')}
        </Alert>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setView('details')} disabled={isProcessing}>
          {t('actions.cancel')}
        </Button>
        <Button variant="primary" onClick={confirmPromotion} disabled={isProcessing}>
          {isProcessing ? t('promote.granting') : t('promote.confirm')}
        </Button>
      </Modal.Footer>
    </>
  );

  const renderDeleteView = () => (
    <>
      <Modal.Header closeButton={!isProcessing}>
        <Modal.Title>{t('delete.title')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="danger" className="mb-4">
          <Alert.Heading className="h6">{t('delete.warningTitle')}</Alert.Heading>
          {t('delete.warningBodyPrefix')} <strong>{user.email}</strong> {t('delete.warningBodySuffix')}
        </Alert>

        <h6 className="mb-3">{t('delete.effectsTitle')}</h6>
        <Row>
          <Col md={6}>
            <h6 className="text-danger mb-2">{t('delete.sections.accountAccess')}</h6>
            <ul className="small mb-3">
              <li>{t('delete.bullets.accountAccess.loseAccess')}</li>
              <li>{t('delete.bullets.accountAccess.credentials')}</li>
              <li>{t('delete.bullets.accountAccess.recovery')}</li>
            </ul>

            <h6 className="text-danger mb-2">{t('delete.sections.dataImpact')}</h6>
            <ul className="small mb-3">
              <li>{t('delete.bullets.dataImpact.chatHistory')}</li>
              <li>{t('delete.bullets.dataImpact.activityLogs')}</li>
              <li>{t('delete.bullets.dataImpact.uploads')}</li>
            </ul>
          </Col>
          <Col md={6}>
            <h6 className="text-warning mb-2">{t('delete.sections.immediateEffects')}</h6>
            <ul className="small mb-3">
              <li>{t('delete.bullets.immediateEffects.groups')}</li>
              <li>{t('delete.bullets.immediateEffects.sessions')}</li>
              <li>{t('delete.bullets.immediateEffects.audit')}</li>
            </ul>

            <h6 className="text-info mb-2">{t('delete.sections.recoveryOptions')}</h6>
            <ul className="small mb-3">
              <li>{t('delete.bullets.recoveryOptions.restore')}</li>
              <li>{t('delete.bullets.recoveryOptions.newAccount')}</li>
              <li>{t('delete.bullets.recoveryOptions.permissions')}</li>
            </ul>
          </Col>
        </Row>

        <Alert variant="warning" className="mt-3">
          <strong>{t('delete.beforeLabel')}</strong> {t('delete.beforeBody')}
        </Alert>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setView('details')} disabled={isProcessing}>
          {t('actions.cancel')}
        </Button>
        <Button variant="danger" onClick={confirmDelete} disabled={isProcessing}>
          {isProcessing ? t('delete.deleting') : t('delete.confirm')}
        </Button>
      </Modal.Footer>
    </>
  );

  const renderMfaResetView = () => (
    <>
      <Modal.Header closeButton={!isProcessing}>
        <Modal.Title>{t('details.mfa.resetConfirmTitle')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="warning" className="mb-3">
          {t('details.mfa.resetConfirmBody', { email: user.email })}
        </Alert>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setView('details')} disabled={isProcessing}>
          {t('actions.cancel')}
        </Button>
        <Button variant="warning" onClick={confirmMfaReset} disabled={isProcessing}>
          {isProcessing ? t('details.mfa.resetting') : t('details.mfa.resetConfirmAction')}
        </Button>
      </Modal.Footer>
    </>
  );

  return (
    <Modal show={show} onHide={handleClose} backdrop={isProcessing ? 'static' : true} size="lg">
      {view === 'details' && renderDetailsView()}
      {view === 'promote' && renderPromoteView()}
      {view === 'delete' && renderDeleteView()}
      {view === 'mfa-reset' && renderMfaResetView()}
    </Modal>
  );
}

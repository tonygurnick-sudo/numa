import { useState, useEffect, useCallback, useMemo } from 'react';
import { Form, Badge, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { getAllTimezones } from '../../utils/timezoneUtils';
import { UsersService, type WorkspaceUser } from '../../Services/UsersService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';

type WorkflowStepPromptProps = {
  name: string;
  onNameChange: (value: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  maxRuns: number;
  onMaxRunsChange: (value: number) => void;
  emailNotifications: boolean;
  onEmailNotificationsChange: (value: boolean) => void;
  notificationEmails: string[];
  onNotificationEmailsChange: (emails: string[]) => void;
  currentUserEmail?: string;
  timezone: string;
  onTimezoneChange: (value: string) => void;
  submitting: boolean;
  nameError?: string;
};

export const WorkflowStepPrompt = ({
  name,
  onNameChange,
  prompt,
  onPromptChange,
  maxRuns,
  onMaxRunsChange,
  emailNotifications,
  onEmailNotificationsChange,
  notificationEmails,
  onNotificationEmailsChange,
  currentUserEmail,
  timezone,
  onTimezoneChange,
  submitting,
  nameError,
}: WorkflowStepPromptProps) => {
  const { t } = useTranslation('automations');
  const { numaGet } = useNumaRequest();
  const timezones = getAllTimezones();

  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  // Load workspace users when email notifications are enabled
  useEffect(() => {
    if (!emailNotifications) return;
    let cancelled = false;
    const load = async () => {
      setUsersLoading(true);
      try {
        const users = await UsersService.list(numaGet);
        if (!cancelled) setWorkspaceUsers(users);
      } catch (err) {
        console.error('[WorkflowStepPrompt] Failed to load users:', err);
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [emailNotifications, numaGet]);

  const filteredUsers = useMemo(() => {
    if (!searchQuery) return workspaceUsers;
    const q = searchQuery.toLowerCase();
    return workspaceUsers.filter((u) => u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q));
  }, [workspaceUsers, searchQuery]);

  const addEmail = useCallback(
    (email: string) => {
      if (!notificationEmails.includes(email)) {
        onNotificationEmailsChange([...notificationEmails, email]);
      }
      setSearchQuery('');
      setShowDropdown(false);
    },
    [notificationEmails, onNotificationEmailsChange]
  );

  const removeEmail = useCallback(
    (email: string) => {
      onNotificationEmailsChange(notificationEmails.filter((e) => e !== email));
    },
    [notificationEmails, onNotificationEmailsChange]
  );

  return (
    <div className="workflow-step">
      <h5 className="mb-1">{t('prompt.title')}</h5>
      <p className="text-muted mb-4">{t('prompt.subtitle')}</p>

      <div className="d-flex flex-column gap-4">
        {/* Name */}
        <div>
          <Form.Label>{t('prompt.name.label')}</Form.Label>
          <Form.Control
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t('prompt.name.placeholder')}
            disabled={submitting}
            isInvalid={!!nameError}
          />
          {nameError && <Form.Control.Feedback type="invalid">{nameError}</Form.Control.Feedback>}
        </div>

        {/* Instructions */}
        <div>
          <Form.Label>{t('prompt.instructions.label')}</Form.Label>
          <Form.Control
            as="textarea"
            rows={4}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder={t('prompt.instructions.placeholder')}
            disabled={submitting}
          />
          <Form.Text muted>{t('prompt.instructions.help')}</Form.Text>
        </div>

        {/* Max runs */}
        <div>
          <Form.Label>{t('prompt.maxRuns.label')}</Form.Label>
          <div className="d-flex align-items-center gap-3">
            <Form.Control
              type="number"
              min={0}
              max={10000}
              value={maxRuns}
              onChange={(e) => onMaxRunsChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
              disabled={submitting}
              style={{ width: 120 }}
            />
            <span className="text-muted small">{maxRuns === 0 ? t('prompt.maxRuns.unlimited') : ''}</span>
          </div>
          <Form.Text muted>{t('prompt.maxRuns.help')}</Form.Text>
        </div>

        {/* Email notifications */}
        <div>
          <Form.Check
            type="switch"
            id="email-notifications"
            label={t('prompt.emailNotifications.label')}
            checked={emailNotifications}
            onChange={(e) => onEmailNotificationsChange(e.target.checked)}
            disabled={submitting}
          />

          {/* Multi-email picker */}
          {emailNotifications && (
            <div className="mt-3 ms-1">
              <Form.Label className="small">{t('prompt.emailNotifications.recipientsLabel')}</Form.Label>

              {/* Selected emails as chips */}
              {notificationEmails.length > 0 && (
                <div className="d-flex flex-wrap gap-1 mb-2">
                  {notificationEmails.map((email) => (
                    <Badge
                      key={email}
                      bg="light"
                      text="dark"
                      className="d-flex align-items-center gap-1 px-2 py-1"
                      style={{ fontSize: '0.8rem', border: '1px solid #dee2e6' }}
                    >
                      {email}
                      {email === currentUserEmail && (
                        <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                          (you)
                        </span>
                      )}
                      <X size={12} style={{ cursor: 'pointer', marginLeft: 2 }} onClick={() => removeEmail(email)} />
                    </Badge>
                  ))}
                </div>
              )}

              {/* Search input */}
              <div className="position-relative">
                <Form.Control
                  type="text"
                  size="sm"
                  placeholder={t('prompt.emailNotifications.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                  disabled={submitting || usersLoading}
                />

                {usersLoading && (
                  <div className="text-muted small mt-1 d-flex align-items-center gap-1">
                    <Spinner animation="border" size="sm" />
                    {t('prompt.emailNotifications.loadingUsers')}
                  </div>
                )}

                {/* Dropdown */}
                {showDropdown && !usersLoading && filteredUsers.length > 0 && (
                  <div
                    className="position-absolute w-100 bg-white border rounded shadow-sm"
                    style={{ top: '100%', zIndex: 10, maxHeight: 200, overflowY: 'auto' }}
                  >
                    {filteredUsers
                      .filter((u) => !notificationEmails.includes(u.email))
                      .map((user) => (
                        <div
                          key={user.email}
                          className="px-3 py-2 d-flex justify-content-between align-items-center"
                          style={{ cursor: 'pointer', fontSize: '0.85rem' }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            addEmail(user.email);
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8f9fa')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '')}
                        >
                          <span className="fw-medium">{user.name}</span>
                          <span className="text-muted small">{user.email}</span>
                        </div>
                      ))}
                    {filteredUsers.filter((u) => !notificationEmails.includes(u.email)).length === 0 && (
                      <div className="px-3 py-2 text-muted small">{t('prompt.emailNotifications.noUsers')}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Timezone */}
        <div>
          <Form.Label>{t('prompt.timezone.label')}</Form.Label>
          <Form.Select value={timezone} onChange={(e) => onTimezoneChange(e.target.value)} disabled={submitting}>
            {timezones.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Form.Select>
        </div>
      </div>
    </div>
  );
};

export default WorkflowStepPrompt;

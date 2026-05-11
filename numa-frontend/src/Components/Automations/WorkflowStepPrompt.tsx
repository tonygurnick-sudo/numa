import { useState, useEffect, useCallback, useMemo } from 'react';
import { Form, Badge, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { getAllTimezones } from '../../utils/timezoneUtils';
import { UsersService, type WorkspaceUser } from '../../Services/UsersService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { ScheduleService, type QuotaSummary } from '../../Services/ScheduleService';
import { projectMonthlyRuns } from '../../utils/cronProjection';

type WorkflowStepPromptProps = {
  name: string;
  onNameChange: (value: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  maxRuns: number;
  onMaxRunsChange: (value: number) => void;
  notificationEmails: string[];
  onNotificationEmailsChange: (emails: string[]) => void;
  currentUserEmail?: string;
  timezone: string;
  onTimezoneChange: (value: string) => void;
  submitting: boolean;
  nameError?: string;
  /**
   * Cron expression from the schedule step. Used to compute the inline
   * "up to N would fit" hint next to the Max-runs field — only shown when
   * the raw cron projection would breach a remaining cap.
   */
  cronExpression?: string;
};

export const WorkflowStepPrompt = ({
  name,
  onNameChange,
  prompt,
  onPromptChange,
  maxRuns,
  onMaxRunsChange,
  notificationEmails,
  onNotificationEmailsChange,
  currentUserEmail,
  timezone,
  onTimezoneChange,
  submitting,
  nameError,
  cronExpression,
}: WorkflowStepPromptProps) => {
  const { t } = useTranslation('automations');
  const { numaGet } = useNumaRequest();
  const timezones = getAllTimezones();

  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [quotaSummary, setQuotaSummary] = useState<QuotaSummary | null>(null);

  // Load workspace users for the recipient picker.
  useEffect(() => {
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
  }, [numaGet]);

  // Quota summary for the "up to N would fit" hint next to Max-runs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ScheduleService.quotaSummary(numaGet);
        if (!cancelled) setQuotaSummary(res);
      } catch {
        // Silent — the hint is purely advisory.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  // "Up to N would fit your remaining quota" — only shown when the raw
  // cron projection would breach a remaining cap. binding cap = whichever
  // of user/company remaining fills up first.
  const fitHint = useMemo<string | null>(() => {
    if (!quotaSummary || !cronExpression) return null;
    const q = quotaSummary.quotas;
    const rawProjected = projectMonthlyRuns(cronExpression);
    const userRemaining = Math.max(0, q.maxRunsPerUserPerMonth - quotaSummary.user.runsPerMonth);
    const companyRemaining = Math.max(0, q.maxRunsPerCompanyPerMonth - quotaSummary.company.runsPerMonth);
    const bindingRemaining = Math.min(userRemaining, companyRemaining);
    // Only show the tip when the cron alone would exceed the binding cap —
    // otherwise Max-runs is purely a defensive limit and there's nothing
    // useful to suggest.
    if (rawProjected <= bindingRemaining) return null;
    if (bindingRemaining === 0) {
      return `Your remaining quota this month is 0 runs — pause an existing schedule to free up room.`;
    }
    const scopeLabel =
      bindingRemaining === companyRemaining && companyRemaining < userRemaining ? 'company' : 'personal';
    return `Set this to ${bindingRemaining.toLocaleString()} or less to fit your remaining ${scopeLabel} quota this month.`;
  }, [quotaSummary, cronExpression]);

  // Visual cue when the user's typed value still wouldn't fit.
  const userExceedsBinding = useMemo<boolean>(() => {
    if (!quotaSummary || maxRuns <= 0) return false;
    const q = quotaSummary.quotas;
    const userRemaining = Math.max(0, q.maxRunsPerUserPerMonth - quotaSummary.user.runsPerMonth);
    const companyRemaining = Math.max(0, q.maxRunsPerCompanyPerMonth - quotaSummary.company.runsPerMonth);
    return maxRuns > Math.min(userRemaining, companyRemaining);
  }, [quotaSummary, maxRuns]);

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
      // The creator's email is locked — they always receive notifications.
      if (email === currentUserEmail) return;
      onNotificationEmailsChange(notificationEmails.filter((e) => e !== email));
    },
    [notificationEmails, onNotificationEmailsChange, currentUserEmail]
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

        {/* Max runs — capped at 100 for the internal-only rollout. Productionising
            this (raising the cap, per-customer overrides) is tracked separately. */}
        <div>
          <Form.Label>{t('prompt.maxRuns.label')}</Form.Label>
          <div className="d-flex align-items-center gap-3">
            <Form.Control
              type="number"
              min={1}
              max={100}
              value={maxRuns || 100}
              onChange={(e) => {
                const parsed = parseInt(e.target.value, 10);
                if (Number.isNaN(parsed)) return;
                onMaxRunsChange(Math.min(100, Math.max(1, parsed)));
              }}
              disabled={submitting}
              style={{ width: 120 }}
              isInvalid={userExceedsBinding}
            />
          </div>
          <Form.Text muted>{t('prompt.maxRuns.help')}</Form.Text>
          {fitHint && (
            <div className="small mt-1 text-warning-emphasis">
              <i className="bi bi-info-circle me-1" />
              {fitHint}
            </div>
          )}
        </div>

        {/* Email notifications — always on; admin chooses recipients (defaults to creator). */}
        <div>
          <Form.Label>{t('prompt.emailNotifications.label')}</Form.Label>
          <div>
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
                        {t('labels.you', '(you, required)')}
                      </span>
                    )}
                    {email !== currentUserEmail && (
                      <X size={12} style={{ cursor: 'pointer', marginLeft: 2 }} onClick={() => removeEmail(email)} />
                    )}
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

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal, Form, Button, Row, Col, Alert, Spinner, Nav } from 'react-bootstrap';
import { ScheduleService } from '../../Services/ScheduleService';
import type { AgentSchedule, CreateAgentSchedulePayload } from '../../types/agentSchedules';
import type { EventTypeFilter } from './CalendarToolbar';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import { getAllTimezones } from '../../utils/timezoneUtils';

interface ScheduleModalProps {
  show: boolean;
  onHide: () => void;
  onScheduleCreated?: (schedule: AgentSchedule) => void;
  onScheduleUpdated?: (schedule: AgentSchedule) => void;
  editSchedule?: AgentSchedule | null;
  initialEventType?: EventTypeFilter;
  initialDate?: Date;
  initialTime?: string;
}

interface FormData {
  eventType: EventTypeFilter;
  label: string;
  cronExpression: string;
  timezone: string;
  // Agent-specific fields
  agentId: string;
  agentTitle: string;
  conversationId: string;
  promptText: string;
  // Application-specific fields
  appId: string;
  inputConfig: Record<string, unknown>;
  // Data sync-specific fields
  sourceType: 'knowledge_base' | 's3' | 'api';
  sourceConfig: Record<string, unknown>;
}

const DEFAULT_FORM_DATA: FormData = {
  eventType: 'agent',
  label: '',
  cronExpression: 'cron(0 9 * * ? *)', // Daily at 9 AM
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  agentId: '',
  agentTitle: '',
  conversationId: '',
  promptText: '',
  appId: '',
  inputConfig: {},
  sourceType: 'knowledge_base',
  sourceConfig: {},
};

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  show,
  onHide,
  onScheduleCreated,
  onScheduleUpdated,
  editSchedule,
  initialEventType = 'agent',
  initialDate,
  initialTime,
}) => {
  const { numaPost, numaPut } = useNumaRequest();
  const { t } = useTranslation('agents');
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM_DATA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EventTypeFilter>(initialEventType);
  const commonCronExpressions = useMemo(
    () => [
      { label: t('scheduling.scheduleModal.commonCron.hourly'), value: 'cron(0 * * * ? *)' },
      { label: t('scheduling.scheduleModal.commonCron.dailyMorning'), value: 'cron(0 9 * * ? *)' },
      { label: t('scheduling.scheduleModal.commonCron.dailyEvening'), value: 'cron(0 18 * * ? *)' },
      { label: t('scheduling.scheduleModal.commonCron.weeklyMonday'), value: 'cron(0 9 ? * MON *)' },
      { label: t('scheduling.scheduleModal.commonCron.weeklyFriday'), value: 'cron(0 17 ? * FRI *)' },
      { label: t('scheduling.scheduleModal.commonCron.monthlyFirst'), value: 'cron(0 9 1 * ? *)' },
    ],
    [t]
  );
  const availableApps = useMemo(
    () => [
      { id: 'document-summariser', name: t('scheduling.scheduleModal.apps.documentSummariser') },
      { id: 'policy-builder', name: t('scheduling.scheduleModal.apps.policyBuilder') },
      { id: 'candidate-screening', name: t('scheduling.scheduleModal.apps.candidateScreening') },
      { id: 'financial-analysis', name: t('scheduling.scheduleModal.apps.financialAnalysis') },
    ],
    [t]
  );

  const isEditing = Boolean(editSchedule);

  // Initialize form data
  useEffect(() => {
    if (editSchedule) {
      setFormData({
        eventType: editSchedule.eventType,
        label: editSchedule.label || '',
        cronExpression: editSchedule.cronExpression,
        timezone: editSchedule.timezone,
        agentId: editSchedule.agentId,
        agentTitle: editSchedule.agentTitle || '',
        conversationId: editSchedule.conversationId,
        promptText: editSchedule.promptText,
        appId: '', // Not supported yet
        inputConfig: {},
        sourceType: 'knowledge_base',
        sourceConfig: {},
      });
      setActiveTab(editSchedule.eventType);
    } else {
      setFormData({
        ...DEFAULT_FORM_DATA,
        eventType: initialEventType,
      });
      setActiveTab(initialEventType);

      // Set initial time if provided
      if (initialDate && initialTime) {
        const hour = parseInt(initialTime.split(':')[0]);
        const minute = parseInt(initialTime.split(':')[1] || '0');
        const cronExpr = `cron(${minute} ${hour} * * ? *)`;
        setFormData((prev) => ({ ...prev, cronExpression: cronExpr }));
      }
    }
  }, [editSchedule, initialEventType, initialDate, initialTime]);

  const handleInputChange = useCallback((field: keyof FormData, value: FormData[keyof FormData]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }, []);

  const handleEventTypeChange = useCallback((eventType: EventTypeFilter) => {
    setActiveTab(eventType);
    setFormData((prev) => ({ ...prev, eventType }));
  }, []);

  const validateForm = useCallback((): string | null => {
    if (!formData.label.trim()) {
      return t('scheduling.scheduleModal.validation.label');
    }
    if (!formData.cronExpression.trim()) {
      return t('scheduling.scheduleModal.validation.cron');
    }
    if (!formData.timezone.trim()) {
      return t('scheduling.scheduleModal.validation.timezone');
    }

    switch (formData.eventType) {
      case 'agent':
        if (!formData.agentId.trim()) {
          return t('scheduling.scheduleModal.validation.agentId');
        }
        if (!formData.promptText.trim()) {
          return t('scheduling.scheduleModal.validation.promptText');
        }
        if (!formData.conversationId.trim()) {
          return t('scheduling.scheduleModal.validation.conversationId');
        }
        break;
      case 'application':
        if (!formData.appId.trim()) {
          return t('scheduling.scheduleModal.validation.appId');
        }
        break;
      case 'data_sync':
        if (!formData.sourceType) {
          return t('scheduling.scheduleModal.validation.sourceType');
        }
        break;
    }

    return null;
  }, [formData, t]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const validationError = validateForm();
      if (validationError) {
        setError(validationError);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const payload: CreateAgentSchedulePayload = {
          label: formData.label,
          cronExpression: formData.cronExpression,
          timezone: formData.timezone,
          agentId: formData.agentId,
          agentTitle: formData.agentTitle,
          conversationId: formData.conversationId,
          promptText: formData.promptText,
        };

        let result: AgentSchedule;

        if (isEditing && editSchedule) {
          // TODO: Implement update functionality
          throw new Error(t('scheduling.scheduleModal.errors.editNotImplemented'));
        } else {
          result = await ScheduleService.create(numaPost, payload);
        }

        if (isEditing && onScheduleUpdated) {
          onScheduleUpdated(result);
        } else if (onScheduleCreated) {
          onScheduleCreated(result);
        }

        onHide();
      } catch (err) {
        console.error('Failed to save schedule:', err);
        setError((err as Error)?.message || t('scheduling.scheduleModal.errors.save'));
      } finally {
        setLoading(false);
      }
    },
    [
      formData,
      validateForm,
      isEditing,
      editSchedule,
      numaPost,
      numaPut,
      onScheduleCreated,
      onScheduleUpdated,
      onHide,
      t,
    ]
  );

  const handleClose = useCallback(() => {
    setFormData(DEFAULT_FORM_DATA);
    setError(null);
    setLoading(false);
    onHide();
  }, [onHide]);

  return (
    <Modal show={show} onHide={handleClose} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>
          {isEditing ? t('scheduling.scheduleModal.title.edit') : t('scheduling.scheduleModal.title.create')}
        </Modal.Title>
      </Modal.Header>

      <Form onSubmit={handleSubmit}>
        <Modal.Body>
          {error && (
            <Alert variant="danger" dismissible onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Event Type Selection */}
          <div className="mb-4">
            <Form.Label className="fw-bold">{t('scheduling.scheduleModal.eventType.label')}</Form.Label>
            <Nav variant="pills" className="mt-2">
              <Nav.Item>
                <Nav.Link active={activeTab === 'agent'} onClick={() => handleEventTypeChange('agent')}>
                  <Bot size={16} className="me-2" />
                  {t('scheduling.scheduleModal.eventType.agent')}
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link
                  active={activeTab === 'application'}
                  onClick={() => handleEventTypeChange('application')}
                  disabled // TODO: Enable when applications are supported
                >
                  <i className="bi bi-grid-1x2-fill me-2"></i>
                  {t('scheduling.scheduleModal.eventType.application')}
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link
                  active={activeTab === 'data_sync'}
                  onClick={() => handleEventTypeChange('data_sync')}
                  disabled // TODO: Enable when data sync is supported
                >
                  <i className="bi bi-arrow-repeat me-2"></i>
                  {t('scheduling.scheduleModal.eventType.dataSync')}
                </Nav.Link>
              </Nav.Item>
            </Nav>
          </div>

          {/* Common Fields */}
          <Row>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>{t('scheduling.scheduleModal.fields.label')}</Form.Label>
                <Form.Control
                  type="text"
                  value={formData.label}
                  onChange={(e) => handleInputChange('label', e.target.value)}
                  placeholder={t('scheduling.scheduleModal.fields.labelPlaceholder')}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>{t('scheduling.scheduleModal.fields.timezone')}</Form.Label>
                <Form.Select value={formData.timezone} onChange={(e) => handleInputChange('timezone', e.target.value)}>
                  {getAllTimezones().map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          {/* Cron Expression */}
          <Form.Group className="mb-3">
            <Form.Label>{t('scheduling.scheduleModal.fields.frequency')}</Form.Label>
            <Form.Select
              value={formData.cronExpression}
              onChange={(e) => handleInputChange('cronExpression', e.target.value)}
              className="mb-2"
            >
              <option value="">{t('scheduling.scheduleModal.fields.frequencyPlaceholder')}</option>
              {commonCronExpressions.map((expr) => (
                <option key={expr.value} value={expr.value}>
                  {expr.label}
                </option>
              ))}
            </Form.Select>
            <Form.Control
              type="text"
              value={formData.cronExpression}
              onChange={(e) => handleInputChange('cronExpression', e.target.value)}
              placeholder={t('scheduling.scheduleModal.fields.cronPlaceholder')}
            />
            <Form.Text className="text-muted">{t('scheduling.scheduleModal.fields.cronHelp')}</Form.Text>
          </Form.Group>

          {/* Agent-specific fields */}
          {activeTab === 'agent' && (
            <>
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>{t('scheduling.scheduleModal.fields.agentId')}</Form.Label>
                    <Form.Control
                      type="text"
                      value={formData.agentId}
                      onChange={(e) => handleInputChange('agentId', e.target.value)}
                      placeholder={t('scheduling.scheduleModal.fields.agentIdPlaceholder')}
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>{t('scheduling.scheduleModal.fields.agentTitle')}</Form.Label>
                    <Form.Control
                      type="text"
                      value={formData.agentTitle}
                      onChange={(e) => handleInputChange('agentTitle', e.target.value)}
                      placeholder={t('scheduling.scheduleModal.fields.agentTitlePlaceholder')}
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Form.Group className="mb-3">
                <Form.Label>{t('scheduling.scheduleModal.fields.conversationId')}</Form.Label>
                <Form.Control
                  type="text"
                  value={formData.conversationId}
                  onChange={(e) => handleInputChange('conversationId', e.target.value)}
                  placeholder={t('scheduling.scheduleModal.fields.conversationIdPlaceholder')}
                />
                <Form.Text className="text-muted">{t('scheduling.scheduleModal.fields.conversationHelp')}</Form.Text>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>{t('scheduling.scheduleModal.fields.promptText')}</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={formData.promptText}
                  onChange={(e) => handleInputChange('promptText', e.target.value)}
                  placeholder={t('scheduling.scheduleModal.fields.promptTextPlaceholder')}
                />
              </Form.Group>
            </>
          )}

          {/* Application-specific fields */}
          {activeTab === 'application' && (
            <>
              <Form.Group className="mb-3">
                <Form.Label>{t('scheduling.scheduleModal.fields.application')}</Form.Label>
                <Form.Select value={formData.appId} onChange={(e) => handleInputChange('appId', e.target.value)}>
                  <option value="">{t('scheduling.scheduleModal.fields.applicationPlaceholder')}</option>
                  {availableApps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>

              <Alert variant="info">
                <i className="bi bi-info-circle me-2"></i>
                {t('scheduling.scheduleModal.applicationNotice')}
              </Alert>
            </>
          )}

          {/* Data sync-specific fields */}
          {activeTab === 'data_sync' && (
            <>
              <Form.Group className="mb-3">
                <Form.Label>{t('scheduling.scheduleModal.fields.sourceType')}</Form.Label>
                <Form.Select
                  value={formData.sourceType}
                  onChange={(e) => handleInputChange('sourceType', e.target.value)}
                >
                  <option value="knowledge_base">{t('scheduling.scheduleModal.sourceTypes.knowledgeBase')}</option>
                  <option value="s3">{t('scheduling.scheduleModal.sourceTypes.s3')}</option>
                  <option value="api">{t('scheduling.scheduleModal.sourceTypes.api')}</option>
                </Form.Select>
              </Form.Group>

              <Alert variant="info">
                <i className="bi bi-info-circle me-2"></i>
                {t('scheduling.scheduleModal.dataSyncNotice')}
              </Alert>
            </>
          )}
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={loading}>
            {t('scheduling.actions.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={loading || activeTab !== 'agent'}>
            {loading ? (
              <>
                <Spinner size="sm" className="me-2" />
                {isEditing
                  ? t('scheduling.scheduleModal.submitting.update')
                  : t('scheduling.scheduleModal.submitting.create')}
              </>
            ) : (
              <>
                <i className="bi bi-check-lg me-2"></i>
                {isEditing ? t('scheduling.modal.submit.update') : t('scheduling.modal.submit.create')}
              </>
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default ScheduleModal;

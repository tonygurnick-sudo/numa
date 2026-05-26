import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Form, Button, ButtonGroup, Alert, Spinner } from 'react-bootstrap';
import { Plus, Trash2, Mail } from 'lucide-react';
import { ConnectorsService } from '../../Services/ConnectorsService';
import type { EmailFilter, EmailFilterField, EmailFilterOp, GmailEventTrigger } from '../../types/agentSchedules';

type EmailFilterBuilderProps = {
  trigger: GmailEventTrigger;
  onChange: (trigger: GmailEventTrigger) => void;
};

const FIELDS: EmailFilterField[] = ['sender', 'subject', 'to', 'body', 'has_attachment'];
const OPS: EmailFilterOp[] = ['contains', 'equals', 'not_contains', 'matches'];

export const EmailFilterBuilder = ({ trigger, onChange }: EmailFilterBuilderProps) => {
  const { t } = useTranslation('automations');

  // Check Gmail connection status when this step loads. Vault is the source
  // of truth — the legacy data-connectors DDB table lags behind PAT vault
  // writes for unified connectors.
  const [gmailStatus, setGmailStatus] = useState<'loading' | 'connected' | 'not_connected'>('loading');
  useEffect(() => {
    ConnectorsService.getStatus('gmail')
      .then((s) => setGmailStatus(s.status === 'connected' ? 'connected' : 'not_connected'))
      .catch(() => setGmailStatus('not_connected'));
  }, []);

  const updateFilter = (idx: number, patch: Partial<EmailFilter>) => {
    const next = trigger.filters.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    onChange({ ...trigger, filters: next });
  };

  const addFilter = () => {
    onChange({
      ...trigger,
      filters: [...trigger.filters, { field: 'subject', op: 'contains', value: '' }],
    });
  };

  const removeFilter = (idx: number) => {
    onChange({ ...trigger, filters: trigger.filters.filter((_, i) => i !== idx) });
  };

  const setLogic = (logic: 'all' | 'any') => onChange({ ...trigger, filter_logic: logic });

  if (gmailStatus === 'loading') {
    return (
      <div className="workflow-step text-center py-5">
        <Spinner animation="border" size="sm" className="me-2" />
        <span className="text-muted">{t('trigger.event.checkingGmail')}</span>
      </div>
    );
  }

  if (gmailStatus === 'not_connected') {
    return (
      <div className="workflow-step">
        <h5 className="mb-1">{t('trigger.event.builder.title')}</h5>
        <p className="text-muted mb-4">{t('trigger.event.builder.subtitle')}</p>
        <Alert variant="warning">{t('trigger.event.gmailNotConnected')}</Alert>
      </div>
    );
  }

  return (
    <div className="workflow-step">
      <h5 className="mb-1">{t('trigger.event.builder.title')}</h5>
      <p className="text-muted mb-4">{t('trigger.event.builder.subtitle')}</p>

      {/* Source: Gmail only for now */}
      <Form.Group className="mb-4">
        <Form.Label className="small text-muted">{t('trigger.event.builder.source')}</Form.Label>
        <div className="d-flex align-items-center gap-2 p-3 border rounded bg-light">
          <Mail size={20} />
          <strong>{t('trigger.event.builder.sourceGmail')}</strong>
          <span className="text-muted small ms-auto">{t('trigger.event.builder.sourceLocked')}</span>
        </div>
      </Form.Group>

      {/* Logic */}
      {trigger.filters.length > 1 && (
        <Form.Group className="mb-3">
          <Form.Label className="small text-muted">{t('trigger.event.builder.matchLogic')}</Form.Label>
          <div>
            <ButtonGroup size="sm">
              <Button
                variant={trigger.filter_logic !== 'any' ? 'primary' : 'outline-secondary'}
                onClick={() => setLogic('all')}
              >
                {t('trigger.event.builder.matchAll')}
              </Button>
              <Button
                variant={trigger.filter_logic === 'any' ? 'primary' : 'outline-secondary'}
                onClick={() => setLogic('any')}
              >
                {t('trigger.event.builder.matchAny')}
              </Button>
            </ButtonGroup>
          </div>
        </Form.Group>
      )}

      {/* Filter rows */}
      <Form.Label className="small text-muted d-flex align-items-center justify-content-between">
        <span>{t('trigger.event.builder.filters')}</span>
        <span className="text-muted fst-italic">{t('trigger.event.builder.caseInsensitive')}</span>
      </Form.Label>
      {trigger.filters.length === 0 && (
        <Alert variant="warning" className="py-2 px-3 small mb-2">
          {t('trigger.event.builder.filterRequired')}
        </Alert>
      )}
      {trigger.filters.map((filter, idx) => (
        <div key={idx} className="d-flex gap-2 mb-2 align-items-center">
          <Form.Select
            size="sm"
            style={{ maxWidth: 160 }}
            value={filter.field}
            onChange={(e) => updateFilter(idx, { field: e.target.value as EmailFilterField })}
          >
            {FIELDS.map((f) => (
              <option key={f} value={f}>
                {t(`trigger.event.builder.fields.${f}`)}
              </option>
            ))}
          </Form.Select>
          {filter.field === 'has_attachment' ? (
            <Form.Select
              size="sm"
              style={{ maxWidth: 140 }}
              value={filter.value}
              onChange={(e) => updateFilter(idx, { op: 'equals', value: e.target.value })}
            >
              <option value="true">{t('trigger.event.builder.yes')}</option>
              <option value="false">{t('trigger.event.builder.no')}</option>
            </Form.Select>
          ) : (
            <>
              <Form.Select
                size="sm"
                style={{ maxWidth: 160 }}
                value={filter.op}
                onChange={(e) => updateFilter(idx, { op: e.target.value as EmailFilterOp })}
              >
                {OPS.map((op) => (
                  <option key={op} value={op}>
                    {t(`trigger.event.builder.ops.${op}`)}
                  </option>
                ))}
              </Form.Select>
              <Form.Control
                size="sm"
                value={filter.value}
                onChange={(e) => updateFilter(idx, { value: e.target.value })}
                placeholder={t('trigger.event.builder.valuePlaceholder')}
              />
            </>
          )}
          <Button size="sm" variant="outline-danger" onClick={() => removeFilter(idx)}>
            <Trash2 size={14} />
          </Button>
        </div>
      ))}

      <Button size="sm" variant="outline-secondary" onClick={addFilter} className="mt-2">
        <Plus size={14} className="me-1" />
        {t('trigger.event.builder.addFilter')}
      </Button>

      {/* Email context auto-injection */}
      <div className="mt-4 px-3 py-2 border rounded bg-light d-flex align-items-start gap-2">
        <Form.Check
          type="switch"
          id="include-email-context"
          checked={trigger.include_email_context !== false}
          onChange={(e) => onChange({ ...trigger, include_email_context: e.target.checked })}
          className="mt-1 flex-shrink-0"
        />
        <div>
          <div className="small">{t('trigger.event.builder.includeContext')}</div>
          <div className="small text-muted">{t('trigger.event.builder.includeContextHelp')}</div>
        </div>
      </div>
    </div>
  );
};

export default EmailFilterBuilder;

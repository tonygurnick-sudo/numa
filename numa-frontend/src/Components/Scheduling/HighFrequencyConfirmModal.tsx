/* eslint-disable i18next/no-literal-string -- admin-only scheduling UI; translations deferred to round-2 */
import { useState, useEffect } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

type HighFrequencyConfirmModalProps = {
  show: boolean;
  projectedRunsPerMonth: number;
  intervalMinutes: number | null;
  /** Resolved company quota — used to show "X% of company quota". Optional. */
  companyMonthlyCap?: number;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Friction confirmation modal shown when a user picks a cadence that would
 * generate > 100 runs/month OR fires more often than every 30 minutes.
 *
 * Required tickbox: "I understand this schedule will use ~X runs of our
 * company quota per month." Direct response to the FEAT-105 ticket bullet
 * about making it as annoying as possible to set up quota-damaging agents.
 */
export const HighFrequencyConfirmModal: React.FC<HighFrequencyConfirmModalProps> = ({
  show,
  projectedRunsPerMonth,
  intervalMinutes,
  companyMonthlyCap,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation('agents');
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset the tickbox each time the modal opens so the user has to actively
  // re-check "I understand" — friction is the point.
  useEffect(() => {
    if (show) setAcknowledged(false);
  }, [show]);

  const pctOfCompany = companyMonthlyCap ? Math.round((projectedRunsPerMonth / companyMonthlyCap) * 100) : null;

  const intervalLabel =
    intervalMinutes != null
      ? intervalMinutes < 60
        ? `every ${intervalMinutes} minute(s)`
        : intervalMinutes < 1440
          ? `every ${Math.round(intervalMinutes / 60)} hour(s)`
          : `every ${Math.round(intervalMinutes / 1440)} day(s)`
      : 'frequently';

  return (
    <Modal show={show} onHide={onCancel} centered backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-exclamation-triangle-fill text-warning me-2" />
          {t('scheduling.friction.title', { defaultValue: 'High-frequency schedule' })}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>
          {t('scheduling.friction.lead', {
            defaultValue: 'This schedule will run {{interval}} — about {{runs}} times per month.',
            interval: intervalLabel,
            runs: projectedRunsPerMonth,
          })}
        </p>
        {pctOfCompany != null && (
          <div className="alert alert-warning small">
            <i className="bi bi-pie-chart-fill me-2" />
            That&apos;s roughly <strong>{pctOfCompany}%</strong> of your company&apos;s monthly quota of{' '}
            {companyMonthlyCap} scheduled runs. Each run also consumes AI tokens (chat, tools, code execution) which
            appear on the company bill.
          </div>
        )}
        <ul className="small text-muted">
          <li>If the schedule&apos;s prompt is broken, every run still consumes quota and tokens.</li>
          <li>Frequent runs make notifications noisy — confirm email recipients are right.</li>
          <li>Less-frequent options (hourly / daily / on-event) are usually better for reports.</li>
        </ul>
        <Form.Check
          type="checkbox"
          id="high-freq-ack"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-3"
          label={
            <span className="fw-semibold">
              {t('scheduling.friction.ack', {
                defaultValue: 'I understand this schedule will use ~{{runs}} runs of our company quota per month.',
                runs: projectedRunsPerMonth,
              })}
            </span>
          }
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          {t('scheduling.friction.cancel', { defaultValue: 'Pick a less-frequent cadence' })}
        </Button>
        <Button variant="warning" onClick={onConfirm} disabled={!acknowledged}>
          {t('scheduling.friction.confirm', { defaultValue: 'Save anyway' })}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

// `isHighFrequencyCadence` lives in ../../utils/cronProjection — re-exported
// from there to satisfy react-refresh/only-export-components on this file.

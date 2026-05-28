/**
 * Recurrence picker — collects pattern, interval, days/dayOfMonth/monthOfYear,
 * time, timezone, start/end date and occurrence count for a ticket
 * recurrence rule. Builds a {@link RecurrenceConfig} payload and hands it to
 * the parent via `onSave`.
 *
 * The picker never surfaces cron syntax; the backend derives the AWS cron
 * expression from these higher-level fields.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Button, Spinner, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { RecurrenceConfig, RecurrencePattern, RecurrenceRule } from '../../../types/ops';
import { DOW_LABEL_KEYS, MONTH_NUMBERS, summarizeRecurrence } from './recurrenceHelpers';

interface RecurrencePickerProps {
  show: boolean;
  onHide: () => void;
  /** Existing rule when editing — null/undefined when creating. */
  initial?: RecurrenceRule | null;
  /** Save handler. Receives the config payload; parent owns the API call. */
  onSave: (config: RecurrenceConfig) => Promise<void>;
  /** Remove handler. Only invoked when `initial` is set. */
  onRemove?: () => Promise<void>;
}

function todayYmd(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}-${parts.find((p) => p.type === 'day')!.value}`;
}

function detectBrowserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const RecurrencePicker: React.FC<RecurrencePickerProps> = ({ show, onHide, initial, onSave, onRemove }) => {
  const { t } = useTranslation('ops');
  const [pattern, setPattern] = useState<RecurrencePattern>('weekly');
  const [interval, setIntervalValue] = useState<number>(1);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1]); // default Monday
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);
  const [monthOfYear, setMonthOfYear] = useState<number>(1);
  const [timeOfDay, setTimeOfDay] = useState<string>('09:00');
  const [timezone, setTimezone] = useState<string>(detectBrowserTz());
  const [startDate, setStartDate] = useState<string>(todayYmd(detectBrowserTz()));
  const [endDate, setEndDate] = useState<string>('');
  const [maxOccurrences, setMaxOccurrences] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed from existing rule when editing.
  useEffect(() => {
    if (!initial) {
      // Reset to defaults each time the create modal opens
      const tz = detectBrowserTz();
      setPattern('weekly');
      setIntervalValue(1);
      setDaysOfWeek([1]);
      setDayOfMonth(1);
      setMonthOfYear(1);
      setTimeOfDay('09:00');
      setTimezone(tz);
      setStartDate(todayYmd(tz));
      setEndDate('');
      setMaxOccurrences('');
      setError(null);
      return;
    }
    const cfg = initial.config;
    setPattern(cfg.pattern);
    setIntervalValue(cfg.interval);
    setDaysOfWeek(cfg.daysOfWeek ?? [1]);
    setDayOfMonth(cfg.dayOfMonth ?? 1);
    setMonthOfYear(cfg.monthOfYear ?? 1);
    setTimeOfDay(cfg.timeOfDay);
    setTimezone(cfg.timezone);
    setStartDate(cfg.startDate);
    setEndDate(cfg.endDate ?? '');
    setMaxOccurrences(cfg.maxOccurrences ? String(cfg.maxOccurrences) : '');
    setError(null);
  }, [initial, show]);

  const config: RecurrenceConfig = useMemo(
    () => ({
      pattern,
      interval,
      daysOfWeek: pattern === 'weekly' ? daysOfWeek : undefined,
      dayOfMonth: pattern === 'monthly' || pattern === 'yearly' ? dayOfMonth : undefined,
      monthOfYear: pattern === 'yearly' ? monthOfYear : undefined,
      timeOfDay,
      timezone,
      startDate,
      endDate: endDate || null,
      maxOccurrences: maxOccurrences ? parseInt(maxOccurrences, 10) : null,
    }),
    [pattern, interval, daysOfWeek, dayOfMonth, monthOfYear, timeOfDay, timezone, startDate, endDate, maxOccurrences]
  );

  const preview = useMemo(() => summarizeRecurrence(config, t), [config, t]);

  const handleToggleDay = (day: number): void => {
    setDaysOfWeek((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const handleSave = async (): Promise<void> => {
    setError(null);
    // Client-side pre-validation matching the backend zod schema.
    if (pattern === 'weekly' && daysOfWeek.length === 0) {
      setError(t('recurrence.error.weeklyNoDays'));
      return;
    }
    if (endDate && endDate < startDate) {
      setError(t('recurrence.error.endBeforeStart'));
      return;
    }
    setSaving(true);
    try {
      await onSave(config);
      onHide();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('recurrence.error.generic'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (): Promise<void> => {
    if (!onRemove) return;
    setRemoving(true);
    try {
      await onRemove();
      onHide();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('recurrence.error.generic'));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>{initial ? t('recurrence.titleEdit') : t('recurrence.titleCreate')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}

        <Form.Group className="mb-3">
          <Form.Label>{t('recurrence.field.pattern')}</Form.Label>
          <Form.Select value={pattern} onChange={(e) => setPattern(e.target.value as RecurrencePattern)}>
            <option value="daily">{t('recurrence.pattern.daily')}</option>
            <option value="weekly">{t('recurrence.pattern.weekly')}</option>
            <option value="monthly">{t('recurrence.pattern.monthly')}</option>
            <option value="yearly">{t('recurrence.pattern.yearly')}</option>
          </Form.Select>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('recurrence.field.interval')}</Form.Label>
          <Form.Control
            type="number"
            min={1}
            max={365}
            value={interval}
            onChange={(e) => setIntervalValue(Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
        </Form.Group>

        {pattern === 'weekly' && (
          <Form.Group className="mb-3">
            <Form.Label>{t('recurrence.field.daysOfWeek')}</Form.Label>
            <div className="d-flex gap-2 flex-wrap">
              {DOW_LABEL_KEYS.map((d) => (
                <Button
                  key={d.value}
                  size="sm"
                  variant={daysOfWeek.includes(d.value) ? 'primary' : 'outline-secondary'}
                  onClick={() => handleToggleDay(d.value)}
                >
                  {t(`recurrence.dow.${d.key}`)}
                </Button>
              ))}
            </div>
          </Form.Group>
        )}

        {(pattern === 'monthly' || pattern === 'yearly') && (
          <Form.Group className="mb-3">
            <Form.Label>{t('recurrence.field.dayOfMonth')}</Form.Label>
            <Form.Control
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Math.max(1, Math.min(31, parseInt(e.target.value, 10) || 1)))}
            />
            <Form.Text className="text-muted">{t('recurrence.help.dayOfMonth')}</Form.Text>
          </Form.Group>
        )}

        {pattern === 'yearly' && (
          <Form.Group className="mb-3">
            <Form.Label>{t('recurrence.field.monthOfYear')}</Form.Label>
            <Form.Select value={monthOfYear} onChange={(e) => setMonthOfYear(parseInt(e.target.value, 10))}>
              {MONTH_NUMBERS.map((m) => (
                <option key={m} value={m}>
                  {t(`recurrence.month.${m}`)}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        )}

        <div className="row g-3 mb-3">
          <Form.Group className="col-md-4">
            <Form.Label>{t('recurrence.field.timeOfDay')}</Form.Label>
            <Form.Control type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
          </Form.Group>
          <Form.Group className="col-md-8">
            <Form.Label>{t('recurrence.field.timezone')}</Form.Label>
            <Form.Control
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Pacific/Auckland"
            />
          </Form.Group>
        </div>

        <div className="row g-3 mb-3">
          <Form.Group className="col-md-4">
            <Form.Label>{t('recurrence.field.startDate')}</Form.Label>
            <Form.Control type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Form.Group>
          <Form.Group className="col-md-4">
            <Form.Label>{t('recurrence.field.endDate')}</Form.Label>
            <Form.Control type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <Form.Text className="text-muted">{t('recurrence.help.optional')}</Form.Text>
          </Form.Group>
          <Form.Group className="col-md-4">
            <Form.Label>{t('recurrence.field.maxOccurrences')}</Form.Label>
            <Form.Control
              type="number"
              min={1}
              value={maxOccurrences}
              onChange={(e) => setMaxOccurrences(e.target.value)}
            />
            <Form.Text className="text-muted">{t('recurrence.help.optional')}</Form.Text>
          </Form.Group>
        </div>

        <Alert variant="info" className="mb-0">
          <strong>{t('recurrence.preview')}:</strong> {preview}
        </Alert>
      </Modal.Body>
      <Modal.Footer>
        {initial && onRemove && (
          <Button variant="outline-danger" onClick={handleRemove} disabled={removing || saving} className="me-auto">
            {removing ? <Spinner size="sm" /> : t('recurrence.button.remove')}
          </Button>
        )}
        <Button variant="secondary" onClick={onHide} disabled={saving || removing}>
          {t('recurrence.button.cancel')}
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={saving || removing}>
          {saving ? <Spinner size="sm" /> : t('recurrence.button.save')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

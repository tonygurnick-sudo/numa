/**
 * Presentational card for one event source in the Automations Builder
 * source picker. Driven entirely by the unified event-sources registry —
 * no per-source code lives here.
 *
 * Renders one of three states:
 *   - available + connected:    clickable, "Connected" check
 *   - available + disconnected: clickable, "Connect on Integrations" link
 *   - unavailable:              hard-disabled, reason text instead of click
 *
 * Plus a subtle source-mechanism badge at the bottom (Pipedream / Native /
 * Both) so users can see at a glance how their data is flowing.
 */

import { Card } from 'react-bootstrap';
import { Link as RouterLink } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getConnectionConfig } from '../../config/integrationsConfig';
import type { EventSource } from '../../../../lib/event-sources';

export type EventSourceCardState =
  | { kind: 'available'; connected: true; healthy: boolean }
  | { kind: 'available'; connected: false }
  /**
   * Source can't be used yet. `reasonKey` is an i18n key; `connectCta`,
   * when set, renders a CTA link to the right setup destination.
   */
  | { kind: 'unavailable'; reasonKey: string; connectCta?: { to: string; labelKey: string } };

type Props = {
  source: EventSource;
  state: EventSourceCardState;
  selected: boolean;
  onSelect: () => void;
};

const sourceTypeLabelKey = (source: EventSource): string => `eventSources.mechanism.${source.source_type}`;

export const EventSourceCard = ({ source, state, selected, onSelect }: Props) => {
  const { t } = useTranslation('automations');
  const cfg = getConnectionConfig(source.icon_slug);
  const label = t(source.label_key, { defaultValue: cfg?.name ?? source.source_id });
  const description = t(source.description_key, { defaultValue: cfg?.description ?? '' });

  const isClickable = state.kind === 'available' && state.connected;
  const isUnhealthy = state.kind === 'available' && state.connected && !state.healthy;

  const className = [
    'workflow-trigger-card',
    selected ? 'workflow-trigger-card--selected' : '',
    !isClickable ? 'workflow-trigger-card--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Common header: icon + label + status indicator. text-start + w-100
  // overrides the parent SCSS centering rules so cards align cleanly with
  // each other regardless of label/description length.
  const header = (
    <div className="d-flex align-items-center gap-2 w-100">
      {cfg?.img_src ? (
        <img src={cfg.img_src} alt="" width={24} height={24} />
      ) : (
        <i className={`${cfg?.fallback_icon ?? 'bi bi-puzzle'}`} />
      )}
      <strong className="small">{label}</strong>
      {state.kind === 'available' && state.connected && !isUnhealthy && (
        <CheckCircle2
          size={14}
          className="text-success ms-auto"
          aria-label={t('pipedreamTriggers.appPicker.connected')}
        />
      )}
      {isUnhealthy && (
        <AlertCircle
          size={14}
          className="text-warning ms-auto"
          aria-label={t('pipedreamTriggers.appPicker.unhealthy')}
        />
      )}
      {state.kind === 'unavailable' && (
        <Lock size={12} className="text-muted ms-auto" aria-label={t('eventSources.unavailable.lockAria')} />
      )}
    </div>
  );

  const footerBadge = (
    <div className="text-muted small d-flex align-items-center" style={{ fontSize: '0.7rem', opacity: 0.7 }}>
      <span>{t('eventSources.sourceLabel')}: </span>
      <span className="ms-1">{t(sourceTypeLabelKey(source))}</span>
    </div>
  );

  // Fully unavailable card: reason text + (optional) CTA, no click.
  if (state.kind === 'unavailable') {
    return (
      <Card className={className} style={{ width: 220, opacity: 0.7 }}>
        <Card.Body className="d-flex flex-column gap-2 p-3 text-start align-items-stretch">
          {header}
          {description && <div className="text-muted small">{description}</div>}
          <div className="text-muted small fst-italic">{t(state.reasonKey)}</div>
          {state.connectCta && (
            <RouterLink to={state.connectCta.to} className="small text-decoration-none">
              {t(state.connectCta.labelKey)} →
            </RouterLink>
          )}
          <div className="border-top pt-2 mt-1">{footerBadge}</div>
        </Card.Body>
      </Card>
    );
  }

  // Available but disconnected: render the disabled-style card with the
  // standard /integrations CTA link.
  if (state.kind === 'available' && !state.connected) {
    return (
      <Card className={className} style={{ width: 220, opacity: 0.85 }}>
        <Card.Body className="d-flex flex-column gap-2 p-3 text-start align-items-stretch">
          {header}
          {description && <div className="text-muted small">{description}</div>}
          <RouterLink to="/integrations" className="small text-decoration-none">
            {t('pipedreamTriggers.appPicker.connectCta')} →
          </RouterLink>
          <div className="border-top pt-2 mt-1">{footerBadge}</div>
        </Card.Body>
      </Card>
    );
  }

  // Connected — fully clickable card.
  return (
    <Card
      className={className}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      style={{ width: 220, cursor: 'pointer' }}
    >
      <Card.Body className="d-flex flex-column gap-2 p-3 text-start align-items-stretch">
        {header}
        {description && <div className="text-muted small">{description}</div>}
        <div className="border-top pt-2 mt-1">{footerBadge}</div>
      </Card.Body>
    </Card>
  );
};

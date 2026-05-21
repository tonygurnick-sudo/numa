import React from 'react';
import { useTranslation } from 'react-i18next';

export type ConnectorStatus =
  | 'connected'
  | 'expired'
  | 'check_failed'
  | 'inactive'
  | 'disconnected'
  | 'not_enabled'
  | 'connecting';

interface ConnectorStatusBadgeProps {
  status: ConnectorStatus;
  className?: string;
  /** Optional contextual detail (e.g. caught error message) shown via `title=` for hover-reveal. */
  detail?: string;
}

// We deliberately split *expired* (amber, recoverable) from *inactive* (red,
// account-level dead) and *check_failed* (amber, transient) — earlier copy
// collapsed all three into a single red "Token expired" pill, which misled
// users when the failure was a network blip rather than an actual auth issue.
const STATUS_TO_VARIANT: Record<ConnectorStatus, { tone: string; icon: string; key: string; fallback: string }> = {
  connected: { tone: 'text-success', icon: 'bi-check-circle', key: 'remote.connected', fallback: 'Connected' },
  expired: {
    tone: 'text-warning',
    icon: 'bi-exclamation-triangle',
    key: 'remote.tokenExpired',
    fallback: 'Reconnect required',
  },
  check_failed: {
    tone: 'text-warning',
    icon: 'bi-exclamation-triangle',
    key: 'remote.checkFailed',
    fallback: "Couldn't verify connection",
  },
  inactive: {
    tone: 'text-danger',
    icon: 'bi-x-circle',
    key: 'remote.inactiveStatus',
    fallback: 'Account inactive',
  },
  disconnected: {
    tone: 'text-muted',
    icon: 'bi-dash-circle',
    key: 'remote.disconnectedStatus',
    fallback: 'Not connected',
  },
  not_enabled: {
    tone: 'text-muted',
    icon: 'bi-dash-circle',
    key: 'remote.notEnabledStatus',
    fallback: 'Not enabled',
  },
  connecting: { tone: 'text-muted', icon: 'bi-hourglass-split', key: 'remote.connecting', fallback: 'Connecting…' },
};

export function ConnectorStatusBadge({ status, className, detail }: ConnectorStatusBadgeProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const variant = STATUS_TO_VARIANT[status];
  return (
    <span className={`${variant.tone} small d-inline-flex align-items-center ${className ?? ''}`.trim()} title={detail}>
      <i className={`bi ${variant.icon} me-1`} aria-hidden />
      {t(variant.key, variant.fallback)}
    </span>
  );
}
